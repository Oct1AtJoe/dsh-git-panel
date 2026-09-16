/**
 * Git 变更对比视图：VS Code 风格的双栏 Diff + 合并冲突一键解决。
 *
 * 这是 `dsh-git-panel` 注册的第二个官方右侧栏标签类型（`kind: 'git-diff'`）的
 * 正文。它与官方文件预览各自独立：
 *
 * - 数据来源全部走本插件自己的宿主路由（HEAD 版本、工作区内容、变更清单），
 *   不依赖官方 Remote 服务的具体版本；
 * - 门禁由 `canOpen` 完成——只有「当前有 git 改动」的文件才会被这个类型接手，
 *   其余文件仍然走官方预览；视图内的「查看源码」按钮用显式 kind 打开官方文本
 *   预览，两条路互不干扰。
 *
 * @module dsh-git-panel/client/GitDiffView
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GitPanelApi } from './api.ts'
import { diffRows, diffStat, type DiffRow } from './diff.ts'
import { basenameOf, parseFileAddress } from './refs.ts'
import { STATUS_COLORS, statusLetter } from './git-status.ts'
import type { TabSessions } from './GitTab.tsx'

/** 折叠未改动区域时保留的上下文行数。 */
const CONTEXT_LINES = 3

/** 单个冲突块。 */
interface ConflictBlock {
  /** 起始行下标（0 基，指向 `<<<<<<<`）。 */
  start: number
  /** 分隔行下标（`=======`）。 */
  middle: number
  /** 结束行下标（`>>>>>>>`）。 */
  end: number
  /** 当前分支（ours）内容。 */
  ours: string
  /** 传入分支（theirs）内容。 */
  theirs: string
  /** 传入分支名。 */
  label: string
}

/** 视图模式。 */
type Mode = 'split' | 'unified' | 'conflict' | 'edit'

/** 正文 props：`useTabInfo` 由官方右侧栏的 slot 钩子注入，其余由本插件注入。 */
export interface GitDiffViewProps {
  api?: GitPanelApi
  sessions?: TabSessions
  /** 作为官方文档预览的替代渲染器时，地址由文档插槽直接给出。 */
  resourceAddress?: string
  useTabInfo?: () => { tab: { id: string; contentId: string; actions: { openResource(address: string, options?: Record<string, unknown>): void } } }
}

/** 从会话快照读取 cwd。 */
function readCwd(sessions: TabSessions | undefined, sessionId: string): string {
  if (!sessions) return ''
  const snapshot = sessions.list.getSnapshot()
  const cwd = snapshot.byId[sessionId]?.cwd
  return typeof cwd === 'string' ? cwd : ''
}

/** 解析工作区文本里的冲突块。 */
export function parseConflicts(text: string): { blocks: ConflictBlock[]; lines: string[] } {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  const blocks: ConflictBlock[] = []
  let start = -1
  let middle = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.startsWith('<<<<<<<')) {
      start = index
      middle = -1
      continue
    }
    if (start !== -1 && middle === -1 && line.startsWith('=======')) {
      middle = index
      continue
    }
    if (start !== -1 && middle !== -1 && line.startsWith('>>>>>>>')) {
      blocks.push({
        start,
        middle,
        end: index,
        ours: lines.slice(start + 1, middle).join('\n'),
        theirs: lines.slice(middle + 1, index).join('\n'),
        label: line.slice(7).trim() || 'incoming',
      })
      start = -1
      middle = -1
    }
  }
  return { blocks, lines }
}

/** 用选定的一侧替换一个冲突块。 */
function applyResolution(text: string, block: ConflictBlock, choice: 'ours' | 'theirs' | 'both'): string {
  const { lines } = parseConflicts(text)
  const ours = block.ours === '' ? [] : block.ours.split('\n')
  const theirs = block.theirs === '' ? [] : block.theirs.split('\n')
  const replacement = choice === 'ours' ? ours : choice === 'theirs' ? theirs : [...ours, ...theirs]
  const next = [...lines.slice(0, block.start), ...replacement, ...lines.slice(block.end + 1)]
  return next.join('\n')
}

/** 展示项：真实行，或一段被折叠的未改动区域。 */
type DisplayItem =
  | { kind: 'row'; row: DiffRow; key: string }
  | { kind: 'gap'; from: number; to: number; key: string }

/** 按上下文行数折叠未改动区域。 */
function buildDisplay(rows: readonly DiffRow[], expanded: ReadonlySet<number>): DisplayItem[] {
  const items: DisplayItem[] = []
  let index = 0
  while (index < rows.length) {
    const row = rows[index]
    if (row === undefined) break
    if (row.kind !== 'equal') {
      items.push({ kind: 'row', row, key: `r${index}` })
      index += 1
      continue
    }
    let end = index
    while (end < rows.length && rows[end]?.kind === 'equal') end += 1
    const count = end - index
    if (count <= CONTEXT_LINES * 2 + 1 || expanded.has(index)) {
      for (let at = index; at < end; at += 1) {
        const held = rows[at]
        if (held !== undefined) items.push({ kind: 'row', row: held, key: `r${at}` })
      }
    } else {
      for (let at = index; at < index + CONTEXT_LINES; at += 1) {
        const held = rows[at]
        if (held !== undefined) items.push({ kind: 'row', row: held, key: `r${at}` })
      }
      items.push({ kind: 'gap', from: index + CONTEXT_LINES, to: end - CONTEXT_LINES, key: `g${index}` })
      for (let at = end - CONTEXT_LINES; at < end; at += 1) {
        const held = rows[at]
        if (held !== undefined) items.push({ kind: 'row', row: held, key: `r${at}` })
      }
    }
    index = end
  }
  return items
}

