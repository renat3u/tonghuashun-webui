/**
 * 本地结构类型：镜像 dsh 客户端运行时（@deepseek-ai/dsh-client-runtime +
 * @deepseek-ai/dsh-client-ui-slots）在 root 槽注册路径上的公开契约。
 *
 * 独立构建（out-of-tree）不解析 monorepo 包类型，因此这里用与真实签名
 * 逐一对应的结构声明；运行时由外壳提供的真实服务满足。改动前对照
 * packages/client/runtime 与 packages/client/ui-slots 的 SlotMap/register。
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

/** 客户端 fiber 上下文：插件通过声明注入获得 slots 服务。 */
export interface ClientContext {
  slots: SlotsLike
  /** cordis 效果：返回释放器；fiber 销毁时执行。 */
  effect(effect: () => () => void, label?: string): void
}
