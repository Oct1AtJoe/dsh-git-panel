/**
 * 输入 dock 的分支 chip：在输入框上方显示当前分支；点击会打开一个本地分支
 * 下拉列表，以便一键切换。通过官方 `conversation.input.dock` 槽位挂载（rc.6
 * 声明了它），因此它渲染在提示输入框上方的、工作区选择器旁边。
 * @module dsh-git-panel/client/BranchChip
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BranchesView } from '../core/types.ts'
import { GitPanelApi } from './api.ts'
import { icon } from './icons.tsx'
import { useT } from './i18n.ts'

const CHIP_STYLE = `
.dsh-gpc { --gpc-fg:#24292f; --gpc-border:rgba(128,128,128,0.35); --gpc-hover:rgba(0,0,0,0.06);
  --gpc-bg:#ffffff; --gpc-muted:#6e7781; --gpc-accent:#1976d2; --gpc-danger:#cf222e;
  --gpc-pop-bg:#ffffff; position:relative; display:flex; justify-content:flex-start;
  width:100%; max-width:var(--dsh-composer-card-max-width, 800px); margin:0 auto; }
[data-ds-dark-theme] .dsh-gpc { --gpc-fg:#d1d9e0; --gpc-border:rgba(255,255,255,0.22);
  --gpc-hover:rgba(255,255,255,0.08); --gpc-bg:#21262d; --gpc-muted:#9198a1;
  --gpc-accent:#58a6ff; --gpc-danger:#f85149; --gpc-pop-bg:#1f2328; }
.dsh-gpc-chip { display:inline-flex; align-items:center; gap:5px; max-width:220px;
  padding:3px 10px; font-size:12px; color:var(--gpc-fg); background:var(--gpc-bg);
  border:1px solid var(--gpc-border); border-radius:999px; cursor:pointer;
  white-space:nowrap; overflow:hidden; }
.dsh-gpc-chip:hover { background:var(--gpc-hover); }
.dsh-gpc-chip:disabled { cursor:default; opacity:0.65; }
.dsh-gpc-chip .label { overflow:hidden; text-overflow:ellipsis; }
.dsh-gpc-spin { width:10px; height:10px; flex:none; border:1.5px solid var(--gpc-muted);
  border-top-color:transparent; border-radius:50%;
  animation:dsh-gpc-spin 0.7s linear infinite; }
@keyframes dsh-gpc-spin { to { transform:rotate(360deg) } }
.dsh-gpc-backdrop { position:fixed; inset:0; z-index:900; }
.dsh-gpc-pop { position:absolute; top:calc(100% + 6px); left:0; min-width:240px; max-width:320px;
  max-height:340px; overflow:auto; z-index:901; background:var(--gpc-pop-bg);
  border:1px solid var(--gpc-border); border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.18);
  padding:4px; }
.dsh-gpc-pop .head { padding:4px 8px; font-size:11px; color:var(--gpc-muted); font-weight:600; }
.dsh-gpc-row { display:flex; align-items:center; gap:6px; padding:5px 8px; font-size:12px;
  color:var(--gpc-fg); border-radius:6px; cursor:pointer; }
.dsh-gpc-row:hover { background:var(--gpc-hover); }
.dsh-gpc-row .check { color:var(--gpc-accent); width:14px; flex:none; }
.dsh-gpc-row .name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
.dsh-gpc-row.current { font-weight:600; }
.dsh-gpc-err { padding:4px 8px; font-size:11px; color:var(--gpc-danger); }
.dsh-gpc-empty { padding:8px; font-size:11px; color:var(--gpc-muted); }
`

let chipStyleInjected = false
function ensureChipStyle(): void {
  if (chipStyleInjected) return
  chipStyleInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-git-panel-chip-css'
  tag.textContent = CHIP_STYLE
  document.head.appendChild(tag)
}

/** chip 所需的 sessions 服务结构（参见 client/index.ts）。 */
interface ChipSessions {
  list: {
    getSnapshot(): { current?: string; byId: Record<string, { cwd?: string }> }
  }
}

interface BranchChipProps {
  /** 当前会话 id（dock 槽位的运行时共享）。 */
  sessionId?: string
  /** 注入的 sessions 服务。 */
  sessions?: ChipSessions
}

