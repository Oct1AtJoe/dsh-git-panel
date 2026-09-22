/**
 * /git-panel/* 路由层：为查询和变更操作提供 JSON 封装（ok/error）。
 * 工作区门禁由服务层负责；本层负责 HTTP 形态。
 * @module dsh-git-panel/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { GitError } from '../core/types.ts'
import type { GitService } from './git-service.ts'
import { generateCommitMessage } from './commit-message.ts'

type Envelope<T> = { ok: true; value: T } | { ok: false; error: GitError }

const BODY_CAP_BYTES = 1 << 20

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const part = chunk as Buffer
    total += part.length
    if (total > BODY_CAP_BYTES) {
      req.destroy()
      return null
    }
    chunks.push(part)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function json(res: ServerResponse, envelope: Envelope<unknown>, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/** 从 JSON 对象载荷中提取必需的字符串字段。 */
function field(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value !== '' ? value : null
}

const BAD_REQUEST: GitError = { code: 'internal', message: 'malformed request' }

function route(service: GitService, ctx: Context) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://dsh')
    const path = url.pathname

    if (req.method !== 'POST') {
      json(res, { ok: false, error: { code: 'internal', message: 'method not allowed' } }, 405)
      return
    }

    const payload = await readJsonBody(req)
    const root = field(payload, 'path')
    if (root === null) {
      json(res, { ok: false, error: BAD_REQUEST }, 400)
      return
    }

    try {
      switch (path) {
        case '/git-panel/current': {
          const value = await service.current(root)
          json(res, { ok: true, value })
          return
        }
        case '/git-panel/branches': {
          const value = await service.branches(root)
          json(res, { ok: true, value })
          return
        }
        case '/git-panel/graph': {
          const value = await service.graph(root)
          json(res, { ok: true, value })
          return
        }
        case '/git-panel/switch': {
          const branch = field(payload, 'branch')
          if (branch === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.switchBranch(root, branch)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/pull': {
          const value = await service.pull(root)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/fetch': {
          const value = await service.fetchAll(root)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/rename': {
          const branch = field(payload, 'branch')
          const newName = field(payload, 'newName')
          if (branch === null || newName === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.renameBranch(root, branch, newName)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/delete': {
          const branch = field(payload, 'branch')
          if (branch === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.deleteBranch(root, branch)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/delete-remote': {
          const branch = field(payload, 'branch')
          if (branch === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.deleteRemoteBranch(root, branch)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/merge': {
          const branch = field(payload, 'branch')
          if (branch === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.mergeBranch(root, branch)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/status': {
          const value = await service.status(root)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/commit': {
          const message = field(payload, 'message')
          if (message === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.commit(root, message)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/generate-commit-message': {
          // 读取暂存区内容交给当前默认模型生成提交信息；暂存区为空与生成失败
          // 都以稳定错误码返回，由客户端分别呈现且不改动输入框。
          const value = await generateCommitMessage(ctx, service, root)
          json(res, value.ok ? { ok: true, value: { message: value.message } } : { ok: false, error: value.error })
          return
        }
        case '/git-panel/push': {
          const value = await service.push(root)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/sync': {
          const value = await service.sync(root)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/stash-list': {
          const value = await service.stashList(root)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/stash-push': {
          const message = field(payload, 'message')
          const value = await service.stashPush(root, message ?? undefined)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/stash-pop': {
          const value = await service.stashPop(root)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/diff': {
          const file = field(payload, 'file')
          if (file === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.diffFile(root, file)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/show-head': {
          const file = field(payload, 'file')
          if (file === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.showHead(root, file)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/save-file': {
          const file = field(payload, 'file')
          const content = typeof (payload as any)?.content === 'string' ? (payload as any).content : null
          if (file === null || content === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.saveFile(root, file, content)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/read-file': {
          const file = field(payload, 'file')
          if (file === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.readFile(root, file)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/cancel': {
          // 中止当前在飞的 git 进程（面板「取消」按钮），不必干等 90 秒超时。
          service.runner?.cancel?.()
          json(res, { ok: true, value: { cancelled: true } })
          return
        }
        case '/git-panel/set-credential': {
          const host = field(payload, 'host')
          const username = field(payload, 'username')
          const password = field(payload, 'password')
          if (!host || !username || !password) {
            json(res, { ok: false, error: BAD_REQUEST }, 400)
            return
          }
          try {
            const { homedir } = await import('node:os')
            const { join } = await import('node:path')
            const { readFileSync, writeFileSync, existsSync } = await import('node:fs')
            const credPath = join(homedir(), '.git-credentials')
            const encodedUser = encodeURIComponent(username)
            const encodedPass = encodeURIComponent(password)

            let currentContent = existsSync(credPath) ? readFileSync(credPath, 'utf8') : ''
            const lines = currentContent.split('\n').filter((l) => l.includes(`@${host}`) === false)
            lines.push(`https://${encodedUser}:${encodedPass}@${host}`)
            // 0600：凭据文件只允许本人读写。
            writeFileSync(credPath, lines.join('\n').trim() + '\n', { encoding: 'utf8', mode: 0o600 })

            // 刻意**不**把密码写进 .git/config 的 origin URL：
            // 那样会让 `git remote -v`、编辑器与任何读配置的进程都看到明文密码。
            // 运行时由 runner 以 `-c credential.helper=store --file=<credPath>` 注入，
            // 并在同一条命令里清空继承的助手链，既不碰钥匙串也不落盘到仓库配置。
            await service.runner.run(['config', '--global', `credential.https://${host}.provider`, 'generic'], root)
            await service.runner.run(['config', '--global', `credential.https://${host}.modalPrompt`, 'false'], root)
            await service.runner.run(['config', '--global', '--replace-all', `credential.https://${host}.helper`, 'store'], root)

            json(res, { ok: true, value: '凭据已安全绑定至当前仓库！' })
          } catch (e: any) {
            json(res, { ok: false, error: { code: 'credential-failed', message: e?.message || '保存凭据失败' } })
          }
          return
        }
        case '/git-panel/file-status': {
          const value = await service.fileStatus(root)
          json(res, value.ok ? { ok: true, value: value.value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/stage': {
          const file = field(payload, 'file')
          if (file === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.stageFile(root, file)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/unstage': {
          const file = field(payload, 'file')
          if (file === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.unstageFile(root, file)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/discard': {
          const file = field(payload, 'file')
          const untracked = (payload as Record<string, unknown>).untracked === true
          if (file === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.discardFile(root, file, untracked)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/cherry-pick': {
          const sha = field(payload, 'sha')
          if (sha === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.cherryPick(root, sha)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        case '/git-panel/revert': {
          const sha = field(payload, 'sha')
          if (sha === null) { json(res, { ok: false, error: BAD_REQUEST }, 400); return }
          const value = await service.revertCommit(root, sha)
          json(res, value.ok ? { ok: true, value } : { ok: false, error: value.error ?? BAD_REQUEST })
          return
        }
        default:
          json(res, { ok: false, error: { code: 'internal', message: `unknown route ${path}` } }, 404)
      }
    } catch (error) {
      const gitError: GitError = (error as { gitError?: GitError }).gitError
        ?? { code: 'internal', message: String(error instanceof Error ? error.message : error) }
      json(res, { ok: false, error: gitError })
    }
  }
}

/** 注册 /git-panel 各路由。 */
export function registerGitPanelRoutes(ctx: Context, service: GitService): () => void {
  return ctx.webServer.register({ kind: 'prefix', path: '/git-panel', handler: route(service, ctx) })
}
