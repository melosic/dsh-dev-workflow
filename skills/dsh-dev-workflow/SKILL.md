---
name: dsh-dev-workflow
description: >
  Development-workflow gatekeeper. Use when starting a feature, preparing a
  commit, opening a pull request, or preparing a release. Covers branch naming,
  commit message format, documentation sync, CHANGELOG upkeep, and release rules.
---

# dsh-dev-workflow

This file is the default specification the plugin ships to everyone who installs
it. It is read on demand — nothing below is resident context.

**The repository you are working in outranks this file.** If its own `AGENTS.md`,
`CONTRIBUTING.md`, or contributor guide says something different — a branch
prefix, a commit type, a changelog heading, a review rule — follow that document
and treat this one as the fallback it is. Where the plugin enforces a rule, the
matching configuration field is what it actually enforces, so check the field
before quoting a number from here.

## How to Read This Document

Three actors are addressed here, and knowing which one a rule is for keeps you
from treating a convention as a gate:

- **The plugin acts automatically.** *Automatic Triggers* and *Safe Operations*
  describe behaviour that happens whether or not anyone remembers it. Do not
  re-state those rules to the user; the guards already answer for them.
- **The AI assistant must.** Most of this document is an instruction set for
  whoever does the work, which is usually an assistant acting for a human. Follow
  it, run the checks, and show the result.
- **The human decides.** Anything that leaves this machine, anything
  irreversible, and every judgement call marked "ask the user" belongs to them.

Three documents usually hold the rules in a repository, and they are not
interchangeable:

| File              | Holds                                                        | Resident |
| ----------------- | ------------------------------------------------------------ | -------- |
| `AGENTS.md`       | the stable rules that must hold on every turn                 | yes      |
| `CONTRIBUTING.md` | the expansion for humans contributing to the repository        | no       |
| this file         | the default specification the plugin ships to every installer | no       |

A repository may use other names — `CLAUDE.md`, `.cursor/rules`, a `docs/`
page. What matters is the split, not the filenames: the always-on rules, the
long form, and this fallback. Write a rule here only if it applies to any
repository that installs the plugin. Repository-specific detail — a project's own
commands, its CI layout, its release mechanics — belongs in that repository's own
documents, and outranks anything below.

Two interaction rules follow from the actor split. When you advise, give **one**
primary recommendation, not a menu of five — a list of options is a way of
handing the decision back without saying anything. And match the tone to the
stakes: a blocking problem is stated plainly and once; a stylistic preference is
mentioned and dropped.

## Core Principles

- **Automation over memory.** A rule that tooling can check should be checked by
  tooling, not recalled by discipline. Anything mechanically verifiable belongs
  in CI or a hook.
- **Atomic changes are recommended, not enforced.** Keep one commit per
  independent logical change, but atomicity needs semantic judgement, so it is
  never a hard gate.
- **Documentation is code.** The docs that describe a change ship in the same
  PR as the change.
- **Quality gates come first.** Typecheck, lint, format, and tests run before
  review, so a reviewer reads intent instead of noise.
- **Secure by default, explicit confirmation.** Destructive operations default
  to asking, never to allowing. So do the actions other people can see — a commit
  the user has not approved, a push, a tag, a pull request, a publish.
- **Trigger on the action, not on a mode switch.** The workflow appears when the
  user is about to commit, branch, or release. Users forget to switch modes;
  actions do not lie.
- **Stay quiet until then.** No nagging and no full-spec dump on every turn. The
  resident cost is one summary line; the full text is read only on demand.

## Branch Model (GitHub Flow)

- `main` is always releasable and is protected: no direct pushes, everything
  lands through a pull request, and required checks must pass.
- Work happens on short-lived branches created from an up-to-date `main`:

  | Prefix      | Use                       |
  | ----------- | ------------------------- |
  | `feature/*` | new capability            |
  | `fix/*`     | bug fix                   |
  | `docs/*`    | documentation only        |
  | `hotfix/*`  | urgent fix against `main` |

- The four prefixes are their own list, **not** derived from the commit types. There
  is no `chore/*` or `ci/*` branch because a branch name never lands anywhere: squash
  merge discards it, while the type is what survives into `main`. Do not "unify" the two
  lists — they answer different questions and have different lifetimes.
- Branch names are all lowercase and kebab-case (the same style as the type and
  scope in a commit). A name that reads on its own is required: `feature/skill-md`
  and `fix/guard-force-push`, not `feature/stuff` or `feature/NewStuff`.
- **Branch naming is a convention, not a gate.** Nothing in the plugin inspects a
  branch name — there is no configuration field for it either. Follow the rule
  because it tells a reader what the branch is for, not because a badly named
  branch will be blocked.
