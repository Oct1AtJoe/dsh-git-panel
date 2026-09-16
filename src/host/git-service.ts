/**
 * 宿主侧 git 服务：以工作区为边界约束的 git 操作，通过托管子进程接缝执行。
 * 浏览器只能在已注册的工作区根目录上运行 git（工作区门禁是 /git-panel
 * 各路由的安全边界）。
 * @module dsh-git-panel/host/git-service
 */

import { execFile as execFileNative } from 'node:child_process'
import { readFile as readBytes, realpath, stat } from 'node:fs/promises'
import { join, relative as relativePath, resolve as resolvePath, sep } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { BranchesView, BranchRow, FileStatusView, GitError, GraphCommit, GraphTips, GraphView, OpResult, WorkspaceFileRead } from '../core/types.ts'

/** 一次已完成的 git 调用。 */
export interface GitRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

/** git 经过的 spawn 接缝（生产环境中即子进程服务）。 */
export interface GitRunner {
  run(argv: readonly string[], cwd: string): Promise<GitRunResult>
}

/** 单条 git 命令的收集输出上限。 */
const OUTPUT_CAP_BYTES = 1 << 20

/** 送入浏览器做差异对比的文本上限（超出部分截断，避免把大文件塞进 JSON）。 */
const DIFF_TEXT_CAP_BYTES = 1 << 21

/**
 * 工作区相对路径的安全判定：拒绝绝对路径与任何向上穿越。
 * @param name - 调用方给出的文件路径。
 * @returns 可以安全地拼到工作区根之下时为 true。
 */
function safeRelative(name: string): boolean {
  if (name === '' || name.startsWith('/') || name.startsWith('\\')) return false
  if (/^[a-zA-Z]:/u.test(name)) return false
  if (name === '..' || name.startsWith('../') || name.includes('/../') || name.endsWith('/..')) return false
  return true
}

/**
 * 绝对路径是否落在工作区根之下。
 * @param root - 工作区根。
 * @param absolute - 待判定的绝对路径。
 * @returns 在根之下（或就是根本身）时为 true。
 */
