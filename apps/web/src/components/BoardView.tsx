import React, { useState, useRef, useMemo, useCallback } from 'react';
import {
  Board,
  BoardGrid,
  BoardObject,
  BoardToken,
  BoardDrop,
  Combat,
  CombatParticipant,
} from '@cyberpgm/shared';
import { woundState, LosStatus } from '@cyberpgm/rules';
import { BoardSettingsPanel } from './BoardSettingsPanel.js';
import { api, getGmToken } from '../api.js';

export interface BoardViewProps {
  board: Board;
  objects: BoardObject[];
  tokens: BoardToken[];
  drops?: BoardDrop[];
  combat?: Combat | null;
  activeParticipantId?: string | null;
  targetParticipantId?: string | null;
  focusedParticipantId?: string | null;
  mode?: 'view' | 'move' | 'attack' | 'pickup' | 'setup';
  reachableCells?: Set<string>; // Set of "x,y"
  destination?: { x: number; y: number } | null;
  onSelectCell?: (cell: { x: number; y: number }) => void;
  onSelectDestination?: (dest: { x: number; y: number }) => void;
  losLine?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    status: LosStatus;
  } | null;
  isGm?: boolean;
  isScreen?: boolean;
  onUpdateObject?: (objId: string, patch: Partial<BoardObject>) => void;
  onDeleteObject?: (objId: string) => void;
  onCreateObject?: (obj: Omit<BoardObject, 'id' | 'board_id'>) => void;
  onMoveToken?: (tokenId: string, x: number, y: number) => void;
  onSelectDrop?: (drop: BoardDrop) => void;
  onSelectParticipant?: (participantId: string) => void;
  onUpdateFog?: (fog: { x: number; y: number }[]) => void;
  // 盤面の設定（背景マップ・マスの大きさ・マス数。Phase 5n）。渡すと GM に「盤面の設定」を出す
  onUpdateBoard?: (patch: { background_image_id?: string | null; grid?: Partial<BoardGrid> }) => void;
  // プレイヤーのスマホ: 「移動」を選んだとき自分のコマだけ動かせる（Phase 6a）。落としたマスは onSelectDestination へ
  ownTokenId?: string | null;
  // 移動できるマス数（届かないマスで離したときの理由に出す）
  moveLimit?: number;
  style?: React.CSSProperties;
  className?: string;
}

