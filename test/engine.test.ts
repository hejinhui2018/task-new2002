import { describe, expect, it } from 'vitest';
import {
  createDefaultSteps,
  createInitialPlate,
  ledgerBalanced,
  simulate,
  STOCK_CONCENTRATION_UM,
  WELL_CAPACITY_UL,
  concentration,
  type PlateState,
  type Step,
} from '../src/engine';
import { makeStepId } from '../src/engine/defaults';
import { wellId } from '../src/engine/plate';

function dispense(
  dest: string,
  volume: number,
  conc: number,
  tip: Step['tip'] = { kind: 'new' },
  sampleId = 'S1',
): Step {
  return {
    id: makeStepId(),
    type: 'dispense',
    dest,
    volume,
    concentration: conc,
    sampleId: conc > 0 ? sampleId : '',
    tip,
  };
}
function mix(well: string, tip: Step['tip'] = { kind: 'new' }): Step {
  return { id: makeStepId(), type: 'mix', well, tip };
}
function transfer(
  source: string,
  dest: string,
  volume: number,
  tip: Step['tip'] = { kind: 'new' },
): Step {
  return { id: makeStepId(), type: 'transfer', source, dest, volume, tip };
}
function aspirate(
  source: string,
  volume: number,
  tip: Step['tip'] = { kind: 'new' },
): Step {
  return { id: makeStepId(), type: 'aspirate', source, volume, tip };
}

function lastFrame(steps: Step[]): PlateState {
  const r = simulate(steps);
  expect(r.failure).toBeNull();
  return r.frames[r.frames.length - 1];
}

describe('内置 A1→A8 二倍稀释方案', () => {
  const steps = createDefaultSteps();
  const result = simulate(steps, createInitialPlate());

  it('全程无失败', () => {
    expect(result.failure).toBeNull();
    expect(result.frames.length).toBe(steps.length + 1);
  });

  it('产生严格的二倍浓度链：100, 50, 25, … , 0.78125 µM', () => {
    const plate = result.frames[result.frames.length - 1];
    for (let col = 1; col <= 8; col++) {
      const expected = STOCK_CONCENTRATION_UM / 2 ** (col - 1);
      expect(concentration(plate[wellId('A', col)])).toBeCloseTo(expected, 9);
    }
  });

  it('各孔终体积均为 100 µL（最后从 A8 弃去 100）', () => {
    const plate = result.frames[result.frames.length - 1];
    for (let col = 1; col <= 8; col++) {
      expect(plate[wellId('A', col)].volume).toBeCloseTo(100, 9);
    }
  });

  it('A8 弃液前为 200 µL / 0.78125 µM', () => {
    // 倒数第二步是 mix A8，倒数第一步才是 aspirate
    const beforeAspirate = result.frames[result.frames.length - 2];
    expect(beforeAspirate.A8.volume).toBeCloseTo(200, 9);
    expect(concentration(beforeAspirate.A8)).toBeCloseTo(
      STOCK_CONCENTRATION_UM / 2 ** 7,
      9,
    );
  });
});

describe('质量守恒', () => {
  it('内置方案：板上 + 废液 = 初始 + 储液加入（体积与物质量）', () => {
    const result = simulate(createDefaultSteps(), createInitialPlate());
    expect(ledgerBalanced(result)).toBe(true);
    // 加入 200 + 7×100 = 900 µL；最终板上 8×100 = 800，废液 100
    expect(result.ledger.addedVolume).toBeCloseTo(900, 9);
    expect(result.ledger.onPlateVolume).toBeCloseTo(800, 9);
    expect(result.ledger.wasteVolume).toBeCloseTo(100, 9);
    // 样本总量 100µM × 200µL = 20000 pmol，最终按 100µL/孔分布在 8 孔
    const chainSum = Array.from({ length: 8 }, (_, i) =>
      (STOCK_CONCENTRATION_UM / 2 ** i) * 100,
    ).reduce((a, b) => a + b, 0);
    expect(result.ledger.onPlateAmount).toBeCloseTo(chainSum, 6);
    expect(result.ledger.wasteAmount).toBeCloseTo(
      (STOCK_CONCENTRATION_UM / 2 ** 7) * 100,
      6,
    );
  });

  it('任意加液/转移/弃液组合都平账', () => {
    const steps: Step[] = [
      dispense('B2', 150, 40),
      dispense('B3', 50, 0),
      mix('B2'),
      transfer('B2', 'B3', 75),
      mix('B3'),
      transfer('B3', 'B4', 60),
      mix('B4'),
      aspirate('B4', 30),
    ];
    const result = simulate(steps);
    expect(result.failure).toBeNull();
    expect(ledgerBalanced(result)).toBe(true);
  });

  it('失败时也在已执行的前缀上保持守恒', () => {
    const steps: Step[] = [
      dispense('C1', 100, 10),
      mix('C1'),
      aspirate('C1', 150), // 吸空失败
    ];
    const result = simulate(steps);
    expect(result.failure?.kind).toBe('empty');
    expect(ledgerBalanced(result)).toBe(true);
  });
});

