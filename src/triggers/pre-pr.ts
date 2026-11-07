import { isAbsolute, join } from 'node:path'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Config } from '../config.js'
import type { Translate } from '../i18n.js'
import type { CheckResult } from '../tools/result.js'
import { evaluateMessage, fingerprint, summarize } from '../checks.js'
import { commandOf, quoteCommandWords, shellWordIsLiteral, wordInvocations } from '../shell.js'
import type { CommandWord } from '../shell.js'
import { conflictingBranches } from '../tools/merge-preview.js'
import type { PendingConflict } from '../tools/merge-preview.js'
import { resolveSections, sectionsFromNames } from '../pr-sections.js'
import type { ResolvedSection } from '../pr-sections.js'
import { readText, settleAbout } from './shared.js'
import type { TriggerOptions } from './shared.js'

// The second automatic check: before the agent opens a pull request, judge the
// text that will describe it. Under squash merge the pull request *title*
// becomes the commit on `main`, so a title that breaks the conventions lands in
// the permanent history — this is the last moment it can be caught cheaply.
//
// Like the pre-commit trigger, this rides on `tools/pre-execute`: the DSH event
// catalogue has no "a pull request is about to be created" event, so the action
// is recognised by the shell command that performs it (`gh pr create`).

/** `gh pr create` options that take a separate value, so it is not a title. */
const GH_VALUE_OPTIONS = new Set([
  '-t',
  '--title',
  '-b',
  '--body',
  '-F',
  '--body-file',
  '-H',
  '--head',
  '-B',
  '--base',
  '-r',
  '--reviewer',
  '-l',
  '--label',
  '-a',
  '--assignee',
  '-m',
  '--milestone',
  '-p',
  '--project',
  // `gh pr merge --subject` (squash) and `--body` write the commit text that
  // lands on the base branch, so they are read as the title and description.
  '--subject',
])

/** `gh` options that take a separate value and may precede the subcommand. */
const GH_GLOBAL_VALUE_OPTIONS = new Set(['-R', '--repo', '--hostname'])

/**
 * Section content that answers a question by declining to answer it.
 *
 * Normalised to bare letters and digits before lookup (see `isDismissal`), so
 * the entries here are the spellings without punctuation. Chinese and English
 * both: the template's headings are English but the text underneath is in
 * whatever language the author writes in.
 */
const DISMISSIVE_ANSWERS = new Set([
  'none',
  'n/a',
  'na',
  'notapplicable',
  'nothing',
  '无',
  '没有',
  '不适用',
  '无影响',
])

/** What a `gh pr create` command line states about the pull request. */
export interface PullRequestCommand {
  /** The title, when the command line states it. */
  readonly title?: string
  /** Whether the title was a single-quoted word, so it is what `gh` will send. */
  readonly titleLiteral?: boolean
  /** The description, when the command line states it. */
  readonly body?: string
  /** Whether the description was a single-quoted word. */
  readonly bodyLiteral?: boolean
  /** Path given to `--body-file`, as written on the command line. */
  readonly bodyFile?: string
  /**
   * The number of the pull request this command edits or merges.
   *
   * Present only for `edit` and `merge`, which name an existing pull request.
   * `create` has no number yet — the one it is about to receive is assigned by
   * the forge, so a description cannot be checked against it here.
   */
  readonly number?: string
}

/** What one pull request inspection covers. Omit a field to skip its rules. */
export interface PullRequestInput {
  /** The pull request title. */
  readonly title?: string
  /** Whether the title is literal text; omitted means it is. */
  readonly titleLiteral?: boolean
  /** The pull request description. */
  readonly body?: string
  /** Whether the description is literal text; omitted means it is. */
  readonly bodyLiteral?: boolean
  /**
   * Local branches this one would conflict with once both are merged.
   *
   * Read from the repository rather than from the command line, so it is present
   * only when a git runner was available.
   */
  readonly conflicts?: readonly PendingConflict[]
  /**
   * The sections the description is judged against.
   *
   * Resolved from the repository's template before this is called, because the
   * decision function does no I/O — and because `assess` re-runs it in the other
   * language, which must not read the file twice. Omitted means the configured
   * names are used as they are, which is what a caller with no repository to
   * look at (a test, a status report) wants.
   */
  readonly sections?: readonly ResolvedSection[]
  /**
   * The number of the pull request being edited, when the command line names it.
   *
   * Used to tell a reference to the issue a change came from apart from a
   * reference to this pull request itself, which traces nothing.
   */
  readonly number?: string
}

