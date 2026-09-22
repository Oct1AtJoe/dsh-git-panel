/**
 * 「自动生成提交信息」：读取暂存区（staged）的变更内容，连同仓库最近若干条
 * 提交的主题一起交给当前默认模型，生成一条可直接提交的信息。
 *
 * 模型路由走 DSH 自身的 `llm` 与 `agentDefaultModel` 服务，两者都按需获取
 * （`ctx.get`）而非声明为必需依赖：缺少它们的部署仍能加载本插件，只是这个
 * 按钮会给出明确的 `no-model` 失败码。
 * @module dsh-git-panel/host/commit-message
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GitError } from '../core/types.ts'
import type { GitService } from './git-service.ts'

/** 送入模型的 diff 字符上限；超出部分截断，避免一次提交撑爆上下文。 */
const DIFF_CAP_CHARS = 24000

/** 生成结果的字符上限（防御性，正常远小于此）。 */
const MESSAGE_CAP_CHARS = 2000

/** 单次生成的整体超时。 */
const TIMEOUT_MS = 60000

/** 本模块需要的 `llm` 服务最小面孔。 */
interface LlmLike {
  stream(options: Record<string, unknown>): AsyncIterable<unknown>
}

/** `agentDefaultModel.currentSelection()` 的最小面孔。 */
interface ModelSelectionLike {
  provider?: unknown
  model?: unknown
}

/** 生成结果。 */
export type GenerateCommitMessageResult =
  | { ok: true; message: string }
  | { ok: false; error: GitError }

const SYSTEM = [
  'You write one git commit message for a staged change set.',
  'Match the repository: use the same language, the same prefix convention (e.g. feat/fix/docs/refactor) and the same tone as the recent commit subjects you are given.',
  'Describe what the change actually does, not that files were edited. Never invent work that the diff does not show.',
  'Return ONLY the commit message as plain text: no quotes, no Markdown code fences, no explanation, no trailing commentary.',
  'Use a single line unless the change genuinely needs a body; if it does, separate the subject from the body with one blank line.',
].join('\n')

/** 清理模型输出：剥掉代码围栏与首尾引号，只留纯文本。 */
function cleanMessage(raw: string): string {
  let text = raw.trim()
  const fence = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text)
  if (fence !== null) text = fence[1].trim()
  text = text.replace(/^["'“”‘’`]+/u, '').replace(/["'“”‘’`]+$/u, '').trim()
  return text.slice(0, MESSAGE_CAP_CHARS).trim()
}

/**
 * 依据暂存区变更生成一条提交信息。
 * @param ctx - 宿主上下文，用于按需获取 `llm` 与 `agentDefaultModel`。
 * @param service - git 服务，提供暂存区 diff 与最近提交主题。
 * @param root - 目标工作区路径（由服务层做工作区门禁）。
 * @returns 生成的提交信息，或带稳定错误码的失败。
 */
export async function generateCommitMessage(
  ctx: Context,
  service: GitService,
  root: string,
): Promise<GenerateCommitMessageResult> {
  const llm = ctx.get('llm') as LlmLike | undefined
  if (llm === undefined || typeof llm.stream !== 'function') {
    return { ok: false, error: { code: 'no-model', message: 'LLM service is unavailable' } }
  }
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.() as ModelSelectionLike | undefined
  const provider = typeof selection?.provider === 'string' ? selection.provider : ''
  const model = typeof selection?.model === 'string' ? selection.model : ''
  if (provider === '' || model === '') {
    return { ok: false, error: { code: 'no-model', message: 'no default model selection' } }
  }

  const staged = await service.stagedContext(root)
  if (!staged.ok) return { ok: false, error: staged.error }
  // 暂存区为空：不触发生成。由调用方把 empty-stage 呈现为明确提示。
  if (staged.diff.trim() === '') {
    return { ok: false, error: { code: 'empty-stage', message: 'nothing is staged' } }
  }

  const diff = staged.diff.length > DIFF_CAP_CHARS
    ? `${staged.diff.slice(0, DIFF_CAP_CHARS)}\n... (diff truncated)`
    : staged.diff
  const input = [
    staged.subjects.length > 0
      ? `Recent commit subjects in this repository (imitate their language, prefix and tone):\n${staged.subjects.map((subject) => `- ${subject}`).join('\n')}`
      : 'This repository has no earlier commits to imitate.',
    '',
    'Staged changes (git diff --cached):',
    diff,
  ].join('\n')

  let text = ''
  let failure: string | null = null
  try {
    const stream = llm.stream({
      provider,
      model,
      system: SYSTEM,
      messages: [{
        id: 'dsh-git-panel-commit-message',
        role: 'user',
        content: [{ type: 'text', text: input }],
        source: { kind: 'user' },
      }],
      temperature: 0.2,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    for await (const chunk of stream) {
      const part = chunk as {
        type?: unknown
        text?: unknown
        reason?: { kind?: unknown; failure?: { message?: unknown } }
      }
      if (part.type === 'text-delta' && typeof part.text === 'string') {
        text += part.text
        continue
      }
      // 适配器把失败规范化为终止 finish 分片；非 stop 即视为生成失败。
      if (part.type === 'finish' && part.reason?.kind !== undefined && part.reason.kind !== 'stop') {
        failure = typeof part.reason.failure?.message === 'string'
          ? part.reason.failure.message
          : String(part.reason.kind)
      }
    }
  } catch (error) {
    return {
      ok: false,
      error: { code: 'generate-failed', message: error instanceof Error ? error.message : String(error) },
    }
  }
  if (failure !== null) return { ok: false, error: { code: 'generate-failed', message: failure } }

  const message = cleanMessage(text)
  if (message === '') {
    return { ok: false, error: { code: 'generate-failed', message: 'the model returned an empty message' } }
  }
  return { ok: true, message }
}
