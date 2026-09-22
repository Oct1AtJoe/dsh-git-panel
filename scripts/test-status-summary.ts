/**
 * 变更分组规则与状态摘要文案的自检。
 *
 * 覆盖点（尤其是容易被谎报的分支）：
 * - 空 changes 但**尚未读到状态**（首次加载 / 请求失败）→ 不得声称「工作区干净」；
 * - 确实读到且无改动 → 「工作区干净」；
 * - 有改动 → 总数 / 已暂存 / 未暂存 计数正确；
 * - 冲突文件既不进 staged 也不进 unstaged，且单独计数；
 * - ` M`（未暂存修改，X 位是空格）不能因为「看起来像没有状态码」而漏掉。
 * 分组规则直接 import 真实实现，避免自检与实现漂移。
 */
import { classifyChanges, type ChangeEntry } from '../src/client/change-groups.ts'

function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

const has = (list: ChangeEntry[], file: string): boolean => list.some((x) => x.file === file)

// ---- classifyChanges 行为 ----
const c1 = classifyChanges([
  { code: ' M', file: 'a.ts' },   // 未暂存修改（X 位空格）
  { code: 'M ', file: 'b.ts' },   // 已暂存
  { code: '??', file: 'c.ts' },   // 未跟踪
  { code: 'UU', file: 'd.ts' },   // 冲突
])
check('未暂存修改（ M）计入 unstaged', has(c1.unstaged, 'a.ts'), JSON.stringify(c1.unstaged))
check('已暂存（M ）计入 staged', has(c1.staged, 'b.ts'), JSON.stringify(c1.staged))
check('未跟踪（??）计入 unstaged', has(c1.unstaged, 'c.ts'), JSON.stringify(c1.unstaged))
check('冲突（UU）计入 conflicts', c1.conflicts.length === 1, JSON.stringify(c1.conflicts))
check('冲突不进 staged', !has(c1.staged, 'd.ts'), JSON.stringify(c1.staged))
check('冲突不进 unstaged', !has(c1.unstaged, 'd.ts'), JSON.stringify(c1.unstaged))
check(' M 不进 staged（X 位是空格）', !has(c1.staged, 'a.ts'), JSON.stringify(c1.staged))

const c2 = classifyChanges([{ code: 'MM', file: 'x.ts' }])
check('MM 同时算已暂存与未暂存', c2.staged.length === 1 && c2.unstaged.length === 1, JSON.stringify(c2))

const c3 = classifyChanges([])
check('空清单三组皆空', c3.conflicts.length === 0 && c3.staged.length === 0 && c3.unstaged.length === 0)

for (const code of ['AA', 'UD', 'DU']) {
  const r = classifyChanges([{ code, file: 'x' }])
  check(`冲突码 ${code} 单独成组`, r.conflicts.length === 1 && r.staged.length === 0 && r.unstaged.length === 0, JSON.stringify(r))
}

// ---- 摘要文案组装（复刻组件里的同一算法，含 statusLoaded 守卫） ----
const DICT = {
  clean: '工作区干净',
  summary: '{total} 个文件已改动 · {staged} 已暂存 · {unstaged} 未暂存',
  conflicts: '（含 {count} 个冲突）',
}
const fmt = (tpl: string, p: Record<string, string>): string => tpl.replace(/\{(\w+)\}/g, (m, k) => p[k] ?? m)

function summary(statusLoaded: boolean, changes: ChangeEntry[]): string {
  if (!statusLoaded) return ''
  if (changes.length === 0) return DICT.clean
  const { conflicts, staged, unstaged } = classifyChanges(changes)
  const base = fmt(DICT.summary, { total: String(changes.length), staged: String(staged.length), unstaged: String(unstaged.length) })
  return conflicts.length > 0 ? base + fmt(DICT.conflicts, { count: String(conflicts.length) }) : base
}

check('未读到状态：不声称干净', summary(false, []) === '', `got ${JSON.stringify(summary(false, []))}`)
check('读到且无改动：声称干净', summary(true, []) === DICT.clean, summary(true, []))
const two = summary(true, [{ code: ' M', file: 'a.ts' }, { code: 'M ', file: 'b.ts' }])
check('有改动：计数正确', two === '2 个文件已改动 · 1 已暂存 · 1 未暂存', two)
check('含冲突：附冲突计数', summary(true, [{ code: 'UU', file: 'd.ts' }]).includes('1 个冲突'), summary(true, [{ code: 'UU', file: 'd.ts' }]))
// 切换仓库瞬间：statusLoaded 已复位但旧 changes 可能还没清干净——仍不得输出结论。
check('未读到状态但有旧 changes：仍不输出结论', summary(false, [{ code: ' M', file: 'a.ts' }]) === '', summary(false, [{ code: ' M', file: 'a.ts' }]))
