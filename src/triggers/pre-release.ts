import { join } from 'node:path'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Config } from '../config.js'
import type { Translate } from '../i18n.js'
import type { CheckResult } from '../tools/result.js'
import { CHANGELOG_CATEGORIES, PUBLISHERS, SEMVER_PATTERN, UNRELEASED } from '../config.js'
import { fingerprint, summarize } from '../checks.js'
import {
  commandOf,
  quoteCommandWords,
  shellWordIsLiteral,
  subcommandWords,
  wordInvocations,
} from '../shell.js'
import type { CommandWord } from '../shell.js'
import { readText, settleAbout } from './shared.js'
import type { TriggerOptions } from './shared.js'
import { hasShortOption } from '../guard/shared.js'

// The third automatic check: before the agent tags or publishes a release, judge
// the release itself. Publishing is the one operation in this workflow that
// cannot be taken back — npm allows unpublishing for only 72 hours, and a version
// number that reached the registry is spent forever.
//
// As with the other two triggers, there is no release event in the DSH catalogue,
// so the action is recognised by the shell command that performs it (`git tag`,
// `npm publish`).

/** `git tag` options that take a separate value, so it is not the tag name. */
const TAG_VALUE_OPTIONS = new Set(['-m', '--message', '-F', '--file', '-u', '--local-user'])

/** `git tag` invocations that only read tags rather than create one. */
const TAG_READ_ONLY = new Set(['-d', '--delete', '-l', '--list', '-v', '--verify'])

/** Semantic version, pre-release and build metadata included. */
const SEMVER = new RegExp(SEMVER_PATTERN)

/** A version carrying a pre-release suffix, e.g. `0.2.0-rc.1`. */
const PRERELEASE = /^\d+\.\d+\.\d+-/

/** The categories Keep a Changelog defines, lowercased. */
const CATEGORIES = new Set<string>(CHANGELOG_CATEGORIES)

/** Publishers a caller that states none gets: the JavaScript package managers. */
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set<string>(PUBLISHERS)

/** Which release rules apply, and how a version is written. */
export interface ReleaseRules {
  /** The version a tag or manifest must match, as a full-match pattern. */
  readonly version: RegExp
  /** Whether the version is checked at all. */
  readonly versioned: boolean
  /** Require the changelog to carry the release. */
  readonly changelog: boolean
  /** Restrict `###` headings to {@link categories}. */
  readonly changelogCategories: boolean
  /** The `###` headings a section may use, lowercased. */
  readonly categories: ReadonlySet<string>
  /** The `##` heading a release is cut from, lowercased and unbracketed for lookup. */
  readonly unreleased: string
  /** The same heading as the repository writes it, for messages. */
  readonly unreleasedName: string
  /** Block a pre-release published to `latest`. */
  readonly prereleaseTag: boolean
}

/** The rules a caller that states none gets: everything on, semantic versions. */
export const DEFAULT_RELEASE_RULES: ReleaseRules = {
  version: SEMVER,
  versioned: true,
  changelog: true,
  changelogCategories: true,
  categories: CATEGORIES,
  unreleased: UNRELEASED.toLowerCase(),
  unreleasedName: UNRELEASED,
  prereleaseTag: true,
}

/**
 * Read the release rules out of the plugin's configuration.
 *
 * A pattern the user typed that the regular-expression engine rejects falls
 * back to the default rather than throwing inside a gate: a broken setting must
 * not turn every `git tag` into an error the author cannot see.
 * @param config - resolved plugin configuration.
 * @returns the rules the release check applies.
 */
