import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { Config } from '../src/config.js'
import { createTranslator } from '../src/i18n.js'
import { createWorkflowState } from '../src/state.js'
import {
  createPreReleaseTrigger,
  detectRelease,
  evaluateRelease,
  releaseRules,
} from '../src/triggers/pre-release.js'
import { askOf, makeApproval, makeExec, type HarnessApproval } from './harness.js'

const t = createTranslator('en-US')

/** A changelog with entries waiting under `[Unreleased]`. */
const FULL_CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '- A `--json` flag for the status command.',
  '',
  '## [0.1.0] - 2026-01-01',
  '',
  '### Added',
  '',
  '- The first release.',
  '',
].join('\n')

/** A changelog whose `[Unreleased]` section is present but empty. */
const EMPTY_CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '## [0.1.0] - 2026-01-01',
  '',
].join('\n')

/**
 * Write a throwaway project with a `package.json` and a changelog.
 * @param version - the version to record in the manifest.
 * @param changelog - the changelog text, when the release should have one.
 * @returns the directory, for use as a session working directory.
 */
function project(version: string, changelog?: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-release-'))
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version }), 'utf8')
  if (changelog !== undefined) writeFileSync(join(directory, 'CHANGELOG.md'), changelog, 'utf8')
  return directory
}

/**
 * Build the listener the way the runtime does.
 * @param options - configuration overrides and the shared state to use.
 * @returns the listener, its state, and resolved configuration.
 */
function trigger(
  options: {
    config?: Record<string, unknown>
    state?: ReturnType<typeof createWorkflowState>
    approval?: HarnessApproval
    warnings?: string[]
  } = {},
) {
  const state = options.state ?? createWorkflowState()
  const resolved = Config(options.config ?? {})
  const warnings = options.warnings ?? []
  const listener = createPreReleaseTrigger({
    config: () => resolved,
    t: () => t,
    state,
    log: () => {},
    warn: (line) => warnings.push(line),
    ...(options.approval === undefined ? {} : { approval: () => options.approval?.service }),
  })
  return { listener, state, config: resolved, warnings }
}

