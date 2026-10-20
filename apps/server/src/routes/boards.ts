import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  boards,
  board_objects,
  board_tokens,
  board_drops,
  images,
} from '../db/schema.js';
import { requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import {
  BoardCreateInputSchema,
  BoardUpdateInputSchema,
  BoardObjectCreateInputSchema,
  BoardObjectUpdateInputSchema,
  BoardTokenCreateInputSchema,
  BoardTokenUpdateInputSchema,
  BoardDropCreateInputSchema,
  generateUlid,
  Board,
} from '@cyberpgm/shared';

export const boardsRoutes = new Hono();

export function getHydratedBoard(boardId: string): Board | null {
  const b = db.select().from(boards).where(eq(boards.id, boardId)).get();
  if (!b) return null;

  const objects = db
    .select()
    .from(board_objects)
    .where(eq(board_objects.board_id, boardId))
    .all();

  const tokens = db
    .select()
    .from(board_tokens)
    .where(eq(board_tokens.board_id, boardId))
    .all();

  const drops = db
    .select()
    .from(board_drops)
    .where(eq(board_drops.board_id, boardId))
    .all()
    .map((d) => ({
      ...d,
      inventory_entry: JSON.parse(d.inventory_entry || '{}'),
    }));

  let bgPath: string | null = null;
  let bgVisibility: string | null = null;
  if (b.background_image_id) {
    const img = db.select().from(images).where(eq(images.id, b.background_image_id)).get();
    if (img) {
      bgPath = img.path;
      bgVisibility = img.visibility;
    }
  }

  return {
    id: b.id,
    name: b.name,
    background_image_id: b.background_image_id,
    grid: JSON.parse(b.grid || '{"show":true,"cell_m":2,"origin_x":0,"origin_y":0,"cell_px":40,"cols":20,"rows":15}'),
    fog: JSON.parse(b.fog || '[]'),
    created_at: b.created_at,
    updated_at: b.updated_at,
    objects: objects.map((o) => ({
      ...o,
      blocks_los: o.blocks_los as 'none' | 'partial' | 'full',
      kind: o.kind as any,
    })),
    tokens,
    drops,
    background_image_path: bgPath,
    background_image_visibility: bgVisibility,
  };
}

// GET /api/boards: List all boards
boardsRoutes.get('/boards', requireGm, async (c) => {
  const allBoards = db.select().from(boards).orderBy(desc(boards.updated_at)).all();
  const hydrated = allBoards.map((b) => getHydratedBoard(b.id)).filter(Boolean);
  return c.json({ boards: hydrated });
});

// POST /api/boards: Create a new board
boardsRoutes.post('/boards', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = BoardCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const id = generateUlid();
  const now = Date.now();
  const gridObj = {
    show: parsed.data.grid?.show ?? true,
    cell_m: parsed.data.grid?.cell_m ?? 2,
    origin_x: parsed.data.grid?.origin_x ?? 0,
    origin_y: parsed.data.grid?.origin_y ?? 0,
    cell_px: parsed.data.grid?.cell_px ?? 40,
    cols: parsed.data.grid?.cols ?? 20,
    rows: parsed.data.grid?.rows ?? 15,
  };

  db.insert(boards)
    .values({
      id,
      name: parsed.data.name,
      background_image_id: parsed.data.background_image_id ?? null,
      grid: JSON.stringify(gridObj),
      created_at: now,
      updated_at: now,
    })
    .run();

  const created = getHydratedBoard(id);
  sessionManager.broadcastBoardUpdate(created);
  sessionManager.broadcastScreenUpdate();

  return c.json({ board: created }, 201);
});

// GET /api/boards/:id: Get board details
boardsRoutes.get('/boards/:id', async (c) => {
  const id = c.req.param('id')!;
  const board = getHydratedBoard(id);
  if (!board) {
    return c.json({ error: 'Board not found' }, 404);
  }
  return c.json({ board });
});

// PATCH /api/boards/:id: Update board metadata or grid
boardsRoutes.patch('/boards/:id', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const body = await c.req.json();
  const parsed = BoardUpdateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const existing = getHydratedBoard(id);
  if (!existing) {
    return c.json({ error: 'Board not found' }, 404);
  }

  const now = Date.now();
  const updates: Record<string, unknown> = { updated_at: now };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.background_image_id !== undefined) updates.background_image_id = parsed.data.background_image_id;
  if (parsed.data.grid !== undefined) {
    updates.grid = JSON.stringify({ ...existing.grid, ...parsed.data.grid });
  }

  db.update(boards).set(updates).where(eq(boards.id, id)).run();

  const updated = getHydratedBoard(id);
  sessionManager.broadcastBoardUpdate(updated);
  sessionManager.broadcastScreenUpdate();

  return c.json({ board: updated });
});