describe('连续稀释的中间帧', () => {
  it('每转移一孔，来源孔减半、目标孔等浓度混合', () => {
    const result = simulate(createDefaultSteps(), createInitialPlate());
    // 前 8 步是 dispense（A1 + A2..A8）。第 9 步 mix A1，第 10 步 transfer A1→A2
    const afterFirstTransfer = result.frames[10];
    expect(afterFirstTransfer.A1.volume).toBeCloseTo(100, 9);
    expect(afterFirstTransfer.A2.volume).toBeCloseTo(200, 9);
    expect(concentration(afterFirstTransfer.A2)).toBeCloseTo(50, 9);
    // A2 在受液后处于未混匀状态
    expect(afterFirstTransfer.A2.mixed).toBe(false);
  });
});

describe('步骤重排：浓度断链', () => {
  it('把 A2 的混匀挪到 A1→A2 转移之前会断链：A2 受液后未混匀即被吸样', () => {
    const steps = createDefaultSteps();
    // 8=mix A1, 9=transfer A1→A2, 10=mix A2, 11=transfer A2→A3
    // 交换 9 和 10：A2 在还是纯稀释液时被混匀，随后受液变成未混匀
    const reordered = [...steps];
    [reordered[9], reordered[10]] = [reordered[10], reordered[9]];

    const result = simulate(reordered, createInitialPlate());
    expect(result.failure).not.toBeNull();
    expect(result.failure!.kind).toBe('unmixed');
    expect(result.failure!.wells).toContain('A2');
    expect(result.failure!.stepIndex).toBe(11);
    // 此前有效状态仍可查看：frames 含初始帧 + 11 个成功步骤
    expect(result.frames.length).toBe(12);
    // 最后一帧中 A1→A2 的转移已生效（A2 有 200 µL 但未混匀）
    const last = result.frames[result.frames.length - 1];
    expect(last.A2.volume).toBeCloseTo(200, 9);
    expect(last.A2.mixed).toBe(false);
  });

  it('重排后重新计算，不保留旧结果：删除关键 mix 后 A3 链断开', () => {
    const steps = createDefaultSteps();
    // 删掉 mix A2 步骤（A1→A2 转移之后、A2→A3 转移之前）
    const mixA2Index = steps.findIndex(
      (s) => s.type === 'mix' && s.well === 'A2',
    );
    const removed = steps.filter((_, i) => i !== mixA2Index);
    const result = simulate(removed, createInitialPlate());
    expect(result.failure?.kind).toBe('unmixed');
    expect(result.failure!.wells).toContain('A2');
  });

  it('调换两次加液顺序改变浓度，仿真按新顺序给出新结果', () => {
    const a: Step[] = [
      dispense('D1', 100, 100),
      dispense('D1', 100, 0),
      mix('D1'),
    ];
    const b: Step[] = [
      dispense('D1', 100, 0),
      dispense('D1', 100, 100),
      mix('D1'),
    ];
    const ra = simulate(a);
    const rb = simulate(b);
    expect(ra.failure).toBeNull();
    expect(rb.failure).toBeNull();
    // 两种顺序终态相同（总量守恒），但第 1 步后的中间帧不同
    expect(ra.frames[1].D1.amount).toBeCloseTo(10000, 9);
    expect(rb.frames[1].D1.amount).toBeCloseTo(0, 9);
  });
});

