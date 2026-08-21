/** 千分位格式化：1234567 -> "1,234,567" */
export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** 带符号百分比：+2.31% / -0.86% / 0.00% */
export function fmtPct(pct: number, digits = 2): string {
  const s = pct > 0 ? '+' : ''
  return `${s}${pct.toFixed(digits)}%`
}

/** 价格方向颜色类（中国股市习惯：红涨绿跌） */
export function dirClass(v: number): 'c-up' | 'c-down' | 'c-flat' {
  return v > 0 ? 'c-up' : v < 0 ? 'c-down' : 'c-flat'
}

/** 行数缩写：12345 -> "1.23万"；用于小数字不缩写 */
export function fmtLoc(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 100000000) return `${(n / 100000000).toFixed(2)}亿`
  if (abs >= 10000) return `${(n / 10000).toFixed(2)}万`
  return fmt(n)
}

/** Token 数量缩写：4.13e9 -> "41.30亿"，9.42e7 -> "9,420万"，412 -> "412" */
export function fmtToken(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e8) {
    const sign = n < 0 ? '-' : ''
    const v = (abs / 1e8).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return `${sign}${v}亿`
  }
  if (abs >= 1e4) return `${fmt(n / 1e4)}万`
  return fmt(n)
}

/** 时钟字符串 HH:MM:SS */
export function fmtClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 日期字符串 YYYY-MM-DD */
export function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 短日期 YYYY/MM/DD */
export function fmtDateSlash(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`
}

/** 分时时间 HH:MM */
export function fmtTime(t: number): string {
  const h = Math.floor(t)
  const m = Math.round((t - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