- Keep a branch on one topic.
- Stay current with `git merge main`, not `git rebase main`. Under squash merge a
  rebase rewrites the branch's own history, so a reviewer can no longer see what
  changed since the last review.
- Resolve conflicts on the branch, never on `main`.
- After resolving a merge conflict, re-run the project's own checks — typecheck,
  lint, and tests, with whatever commands that project defines — before
  committing. A conflict resolution can change what the code means, so the earlier
  green run no longer covers it — committing without re-verifying treats the merge
  as risk-free text editing.
- Merging uses **squash merge**, so `main` keeps one commit per pull request and
  a linear history.
- The squash commit that lands on `main` takes its message from the **pull
  request title**, so the PR title must itself follow Conventional Commits.
- The commits on the branch are squashed away and never appear in `main`'s
  history. This is why the PR title matters more than any single commit on the
  branch.
- Delete the branch as soon as the pull request is merged.

### Branch Protection

This model assumes `main` is protected in the repository settings, not by
convention. The rules it depends on:

- Direct pushes are forbidden.
- Force pushes are forbidden.
- Deletion is forbidden.
- A pull request is required, and its required CI checks must pass.
- The branch must be up to date with `main` before it can merge.
- Every review conversation must be resolved.

Whether an approving review is *also* required is a repository decision, not part
of this model: a repository maintained by one person usually turns it off, since a
review by nobody is not a review.

None of this is enforced by the plugin — these are GitHub settings, and a
repository without them still gets the checks described in *Automatic Triggers*.
Read the repository's actual protection settings before assuming this list is in
force.

### Hotfix Flow

- Cut a `hotfix/*` branch from `main`, never from a feature branch.
- When the fix is done, merge it straight back into `main`. There is no
  `develop` or `release` branch in this model to route it through.
- Write the hotfix's `CHANGELOG.md` entry into `[Unreleased]`; it ships with the
  next release like any other change.
- If the problem is severe enough to need a release right away, follow
  *Withdrawing a Published Release* instead of inventing a second flow.

## Commit Messages (Conventional Commits)

```text
<type>(<scope>): <subject>

<body>

<footer>
```

- `scope` is optional but encouraged when a change is clearly local.
- **Subject**: imperative mood ("add", not "added"), no trailing period, and at
  most 50 characters. Write the subject in English, so it matches the `type` and
  `scope`, which are English by definition.
- The thresholds and the accepted `type` list are **configuration**, not constants
  of this document: `commitCheck.subjectMaxLength`, `commitCheck.types` and
  `commitCheck.requireScope` can be changed from the settings panel, and the gate
  then enforces what they say. Run `/dev-workflow status` to see the values in
  effect before treating a number here as the rule.
- **Body**: wrap at 100 characters — the same ceiling commitlint's
  `body-max-line-length` applies, so the two gates never disagree — and explain
  *why*. Do not restate what the diff already shows. A body or footer may be
  English or Chinese, but one project should pick one and stay with it.
- **Footer**: reference issues (`Closes #12`) and record breaking changes.

  | Type       | Meaning                                             |
  | ---------- | --------------------------------------------------- |
  | `feat`     | a new user-visible capability                        |
  | `fix`      | a bug fix                                            |
  | `docs`     | documentation only                                   |
  | `style`    | formatting, no behaviour change                      |
  | `refactor` | internal change that is neither a fix nor a feature  |
  | `perf`     | a change that improves performance                   |
  | `test`     | adding or fixing tests                               |
  | `build`    | build system or dependencies                         |
  | `ci`       | CI configuration and scripts                         |
  | `chore`    | maintenance that fits nowhere else                   |
  | `revert`   | reverting an earlier commit                          |

- Breaking change: either signal stands on its own. Append `!` after the type or
  scope (`feat(api)!: ...`), **or** write a `BREAKING CHANGE:` footer, or do both.
  The specification lets either one announce the break, so `fix(core)!: drop the
  old api` is a complete message and nothing blocks it.
- The footer is still worth writing: `!` says that something broke, the footer says
  what and what to do instead. Leaving a lone `!` raises an advisory note, never a
  block. Either spelling of the token is accepted — `BREAKING CHANGE: <explanation>`
  and `BREAKING-CHANGE: <explanation>` — all uppercase, with a single space after
  the colon. Accepting both is deliberate: commitlint's own spec lists the
  hyphenated form as equivalent, so a message that passes one gate must not fail
  the other over a dash.
- The 50/100 rule is not cosmetic. Many tools truncate a subject, and a wrapped
  body stays readable in a terminal and in a diff.

### Scope and Examples

A scope names the area of behaviour that changed, not the file that was touched:

