# 触发器

本文件说明 dsh-dev-workflow 的自动介入路径：**它什么时候开口，靠什么开口，以及什么时候它其实开不了口。**

对应的代码是 `src/triggers/`（三个约定触发器：提交前、PR 前、发版前）、`src/guard/`（五道守卫）与
`src/commands/dev-workflow.ts`（手动路径）。它们共用 `src/checks.ts` 与
`src/tools/check-commit-message.ts` 的判定逻辑、`src/shell.ts` 的命令行解析。

**两者的结论一致，但覆盖面不同**，这一点必须说清楚：

- `/dev-workflow check` 没有提交信息可判——它检查的是**工作区**，而自动检查检查的是**这次提交**。
  要判消息规则得显式带上：`/dev-workflow check --message "feat(cli): add a flag"`。不带参数时，
  输出里有一行明说「提交信息规则未包含」。
- 读不到仓库或读不到 git 时，自动检查把这件事写进它的结论（一条 warning），而不是安静地少跑几条规则。

## 拦在哪个事件上

```
agent 调用 bash / pwsh 工具
        │
        ▼
tools/pre-execute  ← waterfall 门禁，本插件在此最多挂八个监听器
        │
        ├─ 监听器 A（pre-commit）：命令是 git commit → 校验提交信息与文档同步
        ├─ 监听器 B（pre-pr）：命令是 gh pr create → 校验标题与描述
        ├─ 监听器 C（pre-release）：命令是 git tag / npm publish → 校验发版
        ├─ 监听器 D（git-guard）：危险 git 操作 → 按策略 deny / ask
        ├─ 监听器 E（outward-guard）：对外可见动作 → 按策略 deny / ask
        ├─ 监听器 F（command-guard）：危险 shell 命令 → 按策略 deny / ask
        ├─ 监听器 G（file-guard）：参数里有敏感路径 → deny
        └─ 监听器 H（secret-guard）：参数里有凭据形状 → deny

前三个命中时返回 { kind: 'ask', displayReason: { en, zh } }；后五个按各自策略返回。
```

**waterfall 的顺序在这里是有语义的，不是摆设。** 监听器按注册顺序由外到内包成一层层：先注册的
在外层，它 `await next()` 的返回值是内层的决定，而它自己的返回值是最终决定。三个约定触发器注册在
最外层，也就是说**它们先看到命令、最后决定结果**。

由此产生两条规则，缺一条就会出问题：

1. **上游更严的决定不被改判。** `next()` 返回 `deny` 或 `cancel` 时原样透传——别人已经拒绝或取消了，
   本插件不替它松口。（`ask` 不算「更严」：它也只是一个待回答的问题。）
2. **上游的 `ask` 不构成「跳过检查」的理由。** 这正是曾经的 bug：触发器在 `next().kind !== 'allow'`
   时直接返回，于是内层的 outward-guard 先对 `gh pr create` 抛出泛泛一问，PR 标题与描述的段落检查
   一行都没跑；用户批准那一问之后命令直接执行。现在触发器先完成自己那份判定，再把发现**并入
   内层那一问**：`reason` 里带上完整清单，`displayReason` 里追加一行说明「回答另一道守卫的问题
   同时也回答了本项检查」。既不重复提问，也不让发现被吞掉。

`tools/pre-execute` 是 DSH 官方在派发任何工具调用之前走的 waterfall 钩子
（`@deepseek-ai/dsh-tools` 的 `prepareExecution`），其 `next()` 会继续调用链上后面的监听器，
默认返回 `{ kind: 'allow' }`。

### 为什么三个触发器都挂在 shell 工具上

规范期望的是「PR 创建前」「发版前」两个断点。**DSH 的事件目录里没有这两类事件**：
`tools/pre-execute` 之外不存在「PR 即将创建」或「即将发版」的钩子（在
`@deepseek-ai/dsh-tools` 的事件声明里搜 `pr` / `publish` 即可复核）。因此这两个断点与提交前一样，
落在**执行动作的那条 shell 命令行**上：`gh pr create`、`git tag`、`npm publish`。

这不是无法拦截后的降级——命令行**在动作发生之前**就已经可见，拦下它就能拦下动作本身。
降级的判据是「动作完全不经过 DSH」，而这三条路径都经过。

由此产生的能力边界，与提交前检查一致：插件只看**被调用的命令文本**，看不懂脚本内部
（agent 执行一个内部会发版的脚本时看不到），也不看用户自己终端里的操作。
`sh -c "..."` 这类把脚本放在一个词里的写法会被**递归解析**（见下面的词法一层），
纯动态拼装仍是边界。

三个约定触发器之外的决策规则也用 `ask` 而不是 `deny`：提交信息或 PR 描述不规范是作者可以明知的
取舍，插件给的是「要不要照常执行」的选择，而不是否决权。**只有配置里显式写了 `'deny'`
的守卫策略才会真正拒绝**（见 [docs/SECURITY.md](SECURITY.md)）。

八道门是独立的：`enableOwnTrigger` 管三个约定触发器，五道守卫各由自己的 `enabled` 管，
其中一个出问题不影响其余。注册顺序是「约定（提交 → PR → 发版）→ 破坏性 git → 对外动作 →
危险命令 → 敏感文件 → 密钥」。**顺序决定谁先看到命令、谁最后拍板**（见上），但不改变各级
决策的汇总方式：命中先计数、再审计，同一道守卫内部按「更严者胜」取一条。**对外动作排在破坏性
git 之后**：它管的也是 git（外加 `gh` 与包管理器），但拦的是「别人会看见」，不是「本机会丢东西」。

## 什么算「一次提交」

触发器不跑 shell，只在**有限的词法层面**判断，因为过度猜测会在错误的时刻开口。这一层
（`src/shell.ts`）由提交前检查与 git-guard 共用：

