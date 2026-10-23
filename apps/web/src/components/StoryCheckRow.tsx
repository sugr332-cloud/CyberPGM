import React, { useState } from 'react';
import { CharacterSheet } from '@cyberpgm/shared';
import { SkillSelect } from './SkillSelect.js';

// 難易度目安（DV値）: イージー・モード p.15（Issue #3）
export const DV_GUIDE = [
  { label: '日常的', dv: 13 },
  { label: '困難', dv: 15 },
  { label: '専門的', dv: 17 },
  { label: '英雄的', dv: 21 },
  { label: '非現実的', dv: 24 },
];

export interface StoryCheckView {
  id: string;
  actor_character_id: string;
  skill_key: string | null;
  dv: number | null;
  opposed: { target_character_id: string; skill_key?: string; rolls?: number[] } | null;
  rolls: number[];
  result: 'success' | 'failure' | null;
  applied_log_id: string | null;
  action_label: string | null;
  choice_label: string | null;
  evaluation: { result: string | null; formula: string; needed: string | null; missing_inputs: string[] };
  preview: string[];
}

interface Props {
  check: StoryCheckView;
  characters: CharacterSheet[];
  onPatch: (body: Record<string, unknown>) => void;
  onRoll: (rolls: number[], opposedRolls?: number[], luckSpent?: number) => void;
  onApply: () => void;
  onUndo: () => void;
}

const inputStyle: React.CSSProperties = {
  padding: '4px 6px',
  backgroundColor: 'var(--color-bg)',
  border: '1px solid var(--color-border-light)',
  borderRadius: '3px',
  color: 'var(--color-text)',
  fontSize: '0.8rem',
};

const smallButton = (bg: string, fg: string): React.CSSProperties => ({
  padding: '3px 8px',
  backgroundColor: bg,
  border: 'none',
  borderRadius: '3px',
  fontSize: '0.75rem',
  color: fg,
  fontWeight: 700,
  cursor: 'pointer',
});

