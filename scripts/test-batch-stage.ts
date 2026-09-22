/**
 * 批量暂存 / 取消暂存的端到端自检。
 *
 * 两段：
 * 1. runBatch 的执行序（纯逻辑，无 React）：全成功、中途失败即停并如实报数、
 *    空列表；并断言调用是串行的（并发会争 git index 锁）。
 * 2. 走真实临时仓库，用 GitService 的既有单文件接口把「全部暂存 / 取消全部
 *    暂存」整条路跑一遍，确认复用既有接口就能达成批量语义。
 * 用 esbuild 打包后由 node 运行，无需 DSH 运行时。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitService, type GitRunner } from '../src/host/git-service.ts'
import { runBatch } from '../src/client/batch-stage.ts'

const runner: GitRunner = {
  run(argv, cwd) {
    return new Promise((resolve) => {
      const child = spawn('git', [...argv], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''; let stderr = ''
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
      child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }))
    })
  },
}

// 与生产一致的门禁替身：生产环境的 createWorkspaceGate（src/index.ts）会先
// realpath 规范化路径再交给服务层。这里必须照样规范化——否则 Windows 上
// mkdtempSync 返回的是 8.3 短路径（ADMINI~1），而 git 回报长路径，
// fileStatus 里的 relativePath 会算出 ../.. 从而丢弃全部条目。
const service = new GitService(runner, async (p) => ({ ok: true, canonical: await realpath(p) }))

function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

async function main(): Promise<void> {
  // ---- 1. runBatch 执行序 ----
  const seen: string[] = []
  const allOk = await runBatch(['a', 'b', 'c'], async (file) => {
    seen.push(file)
    return { ok: true as const }
  })
  check('runBatch 全部成功计数', allOk.done === 3 && allOk.failure === null, JSON.stringify(allOk))
  check('runBatch 按序处理每个文件', seen.join(',') === 'a,b,c', seen.join(','))

  // 串行性：每个操作在前一个 settle 之后才开始。
  let inflight = 0
  let maxInflight = 0
  const serial = await runBatch(['a', 'b', 'c', 'd'], async () => {
    inflight += 1
    maxInflight = Math.max(maxInflight, inflight)
    await new Promise((r) => setTimeout(r, 1))
    inflight -= 1
    return { ok: true as const }
  })
  check('runBatch 串行（并发峰值 1）', maxInflight === 1 && serial.done === 4, `maxInflight=${maxInflight}`)

  const stopped: string[] = []
  const partial = await runBatch(['a', 'b', 'c'], async (file) => {
    stopped.push(file)
    return file === 'b'
      ? { ok: false as const, error: { code: 'stage-failed', message: 'boom' } }
      : { ok: true as const }
  })
  check('失败即停：处理了 a,b 就中断', stopped.join(',') === 'a,b', stopped.join(','))
  check('失败时如实报告已完成数量', partial.done === 1 && partial.failure?.code === 'stage-failed', JSON.stringify(partial))

  const empty = await runBatch([], async () => ({ ok: true as const }))
  check('空列表不报错', empty.done === 0 && empty.failure === null, JSON.stringify(empty))

  // ---- 2. 真实仓库：复用既有单文件接口做批量 ----
  const repo = mkdtempSync(join(tmpdir(), 'gitpanel-batch-'))
  try {
    const git = async (argv: string[]): Promise<string> => {
      const run = await runner.run(argv, repo)
      if (run.exitCode !== 0) throw new Error(`git ${argv.join(' ')}: ${run.stderr}`)
      return run.stdout
    }
    await git(['init', '-q'])
    await git(['config', 'user.email', 'test@test.com'])
    await git(['config', 'user.name', 'Tester'])
    writeFileSync(join(repo, 'base.txt'), 'base\n')
    await git(['add', 'base.txt'])
    await git(['commit', '-qm', 'feat: init'])

    // 三个未暂存改动（含一个未跟踪文件）。
    writeFileSync(join(repo, 'one.txt'), '1\n')
    writeFileSync(join(repo, 'two.txt'), '2\n')
    writeFileSync(join(repo, 'base.txt'), 'base\nchanged\n')

    const before = await service.fileStatus(repo)
    check('初始有 3 个变更', before.ok && before.value.entries.length === 3, before.ok ? String(before.value.entries.length) : before.error.message)

    // 「全部暂存」= 对每个未暂存文件调用既有 stageFile。
    const targets = before.ok ? before.value.entries.map((e) => e.path) : []
    const staged = await runBatch(targets, (file) => service.stageFile(repo, file))
    check('全部暂存成功', staged.done === 3 && staged.failure === null, JSON.stringify(staged))

    const afterStage = await service.fileStatus(repo)
    // 注意 entries.length 断言：空数组的 .every() 恒为 true，只靠 every 会让
    // 「一条都没读到」被误判成通过。
    const allIndexed = afterStage.ok && afterStage.value.entries.length === 3
      && afterStage.value.entries.every((e) => e.code[0] !== ' ' && e.code[0] !== '?')
    check('全部暂存后 index 位全部已置', allIndexed, afterStage.ok ? JSON.stringify(afterStage.value.entries) : '')

    // 「取消全部暂存」= 对每个文件调用既有 unstageFile。
    const unstaged = await runBatch(targets, (file) => service.unstageFile(repo, file))
    check('取消全部暂存成功', unstaged.done === 3 && unstaged.failure === null, JSON.stringify(unstaged))

    const afterUnstage = await service.fileStatus(repo)
    const noneIndexed = afterUnstage.ok && afterUnstage.value.entries.length === 3
      && afterUnstage.value.entries.every((e) => e.code[0] === ' ' || e.code[0] === '?')
    check('取消全部暂存后 index 位全部清空', noneIndexed, afterUnstage.ok ? JSON.stringify(afterUnstage.value.entries) : '')

    // 不存在的路径：失败即停，且仍如实报数。
    const bad = await runBatch(['one.txt', 'no/such/dir/nope.txt', 'two.txt'], (file) => service.stageFile(repo, file))
    check('非法路径时失败即停', bad.done === 1 && bad.failure !== null, JSON.stringify(bad))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error('测试失败:', error); process.exit(1) })
