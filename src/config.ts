import z from '@deepseek-ai/schemastery'

// The plugin reads its own configuration from the DSH profile. This file is the
// single declaration of that surface: every field carries a default, so an empty
// configuration resolves to the documented safe baseline (plugin on, destructive
// git operations ask, nothing allowed implicitly).
//
// Every leaf is also `.volatile()`. That marker is what the settings panel reads:
// the Host only offers the fields declared volatile, and the Loader commits a
// change to one of them into the running references without restarting the
// plugin. A leaf without it still configures the plugin from the profile file,
// but is invisible in the panel. Containers stay plain: the panel rebuilds a
// form from the volatile leaves it finds under them.

/** Commit types from the specification, in the order it lists them. */
export const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const

/** Subject length the specification asks for. */
export const SUBJECT_MAX_LENGTH = 50

/**
 * Sections the specification's pull request template asks for, in template
 * order. Every one of them must carry something: the four below the first three
 * exist to make the author answer a question a reviewer would otherwise have to
 * ask, and "none" is a valid answer to each.
 *
 * A repository whose template names them differently, or asks for fewer,
 * overrides the list; the names are a property of the template, not of the
 * workflow.
 */
export const PR_SECTIONS = [
  'What',
  'Why',
  'How to verify',
  'Type of change',
  'Non-goals',
  'Risk and rollback',
  'Checklist',
] as const

/**
 * Programs whose `publish` subcommand uploads to a registry.
 *
 * A repository releasing through something else — `cargo publish`,
 * `poetry publish`, `mvn deploy` — names it here; otherwise the release check
 * never sees the command and says nothing about a release that happened.
 */
export const PUBLISHERS = [
  'npm',
  'npm.exe',
  'pnpm',
  'pnpm.exe',
  'yarn',
  'yarn.exe',
  'bun',
  'bun.exe',
] as const

/** The changelog section a release is cut from, by its default name. */
export const UNRELEASED = 'Unreleased'

/**
 * The categories Keep a Changelog defines, lowercased. A repository that keeps
 * its own headings overrides the list rather than switching the rule off.
 */
export const CHANGELOG_CATEGORIES = [
  'added',
  'changed',
  'deprecated',
  'removed',
  'fixed',
  'security',
] as const

/**
 * Files whose change normally implies a README update. Used by
 * `docsCheck.requireReadmeOnConfig`.
 */
export const CONFIG_FILES = ['package.json', 'cordis.patch.yml'] as const

/**
 * Semantic version, pre-release and build metadata included, as a full match.
 * Exported so the release check compiles exactly the pattern the schema
 * defaults to — a repository that narrows it narrows the check with it.
 */
export const SEMVER_PATTERN = String.raw`^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`

/**
 * One destructive-git policy value.
 *
 * `deny` blocks the call, `ask` routes it through the approval prompt, and
 * `allow` lets it run untouched. A factory rather than a shared instance: the
 * schema builder is reused for every policy field and must not share resolved
 * state.
 * @returns a fresh policy schema defaulting to `ask`.
 */
const guardAction = () => z.union(['deny', 'ask', 'allow']).default('ask').volatile()

