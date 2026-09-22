# Changelog

`dsh-git-panel` 的版本变更记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- **自动生成提交信息**（写操作条 · 提交信息输入框右端内部新增图标按钮）：
  - 按钮图标取自插件统一的 `icon()` 图标库，语义为 Lucide「sparkles」（四角星 + 霰点，
    读作「由模型生成」，而不是容易被读成收藏 / 星标的通用五角星），16×16 网格、线宽 1.5、
    `currentColor` 着色，深浅主题与悬停态自动继承；
  - 点击后读取**暂存区（`git diff --cached`）**的变更内容，连同仓库最近 5 条提交的主题
    一起交给当前默认模型（`agentDefaultModel.currentSelection()` 选定的 provider/model），
    生成一条符合本仓库语言与提交前缀习惯的信息并回填输入框；
  - 输入框已有文字时，生成结果直接覆盖；
  - **异常处理**：暂存区为空时返回 `empty-stage`，界面给出「请先暂存改动」的明确提示，
    不触发生成、不改动输入框内容；生成失败（无默认模型 / 模型报错 / 空输出）时给出失败
    提示，**输入框里已有的输入原样保留**，绝不因一次失败抹掉手写内容；
  - 生成期间按钮转为转圈 spinner 并禁用，与其它写操作一样防重入。

- **提交信息输入框改为自适应多行（textarea）**：
  - 生成的信息常带正文（subject + blank line + body），单行 input 会让长文本横向滚动；
    改为 `textarea` 按 `scrollHeight` 自动撑高，长信息换行显示；
  - 内容多长都不会出现纵向滚动条：高度按 `scrollHeight` 自适应（**含边框补偿**），
    需要时把框拖高即可；
  - 右下角保留浏览器原生的拖拽把手（`resize:vertical`）——**用户拖过高度后自适应即停手**，
    不会在下次输入或回填时把用户设定的高度冲掉（输入框清空时交还自适应）；
  - 安全网 `max-height:40vh`：异常长的模型输出在框内滚动，不会把整行按钮挤出面板；
  - `Enter` 仍是提交、`Shift+Enter` 换行，多行信息的正文可以正常书写。

- **修复：提交信息框的滚动条一直挂着**（连同上一版一起修）：
  - 根因两处叠加：`.dsh-gp *` 的 `box-sizing:border-box` 下 `height = scrollHeight`
    少了 2px 边框，内容区恒短于内容 → 连**一行短文本**都持续溢出；再叠上
    `max-height:132px` 封顶，长信息必然出现滚动条。
  - 现已按 `scrollHeight + (offsetHeight - clientHeight)` 补偿边框，并把封顶放宽到
    `max-height:40vh`；实测单行 / 三行 / 六行内容均无滚动条。

- **变更文件列表新增批量暂存操作**：
  - 「已暂存的更改」分组头右侧新增**取消全部暂存**按钮，「更改」分组头右侧新增**全部暂存**按钮；
    放在各自分组头内，语义与作用范围一目了然，且不额外占用一行高度；
  - 复用既有的单文件接口（`stageFile` / `unstageFile`）**串行**执行——git 的 index 自带锁，
    并发 `git add` 会互相争锁报错；串行既正确，又不需要新增宿主批量路由或任何依赖；
  - 失败即停并**如实报告已完成的数量**（区分「部分成功」与「全部成功」），且失败时同样刷新
    变更列表，因为前面已成功的部分已经改动了 index。

### Notes
- 模型路由通过 `ctx.get('llm')` 与 `ctx.get('agentDefaultModel')` **按需获取**，两者都不是
  本插件的必需依赖：缺少它们的部署仍能正常加载，只是这个按钮会返回 `no-model` 并提示
  去设置里选默认模型。
- 新增宿主路由 `POST /git-panel/generate-commit-message`，与其它路由一样受工作区门禁约束。
- 新增 `src/client/batch-stage.ts`（批量执行序，独立成模块以便在无 React 环境自检）
  与两个自检脚本 `scripts/test-generate.ts`、`scripts/test-batch-stage.ts`。

## [0.1.19] - 2026-09-16