/** 注入一次样式。 */
let styleReady = false
function ensureStyle(): void {
  if (styleReady || typeof document === 'undefined') return
  styleReady = true
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-git-panel-diff'
  tag.textContent = STYLE
  document.head.appendChild(tag)
}

/** 工具栏图标：统一的 15×15 线性图标。 */
function glyph(kind: string): React.ReactElement {
  const paths: Record<string, React.ReactNode[]> = {
    file: [createElement('path', { key: 'a', d: 'M4.2 1.8h4.3L12 5.3v8.9H4.2z' }), createElement('path', { key: 'b', d: 'M8.4 1.8v3.6H12' })],
    split: [createElement('rect', { key: 'a', x: 2.2, y: 3.2, width: 11.6, height: 9.6, rx: 1.4 }), createElement('path', { key: 'b', d: 'M8 3.2v9.6' })],
    unified: [createElement('path', { key: 'a', d: 'M3 4.6h10M3 8h10M3 11.4h5.5' })],
    edit: [createElement('path', { key: 'a', d: 'M10.9 2.4l2.7 2.7-7.2 7.2H3.7v-2.7z' }), createElement('path', { key: 'b', d: 'M9.6 3.7l2.7 2.7' })],
    conflict: [createElement('path', { key: 'a', d: 'M8 2.4l5.7 10.2H2.3z' }), createElement('path', { key: 'b', d: 'M8 6.4v3.1M8 11.4h.01' })],
    wrap: [createElement('path', { key: 'a', d: 'M3 4.4h10M3 11.6h4M3 8h7.2a2 2 0 010 4H8.4' }), createElement('path', { key: 'b', d: 'M9.6 10.4L8.2 12l1.4 1.6' })],
    fold: [createElement('path', { key: 'a', d: 'M4.4 6.2L8 2.9l3.6 3.3M4.4 9.8L8 13.1l3.6-3.3' })],
    code: [createElement('path', { key: 'a', d: 'M5.9 4.2L2.4 8l3.5 3.8M10.1 4.2L13.6 8l-3.5 3.8' })],
    stage: [createElement('path', { key: 'a', d: 'M8 3.2v9.6M3.2 8h9.6' })],
    save: [createElement('path', { key: 'a', d: 'M8 2.6v6.4M5.2 6.4L8 9.2l2.8-2.8M3.4 13h9.2' })],
    check: [createElement('path', { key: 'a', d: 'M3.4 8.4l3 3 6.2-6.8' })],
  }
  return createElement('svg', {
    className: 'dsh-gd-ico',
    viewBox: '0 0 16 16',
    width: 15,
    height: 15,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }, ...(paths[kind] ?? []))
}

/** 一个图标开关按钮（选中态用品牌色底）。 */
function iconButton(
  id: string,
  label: string,
  active: boolean,
  onClick: () => void,
  kind: string,
  danger = false,
): React.ReactElement {
  return createElement('button', {
    type: 'button',
    'data-gd-btn': id,
    className: `dsh-gd-ico-btn${active ? ' on' : ''}${danger ? ' danger' : ''}`,
    title: label,
    'aria-label': label,
    'aria-pressed': active,
    onClick,
  }, glyph(kind))
}

