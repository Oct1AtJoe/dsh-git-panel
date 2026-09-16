/**
 * dsh-git-panel 的统一图标库。
 *
 * 全插件只允许从这里取图标：同一 16×16 网格、同一线宽 1.5、同样的圆角端点与
 * 连接、全部使用 `currentColor`，因此深浅色主题与按钮悬停态都能自然继承。
 * 之前面板里有 emoji（📋💬↩）、字符字形（≡ + − ✓ ↑↓）和手写 SVG 三种风格混用，
 * 视觉上非常割裂，也导致部分平台字宽不一、对齐错位——统一到这里即可根治。
 *
 * @module dsh-git-panel/client/icons
 */

import { createElement } from 'react'

/** 图标名。命名按语义，不按形状。 */
export type IconName =
  | 'refresh'
  | 'file'
  | 'split'
  | 'unified'
  | 'edit'
  | 'conflict'
  | 'wrap'
  | 'fold'
  | 'code'
  | 'plus'
  | 'minus'
  | 'save'
  | 'check'
  | 'close'
  | 'copy'
  | 'chat'
  | 'undo'
  | 'arrowUp'
  | 'arrowDown'
  | 'sync'
  | 'fetch'
  | 'trash'
  | 'key'
  | 'bulb'
  | 'branch'
  | 'both'
  | 'info'
  | 'list'
  | 'external'

