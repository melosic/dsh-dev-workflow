import { describe, expect, it } from 'vitest'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { Config } from '../src/config.js'
import { createTranslator } from '../src/i18n.js'
import { createWorkflowState } from '../src/state.js'
import type { GitRunner } from '../src/git.js'
import { createRuntime } from '../src/index.js'
import { createPreCommitTrigger } from '../src/triggers/pre-commit.js'
import { checkDocSync } from '../src/tools/check-doc-sync.js'
import {
  createHarness,
  askOf,
  makeApproval,
  makeExec,
  makeFailingGit,
  makeGit,
  type HarnessApproval,
} from './harness.js'

const t = createTranslator('en-US')

/**
 * Build the listener the way the runtime does, with a working tree the spec owns.
 * @param options - configuration overrides, the changed paths to report, and the
 * approval seam to route questions through (absent models a profile with none).
 * @returns the listener, its state, and the paths it reads on every call.
 */
function trigger(
  options: {
    config?: Record<string, unknown>
    files?: () => readonly string[]
    state?: ReturnType<typeof createWorkflowState>
    approval?: HarnessApproval
    warnings?: string[]
    git?: GitRunner
  } = {},
) {
  const state = options.state ?? createWorkflowState()
  const resolved = Config(options.config ?? {})
  const git: GitRunner = options.git ?? makeGit(options.files ?? (() => []))
  const warnings = options.warnings ?? []
  const listener = createPreCommitTrigger({
    config: () => resolved,
    t: () => t,
    state,
    git: () => git,
    log: () => {},
    warn: (line) => warnings.push(line),
    ...(options.approval === undefined ? {} : { approval: () => options.approval?.service }),
  })
  return { listener, state, config: resolved, warnings }
}

