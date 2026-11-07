import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COMMIT_TYPES, Config } from '../src/config.js'
import { createFormScope, loadPanel, volatilePaths } from './harness.js'

// The browser half is only correct relative to the Host half: the same
// namespace, controls on paths the schema actually exposes, and values the
// schema accepts. These are the checks that catch a renamed field, a control
// wired to a value the host would reject, or a leaf the panel silently drops.

interface SchemaNode {
  readonly type: string
  readonly dict?: Record<string, SchemaNode>
  readonly meta?: { readonly volatile?: boolean }
}

// Schemastery schemas are callable branches; resolve by walking `dict`, and use
// the call itself to ask the schema whether a value is acceptable.
const schema = Config as unknown as SchemaNode
const nodeAt = (path: readonly string[]): SchemaNode =>
  path.reduce<SchemaNode>((node, key) => node.dict?.[key] as SchemaNode, schema)
const accepts = (path: readonly string[], value: unknown): boolean => {
  try {
    ;(nodeAt(path) as unknown as (value: unknown) => unknown)(value)
    return true
  } catch {
    return false
  }
}

const keyOf = (path: readonly string[]): string => path.join('.')
const { description, namespaces } = await loadPanel(createFormScope(Config({})))

/** Every item the plan's second step lists as "must be configurable". */
const REQUIRED = [
  'mode',
  'scope',
  'locale',
  'enableOwnTrigger',
  'commitCheck.enabled',
  'commitCheck.onFailure',
  'commitCheck.types',
  'commitCheck.requireScope',
  'commitCheck.subjectMaxLength',
  'docsCheck.enabled',
  'rules.requireChangelogOnFeat',
  'docsCheck.requireReadmeOnConfig',
  'releaseCheck.semver',
  'releaseCheck.changelog',
  'releaseCheck.changelogCategories',
  'releaseCheck.prereleaseTag',
  'gitGuard.enabled',
  'gitGuard.forcePush',
  'gitGuard.hardReset',
  'gitGuard.rebase',
  'gitGuard.amend',
  'gitGuard.branchDelete',
  'gitGuard.cleanForce',
  'gitGuard.checkoutDiscard',
  'gitGuard.noVerify',
  'gitGuard.rememberApproved',
  'outwardGuard.enabled',
  'outwardGuard.push',
  'outwardGuard.tag',
  'outwardGuard.pullRequest',
  'outwardGuard.issue',
  'outwardGuard.publish',
  'commandGuard.enabled',
  'commandGuard.dangerousShell',
  'fileGuard.enabled',
  'secretGuard.enabled',
  'secretGuard.genericHighEntropy',
  'audit.enabled',
]

/** The read-only view of the values the profile file owns. */
const READONLY = [
  'codePaths',
  'docs.docsDir',
  'docs.changelog',
  'docs.exclude',
  'releaseCheck.versionPattern',
  'docs.mirrors',
  'audit.path',
]

// File-only on purpose: the plan keeps them out of the panel. Naming them here
// means a new volatile leaf fails the coverage check instead of slipping by.
const FILE_ONLY = [
  'docs.readme',
  'fileGuard.noRead',
  'prSections',
  'releaseCheck.categories',
  'releaseCheck.unreleased',
  'releaseCheck.publishers',
]