export const BoardView: React.FC<BoardViewProps> = ({
  board,
  objects,
  tokens,
  drops = [],
  combat,
  activeParticipantId,
  targetParticipantId,
  focusedParticipantId,
  mode = 'view',
  reachableCells,
  destination,
  onSelectCell,
  onSelectDestination,
  losLine,
  isGm = false,
  isScreen = false,
  onUpdateObject,
  onDeleteObject,
  onCreateObject,
  onMoveToken,
  onSelectDrop,
  onSelectParticipant,
  onUpdateFog,
  onUpdateBoard,
  ownTokenId = null,
  moveLimit,
  style,
  className = '',
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const grid = useMemo(() => {
    return (
      board.grid || {
        show: true,
        cell_m: 2,
        origin_x: 0,
        origin_y: 0,
        cell_px: 40,
        cols: 20,
        rows: 15,
      }
    );
  }, [board.grid]);

  const [showGrid, setShowGrid] = useState<boolean>(grid.show ?? true);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [draggingTokenId, setDraggingTokenId] = useState<string | null>(null);
  const [draggingObjectId, setDraggingObjectId] = useState<string | null>(null);
  const [dragHoverCell, setDragHoverCell] = useState<{ x: number; y: number } | null>(null);
  const [dragMessage, setDragMessage] = useState<string | null>(null);
  const dragStartCellRef = useRef<{ x: number; y: number } | null>(null);
  const dragMovedRef = useRef<boolean>(false);

  // Fog of War state
  const [isFogMode, setIsFogMode] = useState<boolean>(false);
  const [fogTool, setFogTool] = useState<'hide' | 'reveal'>('hide');
  const [fogCells, setFogCells] = useState<{ x: number; y: number }[]>(board.fog || []);
  const [isPaintingFog, setIsPaintingFog] = useState(false);
  const [netArchs, setNetArchs] = useState<Array<{ id: string; name: string }>>([]);

  React.useEffect(() => {
    if (isGm && !isScreen) {
      api
        .listNetArchitectures()
        .then((res) => setNetArchs(res.architectures || []))
        .catch(() => undefined);
    }
  }, [isGm, isScreen]);

  React.useEffect(() => {
    setFogCells(board.fog || []);
  }, [board.fog]);

  const updateFogAndNotify = useCallback(
    (newFog: { x: number; y: number }[]) => {
      setFogCells(newFog);
      onUpdateFog?.(newFog);
    },
    [onUpdateFog]
  );

  const applyFogToolToCell = useCallback(
    (cell: { x: number; y: number }) => {
      setFogCells((prev) => {
        const exists = prev.some((f) => f.x === cell.x && f.y === cell.y);
        let next: { x: number; y: number }[];
        if (fogTool === 'hide') {
          if (exists) return prev;
          next = [...prev, cell];
        } else {
          if (!exists) return prev;
          next = prev.filter((f) => !(f.x === cell.x && f.y === cell.y));
        }
        onUpdateFog?.(next);
        return next;
      });
    },
    [fogTool, onUpdateFog]
  );

  const hideAllFog = () => {
    const all: { x: number; y: number }[] = [];
    const cCount = grid.cols || 20;
    const rCount = grid.rows || 15;
    for (let y = 0; y < rCount; y++) {
      for (let x = 0; x < cCount; x++) {
        all.push({ x, y });
      }
    }
    updateFogAndNotify(all);
  };

  const clearAllFog = () => {
    updateFogAndNotify([]);
  };

  const svgRef = useRef<SVGSVGElement | null>(null);

  const cols = grid.cols || 20;
  const rows = grid.rows || 15;
  const cellPx = grid.cell_px || 40;
  const boardWidth = cols * cellPx;
  const boardHeight = rows * cellPx;

  // Filter tokens and objects for screen view
  const visibleTokens = useMemo(() => {
    return tokens.filter((t) => {
      if (isScreen && t.gm_only) return false;
      if (isScreen && combat) {
        const p = combat.participants.find(
          (part) => part.character_id === t.character_id || part.id === t.character_id
        );
        if (p && p.side === 'enemy') {
          const status = (p.character?.status as string[]) || (p as any).status || [];
          if (Array.isArray(status) && status.includes('隠れている')) {
            return false;
          }
        }
      }
      return true;
    });
  }, [tokens, isScreen, combat]);

  // Map participant by token
  const getParticipantForToken = useCallback(
    (token: BoardToken): CombatParticipant | undefined => {
      if (!combat || !token.character_id) return undefined;
      return combat.participants.find(
        (p) =>
          (p.character_id && p.character_id === token.character_id) ||
          (p.id && p.id === token.character_id)
      );
    },
    [combat]
  );

  // Convert SVG client coords to grid cell
  const getCellFromEvent = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    if (!svgRef.current) return null;
    let svgX: number;
    let svgY: number;

    const ctm = svgRef.current.getScreenCTM();
    if (ctm && svgRef.current.createSVGPoint) {
      const pt = svgRef.current.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgP = pt.matrixTransform(ctm.inverse());
      svgX = svgP.x;
      svgY = svgP.y;
    } else {
      const rect = svgRef.current.getBoundingClientRect();
      const fit = Math.min(rect.width / boardWidth, rect.height / boardHeight);
      if (fit <= 0) return null;
      svgX = (e.clientX - rect.left - (rect.width - boardWidth * fit) / 2) / fit;
      svgY = (e.clientY - rect.top - (rect.height - boardHeight * fit) / 2) / fit;
    }

    const x = Math.floor(svgX / cellPx);
    const y = Math.floor(svgY / cellPx);
    if (x < 0 || x >= cols || y < 0 || y >= rows) return null;
    return { x, y };
  };

  // ドラッグ中のコマをそのマスに置けるか判定する（Phase 6a）
  const evaluateTokenDropCell = useCallback(
    (tokenId: string, cx: number, cy: number): { valid: boolean; isMoveAction: boolean; reason?: string } => {
      const tok = tokens.find((t) => t.id === tokenId);
      if (!tok) return { valid: false, isMoveAction: false };
      const part = getParticipantForToken(tok);
      const isActiveTurnMove =
        (combat?.status === 'active' &&
          mode === 'move' &&
          Boolean(activeParticipantId) &&
          part?.id === activeParticipantId) ||
        (mode === 'move' && Boolean(ownTokenId) && tok.id === ownTokenId);

      if (isActiveTurnMove) {
        const inReach = Boolean(reachableCells?.has(`${cx},${cy}`));
        if (inReach) {
          return { valid: true, isMoveAction: true };
        }
        const charMove = (part?.character?.stats?.move ?? 6) - (part?.character?.armor_penalty ?? 0);
        const dying = (part?.character?.hp ?? 1) < 1;
        const maxMoves = moveLimit ?? Math.max(1, dying ? charMove - 6 : charMove);
        return {
          valid: false,
          isMoveAction: true,
          reason: `そのマスへは移動できません（移動力 ${maxMoves} マス）`,
        };
      }

      const blockingObj = objects.find(
        (obj) => !obj.passable && cx >= obj.x && cx < obj.x + obj.w && cy >= obj.y && cy < obj.y + obj.h,
      );
      if (blockingObj) {
        return {
          valid: false,
          isMoveAction: false,
          reason: `そのマスへは移動できません（通れない置物「${blockingObj.label || '障害物'}」があります）`,
        };
      }

      const occupyingTok = tokens.find((t) => t.id !== tok.id && t.x === cx && t.y === cy);
      if (occupyingTok) {
        return {
          valid: false,
          isMoveAction: false,
          reason: 'そのマスへは移動できません（ほかのコマがいます）',
        };
      }

      return { valid: true, isMoveAction: false };
    },
    [tokens, objects, combat?.status, mode, activeParticipantId, reachableCells, getParticipantForToken, ownTokenId, moveLimit],
  );

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    const cell = getCellFromEvent(e);
    if (!cell) return;

    if (isGm && !isScreen && !isFogMode && onSelectCell) {
      onSelectCell(cell);
      return;
    }

    if (mode === 'move' && reachableCells?.has(`${cell.x},${cell.y}`)) {
      onSelectDestination?.(cell);
      return;
    }
  };

  const handleCellClick = (x: number, y: number) => {
    if (mode === 'move' && reachableCells?.has(`${x},${y}`)) {
      onSelectDestination?.({ x, y });
    }
  };

  // Object drag handling in setup / non-combat (Pointer Events)
  const handleObjectPointerDown = (objId: string, e: React.PointerEvent) => {
    if (combat?.status === 'active' || isScreen || !isGm || isFogMode || onSelectCell) return;
    e.preventDefault();
    e.stopPropagation();
    const obj = objects.find((o) => o.id === objId);
    setSelectedObjectId(objId);
    setDraggingObjectId(objId);
    setDragHoverCell(obj ? { x: obj.x, y: obj.y } : null);
    dragStartCellRef.current = obj ? { x: obj.x, y: obj.y } : null;
    dragMovedRef.current = false;
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events without active pointerId
    }
  };

  // Token drag handling in setup & active combat for GM (Phase 6a, Pointer Events)
  // プレイヤーは「移動」を選んでいるときに自分のコマだけ
  const canDragToken = (tokenId: string) =>
    !isScreen && !isFogMode && !onSelectCell && (isGm || (mode === 'move' && Boolean(ownTokenId) && tokenId === ownTokenId));
  const handleTokenPointerDown = (tokenId: string, e: React.PointerEvent) => {
    if (!canDragToken(tokenId)) return;
    e.preventDefault();
    e.stopPropagation();
    const tok = tokens.find((t) => t.id === tokenId);
    setDraggingTokenId(tokenId);
    setDragHoverCell(tok ? { x: tok.x, y: tok.y } : null);
    setDragMessage(null);
    dragStartCellRef.current = tok ? { x: tok.x, y: tok.y } : null;
    dragMovedRef.current = false;
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events without active pointerId
    }
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isGm && isFogMode) {
      e.preventDefault();
      const cell = getCellFromEvent(e);
      if (cell) {
        setIsPaintingFog(true);
        applyFogToolToCell(cell);
        try {
          svgRef.current?.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isGm && isFogMode && isPaintingFog) {
      const cell = getCellFromEvent(e);
      if (cell) {
        applyFogToolToCell(cell);
      }
      return;
    }
    if (draggingTokenId || draggingObjectId) {
      const cell = getCellFromEvent(e);
      setDragHoverCell(cell);
      if (
        cell &&
        dragStartCellRef.current &&
        (cell.x !== dragStartCellRef.current.x || cell.y !== dragStartCellRef.current.y)
      ) {
        dragMovedRef.current = true;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    try {
      if (svgRef.current?.hasPointerCapture?.(e.pointerId)) {
        svgRef.current.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
    if (isPaintingFog) {
      setIsPaintingFog(false);
    }
    if (draggingTokenId) {
      const tok = tokens.find((t) => t.id === draggingTokenId);
      const cell = getCellFromEvent(e);
      if (tok && cell && (cell.x !== tok.x || cell.y !== tok.y)) {
        const check = evaluateTokenDropCell(draggingTokenId, cell.x, cell.y);
        if (check.isMoveAction) {
          if (check.valid) {
            setDragMessage(null);
            onSelectDestination?.(cell);
          } else {
            setDragMessage(check.reason || 'そのマスへは移動できません');
          }
        } else {
          if (check.valid) {
            setDragMessage(null);
            onMoveToken?.(draggingTokenId, cell.x, cell.y);
          } else {
            setDragMessage(check.reason || 'そのマスへは移動できません');
          }
        }
      }
      setDraggingTokenId(null);
      setDragHoverCell(null);
    }
    if (draggingObjectId) {
      const cell = getCellFromEvent(e);
      if (cell) {
        onUpdateObject?.(draggingObjectId, { x: cell.x, y: cell.y });
      }
      setDraggingObjectId(null);
      setDragHoverCell(null);
    }
  };

  const selectedObject = objects.find((o) => o.id === selectedObjectId);

  // Background image URL: if visibility is GM and this is TV screen, server will have nullified it.
  // GM だけの画像も GM 画面では見えるように、GM はトークンをつける（v は更新したときの読み直し用）
  const bgImageUrl = board.background_image_id
    ? `/api/images/${board.background_image_id}?v=${board.updated_at || Date.now()}${isGm && !isScreen ? `&t=${getGmToken() ?? ''}` : ''}`
    : null;

  return (
    <div
      className={`board-view-container relative flex flex-col items-center select-none bg-slate-950 text-slate-100 rounded-lg border border-slate-800 ${className}`}
      style={{
        width: '100%',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        ...style,
        ...(isScreen
          ? {
              width: '100%',
              height: '100%',
              minHeight: 0,
              minWidth: 0,
              border: 'none',
              backgroundColor: 'transparent',
            }
          : {}),
      }}
    >
      {/* Board Toolbar (hidden in Screen view) */}
      {!isScreen && (
        <div
          style={{
            width: '100%',
            flexShrink: 0,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            backgroundColor: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            fontSize: '0.85rem',
            gap: '8px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
              盤面: {board.name} ({cols}x{rows}マス / 1マス {grid.cell_m}m)
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />
              <span>グリッド表示</span>
            </label>
            {isGm && onUpdateBoard && (
              <button
                type="button"
                data-testid="board-settings-toggle"
                onClick={() => setShowSettings((v) => !v)}
                style={{
                  padding: '4px 8px',
                  backgroundColor: showSettings ? 'var(--color-ally)' : 'var(--color-surface-elevated)',
                  color: showSettings ? '#000' : 'var(--color-text)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                盤面の設定
              </button>
            )}
          </div>

          <span style={{ color: 'var(--color-ally)', fontSize: '0.8rem' }}>全体表示・画面に自動調整</span>

          {isGm && combat?.status !== 'active' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() =>
                  onCreateObject?.({
                    kind: 'wall',
                    label: '壁',
                    x: Math.floor(cols / 2),
                    y: Math.floor(rows / 2),
                    w: 1,
                    h: 3,
                    rotation: 0,
                    passable: false,
                    blocks_los: 'full',
                    cover_hp: null,
                    cover_hp_max: null,
                  })
                }
                style={{
                  padding: '4px 10px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '4px',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                + 壁追加
              </button>
              <button
                type="button"
                onClick={() =>
                  onCreateObject?.({
                    kind: 'crate',
                    label: '木箱',
                    x: Math.floor(cols / 2),
                    y: Math.floor(rows / 2),
                    w: 1,
                    h: 1,
                    rotation: 0,
                    passable: true,
                    blocks_los: 'partial',
                    cover_hp: 20,
                    cover_hp_max: 20,
                  })
                }
                style={{
                  padding: '4px 10px',
                  backgroundColor: 'rgba(235, 179, 58, 0.15)',
                  border: '1px solid var(--color-warning)',
                  borderRadius: '4px',
                  color: 'var(--color-warning)',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                + 木箱追加
              </button>
              <button
                type="button"
                data-testid="add-access-point-btn"
                onClick={() =>
                  onCreateObject?.({
                    kind: 'access_point',
                    label: 'アクセスポイント',
                    x: Math.floor(cols / 2),
                    y: Math.floor(rows / 2),
                    w: 1,
                    h: 1,
                    rotation: 0,
                    passable: true,
                    blocks_los: 'none',
                    cover_hp: null,
                    cover_hp_max: null,
                  })
                }
                style={{
                  padding: '4px 10px',
                  backgroundColor: 'rgba(34, 211, 238, 0.15)',
                  border: '1px solid var(--color-ally)',
                  borderRadius: '4px',
                  color: 'var(--color-ally)',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                + アクセスポイント追加
              </button>
            </div>
          )}

          {isGm && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setIsFogMode(!isFogMode)}
                style={{
                  padding: '4px 10px',
                  backgroundColor: isFogMode ? 'rgba(79, 182, 227, 0.25)' : 'var(--color-surface-elevated)',
                  border: `1px solid ${isFogMode ? 'var(--color-ally)' : 'var(--color-border-light)'}`,
                  borderRadius: '4px',
                  color: isFogMode ? 'var(--color-ally)' : 'var(--color-text)',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: isFogMode ? 700 : 500,
                }}
              >
                霧ツール
              </button>
              {isFogMode && (
                <>
                  <button
                    type="button"
                    onClick={() => setFogTool('hide')}
                    style={{
                      padding: '3px 8px',
                      backgroundColor: fogTool === 'hide' ? 'var(--color-ally)' : 'var(--color-surface-elevated)',
                      color: fogTool === 'hide' ? '#000' : 'var(--color-text)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    隠す
                  </button>
                  <button
                    type="button"
                    onClick={() => setFogTool('reveal')}
                    style={{
                      padding: '3px 8px',
                      backgroundColor: fogTool === 'reveal' ? 'var(--color-ally)' : 'var(--color-surface-elevated)',
                      color: fogTool === 'reveal' ? '#000' : 'var(--color-text)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    晴らす
                  </button>
                  <button
                    type="button"
                    onClick={hideAllFog}
                    style={{
                      padding: '3px 8px',
                      backgroundColor: 'var(--color-surface-elevated)',
                      color: 'var(--color-text-muted)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    全覆い
                  </button>
                  <button
                    type="button"
                    onClick={clearAllFog}
                    style={{
                      padding: '3px 8px',
                      backgroundColor: 'var(--color-surface-elevated)',
                      color: 'var(--color-text-muted)',
                      border: '1px solid var(--color-border-light)',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    全晴れ
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* 盤面の設定（Phase 5n） */}
      {!isScreen && isGm && onUpdateBoard && showSettings && <BoardSettingsPanel board={board} grid={grid} onUpdateBoard={onUpdateBoard} />}

      {/* Selected Object Controls Bar (GM only, outside combat) */}
      {isGm && combat?.status !== 'active' && selectedObject && (
        <div className="w-full flex items-center justify-between px-3 py-1.5 bg-amber-950/40 border-b border-amber-800/60 text-xs text-amber-200">
          <div className="flex items-center gap-3">
            <span className="font-semibold">
              選択中: {selectedObject.label} ({selectedObject.x}, {selectedObject.y})
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdateObject?.(selectedObject.id, {
                  rotation: ((selectedObject.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                })
              }
              className="px-2 py-0.5 bg-amber-900 hover:bg-amber-800 rounded border border-amber-700"
            >
              90° 回転 ({selectedObject.rotation}°)
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateObject?.(selectedObject.id, {
                  blocks_los:
                    selectedObject.blocks_los === 'none'
                      ? 'partial'
                      : selectedObject.blocks_los === 'partial'
                      ? 'full'
                      : 'none',
                })
              }
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-600"
            >
              遮蔽: {selectedObject.blocks_los}
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateObject?.(selectedObject.id, {
                  passable: !selectedObject.passable,
                })
              }
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-600"
            >
              通行: {selectedObject.passable ? '可能' : '不可'}
            </button>
            {selectedObject.kind === 'access_point' && (
              <label className="flex items-center gap-1">
                <span>NET構造体:</span>
                <select
                  aria-label="アクセスポイントのNET構造体"
                  value={(selectedObject as any).arch_id || ''}
                  onChange={(e) =>
                    onUpdateObject?.(selectedObject.id, {
                      arch_id: e.target.value || null,
                    } as any)
                  }
                  className="px-2 py-0.5 bg-slate-900 rounded border border-cyan-700 text-cyan-200"
                >
                  <option value="">（未指定 / 共通）</option>
                  {netArchs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onDeleteObject?.(selectedObject.id);
                setSelectedObjectId(null);
              }}
              className="px-2 py-0.5 bg-red-950 hover:bg-red-900 text-red-300 rounded border border-red-700"
            >
              削除
            </button>
            <button
              type="button"
              onClick={() => setSelectedObjectId(null)}
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* Always show the entire board inside this viewport. */}
      <div
        data-testid="board-viewport"
        style={{
          flex: isScreen ? '1 1 0' : '0 1 auto',
          position: 'relative',
          width: '100%',
          minHeight: 0,
          minWidth: 0,
          height: isScreen ? '100%' : 'min(60dvh, 640px)',
          maxHeight: isScreen ? '100%' : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${boardWidth} ${boardHeight}`}
          preserveAspectRatio="xMidYMid meet"
          className="border border-slate-800 shadow-2xl transition-transform"
          onClick={handleSvgClick}
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            setDraggingTokenId(null);
            setDraggingObjectId(null);
            setDragHoverCell(null);
            setIsPaintingFog(false);
            dragMovedRef.current = false;
          }}
          style={{
            position: 'absolute',
            inset: 0,
            maxWidth: '100%',
            maxHeight: '100%',
            width: '100%',
            height: '100%',
            minWidth: 0,
            minHeight: 0,
            display: 'block',
            cursor: onSelectCell || mode === 'move' ? 'crosshair' : 'default',
            touchAction: (isGm || ownTokenId) && !isScreen ? 'none' : undefined,
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          <defs>
            {/* Grid Pattern */}
            <pattern
              id="boardGridPattern"
              width={cellPx}
              height={cellPx}
              patternUnits="userSpaceOnUse"
            >
              <rect width={cellPx} height={cellPx} fill="none" />
              <path
                d={`M ${cellPx} 0 L 0 0 0 ${cellPx}`}
                fill="none"
                stroke="rgba(255, 255, 255, 0.12)"
                strokeWidth="1"
              />
            </pattern>
            {/* Pulsing ring filter for active token */}
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background color */}
          <rect width={boardWidth} height={boardHeight} fill="#090d16" />

          {/* Background Image if available */}
          {bgImageUrl && (
            <image
              href={bgImageUrl}
              x={grid.bg_w ? (grid.bg_x ?? 0) : 0}
              y={grid.bg_w ? (grid.bg_y ?? 0) : 0}
              width={grid.bg_w ?? boardWidth}
              height={grid.bg_h ?? boardHeight}
              preserveAspectRatio="none"
            />
          )}

          {/* Grid Overlay */}
          {showGrid && (
            <rect width={boardWidth} height={boardHeight} fill="url(#boardGridPattern)" />
          )}

          {/* Reachable Cells Overlay (Move mode) */}
          {mode === 'move' && reachableCells && (
            <g className="reachable-cells">
              {Array.from(reachableCells).map((coord) => {
                const [cx, cy] = coord.split(',').map(Number);
                const isDest = destination?.x === cx && destination?.y === cy;
                return (
                  <rect
                    key={coord}
                    data-cell={coord}
                    x={cx * cellPx}
                    y={cy * cellPx}
                    width={cellPx}
                    height={cellPx}
                    fill={isDest ? 'rgba(34, 197, 94, 0.45)' : 'rgba(59, 130, 246, 0.35)'}
                    stroke={isDest ? '#22C55E' : '#3B82F6'}
                    strokeWidth={isDest ? 2 : 1}
                    className="hover:fill-cyan-500/50 cursor-pointer transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCellClick(cx, cy);
                    }}
                  />
                );
              })}
            </g>
          )}

          {/* Destination marker if set */}
          {destination && (
            <g className="destination-marker pointer-events-none">
              <rect
                x={destination.x * cellPx}
                y={destination.y * cellPx}
                width={cellPx}
                height={cellPx}
                fill="rgba(34, 197, 94, 0.3)"
                stroke="#22C55E"
                strokeWidth={2}
              />
              <circle
                cx={(destination.x + 0.5) * cellPx}
                cy={(destination.y + 0.5) * cellPx}
                r={6}
                fill="#22C55E"
              />
            </g>
          )}

          {/* Objects */}
          <g className="board-objects">
            {objects.map((obj) => {
              const ox = obj.x * cellPx;
              const oy = obj.y * cellPx;
              const ow = obj.w * cellPx;
              const oh = obj.h * cellPx;
              const cx = ox + ow / 2;
              const cy = oy + oh / 2;
              const isSelected = selectedObjectId === obj.id;
              const isBroken = obj.cover_hp !== null && obj.cover_hp !== undefined && obj.cover_hp <= 0;

              const isWall = obj.kind === 'wall';
              const isAp = obj.kind === 'access_point';
              const fillColor = isBroken
                ? '#334155'
                : isAp
                ? '#0E7490'
                : isWall
                ? '#475569'
                : '#78350F';
              const strokeColor = isSelected
                ? '#F59E0B'
                : isBroken
                ? '#64748B'
                : isAp
                ? '#22D3EE'
                : isWall
                ? '#64748B'
                : '#D97706';

              return (
                <g
                  key={obj.id}
                  transform={`rotate(${obj.rotation || 0} ${cx} ${cy})`}
                  className={
                    combat?.status !== 'active' && isGm && !isScreen
                      ? 'cursor-move'
                      : 'pointer-events-none'
                  }
                  onPointerDown={(e) => handleObjectPointerDown(obj.id, e)}
                  opacity={isBroken ? 0.4 : 0.9}
                >
                  <rect
                    x={ox}
                    y={oy}
                    width={ow}
                    height={oh}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    strokeDasharray={isBroken ? '4 2' : undefined}
                    rx={isWall ? 2 : 4}
                  />
                  {/* Object Label & HP */}
                  <text
                    x={cx}
                    y={cy}
                    fill="#F3F4F6"
                    fontSize={Math.min(12, cellPx * 0.3)}
                    fontWeight="600"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    pointerEvents="none"
                  >
                    {obj.label || (isWall ? '壁' : '木箱')}
                    {obj.cover_hp !== null && obj.cover_hp !== undefined
                      ? isBroken
                        ? ' (破壊)'
                        : ` (${obj.cover_hp})`
                      : ''}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Drops */}
          <g className="board-drops">
            {drops.map((drop) => {
              const dx = (drop.x + 0.5) * cellPx;
              const dy = (drop.y + 0.5) * cellPx;
              const entry = drop.inventory_entry as any;
              const name = entry?.name || '落とし物';

              return (
                <g
                  key={drop.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectDrop?.(drop);
                  }}
                >
                  <circle cx={dx} cy={dy} r={cellPx * 0.25} fill="#D97706" stroke="#FBBF24" strokeWidth={1.5} />
                  <path
                    d={`M ${dx} ${dy - cellPx * 0.15} L ${dx + cellPx * 0.15} ${dy} L ${dx} ${dy + cellPx * 0.15} L ${dx - cellPx * 0.15} ${dy} Z`}
                    fill="#FEF3C7"
                  />
                  <text
                    x={dx}
                    y={dy + cellPx * 0.38}
                    fill="#FDE68A"
                    fontSize={9}
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    {name}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Line of Sight (LoS) */}
          {losLine && (
            <g className="los-line pointer-events-none">
              <line
                x1={(losLine.x1 + 0.5) * cellPx}
                y1={(losLine.y1 + 0.5) * cellPx}
                x2={(losLine.x2 + 0.5) * cellPx}
                y2={(losLine.y2 + 0.5) * cellPx}
                stroke={
                  losLine.status === 'clear'
                    ? '#22C55E'
                    : losLine.status === 'cover'
                    ? '#EAB308'
                    : '#EF4444'
                }
                strokeWidth={3}
                strokeDasharray={
                  losLine.status === 'cover'
                    ? '6 4'
                    : losLine.status === 'blocked'
                    ? '4 4'
                    : undefined
                }
              />
              {/* Target indicator ring */}
              <circle
                cx={(losLine.x2 + 0.5) * cellPx}
                cy={(losLine.y2 + 0.5) * cellPx}
                r={cellPx * 0.45}
                fill="none"
                stroke={
                  losLine.status === 'clear'
                    ? '#22C55E'
                    : losLine.status === 'cover'
                    ? '#EAB308'
                    : '#EF4444'
                }
                strokeWidth={2}
              />
            </g>
          )}

          {/* Tokens */}
          <g className="board-tokens">
            {visibleTokens.map((tok) => {
              const tx = (tok.x + 0.5) * cellPx;
              const ty = (tok.y + 0.5) * cellPx;
              const r = cellPx * 0.38;

              const part = getParticipantForToken(tok);
              const char = part?.character;
              const hasChar = Boolean(tok.character_id && (part || char || tok.hp !== undefined));
              const isAlly = tok.side ? tok.side === 'ally' : part ? part.side === 'ally' : false;
              const sideColor = tok.gm_only
                ? '#A855F7'
                : hasChar
                ? isAlly
                  ? '#4FB6E3'
                  : '#F28C38'
                : '#94A3B8';

              const isActive = part && part.id === activeParticipantId;
              const isTarget = part && part.id === targetParticipantId;
              const isFocused = Boolean(part && part.id === focusedParticipantId);
              const labelAnchor = tok.x === 0 ? 'start' : tok.x === cols - 1 ? 'end' : 'middle';
              const labelY = tok.y === rows - 1 ? ty - r - 20 : ty + r + 10;
              const hpY = tok.y === rows - 1 ? ty - r - 17 : ty + r + 13;

              // HP and wound status
              let currentHp = 0;
              let maxHp = 1;
              let wound: 'ok' | 'seriously' | 'mortally' | 'dead' = 'ok';

              if (hasChar) {
                if (tok.hp !== null && tok.hp !== undefined) {
                  currentHp = tok.hp;
                  maxHp = tok.hp_max ?? Math.max(1, currentHp);
                } else if (char?.hp !== null && char?.hp !== undefined) {
                  currentHp = char.hp;
                  maxHp = char.hp_max ?? Math.max(1, currentHp);
                }

                if (tok.wound_state) {
                  wound = tok.wound_state;
                } else if ((char as any)?.wound_state) {
                  const ws = (char as any).wound_state;
                  if (ws === '死亡') wound = 'dead';
                  else if (ws === '瀕死') wound = 'mortally';
                  else if (ws === '重傷') wound = 'seriously';
                  else if (ws === '健康') wound = 'ok';
                  else wound = ws;
                } else if (char?.hp !== undefined) {
                  wound = currentHp <= 0 ? 'dead' : woundState(currentHp, maxHp);
                }
              }

              const isDead = hasChar && (currentHp <= 0 || wound === 'dead');

              const name = tok.name || part?.name || char?.name || (tok.gm_only ? 'GM' : '—');
              const initial = tok.gm_only ? 'GM' : name.slice(0, 1);

              return (
                <g
                  key={tok.id}
                  data-testid={`token-${tok.id}`}
                  data-character-id={tok.character_id || ''}
                  data-cell={`${tok.x},${tok.y}`}
                  data-focused={isFocused ? 'true' : undefined}
                  aria-label={`${name} (${tok.x}, ${tok.y})`}
                  style={{ cursor: canDragToken(tok.id) ? 'grab' : 'pointer' }}
                  data-dragging={draggingTokenId === tok.id ? 'true' : undefined}
                  className={`token-group ${
                    canDragToken(tok.id) ? 'cursor-move' : 'cursor-pointer'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dragMovedRef.current) {
                      dragMovedRef.current = false;
                      return;
                    }
                    if (isGm && !isScreen && !isFogMode && onSelectCell) {
                      onSelectCell({ x: tok.x, y: tok.y });
                      return;
                    }
                    if (part) {
                      onSelectParticipant?.(part.id);
                    }
                  }}
                  onPointerDown={(e) => handleTokenPointerDown(tok.id, e)}
                  opacity={
                    draggingTokenId === tok.id
                      ? 0.45
                      : tok.gm_only
                      ? 0.6
                      : isDead
                      ? 0.4
                      : 1.0
                  }
                >
                  <title>{`${name} (${tok.x}, ${tok.y})${canDragToken(tok.id) ? '・ドラッグで移動' : ''}`}</title>
                  {isFocused && (
                    <circle data-testid="focused-token-ring" cx={tx} cy={ty} r={r + 6} fill="none" stroke="#22D3EE" strokeWidth={3} strokeDasharray="5 3" pointerEvents="none" />
                  )}
                  {/* Active highlight */}
                  {isActive && (
                    <circle
                      cx={tx}
                      cy={ty}
                      r={r + 5}
                      fill="none"
                      stroke="#FACC15"
                      strokeWidth={3}
                      filter="url(#glow)"
                    />
                  )}

                  {/* Target highlight */}
                  {isTarget && !isActive && (
                    <circle
                      cx={tx}
                      cy={ty}
                      r={r + 4}
                      fill="none"
                      stroke="#FB923C"
                      strokeWidth={2.5}
                      strokeDasharray="4 2"
                    />
                  )}

                  {/* Base Circle */}
                  <circle
                    cx={tx}
                    cy={ty}
                    r={r}
                    fill="#1E293B"
                    stroke={sideColor}
                    strokeWidth={tok.gm_only ? 2 : 2.5}
                    strokeDasharray={tok.gm_only ? '3 2' : undefined}
                  />

                  {/* Character Avatar or Initial */}
                  {char?.image_path ? (
                    <>
                      <clipPath id={`clip-${tok.id}`}>
                        <circle cx={tx} cy={ty} r={r - 1} />
                      </clipPath>
                      <image
                        href={char.image_path.startsWith('/') ? char.image_path : `/api/images/${char.image_path}`}
                        x={tx - r}
                        y={ty - r}
                        width={r * 2}
                        height={r * 2}
                        clipPath={`url(#clip-${tok.id})`}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    </>
                  ) : (
                    <text
                      x={tx}
                      y={ty}
                      fill={sideColor}
                      fontSize={initial.length > 1 ? cellPx * 0.28 : cellPx * 0.4}
                      fontWeight="bold"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      pointerEvents="none"
                    >
                      {initial}
                    </text>
                  )}

                  {/* GM Only Badge */}
                  {tok.gm_only && !isScreen && (
                    <rect
                      x={tx - 12}
                      y={ty - r - 8}
                      width={24}
                      height={10}
                      fill="#7C3AED"
                      rx={2}
                    />
                  )}
                  {tok.gm_only && !isScreen && (
                    <text
                      className="gm-token-badge"
                      x={tx}
                      y={ty - r - 2}
                      fill="#FFFFFF"
                      fontSize={7}
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      GM
                    </text>
                  )}

                  {/* Participant Name */}
                  <text
                    x={tx}
                    y={labelY}
                    fill="#F1F5F9"
                    fontSize={Math.min(10, cellPx * 0.28)}
                    fontWeight="600"
                    textAnchor={labelAnchor}
                    stroke="#090D16"
                    strokeWidth={2}
                    paintOrder="stroke fill"
                  >
                    {name}
                  </text>

                  {/* HP Bar or Wound State */}
                  {hasChar && (
                    <>
                      {/* Case 1: TV Screen and Enemy -> ONLY wound status badge if wounded (wound !== 'ok'), NO numbers! */}
                      {isScreen && !isAlly ? (
                        wound !== 'ok' && (
                          <g transform={`translate(${tx - 16}, ${hpY + 1})`}>
                            <rect
                              width={32}
                              height={10}
                              rx={2}
                              fill={
                                wound === 'seriously'
                                  ? '#B45309'
                                  : wound === 'mortally'
                                  ? '#B91C1C'
                                  : '#475569'
                              }
                            />
                            <text
                              x={16}
                              y={7}
                              fill="#FFFFFF"
                              fontSize={7}
                              fontWeight="bold"
                              textAnchor="middle"
                            >
                              {wound === 'seriously'
                                ? '重傷'
                                : wound === 'mortally'
                                ? '瀕死'
                                : '死亡'}
                            </text>
                          </g>
                        )
                      ) : (
                        /* Case 2: Ally, or GM view -> HP bar with numbers */
                        <g transform={`translate(${tx - r}, ${hpY})`}>
                          {/* Bar Background */}
                          <rect
                            width={r * 2}
                            height={5}
                            fill="#334155"
                            rx={2}
                            stroke="#0F172A"
                            strokeWidth={0.5}
                          />
                          {/* Bar Fill */}
                          <rect
                            width={Math.max(0, Math.min(r * 2, (r * 2 * currentHp) / maxHp))}
                            height={5}
                            fill={
                              currentHp <= 0
                                ? '#64748B'
                                : currentHp <= maxHp / 2
                                ? '#EAB308'
                                : sideColor
                            }
                            rx={2}
                          />
                          {/* Numeric HP text (only if numbers exist and allowed) */}
                          {(isAlly || !isScreen) && (
                            <text
                              x={r}
                              y={11}
                              fill="#CBD5E1"
                              fontSize={8}
                              textAnchor="middle"
                              stroke="#090D16"
                              strokeWidth={1.5}
                              paintOrder="stroke fill"
                            >
                              {currentHp}/{maxHp}
                            </text>
                          )}
                        </g>
                      )}
                    </>
                  )}
                </g>
              );
            })}
          </g>

          {/* Drag Hover Cell Outline (Phase 6a) */}
          {draggingTokenId && dragHoverCell && (() => {
            const check = evaluateTokenDropCell(draggingTokenId, dragHoverCell.x, dragHoverCell.y);
            const isValid = check.valid;
            return (
              <rect
                data-testid="drag-hover-cell"
                data-cell={`${dragHoverCell.x},${dragHoverCell.y}`}
                data-valid={isValid ? 'true' : 'false'}
                x={dragHoverCell.x * cellPx}
                y={dragHoverCell.y * cellPx}
                width={cellPx}
                height={cellPx}
                fill={isValid ? 'rgba(34, 197, 94, 0.28)' : 'rgba(239, 68, 68, 0.28)'}
                stroke={isValid ? '#22C55E' : '#EF4444'}
                strokeWidth={3}
                pointerEvents="none"
              />
            );
          })()}

          {/* Fog of War Layer */}
          <g className="fog-layer">
            {fogCells.map((f, i) => (
              <rect
                key={`fog-${f.x}-${f.y}-${i}`}
                x={f.x * cellPx}
                y={f.y * cellPx}
                width={cellPx}
                height={cellPx}
                fill={isGm ? 'rgba(0, 0, 0, 0.65)' : '#000000'}
                stroke={isGm && isFogMode ? 'rgba(255, 255, 255, 0.25)' : 'none'}
                strokeWidth={0.5}
                style={{ pointerEvents: 'none' }}
              />
            ))}
          </g>
        </svg>
      </div>

      {/* ドラッグできないマスで離したときの理由（Phase 6a） */}
      {!isScreen && dragMessage && (
        <div
          data-testid="board-drag-message"
          style={{
            width: '100%',
            padding: '6px 12px',
            backgroundColor: 'rgba(239, 68, 68, 0.18)',
            borderTop: '1px solid #EF4444',
            color: '#FCA5A5',
            fontSize: '0.85rem',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>{dragMessage}</span>
          <button
            type="button"
            onClick={() => setDragMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#FCA5A5',
              cursor: 'pointer',
              fontSize: '0.9rem',
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
