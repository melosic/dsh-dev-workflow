import { readFile } from 'node:fs/promises'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalSeam } from '../approval-policy.js'
import { unaskable } from '../approval-policy.js'
import type { Config } from '../config.js'
import type { GitRunner } from '../git.js'
import { createTranslator } from '../i18n.js'
import type { Translate } from '../i18n.js'
import type { WorkflowState } from '../state.js'
import type { CheckResult } from '../tools/result.js'

// What the three action triggers have in common. Each of them recognises one
// shell command that starts something hard to undo — a commit, a pull request, a
// release — judges it against the specification, and routes the findings through
// the approval prompt. Only the recognition and the rules differ; the wiring,
// the truncation, and the bilingual prompt are the same shape three times.

/** How many findings an approval prompt shows before it summarises the rest. */
export const MAX_DETAILS = 5

/** Live access every trigger needs. Everything is a getter: the runtime owns it. */
export interface TriggerOptions {
  /** Resolved plugin configuration. */
  readonly config: () => Config
  /** Translator for the locale in effect. */
  readonly t: () => Translate
  /** Session-scoped memory of what was already reported. */
  readonly state: WorkflowState
  /** Diagnostic sink; debug level, so the default profile stays quiet. */
  readonly log: (message: string) => void
  /**
   * Advisory sink: a finding the rules raised but did not block on.
   *
   * Separate from `log` on purpose. A permitted call carries no text — the
   * decision it resolves to has nowhere to put a note — so an advisory finding
   * has no other way to reach the person who triggered it, and a debug-level
   * sink is read by nobody. This one is exported where the user can see it.
   */
  readonly warn: (message: string) => void
  /**
   * The approval seam: the policy a finding resolves under, and the ask itself.
   *
   * Optional: without it every decision is returned as before, which is what a
   * profile with no approval service composed already gets.
   */
  readonly approval?: () => ApprovalSeam | undefined
  /**
   * A git runner for one working directory.
   *
   * Optional for the same reason as `approval`: a trigger that has no repository
   * to read still judges the text it was given, and one that has one can say
   * more. A profile with no subprocess provider yields no runner at all.
   */
  readonly git?: (cwd: string) => GitRunner
}

/**
 * Render findings as the body of an approval prompt.
 *
 * Errors come first and are never crowded out by warnings: a repository with
 * many advisories would otherwise push the one blocking finding past the cut,
 * leaving a prompt that asks about something it does not show.
 * @param outcome - what the check found.
 * @param t - translator for the truncation line.
 * @returns one line per finding, capped at {@link MAX_DETAILS}.
 */
export function detailsOf(outcome: CheckResult, t: Translate): string {
  const room = Math.max(0, MAX_DETAILS - 1)
  const errors = outcome.errors.map((line) => `✖ ${line}`)
  const warnings = outcome.warnings.map((line) => `⚠ ${line}`)
  const shown = [...errors.slice(0, room), ...warnings.slice(0, Math.max(0, room - errors.length))]
  const omitted = errors.length + warnings.length - shown.length
  if (omitted > 0) shown.push(t('trigger.omitted', { count: omitted }))
  return shown.join('\n')
}

/** One `ask` decision, in the shape the approval prompt reads. */
export interface AskOptions {
  /** Dictionary key for the one-line reason the model sees. */
  readonly reasonKey: string
  /** Dictionary key for the full prompt the UI shows. */
  readonly askKey: string
  /** Dictionary key naming one finding in the prompt's own language. */
  readonly detailKey: string
  /** What the check found, already rendered in the plugin's own locale. */
  readonly outcome: CheckResult
  /** Translator for the plugin's own locale. */
  readonly t: Translate
  /**
   * Re-render the findings in one language.
   *
   * The prompt picks a side by the *client's* locale, which is not necessarily
   * the plugin's own, so each side is rendered from scratch with its own
   * translator — findings included, not just the wrapper.
   */
  readonly assess: (t: Translate) => CheckResult
  /** The approval seam: the policy this question resolves under, and the ask. */
  readonly approval?: () => ApprovalSeam | undefined
  /**
   * The call the question is about.
   *
   * The seam asks *about* a call — it routes the question to the session that
   * owns it and carries the signal that cancels it — so a trigger that asks
   * itself needs the whole execution, not just the session it belongs to.
   */
  readonly exec: ToolExecution
  /**
   * What the findings mean for the prompt they are folded into.
   *
   * A `git commit` is stopped by the git guard before the commit message is
   * ever judged, so the trigger's question would be the second one asked about
   * the same command — and a prompt that names one concern while three more sit
   * unseen behind it teaches its reader to approve without looking. Naming the
   * other gate works for both: a question still shows the findings, and a
   * refusal says what else the command broke.
   */
  readonly settledBy?: string
}

