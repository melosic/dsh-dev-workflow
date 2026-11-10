# 更新日志

本文件记录 dsh-dev-workflow 的所有重要变更。

格式遵循 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本 SemVer](https://semver.org/lang/zh-CN/)。

> **关于 0.x 阶段**：本项目尚处于 0.x 阶段，不保证向后兼容性。
> 按 SemVer 规范，MAJOR 位为 0 时，MINOR 位变更即可包含破坏性变更。
> 每个破坏性变更都会在本文件中显式标注 `BREAKING`。

## [Unreleased]

### Fixed

- PR 检查改为读仓库自己的 `pull_request_template.md`，不再拿七段硬编码名字去套（中文模板会被要求填它没有的段落）。模板没有可识别标题时只要求描述非空。
- 检查清单只数**检查清单那一段**里的 `- [ ]`：GitHub 默认模板 `## Type of change` 下的一排选项被当成「还有 2 项没勾」。
- 标题带 `!` 但没写 `BREAKING CHANGE:` footer 不再阻塞提交：规范允许二者择一，这条降为建议性警告。
- 发布工作流在 `ci:checks` 之前先 `pnpm build`：没有 `lib/` 时第 5 项守卫必挂，v0.7.0 的 tag 就是这样停住的。
- 缺 `NPM_TOKEN` 时工作流明说「secret 没配」并指向手动发布的步骤，不再把 npm 的 401 原样抛出来。
- `tsconfig.json` 显式写 `types: ["node"]`：省掉这个字段等于「加载所有 @types」，TypeScript 7 取消了这条默认，升级后整个 node 类型环境消失。
- `client.js` 与 `pre-release.ts` 各有一处赋了值却没用的变量初始化，ESLint 10 的 `no-useless-assignment` 会拦。
- 建发布页那一步也先问再建：tag 已有发布页就跳过，重跑失败的任务不会把手写的中英页冲掉。
- 提示被拒绝或没人回答后重跑同一条命令不再直接放行：只有拿到 `allowed-once` 才记入状态。
- 判定通过但有建议时不再一声不响：三条路径把 `warnings` 写进 `warn` 级日志（默认档位可见），`status` 也写明还剩几条建议；以前只在 `debug` 级。
- 「读不到改动文件列表」这类结论以前是判定之后拼上去的，双语提示里那一半是空的；现在由 `evaluate()` 自己产生，两种语言都渲染得出来。
- git 命令失败的原因不再以 `{detail}` 占位符原样出现，而是带上 git 自己的那句话。
- 非 git 目录不再报「命令执行失败」：探测改为每次失败都问 git，不再只认退出码 128——`git diff --cached` 在仓库外以 129 退出。
- 新建仓库的第一次提交不再被拦：`-a` 的文件集改读 `git status --untracked-files=no`，没有 HEAD 时不再以 128 退出被当成读不到改动列表。
- 镜像对只在另一半仓库里本来就有时才拦：全新项目首次提交只暂存 `README.md`，不再被要求先写 `README.zh.md`。
- `fix(core):`（冒号后为空）不再报「缺少类型前缀」：类型和冒号都在，缺的是标题，改报 `error.empty_subject`。
- `empty_scope` 的文案不再拿 `feat()` 举例：改为写清格式 `<type>(<scope>): <subject>`，`fix()`/`chore()` 也对得上。
- 被多种命令共用的三条守卫文案带上 `{command}`：`stash drop`、`tag -d`、`gc --prune` 不再一律说成 `checkout -- .`。
- `status` 的守卫计数改渲染短标签（`<reason>.label`），不再把整句解释拼进一行，手机上看得全。
- `###` 分类不在 `releaseCheck.categories` 里时只提示、不阻塞发版：Keep a Changelog 明说分组可以自定，被拦一次的人只会把这条规则关掉，从此再也提示不了。
- `fileGuard.noRead` 的默认值由 `credentials` 改为 `credentials/`：以前只拦同名裸文件，`credentials/id` 与 `./credentials/x` 反而放行。
- 只在命令里**搜索**凭据不再被拒：`grep -rn "AKIA…" .`、`rg`、`git log -S` 这类整行只读的命令放行并记一条 `security.secret_search`；行内有一个程序能写出或发送，拒绝照旧。
- `/dev-workflow check --message "feat: x"` 不再把引号当成消息内容判：外层一对配对引号先剥掉，文档里那种写法现在报的是它真正的问题。
- PR 描述里唯一的引用就是它自己的编号时不再算「已关联 Issue」：`gh pr edit 13` 的正文只提 `#13` 另给一条提示，仍只警告。
- 审计日志路径没被 `.gitignore` 忽略时，写完第一行后按 warning 说一次（走 `git check-ignore`），免得拒绝清单随下一次提交出门。
- 写 issue 的动作（`gh issue create`、`comment`、`close` 等）以前没有守卫：现归入 outward-guard，新增 `outwardGuard.issue`，读操作不算。

### Changed

- `commitlint.config.mjs` 给 dependabot 自己的提交开例外：正文一行一个 compare 链接，宽是它的格式，不是懒。
- `.github/dependabot.yml` 按版本区间跳过 TypeScript 7：`typescript-eslint` 的 peer 上界是 `<6.1.0`，装了 7 之后 `pnpm lint` 还没读到文件就退出。
- 开发依赖里七个 `@deepseek-ai/*` 包退回 `0.2.1-rc.2`，与 `@deepseek-ai/dsh` 和声明支持的名单同版：之前一半在 rc.4，CI 跑的是两个版本的混合树。

## [0.7.0] - 2026-10-29

### Added

- `ci:checks` 从十项变十四项：英文面的 CJK、CHANGELOG 配对、底部 compare 链接、发布页模板。
- 英文面（`locale/en.json`、`client.js` 的 `EN` 块、`src/` 非注释代码）出现 CJK 就失败。
- `feat:`/`fix:` 标题或 `src/` 的改动不碰 `CHANGELOG.md` 会失败；只改 `src/` 时降为警告。
- `CHANGELOG.md` 底部每个版本链接都要指向正确的 compare 区间，抄错的链接能点开但指向错 diff。
- 发布页模板必须中英两个锚点同版本，收尾的 `Full Changelog:` 接着 `CHANGELOG.md` 的上一个版本。
- `.github/workflows/release.yml`：`v*` 触发，tag 与 `package.json` 对不上就停，`npm publish --provenance`。
- 发布后回查 registry 上的 tarball 版本，再建发布页；手动 `npm publish` 那条路留在文档里但不再默认。
- CI 对 PR 标题单独跑一次 `commitlint`：squash 之后它是唯一进 `main` 的文本。
- 新的 `floor` 任务在 windows-latest + Node 20 上跑，`engines.node >= 20` 与 Windows 路径语义有人管了。
- `scripts/token-probe.mjs` 随仓库发布，`docs/TOKEN-BUDGET.md` 的字数可以自己复算。
- `tests/git.spec.ts` 补上 `src/git.ts` 的失败分类与可执行文件缓存：它此前只有类型引用。
- `state` 补一条：守卫计数与审批键不共用命名空间，否则跑过的检查会被当成有人批过。
- `secret-guard` 补文档占位值：示例里的假 key 放行，但占位值与真凭据并排时仍按后者拒。

### Changed

- 支持的 DSH 版本不再是范围，而是两个精确版本 `0.2.0-rc.2 || 0.2.1-rc.2`：范围会宣称没测过的版本也兼容。
- `ci:checks` 第 9 项跟着收紧：值里出现范围符号就失败，不只比对两处是否一致。
- 「双语文档必须同步」降级成可执行的标准：结构与关键事实一致，逐字对译不是要求。
- 机器只验成对同改、locale 键对齐、SKILL 标题形状；两种语言是不是同一个意思归 review。
- 分支命名的四个前缀不再被当成第二份清单：它和提交 type 不同源，也不该从 `COMMIT_TYPES` 派生。
- 理由写进 `CONTRIBUTING.md`：分支名被 squash 丢掉，type 才进 `main`，两份清单不必统一。
- 会发布出去的文档不再引用 `.dev-docs/`：`AGENTS.md` 的三处入口标成「仅本机」，克隆里不存在。
- `docs/TOKEN-BUDGET.md` 的「复算方法」改指向仓库内的 `scripts/token-probe.mjs`，那份存在。
- `docs/PUBLISHING.md` 不再让人写 `.dev-docs/_release-notes.md`（被 gitignore），改用 `--generate-notes`。
- `ci:checks` 的手抄样例输出整段删掉：写这份文档时它就已经少列两项、版本还停在 `0.4.2`。
- 长度口径收成一个数：body 换行 100 与 commitlint 的 `body-max-line-length` 同值。
- subject 50 仍然只是警告——比 commitlint 的 100 严，但严的那边只给建议，不制造第二种判定。

### Fixed

- 词法器：单独的 `&` 补进 `OPERATORS`，`cmd & 危险命令` 的后半段不再从守卫视野里消失。
- `npx -c` / `--call` 不再被当成取值的选项，解析出空程序数组等于整条命令不存在。
- `quoteCommandWords` 与 `tokenize` 对引号外的反斜杠采用同一口径：`C:\Users\.env` 不再被读成 `C:Users.env`。
- `-c` 只在 shell 与 `npx` 上被当作命令串，别的程序的 `-c` 不再被误读成脚本。
- 无空格重定向能被看见：`cat<.env` 此前是一个匹配不到任何程序名的词。
- `file-guard`：`ops_*` / `read_files` / `write_file` 这类表外工具按字段名取路径，不再等于放行。
- 读者补 `cp` / `mv` / `tar` / `zip` / `scp` / `rsync` / `dd` / `base64`，`xargs` 作首程序时继续向内看。
- 大小写折叠只在 Windows 上做：Linux 的 `.ENV` 与 `.env` 是两个文件，拦它没有道理。
- `git-guard` 补 `--prune`（注释早就这么写，实现一直没跟）、`tag -d`、`stash drop`。
- `git-guard` 再补 `gc --prune=now` 与 `update-ref -d`：三条都能让提交对象消失。
- `git.ts` 按退出码判定 not-a-git-repository，不再匹配英文 stderr——git 换个语言就失效。
- `check-doc-sync` 改用 `git status --porcelain=v1 -z`：中文与 emoji 路径不再被引号包住后静默判 clean。
- `pre-release` 在 `--filter` 下读被指向的 `package.json`，monorepo 发布不再拿根版本去比对。
- `pre-pr`：`--title=` / `--body=` 的引号继承与 `checks.ts` 一致，闭合式 ATX 标题被认。
- `pre-pr` 认 `gh` 的 `-R` / `--repo` 与 `pr edit` / `pr merge`，不再只认 `pr create`。
- `pre-pr` 的 `How to verify` 不接受「无」/「不适用」，它是唯一能证伪「作者真跑过」的一节。
- issue 缺失的警告在 PR 那一刻就写进会话日志，不再只躺在 `/dev-workflow status` 里没人看。

## [0.6.0] - 2026-10-25

### Added

- `/dev-workflow mark` / `unmark` 直接建或删 `.dsh/dev-workflow.yml`，`scope: 'marked'` 不用再照提示手建路径；`status` 的未标记提示也改成指向 `mark`。

## [0.5.0] - 2026-10-25

### Added

- `docs/assets/how-it-works.png`：一张能一眼看完的机制图，替代 README 里那段 ASCII 框图。
- `scope: 'marked'` 让规则只在项目根带 `.dsh/dev-workflow.yml` 的仓库生效；默认 `all`，现有安装行为不变。
- 仓库级 PR 模板：七节全部由 `gh pr create` 前的检查读取，缺一段或段内为空都会被拦下；另附 issue 的 bug 报告表单。
- PR 段落名可配置（`prSections`），用中文段落名的仓库不必再整体关掉触发器。
- 发版检查的三条约定可配置：哪些命令算发版（`releaseCheck.publishers`）、未发布段落叫什么、分类标题有哪些。
- `gh pr create` 之前会比对本地其它未合并分支：会冲突就点名分支与文件。两个分支各自对基线干净、合起来才冲突，这一条是唯一能在合并顺序还没定下来时提醒的地方。

### Changed

- CHANGELOG 条目限定在一两句、120 字以内，发布页因此是短的；`ci:checks` 新增一项盯着 `[Unreleased]`。
- 发布页改成「交付说明」：中英双语，除 changelog 条目外还写升级、已知问题、致谢。
- `/dev-workflow status` 把放宽成 `allow` 的守卫命中标为「已放行」，不再和拦下的次数混在一起。
- `scope: 'marked'` 的常驻成本写准了：它省掉的是技能目录行，两个工具定义是进程级注册，未标记的仓库里仍然常驻。
- 过期的数字与引用一次性对齐实现：locale 键数、`ci:checks` 的项数、监听器数量、技能正文的字符与行数，以及四处漂移的源码行号和一个失效的 ADR 链接。
- README 重写为「这是什么、什么时候说话、边界在哪」，不再以本仓库的约定做卖点。
- 技能开头声明：所在仓库自己的 `AGENTS.md`/贡献者指南优先级高于本文件，本文件只是默认兜底。
- `CONTRIBUTING.md` 重写：删掉与 `docs/DEVELOPMENT.md` 重复的工程实践、早就没人测的覆盖率要求、以及本机私有的阶段编号；PR 模板段落数改回真实的七节。
- README 两张图都指向仓库里的真实截图；`ci:checks` 的阶段编号豁免只剩 `CHANGELOG.md` 一个。
- 发现绕过不再要求走私密渠道：公开 issue 即可，只有报告本身要贴真实凭据时才走 advisory。

### Fixed

- 清单声明了 `engines.dsh`，市场页不再显示「作者未声明 dsh 版本要求」；`ci:checks` 检查它与 peer 范围一致。
- `/dev-workflow status` 多一行生效范围，`scope: 'marked'` 时按当前目录判定，未标记就给出该建的标记文件路径。
- bug 表单的版本号占位符改成 `0.2.x` / `0.4.x`，不再随每次发版过期。
- `timeout 120 <命令>` 之类包装下的命令现在能被守卫和触发器看见。
- PR 模板里的 HTML 注释不再被当成正文，没填过的 PR 不会静默通过。
- `git commit -a` / `--all` 的提交信息与文档检查改看 `git diff HEAD`：`-a` 在提交那一刻才填索引，命令执行前读索引会把一次正确的提交拦下来。
- `feat` 提交的 CHANGELOG 规则兑现了文档里的「分支已有也算」：读 `merge-base HEAD @{upstream}` 到 `HEAD` 的 diff，拆成多次提交的特性不再被最后一次提交误拦。
- 审计写失败时只报一次，而不是每个命中都刷一行；`AuditSink.failures()` 这个从未被读取的计数连同它那句「status 会报告」的注释一起删掉。
- 会话记忆的两个上限都真正生效：目标按 LRU 淘汰之外，会话桶本身也有了上限，长进程不再为每个结束的会话留一份空桶。

## [0.4.2] - 2026-10-23

### Changed

- **技能补三条纪律，都是「已实现但没写下来」的那一类。** `### Local Verification vs CI`
  增加「没跑成的检查不等于通过的检查」「验产物不验意图」「第二次失败就停下报告」；
  `## Tool and Guard Boundaries` 增加「守卫抛错 = 该次调用报错，不会放行」与
  「子代理里 `ask` 等于拒绝」；`## How to Read This Document` 增加「只给一个主要建议」。
  双语同步，章节数仍为 35。
- **`docs/CONFIGURATION.md` 说明三档 + `onFailure` 就是 major/minor 的实现**，
  并点明 advisory 是既有按字段可调的软警告，不需要另起一套通道。
- **`docs/DEVELOPMENT.md` 新增「会话状态与进度文件」**，区分 `src/state.ts`（内存、
  进程结束即忘）与 `.dev-docs/PROGRESS.md`（本机私有、不入库），并说明为何会发布的
  文件不能引用后者。
- **`ci:checks` 全绿时也逐条打印 `[ok]`。** 此前它只在失败时出声，一次全过的运行和一次
  某项压根没跑成的运行在输出上无法区分。现在每项检查都以 `[ok] <名称>` 或失败行出现，
  `docs/I18N.md`、`docs/PUBLISHING.md` 里引用该输出的示例同步更新。
- **技能里的阈值与 `src/config.ts` 的默认值改由测试绑定。** `SKILL.md` 写「最多 50 字符」、
  列 11 个 type、说 scope 可选，而这三项都能在面板里改；此前没有任何东西保证正文与默认值
  一致，改默认值后两份规范会各说各话。`tests/skill-parity.spec.ts` 现在读
  `commitCheck.subjectMaxLength` / `commitCheck.types` / `commitCheck.requireScope`
  并断言双语正文与之相符（反向对照已验证：把 50 改成 72、或多列一个 type，用例即失败）。
- **`docs/TOKEN-BUDGET.md` 的按需成本表换成探针实测值。** 表里写的 32200/626 与 15200/511
  是 35 节重写之前的文件大小；现在实测正文为 33744/646 与 15718/522。同时写明这两个数是
  `SkillProvider.get()` 剥掉 frontmatter 之后的正文，不是文件大小，按字节算会偏大。

## [0.4.1] - 2026-10-22

### Fixed

- **面板把所有字段标成「当前不生效」。** 依赖上级开关的控件用「上级的值等于 `true`」判断
  自己是否被读取，但 `mode` 是两值联合类型，它的「开」是字符串 `on` 而不是布尔 `true`——
  于是插件明明开着，页面从「文档同步」往下整片都灰掉并标上「当前不生效」，用户会以为规则
  全失效了。现在每个上级开关记下它自己的「开」值（布尔开关是 `true`，`mode` 是 `on`），
  按该值比较。`tests/settings-render.spec.ts` 补了 `mode` 作为上级的回归用例：旧逻辑下
  这条失败，修复后通过。

## [0.4.0] - 2026-10-18

### Added

- **技能补上「谁在做什么」与「守卫到哪儿为止」两块。** 规范现在开头有一节说明三种角色
  （插件自动执行 / AI 助手必须遵守 / 人类做决定）与三份文档的分工（`AGENTS.md` 常驻、
  `CONTRIBUTING.md` 面向贡献者、`SKILL.md` 随包发布），并新增「工具与守卫的边界」一节：
  守卫看的是工具参数而不是运行中的进程，各守卫可配置的粒度并不相同。
  这两处此前只存在于代码注释与 `SECURITY.md` 里，模型读技能时看不到。
- 提交信息一节补 scope 对照表与一组「同一变更两种写法」的示例；PR 一节补「评审者这一侧」
  （读标题与 *Why*、按声明意图读 diff、警惕同提交里被削弱的断言）；发布一节补「发版中断在
  半路」的三种恢复路径与「发布说明就是 CHANGELOG 段落，不要另写一份」；CHANGELOG 一节补
  「并发编辑」（条目加在分类顶部，冲突时两边都留）。
- **`client.js` 进入类型检查（`pnpm typecheck:client`），CI 与 `prepublishOnly` 都会跑。**
  面板是手写的浏览器 JS，此前不在任何 tsconfig 里——宿主改了方法名，编译期毫无反应，
  要等用户打开一个空白面板才知道。新配置 `tsconfig.client.json`（`allowJs` + `checkJs`）配上
  `client-env.d.ts` 里的宿主类型导入，把 `ctx.configForms`、`ctx.locale`、`ctx.remote`、
  `ctx.slots` 的真实声明带进程序，`apply` 的参数按宿主 `Context` 标注后，改名或删字段就是编译错误。
  连带发现并修正三处：`ctx.slots` 的声明来自 `@deepseek-ai/dsh-client-ui-renderer` 而非
  `dsh-client-ui-slots`（后者只提供类型，服务由 renderer 挂载），本插件的
  `settings.devWorkflow` 命名空间需要自行并入宿主 `LocaleNamespaceMap`，`typecheck:tests`
  之外还要有这一份才能覆盖到浏览器侧。

### Changed

- **技能结构由 28 个章节扩到 35 个。** 新增两节 `## How to Read This Document`、
  `## Tool and Guard Boundaries`，以及五个子节；中英两份仍保持章节数量、层级与顺序一致
  （`tests/skill-parity.spec.ts` 与 `scripts/ci-checks.mjs` 同时校验）。`docs/TOKEN-BUDGET.md`
  的按需成本表随之更新为实测值。
- **开发基线升到 DSH `0.2.1-rc.2`，支持下界仍留在 `0.2.0-rc.2`。** `devDependencies` 现在
  精确钉住 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-tools` 的
  `0.2.1-rc.2`，让 `pnpm typecheck`、`pnpm typecheck:tests`、`pnpm test` 跑在一个确定版本上。
  `peerDependencies` 的下界**没有**跟着抬：`0.2.1-rc.2` 在 `next` 渠道，`latest` 渠道仍是
  `0.2.0-rc.2`，抬下界会让仍在默认渠道上的用户被 `preflight()` 静默禁用。两者为何分离、
  以后怎么升级，写进了 `docs/PUBLISHING.md` 第 4 条与 `docs/DEVELOPMENT.md`。
- **DSH `0.2.1-rc.2` 的 API 差异已核对，无需改代码。** 三个包只用到 `dsh-skill` 的
  `BUNDLED_SKILL_RANK` 与 `dsh-tools` 的 `defineTool`，`dsh-tools` 的类型变更是增量式；
  面板用的 `configForms` 公共 API 两版逐字相同，`ConfigFormSnapshot` 删掉的 `mode` 字段
  本插件从未读取（`status` 的 `unavailable` 终点已有渲染分支）。
  顺带补的是文档里两处会把「实测基线」与「支持下界」混为一谈的表述。

### Removed

- **删掉三项从未被任何代码读取的配置：`rules.branchPattern`、`rules.commitPattern`、
  `docs.adrDir`。** 它们之前只有声明、面板展示和一枚「当前不生效」徽标，没有任何行为——
  一块只有承诺没有实现的表面。分支命名仍然是约定（见技能的分支模型一节）；提交头部规则读的是
  `commitCheck.types`、`commitCheck.requireScope` 与 `commitCheck.subjectMaxLength`，不是一条
  独立的正则。schemastery 接受未知键，所以旧配置文件里留着这三项不会报错，只是被忽略。

### Fixed

- **`docs/PUBLISHING.md` 把年龄门槛归因错了对象。** 原文说「只有应用内插件管理器（pnpm 11）会
  停在上一版，`dsh plugin add` 走 PATH 上的 pnpm 10，默认仍是 0，实测三次都装到最新版」。
  实际上门槛读的是**配置而不是 pnpm 版本**：用户级 `~/.npmrc` 里的 `minimum-release-age`
  会被 pnpm 10 与 11 一起继承。本机 pnpm 10.30.3 实测拒绝了一个 10 小时前发布的版本
  （`ERR_PNPM_NO_MATURE_MATCHING_VERSION`），所以两条安装路径在该设置下行为一致。文档现在
  写明门槛来源、用 `pnpm config get minimum-release-age` 自查，并把「刚发完就装一遍验证」
  这条自查路径与「只拦解析、不拦 `--frozen-lockfile`」的边界一起写进去。
- **规范里三处自相矛盾的说法。** 分支保护禁止一切强推，而安全操作要求用
  `--force-with-lease`；分支模型要求 `git merge main` 不用 rebase，而 rebase 在破坏性命令表里
  被整体列为危险；分支命名被写得像门禁，但没有任何检查读取它。现在分别写明
  适用边界：lease 写法只用于非保护分支，rebase 只重写「别人已基于其工作」的历史时才算危险，
  分支命名明确标为约定。
- 技能里「五道守卫可逐条配置」的说法不准确：`commandGuard` 只有一个档位覆盖所有不可逆形态，
  `fileGuard` / `secretGuard` 是固定 `deny`。按实际粒度重写。
- 文档里关于 shell 边界的表述落后于实现：`sh -c` 的内部命令行与 `$(...)`、反引号里的命令
  早已递归解析，`ARCHITECTURE.md` 与 `SECURITY.md` 仍写成「认不出」。真正的不透明处是解释器
  内部（`node -e`、`python -c`），文档改为指向这一点。
- **command-guard 只认 Unix 写法，Windows 上的删除与擦盘全部放行。** 程序名以前按原样比较，
  而 PowerShell 写 `Remove-Item -Recurse`（大写、开关拼全），cmd 写 `rd /s /q`、`del /f /s /q`，
  卷擦除是 `format C:` 或 `Format-Volume`——这些一个都不命中。现在程序名统一按小写比较；
  `/s` 这类 cmd 开关只在 cmd 自家内建命令上生效（`rm -r /etc` 里的 `/etc` 仍是路径，
  写作 `/s` 也不会被当成开关）；`C:`、`C:/`、`C:\`、`C:/*`、`rm -rf //` 归一化为同一位置；
  `$env:USERPROFILE` / `%USERPROFILE%` 按大小写不敏感比较。
- 递归删除**一个操作数都没留下**时不再静默放行。`rm -rf $(cat list)` 的目标在替换占位里，
  词法层把它拆成独立命令段后，`rm` 这一段看起来「没有目标」——这既可能是笔误，也可能是
  目标没露出来，现在按可疑处理并给出同样的理由。命令行全文依旧不进任何输出。
- `summarize()` 只返回第一条错误，于是同时发现三个问题的检查在状态行上读起来像一个。
  现在多出的条数会跟在后面。
- **file-guard 认不出套在 shell 里的读取。** `cat .env` 会被拒，`sh -c "cat .env"` 却放行——
  程序名看到的是 `sh`。现在与 command-guard 用同一条规则拆开 shell 包装，把 `-c` 后面的
  命令行当作独立命令重新判定；`bash -lc`、套一层的 `sh -c "sudo cat .env"` 同样覆盖。
- **`pnpm -r publish` 与 `pnpm --filter pkg publish` 完全看不见。** 识别发版时只把命令的
  第一个词当子命令，而 pnpm 允许全局选项写在子命令前面：`--filter` 顶到前面时被当成子命令，
  于是发布既没有触发预发检查，也没有触发 outward 守卫——`-r` 会把工作区里每个包都推上去。
  现在子命令取第一个自由词，会跳过选项及其取值。
- **git-guard 只认 `checkout --` 一种写法。** `git restore <path>` 是同一损失的新写法、
  也是现在最常敲的形态，此前完全放行；`git checkout -f <branch>` 与
  `git switch --discard-changes <branch>` 不再停在冲突上而是直接丢弃本地改动，同样没被拦。
  现在 `restore` 的第一个自由词按路径判定（`--staged` 与 `--source` 仍然放行），
  强制切换按丢弃改动处理。
- **「PR 没引用 issue」这条建议会变成一次阻拦。** 它是提醒性质的，却和有实质发现的问题
  一起进了审批提问；审批策略为 `never` 时，一个没有内容的提问会被直接拒掉，于是「描述里
  没写 `Closes #12`」就能挡住整个 `gh pr create`。现在它和 `--fill` 那条一样只进状态记录。
- **搜索类命令把自己的搜索词当成了要打开的文件。** `grep -rn "credentials" .` 会被拒，
  而这恰好是「查一下密钥有没有进仓库」的那条命令——把规则逼到要么关掉要么绕过。现在
  `grep`/`rg`/`sed`/`awk`/`findstr`/`Select-String` 的第一个自由词按表达式处理，其后的
  词仍按路径判定（`grep -rn "add .env" .env` 依然被拒）。
- **参数位置上的命令替换会被吸收进外层命令。** 词法层在替换前后都补了分隔，但此前只在
  尾部补：`echo $(rm -rf /)` 因此被读成「`echo` 带着 `rm -rf /` 这三个参数」一条无害命令，
  替换里的程序从未被当作独立命令判定。`echo $(git push --force)`、`cat $(rm -rf /)`、
  `tar -czf b.tgz $(rm -rf /)` 全部放行。现在替换两侧都有边界，且 `quoteCommandWords`
  把 `git tag v$(cat VERSION)` 这样的名字保持成一个词，不被边界切碎。
- **`sh -lc` / `bash -ec` 这类短选项簇里的 `-c` 不被识别。** 之前只认裸的 `-c`，
  于是 `bash -lc 'rm -rf /'`、`sh -ec 'git push --force'` 把整个脚本当成一个不透明参数放行，
  而这正是 CI 与登录 shell 的常见写法。现在按短选项簇识别，脚本取第一个非选项词。

## [0.3.0] - 2026-10-15

### Added

- `docs/PUBLISHING.md` 新增「发布后 24 小时内：安装可能停在上一版」一节。应用内的插件管理器
  走 DSH 自带的 pnpm 11，其 `minimumReleaseAge` 默认值为 1440 分钟，因此**新版本发布不到
  24 小时时，不带版本号的安装会静默回退到上一版**——不报错、不提示、也不写
  `minimumReleaseAgeExclude`。文档记录了现象、四种可用做法（指名版本 / 裸包名 exclude /
  `minimumReleaseAge: 0` / 等满 24 小时）、三个会踩的坑（`@*` 与 `@>=0.2.0` 会被拒绝、
  `minimumReleaseAgeStrict` 单独写无效、**手工删掉 exclude 行会让卸载也失败**），
  以及截止线的算法（当前时间减 1440 分钟对比**发布时刻**）。
  这条只影响应用内那条路：`dsh plugin --profile <profile> add …` 转发给 pnpm 10.30.3，
  不受影响，README 的安装命令无需改动。

- **`releaseCheck`：发版检查的四条规则各自可关。** 此前规则全硬编码，想放宽一条只能
  `enableOwnTrigger=false` 整关。现在 `releaseCheck.semver`（版本号须是 SemVer）、
  `changelog`（须有 `[Unreleased]` 段）、`changelogCategories`（`###` 标题须是
  Keep a Changelog 的六类）、`prereleaseTag`（预发布版本不得推 `latest`）四项默认全开、
  各自可关；`releaseCheck.versionPattern` 是**文件级**正则，用来放宽或收紧版本号格式，
  默认即 `SEMVER_PATTERN`。默认值与原行为逐字相同。
- **`gitGuard.checkoutDiscard`：丢弃工作区改动的档位。** `git checkout -- <path>`、
  `git checkout .`、`git restore <path>`、`git restore .` 会丢掉未提交的改动，此前
  完全没有守卫——现代写法 `restore` 与 `checkout .` 形态都拦不住。默认 `ask`；
  `git checkout main`（切分支）、`git restore --staged`（只动索引）不命中。
- **密钥前缀库由四种扩到九种。** 新增 npm token、GitLab token、GitHub fine-grained
  token、JWT、`Authorization` 头里的 Bearer 值。此前这些只在
  `secretGuard.genericHighEntropy`（默认关）打开时才可能被拦。判定顺序「先具体后泛化」：
  一个 Slack token 出现在 Bearer 头里仍然报 `Slack token`。`docs/SECURITY.md` 的模式表
  与面板文案同步更新。
- **面板标注「尚未生效」的配置。** `docs.adrDir`、`rules.branchPattern`、
  `rules.commitPattern` 三项在 `src/` 中从未被读取，现在在高级区带一枚 `action.inactive`
  徽章，与「只读」区分开——只读是「能改但不在面板改」，这两者不是一回事。
- **`tsconfig.test.json` + `pnpm typecheck:tests`：`tests/` 与 `scripts/` 终于参与类型检查。**
  此前 `tsconfig.json` 的 `include` 只有 `src/**/*.ts`，测试目录从不被检查；CI 增加
  `Typecheck tests` 步骤，`prepublishOnly` 也串上。Node 版本由 20 提到 22（20 已于
  2026 年 4 月 EOL，`engines.node` 仍写 `>=20` 作为下限）。
- **`pnpm ci:checks` 由五项守卫增至七项**：新增镜像对成对变更（`README.md`/`README.zh.md`、
  `locale/en.json`/`zh.json`、`SKILL.md`/`SKILL.zh.md`）与版本三处对齐（`package.json`
  的版本在 `CHANGELOG.md` 里必须有对应标题）；发布入口检查内补上源码映射链路
  （构建产出 `.map` 时 `files` 必须包含 `src/`，否则消费端调试断链）。
  面板词典的占位符对齐另由 `tests/settings-schema.spec.ts` 断言，不在 `ci:checks` 里。
- **新增 `tests/chain.spec.ts`：第一批「触发器与五道守卫同链」的集成用例。** 此前的触发器测试
  全部以单独 listener + `next()=allow` 驱动，因此上面若干条高危（检查被询问吞掉、`-am`
  静默失效、镜像半脏阻塞无关提交）在单测视角下永远发现不了。
- **新增 `tests/commands.spec.ts`：`/dev-workflow` 此前零行为测试**，而 README 让用户用它验证；
  覆盖「off 后仍可 on」「手动 off 穿过一次无关设置写入」「运行期 off 与配置 off 的区分」。
- **新增 `tests/shell.spec.ts`：词法层此前无独立单测**，288 个用例只覆盖实现「恰好能处理」的
  形态，也正是六种绕过长期存在的原因。新增用例表驱动地跑正反两面的形态。

### Changed

- `docs/TRIGGERS.md` 纠正「顺序不影响最终结果」，补「我们看不见什么」清单与 `-F` 的
  同命令时序说明。
- `docs/SECURITY.md` 的凭据模式表由四种扩到九种，并写明前缀库只覆盖有固定形状的凭据；
  `sh -c` 的已知边界升级为运行时可见的说明。
- `docs/CONFIGURATION.md` 记录能力缺口（密钥与敏感文件无逐条例外、命令守卫单一档位、
  git 与对外守卫无 remote/branch 白名单），而不是当成漏掉的配置项；补 `releaseCheck`
  与 `checkoutDiscard`。
- `docs/DEVELOPMENT.md` 的数字与流程改为与测试断言一致（i18n 键数、守卫数量、CI 步骤）；
  `docs/I18N.md` 写明描述类文本在注册时求值这一边界，并同步 `ci:checks` 的实际输出样例；
  `docs/PUBLISHING.md` 的守卫条数由五项改为七项（新增镜像对与版本对齐两项的说明）；
  `CONTRIBUTING.md` 的环境要求写明 CI 跑的是当前 LTS 而非 `engines.node` 的下限。
- `skills/dsh-dev-workflow/SKILL.md` 与 `SKILL.zh.md` 明确「没有任何触发器监视建分支动作」，
  不再让模型的预期建立在插件的宣称上。

### Fixed

- **触发器不再被守卫的询问吞掉。** 瀑布由外向内、`allow` 之外一律透传，而触发器注册在
  外层、守卫在内层：默认档下 `gh pr create` 先被 `outwardGuard` 以 `ask` 拦下，PR 标题与
  描述的三段检查、发版的版本号与 CHANGELOG 检查**一行都不评估**，`state.record` 也不发生；
  用户批准那次泛泛的确认后命令直接执行。`git commit --amend` 同理吞掉提交信息检查。
  现在触发器即使下游是 `ask` 也先完成评估（`detect` 已命中，评估是纯函数加一次文件读），
  把发现合并进那道询问的 `reason` 与 `displayReason.en`/`zh`，`state.record` 照常写入。
  `docs/TRIGGERS.md` 里「顺序不影响最终结果」的说法已改正。
- **触发器「先记后问」改为「真问过才记」。** 指纹此前在提问之前写入，用户点「拒绝」后
  agent 重跑同一条命令，见 `seen` 直接放行——一次否决被降级成一次提醒；`never` 策略下
  连插件自己的拒绝也被记入。现在复用审批 seam：只有自己的提问真的弹出来了才 `remember`，
  别的 gate 即将提问时改写那道提问而不是放弃检查。
- **`/dev-workflow off` 的三处状态机缺陷。** (a) `off` 把命令自己也注销，回显不告知恢复
  方式，随后 `/dev-workflow on` 是「未知命令」；现在 `off` 保留命令自身注册并写明恢复
  方式。(b) `setActive(false)` 把 `registered` 清成 `''`，而 `'' !== registrationSignature()`
  恒成立——任何一次 loader / `volatile-update`（哪怕只是改 locale）都会把手动关掉的插件
  重新激活；现在用 `manualOff` 标志记住手动关闭，只有 mode 或自身签名真的变化才激活。
  (c) `status` 区分「运行期 off（未落盘）」与「配置里 off」，不再与面板显示矛盾。
- **`git commit -am "..."` 不再让提交信息检查静默失效。** `commitArguments` 只认
  `-m` / `-mXXX` / `--message=` / `-F`，而 `'-am'.startsWith('-m')` 为假 → 消息为
  `undefined` → 类型、破坏性变更与 `changelogOnFeat` 全部跳过，结论直接是 `ok`，连
  「这次没检」都不说。现在短选项簇逐字母解析（`-am`、`-avm`、`-qm` 都认得，取值选项
  吃掉簇剩余部分或下一个词）。
- **文档同步改为按「本次提交」判定，而不是整个工作区。** 此前用
  `git status --porcelain --untracked-files=all`：README 只改一半挂在工作区时，任何无关
  提交都被镜像 error 拦下（成对文件分两次提交，第二次必报错）；一条未暂存的 CHANGELOG
  改动就能满足 `requireChangelogOnFeat`（规则被静默架空）；与本次提交无关的脏文件会让
  纯文档提交判失败。现在提交路径用 `git diff --cached --name-only` 判定，工作区状态只留给
  `/dev-workflow check`；镜像对另一半「已暂存或已在分支」时降为 warning；CHANGELOG 由
  「本次提交含它」或「分支 diff 含它」满足。顺带去掉大仓库每次提交跑
  `--untracked-files=all` 的开销。
- **shell 词法层的六种静默绕过。** 编译产物实测曾全部放行：`sudo -u root git push --force`、
  `sh -c "git push --force origin main"`、`sh -c "rm -rf /"`、`echo $(git push --force …)`、
  反引号里的 `git reset --hard`、`find / -exec rm -rf {} +`。现在：`$(...)` 与反引号递归
  切进 token 流（带深度上限）；`sh`/`bash`/`zsh`/`dash`/`ksh`/`ash` 视为透明并把 `-c`
  的参数再解析一遍；`skipWrappers` 跳过取值选项（`-u`/`-g`/`--user=` 等）与其取值；
  `find -exec`/`xargs` 交给 rm 一类破坏性程序时按「目标集合是否由作者限定」判定——
  根目录或家目录为起点一律命中，谓词把集合收窄到作者选定的名字则放行。
- **Windows 上敏感文件守卫对 shell 读取全部失效。** `\` 被无条件当作转义符，
  `tokenize('type C:\Users\x\.env')` 得到一个不存在的路径，规则匹配失败放行；同一个文件
  经工具的 `file_path`（原始字符串）却被拒——两条路径行为相反。现在反斜杠只在转义表内
  的字符前才是转义符，否则保留原样。
- **`grep`/`glob` 的搜索模式不再被当成路径。** `PATH_FIELDS.grep` 此前含 `pattern` 与
  `include`，于是 `grep pattern=".env"`、`glob pattern="**/*.pem"` 一律 deny，
  「查 `.env` 有没有入库」这个本插件鼓励的工作流反而被硬拒，且 deny 不可配置、无逐条例外。
  现在搜索正则不参与路径匹配，只用 `path` / `include`；`file-guard` 也复用 `programWords`
  剥掉包装词，`sudo cat .env` 不再绕过。
- **命令守卫的目标判定。** `slice(0,-1)` 差一导致 `//` 条目永不可达，`rm -rf ~/*`、
  `rm -rf $HOME/*`、`rm -rf //`、`rm -r /etc` 全部放行，而 `rm -rf ~` 被拦——同一组目标
  一半拦一半漏。现在归一并修正切片；递归删除根级或家目录目标不再要求 `-f` 同时出现
  （`rm -r /etc` 也命中）。
- **git 守卫的漏报。** `git restore .`、`git restore --staged`、`git checkout .` 完全无守卫；
  `git push --mirror`（隐含 `--force` 与 `--delete`）只命中 `outward_push`，一旦放宽对外
  推送档位就连带绕过强推与删分支；`yarn publish` / `bun publish` 无任何守卫。现在补齐
  `restore`/`checkout` 形态、`--mirror` 归入 `forcePush`、包管理器扩到 yarn 与 bun。
- **默认档的提示疲劳，以及记忆开关只护 git 守卫。** 每次 `rebase` 都问，连
  `--continue`/`--abort`/`--skip`（冲突恢复与安全回退）也问；每次 `amend` 都问；对外
  的 push/tag/PR/publish 每次重新点头（`approver` 只注入 git 守卫）。现在豁免冲突恢复
  标志，并把会话内记忆接到对外守卫（`gitGuard.rememberApproved` 一处开关同时管两处）。
- **pre-pr 的三个缺口。** `gh pr create --fill`（或交互式无 `-t`/`-b`）此前得到
  `input={}`，规则全跳过却照样写 `state.record({kind:'pr',ok:true})`——squash 工作流下
  PR 标题就是最终 commit message；现在至少给一条「标题将由提交信息填充，无法校验」的
  warning 并记录。`-b "$(cat pr.md)"` 这类字面量此前不做字面量放弃判定，误报「缺
  What/Why/How to verify」并反复拦截；现在复用 `literal()`。PR 标题检查此前无视
  `commitCheck.enabled`/`onFailure`，同一套规则三个入口行为不一致；现在读同一份配置。
- **pre-release 的识别盲区与误报。** `git tag v$(cat VERSION)` 被判「不是语义化版本号」；
  `## v1.0.0 - date` 这种常见风格因捕获名带 `v` 而永远判「没有 1.0.0 条目」、每次打 tag
  必被硬拦；`npm version patch` 一条命令完成 bump+commit+tag，三层门禁全不触发；
  `pnpm --filter pkg publish` 虽然识别，版本却核对会话 cwd 的 `package.json` 而非被发布的包。
  现在 tag 名走 `literal()`、`## v1.0.0` 与 `[v1.0.0]` 归一化查表、识别 `npm version`、
  `--filter` 的包路径参与读取，并在 `docs/TRIGGERS.md` 补上「我们看不见什么」清单。
- **提交信息解析的另外三处盲区。** PowerShell 裸变量 `git commit -m $msg` 不被 `literal()`
  识别（只挡 `$(` 与反引号）→ 误报 `missing_type`；`echo … > m && git commit -F m` 的检测
  发生在执行前，文件尚不存在就静默跳过；`git commit --amend` 走编辑器、读不到消息时不校验
  ——而「用 amend 修消息」恰是最该检查的路径，现在这种情况下读一次
  `git log -1 --format=%B`。
- **审计：记录最终决策、可关联的 callId、写失败不再静默。** 此前 `action` 记的是配置档位
  而非实际决策（被拒、被批、自动放行无痕），也没有 `callId`，多守卫的记录无法关联；写盘
  失败只走 debug 日志，磁盘满或权限错误时审计静默断档。现在 `decision` 与 `callId` 各自
  成字段，写失败计数并在首次失败时上报；敏感路径的脱敏改为子串级，`cat /repo/.env && …`
  这类参数不再把目录原样落盘。
- **命中计数不再漏掉 `allow` 档。** `action === 'allow'` 提前 return，用户放宽某档后
  状态归零、审计对该操作无痕，与「命中先计数」的口径矛盾。现在每一档都计数与审计，用
  `action` 字段区分；同一次调用命中多条规则时全部计数，只有决策取最严。
- **无 git 或非仓库时的降级不再静默。** 提交前检查失败即 `files=undefined`，只剩提交
  信息规则在跑，用户看到的是「检查都过了」；同一个能力在 `check_doc_sync` 工具里却明确报
  `error.not_a_git_repository` / `error.git_not_available`。现在降级事实作为 warning 进入
  触发器结论。
- **locale 切换后工具与命令描述停在旧语言。** 工具描述与命令描述是注册时求值成字符串的，
  而 `resync` 只刷新 locale、locale 又不在注册签名里；面板改 locale 后技能目录立刻变新
  语言，每轮都可见的工具描述却不变。现在 locale 参与注册签名并触发重建——顺带修掉
  「重建时只重注册工具、不重注册命令」的次生问题。
- **同一发现在两个出口的渲染顺序相反。** 触发器侧 errors 在前，工具侧 warnings 在前
  且被测试固化，现在统一为 errors 在前。
- **`matchesPattern` 的前锚与重复分支。** 第二分支缺 `(^|/)` 前锚，`config/secrets` 会命中
  `myconfig/secrets`；该分支与第一分支重复，已删。
- **审批指纹对参数键序敏感。** 同一次 push 换个参数顺序就要重新弹问；现在序列化前递归
  排序对象键。

## [0.2.0] - 2026-10-06

### Added

- **可视化设置面板。** 插件现在在 DSH 设置里有一张自己的卡片，由两半组成：浏览器半
  `client.js`（手写的模块表格式，注册进 `settings.section` 槽位）与 Host 半
  （`src/index.ts` 里关闭 schema 自动页、并监听 `loader/volatile-update`）。
  - **与文件配置同源。** 面板没有自己的存储：保存经宿主的设置控制器写入当前 profile 的
    `cordis.patch.yml`，再提交进运行中的配置引用，**不需要重启**；`locale` 也会随之
    重新解析。
  - 32 项可在面板修改（开关与枚举，外加 `commitCheck.subjectMaxLength` 一个数字输入）；
    8 个危险 git 操作的档位、4 个对外动作的档位、五道守卫与审计的开关、提交与文档两组
    检查的规则都在其中。
  - 9 项（`codePaths`、`docs.docsDir`、`docs.adrDir`、`docs.changelog`、`docs.exclude`、
    `rules.branchPattern`、`rules.commitPattern`、`docs.mirrors`、`audit.path`）只读展示在
    默认折叠的**高级**区，旁边有按钮直接打开 profile 的 `cordis.patch.yml`；另有 2 项
    （`docs.readme`、`fileGuard.noRead`）只能改文件。路径与正则不下沉到主区：写错就静默失效
    的值不该交给没有校验的输入框。
  - **不重复 DSH 的插件总开关**，也不改由 DSH 拥有的设置（审批策略、沙箱模式）。
  - 样式只用主题发布的 `--dsw-alias-*` token，类名统一 `dsw-dev-workflow-` 前缀，
    `<style>` 带 `data-plugin` / `data-plugin-css`，HMR 能按归属清理。
  - **保存成功会在底部给一行提示**（`action.saved`），下一次编辑、取消或关闭设置面板时
    消失。官方 `SettingsForm` 只报失败、不报成功，而这张表单有 32 个字段：保存成功后唯一的
    变化只是按钮不再变灰，滚在顶部的人看不出发生过什么。提示属于「这一次打开」，所以不能只
    记在插件的草稿实例上——设置面板关闭时会卸载这个 section，而草稿实例与插件同生命周期，
    只记在那里会让提示在下次打开面板时重现。
- **配置面补齐并全部标记为可变。** `src/config.ts` 的每个叶子都加了 `.volatile()`——这是
  面板能读到并写入的前提；新增九个字段：
  - `commitCheck`：`enabled`（默认 `true`）、`onFailure`（`'warn' | 'block'`，默认 `block`）、
    `types`（默认 11 个 `COMMIT_TYPES`）、`requireScope`（默认 `false`，开启后「缺 scope」
    从软警告升为硬错误）、`subjectMaxLength`（默认 `50`，`min(1)` 且必须是整数）。
  - `docsCheck`：`enabled`（默认 `true`，只作用于提交前那次判定，`check_doc_sync` 工具不受
    影响）、`requireReadmeOnConfig`（默认 `false`：改 `package.json` / `cordis.patch.yml`
    却没动 README 类文档时给一条警告）。
  - `docs.exclude`（默认 `[]`）：命中的路径既不算代码也不算文档，用来排除生成物。
  - `gitGuard.rememberApproved`（默认 `false`）：见下一条。
- **`gitGuard.rememberApproved`：记住一次批准，同一操作本会话不再询问。** DSH 的审批是
  一次性的（`allowed-once`，没有 `allow-always`，也没有授权存储），而守卫把 `ask` 交给
  dispatcher 后**看不到答案**。所以开启后 git 守卫经 `ctx.get('approval')` 自己发起审批、
  自己读结果：`allowed-once` 放行并记进会话，`rejected` / `cancelled` / `unavailable` 一律拒绝。
  记忆键是「工具名 + 序列化参数」，`git clean -f` 与 `git clean -f -d` 是两次操作，换工作
  目录也是；按会话隔离，插件重新加载即清空，不落盘。`deny` 永不经过这条路；档里没有审批服务
  时把问题交回 dispatcher（与开关关闭时逐字相同），绝不把「问不出来」当成「同意了」；
  别的 gate 已经拒绝或已经要提问时也不自行再问。
- **补全四类安全守卫。** v0.1.0 只有 git-guard，其余三类是写在文档里的承诺；现在它们
  都是代码，并且共用 `src/guard/shared.ts` 的 `createGuard()`（接线、命中计数、审计回调、
  档位决策各一份实现）。
  - `src/guard/command-guard.ts`：拦截不可逆的 shell 命令——`rm -rf /`（含 `/*`、`~`、`.`、
    `*` 等危险目标）、`mkfs` 系列、`dd` 的 `if=`/`of=` 指向块设备、`> /dev/sda`、
    fork 炸弹、`chmod -R 777 /`。默认 `ask`（`commandGuard.dangerousShell`），
    普通删除（`rm -rf node_modules`、`rm -rf ./dist`）放行。
  - `src/guard/file-guard.ts`：从每次工具调用的参数里取路径（`file_path` / `path` /
    `pattern` / `include`，以及 shell 里已知读取程序的操作数），比对 `fileGuard.noRead`
    （默认 `.env`、`.ssh/id_rsa`、`*.pem`、`*.key`、`credentials`、`*.p12`、`.npmrc`、
    `secrets/`），命中即 `deny`。理由里给出文件名与命中的规则，**从不打开文件**。
  - `src/guard/secret-guard.ts`：扫描每次调用的全部参数，识别 AWS access key、GitHub
    token（`ghp_`/`gho_`/`ghs_`/`ghr_`）、Slack token（`xox[baprs]-`）与私钥头，
    命中即 `deny`；可选的 `secretGuard.genericHighEntropy`（默认关）额外标记无前缀的
    高熵字符串。**只报模式名，绝不回显匹配到的值**，同一条值也不进入审计记录。
  - `src/audit.ts`：审计记录写入 `audit.path`（默认 `.dev-docs/audit-log.jsonl`，每行一个
    JSON 对象）。记录守卫决策的形状与**脱敏后**的参数——凭据替换为 `[REDACTED]`，
    敏感路径只保留文件名；同步追加，写失败只记调试日志，绝不让工具调用失败。
  - `src/config.ts`：新增 `commandGuard` / `fileGuard` / `secretGuard` / `audit` 四组配置，
    全部安全默认（`enabled: true`、危险命令 `ask`、没有任何一项默认 `allow`）。
  - `locale/en.json` + `locale/zh.json`：8 个新 key，两本字典 key 与占位符保持对齐。
- `/dev-workflow status` 增加第五行：审计记录的开关与路径。
- **补全 PR 触发器与发版触发器。** v0.1.0 只有提交前触发器；现在三个约定触发器齐备，
  共用 `src/triggers/shared.ts` 的 `detailsOf()` / `askAbout()`（截断、双语 `displayReason`、
   `MAX_DETAILS = 5` 各一份实现），由 `enableOwnTrigger` 统一开关。
  - `src/triggers/pre-pr.ts`：识别 `gh pr create`，校验 PR 标题（**直接复用
    `checkCommitMessage`**——squash merge 后标题就是 main 上的提交信息）、描述的
    `## What` / `## Why` / `## How to verify` 三段（缺段或段内为空都算缺失）、
    未勾选的 `- [ ]` 清单项；无 `#<数字>` 的 Issue 引用只给警告。支持
    `--title` / `--body` / `--body-file`（含 `--opt=value` 写法），
    `-F` 指向的文件在判定时刻读取，`-F -` 跳过描述规则。
  - `src/triggers/pre-release.ts`：识别 `git tag <name>` 与 `npm`/`pnpm publish`（同一条命令
    行两件都做时一起收集）。校验 SemVer、tag 与 `package.json` 的 `version` 是否一致、
    预发布版本是否被推到 `latest`（未写 `--tag` 时按 npm 的默认值记为 `latest`）、
    CHANGELOG 是否有 `## [Unreleased]` 段、段内 `###` 分类是否为 Keep a Changelog 的六类之一、
    `[Unreleased]` 与 `[<version>]` 是否两段皆空。
  - `src/state.ts` 的 `CheckKind` 由 `'commit' | 'doc'` 扩为四种，新增 `'pr' | 'release'`；
    targetId 分别为标题指纹与版本号。
  - `locale/en.json` + `locale/zh.json`：新增 `command.toggle.kind.pr` /
    `command.toggle.kind.release` 与两个触发器的文案，共 17 个新 key；
    `trigger.pre_commit.omitted` 提升为共用的 `trigger.omitted`。

- **补全架构决策记录。** `docs/ADR/` 从两份扩到五份，三份新 ADR 补齐了此前只在
  `docs/TOKEN-BUDGET.md`、`.dev-docs/prompt.md` 与代码注释里零散存在的推理过程：
  - `docs/ADR/003-summary-plus-on-demand.md`：为什么常驻的只有一行目录条目与两个工具定义、
    规范全文按需读取；含 token 成本算法（全文常驻 ≈ 2600 token/轮，是验收线的十倍）。
  - `docs/ADR/004-action-triggered-not-manual-mode.md`：为什么按动作自动触发而不让用户手动切档；
    **记录了手动切档的失败教训——用户会忘记切，而忘记切比不装更糟**。
  - `docs/ADR/005-agents-md-as-context-anchor.md`：`AGENTS.md` 与 `SKILL.md` 的分工
    （每轮都要成立的稳定规则 vs 做事时才读的规范全文），含
    `@deepseek-ai/dsh-agent-instructions` 的加载链、候选名、65536 字节预算与「不 watch」约束。

- **第五道守卫 `outward-guard`：拦下「本机没事、但别人立刻看得见」的动作。**
  此前四道守卫守的都是「东西会丢」，而 agent 抢在用户点头之前就把分支推上去、把标签打上、
  把 PR 开出来、把版本发出去，本机一样东西都没丢——用户却已经被对外宣称同意了。
  新守卫填的正是这个缺口，四个策略键默认全为 `ask`（不是 `deny`：这是唯一一道本机不会造成
  任何损失的守卫，要的是同意而不是禁止）。
  - `src/guard/outward-guard.ts`：`outwardGuard.push` 认任意 `git push`（强推仍归
    `gitGuard.forcePush`，两者同时命中时理由由更严者胜出）、`outwardGuard.tag` 认
    `git tag <name>`（`-l` / `-d` / `-v` 这类读操作不算）、`outwardGuard.pullRequest` 认
    `gh pr create`、`outwardGuard.publish` 认 `npm` / `pnpm publish`；`--dry-run` / `-n`
    一律放过。
  - 识别**复用触发器里的同一份判断**（`detectRelease()` 与 `detectPullRequest()`），
    复制出第二份「什么算一次发版」正是会让门禁和检查对同一行命令各说各话的做法。
  - 注册排在破坏性 git 之后、机器级破坏之前；面板新增「对外可见动作」分组。
  - `tests/outward-guard.spec.ts` 覆盖四类动作、`--dry-run` 排除、开关关掉时全放过
    与「上游拒绝不被降级成询问」。

### Changed

- **DSH `peerDependencies` 改为只写下界 `>=0.2.0-rc.2`，去掉上界 `<0.3.0`。**
  三个 DSH 域内包（`@deepseek-ai/dsh` / `dsh-skill` / `dsh-tools`）都改成这一条。
  下界从 `rc.1` 抬到 `rc.2` 是因为实测基线就是 `0.2.0-rc.2`（本机 `dsh --version` 与
  三个包的实际版本），凭记忆写更低的下界等于宣称一段没人验过的兼容性。
  去掉上界是**明确的取舍**：`0.3.0` 尚不存在，`<0.3.0` 只是猜测，而代价是 DSH 一旦升到
  `0.3`，即使 API 变了插件也会被加载、问题推迟到运行时才暴露，不再由加载时的 `preflight()`
  干净地禁用。规则与代价已写进 `docs/PUBLISHING.md` 第 4 条，`docs/SECURITY.md` 的
  供应链一节同步；`README.md` / `README.zh.md` 的环境要求表随之更新。
- `README.md` / `README.zh.md` 新增「环境要求」一节：DSH 运行时 `>=0.2.0-rc.2`、
  Node.js `>=20`、pnpm `10.x`，以及各自的查看方式。此前这三条只写在 `CONTRIBUTING.md` 里
  （贡献者视角），**使用者视角的要求一条都没有**；其中最容易踩的是 DSH 版本——不在范围内
  的后果是被静默禁用而不是安装失败，所以连症状和排查入口一并写在了 README 里；
  `docs/README.md` 的 README 那行也补上了这一节。
- `README.md` / `README.zh.md` 里 DSH 的链接从 GitHub 组织页 `github.com/deepseek-ai`
  换成了真正的仓库 `github.com/deepseek-ai/deepseek-harness`（后者才是这三个
  peerDependencies 的来源 monorepo，`ACKNOWLEDGEMENTS.md` 一直链的是它）。
- `docs/README.md` 的「我想知道为什么这样设计」一节从一行 ADR 目录扩为逐份登记
  （001–005 各一行说明 + 模板），并补上 ADR 现在有五份。
- `docs/PUBLISHING.md` 补三节：**bundle manifest 完整性检查**（四处链路逐条核对，
  其中两条无自动守卫，必须靠 `pnpm pack --dry-run` 与一次真实安装确认）、
  **0.x 阶段的撤回策略**（按「是否对已装用户造成实际伤害」分三类处置，
  因为 0.x 允许 MINOR 位带破坏性变更，不兼容本身不是撤回理由）、
  以及 `unpublish` 的三个技术前提（72 小时窗口、只接受单个版本或整个项目、
  撤掉最后一个版本会被拦且 24 小时内发不回来）；并把 `ci:checks` 输出示例里的
  过期数字 `locale keys aligned (56 keys)` 更正为 81。
- `docs/SECURITY.md` 从「v0.1.0 只做 git-guard」改写为各道守卫的完整说明，含各自的
  默认值与理由；`docs/CONFIGURATION.md` 补四组新配置；`docs/TRIGGERS.md` 与
  `docs/ARCHITECTURE.md` 的监听器数量与次序更正为「约定 → git → 命令 → 文件 → 密钥」；
  `docs/DEVELOPMENT.md` 补一节「加一整道新守卫要动什么」。
- `docs/TRIGGERS.md` 补 PR 与发版两个断点的完整说明：为什么三者都挂在 `tools/pre-execute`
  （事件目录里没有 PR 创建或发版事件，但动作本身经过 `bash` / `pwsh`，能在动作发生前拦下，
  不构成降级条件）、各自的识别规则与检查项、状态模型扩为四种 `checkType`，
  并更新能力边界表。
- `docs/PUBLISHING.md` 的 v0.1.0 发布记录补上真实结果：提交 `219dbdb`、PR #11、
  annotated tag、发布产物 66 文件 / `shasum 8e35f3866fe53bd1973577ddf1ccbb73e5e0ff4b`、
  发布认证需要 bypass-2FA 的 granular token、以及 GitHub Release 地址；
  并记下「发布成功后 packument 短时 404 是 CDN 负缓存，判断发布是否成功应看 PUT 状态码
  与 tarball shasum」。
- 修正 `locale` 这一项的措辞：面板字段名由「消息语言」改为「插件文案语言」
  （`client.js` 的 `field.locale` / `hint.locale` 两本字典同步），`docs/CONFIGURATION.md`
  的表格行与 `locale: 'auto'` 一节也一并改写。原来的说法容易被读成
  「这个开关决定模型用什么语言写提交信息、PR」——它管不到这件事：提交信息的语言规则
  写在技能里（subject 一律英文，正文与页脚项目内自选一种），中英两版规则逐字相同；
  这个开关只决定插件自身文案（检查结果、技能正文、审批提示）用哪种语言。
- 面板在 `locale` 选中 `auto` 时直接标出它当前解析成哪个语言（新增 `hint.localeResolved`
  键，双字典同步），例如「「自动」跟随本机语言，当前为：中文（zh-Hans-HK）。」——
  `auto` 是默认值，不写出来用户无法知道自己实际看到的是哪种语言。宿主在 node 进程里
  解析（`src/i18n.ts` 的 `resolveLocale()`），面板只能在浏览器里用同一条 `zh` 前缀规则
  复刻；选中显式语言时不显示这一行，因为选项本身已经说明了。
- 面板底部的两个按钮改为靠右对齐（`action.discard` 那行的 `justify-content: flex-end`）。
  此前这一行没有对齐声明，成功/失败提示的 `flex: 1` 会在提示出现时把按钮推到右侧、
  提示消失后又弹回左侧——同一个按钮在两次保存之间会左右跳。
- 底部丢弃草稿的按钮由「放弃 / Discard」改称「取消 / Cancel」。官方 `SettingsForm`
  根本没有这个按钮（它在卸载时调 `onDiscard`），所以措辞由本插件定；`取消` 是
  DSH 自带界面里对同一动作的标准说法（`dsh-client-locale` 的 `cancel` 键），也与面板
  关闭面板即可丢弃草稿的行为一致。
- 修正 `security.guard.approval_rejected` 的措辞：由「你拒绝了这次操作 / You rejected this
  operation」改为陈述结果（「这次操作未获批准，因此保持被拒状态。」/「This operation was not
  approved, so it stays refused.」）。审批策略为 `never` 时，`dsh-user-approval` 的 `decide()`
  **在提问之前**就返回 `rejected`（该包 `lib/index.js:175`），没有任何人被问过，原文案等于
  把平台的自动拒绝说成用户的决定——上游 `dsh-tools` 的 deny reason（`the user rejected
  tool "${name}"`，该包 `lib/index.js:3468-3474`）正是同一个毛病，本插件不跟着犯。
  该文案只在 `rememberApproved: true` 时可达，因此是潜在缺陷而非现网问题。
- **权限预设为 `never` 时，插件自己拒绝并说明原因，不再返回一个不会有人回答的 `ask`。**
  此前四道守卫与三个触发器一律返回 `ask`，而在 `never` 下 `dsh-user-approval` 的
  `decide()` 在提问前就返回 `rejected`（`lib/index.js:175`），dispatcher 再把结果渲染成
  「用户拒绝了工具」——用户什么都没看到，模型却被告知用户做了决定。现在这些 gate 先读
  本会话的有效策略，是 `never` 就自己返回 `deny`，结果与之前相同（都是拒绝），但理由保留
  守卫自己的判定并追加 `approval.disabled`（说明「没有人被问到」、两条放行路径，以及
  「设为『允许』会一直生效直到改回『询问』」这一代价——面板会把它标成「已覆盖」）。
  刻意**不**改成静默放行：守卫静默放行就不是
  守卫。新增 `src/approval-policy.ts`（`unaskable()`，无本地依赖以免 `guard/shared ↔
  guard/approval` 成环）；读不到策略或没有会话时一律维持原行为，避免把能用的提问变成拒绝。
  新增字典键 `approval.disabled`（双字典同步，键数 86→87）。
- **把某个字段选/填回默认值时，面板改为清掉 profile 里的那一项，而不是写一个和默认值相同的值。**
  平台判定「已覆盖」看的是 user 层有没有这个键，不看值等不等于默认值（官方原文见
  `dsh-client-ui-primitives/lib/index.js:7099-7102`），所以此前把 `subjectMaxLength` 从
  `72` 改回默认的 `50` 并保存，写入的是 `{op: 'set', value: 50}`，徽标与「恢复默认」按钮
  留在一颗重置了也没有变化的字段上——用户明确反馈这很碍眼。现在 `DraftForm.edit()`
  先拿**继承层**（`state.base`，与 `value`/`user` 同一套嵌套形状，用同一组 path 寻址）比较：
  新值等于继承值且 user 层确实写着这一项时，改暂存 `{clear: true}`，保存走
  `{op: 'unset', path}`，徽标当场消失。两条边界未变：新值不等于继承值但等于当前有效值时
  仍丢弃草稿、不产生写操作；`invalid` 的坏值仍优先（不会被当成「选回默认值」而静默清掉）。
  面板侧的 `overridden()` 也把已暂存的 clear 视为「不再覆盖」，否则控件显示默认值、字段
  却仍声称被覆盖——正是用户看到的那个矛盾。
- `docs/CONFIGURATION.md` 补一节「「已覆盖」与「恢复默认」」，说明这对徽标/按钮判的是
  **user 层有没有显式写这一项**，而不是值等不等于默认值（官方原文与 `stored(field)`
  实现见 `dsh-client-ui-primitives/lib/index.js:7099-7102` / `:7370-7373`），并写明本面板
  比官方多走一步——选回继承值即等同于「恢复默认」，两条路都发 `{op: 'unset'}`。
  安全相关的档位尤其需要这份清单——从 `ask` 改成 `allow` 之后忘改回来，`allow` 会一直
  生效；现在把档位选回 `ask` 并保存，profile 里那一项就被删掉了。`docs/ARCHITECTURE.md`
  的 `unset` 一句同步。
- **更正 `docs/TOKEN-BUDGET.md` 的按需成本表。** 表里记的还是第三阶段刚写完时的
  `SKILL.md` 10602 字符 / 212 行、`SKILL.zh.md` 5855 字符 / 173 行；技能在第四、五阶段
  长了一倍，**当前值见该表本身**（行数按
  `Get-Content` 计，末行换行不算一行；字符数按 UTF-8 解码后的字符个数，不是字节数）。
  常驻那两行
  （766 / 137 / 903 ≈ 226、522 / 50 / 572 ≈ 240）本次复测完全一致，只有按需部分过期；
  汇总表的「规范全文」一档随之上调。顺带把
  `docs/ADR/` 里写死的行列数删掉，改为指向本表——观测值只该有一个出处。
- `docs/TRIGGERS.md` 的「降级路径」补第三条：设置面板确实有一处**真实降级**。
  `ctx.remote.$host` 只暴露 `{ home, isLoopback }`、包私有 `host.call` RPC 只有动态包
  （vm-sandbox）路径才有（需要 `harness.handle`），所以面板在浏览器侧用同一条 `zh`
  前缀规则重算 `auto` 的解析结果；`documentAvailable` 由 `$host.isLoopback === true`
  决定；面板本身经 `ctx.inject(['settings'], …)` 可选，缺 `settings` 的档位只是没有
  这个页面。前两条降级假设（`tools/pre-execute` 不存在、skill provider 不支持动态内容）
  经核对**不需要降级**，结论不变。
- `docs/ARCHITECTURE.md` 的「不跑 shell 的命令行解析」同步实现：补上 `${VAR}` 的保留、
  `skipWrappers()` 与 `TRANSPARENT` 集合（`sudo` / `doas` / `env` / `nohup` / `command` /
  `exec` / `time` / `npx` 加 `VAR=value` 赋值），并写明 `sh -c "git push --force"` 属
  认不出的已知边界。
- `docs/SECURITY.md` 的审计章按实现重写（原先声称「只记形状」而代码落完整参数副本），
  「不做什么」表与「日志里有什么」并入其中；「本插件不是安全边界」补上 `sh -c` /
  `node -e` / `python -c` 三处已知绕过。
- `CONTRIBUTING.md` 明确「分期到此为止」：后续工作不再编号，标注 ADR 时间写日期而不写
  「第几阶段」；`AGENTS.md`、`ACKNOWLEDGEMENTS.md`、五份 ADR 与 `docs/ADR/template.md`
  里的分期编号一并换成日期或事实描述。`scripts/ci-checks.mjs` 新增一条机械守卫：
  仓库里任何非豁免的 `.md` 出现 `第N阶段` 即失败（`CONTRIBUTING.md` 定义分期、
  `CHANGELOG.md` 是历史记录，两者豁免）。
- 删除 `pnpm test:coverage` 脚本：它依赖未安装的 `@vitest/coverage-v8`，实跑必然
  exit 1，CI 与任何文档都不需要它。`CONTRIBUTING.md` 的命令表同步删去该行。
- **双语 README 从「手册」改回「入口」**：首屏只回答四件事（这是什么、为什么值得用、
  怎么跑起来、去哪看更多）。定位句不再只写「守门员插件」——那是守卫部分的身份，会让人以为
  整个插件就是守卫；改为「面向编码 Agent 的一套开发工作流，以插件形式分发」，下面依次列出
  规范、检查、守卫三层。新增 `Why` / `为什么需要它` 一节，讲的是规范本身的困境而不是守卫：
  每个项目都有这套约定，写下来没人会在该用的那一刻去翻（Agent 尤其不会），不写下来就得每个
  会话重说且会漂移；本插件要做的就是让 Agent 随身带着它、让工具执行能机械检查的部分——
  README 只留结论，不复述 `docs/ADR/001-skill-first-approach.md` 与
  `docs/ADR/004-action-triggered-not-manual-mode.md` 里的论证过程。Features 压到 6 条各一行，
  功能细节留在 `docs/`（`docs/README.md` 已逐份登记，链接不丢）；「环境要求」表格去掉说明列
  只留组件与版本，版本不匹配那段压成三句；Quick Start 补一步最小验证（`/dev-workflow status`
  + 一个应当被拦下的动作）；文档索引收到 3 条，`LICENSE` 一行的去处由底部的许可证一节承担；
  贡献指引压成一句。英文 118 → 85 行、中文 101 → 79 行，两边章节一一对应。
- README 里的 `DSH` 一律写全称 `DeepSeek Harness`（首次出现带 `dsh`）；命令字面量
  （`dsh --version`、`dsh plugin … add …`、`/dev-workflow`）保持不变。

### Fixed

- **`git push --force-with-lease` 会短路掉强推判定。** 只要参数里有
  `--force-with-lease`（含 `=origin/main` 形式），`pushHit()` 就整表提前返回，于是
  `git push --force --force-with-lease origin main` 放行——而 plain `--force` 压过 lease
  并真的覆盖远端。现在只有**不带** `--force` / `-f` / `+refspec` 时 lease 才免检。
- **透明前缀使守卫看不见真实命令。** `programInvocations()` 原先只剥 `VAR=value` 与
  `env`，所以 `sudo git push --force`、`nohup rm -rf /`、`npx npm publish` 一律漏过。
  现在 `src/shell.ts` 导出 `TRANSPARENT` 集合与 `skipWrappers()`，五道守卫共用一处修复。
- **`${HOME}` 永远匹配不上。** `tokenize()` 把 `{` / `}` 当分隔符丢掉，`rm -rf ${HOME}`
  被拆成无从判断的碎片，`DANGEROUS_TARGETS` 里的 `'${HOME}'` 是死条目。现在 `${VAR}`
  保留为一个词；`isDangerousTarget()` 同时归一化尾随斜杠，`rm -rf $HOME/`、`rm -rf ~/`
  与 `rm -rf /` 一样命中。
- **发版守卫把演习当成发布。** `npm publish --dry-run`（及 `-n`）会上报一次「预发布版
  发到 latest」的误报；现在 `detectRelease()` 对这两个选项短路。
- **PR 检查表把模板之外的复选框也算进去。** `uncheckedBoxes()` 原先数整个描述里的
  `- [ ]`，作者自加的 `## Remaining work` 段会被误判；现在只在模板要求的
  `What` / `Why` / `How to verify` 三段之内数。
- **`.env.example` 被当成机密。** 命中 `.env` 的文件名前缀规则会连示例文件一起拒掉，
  而示例文件按惯例不含真实凭据、且是仓库里最需要被读的文件之一。现在
  `example` / `sample` / `template` / `dist` / `defaults` 五个示例变体放行。
- **`git push --delete` 只是文档里的承诺。** `SKILL.md` 的危险表列了这一行，`pushHit()`
  却只认力推，所以删远端分支既不问也不入审计。现在 `--delete` / `-d` / 空左侧 refspec
  （`git push origin :topic`）都归 `gitGuard.branchDelete` 管——与本地 `git branch -D`
  同一份损失、同一个策略键，而不是新加一个只有极端情况才用得到的开关。
- 打包不再可能发出缺文件的产品：`package.json` 增加 `prepack`（`pnpm build && pnpm
  ci:checks`），`scripts/ci-checks.mjs` 增加发布入口存在性检查——`lib/index.js`、
  `client.js`、`locale/en.json`、`skills/dsh-dev-workflow/SKILL.md` 任一不存在、
  或没被 `files` 白名单覆盖即失败（`cordis.patch.yml` 由既有的 patch 检查负责）；
  CI 里 `ci:checks` 排在 `build` 之后。

### Security

- 补齐 `--force-with-lease` 与透明前缀两个绕过路径的回归测试：`tests/guard.spec.ts`
  新增强推组合与 `sudo git push --force` 用例，`tests/command-guard.spec.ts` 新增
  `rm -rf ~/`、`$HOME/`、`${HOME}` 与 `sudo rm -rf /`、`nohup doas rm -rf /` 用例。

## [0.1.0] - 2026-10-05

### Added

- 项目骨架：`package.json`、`tsconfig.json`、`cordis.patch.yml`、`.gitignore`、
  `.editorconfig`、`.gitattributes`。
- 工具链配置：ESLint 9 flat config、Prettier、Vitest。
- `scripts/with-src.mjs`：在 `src/` 尚不存在时跳过 `tsc`，使 `build` / `typecheck` 保持可跑通。
- `AGENTS.md`：面向 AI 编码工具的稳定规则（核心原则、关键约束、常用命令、详细规范入口）。
- 双语 README：`README.md`（英文）与 `README.zh.md`（中文）。
- `CONTRIBUTING.md`：环境搭建、分支命名、提交规范、PR 流程、国际化同步规则、安全操作规范。
- `LICENSE`：MIT。
- `locale/en.json` 与 `locale/zh.json`：面向用户的展示元数据与文本骨架，key 集合完全对齐。
- `scripts/ci-checks.mjs`：CI 守护，校验两个 locale 字典 key 一致，`cordis.patch.yml` 既被
  `dsh.bundle.patch` 声明又列入 `files`，以及两份 SKILL 文件的 frontmatter 合法且章节数量与层级顺序一致。
- `.github/workflows/ci.yml`：push 到 main 与 PR 时执行 install / typecheck / lint / format / test /
  build / locale 与 manifest 校验。
- commitlint（`commitlint.config.mjs`）与 husky 钩子：`commit-msg` 校验提交信息，
  `pre-commit` 对暂存文件跑 ESLint 与 Prettier。
- `skills/dsh-dev-workflow/SKILL.md` 与 `skills/dsh-dev-workflow/SKILL.zh.md`：完整开发工作流规范
  的双语单一事实源，共 13 个章节（核心原则、分支模型、提交信息规范、原子提交、PR 流程与质量门禁、
  文档同步工作流、版本发布、CHANGELOG 维护、安全操作规范、自动触发时机等）。两份文件的章节数量
  与层级顺序由 CI 校验。
- 规范补充 14 处此前只能靠自觉的规则：分支保护与大小写约定、用 `git merge main` 保持最新的理由、
  Issue 引用写法、subject 语言、`BREAKING CHANGE:` 页脚精确格式、PR 粒度上限（200–400 行）、
  文档同步的五类豁免、`docs/` 只描述 main、发布后验证、预发布版本与 dist-tag、废弃与移除、
  回滚、72 小时撤回窗口，以及全新的「CHANGELOG 维护」整章（该写什么、不该写什么、怎么写、
  正反示例、何时写、依赖升级例外、破坏性变更）。
- 插件核心代码（`src/`，8 个文件）：`src/config.ts` 用 Schemastery 声明配置面（每个字段都带默认值），
  `src/i18n.ts` 用 `createRequire` 读取 locale 字典并以 `Intl.DateTimeFormat()` 解析 `auto`，
  `src/git.ts` 通过 `ctx.get('subprocess')` 的可选服务运行 git，`src/skills/provider.ts` 注册单一
  技能 `dsh-dev-workflow`（目录描述与正文都随当前 locale 动态返回），`src/index.ts` 是插件入口。
- 两个工具：`check_commit_message`（按 Conventional Commits 校验提交信息，并对过长标题、句尾句号、
  过宽正文、跨模块提交、缺少 scope 给出可忽略的软警告）与 `check_doc_sync`（成对文件只改一半时报错，
  代码变更未带文档或 CHANGELOG 条目时给警告）。
- `docs/TOKEN-BUDGET.md`：常驻 token 的实测数字与复算方法。实测常驻增量约 900 字符
  （工具定义 + 一行技能目录条目，约 200–250 token），规范全文只在模型主动读取技能时支付。
- `locale/en.json` 与 `locale/zh.json` 补齐两个工具的参数字典、错误码与软警告文案，共 40 个 key。
- 工作流规范补充 6 处：本地验证与 CI 的分工（本地是建议、CI 是硬门禁、本地通过不等于 CI 通过）、
  squash merge 的提交信息来源（squash 提交取 PR 标题，故 PR 标题必须符合 Conventional Commits）、
  hotfix 流程（从 `main` 切出、直接合回、条目写入 `[Unreleased]`）、冲突解决后必须重新跑
  typecheck / lint / test、CI 失败的处理（修根因而非改配置）、提交前扫描密钥模式且泄露后必须轮换密钥。
  SKILL 双语章节数由 26 增至 28。
- 贡献者规范 `CONTRIBUTING.md` 补充 4 节：依赖管理（固定 pnpm、锁文件入库、不混用包管理器）、
  版本号单一源（只在 `package.json` 维护，徽章与文档引用均派生）、忽略规则清单、测试规范
  （测试放 `tests/` 目录、命名与覆盖率要求）。
- `/dev-workflow` 命令：`on` / `off` 切换插件，`status` 报告当前模式、locale、
  最近一次检查结果与守卫命中次数，`check` 按工作流规则即时检查整个工作区。
  命令在 DSH 命令服务存在时注册，不存在时静默跳过。
- pre-commit 触发器（`src/triggers/pre-commit.ts`）：挂在 `tools/pre-execute` waterfall 上，
  当 agent 通过 `bash` / `pwsh` 工具执行 `git commit` 时，把提交信息检查、变更文件检查与
  `rules.requireChangelogOnFeat` 合起来跑一遍（`src/checks.ts`），命中问题时给出
  `ask` 提示。提示文案按客户端 locale 双语渲染，每一份都用对应语言的翻译器重新判定。
  先调用链上后面的门禁，只在它返回 `allow` 之后才自查，绝不改判上游的决定。
- 会话内去重状态（`src/state.ts`）：按 `${sessionId}:${checkType}:${targetId}` 记住已报告过的
  问题，同一会话同一问题只提示一次，跨会话允许重新提示；只存在内存中，不落盘。
- `docs/TRIGGERS.md`：触发器挂载的事件、判定一次「提交」的保守规则、检查内容、双语提示的
  渲染方式、去重状态模型，以及主路径的真实能力边界（含与 husky 的分工）。
- `locale/en.json` 与 `locale/zh.json` 补齐命令、触发器与 `feat` 提交强制 CHANGELOG 的文案，
  共 56 个 key。
- git-guard（`src/guard/git-guard.ts`）：第二个 `tools/pre-execute` 监听器，扫描危险 git 命令。
  识别 force push（含 `-f` 与 `+refspec`）、`reset --hard`、`rebase`、`commit --amend`、
  `branch -D`、`clean -f`、`checkout -- <path>` 与 `--no-verify`，按 `config.gitGuard` 决定
  `deny` / `ask` / `allow`。带 `--force-with-lease` 的推送放行，裸 `--force` 的提示里附带
  改用 `--force-with-lease` 的建议。多条规则同时命中时取最严的一条，绝不削弱上游更严的决定。
- 共用命令行解析层（`src/shell.ts`）：不跑 shell 的词法切分，处理引号与转义、按
  `&&` / `||` / `;` / `|` / 换行切段、跳过 `env` 与前导赋值、跳过 `-C` / `-c` / `--git-dir`
  等带值的全局选项，取出 `git` 子命令与参数。提交前检查与 git-guard 共用它。
- `config.gitGuard` 由 6 个字段扩为 9 个：新增 `cleanForce`、`checkoutDiscard` 与 `noVerify`。
  `cleanForce` 不复用 `hardReset`（`clean -f` 删未跟踪文件，与丢弃已跟踪文件的改动不是一回事）；
  `noVerify` 默认 `ask` 而非 `deny`，因为它是钩子出错时的逃生通道。
- `docs/ARCHITECTURE.md`：模块地图、具名导出与 `inject` 的选择、注册所有权的归属、
  一次检查的数据流与错误处理约定。
- `docs/CONFIGURATION.md`：全部配置字段与默认值，以及 `gitGuard` 三个不显然默认值的理由。
- `docs/TOOLS.md`：两个工具与 `/dev-workflow` 命令的合同、参数、返回结构，以及它们执行的每条规则。
- `docs/I18N.md`：字典读取与插值、`locale` 三取值与 `auto` 的解析时机、`displayReason`
  双语与中文键必须是字面 `zh`、`ci:checks` 的 key 对齐守护。
- `docs/SECURITY.md`：git-guard 保护什么、刻意不做什么（不读敏感文件、不联网、不落盘、
  不写日志文件），以及它与 husky、GitHub 分支保护的分工。
- `docs/ADR/template.md` 与两份架构决策记录：`001-skill-first-approach.md`（规范为什么放技能
  而不是系统提示）与 `002-plugin-not-preset.md`（为什么是插件而不是模式或预设），
  含被否决方案及其理由。
- 测试套件（`tests/`，7 个 spec + 1 个共享脚手架，共 107 个用例）：`register.spec.ts` 覆盖
  cordis 契约（具名导出、无 `default`、`inject`、注册与注销清单、工具定义形状）、
  `config.spec.ts` 覆盖每个默认值与校验报错、`i18n.spec.ts` 覆盖两份字典的 key 与占位符对齐
  及 `t()` 的分语言与回退、`impl.spec.ts` 覆盖两个判定函数与 `evaluate` 的阻塞/建议边界、
  `guard.spec.ts` 覆盖每条 git-guard 规则与三档策略、`trigger.spec.ts` 覆盖触发时机与去重、
  `skill-parity.spec.ts` 覆盖 SKILL 两份语言的标题数量与顺序。测试直接 import `../src/*.js`，
  由 Vitest 转译源码，不依赖 `lib/` 构建产物。
- `docs/DEVELOPMENT.md`：本地循环、目录职责、测试的组织方式与写测试时的约定、
  加一条新规则所需的完整改动清单、CI 的守卫范围，以及若干已知的坑。
- `ACKNOWLEDGEMENTS.md`：上游依赖、作为实现范式被研读的官方包、作为形态参照的社区项目、
  被引用的规范，以及开发工具链，逐项列出作者与许可证。
- `docs/PUBLISHING.md`：发布前检查清单、每一步的实际命令、DSH peerDependencies 的
  分段枚举规则（写错这一节的后果是插件被静默禁用而非安装失败）、撤回与废弃的处置，
  以及本机踩过的坑（镜像源不能发布、`npm audit` 必须显式指定官方 registry）。
- `docs/README.md`：文档索引，按「想用插件 / 想贡献 / 想发版 / 想知道为什么这样设计」
  四条读者路径组织。
- `docs/SECURITY.md` 补发布相关章节：发布产物的白名单能推导出什么、审计结果该怎么读
  （运行期零依赖意味着所有命中都在开发期路径上），以及发布者的凭据放在哪里。

### Changed

- 包名采用 `@melosic/dsh-dev-workflow`：`dsh-dev-workflow` 在 npm 上已被他人占用。
- 工具名不得使用 `:` 命名空间分隔符，只能包含 `[A-Za-z0-9_-]` 且不超过 64 字符
  （DeepSeek function-name 合同）。
- 国际化字典目录由 `locales/` 修正为 DSH 实际约定的单数 `locale/`，文件名为短语言 id
  （`locale/en.json`、`locale/zh.json`）。
- 技能正文目录由预留的 `assets/` 改为 `skills/dsh-dev-workflow/`：`@deepseek-ai/dsh-agent-preset`
  等官方包即采用 `skills/<name>/SKILL.md` 布局，且该路径由 `package.json` 的 `files` 发布。
- `ci.yml` 中关于 Node 版本矩阵的注释已修正：单版本是为控制审查节奏，而非私有仓库的 Actions
  分钟配额（仓库已转为 public，标准 runner 免费）。
- 双语 README 顶部的语言切换行改为普通文本行（不再使用引用块）：去掉指向当前语言自身的链接，
  当前语言的标签保留为纯文本，另一种语言仍为链接。`README.md` 显示
  `**English | [简体中文](README.zh.md)**`，`README.zh.md` 显示
  `**[English](README.md) | 简体中文**`。
- 双语 README 的文档链接列表去掉 `.dev-docs/` 一条：该目录仅存在于开发者本机、未纳入版本控制，
  对仓库读者没有意义。
- `src/checks.ts` 中的命令行词法解析（`tokenize` / `segments` / `git` 调用识别）与
  `commandOf` 提取到 `src/shell.ts`，供提交前检查与 git-guard 共用，避免两处各写一份
  会漂移的解析。`detectCommit` 相应简化为遍历 `gitInvocations()` 的结果。
- 双语 README 的文档链接列表改为指向已落地的参考文档（`docs/ARCHITECTURE.md`、
  `docs/CONFIGURATION.md`、`docs/TOOLS.md`、`docs/I18N.md`、`docs/SECURITY.md`、`docs/ADR/`），
  不再写「随阶段落地后再写」。

### Security

- `peerDependencies` 对 DSH 域内包使用显式版本范围 `>=0.2.0-rc.1 <0.3.0`，不使用 `^` / `~`。
- `config.gitGuard` 的全部策略项默认 `'ask'`，**没有任何一项默认 `'allow'`**；插件自身也不
  默认拒绝任何操作，`'deny'` 只由用户显式配置产生。守卫命中的诊断日志只记规则标识
  （字典 key），不记命令行全文与提交信息内容。

[Unreleased]: https://github.com/Melosic/dsh-dev-workflow/compare/v0.7.0...main
[0.7.0]: https://github.com/Melosic/dsh-dev-workflow/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Melosic/dsh-dev-workflow/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Melosic/dsh-dev-workflow/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/Melosic/dsh-dev-workflow/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/Melosic/dsh-dev-workflow/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Melosic/dsh-dev-workflow/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Melosic/dsh-dev-workflow/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Melosic/dsh-dev-workflow/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Melosic/dsh-dev-workflow/releases/tag/v0.1.0
