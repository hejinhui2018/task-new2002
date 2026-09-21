import type { TipState } from '../engine';

interface TipResidueProps {
  /** 当前播放帧对应的复用吸头快照（与孔板帧、失败解释同一份状态） */
  tips: Record<string, TipState>;
}

/**
 * 复用吸头残留面板：直接展示仿真帧 tipFrames[k] 的内容。
 * 污染判定（simulator 的 foreignSamples）、失败消息与本面板读的是同一份快照，
 * 因此“面板上说有残留”与“下一步被拦截”不可能不一致。
 */
export function TipResidue({ tips }: TipResidueProps) {
  const groups = Object.entries(tips).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="tip-residue">
      {groups.length === 0 ? (
        <div className="empty-note">当前帧没有携带样本残留的复用吸头。</div>
      ) : (
        groups.map(([group, tip]) => (
          <div className="tip-row" key={group}>
            <span className="tip-chip reuse" title="复用吸头组">
              ♻ {group}
            </span>
            <span className="tip-detail">
              残留样本：
              <b>{tip.residueSamples.length ? tip.residueSamples.join('、') : '—'}</b>
            </span>
            <span className="tip-detail">
              接触来源孔：
              <b>{tip.residueSources.length ? tip.residueSources.join('、') : '—'}</b>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
