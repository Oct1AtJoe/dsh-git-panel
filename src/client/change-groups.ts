/**
 * 变更清单的分组规则（porcelain 状态码 → 冲突 / 已暂存 / 未暂存）。
 *
 * 独立成模块的理由与 batch-stage.ts 相同：这是纯逻辑，抽出来才能在无 React 的
 * 环境里被自检覆盖；否则只能靠正则从 Panel.tsx 里抠函数体，既脆弱又需要 eval。
 *
 * porcelain 的两个状态位含义（`XY path`）：
 * - X = index（暂存区）相对 HEAD 的状态，空格表示无变化；
 * - Y = 工作区相对 index 的状态。
 * 因此 ` M` 是「只改了工作区」，`M ` 是「已暂存」，`MM` 是两者都有。
 * @module dsh-git-panel/client/change-groups
 */

/** 一条变更记录。 */
export interface ChangeEntry {
  /** porcelain 的两字符状态码。 */
  code: string
  /** 工作区相对路径。 */
  file: string
}

/** 三组变更。冲突单独成组，且不会同时出现在另外两组里。 */
export interface ChangeGroups {
  conflicts: ChangeEntry[]
  staged: ChangeEntry[]
  unstaged: ChangeEntry[]
}

/**
 * 把变更清单分成冲突 / 已暂存 / 未暂存三组。
 *
 * 冲突（UU / AA / UD / DU）既不算已暂存也不算未暂存：它们需要先被解决，
 * 归到任一侧都会误导用户以为可以直接提交。
 *
 * @param changes - porcelain 解析出的变更清单。
 * @returns 三组变更（各自保序）。
 */
export function classifyChanges(changes: readonly ChangeEntry[]): ChangeGroups {
  const conflicts = changes.filter((c) => c.code === 'UU' || c.code === 'AA' || c.code === 'UD' || c.code === 'DU')
  return {
    // X 位非空格且非 `?`：index 里有改动（`M ` / `A ` / `D ` / `R ` …）。
    staged: changes.filter((c) => c.code[0] !== ' ' && c.code[0] !== '?' && !conflicts.includes(c)),
    // Y 位有改动，或未跟踪（`??`）。注意 ` M` 的 X 位是空格，必须靠 Y 位识别。
    unstaged: changes.filter((c) => (c.code[1] !== ' ' || c.code === '??') && !conflicts.includes(c)),
    conflicts,
  }
}