/**
 * Read what a `gh pr create` command line says.
 * @param args - the words after `create`, each saying how it was written.
 * @returns the stated title, description, and body file, if any.
 */
function pullRequestArguments(args: readonly CommandWord[]): PullRequestCommand {
  let title: CommandWord | undefined
  let body: CommandWord | undefined
  let bodyFile: string | undefined

  const assign = (name: string, value: CommandWord | undefined): void => {
    if (value === undefined) return
    // `--subject` is `gh pr merge --squash`'s spelling of the text that becomes
    // the commit on the base branch — under squash it is the same text as a
    // pull request title, so it is judged by the same rules.
    if (name === '--title' || name === '-t' || name === '--subject') title = value
    else if (name === '--body' || name === '-b') body = value
    else if (name === '--body-file' || name === '-F') bodyFile = value.value
  }

  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]
    const token = word?.value ?? ''
    const equals = token.startsWith('--') ? token.indexOf('=') : -1
    if (equals !== -1) {
      // Attached text inherits the quoting of the word it was cut from, exactly
      // as the commit-message reader does it: `--title=$(cat t)` is a title this
      // check cannot read, and calling it unreadable is the point.
      const value = token.slice(equals + 1)
      assign(token.slice(0, equals), { value, literal: word?.literal ?? false })
      continue
    }
    if (!GH_VALUE_OPTIONS.has(token)) continue
    const value = args[index + 1]
    if (value === undefined) continue
    assign(token, value)
    index += 1
  }

  return {
    ...(title === undefined ? {} : { title: title.value, titleLiteral: shellWordIsLiteral(title) }),
    ...(body === undefined ? {} : { body: body.value, bodyLiteral: shellWordIsLiteral(body) }),
    ...(bodyFile === undefined ? {} : { bodyFile }),
  }
}

/**
 * Recognise a `gh pr create` in one shell command.
 * @param command - a shell command line, as a tool would receive it.
 * @returns what the command line states, or `undefined` when it opens no pull
 *   request.
 */
export function detectPullRequest(command: string): PullRequestCommand | undefined {
  for (const { program, args } of wordInvocations(quoteCommandWords(command))) {
    if (program !== 'gh' && program !== 'gh.exe') continue
    // `gh` takes global options before the subcommand, and `-R owner/repo` is
    // the usual one in a repository with more than one remote — reading the
    // first word as the subcommand saw `-R` and recognised nothing.
    let index = 0
    while (index < args.length && GH_GLOBAL_VALUE_OPTIONS.has(args[index]?.value ?? '')) index += 2
    while (index < args.length && (args[index]?.value ?? '').startsWith('--')) index += 1
    if (args[index]?.value !== 'pr') continue
    const verb = args[index + 1]?.value
    // `create` is where the title is written; `edit` rewrites it on an existing
    // pull request; `merge` under squash sets the commit text through
    // `--subject`. All three end in the same commit message on the base branch.
    if (verb !== 'create' && verb !== 'edit' && verb !== 'merge') continue
    // For `edit` and `merge` the first word after the verb is the pull request
    // itself, and the description may reference it. `create` has no number here:
    // the forge assigns one only after the call goes through.
    const number = verb === 'create' ? undefined : /^\d+$/.exec(args[index + 2]?.value ?? '')?.[0]
    const stated = pullRequestArguments(args.slice(index + 2))
    // Only the words that reach the base branch's history matter here, and only
    // `create` always writes them. `edit` and `merge` are recognised solely when
    // they state a title: `gh pr merge 13 --squash` writes the commit subject
    // from the pull request itself, which this check cannot read anyway.
    if (verb !== 'create' && stated.title === undefined) continue
    return number === undefined ? stated : { ...stated, number }
  }
  return undefined
}

