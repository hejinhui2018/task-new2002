import {
  ALL_WELL_IDS,
  createDefaultSteps,
  type Step,
  type TipMode,
} from '../engine';

const STORAGE_KEY = 'pipette-planner:v1';

/** 宽松的结构校验：语义问题交给仿真引擎在运行时判定 */
function isTipMode(v: unknown): v is TipMode {
  if (!v || typeof v !== 'object') return false;
  const t = v as { kind?: unknown; group?: unknown };
  if (t.kind === 'new') return true;
  return t.kind === 'reuse' && typeof t.group === 'string';
}

function isStep(v: unknown): v is Step {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  if (typeof s.id !== 'string' || !isTipMode(s.tip)) return false;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  const well = (x: unknown) =>
    typeof x === 'string' && ALL_WELL_IDS.includes(x);
  switch (s.type) {
    case 'transfer':
      return well(s.source) && well(s.dest) && num(s.volume);
    case 'aspirate':
      return well(s.source) && num(s.volume);
    case 'dispense':
      return (
        well(s.dest) &&
        num(s.volume) &&
        num(s.concentration) &&
        typeof s.sampleId === 'string'
      );
    case 'mix':
      return well(s.well);
    default:
      return false;
  }
}

/** 读取本地保存的步骤；数据损坏 / 缺失时回退到内置默认方案 */
export function loadSteps(): Step[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultSteps();
    const parsed = JSON.parse(raw) as { version?: number; steps?: unknown };
    if (!Array.isArray(parsed.steps) || !parsed.steps.every(isStep)) {
      return createDefaultSteps();
    }
    return parsed.steps as Step[];
  } catch {
    return createDefaultSteps();
  }
}

export function saveSteps(steps: Step[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, steps }),
    );
  } catch {
    // 隐私模式 / 配额不足时静默降级为仅内存状态
  }
}
