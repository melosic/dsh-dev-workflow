# 配置参考

本文件是 `src/config.ts` 的对照说明。配置面由 Schemastery 声明，**每个字段都带默认值**，
因此空配置解析出的就是文档里描述的基线：插件开着、危险 git 操作、对外可见动作与危险 shell
命令一律 `ask`、没有任何操作被默认放行、五道守卫与审计记录全部启用。

配置写在 DSH profile 里，`apply` 之前由宿主完成校验与填默认值——插件内部永远看不到「未填」的状态。
它也可以在 DSH 设置里的**可视化面板**中修改，两条路写的是同一份配置源：面板保存后落进当前
profile 的 `cordis.patch.yml`，插件无需重启就会读到新值（详见 [可视化面板](#可视化面板)）。

## 顶层

| 字段 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `codePaths` | `string[]` | `['src/']` | 算作「代码」的路径前缀，用于判断文档是否滞后 |
| `docs` | 对象 | 见下 | 文档相关路径 |
| `rules` | 对象 | 见下 | 机械约定 |
| `commitCheck` | 对象 | 见下 | 提交信息检查的开关、档位与类型清单 |
| `prSections` | `string[]` | `['What', 'Why', 'How to verify', 'Type of change', 'Non-goals', 'Risk and rollback', 'Checklist']` | 兜底的 PR 描述段落名。保持默认值时不生效，判定读仓库自己的模板文件；只能在配置文件里声明 |
| `docsCheck` | 对象 | 见下 | 文档同步检查的开关 |
| `releaseCheck` | 对象 | 见下 | 发版前检查的规则开关、版本号模式，以及分类名 / 待发布段名 / 发版程序 |
| `mode` | `'on' \| 'off'` | `'on'` | 总开关。`off` 不注册任何东西，常驻成本为零 |
| `scope` | `'all' \| 'marked'` | `'all'` | 按仓库生效。`marked` 只检查项目根目录带 `.dsh/dev-workflow.yml` 的仓库，见下 |
| `locale` | `'auto' \| 'en-US' \| 'zh-CN'` | `'auto'` | 本插件自身文案的语言（**不是**设置页的语言，也**不**决定模型怎么写提交信息） |
| `enableOwnTrigger` | `boolean` | `true` | 是否运行自带的三个约定检查（提交前、PR 前、发版前） |
| `gitGuard` | 对象 | 见下 | 危险 git 操作的策略 |
| `outwardGuard` | 对象 | 见下 | 对外可见动作（推送、标签、PR、issue、发布）的策略 |
| `commandGuard` | 对象 | 见下 | 危险 shell 命令的策略 |
| `fileGuard` | 对象 | 见下 | 不许读取的敏感路径 |
| `secretGuard` | 对象 | 见下 | 凭据泄漏预防 |
| `audit` | 对象 | 见下 | 审计记录的开关与路径 |

### `scope: 'marked'`：按仓库生效

DSH 的启用单位是 profile，而 profile 是按机器存在的：插件装进一个 profile，这台机器上的每个
工作目录都会用上它。工作流规则却不是机器的属性，而是仓库的属性——同一个 profile 里，有的仓库
想要这套门禁，有的仓库不想要。

`scope: 'marked'` 就是给这件事的一个开关：只有**项目根目录**带 `.dsh/dev-workflow.yml` 的仓库
才被检查，其余仓库里触发器、五个守卫、技能目录行全部安静。标记文件只看在不在，
内容不解析——一个不可能被配错的标记比一个能配错的更有价值。

它省不掉工具定义：`ctx.tools.register` 是进程级注册，不看工作目录，所以未标记的仓库里仍然
常驻两个工具定义（约 520–770 字符），只是不再出现技能目录行。真正的零常驻只有 `mode: 'off'`。

项目根目录取的是「向上最近的 `.git`」，与 DSH 自己对项目根的定义一致，所以在仓库子目录里发起
调用也能命中同一个根。目录的向上查找会缓存，标记文件的存在性不缓存：会话进行中新建或删掉标记，
下一次工具调用就生效，不需要重启。

标记不用手写：在要启用的仓库里敲 `/dev-workflow mark` 就会建好（连 `.dsh/` 目录一起），
它建的文件带三行注释说明自己是什么，可以直接提交；`/dev-workflow unmark` 删掉它。
`status` 在 `marked` 档下会说明当前仓库在不在范围内，没标记时那句提示里直接给出 `mark` 的用法——
不用先知道路径。

面板上没有「选文件夹」的等价控件：面板只写 profile 的配置值，而这件事是**逐仓库**的，落的是
仓库里的文件，不是 profile 里的字段。所以它只能是一个命令。

默认是 `all`。反过来把 `marked` 设成默认，等于让所有还没建标记的仓库静默失去检查——那是把安全
放松伪装成默认值。

### `locale: 'auto'` 的解析时机

`auto` **在每次需要文案时解析**（`src/index.ts` 的 `refreshLocale()`，`t()` 与 `runtime.locale()`
都会调用它），判断依据是 `Intl.DateTimeFormat().resolvedOptions().locale` 是否以 `zh` 开头。
字典只在解析结果真的变化时才重建。

这样技能目录条目与技能正文始终是同一种语言（两者都经过同一个 `refreshLocale()`），
同时也不是「只能重启才能换」：面板改 `locale` 后，宿主把新值提交进运行中的配置，
插件收到 `loader/volatile-update` 就重新解析一次，技能与提示语随之切换。
要写死在文件里就显式写 `en-US` 或 `zh-CN`。

面板在选中 `auto` 时会直接写出它当前解析成哪个语言（例如「当前为：中文（zh-Hans-HK）」）：
宿主在 node 进程里解析，面板只能在浏览器里问同一台机器的 `Intl`，两边用的是同一条
`zh` 前缀规则。这是面板自己的复刻，不是宿主回传的真值 —— 两者理论上可能不一致
（同一台机器上实际不会）。

这一项管的是**插件自身产出的文案**：检查结果、技能正文、审批提示。它管不到、也不该被理解成
「让模型用哪种语言写提交信息」——提交信息的语言规则写在技能里（subject 一律英文，正文与页脚
项目内自选一种），两种语言下的规则逐字相同。设置页本身的文案跟随 DSH 界面的语言（面板走客户端
`locale` 服务，`client.js` 里注册了 `settings.devWorkflow` 这个命名空间），改这一项不会切换设置页的语言。

## `docs`

| 字段 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `readme` | `string[]` | `['README.md', 'README.zh.md']` | 哪些文件算「README 类文档」 |
| `changelog` | `string` | `'CHANGELOG.md'` | CHANGELOG 的路径 |
| `docsDir` | `string` | `'docs/'` | 文档目录；其下的文件都算文档 |
| `exclude` | `string[]` | `[]` | 算作文档的路径前缀；命中的文件不再被当成代码改动，因此不会触发文档滞后检查 |
| `mirrors` | `string[][]` | 三组 | 必须一起改动的文件组，每组一行 |

`mirrors` 的默认值是本仓库真实存在的三对文件：

```js
[
  ['README.md', 'README.zh.md'],
  ['locale/en.json', 'locale/zh.json'],
  ['skills/dsh-dev-workflow/SKILL.md', 'skills/dsh-dev-workflow/SKILL.zh.md'],
]
```

判定规则（`src/tools/check-doc-sync.ts`）分两级：

- 某一组里有文件被改动、其他文件**完全没被碰**，且那个文件**仓库里本来就有** → **报错**（阻塞）。
- 其他文件正躺在暂存区或工作区里编辑（成对的另一个文件也在这次改动里） → **只警告**
  （「分支推出前把这一对补完」）。

「本来就有」这一条是为新仓库留的：全新项目第一次提交只暂存 `README.md`，`README.zh.md` 从未
存在过，不该被当成漏改。所以往 `mirrors` 里加一组之前，先确认那两份文件在仓库里真的存在；
只打算以后才写的文件，先别放进 `mirrors`。

而且判定的是**这次提交**（`git diff --cached`），不是整个工作区。工作区只用来区分上面两种情况——
否则一个「README 只改了一半挂着」的仓库会拦住所有无关提交。`/dev-workflow check` 判定的才是工作区。

`exclude` 在判定「这是不是一个代码改动」之前生效：命中前缀的路径既不算代码，也不算文档，
于是它可以用来把生成物、快照或脚本放进 `docs/` 这类目录里而不误报。

## `rules`

| 字段 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `requireChangelogOnFeat` | `boolean` | `true` | `feat` 提交必须带上 CHANGELOG 改动，否则阻塞（本次提交或分支已有都算） |

分支命名与提交头部格式都不在这里配：前者是团队约定、插件不检查（没有触发器盯「建分支」这个
动作，见 `docs/TRIGGERS.md`），后者的类型清单是 `commitCheck.types`、长度是
`commitCheck.subjectMaxLength`，实际检查读的就是它们。

`COMMIT_TYPES` 为 `feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` /
`ci` / `chore` / `revert`，可在面板勾选。

## `prSections`

| 字段 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `prSections` | `string[]` | `['What', 'Why', 'How to verify', 'Type of change', 'Non-goals', 'Risk and rollback', 'Checklist']` | PR 描述必须填的段落名，缺一段或段内为空都阻塞。**保持默认值时不生效**，判定改看仓库自己的模板文件 |

段落名属于**仓库模板**，不属于工作流本身。插件会先找 `.github/pull_request_template.md`
（以及 GitHub 认的其余几个写法，如 `PULL_REQUEST_TEMPLATE.md`、`docs/` 下的同名文件），
把它的 `##` 标题映射到七种角色，按模板判。所以一个中文模板、或把段落叫 `背景` / `改动` /
`验证` 的仓库，不改配置也能被正确判定。

这个字段是**兜底与覆盖**：模板里一个可识别的标题都没有（写作规范自由的仓库）时判定会关掉、
只要求描述非空；模板不便改、或要在模板之外多要求几段时，才在配置里列出全部段落——**只要
这一项不是默认值，就以它为准，模板不再读**。

只在配置文件里声明，面板不显示——面板只有开关、分段、数字、勾选四种控件，没有文本输入框，
强行做成控件只能给出一组写死的选项，那比不改更糟。判定时大小写不敏感，标题层级必须是 `##`。
数组顺序只影响报错时列出缺失段落的顺序。

```yaml
# ~/.dsh/profiles/<name>/cordis.patch.yml
- id: dsh-dev-workflow
  config:
    prSections: ['背景', '改动', '验证']
```


## `releaseCheck`

| 字段 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `semver` | `boolean` | `true` | 版本号必须是 `MAJOR.MINOR.PATCH`（可带预发布后缀） |
| `changelog` | `boolean` | `true` | CHANGELOG 必须承载这次发版，或有非空的待发布段 |
| `changelogCategories` | `boolean` | `true` | `###` 标题不在 `categories` 里时提示一句（只提示，不阻塞） |
| `categories` | `string[]` | `['added','changed','deprecated','removed','fixed','security']` | 允许的 `###` 分类名，大小写不敏感；只能在文件里声明 |
| `unreleased` | `string` | `'Unreleased'` | 发版所切的那一段的标题，大小写不敏感、带不带方括号都认；只能在文件里声明 |
| `publishers` | `string[]` | `['npm','pnpm','yarn','bun']`（含 `.exe`） | 哪些程序的 `publish` 子命令算发版；只能在文件里声明 |
| `prereleaseTag` | `boolean` | `true` | 预发布版本不许发到 `latest` |
| `versionPattern` | `string` | 语义化版本正则 | 版本号的完整匹配正则；只能在文件里声明 |

后四个字段回答的是同一类问题：**这套发版规则假定的是 Keep a Changelog + JavaScript 包管理器，
而你的仓库不一定如此**。一个用 `## 未发布` 的中文 CHANGELOG、一个用 `### 修复` 做分类的仓库、
一个用 `cargo publish` 发版的 Rust 项目，都不该为了躲开误报而把整条规则关掉——关掉规则就连真正
的问题一起放过了。

`unreleased` 与 `categories` 都只做**名字**上的对齐，判定逻辑不变：仍然是「这一段在不在」、
「段内是不是空的」、「`###` 标题在不在名单里」。

`versionPattern` 写成一个不能编译的正则时，会**静默回退**到内置的语义化版本匹配（不会让插件
崩掉，也不会把每次打 tag 都变成错误）。这是一个有意的取舍：发版检查宁可漏掉自定义格式，也不能
因为一条配置写错就让发版流程完全停住。改完这个字段后，打一个测试 tag 确认它按你的预期匹配。

`publishers` 同时被发版前检查和对外动作守卫读取：加一个 `cargo`，`cargo publish` 才会被问
「版本号对不对、CHANGELOG 写了没」。

```yaml
# ~/.dsh/profiles/<name>/cordis.patch.yml
- id: dsh-dev-workflow
  config:
    releaseCheck:
      unreleased: 未发布
      categories: ['新增', '修复', '变更']
      publishers: ['cargo']
```

### `requireChangelogOnFeat` 与文档检查的分工

`check_doc_sync` 已经会软提示「改了代码但没动 CHANGELOG」。仓库规则把其中一种情况升级为硬规则：

| 提交类型 | 缺 CHANGELOG | 结果 |
| --- | --- | --- |
| `feat` | 是 | **阻塞**（`rules.requireChangelogOnFeat`） |
| 其它类型 | 是 | 软警告 |

同一次判定里只会出现一条：升级为阻塞时，那条软警告会被移除，不重复提示同一件事
（`src/checks.ts:309-318`）。

## `commitCheck`

| 字段 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 提交信息检查的开关。`false` 时提交前不再跑 `check_commit_message`，工具本身仍可手动调用 |
| `onFailure` | `'warn' \| 'block'` | `'block'` | 检查出的**硬性错误**是阻塞（默认）还是降级为警告 |
| `types` | `string[]` | 11 项 `COMMIT_TYPES` | 允许的提交类型 |
| `requireScope` | `boolean` | `false` | `true` 时「缺 scope」从软警告升为硬错误 |
| `subjectMaxLength` | `number` | `50` | 标题最长字符数，`min(1)` 且必须是整数 |

### 硬性错误与建议性警告

检查信息本身的轻重是固定的，`onFailure` 只决定「硬性错误要不要挡住提交」：

| 问题 | 轻重 |
| --- | --- |
| 头部不匹配 / 类型不在 `types` 里 | 硬性错误 |
| 标题超过 `subjectMaxLength` | 建议性警告 |
| 标题以句点结尾 | 建议性警告 |
| `!` 标了破坏性变更却没有 `BREAKING CHANGE:` footer | 建议性警告（`!` 本身已合规） |
| 缺 scope | 建议性警告；`requireScope: true` 时升为硬性错误 |

`onFailure: 'warn'` 只降级提交信息自身的硬性错误，**不影响文档同步检查**：那是另一类问题，
不该因为「这次只想提醒提交话术」而被一起放过。

**三档与 `onFailure` 合起来就是「major / minor」的实现，不是两套机制。** 想要求「破坏性变更必须
被明确确认」就配 `deny`；想让它提醒后放行就配 `ask` + `onFailure: 'warn'`；想完全不管就配
`allow`。已有的建议性警告（标题长度、句点、缺 scope）就是「advisory」这一档，并且是按字段
可调的（`subjectMaxLength`、`requireScope`）——不需要另起一套 advisory 通道。

> **子代理里没有审批面。** 策略设成 `ask` 时，如果当前调用来自子代理，审批服务返回
> `unavailable`，按 `deny` 结算（`src/guard/approval.ts:154`）。即「问不到人就不放行」，
> 不会因为问不到而降级成允许。守卫本身在子代理里照常生效。

`types` 在面板上是 11 个复选框；直接从文件改可以加入自定义类型，面板会把已选中的自定义值
原样保留并一并提交。

## `docsCheck`

| 字段 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 文档同步检查的开关 |
| `requireReadmeOnConfig` | `boolean` | `false` | 改动 `package.json` 或 `cordis.patch.yml` 却没动 `docs.readme` 里的任何文件时给一条警告 |

`docsCheck.enabled` 只作用于**提交前**那一次 `evaluate()`（连同其中的镜像配对与
`rules.requireChangelogOnFeat`）。`check_doc_sync` 工具不受它影响，始终是个可手动调用的检查——
否则面板上关掉它就会让「文档是否同步」这个问题彻底无法提问。

## `gitGuard`

| 字段 | 类型 | 默认值 | 拦截什么 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 守卫总开关 |
| `forcePush` | 动作 | `'ask'` | `git push --force` / `-f` / `--mirror` / `+refspec` |
| `hardReset` | 动作 | `'ask'` | `git reset --hard` |
| `rebase` | 动作 | `'ask'` | `git rebase`（会重写历史；`--continue` / `--abort` / `--skip` 是恢复操作，不问） |
| `amend` | 动作 | `'ask'` | `git commit --amend` |
| `branchDelete` | 动作 | `'ask'` | `git branch -D`、`--delete --force`、`git push --delete` |
| `cleanForce` | 动作 | `'ask'` | `git clean -f`（删未跟踪文件） |
| `checkoutDiscard` | 动作 | `'ask'` | `git checkout -- <path>`、`git checkout .`、`git restore <path>` / `.`（丢弃未暂存改动） |
| `noVerify` | 动作 | `'ask'` | `--no-verify`（跳过 git 钩子） |
| `rememberApproved` | `boolean` | `false` | 同会话内已批准过的同一条命令不再重复询问（需要档里挂了审批通道）。**git 与对外动作两道守卫共用**：批准过一次的 push / tag / publish 同样不再问 |

「动作」是 `'deny' | 'ask' | 'allow'` 之一：

- `deny`：直接拒绝，工具调用带 `Error: <理由>` 返回给 agent。
- `ask`：走审批提示。**宿主没有审批能力时，DSH 会把 `ask` 变成拒绝**——宁可挡住，也不假装问过。
- `allow`：放行。**没有任何一项的默认值是 `allow`。**

### 三个不显然的默认值

**`noVerify` 默认 `ask`，绝不 `deny`。** `--no-verify` 是钩子本身出错时的逃生通道
（紧急修复、钩子误报）。把它默认改成 `deny` 会在最需要它的时候切断它。给它 `ask` 的意义是
「让人知道自己在跳过什么」，而不是「禁止跳过」。

**`rebase` 默认 `ask`，不是 `allow`。** rebase 会重写历史；已经推送过的分支上做这件事，
别人拉到的是被改写的提交。

**`cleanForce` 不复用 `hardReset` 的策略。** 两者丢弃的是不同的东西：`reset --hard` 丢的是
已跟踪文件的改动，`clean -f` 删的是未跟踪文件——后者更可能是「还没进版本控制的新工作」。

### 更严者胜

一条命令行里可能同时命中多项，例如 `git push --no-verify --force origin main`。判定按
`deny > ask > allow` 取最严的一条。逐条识别规则与「同级时先入列者胜」的细节见
[docs/TRIGGERS.md](TRIGGERS.md) 的「守卫危险 git 命令」一节——这里不再复述一遍。

### `rememberApproved` 的记忆范围

DSH 的审批层是**一次性**的：`ApprovalOutcome` 里只有 `allowed-once`，没有 `allow-always`，
也没有授权存储（`dsh-user-approval` 的 README 明说这一点）。而守卫把 `ask` 交给 dispatcher 后
**拿不到那次提问的答案**。所以「记住我的选择」只能由插件自己发起提问：

`rememberApproved: true` 时，命中的操作若策略为 `ask`，git 守卫会自己经 `ctx.get('approval')`
发起审批，然后按答案处理：

| 答案 | 处理 |
| --- | --- |
| `allowed-once` | 放行，并把这次操作记进本会话 |
| `rejected` | 拒绝（`security.guard.approval_rejected`） |
| `cancelled` | 拒绝（`security.guard.approval_cancelled`） |
| `unavailable` | 拒绝（`security.guard.approval_unavailable`） |

被记住的是**一次具体调用**：工具名加上序列化后的参数（对象键按字典序归一化，所以同一份参数
换个书写顺序仍是同一次操作）。所以 `git clean -f` 与 `git clean -f -d` 是两次操作，换工作目录也是。
记忆按会话隔离，插件重新加载即清空，绝不落盘。

**这道开关同时管对外动作守卫。** 它住在 `gitGuard` 下，但 git 与 outward 两道守卫共用同一份
批准记录：批准过一次的 `git push` / `git tag` / `npm publish` 在同一个会话里不再重新点头。
默认关闭——**一次同意不等于整个会话的授权**，重度用户自己打开它来止住提示疲劳。

边界（这几条是刻意的）：

- **只作用于 `ask`。** `deny` 永不经过这条路——把某项设成 `deny` 之后不存在「批准过一次就放行」。
- **拒绝不会被记成批准。** 只有 `allowed-once` 才写入记忆，其余三种都会在下一次重新提问。
- **`rejected` 不等于「用户点了拒绝」。** 审批策略为 `never`（例如 `danger-full-access` 预设）
  时，`dsh-user-approval` 的 `decide()` 会**在提问之前**直接返回 `rejected`
  （`dsh-user-approval/lib/index.js:175 if (this.effectivePolicy(session) === "never") return "rejected"`），
  根本没有人被问过。所以 `security.guard.approval_rejected` 只陈述结果（未获批准），
  不写「你拒绝了」——那会把平台的自动拒绝说成用户的决定。
- **没有审批通道时不自行提问。** 档里没挂审批服务、或这次调用没有 agent，守卫就把问题交回
  dispatcher（与开关关闭时逐字相同的行为），绝不把「问不出来」当成「同意了」。
- **不吞并别的 gate。** 若另一个 listener 已经拒绝，或者已经要提问，守卫不会自己再问一次：
  别的 gate 的答案不是它该记的。

### 权限策略为 `never` 时会发生什么

`danger-full-access` 预设把审批策略设为 `never`。它**不是「全部批准」**：`dsh-user-approval`
的 `decide()` 在询问任何审批方之前就返回 `rejected`（`dsh-user-approval/lib/index.js:175`），
于是 `dsh-tools` 把这次拒绝渲染成 `the user rejected tool "..."`（该包 `lib/index.js:3468`）。
用户什么都没看到，模型却被告知用户做了决定。

所以本插件的每一道 gate（五道守卫 + 三个触发器）在返回 `ask` 之前先读本会话的有效策略
（`effectivePolicy(session)`）。策略是 `never` 时，gate **自己**返回 `deny`：

- 结果与之前完全相同——该操作都是被拒绝；
- 理由保留 gate 自己的判定（是哪次 force push、哪个提交信息不合规），并追加
  `approval.disabled`（双字典同步），说明**没有人被问到**，以及两条放行路径：切换到会
  提问的权限预设，或把对应项设为「允许」而非「询问」。后者**会一直生效**直到改回
  「询问」——正是「已覆盖」徽标标记的那种字段，忘了改回来就会长期静默放行，所以文案里
  把这个代价一并写出，而不是只留给用户自己想到。

刻意**不**改成静默放行：守卫静默放行就不是守卫（`src/guard/git-guard.ts:16-17`）。
读不到策略（档里没挂审批服务、审批服务没实现这个方法）或这次调用没有会话时，行为
与之前逐字相同——维持 `ask`，交给 dispatcher。**不知道就不猜**，否则会把一个能正常
提问、能被批准的操作变成拒绝。实现见 `src/approval-policy.ts` 的 `unaskable()`。

## `outwardGuard`

前面几道守卫拦的是「东西会丢」。这一道拦的是**本机不会丢、但别人立刻看得见**的动作。
默认 `ask`，识别细节与能力边界见 [docs/TRIGGERS.md](TRIGGERS.md) 的「守卫对外可见动作」。

| 字段 | 类型 | 默认值 | 拦截什么 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 守卫总开关 |
| `push` | 动作 | `'ask'` | 任意 `git push`（不含 `--dry-run`）；强推另由 `gitGuard.forcePush` 判定 |
| `tag` | 动作 | `'ask'` | `git tag <name>` 建标签；`-l` / `-d` / `-v` 这类读操作不算 |
| `pullRequest` | 动作 | `'ask'` | `gh pr create`；`gh pr list` / `view` 不算 |
| `issue` | 动作 | `'ask'` | `gh issue` 的写操作（`create`、`comment`、`close` 等）；`list` / `view` / `status` 不算 |
| `publish` | 动作 | `'ask'` | `npm publish` / `pnpm publish` / `yarn publish` / `bun publish`；`--dry-run` / `-n` 不算 |

五项默认都是 `ask` 而非 `deny`：这是唯一一道**本机不会造成任何损失**的守卫，要的是用户
点头同意，而不是禁止这类操作。`git push --force` 同时命中本守卫与 `gitGuard.forcePush`，
理由按「更严者胜」由强推那条给出。

## `commandGuard`

检测危险 shell 命令。命令文本从工具调用的 `command` 字段读取，**不绑定具体工具名**
（本机是 `pwsh`，别处可能是 `bash`），判定复用 `src/shell.ts` 的词法切分。

| 字段 | 类型 | 默认值 | 拦截什么 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 守卫总开关 |
| `dangerousShell` | 动作 | `'ask'` | `rm -rf /`、`rm -rf ~/*`、`rm -r /etc`、`//`、`mkfs`、`dd ... of=/dev/sda`、fork 炸弹、`chmod -R 777 /` |

普通删除（`rm -rf node_modules`、`rm -rf ./dist`、`rm -rf /tmp/build`）不命中：判定看的是
**目标**，不是 `-rf` 本身。根级与家目录级的递归删除**不要求同时带 `-f`**——`rm -r /etc`
不问的话它照样删掉整棵树，`-f` 只决定要不要弹一次确认。完整清单见
[docs/SECURITY.md](SECURITY.md#command-guard-保护什么)。

## `fileGuard`

从工具调用的参数里取路径并在**不打开文件**的前提下比对，命中即 `deny`。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 守卫总开关 |
| `noRead` | `string[]` | 见下 | 不许读取的路径模式 |

```json
{ "fileGuard": { "noRead": [".env", ".ssh/id_rsa", "*.pem", "*.key", "credentials/", "*.p12", ".npmrc", "secrets/"] } }
```

模式语法有四条规则：尾随 `/` 匹配该目录及其中一切；含 `/` 的模式在任意深度匹配
（`.ssh/id_rsa` 命中 `C:/Users/x/.ssh/id_rsa`）；否则匹配文件名，且首字符是 `.` 时同时覆盖
其变体（`.env` 覆盖 `.env.local`）；但**示例变体除外**——`.env.example`、`.env.sample`、
`.env.template`、`.env.dist`、`.env.defaults` 会被放行，因为它们按惯例不含真实凭据，
而它们是仓库里最需要被读的文件之一。**列表是替换而不是追加**——给了一组自定义值，内置清单
就不再生效，设空数组等于关掉这一道。

这一道**没有档位字段**：它固定 `deny`，因为审批提示必须展示那条路径本身，而那正是规则要
挡住的东西。理由见 [docs/SECURITY.md](SECURITY.md#file-guard-保护什么)。

## `secretGuard`

扫描**每一次**工具调用的全部参数，命中即 `deny`；唯一的例外是只读的命令行（见下）。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 守卫总开关 |
| `genericHighEntropy` | `boolean` | `false` | 额外标记无前缀的高熵字符串 |

**`genericHighEntropy` 默认关闭**，因为它是唯一会拦下普通文本的规则：长 base64、哈希、
压缩数据都可能越过熵阈值。需要时再打开，并预期要处理误报。

`noRead` 与凭据前缀都**没有逐条例外的档位**：加一条精确路径是唯一的定制方式。已知会误伤的
情况（测试夹具里的假 `AKIA`、文档中的 PEM 头示例）只能通过改清单或整关守卫来解决——这是
刻意留出的边界，不是漏掉的配置项。

例外只有一条，且不是配置项：**只读的命令行放行**。`grep`、`rg`、`ack`、`findstr`、
`sed`，以及只取 `git log` / `git grep` / `git diff` / `git show` /
`git rev-list` / `git blame` 的 `git`，都是看文本而不搬运文本的程序；一行里全是它们时，
命中的凭据只记一条 `security.secret_search`，不拦。有任何一个程序可能写出或发送，整行照旧
`deny`。

「只读」按这行**真正会执行什么**判断，不按程序名判断：`sed -i` 写回文件，`sed -f` 读一份不在
这行上的脚本，`sed` 的 `e` 标志（`s/a/b/e`）会执行替换文本，任何 `$(…)`、`<(…)`、`>(…)` 都可能
藏一个看不见的程序——这几类一律不算只读。取舍见
[docs/SECURITY.md](SECURITY.md#secret-guard-保护什么)。

## `audit`

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 是否写审计记录 |
| `path` | `string` | `'.dev-docs/audit-log.jsonl'` | 每行一个 JSON 对象；相对路径按调用的工作目录解析 |

每行记录：时间、会话、`callId`、工具名、命中的字典键、**配置档位**（`action`）、
**最终决定**（`decision`，决策落定时写入）、工作目录，以及**脱敏后**的参数——命中的凭据替换为
`[REDACTED]`，敏感路径按**逐词**降到文件名（`cat /repo/.env && make x` 记成 `cat .env && make x`）。
`action` 是守卫自己会怎么做，`decision` 是这次调用实际怎么收场——另一道路径更严、用户回答了
提问、或策略本来就是 `allow` 时，二者不同。

写失败会累加计数、第一次写进 debug 日志，绝不让一次工具调用因为写不出日志而失败。以 warning
报的是另一件事：日志路径没被 `.gitignore` 忽略——插件写完第一行后问一次 `git check-ignore`，
每个路径说一次，免得一份记录着拒绝清单的日志随下一次提交出门。

完整说明见 [docs/SECURITY.md](SECURITY.md#审计日志记什么)。

## 关闭与降级

| 想要的行为 | 配置 |
| --- | --- |
| 完全关掉插件（零常驻、零介入） | `mode: 'off'` |
| 只在部分仓库生效（未标记仓库不检查、无目录行） | `scope: 'marked'`，然后在要检查的仓库里跑 `/dev-workflow mark` |
| 只关掉自带检查（交给 husky / commitlint） | `enableOwnTrigger: false`（管提交 / PR / 发版三个触发器） |
| 只关掉提交信息检查 | `commitCheck.enabled: false`（PR 标题同样不再按提交规范判） |
| 只关掉文档同步检查 | `docsCheck.enabled: false` |
| 只关掉发版检查的某一条规则 | `releaseCheck.semver` / `changelog` / `changelogCategories` / `prereleaseTag` |
| 换一套分类名 / 待发布段名 / 发版程序 | `releaseCheck.categories` / `unreleased` / `publishers` |
| 放宽版本号格式 | `releaseCheck.versionPattern` 改成你要的正则 |
| 只关掉危险 git 命令守卫 | `gitGuard.enabled: false` |
| 只关掉对外动作守卫 | `outwardGuard.enabled: false` |
| 只关掉危险 shell 命令守卫 | `commandGuard.enabled: false` |
| 只关掉敏感文件守卫 | `fileGuard.enabled: false` 或 `noRead: []` |
| 只关掉密钥守卫 | `secretGuard.enabled: false` |
| 只关掉审计记录 | `audit.enabled: false` |
| 让某个操作放行 | 把该项设为 `'allow'`（仅限有档位的守卫） |
| 让某个操作直接拒绝 | 把该项设为 `'deny'` |

**没有逐条例外，也没有白名单。** 敏感文件与密钥两道固定 `deny`，只能整关；命令守卫只有
一个档位（`mkfs` 与 `chmod` 不能分档）；git 与对外守卫没有 remote / branch 白名单
（「个人 fork 可强推、upstream 禁止」这类要求当前表达不了）。这些是已知的能力缺口。

`/dev-workflow on` / `off` 是 `mode` 的**运行期等价物**：它同样撤掉全部注册。区别有三点——
不落盘、保留 `/dev-workflow` 这条命令本身（否则没有回头路）、以及**不会被无关的设置写入撤销**：
只有 `mode` 真的变了才算对同一个问题给出回答。`status` 会区分「运行期 off（未落盘）」与
「配置里 off」两种状态。

## 可视化面板

面板与文件配置**同源**：面板不读也不写任何自己的存储，它走的是 DSH 的设置控制器
（`configForms`），保存后宿主把新值写进当前 profile 的 `cordis.patch.yml`，并通过
`loader/volatile-update` 提交给运行中的插件——**不需要重启**。面板里看到的就是文件里的值，
反过来说，手改文件后重新加载同样会反映到面板。

保存成功时底部会出现一行提示；它只说明「这一批值已经落到 profile 里了」，下一次编辑、取消或
关闭设置面板时就会消失。官方 `SettingsForm` 只报告失败，但本表单有 38 个字段，只靠按钮从
「可点」变回「不可点」来暗示成功，滚在顶部的人无从判断——所以这里补了一行明确的成功提示。
提示绑定在「这一次打开面板」上：设置面板关闭时会卸载这个 section，而草稿实例与插件同生命周期，
所以提示在这两者之间要显式清掉，否则下次打开面板会重放上次的保存提示。底部的两个按钮靠右对齐，
与官方表单一致。

### 「已覆盖」与「恢复默认」

每个字段标题右侧可能带一个「已覆盖」徽标和一颗「恢复默认」按钮——徽标是 `Reset to default`，
按钮也带全称，12px 小字改成与其它控件一致的字号。**面板底部还有一颗「全部恢复默认」**，
一次把 draft 里所有被覆盖的项发成 `unset`，不必逐项去点。它们说的是同一件事：
**这份 profile 里还留着这一项**。平台判定「已覆盖」看的是 user 层有没有这个键，而不是值等不
等于默认值——官方实现把这条说得很直白（`dsh-client-ui-primitives/lib/index.js:7099-7102`）：

> A field shows its effective value — the user layer over the composition layer over the
> schema default — and whether the user layer carries it. **That presence, not a value
> comparison, is what marks a field overridden: an override equal to the composition default
> is still an override.**

对应的判定是 `stored(field)`：只看 user 层有没有这个键（同文件 `:7370-7373`）。

**面板在这一步上比官方更进一步。** 官方只有「恢复默认」按钮会删掉这项；本面板把「用户把字段
选回继承值」也当成同一个意思——你选回默认值时，就是不想再覆盖它了，于是保存时发的是
`{op: 'unset', path: [...]}`，而不是写一个恰好等于默认值的 `{op: 'set'}`。徽标当场消失，不留
一颗「恢复默认」按钮去重置一个本来就等于默认值的字段。两条路都通向 unset：

- 把控件选/填回默认值（例如把 `commitCheck.subjectMaxLength` 从 `72` 改回 `50`）；
- 或者点「恢复默认」（`client.js` 的 `actions.clear(spec.path)`）。

这里有一条边界要留意：**只有当新值恰好等于继承值时才会 unset。** 如果新值不等于继承值、
但恰好等于当前有效值（字段本来就是这个值，或别人刚写进来），草稿会被丢掉、不产生任何写操作
——这一点和改动前一致。

为什么值得知道：对安全相关的项（尤其 `gitGuard` 的八个档位与 `outwardGuard` 的五个）来说，「已覆盖」是一份**清单**。
把它们从 `ask` 改成 `allow` 之后忘改回来，`allow` 会一直生效——徽标正是让你能找回这些字段的
东西，`approval.disabled` 的文案里也把这一点写了出来（见
[权限策略为 `never` 时会发生什么](#权限策略为-never-时会发生什么)）。现在撤销也只要一步：
把那个档位选回 `ask` 再保存，profile 里那一项就被删掉了。

### 面板可以改的（38 项）

| 分组 | 项目 |
| --- | --- |
| 工作流模式 | `mode`、`scope`、`locale`、`enableOwnTrigger` |
| 提交规范 | `commitCheck.enabled`、`onFailure`、`types`、`requireScope`、`subjectMaxLength` |
| 文档同步 | `docsCheck.enabled`、`rules.requireChangelogOnFeat`、`docsCheck.requireReadmeOnConfig`、`releaseCheck.semver`、`releaseCheck.changelog`、`releaseCheck.changelogCategories`、`releaseCheck.prereleaseTag` |
| Git 安全 | `gitGuard.enabled`、八个操作档位、`gitGuard.rememberApproved` |
| 对外可见动作 | `outwardGuard.enabled`、`push`、`tag`、`pullRequest`、`issue`、`publish` |
| 命令安全 | `commandGuard.enabled`、`commandGuard.dangerousShell` |
| 文件与密钥 | `fileGuard.enabled`、`secretGuard.enabled`、`secretGuard.genericHighEntropy` |
| 审计日志 | `audit.enabled` |

主区只有开关与枚举（加上 `subjectMaxLength` 这一个数字输入），不提供自由文本——路径与正则
是「写错就静默失效」的那一类值，不该交给一个没有校验的输入框。

每个守卫的**总开关都带一句后果说明**（关掉它之后哪一类动作不再被拦），关掉某个总开关时
它下面的分项会同时标出「当前不生效」，避免「控件还亮着 = 规则还生效」的误读。

### 只能在文件里改的（13 项）

面板的**高级**区（默认折叠、**只读**）展示其中 7 项，并提供一个打开当前 profile
`cordis.patch.yml` 的按钮：`codePaths`、`docs.docsDir`、`docs.changelog`、
`docs.exclude`、`releaseCheck.versionPattern`、`docs.mirrors`、`audit.path`。

另外 6 项连展示都没有，因为它们只能由文件表达：`docs.readme`（哪些文件算 README 类文档）、
`fileGuard.noRead`（不许读取的敏感路径清单）、`prSections`（模板不存在时的兜底段落名），以及
`releaseCheck` 下的 `categories` / `unreleased` / `publishers`（分类名、待发布段名、哪些程序
算发版）。一份清单或一个名字不是开关或枚举，面板给不了比编辑文件更好的体验。

### 面板不做什么

- **不重复 DSH 自带的插件总开关。** 插件的启用与停用是插件管理器的事，面板只负责插件内部的
  配置；`mode: 'off'` 是插件自己的「零常驻」语义，两者互不替代。
- **不改由 DSH 拥有的东西**（审批策略、沙箱模式、插件名册）。
- **不写入配置文件以外的地方。** 面板没有自己的持久化，也没有「仅本次会话生效」的开关。
  `/dev-workflow off` 那种运行期开关**不在面板里**，因为它不落盘——面板上的每一项都写文件。

## 相关文档

- 配置字段在代码里的唯一声明：`src/config.ts`
- 面板的浏览器半：`client.js`；Host 半（关闭 schema 页、`loader/volatile-update` 后重建注册）在 `src/index.ts` 的 `createRuntime`
- 每个工具的参数：`docs/TOOLS.md`
- 默认值为什么这样定：`docs/SECURITY.md`
- 守卫的判定细节与实测：`docs/TRIGGERS.md`
