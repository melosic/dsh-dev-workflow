# 架构

本文件说明 dsh-dev-workflow 由哪些模块组成、它们怎么连起来，以及几个看起来古怪但必须如此的设计。
它描述的是**已经落地并实测过的行为**，不是设计意图。

## 插件在 DSH 里的位置

DSH 是 Cordis 微内核：内核只提供上下文、服务注册与事件总线，其余能力（工具、技能、命令、子进程）
都是插件。本插件也是其中之一，入口是 `src/index.ts` 的三个具名导出：

| 导出 | 作用 |
| --- | --- |
| `name` | 插件名 `dev-workflow`，必须与 `cordis.patch.yml` 里的 `id` 一致 |
| `inject` | 声明依赖的**宿主服务名**：`['tools', 'skills']` |
| `apply` | `(ctx, config) => void`，唯一的副作用入口 |
| `Config` | Schemastery schema，DSH 在 `apply` 之前完成校验与填默认值 |

**不使用 `export default`。** DSH 的 loader 在 ESM/CJS 互操作时会解包默认导出，一旦用默认导出，
同文件里的 `inject` / `Config` / `name` 都会跟着丢掉，插件会以错误的形式挂载（没有依赖声明、
没有配置面）。这是个安静的坑，不是风格偏好。

`inject` 里写的是**服务名**，不是 npm 包名。本插件只声明两个真正无法工作的依赖：

- `tools`：两个检查工具注册在这里，没有它插件无事可做。
- `skills`：工作流规范以技能形式注入，同上。

`subprocess`（跑 git）与 `commands`（`/dev-workflow`）**故意不写在 `inject` 里**，而是用
`ctx.get('subprocess')` / `ctx.get('commands')` 取。这样做的收益是：一个没有装 git 集成、
或者版本里没有命令服务的 profile 依然能挂载本插件，只是少一项能力，而不是整个加载失败。
代价是这两个服务可以在插件存活期间消失，所以每次使用前都要取一次——见 `src/git.ts` 的
`service()` 与 `src/index.ts` 的 `activate()`。

## 模块地图

```
src/
├── index.ts                  插件入口：构造 Runtime，注册/注销全部资源
├── config.ts                 Schemastery 配置面（唯一声明处，每个字段带默认值）
├── i18n.ts                   locale 解析 + 字典读写 + t()
├── state.ts                  会话内去重状态与守卫命中计数（纯内存）
├── shell.ts                  不跑 shell 的命令行解析（两个特性共用）
├── checks.ts                 一次变更的判定逻辑（触发器与 /dev-workflow check 共用）
├── git.ts                    通过可选服务 subprocess 运行 git
├── skills/provider.ts        技能 provider：目录条目 + 按需全文
├── tools/
│   ├── result.ts             CheckResult 与统一的渲染格式
│   ├── merge-preview.ts      两条分支合并会不会冲突（只读，git merge-tree）
│   ├── check-commit-message.ts
│   └── check-doc-sync.ts
├── triggers/
│   ├── shared.ts             三个触发器共用的截断、双语提示、结算与文件读取
│   ├── pre-commit.ts         tools/pre-execute 上的提交前检查
│   ├── pre-pr.ts             gh pr create 的标题、描述与并行分支冲突检查
│   └── pre-release.ts        git tag / npm publish 的发版检查
├── guard/
│   ├── shared.ts             五道守卫共用的事件接线与档位决策
│   ├── approval.ts           守卫侧审批提问：把接缝的答案翻成放行或拒绝
│   ├── git-guard.ts          危险 git 命令
│   ├── outward-guard.ts      对外可见动作（推送、标签、PR、issue、发布）
│   ├── command-guard.ts      危险 shell 命令
│   ├── file-guard.ts         敏感路径
│   └── secret-guard.ts       凭据泄漏
├── audit.ts                  脱敏后的审计记录（.dev-docs/audit-log.jsonl）
└── commands/dev-workflow.ts  /dev-workflow 的子命令分派

client.js                     浏览器半：设置面板（仓库根目录，不走 src/ 的编译）
```

依赖方向是单向的：`index.ts` 依赖所有模块，各模块之间只向下依赖（`commands` 与
`triggers` 都依赖 `checks`，`checks` 依赖 `tools` 与 `shell`）。没有循环，也没有全局单例——
每个模块导出的都是 `createX(options)` 工厂，要什么能力由调用方注入。

## Runtime：一份可开关的注册集合

`src/index.ts` 的 `createRuntime(ctx, config)` 返回一个 `Runtime`，它把「插件当前在做什么」
收敛成四个访问器加一个开关：