export function releaseRules(config: Config): ReleaseRules {
  // A file-only setting, so it arrives as the plain string the schema resolved
  // rather than as a live reference the panel can change.
  const source = config.releaseCheck.versionPattern
  let version: RegExp
  try {
    version = new RegExp(source)
  } catch {
    version = SEMVER
  }
  const name = config.releaseCheck.unreleased.get()
  return {
    version,
    // Switching the rule off accepts every version rather than deleting the
    // pattern: `semver: false` says "this repository versions some other way",
    // and the check then has nothing to compare against.
    versioned: config.releaseCheck.semver.get(),
    changelog: config.releaseCheck.changelog.get(),
    changelogCategories: config.releaseCheck.changelogCategories.get(),
    categories: new Set(
      config.releaseCheck.categories.get().map((category) => category.toLowerCase()),
    ),
    unreleased: name.toLowerCase().replace(/^\[|\]$/g, ''),
    unreleasedName: name,
    prereleaseTag: config.releaseCheck.prereleaseTag.get(),
  }
}

/** What one release command line does. Omit a field when the line does not. */
export interface ReleaseCommand {
  /** The tag name, when the line creates one. */
  readonly tag?: string
  /**
   * Whether the tag name was literal text. `git tag "v$(cat VERSION)"` is the
   * spelling that made this necessary: the name the check would read is not the
   * name git will create, so the version rules must stand down and say so.
   */
  readonly tagLiteral?: boolean
  /**
   * The dist-tag, when the line publishes. A publish that states none is
   * recorded as the `latest` npm would default to.
   */
  readonly publishTag?: string
  /**
   * The release kind a `npm version <kind>` bumps to, when the line does that.
   *
   * `npm version` is the one command that writes the manifest, commits and tags
   * in a single step, so it is the shortest path to an unreviewed release — and
   * it is neither a `git tag` nor a publish, which is why it used to pass with
   * no check at all.
   */
  readonly versionBump?: string
  /**
   * The workspace directory a `pnpm --filter <name> publish` targets, relative
   * to the session's directory, when the line names one.
   *
   * The version being published is the one in *that* manifest; reading the root
   * `package.json` would compare the tag against an unrelated version.
   */
  readonly filter?: string
}

/** What one release inspection covers. Omit a field to skip its rules. */
export interface ReleaseInput {
  /** The version being released, taken from the tag when there is one. */
  readonly version?: string
  /** The tag name as written, `v` prefix included. */
  readonly tag?: string
  /** Whether the tag name is literal text; omitted means it is. */
  readonly tagLiteral?: boolean
  /** The version recorded in `package.json`, when it could be read. */
  readonly packageVersion?: string
  /** The changelog, when it could be read. */
  readonly changelog?: string
  /** The dist-tag the publish would use. */
  readonly publishTag?: string
  /**
   * The workspace directory a filtered publish targets, when the line names one.
   *
   * With no manifest under it the version rules have nothing to compare against,
   * and the outcome says so rather than reading as a clean release.
   */
  readonly filter?: string
  /** The release kind an `npm version <kind>` bumps to, when the line does that. */
  readonly versionBump?: string
}

/**
 * Read the tag name a `git tag` invocation creates.
 * @param args - the words after `tag`, each saying how it was written.
 * @returns the name and its provenance, or `undefined` when the invocation only
 *   reads tags.
 */
function tagWord(args: readonly CommandWord[]): CommandWord | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]
    const token = word?.value ?? ''
    if (TAG_READ_ONLY.has(token)) return undefined
    if (TAG_VALUE_OPTIONS.has(token)) {
      index += 1
      continue
    }
    if (token.startsWith('-')) continue
    return word
  }
  return undefined
}

/**
 * Options that take a separate value, so the word after one is not the
 * subcommand.
 *
 * `pnpm --filter pkg publish` puts an option and its value in front of
 * `publish`; reading the first word as the subcommand therefore saw `--filter`
 * and reported no release at all. `-r publish` is a recursive publish — it
 * pushes every package in the workspace — and was missed the same way.
 */
const MANAGER_VALUE_OPTIONS = new Set([
  '-C',
  '--dir',
  '-F',
  '--filter',
  '--reporter',
  '--config.confirmModulesPurge',
  '--prefix',
  '--registry',
  '--location',
  '--loglevel',
  '--userconfig',
])