| Scope    | Use for                                        |
| -------- | ---------------------------------------------- |
| `guard`  | one of the guards                              |
| `trigger`| one of the triggers                            |
| `check`  | the rules a check evaluates                    |
| `config` | the configuration schema and defaults          |
| `panel`  | the settings panel                             |
| `i18n`   | dictionaries and `t()` usage                   |
| `docs`   | prose only                                     |
| `deps`   | dependencies and manifest changes              |

If a change spans two areas it is usually two commits; if it genuinely cannot be
split, pick the area a user would notice and say the rest in the body.

The same change, described twice:

```text
fix: fix the crash
```

```text
fix(guard): stop the force-push rule from matching git push --force-with-lease

The rule compared the raw argument list, so the safe form was caught by the
same branch as the dangerous one and every lease push asked for approval.

Match the exact flag instead, and keep `--force` covered.
```

The second one can be reviewed without opening the diff. The first one cannot be
reviewed at all.

### Issue References

- Open an issue when the problem is real but the fix is not happening now: a
  defect you are deferring, a proposal that needs agreement before any code, a
  release checklist that spans several changes. The issue is what keeps that work
  from being remembered only by whoever happened to hear about it.
- Do not open one for what this session will finish. The commit message and the
  pull request description already are that record; a second copy is a second
  thing to keep in sync, and it goes stale the moment the code moves.
- A bypass — a rule that should have caught something and did not, or one that can
  be skipped without a trace — is a defect, and a public issue is fine. This plugin
  is not a security boundary, so a bypass is not a vulnerability; publishing it is
  how the next person finds it and adds "me too".
  The one exception is a report that has to quote a live credential. Replace the
  value first — otherwise the report itself completes the leak.
- Then reference it from the commit: `Closes #12` — once this commit lands, issue
  #12 can be closed.
- `Refs #12` — this commit relates to issue #12 but does not close it.
- Several issues: `Closes #12, #15`.
- Reference the number only. A full URL is not used, because the repository is
  already known and the URL is longer than the fact it carries.

## Atomic Commits (Recommended Practice)

- An atomic commit solves exactly one independent logical problem and can be
  described by a single line of intent.
- This is **recommended, not required**. Atomicity rests on semantic judgement —
  whether two edits belong together depends on intent, not on file paths — so it
  cannot be checked mechanically and is never a merge blocker.
- When preparing a commit, split it if the staged changes answer more than one
  question, or if reverting the change would have to be done in pieces. Keep it
  whole otherwise.
- **The user has the final say.** If they ask for a single commit, produce a
  single commit and state the tradeoff once.
- The pre-commit trigger does not check atomicity. It checks only what is
  mechanically verifiable: commit message format, CHANGELOG, and documentation
  sync.

## Pull Requests and Quality Gates

Before committing, **show the user what will be committed and wait for their
answer.** A commit is the first thing that becomes hard to take back: state the
branch, the staged files, and the message, then let them agree, change, or drop
it. It is their repository. The checklist below is what to verify before you ask,
not permission to skip the asking.

- [ ] The user has seen the exact changes and message, and agreed to them.
- [ ] Your project's own checks pass locally: typecheck, lint, format check, and
      tests, run with whatever commands that project defines.
- [ ] The staged changes answer one question (see *Atomic Commits*).
- [ ] The commit message follows Conventional Commits.
- [ ] Documentation touched by the change is updated in the same commit or PR.
- [ ] `CHANGELOG.md` carries an `[Unreleased]` entry for the change.

Pull request description template. Every heading below must carry something —
the gate reports a missing or empty one before `gh pr create` runs. "None" or one
sentence is a complete answer where nothing applies; what is not accepted is
deleting a heading or leaving it blank, because then the reviewer cannot tell
"nothing to say" from "not considered". These are the default names, used when the
repository has no template of its own. Where one exists —
`.github/pull_request_template.md` and the other paths GitHub reads — its headings
are what the gate checks, so a repository that renames them only has to rename them
there. The text under each heading may be in any language:

```markdown
## What

Add a `--json` flag to the status command.

## Why

Scripts cannot parse the current prose output.

Closes #7

## How to verify

Run `/dev-workflow status --json` and check that the output parses.

## Type of change

Feature: behaviour that did not exist now does.

## Non-goals

Changing the human-readable output.

## Risk and rollback

None; revert the commit.

## Checklist

- [x] One concern in this pull request.
- [x] The tests fail without the change.
```

Two rules about that template are worth knowing before you copy it:

- **The boxes start unticked, and a tick is the only answer.** The sample above
  shows them ticked, which is the state the author leaves them in before asking
  for review. Every `- [ ]` under a heading the gate reads is counted, so a line
  that does not apply has to be deleted and explained under Non-goals — ticking
  it to move on is the one thing the check cannot tell from a real answer. That is
  also why `Type of change` is a list of lines to delete rather than a set of
  checkboxes: one ticked box among four would leave three counted as unticked and
  block every pull request.
