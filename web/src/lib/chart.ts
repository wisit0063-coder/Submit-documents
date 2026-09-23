/**
 * Chart tokens shared by every visualisation in the app.
 *
 * The categorical slots are used in fixed order and are never cycled, so a
 * series keeps its colour when a filter removes its neighbours. The three slots
 * below were validated for colour-vision separation against a white surface
 * (worst all-pairs CVD dE 9.2, normal-vision dE 24.0). Aqua sits below 3:1
 * contrast on white, so every chart that uses it also ships visible labels or a
 * companion table.
 */
export const SERIES = {
  blue: '#2a78d6',
  orange: '#eb6834',
  aqua: '#1baf7a',
} as const;

export const CHART_INK = {
  primary: '#0f172a',
  secondary: '#475569',
  muted: '#94a3b8',
  grid: '#e2e8f0',
  surface: '#ffffff',
} as const;

/** Recharts axis/grid styling: hairline, recessive, never dashed. */
export const axisProps = {
  tick: { fill: CHART_INK.secondary, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: CHART_INK.grid },
} as const;

export const gridProps = {
  stroke: CHART_INK.grid,
  strokeWidth: 1,
  vertical: false,
} as const;

export const tooltipStyle = {
  contentStyle: {
    borderRadius: 10,
    border: `1px solid ${CHART_INK.grid}`,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
    fontSize: 13,
    fontFamily: 'Sarabun, sans-serif',
  },
  labelStyle: { color: CHART_INK.primary, fontWeight: 600, marginBottom: 4 },
  cursor: { fill: 'rgba(148, 163, 184, 0.12)' },
} as const;

/** Compact axis ticks: money in thousands, so labels stay short. */
export function moneyTick(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} ล.`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

/** yyyy-mm from the API turned into a short Thai month label. */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const index = Number(month) - 1;
  const shortYear = String((Number(year) + 543) % 100).padStart(2, '0');
  return `${months[index] ?? month} ${shortYear}`;
}
