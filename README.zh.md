# dsh-dev-workflow

<p align="center">
  <strong>中文</strong> | <a href="README.md">English</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@melosic/dsh-dev-workflow"><img src="https://img.shields.io/npm/v/@melosic/dsh-dev-workflow?style=flat-square&color=6c5ce7" alt="npm"></a>
  <a href="https://www.npmjs.com/package/@melosic/dsh-dev-workflow"><img src="https://img.shields.io/npm/dm/@melosic/dsh-dev-workflow?style=flat-square&color=4b6fff" alt="npm downloads"></a>
  <a href="https://github.com/Melosic/dsh-dev-workflow/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Melosic/dsh-dev-workflow/ci.yml?style=flat-square&label=CI" alt="CI"></a>
</p>

<p align="center"><strong>给 <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> (dsh) 加一道规范闸门</strong></p>

<p align="center"><sub>提交前查提交信息 · 开 PR 前查描述 · 发版前查版本号 · 不可撤销的命令先问一句 · 常驻 200–250 token</sub></p>

<p align="center"><code>dsh plugin --profile web add @melosic/dsh-dev-workflow</code></p>

---

如果你的 `git commit`、`gh pr create`、`git tag` 是让 Agent 代跑的，这套检查就是给你准备的。下面只讲它什么时候会插一句、为什么。

## 为什么

每个项目都会写下一些规范——提交信息怎么写、PR 要哪几段、版本号怎么定。它们通常散在 `AGENTS.md`、`CONTRIBUTING.md` 和一两份文档里。

文字不会自己执行。读到规则和照着规则做是两件事：指南写着标题不超过 50 字，Agent 还是可能写出 62 个字。这个插件把能机器核对的部分变成检查——在提交、PR、发版三个节点替你核对，在不可逆的动作前停下来问一句。

它省掉的是事后返工：

- 提交信息被 CI 打回，再 `--amend` 一次；
- PR 描述缺段被退回，再改一遍；
- 发版后才发现 tag 与 `package.json` 对不上。

它只管三类动作：提交之后就不好改的、推上去别人就看见的、执行了就回不来的。

下文反复出现两个词：

- **触发器**：在提交、开 PR、发版这三个时刻核对规范。
- **守卫**：在命令或文件操作执行前拦一步。

## 它什么时候说话

| 你在做什么 | 它做什么 |
| --- | --- |
| `git commit` | 查提交信息格式；`feat` 是否补了 CHANGELOG；文档是否跟着代码改 |
| `gh pr create` | 查描述是否含模板要求的段落、清单是否勾完、是否关联 Issue |
| `git tag` / `npm publish` | 查版本号是否语义化、tag 与 `package.json` 是否一致、CHANGELOG 是否有对应段落 |
| `git reset --hard`、`rm -rf`、`git push --force` | 先停下来问一句 |
| 读 `.env`、参数里带真实密钥 | 拒绝，无逐次放行 |

其余时候不吭声。

拦下时给一句理由，加一条更安全的替代做法：

> **force push 会重写远端历史，可能丢掉他人的提交。**
> 建议改用 `--force-with-lease`：它会拒绝覆盖你尚未看到的提交。

## 怎么工作

插件挂在 DSH 的工具执行链上。每次 Agent 要跑一条命令或写一个文件，它先看一遍：

