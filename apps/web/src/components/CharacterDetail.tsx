import React, { useState } from 'react';
import { CharacterSheet } from '@cyberpgm/shared';
import { ItemDetailPopup } from './ItemDetail.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '0.75rem' };
const rowButton: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '8px',
  width: '100%',
  padding: '3px 6px',
  background: 'var(--color-surface-elevated)',
  border: '1px solid var(--color-border-light)',
  borderRadius: '3px',
  color: 'var(--color-text)',
  fontSize: '0.75rem',
  cursor: 'pointer',
  textAlign: 'left',
};

/**
 * PC タブのカードの詳細（Phase 5f）: 能力値・技能・SP・武器・防具・サイバーウェア・持ち物。
 * 品目をクリックすると性能・効果・フレーバーの窓を出す（戦闘カードと同じ窓）。
 */
export function CharacterDetail({ character: c }: { character: CharacterSheet }) {
  const [popup, setPopup] = useState<{ name: string; itemId?: string | null } | null>(null);
  // プレイヤーのキャラ作成で入ったサイバーウェアは持ち物にも入っているので、持ち物の側では出さない
  const cyberwareIds = new Set(c.cyberware.map((cw) => cw.item_id).filter(Boolean));
  const inventory = (c.inventory || []).filter((i) => !(i.item_id && cyberwareIds.has(i.item_id)));
  const textWeapons = (c.weapons || []).filter((w): w is string => typeof w === 'string');
  const skills = [...(c.skillsList || [])].sort((a, b) => b.base - a.base);

  const itemRow = (key: string, label: string, itemId?: string | null, extra?: string) => (
    <button key={key} type="button" data-testid="pc-detail-item" onClick={() => setPopup({ name: label, itemId })} style={rowButton}>
      <span>{label}</span>
      {extra && <span style={{ color: 'var(--color-text-muted)' }}>{extra}</span>}
    </button>
  );

  return (
    <div data-testid="pc-detail" style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontFamily: 'var(--font-mono)' }}>
        {Object.entries(c.stats || {}).map(([k, v]) => (
          <span key={k}>
            {k.toUpperCase()} {v}
          </span>
        ))}
      </div>
      <div>
        SP 頭 {c.sp_head} / 胴 {c.sp_body}
      </div>
      <div style={muted}>技能（基本値）</div>
      {skills.length === 0 ? (
        <span>—</span>
      ) : (
        <div style={{ color: 'var(--color-text-muted)' }}>{skills.map((s) => `${s.name} ${s.base}`).join(' / ')}</div>
      )}
      <div style={muted}>武器・防具・持ち物</div>
      {inventory.length === 0 && textWeapons.length === 0 && <span>—</span>}
      {inventory.map((i) =>
        itemRow(i.entry_id, i.name, i.item_id, [i.equipped ? '装備中' : '', i.qty > 1 ? `×${i.qty}` : ''].filter(Boolean).join(' ') || undefined),
      )}
      {textWeapons.map((w, idx) => itemRow(`w-${idx}`, w, null, '名前だけ'))}
      <div style={muted}>サイバーウェア</div>
      {c.cyberware.length === 0 && <span>—</span>}
      {c.cyberware.map((cw, idx) => itemRow(`cw-${idx}`, cw.name, cw.item_id, cw.static_loss != null ? `人間性 −${cw.static_loss}` : undefined))}
      {popup && <ItemDetailPopup name={popup.name} itemId={popup.itemId} onClose={() => setPopup(null)} />}
    </div>
  );
}
