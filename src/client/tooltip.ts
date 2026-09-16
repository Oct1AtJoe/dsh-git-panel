/**
 * 面板内的即时 tooltip。
 *
 * 为什么不用原生 `title`：原生提示有约 1 秒延迟、样式不可控，而且在窄侧栏里
 * 用户往往来不及看到——这正是「按钮看不懂是干啥的」的根因。这里改成挂到
 * `document.body` 的固定定位浮层：即时出现、永不被父级 `overflow:auto` 裁掉、
 * 并自动避让视口边缘。
 *
 * @module dsh-git-panel/client/tooltip
 */

let node: HTMLDivElement | null = null

/** 立即在目标控件附近显示提示。 */
export function showTip(target: HTMLElement, text: string): void {
  hideTip()
  if (text === '') return
  const el = document.createElement('div')
  el.className = 'dsh-gp-tip'
  el.textContent = text
  el.setAttribute('role', 'tooltip')
  document.body.appendChild(el)
  node = el

  const rect = target.getBoundingClientRect()
  const own = el.getBoundingClientRect()
  // 默认在控件上方；顶部空间不足时翻到下方。
  let top = rect.top - own.height - 6
  if (top < 4) top = rect.bottom + 6
  // 水平居中对齐控件，并夹紧到视口内。
  let left = rect.left + rect.width / 2 - own.width / 2
  left = Math.max(6, Math.min(left, window.innerWidth - own.width - 6))
  el.style.top = `${Math.round(top)}px`
  el.style.left = `${Math.round(left)}px`
}

/** 收起当前提示。 */
export function hideTip(): void {
  node?.remove()
  node = null
}
