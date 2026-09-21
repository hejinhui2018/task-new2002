/**
 * 孔板热力图色阶：浓度是顺序量（magnitude），采用已验证调色板中的
 * 单色系蓝色顺序阶（浅→深），以 log 浓度插值。
 * 深色模式单独选阶（暗→亮），不是简单反转。
 */

// light: 100 → 700（调色板 reference 顺序阶）
const LIGHT_RAMP = [
  '#cde2fb',
  '#b7d3f6',
  '#9ec5f4',
  '#86b6ef',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#1c5cab',
  '#184f95',
  '#104281',
  '#0d366b',
];

// dark: 取已验证调色板蓝色 ramp 550→100 反序（不暗于顺序阶深色安全端），
// 在深色表面上由暗蓝递进至亮蓝，明度严格单调。
const DARK_RAMP = [
  '#1c5cab',
  '#256abf',
  '#2a78d6',
  '#3987e5',
  '#5598e7',
  '#6da7ec',
  '#86b6ef',
  '#9ec5f4',
  '#b7d3f6',
  '#cde2fb',
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rampColor(ramp: string[], t: number): string {
  const x = Math.min(0.999999, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = hexToRgb(ramp[i]);
  const b = hexToRgb(ramp[i + 1]);
  const rgb = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function relativeLuminance(rgbCss: string): number {
  const m = rgbCss.match(/\d+/g);
  if (!m) return 1;
  const [r, g, b] = m.map(Number);
  // 近似感知亮度
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export type Theme = 'light' | 'dark';

/**
 * 浓度 → 单元格背景色。
 * - 干孔：透明（由 CSS 给中性底）
 * - 有液体但无分析物：最浅一阶（表示“有稀释液”）
 * - c>0：在 [cMax/256, cMax] 之间按 log 映射（覆盖 8 孔二倍稀释 128 倍跨度）
 */
export function concentrationColor(
  c: number,
  volume: number,
  cMax: number,
  theme: Theme,
): string | null {
  const ramp = theme === 'dark' ? DARK_RAMP : LIGHT_RAMP;
  if (volume <= 0) return null;
  if (c <= 0 || cMax <= 0) return rampColor(ramp, 0);
  const floor = cMax / 256;
  if (c <= floor) return rampColor(ramp, 0);
  const t = Math.log(c / floor) / Math.log(cMax / floor);
  return rampColor(ramp, t);
}

/** 依据背景亮度选择单元格文字色，保证对比度 */
export function cellTextColor(bg: string | null, theme: Theme): string {
  if (!bg) return theme === 'dark' ? '#c3c2b7' : '#52514e';
  return relativeLuminance(bg) < 0.55 ? '#ffffff' : '#0b1b30';
}