/** Run one shell command through the listener. */
async function fire(
  listener: ReturnType<typeof createPreCommitTrigger>,
  command: string,
  options: {
    sessionId?: string
    withoutAgent?: boolean
    downstream?: PreToolDecision
    signal?: AbortSignal
  } = {},
): Promise<PreToolDecision> {
  return listener(
    makeExec(command, {
      sessionId: options.sessionId,
      withoutAgent: options.withoutAgent,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
    async () => options.downstream ?? { kind: 'allow' },
  )
}

describe('src/triggers/pre-commit.ts', () => {
  it('asks about a commit whose message breaks the conventions', async () => {
    const { listener } = trigger()
    const decision = await fire(listener, 'git commit -m "Add the thing"')

    expect(decision.kind).toBe('ask')
    expect((decision as { reason: string }).reason).toContain(
      t('tool.check_commit_message.error.missing_type'),
    )
  })

  it('renders the approval prompt in both client languages', async () => {
    const { listener } = trigger()
    const decision = await fire(listener, 'git commit -m "Add the thing"')
    const display = askOf(decision).displayReason

    expect(display.en).toContain(
      createTranslator('en-US')('tool.check_commit_message.error.missing_type'),
    )
    expect(display.zh).toContain(
      createTranslator('zh-CN')('tool.check_commit_message.error.missing_type'),
    )
    expect(display.en).not.toContain('提交信息缺少类型前缀')
    expect(display.zh).not.toContain('has no type prefix')
    // Both sides are complete prompts, not just translated findings.
    expect(display.en).toContain('Approve to commit anyway')
    expect(display.zh).toContain('批准则照常提交')
    expect(display.en).not.toBe(display.zh)
  })

  it('passes a compliant commit without a word', async () => {
    const { listener, state } = trigger()
    const decision = await fire(listener, 'git commit -m "fix(cli): stop crashing"')

    expect(decision.kind).toBe('allow')
    expect(state.lastOutcome()).toMatchObject({ kind: 'commit', ok: true })
  })

  it('refuses a finding in its own words when the session cannot be asked', async () => {
    // Under the `never` policy a returned `ask` is refused without a prompt and
    // reported as the user's refusal, so the finding is refused here instead.
    const { listener } = trigger({ approval: makeApproval('never') })
    const decision = await fire(listener, 'git commit -m "Add the thing"')

    expect(decision.kind).toBe('deny')
    expect(decision.kind === 'deny' && decision.reason).toContain(
      t('tool.check_commit_message.error.missing_type'),
    )
    // A trigger judges a whole class of actions, so the way out it names is not
    // the guard's "set this operation to allow" — that field does not exist here.
    expect(decision.kind === 'deny' && decision.reason).toContain(t('approval.disabled_trigger'))
    expect(decision.kind === 'deny' && decision.reason).not.toContain(t('approval.disabled'))
  })

  it('stays out of the way while the agent is only coding', async () => {
    const { listener, state } = trigger()
    for (const command of ['npm test', 'git status', 'git add -A', 'echo hi']) {
      expect((await fire(listener, command)).kind, command).toBe('allow')
    }
    expect(state.lastOutcome()).toBeUndefined()
  })

  it('ignores a tool call that is not tied to an agent session', async () => {
    const { listener, state } = trigger()
    const decision = await fire(listener, 'git commit -m "Add the thing"', { withoutAgent: true })
    expect(decision.kind).toBe('allow')
    expect(state.lastOutcome()).toBeUndefined()
  })

  it('keeps a refusal another gate made and adds its findings to it', async () => {
    const { listener, state } = trigger()
    const refusal = await fire(listener, 'git commit -m "Add the thing"', {
      downstream: { kind: 'deny', reason: 'another gate says no' },
    })
    // The refusal is still the other gate's: same kind, same opening words. What
    // it gains is the finding, because under a policy that refuses without
    // asking this text is the only account of the call the model ever gets.
    expect(refusal.kind).toBe('deny')
    expect(refusal.kind === 'deny' && refusal.reason).toMatch(/^another gate says no\n/)
    expect(refusal.kind === 'deny' && refusal.reason).toContain(
      t('tool.check_commit_message.error.missing_type'),
    )
    // It was still judged, so the status line can say the commit broke a rule.
    expect(state.lastOutcome()).toMatchObject({ kind: 'commit', ok: false })

    // The question another gate is asking is not replaced by a second one. Its
    // prompt is the published route to the plugin's approval seam, so the
    // finding is folded into that prompt instead of being dropped.
    const question = await fire(listener, 'git commit -m "Add the thing"', {
      downstream: { kind: 'ask', reason: 'another gate asks' },
    })
    const reason = askOf(question).reason
    const display = askOf(question).displayReason

    expect(question.kind).toBe('ask')
    expect(reason).toContain('another gate asks')
    expect(reason).toContain(t('tool.check_commit_message.error.missing_type'))
    expect(display.en).toContain(t('trigger.pre_commit.settled_by').slice(0, 20))
    expect(display.zh).toContain(
      createTranslator('zh-CN')('trigger.pre_commit.settled_by').slice(0, 8),
    )
  })

  it('reports an abort rather than a finding', async () => {
    const { listener, state } = trigger()
    const controller = new AbortController()
    controller.abort()
    const decision = await fire(listener, 'git commit -m "Add the thing"', {
      signal: controller.signal,
    })
    expect(decision).toEqual({ kind: 'cancel' })
    expect(state.lastOutcome()).toBeUndefined()
  })

  it('does not block a code change that only skipped its documentation', async () => {
    // Missing docs and a missing CHANGELOG entry are advisories, not blockers:
    // `docs/TRIGGERS.md` documents that a change like this warns and proceeds.
    // The advisory itself is asserted where it is produced.
    expect(checkDocSync({ files: ['src/a.ts'] }, Config({}), t).warnings).not.toEqual([])

    const { listener, state, warnings } = trigger({ files: () => ['src/a.ts'] })
    const decision = await fire(listener, 'git commit -m "chore(cli): tidy"')
    expect(decision.kind).toBe('allow')
    expect(state.lastOutcome()).toMatchObject({ kind: 'commit', ok: true })
    // Allowed, but not silently: a permitted call carries no text of its own, so
    // an advisory nobody logs was never said.
    expect(warnings).toContain(
      t('tool.check_doc_sync.warn.changelog', { changelog: 'CHANGELOG.md' }),
    )
  })

  it('states why the file listing failed instead of leaving a placeholder', async () => {
    // A git that cannot answer is not a clean tree, and the reason is the whole
    // finding: the template used to reach the reader with `{detail}` unfilled.
    const { listener, warnings } = trigger({ git: makeFailingGit('command-failed') })
    const decision = await fire(listener, 'git commit -m "fix(core): tidy"')

    expect(decision.kind).toBe('allow')
    const reason = t('error.command_failed', { detail: 'fatal: nope' })
    expect(warnings).toContain(t('trigger.pre_commit.warn.degraded', { reason }))
    for (const line of warnings) expect(line).not.toContain('{detail}')
  })

  it('says the same thing in both languages when the call is blocked', async () => {
    // The prompt is built by running the rules again, once per language, so a
    // finding added to the outcome from outside the rules comes back empty in
    // every language. This is the case that made the body blank.
    const { listener } = trigger({ git: makeFailingGit('command-failed') })
    const decision = await fire(listener, 'git commit -m "Add the thing"')
    const display = askOf(decision).displayReason
    const zh = createTranslator('zh-CN')

    expect(display.en).toContain(
      t('trigger.pre_commit.warn.degraded', {
        reason: t('error.command_failed', { detail: 'fatal: nope' }),
      }),
    )
    expect(display.zh).toContain(
      zh('trigger.pre_commit.warn.degraded', {
        reason: zh('error.command_failed', { detail: 'fatal: nope' }),
      }),
    )
    expect(display.en).not.toContain('未能读取改动文件列表')
  })

  it('prompts when a feature adds no changelog entry', async () => {
    const { listener } = trigger({ files: () => ['src/a.ts'] })
    const decision = await fire(listener, 'git commit -m "feat(cli): add a flag"')
    expect(decision.kind).toBe('ask')
    expect((decision as { reason: string }).reason).toContain(
      t('tool.check_commit_message.error.changelog_required', { changelog: 'CHANGELOG.md' }),
    )
  })

  it('asks again when there is no channel to put the question through', async () => {
    // No approval seam: the dispatcher refuses the ask after this listener
    // returns, so nothing was granted and nothing may be remembered.
    const { listener } = trigger()
    const command = 'git commit -m "Add the thing"'

    expect((await fire(listener, command)).kind).toBe('ask')
    expect((await fire(listener, command)).kind).toBe('ask')
  })

  it('stops asking once the user grants it', async () => {
    const approval = makeApproval()
    const { listener } = trigger({ approval })
    const command = 'git commit -m "Add the thing"'
    approval.answer('allowed-once')

    expect((await fire(listener, command)).kind).toBe('allow')
    expect(approval.asked).toHaveLength(1)

    // The grant is remembered, so the identical command is not put to the user twice.
    expect((await fire(listener, command)).kind).toBe('allow')
    expect(approval.asked).toHaveLength(1)
  })

  it('asks again after a refusal, keeping its finding in the refusal', async () => {
    for (const answer of ['rejected', 'cancelled', 'unavailable'] as const) {
      const approval = makeApproval()
      approval.answer(answer, answer)
      const { listener } = trigger({ approval })
      const command = 'git commit -m "Add the thing"'

      const refusal = await fire(listener, command)
      expect(refusal.kind, answer).toBe('deny')
      // The dispatcher's own refusal says "the user rejected tool ..." and loses
      // the finding, so the gate has to state it here.
      expect(refusal.kind === 'deny' && refusal.reason, answer).toContain(
        t('tool.check_commit_message.error.missing_type'),
      )

      // A refusal answers that attempt, not the object: the retry asks again.
      expect((await fire(listener, command)).kind, answer).toBe('deny')
      expect(approval.asked, answer).toHaveLength(2)
    }
  })

  it('prompts again for a different problem in the same session', async () => {
    const { listener } = trigger()

    expect((await fire(listener, 'git commit -m "Add the thing"')).kind).toBe('ask')
    expect((await fire(listener, 'git commit -m "Add another thing"')).kind).toBe('ask')
  })

  it('prompts again in a different session', async () => {
    const state = createWorkflowState()
    const { listener } = trigger({ state })
    const command = 'git commit -m "Add the thing"'

    expect((await fire(listener, command, { sessionId: 'session-1' })).kind).toBe('ask')
    expect((await fire(listener, command, { sessionId: 'session-2' })).kind).toBe('ask')
  })

  it('treats the same commit with a different working tree as a new problem', async () => {
    const files = ['src/a.ts']
    const approval = makeApproval()
    approval.answer('allowed-once', 'allowed-once')
    const { listener } = trigger({ files: () => files, approval })
    const command = 'git commit -m "feat(cli): add a flag"'

    expect((await fire(listener, command)).kind).toBe('allow')
    expect((await fire(listener, command)).kind).toBe('allow')
    expect(approval.asked).toHaveLength(1)

    // A different change set is a different target, so it is checked afresh.
    files.push('src/b.ts')
    expect((await fire(listener, command)).kind).toBe('allow')
    expect(approval.asked).toHaveLength(2)
  })

  it('does not fire while the mode is off or the trigger is disabled', async () => {
    // The two switches are independent: `mode: off` registers nothing at all,
    // while `enableOwnTrigger: false` keeps the guards and drops only this
    // listener. Both are asserted through the registrations the runtime makes,
    // then by running whatever was registered against a non-compliant commit.
    const off = createHarness()
    createRuntime(off.ctx, Config({ mode: 'off' }))
    expect(off.listeners).toHaveLength(0)
    expect(await chain(off.listeners, 'git commit -m "Add the thing"')).toEqual({ kind: 'allow' })

    const withoutTrigger = createHarness()
    createRuntime(withoutTrigger.ctx, Config({ enableOwnTrigger: false }))
    // `enableOwnTrigger: false` drops all three convention triggers — commit,
    // pull request, and release — and keeps the five guards: git, outward,
    // command, file, secret.
    expect(withoutTrigger.listeners).toHaveLength(5)
    expect(await chain(withoutTrigger.listeners, 'git commit -m "Add the thing"')).toEqual({
      kind: 'allow',
    })
  })
})

/**
 * Run a command through a registered listener chain, outermost first.
 * @param listeners - the listeners the runtime registered, in order.
 * @param command - the shell command line the agent is about to run.
 * @returns the decision the chain settles on.
 */
async function chain(
  listeners: readonly { listener: (exec: never, next: never) => Promise<PreToolDecision> }[],
  command: string,
): Promise<PreToolDecision> {
  const exec = makeExec(command)
  let index = -1
  const step = async (): Promise<PreToolDecision> => {
    index += 1
    const next = listeners[index]
    if (next === undefined) return { kind: 'allow' }
    return next.listener(exec as never, (() => step()) as never)
  }
  return step()
}
