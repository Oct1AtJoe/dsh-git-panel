/**
 * dsh-git-panel —— 浏览器端装配：
 *
 * 1. 输入 dock 的分支 Chip；
 * 2. 官方右侧栏的 Git 面板标签（`kind: 'git'`）；
 * 3. Git 变更对比标签（`kind: 'git-diff'`）——只接手「当前有 git 改动」的文件，
 *    由同步的 `canOpen` 门禁决定，其余文件仍走官方预览；
 * 4. 侧边栏文件树的 git 状态装饰（M/U/A 标记）。
 *
 * 所有接线失败都会记日志而不会抛出——当插件 apply 抛出异常时，shell 会中止整个
 * 启动流程。
 * @module dsh-git-panel/client
 */

import { createElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { GitPanelApi } from './api.ts'
import { BranchChip } from './BranchChip.tsx'
import { initI18n, t } from './i18n.ts'
import { GitTabBody } from './GitTab.tsx'
import { GitDiffView } from './GitDiffView.tsx'
import { GitStatusCache } from './git-status.ts'
import { installFileTreeDecorations } from './decorations.ts'
import { basenameOf, parseFileAddress } from './refs.ts'

/**
 * 我们使用到的注入式客户端运行时结构。这里在本地声明，而不是导入 SDK 的
 * ClientContext：宿主侧的 SDK 包会用另一种不同的 `sessions` 结构扩展同一个
 * cordis Context，当宿主端与客户端在同一程序中一起编译时，后者会胜出。无论
 * 如何，bundle 在运行时都采用鸭子类型判定。
 */
interface PanelClientContext {
  effect(fn: () => (() => void) | void, name: string): void
  inject(services: string[], fn: (scope: PanelClientContext) => void): void
  sidebarRightTabs?: {
    register(def: unknown): () => void
  }
  sessions: {
    list: {
      getSnapshot(): { current?: string; byId: Record<string, { cwd?: string }> }
      subscribe(fn: () => void): () => void
    }
  }
  slots: {
    inject(name: string, factory: () => unknown): () => void
    register(opts: Record<string, unknown>, component: unknown): unknown
  }
  locale: {
    getLocale(): { active: string }
    subscribe(fn: () => void): () => void
  }
}

export const inject = ['sessions', 'locale']

const TAB_ID = '@deepseek-ai/dsh-git-panel'


/**
 * 工作区启动卡上的 Git 图标。
 *
 * 契约与官方 provider 的 guide icon 一致：接收 `{ size, className }`，
 * 尺寸由官方卡片（26px）注入，颜色继承 `currentColor` 以便跟随主题与悬停态。
 */
function GitGuideIcon(props: { size?: number; className?: string }): React.ReactElement {
  const size = props.size ?? 26
  return createElement('svg', {
    width: size,
    height: size,
    className: props.className,
    viewBox: '0 0 28 28',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  },
    createElement('circle', { key: 'a', cx: 9, cy: 7, r: 2.6 }),
    createElement('circle', { key: 'b', cx: 9, cy: 21, r: 2.6 }),
    createElement('circle', { key: 'c', cx: 19, cy: 14, r: 2.6 }),
    createElement('path', { key: 'd', d: 'M9 9.6v8.8M9 14h7.4' }),
  )
}const DIFF_TAB_ID = '@deepseek-ai/dsh-git-panel/diff'
/** 官方文档插槽里的渲染器 id（与标签类型 id 不同名，避免与官方注册表冲突）。 */
const DIFF_VIEWER_ID = 'dsh-git-panel/diff'
const DIFF_KIND = 'git-diff'

/**
 * 「Git 变更对比」可作为备选渲染器的文件后缀。
 *
 * 这份名单刻意只列**官方代码渲染器确实支持**的常见后缀（shiki 语言表覆盖的
 * 那些）：我们的优先级是 `extension`（低于 `builtin`），因此在这些类型上官方
 * 渲染器仍是默认，我们只出现在「打开方式」下拉里，不会改变既有观感。
 *
 * 不在这里的后缀并不会失去对比能力——点文件树里带改动标记的文件，仍然由
 * `git-diff` 标签类型直接接管（那条路与后缀无关）。
 */
const DIFF_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'dart', 'lua', 'pl', 'r', 'scala',
  'sh', 'bash', 'zsh',
  'yml', 'yaml', 'toml', 'ini',
  'sql', 'graphql', 'proto',
  'css', 'scss', 'less',
  'html', 'htm', 'xml', 'svg', 'vue', 'svelte',
  'md', 'markdown',
]

