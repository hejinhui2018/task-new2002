// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { makeStepId } from '../src/engine/defaults';
import { saveSteps } from '../src/state/storage';
import type { Step } from '../src/engine';

// App 的 useTheme 依赖 matchMedia，jsdom 未实现
beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
  }
  localStorage.clear();
});

let container: HTMLDivElement;
let root: Root;

async function renderApp() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {
    root.render(React.createElement(App));
  });
}

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

const rows = () => container.querySelectorAll('.step-row');
const buttons = () => [...container.querySelectorAll('button')];
const buttonByText = (text: string) =>
  buttons().find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const buttonByTitle = (frag: string) =>
  buttons().find((b) => (b.title ?? '').includes(frag)) as HTMLButtonElement;

/** 用合成事件模拟 HTML5 拖拽排序。jsdom 不实现 DragEvent，但 React 18 通过根节点
 *  委托按事件名分发，普通 Event 命名为 dragstart/drop 即可触发 React 的 onDrop；
 *  dataTransfer 手动挂一个假对象。每个事件单独包一层 act，确保 dragstart 的
 *  React state（dragIndex）在 dragover/drop 读取前已刷新。 */
async function dragReorder(from: number, to: number) {
  const dt = { effectAllowed: '', dropEffect: '' };
  const fire = (el: Element, name: string) => {
    const ev = new Event(name, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    el.dispatchEvent(ev);
  };
  const all = rows();
  await act(async () => {
    fire(all[from], 'dragstart');
  });
  await act(async () => {
    fire(all[to], 'dragover');
  });
  await act(async () => {
    fire(all[to], 'drop');
  });
  await act(async () => {
    fire(all[from], 'dragend');
  });
}

const newTip = { kind: 'new' as const };

/** 现场场景：复用吸头整孔转移 S1（A1→A2），随后进入另一份样本 B1(S2) */
function scenarioSteps(): Step[] {
  return [
    {
      id: makeStepId(),
      type: 'dispense',
      dest: 'A1',
      volume: 100,
      concentration: 100,
      sampleId: 'S1',
      tip: newTip,
    },
    {
      id: makeStepId(),
      type: 'transfer',
      source: 'A1',
      dest: 'A2',
      volume: 100,
      tip: { kind: 'reuse', group: 'G' },
    },
    {
      id: makeStepId(),
      type: 'dispense',
      dest: 'B1',
      volume: 100,
      concentration: 100,
      sampleId: 'S2',
      tip: newTip,
    },
    {
      id: makeStepId(),
      type: 'mix',
      well: 'B1',
      tip: { kind: 'reuse', group: 'G' },
    },
  ];
}

const aria = (id: string) =>
  (container.querySelector(`[role="gridcell"][aria-label^="${id}："]`) as HTMLElement)
    ?.getAttribute('aria-label') ?? '';

describe('App：跨样本复用吸头现场场景', () => {
  it('整孔转移后下游谱系可见、残留面板与失败解释一致，且首错冻结', async () => {
    saveSteps(scenarioSteps());
    await renderApp();

    // 直接跳到末帧（第 4 步失败）
    await act(async () => {
      buttonByText('⏭ 到末尾').click();
    });

    // 失败解释：第 4 步、跨样本带入、残留样本 S1、来源孔 A1、被带入孔 B1
    expect(container.textContent).toContain('停在第 4 步');
    expect(container.textContent).toContain('吸头跨样本带入');
    expect(container.textContent).toMatch(/复用吸头（组 G）.*S1/);
    expect(container.textContent).toContain('受影响孔：B1、A1');
    // 成功横幅不得出现（不能放行）
    expect(container.textContent).not.toContain('步执行成功');

    // 同一帧的残留面板与失败解释同源（tipFrames[3]）
    expect(container.textContent).toContain('复用吸头残留（当前帧）');
    const panel = container.querySelector('.tip-residue') as HTMLElement;
    expect(panel.textContent).toContain('G');
    expect(panel.textContent).toContain('S1');
    expect(panel.textContent).toContain('A1');

    // 首错冻结：不能越过失败帧继续前进
    expect(buttonByText('单步 ▶').disabled).toBe(true);
    expect(buttonByText('⏭ 到末尾').disabled).toBe(true);

    // 失败步骤前的帧可回看：后退到第 2 步（整孔转移）那一帧
    await act(async () => {
      buttonByText('◀ 单步').click();
    });
    expect(container.textContent).toContain('第 2 步执行后：转移 A1 → A2');
    // 下游孔详情（aria-label 与悬停提示读同一 well.samples）显示原样本来源
    expect(aria('A2')).toContain('体积 100.0 µL');
    expect(aria('A2')).toContain('样本谱系 S1');
    // 源孔已被整孔清空，不再携带身份
    expect(aria('A1')).toContain('体积 0.0 µL');
    expect(aria('A1')).not.toContain('样本谱系');
    // 历史帧中残留面板随帧对齐：第 2 步后 G 已带 S1
    expect(container.textContent).toContain('G');
    expect(container.textContent).toContain('残留样本');

    // 再前进仍回到同一失败，失败信息没有被编辑/回看动作绕过
    await act(async () => {
      buttonByText('单步 ▶').click();
    });
    expect(container.textContent).toContain('停在第 4 步');
    expect(container.textContent).toContain('吸头跨样本带入');
  });
});

describe('App：步骤重排', () => {
  it('拖拽把复用吸头重回已清空源孔的步骤挪开后，失败消失；撤销后恢复', async () => {
    // 顺序：加液 S1 → 整孔转移（A1 清空，G 带 S1）→ G 混匀空 A1（污染）
    const steps: Step[] = [
      {
        id: makeStepId(),
        type: 'dispense',
        dest: 'A1',
        volume: 100,
        concentration: 100,
        sampleId: 'S1',
        tip: newTip,
      },
      {
        id: makeStepId(),
        type: 'transfer',
        source: 'A1',
        dest: 'A2',
        volume: 100,
        tip: { kind: 'reuse', group: 'G' },
      },
      { id: makeStepId(), type: 'mix', well: 'A1', tip: { kind: 'reuse', group: 'G' } },
    ];
    saveSteps(steps);
    await renderApp();

    await act(async () => {
      buttonByText('⏭ 到末尾').click();
    });
    expect(container.textContent).toContain('停在第 3 步');
    expect(container.textContent).toContain('吸头跨样本带入');

    // 把第 3 步（mix A1）拖到第 2 步（整孔转移）之前
    await dragReorder(2, 1);

    // 重排后多了一个成功帧，先走到新方案的末帧
    await act(async () => {
      buttonByText('⏭ 到末尾').click();
    });

    // 重排后纯函数重新仿真：mix 发生在 A1 还含 S1 时，全部成功
    expect(container.textContent).not.toContain('停在第');
    expect(container.textContent).toContain('全部 3 步执行成功');
    expect(aria('A2')).toContain('样本谱系 S1');

    // 撤销拖拽：危险顺序回来，首错冻结恢复
    await act(async () => {
      buttonByTitle('撤销').click();
    });
    expect(container.textContent).toContain('吸头跨样本带入');
  });
});

describe('App：撤销 / 重做', () => {
  it('删除步骤后可撤销恢复、重做再次删除', async () => {
    await renderApp(); // 默认方案
    const before = rows().length;
    const firstSummary = rows()[0].textContent ?? '';
    expect(firstSummary).toContain('A1');

    await act(async () => {
      (rows()[0].querySelector('button[title="删除步骤"]') as HTMLButtonElement).click();
    });
    expect(rows()).toHaveLength(before - 1);
    expect(rows()[0].textContent).not.toBe(firstSummary);

    await act(async () => {
      buttonByTitle('撤销').click();
    });
    expect(rows()).toHaveLength(before);
    expect(rows()[0].textContent).toBe(firstSummary);

    await act(async () => {
      buttonByTitle('重做').click();
    });
    expect(rows()).toHaveLength(before - 1);

    // 初始状态撤销按钮禁用、重做栈清空后重做按钮禁用
    await act(async () => {
      buttonByTitle('撤销').click();
    });
    expect(buttonByTitle('撤销').disabled).toBe(true);
    await act(async () => {
      buttonByTitle('重做').click();
    });
    expect(buttonByTitle('重做').disabled).toBe(true);
  });
});

describe('App：localStorage 恢复', () => {
  it('刷新后从 localStorage 恢复编辑后的步骤序列（含危险方案的失败状态）', async () => {
    saveSteps(scenarioSteps());
    await renderApp();
    expect(rows()).toHaveLength(4);

    // 删掉第一步，保存副作用把新版本写入 localStorage
    await act(async () => {
      (rows()[0].querySelector('button[title="删除步骤"]') as HTMLButtonElement).click();
    });
    expect(rows()).toHaveLength(3);

    // 模拟刷新：卸载后重新挂载 App，从 localStorage 恢复
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await renderApp();

    expect(rows()).toHaveLength(3);
    // 恢复出的序列第一步已是 transfer A1 → A2（删除前是 dispense A1）
    expect(rows()[0].textContent).toContain('A1 → A2');
    // 复用组与其余步骤一并恢复
    expect(rows()[2].textContent).toContain('混匀 B1');
    expect(container.textContent).toContain('♻ G');
  });

  it('localStorage 数据损坏时回退默认方案，不崩溃', async () => {
    localStorage.setItem('pipette-planner:v1', '{not-json');
    await renderApp();
    expect(rows().length).toBeGreaterThan(0);
    expect(rows()[0].textContent).toContain('A1');
  });
});
