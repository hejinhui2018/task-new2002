import type { Step } from '../engine';

/**
 * 步骤序列的撤销 / 重做历史。
 * 仿真本身是纯函数：present 一旦变化，App 就从初始板重新整盘计算，
 * 因此撤销 / 重做不会绕过首错冻结——回到任意版本看到的都是该版本的真实仿真结果。
 */
export interface StepHistory {
  past: Step[][];
  present: Step[];
  future: Step[][];
}

/** 历史栈上限，避免长时间编辑后内存无限增长 */
const LIMIT = 100;

export function initHistory(initial: Step[]): StepHistory {
  return { past: [], present: initial, future: [] };
}

export type HistoryAction =
  | { type: 'commit'; steps: Step[] }
  | { type: 'undo' }
  | { type: 'redo' };

export function historyReducer(
  h: StepHistory,
  action: HistoryAction,
): StepHistory {
  switch (action.type) {
    case 'commit': {
      if (action.steps === h.present) return h;
      const past = [...h.past, h.present];
      if (past.length > LIMIT) past.shift();
      return { past, present: action.steps, future: [] };
    }
    case 'undo': {
      if (h.past.length === 0) return h;
      const previous = h.past[h.past.length - 1];
      return {
        past: h.past.slice(0, -1),
        present: previous,
        future: [h.present, ...h.future].slice(0, LIMIT),
      };
    }
    case 'redo': {
      if (h.future.length === 0) return h;
      const [next, ...rest] = h.future;
      return {
        past: [...h.past, h.present].slice(-LIMIT),
        present: next,
        future: rest,
      };
    }
  }
}

export function canUndo(h: StepHistory): boolean {
  return h.past.length > 0;
}

export function canRedo(h: StepHistory): boolean {
  return h.future.length > 0;
}
