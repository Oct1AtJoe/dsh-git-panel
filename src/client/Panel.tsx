/**
 * git 面板的 React 界面：分支列表（本地/远程，含 ahead/behind，
 * 可切换/拉取/抓取）以及带 lane 的 GitLens 风格提交图谱。
 * @module dsh-git-panel/client/Panel
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BranchesView, BranchRow, GraphView, OpResult } from '../core/types.ts'
import type { Envelope, GitPanelApi } from './api.ts'
import { layoutGraph, type LayoutCommit } from './graph.ts'
import { useT } from './i18n.ts'

const STYLE = `
.dsh-gp { --bg:#ffffff; --fg:#24292f; --muted:#6e7781; --border:rgba(128,128,128,0.25);
  --accent:#1976d2; --hover:rgba(0,0,0,0.05); --current:#1a7f37; --danger:#cf222e;
  --panel-bg:#f6f8fa; color:var(--fg); background:var(--bg);
  --dsh-gp-lane-0:#1565c0; --dsh-gp-lane-1:#c62828; --dsh-gp-lane-2:#2e7d32; --dsh-gp-lane-3:#6a1b9a;
  --dsh-gp-lane-4:#00838f; --dsh-gp-lane-5:#e65100; --dsh-gp-lane-6:#4527a0; --dsh-gp-lane-7:#558b2f;
  --dsh-gp-lane-8:#ad1457; --dsh-gp-lane-9:#0277bd; --dsh-gp-lane-10:#ef6c00; --dsh-gp-lane-11:#00695c;
  display:flex; flex-direction:column; height:100%; font-size:13px; }
[data-ds-dark-theme] .dsh-gp { --bg:#1f2328; --fg:#d1d9e0; --muted:#9198a1;
  --border:rgba(255,255,255,0.14); --accent:#58a6ff; --hover:rgba(255,255,255,0.07);
  --current:#3fb950; --danger:#f85149; --panel-bg:#161b22;
  --dsh-gp-lane-0:#58a6ff; --dsh-gp-lane-1:#ff7b72; --dsh-gp-lane-2:#3fb950; --dsh-gp-lane-3:#bc8cff;
  --dsh-gp-lane-4:#39c5cf; --dsh-gp-lane-5:#f0883e; --dsh-gp-lane-6:#a371f7; --dsh-gp-lane-7:#7ee787;
  --dsh-gp-lane-8:#ffa198; --dsh-gp-lane-9:#76e3ea; --dsh-gp-lane-10:#e3b341; --dsh-gp-lane-11:#56d364; }
.dsh-gp * { box-sizing:border-box; }
.dsh-gp-head { display:flex; align-items:center; gap:6px; padding:8px 10px;
  border-bottom:1px solid var(--border); font-weight:600; }
.dsh-gp-head .spacer { flex:1; }
.dsh-gp-btn { border:1px solid var(--border); background:transparent; color:var(--fg);
  border-radius:4px; padding:2px 8px; font-size:11px; cursor:pointer; }
.dsh-gp-btn:hover { background:var(--hover); }
.dsh-gp-btn:disabled { opacity:0.5; cursor:default; }
.dsh-gp-tabs { display:flex; border-bottom:1px solid var(--border); }
.dsh-gp-tab { flex:1; text-align:center; padding:6px 0; cursor:pointer; color:var(--muted); }
.dsh-gp-tab.active { color:var(--accent); border-bottom:2px solid var(--accent); font-weight:600; }
.dsh-gp-body { flex:1; overflow:auto; padding:4px 0; }
.dsh-gp-section { padding:8px 10px 4px; color:var(--muted); font-size:12px; font-weight:600;
  text-transform:uppercase; letter-spacing:0.4px; }
.dsh-gp-branch-search { width:calc(100% - 16px); margin:4px 8px 4px; padding:4px 8px; font-size:12px;
  color:var(--fg); background:var(--panel-bg); border:1px solid var(--border); border-radius:6px; outline:none; box-sizing:border-box; }
.dsh-gp-branch-search:focus { border-color:var(--accent); }
.dsh-gp-row { display:flex; flex-direction:column; gap:2px; padding:6px 10px; cursor:pointer;
  border-radius:6px; margin:1px 4px; transition:background 0.1s ease; }
.dsh-gp-row:hover { background:var(--hover); }
.dsh-gp-row-top { display:flex; align-items:center; gap:6px; min-width:0; }
.dsh-gp-row-top .name { font-weight:600; font-size:12.5px; color:var(--fg); white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; }
.dsh-gp-row-top .badges { display:flex; align-items:center; gap:4px; flex:none; }
.dsh-gp-row-bottom { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--muted); min-width:0; }
.dsh-gp-row-bottom .commit-msg { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; }
.dsh-gp-row-bottom .commit-date { flex:none; opacity:0.85; font-variant-numeric:tabular-nums; }
.dsh-gp-badge { font-size:11px; padding:1px 6px; border-radius:8px; background:var(--panel-bg); color:var(--muted); white-space:nowrap; }
.dsh-gp-badge.current { background:var(--current); color:#fff; }
.dsh-gp-badge.ahead { color:var(--current); }
.dsh-gp-badge.behind { color:var(--accent); }
.dsh-gp-msg { margin:6px 10px; padding:6px 8px; border-radius:4px; font-size:11px;
  background:var(--panel-bg); white-space:pre-wrap; word-break:break-all; }
.dsh-gp-msg.err { border:1px solid var(--danger); color:var(--danger); }
.dsh-gp-msg.ok { border:1px solid var(--current); color:var(--current); }
.dsh-gp-menu-backdrop { position:fixed; inset:0; z-index:950; }
.dsh-gp-menu { position:fixed; z-index:951; min-width:170px; padding:4px;
  background:var(--panel-bg); border:1px solid var(--border); border-radius:8px;
  box-shadow:0 8px 24px rgba(0,0,0,0.18); font-size:12px; }
.dsh-gp-menu-item { padding:6px 10px; border-radius:6px; cursor:pointer; color:var(--fg); white-space:nowrap; }
.dsh-gp-menu-item:hover { background:var(--hover); }
.dsh-gp-menu-item.danger { color:var(--danger); }
.dsh-gp-menu-title { padding:4px 10px 8px; color:var(--muted); font-size:11px; }
.dsh-gp-menu-input { width:100%; box-sizing:border-box; padding:5px 8px; margin-bottom:6px;
  font-size:12px; color:var(--fg); background:var(--bg);
  border:1px solid var(--border); border-radius:6px; outline:none; }
.dsh-gp-menu-input:focus { border-color:var(--accent); }
.dsh-gp-menu-actions { display:flex; gap:6px; padding:2px 2px 4px; }
.dsh-gp-menu-actions .dsh-gp-btn { flex:1; }
.dsh-gp-write { display:flex; flex-direction:column; gap:6px; padding:6px 8px; border-bottom:1px solid var(--border); }
.dsh-gp-write-row { display:flex; gap:6px; align-items:center; }
.dsh-gp-write .dsh-gp-btn { flex:none; }
.dsh-gp-input { flex:1; min-width:0; padding:4px 8px; font-size:12px; color:var(--fg);
  background:var(--panel-bg); border:1px solid var(--border); border-radius:6px; outline:none; }
.dsh-gp-input:focus { border-color:var(--current); }
.dsh-gp-write-status { flex:1; min-width:0; font-size:11px; color:var(--muted);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dsh-gp-write-stash { font-size:11px; color:var(--muted); white-space:pre-wrap; word-break:break-all; }
.dsh-gp-detail-actions { display:flex; gap:6px; margin-top:6px; }
.dsh-gp-detail-actions .dsh-gp-btn { font-size:11px; padding:2px 8px; }
.dsh-gp-changes { border-top:1px solid var(--border); padding:6px 8px; display:flex; flex-direction:column; gap:6px; }
.dsh-gp-conflict-banner { background:rgba(210,153,34,0.15); border:1px solid rgba(210,153,34,0.4);
  color:#d29922; border-radius:6px; padding:4px 8px; font-size:11px; font-weight:600; display:flex; align-items:center; gap:4px; }
[data-ds-dark-theme] .dsh-gp-conflict-banner { color:#e3b341; border-color:rgba(227,179,65,0.4); }
.dsh-gp-changes-group { display:flex; flex-direction:column; gap:2px; }
.dsh-gp-changes-group-head { font-size:10.5px; color:var(--muted); font-weight:600; padding:2px 4px; display:flex; justify-content:space-between; }
.dsh-gp-changes-list { display:flex; flex-direction:column; gap:2px; max-height:140px; overflow-y:auto; }
.dsh-gp-changes-item { display:flex; align-items:center; gap:4px; padding:3px 6px; border-radius:5px;
  font-size:11px; color:var(--fg); cursor:pointer; min-width:0; }
.dsh-gp-changes-item:hover { background:var(--hover); }
.dsh-gp-changes-code { flex:none; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10px;
  color:var(--current); width:20px; font-weight:600; }
.dsh-gp-changes-code.conflict { color:var(--danger); }
.dsh-gp-changes-file { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dsh-gp-file-act { opacity:0; padding:0 3px; font-size:11px; border:none; background:transparent; color:var(--muted); cursor:pointer; border-radius:3px; }
.dsh-gp-changes-item:hover .dsh-gp-file-act { opacity:1; }
.dsh-gp-file-act:hover { background:var(--border); color:var(--fg); }
.dsh-gp-changes-diff { border:1px solid var(--border); border-radius:6px; margin-top:4px; overflow:hidden; }
.dsh-gp-changes-diff .dsh-gp-changes-head { padding:4px 6px; background:var(--panel-bg); }
.dsh-gp-changes-pre { max-height:240px; overflow:auto; font-size:11px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  line-height:1.5; padding:4px 0; margin:0; background:var(--bg); }
.dsh-gp-diff-line { padding:0 6px; white-space:pre-wrap; word-break:break-all; display:flex; gap:8px; }
.dsh-gp-diff-line-num { width:28px; text-align:right; color:var(--muted); opacity:0.6; flex:none; user-select:none; font-variant-numeric:tabular-nums; }
.dsh-gp-diff-line-text { flex:1; min-width:0; }
.dsh-gp-diff-line.add { background:rgba(46,160,67,0.15); color:var(--current); }
.dsh-gp-diff-line.del { background:rgba(248,81,73,0.15); color:var(--danger); }
.dsh-gp-diff-line.hunk { background:rgba(56,139,253,0.15); color:var(--accent); font-weight:600; }
.dsh-gp-changes-empty { padding:8px; font-size:11px; color:var(--muted); }
.dsh-gp-empty { padding:20px 10px; text-align:center; color:var(--muted); }
.dsh-gp-warn { flex:1; display:flex; align-items:center; justify-content:center;
  padding:24px; text-align:center; color:#9a6700; font-size:12px; line-height:1.7; }
[data-ds-dark-theme] .dsh-gp-warn { color:#d4a72c; }
.dsh-gp-detail { border-top:1px solid var(--border); padding:6px 10px; font-size:11px;
  background:var(--panel-bg); max-height:96px; overflow:auto; }
.dsh-gp-col-resize { position:absolute; top:0; height:28px; cursor:col-resize; touch-action:none; z-index:5; }
.dsh-gp-col-resize::after { content:''; position:absolute; left:2.5px; top:6px; bottom:6px;
  width:1px; background:var(--border); opacity:0.7; }
.dsh-gp-col-resize:hover::after, .dsh-gp-col-resize:active::after { background:var(--accent); opacity:1; }
`

let styleInjected = false
function ensureStyle(): void {
  if (styleInjected) return
  styleInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-git-panel'
  tag.textContent = STYLE
  document.head.appendChild(tag)
}

/** 将文本安全追加/填入当前会话的输入框（支持 Lexical 富文本与 React 受控组件） */
function injectTextToChatInput(text: string): boolean {
  const el = document.querySelector<HTMLElement>('[contenteditable="true"], [data-lexical-editor="true"], [role="textbox"], textarea')
  if (!el) return false
  el.focus()

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto = Object.getPrototypeOf(el)
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set ||
                         Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    const cur = el.value || ''
    const next = cur ? `${cur}\n\n${text}` : text
    if (nativeSetter) {
      nativeSetter.call(el, next)
    } else {
      el.value = next
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.selectionStart = el.value.length
    el.selectionEnd = el.value.length
    return true
  }

  const sel = window.getSelection()
  if (sel) {
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  const prefix = el.textContent && el.textContent.trim() !== '' ? '\n\n' : ''
  const success = document.execCommand('insertText', false, prefix + text)
  if (!success) {
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: prefix + text,
    }))
  }
  return true
}