/** Git 变更对比视图。 */
export function GitDiffView(props: GitDiffViewProps): React.ReactElement {
  ensureStyle()
  const info = props.useTabInfo?.()
  const tab = info?.tab
  /** 由官方文档插槽挂载时地址直接给出；作为独立标签时取标签地址。 */
  const fromDocumentSlot = typeof props.resourceAddress === 'string' && props.resourceAddress !== ''
  const address = fromDocumentSlot ? props.resourceAddress ?? '' : (typeof tab?.contentId === 'string' ? tab.contentId : '')
  const parsed = useMemo(() => parseFileAddress(address), [address])
  const sessionId = parsed?.sessionId ?? ''
  const file = parsed?.path ?? ''
  const [api] = useState<GitPanelApi>(() => props.api ?? new GitPanelApi())
  const [cwd, setCwd] = useState<string>(() => readCwd(props.sessions, sessionId))

  const [head, setHead] = useState('')
  const [working, setWorking] = useState('')
  const [baseline, setBaseline] = useState('')
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [isNew, setIsNew] = useState(false)
  const [missing, setMissing] = useState(false)
  const [binary, setBinary] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('split')
  const [wrap, setWrap] = useState(true)
  const [collapse, setCollapse] = useState(true)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set<number>())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const [fontSize, setFontSize] = useState(12)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 会话 cwd 跟随切换。
  useEffect(() => {
    if (!props.sessions) return undefined
    const update = (): void => setCwd(readCwd(props.sessions, sessionId))
    update()
    return props.sessions.list.subscribe(update)
  }, [props.sessions, sessionId])

  /** 拉取三份数据：HEAD 版本、工作区内容、状态字母。 */
  const load = useCallback(async (): Promise<void> => {
    if (cwd === '' || file === '') return
    setLoading(true)
    setError(null)
    try {
      const [headResult, workResult, statusResult] = await Promise.all([
        api.showHead(cwd, file),
        api.readFile(cwd, file),
        api.fileStatus(cwd),
      ])
      const headOk = headResult.ok && headResult.value.ok
      setHead(headOk ? headResult.value.output : '')
      setIsNew(!headOk)
      if (workResult.ok && workResult.value.ok) {
        const value = workResult.value
        setWorking(value.text)
        setBinary(value.binary)
        setMissing(value.missing === true)
      } else {
        setWorking('')
        setError(workResult.ok ? workResult.value.error?.message ?? '读取失败' : workResult.error.message)
      }
      if (statusResult.ok) {
        const entry = statusResult.value.entries.find((candidate) => candidate.path === file)
        setStatus(entry === undefined ? undefined : statusLetter(entry.code))
      } else {
        setStatus(undefined)
      }
    } finally {
      setLoading(false)
    }
  }, [api, cwd, file])

  useEffect(() => {
    void load()
  }, [load])

  // 基线 = 上次保存/加载时的内容，用来判断是否有未保存编辑。
  useEffect(() => {
    setBaseline(working)
    // 仅在重新加载后同步基线：working 变化由编辑产生时不重置。
  }, [loading])

  const rows = useMemo(() => diffRows(head, working), [head, working])
  const stat = useMemo(() => diffStat(rows), [rows])
  const conflicts = useMemo(() => parseConflicts(working).blocks, [working])
  const dirty = working !== baseline
  const display = useMemo(
    () => (collapse ? buildDisplay(rows, expanded) : rows.map((row, index) => ({ kind: 'row' as const, row, key: `r${index}` }))),
    [rows, collapse, expanded],
  )

  // 有冲突时自动切到冲突面板。
  useEffect(() => {
    if (conflicts.length > 0) setMode('conflict')
  }, [conflicts.length])

  const save = useCallback(async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      const result = await api.saveFile(cwd, file, working)
      if (result.ok && result.value.ok) {
        setBaseline(working)
        setNote({ text: '已保存到工作区', kind: 'ok' })
        await load()
      } else {
        setNote({ text: result.ok ? result.value.error?.message ?? '保存失败' : result.error.message, kind: 'err' })
      }
    } finally {
      setBusy(false)
    }
  }, [api, busy, cwd, file, load, working])

  const stage = useCallback(async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      const result = await api.stageFile(cwd, file)
      setNote(result.ok && result.value.ok
        ? { text: '已暂存（git add）', kind: 'ok' }
        : { text: result.ok ? result.value.error?.message ?? '暂存失败' : result.error.message, kind: 'err' })
    } finally {
      setBusy(false)
    }
  }, [api, busy, cwd, file])

  const openSource = useCallback((): void => {
    try {
      tab?.actions.openResource(address, { kind: 'text' })
    } catch (openError) {
      setNote({ text: openError instanceof Error ? openError.message : '无法打开源码视图', kind: 'err' })
    }
  }, [address, tab])

  const color = status === undefined ? undefined : STATUS_COLORS[status]
  const name = basenameOf(file)

  return createElement('div', { className: 'dsh-gd' },
    createElement('div', { className: 'dsh-gd-head' },
      // ---- 左：身份区（文件名 / 状态 / 完整路径 / 增删统计）----
      createElement('div', { className: 'dsh-gd-id' },
        createElement('span', { className: 'dsh-gd-glyph', 'aria-hidden': 'true' }, glyph('file')),
        createElement('span', { className: 'dsh-gd-name', title: file }, name),
        status !== undefined && createElement('span', {
          className: 'dsh-gd-badge',
          style: { color, borderColor: `${color}66`, background: `${color}1f` },
          title: `git 状态：${status}`,
        }, status),
        isNew && createElement('span', { className: 'dsh-gd-tag', title: 'HEAD 中不存在这个文件' }, '新增'),
        createElement('span', { className: 'dsh-gd-path', title: file }, file),
        createElement('span', { className: 'dsh-gd-stat' },
          createElement('span', { className: 'dsh-gd-add', title: `${stat.added} 行新增` }, `+${stat.added}`),
          createElement('span', { className: 'dsh-gd-del', title: `${stat.removed} 行删除` }, `−${stat.removed}`),
        ),
      ),
      createElement('span', { className: 'dsh-gd-spacer' }),
      // ---- 右：控件区（视图 / 选项 / 动作）----
      createElement('div', { className: 'dsh-gd-tools' },
        createElement('div', { className: 'dsh-gd-seg', role: 'group', 'aria-label': '视图切换' },
          iconButton('dsh-gd-split', '双栏对比', mode === 'split', () => setMode('split'), 'split'),
          iconButton('dsh-gd-unified', '单栏对比', mode === 'unified', () => setMode('unified'), 'unified'),
          iconButton('dsh-gd-edit', '编辑文件内容', mode === 'edit', () => setMode('edit'), 'edit'),
          conflicts.length > 0 && iconButton(
            'dsh-gd-conflict',
            `处理合并冲突（${conflicts.length} 块）`,
            mode === 'conflict',
            () => setMode('conflict'),
            'conflict',
            true,
          ),
        ),
        createElement('span', { className: 'dsh-gd-sep', 'aria-hidden': 'true' }),
        createElement('div', { className: 'dsh-gd-seg', role: 'group', 'aria-label': '显示选项' },
          iconButton('dsh-gd-wrap', '自动换行', wrap, () => setWrap((value) => !value), 'wrap'),
          iconButton('dsh-gd-fold', '折叠未改动区域', collapse, () => setCollapse((value) => !value), 'fold'),
        ),
        createElement('div', { className: 'dsh-gd-stepper', role: 'group', 'aria-label': '字号' },
          createElement('button', {
            type: 'button',
            className: 'dsh-gd-step',
            title: '缩小字号',
            'aria-label': '缩小字号',
            onClick: () => setFontSize((value) => Math.max(10, value - 1)),
          }, 'A−'),
          createElement('span', { className: 'dsh-gd-size', title: `当前字号 ${fontSize}px` }, String(fontSize)),
          createElement('button', {
            type: 'button',
            className: 'dsh-gd-step',
            title: '放大字号',
            'aria-label': '放大字号',
            onClick: () => setFontSize((value) => Math.min(20, value + 1)),
          }, 'A+'),
        ),
        createElement('span', { className: 'dsh-gd-sep', 'aria-hidden': 'true' }),
        createElement('div', { className: 'dsh-gd-actions' },
          createElement('button', {
            type: 'button',
            'data-gd-btn': 'source',
            className: 'dsh-gd-btn',
            title: '用官方文本预览打开这个文件（代码 / 纯文本 / Markdown 等官方渲染器）',
            onClick: openSource,
          }, glyph('code'), createElement('span', null, '官方预览')),
          createElement('button', {
            type: 'button',
            className: 'dsh-gd-btn',
            title: '暂存该文件（git add）',
            disabled: busy,
            onClick: () => void stage(),
          }, glyph('stage'), createElement('span', null, '暂存')),
          createElement('button', {
            type: 'button',
            'data-gd-btn': 'save',
            className: `dsh-gd-btn${dirty ? ' primary dirty' : ' synced'}`,
            title: dirty ? '保存改动到工作区' : '工作区内容与视图一致',
            disabled: busy || !dirty,
            onClick: () => void save(),
          }, glyph(dirty ? 'save' : 'check'), createElement('span', null, busy ? '处理中' : dirty ? '保存' : '已同步')),
        ),
      ),
    ),
    (note !== null || error !== null || binary || missing || isNew) && createElement('div', { className: 'dsh-gd-notes' },
      error !== null && createElement('span', { className: 'dsh-gd-note err' }, error),
      binary && createElement('span', { className: 'dsh-gd-note' }, '二进制文件，无法显示文本差异'),
      missing && createElement('span', { className: 'dsh-gd-note' }, '工作区中已不存在该文件（可能已删除）'),
      isNew && createElement('span', { className: 'dsh-gd-note' }, '这是新增文件：左栏为空，全部内容为新增'),
      note !== null && createElement('span', { className: `dsh-gd-note ${note.kind}` }, note.text),
    ),
    createElement('div', { className: 'dsh-gd-body', ref: scrollRef },
      loading
        ? createElement('div', { className: 'dsh-gd-empty' }, '正在读取 git 数据…')
        : mode === 'conflict'
          ? renderConflicts(conflicts, working, setWorking, setNote)
          : mode === 'edit'
            ? createElement('textarea', {
              className: 'dsh-gd-editor',
              style: { fontSize: `${fontSize}px`, whiteSpace: wrap ? 'pre-wrap' : 'pre' },
              spellCheck: false,
              value: working,
              onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setWorking(event.target.value),
            })
            : createElement('div', { className: 'dsh-gd-scroll' },
              createElement('div', {
                className: `dsh-gd-rows${wrap ? ' wrap' : ''}${mode === 'unified' ? ' unified' : ''}`,
                style: { fontSize: `${fontSize}px` },
              },
                display.map((item) => item.kind === 'gap'
                  ? createElement('div', {
                    key: item.key,
                    className: 'dsh-gd-gap',
                    onClick: () => setExpanded((held) => new Set([...held, item.from - CONTEXT_LINES])),
                    title: '展开这段未改动的代码',
                  }, `⋯ 展开 ${item.to - item.from} 行未改动`)
                  : mode === 'unified'
                    ? renderUnifiedRow(item.row, item.key)
                    : renderSplitRow(item.row, item.key),
                ),
              ),
            ),
    ),
  )
}

