/**
 * 变更清单的未跟踪文件展开自检。
 *
 * 锁定的回归：`status()` 若不带 `--untracked-files=all`，git 会把整个未跟踪目录
 * 折叠成一行 `?? dir/`，于是「目录里有 N 个文件」在面板上只显示 1 行，
 * 且该行路径带尾部斜杠（行内动作拿到的是目录而非文件）。
 *
 * 因此这里断言三条：
 * 1. status() 会把未跟踪目录展开为目录下的每个文件；
 * 2. status() 与 fileStatus() 对同一仓库给出一致的文件集合（两条路径不得打架）；
 * 3. 展开后的路径是文件路径（不带尾部斜杠），可直接喂给 stageFile / diffFile。
 * 用 esbuild 打包后由 node 运行，无需 DSH 运行时。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitService, type GitRunner } from '../src/host/git-service.ts'

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

// 与生产一致：门禁先 realpath（否则 Windows 上 mkdtemp 的 8.3 短路径会让
// fileStatus 里的 relativePath 算出 ../.. 而丢弃全部条目）。
const service = new GitService(runner, async (p) => ({ ok: true, canonical: await realpath(p) }))

function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

/** 复刻客户端对 status() 输出的解析（固定宽度 slice）。 */
function parsePorcelain(output: string): Array<{ code: string; file: string }> {
  const list: Array<{ code: string; file: string }> = []
  for (const line of output.split('\n')) {
    if (line.trim() === '' || line.length < 4) continue
    const code = line.slice(0, 2)
    const file = line.slice(3).trim()
    if (file !== '') list.push({ code, file })
  }
  return list
}

const NESTED = 5

async function main(): Promise<void> {
  const repo = mkdtempSync(join(tmpdir(), 'gitpanel-untracked-'))
  try {
    const git = async (argv: string[]): Promise<void> => {
      const run = await runner.run(argv, repo)
      if (run.exitCode !== 0) throw new Error(`git ${argv.join(' ')}: ${run.stderr}`)
    }
    await git(['init', '-q'])
    await git(['config', 'user.email', 'test@test.com'])
    await git(['config', 'user.name', 'Tester'])
    writeFileSync(join(repo, 'tracked.txt'), 'base\n')
    await git(['add', 'tracked.txt'])
    await git(['commit', '-qm', 'feat: init'])

    // 一个未跟踪目录，内含多个嵌套文件（还原 .tmp-gitgraph 那种情形）。
    const dir = join(repo, 'untracked-dir')
    mkdirSync(join(dir, 'nested'), { recursive: true })
    for (let i = 0; i < NESTED; i += 1) writeFileSync(join(dir, `file-${i}.txt`), `${i}\n`)
    writeFileSync(join(dir, 'nested', 'deep.txt'), 'deep\n')
    // 另加一个未跟踪的顶层文件。
    writeFileSync(join(repo, 'loose.txt'), 'loose\n')
    // 一条已暂存、一条未暂存的已跟踪改动。
    writeFileSync(join(repo, 'tracked.txt'), 'base\nchanged\n')

    const expectedUntracked = NESTED + 1 + 1 // NESTED + nested/deep.txt + loose.txt

    const statusResult = await service.status(repo)
    const fromStatus = parsePorcelain(statusResult.ok ? statusResult.output : '')
    const untrackedFromStatus = fromStatus.filter((e) => e.code === '??')

    check(
      `status() 展开未跟踪目录（期望 ${expectedUntracked} 条 ?? ，实际 ${untrackedFromStatus.length}）`,
      untrackedFromStatus.length === expectedUntracked,
      JSON.stringify(untrackedFromStatus.map((e) => e.file)),
    )
    check(
      'status() 不含折叠目录行（无尾部斜杠条目）',
      !untrackedFromStatus.some((e) => e.file.endsWith('/')),
      JSON.stringify(untrackedFromStatus.filter((e) => e.file.endsWith('/')).map((e) => e.file)),
    )

    // 与 fileStatus() 给出一致的未跟踪集合（两条路径不得打架）。
    const fileStatus = await service.fileStatus(repo)
    const untrackedFromFileStatus = fileStatus.ok
      ? fileStatus.value.entries.filter((e) => e.code === '??').map((e) => e.path)
      : []
    const a = untrackedFromStatus.map((e) => e.file).sort()
    const b = [...untrackedFromFileStatus].sort()
    check('status() 与 fileStatus() 未跟踪集合一致', JSON.stringify(a) === JSON.stringify(b),
      `status=${JSON.stringify(a)} fileStatus=${JSON.stringify(b)}`)

    // 展开后的路径必须能直接用于逐文件操作（回归点：折叠行会喂进目录）。
    const firstNested = untrackedFromStatus.find((e) => e.file.includes('file-0.txt'))
    check('展开后的路径是文件路径，可被 stageFile 接受',
      firstNested !== undefined && (await service.stageFile(repo, firstNested.file)).ok === true,
      firstNested?.file ?? 'not found')

    // 未跟踪文件经 stageFile 暂存后应转为已暂存（A ），而不是报错。
    const afterStage = parsePorcelain((await service.status(repo)).output)
    check('暂存未跟踪文件后变为已暂存（A ）',
      afterStage.some((e) => e.code === 'A ' && e.file.includes('file-0.txt')),
      JSON.stringify(afterStage.filter((e) => e.file.includes('file-0.txt'))))

    // 总数：1 已暂存 + 1 未暂存已跟踪 + 剩余未跟踪。
    const total = afterStage.length
    const expectedTotal = 1 + 1 + (expectedUntracked - 1)
    check(`变更总数正确（期望 ${expectedTotal}，实际 ${total}）`, total === expectedTotal, JSON.stringify(afterStage))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error('测试失败:', error); process.exit(1) })