/** 判定ボードの 1 行（GM のみ）。誰が・何を・能力値 + 技能・難易度・出目・合計・結果と、反映する内容 */
export function StoryCheckRow({ check, characters, onPatch, onRoll, onApply, onUndo }: Props) {
  const actor = characters.find((c) => c.id === check.actor_character_id);
  const [first, setFirst] = useState('');
  const [extra, setExtra] = useState('');
  const [theirFirst, setTheirFirst] = useState('');
  const [theirExtra, setTheirExtra] = useState('');
  // 使う【運命】点（Phase 5v。p.130）
  const [luck, setLuck] = useState('');
  const applied = !!check.applied_log_id;
  const firstNum = parseInt(first, 10);
  const needsExtra = firstNum === 10 || firstNum === 1;
  const theirFirstNum = parseInt(theirFirst, 10);
  const theirNeedsExtra = theirFirstNum === 10 || theirFirstNum === 1;

  const sendRolls = () => {
    if (isNaN(firstNum)) return;
    const mine = needsExtra && extra ? [firstNum, parseInt(extra, 10)] : [firstNum];
    const theirs =
      check.opposed && !isNaN(theirFirstNum)
        ? theirNeedsExtra && theirExtra
          ? [theirFirstNum, parseInt(theirExtra, 10)]
          : [theirFirstNum]
        : undefined;
    onRoll(mine, theirs, Number(luck) || undefined);
  };

  return (
    <div
      data-testid={`story-check-${check.id}`}
      style={{
        padding: '8px',
        backgroundColor: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-border-light)',
        borderRadius: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>
          {actor?.name || '—'}
          <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '6px' }}>
            {check.choice_label || check.action_label || 'GM が追加した判定'}
          </span>
        </span>
        {check.result && (
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '3px',
              backgroundColor: check.result === 'success' ? 'rgba(46, 204, 113, 0.2)' : 'rgba(235, 75, 75, 0.2)',
              color: check.result === 'success' ? 'var(--color-success)' : 'var(--color-accent)',
            }}
          >
            {check.result === 'success' ? '成功' : '失敗'}
          </span>
        )}
      </div>

      {!applied && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          <SkillSelect value={check.skill_key ?? ''} onChange={(value) => onPatch({ skill_key: value || null })} characters={characters} />
          {!check.opposed && (
            <>
              <input
                aria-label="難易度"
                type="number"
                placeholder="難易度"
                value={check.dv ?? ''}
                onChange={(e) => onPatch({ dv: e.target.value === '' ? null : Number(e.target.value) })}
                style={{ ...inputStyle, width: '64px' }}
              />
              {DV_GUIDE.map((g) => (
                <button key={g.dv} type="button" onClick={() => onPatch({ dv: g.dv })} style={smallButton('var(--color-surface)', 'var(--color-text-muted)')}>
                  {g.label} {g.dv}
                </button>
              ))}
            </>
          )}
          <select
            aria-label="対抗の相手"
            value={check.opposed?.target_character_id ?? ''}
            onChange={(e) =>
              onPatch({ opposed: e.target.value ? { target_character_id: e.target.value, skill_key: check.opposed?.skill_key } : null })
            }
            style={inputStyle}
          >
            <option value="">対抗なし（難易度と比べる）</option>
            {characters
              .filter((c) => c.id !== check.actor_character_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  対抗: {c.name}
                </option>
              ))}
          </select>
          {check.opposed && (
            <SkillSelect label="相手の技能" value={check.opposed.skill_key ?? ''} onChange={(value) => onPatch({ opposed: { ...check.opposed, skill_key: value || undefined } })} characters={characters} />
          )}
        </div>
      )}

      <div style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>{check.evaluation.formula}</div>
      {check.evaluation.missing_inputs.length > 0 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-warning)' }}>{check.evaluation.missing_inputs.join(' / ')}</div>
      )}

      {!check.result && !applied && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {actor?.name ?? ''}の出目（スマホから届くか、ここに入れる）
          </span>
          <input aria-label="出目" type="number" min={1} max={10} value={first} onChange={(e) => setFirst(e.target.value)} style={{ ...inputStyle, width: '52px' }} />
          {needsExtra && (
            <input aria-label="追加の出目" type="number" min={1} max={10} placeholder="追加" value={extra} onChange={(e) => setExtra(e.target.value)} style={{ ...inputStyle, width: '52px' }} />
          )}
          {(() => {
            const left = actor ? Math.max(0, (actor.stats?.luck ?? 0) - Number((actor as { extra?: { luck_used?: number } }).extra?.luck_used ?? 0)) : 0;
            return (check as { luck?: number }).luck ? (
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>運命 +{(check as { luck?: number }).luck}</span>
            ) : left > 0 ? (
              <input aria-label="使う運命点" type="number" min={0} max={left} placeholder={`運命（残${left}）`} value={luck} onChange={(e) => setLuck(e.target.value)} style={{ ...inputStyle, width: '84px' }} />
            ) : null;
          })()}
          {check.opposed && (
            <>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>相手の出目</span>
              <input aria-label="相手の出目" type="number" min={1} max={10} value={theirFirst} onChange={(e) => setTheirFirst(e.target.value)} style={{ ...inputStyle, width: '52px' }} />
              {theirNeedsExtra && (
                <input aria-label="相手の追加の出目" type="number" min={1} max={10} placeholder="追加" value={theirExtra} onChange={(e) => setTheirExtra(e.target.value)} style={{ ...inputStyle, width: '52px' }} />
              )}
            </>
          )}
          <button type="button" onClick={sendRolls} style={smallButton('var(--color-ally)', '#000')}>
            判定
          </button>
        </div>
      )}

      {check.result && check.preview.length > 0 && (
        <div style={{ fontSize: '0.75rem', borderLeft: '2px solid var(--color-border-light)', paddingLeft: '6px' }}>
          <div style={{ color: 'var(--color-text-muted)' }}>反映する内容</div>
          {check.preview.map((p, i) => (
            <div key={i}>{p}</div>
          ))}
        </div>
      )}

      {check.result && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
          {applied ? (
            <button type="button" onClick={onUndo} style={smallButton('rgba(235, 75, 75, 0.2)', 'var(--color-accent)')}>
              取り消す
            </button>
          ) : (
            <button type="button" onClick={onApply} style={smallButton('var(--color-ally)', '#000')}>
              確定して反映
            </button>
          )}
        </div>
      )}
    </div>
  );
}
