import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { ApprovalSeam } from '../approval-policy.js'
import type { Config } from '../config.js'
import type { Translate } from '../i18n.js'
import type { GitRunner } from '../git.js'
import type { WorkflowState } from '../state.js'
import {
  listBranchFiles,
  listChangedFiles,
  listExistingFiles,
  listStagedFiles,
  listTrackedChanges,
  splitsMirrorPair,
} from '../tools/check-doc-sync.js'
import {
  amendedMessage,
  detectCommit,
  evaluate,
  fingerprint,
  resolveCommitMessage,
  summarize,
} from '../checks.js'
import { commandOf } from '../shell.js'
import { settleAbout } from './shared.js'

// The automatic half of the plugin: before the agent runs a shell command that
// creates a commit, check that commit against the workflow rules and route the
// findings through the approval prompt.
//
// This rides on `tools/pre-execute`, a waterfall gate that wraps every tool
// call. Two things shape the handler below: it must call `next()` first (another
// gate's refusal outranks anything said here), and it must always settle — a tool
// call that throws inside the gate would surface as a tool failure rather than a
// finding.

/** Options the trigger needs. Everything is a getter: the runtime owns it. */
export interface PreCommitTriggerOptions {
  /** Resolved plugin configuration. */
  readonly config: () => Config
  /** Translator for the locale in effect. */
  readonly t: () => Translate
  /** Session-scoped memory of what was already reported. */
  readonly state: WorkflowState
  /** A git runner bound to one working directory. */
  readonly git: (cwd: string) => GitRunner
  /** Diagnostic sink; debug level, so the default profile stays quiet. */
  readonly log: (message: string) => void
  /** Advisory sink: findings a commit may proceed with, at a level the user can see. */
  readonly warn: (message: string) => void
  /** The approval seam: the policy a finding resolves under, and the ask. */
  readonly approval?: () => ApprovalSeam | undefined
}

/**
 * Build the `tools/pre-execute` listener.
 *
 * Returning a decision other than `allow` stops the tool call before it runs;
 * `ask` is the one that fits a finding an author may knowingly override.
 * @param options - configuration, translator, state, git access, and logging.
 * @returns the listener to register on `tools/pre-execute`.
 */
