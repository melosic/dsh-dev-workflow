# 安全策略

本文件说明本插件在安全上做了什么、没做什么，以及为什么默认值是现在这些值。

一句话原则：**安全默认，显式确认，最小权限。**

## 三句话的范围

| 说法 | 实际含义 |
| --- | --- |
| 默认安全 | 危险操作的默认动作是 `ask`，**没有任何一项默认 `allow`**；插件关掉时零常驻、零介入 |
| 显式确认 | 命中危险操作时走审批提示，由人决定；宿主没有审批能力、或本会话审批策略为 `never` 时，拒绝由插件自己给出并说明原因（见 [docs/CONFIGURATION.md](CONFIGURATION.md#权限策略为-never-时会发生什么)） |
| 最小权限 | 插件不读敏感文件、不执行 git 以外的程序、不联网，落盘的唯一内容是脱敏后的审计记录 |

五道守卫各管一类事故：git-guard 管**能重做但丢了很贵**的破坏性 git 操作，outward-guard 管
**本机没事、但别人立刻就看得见**的对外动作，command-guard 管**不可逆**的 shell 命令，
file-guard 管**不该被读**的路径，secret-guard 管**发出即泄漏**的凭据。
五者的档位不完全相同，理由见下。

## git-guard 保护什么

| 操作 | 策略键 | 默认 | 为什么危险 |
| --- | --- | --- | --- |
| `git push --force`（含 `-f`、`+refspec`） | `forcePush` | `ask` | 重写远端历史，可能丢掉他人提交 |
| `git reset --hard` | `hardReset` | `ask` | 永久丢弃未提交改动 |
| `git rebase` | `rebase` | `ask` | 重写历史（已推送的分支上尤其） |
| `git commit --amend` | `amend` | `ask` | 改写已发布的提交 |
| `git branch -D` / `--delete --force` / `push --delete` | `branchDelete` | `ask` | 丢掉只存在于该分支的提交 |
| `git clean -f` | `cleanForce` | `ask` | 永久删除未跟踪文件 |
| `git checkout -- <path>` / `checkout .` / `restore <path>` | `checkoutDiscard` | `ask` | 丢弃未暂存的改动 |
| `--no-verify` | `noVerify` | `ask` | 跳过保护仓库的钩子 |

判定细节与实测用例见 [docs/TRIGGERS.md](TRIGGERS.md)。

### 更严者胜

一条命令行可能同时命中多项。判定按 `deny > ask > allow` 取最严的一条——**别人的策略比自己的严
时绝不削弱它**。唯一的覆盖方向是「自己 `deny` 对上上游 `ask`」时返回自己的 `deny`，
因为拒绝一个已经在被质疑的调用不会让情况变坏；反方向（把上游的 `deny` 变成 `ask`）永远不会发生。

上游返回 `cancel`（调用已中止）时原样透传，不做任何判断。

## 默认值的理由

**`noVerify` 默认 `ask`，不默认 `deny`。** `--no-verify` 是钩子本身出错时的逃生通道
（紧急修复、钩子误报、CI 阻塞下的止损）。默认 `deny` 会在最需要它的时候切断它，
而人一旦发现逃生通道被锁，下一步往往是绕过整个插件。给它 `ask` 的意义是
「让人知道自己在跳过什么」。

**`rebase` 默认 `ask`，不默认 `allow`。** rebase 会重写历史。在本地未推送的分支上它完全
正常，在已推送的分支上则会让别人的 clone 失效——而这正是插件无法判断的事，所以交给确认。

**`cleanForce` 不复用 `hardReset`。** 两者丢弃的东西不同：`reset --hard` 丢的是已跟踪文件的
改动，`clean -f` 删的是未跟踪文件——后者更可能是「还没进版本控制的新工作」，
需要独立决策。

**裸 `--force` 会附带改用 `--force-with-lease` 的建议。** `--force-with-lease` 在覆盖一个
你尚未看到的提交时会失败，正是我们想避免的事故。建议出现在理由的第二行，
让「有没有更安全的写法」和「要不要继续」在同一个提示里被回答。

## outward-guard 保护什么

前一道守卫防的是「东西丢了」。这一道防的是另一个错误：**在本机完全可回退，但离开本机的那一刻
其他人就看得见。** 一个还没等到用户点头就先推送、打标签、开 PR、开 issue 或发版的 agent，说的正是
「你已经同意了」——而用户并没有。

| 动作 | 策略键 | 默认 | 为什么需要确认 |
| --- | --- | --- | --- |
| 任意 `git push`（不只强推） | `outwardGuard.push` | `ask` | 分支以用户的名义出现在远端 |
| `git tag <name>`（建标签，不是读标签） | `outwardGuard.tag` | `ask` | 标签是公开标记，别人据此开始构建 |
| `gh pr create` | `outwardGuard.pullRequest` | `ask` | 等于请其他人来审查这个分支 |
| `gh issue` 的写操作（`create`、`comment`、`close` 等） | `outwardGuard.issue` | `ask` | 在仓库里公开挂出一条报告，别人会读到 |
| `npm publish` / `pnpm publish` | `outwardGuard.publish` | `ask` | 所有安装该包的人都看得见，且无法撤回 |

**五项默认全是 `ask`，不是 `deny`。** 这是本插件里唯一一道「本机不会丢任何东西」的守卫，
要的是同意而非阻拦：用户点头，命令原样放行。写 `deny` 会把「先问一句」变成「此路不通」，
而这条路上的动作本来就是正常工作的一部分。

**强推同时命中两道守卫。** `git push --force` 既是对外动作、又是破坏性操作，理由由更严者胜出：
`gitGuard.forcePush` 的解释盖过 `outwardGuard.push`。判定与实测见 [docs/TRIGGERS.md](TRIGGERS.md)。

**上表是全部覆盖面，不是「对外动作」的全集。** 两个同类的动作不在里面：

- `gh release create` / `gh release edit`：发布页同样是公开文本，但标签已经由上一行守着，
  再挡一次只是同一个决定问两遍，所以没做。它默认不被拦截。
- 在 GitHub Actions 里跑的 `npm publish`（`.github/workflows/release.yml`，由 `v*` 标签触发）：
  它发生在 CI 里，不在任何 DSH 会话中，插件的钩子看不到它。这道发布由工作流自己的
  「tag 与 `package.json` 版本一致」门禁和 provenance 负责，与本插件无关。

## command-guard 保护什么

命中以下形状的 shell 命令，默认 `ask`（`commandGuard.dangerousShell`）：

| 形状 | 为什么危险 |
| --- | --- |
| `rm -rf /`、`rm -fr /*`、`rm -Rf ~`、`rm -rf .`、`rm -rf ~/*`、`rm -rf //` | 递归删除落在文件系统根或整个家目录上（含它们的内容），没有回收站 |
| `rm -rf C:\`、`rm -rf C:/*` | 同一个动作的 Windows 写法；`C:`、`C:/`、`C:\` 是同一个位置 |
| `del /f /s /q C:\`、`rd /s /q C:\`、`Remove-Item -Recurse -Force C:\` | cmd 与 PowerShell 的递归删除，目标同样是盘根 |
| `Remove-Item -Recurse -Force $env:USERPROFILE`、`%USERPROFILE%` | 家目录，两种平台的取值语法都按大小写不敏感比较 |
| `format C:`、`Format-Volume`、`Clear-Disk -RemoveData`、`diskpart` | 整卷擦除，不经过文件系统，也不可逆 |
| `mkfs` / `mkfs.ext4` / `mkfs.xfs` | 这个程序存在的唯一目的就是抹掉一个文件系统 |
| `dd if=… of=/dev/sda`、`dd if=/dev/sda` | 裸写（或裸读）块设备，写错盘号即不可逆 |
| `cat image.iso > /dev/sda` | 重定向直写块设备，同上 |
| `:(){ :|:& };:` | fork 炸弹，拖垮整机会话 |
| `chmod -R 777 /`、`chmod -R 777 /etc` | 递归开放系统目录权限，等于取消权限模型 |

**普通删除放行**：`rm build.log`、`rm -rf node_modules`、`rm -rf ./dist`、`rm -rf /tmp/build`、
`Remove-Item -Recurse ./build` 都不命中——判定看的是**目标**（根、家目录、`.`、`..`、`*`，
或 `/` 下单段系统目录），不是 `-rf` 本身。判定的实现直接复用 `src/shell.ts` 的词法切分，
不另写一层 shell 解析。

**目标被替换占位时宁可问一次。** `rm -rf $(cat list)` 的目标不在命令行上，
词法层会把它拆成独立的命令段，因此这一段递归删除**一个操作数都没有**——那既可能是笔误，
也可能是目标没露出来。这种情况同样命中，理由与根目录删除相同：一次问答比一次静默删除便宜。

**命令行全文不进任何输出。** 理由里只有命中的形状名（如 `rm -rf`），这是命令里唯一
可以安全复述的部分。同理 `echo "rm -rf /"` 这类只是**提到**命令的调用不会命中——
判定看的是程序名，不是字符串内容。

## file-guard 保护什么

DSH 没有「读文件前」事件，因此 file-guard 与本仓库其余守卫一样挂在 `tools/pre-execute` 上，
从**调用自身的参数**里取路径，任何情况下都不打开文件。

| 默认 `noRead` | 覆盖范围 |
| --- | --- |
| `.env` | 该文件本身及其变体（`.env.local`、`.env.production`）——但 `.env.example`、`.env.sample`、`.env.template`、`.env.dist`、`.env.defaults` **除外**：它们按惯例不含真实凭据，且是仓库里最需要被读的文件之一 |
| `.ssh/id_rsa` | 任意深度：`/home/x/.ssh/id_rsa` 同样命中 |
| `*.pem`、`*.key`、`*.p12` | 证书与私钥材料，按扩展名 |
| `credentials/` | 云 SDK 的默认凭据目录及其中的每个文件，连同同名的裸文件 |
| `.npmrc` | 常含 `_authToken` |
| `secrets/` | 该目录及其下一切 |

路径来自每个工具真实的参数字段（`file_path`，`grep` 的 `path`/`include`，`glob` 的 `pattern`/`path`，
以及 shell
命令里**已知读取程序**（`cat`、`grep`、`rg`、`Get-Content` 等）的操作数——所以
`cat .env` 会被拦，而 `echo "add .env to gitignore"` 不会。`grep` 的第一个自由词是**搜索表达式**
而不是路径（`grep -rn credentials .` 是在找那个词，不是要读名为 `credentials` 的文件），
所以它不参与路径匹配；路径只看它后面的其余操作数。

**这一道默认 `deny` 而不是 `ask`，与其他守卫不同。** 审批提示必须展示那条路径本身，
而那正是这条规则要挡住的东西——一个会问「要读取 `/repo/.env` 吗」的守卫，已经把路径
送进了模型上下文。拒绝的理由里给出文件名与命中规则（`security.sensitive_file_blocked`
带 `{file}` 与 `{rule}`），足以让人换用环境变量读取或让用户只粘贴需要的那一段。

## secret-guard 保护什么

扫描**每一次**工具调用的全部参数（不只是 shell 命令）：把凭据写进源码文件与敲进命令行
一样是泄漏。识别十八种有固定形状的凭据：

| 模式 | 例子形状 |
| --- | --- |
| AWS access key | `AKIA` + 16 位大写字母数字 |
| AWS secret access key | `aws_secret_access_key` 后跟 40 位 `[A-Za-z0-9/+=]`——它没有自己的前缀，只会以「名字 + 值」的形式出现 |
| GitHub token | `ghp_` / `gho_` / `ghs_` / `ghr_` + 16 位以上 |
| GitHub fine-grained token | `github_pat_` + 20 位以上 |
| Slack token | `xoxb-` / `xoxp-` / `xoxa-` / `xoxr-` / `xoxs-` |
| npm token | `npm_` + 36 位字母数字 |
| GitLab token | `glpat-` + 20 位以上 |
| OpenAI key | `sk-` + 20 位以上（20 位的下限是为了不误伤 `sk-learn` 这类词） |
| Anthropic key | `sk-ant-` + 20 位以上；排在 `sk-` 之前，否则会被报成上个服务 |
| Stripe secret key | `sk_live_` / `rk_live_` + 16 位以上；测试键故意不列，它不守钱 |
| Google API key | `AIza` + 35 位定长 |
| SendGrid key | `SG.` + 22 位 + `.` + 22 位 |
| Twilio API key | `SK` + 32 位小写十六进制 |
| JWT | `eyJ` 开头的三段 base64url |
| Bearer token | `Authorization: Bearer` 后跟 20 位以上不透明值 |
| 密码赋值 | `password` / `passwd` / `pwd` 后跟**带引号**的 6 位以上值 |
| 连接串 | `scheme://user:password@host` 形式 |
| 私钥头 | `-----BEGIN … PRIVATE KEY-----` |

前缀库只覆盖**有固定形状**的凭据：没有前缀、也没有注册表发行格式的通用密钥仍然识别
不了，需要时打开下面那条高熵规则。

**密码赋值只认带引号的值。** 不加引号会同时命中类型声明里的 `password: string` 与普通代码里的
`password = getPassword()`——一个连这两样都拦的守卫，最后一定被人关掉。不带引号的 dotenv
赋值（`DB_PASSWORD=...`）交给 file-guard：那个文件本身就读不到。这是有意的取舍，写在源码的
注释里。

**文档里的占位值不算凭据。** 命中之后还要看一眼匹配到的文本：带 `EXAMPLE`（AWS 参考文档里那把
不能用的键就是这种）、`YOUR_API_KEY` 这类占位词、四个以上连续的 `x`/`X`、八个以上连续的 `0`，
或者已经被脱敏成 `[REDACTED]` 的，放行。方向是安全的：这些值是任何服务都不会签发的，
不是「看着不太像」。不放行的后果是文档里的示例命令全被拒，读者学会的第一件事是把这个守卫关掉。

最后一类「无前缀的高熵字符串」（`secretGuard.genericHighEntropy`）**默认关闭**：它没有
固定形状可依，是唯一会拦下普通文本的规则，误报代价高，需要的人自己打开。

**档位固定为 `deny`，不可配置。** git 与命令守卫拦的是**能重做**的工作，所以给一个
「我知道我在做什么」的覆盖档是合理的；**凭据一旦发出就收不回来**，因此没有更低的档。

**唯一的例外：只读的命令行放行。** 当一行里的每个程序都只读文本时——`grep`、`rg`、
`ack`、`findstr`、`sed`，以及只取 `git log` / `git grep` / `git diff` /
`git show` / `git rev-list` / `git blame` 的 `git`——命中的凭据不会被执行，只记一条
`security.secret_search`（状态行里显示为「已放行」）。理由很实际：值已经在模型刚写下的参数里，
拒绝搜索既删不掉它，也拦不住它外流，只会让人更难发现自己的泄漏；一个连「修」都一起拦下的守卫，
最后一定被关掉。反过来，凡是有**一个**程序可能写出或发送——`curl`、`wget`、`git push`、
`echo` 重定向、`xargs`、管道另一端的任何非只读程序——整行保持拒绝。

判断看的是这行**真正会执行什么**，不是它写着调用谁。三种写法把程序藏在按词切开看不见的地方，
因此一律不算只读：`sed -i`（把结果写回文件）、`sed` 的 `e` 标志与 `-f`（`s/a/b/e` 会执行替换文本，
`-f` 读的脚本不在这行上）、以及任何带 `$(…)`、`<(…)`、`>(…)` 的行（引号里的替换只是一个词，
命令替换就在这个词里）。这几条是补洞留下的，不是理论顾虑：前两版实现都被它们绕过。

这条是策略选择而非漏洞补丁：审计文档把它归类为「误报成本高」，不是「不该拦」。

**回显即泄漏，所以绝不回显。** 命中后返回的文本只说明命中了哪一类模式
（`security.secret_pattern_matched` 带 `{pattern}`，取值为「AWS access key」这类
语言中立的技术名），不包含匹配到的值本身；同一条值也不进入审计记录。理由里会提示
「若已发送到任何地方请轮换」——这是命中之后真正该做的一件事。

## 审计日志记什么

`audit.enabled` 默认开，写入 `audit.path`（默认 `.dev-docs/audit-log.jsonl`，每行一个 JSON
对象）。插件不改你的 `.gitignore`：写完第一行后会问一次 `git check-ignore`，路径没被忽略时
以 warning 说一次——一份记录着拒绝清单的日志随下一次提交出门，比没有日志更糟。
字段是时间、会话、工具名、命中的规则 key、应用了哪一档、
工作目录 `cwd`，以及**该次调用的完整参数副本**——命令行与提交信息的全文都在里面，`cwd` 也落盘。
这是刻意的：命中之后要能复现「当时到底跑了什么」。代价是这份日志的敏感度与它记录的调用同级，
所以本仓库的 `.gitignore` 与 `docs/PUBLISHING.md` 都把它当敏感文件看待。

**脱敏先于落盘，两道独立的处理**：命中的凭据（与开启高熵检测时的长随机串）替换为
`[REDACTED]`；命中 `noRead` 的路径只保留**文件名**（目录本身也是信息，不必记）。
`file-guard` 根本不打开文件，所以敏感文件的内容从不进入审计——`tests/audit.spec.ts` 对这几条
逐条断言，包括「`file_path` 变成 `.env` 而 `/repo/inner` 不出现在整行里」。

审计记录**不回进模型上下文**，写入是同步 `appendFileSync`（进程崩掉时还在内存里的行不算记录）；
**写入失败只走 `ctx.logger.debug`，绝不因为写不出日志而失败一次工具调用**。唯一的例外是
「这个路径没被 git 忽略」那一条：它讲的是提交里会出现什么，按 warning 说，每个路径一次。

**日志与审计的敏感度不同，别混淆。** 守卫命中时 `ctx.logger.debug` 记的是规则标识，
形如 `[dsh-dev-workflow] git guard: security.guard.force_push`——不带命令行、不带提交信息全文
（五个守卫的日志前缀分别是 `git guard`、`outward guard`、`command guard`、`file guard`、
`secret guard`）。
不落盘的日志常常被重定向到文件或随 issue 提交，往里塞全文等于把「作者在做什么、改动里有哪个
客户名」搬到另一个地方。**审计记录带上全文是它的例外，按上文脱敏之后才落盘。**

## 不做什么

| 不做的事 | 原因 |
| --- | --- |
| 不读敏感文件 | file-guard 只比对路径字符串，不打开文件；`.env`、密钥文件的内容不在任何检查的输入里 |
| 不执行 git 以外的程序 | 唯一的子进程是 `git`，经 `subprocess` 服务的 `resolveExecutable('git')` |
| 不联网 | 插件没有任何网络调用 |
| 不落盘会话状态 | 去重状态与命中计数只在内存（`src/state.ts`），重启即清空；唯一落盘的是脱敏后的审计记录 |
| 不硬编码密钥 | 插件不持有任何凭据，也不需要；secret-guard 只识别形状，不校验有效性 |

## 与宿主的分工

| 层 | 负责什么 |
| --- | --- |
| DSH 宿主 | 工具派发、审批服务；审批策略为 `never` 时 `decide()` 在提问前直接返回 `rejected`，没有审批能力时返回 `unavailable` |
| 本插件 | 在门禁上判断命令是否危险，给出 `deny` / `ask` / `allow`；策略为 `never` 时不返回没人会回答的 `ask`，改为自己 `deny` 并说明原因 |
| `.husky/` + commitlint | 用户在自己终端里提交时的强制校验 |
| GitHub 分支保护 | 合并前必须 PR、必须 CI 通过、禁止直接 push、禁止强推与删除 |

**插件管会话内，husky 管会话外。** 用户在**自己的终端**里 `git commit` 或 `git push --force`
时，插件看不到——它只在 DSH 会话的工具调用路径上运行。这不是可以靠更多代码弥补的缺口，
而是分工：会话外的最后一道门是 git 钩子与 GitHub 分支保护。

相应地，**本插件不是安全边界**。它降低事故概率，不能阻止一个决意绕过的操作者
（关掉插件、换终端、直接调 git 都能绕过）。把它当护栏，不要当门锁。

还有一类绕过不需要离开会话：**在命令里再包一层解释器**——`node -e "require('fs').readFileSync('.env')"`、
`python -c "…"`。守卫看的是**参数文本**，不做动态解析，所以它认不出解释器内部那句。

shell 那一层则恢复了一部分：`sudo` / `env` / `npx` 这类**裸包装词**由 `src/shell.ts` 的
`TRANSPARENT` 剥离（`sudo git push --force` 照样命中），`timeout 120` / `nice -n 10` 这类
**限流器前缀**同样剥离并吃掉自己的时长与选项值（`timeout 120 git push --force` 照样命中），
`sh -c "git push --force"` 里的
`-c` 参数会被再次当作命令行解析（`SHELLS`：`sh`、`bash`、`zsh`、`dash`、`ksh`、`ash`），
`$(...)` 与反引号里的命令同样递归解析。但**解释器本身仍是不透明的**——那需要真正的运行时
语义，属于已知边界。`flock -c "<命令>"` 也仍是边界：命令藏在选项值里，词法走查取不回来。

## 怎么报告

**绕过直接开 [公开 issue](https://github.com/Melosic/dsh-dev-workflow/issues/new) 就行。**
本插件不是安全边界（见上一节），所以「某条该拦的命令被放行」是缺陷，不是漏洞：它可复现、应该修、
而且公开之后别人能补充「我也遇到了」，比藏进私密渠道更容易被发现和修掉。已知的边界在上文与
[docs/TRIGGERS.md](TRIGGERS.md#我们看不见什么) 里都写着，这一类信息本来就是公开的。

唯一走私密渠道的情形是**报告本身携带真实凭据**——活 token、私有 key、你家 `.env` 里的那一行。
把它贴进公开 issue 等于亲手完成一次泄漏。这种情况下要么先把值替换成 `xxx`，
要么走 [security advisory](https://github.com/Melosic/dsh-dev-workflow/security/advisories/new)。

报障请用 [bug 报告表单](../.github/ISSUE_TEMPLATE/bug-report.yml)，它要求填 DSH 版本与
`/dev-workflow status` 的完整输出——「插件没反应」的报障绝大多数最终查明是配置值、版本差异
或规则本就如此，缺这两项无法分辨。

## 依赖与供应链

- **运行期零依赖**：`dependencies` 为空。全部能力来自宿主提供的服务与 Node 内建模块。
- DSH 域内包写**精确版本清单** `0.2.0-rc.2 || 0.2.1-rc.2`，不写范围，也不用 `^` / `~`：
  清单上的每个版本都是本插件真正被加载过的；范围会替作者宣称没测过的版本也兼容
  （`>=0.2.0-rc.2` 对 `0.3.0` 及其后的每个版本都为真），而失配的第一个信号是用户会话
  里的运行时错误，不是加载时被 `preflight()` 干净地禁用并说明原因。
  `devDependencies` 另把三个包钉在一个精确的实测基线（当前 `0.2.1-rc.2`），那是 CI 跑的版本，
  与名单是两条会分开漂移的线——把名单收成当前基线，会让仍在旧版本上的用户装不上，
  或装上了在启动时被禁用。清单写法的完整推导、加版本的代价与两者为何分离，
  见 [docs/PUBLISHING.md](PUBLISHING.md)。
- 插件通过 `cordis.patch.yml` 声明为 bundle patch，`scripts/ci-checks.mjs` 校验它
  既被 `package.json` 的 `dsh.bundle.patch` 声明，又列入 `files`——避免「发布出去的包缺了
  挂载点」这类只在用户机器上暴露的问题。

### 发布产物里有什么

`package.json` 的 `files` 是**白名单**，发布出去的 tarball 至少包含以下几项（完整清单以
`pnpm pack --dry-run` 或 `npm pack --dry-run` 的实际输出为准）：

```
lib/  client.js  skills/  locale/  cordis.patch.yml  README.md  README.zh.md  CHANGELOG.md  LICENSE
```

据此可以给出三条可验证的结论：

| 不发布 | 为什么这很重要 |
| --- | --- |
| 源码 `src/` | 发布的是编译产物 `lib/`。源码里的注释、TODO 与内部路径名不进入用户环境 |
| `tests/` | 测试不在用户机器上跑，也不需要在那里存在 |
| `docs/` | 深度文档面向本仓库贡献者，不面向使用者 |
| `.dev-docs/`、`.env`、任何密钥文件 | 前者被 `.gitignore` 忽略且从未进入任何提交；后者从未被读取过（见上表） |

因为白名单只增不减地暴露一个风险：**新加的必要文件忘了写进 `files`**。
两个结构守卫专治这个——`ci:checks` 会校验 `cordis.patch.yml` 是否同时被声明并列入 `files`，
而 `pnpm pack --dry-run` 的输出则是发布前的最后一道肉眼核对。

### 发布前的审计

```bash
pnpm audit --registry=https://registry.npmjs.org
```

必须显式指定官方 registry：本项目开发机的 `.npmrc` 指向只读镜像源，
走默认值只会拿到 `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`（pnpm）或 `ENOLOCK`（npm，本仓库用 pnpm、
没有 `package-lock.json`）。

**读审计结果时先问一句：这条路径能到达用户吗？** 本项目运行期零依赖，所以所有命中都必然在
开发期路径上。开发期路径上的漏洞影响的是贡献者的机器，不是使用者的机器——要修，但它与
「用户装了这个包是否安全」是两个问题，不能混为一谈，也不该为了让命令变绿而删掉一个真实的
开发工具。

### 发布者的凭据

- npm 凭据只存在于开发机的 `~/.npmrc` 或 `npm login` 的凭据存储里，**从不写入仓库**。
  项目的 `.npmrc` 只含 `auto-install-peers` / `strict-peer-dependencies` / `resolution-mode`
  三个 pnpm 配置项，没有 `_authToken`。
- 发布命令必须显式带 `--registry=https://registry.npmjs.org`：镜像源是同步端点，不是发布端点，
  把凭据发往它没有意义。
- **不由本插件自己执行发布。** git-guard 覆盖的是危险 git 命令；`npm publish` 不在它的范围内，
  它也不会被诱导去执行——插件的唯一子进程是 `git`。真正跑发布的是
  `.github/workflows/release.yml`：由 `v*` 标签触发，凭据取自仓库 secret `NPM_TOKEN`，
  带 OIDC provenance，先用「tag 与 `package.json` 版本一致」把自己卡住，发完再回查 registry
  上的 tarball 版本。

## 相关文档

- 判定细节与边界：[docs/TRIGGERS.md](TRIGGERS.md)
- 策略字段与取值：[docs/CONFIGURATION.md](CONFIGURATION.md)
- 发布流程与 peerDependencies 分段规则：[docs/PUBLISHING.md](PUBLISHING.md)
- 规范中的安全操作规范：[skills/dsh-dev-workflow/SKILL.md](../skills/dsh-dev-workflow/SKILL.md)
- 为什么是插件而不是模式：[docs/ADR/002-plugin-not-preset.md](ADR/002-plugin-not-preset.md)