/** Plugin configuration schema, validated by DSH before {@link apply} runs. */
export const Config = z.object({
  /** Prefixes that count as "code" when deciding whether a document is stale. */
  codePaths: z.array(z.string()).default(['src/']).volatile(),
  /** Where this repository keeps the documents a change is expected to update. */
  docs: z
    .object({
      readme: z.array(z.string()).default(['README.md', 'README.zh.md']).volatile(),
      changelog: z.string().default('CHANGELOG.md').volatile(),
      docsDir: z.string().default('docs/').volatile(),
      /**
       * Files that must change together, listed as one group per line. The
       * repository keeps several such pairs; leaving them in configuration
       * keeps every path out of the check itself.
       */
      mirrors: z
        .array(z.array(z.string()))
        .default([
          ['README.md', 'README.zh.md'],
          ['locale/en.json', 'locale/zh.json'],
          ['skills/dsh-dev-workflow/SKILL.md', 'skills/dsh-dev-workflow/SKILL.zh.md'],
        ])
        .volatile(),
      /**
       * Path prefixes that do not count as a code change even when they sit
       * under {@link codePaths}, so documenting-only trees can opt out of the
       * "code changed, document missing" warning.
       */
      exclude: z.array(z.string()).default([]).volatile(),
    })
    .default({}),
  /** Whether the documentation rules take part in {@link evaluate}. */
  docsCheck: z
    .object({
      /**
       * Turns the documentation rules of the pre-commit evaluation off. The
       * `check_doc_sync` tool is an explicit call and stays available.
       */
      enabled: z.boolean().default(true).volatile(),
      /**
       * Warn when a configuration file changes without a README update. Off by
       * default: the README is not the changelog, and most dependency bumps
       * touch `package.json` without deserving a documentation line.
       */
      requireReadmeOnConfig: z.boolean().default(false).volatile(),
    })
    .default({}),
  /** Mechanical conventions the checks compare a change against. */
  rules: z
    .object({
      requireChangelogOnFeat: z.boolean().default(true).volatile(),
    })
    .default({}),
  /** Whether the commit-message rules take part in {@link evaluate}. */
  commitCheck: z
    .object({
      /** Turns the commit-message rules of the pre-commit evaluation off. */
      enabled: z.boolean().default(true).volatile(),
      /**
       * What a hard commit-message problem does. `warn` demotes the errors to
       * warnings; `block` keeps them blocking. The advisory rules (subject
       * length, trailing period, missing scope) are warnings either way.
       */
      onFailure: z.union(['warn', 'block']).default('block').volatile(),
      /**
       * Types the header may open with. Defaults to {@link COMMIT_TYPES}; a
       * repository that narrowed its convention can say so here.
       */
      types: z
        .array(z.string())
        .default([...COMMIT_TYPES])
        .volatile(),
      /**
       * Require a scope on every header. Off by default, where a missing scope
       * is only an advisory warning when the change touches one module.
       */
      requireScope: z.boolean().default(false).volatile(),
      /** Maximum subject length, measured from the text after `type: `. */
      subjectMaxLength: z.number().step(1).min(1).default(SUBJECT_MAX_LENGTH).volatile(),
    })
    .default({}),
  /**
   * The `##` sections a pull request description must fill in.
   *
   * Defaults to the specification's template ({@link PR_SECTIONS}). A
   * repository whose own `.github/pull_request_template.md` names the sections
   * differently — in another language, or with different headings — lists them
   * here; otherwise every one of its pull requests is told it is missing
   * sections its template never asked for.
   *
   * File-only: the settings panel has no text control, so this is declared in
   * the profile file rather than rendered as a field. Order matters only for
   * the order the missing names are reported in.
   */
  prSections: z
    .array(z.string())
    .default([...PR_SECTIONS])
    .volatile(),
  /** Which release rules the pre-release check applies. */
  releaseCheck: z
    .object({
      /**
       * Require a `MAJOR.MINOR.PATCH` version. A repository that versions by
       * date or by build number turns this off rather than silencing the whole
       * check.
       */
      semver: z.boolean().default(true).volatile(),
      /** Require the changelog to carry the release, or a non-empty `[Unreleased]`. */
      changelog: z.boolean().default(true).volatile(),
      /**
       * Note `###` headings that are not in `releaseCheck.categories`. Advisory,
       * never blocking: Keep a Changelog calls the groups optional and lets a
       * project add its own. Off silences the note.
       */
      changelogCategories: z.boolean().default(true).volatile(),
      /**
       * The `###` headings a changelog section may use. The default is the six
       * Keep a Changelog names; a repository with its own vocabulary — `###
       * Internal`, `### 修复` — lists them here instead of switching the rule
       * off. Matched case-insensitively.
       *
       * File-only: the settings panel has no text control.
       */
      categories: z
        .array(z.string())
        .default([...CHANGELOG_CATEGORIES])
        .volatile(),
      /**
       * The changelog heading a release is cut from. The default is
       * `[Unreleased]`; a repository that names it otherwise — `## 未发布`,
       * `## Next` — says so here. Matched case-insensitively, with or without
       * the square brackets.
       *
       * File-only: the settings panel has no text control.
       */
      unreleased: z.string().default(UNRELEASED).volatile(),
      /**
       * Programs whose `publish` subcommand uploads to a registry. The default
       * is the JavaScript package managers; a repository releasing with
       * `cargo`, `poetry`, `mvn`, or a private tool names it here.
       *
       * File-only: the settings panel has no text control.
       */
      publishers: z
        .array(z.string())
        .default([...PUBLISHERS])
        .volatile(),
      /** Block a pre-release published to `latest` instead of a `next`-style tag. */
      prereleaseTag: z.boolean().default(true).volatile(),
      /**
       * How a version is written: the pattern the tag and the manifest are
       * checked against, as a full-match regular expression. The default is
       * `MAJOR.MINOR.PATCH` with optional pre-release and build metadata; a
       * repository that versions by date or build number says so here.
       *
       * Not volatile: this writes the rule the release check compiles, so it
       * belongs to the file the team agrees on rather than to a live control.
       */
      versionPattern: z.string().default(SEMVER_PATTERN),
    })
    .default({}),
  /** Master switch. `off` registers nothing, so the plugin costs no tokens. */
  mode: z.union(['on', 'off']).default('on').volatile(),
  /**
   * Which working directories the plugin applies to.
   *
   * `all` is what a profile-wide install has always done: every working
   * directory is checked. `marked` restricts it to a repository whose project
   * root carries `.dsh/dev-workflow.yml`, so one profile can serve repositories
   * that want the rules and repositories that do not.
   *
   * The default stays `all`: making `marked` the default would silently stop
   * checking every repository that has not created a marker yet, which is a
   * security relaxation disguised as a default.
   */
  scope: z.union(['all', 'marked']).default('all').volatile(),
  /** Dictionary to translate user-visible text with. `auto` follows the runtime locale. */
  locale: z.union(['auto', 'en-US', 'zh-CN']).default('auto').volatile(),
  /**
   * Whether this plugin runs its own pre-commit check. Turn it off when the
   * repository already enforces the same rules with husky and commitlint.
   */
  enableOwnTrigger: z.boolean().default(true).volatile(),
  /** Policies for git operations that can discard work. */
  gitGuard: z
    .object({
      enabled: z.boolean().default(true).volatile(),
      forcePush: guardAction(),
      hardReset: guardAction(),
      rebase: guardAction(),
      amend: guardAction(),
      branchDelete: guardAction(),
      /**
       * `git clean -f` deletes untracked files. It has its own policy rather
       * than borrowing the hard-reset one: they discard different things.
       */
      cleanForce: guardAction(),
      /** `git checkout -- .` discards unstaged edits. */
      checkoutDiscard: guardAction(),
      /**
       * `--no-verify` skips the hooks that protect the repository. It defaults
       * to `ask` and never to `deny`: it is the escape hatch for the moment
       * hooks are wrong, and closing it would leave no way through.
       */
      noVerify: guardAction(),
      /**
       * Answer `ask` from the session's own history: once an operation was
       * approved, the same operation is not asked about again. Off by default,
       * because one approval is not consent for the rest of the session. Only
       * `ask` is affected; `deny` always blocks.
       */
      rememberApproved: z.boolean().default(false).volatile(),
    })
    .default({}),
  /**
   * Policies for actions other people can see: a push, a tag, a pull request, an
   * issue, a publish. Unlike the guards below, nothing here is unrecoverable on this
   * machine — the risk is announcing work the user has not agreed to yet, so the
   * point is consent rather than obstruction.
   */
  outwardGuard: z
    .object({
      enabled: z.boolean().default(true).volatile(),
      /**
       * Any `git push`, not only a forced one. A forced push is a separate,
       * stricter problem and stays with `gitGuard.forcePush`.
       */
      push: guardAction(),
      /** `git tag <name>`, which creates the tag rather than reading tags. */
      tag: guardAction(),
      /** `gh pr create`, which asks other people to look at the branch. */
      pullRequest: guardAction(),
      /** `gh issue create` and the other verbs that write to the tracker. */
      issue: guardAction(),
      /** `npm publish` / `pnpm publish`, which cannot be taken back. */
      publish: guardAction(),
    })
    .default({}),
  /** Policies for shell commands that can destroy a machine rather than a commit. */
  commandGuard: z
    .object({
      enabled: z.boolean().default(true).volatile(),
      /**
       * One policy for every recognised pattern, because they share one property:
       * none of them can be undone. They differ only in what they destroy.
       */
      dangerousShell: guardAction(),
    })
    .default({}),
  /** Files and directories the plugin never lets a tool name at all. */
  fileGuard: z
    .object({
      enabled: z.boolean().default(true).volatile(),
      /**
       * Patterns matched against a tool's path arguments and against the words of
       * a shell command. A trailing `/` matches that directory and everything
       * under it; a pattern containing `/` also matches at any depth
       * (`.ssh/id_rsa` matches `~/.ssh/id_rsa`); anything else matches the file
       * name, where a leading dot also covers its variants (`.env` covers
       * `.env.local`).
       */
      noRead: z
        .array(z.string())
        .default([
          '.env',
          '.ssh/id_rsa',
          '*.pem',
          '*.key',
          // Trailing slash, so the rule covers the store as well as the bare
          // file: `credentials/id` and `./credentials/x` are the same secret.
          'credentials/',
          '*.p12',
          '.npmrc',
          'secrets/',
        ])
        .volatile(),
    })
    .default({}),
  /** Credential patterns scanned for in every tool argument. */
  secretGuard: z
    .object({
      enabled: z.boolean().default(true).volatile(),
      /**
       * Also flag long high-entropy strings with no known prefix. Off by default:
       * it is the pattern most likely to stop an ordinary call.
       */
      genericHighEntropy: z.boolean().default(false).volatile(),
    })
    .default({}),
  /** Security audit trail. */
  audit: z
    .object({
      enabled: z.boolean().default(true).volatile(),
      /** One JSON object per line. Kept out of version control by `.dev-docs/`. */
      path: z.string().default('.dev-docs/audit-log.jsonl').volatile(),
    })
    .default({}),
})

/** Resolved plugin configuration: every default applied. */
export type Config = Schemastery.TypeT<typeof Config>
