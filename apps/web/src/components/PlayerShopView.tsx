import React, { useEffect, useState } from 'react';
import { api, PlayerShopStock, PurchaseRequest } from '../api.js';
import { ITEM_KIND_LABELS, ItemSpecs, itemDisplayName, itemSpecLine } from './ItemDetail.js';

interface Props {
  eb: number;
  /** WebSocket で店や申請が変わったときに増える（読み直す） */
  refreshKey: number;
}

const card: React.CSSProperties = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};
const muted: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--color-text-muted)' };
const button: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid var(--color-border-light)',
  backgroundColor: 'var(--color-surface-elevated)',
  color: 'var(--color-text)',
  fontSize: '0.85rem',
  cursor: 'pointer',
};
const STATUS_LABELS: Record<PurchaseRequest['status'], string> = { pending: 'GM の確認待ち', approved: '買えました', rejected: '見送り' };

/**
 * スマホの「商店」タブ（Phase 5g）: GM が出した店の在庫を見て、買いたい物を GM に申請する。
 * 申請しただけではお金も持ち物も変わらない（GM が承認すると購入になる）
 */
export function PlayerShopView({ eb, refreshKey }: Props) {
  const [shop, setShop] = useState<{ id: string; name: string } | null>(null);
  const [stock, setStock] = useState<PlayerShopStock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api
      .getPlayerShop()
      .then((res) => {
        setShop(res.shop);
        setStock(res.stock);
        // 店が変わったら、もうない品目をカートから外す
        setCart((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => res.stock.some((s) => s.item_id === id))));
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
    api
      .getMyPurchaseRequests()
      .then((res) => setRequests(res.requests))
      .catch(() => undefined);
  }, [refreshKey]);

  const kinds = Array.from(new Set(stock.map((s) => s.item.kind as string)));
  const shown = stock.filter((s) => !kind || s.item.kind === kind);
  const cartLines = stock.filter((s) => cart[s.item_id]).map((s) => ({ ...s, qty: cart[s.item_id] }));
  const total = cartLines.reduce((sum, l) => sum + (l.unit_price ?? 0) * l.qty, 0);

  const setQty = (itemId: string, qty: number) =>
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[itemId];
      else next[itemId] = qty;
      return next;
    });

  const send = async () => {
    setSending(true);
    setMessage(null);
    try {
      await api.createPurchaseRequest(cartLines.map((l) => ({ item_id: l.item_id, qty: l.qty })));
      setCart({});
      setMessage('GM に申請しました。GM が承認すると、お金と持ち物に反映されます。');
      setRequests((await api.getMyPurchaseRequests()).requests);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  if (loaded && !shop) {
    return (
      <div data-testid="player-shop" style={{ padding: '16px' }}>
        <div style={{ ...card, alignItems: 'center', padding: '28px 14px' }}>
          <span style={{ fontWeight: 700 }}>今は店が開いていません</span>
          <span style={muted}>GM が店を開くと、ここに品物が出ます。</span>
        </div>
        <MyRequests requests={requests} />
      </div>
    );
  }

  return (
    <div data-testid="player-shop" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>{shop?.name ?? ''}</span>
        <span style={muted}>所持金 {eb.toLocaleString()} eb</span>
      </div>
      {kinds.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto' }}>
          {['', ...kinds].map((k) => (
            <button
              key={k || 'all'}
              type="button"
              onClick={() => setKind(k)}
              style={{ ...button, padding: '4px 10px', whiteSpace: 'nowrap', borderColor: kind === k ? 'var(--color-ally)' : 'var(--color-border-light)', color: kind === k ? 'var(--color-ally)' : 'var(--color-text)' }}
            >
              {k ? ITEM_KIND_LABELS[k] ?? k : 'すべて'}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {shown.length === 0 && <span style={muted}>品物がありません</span>}
        {shown.map((s) => {
          const open = openId === s.item_id;
          const soldOut = s.quantity !== null && s.quantity <= 0;
          return (
            <div key={s.item_id} data-testid="player-shop-item" style={{ ...card, padding: '10px 12px', gap: '6px', opacity: soldOut ? 0.5 : 1 }}>
              <button type="button" onClick={() => setOpenId(open ? null : s.item_id)} style={{ background: 'none', border: 'none', color: 'var(--color-text)', padding: 0, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', width: '100%' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{itemDisplayName(s.item)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-warning)' }}>{s.unit_price === null ? '—' : `${s.unit_price.toLocaleString()} eb`}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', width: '100%' }}>
                  <span style={muted}>{itemSpecLine(s.item)}</span>
                  <span style={muted}>{s.quantity === null ? '' : soldOut ? '品切れ' : `在庫 ${s.quantity}`}</span>
                </div>
              </button>
              {open && (
                <>
                  <ItemSpecs item={s.item} forPlayer />
                  {s.unit_price === null ? (
                    <span style={muted}>値段が決まっていません（GM に相談してください）</span>
                  ) : (
                    !soldOut && (
                      <button type="button" onClick={() => setQty(s.item_id, (cart[s.item_id] ?? 0) + 1)} style={{ ...button, backgroundColor: 'var(--color-ally)', color: '#000', fontWeight: 700, border: 'none' }}>
                        カートに入れる
                      </button>
                    )
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {cartLines.length > 0 && (
        <div data-testid="player-cart" style={{ ...card, borderColor: 'var(--color-ally)' }}>
          <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>カート</span>
          {cartLines.map((l) => (
            <div key={l.item_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
              <span style={{ flex: 1 }}>{itemDisplayName(l.item)}</span>
              <button type="button" aria-label={`${itemDisplayName(l.item)} を減らす`} onClick={() => setQty(l.item_id, l.qty - 1)} style={{ ...button, padding: '2px 10px' }}>
                −
              </button>
              <span>{l.qty}</span>
              <button
                type="button"
                aria-label={`${itemDisplayName(l.item)} を増やす`}
                disabled={l.quantity !== null && l.qty >= l.quantity}
                onClick={() => setQty(l.item_id, l.qty + 1)}
                style={{ ...button, padding: '2px 10px' }}
              >
                ＋
              </button>
              <span style={{ width: '80px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{((l.unit_price ?? 0) * l.qty).toLocaleString()} eb</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>合計</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: total > eb ? 'var(--color-accent)' : 'var(--color-text)' }}>{total.toLocaleString()} eb</span>
          </div>
          {total > eb && <span style={{ ...muted, color: 'var(--color-accent)' }}>所持金が足りません</span>}
          <button
            type="button"
            disabled={sending || total > eb}
            onClick={send}
            style={{ ...button, backgroundColor: total > eb ? 'var(--color-surface-elevated)' : 'var(--color-ally)', color: total > eb ? 'var(--color-text-muted)' : '#000', fontWeight: 700, border: 'none' }}
          >
            GM に購入を申請する
          </button>
          <span style={muted}>申請しただけではお金は減りません。GM が承認すると購入になります。</span>
        </div>
      )}
      {message && <div style={{ fontSize: '0.85rem' }}>{message}</div>}
      <MyRequests requests={requests} />
    </div>
  );
}

function MyRequests({ requests }: { requests: PurchaseRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <div style={{ ...card, marginTop: '12px' }} data-testid="player-purchase-requests">
      <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>申請したもの</span>
      {requests.map((r) => (
        <div key={r.id} data-testid="player-purchase-request" style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.8rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
            <span>{r.lines.map((l) => `${l.name} ×${l.qty}`).join('、')}</span>
            <span
              style={{
                whiteSpace: 'nowrap',
                fontWeight: 700,
                color: r.status === 'approved' ? 'var(--color-success)' : r.status === 'rejected' ? 'var(--color-accent)' : 'var(--color-warning)',
              }}
            >
              {STATUS_LABELS[r.status]}
            </span>
          </div>
          <span style={muted}>
            {r.total_eb.toLocaleString()} eb{r.comment ? ` — GM: ${r.comment}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