- **Not every checklist line fits every change.** "The tests fail without the
  change" is true of a behaviour change and meaningless for a documentation fix, a
  configuration default, or a pure refactor. Delete that line in those cases and
  say why — a false tick is worse than a deleted line, because it teaches the
  reviewer to stop reading the list.
- **A breaking change needs its migration path**, not just the label: say what an
  existing caller has to do, in the same place a reader will look for it.
- **Paste no CI status.** The platform runs the checks and shows them on the pull
  request; a hand-written "CI passed" is a claim that can be stale by the time it
  is read.

A pull request is mergeable only when CI is green, the branch is up to date with
`main`, and every review conversation is resolved. Never merge by bypassing a
failing check: fix the cause, or report the blocker.

**Two pull requests in flight will meet in the changelog.** Both add a line under
the same unreleased heading, so each is clean against the base and the second one
to merge conflicts there. Decide the merge order before opening the second one:
merge the first, then rebase. The gate names the conflicting branch and files
before the pull request is created — do not read that as a warning to click past;
it is the cheapest moment to avoid the conflict entirely.

**Pushing, tagging, opening the pull request, and publishing each need their own
answer from the user first.** These leave this machine under their name; they are
not steps an assistant completes on its own initiative. Show the branch, the
remote, the tag or the version, and the exact command, then wait. One approval
covers that one action — consent to commit is not consent to push, and consent to
push is not consent to publish. When the user has not answered, the state is "not
yet done", not "done".

### Reviewer's Side

The rules above are what the author owes; these are what the reviewer owes. A
review that skips them is a rubber stamp with a comment attached.

- Read the title and the *Why* first. Under squash merge the title is the commit
  message that survives, so a vague title is a permanent defect, not a nitpick.
- Review the diff against the stated intent. If the diff does something the
  description does not mention, that is the finding — the extra change is
  unreviewed by construction.
- A test that changed in the same commit as the code it covers deserves a second
  look: check whether the assertion moved to match the new behaviour or was
  weakened to accommodate a bug.
- "I trust it" is not a review state. Approve when CI is green and every
  conversation is resolved, or ask for the change. Leave nothing in between.
- Prefer asking for a split over reading it all. A pull request approved without
  being read is worse than one that was never opened.

### Local Verification vs CI

- The local checklist above is a recommendation, not a hard gate.
- CI is the hard gate, and it cannot be bypassed. When it fails, fix the cause —
  never weaken the check, edit the CI configuration to route around it, or skip
  it with `--no-verify`.
- If the CI setup itself is wrong, open an issue for it rather than patching it
  inside an unrelated pull request.
- **A check that could not run is not a check that passed.** Report it as NOT
  ASSESSED and say why — no git, no network, a file that is not there yet. The
  plugin already does this: when its own listing degrades, the trigger says so
  instead of treating the silence as clean. Do not write "all checks passed" for
  a run where one of them never executed.
- **Verify the artifact, not the intent.** Before claiming something works, look
  at the thing that was produced — the file exists, the command exits 0, the
  output contains what you said it would. A fluent description of what the code
  should do is not evidence that it does it.
- **After a second failure, stop and report.** If the same attempt fails twice,
  do not try a third variation silently: say BLOCKED, give what you tried, what
  you observed, and what is still unverified. A partial report with an honest gap
  is worth more than a confident summary with a hole in it.

### Pull Request Size

- Aim for roughly 200–400 changed lines.
- Past 500 lines, split the pull request, or walk a reviewer through it before
  they start reading.
- The reason is practical: a small pull request is reviewed quickly, conflicts
  with less, and is easy to revert if it turns out to be wrong. A large one
  tends to be approved on trust, which is the opposite of review.

## Documentation Sync

| Change                            | Update in the same PR                              |
| --------------------------------- | -------------------------------------------------- |
| User-visible behaviour            | the README, in **every** language it is written in |
| An entry point, data flow, or module boundary | the architecture document               |
| A config option, its default, or its values | the configuration reference             |
| A tool: name, parameters, or returned text | the tool reference                      |
| A trigger, or when one fires      | the trigger reference                              |
| User-visible strings              | every locale dictionary, as a pair                 |
| Anything in this specification    | this file and its translation, same sections       |
| Any change at all                 | an `[Unreleased]` entry in the changelog           |

- Which files those are is configuration, not a constant of this document:
  `docs.readme`, `docs.changelog`, `docs.docsDir`, and `docs.mirrors` name the
  paths the checks actually read. A project with no `docs/` tree simply has fewer
  rows to fill; the changelog row applies everywhere.
- Paired files move together or not at all. A half-synced pair is worse than a
  stale one, because it looks maintained.