```ts
interface Runtime {
  readonly active: boolean          // 当前是否有注册
  locale(): Locale
  t(): Translate
  git(cwd: string): GitRunner       // 带缓存，同一目录复用一个 runner
  readonly state: WorkflowState
  setActive(on: boolean): void
}
```

关键点是 `active` 与 `setActive` 的语义：**`off` 不是「安静地不回答」，而是把注册本身撤掉。**
常驻 token 成本恰恰等于这些注册，所以关掉之后必须真的归零。`releases` 数组按注册顺序存
disposer，`setActive(false)` 逆序逐个调用。

### 为什么注册要额外绑一次 effect

`ctx.tools.register()` 与 `ctx.commands.register()` 返回的 disposer **绑定的是服务自己的
上下文，不是调用方 fiber**：它们的实现内部走 `this.layers.effect(this.ctx, ...)`，
`this.ctx` 是 `ToolRuntime` / `CommandRuntime` 所在的那层。只把 disposer 存进数组的话，
插件 fiber 卸载（热重载、禁用插件）时**注册不会跟着消失**，会留下悬挂的工具定义。

所以 `bind()` 做了两件事：把 disposer 包一层幂等（`released` 标志，重复调用无害），
再用 `ctx.effect(() => once)` 把它挂到本插件 fiber 上。这样运行时显式 `off` 与 fiber 卸载两条路
都能清干净。官方 `dsh-tool-bash` 的 `ctx.inject(['jobs'], jobCtx => jobCtx.effect(...))`
是同一个手法。

事件监听器（`ctx.on`）没有这个问题：`on` 返回的 disposer 本来就归当前 fiber。

## 设置面板层

面板是**两半**：Host 半在 `src/index.ts` 里（没有单独模块，因为它只做三件事），浏览器半是
仓库根目录的 `client.js`。两半通过一个字符串配对：**设置命名空间**。

### Host 半：让出页面，并跟上写入

```ts
export { Config }                                    // Loader 行据此提供 schema
ctx.inject(['settings'], (child) => child.effect(() =>
  (child.get('settings') as SettingsPresentation)
    .configure({ auto: false }, ctx.fiber)))         // 关掉 schema 自动页
ctx.events.on('loader/volatile-update', () => resync())
```

`auto: false` 是因为本插件自己渲染面板（第三、五步的结论）：schema 生成的页面给不了分组、
说明文字和只读高级区。`settings` 是可选服务，用 `ctx.inject` 而不是写进 `inject`，所以没有它
的档照样加载，只是没有面板。

`resync()` 只做两件事：重算 locale；若「构建注册时用到的开关」签名变了，就整体重建注册。
**别的配置项不需要重建**——面板保存时，loader 把新值提交进运行中的 volatile 引用，读取方
（每次检查、每次守卫）自然看到新值，这也正是「改完不用重启」的机制。手工 `/dev-workflow off`
不会被一次无关的编辑撤销，因为签名没变。

### 浏览器半：只渲染，不持久化

`client.js` 是**手写的模块**，因为这个包没有打包器：

```js
window.__ModuleLoader__.load({
  id: '@melosic/dsh-dev-workflow',   // 必须等于 Loader 行 id
  factory: (require) => { const React = require('react'); …; return { apply, inject, panel } },
})
```

`apply(ctx)` 里三件事：注册双语文案（`ctx.locale.register`）；建一个 `DraftForm`；在
**Host 已经开始服务该命名空间之后**，往 `settings.section` 槽位注册导航项：

```js
ctx.configForms.whileServed([NAMESPACE], () =>
  ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, id: NAMESPACE, … }, Section)))
```

`whileServed` 是官方形态：命名空间还没被服务时挂一张卡片，卡片也读不到任何东西。

读写全部交给 `configForms` 提供的控制器，面板**没有自己的存储**：`DraftForm` 只暂存草稿，
`save()` 把改动拼成一批 `{ op: 'set' | 'unset', path, value }`，带上**读到的 revision** 调
`scope.mutate(ops, revision)`；版本不符或写入被拒时草稿保留并显示失败，由宿主负责冲突检测、
落盘和失败后的重载。`unset` 表示「回到继承值」：面板上的「恢复默认」按钮发它，用户把控件选/填回继承值时也发它
（选回默认值就是「不再覆盖这一项」）。

命名空间字符串写错两半就永不配对，所以 `tests/settings-schema.spec.ts` 会拿
`cordis.patch.yml` 里的 `id:` 逐字比对；另外两个 spec 分别覆盖 Host 注册 + volatile 写入
（`tests/settings-register.spec.ts`）与两个方向的往返（`tests/settings-roundtrip.spec.ts`）。

### 样式与主题

