/**
 * git 面板的 React 界面：分支列表（本地/远程，含 ahead/behind，
 * 可切换/拉取/抓取）以及带 lane 的 GitLens 风格提交图谱。
 * @module dsh-git-panel/client/Panel
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BranchesView, BranchRow, GraphView, OpResult } from '../core/types.ts'
import type { Envelope, GitPanelApi } from './api.ts'
import { runBatch } from './batch-stage.ts'
import { classifyChanges } from './change-groups.ts'
import { layoutGraph, type LayoutCommit } from './graph.ts'
import { tError, useT } from './i18n.ts'
import { icon, type IconName } from './icons.tsx'
import { hideTip, showTip } from './tooltip.ts'

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
/* 操作进行中的 loading：转圈 spinner + 顶部不确定进度条 */
@keyframes dsh-gp-spin { to { transform: rotate(360deg); } }
@keyframes dsh-gp-slide { 0% { left:-40%; width:40%; } 50% { width:60%; } 100% { left:100%; width:40%; } }
.dsh-gp-spinner { display:inline-block; width:11px; height:11px; flex:none; border-radius:50%;
  border:1.5px solid currentColor; border-top-color:transparent; animation:dsh-gp-spin .7s linear infinite;
  vertical-align:-1px; }
.dsh-gp-spinner.lg { width:13px; height:13px; border-width:2px; }
.dsh-gp-progress { position:relative; height:2px; overflow:hidden; flex:none;
  background:color-mix(in srgb, var(--accent) 18%, transparent); }
.dsh-gp-progress::before { content:''; position:absolute; top:0; bottom:0; background:var(--accent);
  border-radius:0 2px 2px 0; animation:dsh-gp-slide 1.15s ease-in-out infinite; }
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
.dsh-gp-menu-ico { display:inline-flex; align-items:center; margin-right:6px; vertical-align:-2px; }
.dsh-gp-menu-item { display:flex; align-items:center; padding:6px 10px; border-radius:6px; cursor:pointer; color:var(--fg); white-space:nowrap; }
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
/* 提交信息输入框 + 其右端内部的「自动生成」按钮：按钮绝对定位贴在输入框
   右缘内侧，视觉上明确属于输入框，而不是又一行并排的工具栏按钮。 */
.dsh-gp-input-wrap { position:relative; flex:1; min-width:0; display:flex; align-items:stretch; }
.dsh-gp-input { flex:1; min-width:0; padding:4px 8px; font-size:12px; color:var(--fg);
  background:var(--panel-bg); border:1px solid var(--border); border-radius:6px; outline:none; }
.dsh-gp-input:focus { border-color:var(--current); }
/* 提交信息是多行文本（生成的信息常带正文），因此用 textarea 按内容自动撑高，
   长文本换行显示，不需要横向滚动；右下角保留原生的纵向拖拽把手，高度由用户
   自己决定。
   overflow-y:auto 而不是 hidden：用户把框拖得比内容还矮时，内容仍然可达
   （hidden 会把内容裁掉且无法滚动查看）。正常长度的内容不会触发滚动条。
   max-height 只是安全网，防止异常长的模型输出把整个面板挤出视野。 */
.dsh-gp-textarea { display:block; resize:vertical; overflow-y:auto; line-height:1.5;
  min-height:26px; max-height:40vh; font-family:inherit; }
.dsh-gp-input-wrap .dsh-gp-textarea { padding-right:26px; }
/* 生成按钮贴输入框右上：单行（26px 高）时正好垂直居中，多行时贴顶不跟着下沉。
   绝对定位使其脱离 flex 流，因此不会影响 textarea 自身的高度计算。 */
.dsh-gp-input-btn { position:absolute; right:3px; top:3px;
  width:20px; height:20px; padding:0; display:inline-flex; align-items:center; justify-content:center;
  border:1px solid transparent; background:transparent; color:var(--muted); cursor:pointer; border-radius:5px;
  transition:background .12s ease, color .12s ease, border-color .12s ease; }
.dsh-gp-input-btn:hover:not(:disabled) { background:var(--hover); border-color:var(--border); color:var(--fg); }
.dsh-gp-input-btn:disabled { cursor:default; opacity:0.55; }
.dsh-gp-input-btn .dsh-gp-spinner { width:11px; height:11px; }
/* 状态摘要：内容是人话（可能较长），换行显示而不是省略号截断——截断会把
   「12 个文件已改动 · 4 已暂存 · 8 未暂存」的关键数字吃掉，那正是它存在的意义。
   完整的 porcelain 原文仍挂在 title 上供悬停查看。 */