### Fixed
- **工作区启动卡与官方卡片样式不一致**：
  - 根因：`sidebarRightTabs.register` 的 `guide` 只提供了 `title`（3 个字段），
    而官方 provider（`sidebar-files` / `sidebar-terminal`）使用的是
    `id` + `order` + `title` + `description` + `icon` 五件套；
  - 缺少 `description` 导致卡片只剩一行标题、主副行距与整体留白都与官方卡片对不齐；
  - 缺少 `icon` 导致左侧图标位空缺，卡片视觉重心偏移；
  - 现按官方契约补齐五件套，并新增 26px 的 `GitGuideIcon`（`{ size, className }` 契约，
    尺寸由官方卡片注入、颜色继承 `currentColor` 以跟随主题与悬停态）；
  - 新增三语副标题文案 `guide.gitDescription`（中/英/西）。
- 修复后「Git 版本控制与提交图谱」卡片与「工作区文件」「新建终端」在宽度、高度、
  圆角、边框、内间距、图标尺寸、主副标题字号与行高上完全一致。

> 说明：终端卡右侧的 `▾` 展开箭头是该 provider 独有的 shell 选择功能（可选 bash/zsh/fish），
> 本插件没有对应能力，因此不提供该箭头——这是功能差异，非样式差异。

## [0.1.18] - 2026-09-16

### Security
- **移除文档截图中的真实仓库信息**（0.1.17 的截图直接取自真实项目，泄露了内部项目名、分支名与提交信息）：
  - 重写 `docs/preview.html` 为全虚构示例（示例仓库 `example-shop`、虚构分支与提交、虚构代码文件）；
  - 新增 conflict / diff / tree 三个渲染场景，用 Chrome headless 渲染该页面重截全部 7 张功能图；
  - 三语 README 截图引用统一追加 `?v=0.1.18`；
  - 已验证 docs 与 README 中不含任何真实仓库/分支/账号信息。
- 建议安装 `>=0.1.18`；`0.1.17` 已在 npm 标记为 deprecated。

## [0.1.17] - 2026-09-16

### Added
- **统一图标系统 `src/client/icons.tsx`**：
  - 新增全插件唯一的图标库，统一 16×16 网格、线宽 1.5、圆角端点/连接、`currentColor` 着色；
  - 覆盖刷新、文件、双栏/单栏、编辑、冲突、换行、折叠、代码、加减、保存、勾选、关闭、复制、对话、撤销、上下箭头、同步、抓取、删除、钥匙、灯泡、分支、双保留、信息、列表、外链等 29 个图标；
  - 根除此前 **emoji（📋💬↩）／字符字形（≡ + − ✓ ↑↓）／手写 SVG 三种风格混用** 导致的视觉割裂与跨平台字宽错位。
- **即时 tooltip `src/client/tooltip.ts`**：
  - 自绘浮层替代原生 `title`（原生有约 1 秒延迟且样式不可控，在窄侧栏里用户根本来不及看到）；
  - 挂到 `document.body` 固定定位，永不被列表 `overflow:auto` 裁切，自动避让视口边缘；
  - 变更行操作按钮改为统一图标按钮 + 悬停即时提示。
- **操作进行中的 loading 反馈**：
  - 顶部不确定进度条（`dsh-gp-progress`）+ 转圈图标（`dsh-gp-spinner`）；
  - 新增 `pendingOp` 状态，精确只在被触发的入口上转圈（拉取/推送/同步/抓取/提交互不干扰）；
  - 状态跨面板实例保持在 `GLOBAL_GIT_BUSY_MAP`，切换会话再回来仍显示进行中。
- **「取消」按钮真正中止后台 git 进程**：
  - 新增宿主 `/git-panel/cancel` 路由与 `GitRunner.cancel()`，以及客户端 `api.cancel()`；
  - 此前点击「取消」只清界面状态，git 进程仍在后台跑到超时，表现为「一直卡住」。
- **宿主错误码翻译层 `tError()`**：
  - 宿主返回的 `error.code` 映射为本地化文案（中/英/西），未收录的 code 与 git 自身 stderr 原文保留；
  - 超时改用稳定机器可读标记 `E_TIMEOUT`，不再依赖中/英文案匹配。