面板不引入任何 DSH 私有组件：按钮、开关、分段控件、复选框都是本地实现，类名统一带
`dsw-dev-workflow-` 前缀，颜色只用主题发布的 14 个 `--dsw-alias-*` token，不认识的 token
一律回落到字面量。`<style>` 标签带 `data-plugin` 与 `data-plugin-css` 两个属性，前者让宿主
知道归属、后者让 HMR 能按归属清理。

## 数据流：一次动作检查

```
agent 调 bash/pwsh 工具
        │
        ▼
tools/pre-execute   ← Cordis waterfall，本插件最多挂八个监听器
        │              ① src/triggers/pre-commit.ts   （提交前检查）
        │              ② src/triggers/pre-pr.ts       （PR 创建前检查）
        │              ③ src/triggers/pre-release.ts  （打 tag / 发布前检查）
        │              ④ src/guard/git-guard.ts       （危险 git 命令）
        │              ⑤ src/guard/outward-guard.ts   （对外可见动作）
        │              ⑥ src/guard/command-guard.ts   （危险 shell 命令）
        │              ⑦ src/guard/file-guard.ts      （敏感路径）
        │              ⑧ src/guard/secret-guard.ts    （凭据泄漏）
        │
        ├─ 监听器先 await next()：链上后面的门禁与内置行为先决定
        │
        └─ 上游 allow 时才自查，命中后返回 ask（guard 也返回 deny）
            本会话审批策略为 never 时改为自己 deny 并说明原因
            （src/approval-policy.ts 的 unaskable()，见 docs/CONFIGURATION.md）
```

监听器挂在同一个事件上、互相独立，是刻意的：**三个守规范（提交信息与文档同步、
PR 标题与描述、发版步骤与 CHANGELOG），五个守工作成果（可能丢数据的 git 命令、
本机没事但别人立刻看得见的对外动作、不可逆的 shell 命令、不该读的路径、
发出即泄漏的凭据）**，`enableOwnTrigger` 与各守卫的 `enabled` 分别是它们的开关。
它们不共享判定，但共享四样东西：

- `src/shell.ts`：把命令行归约成 `git <subcommand> <args>`、`<program> <args>` 与命令词序列，
  涉及命令行的监听器必须对「什么算 git」「什么算程序名」有同一个答案。
- `src/triggers/shared.ts`：`detailsOf()` 的截断、`askAbout()` 的双语 `displayReason`、
  `settleAbout()` 的结算与文件读取，三个约定触发器共用；它们各自只提供识别函数与判定函数。
  结算那一步自己通过审批接缝提问，只有拿到 `allowed-once` 才把 target 记进状态——因为
  dispatcher 在监听器返回**之后**才结算 `ask`，答案不回传，「返回 ask」并不等于获批。
- `src/approval-policy.ts`：`ApprovalOutcome` / `ApprovalRequest` / `ApprovalSeam` 三个类型，
  以及 `unaskable()`——本会话审批策略为 `never` 时把 `ask` 改成自己给出的 `deny`。八个
  监听器都经过它，因为「问一个不会有人回答的问题」是它们共同的失效方式；它刻意不 import
  任何本地模块，否则 `guard/approval.ts → guard/shared.ts` 会与它成环。
- `src/guard/shared.ts`：`createGuard()` 提供接线、计数与档位决策，五道守卫都只是给它一个
  `detect(exec)`。策略差异（谁是 `ask`、谁固定 `deny`）留在各自文件里。`outward-guard.ts`
  是其中唯一复用触发器识别函数的守卫（`detectRelease()` / `detectPullRequest()`），
  因为「什么算一次发版」只能有一个答案。
- `src/state.ts`：命中计数与「同一会话同一问题只提示一次」的记忆（四种 `CheckKind`）——
  只在用户批准之后记入，拒绝、取消与没人被问到的情形都不记。

`next()` 返回 `{kind:'allow'}` 之外的值时，本插件一律原样透传，绝不改判上游的决定；
guard 是唯一的例外，且只在**自己的策略更严**（`deny` 对上上游的 `ask`）时才覆盖，
理由写在 `src/guard/shared.ts:248-252`。

## 共用的判定层

`src/checks.ts` 的 `evaluate(input, config, t)` 是「给一份工作区变更 + 一条提交信息，
返回问题清单」的纯函数。它被三处调用：

| 调用方 | 输入 | 用途 |
| --- | --- | --- |
| `triggers/pre-commit.ts` | 命令里解析出的信息 + `git status` 的文件集 | 提交前拦截 |
| `triggers/pre-commit.ts` | 同上，但用另一语言的 `t` | 渲染双语提示 |
| `commands/dev-workflow.ts` | 工作区文件集（无提交信息） | `/dev-workflow check` |

`src/tools/check-commit-message.ts` 的 `checkCommitMessage(input, t)` 也被两处调用：
工具本身，以及 `triggers/pre-pr.ts`——**PR 标题在 squash merge 之后就是 `main` 上的提交信息**，
所以它必须过同一套规则，而不是另写一份更松的校验。

