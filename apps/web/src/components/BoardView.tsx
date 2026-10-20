import React, { useState, useRef, useMemo, useCallback } from 'react';
import {
  Board,
  BoardObject,
  BoardToken,
  BoardDrop,
  Combat,
  CombatParticipant,
} from '@cyberpgm/shared';
import { woundState, LosStatus } from '@cyberpgm/rules';

export interface BoardViewProps {
  board: Board;
  objects: BoardObject[];
  tokens: BoardToken[];
  drops?: BoardDrop[];
  combat?: Combat | null;
  activeParticipantId?: string | null;
  targetParticipantId?: string | null;
  mode?: 'view' | 'move' | 'attack' | 'pickup' | 'setup';
  reachableCells?: Set<string>; // Set of "x,y"
  destination?: { x: number; y: number } | null;
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
  mode = 'view',
  reachableCells,
  destination,
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
  style,
  className = '',
}) => {
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
  const [scale, setScale] = useState<number>(1);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [draggingTokenId, setDraggingTokenId] = useState<string | null>(null);
  const [draggingObjectId, setDraggingObjectId] = useState<string | null>(null);

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
  const getCellFromEvent = (e: React.MouseEvent<SVGSVGElement>): { x: number; y: number } | null => {
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
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;
      svgX = clientX / scale;
      svgY = clientY / scale;
    }

    const x = Math.floor(svgX / cellPx);
    const y = Math.floor(svgY / cellPx);
    if (x < 0 || x >= cols || y < 0 || y >= rows) return null;
    return { x, y };
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const cell = getCellFromEvent(e);
    if (!cell) return;

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

  // Object drag handling in setup / non-combat
  const handleObjectMouseDown = (objId: string, e: React.MouseEvent) => {
    if (combat?.status === 'active' || isScreen || !isGm) return;
    e.stopPropagation();
    setSelectedObjectId(objId);
    setDraggingObjectId(objId);
  };

  const handleTokenMouseDown = (tokenId: string, e: React.MouseEvent) => {
    if (combat?.status === 'active' || isScreen || !isGm) return;
    e.stopPropagation();
    setDraggingTokenId(tokenId);
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingTokenId) {
      const cell = getCellFromEvent(e);
      if (cell) {
        onMoveToken?.(draggingTokenId, cell.x, cell.y);
      }
      setDraggingTokenId(null);
    }
    if (draggingObjectId) {
      const cell = getCellFromEvent(e);
      if (cell) {
        onUpdateObject?.(draggingObjectId, { x: cell.x, y: cell.y });
      }
      setDraggingObjectId(null);
    }
  };

  const selectedObject = objects.find((o) => o.id === selectedObjectId);

  // Background image URL: if visibility is GM and this is TV screen, server will have nullified it.
  const bgImageUrl = board.background_image_id
    ? `/api/images/${board.background_image_id}?t=${board.updated_at || Date.now()}`
    : null;

  return (
    <div
      className={`board-view-container relative flex flex-col items-center select-none bg-slate-950 text-slate-100 rounded-lg border border-slate-800 ${className}`}
      style={{
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
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            backgroundColor: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            fontSize: '0.85rem',
            gap: '8px',
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
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
              style={{
                padding: '4px 8px',
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-light)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
              title="縮小"
            >
              -
            </button>
            <span style={{ minWidth: '45px', textAlign: 'center', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(2.0, s + 0.1))}
              style={{
                padding: '4px 8px',
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-light)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
              title="拡大"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setScale(1)}
              style={{
                padding: '4px 8px',
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-light)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
              title="リセット"
            >
              100%
            </button>
          </div>

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
            </div>
          )}
        </div>
      )}

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

      {/* SVG Canvas Scroll Area */}
      <div
        className="w-full overflow-auto flex items-center justify-center p-2"
        style={{
          flex: 1,
          width: '100%',
          minHeight: 0,
          minWidth: 0,
          height: isScreen ? '100%' : undefined,
          maxHeight: isScreen ? '100%' : '70vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: isScreen ? 'hidden' : 'auto',
          boxSizing: 'border-box',
        }}
      >
        <svg
          ref={svgRef}
          width={isScreen ? '100%' : boardWidth * scale}
          height={isScreen ? '100%' : boardHeight * scale}
          viewBox={`0 0 ${boardWidth} ${boardHeight}`}
          preserveAspectRatio="xMidYMid meet"
          className="border border-slate-800 shadow-2xl transition-transform"
          onClick={handleSvgClick}
          onMouseUp={handleMouseUp}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            width: isScreen ? '100%' : undefined,
            height: isScreen ? '100%' : undefined,
            display: 'block',
            cursor: mode === 'move' ? 'crosshair' : 'default',
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
              x="0"
              y="0"
              width={boardWidth}
              height={boardHeight}
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
              const fillColor = isBroken
                ? '#334155'
                : isWall
                ? '#475569'
                : '#78350F';
              const strokeColor = isSelected
                ? '#F59E0B'
                : isBroken
                ? '#64748B'
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
                  onMouseDown={(e) => handleObjectMouseDown(obj.id, e)}
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
                  className={`token-group ${
                    combat?.status !== 'active' && isGm && !isScreen
                      ? 'cursor-move'
                      : 'cursor-pointer'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (part) {
                      onSelectParticipant?.(part.id);
                    }
                  }}
                  onMouseDown={(e) => handleTokenMouseDown(tok.id, e)}
                  opacity={tok.gm_only ? 0.6 : isDead ? 0.4 : 1.0}
                >
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
                    y={ty + r + 10}
                    fill="#F1F5F9"
                    fontSize={Math.min(10, cellPx * 0.28)}
                    fontWeight="600"
                    textAnchor="middle"
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
                          <g transform={`translate(${tx - 16}, ${ty + r + 14})`}>
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
                        <g transform={`translate(${tx - r}, ${ty + r + 13})`}>
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
        </svg>
      </div>
    </div>
  );
};
