import React, { useEffect, useRef, useState } from 'react';
import type { Shop } from '@cyberpgm/shared';
import { api, getGmToken } from '../api.js';
import { itemDisplayName } from './ItemDetail.js';
import './shop-stock-editor.css';

type CatalogItem = { id: string; kind: string; name_en: string; name_ja?: string | null; name_ja_override?: string | null; price_eb: number | null; image_id?: string | null };
type StockRow = { item_id: string; quantity: number | null; item: CatalogItem };
const categories = [
  ['weapon', '武器'], ['armor', '防具'], ['ammo', '弾薬'], ['cyberware', 'サイバーウェア'],
  ['vehicle', '車両'], ['gear', '装備'], ['clothing', '服'], ['drug', 'ドラッグ'],
  ['program', 'プログラム'], ['cyberdeck', 'サイバーデッキ'], ['upgrade', '改造'],
];
const dragType = 'application/x-cyberpgm-shop-item';
const pageSize = 40;

export function ShopStockEditor({ shop, onClose, onChanged }: { shop: Shop; onClose: () => void; onChanged: () => void }) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.getItems({ q: query, kind, limit: pageSize, offset, sort: 'name_asc' })
      .then((res) => { if (current) { setCatalog(res.items); setTotal(res.total); } })
      .catch((err: Error) => { if (current) setError(err.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [query, kind, offset]);

  useEffect(() => {
    let current = true;
    api.getShopStock(shop.id).then((res) => { if (current) setStock(res.stock); }).catch((err: Error) => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [shop.id]);

  const changeStock = async (id: string, quantity: number | null, remove = false) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      if (remove) await api.deleteShopStock(shop.id, id);
      else await api.setShopStock(shop.id, id, quantity);
      const updated = await api.getShopStock(shop.id);
      if (active.current) { setStock(updated.stock); onChanged(); }
    } catch (err) {
      if (active.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };
  const add = (id: string) => { if (!stock.some((r) => r.item_id === id)) void changeStock(id, null); };
  const startDrag = (e: React.DragEvent, id: string, source: 'catalog' | 'stock') => {
    e.dataTransfer.setData(dragType, JSON.stringify({ id, source, shopId: shop.id }));
    e.dataTransfer.effectAllowed = 'copyMove';
  };
  const drop = (e: React.DragEvent, destination: 'catalog' | 'stock') => {
    e.preventDefault();
    if (busy) return;
    try {
      const data = JSON.parse(e.dataTransfer.getData(dragType));
      if (data.shopId !== shop.id) return;
      if (destination === 'stock' && data.source === 'catalog' && catalog.some((i) => i.id === data.id)) add(data.id);
      if (destination === 'catalog' && data.source === 'stock' && stock.some((r) => r.item_id === data.id)) void changeStock(data.id, null, true);
    } catch { /* この画面以外のドラッグは扱わない */ }
  };
  const allowDrop = (e: React.DragEvent) => { if (e.dataTransfer.types.includes(dragType)) e.preventDefault(); };
  const price = (item: CatalogItem) => item.price_eb === null ? '価格不明' : `${Math.floor(item.price_eb * shop.price_multiplier).toLocaleString()} eb`;

  return <section className="shop-stock-editor" data-testid="shop-stock-editor" aria-label="品揃えを編集">
    <div className="stock-editor-heading"><div><h2>{shop.name} / 品揃えを編集</h2><p>カタログから品揃えへドラッグ、または「＋ 追加」。変更はすぐ保存されます。</p></div><button type="button" onClick={onClose} disabled={busy}>編集を終える</button></div>
    {error && <p role="alert">{error}</p>}
    <div className="stock-editor-columns">
      <section data-testid="stock-catalog" className="stock-editor-panel" aria-label="全品目カタログ" onDragOver={allowDrop} onDrop={(e) => drop(e, 'catalog')}>
        <h3>全品目カタログ</h3><p>品揃えの品をここに戻すと外れます。</p>
        <input aria-label="品揃えのカタログを検索" placeholder="品名を検索（日／英）" value={query} onChange={(e) => { setQuery(e.target.value); setOffset(0); }} />
        <select aria-label="品揃えのカタログ分類" value={kind} onChange={(e) => { setKind(e.target.value); setOffset(0); }}><option value="">すべての分類</option>{categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <p role="status">{loading ? '読み込み中…' : `${total} 件`}</p>
        <div className="stock-editor-items">
          {catalog.map((item) => {
            const added = stock.some((r) => r.item_id === item.id);
            return <article key={item.id} data-testid={`stock-catalog-${item.id}`} className="stock-editor-item" draggable={!busy && !added} onDragStart={(e) => startDrag(e, item.id, 'catalog')}>
              {item.image_id ? <img draggable={false} src={`/api/images/${item.image_id}?t=${encodeURIComponent(getGmToken() ?? '')}`} alt="" /> : <div className="stock-image-placeholder">—</div>}
              <div><strong>{itemDisplayName(item)}</strong><span>{price(item)}</span></div>
              <button type="button" disabled={busy || added} onClick={() => add(item.id)}>{added ? '追加済み ✓' : '＋ 追加'}</button>
            </article>;
          })}
        </div>
        <div className="stock-editor-pagination"><button type="button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))}>前へ</button><span>{total ? offset + 1 : 0}〜{Math.min(offset + pageSize, total)} / {total}</span><button type="button" disabled={offset + pageSize >= total || loading} onClick={() => setOffset(offset + pageSize)}>次へ</button></div>
      </section>
      <section data-testid="stock-drop-zone" className="stock-editor-panel stock-editor-destination" aria-label="この商店の品揃え" onDragOver={allowDrop} onDrop={(e) => drop(e, 'stock')}>
        <h3>品揃え <small>{stock.length} 品</small></h3>
        {stock.length === 0 && <p>ここにドラッグして品揃えを作ります。</p>}
        <div className="stock-editor-items">
          {stock.map((row) => <article key={row.item_id} data-testid={`stock-row-${row.item_id}`} className="stock-editor-item stock-row" draggable={!busy} onDragStart={(e) => startDrag(e, row.item_id, 'stock')}>
            <div><strong>{itemDisplayName(row.item)}</strong><span>{price(row.item)}</span></div>
            <button type="button" aria-label={`${itemDisplayName(row.item)}を品揃えから外す`} disabled={busy} onClick={() => void changeStock(row.item_id, null, true)}>×</button>
            <label>在庫<select aria-label={`${itemDisplayName(row.item)}の在庫方式`} disabled={busy} value={row.quantity === null ? 'unlimited' : 'number'} onChange={(e) => void changeStock(row.item_id, e.target.value === 'unlimited' ? null : 1)}><option value="unlimited">無制限</option><option value="number">数を指定</option></select></label>
            {row.quantity !== null && <input key={`${row.item_id}-${row.quantity}`} aria-label={`${itemDisplayName(row.item)}の在庫数`} type="number" min={0} step={1} disabled={busy} defaultValue={row.quantity} onBlur={(e) => {
              const value = Number(e.currentTarget.value);
              if (e.currentTarget.value !== '' && Number.isInteger(value) && value >= 0) { if (value !== row.quantity) void changeStock(row.item_id, value); }
              else { e.currentTarget.value = String(row.quantity); setError('在庫数は0以上の整数を入力してください'); }
            }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />}
          </article>)}
        </div>
        {busy && <p role="status">保存中…</p>}
      </section>
    </div>
  </section>;
}