/** 输入 dock 的分支选择器 chip。在 git 工作区之外渲染为 null。 */
export function BranchChip(props: BranchChipProps): React.ReactElement | null {
  const { sessionId, sessions } = props
  const t = useT()
  const [api] = useState(() => new GitPanelApi())
  const [current, setCurrent] = useState<string | null>(null)
  const [view, setView] = useState<BranchesView | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const retries = useRef(0)
  // 对进行中的请求做单调递增保护：在会话已改变之后才返回的响应，不得给错误
  // 的仓库打标，也不得填充下拉列表。
  const fetchSeq = useRef(0)
  // 弹层方向动态变化：当 chip 下方空间不足时向上展开（提示输入框靠近视口
  // 底部）。内容加载完成后重新测量（view/error/loading 稳定下来），这样翻转
  // 决定使用的是真实的弹层高度，而不是加载占位的高度。
  const [openUp, setOpenUp] = useState(false)
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)

  const updateDirection = useCallback(() => {
    const chip = chipRef.current
    if (chip === null) return
    const chipRect = chip.getBoundingClientRect()
    const spaceBelow = window.innerHeight - chipRect.bottom
    const spaceAbove = chipRect.top
    const height = popRef.current?.getBoundingClientRect().height ?? 240
    const opensUp = spaceBelow < height + 10
    setOpenUp(opensUp)
    const pop = popRef.current
    if (pop === null) return
    // 在所选方向上，把 maxHeight 钳制到实际可用空间，这样无论时机如何，
    // 列表都不会超出视口。
    const max = opensUp ? Math.max(160, spaceAbove - 12) : Math.max(120, spaceBelow - 12)
    pop.style.maxHeight = `${Math.min(max, 340)}px`
    console.debug('[dsh-git-panel] chip popover', {
      spaceBelow: Math.round(spaceBelow), spaceAbove: Math.round(spaceAbove),
      height: Math.round(height), opensUp, maxHeight: pop.style.maxHeight,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updateDirection()
    window.addEventListener('resize', updateDirection)
    return () => window.removeEventListener('resize', updateDirection)
  }, [open, view, error, loading, updateDirection])

  ensureChipStyle()

  const cwd = useMemo(() => {
    if (!sessionId || !sessions) return ''
    return sessions.list.getSnapshot().byId[sessionId]?.cwd ?? ''
  }, [sessionId, sessions])

  useEffect(() => {
    console.debug('[dsh-git-panel] chip mount', { sessionId, hasSessions: !!sessions, cwd })
  }, [sessionId, sessions, cwd])

  // 标签：只做轻量的当前分支探测。完整的分支列表在弹层打开时才请求——
  // 让启动与会话切换都更廉价。
  const refetchCurrent = useCallback(async () => {
    if (!cwd) {
      setCurrent(null)
      return
    }
    const seq = ++fetchSeq.current
    const result = await api.current(cwd)
    console.debug('[dsh-git-panel] chip current', { cwd, ok: result.ok })
    if (seq !== fetchSeq.current) return
    if (result.ok) {
      retries.current = 0
      setCurrent(result.value.current || null)
      setError(null)
    } else {
      // 保留上次已知的分支标签；对隐藏的 chip 重试一次，这样一次暂时性的
      // 失败不会让选择器永久不可见。
      setError(result.error.message)
      if (current === null && retries.current < 1) {
        retries.current += 1
        window.setTimeout(() => void refetchCurrent(), 1500)
      }
    }
  }, [cwd, api, current])

  // 初始加载 + 会话切换（仅做廉价探测）。
  useEffect(() => {
    void refetchCurrent()
  }, [refetchCurrent])

  // 完整的分支列表，每次弹层打开时都重新获取。
  const refetchList = useCallback(async () => {
    if (!cwd) {
      setView(null)
      return
    }
    const seq = ++fetchSeq.current
    setLoading(true)
    const result = await api.branches(cwd)
    if (seq !== fetchSeq.current) return
    setLoading(false)
    console.debug('[dsh-git-panel] chip branches', { cwd, ok: result.ok })
    if (result.ok) {
      setView(result.value)
      setError(null)
    } else {
      setError(result.error.message)
    }
  }, [cwd, api])

  useEffect(() => {
    if (open) void refetchList()
  }, [open, refetchList])

  // 不是 git 工作区（无会话、无仓库）：完全隐藏 chip。
  if (current === null && !loading) return null

  const switchTo = async (branch: string): Promise<void> => {
    if (busy || branch === current) {
      setOpen(false)
      return
    }
    setBusy(true)
    setError(null)
    const result = await api.switchBranch(cwd, branch)
    setBusy(false)
    if (result.ok) {
      setOpen(false)
      await refetchCurrent()
      // 也通知右侧面板刷新它的分支列表。
      window.dispatchEvent(new CustomEvent('dsh-git-panel:switched'))
    } else {
      setError(result.error.message)
    }
  }

  return (
    <div className="dsh-gpc">
      <button ref={chipRef} type="button" className="dsh-gpc-chip" title={t('chip.title')}
        aria-expanded={open} disabled={loading}
        onClick={() => {
          if (loading) return
          setOpen((v) => !v)
        }}>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor"
          strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="4" cy="4" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="4" r="1.6" />
          <path d="M4 5.6v4.8a2.4 2.4 0 0 0 2.4 2.4H12" />
        </svg>
        <span className="label">{current}</span>
        {loading ? (
          <span className="dsh-gpc-spin" aria-label={t('aria.loading')} />
        ) : (
          <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor"
            strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6l4 4 4-4" />
          </svg>
        )}
      </button>

      {open ? (
        <>
          <div className="dsh-gpc-backdrop" onClick={() => setOpen(false)} />
          <div ref={popRef} className="dsh-gpc-pop" role="listbox"
            style={openUp ? { bottom: 'calc(100% + 6px)', top: 'auto' } : { top: 'calc(100% + 6px)', bottom: 'auto' }}>
            <div className="head">{t('chip.head')}</div>
            {error && view === null ? <div className="dsh-gpc-err">{error}</div> : null}
            {loading && view === null ? <div className="dsh-gpc-empty">{t('loading')}</div> : null}
            {!loading && error && view !== null ? <div className="dsh-gpc-err">{error}</div> : null}
            {!loading && !error && view !== null && view.local.length === 0 ? <div className="dsh-gpc-empty">{t('empty.local')}</div> : null}
            {view?.local.map((branch) => (
              <div key={branch.name} role="option" aria-selected={branch.name === current}
                className={`dsh-gpc-row${branch.name === current ? ' current' : ''}`}
                onClick={() => void switchTo(branch.name)}>
                <span className="check">{branch.name === current ? icon('check', 12) : null}</span>
                <span className="name">{branch.name}</span>
                {branch.ahead || branch.behind ? (
                  <span style={{ color: 'var(--gpc-muted)', fontSize: 11 }}>
                    {branch.ahead ? <>{icon('arrowUp', 11)}{branch.ahead}</> : null}{branch.behind ? <>{icon('arrowDown', 11)}{branch.behind}</> : null}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
