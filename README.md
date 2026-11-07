# dsh-dev-workflow

<p align="center">
  <a href="README.zh.md">中文</a> | <strong>English</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@melosic/dsh-dev-workflow"><img src="https://img.shields.io/npm/v/@melosic/dsh-dev-workflow?style=flat-square&color=6c5ce7" alt="npm"></a>
  <a href="https://www.npmjs.com/package/@melosic/dsh-dev-workflow"><img src="https://img.shields.io/npm/dm/@melosic/dsh-dev-workflow?style=flat-square&color=4b6fff" alt="npm downloads"></a>
  <a href="https://github.com/Melosic/dsh-dev-workflow/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Melosic/dsh-dev-workflow/ci.yml?style=flat-square&label=CI" alt="CI"></a>
</p>

<p align="center"><strong>A conventions gate for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> (dsh)</strong></p>

<p align="center"><sub>check the commit message before it commits · the PR description before it opens · the version before it releases · ask before a command that cannot be undone · 200–250 tokens resident</sub></p>

<p align="center"><code>dsh plugin --profile web add @melosic/dsh-dev-workflow</code></p>

---

If your `git commit`, `gh pr create` and `git tag` are run by an agent, these checks are for you. The rest of this file covers only when it speaks up, and why.

## Why

Every project writes some conventions down — how a commit message is shaped, which sections a PR carries, how a version is chosen. They usually live in `AGENTS.md`, `CONTRIBUTING.md` and a document or two.

Text does not enforce itself. Reading a rule and following it are two different things: the guide says the subject stays under 50 characters and the agent still writes 62. This plugin turns the parts a machine can check into checks that run — at commit, pull request and release time — and stops to ask before anything irreversible.

What it saves is rework:

- a commit rejected by CI, then amended;
- a PR sent back for a missing section, then rewritten;
- a release discovered to disagree with `package.json`.

It only touches three kinds of action: the ones awkward to change once committed, seen by others once pushed, and gone once run.

Two words recur below:

- **Triggers** check the work against the project's rules at commit, pull request and release time.
- **Guards** stop before a command or a file operation runs.

## When it speaks

| You are | It does |
| --- | --- |
| `git commit` | Checks the message format, whether a `feat` added a CHANGELOG entry, and whether docs moved with the code |
| `gh pr create` | Checks the description for the sections the template asks for, unticked checklist items, and a linked issue |
| `git tag` / `npm publish` | Checks the version is semver, that tag and `package.json` agree, and that the changelog has the section |
| `git reset --hard`, `rm -rf`, `git push --force` | Stops and asks first |
| Reading `.env`, a real secret in the arguments | Refuses — no per-call approval |

The rest of the time it says nothing.

What it says when it stops you is one line of why, plus the safer alternative:

> **A force push rewrites remote history and can discard other people's commits.**
> Prefer `--force-with-lease`: it refuses to overwrite commits you have not seen.

## How it works

The plugin hangs off DSH's tool-execution chain. Before the agent runs a command or writes a file, it looks once:

