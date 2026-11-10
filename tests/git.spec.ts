import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createGitRunner } from '../src/git.js'

// Every git call in this plugin goes through this runner, and nothing else in
// the suite exercises it: the other specs hand the checks a fake runner, so a
// classification regression here would only show up as a wrong message in a
// real host. The cases below are the ones that decide what a caller reports.

interface Answer {
  exitCode: number | null
  stdout?: string
  stderr?: string
}

interface Stub {
  readonly ctx: Context
  /** Every argv handed to the subprocess service, program name included. */
  readonly spawned: { argv: readonly string[]; cwd: string }[]
  /** How many times the executable was looked up. */
  readonly resolutions: () => number
}

/**
 * A context whose only service is a scripted subprocess provider.
 * @param options - `resolve` may fail, `answer` decides each spawn's result,
 *   and `abortOnSpawn` models the caller cancelling mid-flight.
 * @returns the context and what it recorded.
 */
function stubContext(
  options: {
    resolve?: () => Promise<string>
    answer?: (args: readonly string[]) => Answer
    failSpawn?: boolean
    abortOnSpawn?: AbortSignal
  } = {},
): Stub {
  const spawned: { argv: readonly string[]; cwd: string }[] = []
  let resolutions = 0
  const service = {
    resolveExecutable: async () => {
      resolutions += 1
      return options.resolve === undefined ? 'git' : options.resolve()
    },
    spawn: (spec: { argv: readonly string[]; cwd: string }) => {
      spawned.push({ argv: spec.argv, cwd: spec.cwd })
      options.abortOnSpawn?.throwIfAborted()
      if (options.failSpawn === true) throw new Error('spawn failed')
      const answer = options.answer?.(spec.argv.slice(1)) ?? { exitCode: 0 }
      const reader = (text: string) => ({ readFrom: () => ({ text }) })
      return {
        collected: { stdout: reader(answer.stdout ?? ''), stderr: reader(answer.stderr ?? '') },
        done: Promise.resolve({ exitCode: answer.exitCode, signal: null }),
        terminate: () => undefined,
      }
    },
  }
  const ctx = { get: (name: string) => (name === 'subprocess' ? service : undefined) }
  return { ctx: ctx as unknown as Context, spawned, resolutions: () => resolutions }
}

describe('git runner', () => {
  it('reports a missing subprocess provider instead of throwing', async () => {
    const runner = createGitRunner({ get: () => undefined } as unknown as Context, '/repo')
    expect(await runner.locate()).toEqual({ ok: false, failure: 'git-not-available' })
    const result = await runner.run(['status'])
    expect(result).toEqual({ ok: false, failure: 'git-not-available', stderr: '' })
  })

  it('runs in the directory it was built for and returns stdout', async () => {
    const stub = stubContext({
      answer: (args) =>
        args[0] === 'status' ? { exitCode: 0, stdout: ' M src/index.ts\n' } : { exitCode: 0 },
    })
    const runner = createGitRunner(stub.ctx, '/repo')
    const result = await runner.run(['status', '--porcelain=v1'])
    expect(result).toEqual({ ok: true, stdout: ' M src/index.ts\n' })
    expect(stub.spawned[0]?.cwd).toBe('/repo')
    expect(stub.spawned[0]?.argv).toEqual(['git', 'status', '--porcelain=v1'])
  })

  it('resolves the executable once and reuses it', async () => {
    const stub = stubContext()
    const runner = createGitRunner(stub.ctx, '/repo')
    await runner.run(['status'])
    await runner.run(['diff'])
    await runner.locate()
    // The answer cannot change while the process runs, and each tool call would
    // otherwise repeat the same filesystem search.
    expect(stub.resolutions()).toBe(1)
  })

  it('classifies the cannot-run exit as not-a-git-repository outside a work tree', async () => {
    const stub = stubContext({
      answer: (args) =>
        args[0] === 'rev-parse'
          ? { exitCode: 0, stdout: 'false\n' }
          : { exitCode: 128, stderr: 'fatal: not a git repository' },
    })
    const runner = createGitRunner(stub.ctx, '/tmp')
    const result = await runner.run(['status'])
    expect(result).toEqual({
      ok: false,
      failure: 'not-a-git-repository',
      stderr: 'fatal: not a git repository',
    })
  })

  it('classifies any failed call by probing the repository, not by the exit code', async () => {
    // `git diff --cached` outside a work tree degrades to --no-index mode and
    // exits 129, not 128: gating the probe on 128 alone reported "a git command
    // failed" for a directory that simply is not a repository.
    for (const exitCode of [1, 128, 129]) {
      const stub = stubContext({
        answer: (args) =>
          args[0] === 'rev-parse'
            ? { exitCode: 0, stdout: 'false\n' }
            : { exitCode, stderr: 'error: unknown option' },
      })
      const runner = createGitRunner(stub.ctx, '/tmp')
      const result = await runner.run(['diff', '--cached', '--name-only', '-z'])
      expect(result).toEqual({
        ok: false,
        failure: 'not-a-git-repository',
        stderr: 'error: unknown option',
      })
    }
  })

  it('keeps any ordinary failure inside a work tree', async () => {
    const stub = stubContext({
      answer: (args) =>
        args[0] === 'rev-parse'
          ? { exitCode: 0, stdout: 'true\n' }
          : { exitCode: 129, stderr: 'fatal: something else' },
    })
    const runner = createGitRunner(stub.ctx, '/repo')
    const result = await runner.run(['diff', '--cached', '--name-only', '-z'])
    expect(result).toEqual({
      ok: false,
      failure: 'command-failed',
      stderr: 'fatal: something else',
      stdout: '',
    })
  })

  it('keeps an ordinary failure inside a work tree, stdout included', async () => {
    const stub = stubContext({
      answer: (args) =>
        args[0] === 'rev-parse'
          ? { exitCode: 0, stdout: 'true\n' }
          : { exitCode: 128, stdout: 'conflicted path\n', stderr: 'fatal: something else' },
    })
    const runner = createGitRunner(stub.ctx, '/repo')
    const result = await runner.run(['merge-tree', 'main', 'fix'])
    // `git merge-tree` reports conflicts this way: a non-zero exit and the paths
    // on stdout. Reading only stderr would lose the answer.
    expect(result).toEqual({
      ok: false,
      failure: 'command-failed',
      stderr: 'fatal: something else',
      stdout: 'conflicted path\n',
    })
  })

  it('reports cancellation when the signal fires during the call', async () => {
    const controller = new AbortController()
    const stub = stubContext({ answer: () => ({ exitCode: 1, stderr: 'partial' }) })
    controller.abort()
    const runner = createGitRunner(stub.ctx, '/repo')
    const result = await runner.run(['status'], controller.signal)
    expect(result).toMatchObject({ ok: false, failure: 'cancelled' })
  })

  it('reports git-not-available when the executable cannot be spawned', async () => {
    const stub = stubContext({ failSpawn: true })
    const runner = createGitRunner(stub.ctx, '/repo')
    const result = await runner.run(['status'])
    expect(result).toMatchObject({ ok: false, failure: 'git-not-available' })
  })

  it('reports git-not-available when the lookup fails', async () => {
    const stub = stubContext({
      resolve: async () => {
        throw new Error('ENOENT')
      },
    })
    const runner = createGitRunner(stub.ctx, '/repo')
    const result = await runner.run(['status'])
    expect(result).toEqual({ ok: false, failure: 'git-not-available', stderr: '' })
    expect(stub.spawned).toHaveLength(0)
  })
})
