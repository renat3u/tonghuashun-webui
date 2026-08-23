/**
 * 弹层统一关闭行为：
 *  - Esc：App 全局键盘处理广播的 `ths:close-popovers` 事件；
 *  - 点击/触摸容器外部（capture 阶段监听，不受内部 stopPropagation 影响）。
 *
 * 使用方把弹层（含触发按钮）的容器 ref 传进来；open 为 false 时不挂监听。
 */
import { useEffect, useRef, type RefObject } from 'react'

export function useDismissable(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  // onClose 每次渲染都是新引用：走 ref 避免反复解绑/重绑监听。
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const close = () => closeRef.current()
    const onPointerDown = (event: PointerEvent) => {
      const el = ref.current
      if (el === null) return
      const target = event.target
      if (target instanceof Node && el.contains(target)) return
      closeRef.current()
    }
    window.addEventListener('ths:close-popovers', close)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('ths:close-popovers', close)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open, ref])
}
