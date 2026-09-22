/**
 * 「自动生成提交信息」的端到端自检：用一个 stub 的 llm 服务跑通
 * 暂存区读取、空暂存区 / 无模型 / 成功三条路径，断言失败路径不改动输入。
 * 与 test-host.ts 同一套路——用 esbuild 打包后由 node 运行，无需 DSH 运行时。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { GitService, type GitRunner } from '../src/host/git-service.ts'
import { generateCommitMessage } from '../src/host/commit-message.ts'

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

const service = new GitService(runner, async (p) => ({ ok: true, canonical: p }))

function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

/** 构造一个只暴露 llm / agentDefaultModel 的 Context 替身。 */
function fakeContext(options: { provider?: string; model?: string; reply?: string; fail?: string }): Context {
  const llm = {
    stream() {
      const chunks: unknown[] = options.fail === undefined
        ? [{ type: 'text-delta', index: 0, text: options.reply ?? '' }, { type: 'finish', reason: { kind: 'stop' } }]
        : [{ type: 'finish', reason: { kind: 'error', failure: { message: options.fail, code: 'X' } } }]
      return {
        async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
      }
    },
  }
  const stub: Record<string, unknown> = {
    llm,
    agentDefaultModel: {
      currentSelection: () => ({ provider: options.provider, model: options.model }),
    },
  }
  return { get: (name: string) => stub[name] } as unknown as Context
}

async function git(cwd: string, argv: string[]): Promise<void> {
  const run = await runner.run(argv, cwd)
  if (run.exitCode !== 0) throw new Error(`git ${argv.join(' ')}: ${run.stderr}`)
}

async function main(): Promise<void> {
  const repo = mkdtempSync(join(tmpdir(), 'gitpanel-gen-'))
  try {
    await git(repo, ['init', '-q'])
    await git(repo, ['config', 'user.email', 'test@test.com'])
    await git(repo, ['config', 'user.name', 'Tester'])
    writeFileSync(join(repo, 'a.txt'), 'hello\n')
    await git(repo, ['add', 'a.txt'])
    await git(repo, ['commit', '-qm', 'feat: init'])

    // 1) 暂存区为空（有一个未暂存改动）→ stagedContext.diff 为空
    writeFileSync(join(repo, 'a.txt'), 'hello\nworld\n')
    const clean = await service.stagedContext(repo)
    check('stagedContext 返回暂存区为空', clean.ok && clean.diff.trim() === '', clean.ok ? '' : clean.error.message)

    // 2) 空暂存区 → empty-stage，且不产生任何信息
    const empty = await generateCommitMessage(fakeContext({ provider: 'p', model: 'm', reply: 'x' }), service, repo)
    check('空暂存区报 empty-stage', !empty.ok && empty.error.code === 'empty-stage', empty.ok ? empty.message : empty.error.code)

    // 3) 暂存改动 → stagedContext 带出 diff 与历史主题
    await git(repo, ['add', '-A'])
    const staged = await service.stagedContext(repo)
    check('stagedContext 带出 diff', staged.ok && staged.diff.includes('+world'), staged.ok ? '' : staged.error.message)
    check('stagedContext 带出历史主题', staged.ok && staged.subjects[0] === 'feat: init', staged.ok ? String(staged.subjects) : staged.error.message)

    // 4) 无默认模型 → no-model
    const noModel = await generateCommitMessage(fakeContext({}), service, repo)
    check('无模型报 no-model', !noModel.ok && noModel.error.code === 'no-model', noModel.ok ? noModel.message : noModel.error.code)

    // 5) 正常生成 → 回填信息，且剥掉代码围栏
    const ok = await generateCommitMessage(
      fakeContext({ provider: 'deepseek', model: 'chat', reply: '```\nfeat: add world line\n```' }),
      service,
      repo,
    )
    check('生成成功', ok.ok && ok.message === 'feat: add world line', ok.ok ? ok.message : ok.error.message)

    // 6) 模型失败 → generate-failed（客户端据此保留输入框原文）
    const failed = await generateCommitMessage(fakeContext({ provider: 'deepseek', model: 'chat', fail: 'boom' }), service, repo)
    check('模型失败报 generate-failed', !failed.ok && failed.error.code === 'generate-failed', failed.ok ? failed.message : failed.error.code)

    // 7) 模型返回空 → generate-failed，而不是回填空串
    const blank = await generateCommitMessage(fakeContext({ provider: 'deepseek', model: 'chat', reply: '   ' }), service, repo)
    check('空输出报 generate-failed', !blank.ok && blank.error.code === 'generate-failed', blank.ok ? blank.message : blank.error.code)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error('测试失败:', error); process.exit(1) })