/**
 * The first free word of a package manager invocation.
 *
 * Everything before it is a global option: a flag, or a flag plus the word it
 * consumes. The index is returned rather than the word so the caller can slice
 * the arguments that belong to the subcommand.
 * @param args - the words after the program name.
 * @returns the index of the subcommand, or `undefined` when there is none.
 */
function subcommandIndex(args: readonly string[]): number | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? ''
    if (word === '--') return index + 1
    if (!word.startsWith('-')) return index
    if (MANAGER_VALUE_OPTIONS.has(word)) index += 1
  }
  return undefined
}

/**
 * Read the dist-tag a `publish` invocation states.
 * @param args - the words after `publish`.
 * @returns the dist-tag, or `undefined` when the invocation states none.
 */
function publishTagOf(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? ''
    if (token === '--tag') return args[index + 1]
    if (token.startsWith('--tag=')) return token.slice('--tag='.length)
  }
  return undefined
}

/**
 * Read the workspace a publish targets, when the line states one.
 *
 * `pnpm --filter <name> publish` and `pnpm publish --filter <name>` both reach
 * one workspace package; the name may be a path (`./packages/core`), and it is
 * read as one so the manifest that is compared with the tag is that package's.
 * @param args - the words of the publish invocation, `publish` included.
 * @returns the filter value, or `undefined` when the line names none.
 */
function filterOf(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? ''
    if (token === '--filter' || token === '-F') return args[index + 1]
    if (token.startsWith('--filter=')) return token.slice('--filter='.length)
  }
  return undefined
}

/**
 * Read the release kind a `npm version <kind>` states.
 * @param args - the words after `version`.
 * @returns the kind, or `undefined` when the line only reads the version.
 */
function versionBumpOf(args: readonly string[]): string | undefined {
  const kind = args.find((word) => !word.startsWith('-'))
  return kind === undefined ? undefined : kind
}

/**
 * Recognise the release actions in one shell command.
 *
 * A single line may do both (`git tag v1.0.0 && npm publish`), so the two are
 * collected together rather than the first one winning: the checks that follow
 * need to see the tag *and* the dist-tag to judge the release as a whole.
 *
 * What is deliberately *not* recognised is listed in `docs/TRIGGERS.md` under
 * "what we cannot see": `nx release`, `lerna publish` and `changesets` drive the
 * same registry writes through their own tooling, and guessing at their output
 * would be worse than saying plainly that they are not covered.
 * @param command - a shell command line, as a tool would receive it.
 * @param publishers - programs whose `publish` subcommand uploads to a registry.
 * @returns what the line does, or `undefined` when it releases nothing.
 */