/** Run one shell command through the listener. */
async function fire(
  listener: ReturnType<typeof createPreReleaseTrigger>,
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

describe('src/triggers/pre-release.ts', () => {
  it('recognises a tag or a publish and nothing else', () => {
    expect(detectRelease('git tag v0.2.0')).toEqual({ tag: 'v0.2.0' })
    expect(detectRelease('git tag -a v0.2.0 -m "release"')).toEqual({ tag: 'v0.2.0' })
    expect(detectRelease('git tag -m "release" v0.2.0')).toEqual({ tag: 'v0.2.0' })
    expect(detectRelease('npm publish')).toEqual({ publishTag: 'latest' })
    expect(detectRelease('npm publish --tag next')).toEqual({ publishTag: 'next' })
    expect(detectRelease('npm publish --tag=next')).toEqual({ publishTag: 'next' })
    // `npx` only runs the package manager, so the publish is still one.
    expect(detectRelease('npx npm publish --tag next')).toEqual({ publishTag: 'next' })
    // A rehearsal uploads nothing, so it releases nothing.
    expect(detectRelease('npm publish --dry-run')).toBeUndefined()
    expect(detectRelease('npm publish -n --tag next')).toBeUndefined()
    expect(detectRelease('git tag v0.2.0 && npm publish --dry-run')).toEqual({ tag: 'v0.2.0' })
    // One line can do both, and the checks need to see both to judge it.
    expect(detectRelease('git tag v0.2.0 && npm publish')).toEqual({
      tag: 'v0.2.0',
      publishTag: 'latest',
    })
    // pnpm takes global options before the subcommand, and `-r` publishes every
    // package in the workspace: both are a publish, not an option-only line.
    expect(detectRelease('pnpm --filter pkg publish')).toEqual({
      publishTag: 'latest',
      filter: 'pkg',
    })
    expect(detectRelease('pnpm -r publish')).toEqual({ publishTag: 'latest' })
    expect(detectRelease('pnpm -w publish --tag next')).toEqual({ publishTag: 'next' })

    for (const command of [
      'git tag',
      'git tag --list',
      'git tag -l "v*"',
      'git tag -d v0.1.0',
      'git tag -v v0.1.0',
      'git push origin v0.1.0',
      'npm test',
      'npm run build',
      'npm install',
      'echo "npm publish"',
    ]) {
      expect(detectRelease(command), command).toBeUndefined()
    }
  })

  it('asks when the unreleased section holds nothing', async () => {
    const { listener, state } = trigger()
    const directory = project('0.1.0', EMPTY_CHANGELOG)
    const decision = await fire(listener, 'git tag v0.2.0', { cwd: directory })

    expect(decision.kind).toBe('ask')
    expect((decision as { reason: string }).reason).toContain(
      t('trigger.pre_release.error.changelog_empty', { version: '0.2.0', section: 'Unreleased' }),
    )
    expect(state.lastOutcome()).toMatchObject({ kind: 'release', ok: false })
  })

  it('asks when the tag and the manifest name different versions', async () => {
    const { listener } = trigger()
    const directory = project('0.1.0', FULL_CHANGELOG)
    const decision = await fire(listener, 'git tag v0.2.0', { cwd: directory })

    expect(decision.kind).toBe('ask')
    expect((decision as { reason: string }).reason).toContain(
      t('trigger.pre_release.error.version_mismatch', { tag: '0.2.0', version: '0.1.0' }),
    )
  })

  it('reads the manifest a --filter points at, not the root one', async () => {
    const { listener } = trigger()
    // A monorepo release names its package; comparing the tag against the root
    // version would fail every such release with a mismatch that is not there.
    const directory = project('0.1.0', FULL_CHANGELOG)
    mkdirSync(join(directory, 'packages', 'core'), { recursive: true })
    writeFileSync(
      join(directory, 'packages', 'core', 'package.json'),
      JSON.stringify({ version: '0.2.0' }),
      'utf8',
    )
    const decision = await fire(listener, 'pnpm --filter packages/core publish', { cwd: directory })

    expect(decision.kind).toBe('allow')
  })

  it('asks when a pre-release is published to latest', async () => {
    const { listener } = trigger()
    // `npm publish` states no dist-tag, and npm defaults pre-releases to
    // `latest` as readily as anything else — which is exactly the mistake.
    const directory = project('0.2.0-rc.1', FULL_CHANGELOG)
    const decision = await fire(listener, 'npm publish', { cwd: directory })

    expect(decision.kind).toBe('ask')
    expect((decision as { reason: string }).reason).toContain(
      t('trigger.pre_release.error.prerelease_tag', { version: '0.2.0-rc.1' }),
    )
  })

  it('accepts a pre-release published to its own dist-tag', async () => {
    const { listener, state } = trigger()
    const directory = project('0.2.0-rc.1', FULL_CHANGELOG)
    const decision = await fire(listener, 'git tag v0.2.0-rc.1 && npm publish --tag next', {
      cwd: directory,
    })

    expect(decision.kind).toBe('allow')
    expect(state.lastOutcome()).toMatchObject({ kind: 'release', ok: true })
  })

  it('asks about a version that is not a semantic version', () => {
    const outcome = evaluateRelease({ version: '0.2' }, t)
    expect(outcome.ok).toBe(false)
    expect(outcome.errors).toContain(t('trigger.pre_release.error.version', { version: '0.2' }))
  })

  it('notes a changelog category Keep a Changelog does not define, without blocking', () => {
    // Keep a Changelog calls the groups optional and lets a project add its own,
    // so a repository vocabulary is a preference. Blocking taught users to turn
    // the rule off and lose it for good.
    const changelog = FULL_CHANGELOG.replace('### Added', '### Improvements')
    const outcome = evaluateRelease({ version: '0.2.0', changelog }, t)
    expect(outcome.ok).toBe(true)
    expect(outcome.warnings).toContain(
      t('trigger.pre_release.warn.changelog_category', { section: 'Improvements' }),
    )
  })

  it('asks when the changelog keeps no unreleased section at all', () => {
    const outcome = evaluateRelease({ version: '0.2.0', changelog: '# Changelog\n' }, t)
    expect(outcome.errors).toContain(
      t('trigger.pre_release.error.changelog', { section: 'Unreleased' }),
    )
  })

  it('passes a compliant release without a word', async () => {
    const { listener, state } = trigger()
    const directory = project('0.2.0', FULL_CHANGELOG)
    const decision = await fire(listener, 'git tag v0.2.0', { cwd: directory })

    expect(decision.kind).toBe('allow')
    expect(state.lastOutcome()).toMatchObject({ kind: 'release', ok: true })
  })

  it('accepts entries already moved into the version section', async () => {
    // The release procedure moves the entries out of `[Unreleased]` and into
    // `[<version>]` before tagging, so a changelog in that state is complete.
    const moved = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '## [0.2.0]',
      '',
      '### Added',
      '',
      '- A flag.',
    ].join('\n')
    const outcome = evaluateRelease({ version: '0.2.0', changelog: moved }, t)
    expect(outcome.errors).toEqual([])
  })

  it('renders the approval prompt in both client languages', async () => {
    const { listener } = trigger()
    const directory = project('0.1.0', EMPTY_CHANGELOG)
    const decision = await fire(listener, 'git tag v0.2.0', { cwd: directory })
    const display = askOf(decision).displayReason

    expect(display.en).toContain(
      createTranslator('en-US')('trigger.pre_release.ask').split('\n')[0],
    )
    expect(display.zh).toContain(
      createTranslator('zh-CN')('trigger.pre_release.ask').split('\n')[0],
    )
    expect(display.en).not.toContain('开发工作流插件发现')
    expect(display.zh).not.toContain('The development-workflow plugin found')
  })

  it('stays out of the way while the agent is only coding', async () => {
    const { listener, state } = trigger()
    const directory = project('0.1.0', FULL_CHANGELOG)
    for (const command of [
      'npm test',
      'npm run build',
      'git status',
      'git commit -m "feat(cli): add a flag"',
      'git push origin main',
      'git tag --list',
    ]) {
      expect((await fire(listener, command, { cwd: directory })).kind, command).toBe('allow')
    }
    expect(state.lastOutcome()).toBeUndefined()
  })

  it('ignores a tool call that is not tied to an agent session', async () => {
    const { listener, state } = trigger()
    const directory = project('0.1.0', EMPTY_CHANGELOG)
    const decision = await fire(listener, 'npm publish', { cwd: directory, withoutAgent: true })
    expect(decision.kind).toBe('allow')
    expect(state.lastOutcome()).toBeUndefined()
  })

  it('keeps a refusal another gate made and adds its findings to it', async () => {
    const { listener, state } = trigger()
    const directory = project('0.1.0', EMPTY_CHANGELOG)
    const refusal = await fire(listener, 'npm publish', {
      cwd: directory,
      downstream: { kind: 'deny', reason: 'another gate says no' },
    })
    expect(refusal.kind).toBe('deny')
    expect(refusal.kind === 'deny' && refusal.reason).toMatch(/^another gate says no\n/)
    expect(refusal.kind === 'deny' && refusal.reason).toContain(
      t('trigger.pre_release.error.changelog_empty', { version: '0.1.0', section: 'Unreleased' }),
    )
    expect(state.lastOutcome()).toMatchObject({ kind: 'release', ok: false })
  })

  it('reports an abort rather than a finding', async () => {
    const { listener, state } = trigger()
    const directory = project('0.1.0', EMPTY_CHANGELOG)
    const controller = new AbortController()
    controller.abort()
    const decision = await fire(listener, 'npm publish', {
      cwd: directory,
      signal: controller.signal,
    })
    expect(decision).toEqual({ kind: 'cancel' })
    expect(state.lastOutcome()).toBeUndefined()
  })

  it('asks again when there is no channel to put the question through', async () => {
    const { listener } = trigger()
    const directory = project('0.1.0', EMPTY_CHANGELOG)
    const command = 'git tag v0.2.0'

    expect((await fire(listener, command, { cwd: directory })).kind).toBe('ask')
    expect((await fire(listener, command, { cwd: directory })).kind).toBe('ask')
  })

  it('stops asking once the user grants it', async () => {
    const approval = makeApproval()
    approval.answer('allowed-once')
    const { listener } = trigger({ approval })
    const directory = project('0.1.0', EMPTY_CHANGELOG)
    const command = 'git tag v0.2.0'

    expect((await fire(listener, command, { cwd: directory })).kind).toBe('allow')
    expect((await fire(listener, command, { cwd: directory })).kind).toBe('allow')
    expect(approval.asked).toHaveLength(1)
  })

  it('prompts again for a different version in the same session', async () => {
    const { listener } = trigger()
    const directory = project('0.1.0', EMPTY_CHANGELOG)
    expect((await fire(listener, 'git tag v0.2.0', { cwd: directory })).kind).toBe('ask')
    expect((await fire(listener, 'git tag v0.3.0', { cwd: directory })).kind).toBe('ask')
  })

  it('prompts again in a different session', async () => {
    const state = createWorkflowState()
    const { listener } = trigger({ state })
    const directory = project('0.1.0', EMPTY_CHANGELOG)
    const command = 'git tag v0.2.0'

    expect((await fire(listener, command, { cwd: directory, sessionId: 's1' })).kind).toBe('ask')
    expect((await fire(listener, command, { cwd: directory, sessionId: 's2' })).kind).toBe('ask')
  })

  it('reads the changelog section the repository configured', () => {
    // A changelog written in another language names its section differently;
    // the default `[Unreleased]` lookup would report every release as missing it.
    const chinese = ['# Changelog', '', '## [未发布]', '', '### Fixed', '', '- One problem.'].join(
      '\n',
    )
    const configured = Config({ releaseCheck: { unreleased: '未发布' } })
    const rules = releaseRules(configured)

    expect(evaluateRelease({ version: '0.2.0', changelog: chinese }, t).errors).toContain(
      t('trigger.pre_release.error.changelog', { section: 'Unreleased' }),
    )
    expect(evaluateRelease({ version: '0.2.0', changelog: chinese }, t, rules).errors).toEqual([])
  })

  it('accepts the categories the repository configured', () => {
    // `### 修复` is the Chinese spelling of Fixed; a repository keeping its own
    // vocabulary lists it instead of switching the category rule off.
    const chinese = ['# Changelog', '', '## [Unreleased]', '', '### 修复', '', '- 一个问题。'].join(
      '\n',
    )
    const configured = Config({ releaseCheck: { categories: ['修复', '新增'] } })
    const rules = releaseRules(configured)

    const outcome = evaluateRelease({ version: '0.2.0', changelog: chinese }, t)
    expect(outcome.ok).toBe(true)
    expect(outcome.warnings).toContain(
      t('trigger.pre_release.warn.changelog_category', { section: '修复' }),
    )
    expect(evaluateRelease({ version: '0.2.0', changelog: chinese }, t, rules).warnings).toEqual([])
  })

  it('recognises the publishers the repository configured', () => {
    // `cargo publish` is a release the default list has never heard of.
    const publishers = new Set(
      Config({ releaseCheck: { publishers: ['cargo'] } }).releaseCheck.publishers.get(),
    )

    expect(detectRelease('cargo publish')).toBeUndefined()
    expect(detectRelease('cargo publish', publishers)).toEqual({ publishTag: 'latest' })
  })

  it('says out loud that a version bump skipped the checks', async () => {
    // `npm version` writes the manifest, the commit and the tag in one step, so
    // nothing here was judged. The release proceeds — but the user is told, and
    // told in their own language when the prompt also has something to ask.
    const { listener, warnings } = trigger()
    const directory = project('0.2.0', FULL_CHANGELOG)
    const decision = await fire(listener, 'npm version patch', { cwd: directory })

    expect(decision.kind).toBe('allow')
    expect(warnings).toContain(t('trigger.pre_release.warn.version_bump', { kind: 'patch' }))

    const raised = trigger()
    const blocked = await fire(raised.listener, 'npm version patch', {
      cwd: project('0.1.0', EMPTY_CHANGELOG),
    })
    const display = askOf(blocked).displayReason
    const zh = createTranslator('zh-CN')
    expect(display.en).toContain(t('trigger.pre_release.warn.version_bump', { kind: 'patch' }))
    expect(display.zh).toContain(zh('trigger.pre_release.warn.version_bump', { kind: 'patch' }))
  })

  it('checks a release even where there is no changelog to read', async () => {
    // Without a changelog the rules that need one simply do not run; the rules
    // that only need the version still do, so the gate never becomes a no-op.
    const directory = project('0.1.0')
    const { listener } = trigger()
    const decision = await fire(listener, 'git tag v0.2.0', { cwd: directory })
    expect(decision.kind).toBe('ask')
  })
})
