import React, { useState } from 'react';
import { CharacterSheet } from '@cyberpgm/shared';
import { gmFetch } from '../api.js';

interface Props {
  combatId: string;
  characters: CharacterSheet[];
  /** すでに参加しているキャラ（PC と NPC は重ねて足さない。モブは何体でも足せる） */
  joinedCharacterIds: string[];
  onClose: () => void;
  onJoined: () => void;
}

const field: React.CSSProperties = {
  padding: '6px',
  backgroundColor: 'var(--color-bg)',
  border: '1px solid var(--color-border-light)',
  borderRadius: '4px',
  color: 'var(--color-text)',
  fontSize: '0.85rem',
};

/**
 * 戦闘中に参加者を足す（Phase 5e）。イニシアチブは、出目を入れた人はその値、空欄はアプリで振る（NPC の自動ロールと同じ）。
 * 足した参加者のコマは「未配置の参加者コマを配置」で盤面に置く。
 */
export function JoinCombatDialog({ combatId, characters, joinedCharacterIds, onClose, onJoined }: Props) {
  const candidates = characters.filter((c) => c.kind === 'mook' || !joinedCharacterIds.includes(c.id));
  const [characterId, setCharacterId] = useState('');
  const [side, setSide] = useState<'ally' | 'enemy'>('enemy');
  const [count, setCount] = useState(1);
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selected = characters.find((c) => c.id === characterId);
  const isMook = selected?.kind === 'mook';
  const firstNum = parseInt(first, 10);

  const submit = async () => {
    if (!selected) return;
    setError(null);
    const rolls = !isNaN(firstNum) && !isMook ? [{ first: firstNum }] : [];
    const res = await gmFetch(`/api/combats/${combatId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: selected.id, side, count: isMook ? count : 1, rolls }),
    }).then((r) => r.json());
    if (res.error) {
      setError(res.error);
      return;
    }
    onJoined();
    onClose();
  };

  return (
    <div
      data-testid="join-combat-dialog"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(420px, 92vw)', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}
      >
        <div style={{ fontWeight: 700 }}>参加者を足す</div>
        <select
          aria-label="足すキャラ"
          value={characterId}
          onChange={(e) => {
            setCharacterId(e.target.value);
            const ch = characters.find((c) => c.id === e.target.value);
            setSide(ch?.kind === 'pc' ? 'ally' : 'enemy');
          }}
          style={field}
        >
          <option value="">キャラを選ぶ</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}（{c.kind === 'pc' ? 'PC' : c.kind === 'npc' ? 'NPC' : 'モブ'}）
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '0.85rem' }}>
          <label>
            <input type="radio" checked={side === 'ally'} onChange={() => setSide('ally')} /> 味方
          </label>
          <label>
            <input type="radio" checked={side === 'enemy'} onChange={() => setSide('enemy')} /> 敵
          </label>
          {isMook && (
            <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              人数
              <input aria-label="人数" type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} style={{ ...field, width: '64px' }} />
            </label>
          )}
        </div>
        {selected && !isMook && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem' }}>
            <span>イニシアチブの出目</span>
            <input aria-label="イニシアチブの出目" type="number" min={1} max={10} value={first} onChange={(e) => setFirst(e.target.value)} placeholder="空欄はアプリで振る" style={{ ...field, width: '140px' }} />
          </div>
        )}
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          足した参加者は行動順に入ります（今の手番の人は変わりません）。盤面があるときは、あとで「未配置の参加者コマを配置」で置きます。取り消しで元に戻せます。
        </div>
        {error && <div style={{ color: 'var(--color-accent)', fontSize: '0.8rem' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button type="button" onClick={onClose} style={{ ...field, cursor: 'pointer' }}>
            やめる
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={submit}
            style={{ ...field, backgroundColor: 'var(--color-ally)', color: '#000', fontWeight: 700, cursor: 'pointer' }}
          >
            足す
          </button>
        </div>
      </div>
    </div>
  );
}
