import React, { useEffect, useState } from 'react';
import { api, PurchaseRequest } from '../api.js';

interface Props {
  /** 商店タブで選んでいる店（「スマホに出す」の対象） */
  currentShop: { id: string; name: string } | null;
  /** WebSocket で申請が来たときに増える */
  refreshKey: number;
  /** 承認でキャラの資金・持ち物が変わったとき */
  onPurchased?: () => void;
}

const button: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: '4px',
  border: '1px solid var(--color-border-light)',
  backgroundColor: 'var(--color-surface-elevated)',
  color: 'var(--color-text)',
  fontSize: '0.8rem',
  cursor: 'pointer',
};

/**
 * GM の商店タブ（Phase 5g）: どの店をプレイヤーのスマホに出すか、と、スマホからの購入申請の承認・見送り
 */
export function PurchaseRequestsPanel({ currentShop, refreshKey, onPurchased }: Props) {
  const [openShop, setOpenShop] = useState<{ id: string; name: string } | null>(null);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [kinds, setKinds] = useState<Record<string, string>>({});
  // サイバーウェアの人間性の減り方（固定値 / 振った値）と、振った値（Phase 5n）
  const [lossRules, setLossRules] = useState<Record<string, { roll: string | null; fixed: number | null }>>({});
  const [lossRolled, setLossRolled] = useState<Record<string, string>>({});
  const [install, setInstall] = useState<Record<string, boolean>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.getPlayerShop(true).then((res) => setOpenShop(res.shop)).catch(() => undefined);
    api
      .getPurchaseRequests()
      .then(async (res) => {
        setRequests(res.requests);
        // サイバーウェアの行には「取り付ける」を出す
        const ids = Array.from(new Set(res.requests.flatMap((r) => r.lines.map((l) => l.item_id))));
        const list = await Promise.all(ids.map((id) => api.getItem(id).catch(() => null)));
        setKinds(Object.fromEntries(list.filter(Boolean).map((it) => [it.id, it.kind])));
        setLossRules(
          Object.fromEntries(
            list
              .filter((it) => it?.cyberware)
              .map((it) => [it.id, { roll: it.cyberware.humanity_loss_roll ?? null, fixed: it.cyberware.humanity_loss_static ?? null }]),
          ),
        );
      })
      .catch(() => undefined);
  };

  useEffect(load, [refreshKey]);

  const toggleOpen = async () => {
    const next = openShop && currentShop && openShop.id === currentShop.id ? null : currentShop?.id ?? null;
    await api.setPlayerShop(next);
    load();
  };

  const approve = async (r: PurchaseRequest) => {
    setError(null);
    try {
      const cw = r.lines
        .filter((l) => kinds[l.item_id] === 'cyberware' && install[`${r.id}:${l.item_id}`])
        .map((l) => {
          // 振った値が入っていればそれ、空なら固定値（作成後は GM が選ぶ。仕様 §5.5）
          const rolled = lossRolled[`${r.id}:${l.item_id}`];
          return rolled && Number(rolled) >= 0 ? { item_id: l.item_id, humanity_loss: Number(rolled) } : { item_id: l.item_id };
        });
      await api.approvePurchaseRequest(r.id, cw.length > 0 ? cw : undefined);
      onPurchased?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    load();
  };

  const reject = async (r: PurchaseRequest) => {
    setError(null);
    await api.rejectPurchaseRequest(r.id, comments[r.id] ?? '').catch((err) => setError(String(err)));
    load();
  };

  const isOpenHere = !!(openShop && currentShop && openShop.id === currentShop.id);

  return (
    <div
      data-testid="purchase-requests-panel"
      style={{ padding: '12px 16px', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
        <span style={{ fontWeight: 700 }}>スマホの商店:</span>
        <span data-testid="player-shop-status">{openShop ? `「${openShop.name}」を出しています` : '出していません'}</span>
        {currentShop ? (
          <button type="button" onClick={toggleOpen} style={{ ...button, borderColor: isOpenHere ? 'var(--color-accent)' : 'var(--color-ally)', color: isOpenHere ? 'var(--color-accent)' : 'var(--color-ally)', fontWeight: 700 }}>
            {isOpenHere ? 'スマホから下げる' : `「${currentShop.name}」をスマホに出す`}
          </button>
        ) : (
          openShop && (
            <button type="button" onClick={toggleOpen} style={{ ...button, color: 'var(--color-accent)' }}>
              スマホから下げる
            </button>
          )
        )}
        {!currentShop && !openShop && <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>店舗を選ぶと、その店の在庫をスマホに出せます</span>}
      </div>

      {requests.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--color-warning)' }}>購入の申請（{requests.length}）</span>
          {requests.map((r) => (
            <div key={r.id} data-testid="purchase-request" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px', border: '1px solid var(--color-border-light)', borderRadius: '6px', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <span>
                  <strong>{r.character_name ?? '—'}</strong>: {r.lines.map((l) => `${l.name} ×${l.qty}（${l.unit_price.toLocaleString()} eb）`).join('、')}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{r.total_eb.toLocaleString()} eb</span>
              </div>
              {r.lines
                .filter((l) => kinds[l.item_id] === 'cyberware')
                .map((l) => (
                  <label key={l.item_id} style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.8rem' }}>
                    <input
                      type="checkbox"
                      checked={!!install[`${r.id}:${l.item_id}`]}
                      onChange={(e) => setInstall((prev) => ({ ...prev, [`${r.id}:${l.item_id}`]: e.target.checked }))}
                    />
                    {l.name} をその場で取り付ける（人間性が減ります）
                    {install[`${r.id}:${l.item_id}`] && (
                      <>
                        <span style={{ color: 'var(--color-text-muted)' }}>
                          固定値 {lossRules[l.item_id]?.fixed ?? '—'}
                          {lossRules[l.item_id]?.roll ? ` / 振るなら ${lossRules[l.item_id]?.roll}:` : ''}
                        </span>
                        {lossRules[l.item_id]?.roll && (
                          <input
                            aria-label={`${l.name} の人間性の出目`}
                            type="number"
                            min={0}
                            placeholder="空欄は固定値"
                            value={lossRolled[`${r.id}:${l.item_id}`] ?? ''}
                            onChange={(e) => setLossRolled((prev) => ({ ...prev, [`${r.id}:${l.item_id}`]: e.target.value }))}
                            style={{ ...button, width: '110px', backgroundColor: 'var(--color-bg)', cursor: 'text' }}
                          />
                        )}
                      </>
                    )}
                  </label>
                ))}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => approve(r)} style={{ ...button, backgroundColor: 'var(--color-ally)', color: '#000', fontWeight: 700, border: 'none' }}>
                  承認して売る
                </button>
                <input
                  aria-label="見送りのひとこと"
                  placeholder="見送りのひとこと（なくてもよい）"
                  value={comments[r.id] ?? ''}
                  onChange={(e) => setComments((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  style={{ ...button, flex: 1, minWidth: '160px', backgroundColor: 'var(--color-bg)', cursor: 'text' }}
                />
                <button type="button" onClick={() => reject(r)} style={{ ...button, color: 'var(--color-accent)' }}>
                  見送る
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <div style={{ color: 'var(--color-accent)', fontSize: '0.8rem' }}>{error}</div>}
    </div>
  );
}
