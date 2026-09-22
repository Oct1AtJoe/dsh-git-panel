/** /git-panel 路由的类型化传输层。 */
import type { BranchesView, FileStatusView, GraphView, OpResult, WorkspaceFileRead } from '../core/types.ts'

export interface GitError {
  code: string
  message: string
}

export type Envelope<T> = { ok: true; value: T } | { ok: false; error: GitError }

async function post<T>(path: string, payload: unknown): Promise<Envelope<T>> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, error: { code: 'internal', message: 'git route unavailable' } }
  }
  try {
    return (await response.json()) as Envelope<T>
  } catch {
    return { ok: false, error: { code: 'internal', message: `bad response (HTTP ${response.status})` } }
  }
}

/** 浏览器端的 git 面板 API。 */
export class GitPanelApi {
  /** 轻量接口：仅获取当前分支（用于 chip 标签）。 */
  current(path: string) {
    return post<{ repo: string; current: string }>('/git-panel/current', { path })
  }

  branches(path: string) {
    return post<BranchesView>('/git-panel/branches', { path })
  }

  graph(path: string) {
    return post<GraphView>('/git-panel/graph', { path })
  }

  switchBranch(path: string, branch: string) {
    return post<OpResult>('/git-panel/switch', { path, branch })
  }

  /** 中止当前在飞的 git 进程。 */
  cancel(path: string) {
    return post<{ cancelled: boolean }>('/git-panel/cancel', { path })
  }

  pull(path: string) {
    return post<OpResult>('/git-panel/pull', { path })
  }

  fetchAll(path: string) {
    return post<OpResult>('/git-panel/fetch', { path })
  }

  renameBranch(path: string, branch: string, newName: string) {
    return post<OpResult>('/git-panel/rename', { path, branch, newName })
  }

  deleteBranch(path: string, branch: string) {
    return post<OpResult>('/git-panel/delete', { path, branch })
  }

  deleteRemoteBranch(path: string, branch: string) {
    return post<OpResult>('/git-panel/delete-remote', { path, branch })
  }

  mergeBranch(path: string, branch: string) {
    return post<OpResult>('/git-panel/merge', { path, branch })
  }

  status(path: string) {
    return post<OpResult>('/git-panel/status', { path })
  }

  diffFile(path: string, file: string) {
    return post<OpResult>('/git-panel/diff', { path, file })
  }

  showHead(path: string, file: string) {
    return post<OpResult>('/git-panel/show-head', { path, file })
  }

  saveFile(path: string, file: string, content: string) {
    return post<OpResult>('/git-panel/save-file', { path, file, content })
  }

  /** 工作区变更清单（含 porcelain 状态码），文件树装饰与路由门禁共用。 */
  fileStatus(path: string) {
    return post<FileStatusView>('/git-panel/file-status', { path })
  }

  /** 读取工作区文件当前内容。 */
  readFile(path: string, file: string) {
    return post<WorkspaceFileRead>('/git-panel/read-file', { path, file })
  }

  stageFile(path: string, file: string) {
    return post<OpResult>('/git-panel/stage', { path, file })
  }

  unstageFile(path: string, file: string) {
    return post<OpResult>('/git-panel/unstage', { path, file })
  }

  discardFile(path: string, file: string, untracked: boolean) {
    return post<OpResult>('/git-panel/discard', { path, file, untracked })
  }

  cherryPick(path: string, sha: string) {
    return post<OpResult>('/git-panel/cherry-pick', { path, sha })
  }

  revertCommit(path: string, sha: string) {
    return post<OpResult>('/git-panel/revert', { path, sha })
  }

  commit(path: string, message: string) {
    return post<OpResult>('/git-panel/commit', { path, message })
  }

  /** 读取暂存区内容，由当前默认模型生成一条提交信息。 */
  generateCommitMessage(path: string) {
    return post<{ message: string }>('/git-panel/generate-commit-message', { path })
  }

  push(path: string) {
    return post<OpResult>('/git-panel/push', { path })
  }

  sync(path: string) {
    return post<OpResult>('/git-panel/sync', { path })
  }

  setCredential(path: string, host: string, username: string, password: string) {
    return post<OpResult>('/git-panel/set-credential', { path, host, username, password })
  }

  stashList(path: string) {
    return post<OpResult>('/git-panel/stash-list', { path })
  }

  stashPush(path: string, message?: string) {
    return post<OpResult>('/git-panel/stash-push', { path, message: message ?? '' })
  }

  stashPop(path: string) {
    return post<OpResult>('/git-panel/stash-pop', { path })
  }
}
