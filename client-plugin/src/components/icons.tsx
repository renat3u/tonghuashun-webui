/** 内联 SVG 图标集（取自设计稿，stroke 风格统一） */
import type { SVGProps } from 'react'

export type IconName =
  | 'search'
  | 'monitor'
  | 'clock'
  | 'user'
  | 'collapse'
  | 'project'
  | 'chart'
  | 'session'
  | 'skill'
  | 'database'
  | 'plugin'
  | 'assistant'
  | 'dots'
  | 'gear'
  | 'plus'
  | 'chevronDown'
  | 'chevronRight'
  | 'zap'
  | 'send'
  | 'star'
  | 'x'
  | 'branch'
  | 'graph'
  | 'expand'
  | 'check'
  | 'restore'

const PATHS: Record<IconName, string[]> = {
  search: ['M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0', 'M20 20l-3.5-3.5'],
  monitor: ['M3 4h18v14H3z', 'M8 21h8'],
  clock: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M12 7v5l3 3'],
  user: ['M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', 'M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5'],
  collapse: ['M11 17l-5-5 5-5', 'M18 17l-5-5 5-5'],
  project: ['M3 7l9-4 9 4-9 4-9-4z', 'M3 12l9 4 9-4'],
  chart: ['M3 3v18h18', 'M7 14l4-4 3 3 5-6'],
  session: ['M8 3L3 8l5 5', 'M3 8h13', 'M16 21l5-5-5-5', 'M21 16H8'],
  skill: ['M4 19.5A2.5 2.5 0 016.5 17H20V4H6.5A2.5 2.5 0 004 6.5v13z', 'M4 19.5A2.5 2.5 0 006.5 22H20v-5'],
  database: ['M12 5c-4.4 0-8 1.3-8 3s3.6 3 8 3 8-1.3 8-3-3.6-3-8-3', 'M4 8v6c0 1.7 3.6 3 8 3s8-1.3 8-3V8', 'M4 14v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
  plugin: ['M6 6m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0', 'M18 18m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0', 'M6 8.5v7a4 4 0 004 4h3'],
  assistant: ['M4 4h16v16H4z', 'M9 12h6', 'M9 8.5h6', 'M9 15.5h3'],
  dots: ['M5 12m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0', 'M12 12m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0', 'M19 12m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0'],
  gear: [
    'M12 9m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
    'M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronRight: ['M9 6l6 6-6 6'],
  zap: ['M13 2L3 14h7l-1 8 10-12h-7l1-8z'],
  send: ['M5 3l16 9-16 9v-7l9-2-9-2V3z'],
  star: ['M12 2l2.9 6.3 6.6.7-5 4.6 1.4 6.5L12 16.9 6.1 20l1.4-6.5-5-4.6 6.6-.7L12 2z'],
  x: ['M18 6L6 18', 'M6 6l12 12'],
  branch: ['M6 6m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0', 'M6 18m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0', 'M18 10m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0', 'M6 8.4v7.2', 'M6 15a8 8 0 008-5h1.6'],
  graph: ['M4 19.5A2.5 2.5 0 016.5 17H20V2H6.5A2.5 2.5 0 004 4.5v15z'],
  expand: ['M8 3H3v5', 'M16 3h5v5', 'M8 21H3v-5', 'M16 21h5v-5'],
  check: ['M4 12l5 5L20 6'],
  restore: ['M3 12a9 9 0 109-9', 'M3 3v6h6'],
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
  filled?: boolean
}

export function Icon({ name, size = 13, filled = false, ...rest }: IconProps) {
  const paths = PATHS[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