/** 双栏模式的一行。 */
function renderSplitRow(row: DiffRow, key: string): React.ReactElement {
  return createElement('div', { className: `dsh-gd-row ${row.kind}`, key },
    createElement('div', { className: `dsh-gd-cell left ${row.kind}` },
      createElement('span', { className: 'dsh-gd-num' }, row.left === undefined ? '' : String(row.left.num)),
      createElement('span', { className: 'dsh-gd-txt', title: row.left?.text }, row.left?.text ?? ''),
    ),
    createElement('div', { className: `dsh-gd-cell right ${row.kind}` },
      createElement('span', { className: 'dsh-gd-num' }, row.right === undefined ? '' : String(row.right.num)),
      createElement('span', { className: 'dsh-gd-txt', title: row.right?.text }, row.right?.text ?? ''),
    ),
  )
}

/** 单栏模式的一行。 */
function renderUnifiedRow(row: DiffRow, key: string): React.ReactElement {
  const text = row.kind === 'del' ? row.left?.text : row.right?.text ?? row.left?.text
  const num = row.kind === 'del' ? row.left?.num : row.right?.num ?? row.left?.num
  const marker = row.kind === 'ins' ? '+' : row.kind === 'del' ? '-' : row.kind === 'change' ? '±' : ' '
  return createElement('div', { className: `dsh-gd-row unified ${row.kind}`, key },
    createElement('span', { className: 'dsh-gd-marker' }, marker),
    createElement('span', { className: 'dsh-gd-num' }, num === undefined ? '' : String(num)),
    createElement('span', { className: 'dsh-gd-txt', title: text }, text ?? ''),
    row.kind === 'change' && createElement('span', { className: 'dsh-gd-txt after' }, row.right?.text ?? ''),
  )
}

