/** 确定性伪随机数（mulberry32） */
export type Rand = () => number

export function mulberry32(seed: number): Rand {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 由字符串生成 32 位种子 */
export function seedFromString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h | 0
}

/** 生成 [min, max) 均匀分布 */
export function range(rand: Rand, min: number, max: number): number {
  return min + rand() * (max - min)
}

/** 生成近似正态分布的抖动（两次均匀取平均） */
export function jitter(rand: Rand, scale: number): number {
  return ((rand() + rand()) / 2 - 0.5) * 2 * scale
}
