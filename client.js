// Browser half of `@melosic/dsh-dev-workflow`.
//
// Hand-written, in the deployment's module-table format, because this package
// has no bundler: the loader hands the factory a `require` that resolves the
// baseline externals (`react` here), and the factory's return value becomes the
// module exports. The id must equal the package name, and the configuration
// namespace below must equal the Loader entry id that Host half registers, or
// the two halves never pair up.
//
// Nothing here talks to the profile file directly. Reads, writes, the revision
// fence, conflict detection and the reload after a failed write all go through
// the client `configForms` service; this file only renders the form and stages
// a draft the way the official `SettingsForm` does.
window.__ModuleLoader__.load({
  id: '@melosic/dsh-dev-workflow',
  // The parameter is called `req`, not `require`: TypeScript reads a call to an
  // identifier named `require` in a JS file as a CommonJS import, so a
  // parameter of that name looks unused and the real return type of the
  // declared `ModuleRequire` is never applied. The loader passes it
  // positionally, so the name is free.
  factory: (req) => {
    const React = req('react')
    const h = React.createElement
    const { useEffect, useState } = React

    /** Loader entry id of the Host half; the settings namespace key. */
    const NAMESPACE = 'dsh-dev-workflow'
    /** Client locale namespace for this panel's own text. */
    const LOCALE = 'settings.devWorkflow'
    /** Slot the Settings navigation entry lives in. */
    const SLOT = 'settings.section'

    // Only the 14 `--dsw-alias-*` tokens the theme publishes are referenced;
    // the primitive package's other tokens stay undefined for a plugin, so
    // every value the primitives read from one falls back to a literal here.
    // Markup and behaviour are copied from `dsh-client-ui-primitives` and the
    // official settings pages, renamed under this plugin's prefix.
    const CSS = `
.dsw-dev-workflow-section{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary)}
.dsw-dev-workflow-title{margin:0;font-size:18px;font-weight:600}
.dsw-dev-workflow-intro{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dsw-dev-workflow-status{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsw-dev-workflow-group{display:flex;flex-direction:column;width:100%;min-width:0}
.dsw-dev-workflow-group+.dsw-dev-workflow-group{border-top:0.5px solid var(--dsw-alias-border-l1)}
.dsw-dev-workflow-groupRow{display:flex;align-items:center;gap:6px;height:32px;min-width:0;padding:0;border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;font:inherit}
.dsw-dev-workflow-groupRow:hover{color:var(--dsw-alias-label-primary)}
.dsw-dev-workflow-groupChevron{flex:none;width:14px;height:14px;transition:transform 120ms ease}
.dsw-dev-workflow-groupRow[aria-expanded='true'] .dsw-dev-workflow-groupChevron{transform:rotate(90deg)}
.dsw-dev-workflow-groupTitle{font-size:13px;font-weight:500;line-height:1.5}
.dsw-dev-workflow-groupBody{display:flex;flex-direction:column;padding:0 0 8px}
.dsw-dev-workflow-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.dsw-dev-workflow-field+.dsw-dev-workflow-field{border-top:0.5px solid var(--dsw-alias-border-l2)}
.dsw-dev-workflow-fieldHead{display:flex;align-items:center;gap:8px}
.dsw-dev-workflow-field[data-inline] .dsw-dev-workflow-fieldHead{flex:1;min-width:0}
.dsw-dev-workflow-fieldRow{display:flex;align-items:flex-start;gap:12px}
.dsw-dev-workflow-fieldRow .dsw-dev-workflow-fieldBody{flex:none;padding-top:1px}
.dsw-dev-workflow-fieldLabel{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5}
.dsw-dev-workflow-fieldBody{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsw-dev-workflow-hint{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dsw-dev-workflow-invalid{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}
.dsw-dev-workflow-reset{padding:0;border:0;background:none;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsw-dev-workflow-badge{flex:none;padding:1px 6px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsw-dev-workflow-badge[data-tone='muted']{font-style:italic;opacity:0.7}
.dsw-dev-workflow-check input:disabled+span{opacity:0.5}
.dsw-dev-workflow-number:disabled,.dsw-dev-workflow-segments[data-disabled=''] .dsw-dev-workflow-segment{opacity:0.5}
.dsw-dev-workflow-switch{box-sizing:border-box;position:relative;flex:none;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l1);cursor:pointer}
.dsw-dev-workflow-switch[aria-checked='true']{background:var(--dsw-alias-brand-primary)}
.dsw-dev-workflow-switch:disabled{opacity:0.4;cursor:default}
.dsw-dev-workflow-switchThumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);transition:transform 120ms ease}
.dsw-dev-workflow-switch[aria-checked='true'] .dsw-dev-workflow-switchThumb{transform:translateX(16px)}
.dsw-dev-workflow-segments{position:relative;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:4px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsw-dev-workflow-segmentIndicator{position:absolute;top:4px;left:4px;width:calc((100% - 8px - 2px * (var(--dsw-dev-workflow-segment-count) - 1)) / var(--dsw-dev-workflow-segment-count));height:calc(100% - 8px);border-radius:6px;background:var(--dsw-alias-bg-layer-1);transform:translateX(calc(var(--dsw-dev-workflow-segment-index) * (100% + 2px)));transition:transform 160ms ease;pointer-events:none}
.dsw-dev-workflow-segment{box-sizing:border-box;position:relative;z-index:1;height:28px;padding:0 16px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer;transition:color 120ms ease}
.dsw-dev-workflow-segment:hover{color:var(--dsw-alias-label-primary)}
.dsw-dev-workflow-segment[aria-selected='true']{color:var(--dsw-alias-label-primary);font-weight:600}
.dsw-dev-workflow-segment:disabled{opacity:0.4;cursor:default}
.dsw-dev-workflow-checks{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px 16px}
.dsw-dev-workflow-check{display:inline-flex;align-items:center;gap:6px;font-size:13px;line-height:20px;cursor:pointer}
.dsw-dev-workflow-check input{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary)}
.dsw-dev-workflow-number{box-sizing:border-box;width:96px;height:32px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsw-dev-workflow-number:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dsw-dev-workflow-number[aria-invalid='true']{border-color:var(--dsw-alias-state-error-primary)}
.dsw-dev-workflow-advanced{display:flex;flex-direction:column;gap:6px;padding:8px 0 4px}
.dsw-dev-workflow-advancedRow{display:flex;gap:12px;font-size:12px;line-height:1.6}
.dsw-dev-workflow-advancedKey{flex:none;width:180px;color:var(--dsw-alias-label-secondary)}
.dsw-dev-workflow-advancedValue{flex:1;min-width:0;margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;color:var(--dsw-alias-label-primary)}
.dsw-dev-workflow-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:12px}
.dsw-dev-workflow-note{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsw-dev-workflow-note[data-tone='error']{color:var(--dsw-alias-state-error-primary)}
.dsw-dev-workflow-note[data-tone='success']{color:var(--dsw-alias-state-success-primary)}
.dsw-dev-workflow-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer}
.dsw-dev-workflow-button:disabled{opacity:0.4;cursor:default}
.dsw-dev-workflow-button[data-variant='primary']{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}
@media (prefers-reduced-motion: reduce){.dsw-dev-workflow-switchThumb,.dsw-dev-workflow-groupChevron,.dsw-dev-workflow-segmentIndicator{transition:none}}
`
    const cssTag = '@melosic/dsh-dev-workflow/client.module.css'
    if (
      typeof document !== 'undefined' &&
      document.querySelector('style[data-plugin-css=' + JSON.stringify(cssTag) + ']') === null
    ) {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@melosic/dsh-dev-workflow'
      tag.dataset.pluginCss = cssTag
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    const EN = {
      nav: 'Dev workflow',
      title: 'Dev workflow',
      intro:
        'The conventions this plugin enforces while you work. Saving writes them to the configuration file of this profile; they take effect without a restart.',
      'group.workflow': 'Workflow mode',
      'group.commit': 'Commit convention',
      'group.docs': 'Documentation sync',
      'group.git': 'Git safety',
      'group.outward': 'Outward-facing actions',
      'group.command': 'Command safety',
      'group.files': 'Files and secrets',
      'group.audit': 'Audit log',
      'group.advanced': 'Advanced (read-only)',
      'field.mode': 'Plugin mode',
      'field.scope': 'Which repositories',
      'field.locale': 'Plugin text language',
      'field.ownTrigger': 'Run the built-in checks (commit, PR, release)',
      'field.commitEnabled': 'Check commit messages',
      'field.onFailure': 'On a hard problem',
      'field.types': 'Allowed types',
      'field.requireScope': 'Require a scope',
      'field.subjectMaxLength': 'Maximum subject length',
      'field.docsEnabled': 'Check documentation sync',
      'field.requireChangelog': 'A feat must update the changelog',
      'field.requireReadmeOnConfig': 'A configuration change must update the README',
      'field.releaseSemver': 'Check the version number',
      'field.releaseChangelog': 'The release must be in the changelog',
      'field.releaseCategories': 'Changelog headings should be standard categories',
      'field.releasePrerelease': 'A pre-release must not publish to latest',
      'field.gitEnabled': 'Git guard',
      'field.outwardEnabled': 'Outward guard',
      'field.rememberApproved': 'Remember approved operations',
      'field.commandEnabled': 'Command guard',
      'field.dangerousShell': 'Destructive shell commands',
      'field.fileEnabled': 'Sensitive file guard',
      'field.secretEnabled': 'Secret leak guard',
      'field.genericHighEntropy': 'Generic high-entropy strings',
      'field.auditEnabled': 'Audit log',
      'policy.forcePush': 'Force push',
      'policy.hardReset': 'Hard reset',
      'policy.rebase': 'Rebase',
      'policy.amend': 'Amend a commit',
      'policy.branchDelete': 'Delete a branch',
      'policy.cleanForce': 'Clean untracked files',
      'policy.checkoutDiscard': 'Discard unstaged edits',
      'policy.noVerify': 'Skip hooks (--no-verify)',
      'outward.push': 'Push to the remote',
      'outward.tag': 'Create a tag',
      'outward.pullRequest': 'Open a pull request',
      'outward.issue': 'Open an issue',
      'outward.publish': 'Publish a version',
      'hint.mode':
        'Off withdraws every tool, skill, command and trigger this plugin registers, so it costs no tokens. The plugin itself stays loaded — enabling or disabling it is the plugin manager\u2019s job.',
      'hint.scope':
        'Which repositories this profile checks. Marked means only a repository whose project root has .dsh/dev-workflow.yml; the skill line and every guard stay quiet everywhere else. The two tool definitions are registered per process, so they still ride along in an unmarked repository.',
      'hint.locale':
        'The language of this plugin\u2019s own text — check results, skill text, approval prompts. It does not decide what language the model writes commits or pull requests in.',
      'hint.localeResolved':
        'Auto follows the machine\u2019s own language \u2014 currently {locale} ({tag}).',
      'hint.onFailure':
        'A header that does not parse and a type outside the allowed set are hard problems. Length, a trailing period, a missing scope, and a `!` with no BREAKING CHANGE footer are always warnings.',
      'hint.requireScope':
        'Off leaves a missing scope as a hint, shown only when the change touches one module.',
      'hint.ownTrigger':
        'Governs all three triggers: the message and documentation checks before a commit, the title and description checks before a pull request, and the version and changelog checks before a release. Turn it off when the repository already enforces the conventions with husky and commitlint.',
      'hint.releaseSemver':
        'The version a tag or publish names must look like a version. Off for a repository that versions by date or build number; the pattern itself is in the configuration file.',
      'hint.genericHighEntropy':
        'Also stops long random strings with no known prefix. This is the rule most likely to interrupt an ordinary call, so it is off by default.',
      'hint.rememberApproved':
        'Applies to git operations whose policy is Ask: one approval covers the same operation for the rest of the session. Deny is never affected.',
      'hint.outward':
        'Covers the actions other people can see: a push, a tag, a pull request, an issue, a publish. Nothing here is lost if it goes wrong on this machine — the question is whether you agreed to announce it.',
      'hint.gitEnabled':
        'Off means no git operation is questioned again: a force push, a hard reset, a rebase, an amend, a branch delete, a clean, a discarded working tree, or --no-verify all run untouched.',
      'hint.commandEnabled':
        'Off means a recursive delete aimed at a filesystem root, a reformat, a raw write to a block device and a fork bomb all run untouched.',
      'hint.fileEnabled':
        'Off means the files listed in `fileGuard.noRead` (a .env, an ssh key, a *.pem, a credentials file) may be read by any tool. There is no per-file exception, so this is the only way to read one.',
      'hint.secretEnabled':
        'Off means a call carrying an AWS key, a GitHub token (classic or fine-grained), a Slack token, an npm or GitLab token, a JWT, a Bearer header or a private key is forwarded. A credential that has been sent cannot be recalled.',
      'hint.auditEnabled':
        'Off means no guard decision is recorded: a reviewer has no trail of what was questioned, allowed, or refused after the session ends.',
      'value.on': 'On',
      'value.off': 'Off',
      'value.all': 'Every repository',
      'value.marked': 'Only marked ones',
      'value.auto': 'Auto',
      'value.en-US': 'English',
      'value.zh-CN': 'Chinese',
      'value.warn': 'Warn',
      'value.block': 'Block',
      'value.deny': 'Deny',
      'value.ask': 'Ask',
      'value.allow': 'Allow',
      'invalid.number': 'Enter a whole number of 1 or more.',
      'action.save': 'Save',
      'action.saving': 'Saving\u2026',
      'action.saved': 'Saved. The change takes effect right away.',
      'action.discard': 'Cancel',
      'action.reset': 'Reset',
      'action.overridden': 'Overridden',
      'action.failed': 'Could not save. The draft is kept.',
      'action.conflict':
        'Someone else changed these settings while this page was open. The draft is kept — reload to see both, then save again.',
      'action.resetAll': 'Reset all to defaults',
      'action.inactive': 'Not in effect',
      'action.unavailable': 'These settings are not available right now.',
      'advanced.note':
        'Declared in the configuration file only. The panel shows them for reference and never edits them.',
      'advanced.open': 'Open configuration file',
      'advanced.empty': 'not set',
      'advanced.codePaths': 'Code paths',
      'advanced.docsDir': 'Docs directory',
      'advanced.changelog': 'Changelog path',
      'advanced.exclude': 'Excluded paths',
      'advanced.versionPattern': 'Version pattern',
      'advanced.mirrors': 'Code \u2194 document mirrors',
      'advanced.auditPath': 'Audit log path',
    }
    const ZH = {
      nav: '开发工作流',
      title: '开发工作流',
      intro:
        '本插件在工作过程中执行的规范。保存即写入当前 profile 的配置文件，不需要重启即可生效。',
      'group.workflow': '工作流模式',
      'group.commit': '提交规范',
      'group.docs': '文档同步',
      'group.git': 'Git 安全',
      'group.outward': '对外可见动作',
      'group.command': '命令安全',
      'group.files': '文件与密钥保护',
      'group.audit': '审计日志',
      'group.advanced': '高级（只读）',
      'field.mode': '插件模式',
      'field.scope': '作用于哪些仓库',
      'field.locale': '插件文案语言',
      'field.ownTrigger': '运行自带检查（提交 / PR / 发版）',
      'hint.ownTrigger':
        '管三个触发器：提交前的信息与文档检查、PR 前的标题与描述检查、发版前的版本与 CHANGELOG 检查。仓库自己用 husky / commitlint 兜住规范时关掉它。',
      'field.commitEnabled': '检查提交信息',
      'field.onFailure': '出现硬性问题时',
      'field.types': '允许的 type',
      'field.requireScope': 'scope 必填',
      'field.subjectMaxLength': 'subject 最大长度',
      'field.docsEnabled': '检查文档同步',
      'field.requireChangelog': 'feat 必须更新 CHANGELOG',
      'field.requireReadmeOnConfig': '配置变更必须更新 README',
      'field.releaseSemver': '校验版本号',
      'field.releaseChangelog': '发版必须写入 CHANGELOG',
      'field.releaseCategories': 'CHANGELOG 分类建议用标准类别',
      'field.releasePrerelease': '预发布不得发到 latest',
      'field.gitEnabled': 'Git 守卫',
      'field.outwardEnabled': '对外动作守卫',
      'field.rememberApproved': '记住已批准的同类操作',
      'field.commandEnabled': '命令守卫',
      'field.dangerousShell': '危险 shell 命令',
      'field.fileEnabled': '敏感文件守卫',
      'field.secretEnabled': '密钥泄漏守卫',
      'field.genericHighEntropy': '通用高熵字符串检测',
      'field.auditEnabled': '审计日志',
      'policy.forcePush': '强制推送',
      'policy.hardReset': '硬重置',
      'policy.rebase': '变基',
      'policy.amend': '修改已有提交',
      'policy.branchDelete': '删除分支',
      'policy.cleanForce': '清理未跟踪文件',
      'policy.checkoutDiscard': '丢弃未暂存改动',
      'policy.noVerify': '跳过钩子（--no-verify）',
      'outward.push': '推送到远端',
      'outward.tag': '创建标签',
      'outward.pullRequest': '创建 PR',
      'outward.issue': '创建 issue',
      'outward.publish': '发布版本',
      'hint.mode':
        '关闭后，本插件注册的工具、技能、命令和触发器全部撤销，不占常驻 token。插件本身仍然加载 —— 启用或停用是插件管理器的事。',
      'hint.scope':
        '这个 profile 检查哪些仓库。「仅带标记」表示只检查项目根目录下有 .dsh/dev-workflow.yml 的仓库；其余仓库里技能目录行和所有守卫都不出声。两个工具定义是进程级注册，在未标记的仓库里仍然常驻。',
      'hint.locale':
        '本插件自身文案的语言 —— 检查结果、技能正文、审批提示。它不决定模型用什么语言写提交信息或 PR。',
      'hint.localeResolved': '「自动」跟随本机语言，当前为：{locale}（{tag}）。',
      'hint.onFailure':
        'header 无法解析、type 不在允许集合属于硬性问题。长度、句末句点、缺少 scope、以及 `!` 没配 BREAKING CHANGE footer 始终只是警告。',
      'hint.requireScope': '关闭时，只有改动落在单个模块里才提示补 scope。',
      'hint.releaseSemver':
        '打标签或发布时写出的版本号必须像一个版本号。按日期或构建号发版的仓库可以关闭；具体正则写在配置文件里。',
      'hint.genericHighEntropy':
        '没有已知前缀的长随机串也会被拦。这一项最容易打断普通调用，所以默认关闭。',
      'hint.rememberApproved':
        '仅对策略为「询问」的 git 操作生效：一次同意覆盖本会话内同一操作。策略为「拒绝」的操作永不受影响。',
      'hint.outward':
        '覆盖其他人看得见的动作：推送、打标签、创建 PR、开 issue、发布。这些在本机做错了都还能回头 —— 要确认的是你有没有同意把它公开出去。',
      'hint.gitEnabled':
        '关闭后不再过问任何 git 操作：强制推送、硬重置、变基、修改已有提交、删分支、清理未跟踪文件、丢弃工作区改动、--no-verify 全部原样执行。',
      'hint.commandEnabled':
        '关闭后，指向文件系统根目录的递归删除、格式化、向块设备裸写、fork 炸弹都原样执行。',
      'hint.fileEnabled':
        '关闭后 `fileGuard.noRead` 里的文件（.env、ssh 私钥、*.pem、凭据文件）任何工具都能读。这项没有逐条例外，所以关闭它是读这些文件的唯一办法。',
      'hint.secretEnabled':
        '关闭后，带着 AWS key、GitHub token（经典或 fine-grained）、Slack token、npm / GitLab token、JWT、Bearer 头或私钥的调用会原样转发。凭据一旦发出就收不回来。',
      'hint.auditEnabled':
        '关闭后不再记录任何守卫决策：会话结束后，审查者看不到哪些操作被问过、被放行或被拒绝。',
      'value.on': '开启',
      'value.off': '关闭',
      'value.all': '所有仓库',
      'value.marked': '仅带标记的',
      'value.auto': '自动',
      'value.en-US': 'English',
      'value.zh-CN': '中文',
      'value.warn': '警告',
      'value.block': '阻断',
      'value.deny': '拒绝',
      'value.ask': '询问',
      'value.allow': '允许',
      'invalid.number': '请输入大于等于 1 的整数。',
      'action.save': '保存',
      'action.saving': '保存中…',
      'action.saved': '已保存，改动立即生效。',
      'action.discard': '取消',
      'action.reset': '恢复默认',
      'action.overridden': '已覆盖',
      'action.failed': '保存失败。草稿已保留。',
      'action.conflict':
        '页面打开期间有人改过这些设置。草稿已保留 —— 重新打开页面看到两边内容后再保存。',
      'action.resetAll': '全部恢复默认',
      'action.inactive': '当前不生效',
      'action.unavailable': '当前无法读取这些设置。',
      'advanced.note': '这些项只能在配置文件里声明。面板只作展示，从不修改它们。',
      'advanced.open': '打开配置文件',
      'advanced.empty': '未设置',
      'advanced.codePaths': '代码目录',
      'advanced.docsDir': '文档目录',
      'advanced.changelog': 'CHANGELOG 路径',
      'advanced.exclude': '排除路径',
      'advanced.versionPattern': '版本号正则',
      'advanced.mirrors': '代码 ↔ 文档映射',
      'advanced.auditPath': '审计日志路径',
    }

    // One entry per control the page renders. `path` is the same path the Host
    // schema nests the field under, so a test can walk `Config` with it.
    const COMMIT_TYPES = [
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
    ]
    const GIT_POLICIES = [
      'forcePush',
      'hardReset',
      'rebase',
      'amend',
      'branchDelete',
      'cleanForce',
      'checkoutDiscard',
      'noVerify',
    ]
    const POLICY_OPTIONS = [
      { value: 'deny', label: 'value.deny' },
      { value: 'ask', label: 'value.ask' },
      { value: 'allow', label: 'value.allow' },
    ]
    const OUTWARD_POLICIES = ['push', 'tag', 'pullRequest', 'issue', 'publish']
    const GROUPS = [
      { key: 'workflow', open: true },
      { key: 'commit', open: true },
      { key: 'docs', open: true },
      { key: 'git', open: true },
      { key: 'outward', open: true },
      { key: 'command', open: true },
      { key: 'files', open: true },
      { key: 'audit', open: true },
      { key: 'advanced', open: false },
    ]
    // Every entry names its `label` explicitly: a key derived from the last path
    // segment collides across namespaces (`field.enabled` for six different
    // switches), which is how untranslated placeholders reached the page. The
    // schema test walks this table and fails if a label is not in both
    // dictionaries.
    const FIELDS = [
      {
        group: 'workflow',
        path: ['mode'],
        control: 'switch',
        label: 'field.mode',
        on: 'on',
        off: 'off',
        hint: 'hint.mode',
      },
      {
        group: 'workflow',
        path: ['scope'],
        control: 'segments',
        label: 'field.scope',
        options: ['all', 'marked'],
        hint: 'hint.scope',
      },
      {
        group: 'workflow',
        path: ['locale'],
        control: 'segments',
        label: 'field.locale',
        hint: 'hint.locale',
        note: 'hint.localeResolved',
        options: ['auto', 'en-US', 'zh-CN'],
      },
      {
        group: 'workflow',
        path: ['enableOwnTrigger'],
        control: 'switch',
        label: 'field.ownTrigger',
        hint: 'hint.ownTrigger',
      },
      {
        group: 'commit',
        path: ['commitCheck', 'enabled'],
        control: 'switch',
        label: 'field.commitEnabled',
      },
      {
        group: 'commit',
        path: ['commitCheck', 'onFailure'],
        control: 'segments',
        label: 'field.onFailure',
        options: ['warn', 'block'],
        hint: 'hint.onFailure',
      },
      {
        group: 'commit',
        path: ['commitCheck', 'types'],
        control: 'checks',
        label: 'field.types',
      },
      {
        group: 'commit',
        path: ['commitCheck', 'requireScope'],
        control: 'switch',
        label: 'field.requireScope',
        hint: 'hint.requireScope',
      },
      {
        group: 'commit',
        path: ['commitCheck', 'subjectMaxLength'],
        control: 'number',
        label: 'field.subjectMaxLength',
      },
      {
        group: 'docs',
        path: ['docsCheck', 'enabled'],
        control: 'switch',
        label: 'field.docsEnabled',
      },
      {
        group: 'docs',
        path: ['rules', 'requireChangelogOnFeat'],
        control: 'switch',
        label: 'field.requireChangelog',
      },
      {
        group: 'docs',
        path: ['docsCheck', 'requireReadmeOnConfig'],
        control: 'switch',
        label: 'field.requireReadmeOnConfig',
      },
      {
        group: 'docs',
        path: ['releaseCheck', 'semver'],
        control: 'switch',
        label: 'field.releaseSemver',
        hint: 'hint.releaseSemver',
      },
      {
        group: 'docs',
        path: ['releaseCheck', 'changelog'],
        control: 'switch',
        label: 'field.releaseChangelog',
      },
      {
        group: 'docs',
        path: ['releaseCheck', 'changelogCategories'],
        control: 'switch',
        label: 'field.releaseCategories',
      },
      {
        group: 'docs',
        path: ['releaseCheck', 'prereleaseTag'],
        control: 'switch',
        label: 'field.releasePrerelease',
      },
      {
        group: 'git',
        path: ['gitGuard', 'enabled'],
        control: 'switch',
        label: 'field.gitEnabled',
        hint: 'hint.gitEnabled',
      },
      ...GIT_POLICIES.map((policy) => ({
        group: 'git',
        path: ['gitGuard', policy],
        control: 'segments',
        options: POLICY_OPTIONS,
        label: `policy.${policy}`,
      })),
      {
        group: 'git',
        path: ['gitGuard', 'rememberApproved'],
        control: 'switch',
        label: 'field.rememberApproved',
        hint: 'hint.rememberApproved',
      },
      {
        group: 'outward',
        path: ['outwardGuard', 'enabled'],
        control: 'switch',
        label: 'field.outwardEnabled',
        hint: 'hint.outward',
      },
      ...OUTWARD_POLICIES.map((policy) => ({
        group: 'outward',
        path: ['outwardGuard', policy],
        control: 'segments',
        options: POLICY_OPTIONS,
        label: `outward.${policy}`,
      })),
      {
        group: 'command',
        path: ['commandGuard', 'enabled'],
        control: 'switch',
        label: 'field.commandEnabled',
        hint: 'hint.commandEnabled',
      },
      {
        group: 'command',
        path: ['commandGuard', 'dangerousShell'],
        control: 'segments',
        label: 'field.dangerousShell',
        options: POLICY_OPTIONS,
      },
      {
        group: 'files',
        path: ['fileGuard', 'enabled'],
        control: 'switch',
        label: 'field.fileEnabled',
        hint: 'hint.fileEnabled',
      },
      {
        group: 'files',
        path: ['secretGuard', 'enabled'],
        control: 'switch',
        label: 'field.secretEnabled',
        hint: 'hint.secretEnabled',
      },
      {
        group: 'files',
        path: ['secretGuard', 'genericHighEntropy'],
        control: 'switch',
        label: 'field.genericHighEntropy',
        hint: 'hint.genericHighEntropy',
      },
      {
        group: 'audit',
        path: ['audit', 'enabled'],
        control: 'switch',
        label: 'field.auditEnabled',
        hint: 'hint.auditEnabled',
      },
    ]
    // Read-only projection of the fields the profile file owns. Every row here
    // is something a check or the release tag actually reads: the panel would
    // otherwise show a value and leave the reader guessing whether it acts.
    const ADVANCED = [
      { path: ['codePaths'], label: 'advanced.codePaths' },
      { path: ['docs', 'docsDir'], label: 'advanced.docsDir' },
      { path: ['docs', 'changelog'], label: 'advanced.changelog' },
      { path: ['docs', 'exclude'], label: 'advanced.exclude' },
      { path: ['releaseCheck', 'versionPattern'], label: 'advanced.versionPattern' },
      { path: ['docs', 'mirrors'], label: 'advanced.mirrors' },
      { path: ['audit', 'path'], label: 'advanced.auditPath' },
    ]
    // Fields whose value the Host would reject as written. A staged value that
    // fails here never becomes an operation, which is what disables Save.
    const VALIDATORS = {
      'commitCheck.subjectMaxLength': (value) => Number.isInteger(value) && value >= 1,
    }
    // Control → the switch it depends on. A guard's own `enabled` off means the
    // policies under it are read by nobody, so the page says so rather than
    // leaving live-looking controls that change nothing. This is the mapping the
    // panel used to lack: turning off `fileGuard` left its list bright and its
    // meaning unchanged.
    const DEPENDENTS = {
      mode: [
        'enableOwnTrigger',
        'commitCheck.enabled',
        'docsCheck.enabled',
        'releaseCheck.semver',
        'releaseCheck.changelog',
        'releaseCheck.changelogCategories',
        'releaseCheck.prereleaseTag',
        'rules.requireChangelogOnFeat',
        'docsCheck.requireReadmeOnConfig',
        'gitGuard.enabled',
        'outwardGuard.enabled',
        'commandGuard.enabled',
        'fileGuard.enabled',
        'secretGuard.enabled',
        'audit.enabled',
      ],
      'commitCheck.enabled': [
        'commitCheck.onFailure',
        'commitCheck.types',
        'commitCheck.requireScope',
        'commitCheck.subjectMaxLength',
      ],
      'docsCheck.enabled': ['rules.requireChangelogOnFeat', 'docsCheck.requireReadmeOnConfig'],
      'gitGuard.enabled': [
        'gitGuard.forcePush',
        'gitGuard.hardReset',
        'gitGuard.rebase',
        'gitGuard.amend',
        'gitGuard.branchDelete',
        'gitGuard.cleanForce',
        'gitGuard.checkoutDiscard',
        'gitGuard.noVerify',
        'gitGuard.rememberApproved',
      ],
      'outwardGuard.enabled': [
        'outwardGuard.push',
        'outwardGuard.tag',
        'outwardGuard.pullRequest',
        'outwardGuard.issue',
        'outwardGuard.publish',
      ],
      'commandGuard.enabled': ['commandGuard.dangerousShell'],
      'secretGuard.enabled': ['secretGuard.genericHighEntropy'],
    }
    /** The switch each dependent control answers to, keyed by the dependent's path. */
    const MASTERS = new Map()
    for (const [master, dependents] of Object.entries(DEPENDENTS)) {
      for (const path of dependents) if (!MASTERS.has(path)) MASTERS.set(path, master)
    }
    /**
     * The value that means "this master switch is on", per master path.
     *
     * A boolean switch is on at `true`, but `mode` is a two-value union whose on
     * value is the string `on`. Comparing every master against `true` marked
     * every field under `mode` as not in effect even while the plugin was on.
     */
    const MASTER_ON = new Map()
    for (const spec of FIELDS) {
      const key = spec.path.join('.')
      if (DEPENDENTS[key] === undefined) continue
      // `on` exists only on a switch spec; a boolean switch omits it and is on
      // at `true`.
      MASTER_ON.set(key, 'on' in spec && spec.on !== undefined ? spec.on : true)
    }

    const keyOf = (path) => path.join('.')
    const readPath = (value, path) => {
      let current = value
      for (const key of path) {
        if (current === null || typeof current !== 'object') return undefined
        current = current[key]
      }
      return current
    }
    const hasPath = (value, path) => {
      let current = value
      for (const key of path) {
        if (current === null || typeof current !== 'object') return false
        if (!Object.prototype.hasOwnProperty.call(current, key)) return false
        current = current[key]
      }
      return true
    }
    const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right)
    // `auto` means "follow this machine's own language", so the panel has to say
    // which language that turned out to be. The Host half resolves it inside the
    // node process (`src/i18n.ts`); the panel can only ask the browser, which
    // runs on the same machine. Both read `Intl`, map a `zh` prefix to `zh-CN`
    // and everything else to `en-US` — the same rule, so they agree.
    const machineLocale = () => {
      let tag = 'en-US'
      try {
        tag = Intl.DateTimeFormat().resolvedOptions().locale
      } catch {
        // An engine without `Intl` keeps the fallback above.
      }
      return { tag, locale: tag.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US' }
    }

    /**
     * The save model of the official `SettingsForm`: staged edits, one Save, one
     * Cancel that drops the draft, and a draft that survives a rejected write.
     * Reads and writes stay with the controller the `configForms` service handed
     * us — this class adds no persistence of its own.
     */
    class DraftForm {
      constructor(scope) {
        this.scope = scope
        this.staged = new Map()
        this.listeners = new Set()
        this.baseline = undefined
        this.saving = false
        this.failed = false
        this.conflicted = false
        this.saved = false
        this.snapshot = undefined
        this.off = scope.subscribe(() => {
          this.invalidate()
        })
      }
      getSnapshot() {
        if (this.snapshot === undefined) this.snapshot = this.build()
        return this.snapshot
      }
      subscribe(listener) {
        this.listeners.add(listener)
        return () => {
          this.listeners.delete(listener)
        }
      }
      invalidate() {
        this.snapshot = undefined
        for (const listener of this.listeners) listener()
      }
      build() {
        const state = this.scope.getSnapshot()
        const value = state.value
        const staged = this.staged
        /** The effective value of a path, staged entries included. */
        const effective = (path) => {
          const entry = staged.get(keyOf(path))
          if (entry === undefined) return readPath(value, path)
          if (entry.clear === true) return readPath(state.base, path)
          return entry.value
        }
        return {
          status: state.status,
          writable: state.writable === true,
          dirty: staged.size > 0,
          invalid: [...staged.values()].some((entry) => entry.invalid === true),
          saving: this.saving,
          failed: this.failed,
          conflicted: this.conflicted,
          saved: this.saved,
          read: effective,
          invalidAt: (path) => {
            const entry = staged.get(keyOf(path))
            return entry !== undefined && entry.invalid === true
          },
          // A staged clear is the draft of "the file no longer says this", so the
          // badge and its reset button go with it — otherwise the control shows
          // the inherited value while the field still claims an override.
          overridden: (path) => {
            const entry = staged.get(keyOf(path))
            if (entry !== undefined && entry.clear === true) return false
            return hasPath(state.user, path)
          },
          /**
           * Whether a control is read by anybody right now.
           *
           * A policy under a guard whose master switch is off is never consulted,
           * so the page has to say so: a bright control that changes nothing is
           * how a user comes to believe a rule is still in force. The staged value
           * counts, so turning a master off marks its dependents at once.
           */
          live: (path) => {
            const master = MASTERS.get(keyOf(path))
            if (master === undefined) return true
            const on = MASTER_ON.get(master)
            return effective(master.split('.')) === (on === undefined ? true : on)
          },
        }
      }
      /** Stage an edit, or drop the entry when it restates the stored value. */
      edit(path, value) {
        const key = keyOf(path)
        const validate = VALIDATORS[key]
        const invalid = validate !== undefined && !validate(value)
        // Any new edit invalidates the "saved" note: what the page shows no
        // longer matches what the profile holds.
        this.saved = false
        const state = this.scope.getSnapshot()
        // Choosing the inherited value is how a user says "stop overriding this".
        // The platform marks a field overridden by the user layer *carrying* the
        // entry, not by its value, so writing the default back would leave the
        // badge and a reset button that resets nothing. Clear the entry instead:
        // same visible value, one fewer thing the profile says.
        if (!invalid && sameValue(readPath(state.base, path), value)) {
          if (!hasPath(state.user, path)) {
            if (this.staged.delete(key)) this.invalidate()
            return
          }
          this.baseline ??= state
          this.staged.set(key, { path, clear: true })
          this.invalidate()
          return
        }
        if (!invalid && sameValue(readPath(state.value, path), value)) {
          if (this.staged.delete(key)) this.invalidate()
          return
        }
        this.baseline ??= state
        this.staged.set(key, { path, value, invalid })
        this.invalidate()
      }
      /** Stage "back to the inherited value" for a field the file overrides. */
      clear(path) {
        this.baseline ??= this.scope.getSnapshot()
        this.saved = false
        this.staged.set(keyOf(path), { path, clear: true })
        this.invalidate()
      }
      discard() {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.baseline = undefined
        this.failed = false
        this.saved = false
        this.invalidate()
      }
      /**
       * Drop the "saved" note. The flag has to live on this instance because the
       * instance is the only channel the bound component reads, but the note
       * belongs to one visit: the settings dialog unmounts the section when it
       * closes, so a note kept here would be replayed the next time the user
       * opens the page. The section therefore acknowledges it once per mount.
       */
      acknowledgeSaved() {
        if (!this.saved) return
        this.saved = false
        this.invalidate()
      }
      async save() {
        const snapshot = this.getSnapshot()
        if (!snapshot.dirty || snapshot.invalid || this.saving) return
        const ops = []
        for (const entry of this.staged.values()) {
          if (entry.invalid === true) continue
          ops.push(
            entry.clear === true
              ? { op: 'unset', path: entry.path }
              : { op: 'set', path: entry.path, value: entry.value },
          )
        }
        if (ops.length === 0) return
        this.saving = true
        this.invalidate()
        const revision = this.baseline === undefined ? undefined : this.baseline.revision
        let landed
        try {
          landed = await this.scope.mutate(ops, revision)
        } catch {
          landed = false
        }
        this.saving = false
        if (landed) {
          this.staged.clear()
          this.baseline = undefined
          // A retry after a rejected batch has to clear the failure, or the
          // panel would keep claiming the save failed.
          this.failed = false
          this.conflicted = false
          // The official SettingsForm only ever reports failure, so a plain
          // successful save leaves no visible trace: the button just stops
          // being disabled, which on a form this long reads as "nothing
          // happened". The note is this panel's deliberate addition.
          this.saved = true
        } else {
          // A `false` answer is not always an error. When the batch carried the
          // revision this panel read and the work still did not land, someone
          // else wrote in between — the draft is intact and reloading shows both.
          // Telling that apart from "the write failed" is what keeps the user
          // from retrying a batch that cannot land until they look.
          this.conflicted = revision !== undefined && this.scope.getSnapshot().revision !== revision
          this.failed = !this.conflicted
          this.saved = false
        }
        this.invalidate()
      }
      /** Stage "back to the inherited value" for every field the file overrides. */
      resetAll() {
        const state = this.scope.getSnapshot()
        this.saved = false
        this.failed = false
        this.conflicted = false
        // A field the user layer carries is one the panel can unset; the draft
        // then previews the inherited value for all of them at once.
        for (const spec of FIELDS) {
          if (hasPath(state.user, spec.path))
            this.staged.set(keyOf(spec.path), {
              path: spec.path,
              clear: true,
            })
        }
        for (const entry of ADVANCED) {
          if (hasPath(state.user, entry.path))
            this.staged.set(keyOf(entry.path), {
              path: entry.path,
              clear: true,
            })
        }
        if (this.staged.size > 0) this.baseline ??= state
        this.invalidate()
      }
      /**
       * The actions a bound component calls, as plain props. The `useForm` hook
       * only ever yields `getSnapshot()`, so an action left on this instance is
       * unreachable from the markup — the official `SettingsFormModel` hands its
       * actions out separately for exactly this reason.
       */
      actions() {
        return {
          edit: (path, value) => this.edit(path, value),
          clear: (path) => this.clear(path),
          discard: () => this.discard(),
          resetAll: () => this.resetAll(),
          save: () => this.save(),
          acknowledgeSaved: () => this.acknowledgeSaved(),
        }
      }
      dispose() {
        if (this.off !== undefined) this.off()
        this.off = undefined
        this.listeners.clear()
      }
    }

    /** The one action that leaves the panel: hand the profile file to the editor. */
    class DocumentAction {
      constructor(scope) {
        this.scope = scope
        this.state = { opening: false, error: null }
        this.listeners = new Set()
      }
      getSnapshot() {
        return this.state
      }
      subscribe(listener) {
        this.listeners.add(listener)
        return () => {
          this.listeners.delete(listener)
        }
      }
      update(patch) {
        this.state = { ...this.state, ...patch }
        for (const listener of this.listeners) listener()
      }
      async open() {
        if (this.state.opening) return
        this.update({ opening: true, error: null })
        try {
          const result = await this.scope.openSettingsDocument()
          if (result !== undefined && result !== null && result.ok !== true) {
            this.update({ error: (result.error && result.error.message) || 'failed' })
          }
        } catch (error) {
          this.update({ error: error instanceof Error ? error.message : String(error) })
        } finally {
          this.update({ opening: false })
        }
      }
    }

    function Switch({ checked, onChange, label, disabled }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dsw-dev-workflow-switch',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          disabled,
          onClick: () => onChange(!checked),
        },
        h('span', { className: 'dsw-dev-workflow-switchThumb' }),
      )
    }

    // Copy of the primitive's SegmentedControl, including the roving tabindex
    // and the arrow/Home/End walk: those are the behaviours a keyboard user
    // depends on, so they come along with the markup.
    function Segments({ id, value, options, onChange, label, disabled }) {
      const index = Math.max(
        0,
        options.findIndex((option) => option.value === value),
      )
      const nodes = React.useRef([])
      const onKeyDown = (event) => {
        const enabled = [...options.keys()].filter(
          (position) => options[position].disabled !== true,
        )
        if (enabled.length === 0) return
        const current = enabled.indexOf(index)
        let next
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
          next = enabled[(current + 1) % enabled.length]
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
          next = enabled[(current - 1 + enabled.length) % enabled.length]
        else if (event.key === 'Home') next = enabled[0]
        else if (event.key === 'End') next = enabled[enabled.length - 1]
        else return
        event.preventDefault()
        const target = options[next]
        if (target.disabled === true) return
        onChange(target.value)
        const node = nodes.current[next]
        if (node !== undefined && node !== null) node.focus()
      }
      return h(
        'div',
        {
          className: 'dsw-dev-workflow-segments',
          role: 'tablist',
          'aria-label': label,
          'data-disabled': disabled === true ? '' : undefined,
          style: {
            '--dsw-dev-workflow-segment-count': String(options.length),
            '--dsw-dev-workflow-segment-index': String(index),
          },
          onKeyDown,
        },
        h('span', { className: 'dsw-dev-workflow-segmentIndicator', 'aria-hidden': true }),
        options.map((option, position) =>
          h(
            'button',
            {
              key: option.value,
              ref: (node) => {
                nodes.current[position] = node
              },
              id: `${id}-${option.value}`,
              type: 'button',
              className: 'dsw-dev-workflow-segment',
              role: 'tab',
              'aria-selected': option.value === value,
              tabIndex: option.value === value ? 0 : -1,
              disabled: disabled === true || option.disabled === true,
              onClick: () => onChange(option.value),
            },
            option.text,
          ),
        ),
      )
    }

    function NumberInput({ id, value, invalid, disabled, onChange }) {
      const [text, setText] = useState(() => (value === undefined ? '' : String(value)))
      // Re-seed from the stored value while the field is not carrying a draft of
      // its own, so a reload after a failed write is visible.
      useEffect(() => {
        setText(value === undefined ? '' : String(value))
      }, [value])
      return h('input', {
        id,
        className: 'dsw-dev-workflow-number',
        type: 'text',
        inputMode: 'numeric',
        'aria-invalid': invalid,
        disabled,
        value: text,
        onChange: (event) => {
          const next = event.target.value
          setText(next)
          const parsed = Number(next)
          onChange(next.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed)
        },
      })
    }

    function formatValue(value) {
      if (value === undefined || value === null) return ''
      if (Array.isArray(value)) {
        const parts = value.map((item) => formatValue(item)).filter((part) => part !== '')
        return parts.length === 0 ? '' : parts.join(' \u00b7 ')
      }
      if (typeof value === 'object') {
        const parts = Object.entries(value).map(([key, item]) => `${key}: ${formatValue(item)}`)
        return parts.join(' \u00b7 ')
      }
      return String(value)
    }

    function Field({ spec, form, actions, t }) {
      const id = `dsw-dev-workflow-${keyOf(spec.path)}`
      const value = form.read(spec.path)
      const invalid = form.invalidAt(spec.path)
      const label = t(spec.label)
      // A dependent of a master switch that is off: the control still shows its
      // value (the file keeps it) but nothing reads it, so it is marked rather
      // than hidden — hiding it would make the setting look lost.
      const live = form.live(spec.path)
      const disabled = !form.writable || !live
      // Only `auto` needs the explanation; an explicit choice already names the
      // language it selects.
      const machine = spec.note !== undefined && value === 'auto' ? machineLocale() : undefined
      const labelNode = h(
        'label',
        {
          className: 'dsw-dev-workflow-fieldLabel',
          htmlFor: spec.control === 'switch' ? undefined : id,
        },
        label,
      )
      let control
      if (spec.control === 'switch') {
        // `mode` is a two-value union, not a boolean, so a switch has to be told
        // which values it toggles between; a boolean field just uses true/false.
        const on = spec.on === undefined ? true : spec.on
        const off = spec.off === undefined ? false : spec.off
        control = h(Switch, {
          checked: value === on,
          disabled,
          label,
          onChange: (next) => actions.edit(spec.path, next === true ? on : off),
        })
      } else if (spec.control === 'segments') {
        const options = spec.options.map((option) =>
          typeof option === 'string'
            ? { value: option, text: t(`value.${option}`) }
            : { value: option.value, text: t(option.label) },
        )
        control = h(Segments, {
          id,
          value,
          options,
          label,
          disabled,
          onChange: (next) => actions.edit(spec.path, next),
        })
      } else if (spec.control === 'number') {
        control = h(NumberInput, {
          id,
          value,
          invalid,
          disabled,
          onChange: (next) => actions.edit(spec.path, next),
        })
      } else {
        const selected = Array.isArray(value) ? value : []
        control = h(
          'div',
          { className: 'dsw-dev-workflow-checks', role: 'group', 'aria-label': label },
          selected.concat(COMMIT_TYPES.filter((type) => !selected.includes(type))).map((type) =>
            h(
              'label',
              { key: type, className: 'dsw-dev-workflow-check' },
              h('input', {
                type: 'checkbox',
                checked: selected.includes(type),
                disabled,
                onChange: () =>
                  actions.edit(
                    spec.path,
                    selected.includes(type)
                      ? selected.filter((item) => item !== type)
                      : [...selected, type],
                  ),
              }),
              h('span', null, type),
            ),
          ),
        )
      }
      const head = h(
        'div',
        { className: 'dsw-dev-workflow-fieldHead' },
        labelNode,
        // Two badges can sit side by side and mean different things: "the file
        // overrides this" and "nothing reads this right now". The second is the
        // one that keeps a live-looking control from lying.
        !live
          ? h(
              'span',
              { className: 'dsw-dev-workflow-badge', 'data-tone': 'muted' },
              t('action.inactive'),
            )
          : null,
        form.overridden(spec.path)
          ? h(
              React.Fragment,
              null,
              h('span', { className: 'dsw-dev-workflow-badge' }, t('action.overridden')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsw-dev-workflow-reset',
                  disabled,
                  onClick: () => actions.clear(spec.path),
                },
                t('action.reset'),
              ),
            )
          : null,
      )
      const body = h('div', { className: 'dsw-dev-workflow-fieldBody' }, control)
      // A switch reads as a row — its label on the left, the toggle on the
      // right, which is the row shape every settings page uses. Controls the
      // user reads before typing (text, segments, checkboxes) keep the label
      // above them.
      const inline = spec.control === 'switch'
      return h(
        'div',
        {
          className: 'dsw-dev-workflow-field',
          'data-path': keyOf(spec.path),
          'data-inline': inline ? '' : undefined,
        },
        inline
          ? h('div', { className: 'dsw-dev-workflow-fieldRow' }, head, body)
          : h(React.Fragment, null, head, body),
        invalid ? h('p', { className: 'dsw-dev-workflow-invalid' }, t('invalid.number')) : null,
        machine === undefined
          ? null
          : h(
              'p',
              { className: 'dsw-dev-workflow-hint', 'data-note': spec.note },
              t(spec.note, { locale: t(`value.${machine.locale}`), tag: machine.tag }),
            ),
        spec.hint === undefined
          ? null
          : h('p', { className: 'dsw-dev-workflow-hint' }, t(spec.hint)),
      )
    }

    function Group({ group, open, onToggle, t, children }) {
      return h(
        'div',
        { className: 'dsw-dev-workflow-group' },
        h(
          'button',
          {
            type: 'button',
            className: 'dsw-dev-workflow-groupRow',
            'aria-expanded': open,
            onClick: onToggle,
          },
          h(
            'svg',
            {
              className: 'dsw-dev-workflow-groupChevron',
              viewBox: '0 0 16 16',
              'aria-hidden': true,
              focusable: false,
            },
            h('path', {
              d: 'M6 3.5 10.5 8 6 12.5',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.5,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }),
          ),
          h('span', { className: 'dsw-dev-workflow-groupTitle' }, t(`group.${group.key}`)),
        ),
        open ? h('div', { className: 'dsw-dev-workflow-groupBody' }, children) : null,
      )
    }

    function Advanced({ form, document: doc, t, openDocument, documentAvailable }) {
      return h(
        'div',
        { className: 'dsw-dev-workflow-advanced' },
        h('p', { className: 'dsw-dev-workflow-hint' }, t('advanced.note')),
        ADVANCED.map((entry) =>
          h(
            'div',
            { key: keyOf(entry.path), className: 'dsw-dev-workflow-advancedRow' },
            h('span', { className: 'dsw-dev-workflow-advancedKey' }, t(entry.label)),
            h(
              'code',
              { className: 'dsw-dev-workflow-advancedValue' },
              formatValue(form.read(entry.path)) || t('advanced.empty'),
            ),
          ),
        ),
        documentAvailable
          ? h(
              'div',
              { className: 'dsw-dev-workflow-fieldBody' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsw-dev-workflow-button',
                  disabled: doc.opening,
                  onClick: () => {
                    openDocument()
                  },
                },
                t('advanced.open'),
              ),
              doc.error === null
                ? null
                : h('p', { className: 'dsw-dev-workflow-invalid' }, doc.error),
            )
          : null,
      )
    }

    function Section({ useForm, useDocument, t, openDocument, documentAvailable, actions }) {
      const form = useForm((snapshot) => snapshot)
      const document = useDocument((snapshot) => snapshot)
      const [open, setOpen] = useState(() => {
        const initial = {}
        for (const group of GROUPS) initial[group.key] = group.open
        return initial
      })
      // The note belongs to this visit: the dialog unmounts the section when it
      // closes, and without this the flag on the long-lived form would replay
      // the note every time the page is opened again.
      useEffect(
        () => () => {
          actions.acknowledgeSaved()
        },
        [],
      )
      if (form.status !== 'ready') {
        return h(
          'section',
          { className: 'dsw-dev-workflow-section' },
          h('h2', { className: 'dsw-dev-workflow-title' }, t('title')),
          h('p', { className: 'dsw-dev-workflow-status', role: 'status' }, t('action.unavailable')),
        )
      }
      const blocked = !form.dirty || form.invalid || form.saving
      return h(
        'section',
        { className: 'dsw-dev-workflow-section' },
        h('h2', { className: 'dsw-dev-workflow-title' }, t('title')),
        h('p', { className: 'dsw-dev-workflow-intro' }, t('intro')),
        form.writable
          ? null
          : h(
              'p',
              { className: 'dsw-dev-workflow-status', role: 'status' },
              t('action.unavailable'),
            ),
        GROUPS.map((group) =>
          h(
            Group,
            {
              key: group.key,
              group,
              open: open[group.key] === true,
              t,
              onToggle: () =>
                setOpen((current) => ({ ...current, [group.key]: current[group.key] !== true })),
            },
            group.key === 'advanced'
              ? h(Advanced, { form, document, t, openDocument, documentAvailable })
              : FIELDS.filter((spec) => spec.group === group.key).map((spec) =>
                  h(Field, { key: keyOf(spec.path), spec, form, actions, t }),
                ),
          ),
        ),
        h(
          'div',
          { className: 'dsw-dev-workflow-actions' },
          form.failed
            ? h(
                'p',
                { className: 'dsw-dev-workflow-note', 'data-tone': 'error', role: 'status' },
                t('action.failed'),
              )
            : null,
          // A revision conflict and a failed write are different events with
          // different next steps, so they cannot share one sentence: the first
          // says to reload and compare, the second says to try again.
          form.conflicted
            ? h(
                'p',
                { className: 'dsw-dev-workflow-note', 'data-tone': 'error', role: 'status' },
                t('action.conflict'),
              )
            : null,
          form.saved
            ? h(
                'p',
                { className: 'dsw-dev-workflow-note', 'data-tone': 'success', role: 'status' },
                t('action.saved'),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dsw-dev-workflow-button',
              disabled: !form.dirty || form.saving,
              onClick: () => actions.resetAll(),
            },
            t('action.resetAll'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsw-dev-workflow-button',
              disabled: !form.dirty || form.saving,
              onClick: () => actions.discard(),
            },
            t('action.discard'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsw-dev-workflow-button',
              'data-variant': 'primary',
              disabled: blocked,
              onClick: () => actions.save(),
            },
            form.saving ? t('action.saving') : t('action.save'),
          ),
        ),
      )
    }

    const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.settings']

    /**
     * Annotated against the Host's own `Context` on purpose: the augmentations
     * from the client packages are what make `configForms`, `locale`, `remote`
     * and `slots` real members here. Drop the annotation and the body silently
     * becomes unchecked `any`, which is how a renamed host method survives
     * until a user opens a blank panel.
     *
     * @param {import('@deepseek-ai/cordis').Context} ctx
     */
    function apply(ctx) {
      const t = ctx.locale.bind(LOCALE)
      ctx.effect(
        () => ctx.locale.register(LOCALE, { en: EN, zh: ZH }),
        'dsh-dev-workflow: panel dictionaries',
      )
      const form = new DraftForm(ctx.configForms.get(NAMESPACE))
      const document = new DocumentAction(ctx.remote.settings)
      ctx.effect(
        () => () => {
          form.dispose()
        },
        'dsh-dev-workflow: panel draft',
      )
      // The navigation entry appears only once the Host serves the namespace:
      // a card for a namespace that is not there could not read or write
      // anything. Also the official shape (`whileServed` + `slots.inject`).
      // `hooks` carries observable sources only — the bound component receives
      // `useForm`/`useDocument` selectors, which can read a snapshot but never
      // reach the instance. The actions therefore ride the face as ordinary
      // props, the way the official settings pages do it.
      const face = () => ({
        hooks: { form, document },
        actions: form.actions(),
        openDocument: () => {
          void document.open()
        },
        documentAvailable: ctx.remote.$host.isLoopback === true,
      })
      ctx.effect(
        () =>
          ctx.configForms.whileServed([NAMESPACE], () =>
            ctx.slots.inject(SLOT, () =>
              ctx.slots.register(
                {
                  name: SLOT,
                  id: NAMESPACE,
                  order: 50,
                  locale: LOCALE,
                  label: () => t('nav'),
                  inject: face,
                },
                Section,
              ),
            ),
          ),
        'dsh-dev-workflow: settings section',
      )
    }

    // Exported for the tests, and only for them: the tables above are the one
    // description of what the page offers, so a test can compare the panel
    // against the Host schema instead of restating the field list.
    const panel = {
      namespace: NAMESPACE,
      locale: LOCALE,
      slot: SLOT,
      order: 50,
      groups: GROUPS,
      fields: FIELDS,
      advanced: ADVANCED,
      commitTypes: COMMIT_TYPES,
      gitPolicies: GIT_POLICIES,
      dictionaries: { en: EN, zh: ZH },
      css: CSS,
    }

    return { apply, inject, panel }
  },
})
