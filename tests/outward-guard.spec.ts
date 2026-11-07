import { describe, expect, it } from 'vitest'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { Config } from '../src/config.js'
import { createTranslator } from '../src/i18n.js'
import { createWorkflowState } from '../src/state.js'
import { createOutwardGuard, detectOutward } from '../src/guard/outward-guard.js'
import { allow, makeExec } from './harness.js'

const t = createTranslator('en-US')

/**
 * Classify one command the way the live gate does.
 * @param command - the shell command line.
 * @param guard - `outwardGuard` configuration overrides.
 * @returns the reason and action of the strictest hit, or `undefined`.
 */
function classify(command: string, guard: Record<string, unknown> = {}) {
  const hit = detectOutward(command, Config({ outwardGuard: guard }))
  return hit === undefined ? undefined : { reason: hit.reason, action: hit.action }
}

/**
 * Run one command through the listener and report the decision it settles on.
 * @param command - the shell command line.
 * @param options - configuration overrides and a downstream decision to model.
 * @returns the decision, plus the guard tally it produced.
 */
async function run(
  command: string,
  options: {
    guard?: Record<string, unknown>
    downstream?: PreToolDecision
    state?: ReturnType<typeof createWorkflowState>
  } = {},
) {
  const state = options.state ?? createWorkflowState()
  const controller = new AbortController()
  const guard = createOutwardGuard({
    config: () => Config({ outwardGuard: options.guard ?? {} }),
    t: () => t,
    state,
    log: () => {},
  })
  const decision = await guard(
    makeExec(command, { signal: controller.signal }),
    async () => options.downstream ?? (await allow()),
  )
  return { decision, state }
}

describe('src/guard/outward-guard.ts', () => {
  it('asks about any push, not only a forced one', () => {
    // The git guard owns the forced push. What is new here is that the ordinary
    // push — the one that publishes a branch under the user's name — is gated too.
    expect(classify('git push origin main')).toMatchObject({
      reason: 'security.guard.outward_push',
      action: 'ask',
    })
    expect(classify('git push')).toMatchObject({ reason: 'security.guard.outward_push' })
    expect(classify('git push --force origin main')).toMatchObject({
      reason: 'security.guard.outward_push',
    })
    expect(classify('git push --tags origin main')).toMatchObject({
      reason: 'security.guard.outward_push',
    })
  })

  it('leaves a rehearsal push alone', () => {
    // `--dry-run` reaches no remote, so there is nothing for the user to agree to.
    expect(classify('git push --dry-run origin main')).toBeUndefined()
    expect(classify('git push -n origin main')).toBeUndefined()
  })

  it('asks about a tag that is created and not about one that is read', () => {
    expect(classify('git tag v1.0.0')).toMatchObject({
      reason: 'security.guard.outward_tag',
      action: 'ask',
    })
    expect(classify('git tag -a v1.0.0 -m release')).toMatchObject({
      reason: 'security.guard.outward_tag',
    })
    expect(classify('git tag --list')).toBeUndefined()
    expect(classify('git tag -l v1.*')).toBeUndefined()
    expect(classify('git tag -d v1.0.0')).toBeUndefined()
  })

  it('asks about a pull request that is opened and not about one that is listed', () => {
    expect(classify('gh pr create --title x --body y')).toMatchObject({
      reason: 'security.guard.outward_pull_request',
      action: 'ask',
    })
    expect(classify('gh pr create --body-file notes.md')).toMatchObject({
      reason: 'security.guard.outward_pull_request',
    })
    expect(classify('gh pr list')).toBeUndefined()
    expect(classify('gh pr view 21')).toBeUndefined()
  })

  it('asks about an issue that is filed and not about one that is read', () => {
    expect(classify('gh issue create --title x --body y')).toMatchObject({
      reason: 'security.guard.outward_issue',
      action: 'ask',
    })
    expect(classify('gh issue create --body-file notes.md')).toMatchObject({
      reason: 'security.guard.outward_issue',
    })
    // Every verb but the reading ones writes to a tracker other people read, so
    // the gate follows the verb rather than listing the writes it knows.
    expect(classify('gh issue comment 3 --body x')).toMatchObject({
      reason: 'security.guard.outward_issue',
    })
    expect(classify('gh issue close 3')).toMatchObject({ reason: 'security.guard.outward_issue' })
    expect(classify('gh issue list')).toBeUndefined()
    expect(classify('gh issue view 3')).toBeUndefined()
    expect(classify('gh issue status')).toBeUndefined()
    // Asking gh for help reads the manual, not a tracker.
    expect(classify('gh issue --help')).toBeUndefined()
    expect(classify('gh issue')).toBeUndefined()
  })

  it('asks about a publish and not about a rehearsal or an install', () => {
    expect(classify('npm publish')).toMatchObject({
      reason: 'security.guard.outward_publish',
      action: 'ask',
    })
    expect(classify('pnpm publish --tag next')).toMatchObject({
      reason: 'security.guard.outward_publish',
    })
    expect(classify('npm publish --dry-run')).toBeUndefined()
    expect(classify('npm install')).toBeUndefined()
  })

  it('sees the action through a wrapper in front of it', () => {
    expect(classify('sudo git push origin main')).toMatchObject({
      reason: 'security.guard.outward_push',
    })
    expect(classify('npx npm publish')).toMatchObject({
      reason: 'security.guard.outward_publish',
    })
  })

  it('keeps the first action on a tie, so a combined line reports what happens first', () => {
    // `strictest()` keeps the first on a tie, and the recognisers run in the order
    // of the sentence: the push is reported, the publish is not — but both are
    // still gated, because the answer is the same question either way.
    expect(classify('git push origin main && npm publish')).toMatchObject({
      reason: 'security.guard.outward_push',
    })
  })

  it('reports nothing at all when the guard is switched off', () => {
    expect(classify('git push origin main', { enabled: false })).toBeUndefined()
    expect(classify('npm publish', { enabled: false })).toBeUndefined()
  })

  it('honours a stricter policy than ask', async () => {
    const { decision } = await run('git push origin main', { guard: { push: 'deny' } })
    expect(decision.kind).toBe('deny')
    expect((decision as { reason: string }).reason).toBe(t('security.guard.outward_push'))
  })

  it('asks in both client languages by default', async () => {
    const { decision } = await run('gh pr create --title x --body y')
    expect(decision).toMatchObject({
      kind: 'ask',
      reason: t('security.guard.outward_pull_request'),
      displayReason: {
        en: createTranslator('en-US')('security.guard.outward_pull_request'),
        zh: createTranslator('zh-CN')('security.guard.outward_pull_request'),
      },
    })
  })

  it('stands down when the policy is allow', async () => {
    const { decision, state } = await run('git push origin main', { guard: { push: 'allow' } })
    expect(decision.kind).toBe('allow')
    // Counted all the same: the tally records what the guard recognised, not
    // what it decided to do about it.
    expect(state.guardHits()).toEqual({ 'security.guard.outward_push': 1 })
  })

  it('never weakens a refusal by another gate into a question', async () => {
    const { decision } = await run('git push origin main', {
      downstream: { kind: 'deny', reason: 'refused elsewhere' },
    })
    expect(decision).toEqual({ kind: 'deny', reason: 'refused elsewhere' })
  })

  it('counts the hit it saw even before the decision is settled', async () => {
    const { state } = await run('npm publish')
    expect(state.guardHits()).toEqual({ 'security.guard.outward_publish': 1 })
  })
})