### Changed
- **全插件文案多语言化**：移除所有硬编码中文与文案内装饰性 emoji，新增/迁移约 100 条 i18n 键（中 / 英 / 西三语齐全），
  涉及 `Panel.tsx`、`GitDiffView.tsx`、`index.ts`、`BranchChip.tsx`，以及宿主错误的界面呈现。
- **git 执行方式对齐 VS Code**（`extensions/git/src/git.ts`）：
  - 改用 `spawn` 且 `stdio[0]='ignore'`——git 拿不到 stdin，**永远无法交互式提问**，不会再卡在凭据提示；
  - 环境变量强制 `LANGUAGE/LC_ALL/LANG=en_US.UTF-8` 与 `GIT_PAGER=cat`，输出稳定可被程序解析；
  - 凭据**不再由插件接管**：默认完全交给系统凭据助手（macOS 上的 GCM），仅在用户主动保存过 `~/.git-credentials` 时才额外挂 git 原生 `store` 助手；
  - `HOME` 不再被硬编码为 Windows 路径（此前导致 macOS 上读不到 `~/.gitconfig`、`~/.ssh` 与凭据文件）。

### Fixed
- **macOS 上每次拉取都弹出钥匙串对话框并卡死**：根因是插件调用 git 时继承了全局 Git Credential Manager，
  且 `HOME` 被写成 Windows 路径使 git 读不到真实配置。现已彻底修掉（详见 Changed 中的执行方式对齐）。
- **凭据以明文写入仓库配置**：`set-credential` 曾把带密码的 URL 写进 `.git/config` 的 `remote.origin.url`
  与分支 `remote` 字段，`git remote -v` 即可看到明文。现已删除该行为，并收紧 `~/.git-credentials` 为 `0600`。
- **变更列表丢失「仅工作区修改」的文件**：客户端用 `/^(\S+)\s+/` 解析 porcelain，
  未暂存行的 X 位本身是空格（`" M path"`）导致整行被丢弃。现按 porcelain 固定宽度（XY + 空格 + 路径）解析。
- **「同步」按钮误触发放弃更改**：`runWrite('sync')` 缺少 sync 分支，会掉进最后的 `discardFile` 兜底（等同误删改动），已补上并移除 `as any`。
- **忙碌提示条内取消按钮样式错乱**：图标被强制 `display:block` 把文字挤到下一行，已改为行内并重构为紧凑按钮。
- **非交互凭据匹配失败**：显式关闭 `credential.useHttpPath`，避免按仓库路径精确匹配导致永远取不到凭据。

## [0.1.16] - 2026-09-12

### Fixed
- **彻底同步所有功能至 \src/\ TypeScript/TSX 源码中**：
  - 修复此前仅在 \lib/\ 产物热修而导致 \src/\ 源码缺失新特性的问题；
  - 源码现已完整包含：
    - \src/client/Panel.tsx\：分支右键菜单「⬇️ 拉取更新 (Pull)」与「🔄 抓取全部 (Fetch all)」、分支落后胶囊点击直接拉取、全局防重入锁 \GLOBAL_GIT_BUSY_MAP\、GitLab 凭据免终端原位保存弹窗表单；
    - \src/client/GitDiffView.tsx\：全景行号上下文冲突合并视图、未冲突区域折叠与展开、冲突卡片置顶首屏；
    - \src/host/git-service.ts\：原生子进程执行模式 \execFileNative\、环境变量完整注入、90秒超时兜底与 \.git/MERGE_MSG\ 自动读取；
    - \src/host/routes.ts\ & \src/client/api.ts\：\/git-panel/set-credential\ 原位凭据配置路由；
  - 源码支持使用 \
ode scripts/build.mjs\ 重新打包出 100% 对应的一致产物。
## [0.1.15] - 2026-09-12

