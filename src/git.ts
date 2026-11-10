import type { Context } from '@deepseek-ai/cordis'

// The single place this plugin talks to git. Everything routes through the DSH
// subprocess service rather than `node:child_process`, so spawned git inherits
// the harness's scrubbed environment and cancellation policy.

// The service is read through `ctx.get`, not `inject`: git is an optional
// capability, and a profile without a subprocess provider must still load the
// plugin and report "git was not found" for one check rather than fail to mount.
// The types below are the structural shape actually used; `@deepseek-ai/dsh-subprocess`
// is a peer package that cannot be resolved from this plugin's own root.
interface OutputReader {
  readFrom(offset: number): { text: string }
}

interface SpawnOutcome {
  readonly exitCode: number | null
  readonly signal: string | null
}

interface SpawnHandle {
  readonly collected: { readonly stdout?: OutputReader; readonly stderr?: OutputReader }
  readonly done: Promise<SpawnOutcome>
  terminate(): void
}

interface SubprocessService {
  resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string>
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: {
      stdin: 'ignore'
      stdout: { maxBytes: number }
      stderr: { maxBytes: number }
    }
    graceMs: number
    signal?: AbortSignal
  }): SpawnHandle
}

/** Why a git call did not produce usable output. */
export type GitFailure =
  /** No subprocess provider is mounted, or git is not on the provider's PATH. */
  | 'git-not-available'
  /** The directory is not inside a git work tree. */
  | 'not-a-git-repository'
  /** The call was cancelled through its abort signal. */
  | 'cancelled'
  /** git ran and reported a failure the caller has to read from `stderr`. */
  | 'command-failed'

/** Outcome of one git invocation. */
export type GitResult =
  | { readonly ok: true; readonly stdout: string }
  | {
      readonly ok: false
      readonly failure: GitFailure
      readonly stderr: string
      /**
       * What the command wrote before it failed, when that is the answer rather
       * than noise. `git merge-tree` reports a conflict as a non-zero exit and
       * names the files on stdout, so a caller that reads only `stderr` would
       * learn that something went wrong but not what.
       */
      readonly stdout?: string
    }

/** Maximum bytes retained per stream: commit metadata, never file contents. */
const MAX_STREAM_BYTES = 1024 * 1024

/** Grace period handed to the subprocess provider's termination procedure. */
const GRACE_MS = 5000

/**
 * Read the optional subprocess service from a context.
 * @param ctx - any DSH context; the service is resolved, not injected.
 * @returns the service, or `undefined` when the profile has no provider.
 */
function service(ctx: Context): SubprocessService | undefined {
  const found: unknown = ctx.get('subprocess')
  return found === undefined || found === null ? undefined : (found as SubprocessService)
}

/** Run git in one repository directory. */
export interface GitRunner {
  /** Absolute directory every call runs in. */
  readonly cwd: string
  /**
   * Run one git command.
   * @param args - arguments after the program name, never shell-interpreted.
   * @param signal - caller-owned cancellation.
   * @returns stdout on success, or a classified failure.
   */
  run(args: readonly string[], signal?: AbortSignal): Promise<GitResult>
  /**
   * Whether {@link run} can reach git at all. Callers use this to tell "no git
   * here" apart from "git says no".
   * @param signal - caller-owned cancellation.
   * @returns the executable path, or a failure to report.
   */
  locate(
    signal?: AbortSignal,
  ): Promise<{ ok: true; path: string } | { ok: false; failure: GitFailure }>
}

/**
 * Build a git runner for one working directory.
 * @param ctx - the plugin context.
 * @param cwd - the directory git commands run in.
 * @returns the runner.
 */
export function createGitRunner(ctx: Context, cwd: string): GitRunner {
  const subprocess = service(ctx)

  // The executable does not move while the process runs, and every git call in a
  // tool invocation would otherwise pay a fresh filesystem search for the same
  // answer.
  let found: string | undefined

  const locate: GitRunner['locate'] = async (signal) => {
    if (subprocess === undefined) return { ok: false, failure: 'git-not-available' }
    if (found !== undefined) return { ok: true, path: found }
    try {
      found = await subprocess.resolveExecutable('git', undefined, signal)
      return { ok: true, path: found }
    } catch {
      return { ok: false, failure: 'git-not-available' }
    }
  }

  /** One spawn, already located: the shape both the caller and the probe use. */
  const exec = async (
    path: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> => {
    const handle = subprocess!.spawn({
      argv: [path, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_STREAM_BYTES },
        stderr: { maxBytes: MAX_STREAM_BYTES },
      },
      graceMs: GRACE_MS,
      signal,
    })
    const outcome = await handle.done
    return {
      exitCode: outcome.exitCode,
      stdout: handle.collected.stdout?.readFrom(0).text ?? '',
      stderr: handle.collected.stderr?.readFrom(0).text ?? '',
    }
  }

  /**
   * Whether the working directory is inside a git work tree.
   *
   * Asked of git rather than read off a message: git translates its errors, so
   * matching the English text of "not a git repository" stops working under any
   * other locale, and the caller then reports an ordinary command failure for a
   * directory that simply is not a repository. The probe runs only after a
   * command has already failed, so the ordinary path pays nothing for it.
   */
  const isRepository = async (path: string, signal?: AbortSignal): Promise<boolean> => {
    try {
      const probe = await exec(path, ['rev-parse', '--is-inside-work-tree'], signal)
      return probe.exitCode === 0 && probe.stdout.trim() === 'true'
    } catch {
      return false
    }
  }

  const run: GitRunner['run'] = async (args, signal) => {
    // Asked as a call, not read off `signal.aborted`: an abort can arrive during
    // any of the awaits below, and a value the type checker narrowed earlier in
    // this function is about that moment, not about now.
    const cancelled = (): boolean => signal?.aborted === true
    const located = await locate(signal)
    if (!located.ok) return { ok: false, failure: located.failure, stderr: '' }

    let outcome: { exitCode: number | null; stdout: string; stderr: string }
    try {
      outcome = await exec(located.path, args, signal)
    } catch (error) {
      // A pre-aborted signal and an unlaunchable executable both land here.
      return {
        ok: false,
        failure: signal?.aborted === true ? 'cancelled' : 'git-not-available',
        stderr: String(error),
      }
    }

    const { stdout, stderr } = outcome
    if (outcome.exitCode === 0) return { ok: true, stdout }
    if (cancelled()) return { ok: false, failure: 'cancelled', stderr }
    if (outcome.exitCode === null) return { ok: false, failure: 'cancelled', stderr }
    // The exit code does not say whether git could run here. 128 is the usual
    // cannot-run-here code, but `git diff --cached` degrades to --no-index mode
    // outside a work tree and exits 129, so gating the probe on one code would
    // report "a git command failed" for a directory that is simply not a
    // repository. Probing on every failed call keeps that answer independent of
    // whichever code git picked this time; a call that succeeded pays nothing.
    const inside = await isRepository(located.path, signal)
    // The probe is another git call, so it can be cancelled too; a cancelled
    // call is reported as cancelled, not as a directory that is not a repository.
    if (cancelled()) return { ok: false, failure: 'cancelled', stderr }
    if (!inside) return { ok: false, failure: 'not-a-git-repository', stderr }
    // The stdout is kept only for a command that reports its answer through it;
    // for everything else it is partial output of a failed run, and a caller
    // reading it as data would judge a truncated result.
    return { ok: false, failure: 'command-failed', stderr, stdout }
  }

  return { cwd, run, locate }
}