export function createPreCommitTrigger(
  options: PreCommitTriggerOptions,
): (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision> {
  return async (exec, next) => {
    // Every other gate gets to speak first — including the ones this plugin does
    // not own — because a call that another gate cancels or refuses is not this
    // check's to settle. What that answer does *not* do is suppress the check: a
    // guard that asks about the same commit would otherwise be the only thing
    // the user hears about it, and the convention rules would never run at all.
    // A refusal only ends the check when the call is cancelled; otherwise the
    // findings are appended to that refusal, which is the only way they reach
    // somebody under a policy that refuses without asking.
    const downstream = await next()
    if (downstream.kind === 'cancel') return downstream

    const agent = exec.agent
    if (agent === undefined) return downstream
    const command = commandOf(exec.arguments)
    if (command === undefined) return downstream
    const commit = detectCommit(command)
    if (commit === undefined) return downstream
    if (exec.signal.aborted) return { kind: 'cancel' }

    const t = options.t()
    const config = options.config()
    // A session without a working directory runs where the process does; the
    // doc check resolves the same way.
    const cwd = agent.session.header.cwd ?? process.cwd()
    const sessionId = agent.session.id
    options.log(t('trigger.pre_commit.detected'))

    // The commit's own contents, not the working tree: what is staged is what the
    // command is about to record, and judging the rest would fail a commit for
    // edits it does not mention. The working tree is read too, but only to tell
    // a mirrored document left behind from one whose pair is being edited in the
    // same tree.
    const runner = options.git(cwd)
    // `-a` fills the index at commit time, so reading it now would describe a
    // different commit than the one about to run: the listing reads what git is
    // about to stage instead of what the index holds.
    const listed =
      commit.all === true
        ? await listTrackedChanges(runner, exec.signal)
        : await listStagedFiles(runner, exec.signal)
    const files = listed.ok ? listed.files : undefined
    // `-a` commits every tracked change, so there is no "left behind in the
    // tree" set to tell apart: the only thing a second read could add is an
    // untracked file, which `-a` does not stage and therefore must not downgrade
    // a missing document from a block to a note.
    const worktree =
      files === undefined || commit.all === true
        ? undefined
        : await listChangedFiles(runner, exec.signal)
    const resolved = await resolveCommitMessage(commit, cwd)
    // `--amend` names no message, and repairing the message is exactly what
    // amend is for: the one still in history is the one git would keep.
    const message =
      resolved.message ??
      (commit.amend === true ? await amendedMessage(runner, exec.signal) : undefined)
    // The changelog rule is about the branch, not this commit, so a feature
    // split over several commits satisfies it once. The read costs two git
    // calls, so it only runs when that rule can actually fire.
    const feature = message !== undefined && /^([a-z]+)/.exec(message)?.[1] === 'feat'
    const branchFiles =
      feature && config.rules.requireChangelogOnFeat.get()
        ? await listBranchFiles(runner, exec.signal)
        : []
    // A pair half in this commit is only a mistake when the project keeps the
    // other half: the first commit of a brand-new repository stages README.md
    // and nothing else, and there is no README.zh.md to have left behind. The
    // read costs a git call, so it only runs when a pairing was actually split.
    const existing =
      files !== undefined && config.docsCheck.enabled.get() && splitsMirrorPair(files, config)
        ? await listExistingFiles(runner, exec.signal)
        : undefined
    // What the inspection could not read travels with the input, not next to the
    // outcome: the prompt is rendered twice, once per language, and a finding
    // assembled afterwards would be missing from one of them.
    const input = {
      ...(message === undefined ? {} : { message }),
      ...(files === undefined ? {} : { files }),
      ...(branchFiles.length === 0 ? {} : { branchFiles }),
      ...(worktree === undefined || !worktree.ok ? {} : { worktreeFiles: worktree.files }),
      ...(existing === undefined ? {} : { existing }),
      ...(listed.ok ? {} : { listing: { failure: listed.failure, detail: listed.stderr } }),
      ...(resolved.unreadable === undefined ? {} : { unreadable: resolved.unreadable }),
    }

    const outcome = evaluate(input, config, t)
    options.state.record({
      kind: 'commit',
      ok: outcome.ok,
      summary: summarize(outcome, t),
    })

    // A finding the rules raised but did not block on is still a finding: it is
    // logged where someone can see it and recorded in the status line, and the
    // commit proceeds. Silence is what made these invisible.
    if (outcome.ok) {
      for (const line of outcome.warnings) options.warn(line)
      return downstream
    }

    const commitTarget = fingerprint(message ?? command)
    const docTarget = fingerprint((files ?? []).join('\n'))
    const repeated =
      options.state.seen(String(sessionId), 'commit', commitTarget) &&
      (files === undefined || options.state.seen(String(sessionId), 'doc', docTarget))
    // A commit that already broke the rules is allowed to proceed instead of
    // being asked about twice, but only until the user has answered a question
    // that carried the findings: `settleAbout` remembers them only then, so a
    // refusal does not turn into a one-time reminder.
    if (repeated) return downstream
    const remember = (): void => {
      options.state.remember(String(sessionId), 'commit', commitTarget)
      if (files !== undefined) options.state.remember(String(sessionId), 'doc', docTarget)
    }

    return settleAbout(
      downstream,
      {
        reasonKey: 'trigger.pre_commit.reason',
        askKey: 'trigger.pre_commit.ask',
        detailKey: 'trigger.pre_commit.detail',
        settledBy: 'trigger.pre_commit.settled_by',
        outcome,
        t,
        assess: (translator) => evaluate(input, config, translator),
        approval: options.approval,
        exec,
      },
      remember,
    )
  }
}