### Docs
- **重绘 `docs/git-conflict-resolve.png`**（纯文档版本，无代码改动）：
  - 旧图仍是 0.1.13 时期的 `DSH_CONFLICT_DEMO.txt` 示例，**未反映** 0.1.14 推出的「全景行号上下文冲突合并视图」；
  - 新图按 0.1.14 的真实 UI 结构渲染：官方标签页 → 文件头（红色 `C` 标记 + 路径 + 编辑/官方预览/暂存/已同步）→ 折叠条 → 带上行号的上下文代码 → 红框冲突卡片（含三个一键动作 + 左右双栏）→ 下方上下文 → 折叠条；
  - 示例内容为虚构的 `src/utils/pricing/calculateTax.ts`（`feature/vat-v2` 分支），**不含任何真实业务代码**。
- **三语 README 补齐与更新**：
  - 西班牙语版本此前**缺失 3 张截图**（文件树改动标记、对比视图、冲突解决），现已补齐，与中/英文版本对齐；
  - 中/英文的冲突截图说明由旧的「逐块并排展示」更新为实际的全景上下文行为；
  - 冲突截图引用追加 `?v=0.1.15`，避免 GitHub Camo 继续返回旧图。
- 渲染方式：Chrome headless 加载插件真实 UI 结构与配色绘制（图标为矢量，示例为虚构代码）。

## [0.1.14] - 2026-09-12

### Added
- **免终端原位凭据保存（像 VS Code 一样傻瓜式配置）**：
  - 遇到私有企业 GitLab 缺少凭据或认证失败时，不再抛出冰冷终端指令，而是直接在面板内原位弹出优雅的账号密码配置卡片
  - 一键自动将已认证的 Basic Auth 嵌入至 remote url 并安全写入 `~/.git-credentials`，自动规避 GCM 的 OAuth 弹窗死锁
- **全景行号上下文冲突合并视图（首屏即是靶心）**：
  - 冲突卡片与紧邻前后 8 行完整代码直接坐落首屏正中央，无需手动滚动
  - 远端无关代码自动折叠为可展开条，行号精准无缝连贯
  - 优化每块冲突顶部的「✔ 采用当前更改」「✔ 采用传入更改」「✔ 两者都保留」操作，解决完一键保存写回磁盘
- **多语言情境感知 Prompt 智能引擎**：
  - 检测到冲突时，按钮自动切换为「💬 将冲突分析带入对话」，一键注入专业的冲突排查与保留分析指令
  - 无冲突时生成代码审查与规范 Commit Message 提示；全面自适应中文、英文、西班牙语三语
- **多处极速操作直达**：
  - 本地分支右侧的落后（`↓101`）胶囊徽章支持直接鼠标点击，一键快速拉取更新
  - 右键菜单新增「⬇️ 拉取更新 (Pull)」与「🔄 抓取全部 (Fetch all)」，支持严格的并发防重入锁与「✕ 取消」操作

### Fixed
- **彻底根除 Windows 下 `subprocess-local: Windows Job runner exited with exit code 1` 异常**：
  - 放弃脆弱的 DSH `ctx.subprocess.spawn` Job Object 驱动层，改用 Node.js 官方原生的 `child_process.execFile` 直连调度 git，性能与稳定性大幅提升
- **修复一键同步（Sync）强制带 `--rebase` 导致的人工变基冲突**：
  - 对标 VS Code 官方标准同步策略：仅超前时直接快速 push，有落后时才执行安全 pull，绝不使用 `--rebase`，从源头杜绝逐个 commit 重放造出的虚假冲突
  - 自动检测并脱离历史残留的变基中间态（自动 `rebase --abort` 救援）
- **全面适配最新 DSH Web Lexical 富文本编辑器**：
  - 解决「💬 将改动带入对话输入框」在最新版本 DSH 下点击无反应的问题，支持基于 `contenteditable` 的标准文本注入

## [0.1.13] - 2026-09-11

### Added（VS Code 式改动感知）

- **工作区文件树改动标记**：右侧栏「文件」树里，有 git 改动的文件在文件名后显示状态字母并给名字上色（`M` 修改 / `A` 新增 / `U` 未跟踪 / `D` 删除 / `R` 重命名 / `C` 冲突），包含改动的目录显示一个圆点——与 VS Code 资源管理器同一观感
  - 装饰层只读取官方文件树已经给出的稳定 DOM 契约（`[data-files-state="tree"][data-files-root]` 与 `li[data-files-entry][data-files-path]`），不改动官方渲染逻辑
  - 清单来自宿主新增的 `/git-panel/file-status` 路由（以仓库根为 cwd 运行 `git status --porcelain -z`，再解析回工作区相对路径），客户端按 TTL 缓存，页面不可见时不轮询