// PATCH /api/boards/:id/fog: Update board fog (hidden cells)
boardsRoutes.patch('/boards/:id/fog', requireGm, async (c) => {
  const id = c.req.param('id')!;
  const body = await c.req.json();
  const fog = Array.isArray(body.fog) ? body.fog : [];

  const existing = db.select().from(boards).where(eq(boards.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Board not found' }, 404);
  }

  db.update(boards)
    .set({
      fog: JSON.stringify(fog),
      updated_at: Date.now(),
    })
    .where(eq(boards.id, id))
    .run();

  const updated = getHydratedBoard(id);
  sessionManager.broadcastBoardUpdate(updated);
  sessionManager.broadcastScreenUpdate();

  return c.json({ board: updated, fog });
});

// DELETE /api/boards/:id: Delete a board
boardsRoutes.delete('/boards/:id', requireGm, async (c) => {
  const id = c.req.param('id')!;
  db.delete(boards).where(eq(boards.id, id)).run();
  sessionManager.broadcastBoardUpdate(null);
  sessionManager.broadcastScreenUpdate();
  return c.json({ success: true });
});

// --- Board Objects ---

// POST /api/boards/:id/objects: Add an object
boardsRoutes.post('/boards/:id/objects', requireGm, async (c) => {
  const boardId = c.req.param('id')!;
  const body = await c.req.json();
  const parsed = BoardObjectCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const id = generateUlid();
  db.insert(board_objects)
    .values({
      id,
      board_id: boardId,
      kind: parsed.data.kind,
      label: parsed.data.label,
      x: parsed.data.x,
      y: parsed.data.y,
      w: parsed.data.w,
      h: parsed.data.h,
      rotation: parsed.data.rotation,
      passable: parsed.data.passable,
      blocks_los: parsed.data.blocks_los,
      cover_hp: parsed.data.cover_hp ?? null,
      cover_hp_max: parsed.data.cover_hp_max ?? null,
    })
    .run();

  db.update(boards).set({ updated_at: Date.now() }).where(eq(boards.id, boardId)).run();

  const updatedBoard = getHydratedBoard(boardId);
  sessionManager.broadcastBoardUpdate(updatedBoard);
  sessionManager.broadcastScreenUpdate();

  return c.json({ board: updatedBoard }, 201);
});

// PATCH /api/boards/:id/objects/:objId: Update an object
boardsRoutes.patch('/boards/:id/objects/:objId', requireGm, async (c) => {
  const boardId = c.req.param('id')!;
  const objId = c.req.param('objId')!;
  const body = await c.req.json();
  const parsed = BoardObjectUpdateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.kind !== undefined) updates.kind = parsed.data.kind;
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.x !== undefined) updates.x = parsed.data.x;
  if (parsed.data.y !== undefined) updates.y = parsed.data.y;
  if (parsed.data.w !== undefined) updates.w = parsed.data.w;
  if (parsed.data.h !== undefined) updates.h = parsed.data.h;
  if (parsed.data.rotation !== undefined) updates.rotation = parsed.data.rotation;
  if (parsed.data.passable !== undefined) updates.passable = parsed.data.passable;
  if (parsed.data.blocks_los !== undefined) updates.blocks_los = parsed.data.blocks_los;
  if (parsed.data.cover_hp !== undefined) updates.cover_hp = parsed.data.cover_hp;
  if (parsed.data.cover_hp_max !== undefined) updates.cover_hp_max = parsed.data.cover_hp_max;

  db.update(board_objects).set(updates).where(eq(board_objects.id, objId)).run();
  db.update(boards).set({ updated_at: Date.now() }).where(eq(boards.id, boardId)).run();

  const updatedBoard = getHydratedBoard(boardId);
  sessionManager.broadcastBoardUpdate(updatedBoard);
  sessionManager.broadcastScreenUpdate();

  return c.json({ board: updatedBoard });
});

// DELETE /api/boards/:id/objects/:objId: Delete an object
boardsRoutes.delete('/boards/:id/objects/:objId', requireGm, async (c) => {
  const boardId = c.req.param('id')!;
  const objId = c.req.param('objId')!;
  db.delete(board_objects).where(eq(board_objects.id, objId)).run();
  db.update(boards).set({ updated_at: Date.now() }).where(eq(boards.id, boardId)).run();

  const updatedBoard = getHydratedBoard(boardId);
  sessionManager.broadcastBoardUpdate(updatedBoard);
  sessionManager.broadcastScreenUpdate();

  return c.json({ board: updatedBoard });
});