/** 全局常驻操作状态字典：按工作区路径 path 保持 busy 和 message 状态 */
export const GLOBAL_GIT_BUSY_MAP = new Map<string, { busy?: boolean; message?: { text: string; kind: 'ok' | 'err'; showAuthForm?: boolean } | null }>()

/** GitLens 风格的分支行（双行信息分层）：双击激活，右键打开菜单。 */
const BranchRowView = memo(function BranchRowView(props: {
  row: BranchRow
  isRemote: boolean
  current?: string
  busy: boolean
  onActivate: (branch: string) => void
  onPull?: () => void
  onContextMenu: (event: React.MouseEvent, row: BranchRow, isRemote: boolean) => void
}): React.ReactElement {
  const { row, isRemote, current, busy, onActivate, onPull, onContextMenu } = props
  const t = useT()
  const isCurrent = !isRemote && row.name === current
  const badges = [
    !isRemote && row.ahead ? <span key="a" className="dsh-gp-badge ahead">↑{row.ahead}</span> : null,
    !isRemote && row.behind ? (
      <span
        key="b"
        className={`dsh-gp-badge behind ${busy && isCurrent ? 'busy' : ''}`}
        style={{ cursor: isCurrent && !busy ? 'pointer' : 'default' }}
        title={busy && isCurrent ? '正在拉取更新中...' : `落后上游 ${row.behind} 个提交，点击立即拉取更新 (git pull)`}
        onClick={(e) => {
          if (isCurrent && !busy && onPull) {
            e.stopPropagation()
            onPull()
          }
        }}
      >
        ↓{row.behind}
      </span>
    ) : null,
    isCurrent ? <span key="c" className="dsh-gp-badge current">{t('badge.current')}</span> : null,
  ]
  const dateText = row.date ? row.date.slice(5, 16).replace('T', ' ') : ''
  const commitFull = `${row.subject ?? ''}${dateText ? ` (${dateText})` : ''}`
  return (
    <div
      className="dsh-gp-row"
      title={`${row.name}\n${commitFull}`}
      onDoubleClick={() => {
        if (busy) return
        onActivate(row.name)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(event, row, isRemote)
      }}
    >
      <div className="dsh-gp-row-top">
        <span className="name" title={row.name}>{row.name}</span>
        {badges.some(Boolean) ? <div className="badges">{badges}</div> : null}
      </div>
      {row.subject || dateText ? (
        <div className="dsh-gp-row-bottom" title={commitFull}>
          <span className="commit-msg">{row.subject || '—'}</span>
          {dateText ? <span className="commit-date">{dateText}</span> : null}
        </div>
      ) : null}
    </div>
  )
})

