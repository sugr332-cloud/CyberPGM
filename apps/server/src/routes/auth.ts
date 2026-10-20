import crypto from 'node:crypto';
import { Hono, Context } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { characters, devices, images } from '../db/schema.js';
import { getOrCreateGmPin } from '../config.js';
import {
  registerDevice,
  revokeCharacterDevices,
  requireGm,
} from '../auth.js';
import { sessionManager } from '../session.js';
import {
  GmLoginInputSchema,
  JoinInputSchema,
  ClaimInputSchema,
  ClaimResolveInputSchema,
} from '@cyberpgm/shared';
import { generateUlid } from '@cyberpgm/shared';

export const authRoutes = new Hono();

interface RateLimitEntry {
  failCount: number;
  lockedUntil: number;
}

const gmRateLimits = new Map<string, RateLimitEntry>();

export function resetGmRateLimits(): void {
  gmRateLimits.clear();
}

function getClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = c.req.header('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  const envObj = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  if (envObj?.incoming?.socket?.remoteAddress) {
    return envObj.incoming.socket.remoteAddress;
  }
  return '127.0.0.1';
}

function verifyPin(inputPin: string, actualPin: string): boolean {
  const hashInput = crypto.createHash('sha256').update(inputPin).digest();
  const hashActual = crypto.createHash('sha256').update(actualPin).digest();
  return crypto.timingSafeEqual(hashInput, hashActual);
}

/**
 * GM login via PIN.
 * Rate limit: 5 consecutive failures from same IP locks out for 60 seconds (HTTP 429).
 */
authRoutes.post('/gm', async (c) => {
  const clientIp = getClientIp(c);
  const now = Date.now();
  const entry = gmRateLimits.get(clientIp);

  if (entry && entry.lockedUntil > now) {
    const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
    c.header('Retry-After', String(retryAfter));
    return c.json(
      {
        error: 'Too many failed login attempts. Please wait 60 seconds.',
        retryAfter,
      },
      429,
    );
  }

  const body = await c.req.json();
  const parsed = GmLoginInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const { pin } = getOrCreateGmPin();
  const isMatch = verifyPin(parsed.data.pin, pin);

  if (!isMatch) {
    const currentFails = (entry && entry.lockedUntil <= now ? entry.failCount : 0) + 1;
    if (currentFails >= 5) {
      gmRateLimits.set(clientIp, {
        failCount: currentFails,
        lockedUntil: now + 60_000,
      });
    } else {
      gmRateLimits.set(clientIp, {
        failCount: currentFails,
        lockedUntil: 0,
      });
    }
    return c.json({ error: 'Invalid GM PIN' }, 401);
  }

  // Success: reset rate limit counter for this IP
  gmRateLimits.delete(clientIp);

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

  const available = allPcs.map((pc) => {
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

  // Check if character is already claimed by an active device
  const existingDevice = db
    .select()
    .from(devices)
    .where(and(eq(devices.character_id, char.id), eq(devices.revoked, false)))
    .get();

  const userAgent = c.req.header('User-Agent') || 'Player Mobile';

  if (existingDevice) {
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