describe('容量限制（200 µL/孔）', () => {
  it('单次加液超过容量 → overflow', () => {
    const result = simulate([dispense('E1', WELL_CAPACITY_UL + 1, 10)]);
    expect(result.failure?.kind).toBe('overflow');
    expect(result.failure!.wells).toEqual(['E1']);
    // 失败步骤不产生任何状态变更
    expect(result.frames.length).toBe(1);
    expect(result.frames[0].E1.volume).toBe(0);
  });

  it('累计加液超过容量 → overflow', () => {
    const result = simulate([
      dispense('E2', 150, 0),
      dispense('E2', 60, 0),
    ]);
    expect(result.failure?.kind).toBe('overflow');
    expect(result.failure!.stepIndex).toBe(1);
  });

  it('转移进液导致超限 → overflow', () => {
    const result = simulate([
      dispense('F1', 180, 10),
      dispense('F2', 180, 0),
      mix('F1'),
      transfer('F1', 'F2', 30),
    ]);
    expect(result.failure?.kind).toBe('overflow');
    expect(result.failure!.wells).toEqual(['F2']);
  });

  it('恰好 200 µL 不溢出', () => {
    const result = simulate([
      dispense('F3', 120, 0),
      dispense('F3', 80, 0),
    ]);
    expect(result.failure).toBeNull();
    expect(result.frames.at(-1)!.F3.volume).toBeCloseTo(200, 9);
  });
});

describe('吸空', () => {
  it('吸取量超过余量 → empty 并停止', () => {
    const result = simulate([
      dispense('G1', 50, 10),
      mix('G1'),
      aspirate('G1', 100),
    ]);
    expect(result.failure?.kind).toBe('empty');
    expect(result.failure!.wells).toEqual(['G1']);
  });

  it('转移量超过来源余量 → empty', () => {
    const result = simulate([
      dispense('G2', 40, 10),
      dispense('G3', 10, 0),
      mix('G2'),
      transfer('G2', 'G3', 80),
    ]);
    expect(result.failure?.kind).toBe('empty');
    expect(result.failure!.stepIndex).toBe(3);
    // 目标孔的容量检查虽在吸空检查之后，但 G3 尚未被改动
    const plate = result.frames.at(-1)!;
    expect(plate.G2.volume).toBeCloseTo(40, 9);
    expect(plate.G3.volume).toBeCloseTo(10, 9);
  });
});

describe('未混匀转移', () => {
  it('向已有液体的孔加液后不混匀直接吸样 → unmixed', () => {
    const result = simulate([
      dispense('H1', 100, 100),
      dispense('H1', 100, 0),
      // 故意不 mix
      aspirate('H1', 10),
    ]);
    expect(result.failure?.kind).toBe('unmixed');
    expect(result.failure!.wells).toEqual(['H1']);
  });

  it('空孔受液视为均匀，无需显式混匀', () => {
    const result = simulate([
      dispense('H2', 100, 50),
      aspirate('H2', 10),
    ]);
    expect(result.failure).toBeNull();
  });

  it('转移进入已有液体后必须重新混匀', () => {
    const result = simulate([
      dispense('H3', 100, 100),
      dispense('H4', 100, 0),
      mix('H3'),
      transfer('H3', 'H4', 100), // H4 现在未混匀
      aspirate('H4', 10),
    ]);
    expect(result.failure?.kind).toBe('unmixed');
    expect(result.failure!.wells).toEqual(['H4']);
  });
});