![dsh-dev-workflow 怎么工作](https://raw.githubusercontent.com/Melosic/dsh-dev-workflow/main/docs/assets/how-it-works.png)

一层判「合不合规范」——提交信息、PR 描述、版本号；一层判「回不回得来」——会丢工作、会重写历史、会被别人看见。两层同时命中时，提示只有一条，把两组理由合并显示，不会连问两次。

规范全文也不在这条路径上：它以一行摘要常驻，需要时才读，所以常驻成本只有 200–250 token。

## 五道守卫

| 守卫 | 拦什么 | 默认档位 |
| --- | --- | --- |
| 命令 | `rm -rf /`、`mkfs`、`dd of=/dev/sda` —— 不可撤销 | 问 |
| git | `reset --hard`、`clean -f`、`push --force`、删分支、`--no-verify`、`git restore .` | 问 |
| 对外 | `push`、`tag`、`gh pr create`、`gh issue create`、`npm publish` —— 别人会看见 | 问 |
| 敏感文件 | `.env`、`*.pem`、私钥、`credentials` 文件与目录 | 拒 |
| 凭据 | 命令行参数里出现真实密钥 | 拒；只读的命令行除外 |

前三道默认「先问」：这些动作本身多数合法，只是值得确认一次。后两道默认「拒」——读一个私钥没有「确认之后就没问题」的情形，把路径展示在审批框里反而是二次泄露，所以不给逐次放行。真正会误伤的场景已经排除：`.env.example` 这类样本文件不算，`grep -rn "credentials" .` 这种「查它有没有入库」的搜索也不算（搜索表达式不是路径）。要让某个文件可读，只有把它从 `fileGuard.noRead` 里去掉，或整关这道守卫。

凭据守卫有一个例外，它是一条判断而不是一个开关：一行里每个程序都只读时——`grep`、`rg`、
`sed -n 's/…/…/p'`、`git log -S`——放行并记一笔。值已经在模型刚写下的参数里，拒绝搜索
既删不掉它，也拦不住它外流，只会让找泄漏的人更难发现；只要这一行里有一个程序能写出或发送，
拒绝就照旧。判断看的是这行**真正会执行什么**，不是它写着调用谁：`sed -i` 把结果写回文件，
`sed -f` 读的脚本不在这行上，`e` 标志（`s/a/b/e`）会执行替换文本，`$(…)` / `<(…)` 能把另一个
程序藏进一个词里——这几种都不算只读。

关掉审批的会话里，「问」按拒绝处理，并把「怎么放行」写进提示。

## 安装、更新、卸载

### 在窗口里装

左上角 `插件` → 右上方 `添加插件` → 输入包名 → `安装`：

```
@melosic/dsh-dev-workflow
```

![添加插件弹窗，已填入 @melosic/dsh-dev-workflow](https://raw.githubusercontent.com/Melosic/dsh-dev-workflow/main/docs/assets/install-dialog.png)

装完回到插件列表，确认它是启用状态。

弹窗里的「安装源」默认跟随你自己的 pnpm 配置，也可以直接选 npm 官方源或中国大陆镜像源。国内网络环境下 `registry.npmmirror.com` 通常明显更快。

这条路径在桌面应用里同样可用，也是**唯一不需要碰命令行**的方式。

### 命令行

装进你启动 dsh 时用的那个 profile。用 `dsh web` 启动的就是 `web`：

```bash
dsh plugin --profile web add @melosic/dsh-dev-workflow
```

随 dsh 一起提供的模板还有 `headless`、`acp`、`sdk`、`sdk-minimal`；自建的 profile 换成它的名字。

**桌面应用例外**：它的 profile 叫 `desktop`，普通 `dsh` 命令拒绝管理（会报 `profile "desktop" is managed exclusively by the Electron application`），要用应用自带的那一个：

```bash
"<桌面安装目录>/resources/runtime/cli/bin/dsh.cmd" plugin --profile desktop add @melosic/dsh-dev-workflow
```

用 DSH 的安装器，不要用 `npm install`：profile 只加载 `dsh.profile.bundles` 里点名的组合包，安装器负责同时写依赖和这个条目。

```bash
# 更新 / 卸载，上面那种 profile 前缀照抄
dsh plugin --profile web add @melosic/dsh-dev-workflow@latest
dsh plugin --profile web remove @melosic/dsh-dev-workflow
```

装完重载 dsh，执行 `/dev-workflow status` 确认它在工作：

```console
$ /dev-workflow status
dev-workflow 已开启。规范以简短摘要常驻，细节按需读取。
语言：zh-CN（配置为 "auto"）。
生效范围：所有仓库。当前工作目录会被检查。
本会话还没有跑过检查。
守卫命中次数：无。
安全审计已启用。守卫决策会追加到 .dev-docs/audit-log.jsonl，该文件不进入模型上下文。是否被 git 跟踪取决于本仓库的 .gitignore。
```

第一行是「已开启」就装对了。如果写的是「本会话已关闭」或「当前仓库没有标记」，它是在**故意**不工作——输入 `/dev-workflow on` 恢复，或按下一节建标记文件。

行为在设置面板里改，每一项都无需重启。

## 配置

默认值取通用约定（Conventional Commits + Keep a Changelog），机器能查的每一项都能改：类型表、是否要求 scope、标题长度、PR 要哪些段落、CHANGELOG 分类名、发版用哪些工具。按你项目自己的指南调一遍，它就是那个项目的闸门，而不是这个仓库的。完整字段见 [docs/CONFIGURATION.md](docs/CONFIGURATION.md)。

- **按仓库生效，不按机器。** `scope: 'marked'` 让规则只作用于根目录带 `.dsh/dev-workflow.yml` 的仓库，其它仓库里守卫和触发器都不出声、技能目录行也不出现（两个工具定义是进程级注册，会跟着进程走）。
- **常驻 200–250 token。** 规范全文按需读取，常驻的只有两个工具定义和一行技能目录，见 [docs/TOKEN-BUDGET.md](docs/TOKEN-BUDGET.md)。
- **`off` 是真的关掉。** `/dev-workflow off` 注销工具、技能、触发器与守卫，常驻增量归零；命令本身留着，`/dev-workflow on` 随时开回来。

## 边界

- 不替换 CI。它是提交前的一道预检，CI 才是最终判定。
- 不评审代码、不跑测试、不做格式化。
- 不替你做决定：拦下时问的是你，你拒绝就是拒绝。
- 不猜。读不到提交信息、拿不到改动文件列表时，它会说「这条规则没执行」，而不是假装通过。
- 有看不见的路径，列在 [docs/TRIGGERS.md](docs/TRIGGERS.md) 的「我们看不见什么」一节里。那张表是承诺，不是免责声明。

## 环境要求

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| DeepSeek Harness 运行时 | `0.2.0-rc.2` 或 `0.2.1-rc.2` | `dsh --version` 可查 |
| Node.js | `>=20` | dsh 自身的要求 |
| pnpm | 不校验版本 | 只在 `dsh plugin` 安装时需要，必须在 `PATH` 上 |

只有这两个版本，不是一个范围：它们是本插件真正被加载过的版本，写成范围会把中间那些 0.2 预发布和之后的每一个 0.3 一起宣称成兼容。代价是 DSH 每出一个新预发布，本插件就得发一版跟着走——方向是对的，因为「没测过」本来就该读作「不支持」。版本不是这两个时，**`dsh plugin add` 会直接拒绝安装**（`dsh: installation rejected: Plugin … is incompatible with dsh …`，什么都不装），并给出 `dsh plugin allow-version` 这条应急口子。已经装着的旧版本则是另一种表现：启动时该插件被禁用，stderr 打印 `dsh: disabling profile plugin …`，其余插件照常加载。两种情况都会明说原因，不会悄无声息。报 bug 之前先用 `dsh --version` 对一下上面的版本清单，并把 `/dev-workflow status` 的输出贴进 issue；这份清单怎么定见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。

## 文档

- [docs/README.md](docs/README.md) —— 全部文档的索引，从这里挑一条阅读路径。
- [docs/SECURITY.md](docs/SECURITY.md) —— 五道守卫各拦什么、默认值为什么是这些、已知的绕过边界。
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) —— 全部可调字段与默认值，含面板里没有的文件级设置。
- [CHANGELOG.md](CHANGELOG.md) —— 版本历史，Keep a Changelog 格式。
- [CONTRIBUTING.md](CONTRIBUTING.md) —— 环境搭建、分支、提交与提交流程。

## 贡献

欢迎贡献——请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © 2026 Melosic
