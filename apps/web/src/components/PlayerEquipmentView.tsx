import React, { useState } from 'react';
import { CharacterSheet, InventoryEntry } from '@cyberpgm/shared';
import { ItemDetailPopup } from './ItemDetail.js';

const card: React.CSSProperties = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};
const title: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 700 };
const muted: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--color-text-muted)' };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  padding: '8px 10px',
  backgroundColor: 'var(--color-surface-elevated)',
  border: '1px solid var(--color-border-light)',
  borderRadius: '6px',
  color: 'var(--color-text)',
  fontSize: '0.85rem',
  textAlign: 'left',
  cursor: 'pointer',
};

/** スマホの「装備」タブ（Phase 5g）: 武器・防具・持ち物・サイバーウェア。タップすると性能（効果・フレーバーは出さない） */
export function PlayerEquipmentView({ sheet }: { sheet: CharacterSheet }) {
  const [popup, setPopup] = useState<{ name: string; itemId?: string | null } | null>(null);
  const cyberwareIds = new Set(sheet.cyberware.map((cw) => cw.item_id).filter(Boolean));
  const inventory = sheet.inventory.filter((i) => !(i.item_id && cyberwareIds.has(i.item_id)));
  const weapons = inventory.filter((i) => i.kind === 'weapon');
  const armor = inventory.filter((i) => i.kind === 'armor');
  const others = inventory.filter((i) => i.kind !== 'weapon' && i.kind !== 'armor');
  const textWeapons = (sheet.weapons || []).filter((w): w is string => typeof w === 'string');

  const entryRow = (i: InventoryEntry) => (
    <button key={i.entry_id} type="button" data-testid="player-inventory-item" onClick={() => setPopup({ name: i.name, itemId: i.item_id })} style={rowStyle}>
      <span style={{ fontWeight: 500 }}>
        {i.name}
        {i.equipped && <span style={{ ...muted, marginLeft: '6px' }}>装備中</span>}
        {i.ammo !== undefined && i.ammo !== null && (
          <span data-testid="player-inventory-ammo" style={{ ...muted, marginLeft: '6px' }}>
            弾数: {i.ammo}
          </span>
        )}
      </span>
      <span style={muted}>× {i.qty}</span>
    </button>
  );

  return (
    <div data-testid="player-inventory-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ ...card, flexDirection: 'row', justifyContent: 'space-around', fontSize: '0.9rem' }}>
        <span>
          SP 頭 <strong>{sheet.sp_head}</strong>
        </span>
        <span>
          SP 胴 <strong>{sheet.sp_body}</strong>
        </span>
        <span>
          <strong>{sheet.eb.toLocaleString()}</strong> eb
        </span>
      </div>

      <div data-testid="player-inventory-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={card}>
          <span style={title}>武器</span>
          {weapons.length === 0 && textWeapons.length === 0 && <span style={muted}>なし</span>}
          {weapons.map(entryRow)}
          {textWeapons.map((w, idx) => (
            <button key={`w-${idx}`} type="button" data-testid="player-inventory-item" onClick={() => setPopup({ name: w })} style={rowStyle}>
              <span style={{ fontWeight: 500 }}>{w}</span>
            </button>
          ))}
        </div>
        <div style={card}>
          <span style={title}>防具</span>
          {armor.length === 0 && <span style={muted}>なし</span>}
          {armor.map(entryRow)}
        </div>
        <div style={card}>
          <span style={title}>サイバーウェア</span>
          {sheet.cyberware.length === 0 && <span style={muted}>なし</span>}
          {sheet.cyberware.map((cw, idx) => (
            <button key={`cw-${idx}`} type="button" onClick={() => setPopup({ name: cw.name, itemId: cw.item_id })} style={rowStyle}>
              <span style={{ fontWeight: 500 }}>{cw.name}</span>
              {cw.static_loss != null && <span style={muted}>人間性 −{cw.static_loss}</span>}
            </button>
          ))}
        </div>
        <div style={card}>
          <span style={title}>持ち物</span>
          {others.length === 0 && <span style={muted}>なし</span>}
          {others.map(entryRow)}
        </div>
      </div>
      <span style={muted}>タップすると性能が出ます。</span>
      {popup && <ItemDetailPopup forPlayer name={popup.name} itemId={popup.itemId} onClose={() => setPopup(null)} />}
    </div>
  );
}