/** One finding, rendered for one side of the prompt. */
function sideOf(
  outcome: CheckResult,
  t: Translate,
  detailKey: string,
): { readonly details: string; readonly first: string } {
  const rendered = detailsOf(outcome, t)
  // The first line doubles as the one-sentence account appended to another
  // gate's reason, so it keeps its own `✖`/`⚠` rather than gaining a second one.
  const first = rendered.split('\n')[0] ?? t(detailKey, { details: rendered })
  return { details: rendered, first }
}

/**
 * Turn a failing outcome into the one decision worth returning.
 *
 * `ask` is the decision that fits a finding an author may knowingly override:
 * returning anything else would block an action the specification permits.
 * @param options - the keys, the outcome, and how to re-render it.
 * @returns the decision for `tools/pre-execute`.
 */
export function askAbout(options: AskOptions): PreToolDecision {
  const english = createTranslator('en-US')
  const chinese = createTranslator('zh-CN')
  // The Chinese key is the literal `zh`: the client lower-cases a locale and
  // falls back to `en`, so `zh-CN` would never match.
  const own = sideOf(options.outcome, options.t, options.detailKey)
  return unaskable(
    {
      kind: 'ask',
      reason: options.t(options.reasonKey, { details: own.details }),
      displayReason: {
        en: english(options.askKey, {
          details: sideOf(options.assess(english), english, options.detailKey).details,
        }),
        zh: chinese(options.askKey, {
          details: sideOf(options.assess(chinese), chinese, options.detailKey).details,
        }),
      },
    },
    options.t,
    options.approval,
    options.exec.agent?.session,
    // Triggers gate an action by its shape, not by a per-operation tier, so the
    // guard's way out — "set this operation to allow" — names a field that does
    // not exist here. The trigger's own way out is the switch, or the reason.
    'approval.disabled_trigger',
  )
}

/**
 * The line naming the gate that asked first, in one language.
 *
 * `settledBy` is already a translated sentence, so it is read, not looked up:
 * the findings follow it in the prompt, which is why the line does not repeat
 * them.
 * @param t - translator for one side of the prompt.
 * @param settledBy - the sentence the trigger supplied.
 * @returns the line, ending with a newline before the findings.
 */
function noteOf(t: Translate, settledBy: string): string {
  return `\n${t(settledBy)}`
}

/**
 * Splice a decided check into the question another gate is asking.
 *
 * The prompt keeps its own wrapper and gains the findings: a prompt that names
 * one concern while three more sit unseen behind it teaches its reader to
 * approve without looking. The `reason` the model reads carries them too,
 * because that text is the model's only account of why the call was stopped.
 * @param decision - the `ask` to extend.
 * @param options - the keys, and how to re-render the findings per language.
 * @returns the extended decision.
 */
function mergeRequest(
  decision: PreToolDecision & { readonly kind: 'ask' },
  options: AskOptions,
): PreToolDecision {
  const english = createTranslator('en-US')
  const chinese = createTranslator('zh-CN')
  const own = sideOf(options.outcome, options.t, options.detailKey)
  const settledBy = options.settledBy ?? ''
  return {
    ...decision,
    reason: `${decision.reason ?? ''}\n${own.details}`,
    displayReason: {
      ...decision.displayReason,
      en: `${decision.displayReason?.en ?? ''}${noteOf(english, settledBy)}\n${sideOf(options.assess(english), english, options.detailKey).details}`,
      zh: `${decision.displayReason?.zh ?? ''}${noteOf(chinese, settledBy)}\n${sideOf(options.assess(chinese), chinese, options.detailKey).details}`,
    },
  }
}

/**
 * Append the findings to a refusal another gate already made.
 *
 * The refusal is not softened and not replaced: its kind, its own reason and
 * whoever made it are kept as they are, and the findings follow. Under a policy
 * that refuses without asking, the gate in front is the only thing the user
 * hears about the call, so a check that stopped there would never speak at all.
 * @param decision - the refusal to extend.
 * @param options - the keys, and how to render the findings.
 * @returns the extended refusal.
 */
