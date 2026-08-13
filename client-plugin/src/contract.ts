/**
 * 本地结构类型：镜像 dsh 客户端运行时（@deepseek-ai/dsh-client-runtime +
 * @deepseek-ai/dsh-client-ui-slots + @deepseek-ai/dsh-client-web）在 root 槽
 * 注册路径上的公开契约。
 *
 * 独立构建（out-of-tree）不解析 monorepo 包类型，因此这里用与真实签名
 * 逐一对应的结构声明；运行时由外壳提供的真实服务满足。改动前对照
 * packages/client/runtime、packages/client/ui-slots 与 packages/client/web 的
 * SlotMap / register / reflect。
 *
 * 0812 快照：外壳伪条目 dsh-client-app-shell 注入 slots+sessions+layout 后
 * 才渲染 root；ui-layout 被禁用时本插件需自己提供 layout 服务占位
 * （剩余条目无人消费该服务，只用于满足激活门）。
 */

import type { ReactElement } from 'react'

/** 槽运行时规格：'root' 是运行时声明的唯一先验槽（single/root）。 */
export interface RootSlotSpec {
  kind: 'single'
  scope: 'root'
}

/** root 注册参数：终端界面不声明子槽、不挂 store、不注入业务面。 */
export interface RegisterOptions {
  name: 'root'
  children: Record<string, never>
  inject: () => Record<string, never>
}

/** SlotsService 的注册面（ctx.slots）。 */
export interface SlotsLike {
  register(options: RegisterOptions, component: (props: Record<string, never>) => ReactElement): () => void
}

/** reflect 服务的提供面（ctx.reflect）。 */
export interface ReflectLike {
  provide(name: string, value: unknown): () => void
}

/** 客户端 fiber 上下文：插件通过声明注入获得 slots 服务。 */
export interface ClientContext {
  slots: SlotsLike
  reflect: ReflectLike
  /** cordis 效果：返回释放器；fiber 销毁时执行。 */
  effect(effect: () => () => void, label?: string): void
}