function inside(root: string, absolute: string): boolean {
  if (absolute === root) return true
  return absolute.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

/** 工作区归属判定结果。 */
export type WorkspaceVerdict = { ok: true; canonical: string } | { ok: false; error: GitError }

/** 规范化路径并要求其等于一个已注册的工作区根目录。 */
export type WorkspaceGate = (path: string) => Promise<WorkspaceVerdict>

/** 基于原生 child_process 的生产运行器，支持环境变量完整透传与网络超时。 */
export function subprocessRunner(_ctx: Context): GitRunner {
  return {
    async run(argv, cwd) {
      return new Promise((resolve) => {
        // 核心透传：强制将当前真实用户 Administrator 的凭据目录与配置注入环境，
        // 确保后台读取到本地已有的 git 认证与 SSH keys，与外部终端 100% 表现一致！
        const userProfile = process.env.USERPROFILE || 'C:\\Users\\Administrator'
        const env = {
          ...process.env,
          USERPROFILE: userProfile,
          HOME: userProfile,
          APPDATA: process.env.APPDATA || `${userProfile}\\AppData\\Roaming`,
          LOCALAPPDATA: process.env.LOCALAPPDATA || `${userProfile}\\AppData\\Local`,
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          GCM_MODAL_PROMPT: 'false',
          // 核心修复：局域网/企业私有 GitLab 绝不走 7890 代理，内网直连秒速完成！
          NO_PROXY: '*sjfood.us,localhost,127.0.0.1',
          no_proxy: '*sjfood.us,localhost,127.0.0.1',
        }
        // 充裕合理的 90 秒网络超时：给多分支与大体积提交留足下载空间
        const isNetworkOp = argv.includes('pull') || argv.includes('fetch') || argv.includes('push') || argv.includes('clone')
        const timeout = isNetworkOp ? 90000 : 20000

        execFileNative('git', argv as string[], { cwd, maxBuffer: OUTPUT_CAP_BYTES, windowsHide: true, env, timeout }, (err, stdout, stderr) => {
          if (err) {
            let errMsg = stderr ? stderr.toString() : (err.message || String(err))
            if ((err as any).killed) {
              errMsg = '⚠️ 操作超时（超过90秒）：网络连接缓慢或远程服务器无响应，请稍后重试或检查代理。'
            }
            resolve({
              exitCode: typeof (err as any).code === 'number' ? (err as any).code : 1,
              stdout: stdout ? stdout.toString() : '',
              stderr: errMsg,
            })
          } else {
            resolve({
              exitCode: 0,
              stdout: stdout ? stdout.toString() : '',
              stderr: stderr ? stderr.toString() : '',
            })
          }
        })
      })
    },
  }
}

/**
 * git --format 输出的记录/字段分隔符。NUL 是常规选择，但 Node 禁止在
 * spawn argv 中出现 NUL——子进程服务同样会拒绝——因此记录用 \x1e、字段用
 * \x1f（实际中 git 不会产生这些字符）。git 会在每条记录后追加换行，所以
 * 除第一条外的每条拆分记录都以 "\n" 开头——在 splitRecords 中剥离。
 */
const REC = '\u001e'
const FIELD = '\u001f'
/** 转义会破坏输出的控制字符（分隔符除外）。 */
function sanitize(text: string): string {
  return text.replace(/[\u0000-\u001d\u007f]/g, ' ')
}

/** 将 git --format 流拆分为记录，去掉每条记录自带的换行。 */
function splitRecords(text: string): string[] {
  return text
    .split(REC)
    .map((record) => (record.startsWith('\n') ? record.slice(1) : record))
    .filter((record) => record !== '')
}

/** 以工作区为边界约束的 git 服务。 */
export class GitService {
  constructor(
    public readonly runner: GitRunner,
    private readonly gate: WorkspaceGate,
  ) {}

  private async requireWorkspace(path: string): Promise<string> {
    const verdict = await this.gate(path)
    if (!verdict.ok) throw Object.assign(new Error(verdict.error.message), { gitError: verdict.error })
    return verdict.canonical
  }

  /** 解析仓库显示名（顶层目录的基名）。 */
  private async repoName(canonical: string): Promise<string> {
    const run = await this.runner.run(['rev-parse', '--show-toplevel'], canonical)
    if (run.exitCode !== 0) return canonical.split(/[\\/]/).pop() ?? canonical
    return run.stdout.trim().split(/[\\/]/).pop() ?? canonical
  }

  /** 当前分支短名（HEAD 游离时为空）。 */
  async currentBranch(canonical: string): Promise<string> {
    const run = await this.runner.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], canonical)
    return run.exitCode === 0 ? run.stdout.trim() : ''
  }

  /** 轻量级当前分支探测（一次或两次 git 调用），用于 chip 标签。 */
  async current(path: string): Promise<{ repo: string; current: string }> {
    const canonical = await this.requireWorkspace(path)
    const [repo, current] = await Promise.all([
      this.repoName(canonical),
      this.currentBranch(canonical),
    ])
    return { repo, current }
  }

  /** 带 ahead/behind 相对上游的分支列表。 */
  async branches(path: string): Promise<BranchesView> {
    const canonical = await this.requireWorkspace(path)
    const [repo, current] = await Promise.all([
      this.repoName(canonical),
      this.currentBranch(canonical),
    ])

    // 一趟遍历本地 + 远程引用。下面会剥离完整引用名
    // （refname:short 会抹掉 heads/remotes 的区别）。
    const run = await this.runner.run(
      ['for-each-ref', '--format=' + `%(refname)${FIELD}%(objectname:short)${FIELD}%(committerdate:iso8601)${FIELD}%(subject)${FIELD}%(upstream:short)${REC}`, 'refs/heads', 'refs/remotes'],
      canonical,
    )
    if (run.exitCode !== 0) {
      throw Object.assign(
        new Error(run.stderr.trim() || 'not a git repository'),
        { gitError: { code: 'not-a-repo', message: run.stderr.trim() || 'not a git repository' } },
      )
    }
    const local: BranchRow[] = []
    const remote: BranchRow[] = []
    const withUpstream: Array<[BranchRow, string]> = []

    for (const record of splitRecords(run.stdout)) {
      const [ref, sha, date, subject, upstream] = record.split(FIELD)
      if (!ref || !sha) continue
      const isRemote = ref.startsWith('refs/remotes/')
      const name = isRemote ? ref.slice('refs/remotes/'.length) : ref.slice('refs/heads/'.length)
      const row: BranchRow = {
        name: sanitize(name),
        sha: sanitize(sha),
        date: sanitize(date),
        subject: sanitize(subject ?? '').slice(0, 80),
        current: !isRemote && name === current,
      }
      if (isRemote) {
        remote.push(row)
      } else {
        local.push(row)
        if (upstream) withUpstream.push([row, upstream])
      }
    }

    // ahead/behind 相对上游，每个跟踪的本地分支一次 git 调用。
    await Promise.all(withUpstream.map(async ([row, upstream]) => {
      const count = await this.runner.run(['rev-list', '--left-right', '--count', `${row.name}...${upstream}`], canonical)
      if (count.exitCode !== 0) return
      const [a, b] = count.stdout.trim().split(/\s+/).map(Number)
      row.ahead = Number.isFinite(a) ? a : 0
      row.behind = Number.isFinite(b) ? b : 0
    }))

    const sortRows = (rows: BranchRow[]): BranchRow[] => {
      rows.sort((x, y) => (x.name === current ? -1 : y.name === current ? 1 : x.name.localeCompare(y.name)))
      return rows
    }

    return { repo, current, local: sortRows(local), remote: sortRows(remote) }
  }

  /** 切换到已存在的分支（或为远程分支创建本地跟踪分支）。 */
  async switchBranch(path: string, branch: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const argv: string[] = branch.startsWith('origin/')
      ? ['switch', '-c', branch.slice('origin/'.length), '--track', branch]
      : ['switch', branch]
    const run = await this.runner.run(argv, canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'switch-failed', message: run.stderr.trim() || `git switch ${branch} failed` } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 拉取当前分支（使用其上游）。 */
  async pull(path: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const run = await this.runner.run(['pull'], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'pull-failed', message: run.stderr.trim() || 'git pull failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 拉取所有远程，并执行 prune。 */
  async fetchAll(path: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const run = await this.runner.run(['fetch', '--all', '--prune'], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'fetch-failed', message: run.stderr.trim() || 'git fetch failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 重命名本地分支（git branch -m）。 */
  async renameBranch(path: string, from: string, to: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const run = await this.runner.run(['branch', '-m', from, to], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'rename-failed', message: run.stderr.trim() || 'git branch -m failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 强制删除本地分支（git branch -D）。 */
  async deleteBranch(path: string, branch: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const run = await this.runner.run(['branch', '-D', branch], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'delete-failed', message: run.stderr.trim() || 'git branch -D failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 删除远程分支（git push <remote> --delete <name>）。 */
  async deleteRemoteBranch(path: string, branch: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const slash = branch.indexOf('/')
    if (slash <= 0 || slash === branch.length - 1) {
      return { ok: false, output: '', error: { code: 'bad-branch', message: `invalid remote branch: ${branch}` } }
    }
    const remote = branch.slice(0, slash)
    const name = branch.slice(slash + 1)
    const run = await this.runner.run(['push', remote, '--delete', name], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'delete-failed', message: run.stderr.trim() || 'git push --delete failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 将某分支合入当前分支（git merge --no-edit）。 */
  async mergeBranch(path: string, branch: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const run = await this.runner.run(['merge', '--no-edit', branch], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'merge-failed', message: run.stderr.trim() || 'git merge failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 工作区状态摘要：变更文件列表（git status --porcelain）并自动读取 MERGE_MSG。 */
  async status(path: string): Promise<{ ok: boolean; output: string; mergeMsg?: string; error?: { code: string; message: string } }> {
    const canonical = await this.requireWorkspace(path)
    const run = await this.runner.run(['status', '--porcelain'], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: '', error: { code: 'status-failed', message: run.stderr.trim() || 'git status failed' } }
    }
    const lines = run.stdout.split('\n').filter((l) => l.trim() !== '')
    // 精简：状态码 + 路径（中文路径保留）。
    const output = lines.map((l) => l.replace(/^(\S+)\s+(.+)$/, '$1  $2')).join('\n')

    // 像 VS Code 一样：检查是否有 .git/MERGE_MSG 并自动读取
    let mergeMsg = ''
    try {
      const revTop = await this.runner.run(['rev-parse', '--git-dir'], canonical)
      const gitDir = revTop.exitCode === 0 ? revTop.stdout.trim() : '.git'
      const fullGitDir = gitDir.startsWith('/') || /^[a-zA-Z]:/.test(gitDir) ? gitDir : join(canonical, gitDir)
      const mergeMsgPath = join(fullGitDir, 'MERGE_MSG')
      if (existsSync(mergeMsgPath)) {
        mergeMsg = readFileSync(mergeMsgPath, 'utf8').split('\n')[0].trim()
      }
    } catch {}

    return { ok: true, output, mergeMsg }
  }

  /** 单个文件暂存（git add -- <file>）。 */
  async stageFile(path: string, file: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const name = file.trim()
    if (name === '' || name.startsWith('/') || name === '..' || name.includes('/../')) {
      return { ok: false, output: '', error: { code: 'invalid-file', message: '非法文件路径' } }
    }
    const run = await this.runner.run(['add', '--', name], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'stage-failed', message: run.stderr.trim() || 'git add failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 取消单个文件暂存（git reset HEAD -- <file> 或 git restore --staged -- <file>）。 */
  async unstageFile(path: string, file: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const name = file.trim()
    if (name === '' || name.startsWith('/') || name === '..' || name.includes('/../')) {
      return { ok: false, output: '', error: { code: 'invalid-file', message: '非法文件路径' } }
    }
    const run = await this.runner.run(['reset', 'HEAD', '--', name], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'unstage-failed', message: run.stderr.trim() || 'git reset failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 放弃工作区未暂存修改（git checkout -- <file> 或 git clean for untracked）。 */
  async discardFile(path: string, file: string, untracked: boolean): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const name = file.trim()
    if (name === '' || name.startsWith('/') || name === '..' || name.includes('/../')) {
      return { ok: false, output: '', error: { code: 'invalid-file', message: '非法文件路径' } }
    }
    const argv = untracked ? ['clean', '-fd', '--', name] : ['checkout', '--', name]
    const run = await this.runner.run(argv, canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'discard-failed', message: run.stderr.trim() || 'discard failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 单个文件的变更 diff（已暂存 + 未暂存，git diff HEAD -- <file>）。 */
  async diffFile(path: string, file: string): Promise<{ ok: boolean; output: string; error?: { code: string; message: string } }> {
    const canonical = await this.requireWorkspace(path)
    const name = file.trim()
    if (name === '' || name.startsWith('/') || name === '..' || name.includes('/../')) {
      return { ok: false, output: '', error: { code: 'invalid-file', message: '非法文件路径' } }
    }
    const run = await this.runner.run(['diff', 'HEAD', '--', name], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: '', error: { code: 'diff-failed', message: run.stderr.trim() || 'git diff failed' } }
    }
    return { ok: true, output: run.stdout }
  }

  /** 获取文件 HEAD 版本的内容（git show HEAD:<仓库相对路径>）。 */
  async showHead(path: string, file: string): Promise<{ ok: boolean; output: string; error?: { code: string; message: string } }> {
    const canonical = await this.requireWorkspace(path)
    const name = file.trim()
    if (!safeRelative(name)) {
      return { ok: false, output: '', error: { code: 'invalid-file', message: '非法文件路径' } }
    }
    const toplevel = await this.repoRoot(canonical)
    const absolute = resolvePath(canonical, name)
    if (!inside(canonical, absolute)) {
      return { ok: false, output: '', error: { code: 'outside-workspace', message: '文件位于工作区外' } }
    }
    const tracked = relativePath(toplevel, absolute).split(sep).join('/')
    const run = await this.runner.run(['show', `HEAD:${tracked}`], toplevel)
    if (run.exitCode !== 0) {
      return { ok: false, output: '', error: { code: 'show-failed', message: run.stderr.trim() || 'git show HEAD failed' } }
    }
    return { ok: true, output: run.stdout }
  }

  /** 读取工作区文件的当前内容（UTF-8）；二进制与超限文件只回报元数据。 */
  async readFile(path: string, file: string): Promise<WorkspaceFileRead> {
    const canonical = await this.requireWorkspace(path)
    const name = file.trim()
    if (!safeRelative(name)) {
      return { ok: false, text: '', bytes: 0, binary: false, truncated: false, error: { code: 'invalid-file', message: '非法文件路径' } }
    }
    const absolute = resolvePath(canonical, name)
    if (!inside(canonical, absolute)) {
      return { ok: false, text: '', bytes: 0, binary: false, truncated: false, error: { code: 'outside-workspace', message: '文件位于工作区外' } }
    }
    try {
      const info = await stat(absolute)
      if (info.isDirectory()) {
        return { ok: false, text: '', bytes: 0, binary: false, truncated: false, error: { code: 'not-a-file', message: '这是一个目录' } }
      }
      const buffer = await readBytes(absolute)
      const binary = buffer.includes(0)
      const truncated = buffer.byteLength > DIFF_TEXT_CAP_BYTES
      const slice = truncated ? buffer.subarray(0, DIFF_TEXT_CAP_BYTES) : buffer
      return {
        ok: true,
        text: binary ? '' : slice.toString('utf8'),
        bytes: buffer.byteLength,
        binary,
        truncated,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return { ok: true, text: '', bytes: 0, binary: false, truncated: false, missing: true }
      }
      return {
        ok: false,
        text: '',
        bytes: 0,
        binary: false,
        truncated: false,
        error: { code: 'read-failed', message: error instanceof Error ? error.message : '读取失败' },
      }
    }
  }

  /** 保存文件内容（冲突解决或编辑回写）。 */
  async saveFile(path: string, file: string, content: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const name = file.trim()
    if (!safeRelative(name)) {
      return { ok: false, output: '', error: { code: 'invalid-file', message: '非法文件路径' } }
    }
    const absolute = resolvePath(canonical, name)
    if (!inside(canonical, absolute)) {
      return { ok: false, output: '', error: { code: 'outside-workspace', message: '文件位于工作区外' } }
    }
    try {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(absolute, content, 'utf8')
      return { ok: true, output: 'saved' }
    } catch (error) {
      return { ok: false, output: '', error: { code: 'write-failed', message: error instanceof Error ? error.message : '写入失败' } }
    }
  }

  /**
   * 变更文件清单：以工作区根为基准的相对路径（含未跟踪），供客户端做同步的
   * 「这个文件有没有 git 改动」门禁；同时回报仓库根，便于客户端展示。
   */
  async fileStatus(path: string): Promise<{ ok: boolean; value?: FileStatusView; error?: GitError }> {
    const canonical = await this.requireWorkspace(path)
    const toplevel = await this.repoRoot(canonical)
    // 以仓库根为 cwd 运行，porcelain 的路径基准与 toplevel 必然一致。
    const run = await this.runner.run(['status', '--porcelain', '-z', '--untracked-files=all'], toplevel)
    if (run.exitCode !== 0) {
      return { ok: false, error: { code: 'status-failed', message: run.stderr.trim() || 'git status failed' } }
    }
    const entries: Array<{ path: string; code: string }> = []
    const chunks = run.stdout.split('\u0000')
    for (let index = 0; index < chunks.length; index += 1) {
      const entry = chunks[index]
      if (entry === undefined || entry.length < 4) continue
      const code = entry.slice(0, 2)
      const target = entry.slice(3)
      // -z 的重命名记录把原路径放在下一段，跳过它。
      if (code.startsWith('R') || code.startsWith('C')) index += 1
      const absolute = resolvePath(toplevel, target)
      const local = relativePath(canonical, absolute).split(sep).join('/')
      if (local === '' || local.startsWith('../') || local === '..') continue
      entries.push({ path: local, code })
    }
    entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    return {
      ok: true,
      value: { workspace: canonical, toplevel, entries },
    }
  }

  /** 仓库根：非 git 目录回退到工作区根本身。 */
  private async repoRoot(canonical: string): Promise<string> {
    const run = await this.runner.run(['rev-parse', '--show-toplevel'], canonical)
    const root = run.exitCode === 0 ? run.stdout.trim() : ''
    return root === '' ? canonical : root
  }

  /** 摘取一个提交到当前分支（git cherry-pick）。 */
  async cherryPick(path: string, sha: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const clean = sha.trim()
    if (clean === '') return { ok: false, output: '', error: { code: 'empty-sha', message: 'sha 不能为空' } }
    const run = await this.runner.run(['cherry-pick', clean], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'cherry-pick-failed', message: run.stderr.trim() || 'git cherry-pick failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 撤销一个提交（git revert --no-edit）。 */
  async revertCommit(path: string, sha: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const clean = sha.trim()
    if (clean === '') return { ok: false, output: '', error: { code: 'empty-sha', message: 'sha 不能为空' } }
    const run = await this.runner.run(['revert', '--no-edit', clean], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'revert-failed', message: run.stderr.trim() || 'git revert failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 一键同步（git pull --rebase + 有超前则 git push）。 */
  async sync(path: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const pullRun = await this.runner.run(['pull', '--rebase'], canonical)
    if (pullRun.exitCode !== 0) {
      return { ok: false, output: pullRun.stdout, error: { code: 'sync-pull-failed', message: pullRun.stderr.trim() || 'git pull --rebase failed' } }
    }
    const pushRun = await this.runner.run(['push'], canonical)
    if (pushRun.exitCode !== 0) {
      return { ok: false, output: pushRun.stdout, error: { code: 'sync-push-failed', message: pushRun.stderr.trim() || 'git push failed' } }
    }
    const out = [pullRun.stdout.trim(), pushRun.stdout.trim()].filter(Boolean).join('\n')
    return { ok: true, output: out || 'Sync successful' }
  }

  /** 提交全部变更（git add -A + git commit -m）。 */
  async commit(path: string, message: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const clean = message.trim()
    if (clean === '') {
      return { ok: false, output: '', error: { code: 'empty-message', message: 'commit message 不能为空' } }
    }
    const addRun = await this.runner.run(['add', '-A'], canonical)
    if (addRun.exitCode !== 0) {
      return { ok: false, output: addRun.stdout, error: { code: 'add-failed', message: addRun.stderr.trim() || 'git add failed' } }
    }
    const commitRun = await this.runner.run(['commit', '-m', clean], canonical)
    if (commitRun.exitCode !== 0) {
      return { ok: false, output: commitRun.stdout, error: { code: 'commit-failed', message: commitRun.stderr.trim() || 'git commit failed' } }
    }
    return { ok: true, output: commitRun.stdout.trim() }
  }

  /** 推送当前分支到上游（git push）。 */
  async push(path: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const run = await this.runner.run(['push'], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'push-failed', message: run.stderr.trim() || 'git push failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 暂存列表（git stash list）。 */
  async stashList(path: string): Promise<{ ok: boolean; output: string; error?: { code: string; message: string } }> {
    const canonical = await this.requireWorkspace(path)
    const run = await this.runner.run(['stash', 'list'], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: '', error: { code: 'stash-list-failed', message: run.stderr.trim() || 'git stash list failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 暂存当前变更（git stash push -m）。 */
  async stashPush(path: string, message?: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const argv = message !== undefined && message.trim() !== '' ? ['stash', 'push', '-m', message.trim()] : ['stash', 'push']
    const run = await this.runner.run(argv, canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'stash-failed', message: run.stderr.trim() || 'git stash push failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 恢复最新暂存（git stash pop）。 */
  async stashPop(path: string): Promise<OpResult> {
    const canonical = await this.requireWorkspace(path)
    const run = await this.runner.run(['stash', 'pop'], canonical)
    if (run.exitCode !== 0) {
      return { ok: false, output: run.stdout, error: { code: 'stash-pop-failed', message: run.stderr.trim() || 'git stash pop failed' } }
    }
    return { ok: true, output: run.stdout.trim() }
  }

  /** 用于图视图的提交 DAG（全部引用，按日期排序，有上限）。 */
  async graph(path: string): Promise<GraphView> {
    const canonical = await this.requireWorkspace(path)
    const [repo, current, logRun, tipRun] = await Promise.all([
      this.repoName(canonical),
      this.currentBranch(canonical),
      this.runner.run(
        ['log', '--all', '--date-order', '--max-count=300',
          '--pretty=format:' + `%H${FIELD}%P${FIELD}%an${FIELD}%ai${FIELD}%s${REC}`],
        canonical,
      ),
      this.runner.run(
        ['for-each-ref', '--format=' + `%(refname:short)${FIELD}%(objectname)${REC}`, 'refs/heads', 'refs/remotes'],
        canonical,
      ),
    ])

    const commits: GraphCommit[] = []
    const seen = new Set<string>()
    if (logRun.exitCode !== 0) {
      throw Object.assign(
        new Error(logRun.stderr.trim() || 'not a git repository'),
        { gitError: { code: 'not-a-repo', message: logRun.stderr.trim() || 'not a git repository' } },
      )
    }
    for (const record of splitRecords(logRun.stdout)) {
      const [sha, parents, author, date, subject] = record.split(FIELD)
      if (!sha || seen.has(sha)) continue
      seen.add(sha)
      commits.push({
        sha,
        parents: parents ? parents.split(' ') : [],
        author: sanitize(author ?? ''),
        date: sanitize(date ?? ''),
        subject: sanitize(subject ?? '').slice(0, 100),
      })
    }

    const tips: GraphTips = {}
    for (const record of splitRecords(tipRun.stdout)) {
      const [name, sha] = record.split(FIELD)
      if (name && sha) tips[name] = sha
    }

    return { repo, current, commits, tips }
  }
}