/** 共享的图谱几何与文本度量（模块级：稳定的引用）。 */
const ROW_HEIGHT = 24
const LANE_WIDTH = 14
const NODE_RADIUS = 4
const PAD_LEFT = 10
const PAD_TOP = 10
const LANE_COLOR_COUNT = 12

/** 在视口上下额外渲染的行数，保证快速滚动时不闪烁。 */
const GRAPH_BUFFER_ROWS = 10

const laneColor = (lane: number): string => `var(--dsh-gp-lane-${lane % LANE_COLOR_COUNT})`

/** 文本的近似渲染宽度（CJK 字符约为 ASCII 字符的 2 倍）。 */
const labelWidth = (text: string): number =>
  [...text].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 12 : 6.5), 0)

const fitByWidth = (text: string, maxWidth: number): string => {
  let w = 0
  for (let i = 0; i < text.length; i += 1) {
    w += text.charCodeAt(i) > 255 ? 12 : 6.5
    if (w > maxWidth) return `${text.slice(0, i)}…`
  }
  return text
}

/**
 * 图谱标签页的 SVG 主体，按其几何信息做 memo：点击某个节点只更新详情条，
 * 因此 300 个提交的 DOM 在点击时不会重建。被截断的文本按每列的宽度缓存，
 * 因此重渲染时不会逐字符重新遍历每个 subject。只渲染可见视口内（±一个缓冲
 * 区）的行；SVG 保持完整高度，这样滚动条始终正确。
 */
const GraphSvg = memo(function GraphSvg(props: {
  layout: LayoutCommit[]
  graph: GraphView
  textX: number
  commitWidth: number
  labelZone: number
  graphWidth: number
  height: number
  onSelect: (commit: LayoutCommit) => void
}): React.ReactElement {
  const { layout, graph, textX, commitWidth, labelZone, graphWidth, height, onSelect } = props
  const rootRef = useRef<SVGSVGElement>(null)  // 可见行的窗口；Infinity = "尚未测量"（渲染全部内容，
  // 直到 layout effect 测量出真实视口）。
  const [viewport, setViewport] = useState({ first: 0, last: Infinity })

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const scroller = root.closest<HTMLElement>('.dsh-gp-body')
    if (!scroller) return
    const measure = (): void => {
      const rect = root.getBoundingClientRect()
      const srect = scroller.getBoundingClientRect()
      // 用 SVG 自身的坐标空间表示的视口顶部/底部。
      // getBoundingClientRect 已经计入了滚动——这里再加 scrollTop 会让窗口
      // 随用户滚动向下漂移，使图谱下方变空白。
      const v0 = srect.top - rect.top
      const v1 = v0 + scroller.clientHeight
      const first = Math.max(0, Math.floor((v0 - PAD_TOP) / ROW_HEIGHT) - GRAPH_BUFFER_ROWS)
      const last = Math.min(layout.length - 1, Math.ceil((v1 - PAD_TOP) / ROW_HEIGHT) + GRAPH_BUFFER_ROWS)
      setViewport((prev) => (prev.first === first && prev.last === last ? prev : { first, last }))
    }
    measure()
    let raf = 0
    const onScroll = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        measure()
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [layout])

  const bySha = useMemo(() => {
    const map = new Map<string, LayoutCommit>()
    for (const c of layout) map.set(c.sha, c)
    return map
  }, [layout])

  const xOf = (lane: number): number => PAD_LEFT + lane * LANE_WIDTH
  const yOf = (row: number): number => PAD_TOP + row * ROW_HEIGHT

  const tipBranches = useMemo(
    () => Object.entries(graph.tips).filter(([, sha]) => bySha.has(sha)),
    [graph.tips, bySha],
  )
  // 每行一个标签：优先当前分支，然后按名称取第一个。指向同一提交的本地 +
  // 远程分支否则都会堆叠在同一个 y 处。
  const tipLabelByRow = useMemo(() => {
    const byRow = new Map<number, string>()
    const sorted = [...tipBranches].sort(([a], [b]) => {
      const aCur = a === graph.current ? 0 : 1
      const bCur = b === graph.current ? 0 : 1
      return aCur - bCur || a.localeCompare(b)
    })
    for (const [branch, sha] of sorted) {
      const commit = bySha.get(sha)
      if (!commit) continue
      const key = commit.row
      if (!byRow.has(key)) byRow.set(key, branch)
    }
    return byRow
  }, [tipBranches, bySha, graph.current])

  // 缓存截断结果：仅在列宽真正变化时重新计算。
  const subjects = useMemo(
    () => new Map(layout.map((c) => [c.sha, fitByWidth(c.subject, commitWidth - 2)])),
    [layout, commitWidth],
  )
  const tipTexts = useMemo(
    () => new Map([...tipLabelByRow.entries()].map(([row, b]) => [row, fitByWidth(b, labelZone - 6)])),
    [tipLabelByRow, labelZone],
  )

  const isTipCommit = (commit: LayoutCommit): boolean =>
    tipBranches.some(([, sha]) => sha === commit.sha)
  const nodeFill = (commit: LayoutCommit): string => {
    const isCurrentTip = tipBranches.some(([branch, sha]) => sha === commit.sha && branch === graph.current)
    return isCurrentTip ? 'var(--current)' : laneColor(commit.lane)
  }

  const last = Math.min(viewport.last, layout.length - 1)
  const inWindow = (row: number): boolean => row >= viewport.first && row <= last

  const edges: React.ReactElement[] = []
  const nodes: React.ReactElement[] = []
  layout.forEach((commit) => {
    const parents = commit.parents
      .map((parentSha) => bySha.get(parentSha))
      .filter((parent): parent is LayoutCommit => parent !== undefined)
    // 当任一端位于窗口内时就绘制边，这样跨越视口顶部/底部边缘的连线保持连续。
    const drawEdges = inWindow(commit.row) || parents.some((parent) => inWindow(parent.row))
    if (!drawEdges) return
    const x = xOf(commit.lane)
    const y = yOf(commit.row)
    const color = laneColor(commit.lane)
    parents.forEach((parent) => {
      const px = xOf(parent.lane)
      const py = yOf(parent.row)
      if (parent.lane === commit.lane) {
        edges.push(
          <line key={`e-${commit.sha}-${parent.sha}`} x1={x} y1={y} x2={px} y2={py}
            stroke={color} strokeWidth="1.2" opacity="0.85" />,
        )
      } else {
        // GitLens 风格的绕行路径：从子提交 VERTICALLY 离开，在水平方向中途
        // 横扫，再 VERTICALLY 进入父提交。控制点与端点垂直对齐，因此两个
        // 切线都是垂直的。
        const dy = Math.min(12, (py - y) / 2)
        const d = `M ${x} ${y} C ${x} ${y + dy}, ${px} ${py - dy}, ${px} ${py}`
        edges.push(
          <path key={`e-${commit.sha}-${parent.sha}`} d={d} fill="none"
            stroke={color} strokeWidth="1.2" opacity="0.85" />,
        )
      }
    })
    if (!inWindow(commit.row)) return
    nodes.push(
      <g key={`n-${commit.sha}`} onClick={() => onSelect(commit)}>
        <circle cx={x} cy={y} r={NODE_RADIUS + 2} fill="transparent" />
        <circle
          cx={x} cy={y} r={NODE_RADIUS}
          fill={nodeFill(commit)}
          stroke={isTipCommit(commit) ? 'var(--bg)' : 'none'}
          strokeWidth={isTipCommit(commit) ? 1.5 : 0}
        />
        <text x={textX} y={y + 3.5} fontSize="12" fill="var(--fg)" style={{ pointerEvents: 'none' }}>
          {subjects.get(commit.sha) ?? commit.subject}
        </text>
      </g>,
    )
  })

  return (
    <svg ref={rootRef} width={graphWidth} height={height} style={{ display: 'block', cursor: 'default' }}>
      {edges}
      {nodes}
      {[...tipLabelByRow.entries()]
        .filter(([row]) => inWindow(row))
        .map(([row, branch]) => {
          const isCurrent = branch === graph.current
          return (
            <text
              key={`tip-${row}`}
              x={graphWidth - 4}
              y={yOf(row) + 4}
              fontSize="11"
              textAnchor="end"
              fontWeight={isCurrent ? 700 : 400}
              fill={isCurrent ? 'var(--current)' : 'var(--muted)'}
            >
              {tipTexts.get(row) ?? branch}
            </text>
          )
        })}
    </svg>
  )
})

