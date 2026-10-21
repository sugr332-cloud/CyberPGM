import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { characters, devices, images, players } from '../db/schema.js';
import {
  registerDevice,
  revokeCharacterDevices,
  requireGm,
} from '../auth.js';
import { sessionManager } from '../session.js';
import {
  JoinInputSchema,
  ClaimInputSchema,
  ClaimResolveInputSchema,
} from '@cyberpgm/shared';
import { generateUlid } from '@cyberpgm/shared';
import { activeScenarioId, characterLock } from './players.js';

export const authRoutes = new Hono();

/**
 * Automatically issues a GM token when the GM window is opened.
 * No PIN or credentials required.
 */
authRoutes.post('/gm-token', async (c) => {
  const userAgent = c.req.header('User-Agent') || 'GM Console';
  const { token, deviceId } = registerDevice({
    role: 'gm',
    label: userAgent,
  });

  return c.json({
    token,
    role: 'gm',
    deviceId,
  });
});

authRoutes.get('/gm-token', async (c) => {
  const userAgent = c.req.header('User-Agent') || 'GM Console';
  const { token, deviceId } = registerDevice({
    role: 'gm',
    label: userAgent,
  });

  return c.json({
    token,
    role: 'gm',
    deviceId,
  });
});

/**
 * Player joins with session code, returns unclaimed PC list.
 */
authRoutes.post('/join', async (c) => {
  const body = await c.req.json();
  const parsed = JoinInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  if (parsed.data.code.toUpperCase() !== sessionManager.getSessionCode().toUpperCase()) {
    return c.json({ error: 'Invalid session code' }, 400);
  }

  // Get active claimed character IDs
  const activeDevices = db
    .select({ character_id: devices.character_id })
    .from(devices)
    .where(and(eq(devices.revoked, false), eq(devices.role, 'player')))
    .all();

  const claimedIds = new Set(
    activeDevices.map((d) => d.character_id).filter((id): id is string => id !== null),
  );

  // List all PCs (kind = 'pc')
  const allPcs = db
    .select()
    .from(characters)
    .where(eq(characters.kind, 'pc'))
    .all();

  // 自分（player_id）のキャラと、持ち主なしのキャラだけにする（Phase 5i）
  const playerId = parsed.data.player_id ?? null;
  const visiblePcs = playerId ? allPcs.filter((pc) => pc.player_id === playerId || pc.player_id === null) : allPcs;
  const activeId = activeScenarioId();

  const available = visiblePcs.map((pc) => {
    let imgPath: string | null = null;
    if (pc.image_id) {
      const img = db.select().from(images).where(eq(images.id, pc.image_id)).get();
      if (img) imgPath = img.path;
    }

    return {
      id: pc.id,
      name: pc.name,
      role: pc.role,
      image_id: pc.image_id,
      image_path: imgPath,
      claimed: claimedIds.has(pc.id),
      player_id: pc.player_id,
      scenario_id: pc.scenario_id,
      ...characterLock(pc.scenario_id, activeId),
    };
  });

  return c.json({
    code: sessionManager.getSessionCode(),
    characters: available,
  });
});

/**
 * Player claims a character. Handles device collision via GM prompt.
 */
authRoutes.post('/claim', async (c) => {
  const body = await c.req.json();
  const parsed = ClaimInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  if (parsed.data.code.toUpperCase() !== sessionManager.getSessionCode().toUpperCase()) {
    return c.json({ error: 'Invalid session code' }, 400);
  }

  const char = db
    .select()
    .from(characters)
    .where(eq(characters.id, parsed.data.character_id))
    .get();

  if (!char) {
    return c.json({ error: 'Character not found' }, 404);
  }
  // スマホで使えるのは PC だけ（NPC・モブは GM が動かす）
  if (char.kind !== 'pc') {
    return c.json({ error: 'This character is not a PC' }, 400);
  }

  // 未クリアのシナリオに入っているキャラは、そのシナリオ以外では選べない（Phase 5i）
  const activeId = activeScenarioId();
  const lock = characterLock(char.scenario_id, activeId);
  if (lock.locked) {
    return c.json({ error: lock.lock_reason }, 409);
  }

  // Check if character is already claimed by an active device
  const existingDevice = db
    .select()
    .from(devices)
    .where(and(eq(devices.character_id, char.id), eq(devices.revoked, false)))
    .get();

  const userAgent = c.req.header('User-Agent') || 'Player Mobile';

  // 持ち主本人なら GM の承認なしで取り直す（別の Wi-Fi でスマホが記録を忘れたとき。Phase 5i）
  const isOwner = !!char.player_id && parsed.data.player_id === char.player_id;

  if (existingDevice && isOwner) {
    revokeCharacterDevices(char.id);
  } else if (existingDevice) {
    // Collision! Request GM permission
    const requestId = generateUlid();
    const allowed = await sessionManager.requestClaim({
      requestId,
      characterId: char.id,
      characterName: char.name,
      deviceLabel: userAgent,
    });

    if (!allowed) {
      return c.json(
        { error: 'Claim rejected by GM or timed out' },
        403,
      );
    }

    // Revoke old device
    revokeCharacterDevices(char.id);
  }

  // 持ち主なしのキャラは、選んだ人のキャラにする。シナリオ進行中なら、そのシナリオに入れる（Phase 5i）
  const requestedPlayer = parsed.data.player_id
    ? db.select().from(players).where(eq(players.id, parsed.data.player_id)).get()
    : undefined;
  const ownerId = char.player_id ?? requestedPlayer?.id ?? null;
  const scenarioId = char.scenario_id ?? activeId;
  if (ownerId !== char.player_id || scenarioId !== char.scenario_id) {
    db.update(characters)
      .set({ player_id: ownerId, scenario_id: scenarioId })
      .where(eq(characters.id, char.id))
      .run();
  }

  // Register new device
  const { token, deviceId } = registerDevice({
    role: 'player',
    characterId: char.id,
    label: userAgent,
  });

  return c.json({
    token,
    role: 'player',
    character_id: char.id,
    player_id: ownerId,
    deviceId,
  });
});

/**
 * GM resolves a claim request.
 */
authRoutes.post('/claim/:id/resolve', requireGm, async (c) => {
  const requestId = c.req.param('id');
  if (!requestId) {
    return c.json({ error: 'Missing claim request ID' }, 400);
  }
  const body = await c.req.json();
  const parsed = ClaimResolveInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const ok = sessionManager.resolveClaim(requestId, parsed.data.allow);
  if (!ok) {
    return c.json({ error: 'Claim request not found or expired' }, 404);
  }

  return c.json({ success: true });
});
