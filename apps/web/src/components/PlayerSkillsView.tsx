import React, { useMemo, useState } from 'react';
import { CharacterSheet, CharacterStats, SKILL_CATALOG } from '@cyberpgm/shared';
import { DEFAULT_RULES } from '@cyberpgm/rules';

const muted: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--color-text-muted)' };

/**
 * スマホの「技能」タブ（Phase 5g）: 自分の技能の一覧。基本値 = 能力値 + レベル − 負傷のペナルティ。
 * 「持っていない技能も出す」で、レベル 0 の技能（能力値だけで振る）も見られる
 */
export function PlayerSkillsView({ sheet }: { sheet: CharacterSheet }) {
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const learned = sheet.skillsList.map((s) => ({ key: s.key, name: s.name, stat: s.statKey as string, level: s.level, base: s.base }));
    const unlearned = showAll
      ? Object.values(SKILL_CATALOG)
          .filter((s) => !learned.some((l) => l.key === s.key))
          .map((s) => ({
            key: s.key,
            name: s.name,
            stat: s.stat,
            level: 0,
            base: Math.max(0, (sheet.stats[s.stat as keyof CharacterStats] ?? 0) + sheet.woundPenalty),
          }))
      : [];
    const term = q.trim().toLowerCase();
    return [...learned.sort((a, b) => b.base - a.base), ...unlearned.sort((a, b) => b.base - a.base)].filter(
      (s) => !term || s.name.toLowerCase().includes(term) || s.key.includes(term),
    );
  }, [sheet, q, showAll]);

  return (
    <div data-testid="player-skills" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          aria-label="技能を探す"
          placeholder="技能を探す"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border-light)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.9rem' }}
        />
        <label style={{ display: 'flex', gap: '4px', alignItems: 'center', fontSize: '0.8rem' }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          持っていない技能も
        </label>
      </div>
      <div style={muted}>
        基本値 = 能力値 + レベル{sheet.woundPenalty !== 0 ? ` ${sheet.woundPenalty}（負傷）` : ''}。判定は 基本値 + 1d10 で、{DEFAULT_RULES.tieRule === 'success' ? '難易度と同じか上回れば成功' : '難易度を上回れば成功（同じ値は失敗）'}。
      </div>
      <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
        {rows.length === 0 && <div style={{ ...muted, padding: '12px' }}>技能なし</div>}
        {rows.map((s) => (
          <div
            key={s.key}
            data-testid="player-skill-row"
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderBottom: '1px solid var(--color-border-light)', opacity: s.level === 0 ? 0.65 : 1 }}
          >
            <span style={{ flex: 1, fontSize: '0.9rem' }}>{s.name}</span>
            <span style={{ ...muted, width: '42px' }}>{s.stat.toUpperCase()}</span>
            <span style={{ ...muted, width: '36px' }}>Lv.{s.level}</span>
            <strong style={{ width: '28px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-ally)' }}>{s.base}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