「纯函数」这条不是洁癖：触发器要为审批提示同时给出中英两份，而**每一份都必须用对应语言的
翻译器重新跑一遍 `evaluate`**。如果清单是一次算好再翻译外层的，就会出现「英文提示里嵌着
中文问题」。详见 [docs/TRIGGERS.md](TRIGGERS.md#提示的语言)。

工作区只读一次（`git status --porcelain=v1 --untracked-files=all`，由调用方执行），
之后所有判断都是对文件列表与字符串的操作——这也是 `evaluate` 能重跑的前提。

PR 检查多问一次仓库：`src/tools/merge-preview.ts` 用
`git merge-tree --write-tree --name-only` 算一遍「本分支与本地另一个未合并分支会不会冲突」。
它只写对象库，不碰工作区、索引与网络，所以放在 `tools/pre-execute` 上是安全的。两个分支各自
对基线干净、合起来才冲突，正是并行 PR 最难自己发现的一类问题。

## 不跑 shell 的命令行解析

插件需要识别「agent 正要用 `git commit`」「正要用 `gh pr create`」「正要用 `git tag` /
`npm publish`」和「正要用 `git push --force`」，
但它**不通过执行 shell 来识别**——那会带来两个问题：需要真的跑一遍命令（有副作用），
以及依赖 shell 的可用性。

`src/shell.ts` 因此只做有限词法：

1. `tokenize()` 处理单双引号、反斜杠转义，把 `&&` / `||` / `;` / `|` / 换行保留为独立 token；
   `${VAR}` 保留为一个词（花括号不再当分隔符丢掉），否则 `rm -rf ${HOME}` 会被拆成无从判断的碎片。
2. `segments()` 按这些运算符切段，每段独立判断（`pnpm test && git commit -m "..."` 照样命中）。
3. `skipWrappers()` 剥掉前导的包装词与变量赋值——`TRANSPARENT` 集合里的 `sudo`、`doas`、
   `env`、`nohup`、`command`、`exec`、`time`、`npx`，以及 `VAR=value` 形式的赋值。
   因此 `sudo git push --force`、`npx npm publish` 与 `FOO=1 git commit` 都还原成真实程序。
4. `programInvocations()` 取程序名 basename，返回该段的 `{ program, args }`——`git tag`、
   `npm publish`、`gh pr create` 都从这一步往下判；五道守卫共用它，所以包装词只需在这里处理一次。
5. `gitInvocations()` 在它之上跳过 `-C`、`-c`、`--git-dir` 等带值的全局选项，取出子命令。

它的**刻意的能力边界**：引号里的 `git commit` 不算命令；`sh -c "git push --force"` 这类
**shell 的 `-c` 参数**会被再次当作命令行解析（`SHELLS` 集合：`sh`、`bash`、`zsh`、`dash`、
`ksh`、`ash`），`$(...)` 与反引号里的命令同样递归解析，但**解释器内部**是不透明的——
`node -e "…"`、`python -c "…"` 里的内容没有任何检查会读；提交信息含 `$(...)` 或反引号时
放弃判定（插件看不到 git 最终收到的字面量）；`git commit -F -` 与 `gh pr create --body-file -`
放弃判定。
这些不是待修的缺陷，
而是「宁可不开口，也不误报」的取舍，清单见 [docs/TRIGGERS.md](TRIGGERS.md#降级路径)。

## 错误处理约定

- **工具执行失败返回 `{ error: ... }`，不抛异常。** `CheckResult` 里 `error` 字段存在时
  `renderCheck()` 只渲染这一行；`/dev-workflow check` 遇到 git 不可用时返回
  `{kind:'error', text}`。
- **事件监听器必须总是 settle。** 门禁里抛出的异常会变成工具调用失败，而不是一条提示。
- **没有可用服务时静默降级**，不报错、不阻塞：没有 `subprocess` 时判定退化为只检查提交信息；
  没有 `commands` 时命令不注册；没有 `approval` 时 DSH 自己会把 `ask` 变成拒绝
  （这是宿主的行为，不是本插件的选择）。

## 相关文档

- 配置面：[docs/CONFIGURATION.md](CONFIGURATION.md)
- 两个工具：[docs/TOOLS.md](TOOLS.md)
- 触发时机与边界：[docs/TRIGGERS.md](TRIGGERS.md)
- 语言处理：[docs/I18N.md](I18N.md)
- 安全默认值：[docs/SECURITY.md](SECURITY.md)
- 常驻成本：[docs/TOKEN-BUDGET.md](TOKEN-BUDGET.md)
- 决策记录：[docs/ADR/](ADR/)
