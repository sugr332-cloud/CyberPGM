import crypto from 'node:crypto';
import { Context, Next } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from './db/client.js';
import { devices } from './db/schema.js';
import { generateUlid } from '@cyberpgm/shared';

export interface DeviceRecord {
  id: string;
  tokenHash: string;
  role: 'gm' | 'player';
  characterId: string | null;
  label: string | null;
  lastSeenAt: number;
  revoked: boolean;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Creates a new device record with a secure token.
 */
export function registerDevice(params: {
  role: 'gm' | 'player';
  characterId?: string | null;
  label?: string | null;
}): { token: string; deviceId: string } {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const deviceId = generateUlid();
  const now = Date.now();

  db.insert(devices)
    .values({
      id: deviceId,
      token_hash: tokenHash,
      role: params.role,
      character_id: params.characterId ?? null,
      label: params.label ?? null,
      last_seen_at: now,
      revoked: false,
    })
    .run();

  return { token, deviceId };
}

/**
 * Verifies a token and updates last_seen_at. Returns device if valid.
 */
export function verifyToken(token: string): DeviceRecord | null {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = hashToken(token);

  const row = db
    .select()
    .from(devices)
    .where(and(eq(devices.token_hash, tokenHash), eq(devices.revoked, false)))
    .get();

  if (!row) return null;

  const now = Date.now();
  // Update last seen asynchronously or synchronously
  db.update(devices)
    .set({ last_seen_at: now })
    .where(eq(devices.id, row.id))
    .run();

  return {
    id: row.id,
    tokenHash: row.token_hash,
    role: row.role as 'gm' | 'player',
    characterId: row.character_id,
    label: row.label,
    lastSeenAt: now,
    revoked: Boolean(row.revoked),
  };
}

/**
 * Revokes all active devices associated with a given character.
 */
export function revokeCharacterDevices(characterId: string): void {
  db.update(devices)
    .set({ revoked: true })
    .where(and(eq(devices.character_id, characterId), eq(devices.revoked, false)))
    .run();
}

/**
 * Revokes a specific device by ID.
 */
export function revokeDeviceById(deviceId: string): void {
  db.update(devices)
    .set({ revoked: true })
    .where(eq(devices.id, deviceId))
    .run();
}

/**
 * Extracts Bearer token or query token.
 */
export function extractToken(c: Context): string | null {
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const queryToken = c.req.query('token');
  if (queryToken) {
    return queryToken.trim();
  }
  return null;
}

// Type augmentations for Hono context
declare module 'hono' {
  interface ContextVariableMap {
    device?: DeviceRecord;
    role?: 'gm' | 'player';
    characterId?: string | null;
  }
}

/**
 * Hono middleware that attaches device/role info if token is provided.
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const token = extractToken(c);
  if (token) {
    const device = verifyToken(token);
    if (device) {
      c.set('device', device);
      c.set('role', device.role);
      c.set('characterId', device.characterId);
    }
  }
  await next();
}

/**
 * Middleware: Requires GM role.
 */
export async function requireGm(c: Context, next: Next): Promise<Response | void> {
  const role = c.get('role');
  if (role !== 'gm') {
    return c.json({ error: 'Forbidden: GM access required' }, 403);
  }
  await next();
}

/**
 * Middleware: Requires authenticated player or GM.
 */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const role = c.get('role');
  if (!role) {
    return c.json({ error: 'Unauthorized: Valid token required' }, 401);
  }
  await next();
}
