import { describe, expect, it } from 'vitest'
import { COMMIT_TYPES, Config, SUBJECT_MAX_LENGTH } from '../src/config.js'
import { plain } from './harness.js'

// The configuration surface: every default the plugin documents, and the
// validation the host performs before `apply` ever runs.

describe('src/config.ts', () => {
  it('resolves an empty configuration to the documented safe baseline', () => {
    const config = Config({})

    expect(plain(config.mode)).toBe('on')
    expect(plain(config.locale)).toBe('auto')
    expect(plain(config.enableOwnTrigger)).toBe(true)
    expect(plain(config.rules.requireChangelogOnFeat)).toBe(true)
    expect(plain(config.codePaths)).toEqual(['src/'])
  })

  it('defaults every destructive git operation to ask', () => {
    const config = Config({})

    expect(plain(config.gitGuard)).toEqual({
      enabled: true,
      forcePush: 'ask',
      hardReset: 'ask',
      rebase: 'ask',
      amend: 'ask',
      branchDelete: 'ask',
      cleanForce: 'ask',
      checkoutDiscard: 'ask',
      noVerify: 'ask',
      rememberApproved: false,
    })
  })

  it('gives each guard field its own default instead of sharing one', () => {
    // A shared schema instance would leak the first resolved value into every
    // other field; `guardAction()` is a factory precisely to prevent that.
    const config = Config({ gitGuard: { forcePush: 'deny' } })

    expect(plain(config.gitGuard.forcePush)).toBe('deny')
    expect(plain(config.gitGuard.hardReset)).toBe('ask')
    expect(plain(config.gitGuard.noVerify)).toBe('ask')
  })

  it('accepts all three policy values for a guard operation', () => {
    for (const action of ['deny', 'ask', 'allow'] as const) {
      expect(plain(Config({ gitGuard: { rebase: action } }).gitGuard.rebase)).toBe(action)
    }
  })

  it('defaults every outward-facing action to ask', () => {
    // Nothing here is unrecoverable on this machine, so there is no `deny`
    // default to weigh against: the question is consent, and the answer is to
    // ask. `enabled` is on so a fresh profile is covered without configuration.
    const config = Config({})

    expect(plain(config.outwardGuard)).toEqual({
      enabled: true,
      push: 'ask',
      tag: 'ask',
      pullRequest: 'ask',
      issue: 'ask',
      publish: 'ask',
    })
  })

  it('gives each outward field its own default instead of sharing one', () => {
    const config = Config({ outwardGuard: { push: 'deny' } })

    expect(plain(config.outwardGuard.push)).toBe('deny')
    expect(plain(config.outwardGuard.publish)).toBe('ask')
  })

  it('defaults every non-git guard to a safe, enabled baseline', () => {
    const config = Config({})

    expect(plain(config.commandGuard)).toEqual({ enabled: true, dangerousShell: 'ask' })
    expect(plain(config.fileGuard)).toEqual({
      enabled: true,
      noRead: [
        '.env',
        '.ssh/id_rsa',
        '*.pem',
        '*.key',
        'credentials/',
        '*.p12',
        '.npmrc',
        'secrets/',
      ],
    })
    // The high-entropy heuristic is the one rule that flags ordinary text, so it
    // is the one rule that ships off.
    expect(plain(config.secretGuard)).toEqual({ enabled: true, genericHighEntropy: false })
    expect(plain(config.audit)).toEqual({ enabled: true, path: '.dev-docs/audit-log.jsonl' })
  })

  it("defaults the check and documentation switches to today's behaviour", () => {
    const config = Config({})

    expect(plain(config.docsCheck)).toEqual({ enabled: true, requireReadmeOnConfig: false })
    expect(plain(config.commitCheck)).toEqual({
      enabled: true,
      onFailure: 'block',
      types: [...COMMIT_TYPES],
      requireScope: false,
      subjectMaxLength: SUBJECT_MAX_LENGTH,
    })
    expect(plain(config.docs.exclude)).toEqual([])
  })

  it('keeps the command policy out of the git guard and vice versa', () => {
    const config = Config({
      commandGuard: { dangerousShell: 'deny' },
      fileGuard: { noRead: ['*.vault'] },
    })

    expect(plain(config.commandGuard.dangerousShell)).toBe('deny')
    expect(plain(config.gitGuard.forcePush)).toBe('ask')
    expect(plain(config.fileGuard.noRead)).toEqual(['*.vault'])
  })

  it('defaults the document layout to this repository', () => {
    const config = Config({})

    expect(plain(config.docs.readme)).toEqual(['README.md', 'README.zh.md'])
    expect(plain(config.docs.changelog)).toBe('CHANGELOG.md')
    expect(plain(config.docs.docsDir)).toBe('docs/')
    expect(plain(config.docs.mirrors)).toEqual([
      ['README.md', 'README.zh.md'],
      ['locale/en.json', 'locale/zh.json'],
      ['skills/dsh-dev-workflow/SKILL.md', 'skills/dsh-dev-workflow/SKILL.zh.md'],
    ])
  })

  it('keeps the commit type list the checks agree on', () => {
    expect(COMMIT_TYPES).toHaveLength(11)
    expect(SUBJECT_MAX_LENGTH).toBe(50)
  })

  it('rejects a mode outside on and off', () => {
    expect(() => Config({ mode: 'maybe' } as never)).toThrowError(
      '$.mode expected "on" | "off" but got "maybe"',
    )
  })

  it('rejects a locale it ships no dictionary for', () => {
    expect(() => Config({ locale: 'fr' } as never)).toThrowError(
      '$.locale expected "auto" | "en-US" | "zh-CN" but got "fr"',
    )
  })

  it('rejects an unknown guard policy', () => {
    expect(() => Config({ gitGuard: { forcePush: 'yes' } } as never)).toThrowError(
      '$.gitGuard.forcePush expected "deny" | "ask" | "allow" but got "yes"',
    )
  })

  it('rejects a commit type list that is not a list of strings', () => {
    expect(() => Config({ commitCheck: { types: 'feat,fix' } } as never)).toThrowError(
      '$.commitCheck.types expected array but got feat,fix',
    )
  })

  it('keeps an explicit value and fills the rest with defaults', () => {
    const config = Config({
      mode: 'off',
      locale: 'zh-CN',
      enableOwnTrigger: false,
      codePaths: ['packages/'],
    })

    expect(plain(config.mode)).toBe('off')
    expect(plain(config.locale)).toBe('zh-CN')
    expect(plain(config.enableOwnTrigger)).toBe(false)
    expect(plain(config.codePaths)).toEqual(['packages/'])
    expect(plain(config.gitGuard.enabled)).toBe(true)
  })
})
