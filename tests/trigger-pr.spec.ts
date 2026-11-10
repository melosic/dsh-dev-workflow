import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { Config, PR_SECTIONS } from '../src/config.js'
import { createTranslator } from '../src/i18n.js'
import { createWorkflowState } from '../src/state.js'
import {
  createPrePrTrigger,
  detectPullRequest,
  evaluatePullRequest,
} from '../src/triggers/pre-pr.js'
import { askOf, makeApproval, makeConflictGit, makeExec, type HarnessApproval } from './harness.js'

const t = createTranslator('en-US')
const config = Config({})

/** A description that satisfies the template the specification ships. */
const GOOD_BODY = [
  '## What',
  '',
  'Add a `--json` flag to the status command.',
  '',
  '## Why',
  '',
  'Scripts cannot parse the current prose output. Closes #7.',
  '',
  '## How to verify',
  '',
  'Run `/dev-workflow status --json` and check that it parses.',
  '',
  '## Type of change',
  '',
  '- Feature: behaviour that did not exist now does.',
  '',
  '## Non-goals',
  '',
  'Changing the human-readable output.',
  '',
  '## Risk and rollback',
  '',
  'None; revert the commit.',
  '',
  '## Checklist',
  '',
  '- [x] One concern in this pull request.',
  '- [x] The tests fail without the change.',
].join('\n')

/** The sections the default configuration requires, in template order. */
const SECTIONS = PR_SECTIONS.join(', ')

/**
 * Build the listener the way the runtime does.
 * @param options - configuration overrides and the shared state to use.
 * @returns the listener, its state, and resolved configuration.
 */
function trigger(
  options: {
    config?: Record<string, unknown>
    state?: ReturnType<typeof createWorkflowState>
    git?: ReturnType<typeof makeConflictGit>
    logs?: string[]
    approval?: HarnessApproval
  } = {},
) {
  const state = options.state ?? createWorkflowState()
  const resolved = Config(options.config ?? {})
  const listener = createPrePrTrigger({
    config: () => resolved,
    t: () => t,
    state,
    git: () => options.git ?? makeConflictGit(),
    log: (line) => {
      options.logs?.push(line)
    },
    warn: (line) => {
      options.logs?.push(line)
    },
    ...(options.approval === undefined ? {} : { approval: () => options.approval?.service }),
  })
  return { listener, state, config: resolved }
}