/** 提交图谱标签页（memoized：其 props 只在加载/缩放时变化）。 */
const GraphViewComponent = memo(function GraphViewComponent(props: { graph: GraphView; width: number; onCherryPick?: (sha: string) => void; onRevert?: (sha: string) => void }): React.ReactElement {
  const { graph, width, onCherryPick, onRevert } = props
  const t = useT()
  const [selected, setSelected] = useState<LayoutCommit | null>(null)
  const layout = useMemo(() => layoutGraph(graph.commits), [graph])
  const onSelect = useCallback((commit: LayoutCommit) => setSelected(commit), [])

  const lanes = Math.max(1, ...layout.map((c) => c.lane + 1))
  // 固定 lane 区域的右边缘；提交列在其后开始（见下方 gapOverride 中用户可调
  // 的间隔）。
  const laneRight = PAD_LEFT + lanes * LANE_WIDTH
  const height = PAD_TOP + layout.length * ROW_HEIGHT + 12

  // 三个彼此独立缩放的列：lane（固定宽度）、提交 subject、分支标签。提交列
  // 与分支列各有自己的整列高可拖拽分隔线，因此缩放其一不会影响另一个。
  // 宽度写入 localStorage；0 表示"按最宽的文本自动调整大小"。
  const readSaved = (key: string): number => {
    try {
      const saved = Number(localStorage.getItem(key))
      return Number.isFinite(saved) && saved >= 40 ? saved : 0
    } catch {
      return 0
    }
  }
  const [commitOverride, setCommitOverride] = useState<number>(() => readSaved('dsh-gp-graph-col-commit'))
  const commitRef = useRef(commitOverride)
  useEffect(() => {
    commitRef.current = commitOverride
  }, [commitOverride])

  // 用户在 lane 区域与提交列之间可调的间隔：左侧的标题分隔线会移动提交列的
  // 左边缘，因此它的宽度改变而右边缘保持不变。默认 14px。
  const [gapOverride, setGapOverride] = useState<number>(() => readSaved('dsh-gp-graph-col-gap'))
  const gapRef = useRef(gapOverride)
  useEffect(() => {
    gapRef.current = gapOverride
  }, [gapOverride])
  const gap = gapOverride > 0 ? gapOverride : 14
  const textX = laneRight + gap

  // 分支列有固定且较宽的宽度（不可缩放）；只有提交列是用户可调的。图谱会随
  // 提交列 GROW——加宽它会让整个图谱变宽，面板随之水平滚动，因此分支列保持
  // 自己的宽度。
  const BRANCH_COL_WIDTH = 240
  const maxSubjectWidth = Math.max(0, ...layout.map((c) => labelWidth(c.subject)))
  const autoCommit = Math.max(60, maxSubjectWidth + 16)
  const commitWidth = commitOverride > 0 ? commitOverride : autoCommit
  const labelZone = BRANCH_COL_WIDTH
  const commitRight = textX + commitWidth
  const graphWidth = Math.max(width - 16, commitRight + labelZone + 8)
  const labelLeft = graphWidth - labelZone

  const startResize = (
    key: string,
    valueRef: React.MutableRefObject<number>,
    set: (v: number) => void,
    start: number,
    min: number,
    max: number,
  ): ((event: React.PointerEvent) => void) => (event) => {
    event.preventDefault()
    event.stopPropagation()
    const startClientX = event.clientX
    const onMove = (ev: PointerEvent): void => {
      set(Math.min(max, Math.max(min, start + (ev.clientX - startClientX))))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      try {
        localStorage.setItem(key, String(valueRef.current))
      } catch {
        /* 存储不可用——保留内存中的值 */
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const resetResize = (key: string, set: (v: number) => void): (() => void) => () => {
    set(0)
    try {
      localStorage.removeItem(key)
    } catch {
      /* 忽略 */
    }
  }
  // 拖拽标题栏分隔线只会移动提交列；分支列是固定的。上限很宽松：多余的宽度
  // 只是让图谱水平滚动而已。
  const startCommitResize = startResize('dsh-gp-graph-col-commit', commitRef, setCommitOverride, commitWidth, 60, 900)
  // 左侧分隔线移动提交列的 LEFT 边缘：它的宽度变化而右边缘固定。
  const startLeftResize = (event: React.PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const startClientX = event.clientX
    const startCommitRight = commitRight
    const startGap = gap
    const onMove = (ev: PointerEvent): void => {
      const maxGap = Math.max(4, startCommitRight - laneRight - 60)
      const minGap = Math.max(4, startCommitRight - laneRight - 900)
      const next = Math.min(maxGap, Math.max(minGap, startGap + (ev.clientX - startClientX)))
      setGapOverride(next)
      setCommitOverride(startCommitRight - (laneRight + next))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      try {
        localStorage.setItem('dsh-gp-graph-col-gap', String(gapRef.current))
        localStorage.setItem('dsh-gp-graph-col-commit', String(commitRef.current))
      } catch {
        /* 存储不可用——保留内存中的值 */
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div style={{ padding: '0 8px', position: 'relative', width: 'max-content' }}>
      {/* 三列表头，标题在各列起点从左到右排布。两条可拖拽分隔线夹着提交列：
          左侧的移动它的左边缘，右侧的移动它的右边缘。 */}
      <div
        style={{
          position: 'relative',
          width: graphWidth,
          height: 28,
          fontSize: 13,
          color: 'var(--muted)',
          userSelect: 'none',
        }}
      >
        <span style={{ position: 'absolute', left: PAD_LEFT, top: 8, fontWeight: 600 }}>{t('graph.col.lanes')}</span>
        {lanes >= 2 ? (
          <div
            className="dsh-gp-col-resize"
            title={t('graph.col.resize')}
            onPointerDown={startLeftResize}
            onDoubleClick={resetResize('dsh-gp-graph-col-gap', setGapOverride)}
            style={{ left: textX - 10, width: 6 }}
          />
        ) : null}
        <span style={{ position: 'absolute', left: textX, top: 8, fontWeight: 600 }}>{t('graph.col.commit')}</span>
        <div
          className="dsh-gp-col-resize"
          title={t('graph.col.resize')}
          onPointerDown={startCommitResize}
          onDoubleClick={resetResize('dsh-gp-graph-col-commit', setCommitOverride)}
          style={{ left: commitRight - 3, width: 6 }}
        />
        <span style={{ position: 'absolute', left: labelLeft, top: 8, fontWeight: 600 }}>{t('graph.col.branch')}</span>
      </div>
      <GraphSvg
        layout={layout}
        graph={graph}
        textX={textX}
        commitWidth={commitWidth}
        labelZone={labelZone}
        graphWidth={graphWidth}
        height={height}
        onSelect={onSelect}
      />
      {selected ? (
        <div className="dsh-gp-detail">
          <div><b>{selected.subject}</b></div>
          <div>{selected.sha} · {selected.author} · {selected.date}</div>
          {onCherryPick !== undefined || onRevert !== undefined ? (
            <div className="dsh-gp-detail-actions">
              {onCherryPick !== undefined ? (
                <button type="button" className="dsh-gp-btn" onClick={() => onCherryPick(selected.sha)}>{t('op.cherryPick')}</button>
              ) : null}
              {onRevert !== undefined ? (
                <button type="button" className="dsh-gp-btn" onClick={() => onRevert(selected.sha)}>{t('op.revert')}</button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

/** 完整的面板。 */
export function GitPanel(props: {
  path: string
  api: GitPanelApi
  /** 在右侧栏以完整 Git 对比视图打开一个变更文件；返回是否成功。 */
  onOpenDiff?: (file: string) => boolean
  /** 写操作后刷新变更缓存（文件树装饰共用）。 */
  onRefreshStatus?: () => void
}): React.ReactElement {
  const { path, api, onOpenDiff, onRefreshStatus } = props
  const t = useT()
  const [tab, setTab] = useState<'branches' | 'graph'>('branches')
  const [branches, setBranches] = useState<BranchesView | null>(null)
  const [graph, setGraph] = useState<GraphView | null>(null)
  const [loading, setLoading] = useState(false)
  // 对进行中的加载做单调递增保护（见 load()）。
  const loadSeq = useRef(0)
  const [busy, setBusyState] = useState(() => GLOBAL_GIT_BUSY_MAP.get(path)?.busy ?? false)
  const [message, setMessageState] = useState<{ text: string; kind: 'ok' | 'err'; showAuthForm?: boolean } | null>(() => GLOBAL_GIT_BUSY_MAP.get(path)?.message ?? null)

  const setBusy = (val: boolean): void => {
    setBusyState(val)
    const cur = GLOBAL_GIT_BUSY_MAP.get(path) || {}
    GLOBAL_GIT_BUSY_MAP.set(path, { ...cur, busy: val })
  }
  const setMessage = (msg: { text: string; kind: 'ok' | 'err'; showAuthForm?: boolean } | null): void => {
    setMessageState(msg)
    const cur = GLOBAL_GIT_BUSY_MAP.get(path) || {}
    GLOBAL_GIT_BUSY_MAP.set(path, { ...cur, message: msg })
  }

  // 会话切换回来时，若全局正在执行后台操作，恢复视图上的状态
  useEffect(() => {
    const globalState = GLOBAL_GIT_BUSY_MAP.get(path)
    if (globalState) {
      if (globalState.busy !== undefined) setBusyState(globalState.busy)
      if (globalState.message !== undefined) setMessageState(globalState.message)
    }
  }, [path])
  const [width, setWidth] = useState(300)
  // 右键上下文菜单。
  const [menu, setMenu] = useState<{
    x: number
    y: number
    row: BranchRow
    isRemote: boolean
    isCurrent: boolean
  } | null>(null)
  const [menuMode, setMenuMode] = useState<'main' | 'rename' | 'confirm-delete'>('main')
  const [renameValue, setRenameValue] = useState('')
  // 写操作：提交信息、变更状态、暂存列表。
  const [commitMsg, setCommitMsg] = useState('')
  const [statusText, setStatusText] = useState('')
  const [stashText, setStashText] = useState('')
  // 变更文件列表 + 选中的文件 diff。
  const [changes, setChanges] = useState<Array<{ code: string; file: string }>>([])
  const [diffState, setDiffState] = useState<{ file: string; content: string; busy: boolean } | null>(null)
  // 分支名快速搜索过滤。
  const [branchSearch, setBranchSearch] = useState('')

  ensureStyle()

  const load = useCallback(async () => {
    if (!path) return
    // 会话切换：在加载新路径前丢弃上一个仓库的数据，这样一次失败的加载永不
    // 会在屏幕上留下过期的分支。序列号保护会丢弃在新路径再次改变之后才返回的
    // 响应（来自旧会话的在途请求绝不能落地）。
    const seq = ++loadSeq.current
    setLoading(true)
    setBranches(null)
    setGraph(null)
    setMessage(null)
    const [b, g] = await Promise.all([api.branches(path), api.graph(path)])
    if (seq !== loadSeq.current) return
    if (b.ok) setBranches(b.value)
    if (g.ok) setGraph(g.value)
    if (!b.ok) setMessage({ text: b.error.message, kind: 'err' })
    else if (!g.ok) setMessage({ text: g.error.message, kind: 'err' })
    setLoading(false)
  }, [path, api])

  useEffect(() => {
    void load()
  }, [load])

  // ---- 写操作（commit / push / stash） ----
  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!path) return
    const result = await api.status(path)
    const output = result.ok ? result.value.output : ''
    setStatusText(output)
    // 解析 porcelain 行：状态码 + 路径。
    const list: Array<{ code: string; file: string }> = []
    for (const line of output.split('\n')) {
      const m = line.match(/^(\S+)\s+(.+)$/)
      if (m !== null) list.push({ code: m[1], file: m[2] })
    }
    setChanges(list)
  }, [path, api])

  /** 加载某文件的 diff。 */
  const loadDiff = useCallback(async (file: string): Promise<void> => {
    if (!path) return
    setDiffState({ file, content: '', busy: true })
    const result = await api.diffFile(path, file)
    setDiffState({ file, content: result.ok ? result.value.output : result.error?.message ?? '', busy: false })
  }, [path, api])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const runWrite = useCallback(async (action: 'commit' | 'push' | 'stash-push' | 'stash-pop' | 'stage' | 'unstage' | 'discard', extra?: string): Promise<void> => {
    if (!path || busy) return
    setBusy(true)
    setMessage(null)
    let result: { ok: boolean; output?: string; error?: { code: string; message: string } }
    try {
      if (action === 'commit') {
        result = await api.commit(path, extra ?? commitMsg)
      } else if (action === 'push') {
        result = await api.push(path)
      } else if (action === 'stash-push') {
        result = await api.stashPush(path, extra)
      } else if (action === 'stash-pop') {
        result = await api.stashPop(path)
      } else if (action === 'stage') {
        result = await api.stageFile(path, extra ?? '')
      } else if (action === 'unstage') {
        result = await api.unstageFile(path, extra ?? '')
      } else {
        const [file, untracked] = (extra ?? '').split('|')
        result = await api.discardFile(path, file, untracked === 'untracked')
      }
    } catch (error) {
      result = { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } }
    }
    setBusy(false)
    if (result.ok) {
      setMessage({ text: result.output ?? t('op.ok'), kind: 'ok' })
      if (action === 'commit' || action === 'stash-pop') setCommitMsg('')
      void refreshStatus()
      void load()
      onRefreshStatus?.()
    } else {
      let errMsg = result.error?.message ?? t('op.failed')
      let showAuthForm = false
      if (errMsg.includes('OAuth') || errMsg.includes('Authentication') || errMsg.includes('fatal: could not read Username') || errMsg.includes('terminal prompts disabled')) {
        errMsg = '⚠️ 缺少 GitLab 访问凭据或认证失败，请在下方直接输入账号密码即可一键保存：'
        showAuthForm = true
      }
      setMessage({ text: errMsg, kind: 'err', showAuthForm })
    }
  }, [path, api, busy, commitMsg, t, refreshStatus, load, onRefreshStatus])

  // 输入 dock 的 chip 会在一次成功的分支切换后派发这个事件。
  useEffect(() => {
    const onSwitched = (): void => {
      void load()
    }
    window.addEventListener('dsh-git-panel:switched', onSwitched)
    return () => window.removeEventListener('dsh-git-panel:switched', onSwitched)
  }, [load])

  useEffect(() => {
    const measure = (): void => setWidth(Math.max(240, (document.querySelector('[data-git-panel-col]')?.clientWidth ?? 300) - 16))
    measure()
    const observer = new ResizeObserver(measure)
    const col = document.querySelector('[data-git-panel-col]')
    if (col) observer.observe(col)
    return () => observer.disconnect()
  }, [])

  if (!path) {
    return (
      <div className="dsh-gp">
        <div className="dsh-gp-head">{t('panel.title')}</div>
        <div className="dsh-gp-empty">{t('panel.empty')}</div>
      </div>
    )
  }

  const runOp = useCallback(async (label: string, op: () => Promise<Envelope<OpResult>>): Promise<void> => {
    setBusy(true)
    setMessage({ text: `⏳ 正在执行 ${label}...`, kind: 'ok' })
    const result = await op()
    if (result.ok) {
      setMessage({ text: result.value.output || t('op.done', { label }), kind: 'ok' })
      await load()
    } else {
      let errMsg = result.error.message || '操作失败'
      let showAuthForm = false
      if (errMsg.includes('OAuth') || errMsg.includes('Authentication') || errMsg.includes('fatal: could not read Username') || errMsg.includes('terminal prompts disabled')) {
        errMsg = '⚠️ 缺少 GitLab 访问凭据或认证失败，请在下方直接输入账号密码即可一键保存：'
        showAuthForm = true
      } else if (errMsg.includes('timed out') || errMsg.includes('超时')) {
        errMsg = '⚠️ 操作超时：网络连接失败或远程服务器无响应。'
      }
      setMessage({ text: errMsg, kind: 'err', showAuthForm })
    }
    setBusy(false)
  }, [load, t])

  const repoName = branches?.repo ?? ''

  // ---- 上下文菜单操作 ----
  // 稳定的引用，使被 memo 化的 BranchRowView 不会因无关状态变化（message、
  // menu、tab…）而重渲染。
  const openMenu = useCallback((event: React.MouseEvent, row: BranchRow, isRemote: boolean): void => {
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 180),
      row,
      isRemote,
      isCurrent: !isRemote && row.name === branches?.current,
    })
    setMenuMode('main')
    setRenameValue(row.name)
  }, [branches?.current])

  const activateLocal = useCallback((branch: string): void => {
    if (branch === branches?.current) {
      void runOp(t('op.pull'), () => api.pull(path))
    } else {
      void runOp(t('op.switch'), () => api.switchBranch(path, branch))
    }
  }, [branches?.current, runOp, api, path])

  const activateRemote = useCallback((branch: string): void => {
    void runOp(t('op.checkout'), () => api.switchBranch(path, branch))
  }, [runOp, api, path])

  const closeMenu = (): void => setMenu(null)

  const confirmRename = async (): Promise<void> => {
    if (!menu) return
    const name = renameValue.trim()
    if (name === '' || name === menu.row.name) {
      closeMenu()
      return
    }
    // 对 git 引用名做基本合理性检查：不允许空格或 git 禁止的字符。
    if (!/^[^\s~^:?*[\\]+$/.test(name) || name.startsWith('-')) {
      setMessage({ text: t('error.invalidName', { name }), kind: 'err' })
      return
    }
    const current = menu.row.name
    closeMenu()
    await runOp(t('op.rename'), () => api.renameBranch(path, current, name))
  }

  const confirmDelete = async (): Promise<void> => {
    if (!menu) return
    const { row, isRemote } = menu
    closeMenu()
    if (isRemote) {
      await runOp(t('op.deleteRemote'), () => api.deleteRemoteBranch(path, row.name))
    } else {
      await runOp(t('op.delete'), () => api.deleteBranch(path, row.name))
    }
  }

  const mergeInto = async (): Promise<void> => {
    if (!menu) return
    const branch = menu.row.name
    closeMenu()
    await runOp(t('op.merge', { branch }), () => api.mergeBranch(path, branch))
  }

  return (
    <div className="dsh-gp">
      <div className="dsh-gp-head">
        <span>{t('panel.title')}</span>
        <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>{repoName}</span>
        <span className="spacer" />
        <button className="dsh-gp-btn" disabled={loading || busy} onClick={() => void load()} title={t('op.refresh')}>
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3" />
          </svg>
        </button>
      </div>
      <div className="dsh-gp-tabs">
        <div className={`dsh-gp-tab${tab === 'branches' ? ' active' : ''}`} onClick={() => setTab('branches')}>{t('tab.branches')}</div>
        <div className={`dsh-gp-tab${tab === 'graph' ? ' active' : ''}`} onClick={() => setTab('graph')}>{t('tab.graph')}</div>
      </div>
      <div className="dsh-gp-write">
        <div className="dsh-gp-write-row">
          <input className="dsh-gp-input" value={commitMsg} placeholder={t('write.commit.placeholder')}
            onChange={(event) => setCommitMsg(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && commitMsg.trim() !== '') void runWrite('commit')
            }} />
          <button className="dsh-gp-btn" disabled={busy || commitMsg.trim() === ''}
            onClick={() => void runWrite('commit')}>{t('write.commit')}</button>
          <button className="dsh-gp-btn" disabled={busy}
            onClick={() => void runWrite('push')}>{t('write.push')}</button>
          <button className="dsh-gp-btn" disabled={busy}
            onClick={() => void runWrite('sync' as any)}>{t('write.sync')}</button>
        </div>
        <div className="dsh-gp-write-row">
          <button className="dsh-gp-btn" disabled={busy}
            onClick={() => void runWrite('stash-push')}>{t('write.stash')}</button>
          <button className="dsh-gp-btn" disabled={busy}
            onClick={() => void runWrite('stash-pop')}>{t('write.stashPop')}</button>
          <button className="dsh-gp-btn" disabled={busy} onClick={() => void refreshStatus()}>{t('write.status')}</button>
          <span className="dsh-gp-write-status" title={statusText}>{statusText.split('\n')[0] ?? ''}</span>
        </div>
        {stashText !== '' ? <div className="dsh-gp-write-stash">{stashText}</div> : null}
        {(() => {
          if (changes.length === 0) return null
          const conflicts = changes.filter((c) => c.code === 'UU' || c.code === 'AA' || c.code === 'UD' || c.code === 'DU')
          const staged = changes.filter((c) => c.code[0] !== ' ' && c.code[0] !== '?' && !conflicts.includes(c))
          const unstaged = changes.filter((c) => (c.code[1] !== ' ' || c.code === '??') && !conflicts.includes(c))

          return (
            <div className="dsh-gp-changes">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0 4px', fontSize: 11, color: 'var(--muted)' }}>
                <span>{t('changes.title')} ({changes.length})</span>
                <button type="button" className="dsh-gp-btn"
                  title={t('changes.sendToChat')}
                  style={{ fontSize: 11, padding: '1px 6px' }}
                  onClick={() => {
                    const fileLines = changes.map(c => `- \`${c.code}\` ${c.file}`).join('\n')
                    const prompt = `当前 Git 工作区有以下 ${changes.length} 处变更：\n${fileLines}\n\n请帮我检查这些更改并根据规范生成清晰的 Git Commit Message。`
                    if (injectTextToChatInput(prompt)) {
                      setMessage({ kind: 'ok', text: t('changes.sentSuccess') })
                    }
                  }}>
                  💬 {t('changes.sendToChat')}
                </button>
              </div>
              {conflicts.length > 0 ? (
                <div className="dsh-gp-conflict-banner">
                  ⚠️ {t('changes.conflicts', { count: String(conflicts.length) })}
                </div>
              ) : null}

              {conflicts.length > 0 ? (
                <div className="dsh-gp-changes-group">
                  <div className="dsh-gp-changes-group-head" style={{ color: 'var(--danger)' }}>
                    <span>{t('changes.conflictsGroup')} ({conflicts.length})</span>
                  </div>
                  <div className="dsh-gp-changes-list">
                    {conflicts.map((c) => (
                      <div key={c.file} className="dsh-gp-changes-item" onClick={() => void loadDiff(c.file)}>
                        <span className="dsh-gp-changes-code conflict">{c.code}</span>
                        <span className="dsh-gp-changes-file" title={c.file}>{c.file}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {staged.length > 0 ? (
                <div className="dsh-gp-changes-group">
                  <div className="dsh-gp-changes-group-head">
                    <span>{t('changes.staged')} ({staged.length})</span>
                  </div>
                  <div className="dsh-gp-changes-list">
                    {staged.map((c) => (
                      <div key={c.file} className="dsh-gp-changes-item" onClick={() => void loadDiff(c.file)}>
                        <span className="dsh-gp-changes-code">{c.code}</span>
                        <span className="dsh-gp-changes-file" title={c.file}>{c.file}</span>
                        <button type="button" className="dsh-gp-file-act" title={t('changes.copyPath')}
                          onClick={(e) => {
                            e.stopPropagation()
                            try {
                              navigator.clipboard.writeText(c.file)
                              setMessage({ kind: 'ok', text: t('changes.copyPathDone') })
                            } catch {}
                          }}>📋</button>
                        <button type="button" className="dsh-gp-file-act" title={t('changes.fileToChat')}
                          onClick={(e) => {
                            e.stopPropagation()
                            const prompt = `请帮我分析已暂存文件：\`${c.file}\``
                            if (injectTextToChatInput(prompt)) {
                              setMessage({ kind: 'ok', text: t('changes.sentSuccess') })
                            }
                          }}>💬</button>
                        <button type="button" className="dsh-gp-file-act" title={t('changes.unstage')}
                          onClick={(e) => { e.stopPropagation(); void runWrite('unstage' as any, c.file) }}>−</button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {unstaged.length > 0 ? (
                <div className="dsh-gp-changes-group">
                  <div className="dsh-gp-changes-group-head">
                    <span>{t('changes.unstaged')} ({unstaged.length})</span>
                  </div>
                  <div className="dsh-gp-changes-list">
                    {unstaged.map((c) => (
                      <div key={c.file} className="dsh-gp-changes-item"
                        title="点击在右侧栏打开完整 Git 对比（VS Code 风格）"
                        onClick={() => {
                          if (onOpenDiff?.(c.file) === true) return
                          void loadDiff(c.file)
                        }}>
                        <span className="dsh-gp-changes-code">{c.code}</span>
                        <span className="dsh-gp-changes-file" title={c.file}>{c.file}</span>
                        <button type="button" className="dsh-gp-file-act" title="内嵌查看 diff"
                          onClick={(e) => { e.stopPropagation(); void loadDiff(c.file) }}>≡</button>
                        <button type="button" className="dsh-gp-file-act" title={t('changes.copyPath')}
                          onClick={(e) => {
                            e.stopPropagation()
                            try {
                              navigator.clipboard.writeText(c.file)
                              setMessage({ kind: 'ok', text: t('changes.copyPathDone') })
                            } catch {}
                          }}>📋</button>
                        <button type="button" className="dsh-gp-file-act" title={t('changes.fileToChat')}
                          onClick={(e) => {
                            e.stopPropagation()
                            const prompt = `请帮我分析并处理该文件的改动：\`${c.file}\``
                            if (injectTextToChatInput(prompt)) {
                              setMessage({ kind: 'ok', text: t('changes.sentSuccess') })
                            }
                          }}>💬</button>
                        <button type="button" className="dsh-gp-file-act" title={t('changes.stage')}
                          onClick={(e) => { e.stopPropagation(); void runWrite('stage' as any, c.file) }}>+</button>
                        <button type="button" className="dsh-gp-file-act" title={t('changes.discard')}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (window.confirm(t('changes.discardConfirm', { file: c.file }))) {
                              void runWrite('discard' as any, `${c.file}|${c.code === '??' ? 'untracked' : ''}`)
                            }
                          }}>↩</button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {diffState !== null ? (
                <div className="dsh-gp-changes-diff">
                  <div className="dsh-gp-changes-head" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('changes.diff')}: {diffState.file}</span>
                    <button type="button" className="dsh-gp-btn"
                      title={t('changes.diffToChat')}
                      style={{ marginLeft: 'auto', fontSize: 11, padding: '0 6px', whiteSpace: 'nowrap' }}
                      onClick={() => {
                        const prompt = `请帮我 Review 文件 \`${diffState.file}\` 的以下 Diff 改动：\n\`\`\`diff\n${diffState.content.slice(0, 8000)}\n\`\`\``
                        if (injectTextToChatInput(prompt)) {
                          setMessage({ kind: 'ok', text: t('changes.sentSuccess') })
                        }
                      }}>
                      💬 {t('changes.diffToChat')}
                    </button>
                    <button type="button" className="dsh-gp-btn"
                      onClick={() => setDiffState(null)} style={{ fontSize: 11, padding: '0 6px' }}>
                      ✕
                    </button>
                  </div>
                  {diffState.busy ? (
                    <div className="dsh-gp-changes-empty">…</div>
                  ) : diffState.content === '' ? (
                    <div className="dsh-gp-changes-empty">{t('changes.empty')}</div>
                  ) : (
                    <div className="dsh-gp-changes-pre">
                      {(() => {
                        let oldNum = 0
                        let newNum = 0
                        return diffState.content.slice(0, 30000).split('\n').map((line, idx) => {
                          let kind = ''
                          let numStr = ''
                          if (line.startsWith('@@')) {
                            kind = 'hunk'
                            const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
                            if (m) {
                              oldNum = parseInt(m[1], 10)
                              newNum = parseInt(m[2], 10)
                            }
                            numStr = '@@'
                          } else if (line.startsWith('+') && !line.startsWith('+++')) {
                            kind = 'add'
                            numStr = String(newNum++)
                          } else if (line.startsWith('-') && !line.startsWith('---')) {
                            kind = 'del'
                            numStr = String(oldNum++)
                          } else if (line.startsWith(' ') || line === '') {
                            numStr = String(newNum++)
                            oldNum++
                          }
                          return (
                            <div key={idx} className={`dsh-gp-diff-line ${kind}`}>
                              <span className="dsh-gp-diff-line-num">{numStr}</span>
                              <span className="dsh-gp-diff-line-text">{line || ' '}</span>
                            </div>
                          )
                        })
                      })()}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )
        })()}
      </div>
      <div className="dsh-gp-body">
        {loading && !branches && !graph ? <div className="dsh-gp-empty">{t('loading')}</div> : null}
        {!loading && message && !branches && !graph ? (
          <div className="dsh-gp-warn">{message.text}</div>
        ) : null}
        {message && (branches || graph) ? (
          <div className={`dsh-gp-msg ${message.kind}`}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>{message.text}</span>
              {busy ? (
                <button
                  type="button"
                  className="dsh-gp-btn"
                  style={{ fontSize: 10, padding: '1px 6px', flex: 'none' }}
                  onClick={() => {
                    setBusy(false)
                    setMessage({ text: '已取消当前操作等待', kind: 'ok' })
                  }}
                >
                  ✕ 取消
                </button>
              ) : null}
            </div>
            {message.showAuthForm ? (
              <div style={{
                background: 'rgba(128,128,128,0.12)',
                padding: 8,
                borderRadius: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                marginTop: 4,
              }}>
                <div style={{ fontWeight: 600, fontSize: 11 }}>🔑 在此原位配置 Git 访问凭据（免终端配置，自动保存）：</div>
                <input
                  id="dsh-git-auth-user"
                  className="dsh-gp-input"
                  placeholder="用户名（或邮箱前缀，如 jaden.tang）"
                  defaultValue="jaden.tang"
                />
                <input
                  id="dsh-git-auth-pass"
                  type="password"
                  className="dsh-gp-input"
                  placeholder="密码或 GitLab Personal Access Token"
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 2 }}>
                  <button
                    type="button"
                    className="dsh-gp-btn"
                    onClick={async () => {
                      const u = (document.getElementById('dsh-git-auth-user') as HTMLInputElement)?.value.trim()
                      const p = (document.getElementById('dsh-git-auth-pass') as HTMLInputElement)?.value.trim()
                      if (!u || !p) {
                        alert('请填写用户名和密码/Token')
                        return
                      }
                      setMessage({ text: '正在保存凭据并自动配置...', kind: 'ok' })
                      const res = await api.setCredential(path, 'gitlab.sjfood.us', u, p)
                      if (res.ok) {
                        setMessage({ text: '✅ 凭据已成功保存！正在自动为您重试拉取/同步...', kind: 'ok' })
                        void runOp(t('op.pull'), () => api.pull(path))
                      } else {
                        setMessage({ text: `保存失败: ${res.error?.message}`, kind: 'err' })
                      }
                    }}
                  >
                    💾 记住凭据并立即重试
                  </button>
                  <button
                    type="button"
                    className="dsh-gp-btn"
                    onClick={() => setMessage(null)}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'branches' && branches ? (
          <>
            <input
              className="dsh-gp-branch-search"
              value={branchSearch}
              placeholder={t('branches.search')}
              onChange={(e) => setBranchSearch(e.target.value)}
            />
            {(() => {
              const q = branchSearch.trim().toLowerCase()
              const match = (name: string): boolean => q === '' || name.toLowerCase().includes(q)
              const localFiltered = branches.local.filter((r) => match(r.name) || (r.subject && r.subject.toLowerCase().includes(q)))
              const remoteFiltered = branches.remote.filter((r) => match(r.name) || (r.subject && r.subject.toLowerCase().includes(q)))
              return (
                <>
                  <div className="dsh-gp-section">{t('section.local')} ({localFiltered.length})</div>
                  {localFiltered.length === 0 ? <div className="dsh-gp-empty">{t('empty.local')}</div> : null}
                  {localFiltered.map((row) => (
                    <BranchRowView
                      key={row.name}
                      row={row}
                      isRemote={false}
                      current={branches.current}
                      busy={busy}
                      onActivate={activateLocal}
                      onPull={() => void runOp(t('op.pull'), () => api.pull(path))}
                      onContextMenu={openMenu}
                    />
                  ))}
                  <div className="dsh-gp-section">{t('section.remote')} ({remoteFiltered.length})</div>
                  {remoteFiltered.length === 0 ? <div className="dsh-gp-empty">{t('empty.remote')}</div> : null}
                  {remoteFiltered.map((row) => (
                    <BranchRowView
                      key={row.name}
                      row={row}
                      isRemote
                      current={branches.current}
                      busy={busy}
                      onActivate={activateRemote}
                      onContextMenu={openMenu}
                    />
                  ))}
                </>
              )
            })()}
            <div style={{ padding: 8 }}>
              <button className="dsh-gp-btn" disabled={busy} onClick={() => void runOp(t('fetch.all'), () => api.fetchAll(path))}>
                {t('fetch.all')}
              </button>
            </div>
          </>
        ) : null}

        {tab === 'graph' && graph ? (
          <GraphViewComponent
            graph={graph}
            width={width}
            onCherryPick={(sha) => void runOp(t('op.cherryPick'), () => api.cherryPick(path, sha))}
            onRevert={(sha) => void runOp(t('op.revert'), () => api.revertCommit(path, sha))}
          />
        ) : null}
      </div>

      {menu ? (
        <>
          <div className="dsh-gp-menu-backdrop" onClick={closeMenu}
            onContextMenu={(event) => { event.preventDefault(); closeMenu() }} />
          <div className="dsh-gp-menu" style={{ left: menu.x, top: menu.y }}>
            {menuMode === 'rename' ? (
              <>
                <div className="dsh-gp-menu-title">{t('menu.title.rename', { name: menu.row.name })}</div>
                <input
                  className="dsh-gp-menu-input"
                  value={renameValue}
                  autoFocus
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void confirmRename()
                    if (event.key === 'Escape') setMenuMode('main')
                  }}
                />
                <div className="dsh-gp-menu-actions">
                  <button className="dsh-gp-btn" onClick={() => void confirmRename()}>{t('menu.confirm')}</button>
                  <button className="dsh-gp-btn" onClick={() => setMenuMode('main')}>{t('menu.cancel')}</button>
                </div>
              </>
            ) : menuMode === 'confirm-delete' ? (
              <>
                <div className="dsh-gp-menu-title">
                  {menu.isRemote
                    ? t('menu.title.deleteRemote', { name: menu.row.name })
                    : t('menu.title.delete', { name: menu.row.name })}
                </div>
                <div className="dsh-gp-menu-actions">
                  <button className="dsh-gp-btn" style={{ color: 'var(--danger)' }}
                    onClick={() => void confirmDelete()}>{t('menu.delete')}</button>
                  <button className="dsh-gp-btn" onClick={() => setMenuMode('main')}>{t('menu.cancel')}</button>
                </div>
              </>
            ) : (
              <>
                <div className="dsh-gp-menu-item" onClick={() => {
                  if (navigator?.clipboard?.writeText) {
                    void navigator.clipboard.writeText(menu.row.name)
                    setMessage({ text: `${t('menu.copyName.done')}: ${menu.row.name}`, kind: 'ok' })
                  }
                  closeMenu()
                }}>{t('menu.copyName')}</div>
                {menu.isCurrent ? (
                  <div
                    className={`dsh-gp-menu-item ${busy ? 'disabled' : ''}`}
                    style={busy ? { opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' } : undefined}
                    onClick={() => {
                      if (busy) return
                      closeMenu()
                      void runOp(t('op.pull'), () => api.pull(path))
                    }}
                  >
                    {busy ? '⏳ 正在同步中...' : '⬇️ 拉取更新 (Pull)'}
                  </div>
                ) : null}
                <div
                  className={`dsh-gp-menu-item ${busy ? 'disabled' : ''}`}
                  style={busy ? { opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' } : undefined}
                  onClick={() => {
                    if (busy) return
                    closeMenu()
                    void runOp(t('fetch.all'), () => api.fetchAll(path))
                  }}
                >
                  {busy ? '⏳ 正在同步中...' : '🔄 抓取全部 (Fetch all)'}
                </div>
                <div className="dsh-gp-menu-item" onClick={() => setMenuMode('rename')}>{t('menu.rename')}</div>
                {!menu.isCurrent && !menu.isRemote ? (
                  <div className="dsh-gp-menu-item danger" onClick={() => setMenuMode('confirm-delete')}>{t('menu.delete')}</div>
                ) : null}
                {menu.isRemote ? (
                  <div className="dsh-gp-menu-item danger" onClick={() => setMenuMode('confirm-delete')}>{t('menu.deleteRemote')}</div>
                ) : null}
                {!menu.isCurrent ? (
                  <div className="dsh-gp-menu-item" onClick={() => void mergeInto()}>{t('menu.merge')}</div>
                ) : null}
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
