// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createDefaultSteps, simulate, type Step } from '../src/engine';
import { makeStepId } from '../src/engine/defaults';
import { loadSteps, saveSteps } from '../src/state/storage';

const STORAGE_KEY = 'pipette-planner:v1';
const store = new Map<string, string>();

// storage 模块直接读写全局 localStorage，node 环境下补桩
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
    configurable: true,
  });
});

/** 现场事故场景：整孔转移后复用吸头进入另一份样本孔 */
function contaminationScenario(): Step[] {
  const g = { kind: 'reuse' as const, group: 'G' };
  let seq = 0;
  const id = () => `stored-${++seq}`;
  return [
    { id: id(), type: 'dispense', dest: 'A1', volume: 200, concentration: 100, sampleId: 'S1', tip: { kind: 'new' } },
    { id: id(), type: 'mix', well: 'A1', tip: { kind: 'new' } },
    { id: id(), type: 'transfer', source: 'A1', dest: 'B1', volume: 200, tip: g },
    { id: id(), type: 'dispense', dest: 'A2', volume: 100, concentration: 50, sampleId: 'S2', tip: { kind: 'new' } },
    { id: id(), type: 'mix', well: 'A2', tip: g },
  ];
}

describe('localStorage 持久化与恢复（回归）', () => {
  it('保存 → 读取回环：步骤逐一相等', () => {
    const steps = contaminationScenario();
    saveSteps(steps);
    const restored = loadSteps();
    expect(restored).toEqual(steps);
  });

  it('恢复的步骤复现相同的整孔转移污染检测与下游谱系', () => {
    const steps = contaminationScenario();
    saveSteps(steps);
    const restored = loadSteps();
    const fromRestored = simulate(restored);
    const fromOriginal = simulate(steps);
    // 同一份状态：失败、历史帧、吸头残留完全一致
    expect(fromRestored.failure).toEqual(fromOriginal.failure);
    expect(fromRestored.failure?.kind).toBe('contamination');
    expect(fromRestored.failure!.wells).toContain('A1');
    expect(fromRestored.frames).toEqual(fromOriginal.frames);
    expect(fromRestored.frames[3].B1.samples).toEqual(['S1']);
    expect(fromRestored.tipFrames).toEqual(fromOriginal.tipFrames);
  });

  it('无保存数据时回退到内置默认方案', () => {
    store.clear();
    const restored = loadSteps();
    expect(restored.map((s) => s.type)).toEqual(
      createDefaultSteps().map((s) => s.type),
    );
  });

  it('JSON 损坏时回退到默认方案', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');
    const restored = loadSteps();
    expect(restored.map((s) => s.type)).toEqual(
      createDefaultSteps().map((s) => s.type),
    );
  });

  it('步骤结构非法时回退到默认方案', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, steps: [{ id: 'x', type: 'fly', tip: { kind: 'new' } }] }),
    );
    const restored = loadSteps();
    expect(restored.map((s) => s.type)).toEqual(
      createDefaultSteps().map((s) => s.type),
    );
  });

  it('复用组等吸头字段随步骤一起恢复', () => {
    const steps = contaminationScenario();
    saveSteps(steps);
    const restored = loadSteps();
    expect(restored[2].tip).toEqual({ kind: 'reuse', group: 'G' });
    expect(restored[4].tip).toEqual({ kind: 'reuse', group: 'G' });
  });

  it('makeStepId 生成的默认方案可保存恢复且仿真一致', () => {
    const steps = createDefaultSteps();
    saveSteps(steps);
    const restored = loadSteps();
    expect(restored).toEqual(steps);
    expect(simulate(restored).failure).toBeNull();
    expect(makeStepId()).not.toBe(restored[0].id);
  });
});