1. `tokenize()` 按 shell 语法切成 token（处理引号、`\` 转义、
   `&&` / `||` / `;` / `|` / 换行作为分隔）。
2. `segments()` 按这些运算符切段，每段独立判断——所以
   `pnpm test && git commit -m "..."` 里的提交部分照样被识别。
3. `programInvocations()` 在每段里跳过前导的 `VAR=value` 赋值与包装词（`sudo`、`doas`、`env`、
   `nohup`、`command`、`exec`、`time`、`npx`，以及限流器 `timeout`、`nice`、`stdbuf`、`ionice`、
   `watch`；值选项按包装词各自声明，如 `sudo -u root`、`nice -n 10`，`timeout` 还要先吃掉
   自己的时长参数），取程序名的 basename；`sh -c "<命令>"` 这类把脚本藏在一个词里的写法会
   **递归解析**内部的命令行。
4. `gitInvocations()` 在 `git` 的调用里跳过 `-C`、`-c`、`--git-dir` 等带值的全局选项，
   取出子命令与它的参数。
5. `commitArguments()` 解析提交信息：`-m` / `--message` / `--message=` / `-mXXX`
   （多个 `-m` 按 git 的语义用空行拼接），以及 `-F` / `--file` / `--file=` / `-FXXX`。
   **短选项按字母拆开**：`-am "msg"`、`-avm "msg"`、`-qm "msg"` 与 `-m "msg"` 是同一件事——
   只按词首匹配 `-m` 会把人类最常用的 `git commit -am` 整条漏掉。
6. `quoteCommandWords()` 是第 1 步的"带出处"版本：每个词额外记住**它是不是 shell 原样保留的文本**
   （单引号里的就是，双引号里有 `$`/反引号的不是），判定需要这份信息才能区分「信息里含 `$(...)`」
   与「信息本身是一段字面文本」。

几条刻意的保守规则：

- **引号里的 `git commit` 不算提交。** 词法处理已经把它归到同一 token 里，
  不会被当成命令名。
- **提交信息的值含 `$(...)`、`${...}` 或反引号时不判定，但要说明未判定。** 这种值要在 shell 里
  展开，插件看不到 git 最终收到的字面量，与其对一段 git 永远不会收到的文本报错，不如不开口；
  「不开口」和「查过且通过」必须能区分，所以结论里会带一条 warning 说这条规则没跑。
  反过来，**单引号包住的值是字面文本**：`-m '$msg'` 提交的就是 `$msg` 四个字符，照常判定。
- **裸 `$msg`（PowerShell / shell 变量）同样不判定**，理由相同。
- **`-F` 指向的文件在判定时刻读，可能还不存在。** `echo x > m && git commit -F m` 里文件是
  同一条命令的后半段写的，判定发生在执行之前，所以读不到——这时报「信息不可读」而不是沉默。
- **`git commit --amend` 且命令行没写信息时，读一次 `git log -1 --format=%B`。** 用 amend 修
  提交信息恰恰是最需要检查的路径，读不到就不查等于放走了它。

`git commit -F -`（从标准输入读）同样放弃判定：信息还没产生。

## 检查什么

`evaluate()` 把两个已有工具合在一起跑，输入是「提交信息 + 本次提交的变更文件集 + 工作区里
其它未提交的改动」：

| 来源 | 判定 |
| --- | --- |
| `checkCommitMessage` | Conventional Commits：类型、格式、标题长度、句尾句号、`!` 与 `BREAKING CHANGE:` 页脚是否配套 |
| 变更文件集 | 跨模块提交、缺少 scope 的软警告 |
| `checkDocSync` | 成对文件（README、locale、SKILL）只改一半，且另一半仓库里本来就有 → 报错；改了代码没动文档 / CHANGELOG → 警告 |
| `rules.requireChangelogOnFeat` | `feat` 提交且**本次提交或分支已有** `config.docs.changelog` → 不阻塞 |

最后一条把 `config.rules.requireChangelogOnFeat` 与 `checkDocSync` 的同类警告区分开：
`feat` 要求 CHANGELOG 是硬规则（阻塞），其它类型的 CHANGELOG 缺失只是建议（警告）。
同一次判定里两者只出现一条，不重复提示同一件事。

**判定的是"这次提交"，不是"整个工作区"。** 文件集取自 `git diff --cached --name-only -z`——
暂存区里的才是这条 `git commit` 将要记录的内容。这个区别不是学术性的：重度用户的工作区里
总有别的改动，按工作区判定会把无关提交拦下来，甚至让一个「文档只改了一半挂在工作区」的状态
阻塞仓库里其它所有提交。工作区（`git status --porcelain=v1`）仍然读，但**只用来区分两种镜像
情况**：配对的另一半完全没动 → 报错；另一半正在暂存区或工作区里编辑 → 降为 warning
（「分支推出前把这一对补完」）。

**`git commit -a` / `--all` 是唯一的例外**：`-a` 在提交那一刻才把已跟踪改动填进索引，所以
命令执行前读索引只会得到一个空集或陈旧集，据此判定会把一次完全正确的提交拦下来。这种命令
的文件集改读 `git status --porcelain --untracked-files=no -z`——正是 git 即将暂存的那一批：
已暂存 + 未暂存的已跟踪改动，不含未跟踪文件（`-a` 也不碰它们）。

这里特意不用 `git diff HEAD`：它等价、更快，但**在一个还没有任何提交的仓库里没有 HEAD**，
命令以 128 退出。新建仓库的第一次提交正是这种情形，而它只是一次普通的提交，不是一次读失败。
用 status 读，同一趟调用就把这两种情况都覆盖了。也因为 `-a` 只收已跟踪文件，这种提交不再读
工作区——第二次读只会多带进未跟踪文件，把「配对只改了一半」从阻塞降成提醒。

**镜像对还要知道「另一半是否存在」。** 只改一半是漏改，前提是这个项目有另一半：全新仓库的
第一次提交只暂存 `README.md`，`README.zh.md` 从未存在过，拦下它就等于要求每个新项目先写一份
中文 README。这个判断变更集给不出——「从没有过」和「有但这次没改」在 `git diff --cached` 里
长得一模一样——所以另读一次 `git ls-files --cached --others --exclude-standard -z`：索引与 HEAD
里的路径（含已从工作区删掉的），加上已经在磁盘上的未跟踪文件。读失败时按「都存在」处理，
退回老规则：读不到不该让检查静默失效。

这一趟只在**真的有一组被拆开**时才读（`splitsMirrorPair()`），所以一次只碰代码、不碰任何成对
文件的提交，git 调用次数不变。

**`feat` 与 CHANGELOG 的规则看的是分支，不是单次提交。** 一个特性拆成几次提交、CHANGELOG 在
前一次里补过，最后一次提交不该因为没有它而被拦。分支集取自
`git merge-base HEAD @{upstream}` 到 `HEAD` 的 diff；读不到（没有 upstream、shallow clone）
时按空集处理——这个集合只能**解除**拦截，读不到就诚实地说没有，绝不凭空猜。为省两次 git 调用，
它只在消息以 `feat` 开头且 `rules.requireChangelogOnFeat` 打开时才读。

`/dev-workflow check` 读的才是工作区——那是它的用途。两者各自的取舍写在上面的对比里。
**一次普通判定最多跑两次 git**（暂存集 + 工作区）；`-a` 提交只跑一次（工作区那一趟被省掉）；
拆开了成对文件的提交再加一次（`ls-files`）；`feat` 提交在规则打开时再加两次（merge-base 与
分支 diff）；其余情形都不会多跑。

## 什么算「一次 PR 创建」

`detectPullRequest()` 在每段里找 basename 为 `gh` / `gh.exe` 的程序，要求前两个参数是
`pr` `create`。命令行里通过 `--title` / `-t`、`--body` / `-b`、`--body-file` / `-F`
（含 `--opt=value` 写法）给出的内容会被解析出来；这几项之外的带值选项在
`GH_VALUE_OPTIONS` 里列明，以免把它们的值误当标题。

`--body-file` 指向的文件在**判定时刻**读取（相对路径按会话 cwd 解析）；
`-F -`（从标准输入读）不读——和 `git commit -F -` 同理，内容还没产生。

**`--fill` 和描述由 shell 组装的情况会明说，而不是当作「查过且通过」。** 前者命令行里没有标题，
`squash` 合并后它却会成为主干上的提交信息，所以结论里记一条 warning；后者（`-b "$(cat pr.md)"`）
的正文只有字面片段可查，段落规则不跑，同样记一条 warning——否则这条路径会**每次都被误拦**
（把 `$(cat pr.md)` 当成正文，每个段落都被判成缺失）。两者的写法差异被保留：单引号里的正文是
字面文本，照常查。

## PR 检查什么

| 规则 | 判定 |
| --- | --- |
| 标题 | 复用提交信息的判定函数（`evaluateMessage`），也就是**同一套配置、同一套规则**。**squash merge 后 PR 标题就是 main 上的提交信息**，因此它必须满足与提交信息完全相同的规范；`commitCheck.enabled` / `onFailure` 对标题同样生效，一处关掉或降级在三个入口一致 |
| 描述段落 | 判定依据是**仓库自己的** PR 模板：找到 `.github/pull_request_template.md`（以及 GitHub 认的其余几个路径）就按它的 `##` 标题判，**缺段或段内为空都算缺失**——一个只有标题的空盒子并不比没有好。没有模板、或没改过 `prSections` 时才用内置的七段 |
| 检查清单 | **只在模板标为检查清单的那一段之内**（`Checklist` / `检查清单` 等）数遗留的 `- [ ]`。选项型段落（GitHub 默认模板的 `## Type of change` 就是一堆 `- [ ]`）不算：那是让人「勾一条」，不是「条条都要做完」（描述整体为空时这条不触发，只提示） |
| 关联 Issue | 标题与描述里没有 `#<数字>` 时**只警告**：本地无法判断是否真的存在对应 Issue，不该因此阻塞。若写了的编号**全是它自己的 PR 号**（`gh pr edit 13` 的正文只提 `#13`），那也一样只警告——自引用追溯不到任何东西。`gh pr create` 那一刻还没有 PR 号，这种情况判不了，按无引用处理。这两条警告都没有「问」的资格（问题里没有可答的内容，`never` 策略下会被直接拒掉），所以在 PR 那一刻**写进会话日志**，并同时留在 `/dev-workflow status` 的记录里——只躺在 status 里等于没人看见 |

