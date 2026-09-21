/** 仿真引擎的核心数据类型 */

export const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** 每孔最大容量 µL */
export const WELL_CAPACITY_UL = 200;
/** 内置方案的样本原液浓度 µM */
export const STOCK_CONCENTRATION_UM = 100;
/** 内置方案的样本标识 */
export const DEFAULT_SAMPLE_ID = 'S1';

export type RowLetter = (typeof ROWS)[number];
export type WellId = string; // 形如 "A1" .. "H12"

/**
 * 孔状态。
 * - volume：孔内液体体积 (µL)
 * - amount：孔内分析物总量 (pmol = µM·µL)，浓度 = amount / volume
 *   用“物质量”记账，混匀与转移时的浓度计算就是简单的加除，
 *   也便于做质量守恒校验。
 * - mixed：孔内液体是否已混匀。加液 / 受液后变为 false，
 *   必须先 mix 才能作为转移的来源。
 * - samples：孔内液体含有的样本标识集合（样本谱系）。
 *   复用吸头带入孔内“本不含有”的样本即判定为跨样本污染；
 *   连续稀释链上的下游孔因正常受液已含有上游样本，不会误报。
 */
export interface Well {
  id: WellId;
  volume: number;
  amount: number;
  mixed: boolean;
  samples: string[];
}

export type PlateState = Record<WellId, Well>;

/** 吸头模式：每次全新，或在同一个“复用组”内共用一支吸头 */
export type TipMode =
  | { kind: 'new' }
  | { kind: 'reuse'; group: string };

export type TipKind = 'new' | 'reuse';

interface StepBase {
  id: string;
  tip: TipMode;
}

/** 从 source 吸取 volume µL 打入 dest */
export interface TransferStep extends StepBase {
  type: 'transfer';
  source: WellId;
  dest: WellId;
  volume: number;
}

/** 从 source 吸取 volume µL 并废弃（孔外废液缸） */
export interface AspirateStep extends StepBase {
  type: 'aspirate';
  source: WellId;
  volume: number;
}

/**
 * 从储液池向 dest 加入 volume µL、浓度 concentration µM 的液体。
 * concentration = 0 表示纯稀释液；> 0 时 sampleId 标识样本来源
 * （同一样本的多次加液应使用相同 sampleId）。
 */
export interface DispenseStep extends StepBase {
  type: 'dispense';
  dest: WellId;
  volume: number;
  concentration: number;
  sampleId: string;
}

/** 混匀指定孔 */
export interface MixStep extends StepBase {
  type: 'mix';
  well: WellId;
}

export type Step = TransferStep | AspirateStep | DispenseStep | MixStep;

export type FailureKind =
  | 'invalid' // 步骤参数非法
  | 'empty' // 吸空：余量不足
  | 'overflow' // 溢出：超过 200 µL
  | 'unmixed' // 未混匀即转移
  | 'contamination'; // 复用吸头跨样本带入

export interface Failure {
  /** 出错步骤在当前步骤序列中的下标 */
  stepIndex: number;
  stepId: string;
  kind: FailureKind;
  /** 受影响的孔（污染时首项为被带入孔，其余为残留来源孔） */
  wells: WellId[];
  message: string;
}

/** 一支（按复用组区分的）吸头在步骤之间残留的样本记录 */
export interface TipState {
  /** 残液中分析物曾经来自的孔；为空表示吸头干净 */
  residueSources: WellId[];
  /** 残液中带有的样本标识 */
  residueSamples: string[];
}

/** 质量守恒账：板上 + 废液 = 初始 + 储液池加入 */
export interface Ledger {
  initialVolume: number;
  addedVolume: number;
  onPlateVolume: number;
  wasteVolume: number;
  initialAmount: number;
  addedAmount: number;
  onPlateAmount: number;
  wasteAmount: number;
}

export interface SimResult {
  /** frames[0] 为初始板，frames[k] 为前 k 个步骤成功执行后的板 */
  frames: PlateState[];
  /** 与 frames 对齐的吸头状态快照（按复用组名索引；不含一次性新吸头） */
  tipFrames: Record<string, TipState>[];
  /** 累加的废液账（与 frames 对齐） */
  wasteFrames: { volume: number; amount: number }[];
  failure: Failure | null;
  ledger: Ledger;
}