/** 冲突面板：全景行号上下文合并视图（首屏即是靶心，未冲突区域智能折叠）。 */
function renderConflicts(
  conflicts: readonly ConflictBlock[],
  working: string,
  setWorking: (next: string) => void,
  setNote: (note: { text: string; kind: 'ok' | 'err' } | null) => void,
): React.ReactElement {
  if (conflicts.length === 0) {
    return createElement('div', { className: 'dsh-gd-empty ok' }, '✓ 本文件所有冲突已全部解决！请点击右上角「保存」写回文件。')
  }

  const lines = working.split('\n')
  const CONTEXT_AROUND = 8 // 冲突上下各保留 8 行紧邻完整上下文代码
  const elements: React.ReactElement[] = []
  let lineIdx = 0

  elements.push(
    createElement(
      'div',
      {
        className: 'dsh-gd-conflict-hint',
        key: 'hint',
        style: {
          padding: '8px 12px',
          background: 'rgba(210, 153, 34, 0.12)',
          borderBottom: '1px solid rgba(210, 153, 34, 0.25)',
          color: 'var(--fg)',
          fontSize: 12,
        },
      },
      '💡 提示：冲突核心与紧邻代码已直接置于首屏！逐块点击按钮合并冲突，处理完点击右上角「保存」写回磁盘。',
    ),
  )

  for (let cIdx = 0; cIdx < conflicts.length; cIdx += 1) {
    const block = conflicts[cIdx]

    // 1. 如果离上一个冲突块较远，折叠远处的无关代码
    const contextStart = Math.max(lineIdx, block.start - CONTEXT_AROUND)
    if (contextStart > lineIdx) {
      const skippedCount = contextStart - lineIdx
      const fromLine = lineIdx + 1
      const toLine = contextStart
      elements.push(
        createElement(
          'div',
          {
            className: 'dsh-gd-gap',
            key: `gap-before-${cIdx}`,
            style: {
              padding: '6px 12px',
              margin: '4px 0',
              background: 'rgba(128,128,128,0.08)',
              borderRadius: 4,
              fontSize: 11,
              color: 'var(--muted)',
              cursor: 'pointer',
              textAlign: 'center',
            },
            title: '点击查看完整历史代码',
            onClick: () => {
              const el = document.getElementById(`gap-body-${cIdx}`)
              if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'
            },
          },
          `↕️ 已折叠上方第 ${fromLine}–${toLine} 行未冲突代码 (${skippedCount} 行)`,
        ),
        createElement(
          'div',
          {
            id: `gap-body-${cIdx}`,
            key: `gap-body-content-${cIdx}`,
            style: { display: 'none' },
          },
          lines.slice(lineIdx, contextStart).map((lText, i) => {
            const num = lineIdx + i + 1
            return createElement(
              'div',
              { className: 'dsh-gd-row normal', key: `line-${num}` },
              createElement('span', { className: 'dsh-gd-marker' }, ' '),
              createElement('span', { className: 'dsh-gd-num' }, String(num)),
              createElement('span', { className: 'dsh-gd-txt', style: { whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' } }, lText),
            )
          }),
        ),
      )
      lineIdx = contextStart
    }

    // 2. 渲染冲突上方的 8 行紧邻上下文代码
    while (lineIdx < block.start) {
      const num = lineIdx + 1
      const text = lines[lineIdx] ?? ''
      elements.push(
        createElement(
          'div',
          { className: 'dsh-gd-row normal', key: `line-${num}` },
          createElement('span', { className: 'dsh-gd-marker' }, ' '),
          createElement('span', { className: 'dsh-gd-num' }, String(num)),
          createElement('span', { className: 'dsh-gd-txt', style: { whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' } }, text),
        ),
      )
      lineIdx += 1
    }

    // 3. 渲染冲突核心卡片（首屏即是靶心！）
    elements.push(
      createElement(
        'div',
        {
          id: `conflict-block-${cIdx}`,
          className: 'dsh-gd-conflict-block',
          key: `conflict-${block.start}-${block.middle}`,
          style: {
            margin: '8px 0',
            border: '1px solid var(--danger, #ef4444)',
            borderRadius: 6,
            overflow: 'hidden',
            background: 'rgba(239, 68, 68, 0.04)',
          },
        },
        createElement(
          'div',
          {
            className: 'dsh-gd-conflict-head',
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              background: 'rgba(239, 68, 68, 0.12)',
              borderBottom: '1px solid rgba(239, 68, 68, 0.2)',
              fontSize: 11.5,
            },
          },
          createElement('span', { style: { fontWeight: 600, color: 'var(--danger, #ef4444)' } }, `⚠️ 冲突 ${cIdx + 1} / ${conflicts.length} · 行 ${block.start + 1}–${block.end + 1}`),
          createElement('span', { className: 'dsh-gd-spacer', style: { flex: 1 } }),
          createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-gd-btn',
              style: { padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600 },
              onClick: () => {
                setWorking(applyResolution(working, block, 'ours'))
                setNote({ text: `已采用当前更改 (行 ${block.start + 1})`, kind: 'ok' })
              },
            },
            '✔ 采用当前更改 (HEAD)',
          ),
          createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-gd-btn',
              style: { padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600 },
              onClick: () => {
                setWorking(applyResolution(working, block, 'theirs'))
                setNote({ text: `已采用传入更改 (${block.label})`, kind: 'ok' })
              },
            },
            `✔ 采用传入更改 (${block.label})`,
          ),
          createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-gd-btn',
              style: { padding: '3px 8px', fontSize: 11, cursor: 'pointer' },
              onClick: () => {
                setWorking(applyResolution(working, block, 'both'))
                setNote({ text: '已保留双方更改', kind: 'ok' })
              },
            },
            '✔ 两者都保留',
          ),
        ),
        createElement(
          'div',
          { className: 'dsh-gd-conflict-panes', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'rgba(128,128,128,0.15)' } },
          createElement(
            'div',
            { style: { padding: '8px 10px', background: 'rgba(59, 130, 246, 0.08)' } },
            createElement('div', { style: { fontSize: 10.5, color: 'var(--accent, #3b82f6)', marginBottom: 4, fontWeight: 600 } }, 'HEAD / 当前分支:'),
            createElement('pre', { style: { margin: 0, fontSize: 12, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' } }, block.ours || '（空）'),
          ),
          createElement(
            'div',
            { style: { padding: '8px 10px', background: 'rgba(34, 197, 94, 0.08)' } },
            createElement('div', { style: { fontSize: 10.5, color: 'var(--current, #22c55e)', marginBottom: 4, fontWeight: 600 } }, `传入 / ${block.label}:`),
            createElement('pre', { style: { margin: 0, fontSize: 12, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' } }, block.theirs || '（空）'),
          ),
        ),
      ),
    )

    lineIdx = block.end + 1

    // 4. 渲染冲突下方的 8 行紧邻上下文代码
    const contextEnd = Math.min(lines.length, lineIdx + CONTEXT_AROUND)
    while (lineIdx < contextEnd) {
      const num = lineIdx + 1
      const text = lines[lineIdx] ?? ''
      elements.push(
        createElement(
          'div',
          { className: 'dsh-gd-row normal', key: `line-${num}` },
          createElement('span', { className: 'dsh-gd-marker' }, ' '),
          createElement('span', { className: 'dsh-gd-num' }, String(num)),
          createElement('span', { className: 'dsh-gd-txt', style: { whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' } }, text),
        ),
      )
      lineIdx += 1
    }
  }

  // 5. 如果下方还有大量剩余代码，折叠剩余部分
  if (lineIdx < lines.length) {
    const remainingCount = lines.length - lineIdx
    const fromLine = lineIdx + 1
    const toLine = lines.length
    elements.push(
      createElement(
        'div',
        {
          className: 'dsh-gd-gap',
          key: 'gap-after-last',
          style: {
            padding: '6px 12px',
            margin: '4px 0',
            background: 'rgba(128,128,128,0.08)',
            borderRadius: 4,
            fontSize: 11,
            color: 'var(--muted)',
            cursor: 'pointer',
            textAlign: 'center',
          },
          title: '点击展开剩余代码',
          onClick: () => {
            const el = document.getElementById('gap-body-after-last')
            if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'
          },
        },
        `↕️ 已折叠下方第 ${fromLine}–${toLine} 行未冲突代码 (${remainingCount} 行)`,
      ),
      createElement(
        'div',
        {
          id: 'gap-body-after-last',
          key: 'gap-body-content-after-last',
          style: { display: 'none' },
        },
        lines.slice(lineIdx).map((lText, i) => {
          const num = lineIdx + i + 1
          return createElement(
            'div',
            { className: 'dsh-gd-row normal', key: `line-${num}` },
            createElement('span', { className: 'dsh-gd-marker' }, ' '),
            createElement('span', { className: 'dsh-gd-num' }, String(num)),
            createElement('span', { className: 'dsh-gd-txt', style: { whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' } }, lText),
          )
        }),
      ),
    )
  }

  return createElement('div', { className: 'dsh-gd-conflicts-flow', style: { padding: '8px 12px', overflowY: 'auto' } }, elements)
}

/** 视图样式（跟随 DSH 的深浅色变量）。 */
const STYLE = `
.dsh-gd { --gd-bg:var(--dsw-alias-bg-base, #ffffff); --gd-fg:var(--dsw-alias-label-primary, #24292f);
  --gd-muted:var(--dsw-alias-label-tertiary, #6e7781); --gd-border:var(--dsw-alias-border-l3, rgba(128,128,128,0.25));
  --gd-add:#1a7f37; --gd-add-bg:rgba(46,160,67,0.12); --gd-del:#cf222e; --gd-del-bg:rgba(207,34,46,0.10);
  display:flex; flex-direction:column; height:100%; min-height:0; color:var(--gd-fg); background:var(--gd-bg); }
[data-ds-dark-theme] .dsh-gd { --gd-bg:var(--dsw-alias-bg-base, #1f2328); --gd-fg:var(--dsw-alias-label-primary, #d1d9e0);
  --gd-muted:#9198a1; --gd-border:rgba(255,255,255,0.14); --gd-add:#3fb950; --gd-add-bg:rgba(63,185,80,0.15);
  --gd-del:#f85149; --gd-del-bg:rgba(248,81,73,0.15); }
.dsh-gd-head { display:flex; align-items:center; gap:8px; flex:0 0 auto; padding:5px 8px;
  border-bottom:1px solid var(--gd-border); background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.05));
  flex-wrap:wrap; row-gap:4px; min-height:36px; }
.dsh-gd-id { display:flex; align-items:center; gap:6px; min-width:0; flex:0 1 auto; }
.dsh-gd-glyph { display:inline-flex; color:var(--gd-muted); flex:0 0 auto; }
.dsh-gd-name { font-weight:600; font-size:12.5px; white-space:nowrap; }
.dsh-gd-path { font-size:11px; color:var(--gd-muted); font-family:var(--dsw-font-mono, ui-monospace, monospace);
  max-width:42ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; direction:rtl; text-align:left; }
.dsh-gd-path:hover { color:var(--gd-fg); }
.dsh-gd-badge { font-size:10px; font-weight:700; border:1px solid; border-radius:4px; padding:0 4px; line-height:15px; flex:0 0 auto; }
.dsh-gd-tag { font-size:10px; color:var(--gd-muted); border:1px solid var(--gd-border); border-radius:4px;
  padding:0 4px; line-height:15px; flex:0 0 auto; }
.dsh-gd-stat { display:flex; align-items:center; gap:4px; flex:0 0 auto;
  font-family:var(--dsw-font-mono, ui-monospace, monospace); font-size:11px; }
.dsh-gd-add, .dsh-gd-del { border-radius:4px; padding:0 4px; line-height:16px; }
.dsh-gd-add { color:var(--gd-add); background:var(--gd-add-bg); }
.dsh-gd-del { color:var(--gd-del); background:var(--gd-del-bg); }
.dsh-gd-spacer { flex:1 1 auto; }
.dsh-gd-tools { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
.dsh-gd-seg { display:flex; align-items:center; gap:2px; padding:2px; border-radius:8px;
  background:var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.10)); border:1px solid var(--gd-border); }
.dsh-gd-ico-btn { width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center;
  border-radius:6px; border:1px solid transparent; background:transparent; color:var(--gd-muted); cursor:pointer; padding:0; }
.dsh-gd-ico-btn:hover { color:var(--gd-fg); background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.14)); }
.dsh-gd-ico-btn.on { color:var(--dsw-alias-color-brand, #1976d2);
  background:var(--dsw-alias-bg-base, #fff); border-color:var(--gd-border);
  box-shadow:0 1px 2px rgba(0,0,0,0.10); }
.dsh-gd-ico-btn.danger { color:var(--gd-del); }
.dsh-gd-ico-btn.danger.on { color:#fff; background:var(--gd-del); border-color:transparent; }
.dsh-gd-stepper { display:flex; align-items:center; gap:1px; padding:2px; border-radius:8px;
  background:var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.10)); border:1px solid var(--gd-border); }
.dsh-gd-step { min-width:24px; height:24px; border:none; border-radius:6px; background:transparent;
  color:var(--gd-muted); cursor:pointer; font-size:11px; font-weight:600; padding:0 4px; }
.dsh-gd-step:hover { color:var(--gd-fg); background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.14)); }
.dsh-gd-size { min-width:18px; text-align:center; font-size:11px; color:var(--gd-muted);
  font-family:var(--dsw-font-mono, ui-monospace, monospace); }
.dsh-gd-actions { display:flex; align-items:center; gap:6px; }
.dsh-gd-sep { width:1px; height:18px; background:var(--gd-border); flex:0 0 auto; }
.dsh-gd-btn { display:inline-flex; align-items:center; gap:5px; height:26px; padding:0 9px; border-radius:7px;
  font-size:11.5px; cursor:pointer; color:var(--gd-fg); background:transparent;
  border:1px solid var(--gd-border); white-space:nowrap; }
.dsh-gd-btn .dsh-gd-ico { opacity:.85; }
.dsh-gd-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12));
  border-color:var(--dsw-alias-label-tertiary, rgba(128,128,128,0.5)); }
.dsh-gd-btn:disabled { opacity:.5; cursor:default; }
.dsh-gd-btn.on { border-color:var(--dsw-alias-color-brand, #1976d2); color:var(--dsw-alias-color-brand, #1976d2); }
.dsh-gd-btn.primary { background:var(--dsw-alias-color-brand, #1976d2); border-color:transparent; color:#fff; font-weight:600; }
.dsh-gd-btn.primary:hover:not(:disabled) { filter:brightness(1.08); }
.dsh-gd-btn.primary:disabled { opacity:.5; }
.dsh-gd-btn.synced { color:var(--gd-muted); border-color:var(--gd-border); background:transparent; }
.dsh-gd-btn.synced:disabled { opacity:1; }
.dsh-gd-btn.primary.dirty { box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-color-brand, #1976d2) 22%, transparent); }
.dsh-gd-btn.primary.dirty .dsh-gd-ico { animation:dshGdPulse 1.6s ease-in-out infinite; }
@keyframes dshGdPulse { 0%,100% { transform:translateY(0); opacity:.9; } 50% { transform:translateY(1.5px); opacity:1; } }
.dsh-gd-notes { display:flex; gap:6px; flex-wrap:wrap; padding:5px 8px; font-size:11px;
  border-bottom:1px solid var(--gd-border); background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.04)); }
.dsh-gd-note { color:var(--gd-muted); border:1px solid var(--gd-border); border-radius:999px; padding:1px 8px; line-height:16px; }
.dsh-gd-note.ok { color:var(--gd-add); border-color:color-mix(in srgb, var(--gd-add) 40%, transparent);
  background:color-mix(in srgb, var(--gd-add) 10%, transparent); }
.dsh-gd-note.err { color:var(--gd-del); border-color:color-mix(in srgb, var(--gd-del) 40%, transparent);
  background:color-mix(in srgb, var(--gd-del) 10%, transparent); }
.dsh-gd-body { flex:1 1 auto; min-height:0; display:flex; }
.dsh-gd-scroll { flex:1 1 auto; min-height:0; overflow:auto; }
.dsh-gd-rows { min-width:100%; font-family:var(--dsw-font-mono, ui-monospace, monospace); line-height:1.55; }
.dsh-gd-row { display:flex; align-items:stretch; content-visibility:auto; contain-intrinsic-size:auto 19px; }
.dsh-gd-cell { flex:1 1 50%; min-width:0; display:flex; gap:6px; padding:0 6px 0 0; }
.dsh-gd-cell.left { border-right:1px solid var(--gd-border); }
.dsh-gd-num { flex:0 0 auto; width:3.2em; text-align:right; color:var(--gd-muted); user-select:none; padding-right:4px; }
.dsh-gd-txt { flex:1 1 auto; min-width:0; white-space:pre; overflow:hidden; text-overflow:ellipsis; }
.dsh-gd-rows.wrap .dsh-gd-txt { white-space:pre-wrap; word-break:break-word; overflow:visible; }
.dsh-gd-row.ins .right, .dsh-gd-row.change .right { background:var(--gd-add-bg); }
.dsh-gd-row.del .left, .dsh-gd-row.change .left { background:var(--gd-del-bg); }
.dsh-gd-row.unified { display:flex; gap:6px; padding-right:8px; }
.dsh-gd-row.unified.ins { background:var(--gd-add-bg); }
.dsh-gd-row.unified.del { background:var(--gd-del-bg); }
.dsh-gd-row.unified.change { background:linear-gradient(90deg, var(--gd-del-bg) 0 50%, var(--gd-add-bg) 50% 100%); }
.dsh-gd-row.unified .dsh-gd-txt.after { border-left:1px dashed var(--gd-border); padding-left:8px; }
.dsh-gd-marker { flex:0 0 auto; width:1em; text-align:center; color:var(--gd-muted); }
.dsh-gd-gap { padding:1px 10px; font-size:11px; color:var(--gd-muted); cursor:pointer;
  background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08)); border-top:1px solid var(--gd-border);
  border-bottom:1px solid var(--gd-border); }
.dsh-gd-gap:hover { color:var(--gd-fg); }
.dsh-gd-empty { padding:24px; text-align:center; color:var(--gd-muted); font-size:12px; }
.dsh-gd-empty.ok { color:var(--gd-add); }
.dsh-gd-editor { flex:1 1 auto; min-height:0; width:100%; border:none; outline:none; resize:none; padding:10px;
  background:transparent; color:var(--gd-fg); font-family:var(--dsw-font-mono, ui-monospace, monospace); line-height:1.55; }
.dsh-gd-conflicts { padding:10px; display:flex; flex-direction:column; gap:10px; width:100%; }
.dsh-gd-conflict-hint { font-size:11px; color:var(--gd-muted); }
.dsh-gd-conflict { border:1px solid var(--gd-border); border-radius:8px; overflow:hidden; }
.dsh-gd-conflict-head { display:flex; align-items:center; gap:6px; padding:5px 8px; font-size:11px;
  background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08)); border-bottom:1px solid var(--gd-border); }
.dsh-gd-conflict-panes { display:flex; align-items:stretch; }
.dsh-gd-conflict-pane { flex:1 1 50%; min-width:0; padding:6px 8px; }
.dsh-gd-conflict-pane.ours { border-right:1px solid var(--gd-border); background:var(--gd-del-bg); }
.dsh-gd-conflict-pane.theirs { background:var(--gd-add-bg); }
.dsh-gd-conflict-title { font-size:10px; color:var(--gd-muted); margin-bottom:3px; }
.dsh-gd-conflict-pane pre { margin:0; font-family:var(--dsw-font-mono, ui-monospace, monospace); font-size:11.5px;
  white-space:pre-wrap; word-break:break-word; max-height:220px; overflow:auto; }
`
