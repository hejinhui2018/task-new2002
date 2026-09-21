import { useState } from 'react';
import { COLS, ROWS, concentration, type PlateState, type Well, type WellId } from '../engine';
import { cellTextColor, concentrationColor, type Theme } from './colorScale';

interface WellPlateProps {
  plate: PlateState;
  /** 当前步骤接触的孔（蓝色高亮） */
  activeWells: WellId[];
  /** 失败步骤涉及的孔（红色高亮） */
  failedWells: WellId[];
  cMax: number;
  theme: Theme;
}

function fmtVol(v: number): string {
  if (Math.abs(v - Math.round(v)) < 0.01) return String(Math.round(v));
  return v.toFixed(1);
}

function fmtConc(c: number): string {
  if (c <= 0) return '稀释液';
  let s: string;
  if (c >= 100) s = c.toFixed(1);
  else if (c >= 10) s = c.toFixed(2);
  else if (c >= 1) s = c.toFixed(3);
  else s = c.toFixed(4);
  s = s.replace(/\.?0+$/, '');
  return `${s} µM`;
}

interface Tip {
  id: WellId;
  x: number;
  y: number;
}

export function WellPlate({ plate, activeWells, failedWells, cMax, theme }: WellPlateProps) {
  const [tip, setTip] = useState<Tip | null>(null);
  const active = new Set(activeWells);
  const failed = new Set(failedWells);

  return (
    <div className="plate-scroll">
      <div className="plate" role="grid" aria-label="96 孔板">
        <div />
        {COLS.map((c) => (
          <div key={c} className="axis">
            {c}
          </div>
        ))}

        {ROWS.map((row) => (
          <RowFragment key={row} row={row}>
            {COLS.map((col) => {
              const id = `${row}${col}` as WellId;
              const w = plate[id];
              const bg = concentrationColor(concentration(w), w.volume, cMax, theme);
              const ink = cellTextColor(bg, theme);
              const isFailed = failed.has(id);
              const isActive = !isFailed && active.has(id);
              return (
                <div
                  key={id}
                  className={[
                    'well',
                    isActive ? 'is-active' : '',
                    isFailed ? 'is-failed' : '',
                    w.volume > 0 && !w.mixed ? 'not-mixed' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={bg ? { background: bg, color: ink, borderColor: 'transparent' } : undefined}
                  role="gridcell"
                  aria-label={wellAria(w)}
                  onMouseEnter={(e) => setTip({ id, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setTip({ id, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTip((t) => (t?.id === id ? null : t))}
                >
                  <span className="w-id">{id}</span>
                  <span className="w-vol">{w.volume > 0 ? `${fmtVol(w.volume)}` : '·'}</span>
                  <span className="w-conc">
                    {w.volume > 0 ? fmtConc(concentration(w)) : ''}
                  </span>
                </div>
              );
            })}
          </RowFragment>
        ))}
      </div>

      {tip && <WellTooltip well={plate[tip.id]} x={tip.x} y={tip.y} />}
    </div>
  );
}

/** 每行前加行名轴，用 Fragment 平铺到同一个 grid 里 */
function RowFragment({ row, children }: { row: string; children: React.ReactNode }) {
  return (
    <>
      <div className="axis">{row}</div>
      {children}
    </>
  );
}

function wellAria(w: Well): string {
  return `${w.id}：体积 ${w.volume.toFixed(1)} µL，浓度 ${concentration(w).toFixed(4)} µM${
    w.mixed ? '' : '，未混匀'
  }`;
}

function WellTooltip({ well, x, y }: { well: Well; x: number; y: number }) {
  return (
    <div className="well-tip" style={{ left: x + 14, top: y + 14 }}>
      <div className="t-title">孔 {well.id}</div>
      <div className="t-row">
        <span>体积</span>
        <b>{well.volume.toFixed(2)} µL</b>
      </div>
      <div className="t-row">
        <span>浓度</span>
        <b>{concentration(well).toFixed(4)} µM</b>
      </div>
      <div className="t-row">
        <span>分析物</span>
        <b>{well.amount.toFixed(2)} pmol</b>
      </div>
      <div className="t-row">
        <span>混匀状态</span>
        <b>{well.volume === 0 || well.mixed ? '已混匀' : '未混匀'}</b>
      </div>
      <div className="t-row">
        <span>样本谱系</span>
        <b>{well.samples.length ? well.samples.join('、') : '—'}</b>
      </div>
    </div>
  );
}