![How dsh-dev-workflow works](https://raw.githubusercontent.com/Melosic/dsh-dev-workflow/main/docs/assets/how-it-works.png)

One layer judges "is this within the rules" — commit messages, PR descriptions, version numbers. The other judges "can this be undone" — lost work, rewritten history, things others will see. When both fire, there is one prompt showing both sets of reasons, never two questions in a row.

The full spec is not on this path either: it stays resident as one summary line and is read only when needed, which is why the resident cost is 200–250 tokens.

## The five guards

| Guard | Blocks | Default |
| --- | --- | --- |
| Command | `rm -rf /`, `mkfs`, `dd of=/dev/sda` — irreversible | ask |
| git | `reset --hard`, `clean -f`, `push --force`, branch deletion, `--no-verify`, `git restore .` | ask |
| Outward | `push`, `tag`, `gh pr create`, `gh issue create`, `npm publish` — others will see it | ask |
| Sensitive files | `.env`, `*.pem`, private keys, the `credentials` file and directory | deny |
| Credentials | A real secret in the command arguments | deny, unless the line only reads |

The first three ask rather than refuse: most of these actions are legitimate, they are just worth one confirmation. The last two refuse — reading a private key has no "fine once you confirm it" case, and printing the path in an approval dialog is itself a second leak, so there is no per-call approval. The false positives are already excluded: sample files such as `.env.example` do not count, and neither does `grep -rn "credentials" .` — the check that tells you whether a secret is in the tree, because a search expression is not a path. To make one file readable, drop it from `fileGuard.noRead` or turn that guard off.

The credential guard has one exception, and it is a judgement rather than a setting: a command line whose every program only reads — `grep`, `rg`, `sed -n 's/…/…/p'`, `git log -S` — is let through and recorded as a hit. The value is already in the argument the model just wrote, so refusing the search removes nothing and stops nothing; it only hides the leak from whoever is looking for it. One program on the line that could write or send puts the refusal back. The judgement is about what the line will actually run, not what it is named: `sed -i` writes the file back, `sed -f` reads a script that is not on the line, the `e` flag (`s/a/b/e`) runs the replacement, and `$(…)` / `<(…)` can hold a second program inside what looks like one word. None of those counts as reading.

In a session with approvals turned off, "ask" becomes a refusal, and the prompt says how to get past it.

## Install, update, uninstall

### From the window

`Plugins` (top left) → `Add plugin` (top right of the page) → paste the package name → `Install`:

```
@melosic/dsh-dev-workflow
```

![The Add plugin dialog with @melosic/dsh-dev-workflow filled in](https://raw.githubusercontent.com/Melosic/dsh-dev-workflow/main/docs/assets/install-dialog.png)

Then check the plugin list to confirm it is enabled.

The dialog's `Registry` selector defaults to your own pnpm configuration; you can also pick the official npm registry or the mainland-China mirror directly. On a slow connection to npmjs, `registry.npmmirror.com` is usually much faster.

This is the only path that needs no terminal, and it works in the desktop app too.

### Command line

Install it into the profile you boot dsh with. If you start with `dsh web`, that is `web`:

```bash
dsh plugin --profile web add @melosic/dsh-dev-workflow
```

The templates that ship with dsh are `web`, `headless`, `acp`, `sdk` and `sdk-minimal`; a profile of your own takes its own name.

**The desktop app is the exception**: its profile is `desktop`, and the plain `dsh` command refuses to manage it (`profile "desktop" is managed exclusively by the Electron application`). Use the CLI the app ships:

```bash
"<desktop install>/resources/runtime/cli/bin/dsh.cmd" plugin --profile desktop add @melosic/dsh-dev-workflow
```

Use DSH's installer rather than `npm install`: a profile only loads the bundles named in its own `dsh.profile.bundles` list, and the installer is what writes both the dependency and that entry.

```bash
# update / uninstall — copy the profile prefix from above
dsh plugin --profile web add @melosic/dsh-dev-workflow@latest
dsh plugin --profile web remove @melosic/dsh-dev-workflow
```

Reload dsh, then run `/dev-workflow status` to confirm it is working:

```console
$ /dev-workflow status
dev-workflow is on. Conventions stay resident as a short summary; details are read on demand.
Locale: en-US (configuration says "auto").
Scope: every repository. This working directory is checked.
No check has run in this session yet.
Guard hits: none.
Security audit enabled. Guard decisions are appended to .dev-docs/audit-log.jsonl, which stays out of the model's context. Whether git tracks it is up to this repository's .gitignore.
```

If the first line says "is on", the install worked. If it says "off for this session" or "this one is NOT marked", the plugin is deliberately doing nothing — type `/dev-workflow on`, or create the marker file described in the next section.

Behaviour is changed in the settings panel; nothing there needs a restart.

## Configuration

The defaults are the common ones (Conventional Commits, Keep a Changelog). Everything a machine can check is adjustable — the type list, whether a scope is required, subject length, which PR sections are expected, the changelog category names, which publishing tools count. Tuned to your guide, it is that project's gate rather than this repository's. The full field list is in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

- **Per repository, not per machine.** `scope: 'marked'` limits the rules to repositories whose root carries a `.dsh/dev-workflow.yml`; elsewhere the guards and triggers stay quiet and the skill-catalogue line disappears (the two tool definitions are registered per process, so they ride along).
- **200–250 tokens resident.** The full spec is read on demand; what stays resident is two tool definitions and one skill-catalogue line. See [docs/TOKEN-BUDGET.md](docs/TOKEN-BUDGET.md).
- **`off` really turns it off.** `/dev-workflow off` withdraws the tools, skill, triggers and guards, and the resident cost drops to zero. The command stays, so `/dev-workflow on` brings it back.

## Boundaries

- It does not replace CI. It is a pre-flight check; CI is the verdict.
- It does not review code, run tests, or format anything.
- It does not decide for you: the question is asked of you, and your refusal stands.
- It does not guess. When it cannot read the commit message or the changed-file list, it says that rule did not run instead of reporting a pass.
- Some paths it cannot see are listed under "what we cannot see" in [docs/TRIGGERS.md](docs/TRIGGERS.md). That table is a promise, not a disclaimer.

## Requirements

| Component | Version | Notes |
| --- | --- | --- |
| DeepSeek Harness runtime | `0.2.0-rc.2` or `0.2.1-rc.2` | `dsh --version` |
| Node.js | `>=20` | required by dsh itself |
| pnpm | any; not checked | only needed by `dsh plugin`, and it must be on `PATH` |

Those are the only two versions, not a range: they are the ones this plugin has actually been loaded on, and a range would also claim every 0.2 prerelease in between and every 0.3 after them. The cost is that a new DSH prerelease needs a new release of this plugin — which is the honest direction, because "not tested" should read as "unsupported". When the version is one of the others, **`dsh plugin add` refuses the install outright** (`dsh: installation rejected: Plugin … is incompatible with dsh …`, nothing is installed) and prints the `dsh plugin allow-version` escape hatch. An already-installed older copy behaves differently: the plugin is disabled at startup with `dsh: disabling profile plugin …` on stderr, and the rest of the profile loads normally. Both say why; neither is silent. Check `dsh --version` against the list above before filing a bug, and paste the output of `/dev-workflow status` into the issue; how the list is chosen is in [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Documentation

- [docs/README.md](docs/README.md) — the index of all documentation: start here and pick a reading path.
- [docs/SECURITY.md](docs/SECURITY.md) — what each of the five guards stops, why the defaults are what they are, and the known boundaries.
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — every adjustable field and its default, including the file-only settings the panel does not show.
- [CHANGELOG.md](CHANGELOG.md) — release history, Keep a Changelog format.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to set up, branch, commit, and submit changes.

## Contributing

Contributions are welcome — read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

[MIT](LICENSE) © 2026 Melosic
