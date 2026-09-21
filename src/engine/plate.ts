import { COLS, ROWS, type PlateState, type Well, type WellId } from './types';

export function wellId(row: string, col: number): WellId {
  return `${row}${col}`;
}

export const ALL_WELL_IDS: WellId[] = ROWS.flatMap((r) =>
  COLS.map((c) => wellId(r, c)),
);

export function isValidWellId(id: WellId): boolean {
  return ALL_WELL_IDS.includes(id);
}

/** 行号（0-7）与列号（0-11），供 UI 定位 */
export function wellPosition(id: WellId): { row: number; col: number } {
  const row = ROWS.indexOf(id[0] as (typeof ROWS)[number]);
  const col = Number(id.slice(1)) - 1;
  return { row, col };
}

/** 创建一块 96 孔空板 */
export function createEmptyPlate(): PlateState {
  const plate: PlateState = {};
  for (const id of ALL_WELL_IDS) {
    plate[id] = { id, volume: 0, amount: 0, mixed: true, samples: [] };
  }
  return plate;
}

export function clonePlate(plate: PlateState): PlateState {
  const next: PlateState = {};
  for (const id of ALL_WELL_IDS) {
    next[id] = { ...plate[id] };
  }
  return next;
}

export function concentration(well: Well): number {
  return well.volume > 0 ? well.amount / well.volume : 0;
}

/** 浮点账目误差容忍（pmol / µL 量级下 1e-9 足够） */
export const EPS = 1e-9;