export function detectRelease(
  command: string,
  publishers: ReadonlySet<string> = PACKAGE_MANAGERS,
): ReleaseCommand | undefined {
  let tag: string | undefined
  let tagLiteral = true
  let publishTag: string | undefined
  let versionBump: string | undefined
  let filter: string | undefined

  const words = quoteCommandWords(command)
  const git = wordInvocations(words)

  for (const { program, args } of git) {
    if (program !== 'git' && program !== 'git.exe') continue
    const subcommand = subcommandWords(args)
    if (subcommand === undefined || subcommand.subcommand !== 'tag') continue
    const named = tagWord(subcommand.args)
    if (named !== undefined) {
      tag = named.value
      tagLiteral = shellWordIsLiteral(named)
      break
    }
  }

  for (const { program, args } of git) {
    if (program === 'git' || program === 'git.exe') continue
    if (!publishers.has(program)) continue
    const wordsAfter = args.map((word) => word.value)

    // pnpm and npm both accept global options before the subcommand
    // (`pnpm --filter pkg publish`), so the subcommand is the first free word
    // rather than the first word.
    const start = subcommandIndex(wordsAfter)
    if (start === undefined) continue
    const subcommand = wordsAfter[start]
    const rest = wordsAfter.slice(start + 1)

    if (subcommand === 'version') {
      versionBump = versionBumpOf(rest)
      continue
    }

    if (subcommand !== 'publish') continue
    // `--dry-run` (and its `-n` short form) is the rehearsal `docs/PUBLISHING.md`
    // itself recommends: nothing is uploaded, so nothing is released.
    if (wordsAfter.includes('--dry-run') || hasShortOption(wordsAfter, 'n')) break
    // npm defaults the dist-tag to `latest`, and does not except pre-releases
    // from that default. Recording the default is what makes the pre-release
    // rule below able to fire on a publish that stated nothing.
    publishTag = publishTagOf(rest) ?? 'latest'
    filter = filterOf(wordsAfter)
    break
  }

  if (tag === undefined && publishTag === undefined && versionBump === undefined) return undefined
  return {
    // Only an unreadable tag is worth saying: a literal one is the normal case,
    // and a field that is always present would make every caller assert it.
    ...(tag === undefined ? {} : tagLiteral ? { tag } : { tag, tagLiteral: false }),
    ...(publishTag === undefined ? {} : { publishTag }),
    ...(versionBump === undefined ? {} : { versionBump }),
    ...(filter === undefined ? {} : { filter }),
  }
}

/**
 * Split a changelog into its `##` sections.
 * @param changelog - the changelog text.
 * @returns section body per lowercased section name, e.g. `unreleased`, `0.2.0`.
 */
function sections(changelog: string): Map<string, string> {
  const found = new Map<string, string>()
  let name: string | undefined
  let lines: string[] = []

  const flush = (): void => {
    if (name === undefined) return
    found.set(name, lines.join('\n'))
  }

  for (const line of changelog.split('\n')) {
    // `## [Unreleased]` and `## [0.2.0] - 2026-01-01` both name a section; `###`
    // does not, because the character after `##` is not whitespace.
    const heading = /^##\s+\[?([^\]\s]+)\]?/.exec(line)
    if (heading !== null) {
      flush()
      name = (heading[1] ?? '').toLowerCase()
      lines = []
      continue
    }
    if (name === undefined) continue
    lines.push(line)
  }
  flush()
  return found
}

/**
 * Find the changelog section that records one version.
 *
 * Projects write the heading with or without the tag's `v`, and the version
 * this check holds has already had it stripped — so both spellings are looked
 * up. Without the second form a repository that writes `## v1.0.0 - <date>`
 * would be told on every tag that its release is undocumented.
 * @param released - the changelog's sections, by lowercased heading.
 * @param version - the version to find, `v` prefix already removed.
 * @returns the section body, or `undefined` when the version is not recorded.
 */
function sectionFor(released: Map<string, string>, version: string): string | undefined {
  return released.get(version.toLowerCase()) ?? released.get(`v${version}`.toLowerCase())
}

/**
 * Name the category headings a section body uses.
 * @param body - one `##` section's body.
 * @returns the `###` heading texts, in order.
 */
