import type { Board } from '@cyberpgm/shared';

export function tokenPlacementError(board: Board, x: number, y: number, tokenId?: string): string | null {
  const cols = board.grid?.cols || 20;
  const rows = board.grid?.rows || 15;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= cols || y >= rows) {
    return '盤面の範囲内のマスを選んでください';
  }
  if (board.tokens?.some((t) => t.id !== tokenId && t.x === x && t.y === y)) {
    return 'そのマスにはほかのコマがいます';
  }
  const obstacle = board.objects?.find((o) => !o.passable && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h);
  return obstacle ? `通れない置物「${obstacle.label || '障害物'}」があるマスには配置できません` : null;
}

export function findTokenPlacement(board: Board, side: string, tokenId?: string): { x: number; y: number } | null {
  const cols = board.grid?.cols || 20;
  const rows = board.grid?.rows || 15;
  // 味方は左、敵は右から、盤面内の空きマスを探す。
  for (let y = 0; y < rows; y++) {
    for (let offset = 0; offset < cols; offset++) {
      const x = side === 'ally' ? offset : cols - 1 - offset;
      if (!tokenPlacementError(board, x, y, tokenId)) return { x, y };
    }
  }
  return null;
}