`.github/pull_request_template.md` 就是这个仓库的模板，判定跟着它走：先找模板文件，再把
`##` 标题映射到七种角色（改了什么 / 为什么 / 怎么验证 / 变更类型 / 非目标 / 风险与回滚 /
检查清单，中英文写法都认）。映射不上的标题——比如本仓库的 `## Where to look first`——不进判定，
那是作者可删可留的散文段。判定前先剥掉 HTML 注释：GitHub 会把模板预填进描述框，一个没动过的
PR 到达检查时是「若干标题 + 若干段 `<!-- 这里写什么 -->`」，若把注释算作段内内容，仓库一加模板
就等于关掉了这条检查。剥掉注释之后，`<!-- Closes #12 -->` 也不算作者写的关联 Issue——那是给
作者的指示。编号来自命令行本身：`gh pr edit 13` / `gh pr merge 13` 的那个参数是现有的 PR 号，
于是「正文只提 `#13`」能被认出来；`gh pr create` 还没有编号，只能按无引用处理。

三种情形分别对待：**模板里一个可识别的标题都没有**（写作规范自由的仓库）则整段检查关掉，只要求
描述不是空的——拿内置的七段去判一份自由散文，等于每个 PR 都被判错；**配置里改过 `prSections`**
则配置优先于模板，那是比模板更具体的声明；**两者都没有**则用内置七段。