/** `gh issue` verbs that only read; every other verb writes to the tracker. */
const READING_ISSUE_VERBS = new Set(['list', 'view', 'status'])

/**
 * Recognise a `gh issue` that writes to the tracker in one shell command.
 *
 * `create` is the obvious one, but `edit`, `comment`, `close` and
 * `transfer` leave a public trace just the same, and the forge keeps adding
 * verbs. The read-only ones are the small, closed set, so every other named
 * verb counts: a verb that appears later is copied to a tracker the user has
 * not agreed to, and this gate only asks.
 * @param command - a shell command line, as a tool would receive it.
 * @returns `true` when the command line writes to an issue.
 */
export function detectIssue(command: string): boolean {
  for (const { program, args } of wordInvocations(quoteCommandWords(command))) {
    if (program !== 'gh' && program !== 'gh.exe') continue
    let index = 0
    while (index < args.length && GH_GLOBAL_VALUE_OPTIONS.has(args[index]?.value ?? '')) index += 2
    while (index < args.length && (args[index]?.value ?? '').startsWith('--')) index += 1
    if (args[index]?.value !== 'issue') continue
    const verb = args[index + 1]?.value
    // A bare `gh issue` and `gh issue --help` print the command list. Reading
    // the missing verb as a write would ask about help text.
    if (verb === undefined || verb === '--help' || verb === '-h' || verb === 'help') continue
    if (READING_ISSUE_VERBS.has(verb)) continue
    return true
  }
  return false
}

/**
 * Split a description into its `##` sections.
 *
 * The template's checklist belongs to the section that carries it, and text
 * outside any required section is not the template: a `- [ ]` line elsewhere
 * (in a fenced example, say) is not a box the author forgot to tick.
 *
 * A closed ATX heading (`## What ##`, which Markdown allows and some editors
 * write) names the same section as the bare form. Reading only the open form
 * made every section of such a description look missing.
 * @param body - the pull request description.
 * @returns the lines under each lowercased section name.
 */
function sectionContent(body: string): Map<string, string[]> {
  const content = new Map<string, string[]>()
  let current: string | undefined
  for (const line of body.split('\n')) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading !== null) {
      current = (heading[1] ?? '').toLowerCase()
      if (!content.has(current)) content.set(current, [])
      continue
    }
    if (current === undefined) continue
    content.get(current)?.push(line)
  }
  return content
}

/**
 * Name the template sections that are missing or left empty.
 *
 * A heading with nothing under it is as absent as no heading at all: an
 * untouched template describes the change no better than an empty box.
 * @param body - the pull request description.
 * @param sections - the sections this repository's template asks for.
 * @returns the section names that carry no content, in template order.
 */
function missingSections(body: string, sections: readonly ResolvedSection[]): string[] {
  const content = sectionContent(body)
  return sections
    .filter((section) => {
      const lines = content.get(section.heading.toLowerCase())
      return lines === undefined || lines.join('\n').trim().length === 0
    })
    .map((section) => section.heading)
}

/**
 * The section that asks the author to show the change working, if the template
 * has one.
 *
 * Every other heading can honestly be answered with "none": a change with no
 * non-goals has none, and a change that cannot break anything has nothing to
 * roll back. This one is the only place where "none" is not a sentence about
 * the change but a refusal to answer — it is the one section that can falsify
 * "the author ran it".
 * @param sections - the sections this repository's template asks for.
 * @returns the section's name as the template spells it, when present.
 */
function verificationSection(sections: readonly ResolvedSection[]): string | undefined {
  return sections.find((section) => section.role === 'verify')?.heading
}