- "In sync" means the same structure and the same key facts, not a literal
  translation: the same sections in the same order, and the numbers, commands,
  paths and defaults saying the same thing in both languages. A difference you
  keep on purpose belongs in the pull request description, not left to be
  guessed from the diff.
- CI enforces what is mechanical: locale keys line up, the two skill files
  expose the same sections in the same order, and no CJK reaches an English
  surface. Whether a translation reads well, and whether both sides say the
  same thing, stay human review items.
- The docs describe the current state of the main branch. They are not versioned
  documentation: to read how an older version behaved, check out its git tag.

### When Documentation Sync Does Not Apply

These changes need no README and no architecture/config/tool/trigger document
update:

- A purely internal refactor that leaves externally visible behaviour unchanged.
- A test-only change.
- A dependency upgrade that does not change user-visible behaviour.
- Code style or formatting.
- CI configuration.

The exemption covers prose only. If any of these does change what a user sees,
it still needs a changelog entry — the two obligations are separate, and this
list waives just one of them.

## Releases (SemVer + Keep a Changelog)

- Versions follow [SemVer](https://semver.org/): `MAJOR.MINOR.PATCH`.
  - `MAJOR` — incompatible changes.
  - `MINOR` — backward-compatible additions.
  - `PATCH` — backward-compatible fixes.
- **While the project is 0.x it makes no compatibility promise.** SemVer permits
  a 0.x `MINOR` bump to carry breaking changes; this project says so out loud and
  marks each one `BREAKING` in the changelog.
- `CHANGELOG.md` follows
  [Keep a Changelog 1.1.0](https://keepachangelog.com/1.1.0/): an `[Unreleased]`
  section always sits at the top, above the six categories `Added`, `Changed`,
  `Deprecated`, `Removed`, `Fixed`, and `Security`.
- Release flow:
  1. Confirm `main` is green and every intended change is merged.
  2. Move the `[Unreleased]` entries under a new `[<version>] - <YYYY-MM-DD>`
     heading, and leave `[Unreleased]` in place, empty.
  3. Bump `version` in `package.json` to match the new heading.
  4. Commit as `chore(release): <version>`, then tag `v<version>` and push it.
  5. Publish from the tagged commit with `npm publish`.
  6. Verify the publish landed: `npm view <package> versions` shows the new
     version, or `npx <package>@latest --version` installs and reports it. If
     the verification fails, check the dist-tag and the registry status before
     assuming the publish succeeded.
- Do not edit a released section. Corrections become new entries.

### Pre-release Versions

- A pre-release version follows SemVer:
  `MAJOR.MINOR.PATCH-<pre-release>`.
- The common identifiers are `-rc.1`, `-beta.1`, and `-alpha.1`, in descending
  order of readiness.
- A pre-release is not published to the `latest` tag. Publish it with
  `npm publish --tag next`, so nobody installs a release candidate by accident.
- Examples: `0.2.0-rc.1`, `1.0.0-beta.3`.
- A candidate and `[Unreleased]` must not both claim the same change. Either the
  entries moved under the `-rc.1` heading, or they are still unreleased — pick
  one and keep it true while the candidate is out. When `-rc.2` follows, add to
  the same version heading; do not open a second one.

### When a Release Stops Half-Way

The steps are ordered, and a run can die between any two of them. Recover by
working out which of the three facts actually happened, not which step the output
claims:

- **The tag exists but nothing shipped.** Fix the cause and publish again from
  the same tag. Do not delete and re-push the tag once anyone may have fetched
  it; the tag is the promise, the registry entry is the delivery.
- **The publish succeeded but verification still shows the old version.** Wait.
  Registry propagation takes minutes, and a mirror or a release-age policy can
  hold an unqualified install back for a day. Confirm with a packument read
  before concluding the publish failed — re-publishing the same version fails, so
  a wrong conclusion here costs a version number.
- **Something shipped and is wrong.** Amend nothing: a tagged commit is
  immutable in practice. Follow *Withdrawing a Published Release*, then land the
  fix as a new patch.
- **The release commit itself is wrong** (wrong files, wrong date). If nothing
  was tagged or published, reset and redo it. If a tag exists, leave the history
  alone and correct forward.

### Release Notes

Release notes are the delivery note for one version, published where people look
when a new version appears. Their reader is the user, or the person deciding
whether to upgrade — not the developer who wrote the change. The question they
answer is *what does this mean for me, should I upgrade, and how*.

Write these out in full:

- **New features.** What changed that the user can notice, with a short usage
  example.
- **Fixes.** Which user-visible bugs are gone.
- **Breaking changes.** Impossible to miss, with the migration steps.
- **Upgrade.** Version requirements, configuration changes, and anything that has
  to happen before or after the install.
- **Known issues.** Honestly listed. If there are none, say so in one line
  rather than deleting the section — a missing section reads as an oversight.
- **Thanks** (optional). The contributors who made the release.

Keep these short, or leave them out:

- Internal implementation detail, and the log of refactors.
- A list of commit hashes. Link to the changelog instead.
- A "miscellaneous" entry that says nothing.
- A narrative of each pull request's review.

The split is: detail from the user's side — what I get, what I must change —
and brief from the internal side, where a link is enough.

The entries come from the changelog section for that version and are copied,
never re-summarised: when the two disagree on a fact, the changelog is right and
the release page is wrong. The upgrade, known-issues, and thanks sections are the
only content that does not exist in the changelog, because a changelog records
changes and those three answer questions a record of changes cannot hold.

If the project writes for readers in more than one language, put both on the
same page rather than picking one:

```markdown
[中文](#cn-v1.2.0) | [English](#en-v1.2.0)

<h3 id="cn-v1.2.0">v1.2.0</h3>

#### 新增

- 空配置自动回退到默认值，不必先写一份配置文件

#### 修复

- Windows 上配置里的 `C:\...` 被当成转义读不到

#### 破坏性变更

- 配置字段 `timeout` 更名为 `requestTimeout`；旧名仍兼容一个版本

#### 升级

`dsh plugin --profile <profile> add @melosic/dsh-dev-workflow@1.2.0`

#### 已知问题

- 无

<h3 id="en-v1.2.0">v1.2.0</h3>

#### Added

- An empty configuration now falls back to the defaults instead of requiring a file

#### Fixed

- A `C:\...` path in the configuration was read as an escape sequence on Windows

#### Breaking changes

- The `timeout` field is now `requestTimeout`; the old name still works for one version

#### Upgrade

`dsh plugin --profile <profile> add @melosic/dsh-dev-workflow@1.2.0`

#### Known issues

- None

Full Changelog: [v1.1.0...v1.2.0](https://.../compare/v1.1.0...v1.2.0)
```

The second language is a translation of the same entries, never a second summary
of them. Keep one heading per language — a `####` sub-heading under each is fine,
a second copy of the whole page is not. This costs a translation per release and
buys a page a reader who does not read the changelog's language can still use;
skip it if the project genuinely has one audience, and say so rather than leaving
one half empty.

### Deprecation and Removal

- To deprecate something, add an entry under `Deprecated` in `[Unreleased]`
  naming the replacement and when the removal is planned.
- Keep a deprecated feature for at least one `MINOR` release before removing it.
  A security problem is the one reason to skip that wait.
- Removing it is a `Removed` entry, and under 0.x it is marked `BREAKING`.

### Rollback

- To roll back a published change, revert it with a `revert` commit and add an
  entry under the matching `[Unreleased]` category saying what was rolled back
  and why.
- Do not delete the original changelog entry. The changelog is a record of what
  happened, and a version that was published did happen.
- Whether a rollback needs its own release depends on how far the original
  change had spread; a rollback of something users already depend on does.

### Withdrawing a Published Release

- A version published less than 72 hours ago can be removed with
  `npm unpublish`.
- Past 72 hours, `npm unpublish` is no longer available. Deprecate the version
  with `npm deprecate` instead, then publish a fixed version.
- A deprecation message must state the problem, which versions are affected, and
  what to use instead. It is read by someone who already has the broken version
  installed, so it is the only place they will look.
- Never cover a bad release by deleting the version. Publish a new one.

## CHANGELOG Maintenance

The changelog answers one question for someone who is deciding whether to
upgrade: *what changed for me?* It is not a summary of the commit log.

### What to Write

- Any user-visible behaviour change: a new capability, a fix, a changed
  configuration option, or a changed API.
- A breaking change. Always, with a `BREAKING` marker and migration notes.
- A security fix — but do not disclose the vulnerability in the entry until the
  fix has been released.
- A deprecation: what is deprecated, what replaces it, and when it is planned to
  go away.

### What Not to Write

- Internal refactors, code style, test changes, and dependency upgrades.
- A restatement of the commit messages. The changelog is not a commit log.
- Implementation detail, such as which function was renamed.
- Anything that has not been released yet.
- Sensitive information of any kind.

### How to Write

- Use the imperative, and address the reader.
- One entry per change.
- Say what it means for the user, not what the code does.
- For a breaking change, give the migration path.
- One entry, one sentence, at most 120 characters — `ci:checks` measures it. The
  release notes are copied from these entries verbatim, so entry length is
  release-page length.
- Write the state after the change, never the state before it. The "this used to
  be broken because X, and now it is Z" belongs in the commit message and the
  pull request, where someone debugging it will look; a reader of the release
  page only wants to know what is true now.
- No bold lead-in. `**Headline.** Then the explanation` is a second title: it
  spends characters and then repeats itself in the sentence that follows.
- If an entry needs three or more sentences, it is either several changes that
  want separate entries, or an explanation of *how* the fix works. A changelog
  long enough to be skimmed is a changelog nobody reads.

### Examples

| Bad entry                        | Why it falls short                               | Better entry                                                            |
| -------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| `Fixed — fixed a bug`            | A reader cannot tell whether it affects them.    | `Fixed — a failed push left the branch dirty; the error now rolls back` |
| `Added — refactored the parser`  | A refactor is not an addition, nor user-visible. | `Changed — the parser accepts a single leading "+" before a number`     |
| `Changed — updated dependencies` | A routine upgrade is not a change to the user.   | *(no entry)*                                                            |

### When to Write

- At the moment the change happens, into the matching `[Unreleased]` category.
- Not at release time. By then the detail is lost and the entries become vague.
- `docs`, `test`, `chore`, `ci`, and `build` commits usually need no entry.
- `feat`, `fix`, and `perf` need one. `refactor` needs one only when it changes
  something a user can observe. `revert` needs one.

### Concurrent Edits

`[Unreleased]` is the one section every open branch writes to, which makes it the
most common conflict in this repository. Three habits keep the conflict small:

- Add your entry at the **top** of its category, not at the bottom. The newest
  entry is the one a reader most wants first, and appending to the end guarantees
  a conflict with every other branch that also appended.
- Resolve a `CHANGELOG.md` conflict by keeping **both** sides. A changelog
  conflict is never a choice; both entries describe something that happened.
- After merging `main`, check that your entry is not now duplicated, and that the
  category headings are still in the Keep a Changelog order.

### Dependency Upgrades

- A dependency upgrade does not get a changelog entry by itself.
- The exception is an upgrade that changes user-visible behaviour — for example,
  a parser that now rejects input it used to accept. That is written under the
  category it actually belongs to, not under `Changed — dependencies`.

### Breaking Changes

- Write the entry under the matching `[Unreleased]` category and prefix it with
  `**BREAKING:**`.
- Include the migration path: what to do instead, and what happens if you do
  nothing.
- This matters most in the 0.x stage, where a `MINOR` bump can carry the change.

## Safe Operations

Destructive git commands. These rewrite or discard history and must never run
unprompted:

| Command                                  | Risk                                             |
| ---------------------------------------- | ------------------------------------------------ |
| `git push --force` / `--force-with-lease`| overwrites remote history; can discard commits   |
| `git push --mirror`                      | forces and deletes: makes the remote match you   |
| `git reset --hard`                       | discards uncommitted work permanently            |
| `git clean -f`                           | deletes untracked files permanently              |
| `git branch -D`                          | deletes a branch whose commits may exist nowhere |
| `git rebase`                             | rewrites history                                 |
| `git commit --amend`                     | rewrites a commit that may already be published  |
| `git checkout -- .` / `git restore .`    | discards every unstaged change                   |
| `git checkout -f` / `git switch --discard-changes` | discards edits by switching anyway      |
| `git push --delete`                      | removes a remote branch others may base work on  |
| `--no-verify`                            | skips the hooks that protect the repository      |

`git restore --staged <path>` is not on the list: it moves a change back to the
working tree and discards nothing. `git restore <path>` with no `--staged` is the
modern spelling of `git checkout -- <path>` and is.

- The table is about rewriting history other people can see. Rebasing a branch
  only you have, and have never pushed, rewrites nothing anyone else holds.
  Rebasing a branch someone has based work on — or `main` itself — is the case
  the table warns about, and it is why the branch model says `git merge main`.
- Never hard-code a credential, and never write one into a log, a fixture, or a
  document. Secrets come from the environment or an untracked local file.
- Never read a sensitive file to "check" it: `.env`, `*.pem`, `*.key`,
  `id_rsa*`, `credentials`, `*.p12`, an `.npmrc` holding an auth token, and
  anything under `secrets/`.
- A force push must use `--force-with-lease`, which refuses to overwrite commits
  you have not fetched. That form is acceptable only on a branch that is neither
  `main` nor protected; against `main`, no force form is acceptable at all. A
  bare `--force` is never the answer.
- Do not bypass git hooks as a habit. `--no-verify` is an escape hatch for an
  emergency, not a workflow.
- An AI assistant must not run a destructive operation without explicit
  confirmation from the user for that specific action, and must name what will
  be lost.
- **The same goes for every action other people can see.** A push, a tag, a pull
  request, and a publish leave this machine under the user's name, and saying
  "done" before they agreed is the mistake these four have in common. Show what
  will leave, wait for the answer, and only then run it. A forced push is both:
  show the remote commit that will be overwritten as well.
- When a destructive command is requested, prefer the reversible form and say
  why.
- Scan the staged diff for credentials before committing, with a secret scanner
  such as gitleaks rather than by eye. If one turns up, rotate the secret —
  deleting the commit is not enough. A secret that reached the remote is already
  exposed.

## Tool and Guard Boundaries

The plugin is a set of guards and triggers, not a sandbox. Knowing where it stops
prevents both false trust and wasted effort trying to configure what cannot be
configured:

- **The guards see tool arguments, not running processes.** A path assembled
  inside a script, or read through a language runtime, is invisible to
  `fileGuard` — it matches the words a tool was called with.
- **Shell parsing is lexical, not a shell.** The guards read the ordinary hiding
  places — command substitutions, backticks, and the argument of `sh -c` are
  parsed again as commands — but an interpreter is opaque: nothing reads inside
  `node -e "…"` or `python -c "…"`. The guards catch the ordinary forms of a
  destructive command, which is where mistakes happen; they are not a defence
  against someone deliberately obfuscating one.
- **How configurable a guard is depends on which guard it is.** `gitGuard` gives
  each rule its own policy (force push, hard reset, rebase, amend, branch delete,
  clean, discarded checkout, `--no-verify`), and `outwardGuard` gives each
  outward action its own (push, tag, pull request, issue, publish). `commandGuard` has
  a single policy for every recognised pattern, because they share the one
  property that matters — none can be undone. `fileGuard` and `secretGuard` are
  fixed `deny` with no per-item exemption, so the only relaxation is turning the
  guard off; do that only in a sandbox where the files you would expose do not
  matter.
- **The triggers check the action, not the result.** A commit message is checked
  before the commit runs; a changed file is checked before it is written. Where a
  value cannot be known until the command executes, the check says so rather than
  guessing.
- **The real boundary is the host.** The sandbox and approval policy decide what a
  tool may do. These guards exist so a normal mistake is caught early — treat a
  green run as "nothing obvious went wrong", never as proof of safety.
- **A guard that throws fails the call; it does not fall through.** The host wraps
  the whole pre-execute chain, so an error inside a guard becomes an error on that
  tool call. Nothing turns a crash into a silent allow. This is deliberate: a
  swallowed exception would be a guard quietly stepping aside.
- **In a subagent, an `ask` is a refusal.** A subagent has no approval surface of
  its own, so a question that cannot reach a human is settled as `deny` rather
  than assumed. The guards still run inside subagents — but a policy set to `ask`
  stops them, not warns them.
- **Which repositories are checked is a setting, not a property of the machine.**
  DSH enables a plugin per profile, and a profile is per machine — but these rules
  belong to a repository. With `scope: 'marked'`, only a repository whose project
  root carries `.dsh/dev-workflow.yml` is checked; everywhere else the skill line
  is absent and every guard steps aside, so nothing is resident and nothing
  interrupts. The default is `all`, which checks every working directory as
  before. If a repository has no marker and you are unsure whether the rules
  apply, ask before assuming they do — silence from the guards is not agreement.
  `/dev-workflow mark` writes the marker (and `unmark` removes it), so opting a
  repository in never means hand-creating a path.

## Automatic Triggers

- **Before a commit** — check the commit message against Conventional Commits,
  whether `CHANGELOG.md` needs an `[Unreleased]` entry, and whether the changed
  files took their documentation with them.
- **Before a pull request** — check the title with the commit-message rules (under
  squash merge it becomes the commit on the main branch) and the description
  against the repository's own template headings, falling back to `What` / `Why` /
  `How to verify` / `Type of change` / `Non-goals` / `Risk and rollback` /
  `Checklist` when the repository has no template.
- **Before a release** — check the version, the tag against `package.json`, and
  whether the changelog carries the release.
- **No trigger watches branch creation.** Branch naming is a convention this
  document asks for, not something the plugin enforces, so a badly named branch is
  not blocked.
- **Otherwise stay quiet.** Do not volunteer the specification, do not read its
  full text, and do not interrupt unrelated work. The resident cost stays at one
  summary line.
- If the user ignores a hint, let the action proceed. Do not repeat it: **the
  same hint about the same problem in the same session is raised once — and only
  after the user approved that action.** Returning `ask` is not approval: the
  dispatcher settles the question after the gate returns and keeps the answer to
  itself, so a refusal, a cancellation, and a profile with no approval channel all
  leave the target unremembered and the same command is judged again next time. A
  repeated warning is noise, and noise trains people to click through warnings.
- Every hint must be actionable: name the problem, show the expected form, and
  offer the concrete fix. "Invalid commit message" is not a hint; "the subject is
  63 characters — Conventional Commits suggests 50 or fewer" is.