数未勾选行时只在标为检查清单的那段之内数——`## Remaining work` 这类作者自加的段落，以及
选项型的段落，都不会被误算。两个已知取舍：

- 描述整体为空（`--body` 没给）时这条规则**完全不跑**：没有描述时把「零个复选框」当成合规，
  比凭空报一次错更不容易误伤。
- 只带 advisory 警告（`--fill` 没给标题、描述没关联 Issue）而没有任何阻塞项时**不弹确认框**，
  但警告会打到日志：那两种情形都是「这条规则没东西可判」，为一个空问题弹框，在 `never`
  策略下等于把提示变成阻塞。日志和 status 是它们该待的地方，弹框不是。
- 段名逐字匹配模板，大小写不敏感，层级必须是 `##`。仓库用别的语言、别的标题就在模板里
  那么写；模板不便改或要额外的段落，则在配置里改写 `prSections`（改过就以配置为准），
  否则每个 PR 都会被要求填它模板里没有的段落。

## 什么算「一次发版」

`detectRelease()` 同时收集两类动作，**同一条命令行可以两件都做**
（`git tag v0.2.0 && npm publish`）：只有拿到 tag 和 dist-tag 两样，才谈得上「发版整体是否合规」。

- `git tag <name>`：跳过 `-a` / `-s` 等无值选项与 `-m` / `-F` / `-u` 等带值选项，
  取第一个非选项词为 tag 名；`-l` / `--list` / `-d` / `--delete` / `-v` / `--verify`
  是**读**操作，直接不算发版。tag 名同样带出处：`git tag "v$(cat VERSION)"` 的**真实**名字
  看不到，此时版本规则不跑并记一条 warning，而不是拿 `v$(cat VERSION)` 去比 SemVer。
- **包管理器扩到 npm / pnpm / yarn / bun**，读 `--tag` / `--tag=`。**没有写 dist-tag
  时记为 `latest`**，因为 npm 确实会把预发布版本也发布到 `latest`——把默认值当成事实，
  预发布规则才拦得住它。
- **`pnpm --filter <pkg> publish` 读的是被发布那个包的 `package.json`**（相对会话 cwd 解析）。
  读不到就记一条 warning 说比对的是当前目录的版本——拿主包版本去比 tag 是个错误的答案，
  比「读不到」更糟。
- **`npm version <kind>` 要认。** 它一条命令完成「改版本号 + 提交 + 打 tag」，既不是 `git tag`
  也不是 publish；不认它等于给出了一条最省事的绕过路径。识别到就记一条 warning 说明它越过了
  提交与 tag 两道检查。
- **`--dry-run`（或短选项 `-n`）不算发版。** 它不上传任何东西，而 `docs/PUBLISHING.md`
  自己就推荐用它核对打包结果——把一次演习拦下来并报「预发布版发到 latest」是纯误报。
- 前面的 `npx` 属于被剥离的包装词（见 `src/shell.ts` 的 `TRANSPARENT`），所以
  `npx npm publish` 认得出是发布。

### 我们看不见什么

这张清单是**承诺**，不是免责：以下路径本插件不拦，如果你用它发版，拦不住是已知的。

| 路径 | 为什么看不见 |
| --- | --- |
| `nx release`、`lerna publish`、`changesets` | 各自的工具链完成 bump / tag / publish，命令行上看不出最终动作 |
| `sh -c "npm publish"` 里被引号包住的整段脚本 | 递归解析能处理多数写法，但纯动态拼装（`eval`、变量展开的脚本）读不出 |
| 脚本文件里的发版（`./release.sh`） | 只看被调用的命令文本，不看脚本内部 |
| CI / 其它机器上的发布 | 插件只在 DSH 会话内运行 |
| `gh release create`、`git push --follow-tags` 的 tag 部分 | `gh release create` 不在识别集里；`push` 会按「推送」拦下，但不会额外判 tag |

## 发版检查什么

| 规则 | 判定 | 可否配置 |
| --- | --- | --- |
| SemVer | 版本号须匹配 `MAJOR.MINOR.PATCH`，可带 `-rc.1` 之类的预发布后缀 | `releaseCheck.semver` 关闭即跳过；模式本身是文件级设置 `releaseCheck.versionPattern` |
| tag 与 manifest 一致 | 去掉 `v` 前缀后，tag 名与 `package.json` 的 `version` 必须相同：两者不一致意味着「发布出来的版本」和「tag 名」不是同一个 | 同上，随版本规则一起开关 |
| 预发布不推 latest | 版本带预发布后缀而 dist-tag 是 `latest` → 阻塞，提示改用 `--tag next` | `releaseCheck.prereleaseTag` |
| CHANGELOG 有待发布段 | 没有这一段 → 阻塞（Keep a Changelog 要求它常驻顶部；段名默认 `[Unreleased]`） | `releaseCheck.changelog`，段名见 `releaseCheck.unreleased` |
| CHANGELOG 分类规范 | 待发布段里的 `###` 标题不在允许的分类里 → **只提示，不阻塞**（Keep a Changelog 允许自定分组）；默认名单是 Added / Changed / Deprecated / Removed / Fixed / Security | `releaseCheck.changelogCategories`，名单见 `releaseCheck.categories` |
| 待发布段不为空 | **待发布段与 `[<version>]` 两段都为空**才算空：发布流程的第二步就是把条目从前者移入后者，所以 tag 创建的那一刻，合法状态可能落在任何一段里 | 同 `changelog` |

