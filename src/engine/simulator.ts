import { EPS, clonePlate, createEmptyPlate, isValidWellId } from './plate';
import {
  WELL_CAPACITY_UL,
  type Failure,
  type Ledger,
  type PlateState,
  type SimResult,
  type Step,
  type TipState,
  type WellId,
} from './types';

/** 复用组内一支吸头的残留记录 */
interface Residue {
  /** 残液中分析物曾经来自的孔 */
  wells: WellId[];
  /** 残液中带有的样本标识（样本谱系） */
  samples: string[];
}

interface InternalState {
  plate: PlateState;
  /** 按复用组名索引（一次性新吸头不入表） */
  tips: Record<string, Residue>;
  waste: { volume: number; amount: number };
  added: { volume: number; amount: number };
}

function fail(
  partial: Omit<Failure, 'stepIndex' | 'stepId'>,
  step: Step,
  index: number,
): Failure {
  return { stepIndex: index, stepId: step.id, ...partial };
}

function sumPlate(plate: PlateState): { volume: number; amount: number } {
  let volume = 0;
  let amount = 0;
  for (const id of Object.keys(plate)) {
    volume += plate[id].volume;
    amount += plate[id].amount;
  }
  return { volume, amount };
}

function isFinitePositive(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

function unionSamples(a: string[], b: string[]): string[] {
  const set = new Set(a);
  for (const s of b) set.add(s);
  return [...set].sort();
}

/**
 * 判断复用吸头进入某板孔时是否会带入“该孔本不含有”的样本。
 * 连续稀释链下游孔已通过正常受液获得上游样本谱系，不会误报。
 */
function foreignSamples(
  tip: Residue | undefined,
  enteredWell: WellId,
  plate: PlateState,
): { samples: string[]; sourceWells: WellId[] } {
  if (!tip) return { samples: [], sourceWells: [] };
  const present = new Set(plate[enteredWell].samples);
  const samples = tip.samples.filter((s) => !present.has(s));
  if (samples.length === 0) return { samples: [], sourceWells: [] };
  const sampleSet = new Set(samples);
  const sourceWells = tip.wells.filter((w) =>
    plate[w] ? plate[w].samples.some((s) => sampleSet.has(s)) : true,
  );
  return { samples, sourceWells };
}

/** 吸头接触含分析物的板孔后，把该孔的样本谱系记入残留 */
function recordResidue(
  state: InternalState,
  group: string,
  well: WellId,
): void {
  const w = state.plate[well];
  if (w.amount <= EPS) return; // 只接触稀释液，无分析物残留
  const tip = (state.tips[group] ??= { wells: [], samples: [] });
  if (!tip.wells.includes(well)) tip.wells.push(well);
  tip.samples = unionSamples(tip.samples, w.samples);
}

/**
 * 按当前步骤顺序从初始板开始逐步仿真。
 * 任何步骤失败即停止：failure 记录首个失败，frames 保留此前全部有效状态。
 * 本函数是纯函数——步骤重排 / 增删 / 编辑后重新调用即可，绝不会沿用旧结果。
 */
export function simulate(
  steps: Step[],
  initialPlate?: PlateState,
  capacity: number = WELL_CAPACITY_UL,
): SimResult {
  const startPlate = initialPlate ? clonePlate(initialPlate) : createEmptyPlate();
  const initialTotals = sumPlate(startPlate);

  const state: InternalState = {
    plate: clonePlate(startPlate),
    tips: {},
    waste: { volume: 0, amount: 0 },
    added: { volume: 0, amount: 0 },
  };

  const frames: PlateState[] = [clonePlate(state.plate)];
  const tipFrames: Record<string, TipState>[] = [{}];
  const wasteFrames = [{ volume: 0, amount: 0 }];
  let failure: Failure | null = null;

  const snapshotTips = (): Record<string, TipState> => {
    const out: Record<string, TipState> = {};
    for (const [group, tip] of Object.entries(state.tips)) {
      out[group] = {
        residueSources: [...tip.wells],
        residueSamples: [...tip.samples],
      };
    }
    return out;
  };

  outer: for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isReuse = step.tip.kind === 'reuse';
    const tipGroup =
      step.tip.kind === 'reuse' ? step.tip.group.trim() : '';

    // —— 1. 参数合法性 ——
    if (isReuse && tipGroup === '') {
      failure = fail(
        { kind: 'invalid', wells: [], message: '复用吸头必须指定一个复用组名。' },
        step,
        i,
      );
      break;
    }

    let enteredWell: WellId | null = null; // 吸头接触的板孔（污染检查点）
    let sourceWell: WellId | null = null;
    let destWell: WellId | null = null;
    let drawVolume = 0;
    let incomingVolume = 0;

    switch (step.type) {
      case 'transfer':
        if (
          !isValidWellId(step.source) ||
          !isValidWellId(step.dest) ||
          step.source === step.dest ||
          !isFinitePositive(step.volume)
        ) {
          failure = fail(
            {
              kind: 'invalid',
              wells: [step.source, step.dest].filter(isValidWellId),
              message: '转移步骤需要两个不同的有效孔，且体积须为正数。',
            },
            step,
            i,
          );
          break outer;
        }
        sourceWell = step.source;
        destWell = step.dest;
        drawVolume = step.volume;
        incomingVolume = step.volume;
        enteredWell = sourceWell; // 吸样时吸头先接触来源孔
        break;

      case 'aspirate':
        if (!isValidWellId(step.source) || !isFinitePositive(step.volume)) {
          failure = fail(
            {
              kind: 'invalid',
              wells: isValidWellId(step.source) ? [step.source] : [],
              message: '弃液步骤需要有效孔且体积须为正数。',
            },
            step,
            i,
          );
          break outer;
        }
        sourceWell = step.source;
        drawVolume = step.volume;
        enteredWell = sourceWell;
        break;

      case 'dispense':
        if (
          !isValidWellId(step.dest) ||
          !isFinitePositive(step.volume) ||
          !(Number.isFinite(step.concentration) && step.concentration >= 0)
        ) {
          failure = fail(
            {
              kind: 'invalid',
              wells: isValidWellId(step.dest) ? [step.dest] : [],
              message: '加液步骤需要有效孔、正体积和非负浓度。',
            },
            step,
            i,
          );
          break outer;
        }
        if (step.concentration > 0 && step.sampleId.trim() === '') {
          failure = fail(
            {
              kind: 'invalid',
              wells: [step.dest],
              message: '加入含样本液体（浓度 > 0）时必须指定样本标识，用于追踪吸头跨样本带入。',
            },
            step,
            i,
          );
          break outer;
        }
        destWell = step.dest;
        incomingVolume = step.volume;
        enteredWell = destWell; // 残液随排出的液体进入目标孔
        break;

      case 'mix':
        if (!isValidWellId(step.well)) {
          failure = fail(
            { kind: 'invalid', wells: [], message: '混匀步骤需要指定一个有效孔。' },
            step,
            i,
          );
          break outer;
        }
        enteredWell = step.well;
        break;
    }

    // —— 2. 吸头跨样本带入（吸头接触板孔的一刻即发生，先于一切容量检查）——
    if (isReuse) {
      const { samples, sourceWells } = foreignSamples(
        state.tips[tipGroup],
        enteredWell!,
        state.plate,
      );
      if (samples.length > 0) {
        failure = fail(
          {
            kind: 'contamination',
            wells: [enteredWell!, ...sourceWells],
            message:
              `复用吸头（组 ${tipGroup}）残留来自 ${sourceWells.join('、') || '其他孔'} 的样本 ${samples.join(
                '、',
              )}，进入 ${enteredWell} 时会跨样本带入该孔。请改用新吸头或更换复用组。`,
          },
          step,
          i,
        );
        break;
      }
    }

    // —— 3. 从板孔吸样：先查混匀，再查余量（吸空）——
    if (sourceWell) {
      const src = state.plate[sourceWell];
      if (!src.mixed) {
        failure = fail(
          {
            kind: 'unmixed',
            wells: [sourceWell],
            message: `孔 ${sourceWell} 尚未混匀即从中吸样，浓度不具代表性。请先添加混匀步骤。`,
          },
          step,
          i,
        );
        break;
      }
      if (src.volume + EPS < drawVolume) {
        failure = fail(
          {
            kind: 'empty',
            wells: [sourceWell],
            message: `吸空：孔 ${sourceWell} 余量 ${round(src.volume)} µL，不足 ${round(
              drawVolume,
            )} µL。`,
          },
          step,
          i,
        );
        break;
      }
    }

    // —— 4. 目标孔容量（溢出）——
    if (destWell) {
      const dst = state.plate[destWell];
      if (dst.volume + incomingVolume > capacity + EPS) {
        failure = fail(
          {
            kind: 'overflow',
            wells: [destWell],
            message: `溢出：孔 ${destWell} 现有 ${round(dst.volume)} µL，加入 ${round(
              incomingVolume,
            )} µL 后超过容量 ${capacity} µL。`,
          },
          step,
          i,
        );
        break;
      }
    }

    // —— 全部检查通过，执行状态变更 ——
    switch (step.type) {
      case 'transfer': {
        const src = state.plate[sourceWell!];
        const dst = state.plate[destWell!];
        const c = src.volume > 0 ? src.amount / src.volume : 0;
        const drawnAmount = c * drawVolume;
        src.volume -= drawVolume;
        src.amount -= drawnAmount;
        if (src.volume <= EPS) {
          src.volume = 0;
          src.amount = 0;
          src.samples = [];
        }
        // 均匀液体被吸走后，剩余液体仍均匀
        const wasEmpty = dst.volume <= EPS;
        dst.volume += drawVolume;
        dst.amount += drawnAmount;
        dst.samples = unionSamples(dst.samples, src.samples);
        dst.mixed = wasEmpty; // 与孔内旧液合并后必须重新混匀
        if (isReuse) recordResidue(state, tipGroup, sourceWell!);
        break;
      }
      case 'aspirate': {
        const src = state.plate[sourceWell!];
        const c = src.volume > 0 ? src.amount / src.volume : 0;
        const drawnAmount = c * drawVolume;
        src.volume -= drawVolume;
        src.amount -= drawnAmount;
        if (src.volume <= EPS) {
          src.volume = 0;
          src.amount = 0;
          src.samples = [];
        }
        state.waste.volume += drawVolume;
        state.waste.amount += drawnAmount;
        if (isReuse) recordResidue(state, tipGroup, sourceWell!);
        break;
      }
      case 'dispense': {
        const dst = state.plate[destWell!];
        const wasEmpty = dst.volume <= EPS;
        dst.volume += step.volume;
        dst.amount += step.concentration * step.volume;
        if (step.concentration > 0) {
          dst.samples = unionSamples(dst.samples, [step.sampleId.trim()]);
        }
        dst.mixed = wasEmpty; // 空孔加入均匀液体即均匀；与旧液合并则需混匀
        state.added.volume += step.volume;
        state.added.amount += step.concentration * step.volume;
        // 加液时复用吸头先接触过目标孔（残液已排入），再接触储液池不影响板孔
        if (isReuse) recordResidue(state, tipGroup, destWell!);
        break;
      }
      case 'mix': {
        state.plate[enteredWell!].mixed = true;
        if (isReuse) recordResidue(state, tipGroup, enteredWell!);
        break;
      }
    }

    frames.push(clonePlate(state.plate));
    tipFrames.push(snapshotTips());
    wasteFrames.push({ ...state.waste });
  }

  const onPlate = sumPlate(state.plate);
  const ledger: Ledger = {
    initialVolume: initialTotals.volume,
    addedVolume: state.added.volume,
    onPlateVolume: onPlate.volume,
    wasteVolume: state.waste.volume,
    initialAmount: initialTotals.amount,
    addedAmount: state.added.amount,
    onPlateAmount: onPlate.amount,
    wasteAmount: state.waste.amount,
  };

  return { frames, tipFrames, wasteFrames, failure, ledger };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** 质量守恒校验：板上 + 废液 = 初始 + 储液加入（体积与物质量分别核对） */
export function ledgerBalanced(result: SimResult, eps = 1e-6): boolean {
  const l = result.ledger;
  return (
    Math.abs(l.onPlateVolume + l.wasteVolume - l.initialVolume - l.addedVolume) <=
      eps &&
    Math.abs(l.onPlateAmount + l.wasteAmount - l.initialAmount - l.addedAmount) <=
      eps
  );
}