.dsh-gp-write-status { flex:1; min-width:0; font-size:11px; color:var(--muted); line-height:1.45; }
.dsh-gp-write-stash { font-size:11px; color:var(--muted); white-space:pre-wrap; word-break:break-all; }
.dsh-gp-detail-actions { display:flex; gap:6px; margin-top:6px; }
.dsh-gp-detail-actions .dsh-gp-btn { font-size:11px; padding:2px 8px; }
.dsh-gp-changes { border-top:1px solid var(--border); padding:6px 8px; display:flex; flex-direction:column; gap:6px; }
.dsh-gp-conflict-banner { background:rgba(210,153,34,0.15); border:1px solid rgba(210,153,34,0.4);
  color:#d29922; border-radius:6px; padding:4px 8px; font-size:11px; font-weight:600; display:flex; align-items:center; gap:4px; }
[data-ds-dark-theme] .dsh-gp-conflict-banner { color:#e3b341; border-color:rgba(227,179,65,0.4); }
.dsh-gp-changes-group { display:flex; flex-direction:column; gap:2px; }
.dsh-gp-changes-group-head { font-size:10.5px; color:var(--muted); font-weight:600; padding:2px 4px; display:flex; align-items:center; justify-content:space-between; gap:6px; }
/* 分组头右侧的批量操作：与分组标题同一行、紧贴右缘，用比行内动作更轻的
   图标按钮（复用 .dsh-gp-act 的视觉语言），不额外增加一行的高度。 */
.dsh-gp-group-actions { display:flex; align-items:center; gap:2px; flex:none; }
.dsh-gp-changes-group-head .dsh-gp-act { opacity:1; }
.dsh-gp-changes-title { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:2px 0 4px; font-size:11px; color:var(--muted); }
.dsh-gp-changes-list { display:flex; flex-direction:column; gap:2px; max-height:140px; overflow-y:auto; }
.dsh-gp-changes-item { display:flex; align-items:center; gap:4px; padding:3px 6px; border-radius:5px;
  font-size:11px; color:var(--fg); cursor:pointer; min-width:0; }
.dsh-gp-changes-item:hover { background:var(--hover); }
.dsh-gp-changes-code { flex:none; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10px;
  color:var(--current); width:20px; font-weight:600; }
.dsh-gp-changes-code.conflict { color:var(--danger); }
.dsh-gp-changes-file { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* 变更行尾操作按钮：统一图标按钮，悬停出现 + 即时 tooltip */
.dsh-gp-act { opacity:0; width:22px; height:20px; padding:0; display:inline-flex; align-items:center;
  justify-content:center; border:1px solid transparent; background:transparent; color:var(--muted);
  cursor:pointer; border-radius:5px; flex:none;
  transition:background .12s ease, color .12s ease, border-color .12s ease, opacity .12s ease; }
.dsh-gp-changes-item:hover .dsh-gp-act, .dsh-gp-act:focus-visible { opacity:1; }
.dsh-gp-act:hover { background:var(--panel-bg); border-color:var(--border); color:var(--fg); }
.dsh-gp-act.danger:hover { color:var(--danger); border-color:color-mix(in srgb, var(--danger) 45%, transparent); }
.dsh-gp-msg-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.dsh-gp-msg-text { display:inline-flex; align-items:center; gap:6px; min-width:0; }
.dsh-gp-msg-text .dsh-gp-spinner { color:var(--accent); }
/* 取消按钮：图标 + 文字同一行，紧凑且与面板风格一致 */
.dsh-gp-cancel { display:inline-flex; align-items:center; gap:4px; flex:none; cursor:pointer;
  font-size:10.5px; line-height:1; padding:3px 7px; border-radius:5px;
  color:var(--danger); background:transparent; border:1px solid color-mix(in srgb, var(--danger) 40%, transparent);
  transition:background .12s ease, color .12s ease; }
.dsh-gp-cancel:hover { background:color-mix(in srgb, var(--danger) 12%, transparent); }
.dsh-gp-cancel .dsh-icon { vertical-align:0; }
/* 即时 tooltip：固定定位挂在 body 下，不会被列表的 overflow 裁掉 */
.dsh-gp-tip { position:fixed; z-index:9999; pointer-events:none; padding:3px 8px; border-radius:6px;
  font-size:11px; line-height:16px; white-space:nowrap; color:#fff; background:rgba(28,32,38,.96);
  box-shadow:0 4px 14px rgba(0,0,0,.28); }
.dsh-gp-btn-ico { display:inline-flex; align-items:center; margin-right:4px; vertical-align:-2px; }
/* 统一图标基线：默认行内，避免在按钮里把文字挤到下一行；flex 容器内仍是 flex:none */
.dsh-icon { display:inline-block; vertical-align:-2px; flex:none; }
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
export const GLOBAL_GIT_BUSY_MAP = new Map<string, { busy?: boolean; pendingOp?: string | null; message?: { text: string; kind: 'ok' | 'err'; showAuthForm?: boolean } | null }>()

/** 右键菜单项的统一图标前缀（与全插件同一套图标）。 */
function menuIcon(name: IconName): React.ReactElement {
  return <span className="dsh-gp-menu-ico">{icon(name, 13)}</span>
}

/**
 * 即时 tooltip 的属性展开助手。
 *
 * 自绘 tooltip 需要在 mouseenter/leave 与 focus/blur 四处接线（键盘可达性要求
 * 焦点也要出提示），手写四遍既啰嗦又容易漏掉 focus 那两条。这里统一展开。
 */
function tipProps(text: string): {
  onMouseEnter: (event: React.MouseEvent<HTMLElement>) => void
  onMouseLeave: () => void
  onFocus: (event: React.FocusEvent<HTMLElement>) => void
  onBlur: () => void
} {
  return {
    onMouseEnter: (event) => showTip(event.currentTarget, text),
    onMouseLeave: hideTip,
    onFocus: (event) => showTip(event.currentTarget, text),
    onBlur: hideTip,
  }
}

/**
 * 变更行尾的操作按钮：统一图标 + 即时 tooltip。
 *
 * 图标一律取自 icons.tsx，保证与视图内其它按钮同一套视觉语言；提示用自绘
 * tooltip（原生 title 有延迟，用户看不到就会「不知道这按钮干啥」）。
 */
function RowAction(props: {
  icon: IconName
  label: string
  danger?: boolean
  onClick: (event: React.MouseEvent) => void
}): React.ReactElement {
  const { icon: name, label, danger, onClick } = props
  return (
    <button
      type="button"
      className={`dsh-gp-act${danger === true ? ' danger' : ''}`}
      aria-label={label}
      onMouseEnter={(event) => showTip(event.currentTarget, label)}
      onMouseLeave={hideTip}
      onFocus={(event) => showTip(event.currentTarget, label)}
      onBlur={hideTip}
      onClick={onClick}
    >
      {icon(name, 13)}
    </button>
  )
}

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
    !isRemote && row.ahead ? (
      <span key="a" className="dsh-gp-badge ahead">{icon('arrowUp', 11)}{row.ahead}</span>
    ) : null,
    !isRemote && row.behind ? (
      <span
        key="b"
        className={`dsh-gp-badge behind ${busy && isCurrent ? 'busy' : ''}`}
        style={{ cursor: isCurrent && !busy ? 'pointer' : 'default' }}
        title={busy && isCurrent ? t('panel.pullingNow') : t('panel.behindHint', { count: String(row.behind) })}
        onClick={(e) => {
          if (isCurrent && !busy && onPull) {
            e.stopPropagation()
            onPull()
          }
        }}
      >
        {busy && isCurrent ? <span className="dsh-gp-spinner" /> : icon('arrowDown', 11)}
        {busy && isCurrent ? t('panel.pullingNow') : row.behind}
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
  // 当前工作区路径的实时快照：异步结果回来时用它判断会话是否已经切走。
  const pathRef = useRef(path)
  pathRef.current = path
  const [busy, setBusyState] = useState(() => GLOBAL_GIT_BUSY_MAP.get(path)?.busy ?? false)
  const [message, setMessageState] = useState<{ text: string; kind: 'ok' | 'err'; showAuthForm?: boolean } | null>(() => GLOBAL_GIT_BUSY_MAP.get(path)?.message ?? null)
  // 当前正在执行的操作种类（pull / push / sync / fetch / commit …），用于只在
  // 真正被触发的那个入口上转 loading，而不是让整面板所有按钮一起转。
  const [pendingOp, setPendingOpState] = useState<string | null>(() => GLOBAL_GIT_BUSY_MAP.get(path)?.pendingOp ?? null)

  const setBusy = (val: boolean): void => {
    setBusyState(val)
    const cur = GLOBAL_GIT_BUSY_MAP.get(path) || {}
    GLOBAL_GIT_BUSY_MAP.set(path, { ...cur, busy: val })
  }
  const setPendingOp = (op: string | null): void => {
    setPendingOpState(op)
    const cur = GLOBAL_GIT_BUSY_MAP.get(path) || {}
    GLOBAL_GIT_BUSY_MAP.set(path, { ...cur, pendingOp: op })
  }
  const setMessage = (msg: { text: string; kind: 'ok' | 'err'; showAuthForm?: boolean } | null): void => {
    setMessageState(msg)
    const cur = GLOBAL_GIT_BUSY_MAP.get(path) || {}
    GLOBAL_GIT_BUSY_MAP.set(path, { ...cur, message: msg })
  }

  // 会话切换回来时，若全局正在执行后台操作，恢复视图上的状态
  useEffect(() => {
    // 切走再切回：上一个仓库那次未完成的生成已经不适用了，别让新仓库的按钮一直转圈。
    setGenerating(false)
    // 同理，切换仓库时先丢弃上一个仓库的变更结论：否则在新请求返回前，状态摘要
    // 会拿旧仓库的 changes 去描述新仓库（比如把有改动的仓库说成「干净」）。
    setChanges([])
    setStatusText('')
    setStatusLoaded(false)
    const globalState = GLOBAL_GIT_BUSY_MAP.get(path)
    if (globalState) {
      if (globalState.busy !== undefined) setBusyState(globalState.busy)
      if (globalState.pendingOp !== undefined) setPendingOpState(globalState.pendingOp)
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
  // 自动生成提交信息进行中（生成按钮的转圈与禁用）。
  const [generating, setGenerating] = useState(false)
  // 提交信息输入框：textarea 随内容自适应高度。
  const commitRef = useRef<HTMLTextAreaElement | null>(null)
  // 上一次由自适应写入的 inline height；被外部改过即说明用户拖了高度。
  const appliedHeightRef = useRef<string | null>(null)
  const [statusText, setStatusText] = useState('')
  // 是否已成功读到过一次变更状态（用于区分「干净」与「读不到」）。
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [stashText, setStashText] = useState('')
  // 变更文件列表 + 选中的文件 diff。
  const [changes, setChanges] = useState<Array<{ code: string; file: string }>>([])
  const [diffState, setDiffState] = useState<{ file: string; content: string; busy: boolean } | null>(null)
  // 分支名快速搜索过滤。
  const [branchSearch, setBranchSearch] = useState('')

  ensureStyle()

  /**
   * 提交信息框按内容自适应高度。
   *
   * 两个容易踩的点，都已实证（无头 Edge 实测）：
   *
   * 1. **必须补上边框**：`.dsh-gp *` 有 `box-sizing:border-box`，而 `scrollHeight`
   *    不含边框、border-box 的 `height` 含边框。直接写 `height = scrollHeight`
   *    会让内容区比内容矮 2px——连一行短文本都持续溢出，滚动条永远挂着。
   * 2. **用户拖过之后必须停手**：`resize:vertical` 的把手由浏览器写 inline
   *    `height`，本效果也在写同一个属性，一打字就会把用户拖出来的高度冲掉。
   *    判据是「inline height 是否还等于上一次我们自己写入的值」——被外部改过
   *    即视为用户接管。（不用元素 resize 事件：那依赖事件触发时机，而比较
   *    inline 值确定可测。）接管后不再干预，直到输入框清空时交还自适应。
   */
  useLayoutEffect(() => {
    const el = commitRef.current
    if (el === null) return
    // 空内容代表一次提交完成 / 新会话：交还控制权给自适应。
    if (commitMsg === '') {
      el.style.height = ''
      appliedHeightRef.current = null
      return
    }
    // 用户拖过高度（inline 值已不是我们上次写的那个）：不要再覆盖。
    if (appliedHeightRef.current !== null && el.style.height !== appliedHeightRef.current) return

    el.style.height = 'auto'
    const border = el.offsetHeight - el.clientHeight
    const next = `${el.scrollHeight + border}px`
    el.style.height = next
    appliedHeightRef.current = next
  }, [commitMsg])

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
    if (!b.ok) setMessage({ text: tError(b.error.code, b.error.message), kind: 'err' })
    else if (!g.ok) setMessage({ text: tError(g.error.code, g.error.message), kind: 'err' })
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
    // 只有成功读到状态才敢声称「工作区干净」：请求失败时 changes 同样是空数组，
    // 但那是「读不到」而不是「没改动」，两者必须在界面上区分开。
    setStatusLoaded(result.ok)
    // porcelain 固定宽度：前 2 字符是 XY 状态码，第 3 字符是分隔空格，其余是路径。
    // 不能用 /^(\S+)\s+/：未暂存修改的 X 位本身是空格（" M path"），会被整行漏掉，
    // 导致「仅工作区修改」的文件在变更列表里彻底消失。
    const list: Array<{ code: string; file: string }> = []
    for (const line of output.split('\n')) {
      if (line.trim() === '' || line.length < 4) continue
      const code = line.slice(0, 2)
      const file = line.slice(3).trim()
      if (file !== '') list.push({ code, file })
    }
    setChanges(list)
  }, [path, api])

  /** 加载某文件的 diff。 */
  const loadDiff = useCallback(async (file: string): Promise<void> => {
    if (!path) return
    setDiffState({ file, content: '', busy: true })
    const result = await api.diffFile(path, file)
    setDiffState({ file, content: result.ok ? result.value.output : tError(result.error?.code, result.error?.message ?? ''), busy: false })
  }, [path, api])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const runWrite = useCallback(async (action: 'commit' | 'push' | 'stash-push' | 'stash-pop' | 'stage' | 'unstage' | 'discard' | 'sync', extra?: string): Promise<void> => {
    if (!path || busy) return
    setBusy(true)
    setPendingOp(action)
    setMessage(null)
    let result: { ok: boolean; output?: string; error?: { code: string; message: string } }
    try {
      if (action === 'commit') {
        result = await api.commit(path, extra ?? commitMsg)
      } else if (action === 'push') {
        result = await api.push(path)
      } else if (action === 'sync') {
        // 官方此前的 sync 按钮漏了分支，会掉进最后的 discard 兜底（等同误删改动），这里补上。
        result = await api.sync(path)
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
    if (result.ok) {
      setMessage({ text: result.output ?? t('op.ok'), kind: 'ok' })
      if (action === 'commit' || action === 'stash-pop') setCommitMsg('')
      void refreshStatus()
      void load()
      onRefreshStatus?.()
    } else {
      let errMsg = tError(result.error?.code, result.error?.message ?? t('op.failed'))
      let showAuthForm = false
      if (errMsg.includes('OAuth') || errMsg.includes('Authentication') || errMsg.includes('fatal: could not read Username') || errMsg.includes('terminal prompts disabled')) {
        errMsg = t('panel.needCredential')
        showAuthForm = true
      }
      setMessage({ text: errMsg, kind: 'err', showAuthForm })
    }
    setPendingOp(null)
    setBusy(false)
  }, [path, api, busy, commitMsg, t, refreshStatus, load, onRefreshStatus])

  /**
   * 批量暂存 / 取消暂存一组文件。
   *
   * 复用既有的单文件接口（串行执行的理由见 batch-stage.ts）。失败时仍要刷新：
   * 前面已成功的部分已经改动了 index，界面必须跟上磁盘。
   */
  const runBatchStage = useCallback(async (
    files: string[],
    action: 'stage' | 'unstage',
  ): Promise<void> => {
    if (!path || busy || files.length === 0) return
    setBusy(true)
    setPendingOp(action)
    setMessage({ text: t('panel.running', { label: t(action === 'stage' ? 'changes.stageAll' : 'changes.unstageAll') }), kind: 'ok' })
    const outcome = await runBatch(files, async (file) => {
      try {
        return await (action === 'stage' ? api.stageFile(path, file) : api.unstageFile(path, file))
      } catch (error) {
        return { ok: false as const, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } }
      }
    })
    if (outcome.failure === null) {
      setMessage({ text: t(action === 'stage' ? 'changes.stageAllDone' : 'changes.unstageAllDone', { count: String(outcome.done) }), kind: 'ok' })
    } else {
      // 报告已完成数量，绝不把「部分成功」谎报成成功。
      setMessage({
        text: t('changes.batchFailed', {
          count: String(outcome.done),
          reason: tError(outcome.failure.code, outcome.failure.message),
        }),
        kind: 'err',
      })
    }
    void refreshStatus()
    void load()
    onRefreshStatus?.()
    setPendingOp(null)
    setBusy(false)
  }, [path, api, busy, t, refreshStatus, load, onRefreshStatus])

  /**
   * 依据暂存区变更自动生成提交信息并回填输入框。
   *
   * 失败路径刻意**不**触碰 `commitMsg`：用户在输入框里手写的内容永远不该被一次
   * 失败的生成抹掉。只有拿到非空结果时才覆盖（无论输入框原本有没有文字）。
   *
   * 面板实例会跨会话复用（`path` 是 prop），因此这里用发起时的 `path` 做快照：
   * 结果回来时若已经切到别的仓库，一律丢弃——否则一次慢生成会把上一个仓库的
   * 提交信息写进当前会话的输入框。
   */
  const generateMessage = useCallback(async (): Promise<void> => {
    if (!path || generating || busy) return
    const target = path
    setGenerating(true)
    setMessage({ text: t('write.commit.generating'), kind: 'ok' })
    let result: Envelope<{ message: string }>
    try {
      result = await api.generateCommitMessage(target)
    } catch (error) {
      result = { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } }
    }
    if (pathRef.current !== target) {
      setGenerating(false)
      return
    }
    if (result.ok) {
      const text = result.value.message.trim()
      if (text !== '') {
        setCommitMsg(text)
        setMessage({ text: t('write.commit.generated'), kind: 'ok' })
      } else {
        setMessage({ text: t('write.commit.failed', { reason: t('op.failed') }), kind: 'err' })
      }
    } else if (result.error.code === 'empty-stage') {
      setMessage({ text: t('write.commit.emptyStage'), kind: 'err' })
    } else if (result.error.code === 'no-model') {
      setMessage({ text: t('write.commit.noModel'), kind: 'err' })
    } else {
      setMessage({ text: t('write.commit.failed', { reason: tError(result.error.code, result.error.message) }), kind: 'err' })
    }
    setGenerating(false)
  }, [path, api, generating, busy, t])

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

  const runOp = useCallback(async (label: string, op: () => Promise<Envelope<OpResult>>, kind?: string): Promise<void> => {
    setBusy(true)
    setPendingOp(kind ?? label)
    setMessage({ text: t('panel.running', { label: label }), kind: 'ok' })
    const result = await op()
    if (result.ok) {
      setMessage({ text: result.value.output || t('op.done', { label }), kind: 'ok' })
      await load()
    } else {
      let errMsg = tError(result.error.code, result.error.message || t('panel.opFailed'))
      let showAuthForm = false
      if (errMsg.includes('OAuth') || errMsg.includes('Authentication') || errMsg.includes('fatal: could not read Username') || errMsg.includes('terminal prompts disabled')) {
        errMsg = t('panel.needCredential')
        showAuthForm = true
      }
      setMessage({ text: errMsg, kind: 'err', showAuthForm })
    }
    setPendingOp(null)
    setBusy(false)
  }, [load, t])

  const repoName = branches?.repo ?? ''

  /**
   * 变更状态的一句话摘要（替代原先直接暴露 `git status --porcelain` 首行的做法）。
   *
   * porcelain 是给程序读的机器格式（` M path`、`?? path`），带前导空格与两位
   * 状态码，直接显示在界面上用户读不懂；而且只取首行时多个文件只能看到一个，
   * 信息量与下方变更列表重复。这里改用一句人话，复用已解析好的 changes。
   */
  const statusSummary = (() => {
    // 还没读到状态（首次加载中或请求失败）时不显示任何结论，避免把「读不到」
    // 谎报成「工作区干净」。
    if (!statusLoaded) return ''
    if (changes.length === 0) return t('write.status.clean')
    const { conflicts, staged, unstaged } = classifyChanges(changes)
    const base = t('write.status.summary', {
      total: String(changes.length),
      staged: String(staged.length),
      unstaged: String(unstaged.length),
    })
    return conflicts.length > 0 ? base + t('write.status.conflicts', { count: String(conflicts.length) }) : base
  })()
  // 进行中操作的本地化名称（用于进度条/按钮的无障碍标签）。
  const pendingOpLabel =
    pendingOp === 'pull' ? t('op.pulling')
    : pendingOp === 'push' ? t('op.pushing')
    : pendingOp === 'sync' ? t('op.syncing')
    : pendingOp === 'fetch' ? t('op.fetching')
    : pendingOp !== null ? t('panel.running', { label: pendingOp })
    : null

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
      void runOp(t('op.pull'), () => api.pull(path), 'pull')
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
          {loading || busy ? (
            <span className="dsh-gp-spinner" role="status" aria-label={busy && pendingOp === 'pull' ? t('op.pulling') : t('op.refresh')} />
          ) : (
            icon('refresh', 13)
          )}
        </button>
      </div>
      {/* 顶部不确定进度条：任何拉取/推送/同步/提交进行中都会显示 */}
      {busy ? <div className="dsh-gp-progress" role="progressbar" aria-label={pendingOpLabel ?? t('op.refresh')} /> : null}
      <div className="dsh-gp-tabs">
        <div className={`dsh-gp-tab${tab === 'branches' ? ' active' : ''}`} onClick={() => setTab('branches')}>{t('tab.branches')}</div>
        <div className={`dsh-gp-tab${tab === 'graph' ? ' active' : ''}`} onClick={() => setTab('graph')}>{t('tab.graph')}</div>
      </div>
      <div className="dsh-gp-write">
        <div className="dsh-gp-write-row">
          <div className="dsh-gp-input-wrap">
            <textarea ref={commitRef} className="dsh-gp-input dsh-gp-textarea" rows={1} value={commitMsg}
              placeholder={t('write.commit.placeholder')}
              onChange={(event) => setCommitMsg(event.target.value)}
              onKeyDown={(event) => {
                // Enter 提交、Shift+Enter 换行：多行信息需要能写正文。
                if (event.key === 'Enter' && !event.shiftKey && commitMsg.trim() !== '') {
                  event.preventDefault()
                  void runWrite('commit')
                }
              }} />
            <button type="button" className="dsh-gp-input-btn"
              disabled={busy || generating}
              aria-label={t('write.commit.generate')}
              {...tipProps(t('write.commit.generate'))}
              onClick={() => void generateMessage()}>
              {generating ? <span className="dsh-gp-spinner" role="status" aria-label={t('write.commit.generating')} /> : icon('sparkles', 13)}
            </button>
          </div>
          <button className="dsh-gp-btn" disabled={busy || commitMsg.trim() === ''}
            onClick={() => void runWrite('commit')}>{t('write.commit')}</button>
          <button className="dsh-gp-btn" disabled={busy}
            onClick={() => void runWrite('push')}>
            {pendingOp === 'push' ? <><span className="dsh-gp-spinner" /> {t('op.pushing')}</> : t('write.push')}
          </button>
          <button className="dsh-gp-btn" disabled={busy}
            onClick={() => void runWrite('sync')}>
            {pendingOp === 'sync' ? <><span className="dsh-gp-spinner" /> {t('op.syncing')}</> : t('write.sync')}
          </button>
        </div>
        <div className="dsh-gp-write-row">
          <button className="dsh-gp-btn" disabled={busy} {...tipProps(t('write.stash.tip'))}
            onClick={() => void runWrite('stash-push')}>{t('write.stash')}</button>
          <button className="dsh-gp-btn" disabled={busy} {...tipProps(t('write.stashPop.tip'))}
            onClick={() => void runWrite('stash-pop')}>{t('write.stashPop')}</button>
          <button className="dsh-gp-btn" disabled={busy} {...tipProps(t('write.status.tip'))}
            onClick={() => void refreshStatus()}>{t('write.status')}</button>
          {/* title 保留完整的 porcelain 原文：人话摘要用于扫读，悬停可查机器原文。 */}
          <span className="dsh-gp-write-status" title={statusText}>{statusSummary}</span>
        </div>
        {stashText !== '' ? <div className="dsh-gp-write-stash">{stashText}</div> : null}
        {(() => {
          if (changes.length === 0) return null
          const { conflicts, staged, unstaged } = classifyChanges(changes)

          return (
            <div className="dsh-gp-changes">
              <div className="dsh-gp-changes-title">
                <span>{t('changes.title')} ({changes.length})</span>
                <button type="button" className="dsh-gp-btn"
                  title={conflicts.length > 0 ? t('changes.sendConflictsToChat') : t('changes.sendToChat')}
                  style={{ fontSize: 11, padding: '1px 6px' }}
                  onClick={() => {
                    let prompt: string
                    if (conflicts.length > 0) {
                      const conflictList = conflicts.map(c => `- \`${c.file}\` (CONFLICT)`).join('\n')
                      prompt = t('prompt.conflicts', {
                        count: String(conflicts.length),
                        conflictList,
                        otherCount: String(changes.length - conflicts.length),
                      })
                    } else {
                      const fileLines = changes.map(c => `- \`${c.code}\` ${c.file}`).join('\n')
                      prompt = t('prompt.normal', { count: String(changes.length), fileList: fileLines })
                    }
                    if (injectTextToChatInput(prompt)) {
                      setMessage({ kind: 'ok', text: t('changes.sentSuccess') })
                    }
                  }}>
                  <span className="dsh-gp-btn-ico">{icon(conflicts.length > 0 ? 'conflict' : 'chat', 13)}</span>
                  {conflicts.length > 0 ? t('changes.sendConflictsToChat') : t('changes.sendToChat')}
                </button>
              </div>
              {conflicts.length > 0 ? (
                <div className="dsh-gp-conflict-banner">
                  {icon('conflict', 13)} {t('changes.conflicts', { count: String(conflicts.length) })}
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
                    <div className="dsh-gp-group-actions">
                      <RowAction icon="minus" label={t('changes.unstageAll')}
                        onClick={(e) => {
                          e.stopPropagation()
                          void runBatchStage(staged.map((c) => c.file), 'unstage')
                        }} />
                    </div>
                  </div>
                  <div className="dsh-gp-changes-list">
                    {staged.map((c) => (
                      <div key={c.file} className="dsh-gp-changes-item" onClick={() => void loadDiff(c.file)}>
                        <span className="dsh-gp-changes-code">{c.code}</span>
                        <span className="dsh-gp-changes-file" title={c.file}>{c.file}</span>
                        <RowAction icon="copy" label={t('changes.copyPath')}
                          onClick={(e) => {
                            e.stopPropagation()
                            try {
                              navigator.clipboard.writeText(c.file)
                              setMessage({ kind: 'ok', text: t('changes.copyPathDone') })
                            } catch {}
                          }} />
                        <RowAction icon="chat" label={t('changes.fileToChat')}
                          onClick={(e) => {
                            e.stopPropagation()
                            const prompt = t('prompt.stagedFile', { file: c.file })
                            if (injectTextToChatInput(prompt)) {
                              setMessage({ kind: 'ok', text: t('changes.sentSuccess') })
                            }
                          }} />
                        <RowAction icon="minus" label={t('changes.unstage')}
                          onClick={(e) => { e.stopPropagation(); void runWrite('unstage', c.file) }} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {unstaged.length > 0 ? (
                <div className="dsh-gp-changes-group">
                  <div className="dsh-gp-changes-group-head">
                    <span>{t('changes.unstaged')} ({unstaged.length})</span>
                    <div className="dsh-gp-group-actions">
                      <RowAction icon="plus" label={t('changes.stageAll')}
                        onClick={(e) => {
                          e.stopPropagation()
                          void runBatchStage(unstaged.map((c) => c.file), 'stage')
                        }} />
                    </div>
                  </div>
                  <div className="dsh-gp-changes-list">
                    {unstaged.map((c) => (
                      <div key={c.file} className="dsh-gp-changes-item"
                        title={t('changes.openFullDiff')}
                        onClick={() => {
                          if (onOpenDiff?.(c.file) === true) return
                          void loadDiff(c.file)
                        }}>
                        <span className="dsh-gp-changes-code">{c.code}</span>
                        <span className="dsh-gp-changes-file" title={c.file}>{c.file}</span>
                        <RowAction icon="unified" label={t('changes.inlineDiff')}
                          onClick={(e) => { e.stopPropagation(); void loadDiff(c.file) }} />
                        <RowAction icon="copy" label={t('changes.copyPath')}
                          onClick={(e) => {
                            e.stopPropagation()
                            try {
                              navigator.clipboard.writeText(c.file)
                              setMessage({ kind: 'ok', text: t('changes.copyPathDone') })
                            } catch {}
                          }} />
                        <RowAction icon="chat" label={t('changes.fileToChat')}
                          onClick={(e) => {
                            e.stopPropagation()
                            const prompt = t('prompt.fileChange', { file: c.file })
                            if (injectTextToChatInput(prompt)) {
                              setMessage({ kind: 'ok', text: t('changes.sentSuccess') })
                            }
                          }} />
                        <RowAction icon="plus" label={t('changes.stage')}
                          onClick={(e) => { e.stopPropagation(); void runWrite('stage', c.file) }} />
                        <RowAction icon="undo" danger label={t('changes.discard')}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (window.confirm(t('changes.discardConfirm', { file: c.file }))) {
                              void runWrite('discard', `${c.file}|${c.code === '??' ? 'untracked' : ''}`)
                            }
                          }} />
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
                        const prompt = t('prompt.reviewDiff', { file: diffState.file, diff: diffState.content.slice(0, 8000) })
                        if (injectTextToChatInput(prompt)) {
                          setMessage({ kind: 'ok', text: t('changes.sentSuccess') })
                        }
                      }}>
                      {icon('chat', 13)} {t('changes.diffToChat')}
                    </button>
                    <button type="button" className="dsh-gp-btn"
                      onClick={() => setDiffState(null)} style={{ fontSize: 11, padding: '0 6px' }}>
                      {icon('close', 13)}
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
            <div className="dsh-gp-msg-row">
              <span className="dsh-gp-msg-text">
                {busy ? <span className="dsh-gp-spinner" aria-hidden="true" /> : null}
                {message.text}
              </span>
              {busy ? (
                <button
                  type="button"
                  className="dsh-gp-cancel"
                  title={t('panel.cancelOp')}
                  aria-label={t('panel.cancelOp')}
                  onClick={() => {
                    // 真正中止后台 git 进程，而不只是把界面状态清掉。
                    void api.cancel(path)
                    setPendingOp(null)
                    setBusy(false)
                    setMessage({ text: t('panel.cancelled'), kind: 'ok' })
                  }}
                >
                  {icon('close', 12)}
                  <span>{t('menu.cancel')}</span>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, fontSize: 11 }}>{icon('key', 13)}{t('auth.title')}</div>
                <input
                  id="dsh-git-auth-user"
                  className="dsh-gp-input"
                  placeholder={t('auth.usernamePlaceholder')}
                  defaultValue="jaden.tang"
                />
                <input
                  id="dsh-git-auth-pass"
                  type="password"
                  className="dsh-gp-input"
                  placeholder={t('auth.passwordPlaceholder')}
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 2 }}>
                  <button
                    type="button"
                    className="dsh-gp-btn"
                    onClick={async () => {
                      const u = (document.getElementById('dsh-git-auth-user') as HTMLInputElement)?.value.trim()
                      const p = (document.getElementById('dsh-git-auth-pass') as HTMLInputElement)?.value.trim()
                      if (!u || !p) {
                        alert(t('auth.fillBoth'))
                        return
                      }
                      setMessage({ text: t('auth.saving'), kind: 'ok' })
                      const res = await api.setCredential(path, 'gitlab.sjfood.us', u, p)
                      if (res.ok) {
                        setMessage({ text: t('auth.saved'), kind: 'ok' })
                        void runOp(t('op.pull'), () => api.pull(path), 'pull')
                      } else {
                        setMessage({ text: t('auth.saveFailed', { reason: tError(res.error?.code, res.error?.message ?? String(res)) }), kind: 'err' })
                      }
                    }}
                  >
                    {icon('save', 13)} {t('auth.saveAndRetry')}
                  </button>
                  <button
                    type="button"
                    className="dsh-gp-btn"
                    onClick={() => setMessage(null)}
                  >
                    {t('menu.cancel')}
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
                      onPull={() => void runOp(t('op.pull'), () => api.pull(path), 'pull')}
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
              <button className="dsh-gp-btn" disabled={busy} onClick={() => void runOp(t('fetch.all'), () => api.fetchAll(path), 'fetch')}>
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
                      void runOp(t('op.pull'), () => api.pull(path), 'pull')
                    }}
                  >
                    {busy && pendingOp === 'pull' ? (
                      <><span className="dsh-gp-spinner" /> {t('op.pulling')}</>
                    ) : busy ? (
                      t('menu.busySyncing')
                    ) : (
                      <>{menuIcon('arrowDown')}{t('menu.pull')}</>
                    )}
                  </div>
                ) : null}
                <div
                  className={`dsh-gp-menu-item ${busy ? 'disabled' : ''}`}
                  style={busy ? { opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' } : undefined}
                  onClick={() => {
                    if (busy) return
                    closeMenu()
                    void runOp(t('fetch.all'), () => api.fetchAll(path), 'fetch')
                  }}
                >
                  {busy && pendingOp === 'fetch' ? (
                    <><span className="dsh-gp-spinner" /> {t('op.fetching')}</>
                  ) : busy ? (
                    t('menu.busySyncing')
                  ) : (
                    <>{menuIcon('fetch')}{t('menu.fetchAll')}</>
                  )}
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