**版本条目按两种写法查。** `## [1.0.0]`、`## 1.0.0` 与 `## v1.0.0 - 2026-01-01` 都是常见写法，
查表时带上/去掉 `v` 前缀都试一遍——不这么做，写 `## v1.0.0` 的仓库会在每次 tag 时被告知
「这个版本没有记录」，而它明明写了。

版本号取自 tag（无 tag 时才退回 `package.json`）。`package.json` 与 CHANGELOG 在
**判定时刻**从会话 cwd 读取；读不到就不跑对应规则，只跑能跑的——门禁不会因此变成空操作。
**规则全部可在配置里单独关掉**（`releaseCheck.*`，默认沿用上表），这样想放宽一条不必整关检查。
换名字比关规则更常见：中文 CHANGELOG 的 `## 未发布`、`### 修复` 用 `releaseCheck.unreleased`
与 `releaseCheck.categories` 对齐即可；用 `cargo publish` 这类非 JS 包管理器发版的仓库，
把程序名加进 `releaseCheck.publishers`，发版检查与对外动作守卫才会看见它。

## 守卫危险 git 命令

第一道守卫（`src/guard/git-guard.ts`）与提交前检查共用同一段命令行解析，
但看的是另一件事：**这条命令会不会让工作成果不可恢复地消失。**

| 命令形态 | 策略键 | 默认 |
| --- | --- | --- |
| `push --force` / `-f` / `+refspec` / **`--mirror`** | `forcePush` | `ask` |
| `reset --hard` | `hardReset` | `ask` |
| `rebase`（`--continue` / `--abort` / `--skip` 除外） | `rebase` | `ask` |
| `commit --amend` | `amend` | `ask` |
| `branch -D` / `--delete --force` | `branchDelete` | `ask` |
| `push --delete` / `-d <remote> <branch>` | `branchDelete` | `ask` |
| `clean -f` / `-fd` | `cleanForce` | `ask` |
| `checkout -- <path>` / `checkout .` / `restore <path>` / `restore .` | `checkoutDiscard` | `ask` |
| `--no-verify`（任何子命令） | `noVerify` | `ask` |

识别规则里几处刻意的地方：

- **`--force-with-lease` 只在它独自出现时放过。** 光带这个选项（含
  `--force-with-lease=main`）不算 force push——它会在覆盖一个你尚未看到的提交时失败，正是
  我们想避免的事故。但它**不短路**：`git push --force-with-lease --force` 仍是强推，因为
  plain `--force` 压过 lease 并真的覆盖远端。只有不带 `--force` / `-f` / `+refspec` 时，
  lease 才让这条命令通过。反过来，裸 `--force` 的理由里会附带一行「建议改用
  `--force-with-lease`」。
- **`--mirror` 归入强推。** 它让远端与本机 refs 完全一致，等于隐含着「覆盖 + 删除本机没有的
  ref」；不认它的话，用户一旦把 `outwardGuard.push` 放宽（几乎必然），它就成了绕过 forcePush 的口子。
- **`rebase --continue` / `--abort` / `--skip` 放过。** 这三个是冲突恢复与安全回退，不是改写历史的
  起点；每次都问会把工具疲劳推向「一律允许」。带 `--exec` 的不放过：那会在每个 commit 上跑命令。
- **`checkout .`、`restore <path>`、`restore .` 都算丢弃改动**（`git restore` 是 `checkout --` 的
  现代替代写法）；`restore --staged` 不算，它把改动退回工作区，什么也没丢。
- **短选项按字母匹配。** `-fd` 含 `f`，`-D` 含 `D`；`--force` 这类长选项不参与短选项匹配。
- **`reset --soft` / `clean -n` / `branch -d` / `checkout main` 都不拦。** 它们不丢工作。
- **`--no-verify` 与操作同时出现时，操作胜出。** `git push --no-verify --force` 报的是
  force push：`--no-verify` 只是修饰符，真正会丢东西的是那个操作。同等级的策略下先入列者
  胜出，所以判定循环把 `--no-verify` 放在子命令判定之后——但它**仍会被计数与审计**，
  状态行里两项都在。

判定链与每项默认值的理由（为什么 `noVerify` 是 `ask` 而非 `deny` 等）见
[docs/CONFIGURATION.md](CONFIGURATION.md) 的 `gitGuard` 表与
[docs/SECURITY.md](SECURITY.md)。

一条命令行同时命中多项时，按 `deny > ask > allow` 取最严的一条——**绝不削弱上游更严的决定**。
唯一的覆盖方向是「自己 `deny` 对上上游 `ask`」，因为拒绝一个已经在被质疑的调用不会让情况变坏。

## 守卫对外可见动作

第二道守卫（`src/guard/outward-guard.ts`）管的是另一类错误：**在本机完全可回退，但一旦离开
本机，其他人立刻就看得见。** 推送、打标签、创建 PR、开 issue、发布都越过这条线；agent 抢在用户同意
之前替你对外宣称「做完了」，正是缺这一道门时会发生的事。

| 命令形态 | 策略键 | 默认 |
| --- | --- | --- |
| 任意 `git push`（不只强推） | `outwardGuard.push` | `ask` |
| `git tag <name>`（建标签，不是读标签） | `outwardGuard.tag` | `ask` |
| `gh pr create` | `outwardGuard.pullRequest` | `ask` |
| `gh issue` 的写操作（`create`、`comment`、`close` 等） | `outwardGuard.issue` | `ask` |
| `npm publish` / `pnpm publish` | `outwardGuard.publish` | `ask` |

