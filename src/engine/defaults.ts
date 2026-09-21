import {
  DEFAULT_SAMPLE_ID,
  STOCK_CONCENTRATION_UM,
  type PlateState,
  type Step,
} from './types';
import { clonePlate, createEmptyPlate, wellId } from './plate';

let seq = 0;
export function makeStepId(): string {
  seq += 1;
  return `step-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 内置 A1 → A8 二倍稀释方案：
 * - A1：200 µL、100 µM 样本（样本标识 S1）
 * - A2..A8：各 100 µL 稀释液
 * - A1..A7 依次混匀并向下一孔转移 100 µL
 * - 最后从 A8 混匀后弃去 100 µL（使各孔终体积一致：100 µL）
 * 全部使用新吸头。
 */
export function createDefaultSteps(): Step[] {
  const steps: Step[] = [];

  steps.push({
    id: makeStepId(),
    type: 'dispense',
    dest: 'A1',
    volume: 200,
    concentration: STOCK_CONCENTRATION_UM,
    sampleId: DEFAULT_SAMPLE_ID,
    tip: { kind: 'new' },
  });

  for (let col = 2; col <= 8; col++) {
    steps.push({
      id: makeStepId(),
      type: 'dispense',
      dest: wellId('A', col),
      volume: 100,
      concentration: 0,
      sampleId: '',
      tip: { kind: 'new' },
    });
  }

  for (let col = 1; col <= 7; col++) {
    const from = wellId('A', col);
    const to = wellId('A', col + 1);
    steps.push({ id: makeStepId(), type: 'mix', well: from, tip: { kind: 'new' } });
    steps.push({
      id: makeStepId(),
      type: 'transfer',
      source: from,
      dest: to,
      volume: 100,
      tip: { kind: 'new' },
    });
  }

  steps.push({ id: makeStepId(), type: 'mix', well: 'A8', tip: { kind: 'new' } });
  steps.push({
    id: makeStepId(),
    type: 'aspirate',
    source: 'A8',
    volume: 100,
    tip: { kind: 'new' },
  });

  return steps;
}

/** 默认初始板：空板（液体全部由步骤中的 dispense 加入） */
export function createInitialPlate(): PlateState {
  return clonePlate(createEmptyPlate());
}