function categoryHeadings(body: string): string[] {
  return body
    .split('\n')
    .map((line) => /^###\s+(\S.*?)\s*$/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined)
}

/**
 * Read the manifest a `--filter` points at.
 *
 * `pnpm --filter <dir> publish` publishes that workspace package, so the
 * version to compare with the tag is that package's. The filter is used as a
 * path: `./packages/core` and `packages/core` both resolve, which is how the
 * flag is written in a monorepo release script.
 *
 * ponytail: a filter naming a package (`--filter @scope/core`) is not resolved
 * — that needs the workspace manifest and its globs. The warning below still
 * says so. Add the `pnpm-workspace.yaml` lookup when a name filter becomes the
 * normal way this repository releases.
 * @param cwd - the directory the command runs in.
 * @param filter - the `--filter` value.
 * @returns the absolute manifest path, or `undefined`.
 */
function filteredManifest(cwd: string, filter: string): string | undefined {
  const relative = filter.replace(/^\.\//, '')
  if (relative.startsWith('-') || relative === '') return undefined
  return join(cwd, relative, 'package.json')
}

/**
 * Read the `version` field of a `package.json`.
 * @param path - absolute path to the manifest.
 * @returns the version, or `undefined` when it cannot be read.
 */
async function readPackageVersion(path: string): Promise<string | undefined> {
  const text = await readText(path)
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const value: unknown = (parsed as { version?: unknown }).version
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Judge one release against the workflow rules.
 *
 * The changelog rule accepts either place for the entries. Keep a Changelog
 * keeps them under `[Unreleased]` until the moment of release, and the release
 * procedure then moves them into a `[<version>]` section — so at the instant a
 * tag is created, "nothing here" means both are empty, not just the first.
 * @param input - what is known about the release.
 * @param t - translator for every returned line.
 * @param rules - which rules apply, and how a version is written.
 * @returns blocking problems and advisory observations.
 */
export function evaluateRelease(
  input: ReleaseInput,
  t: Translate,
  rules: ReleaseRules = DEFAULT_RELEASE_RULES,
): CheckResult {
  const errors: string[] = []
  const warnings: string[] = []

  // What this inspection could not judge belongs to its outcome: the prompt is
  // rendered once per language, and a note added afterwards would only reach
  // some of the renderings.
  if (input.tagLiteral === false) {
    warnings.push(t('trigger.pre_release.warn.tag_literal'))
  }
  if (input.filter !== undefined && input.packageVersion === undefined) {
    warnings.push(
      t('trigger.pre_release.warn.filter', {
        name: input.filter,
        version: t('trigger.pre_release.warn.filter_unknown'),
      }),
    )
  }
  if (input.versionBump !== undefined) {
    warnings.push(t('trigger.pre_release.warn.version_bump', { kind: input.versionBump }))
  }

  const version = input.version?.replace(/^v/, '')
  if (version !== undefined && rules.versioned && !rules.version.test(version)) {
    errors.push(t('trigger.pre_release.error.version', { version }))
  }

  // The tag and the manifest disagreeing means the published artefact and the
  // tag name different versions — whichever one is wrong, the release is.
  const tagged = input.tag?.replace(/^v/, '')
  if (
    tagged !== undefined &&
    input.packageVersion !== undefined &&
    tagged !== input.packageVersion
  ) {
    errors.push(
      t('trigger.pre_release.error.version_mismatch', {
        tag: tagged,
        version: input.packageVersion,
      }),
    )
  }

  if (
    rules.prereleaseTag &&
    version !== undefined &&
    PRERELEASE.test(version) &&
    input.publishTag === 'latest'
  ) {
    errors.push(t('trigger.pre_release.error.prerelease_tag', { version }))
  }

  if (rules.changelog && input.changelog !== undefined) {
    const released = sections(input.changelog)
    const unreleased = released.get(rules.unreleased)
    if (unreleased === undefined) {
      errors.push(t('trigger.pre_release.error.changelog', { section: rules.unreleasedName }))
    } else {
      // Keep a Changelog calls the groups optional and lets a project add its
      // own, so a repository vocabulary is a preference, not a defect. Blocking
      // on it taught users to switch the rule off and lose it for good; naming
      // the category and releasing is the smaller loss.
      if (rules.changelogCategories) {
        for (const category of categoryHeadings(unreleased)) {
          if (!rules.categories.has(category.toLowerCase())) {
            warnings.push(t('trigger.pre_release.warn.changelog_category', { section: category }))
          }
        }
      }
      const recorded = version === undefined ? undefined : sectionFor(released, version)
      const empty = unreleased.trim().length === 0 && (recorded ?? '').trim().length === 0
      if (empty) {
        errors.push(
          t('trigger.pre_release.error.changelog_empty', {
            version: version ?? rules.unreleasedName,
            section: rules.unreleasedName,
          }),
        )
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

/**
 * Build the `tools/pre-execute` listener for tags and publishes.
 * @param options - configuration, translator, state, and logging.
 * @returns the listener to register on `tools/pre-execute`.
 */
export function createPreReleaseTrigger(
  options: TriggerOptions,
): (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision> {
  return async (exec, next) => {
    // The gates behind this one decide first; a cancelled call is not this
    // check's to settle. Neither its `ask` nor its refusal is a skip: `git tag`
    // and `npm publish` are exactly what the outward guard asks about, so
    // returning early would leave the release rules unread — and under a policy
    // that refuses without asking, that refusal is all the user would hear.
    const downstream = await next()
    if (downstream.kind === 'cancel') return downstream

    const agent = exec.agent
    if (agent === undefined) return downstream
    const command = commandOf(exec.arguments)
    if (command === undefined) return downstream
    const config = options.config()
    // The publishers are configuration, so the recogniser is told which
    // programs to look for rather than assuming the JavaScript ones.
    const release = detectRelease(command, new Set(config.releaseCheck.publishers.get()))
    if (release === undefined) return downstream
    if (exec.signal.aborted) return { kind: 'cancel' }

    const t = options.t()
    const rules = releaseRules(config)
    const cwd = agent.session.header.cwd ?? process.cwd()
    const sessionId = String(agent.session.id)
    options.log(t('trigger.pre_release.detected'))

    // `pnpm --filter <dir> publish` publishes that workspace package, so the
    // manifest it will read the version from is that one, not the root's —
    // comparing a monorepo package's tag against the root version fails every
    // release. A filter that names a package rather than a directory cannot be
    // resolved here, and saying so is better than comparing the wrong file.
    const filtered =
      release.filter === undefined ? undefined : filteredManifest(cwd, release.filter)
    const packageVersion = await readPackageVersion(filtered ?? join(cwd, 'package.json'))
    const changelog = await readText(join(cwd, config.docs.changelog.get()))
    const version = release.tag?.replace(/^v/, '') ?? packageVersion

    const input: ReleaseInput = {
      ...(version === undefined ? {} : { version }),
      ...(release.tag === undefined
        ? {}
        : { tag: release.tag, tagLiteral: release.tagLiteral ?? true }),
      ...(packageVersion === undefined ? {} : { packageVersion }),
      ...(changelog === undefined ? {} : { changelog }),
      ...(release.publishTag === undefined ? {} : { publishTag: release.publishTag }),
      ...(release.filter === undefined ? {} : { filter: release.filter }),
      ...(release.versionBump === undefined ? {} : { versionBump: release.versionBump }),
    }
    const outcome = evaluateRelease(input, t, rules)
    options.state.record({
      kind: 'release',
      ok: outcome.ok,
      summary: summarize(outcome, t),
    })

    // A release the rules advise against but do not block is still a release
    // worth hearing about: the notes are logged where they can be read, and the
    // command proceeds.
    if (outcome.ok) {
      for (const line of outcome.warnings) options.warn(line)
      return downstream
    }

    // The version identifies the release, which is what the state model asks
    // for: a second attempt at releasing the same version is the same problem.
    const target = fingerprint(version ?? command)
    if (options.state.seen(sessionId, 'release', target)) return downstream

    // The findings are rendered again when the prompt opens so a text assembled
    // by the shell is judged by its literal text only, exactly as the first pass
    // did — the same rules, the same outcome.
    return settleAbout(
      downstream,
      {
        reasonKey: 'trigger.pre_release.reason',
        askKey: 'trigger.pre_release.ask',
        detailKey: 'trigger.pre_release.detail',
        settledBy: 'trigger.pre_release.settled_by',
        outcome,
        t,
        assess: (translator) => evaluateRelease(input, translator, rules),
        approval: options.approval,
        exec,
      },
      () => options.state.remember(sessionId, 'release', target),
    )
  }
}
