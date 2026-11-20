import { createContext, useContext, type ReactElement, type ReactNode } from 'react'
import type { PresetKind } from './presetKinds'

type IconProps = { color: string }

const StrokeWidthContext = createContext(2.25)

function Svg({ children, color }: { children: ReactNode; color: string }) {
  const strokeWidth = useContext(StrokeWidthContext)
  return (
    <svg
      viewBox="0 0 64 64"
      width="100%"
      height="100%"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

const icons: Record<PresetKind, (p: IconProps) => ReactElement> = {
  rect: ({ color }) => (
    <Svg color={color}>
      <rect x="10" y="14" width="44" height="36" />
    </Svg>
  ),
  'rounded-rect': ({ color }) => (
    <Svg color={color}>
      <rect x="10" y="14" width="44" height="36" rx="8" />
    </Svg>
  ),
  ellipse: ({ color }) => (
    <Svg color={color}>
      <ellipse cx="32" cy="32" rx="22" ry="16" />
    </Svg>
  ),
  diamond: ({ color }) => (
    <Svg color={color}>
      <path d="M32 8 L56 32 L32 56 L8 32 Z" />
    </Svg>
  ),
  cloud: ({ color }) => (
    <Svg color={color}>
      <path d="M20 42h28a10 10 0 0 0 0-20 12 12 0 0 0-23-3A9 9 0 0 0 20 42z" />
    </Svg>
  ),
  hexagon: ({ color }) => (
    <Svg color={color}>
      <path d="M20 12 L44 12 L56 32 L44 52 L20 52 L8 32 Z" />
    </Svg>
  ),
  note: ({ color }) => (
    <Svg color={color}>
      <path d="M16 10h26l10 10v34H16z" />
      <path d="M42 10v10h10" />
      <path d="M24 30h16M24 38h16M24 46h10" />
    </Svg>
  ),
  database: ({ color }) => (
    <Svg color={color}>
      <ellipse cx="32" cy="16" rx="18" ry="7" />
      <path d="M14 16v28c0 4 8 7 18 7s18-3 18-7V16" />
      <path d="M14 30c0 4 8 7 18 7s18-3 18-7" />
    </Svg>
  ),
  server: ({ color }) => (
    <Svg color={color}>
      <rect x="14" y="10" width="36" height="14" rx="2" />
      <rect x="14" y="28" width="36" height="14" rx="2" />
      <rect x="14" y="46" width="36" height="10" rx="2" />
      <circle cx="20" cy="17" r="1.5" fill={color} stroke="none" />
      <circle cx="20" cy="35" r="1.5" fill={color} stroke="none" />
    </Svg>
  ),
  queue: ({ color }) => (
    <Svg color={color}>
      <rect x="10" y="18" width="12" height="28" rx="2" />
      <rect x="26" y="18" width="12" height="28" rx="2" />
      <rect x="42" y="18" width="12" height="28" rx="2" />
    </Svg>
  ),
  cache: ({ color }) => (
    <Svg color={color}>
      <rect x="12" y="14" width="40" height="36" rx="4" />
      <path d="M20 14v36M32 14v36M44 14v36" />
      <path d="M12 26h40M12 38h40" />
    </Svg>
  ),
  'api-gateway': ({ color }) => (
    <Svg color={color}>
      <path d="M8 32h14" />
      <rect x="22" y="18" width="20" height="28" rx="3" />
      <path d="M42 32h14" />
      <path d="M28 26h8M28 32h8M28 38h8" />
    </Svg>
  ),
  'load-balancer': ({ color }) => (
    <Svg color={color}>
      <circle cx="32" cy="16" r="8" />
      <path d="M32 24v8M18 48l14-16 14 16" />
      <circle cx="14" cy="52" r="6" />
      <circle cx="32" cy="52" r="6" />
      <circle cx="50" cy="52" r="6" />
    </Svg>
  ),
  person: ({ color }) => (
    <Svg color={color}>
      <circle cx="32" cy="18" r="8" />
      <path d="M16 52c2-12 10-18 16-18s14 6 16 18" />
    </Svg>
  ),
  browser: ({ color }) => (
    <Svg color={color}>
      <rect x="8" y="12" width="48" height="40" rx="3" />
      <path d="M8 22h48" />
      <circle cx="14" cy="17" r="1.5" fill={color} stroke="none" />
      <circle cx="20" cy="17" r="1.5" fill={color} stroke="none" />
      <circle cx="26" cy="17" r="1.5" fill={color} stroke="none" />
    </Svg>
  ),
  mobile: ({ color }) => (
    <Svg color={color}>
      <rect x="20" y="6" width="24" height="52" rx="4" />
      <path d="M28 12h8" />
      <circle cx="32" cy="50" r="2" fill={color} stroke="none" />
    </Svg>
  ),
  firewall: ({ color }) => (
    <Svg color={color}>
      <path d="M12 18h40v28H12z" />
      <path d="M12 28h40M12 38h40M24 18v28M40 18v28" />
    </Svg>
  ),
  ec2: ({ color }) => (
    <Svg color={color}>
      <rect x="14" y="14" width="36" height="36" rx="2" />
      <path d="M22 26h20M22 32h20M22 38h12" />
    </Svg>
  ),
  s3: ({ color }) => (
    <Svg color={color}>
      <path d="M16 20h32l-4 28H20z" />
      <path d="M16 20l16-8 16 8" />
      <path d="M32 12v36" />
    </Svg>
  ),
  lambda: ({ color }) => (
    <Svg color={color}>
      <path d="M18 50 L30 14h8L50 50" />
      <path d="M26 36h16" />
    </Svg>
  ),
  rds: ({ color }) => (
    <Svg color={color}>
      <ellipse cx="32" cy="18" rx="16" ry="6" />
      <path d="M16 18v10c0 3.5 7 6 16 6s16-2.5 16-6V18" />
      <path d="M16 28v10c0 3.5 7 6 16 6s16-2.5 16-6V28" />
      <path d="M16 38v8c0 3.5 7 6 16 6s16-2.5 16-6v-8" />
    </Svg>
  ),
  dynamodb: ({ color }) => (
    <Svg color={color}>
      <path d="M12 16h40v32H12z" />
      <path d="M12 28h40M24 16v32" />
      <circle cx="18" cy="22" r="2" fill={color} stroke="none" />
    </Svg>
  ),
  sqs: ({ color }) => (
    <Svg color={color}>
      <path d="M10 22h28v20H10z" />
      <path d="M38 28l14-6v24l-14-6" />
      <path d="M16 30h16M16 36h10" />
    </Svg>
  ),
  sns: ({ color }) => (
    <Svg color={color}>
      <circle cx="18" cy="32" r="8" />
      <path d="M26 32h8" />
      <circle cx="42" cy="18" r="6" />
      <circle cx="42" cy="32" r="6" />
      <circle cx="42" cy="46" r="6" />
      <path d="M34 32l8-14M34 32h8M34 32l8 14" />
    </Svg>
  ),
  cloudfront: ({ color }) => (
    <Svg color={color}>
      <circle cx="32" cy="32" r="10" />
      <path d="M32 8v10M32 46v10M8 32h10M46 32h10" />
      <path d="M14 14l8 8M42 42l8 8M50 14l-8 8M22 42l-8 8" />
    </Svg>
  ),
  'aws-api-gateway': ({ color }) => (
    <Svg color={color}>
      <path d="M8 20h16v24H8z" />
      <path d="M40 20h16v24H40z" />
      <path d="M24 32h16" />
      <path d="M28 26l8 6-8 6" />
    </Svg>
  ),
  vpc: ({ color }) => (
    <Svg color={color}>
      <rect x="8" y="12" width="48" height="40" rx="4" strokeDasharray="4 3" />
      <rect x="16" y="22" width="14" height="20" rx="2" />
      <rect x="34" y="22" width="14" height="20" rx="2" />
    </Svg>
  ),
  'start-end': ({ color }) => (
    <Svg color={color}>
      <rect x="8" y="22" width="48" height="20" rx="10" />
    </Svg>
  ),
  process: ({ color }) => (
    <Svg color={color}>
      <rect x="10" y="18" width="44" height="28" />
    </Svg>
  ),
  decision: ({ color }) => (
    <Svg color={color}>
      <path d="M32 8 L56 32 L32 56 L8 32 Z" />
    </Svg>
  ),
  'input-output': ({ color }) => (
    <Svg color={color}>
      <path d="M14 18 L54 18 L46 46 L6 46 Z" />
    </Svg>
  ),
  document: ({ color }) => (
    <Svg color={color}>
      <path d="M16 10h24l12 12v32H16z" />
      <path d="M40 10v12h12" />
      <path d="M16 54c6-4 12-4 18 0s12 4 18 0" />
    </Svg>
  ),
}

export function PresetIcon({
  kind,
  color,
  strokeWidth = 2.25,
}: {
  kind: string
  color: string
  strokeWidth?: number
}) {
  const render = (icons as Record<string, (p: IconProps) => ReactElement>)[kind] ?? icons.rect
  return (
    <StrokeWidthContext.Provider value={strokeWidth}>{render({ color })}</StrokeWidthContext.Provider>
  )
}
