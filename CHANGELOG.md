# Changelog

`dsh-git-panel` 的版本变更记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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
