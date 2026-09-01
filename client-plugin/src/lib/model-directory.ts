/**
 * 模型目录的纯解析：把 connection.api.sessions.models 返回的目录变成
 * 可选择 id 列表，并把用户输入（model id / 显示名 / provider+id）解析为
 * `session.selectModel` 需要的 provider/model/reasoningEffort。
 */
import type { ModelDirectoryLike, ModelGroupLike } from '../contract'

/** 一次模型选择请求（dsh ModelSelection 的结构子集）。 */
export interface ModelSelectionLike {
  provider: string
  model: string
  reasoningEffort?: string
}

/**
 * 在目录中查找用户输入对应的模型。
 * 接受 model id、显示名，或 `provider-id/model-id`（与默认 model selector 的
 * row id 形态一致）。
 * @param directory - 已加载的模型目录。
 * @param query - 用户点击的选项值或手输内容。
 * @returns 找到的选择请求；未命中返回 null。
 */
export function findModelSelection(directory: ModelDirectoryLike, query: string): ModelSelectionLike | null {
  const value = query.trim()
  if (value.length === 0) return null
  for (const group of directory.groups) {
    const hit = group.models.find((option) =>
      option.id === value
      || option.name === value
      || `${group.id}/${option.id}` === value,
    )
    if (hit === undefined) continue
    return {
      provider: group.id,
      model: hit.id,
      ...hit.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: hit.reasoning.defaultEffort },
    }
  }
  return null
}

/**
 * 目录中的可选模型 id（去重）。目录可用时只列目录内的模型，meter 快照里
 * 见过但目录不存在的模型 id 不可点选；目录不可用时才退回历史模型 id。
 */
export function modelOptionIds(
  directory: ModelDirectoryLike | null,
  fallback: readonly string[] = [],
): string[] {
  if (directory !== null) {
    const rows: string[] = []
    const seen = new Set<string>()
    for (const group of directory.groups) {
      appendGroup(rows, seen, group)
    }
    return rows
  }
  const rows: string[] = []
  const seen = new Set<string>()
  for (const name of fallback) {
    if (seen.has(name)) continue
    seen.add(name)
    rows.push(name)
  }
  return rows
}

function appendGroup(rows: string[], seen: Set<string>, group: ModelGroupLike): void {
  for (const option of group.models) {
    if (seen.has(option.id)) continue
    seen.add(option.id)
    rows.push(option.id)
  }
}