/**
 * Whether a section's whole content is one of the answers that assert nothing.
 *
 * Only a section whose entire text is a dismissal counts. "None of the
 * fixtures cover this, so I ran it against a scratch profile" starts with the
 * same word and says something; the rule has to let it through, which is why
 * this compares the whole normalised section rather than looking for a word.
 * @param text - the section's content, HTML comments already removed.
 * @returns whether the content is a dismissal and nothing else.
 */
function isDismissal(text: string): boolean {
  // Punctuation and emphasis carry no claim either way: "None.", "**n/a**" and
  // "（无）" are the same non-answer as "none".
  const normalised = text
    .toLowerCase()
    .replace(/[\s.。,，;；:：!！?？*_`'"‘’“”~()（）[\]【】—–-]/g, '')
  return DISMISSIVE_ANSWERS.has(normalised)
}

/**
 * Count the checkboxes in a description's checklist that are still unticked.
 *
 * Only the section whose role is `checklist` is read. Almost every template
 * lists its options under some other heading — GitHub's own "Type of change"
 * offers four bullets of which the author ticks one — and counting those turned
 * every description that followed the template into "2 items still unticked".
 * @param body - the pull request description.
 * @param sections - the sections this repository's template asks for.
 * @returns how many `- [ ]` lines the checklist section contains.
 */
function uncheckedBoxes(body: string, sections: readonly ResolvedSection[]): number {
  const content = sectionContent(body)
  let total = 0
  for (const section of sections) {
    if (section.role !== 'checklist') continue
    for (const line of content.get(section.heading.toLowerCase()) ?? []) {
      if (/^\s*[-*]\s+\[ \]/.test(line)) total += 1
    }
  }
  return total
}

/**
 * Whether an otherwise-clean outcome still holds something worth a question.
 *
 * Two warnings are not findings: the note that `--fill` left no title for this
 * check to read, and the note that the description names no issue. Both are
 * advisory — the first states what could not be judged, the second asks for
 * something the check has no way to know exists. They belong in the record, so a
 * status report shows them, but a question containing only those has nothing to
 * ask: under a `never` approval policy it would be refused outright and turn an
 * advisory note into a blocked pull request. They are logged instead, by the
 * caller, on the path where nothing else would be said.
 * @param outcome - what the check found.
 * @param t - translator, to recognise the notes in the language in effect.
 * @returns whether the prompt has anything to carry.
 */
function worthAsking(outcome: CheckResult, t: Translate): boolean {
  const notes = new Set([
    t('trigger.pre_pr.warn.filled'),
    t('trigger.pre_pr.warn.issue'),
    t('trigger.pre_pr.warn.self_issue'),
  ])
  return outcome.errors.length > 0 || outcome.warnings.some((line) => !notes.has(line))
}

/**
 * Remove the HTML comments a template uses as instructions.
 *
 * GitHub pre-fills a repository template into the description box, so an
 * untouched pull request arrives as headings whose only content is a
 * `<!-- what to write here -->` hint. Treating that hint as text would let every
 * pull request through the moment the repository started using a template, and
 * a `- [ ]` inside one is not a task the author forgot.
 * @param body - the pull request description.
 * @returns the description with its HTML comments removed.
 */
function withoutComments(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * Judge the text of one pull request against the workflow rules.
 *
 * The title is judged with the commit-message rules because squash merge makes
 * it the commit message. The description rules are the specification's own
 * template; the issue reference is advisory, because nothing here can tell
 * whether an issue exists to reference.
 * @param input - the title and description known about the pull request.
 * @param config - resolved plugin configuration.
 * @param t - translator for every returned line.
 * @returns blocking problems and advisory observations.
 */
export function evaluatePullRequest(
  input: PullRequestInput,
  config: Config,
  t: Translate,
): CheckResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (input.title !== undefined) {
    // The title is judged with the commit-message rules — and with that check's
    // own configuration, because under squash merge this title *is* a commit
    // message. A repository that turned the check off or downgraded it to a
    // warning meant it for this text too.
    const title = evaluateMessage(input.title, undefined, config, t)
    errors.push(...title.errors)
    warnings.push(...title.warnings)
    if (!(input.titleLiteral ?? true)) {
      warnings.push(t('trigger.pre_pr.warn.title_literal'))
    }
  }

  if (input.body !== undefined) {
    // A description assembled by the shell is not text this check can read;
    // judging the literal pieces of `-b "$(cat pr.md)"` would report every
    // section as missing and repeat the report on every attempt.
    if (!(input.bodyLiteral ?? true)) {
      warnings.push(t('trigger.pre_pr.warn.body_literal'))
    } else {
      const described = withoutComments(input.body)
      const sections = input.sections ?? sectionsFromNames(config.prSections.get())
      const missing = missingSections(described, sections)
      // No resolved section means this repository's template states no heading
      // this check has a rule for. Demanding the built-in list there would judge
      // a free-form description by a template it never used, so all that is asked
      // for is that the description says something.
      if (sections.length === 0) {
        if (described.trim().length === 0) {
          errors.push(t('trigger.pre_pr.error.empty'))
        }
      } else if (missing.length > 0) {
        errors.push(t('trigger.pre_pr.error.description', { sections: missing.join(', ') }))
      }
      // The one section where "none" is not an answer. Everything else in the
      // template can be dismissed honestly; this one asks for evidence, and
      // "not applicable" is the author reporting that no evidence exists — which
      // is exactly the state the section was added to make visible.
      const verification = verificationSection(sections)
      if (verification !== undefined && !missing.includes(verification)) {
        const lines = sectionContent(described).get(verification.toLowerCase()) ?? []
        if (isDismissal(lines.join('\n').trim())) {
          errors.push(t('trigger.pre_pr.error.verification', { section: verification }))
        }
      }
      const unchecked = uncheckedBoxes(described, sections)
      if (unchecked > 0) {
        errors.push(t('trigger.pre_pr.error.checklist', { count: unchecked }))
      }
    }
  }

  // `gh pr create --fill` takes the title and description from the commits, so
  // the command line states neither and nothing here can judge them. Saying that
  // is the point: silently reporting "clean" would make the check look like it
  // passed. Under squash merge the filled title is what lands on `main`.
  if (input.title === undefined && input.body === undefined) {
    warnings.push(t('trigger.pre_pr.warn.filled'))
  }

  // A branch that would conflict with another one still in flight is not a
  // problem with this pull request: each branch is clean against the base, and
  // the conflict only exists once both are merged. Saying so now is the one
  // moment it is cheap — before review, before CI, before the merge that makes
  // somebody redo the work.
  for (const conflict of input.conflicts ?? []) {
    warnings.push(
      t('trigger.pre_pr.warn.conflict', {
        branch: conflict.branch,
        files: conflict.files.join(', '),
      }),
    )
  }

  // The reference is looked for in the same text the section rules read: a
  // template hint of the form `<!-- Closes #123 -->` is an instruction to the
  // author, not a reference the author wrote.
  const described = `${input.title ?? ''}\n${withoutComments(input.body ?? '')}`
  if (described.trim().length > 0) {
    const references = [...described.matchAll(/(?:^|\s)#(\d+)/g)].map((found) => found[1])
    if (references.length === 0) {
      warnings.push(t('trigger.pre_pr.warn.issue'))
    } else if (input.number !== undefined && references.every((one) => one === input.number)) {
      // A description that references only the pull request it belongs to names
      // no reason for the change. Its own number is knowable only on `edit` and
      // `merge`, which is where it came from.
      warnings.push(t('trigger.pre_pr.warn.self_issue'))
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

/**
 * Build the `tools/pre-execute` listener for pull request creation.
 * @param options - configuration, translator, state, and logging.
 * @returns the listener to register on `tools/pre-execute`.
 */
export function createPrePrTrigger(
  options: TriggerOptions,
): (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision> {
  return async (exec, next) => {
    // The gates behind this one decide first; a cancelled or refused call is not
    // this check's to settle. What that answer does not do is skip the check:
    // `gh pr create` is exactly the command the outward guard asks about, so
    // settling the question from behind it would mean the pull request rules
    // never ran.
    const downstream = await next()
    if (downstream.kind === 'cancel' || downstream.kind === 'deny') return downstream

    const agent = exec.agent
    if (agent === undefined) return downstream
    const command = commandOf(exec.arguments)
    if (command === undefined) return downstream
    const pullRequest = detectPullRequest(command)
    if (pullRequest === undefined) return downstream
    if (exec.signal.aborted) return { kind: 'cancel' }

    const t = options.t()
    const cwd = agent.session.header.cwd ?? process.cwd()
    const sessionId = String(agent.session.id)
    options.log(t('trigger.pre_pr.detected'))

    // A description given as a file is read here rather than on the command
    // line; `-` means stdin, whose contents are not knowable at this point.
    let body = pullRequest.body
    if (body === undefined && pullRequest.bodyFile !== undefined && pullRequest.bodyFile !== '-') {
      const path = isAbsolute(pullRequest.bodyFile)
        ? pullRequest.bodyFile
        : join(cwd, pullRequest.bodyFile)
      body = await readText(path)
    }

    // A description read from a file is text this check holds, so it is literal
    // whatever the command line said about where it came from.
    const stated = pullRequest.body !== undefined
    const literal = stated ? (pullRequest.bodyLiteral ?? true) : true
    // Which other branches this one would clash with. A profile with no
    // subprocess provider has no runner, and the check then says nothing about
    // conflicts rather than claiming there are none.
    const runner = options.git?.(cwd)
    const conflicts = runner === undefined ? [] : await conflictingBranches(runner, exec.signal)
    // Which sections this description is judged against is a property of the
    // repository, so it is read here rather than inside the decision function:
    // that one has no filesystem and runs twice, once per language.
    const sections = await resolveSections(cwd, options.config().prSections.get())
    const input: PullRequestInput = {
      ...(pullRequest.title === undefined
        ? {}
        : { title: pullRequest.title, titleLiteral: pullRequest.titleLiteral ?? true }),
      ...(body === undefined ? {} : { body, bodyLiteral: literal }),
      ...(conflicts.length === 0 ? {} : { conflicts }),
      ...(pullRequest.number === undefined ? {} : { number: pullRequest.number }),
      sections,
    }
    const outcome = evaluatePullRequest(input, options.config(), t)
    options.state.record({
      kind: 'pr',
      ok: outcome.ok,
      summary: summarize(outcome, t),
    })

    // `--fill` is not a finding: it is this check stating that the command line
    // carries no title to judge. Asking the user to approve that statement would
    // be a prompt with nothing in it, so the statement is recorded and the call
    // proceeds. Every other warning is a finding and goes to the prompt.
    if (outcome.ok && !worthAsking(outcome, t)) {
      // Nothing will be asked, so the notes are exported here. A warning that
      // only ever reached `/dev-workflow status` was read by nobody: the pull
      // request went through and the description kept naming no issue.
      for (const line of outcome.warnings) options.warn(line)
      return downstream
    }

    const target = fingerprint(pullRequest.title ?? body ?? command)
    // Asked once and not answered? `settleAbout` records the check only once the
    // question really reaches the user, so a rejection is not turned into a
    // one-time reminder.
    if (options.state.seen(sessionId, 'pr', target)) return downstream

    return settleAbout(
      downstream,
      {
        reasonKey: 'trigger.pre_pr.reason',
        askKey: 'trigger.pre_pr.ask',
        detailKey: 'trigger.pre_pr.detail',
        settledBy: 'trigger.pre_pr.settled_by',
        outcome,
        t,
        assess: (translator) => evaluatePullRequest(input, options.config(), translator),
        approval: options.approval,
        exec,
      },
      () => options.state.remember(sessionId, 'pr', target),
    )
  }
}
