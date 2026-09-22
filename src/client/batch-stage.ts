/**
 * 批量暂存 / 取消暂存的执行序。
 *
 * 为什么串行而不是 `Promise.all`：git 的 index 自带锁文件，并发的 `git add`
 * 会互相争锁并随机报 「index.lock exists」；串行既正确，又不需要新增宿主
 * 批量路由或任何依赖。
 *
 * 为什么失败即停而不是继续：暂存失败通常意味着整个 index 处于异常状态
 * （锁残留、权限、磁盘），继续跑只会制造更多失败。停在这里并如实报告已成功
 * 的数量，调用方就能把「部分成功」与「全部成功」区分开。
 *
 * 独立成模块是为了能在没有 React 的环境里被自检覆盖。
 * @module dsh-git-panel/client/batch-stage
 */

/** 一次批量操作的结果。 */
export interface BatchOutcome {
  /** 成功处理的文件数。 */
  done: number
  /** 第一个失败的错误；全部成功时为 null。 */
  failure: { code: string; message: string } | null
}

/**
 * 串行地对一组文件执行同一个操作。
 * @param files - 目标文件（工作区相对路径）。
 * @param apply - 对单个文件执行的操作，返回 ok 或错误。
 * @returns 成功数量与首个失败。
 */
export async function runBatch(
  files: readonly string[],
  apply: (file: string) => Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }>,
): Promise<BatchOutcome> {
  let done = 0
  for (const file of files) {
    const result = await apply(file)
    if (!result.ok) return { done, failure: result.error }
    done += 1
  }
  return { done, failure: null }
}