- **普通 `git push` 也拦。** 强推是另一个、更严重的问题，仍归 `gitGuard.forcePush`；
  这里拦的是「把分支推到远端」本身。同一条 `git push --force` 会同时命中两道守卫，
  最终理由由更严者胜出——强推的理由盖过「推送」的理由。
- **识别复用触发器里的同一份判断。** 建标签与读标签之别、`gh pr create` 与 `gh pr list`
  之别、`gh issue create` 与 `gh issue list` 之别、以及 `--dry-run` / `-n` 不算发版，都走
  `detectRelease()`、`detectPullRequest()` 与 `detectIssue()`——「什么算一次发版」只能有一个
  答案，否则门禁和检查会对同一行命令各说各话。
- **`--dry-run` 演习一律放过。** 它不碰远端也不上传，没有需要用户同意的事。
- **能力边界与触发器相同。** 只看命令行词法：`sh -c "git push"` 会被递归解析出内部的命令，
  但纯动态拼装（`eval`、变量展开的脚本）读不出——那是 `docs/SECURITY.md` 里声明过的边界。
- **它是唯一一道拦「本机没事」的守卫，所以默认全是 `ask` 而非 `deny`。** 要的是同意，
  不是阻拦：用户点头，命令原样放行。
- **`gitGuard.rememberApproved` 对它同样生效。** 开关住在 `gitGuard` 里，git 与对外动作两道
  守卫共用同一个批准记忆：本会话内批准过一次同样的 push / tag / publish，就不会被问第二次。
  默认关闭——一次同意不等于整个会话的授权。

## 机器与文件的三道守卫

后三道守卫看的是同一件事的三面：**这次调用会不会让东西永久地出去或消失。**

| 监听器 | 看什么 | 命中后 | 默认 |
| --- | --- | --- | --- |
| `command-guard` | `command` 里不可逆的 shell 命令 | 按 `commandGuard.dangerousShell` 走 `deny` / `ask` / `allow` | `ask` |
| `file-guard` | 参数里的路径是否命中 `fileGuard.noRead` | `deny` | `deny` |
| `secret-guard` | 参数里是否有凭据形状 | 有就 `deny`；只读的命令行 `allow` 并记一笔 | `deny` |

三处与 git-guard 不同的地方，都是刻意的：

- **`file-guard` 与 `secret-guard` 没有档位字段。** git 与命令守卫拦的是可以重做的工作，
  所以给一个「我知道我在做什么」的覆盖档是合理的；**读出去的路径与发出去的凭据收不回来**，
  因此这两道只有拒绝。`fileGuard.noRead: []` 或 `secretGuard.enabled: false` 才是它们的开关。
  `secret-guard` 有一个例外，不是档位而是判断：**一行里每个程序都只读时放行**（`grep`、
  `rg`、`sed -n 's/…/…/p'`、`git log -S` 这类）。值已经在参数里，拒绝搜索拦不住外流，
  只挡住找泄漏的人；有一个程序能写出或发送，整行照旧拒绝。判断按**这行会执行什么**，
  不按程序名：`sed -i`、`sed -f`、`sed` 的 `e` 标志，以及任何 `$(…)` / `<(…)` / `>(…)` 都不算只读。
- **`file-guard` 与 `secret-guard` 不只看 shell 命令。** 它们扫描**每一次**工具调用的参数：
  凭据写进源码文件与敲进命令行一样是泄漏，`read` 一个 `.env` 与 `cat` 它一样是读取。
  `command-guard` 则只认 `command` 字段，因为只有它看的是一行命令。
- **路径从每个工具真实的参数字段里取**（`read` / `edit` / `write` 的 `file_path`；`glob` 的
  `pattern` / `path`；`grep` 的 `path` / `include`），而不是靠工具名猜。**`grep` 的 `pattern`
  不在其中**：那是搜索表达式，不是路径——把它当路径会让 `grep -rn "credentials" .`
  这次「查一下树里有没有密钥」的搜索被硬拒，恰好挡住本插件鼓励的工作流。判定只看字符串，
  **从不打开文件**——这一道自己读文件去判断该不该读，就正好是它要防的事。
- **包装词会被剥掉。** `sudo cat .env` 与 `cat .env` 一样命中；两道守卫共用
  `src/shell.ts` 的一层词法，不各写一套。

