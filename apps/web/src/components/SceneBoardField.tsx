import React, { useCallback, useEffect, useState } from 'react';
import { Board, BoardObject, BoardToken } from '@cyberpgm/shared';
import { api } from '../api.js';
import { BoardView } from './BoardView.js';

type HydratedBoard = Board & { objects?: BoardObject[]; tokens?: BoardToken[] };

interface Props {
  sceneTitle: string;
  boardId: string | null | undefined;
  onChange: (boardId: string | null) => void;
}

const field: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: '0.75rem',
  borderRadius: '4px',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
};

/**
 * シーンの盤面（Phase 5n）: シーンに盤面を割り当て、背景マップ・グリッド・壁や遮蔽物をシナリオメーカーで用意しておく。
 * 敵の初期配置はエンカウンターの位置で決まる。進行中にこのシーンに入ると、この盤面が出る
 */
export function SceneBoardField({ sceneTitle, boardId, onChange }: Props) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [board, setBoard] = useState<HydratedBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(() => api.getBoards().then((res) => setBoards(res.boards)).catch(() => undefined), []);
  const loadBoard = useCallback(() => {
    if (!boardId) {
      setBoard(null);
      return;
    }
    api
      .getBoard(boardId)
      .then((res) => setBoard(res.board as HydratedBoard))
      .catch(() => setBoard(null));
  }, [boardId]);

  useEffect(() => {
    loadList();
  }, [loadList]);
  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const createForScene = async () => {
    setError(null);
    try {
      const res = await api.createBoard({ name: sceneTitle || 'シーンの盤面' });
      await loadList();
      onChange(res.board.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '盤面を作れませんでした');
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      loadBoard();
    } catch (e) {
      setError(e instanceof Error ? e.message : '盤面を更新できませんでした');
    }
  };

  return (
    <div data-testid="scene-board-field" style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        盤面（背景マップ・グリッド・壁や遮蔽物。進行中にこのシーンに入ると出る）
      </label>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <select aria-label="シーンの盤面" value={boardId ?? ''} onChange={(e) => onChange(e.target.value || null)} style={{ ...field, flex: 1 }}>
          <option value="">なし</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={createForScene} style={{ ...field, cursor: 'pointer' }}>
          ＋ このシーンの盤面を作る
        </button>
      </div>
      {board && (
        <div style={{ height: '380px', position: 'relative' }}>
          <BoardView
            board={board}
            objects={board.objects ?? []}
            tokens={board.tokens ?? []}
            isGm={true}
            mode="setup"
            onUpdateBoard={(patch) => run(() => api.updateBoard(board.id, patch))}
            onCreateObject={(obj) => run(() => api.createBoardObject(board.id, obj))}
            onUpdateObject={(objId, patch) => run(() => api.updateBoardObject(board.id, objId, patch))}
            onDeleteObject={(objId) => run(() => api.deleteBoardObject(board.id, objId))}
            style={{ height: '380px' }}
          />
        </div>
      )}
      {error && <span style={{ color: 'var(--color-accent)', fontSize: '0.75rem' }}>{error}</span>}
    </div>
  );
}
