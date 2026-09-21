import { useEffect, useMemo, useRef, useState } from 'react';
import {
  concentration,
  createDefaultSteps,
  createInitialPlate,
  simulate,
  STOCK_CONCENTRATION_UM,
  WELL_CAPACITY_UL,
  type FailureKind,
  type Step,
  type WellId,
} from './engine';
import { loadSteps, saveSteps } from './state/storage';
import { WellPlate } from './components/WellPlate';
import { StepList } from './components/StepList';
import type { Theme } from './components/colorScale';

const FAILURE_LABEL: Record<FailureKind, string> = {
  invalid: '参数非法',
  empty: '吸空',
  overflow: '溢出',
  unmixed: '未混匀转移',
  contamination: '吸头跨样本带入',
};

const FAILURE_ICON: Record<FailureKind, string> = {
  invalid: '⚠',
  empty: '🪫',
  overflow: '🛢',
  unmixed: '🌀',
  contamination: '♻⚠',
};

function stepWells(step: Step): WellId[] {
  switch (step.type) {
    case 'transfer':
      return [step.source, step.dest];
    case 'aspirate':
      return [step.source];
    case 'dispense':
      return [step.dest];
    case 'mix':
      return [step.well];
  }
}

function stepVerb(step: Step): string {
  switch (step.type) {
    case 'transfer':
      return `转移 ${step.source} → ${step.dest}`;
    case 'aspirate':
      return `从 ${step.source} 弃液`;
    case 'dispense':
      return `向 ${step.dest} 加液`;
    case 'mix':
      return `混匀 ${step.well}`;
  }
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('pipette-planner:theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('pipette-planner:theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export default function App() {
  const [steps, setSteps] = useState<Step[]>(() => loadSteps());
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const timer = useRef<number | null>(null);

  // 步骤任何增删 / 拖动 / 编辑都从初始板重新整盘仿真，绝不沿用旧结果
  const sim = useMemo(() => simulate(steps, createInitialPlate()), [steps]);

  useEffect(() => {
    saveSteps(steps);
  }, [steps]);

  const lastFrameIndex = sim.frames.length - 1;

  // 步骤缩短后把播放头收回到有效范围
  useEffect(() => {
    setPlayhead((p) => Math.min(p, lastFrameIndex));
  }, [lastFrameIndex]);

  useEffect(() => {
    if (!playing) return;
    if (playhead >= lastFrameIndex) {
      setPlaying(false);
      return;
    }
    timer.current = window.setTimeout(() => setPlayhead((p) => p + 1), 850);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [playing, playhead, lastFrameIndex]);

  const failedIndex = sim.failure?.stepIndex ?? -1;
  const atFailure = sim.failure !== null && playhead === failedIndex;
  const allDone = !sim.failure && playhead === lastFrameIndex && lastFrameIndex > 0;

  const currentStep = playhead < steps.length ? steps[playhead] : null;
  const activeWells =
    currentStep && !atFailure && playhead < lastFrameIndex
      ? stepWells(currentStep)
      : [];
  const failedWells = atFailure ? sim.failure!.wells : [];

  // 色阶以全部帧中的最高浓度为满刻度，播放过程中保持刻度稳定
  const cMax = useMemo(() => {
    let max = STOCK_CONCENTRATION_UM;
    for (const f of sim.frames) {
      for (const id of Object.keys(f)) {
        const c = concentration(f[id]);
        if (c > max) max = c;
      }
    }
    return max;
  }, [sim]);

  // 当前帧的活守恒账
  const frame = sim.frames[playhead];
  const live = useMemo(() => {
    let onV = 0;
    let onA = 0;
    for (const id of Object.keys(frame)) {
      onV += frame[id].volume;
      onA += frame[id].amount;
    }
    let addV = 0;
    let addA = 0;
    for (const s of steps.slice(0, playhead)) {
      if (s.type === 'dispense') {
        addV += s.volume;
        addA += s.concentration * s.volume;
      }
    }
    const waste = sim.wasteFrames[playhead] ?? { volume: 0, amount: 0 };
    const balanced =
      Math.abs(onV + waste.volume - addV) < 1e-6 &&
      Math.abs(onA + waste.amount - addA) < 1e-6;
    return { onV, onA, addV, addA, waste, balanced };
  }, [frame, steps, playhead, sim.wasteFrames]);

  const resetProtocol = () => {
    if (!window.confirm('恢复为内置 A1→A8 二倍稀释方案？当前编辑将被替换。')) return;
    setSteps(createDefaultSteps());
    setPlayhead(0);
    setPlaying(false);
  };
  const clearAll = () => {
    if (!window.confirm('清空全部步骤？')) return;
    setSteps([]);
    setPlayhead(0);
    setPlaying(false);
  };

  const frameTitle =
    playhead === 0
      ? '初始状态'
      : atFailure
        ? `第 ${playhead} 步失败：${sim.failure ? FAILURE_LABEL[sim.failure.kind] : ''}`
        : `第 ${playhead} 步执行后：${stepVerb(steps[playhead - 1])}`;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>移液方案预演工具</h1>
          <div className="subtitle">96 孔板 · 每孔上限 {WELL_CAPACITY_UL} µL · 上机前核对体积、浓度与污染风险</div>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={toggleTheme} title="切换明暗主题">
            {theme === 'dark' ? '☀ 浅色' : '🌙 深色'}
          </button>
          <button className="btn" onClick={resetProtocol}>
            恢复默认方案
          </button>
          <button className="btn danger" onClick={clearAll}>
            清空
          </button>
        </div>
      </header>

      <div className="layout">
        <div>
          <div className="card">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                marginBottom: 12,
                flexWrap: 'wrap',
              }}
            >
              <h2 style={{ margin: 0 }}>{frameTitle}</h2>
              <div className="controls">
                <button
                  className="btn"
                  onClick={() => {
                    setPlaying(false);
                    setPlayhead(0);
                  }}
                  disabled={playhead === 0}
                  title="回到初始状态"
                >
                  ⏮
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setPlaying(false);
                    setPlayhead((p) => Math.max(0, p - 1));
                  }}
                  disabled={playhead === 0}
                >
                  ◀ 单步
                </button>
                <button
                  className="btn primary"
                  onClick={() => {
                    if (playhead >= lastFrameIndex) setPlayhead(0);
                    setPlaying((p) => !p);
                  }}
                  disabled={lastFrameIndex === 0}
                >
                  {playing ? '⏸ 暂停' : '▶ 连续播放'}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setPlaying(false);
                    setPlayhead((p) => Math.min(lastFrameIndex, p + 1));
                  }}
                  disabled={playhead >= lastFrameIndex}
                >
                  单步 ▶
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setPlaying(false);
                    setPlayhead(lastFrameIndex);
                  }}
                  disabled={playhead >= lastFrameIndex}
                >
                  ⏭ 到末尾
                </button>
                <span className="playhead">
                  {playhead} / {steps.length} 步
                </span>
              </div>
            </div>

            <WellPlate
              plate={frame}
              activeWells={activeWells}
              failedWells={failedWells}
              cMax={cMax}
              theme={theme}
            />

            <div className="legend">
              <div className="ramp">
                <span>浓度</span>
                <span>0</span>
                <span
                  className="ramp-bar"
                  style={{
                    background:
                      theme === 'dark'
                        ? 'linear-gradient(90deg,#1c5cab,#cde2fb)'
                        : 'linear-gradient(90deg,#cde2fb,#0d366b)',
                  }}
                />
                <span>{cMax} µM</span>
              </div>
              <span>
                <i className="swatch" style={{ background: 'var(--surface-2)' }} />
                空孔
              </span>
              <span>
                <i className="swatch active" style={{ background: 'var(--surface-2)' }} />
                当前步骤
              </span>
              <span>
                <i className="swatch unmixed" style={{ background: 'var(--surface-2)' }} />
                未混匀
              </span>
              <span>
                <i className="swatch failed" style={{ background: 'var(--surface-2)' }} />
                失败孔
              </span>
            </div>

            <div className="status-line">
              单元格上行数字为体积 (µL)，下行为浓度；悬停可看分析物总量与样本谱系。
            </div>
          </div>

          {sim.failure && (
            <div className="card">
              <div className="failure">
                <div className="f-head">
                  <span aria-hidden>{FAILURE_ICON[sim.failure.kind]}</span>
                  <span>
                    停在第 {sim.failure.stepIndex + 1} 步 · {FAILURE_LABEL[sim.failure.kind]}
                  </span>
                </div>
                <div className="f-msg">{sim.failure.message}</div>
                <div className="f-meta">
                  受影响孔：{sim.failure.wells.length ? sim.failure.wells.join('、') : '—'}
                  。仿真已在首次失败处中止，之前 {sim.failure.stepIndex} 个步骤的状态仍可用单步 / 进度条回看。
                </div>
              </div>
            </div>
          )}
          {allDone && (
            <div className="card">
              <div className="success-banner">✓ 全部 {steps.length} 步执行成功，无吸空、溢出、未混匀或污染风险。</div>
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <h2>步骤序列（可拖动排序、点 ✎ 编辑）</h2>
            <StepList
              steps={steps}
              playhead={playhead}
              failure={sim.failure}
              onChange={(next) => {
                setSteps(next);
                setPlaying(false);
              }}
            />
          </div>

          <div className="card">
            <h2>质量守恒账（当前帧）</h2>
            <div className="ledger">
              <span className="l-row">
                <span>储液加入体积</span>
                <b>{live.addV.toFixed(1)} µL</b>
              </span>
              <span className="l-row">
                <span>废液体积</span>
                <b>{live.waste.volume.toFixed(1)} µL</b>
              </span>
              <span className="l-row">
                <span>板上体积</span>
                <b>{live.onV.toFixed(1)} µL</b>
              </span>
              <span className="l-row">
                <span>板上分析物</span>
                <b>{live.onA.toFixed(1)} pmol</b>
              </span>
              <span className="l-row">
                <span>废液分析物</span>
                <b>{live.waste.amount.toFixed(1)} pmol</b>
              </span>
              <span className="l-row">
                <span>加入分析物</span>
                <b>{live.addA.toFixed(1)} pmol</b>
              </span>
            </div>
            <div className="status-line">
              {live.balanced ? (
                <span className="ok">✓ 守恒校验通过：板上 + 废液 = 储液加入</span>
              ) : (
                <span style={{ color: 'var(--critical)' }}>✗ 账目不平</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