/** 每个图标由若干 SVG 子元素描述（与绘制顺序一致）。 */
const SHAPES: Record<IconName, Array<Record<string, unknown>>> = {
  refresh: [
    { d: 'M13.2 8a5.2 5.2 0 1 1-1.5-3.7' },
    { d: 'M13.4 2.6v2.9h-2.9' },
  ],
  file: [
    { d: 'M4.2 1.8h4.3L12 5.3v8.9H4.2z' },
    { d: 'M8.4 1.8v3.6H12' },
  ],
  split: [
    { rect: { x: 2.2, y: 3.2, width: 11.6, height: 9.6, rx: 1.4 } },
    { d: 'M8 3.2v9.6' },
  ],
  unified: [{ d: 'M3 4.6h10M3 8h10M3 11.4h5.5' }],
  edit: [
    { d: 'M10.9 2.4l2.7 2.7-7.2 7.2H3.7v-2.7z' },
    { d: 'M9.6 3.7l2.7 2.7' },
  ],
  conflict: [
    { d: 'M8 2.4l5.7 10.2H2.3z' },
    { d: 'M8 6.4v3.1M8 11.4h.01' },
  ],
  wrap: [
    { d: 'M3 4.4h10M3 11.6h4M3 8h7.2a2 2 0 010 4H8.4' },
    { d: 'M9.6 10.4L8.2 12l1.4 1.6' },
  ],
  fold: [{ d: 'M4.4 6.2L8 2.9l3.6 3.3M4.4 9.8L8 13.1l3.6-3.3' }],
  code: [{ d: 'M5.9 4.2L2.4 8l3.5 3.8M10.1 4.2L13.6 8l-3.5 3.8' }],
  plus: [{ d: 'M8 3.2v9.6M3.2 8h9.6' }],
  minus: [{ d: 'M3.4 8h9.2' }],
  save: [{ d: 'M8 2.6v6.4M5.2 6.4L8 9.2l2.8-2.8M3.4 13h9.2' }],
  check: [{ d: 'M3.4 8.4l3 3 6.2-6.8' }],
  close: [{ d: 'M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2' }],
  copy: [
    { rect: { x: 5.4, y: 5.4, width: 8.2, height: 8.2, rx: 1.5 } },
    { d: 'M10.6 3.6V3a1.4 1.4 0 0 0-1.4-1.4H3.6A1.4 1.4 0 0 0 2.2 3v5.6a1.4 1.4 0 0 0 1.4 1.4h.4' },
  ],
  chat: [{ d: 'M13.4 9.4a2.4 2.4 0 0 1-2.4 2.4H6.2L2.6 14.4V4.6a2.4 2.4 0 0 1 2.4-2.4h6a2.4 2.4 0 0 1 2.4 2.4z' }],
  undo: [
    { d: 'M3.2 8h7a2.8 2.8 0 0 1 0 5.6H7.4' },
    { d: 'M3.2 8l2.8-2.8M3.2 8l2.8 2.8' },
  ],
  arrowUp: [{ d: 'M8 12.8V3.2M4.6 6.6L8 3.2l3.4 3.4' }],
  arrowDown: [{ d: 'M8 3.2v9.6M4.6 9.4L8 12.8l3.4-3.4' }],
  sync: [
    { d: 'M3.4 6.6a4.6 4.6 0 0 1 7.6-2.2M12.6 9.4a4.6 4.6 0 0 1-7.6 2.2' },
    { d: 'M11 2.4v2.2H8.8M5 13.6v-2.2h2.2' },
  ],
  fetch: [
    { d: 'M4.6 11.4a2.8 2.8 0 0 1-.3-5.6 3.6 3.6 0 0 1 7-1 2.6 2.6 0 0 1 .3 5.2' },
    { d: 'M8 8.4v3.6M6.4 10.6L8 12.4l1.6-1.8' },
  ],
  trash: [{ d: 'M3.4 4.6h9.2M6.4 4.6V3.2h3.2v1.4M5 4.6l.6 8.2h4.8l.6-8.2' }],
  key: [
    { circle: { cx: 5.6, cy: 10.4, r: 2.4 } },
    { d: 'M7.4 8.6l5-5M10.4 5.6l1.6 1.6M12 4l1.4 1.4' },
  ],
  bulb: [
    { d: 'M8 2.6a3.6 3.6 0 0 0-2.1 6.5c.4.3.6.8.6 1.3v.4h3v-.4c0-.5.2-1 .6-1.3A3.6 3.6 0 0 0 8 2.6z' },
    { d: 'M6.6 12.6h2.8' },
  ],
  branch: [
    { circle: { cx: 4.6, cy: 4, r: 1.6 } },
    { circle: { cx: 4.6, cy: 12, r: 1.6 } },
    { circle: { cx: 11.4, cy: 6.4, r: 1.6 } },
    { d: 'M4.6 5.6v4.8M11.4 8c0 2.2-2 3.2-4.6 3.4' },
  ],
  both: [
    { d: 'M4 3.4h2.2a2.4 2.4 0 0 1 2.4 2.4v4.4a2.4 2.4 0 0 0 2.4 2.4H13' },
    { d: 'M4 12.6h2.2a2.4 2.4 0 0 0 2.4-2.4' },
  ],
  info: [
    { circle: { cx: 8, cy: 8, r: 5.6 } },
    { d: 'M8 7.4v4M8 4.8h.01' },
  ],
  list: [{ d: 'M5.4 4.4h8M5.4 8h8M5.4 11.6h8M2.8 4.4h.01M2.8 8h.01M2.8 11.6h.01' }],
  external: [
    { d: 'M9.4 2.6h4v4' },
    { d: 'M13.4 2.6L7.6 8.4' },
    { d: 'M12 10v2.6a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 12.6V5.4A1.4 1.4 0 0 1 3.4 4H6' },
  ],
}

/**
 * 渲染一个统一风格的图标。
 * @param name - 图标名。
 * @param size - 边长（默认 14，与按钮字号视觉齐平）。
 */
export function icon(name: IconName, size = 14): React.ReactElement {
  const children = (SHAPES[name] ?? []).map((shape, i) => {
    if (shape.rect !== undefined) return createElement('rect', { key: i, ...(shape.rect as object) })
    if (shape.circle !== undefined) return createElement('circle', { key: i, ...(shape.circle as object) })
    return createElement('path', { key: i, d: shape.d as string })
  })
  return createElement(
    'svg',
    {
      className: 'dsh-icon',
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ...children,
  )
}