`command-guard` 的识别细节（什么算危险目标、为什么 `rm -rf node_modules` 放行）见
[docs/SECURITY.md](SECURITY.md#command-guard-保护什么)。

**五道守卫共用 `src/guard/shared.ts` 的 `createGuard()`。** 它负责接线、命中计数、审计回调
与档位决策；每道守卫只提供一个 `detect(exec)`（识别多项时再提供一个 `detectAll`）。
因此「透传上游决定、`signal.aborted` 时返回 `cancel`、同级先入列者胜」这些规则只有一份实现。

**命中先计数、再审计，且全部计数。** 一行命令命中多项时，每一项都进状态行与审计记录
（`git push -f --no-verify` 计两项），只有**决策**从最严的那条取。被配置放宽到 `allow`
的命中同样计数与审计——「识别到了但放行」正是审计日志存在的意义。

## 提示的语言

审批提示按**客户端的 locale** 选择文案，而客户端 locale 未必等于插件自己的
`config.locale`。因此 `displayReason` 同时给出 `en` 和 `zh` 两份，并且每一份都是
**用它自己的翻译器重新跑一遍判定**得到的——只要外面那层包装是英文、
里面的问题清单还是中文，就等于没翻。

中文键必须是字面 `zh`：客户端会把 locale 小写化再回退到 `en`，写 `zh-CN` 永远匹配不上。

内层守卫已经在提问时，外层触发器的发现会**并入那一问**：`displayReason` 两份都追加一行
「另一道守卫已就这次调用发问，回答它同时也回答了本项检查」并列出清单，`reason` 里带上完整
findings，让模型看到的是同一份事实。

## 状态模型：同一会话同一问题只提示一次

状态在插件 fiber 的内存里（`src/state.ts`），**不落盘**：

- key 为 `${sessionId}:${checkType}:${targetId}`，`checkType` 为 `commit`、`doc`、`pr` 或 `release`。
- `targetId`：提交检查用提交信息（或命令文本）的 FNV-1a 指纹；
  文档检查用变更文件集合的指纹；PR 检查用标题（无标题时退回描述，再退回命令文本）的指纹；
  发版检查用版本号（无版本号时退回命令文本）。
- 单个会话最多记 512 个 target，超出后淘汰**最久未使用**的（重新记入会把 key 移到队尾），
  避免长会话无界增长。
- 插件重启后状态清空。
- 跨会话允许重新提示：同一个问题在另一个会话里会再问一次。

**只在回答是「同意」之后才记入。** 记的动作发生在 `settleAbout()` 里，但它不在函数返回时
发生，而是在**拿到批准之后**——也就是说：

- **批准后执行**：`allowed-once` 是唯一的授权，此时才写入 target，同样的对象不会被拦第二遍
  （这是「同一会话同一问题只提示一次」想要的效果）。
- **拒绝 / 取消**：target **不**进状态，同样的命令再跑一次**还会被问**。一次拒绝是对那一次尝试的
  回答，不是对那个对象的回答；把它降级成提醒就等于把否决权变成了一次性通知。
- **`never` 策略下插件自拒**（`unaskable` 把 `ask` 变成 `deny`）：同样不记，因为没有人被问到。
- **没有审批通道**（会话里没有 `approval` 服务，或它不提供 `request`）：这一问交给 dispatcher，
  而 dispatcher 在没有通道时把 `ask` 直接判成拒绝。既然没有人被问到，**同样不记**。

最后两条不是巧合，而是同一个事实的两种形态：**返回 `ask` 不等于用户说了「是」。** dispatcher
在本监听器返回**之后**才结算这一问，并且不把答案告诉它；所以是否「已经问过并获批」，只能由插件
自己通过审批接缝去问、并拿到 `allowed-once` 才知道。这就是 `settleAbout()` 会 `await`
`approval.request(...)` 的原因，也是守卫早就这么做（`src/guard/approval.ts`）而触发器此前漏掉的原因。

拒绝时插件给出的是**自己的** `deny`，而不是把 dispatcher 那句 `the user rejected tool "bash"` 透传：
后者会丢掉 findings，模型接着重跑同一条命令时看不到到底哪里错了。

`/dev-workflow status` 会显示最近一次检查结果和守卫命中次数，这些同样来自这个状态。
命中次数单独看分不出「拦了三次」和「放宽后放了三次」，所以**被配置改成 `allow` 的命中会单独标出**
（`…（已放行）×3`）：`allow` 是唯一会一直生效的档位，直到有人改回来；一个认得出操作却不再拦它的
守卫，正是读状态的人必须看得见的事实。`ask` 与 `deny` 不加标注——它们是守卫本来在工作。

## 降级路径

规范给了两条路：主路径（在会话内自动拦截）与降级路径（插件只提供手动工具，
强制拦截完全交给 husky）。

**实际结论：走主路径，三个断点都不降级。** `tools/pre-execute` 确实存在、确实是 waterfall、
确实能拦下 agent 通过 `bash` / `pwsh` 执行的 `git commit`，因此不需要降级。
核对的依据是 `@deepseek-ai/dsh-tools` 的类型声明（`Events` 里声明了
`'tools/pre-execute'`，模式为 waterfall）与派发实现（`prepareExecution` 里
`await this.ctx.waterfall(carrier, 'tools/pre-execute', exec, ...)`），
以及本机探针实测：构造一次 `bash` + `git commit -m "..."` 的调用，
监听器被调用并返回了 `ask`。

PR 与发版两个断点的核对结论见上文「为什么三个触发器都挂在 shell 工具上」：
事件目录里没有对应事件，但动作本身经过 `bash` / `pwsh`，所以在动作发生前就能拦下，
**不构成降级条件**。

第三条「DSH 不支持设置面板的某些能力」有一条**真实降级**。面板需要知道 `auto`
解析成了哪种语言，但 `ctx.remote.$host` 只暴露 `{ home, isLoopback }`，没有 locale；
包私有的 `host.call` RPC 需要 `harness.handle(method, fn)`，那只有动态包（vm-sandbox）
路径才有，普通 npm bundle 拿不到。降级方案是浏览器侧用同一条 `zh` 前缀规则自己重算一遍：
面板显示的是「解析结果」而不是宿主内部值，两者在同一条 `Intl` 规则下等价。
`documentAvailable` 同理——它由 `$host.isLoopback === true` 决定，非回环环境不提供打开
文件。面板整体是可选的：`ctx.inject(['settings'], …)`，没有 `settings` 服务的档位只是
没有这个页面，不影响守卫与触发器。

| 场景 | 行为 |
| --- | --- |
| agent 通过 `bash` / `pwsh` 工具执行 `git commit` | 检查并提示 |
| 检查通过，但结论里带 warning | 提交照常进行，warning 逐条写进日志（`warn` 级别，默认档位看得见）；`/dev-workflow status` 的「最近一次检查」也会写明还有几条建议 |
| 提交信息是字面文本（含单引号里的 `$msg`） | 照常判定 |
| 提交信息含 `$(...)`、`${...}`、裸 `$var` 或反引号，或 `-F -` 从 stdin 读 | 放弃判定，但结论里带一条 warning 说明消息规则未跑 |
| `git commit -am "..."`（短选项簇） | 与 `-m "..."` 同样解析并判定 |
| `git commit --amend` 且命令行没写信息 | 读一次 `git log -1 --format=%B` 后判定 |
| `-F` 指向的文件由同一条命令稍后写入 | 判定时读不到 → 报「信息不可读」而非沉默 |
| agent 通过 `bash` / `pwsh` 执行 `gh pr create` | 检查标题与描述并提示 |
| `gh pr create --fill` / 命令行没给标题 | 标题规则不跑，记一条 warning 说明「填充后的标题无法校验」 |
| 本地还有未合并的分支，与本分支会冲突 | 记一条 warning，点名分支与冲突文件；判定用 `git merge-tree`，只写对象库、不碰工作区与索引 |
| PR 描述由 `--body-file -` 从 stdin 读 | 跳过描述规则，标题照常检查 |
| PR 描述由 shell 组装（`-b "$(cat pr.md)"`） | 跳过描述规则并记 warning，不再把 `$(cat pr.md)` 当正文误拦 |
| agent 通过 `bash` / `pwsh` 执行 `git tag` / `npm publish` / `yarn publish` / `bun publish` | 检查发版并提示 |
| `npm version patch` | 记一条 warning：它一步完成 bump + commit + tag，越过了提交与 tag 两道检查 |
| `pnpm --filter <pkg> publish` | 读被发布包的 manifest；读不到则说明比对的是当前目录版本 |
| tag 名由 shell 组装（`git tag "v$(cat VERSION)"`） | 版本规则不跑并记 warning |
| 读不到 `package.json` 或 CHANGELOG | 只跑能跑的规则，不提示缺文件本身 |
| 仓库读不到改动文件集（非仓库 / PATH 无 git / 命令失败） | 文档规则不跑，**结论里带一条 warning** 说明原因（含 git 的原话，不是占位符）；消息规则照常跑 |
| 分支还没有任何提交 | 与普通仓库一样判定，不会读成「读不到改动文件集」 |
| agent 通过 `bash` / `pwsh` 执行危险 git 命令 | 按 `gitGuard` 策略 deny / ask |
| agent 用其它非 shell 路径提交、建 PR 或发版（如某个工具内部代办） | 不提示 |
| 命令写在脚本里、由 agent 执行该脚本 | 看不到——插件只看被调用的命令文本本身 |
| 用户在**自己的终端**里提交、建 PR 或发版 | 不提示——插件只在 DSH 会话内运行 |
| 运行时没有 `approval` 服务 | DSH 会把 `ask` 降级为拒绝；操作被拦下，而不是静默放行。target 也不进状态，所以下次同样的命令还会再问一遍 |
| 本会话审批策略为 `never`（如 `danger-full-access` 预设） | 不再返回没人会回答的 `ask`：插件自己 `deny`，理由追加 `approval.disabled` 说明没有人被问到、两条放行路径，以及「设为『允许』会一直生效直到改回『询问』」的代价 |
| `mode: 'off'` | 监听器根本不注册，零常驻成本、零介入 |
| `enableOwnTrigger: false` / 某个守卫 `enabled: false` | 对应的监听器不注册（前者管三个约定触发器），其余照常工作 |
| 运行时没有 `subprocess` 服务 | `git` 读不到改动文件集，提交判定只跑消息规则并说明原因；PR 检查不比对分支冲突；守卫不受影响（它不需要读仓库） |

「插件管会话内，husky 管会话外」是这套机制与 git 钩子的分工：作者在自己的终端里
`git commit` 时，唯一能拦住的仍然是 `.husky/` 里的钩子；插件的价值在于让 agent 在提交之前
就知道规范，而不是代替 git 钩子。

缺少 `approval` 服务时行为来自 DSH 本身（`serviceAsk` 在缺少 approval 时把 `ask` 变成 deny），
**不是本插件主动选择的**：如果宿主没有审批能力，我们宁可挡住，也不假装问过。

`never` 策略下由本插件**主动**补上诚实的那一半。`decide()` 会在提问前返回 `rejected`，
dispatcher 再把它说成「用户拒绝了工具」——用户什么都没看到。结果无法更好（操作都是被拒），
但理由可以更诚实，至少让用户知道没有人被问到、以及在哪里放行。实现是
`src/approval-policy.ts` 的 `unaskable()`，八个监听器共用；读不到策略或没有会话时一律
维持 `ask`，因为「不知道」不该被猜成「不会有人回答」。

## 手动路径

`/dev-workflow check` 走同一套判定，只是判定对象是工作区而不是提交：

- 取当前工作区的变更文件集，跑 `evaluate()`，把结果渲染成 `✖`（先）与 `⚠`（后）清单。
  只有警告时结论不会写成「没有发现阻塞性问题」——那会被读成「什么都没有」，
  这行会改成「没有阻塞性问题，另有 N 条建议没读」，指向上面的清单。
- 带上 `--message "type: subject"` 时连消息规则一起跑；不带时输出里有一行明说
  「提交信息规则未包含」——两者的结论要能对比，就不能让一处安静地少查几条。
- 同时把结果记入状态，所以随后的自动检查能看到「最近一次检查结果」。

`/dev-workflow on | off` 切换的是**注册本身**：`off` 会把两个工具、技能 provider
和全部事件监听器注销，**但保留 `/dev-workflow` 这条命令**——它是唯一的回头路，
自己注销掉就等于把门锁死。`mode: 'off'` 时则一开始就不注册任何东西。
所以关掉之后常驻增量只剩命令本身，而不只是「安静地不回答」；回显会写明怎么恢复，
`status` 会区分「运行期 off（未落盘）」与「配置里 off」。详见
[docs/TOKEN-BUDGET.md](TOKEN-BUDGET.md)。