- **Git 变更对比标签（`kind: 'git-diff'`）**：VS Code 风格的双栏 Diff
  - 只有「此刻确有 git 改动」的文件才由本类型接手（同步的 `canOpen` 门禁），未改动文件仍然走官方预览；视图右上角的「源码」按钮用显式 kind 回到官方文本预览，两条路互不干扰
  - 行级 LCS 差异算法（公共前后缀裁剪 + 动态规划，超大文件退化为顺序配对），左右行号严格对齐；新增 / 删除 / 修改行分别着色
  - 支持**单栏**与**双栏**两种布局、**折叠未改动区域**（默认保留 3 行上下文，点击展开）、**自动换行**开关、**字号缩放**
  - **手动编辑**模式：直接修改工作区内容
  - 头部显示文件状态字母与 `+新增 / −删除` 统计；「暂存」按钮一键 `git add`
- **合并冲突一键解决**：
  - 自动识别 `<<<<<<<` / `=======` / `>>>>>>>` 冲突块（可同时处理多块）
  - 每块提供「保留当前更改」「保留传入更改（分支名）」「两者都保留」三个动作，并排展示两侧内容
  - 处理完点「保存」写回工作区文件；检测到冲突时自动切到冲突面板
- 宿主新增路由：`/git-panel/show-head`（`git show HEAD:<仓库相对路径>`，以仓库根解析，工作区为子目录时同样正确）、`/git-panel/read-file`（工作区文件内容，含二进制与超限判定）、`/git-panel/save-file`（冲突解决 / 编辑回写，含工作区边界校验）、`/git-panel/file-status`（变更清单）
- Git 面板与对比标签联动：在变更文件列表里点击任意文件，直接在右侧栏以完整对比视图打开；写操作（暂存 / 取消暂存 / 放弃）后立即刷新文件树标记

## [0.1.12] - 2026-09-10

### Changed（重大变更 · 需 DSH 0.1.5-alpha.1+）

- **Git 面板融合为官方右侧栏的原生 Tab**：
  - 面板不再外挂独立的右侧列，改为通过官方 `sidebarRightTabs` 注册为右侧栏的一等公民标签页（`kind: "git"`，标签标题 `🌿 Git`），与官方「文件」标签并列
  - 注册契约：类型进 `ctx.sidebarRightTabs`，内容体进 `sidebar.right.pane.tab`，标签标题进 `sidebar.right.pane.tab.title`，全部以本插件的 `id` 作为 key
  - 展开、收起、宽度拖拽、多标签切换现在完全由官方右侧栏接管

### Fixed

- **修复收起官方侧边栏后 Git 面板被挤成空白窄条的问题**：
  - 根因：旧实现直接改写页面根容器的 `gridTemplateColumns`，并硬编码假设布局「恒为 3 列」。DSH 引入官方右侧栏后列数会在展开/收起时动态增减，该假设失效，导致面板所在列被压缩到接近 0px，必须手动折叠再展开 Git 面板才能恢复
  - 现已彻底删除该布局改写逻辑（移除 `src/client/frame.ts` 整个模块），打包产物中不再包含任何 `gridTemplateColumns` 写入、列宽手柄或折叠箭头

- **修复切换会话后 Git 面板路径不跟随的问题**：
  - 新增 `GitTab.tsx`，订阅 sessions 列表把「当前活动会话 → 工作区 cwd」映射为 React 状态，切换会话时面板自动重指向新仓库

### Removed

- 移除右侧悬浮的折叠箭头与外挂面板列（已被官方右侧栏 Tab 完全取代）
- 移除 `src/client/frame.ts`（页面网格布局改写模块）

### Requirements

- 需要 DSH `>=0.1.5-alpha.1`（该版本起提供 `@deepseek-ai/dsh-client-ui-sidebar-right` 右侧栏多标签框架）

## [0.1.11] - 2026-09-08

- 文件级复制路径、向 Agent 提问按钮、丢弃改动二次确认