// --- Board Tokens ---

// POST /api/boards/:id/tokens: Place a token
boardsRoutes.post('/boards/:id/tokens', requireGm, async (c) => {
  const boardId = c.req.param('id')!;
  const body = await c.req.json();
  const parsed = BoardTokenCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const id = generateUlid();
  db.insert(board_tokens)
    .values({
      id,
      board_id: boardId,
      character_id: parsed.data.character_id ?? null,
      x: parsed.data.x,
      y: parsed.data.y,
      gm_only: parsed.data.gm_only ?? false,
    })
    .run();

  db.update(boards).set({ updated_at: Date.now() }).where(eq(boards.id, boardId)).run();

  const updatedBoard = getHydratedBoard(boardId);
  sessionManager.broadcastBoardUpdate(updatedBoard);
  sessionManager.broadcastScreenUpdate();

  return c.json({ board: updatedBoard }, 201);
});

// PATCH /api/boards/:id/tokens/:tokenId: Update a token
boardsRoutes.patch('/boards/:id/tokens/:tokenId', requireGm, async (c) => {
  const boardId = c.req.param('id')!;
  const tokenId = c.req.param('tokenId')!;
  const body = await c.req.json();
  const parsed = BoardTokenUpdateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.x !== undefined) updates.x = parsed.data.x;
  if (parsed.data.y !== undefined) updates.y = parsed.data.y;
  if (parsed.data.gm_only !== undefined) updates.gm_only = parsed.data.gm_only;
  if (parsed.data.character_id !== undefined) updates.character_id = parsed.data.character_id;

  db.update(board_tokens).set(updates).where(eq(board_tokens.id, tokenId)).run();
  db.update(boards).set({ updated_at: Date.now() }).where(eq(boards.id, boardId)).run();

  const updatedBoard = getHydratedBoard(boardId);
  sessionManager.broadcastBoardUpdate(updatedBoard);
  sessionManager.broadcastScreenUpdate();

  return c.json({ board: updatedBoard });
});

// DELETE /api/boards/:id/tokens/:tokenId: Delete a token
boardsRoutes.delete('/boards/:id/tokens/:tokenId', requireGm, async (c) => {
  const boardId = c.req.param('id')!;
  const tokenId = c.req.param('tokenId')!;
  db.delete(board_tokens).where(eq(board_tokens.id, tokenId)).run();
  db.update(boards).set({ updated_at: Date.now() }).where(eq(boards.id, boardId)).run();

  const updatedBoard = getHydratedBoard(boardId);
  sessionManager.broadcastBoardUpdate(updatedBoard);
  sessionManager.broadcastScreenUpdate();

  return c.json({ board: updatedBoard });
});

// --- Board Drops ---

// POST /api/boards/:id/drops: Add a drop
boardsRoutes.post('/boards/:id/drops', requireGm, async (c) => {
  const boardId = c.req.param('id')!;
  const body = await c.req.json();
  const parsed = BoardDropCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const id = generateUlid();
  db.insert(board_drops)
    .values({
      id,
      board_id: boardId,
      x: parsed.data.x,
      y: parsed.data.y,
      inventory_entry: JSON.stringify(parsed.data.inventory_entry),
      from_character_id: parsed.data.from_character_id ?? null,
    })
    .run();

  db.update(boards).set({ updated_at: Date.now() }).where(eq(boards.id, boardId)).run();

  const updatedBoard = getHydratedBoard(boardId);
  sessionManager.broadcastBoardUpdate(updatedBoard);
  sessionManager.broadcastScreenUpdate();

  return c.json({ board: updatedBoard }, 201);
});

// DELETE /api/boards/:id/drops/:dropId: Delete a drop
boardsRoutes.delete('/boards/:id/drops/:dropId', requireGm, async (c) => {
  const boardId = c.req.param('id')!;
  const dropId = c.req.param('dropId')!;
  db.delete(board_drops).where(eq(board_drops.id, dropId)).run();
  db.update(boards).set({ updated_at: Date.now() }).where(eq(boards.id, boardId)).run();

  const updatedBoard = getHydratedBoard(boardId);
  sessionManager.broadcastBoardUpdate(updatedBoard);
  sessionManager.broadcastScreenUpdate();

  return c.json({ board: updatedBoard });
});
