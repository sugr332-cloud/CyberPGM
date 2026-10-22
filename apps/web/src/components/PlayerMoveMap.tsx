import React, { useEffect, useMemo, useState } from 'react';
import { findReachableSquares } from '@cyberpgm/rules';
import { api } from '../api.js';
import { BoardView } from './BoardView.js';

type MapData = Awaited<ReturnType<typeof api.getPlayerCombatMap>>;

export interface PlayerMoveResult {
  ok: boolean;
  error?: string;
  destination?: { x: number; y: number };
}

/**
 * スマホで「移動」「走る」を押したときのマップ（Phase 6a）。
 * 自分のコマを緑のマスへドラッグ（またはマスをタップ）すると、移動先を GM に送る。確定は GM の「移動を確定」
 */
export const PlayerMoveMap: React.FC<{
  token: string;
  actionKey: 'move' | 'run';
  refreshKey: unknown;
  result: PlayerMoveResult | null;
  onSend: (dest: { x: number; y: number }) => void;
  onClose: () => void;
}> = ({ token, actionKey, refreshKey, result, onSend, onClose }) => {
  const [data, setData] = useState<MapData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getPlayerCombatMap(token)
      .then((res) => {
        if (alive) {
          setData(res);
          setLoadError(null);
        }
      })
      .catch((err: Error) => {
        if (alive) setLoadError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [token, refreshKey]);

  const board = data?.board ?? null;
  const myToken = board?.tokens?.find((t: { id: string }) => t.id === data?.my_token_id);

  // 移動できるマス（GM 画面と同じ数え方。最終的にはサーバーが確かめる）
  const reachableCells = useMemo(() => {
    if (!board || !myToken || !data?.max_moves) return undefined;
    const blocked = new Set<string>();
    for (const obj of board.objects ?? []) {
      if (obj.passable) continue;
      for (let dx = 0; dx < (obj.w || 1); dx++) {
        for (let dy = 0; dy < (obj.h || 1); dy++) blocked.add(`${obj.x + dx},${obj.y + dy}`);
      }
    }
    const occupied = new Set<string>(
      (board.tokens ?? []).filter((t: { id: string }) => t.id !== myToken.id).map((t: { x: number; y: number }) => `${t.x},${t.y}`),
    );
    const cells = findReachableSquares({
      start: { x: myToken.x, y: myToken.y },
      maxSquares: data.max_moves,
      isPassable: (pt) => !blocked.has(`${pt.x},${pt.y}`),
      canStop: (pt) => !occupied.has(`${pt.x},${pt.y}`),
      bounds: { cols: board.grid?.cols || 20, rows: board.grid?.rows || 15 },
      diagonalRule: data.diagonal_rule || 'chebyshev',
    });
    return new Set(cells.map((pt) => `${pt.x},${pt.y}`));
  }, [board, myToken, data?.max_moves, data?.diagonal_rule]);

  const choose = (dest: { x: number; y: number }) => {
    setSent(dest);
    onSend(dest);
  };

  const shown = result?.ok && result.destination ? result.destination : sent;

  return (
    <div
      data-testid="player-move-map"
      style={{
        border: '1px solid var(--color-ally)',
        borderRadius: '6px',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <strong style={{ fontSize: '0.9rem' }}>{actionKey === 'run' ? '走る' : '移動'}: 移動先を選ぶ</strong>
        <button type="button" onClick={onClose} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
          閉じる
        </button>
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        自分のコマを緑のマスへドラッグするか、緑のマスをタップしてください（移動力 {data?.max_moves ?? '—'} マス）。確定は GM が行います
      </div>
      {loadError && <div style={{ color: 'var(--color-enemy)', fontSize: '0.85rem' }}>マップを読み込めません: {loadError}</div>}
      {data && !board && <div style={{ fontSize: '0.85rem' }}>この戦闘には盤面がありません。GM に移動先を伝えてください</div>}
      {board && !myToken && <div style={{ fontSize: '0.85rem' }}>盤面に自分のコマが見えません。GM に移動先を伝えてください</div>}
      {board && (
        <div style={{ overflow: 'auto', maxHeight: '60vh', touchAction: 'pan-x pan-y pinch-zoom' }}>
          <BoardView
            board={board}
            objects={board.objects ?? []}
            tokens={board.tokens ?? []}
            drops={board.drops ?? []}
            mode="move"
            reachableCells={reachableCells}
            destination={shown}
            onSelectDestination={choose}
            ownTokenId={myToken?.id ?? null}
            moveLimit={data?.max_moves}
            isGm={false}
          />
        </div>
      )}
      {result && !result.ok && (
        <div data-testid="player-move-error" role="alert" style={{ color: 'var(--color-enemy)', fontSize: '0.85rem', fontWeight: 600 }}>
          {result.error}
        </div>
      )}
      {result?.ok && result.destination && (
        <div data-testid="player-move-sent" style={{ color: 'var(--color-ally)', fontSize: '0.85rem' }}>
          移動先 ({result.destination.x}, {result.destination.y}) を GM に送りました。GM の確定を待っています（確定前なら置き直せます）
        </div>
      )}
    </div>
  );
};