/** Run one shell command through the listener. */
async function fire(
  listener: ReturnType<typeof createPrePrTrigger>,
  command: string,
  options: {
    sessionId?: string
    cwd?: string
    withoutAgent?: boolean
    downstream?: PreToolDecision
    signal?: AbortSignal
  } = {},
): Promise<PreToolDecision> {
  return listener(
    makeExec(command, {
      sessionId: options.sessionId,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      withoutAgent: options.withoutAgent,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
    async () => options.downstream ?? { kind: 'allow' },
  )
}

/**
 * Wrap a multi-line body the way a shell sees it.
 *
 * Single quotes, not `JSON.stringify`: the lexer resolves escapes, so a
 * double-quoted `\n` would reach the gate as a bare `n` and the sections would
 * all look empty.
 * @param body - the description text.
 * @returns the text as one single-quoted shell word.
 */
function quoted(body: string): string {
  return `'${body}'`
}

describe('src/triggers/pre-pr.ts', () => {
  it('recognises a pull request only when gh is asked to create one', () => {
    expect(detectPullRequest('gh pr create --title "feat(a): b" --body "x"')).toMatchObject({
      title: 'feat(a): b',
      body: 'x',
    })
    expect(detectPullRequest('gh pr create -t "feat(a): b" -F body.md')).toMatchObject({
      title: 'feat(a): b',
      bodyFile: 'body.md',
    })
    // `--title=` is the form an agent writes when it builds the line by hand.
    expect(detectPullRequest('gh pr create --title="feat(a): b"')).toMatchObject({
      title: 'feat(a): b',
    })
    // `-R` precedes the subcommand and is not the subcommand.
    expect(detectPullRequest('gh -R owner/repo pr create -t "feat(a): b"')).toMatchObject({
      title: 'feat(a): b',
    })
    // `gh pr merge --subject` is the text squash writes to the base branch, and
    // `gh pr edit --title` rewrites the title a later squash will use.
    expect(detectPullRequest('gh pr merge 13 --squash --subject "feat(a): b"')).toMatchObject({
      title: 'feat(a): b',
    })
    expect(detectPullRequest('gh pr edit 13 --title "feat(a): b"')).toMatchObject({
      title: 'feat(a): b',
      // `edit` and `merge` name an existing pull request, and that number is
      // the only way the check can tell a reference to the issue from a
      // reference to the pull request itself.
      number: '13',
    })
    expect(detectPullRequest('gh pr merge 13 --squash --subject "feat(a): b"')).toMatchObject({
      number: '13',
    })
    // `create` has no number until the forge issues one, so the field is
    // absent rather than guessed.
    expect(detectPullRequest('gh pr create --title "feat(a): b"')).not.toHaveProperty('number')
    // A title the shell builds is not readable text, so it is reported as such
    // instead of being judged as the literal `$(…)`.
    expect(detectPullRequest('gh pr create --title=$(cat t.md)')).toMatchObject({
      titleLiteral: false,
    })

    for (const command of [
      'gh pr view 13',
      'gh pr merge 13 --squash',
      'gh pr edit 13 --body "x"',
      'gh pr list',
      'git commit -m "feat(a): b"',
      'echo "gh pr create"',
    ]) {
      expect(detectPullRequest(command), command).toBeUndefined()
    }
  })

  it('asks about a title that breaks the commit conventions', async () => {
    const { listener, state } = trigger()
    const decision = await fire(
      listener,
      `gh pr create --title "Add the flag" --body ${quoted(GOOD_BODY)}`,
    )

    expect(decision.kind).toBe('ask')
    // The title becomes the squash-merge commit on main, so it is judged by the
    // commit-message rules rather than by a separate set.
    expect((decision as { reason: string }).reason).toContain(
      t('tool.check_commit_message.error.missing_type'),
    )
    expect(state.lastOutcome()).toMatchObject({ kind: 'pr', ok: false })
  })

  it('asks about a description that leaves the template sections empty', async () => {
    const { listener } = trigger()
    const body = ['## What', '', 'Add a flag.', '', '## Why', '', '## How to verify', ''].join('\n')
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a flag" --body ${quoted(body)}`,
    )

    expect(decision.kind).toBe('ask')
    const reason = (decision as { reason: string }).reason
    expect(reason).toContain('Why')
    expect(reason).toContain('How to verify')
    expect(reason).not.toContain('What,')
  })

  it('asks about a description that omits the template altogether', async () => {
    const { listener } = trigger()
    const decision = await fire(
      listener,
      'gh pr create --title "feat(cli): add a flag" --body "Adds a flag."',
    )
    expect(decision.kind).toBe('ask')
    expect((decision as { reason: string }).reason).toContain(SECTIONS)
  })

  // The one section where "none" is not an answer. A change with no non-goals
  // honestly has none; this section exists to show the change was run, and
  // "not applicable" is the author reporting that no evidence exists.
  it('asks about a verification section that states no evidence', () => {
    const body = GOOD_BODY.replace(
      'Run `/dev-workflow status --json` and check that it parses.',
      'None.',
    )
    const outcome = evaluatePullRequest({ title: 'feat(cli): add a flag', body }, config, t)

    expect(outcome.ok).toBe(false)
    expect(outcome.errors).toContain(
      t('trigger.pre_pr.error.verification', { section: 'How to verify' }),
    )
  })

  it('asks about the same answer spelled as a dismissal', () => {
    for (const dismissal of ['n/a', 'Not applicable.', '**None**', '无', '（不适用）']) {
      const body = GOOD_BODY.replace(
        'Run `/dev-workflow status --json` and check that it parses.',
        dismissal,
      )
      const outcome = evaluatePullRequest({ body }, config, t)
      expect(outcome.ok, dismissal).toBe(false)
    }
  })

  // The rule has to let through a sentence that merely starts with the same
  // word: "none of the fixtures cover this, so I ran it by hand" is the answer
  // the section is asking for, not a refusal to give one.
  it('accepts a verification section that goes on to say what was run', () => {
    const body = GOOD_BODY.replace(
      'Run `/dev-workflow status --json` and check that it parses.',
      'None of the fixtures cover this, so I started a scratch profile and ran the command there.',
    )
    const outcome = evaluatePullRequest({ title: 'feat(cli): add a flag', body }, config, t)
    expect(outcome.errors).not.toContain(
      t('trigger.pre_pr.error.verification', { section: 'How to verify' }),
    )
  })

  // The section names belong to the template. A repository that renamed the
  // headings has no "How to verify" for this rule to read, and inventing one
  // would report every such pull request as broken.
  it('has no verification rule when the template has no such section', () => {
    const renamed = Config({ prSections: ['What'] })
    const body = ['## What', '', 'None.'].join('\n')
    expect(evaluatePullRequest({ body }, renamed, t).ok).toBe(true)
  })

  it('asks about a checklist left unticked', async () => {
    const { listener } = trigger()
    const body = `${GOOD_BODY}\n- [ ] Documentation updated\n`
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a flag" --body ${quoted(body)}`,
    )
    expect(decision.kind).toBe('ask')
    expect((decision as { reason: string }).reason).toContain(
      t('trigger.pre_pr.error.checklist', { count: 1 }),
    )
  })

  it('leaves checkboxes outside the template sections alone', async () => {
    const { listener } = trigger()
    const body = `${GOOD_BODY}\n\n## Remaining work\n\n- [ ] Follow-up pull request\n`
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a flag" --body ${quoted(body)}`,
    )
    expect(decision.kind).toBe('allow')
  })

  // GitHub pre-fills a repository template into the description box, so an
  // untouched pull request arrives as headings whose only content is the
  // template's own `<!-- what to write here -->` hint. Reading that hint as
  // text would let every pull request through the moment a template was added.
  it('does not count template hints as a filled section', () => {
    const body = [
      '## What',
      '<!-- Describe the change in one sentence. -->',
      '## Why',
      '<!-- Why is this needed? Link the issue. -->',
      '## How to verify',
      '<!-- What should a reviewer run? -->',
    ].join('\n')
    const outcome = evaluatePullRequest({ body }, config, t)
    expect(outcome.ok).toBe(false)
    expect(outcome.errors).toContain(t('trigger.pre_pr.error.description', { sections: SECTIONS }))
  })

  it('does not count a checkbox inside a comment', () => {
    const body = `${GOOD_BODY}\n<!--\n- [ ] this line is an instruction, not a task\n-->`
    const outcome = evaluatePullRequest({ body }, config, t)
    expect(outcome.ok).toBe(true)
  })

  it('does not count an issue reference written inside a comment', () => {
    const body = `${GOOD_BODY.replace(' Closes #7.', '')}\n<!-- Closes #12 -->`
    const outcome = evaluatePullRequest({ body }, config, t)
    expect(outcome.warnings).toContain(t('trigger.pre_pr.warn.issue'))
  })

  it('still blocks a real unticked box next to a comment', () => {
    const body = `${GOOD_BODY}\n<!-- a note -->\n- [ ] Documentation updated`
    const outcome = evaluatePullRequest({ body }, config, t)
    expect(outcome.ok).toBe(false)
    expect(outcome.errors).toContain(t('trigger.pre_pr.error.checklist', { count: 1 }))
  })

  it('asks about a description that keeps its text outside the comments', async () => {
    const { listener } = trigger()
    const body = [
      '## What',
      '<!-- Describe the change. -->',
      'Add a flag.',
      '## Why',
      '<!-- Why? -->',
      'Scripts need it. Closes #7.',
      '## How to verify',
      '<!-- What to run? -->',
      'Run it.',
      '## Type of change',
      '<!-- Which one? -->',
      'Feature.',
      '## Non-goals',
      '<!-- What is out of scope? -->',
      'Nothing.',
      '## Risk and rollback',
      '<!-- What could break? -->',
      'None.',
      '## Checklist',
      '<!-- Tick what applies. -->',
      '- [x] One concern.',
    ].join('\n')
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a flag" --body ${quoted(body)}`,
    )
    expect(decision.kind).toBe('allow')
  })

  it('notes a missing issue reference without blocking on it', () => {
    const outcome = evaluatePullRequest(
      { title: 'feat(cli): add a flag', body: GOOD_BODY.replace(' Closes #7.', '') },
      config,
      t,
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.warnings).toContain(t('trigger.pre_pr.warn.issue'))
  })

  // A number is not a reference. `gh pr edit 13` writes `#13` into the
  // description as a matter of habit, and that traces the change back to
  // itself rather than to the reason it exists.
  it('does not count a pull request citing only itself as naming an issue', () => {
    const outcome = evaluatePullRequest(
      {
        title: 'feat(cli): add a flag',
        body: GOOD_BODY.replace(' Closes #7.', ' Closes #13.'),
        number: '13',
      },
      config,
      t,
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.warnings).toContain(t('trigger.pre_pr.warn.self_issue'))
    expect(outcome.warnings).not.toContain(t('trigger.pre_pr.warn.issue'))
  })

  it('takes a real issue beside the pull request number as a reference', () => {
    const body = GOOD_BODY.replace(' Closes #7.', ' Closes #13, see #7.')
    const outcome = evaluatePullRequest(
      { title: 'feat(cli): add a flag', body, number: '13' },
      config,
      t,
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.warnings).toEqual([])
  })

  // `gh pr create` has no number yet, so a self-reference there is unknowable
  // and the reference is accepted.
  it('accepts a reference it cannot compare against when no number is known', () => {
    const body = GOOD_BODY.replace(' Closes #7.', ' Closes #13.')
    const outcome = evaluatePullRequest({ title: 'feat(cli): add a flag', body }, config, t)
    expect(outcome.warnings).toEqual([])
  })

  // The section names are a property of the repository's template, not of the
  // workflow. A repository that writes its template in another language would
  // otherwise be told on every pull request that it is missing sections its
  // template never asked for.
  it('judges the sections the repository configured, not the default names', () => {
    const renamed = Config({ prSections: ['改了什么', '为什么', '怎么验证'] })
    const body = [
      '## 改了什么',
      '',
      '加一个 flag。',
      '',
      '## 为什么',
      '',
      '脚本要解析。',
      '',
      '## 怎么验证',
      '',
      '跑一遍。',
    ].join('\n')

    expect(evaluatePullRequest({ body }, config, t).ok).toBe(false)
    expect(evaluatePullRequest({ body }, renamed, t).ok).toBe(true)
  })

  it('still requires every configured section, by its configured name', () => {
    const renamed = Config({ prSections: ['改了什么', '为什么'] })
    const body = ['## What', '', 'Add a flag.', '', '## Why', '', 'Scripts need it.'].join('\n')
    const outcome = evaluatePullRequest({ body }, renamed, t)

    expect(outcome.ok).toBe(false)
    expect(outcome.errors).toContain(
      t('trigger.pre_pr.error.description', { sections: '改了什么, 为什么' }),
    )
  })

  it('counts unticked boxes only inside the configured sections', () => {
    const renamed = Config({ prSections: ['What'] })
    const body = ['## What', '', 'Add a flag.', '', '## Checklist', '', '- [ ] Tests added'].join(
      '\n',
    )

    // The box is under `## Checklist`, which is not a configured section, so it
    // is not a task this check counts — the same rule that lets a richer
    // template coexist with the gate.
    expect(evaluatePullRequest({ body }, renamed, t).ok).toBe(true)
  })

  // Which headings are required is a property of the repository, not of this
  // plugin. Reading the built-in list instead told every pull request in a
  // repository whose template asks different questions that it had missed six
  // headings it was never shown.
  it('judges the description against the repository template', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-pr-template-'))
    mkdirSync(join(directory, '.github'), { recursive: true })
    writeFileSync(
      join(directory, '.github', 'pull_request_template.md'),
      ['## What changed', '<!-- one sentence -->', '## How to test', '<!-- what to run -->'].join(
        '\n',
      ),
      'utf8',
    )
    const { listener } = trigger()

    const own = ['## What changed', '', 'Add a flag.', '', '## How to test', '', 'Run it.'].join(
      '\n',
    )
    const compliant = await fire(
      listener,
      `gh pr create --title "feat(cli): add a flag" --body ${quoted(own)}`,
      { cwd: directory },
    )
    expect(compliant.kind).toBe('allow')

    // The built-in names now belong to no template in this repository, so the
    // description that satisfied the old check satisfies nothing here.
    const builtIn = await fire(
      listener,
      `gh pr create --title "feat(cli): add a flag" --body ${quoted(GOOD_BODY)}`,
      { cwd: directory },
    )
    expect(builtIn.kind).toBe('ask')
    expect((builtIn as { reason: string }).reason).toContain(
      t('trigger.pre_pr.error.description', { sections: 'What changed, How to test' }),
    )
  })

  it('leaves a free-form template alone beyond asking for words', async () => {
    // A template with no question this check has a rule for says the repository
    // takes prose. Judging it section by section would reject every pull request.
    const directory = mkdtempSync(join(tmpdir(), 'dsh-pr-template-'))
    mkdirSync(join(directory, '.github'), { recursive: true })
    writeFileSync(
      join(directory, '.github', 'pull_request_template.md'),
      '## Screenshots\n<!-- paste them here -->\n',
      'utf8',
    )
    const { listener } = trigger()

    const prose = await fire(
      listener,
      `gh pr create --title "feat(cli): add a flag" --body ${quoted('Rewrote the parser.')}`,
      { cwd: directory },
    )
    expect(prose.kind).toBe('allow')

    // GitHub hands the author the template itself, so a description that is
    // nothing but the template's comments is an empty one.
    const empty = await fire(
      listener,
      `gh pr create --title "feat(cli): add a flag" --body ${quoted('<!-- paste them here -->')}`,
      { cwd: directory },
    )
    expect(empty.kind).toBe('ask')
    expect((empty as { reason: string }).reason).toContain(t('trigger.pre_pr.error.empty'))
  })

  // A template that offers options as checkboxes — GitHub's own does — means
  // "tick the one that applies", not "every line here is a task you left undone".
  // Counting them produced "2 checklist items are still unticked" on a complete
  // description, which is a report the author cannot act on.
  it('does not read an option list as an unticked checklist', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-pr-template-'))
    mkdirSync(join(directory, '.github'), { recursive: true })
    writeFileSync(
      join(directory, '.github', 'pull_request_template.md'),
      [
        '## What',
        '## Type of change',
        '- [ ] Bug fix',
        '- [ ] Feature',
        '## Checklist',
        '- [ ] Tests added',
      ].join('\n'),
      'utf8',
    )
    const { listener } = trigger()

    const options = [
      '## What',
      '',
      'Add a flag.',
      '',
      '## Type of change',
      '',
      '- [x] Feature',
      '- [ ] Bug fix',
      '',
      '## Checklist',
      '',
      '- [x] Tests added',
    ].join('\n')
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a flag" --body ${quoted(options)}`,
      { cwd: directory },
    )
    expect(decision.kind).toBe('allow')

    // The one section the template does call a checklist still counts.
    const unticked = await fire(
      listener,
      `gh pr create --title "feat(cli): add a flag" --body ${quoted(
        options.replace('- [x] Tests added', '- [ ] Tests added'),
      )}`,
      { cwd: directory },
    )
    expect(unticked.kind).toBe('ask')
    expect((unticked as { reason: string }).reason).toContain(
      t('trigger.pre_pr.error.checklist', { count: 1 }),
    )
  })

  // The note is advisory, so it must not become a question. Under a `never`
  // approval policy a question with nothing in it is refused, which turned this
  // one into a blocked pull request the moment the description named no issue.
  it('does not ask about a missing issue reference alone', async () => {
    const { listener } = trigger()
    const body = GOOD_BODY.replace(' Closes #7.', '')
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a flag" --body ${quoted(body)}`,
    )
    expect(decision.kind).toBe('allow')
  })

  // Not asking is not the same as not saying. A note that only reached the
  // status record was read by nobody, so it goes to the log at the same moment.
  it('still says out loud that the description names no issue', async () => {
    const logs: string[] = []
    const { listener } = trigger({ logs })
    const body = GOOD_BODY.replace(' Closes #7.', '')
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a flag" --body ${quoted(body)}`,
    )

    expect(decision.kind).toBe('allow')
    expect(logs).toContain(t('trigger.pre_pr.warn.issue'))
  })

  // The self-reference note is the same kind of note: it says something the
  // author should read, and it has no question in it.
  it('says a pull request that cites only itself out loud, without asking', async () => {
    const logs: string[] = []
    const { listener } = trigger({ logs })
    const body = GOOD_BODY.replace(' Closes #7.', ' Closes #13.')
    const decision = await fire(
      listener,
      `gh pr edit 13 --title "feat(cli): add a flag" --body ${quoted(body)}`,
    )

    expect(decision.kind).toBe('allow')
    expect(logs).toContain(t('trigger.pre_pr.warn.self_issue'))
  })

  it('passes a compliant pull request without a word', async () => {
    const { listener, state } = trigger()
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a json flag" --body ${quoted(GOOD_BODY)}`,
    )

    expect(decision.kind).toBe('allow')
    expect(state.lastOutcome()).toMatchObject({ kind: 'pr', ok: true })
  })

  it('says which branch this one would conflict with, before either merges', async () => {
    const { listener, state } = trigger({
      git: makeConflictGit({ 'fix/other': ['CHANGELOG.md', 'src/index.ts'] }),
    })
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a json flag" --body ${quoted(GOOD_BODY)}`,
    )

    // A clean pull request that would clash later is not a clean pull request:
    // approving here means approving a conflict the author has not seen.
    expect(decision.kind).toBe('ask')
    const reason = (decision as { reason: string }).reason
    expect(reason).toContain('fix/other')
    expect(reason).toContain('CHANGELOG.md')
    // The two branches are each clean against the base; the finding has to say
    // that, or it reads as "this branch is broken".
    expect(reason).toContain('cleanly against the base')
    expect(state.lastOutcome()).toMatchObject({ kind: 'pr', ok: true })
  })

  it('does not call the branch it is heading for a conflict', async () => {
    // A branch behind `main` is the ordinary state of a working branch. If the
    // merge target were treated as a sibling, every stale branch would get a
    // warning telling the author to rebase — advice for a problem that does not
    // exist until somebody else's work actually lands.
    const { listener } = trigger({
      git: makeConflictGit({ main: ['CHANGELOG.md'], 'fix/other': ['CHANGELOG.md'] }),
    })
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a json flag" --body ${quoted(GOOD_BODY)}`,
    )
    const reason = (decision as { reason: string }).reason
    expect(reason).toContain('`fix/other` is still unmerged')
    expect(reason).not.toContain('`main` is still unmerged')
  })

  it('finds the trunk without a fetched remote, so a stale branch is not a conflict', async () => {
    // A clone that has never fetched has no `origin/HEAD`. The trunk then has to
    // be recognised by name, or every branch behind it gets the rebase advice.
    const { listener } = trigger({
      git: makeConflictGit(
        { main: ['CHANGELOG.md'], 'fix/other': ['CHANGELOG.md'] },
        { remoteHead: false },
      ),
    })
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a json flag" --body ${quoted(GOOD_BODY)}`,
    )
    const reason = (decision as { reason: string }).reason
    expect(reason).toContain('`fix/other` is still unmerged')
    expect(reason).not.toContain('`main` is still unmerged')
  })

  it('says nothing about conflicts when the repository cannot be read', async () => {
    // correct here — an unreadable repository is not a conflict.
    const state = createWorkflowState()
    const listener = createPrePrTrigger({
      config: () => Config({}),
      t: () => t,
      state,
      log: () => {},
      warn: () => {},
    })
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a json flag" --body ${quoted(GOOD_BODY)}`,
    )
    expect(decision.kind).toBe('allow')
  })

  it('lists at most two conflicting branches, so the prompt stays readable', async () => {
    const { listener } = trigger({
      git: makeConflictGit({
        'fix/one': ['CHANGELOG.md'],
        'fix/two': ['CHANGELOG.md'],
        'fix/three': ['CHANGELOG.md'],
      }),
    })
    const decision = await fire(
      listener,
      `gh pr create --title "feat(cli): add a json flag" --body ${quoted(GOOD_BODY)}`,
    )
    const reason = (decision as { reason: string }).reason
    expect(reason).toContain('fix/one')
    expect(reason).toContain('fix/two')
    expect(reason).not.toContain('fix/three')
  })

  it('reads a description given as a file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-pr-'))
    writeFileSync(join(directory, 'body.md'), GOOD_BODY, 'utf8')

    const { listener } = trigger()
    const compliant = await fire(
      listener,
      'gh pr create --title "feat(cli): add a json flag" -F body.md',
      { cwd: directory },
    )
    expect(compliant.kind).toBe('allow')

    writeFileSync(join(directory, 'thin.md'), 'Nothing here.', 'utf8')
    const thin = await fire(listener, 'gh pr create --title "feat(cli): add a flag" -F thin.md', {
      cwd: directory,
    })
    expect(thin.kind).toBe('ask')
    expect((thin as { reason: string }).reason).toContain(SECTIONS)
  })

  it('renders the approval prompt in both client languages', async () => {
    const { listener } = trigger()
    const decision = await fire(listener, 'gh pr create --title "Add the flag"')
    const display = askOf(decision).displayReason

    expect(display.en).toContain(createTranslator('en-US')('trigger.pre_pr.ask').split('\n')[0])
    expect(display.zh).toContain(createTranslator('zh-CN')('trigger.pre_pr.ask').split('\n')[0])
    expect(display.en).not.toContain('开发工作流插件发现')
    expect(display.zh).not.toContain('The development-workflow plugin found')
  })

  it('stays out of the way while the agent is only coding', async () => {
    const { listener, state } = trigger()
    for (const command of [
      'npm test',
      'git status',
      'git commit -m "feat(cli): add a flag"',
      'gh pr view 13',
      'gh issue list',
      'git push origin feature/x',
    ]) {
      expect((await fire(listener, command)).kind, command).toBe('allow')
    }
    expect(state.lastOutcome()).toBeUndefined()
  })

  it('ignores a tool call that is not tied to an agent session', async () => {
    const { listener, state } = trigger()
    const decision = await fire(listener, 'gh pr create --title "Add the flag"', {
      withoutAgent: true,
    })
    expect(decision.kind).toBe('allow')
    expect(state.lastOutcome()).toBeUndefined()
  })

  it('keeps a refusal another gate made and adds its findings to it', async () => {
    const { listener, state } = trigger()
    const refusal = await fire(listener, 'gh pr create --title "Add the flag"', {
      downstream: { kind: 'deny', reason: 'another gate says no' },
    })
    // Under the `never` policy the outward guard's refusal is the whole answer,
    // so the description rules would never be heard at all without this.
    expect(refusal.kind).toBe('deny')
    expect(refusal.kind === 'deny' && refusal.reason).toMatch(/^another gate says no\n/)
    expect(refusal.kind === 'deny' && refusal.reason).toContain(
      t('tool.check_commit_message.error.missing_type'),
    )
    expect(state.lastOutcome()).toMatchObject({ kind: 'pr', ok: false })
  })

  it('reports an abort rather than a finding', async () => {
    const { listener, state } = trigger()
    const controller = new AbortController()
    controller.abort()
    const decision = await fire(listener, 'gh pr create --title "Add the flag"', {
      signal: controller.signal,
    })
    expect(decision).toEqual({ kind: 'cancel' })
    expect(state.lastOutcome()).toBeUndefined()
  })

  it('asks again when there is no channel to put the question through', async () => {
    const { listener } = trigger()
    const command = 'gh pr create --title "Add the flag"'

    expect((await fire(listener, command)).kind).toBe('ask')
    expect((await fire(listener, command)).kind).toBe('ask')
  })

  it('stops asking once the user grants it', async () => {
    const approval = makeApproval()
    approval.answer('allowed-once')
    const { listener } = trigger({ approval })
    const command = 'gh pr create --title "Add the flag"'

    expect((await fire(listener, command)).kind).toBe('allow')
    expect((await fire(listener, command)).kind).toBe('allow')
    expect(approval.asked).toHaveLength(1)
  })

  it('prompts again for a different title in the same session', async () => {
    const { listener } = trigger()
    expect((await fire(listener, 'gh pr create --title "Add the flag"')).kind).toBe('ask')
    expect((await fire(listener, 'gh pr create --title "Add another flag"')).kind).toBe('ask')
  })

  it('prompts again in a different session', async () => {
    const state = createWorkflowState()
    const { listener } = trigger({ state })
    const command = 'gh pr create --title "Add the flag"'

    expect((await fire(listener, command, { sessionId: 'session-1' })).kind).toBe('ask')
    expect((await fire(listener, command, { sessionId: 'session-2' })).kind).toBe('ask')
  })
})
