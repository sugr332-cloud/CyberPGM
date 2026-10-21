import React, { useEffect, useRef, useState } from 'react';
import { Board, BoardGrid } from '@cyberpgm/shared';
import { getGmToken, gmFetch } from '../api.js';

interface ImageRow {
  id: string;
  title: string | null;
  path: string;
}

interface Props {
  board: Board;
  grid: BoardGrid;
  onUpdateBoard: (patch: { background_image_id?: string | null; grid?: Partial<BoardGrid> }) => void;
}

const btn: React.CSSProperties = {
  padding: '3px 8px',
  backgroundColor: 'var(--color-surface-elevated)',
  border: '1px solid var(--color-border-light)',
  borderRadius: '4px',
  color: 'var(--color-text)',
  cursor: 'pointer',
  fontSize: '0.8rem',
};
const num: React.CSSProperties = { ...btn, width: '64px', cursor: 'text' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' };

/**
 * 盤面の設定（Phase 5n、GM のみ）: 背景マップ、マスの大きさ（地図に対してグリッドを拡大・縮小）、マス数、背景の位置、1 マスの距離。
 * 距離はグリッドのマスで数える
 */
export function BoardSettingsPanel({ board, grid, onUpdateBoard }: Props) {
  const [images, setImages] = useState<ImageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cellPx = grid.cell_px || 40;

  const loadImages = () =>
    gmFetch('/api/images')
      .then((r) => r.json())
      // 品目のアイコン（FVTT）は背景の候補に出さない
      .then((res) => setImages((res.images ?? []).filter((i: ImageRow) => !i.path.startsWith('fvtt/'))))
      .catch(() => undefined);

  useEffect(() => {
    loadImages();
  }, []);

  // 背景を選んだら、いまの盤面の横幅に合わせて地図を置く（縦は地図の縦横比で）。マス数は地図を覆うように決める
  const chooseBackground = (imageId: string | null) => {
    if (!imageId) {
      onUpdateBoard({ background_image_id: null });
      return;
    }
    const img = new Image();
    img.onload = () => {
      const w = (grid.cols || 20) * cellPx;
      const h = Math.round((w * img.naturalHeight) / Math.max(1, img.naturalWidth));
      onUpdateBoard({
        background_image_id: imageId,
        grid: { bg_x: 0, bg_y: 0, bg_w: w, bg_h: h, cols: Math.max(1, Math.ceil(w / cellPx)), rows: Math.max(1, Math.ceil(h / cellPx)) },
      });
    };
    img.onerror = () => setError('画像を読めませんでした');
    img.src = `/api/images/${imageId}?t=${getGmToken() ?? ''}`;
  };

  // マスの大きさを変える。背景があれば、マス数は地図を覆うように数え直す
  const setCellPx = (next: number) => {
    const px = Math.max(10, Math.min(200, Math.round(next)));
    const patch: Partial<BoardGrid> = { cell_px: px };
    if (grid.bg_w && grid.bg_h) {
      patch.cols = Math.max(1, Math.ceil(((grid.bg_x ?? 0) + grid.bg_w) / px));
      patch.rows = Math.max(1, Math.ceil(((grid.bg_y ?? 0) + grid.bg_h) / px));
    }
    onUpdateBoard({ grid: patch });
  };

  const nudge = (dx: number, dy: number) => onUpdateBoard({ grid: { bg_x: (grid.bg_x ?? 0) + dx, bg_y: (grid.bg_y ?? 0) + dy } });

  const upload = async (file: File) => {
    setError(null);
    const fd = new FormData();
    fd.append('image', file);
    fd.append('title', file.name);
    fd.append('visibility', 'players'); // 盤面の地図は表示ウィンドウ（TV）にも出す
    const res = await gmFetch('/api/images', { method: 'POST', body: fd }).then((r) => r.json());
    if (res.error) {
      setError(res.error);
      return;
    }
    await loadImages();
    const id = res.image?.id ?? res.id;
    if (id) chooseBackground(id);
  };

  return (
    <div
      data-testid="board-settings"
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px 12px',
        backgroundColor: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        fontSize: '0.8rem',
        color: 'var(--color-text)',
      }}
    >
      <div style={row}>
        <span style={{ color: 'var(--color-text-muted)' }}>背景マップ:</span>
        <select
          aria-label="背景マップ"
          value={board.background_image_id ?? ''}
          onChange={(e) => chooseBackground(e.target.value || null)}
          style={{ ...btn, maxWidth: '260px' }}
        >
          <option value="">なし</option>
          {images.map((i) => (
            <option key={i.id} value={i.id}>
              {i.title || i.path}
            </option>
          ))}
        </select>
        <button type="button" style={btn} onClick={() => fileRef.current?.click()}>
          画像を登録
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = '';
          }}
        />
      </div>
      <div style={row}>
        <span style={{ color: 'var(--color-text-muted)' }}>マスの大きさ:</span>
        <button type="button" style={btn} aria-label="マスを小さく" onClick={() => setCellPx(cellPx - 2)}>
          −
        </button>
        <input
          aria-label="マスの大きさ"
          type="number"
          min={10}
          max={200}
          value={cellPx}
          onChange={(e) => e.target.value && setCellPx(Number(e.target.value))}
          style={num}
        />
        <button type="button" style={btn} aria-label="マスを大きく" onClick={() => setCellPx(cellPx + 2)}>
          ＋
        </button>
        <span style={{ color: 'var(--color-text-muted)' }}>px（地図のマス目に合わせる）</span>
        <span style={{ color: 'var(--color-text-muted)', marginLeft: '8px' }}>1 マス</span>
        <input
          aria-label="1 マスの距離"
          type="number"
          min={1}
          value={grid.cell_m}
          onChange={(e) => e.target.value && onUpdateBoard({ grid: { cell_m: Number(e.target.value) } })}
          style={{ ...num, width: '48px' }}
        />
        <span style={{ color: 'var(--color-text-muted)' }}>m</span>
      </div>
      <div style={row}>
        <span style={{ color: 'var(--color-text-muted)' }}>マス数:</span>
        <input
          aria-label="横のマス数"
          type="number"
          min={1}
          max={200}
          value={grid.cols}
          onChange={(e) => e.target.value && onUpdateBoard({ grid: { cols: Math.max(1, Number(e.target.value)) } })}
          style={{ ...num, width: '56px' }}
        />
        ×
        <input
          aria-label="縦のマス数"
          type="number"
          min={1}
          max={200}
          value={grid.rows}
          onChange={(e) => e.target.value && onUpdateBoard({ grid: { rows: Math.max(1, Number(e.target.value)) } })}
          style={{ ...num, width: '56px' }}
        />
        {grid.bg_w && (
          <>
            <span style={{ color: 'var(--color-text-muted)', marginLeft: '8px' }}>背景の位置:</span>
            {(
              [
                ['←', -2, 0],
                ['→', 2, 0],
                ['↑', 0, -2],
                ['↓', 0, 2],
              ] as const
            ).map(([label, dx, dy]) => (
              <button key={label} type="button" style={btn} aria-label={`背景を${label}`} onClick={() => nudge(dx, dy)}>
                {label}
              </button>
            ))}
            <span style={{ color: 'var(--color-text-muted)' }}>背景の大きさ:</span>
            <button
              type="button"
              style={btn}
              aria-label="背景を小さく"
              onClick={() => onUpdateBoard({ grid: { bg_w: Math.round(grid.bg_w! * 0.95), bg_h: Math.round((grid.bg_h ?? 0) * 0.95) } })}
            >
              −
            </button>
            <button
              type="button"
              style={btn}
              aria-label="背景を大きく"
              onClick={() => onUpdateBoard({ grid: { bg_w: Math.round(grid.bg_w! * 1.05), bg_h: Math.round((grid.bg_h ?? 0) * 1.05) } })}
            >
              ＋
            </button>
          </>
        )}
      </div>
      {error && <span style={{ color: 'var(--color-accent)' }}>{error}</span>}
    </div>
  );
}