function appendFindings(
  decision: PreToolDecision & { readonly kind: 'deny' },
  options: AskOptions,
): PreToolDecision {
  const own = sideOf(options.outcome, options.t, options.detailKey)
  if (own.details === '') return decision
  return { ...decision, reason: `${decision.reason}\n${own.details}` }
}

/**
 * Restate an answer that was not a grant as the refusal it is.
 *
 * The findings stay in the reason: the model's only account of why the call was
 * stopped is the text this decision carries, and a bare "the user rejected it"
 * would leave the next attempt guessing at what to change.
 * @param decision - the question that was put to the user.
 * @param outcome - what came back.
 * @param t - translator for the plugin's own locale.
 * @returns the refusal to return instead.
 */
function refusalOf(
  decision: PreToolDecision & { readonly kind: 'ask' },
  outcome: ApprovalOutcome,
  t: Translate,
): PreToolDecision {
  const key =
    outcome === 'rejected'
      ? 'security.guard.approval_rejected'
      : outcome === 'cancelled'
        ? 'security.guard.approval_cancelled'
        : 'security.guard.approval_unavailable'
  return { kind: 'deny', reason: `${decision.reason}\n${t(key)}` }
}

/**
 * Settle a check that has already been evaluated.
 *
 * Five things shape the answer, and the order matters. A gate that denied the
 * call keeps its refusal — the kind, the reason and who made it stand — and the
 * findings are appended to that reason, so the model is told what else broke
 * instead of being left with half the story. The check still ran either way, so
 * the status line can say the command failed its convention check rather than
 * saying nothing happened. A question another gate is asking gains the findings
 * rather than being asked twice. A check that was *granted* is
 * remembered, so the same object is not stopped twice. And a check that was
 * refused — or never reached a person at all — is not remembered: a refusal
 * answers one attempt, so the next one is judged again.
 *
 * The grant is read through the approval seam rather than taken for granted.
 * The dispatcher settles a trigger's `ask` *after* this listener returns and
 * keeps the answer to itself, so "returning `ask`" does not mean "the user
 * said yes" — under a profile with no approval channel it is a refusal, and
 * under the `never` policy it is a refusal before anybody is consulted. Asking
 * through the same seam is what makes the distinction observable, and it is the
 * shape `createGuardApprover` already uses for the `rememberApproved` policy.
 * @param downstream - what the gates behind this one decided.
 * @param options - the keys, the outcome, and how to re-render it.
 * @param remember - records that the question was granted.
 * @returns the decision for `tools/pre-execute`.
 */
export async function settleAbout(
  downstream: PreToolDecision,
  options: AskOptions,
  remember: () => void,
): Promise<PreToolDecision> {
  if (downstream.kind === 'cancel') return downstream
  if (downstream.kind === 'deny') return appendFindings(downstream, options)

  const settledBy = options.settledBy
  if (downstream.kind !== 'allow' && settledBy !== undefined) {
    // Another gate is about to ask the same user about the same call. Its
    // prompt shows the findings; this check asks nothing of its own.
    return mergeRequest(downstream, options)
  }

  // Already a refusal when the session cannot be asked at all: under the
  // `never` policy nobody is consulted, so there is no grant to remember and
  // the next attempt speaks again.
  const decision = askAbout(options)
  if (decision.kind !== 'ask') return decision

  const service = options.approval?.()
  const agent = options.exec.agent
  // Nobody to route the question through. The dispatcher's own prompt stands —
  // and it settles that prompt into a refusal whenever no approval channel is
  // composed, which is exactly why nothing is remembered here.
  if (service?.request === undefined || agent === undefined) return decision

  const outcome = await service.request({
    agent,
    toolName: options.exec.name,
    callId: options.exec.callId,
    reason: decision.reason,
    ...(decision.displayReason === undefined ? {} : { displayReason: decision.displayReason }),
    signal: options.exec.signal,
  })
  if (outcome !== 'allowed-once') return refusalOf(decision, outcome, options.t)

  // Granted. Whatever the gates behind this one decided still stands; the
  // trigger's own question is the only thing that was answered here.
  remember()
  return downstream
}

/**
 * Read a file as text, treating absence as absence rather than as a failure.
 *
 * Checks that inspect a file the author controls (a changelog, a pull request
 * template) must not turn a missing file into a thrown error: the gate would
 * then deny a tool call over a problem the author can still fix afterwards.
 * @param path - absolute path to read.
 * @returns the contents, or `undefined` when the file cannot be read.
 */
export async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}
