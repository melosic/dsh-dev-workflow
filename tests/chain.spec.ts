import { describe, expect, it } from 'vitest'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import type { GitResult, GitRunner } from '../src/git.js'
import { createTranslator } from '../src/i18n.js'
import { createRuntime } from '../src/index.js'
import { createHarness, askOf, harnessConfig, makeExec } from './harness.js'

// The guards and the convention triggers ride on the same event, in one
// waterfall, and the order between them is not the order they were written in:
// the outermost listener's answer is the one the tool call settles on. Every
// other spec drives one listener with `next()` answering `allow`, which is a
// shape no session ever produces. These cases drive the chain the runtime
// actually registers, because that is where the audit's worst findings lived:
// a guard that answers `ask` first would hide every convention finding behind
// its own generic question.

const t = createTranslator('en-US')

/**
 * A git runner that answers the questions the checks ask.
 * @param options - staged paths, working-tree paths, branch paths, whether the
 * branch has no commit yet, and the current message.
 * @returns the runner, recording every argument list it was asked for.
 */
function makeRepo(options: {
  staged?: readonly string[]
  worktree?: readonly string[]
  branch?: readonly string[]
  existing?: readonly string[]
  unborn?: boolean
  asks?: string[][]
}): GitRunner {
  const staged = options.staged ?? []
  const worktree = options.worktree ?? staged
  const branch = options.branch ?? []
  // What the repository already carries. Every path this fake knows about is
  // tracked, so that is the default; a spec whose repository also keeps files
  // this commit does not mention names them.
  const existing = options.existing ?? [...new Set([...staged, ...worktree])]
  return {
    cwd: process.cwd(),
    run: async (args): Promise<GitResult> => {
      options.asks?.push([...args])
      const joined = args.join(' ')
      if (joined.startsWith('diff --cached')) {
        return { ok: true, stdout: staged.map((path) => `${path}\0`).join('') }
      }
      // `-a` asks what the commit will contain, which the index cannot answer
      // before the command runs: it is every tracked change, staged or not.
      if (joined.startsWith('diff --name-only -z HEAD')) {
        // On a branch with no commit yet this is what git really answers:
        // exit 128, `fatal: ambiguous argument 'HEAD'`.
        if (options.unborn === true) {
          return { ok: false, failure: 'command-failed', stderr: 'fatal: HEAD' }
        }
        const tracked = [...new Set([...staged, ...worktree])]
        return { ok: true, stdout: tracked.map((path) => `${path}\0`).join('') }
      }
      if (joined.startsWith('merge-base')) {
        return { ok: true, stdout: branch.length === 0 ? '' : 'base000\n' }
      }
      if (joined.startsWith('diff --name-only -z base000..HEAD')) {
        return { ok: true, stdout: branch.map((path) => `${path}\0`).join('') }
      }
      if (joined.startsWith('status --porcelain')) {
        return { ok: true, stdout: worktree.map((path) => ` M ${path}\0`).join('') }
      }
      // Everything tracked, plus every file already on disk: the answer to
      // "has this document ever existed here?".
      if (joined.startsWith('ls-files')) {
        return { ok: true, stdout: existing.map((path) => `${path}\0`).join('') }
      }
      if (joined.startsWith('log -1')) return { ok: true, stdout: 'feat: previous subject\n' }
      return { ok: true, stdout: '' }
    },
    locate: async () => ({ ok: true, path: 'git' }),
  }
}

/**
 * Build the chain the runtime registers and drive one command through it.
 * @param command - the shell command to run.
 * @param options - repository contents and configuration overrides.
 * @returns the decision and the captured environment.
 */
async function run(
  command: string,
  options: {
    staged?: readonly string[]
    worktree?: readonly string[]
    branch?: readonly string[]
    existing?: readonly string[]
    unborn?: boolean
    config?: Record<string, unknown>
    /** The approval policy the composed seam reports; `never` refuses without asking. */
    policy?: string
  } = {},
): Promise<{
  decision: PreToolDecision
  asks: string[][]
  harness: ReturnType<typeof createHarness>
}> {
  const harness = createHarness(
    options.policy === undefined ? {} : { approval: true, policy: options.policy },
  )
  const asks: string[][] = []
  const repo = makeRepo({ ...options, asks })
  // `en-US` explicitly: the prompts are bilingual, the model-facing reason is
  // not, and a runtime reading the machine's locale would assert differently on
  // a different machine.
  const runtime = createRuntime(harness.ctx, harnessConfig({ locale: 'en-US', ...options.config }))
  // The runtime builds its own runner per working directory, so the spec asks it
  // once for the directory the call runs in — that answer is the cache entry the
  // triggers will read — and then hands back its own repository for every
  // directory. Running against the real checkout is what the suite must never do.
  runtime.git(process.cwd())
  runtime.git = () => repo
  const exec = makeExec(command)

  // `harness.listeners` is in registration order, outermost first — the same
  // order cordis runs them in.
  const listeners = harness.listeners
  const step = async (index: number): Promise<PreToolDecision> => {
    const next = listeners[index]
    if (next === undefined) return { kind: 'allow' }
    return next.listener(exec as never, (() => step(index + 1)) as never)
  }
  return { decision: await step(0), asks, harness }
}