/** 文件地址前缀（与官方 side-bar 文件树拼出的地址同一约定）。 */
const FILE_PREFIX = 'dsh-resource://file/session/'

/** 变更清单轮询间隔：既保证装饰新鲜，又不至于在本地反复跑 git。 */
const POLL_MS = 4000

/** 由会话身份拼出文件资源地址。 */
function fileAddressOf(sessionId: string, relative: string): string {
  const encoded = relative.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `${FILE_PREFIX}${encodeURIComponent(sessionId)}/${encoded}`
}

export function apply(ctx: PanelClientContext): void {
  try {
    initI18n(ctx.locale)
  } catch (error) {
    console.error('dsh-git-panel: i18n init failed', error)
  }

  const api = new GitPanelApi()
  const statusCache = new GitStatusCache(api)

  /** 会话身份 -> 工作区根（cwd）。 */
  const cwdOf = (sessionId: string | undefined): string => {
    if (sessionId === undefined) return ''
    try {
      const snapshot = ctx.sessions.list.getSnapshot()
      const cwd = snapshot.byId[sessionId]?.cwd
      return typeof cwd === 'string' ? cwd : ''
    } catch {
      return ''
    }
  }

  // 0. 变更清单轮询：装饰与路由门禁共用同一份快照。
  ctx.inject(['sessions'], () => {
    try {
      const refresh = (): void => {
        const current = ctx.sessions.list.getSnapshot().current
        const cwd = cwdOf(current)
        if (cwd !== '') void statusCache.ensure(cwd)
        // 文件树可能属于其它会话（多会话并行），它们的工作区同样要保活。
        for (const root of statusCache.roots()) {
          if (root !== cwd) void statusCache.ensure(root)
        }
      }
      refresh()
      ctx.sessions.list.subscribe(refresh)
      const timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') refresh()
      }, POLL_MS)
      ctx.effect(() => () => window.clearInterval(timer), 'dsh-git-panel: status poll')
      ctx.effect(() => installFileTreeDecorations(statusCache, (root) => { void statusCache.ensure(root) }), 'dsh-git-panel: file tree decorations')
    } catch (error) {
      console.warn('dsh-git-panel: status polling setup failed', error)
    }
  })

  // 1. 输入框上方分支状态 Chip
  ctx.inject(['slots', 'sessions'], (scope: PanelClientContext) => {
    try {
      scope.slots.inject('conversation.input.dock', () =>
        scope.slots.register({
          name: 'conversation.input.dock',
          id: 'git-panel-branch-chip',
          order: 100,
          locale: 'dsh-git-panel',
          inject: () => ({ sessions: scope.sessions }),
        }, BranchChip))
    } catch (error) {
      console.error('dsh-git-panel: branch chip registration failed', error)
    }
  })

  // 2. 官方右侧栏集成 (适配新版 DSH 0.1.5-alpha.2+ 原生多 Tab 系统)
  ctx.inject(['sidebarRightTabs', 'slots'], (scope: any) => {
    try {
      if (scope.sidebarRightTabs) {
        scope.sidebarRightTabs.register({
          id: TAB_ID,
          kind: 'git',
          priority: 'extension',
          title: () => 'Git',
          // 与官方 provider（sidebar-files / sidebar-terminal）保持完全一致的
          // guide 契约：id + order + title + description + icon 五件套。
          // 缺 description/icon 会让工作区启动卡只剩一行标题，行距与留白都和
          // 官方卡片对不齐——补全后才与「工作区文件」「新建终端」长得一样。
          guide: [{
            id: 'git',
            order: 12,
            title: () => t('tab.gitTitle'),
            description: () => t('guide.gitDescription'),
            icon: GitGuideIcon,
          }],
        })

        scope.slots.inject('sidebar.right.pane.tab', () =>
          scope.slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            inject: () => ({ api, sessions: ctx.sessions, statusCache }),
          }, GitTabBody)
        )

        scope.slots.inject('sidebar.right.pane.tab.title', () =>
          scope.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key: TAB_ID,
          }, () => createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
            createElement('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
              createElement('circle', { cx: 4, cy: 4, r: 2 }),
              createElement('circle', { cx: 4, cy: 12, r: 2 }),
              createElement('circle', { cx: 12, cy: 8, r: 2 }),
              createElement('path', { d: 'M4 6v4M4 8h5a3 3 0 013 3' })
            ),
            createElement('span', null, 'Git')
          ))
        )
        console.log('dsh-git-panel: registered into native sidebarRightTabs')
      }
    } catch (err) {
      console.warn('dsh-git-panel: sidebarRightTabs register error', err)
    }
  })

  // 3. Git 变更对比标签：只接手「此刻确有 git 改动」的文件。
  ctx.inject(['sidebarRightTabs', 'slots', 'sessions'], (scope: any) => {
    try {
      if (!scope.sidebarRightTabs) return
      scope.sidebarRightTabs.register({
        id: DIFF_TAB_ID,
        kind: DIFF_KIND,
        priority: 'extension',
        patterns: ['dsh-resource://file/**'],
        canOpen: (address: string): boolean => {
          const parsed = parseFileAddress(address)
          if (parsed === undefined) return false
          const cwd = cwdOf(parsed.sessionId)
          if (cwd === '') return false
          return statusCache.isChanged(cwd, parsed.path)
        },
        title: (address: string) => {
          const parsed = parseFileAddress(address)
          return `± ${basenameOf(parsed?.path ?? address)}`
        },
      })

      scope.slots.inject('sidebar.right.pane.tab', () =>
        scope.slots.register({
          name: 'sidebar.right.pane.tab',
          key: DIFF_TAB_ID,
          inject: () => ({ api, sessions: ctx.sessions }),
        }, GitDiffView)
      )
      console.log('dsh-git-panel: registered git-diff tab type')
    } catch (error) {
      console.warn('dsh-git-panel: git-diff register error', error)
    }
  })

  // 4. 官方文件预览的可选渲染器：在「打开方式」下拉里多一个「Git 变更对比」。
  //
  //    与第 3 条互补：标签类型只在「确有改动」时接手，命中之前（缓存未热）或想
  //    对比一个没改动的文件时，用户仍可在这里手动切换过来。优先级用 extension
  //    （低于 builtin），因此代码 / Markdown 等官方渲染器仍是默认，我们只出现在
  //    备选列表里，不会改变既有默认观感。
  ctx.inject(['documentPreviews', 'slots', 'sessions'], (scope: any) => {
    try {
      if (!scope.documentPreviews) return
      scope.documentPreviews.register({
        id: DIFF_VIEWER_ID,
        extensions: DIFF_EXTENSIONS,
        priority: 'extension',
        title: () => 'Git 变更对比',
        loading: 'text-pages',
        wrap: true,
      })

      scope.slots.inject('sidebar.right.tab.document', () =>
        scope.slots.register({
          name: 'sidebar.right.tab.document',
          key: DIFF_VIEWER_ID,
        }, (props: { resourceAddress?: string }) => createElement(GitDiffView, {
          resourceAddress: props.resourceAddress,
          api,
          sessions: ctx.sessions,
        }))
      )
      console.log('dsh-git-panel: registered Git diff as a document viewer')
    } catch (error) {
      console.warn('dsh-git-panel: document viewer register error', error)
    }
  })
}

/** Cordis 插件入口 —— 同时提供命名与默认导出，确保 loader 总能解析到它。 */
export default { apply, inject }
