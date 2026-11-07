import type { Config } from '../config.js'
import { commandOf, gitInvocations } from '../shell.js'
import { detectIssue, detectPullRequest } from '../triggers/pre-pr.js'
import { detectRelease } from '../triggers/pre-release.js'
import { createGuardApprover } from './approval.js'
import type { ApprovalService } from './approval.js'
import { createGuard, hasShortOption, strictest } from './shared.js'
import type { GuardHit, GuardOptions } from './shared.js'

// outward-guard: the half of the plugin that protects the user's turn.
//
// The other four guards protect work that is lost or exposed in this machine's
// own reckoning — a discarded commit, a wiped disk, a credential in an argument.
// This one covers a different mistake: an action that is perfectly reversible
// here, but that other people can see the moment it leaves. A push, a tag, a
// pull request, an issue, and a publish all cross that line — and an agent
// running ahead to announce work the user has not agreed to yet is exactly what
// happens without a gate here.
//
// Like the git guard it classifies words rather than running a shell. The
// recognisers it needs are the ones the pull-request and release triggers
// already use, imported rather than copied: "what counts as a release" has to
// stay one answer, or the gate and the check will disagree about what they are
// looking at.
//
// Every default is `ask`, never `allow`. The point is consent, not obstruction:
// the user says yes, and the push goes through untouched.
//
// What this guard cannot see is the same limit the triggers have: it reads the
// command line, so a `git push` wrapped in a quoting this lexer cannot read is
// invisible to it — a boundary SECURITY.md states rather than a claim it makes.

/**
 * What this guard needs. Same shape as every other guard's, plus the approval
 * seam it asks through when `gitGuard.rememberApproved` is on: a session that
 * has already consented to publishing this branch is not asked again for the
 * same push, tag or publish.
 */
export type OutwardGuardOptions = Omit<GuardOptions, 'approval'> & {
  readonly approval?: () => ApprovalService | undefined
}

/**
 * Find the outward-facing action in one shell command.
 * @param command - the command line the agent is about to run.
 * @param config - resolved plugin configuration.
 * @returns the strictest hit, or `undefined` when nothing leaves this machine.
 */
export function detectOutward(command: string, config: Config): GuardHit | undefined {
  if (!config.outwardGuard.enabled.get()) return undefined
  const guard = config.outwardGuard
  const hits: GuardHit[] = []

  for (const { subcommand, args } of gitInvocations(command)) {
    if (subcommand !== 'push') continue
    // A rehearsal never reaches the remote, so it is not outward-facing.
    if (args.includes('--dry-run') || hasShortOption(args, 'n')) continue
    hits.push({ reason: 'security.guard.outward_push', action: guard.push.get() })
  }

  // One recogniser answers both questions: it returns the tag only when the line
  // creates one, and the dist-tag only when the line really publishes (it
  // deliberately reports nothing for `--dry-run`).
  const release = detectRelease(command, new Set(config.releaseCheck.publishers.get()))
  if (release?.tag !== undefined) {
    hits.push({ reason: 'security.guard.outward_tag', action: guard.tag.get() })
  }
  if (release?.publishTag !== undefined) {
    hits.push({ reason: 'security.guard.outward_publish', action: guard.publish.get() })
  }

  if (detectPullRequest(command) !== undefined) {
    hits.push({ reason: 'security.guard.outward_pull_request', action: guard.pullRequest.get() })
  }
  if (detectIssue(command)) {
    hits.push({ reason: 'security.guard.outward_issue', action: guard.issue.get() })
  }

  return strictest(hits)
}

/**
 * Build the `tools/pre-execute` listener for actions that leave this machine.
 * @param options - configuration, translator, hit tally, and logging.
 * @returns the listener to register on `tools/pre-execute`.
 */
export function createOutwardGuard(options: OutwardGuardOptions): ReturnType<typeof createGuard> {
  return createGuard({
    ...options,
    label: 'outward guard',
    // The policy switch lives in `gitGuard`, beside the git guard's own memory.
    // A push the user has already approved in this session is the same push the
    // next turn is about to make: asking again is how a prompt teaches its
    // reader to approve without reading.
    approver: createGuardApprover({
      approval: options.approval ?? (() => undefined),
      state: options.state,
      remembers: () => options.config().gitGuard.rememberApproved.get(),
    }),
    detect: (exec) => {
      const command = commandOf(exec.arguments)
      return command === undefined ? undefined : detectOutward(command, options.config())
    },
  })
}