describe('client.js schema agreement', () => {
  it('pairs with the Loader entry the bundle patch installs', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

    expect(description.namespace).toBe('dsh-dev-workflow')
    expect(patch).toContain(`id: ${description.namespace}`)
    expect(namespaces).toEqual([description.namespace])
  })

  it('offers one control for every required item and nothing else', () => {
    const offered = description.fields.map((field) => keyOf(field.path))

    expect(offered.toSorted()).toEqual(REQUIRED.toSorted())
  })

  it('controls only leaves the host declares volatile', () => {
    const volatile = new Set(volatilePaths(Config).map(keyOf))
    // The pattern fields are shown for reference rather than edited: a regular
    // expression is a configuration-file setting, like the branch and commit
    // patterns beside it, so the panel renders them without committing a value.
    const readonly = new Set(READONLY)
    const controlled = [
      ...description.fields.map((field) => keyOf(field.path)),
      ...description.advanced.map((entry) => keyOf(entry.path)),
    ]

    expect(controlled.filter((path) => !volatile.has(path) && !readonly.has(path))).toEqual([])
  })

  it('covers every volatile leaf except the file-only ones', () => {
    const volatile = volatilePaths(Config).map(keyOf)
    const controlled = new Set([
      ...description.fields.map((field) => keyOf(field.path)),
      ...description.advanced.map((entry) => keyOf(entry.path)),
    ])

    expect(volatile.filter((path) => !controlled.has(path)).toSorted()).toEqual(
      FILE_ONLY.toSorted(),
    )
  })

  it('sends every control a value the host schema accepts', () => {
    for (const field of description.fields) {
      const path = keyOf(field.path)
      if (field.control === 'switch') {
        expect(accepts(field.path, field.on ?? true), `${path} on`).toBe(true)
        expect(accepts(field.path, field.off ?? false), `${path} off`).toBe(true)
      } else if (field.control === 'segments') {
        expect(field.options?.length ?? 0).toBeGreaterThan(0)
        for (const option of field.options ?? []) {
          const value = typeof option === 'string' ? option : option.value
          expect(accepts(field.path, value), `${path} = ${value}`).toBe(true)
        }
      } else if (field.control === 'checks') {
        expect(accepts(field.path, [...COMMIT_TYPES]), path).toBe(true)
      } else if (field.control === 'number') {
        // The number field stages what the schema's minimum and step allow, and
        // its validator rejects exactly what the schema rejects.
        expect(accepts(field.path, 72), path).toBe(true)
        expect(accepts(field.path, 0), path).toBe(false)
        expect(accepts(field.path, 1.5), path).toBe(false)
      } else {
        throw new Error(`unknown control ${field.control} on ${path}`)
      }
    }
  })

  it('lists the commit types the host defaults to', () => {
    expect(description.commitTypes).toEqual([...COMMIT_TYPES])
    expect(new Set(description.commitTypes).size).toBe(COMMIT_TYPES.length)
  })

  it('gives all eight git policies the same three actions', () => {
    expect([...description.gitPolicies].toSorted()).toEqual([
      'amend',
      'branchDelete',
      'checkoutDiscard',
      'cleanForce',
      'forcePush',
      'hardReset',
      'noVerify',
      'rebase',
    ])

    for (const policy of description.gitPolicies) {
      const field = description.fields.find((entry) => keyOf(entry.path) === `gitGuard.${policy}`)
      const values = (field?.options ?? []).map((option) =>
        typeof option === 'string' ? option : option.value,
      )
      expect(values.toSorted()).toEqual(['allow', 'ask', 'deny'])
    }
  })

  it('gives all five outward actions the same three policies', () => {
    const outward = REQUIRED.filter((key) => key.startsWith('outwardGuard.')).filter(
      (key) => key !== 'outwardGuard.enabled',
    )
    expect(outward).toHaveLength(5)

    for (const key of outward) {
      const field = description.fields.find((entry) => keyOf(entry.path) === key)
      const values = (field?.options ?? []).map((option) =>
        typeof option === 'string' ? option : option.value,
      )
      expect(values.toSorted()).toEqual(['allow', 'ask', 'deny'])
    }
  })

  it('opens the working groups and collapses the advanced one', () => {
    const collapsed = description.groups.filter((group) => group.open !== true)

    expect(description.groups).toHaveLength(9)
    expect(collapsed.map((group) => group.key)).toEqual(['advanced'])

    // Read-only entries live in the collapsed group and nowhere else.
    const groups = new Set(description.fields.map((field) => field.group))
    expect(groups.has('advanced')).toBe(false)
    expect(description.advanced.map((entry) => entry.label).every(Boolean)).toBe(true)
    for (const path of READONLY) {
      expect(description.advanced.some((entry) => keyOf(entry.path) === path)).toBe(true)
    }
  })

  it('marks no field as not in effect', () => {
    // Every row the panel shows is now read by something. The query stays so a
    // field that goes stale again gets caught here instead of shipping a claim
    // the panel makes by omission.
    const marked = description.advanced
      .filter((entry) => entry.inactive === true)
      .map((entry) => keyOf(entry.path))

    expect(marked).toEqual([])
    expect(description.advanced.length).toBeGreaterThan(0)
  })

  it('ships both locales with the same keys', () => {
    expect(Object.keys(description.dictionaries.zh).toSorted()).toEqual(
      Object.keys(description.dictionaries.en).toSorted(),
    )
    expect(Object.keys(description.dictionaries.en).length).toBeGreaterThan(40)
  })

  it('carries the same placeholders in both panel languages', () => {
    // The panel dictionary is a second translation surface with its own file
    // conventions, so it gets the same check the locale dictionaries get: a
    // translation that drops `{path}` renders a sentence with the value missing,
    // and a matching key set would not notice.
    const placeholders = (template: string): string[] =>
      (template.match(/\{(\w+)\}/g) ?? []).map((match) => match.slice(1, -1)).sort()
    for (const [key, template] of Object.entries(description.dictionaries.en)) {
      expect(placeholders(description.dictionaries.zh[key] ?? ''), key).toEqual(
        placeholders(template),
      )
    }
  })
})
