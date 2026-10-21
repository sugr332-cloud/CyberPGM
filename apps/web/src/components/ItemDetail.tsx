import React, { useEffect, useState } from 'react';
import { formatWeaponType, formatWeaponMagazineAndAmmo } from '@cyberpgm/shared';
import { api } from '../api.js';
import { ItemNotes } from './ItemNotes.js';

export const ITEM_KIND_LABELS: Record<string, string> = {
  weapon: '武器',
  armor: '防具',
  cyberware: 'サイバーウェア',
  cyberdeck: 'サイバーデッキ',
  gear: 'ギア',
  clothing: '衣服',
  ammo: '弾薬',
  upgrade: '改造パーツ',
  program: 'プログラム',
  vehicle: '乗り物',
  drug: 'ドラッグ',
};

export function itemDisplayName(item: any): string {
  return item?.name_ja_override || item?.name_ja || item?.name_en || '';
}

/** 一覧に出す 1 行の性能（ない値は「—」） */
export function itemSpecLine(item: any): string {
  if (item.weapon) return `${item.weapon.damage ?? '—'} · ROF ${item.weapon.rof ?? '—'} · 装弾数 ${item.weapon.magazine_max ?? '—'}`;
  if (item.armor) {
    return item.armor.is_shield ? `シールド HP ${item.armor.shield_hp ?? '—'}` : `SP 頭 ${item.armor.sp_head ?? '—'} / 胴 ${item.armor.sp_body ?? '—'}`;
  }
  if (item.cyberware) return `人間性 −${item.cyberware.humanity_loss_static ?? '—'}（${item.cyberware.humanity_loss_roll ?? '—'}）`;
  return `${item.price_eb ?? '—'} eb`;
}

const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '8px' };
const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

/** 品目の性能・価格・効果・フレーバー（GM のみ。キャラ作成・PC の詳細・戦闘カードで使う。Phase 5f） */
export function ItemSpecs({ item }: { item: any }) {
  return (
    <div data-testid="item-specs" style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem' }}>
      <div style={row}>
        <span style={muted}>種類</span>
        <span>{ITEM_KIND_LABELS[item.kind] ?? item.kind}</span>
      </div>
      <div style={row}>
        <span style={muted}>価格</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>{item.price_eb != null ? `${Number(item.price_eb).toLocaleString()} eb` : '—'}</span>
      </div>
      {item.weapon && (
        <>
          <div style={row}>
            <span style={muted}>武器種別</span>
            <span>{formatWeaponType(item.weapon.weapon_type)}</span>
          </div>
          <div style={row}>
            <span style={muted}>ダメージ / ROF</span>
            <span>
              {item.weapon.damage || '—'} / ROF {item.weapon.rof ?? '—'}
            </span>
          </div>
          <div style={row}>
            <span style={muted}>装弾数 / 弾薬</span>
            <span>{formatWeaponMagazineAndAmmo(item.weapon.magazine_max, item.weapon.ammo_types)}</span>
          </div>
          <div style={row}>
            <span style={muted}>隠匿 / 両手</span>
            <span>
              {item.weapon.concealable == null ? '—' : item.weapon.concealable ? '隠匿可' : '不可'} · {item.weapon.hands ?? '—'}手
            </span>
          </div>
        </>
      )}
      {item.armor && (
        <div style={row}>
          <span style={muted}>SP</span>
          <span>{item.armor.is_shield ? `シールド HP ${item.armor.shield_hp ?? '—'}` : `頭 ${item.armor.sp_head ?? '—'} / 胴 ${item.armor.sp_body ?? '—'}`}</span>
        </div>
      )}
      {item.armor && (
        <div style={row}>
          <span style={muted}>防具ペナルティ</span>
          <span>{item.armor.penalty ?? '—'}</span>
        </div>
      )}
      {item.cyberware && (
        <>
          <div style={row}>
            <span style={muted}>人間性の減少</span>
            <span>
              {item.cyberware.humanity_loss_static ?? '—'}
              {item.cyberware.humanity_loss_roll ? `（${item.cyberware.humanity_loss_roll}）` : ''}
            </span>
          </div>
          <div style={row}>
            <span style={muted}>部位 / 枠</span>
            <span>
              {item.cyberware.install_location || '—'} / {item.cyberware.slot_size ?? '—'}
            </span>
          </div>
        </>
      )}
      {item.summary_ja && <div style={{ ...muted, whiteSpace: 'pre-wrap' }}>{item.summary_ja}</div>}
      <ItemNotes item={item} />
    </div>
  );
}

interface PopupProps {
  name: string;
  itemId?: string | null;
  onClose: () => void;
}

/** 品目の窓。品目 ID のない持ち物（手入力の名前だけ）は「品目の情報なし」 */
export function ItemDetailPopup({ name, itemId, onClose }: PopupProps) {
  const [item, setItem] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setItem(null);
    setLoading(true);
    // 品目 ID のない持ち物（名前だけの武器など）は、名前がぴったり同じ品目を探す
    const load = itemId
      ? api.getItem(itemId)
      : api.getItems({ q: name, limit: 50 }).then((res) => {
          const found = res.items.find((i) => [i.name_ja_override, i.name_ja, i.name_en].includes(name));
          return found ? api.getItem(found.id) : null;
        });
    load
      .then((res) => active && setItem(res))
      .catch(() => undefined)
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [itemId, name]);

  return (
    <div
      data-testid="item-popup"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(420px, 92vw)',
          maxHeight: '86vh',
          overflowY: 'auto',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700 }}>{item ? itemDisplayName(item) : name}</span>
          <button type="button" aria-label="閉じる" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
            ✕
          </button>
        </div>
        {item ? (
          <>
            <div style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>{itemSpecLine(item)}</div>
            <ItemSpecs item={item} />
          </>
        ) : (
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{loading ? '読み込み中…' : itemId ? '品目の情報なし' : '品目と結び付いていない名前だけの持ち物です（キャラ作成タブの「品目から探す」で結び付けられます）'}</div>
        )}
      </div>
    </div>
  );
}