describe('guard and trigger on one chain', () => {
  it('shows the pull-request findings even though the outward guard asks first', async () => {
    const { decision } = await run(
      'gh pr create --title "Add the thing" --body "No sections here."',
    )

    expect(decision.kind).toBe('ask')
    const ask = askOf(decision)
    // The guard's own question, and the trigger's findings inside it: this is the
    // audit's first finding, and it is only visible on a real chain.
    expect(ask.reason).toContain(t('security.guard.outward_pull_request'))
    expect(ask.reason).toContain(t('tool.check_commit_message.error.missing_type'))
    expect(ask.displayReason.en).toContain(t('tool.check_commit_message.error.missing_type'))
  })

  it('names the pull-request findings inside the refusal when nobody can be asked', async () => {
    const { decision } = await run(
      'gh pr create --title "Add the thing" --body "No sections here."',
      {
        policy: 'never',
      },
    )

    // Under `never` the outward guard's question is refused before it is asked,
    // so the refusal is the only text the model ever reads. The description rules
    // have to be in it, or the check never spoke at all.
    expect(decision.kind).toBe('deny')
    expect((decision as { reason: string }).reason).toContain(
      t('security.guard.outward_pull_request'),
    )
    expect((decision as { reason: string }).reason).toContain(
      t('tool.check_commit_message.error.missing_type'),
    )
  })

  it('reads a clustered short option, so `git commit -am` still gets its message checked', async () => {
    const { decision, asks } = await run('git commit -am "Add the thing"', {
      staged: ['src/a.ts'],
    })

    expect(decision.kind).toBe('ask')
    expect(askOf(decision).reason).toContain(t('tool.check_commit_message.error.missing_type'))
    // One git call for the staged set, one for the working tree — the checks do
    // not re-read the same answer.
    expect(asks.filter((args) => args[0] === 'status')).toHaveLength(1)
  })

  it('does not block an unrelated commit on a half-staged mirrored pair', async () => {
    // README.md was left half-edited in the working tree; the commit itself is
    // about one source file and its own documentation.
    const { decision } = await run('git commit -m "docs(api): describe the flag"', {
      staged: ['src/a.ts', 'docs/API.md'],
      worktree: ['src/a.ts', 'docs/API.md', 'README.md'],
    })

    expect(decision.kind).toBe('allow')
  })

  it('still refuses a commit that leaves the pair behind entirely', async () => {
    // README.md is the mirror of README.zh.md, and the commit touches only one
    // half of the pair — with nothing else in the tree to suggest the other half
    // is being written next. The repository keeps both halves, which is what
    // makes the untouched one a document that was left behind.
    const { decision } = await run('git commit -m "docs(readme): describe the flag"', {
      staged: ['README.md', 'docs/API.md'],
      worktree: ['README.md', 'docs/API.md'],
      existing: ['README.md', 'README.zh.md', 'docs/API.md'],
    })

    expect(decision.kind).toBe('ask')
    // The reason wraps the findings: it names why the call was stopped, then
    // lists what the check found.
    const ask = askOf(decision)
    expect(ask.reason).toContain(t('trigger.pre_commit.reason').split('\n')[0] ?? '')
    expect(ask.reason).toContain(
      createTranslator('en-US')('tool.check_doc_sync.error.mirror', {
        changed: 'README.md',
        missing: 'README.zh.md',
      }),
    )
  })

  it('does not refuse the first commit of a repository that has no pair yet', async () => {
    // A brand-new project stages its README.md and nothing else: there is no
    // README.zh.md to have left behind, and a project written in one language
    // never writes one. Demanding it would stop the repository at commit one.
    const { decision } = await run('git commit -m "chore(repo): start"', {
      staged: ['README.md'],
      worktree: ['README.md'],
      existing: ['README.md'],
    })

    expect(decision.kind).toBe('allow')
  })

  it('reads what `git commit -a` will record instead of the empty index', async () => {
    // `-a` stages at commit time: the index is empty when the check runs, and
    // judging it would fail a feature commit whose CHANGELOG is right there in
    // the working tree.
    const { decision } = await run('git commit -a -m "feat(core): add a flag"', {
      staged: [],
      worktree: ['src/core.ts', 'CHANGELOG.md'],
    })

    expect(decision.kind).toBe('allow')
  })

  it('commits into a repository that has no history yet', async () => {
    // Before the first commit there is no HEAD, so `git diff HEAD` exits 128.
    // Reading that as a failed listing blocked the first commit of every new
    // repository — a commit like any other.
    const { decision, asks, harness } = await run('git commit -a -m "fix(core): start"', {
      unborn: true,
      staged: [],
      worktree: ['src/core.ts', 'CHANGELOG.md'],
    })

    expect(decision.kind).toBe('allow')
    expect(asks.map((args) => args.join(' '))).not.toContain('diff --name-only -z HEAD')
    expect(harness.warnings.join('\n')).not.toContain(
      t('trigger.pre_commit.warn.degraded', {
        reason: t('error.command_failed', { detail: 'fatal: HEAD' }),
      }),
    )
  })

  it('counts a changelog an earlier commit on the branch already carries', async () => {
    // The feature was split over several commits and the changelog was written
    // in an earlier one. The rule is about the branch, so the last commit must
    // not be stopped for a document that is already in history.
    const { decision } = await run('git commit -m "feat(core): wire the flag"', {
      staged: ['src/core.ts'],
      worktree: ['src/core.ts'],
      branch: ['src/core.ts', 'CHANGELOG.md'],
    })

    expect(decision.kind).toBe('allow')
  })
})
