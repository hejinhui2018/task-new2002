import { useState } from 'react';
import {
  ROWS,
  COLS,
  type Failure,
  type Step,
  type TipMode,
  type WellId,
} from '../engine';
import { makeStepId } from '../engine/defaults';

interface StepListProps {
  steps: Step[];
  /** 已执行到的步骤下标（steps[0..playhead-1] 已成功）；-1 表示初始帧 */
  playhead: number;
  failure: Failure | null;
  onChange(next: Step[]): void;
}

function WellSelect({
  value,
  onChange,
  label,
}: {
  value: WellId;
  onChange: (v: WellId) => void;
  label: string;
}) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as WellId)}>
        {ROWS.map((r) => (
          <optgroup key={r} label={`行 ${r}`}>
            {COLS.map((c) => {
              const id = `${r}${c}` as WellId;
              return (
                <option key={id} value={id}>
                  {id}
                </option>
              );
            })}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        step={step}
        min={min}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      />
    </label>
  );
}

function TipEditor({ tip, onChange }: { tip: TipMode; onChange: (t: TipMode) => void }) {
  return (
    <>
      <label className="field">
        吸头
        <select
          value={tip.kind}
          onChange={(e) =>
            onChange(
              e.target.value === 'new'
                ? { kind: 'new' }
                : { kind: 'reuse', group: tip.kind === 'reuse' ? tip.group : 'G1' },
            )
          }
        >
          <option value="new">新吸头</option>
          <option value="reuse">复用组</option>
        </select>
      </label>
      {tip.kind === 'reuse' && (
        <label className="field">
          复用组名
          <input
            type="text"
            value={tip.group}
            placeholder="例如 G1"
            onChange={(e) => onChange({ kind: 'reuse', group: e.target.value })}
          />
        </label>
      )}
    </>
  );
}

function StepEditor({ step, onChange }: { step: Step; onChange(s: Step): void }) {
  const patch = (p: Partial<Step>) => onChange({ ...step, ...p } as Step);
  return (
    <div className="step-editor">
      {step.type === 'transfer' && (
        <>
          <WellSelect label="来源孔" value={step.source} onChange={(v) => patch({ source: v })} />
          <WellSelect label="目标孔" value={step.dest} onChange={(v) => patch({ dest: v })} />
          <NumberField label="体积 (µL)" value={step.volume} onChange={(v) => patch({ volume: v })} />
          <TipEditor tip={step.tip} onChange={(t) => patch({ tip: t })} />
        </>
      )}
      {step.type === 'aspirate' && (
        <>
          <WellSelect label="来源孔" value={step.source} onChange={(v) => patch({ source: v })} />
          <NumberField label="弃液体积 (µL)" value={step.volume} onChange={(v) => patch({ volume: v })} />
          <TipEditor tip={step.tip} onChange={(t) => patch({ tip: t })} />
        </>
      )}
      {step.type === 'dispense' && (
        <>
          <WellSelect label="目标孔" value={step.dest} onChange={(v) => patch({ dest: v })} />
          <NumberField label="体积 (µL)" value={step.volume} onChange={(v) => patch({ volume: v })} />
          <NumberField
            label="浓度 (µM，0=稀释液)"
            value={step.concentration}
            onChange={(v) => patch({ concentration: v })}
          />
          <label className="field">
            样本标识
            <input
              type="text"
              value={step.sampleId}
              disabled={step.concentration === 0}
              placeholder={step.concentration === 0 ? '稀释液无需标识' : '例如 S1'}
              onChange={(e) => patch({ sampleId: e.target.value })}
            />
          </label>
          <TipEditor tip={step.tip} onChange={(t) => patch({ tip: t })} />
        </>
      )}
      {step.type === 'mix' && (
        <>
          <WellSelect label="混匀孔" value={step.well} onChange={(v) => patch({ well: v })} />
          <TipEditor tip={step.tip} onChange={(t) => patch({ tip: t })} />
        </>
      )}
    </div>
  );
}

const BADGE: Record<Step['type'], { text: string; cls: string }> = {
  transfer: { text: '转移', cls: 'badge-transfer' },
  aspirate: { text: '弃液', cls: 'badge-aspirate' },
  dispense: { text: '加液', cls: 'badge-dispense' },
  mix: { text: '混匀', cls: 'badge-mix' },
};

function summarize(s: Step): string {
  switch (s.type) {
    case 'transfer':
      return `${s.source} → ${s.dest}，${s.volume} µL`;
    case 'aspirate':
      return `从 ${s.source} 弃去 ${s.volume} µL`;
    case 'dispense':
      return `向 ${s.dest} 加入 ${s.volume} µL${
        s.concentration > 0 ? `，${s.concentration} µM（${s.sampleId || '未命名'}）` : ' 稀释液'
      }`;
    case 'mix':
      return `混匀 ${s.well}`;
  }
}

function newStep(type: Step['type']): Step {
  const base = { id: makeStepId(), tip: { kind: 'new' as const } };
  switch (type) {
    case 'transfer':
      return { ...base, type, source: 'A1', dest: 'A2', volume: 100 };
    case 'aspirate':
      return { ...base, type, source: 'A1', volume: 100 };
    case 'dispense':
      return { ...base, type, dest: 'A1', volume: 100, concentration: 0, sampleId: '' };
    case 'mix':
      return { ...base, type, well: 'A1' };
  }
}

export function StepList({ steps, playhead, failure, onChange }: StepListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const update = (id: string, next: Step) =>
    onChange(steps.map((s) => (s.id === id ? next : s)));
  const remove = (id: string) => onChange(steps.filter((s) => s.id !== id));
  const add = (type: Step['type']) => {
    const s = newStep(type);
    onChange([...steps, s]);
    setEditingId(s.id);
  };
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div>
      <div className="step-list">
        {steps.length === 0 && <div className="empty-note">还没有步骤，从下方添加。</div>}
        {steps.map((s, i) => {
          const isPast = i < playhead;
          const isCurrent = i === playhead;
          const isFailed = failure?.stepIndex === i;
          const badge = BADGE[s.type];
          return (
            <div
              key={s.id}
              className={[
                'step-row',
                isPast ? 'past' : '',
                isCurrent ? 'current' : '',
                isFailed ? 'failed-step' : '',
                dragIndex === i ? 'dragging' : '',
                overIndex === i && dragIndex !== i ? 'drag-over' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              draggable
              onDragStart={(e) => {
                setDragIndex(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== i) setOverIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
                setOverIndex(null);
              }}
            >
              <div className="step-main">
                <span className="drag-handle" title="拖动排序" aria-hidden>
                  ⠿
                </span>
                <span className="step-index">{i + 1}.</span>
                <span className={`step-badge ${badge.cls}`}>{badge.text}</span>
                <span className="step-summary" title={summarize(s)}>
                  {summarize(s)}
                </span>
                {s.tip.kind === 'new' ? (
                  <span className="tip-chip">新吸头</span>
                ) : (
                  <span className="tip-chip reuse" title="复用吸头组">
                    ♻ {s.tip.group || '未命名组'}
                  </span>
                )}
                <span className="step-actions">
                  <button
                    className="btn ghost icon"
                    title={editingId === s.id ? '收起编辑' : '编辑'}
                    onClick={() => setEditingId(editingId === s.id ? null : s.id)}
                  >
                    {editingId === s.id ? '✕' : '✎'}
                  </button>
                  <button
                    className="btn ghost icon danger"
                    title="删除步骤"
                    onClick={() => remove(s.id)}
                  >
                    🗑
                  </button>
                </span>
              </div>
              {editingId === s.id && (
                <StepEditor step={s} onChange={(next) => update(s.id, next)} />
              )}
          {
            /* 状态通过行底色与徽标表达，无需额外节点 */
          }
        </div>
          );
        })}
      </div>

      <div className="add-bar">
        <button className="btn" onClick={() => add('dispense')}>
          ＋ 加液
        </button>
        <button className="btn" onClick={() => add('transfer')}>
          ＋ 转移
        </button>
        <button className="btn" onClick={() => add('mix')}>
          ＋ 混匀
        </button>
        <button className="btn" onClick={() => add('aspirate')}>
          ＋ 弃液
        </button>
      </div>
    </div>
  );
}