describe('吸头状态：新吸头 / 复用组', () => {
  it('全程新吸头：无任何污染，吸头表为空', () => {
    const result = simulate(createDefaultSteps(), createInitialPlate());
    expect(result.failure).toBeNull();
    // 一次性新吸头不入复用表
    expect(Object.keys(result.tipFrames.at(-1)!)).toHaveLength(0);
  });

  it('同一复用组沿连续稀释链复用是安全的（先用干净吸头分装稀释液，再接触样本）', () => {
    const group = { kind: 'reuse' as const, group: 'g1' };
    const result = simulate([
      // 干净吸头先分装稀释液（无分析物，不留下样本残留）
      dispense('A2', 100, 0, group),
      dispense('A3', 100, 0, group),
      dispense('A1', 200, 100, group), // 吸头只接触过稀释液 → 安全
      mix('A1', group),
      transfer('A1', 'A2', 100, group), // 转移本身把 S1 送入 A2，属预期
      mix('A2', group), // A2 已通过受液获得 S1 谱系 → 安全
      transfer('A2', 'A3', 100, group),
    ]);
    expect(result.failure).toBeNull();
    const plate = result.frames.at(-1)!;
    expect(plate.A3.samples).toEqual(['S1']);
    expect(concentration(plate.A3)).toBeCloseTo(25, 9);
  });

  it('吸头接触样本后再用它向不相干孔加液会被拦截（残留在正式转移前进入）', () => {
    const group = { kind: 'reuse' as const, group: 'g1' };
    const result = simulate([
      dispense('A1', 200, 100, group),
      dispense('A2', 100, 0, group), // 吸头已带 S1，却向空 A2 打稀释液
    ]);
    expect(result.failure?.kind).toBe('contamination');
    expect(result.failure!.wells[0]).toBe('A2');
  });

  it('同一支吸头重复进入同一个含样本孔是安全的', () => {
    const g = { kind: 'reuse' as const, group: 'same' };
    const result = simulate([
      dispense('A1', 100, 100, g),
      mix('A1', g),
      aspirate('A1', 10, g),
      mix('A1', g),
      aspirate('A1', 10, g),
    ]);
    expect(result.failure).toBeNull();
  });

  it('复用吸头把 S1 带入只含 S2 的另一组孔 → contamination', () => {
    const group = { kind: 'reuse' as const, group: 'serial' };
    const result = simulate([
      dispense('A1', 100, 100, group, 'S1'),
      mix('A1', group),
      aspirate('A1', 10, group), // 吸头带 S1 残留
      dispense('B1', 100, 100, { kind: 'new' }, 'S2'),
      mix('B1', group), // S1 残留进入只含 S2 的 B1
    ]);
    expect(result.failure?.kind).toBe('contamination');
    expect(result.failure!.wells[0]).toBe('B1');
    expect(result.failure!.wells).toContain('A1');
    expect(result.failure!.stepIndex).toBe(4);
    // 失败前 B1 未被改动
    const plate = result.frames.at(-1)!;
    expect(plate.B1.volume).toBeCloseTo(100, 9);
  });

  it('吸头残留进入不相干的空孔同样算污染', () => {
    const group = { kind: 'reuse' as const, group: 'g' };
    const result = simulate([
      dispense('A1', 100, 100, group, 'S1'),
      mix('A1', group),
      aspirate('A1', 10, group),
      mix('C5', group), // C5 是空孔
    ]);
    expect(result.failure?.kind).toBe('contamination');
    expect(result.failure!.wells).toContain('C5');
  });

  it('不同复用组互不影响', () => {
    const gA = { kind: 'reuse' as const, group: 'A' };
    const gB = { kind: 'reuse' as const, group: 'B' };
    const plate = lastFrame([
      dispense('A1', 100, 100, gA, 'S1'),
      dispense('B1', 100, 100, gB, 'S2'),
      mix('A1', gA),
      mix('B1', gB),
      aspirate('A1', 10, gA),
      aspirate('B1', 10, gB),
    ]);
    expect(plate.A1.volume).toBeCloseTo(90, 9);
    expect(plate.B1.volume).toBeCloseTo(90, 9);
  });

  it('换用新吸头不携带残留：同一新吸头步骤不会把上一孔样本带入下一组', () => {
    const g = { kind: 'reuse' as const, group: 'x' };
    const result = simulate([
      dispense('A1', 100, 100, g, 'S1'),
      mix('A1', g),
      // 新吸头处理 B1（S2），安全
      dispense('B1', 100, 100, { kind: 'new' }, 'S2'),
      mix('B1', { kind: 'new' }),
      aspirate('B1', 10, { kind: 'new' }),
      // 再用回复用组 x：吸头仍带 S1，进入 B1 必须报错
      mix('B1', g),
    ]);
    expect(result.failure?.kind).toBe('contamination');
    expect(result.failure!.wells[0]).toBe('B1');
  });

  it('只接触过稀释液（无分析物）的复用吸头不构成污染', () => {
    const g = { kind: 'reuse' as const, group: 'buffer' };
    const result = simulate([
      dispense('A1', 100, 0, g),
      dispense('A2', 100, 100, { kind: 'new' }, 'S9'),
      mix('A2', g),
    ]);
    expect(result.failure).toBeNull();
  });

  it('复用组名为空 → invalid', () => {
    const result = simulate([
      dispense('A1', 100, 100, { kind: 'reuse', group: '  ' }),
    ]);
    expect(result.failure?.kind).toBe('invalid');
  });

  it('含样本加液缺少样本标识 → invalid', () => {
    const result = simulate([
      {
        id: makeStepId(),
        type: 'dispense',
        dest: 'A1',
        volume: 100,
        concentration: 50,
        sampleId: '  ',
        tip: { kind: 'new' },
      },
    ]);
    expect(result.failure?.kind).toBe('invalid');
  });
});
