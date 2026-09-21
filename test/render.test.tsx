// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { describe, expect, it, beforeAll } from 'vitest';
import React from 'react';

// App 在渲染期读取 localStorage / matchMedia，node 环境下补桩
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: {
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
    configurable: true,
  });
});

async function renderDefault() {
  const { default: App } = await import('../src/App');
  return renderToString(React.createElement(App));
}

describe('App 整树渲染', () => {
  it('默认方案渲染出 96 孔板、播放控件和 A1→A8 步骤', async () => {
    const html = await renderDefault();
    expect(html).toContain('移液方案预演工具');
    expect(html).toContain('A1');
    expect(html).toContain('H12');
    expect(html).toContain('连续播放');
    expect(html).toContain('单步');
    // 默认步骤摘要
    expect(html).toContain('混匀 A1');
    expect(html).toContain('从 A8 弃去 100 µL');
    // 默认方案无失败
    expect(html).not.toContain('停在第');
    expect(html).toContain('质量守恒账');
  }, 15000);
});
