import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { audio } from '../db/schema.js';
import { requireGm } from '../auth.js';
import { generateUlid, getProjectRoot } from '@cyberpgm/shared';

// シーンの BGM の音声ファイル（Phase 5e）。ファイルは data/audio/ に置き、git に入れない
export const audioRoutes = new Hono();

const MAX_SIZE = 30 * 1024 * 1024;
const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

export function getAudioDir(): string {
  // テストと E2E は AUDIO_DIR で一時フォルダを使う
  const dir = process.env.AUDIO_DIR ? path.resolve(process.env.AUDIO_DIR) : path.join(getProjectRoot(), 'data', 'audio');
  fs.mkdirSync(path.join(dir, 'user'), { recursive: true });
  return dir;
}

/** 拡張子と先頭のバイトが合っているか */
export function matchesAudioSignature(ext: string, buf: Buffer): boolean {
  const ascii = (start: number, end: number) => buf.subarray(start, end).toString('latin1');
  switch (ext) {
    case '.mp3':
      // ID3 タグか、MPEG のフレーム同期（11 ビットが 1）
      return ascii(0, 3) === 'ID3' || (buf.length > 1 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
    case '.ogg':
      return ascii(0, 4) === 'OggS';
    case '.wav':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    case '.m4a':
      return ascii(4, 8) === 'ftyp';
    default:
      return false;
  }
}

/**
 * BGM のフォルダ（data/audio）に置いた曲を一覧に入れる（Phase 5n）。サブフォルダも読む。
 * 曲名はファイル名（サブフォルダは「フォルダ / 曲名」）。フォルダから消えた曲は一覧からも消す
 */
export function syncAudioFolder(): { added: number; removed: number } {
  const base = getAudioDir();
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (TYPES[path.extname(ent.name).toLowerCase()]) found.push(path.relative(base, full));
    }
  };
  walk(base);
  const rows = db.select().from(audio).all();
  const known = new Set(rows.map((r) => r.path));
  let added = 0;
  for (const rel of found) {
    if (known.has(rel)) continue;
    const ext = path.extname(rel).toLowerCase();
    const dir = path.dirname(rel);
    const name = path.basename(rel, ext);
    db.insert(audio)
      .values({
        id: generateUlid(),
        title: dir === '.' ? name : `${dir.split(path.sep).join(' / ')} / ${name}`,
        path: rel,
        mime: TYPES[ext],
        size: fs.statSync(path.join(base, rel)).size,
        duration_sec: null,
        created_at: Date.now(),
      })
      .run();
    added++;
  }
  const present = new Set(found);
  let removed = 0;
  for (const r of rows) {
    if (!present.has(r.path)) {
      db.delete(audio).where(eq(audio.id, r.id)).run();
      removed++;
    }
  }
  return { added, removed };
}

// GET /api/audio: 音声の一覧（GM）。開くたびに BGM フォルダを読み直す
audioRoutes.get('/audio', requireGm, (c) => {
  syncAudioFolder();
  return c.json({ audio: db.select().from(audio).all().sort((a, b) => a.title.localeCompare(b.title, 'ja')), folder: getAudioDir() });
});

// POST /api/audio: 音声のアップロード（GM。multipart: file, title?）
audioRoutes.post('/audio', requireGm, async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);
  if (file.size > MAX_SIZE) return c.json({ error: '音声ファイルは 30MB までです' }, 400);
  const ext = path.extname(file.name).toLowerCase();
  if (!TYPES[ext]) return c.json({ error: 'mp3 / ogg / m4a / wav だけ登録できます' }, 400);
  const buf = Buffer.from(await file.arrayBuffer());
  if (!matchesAudioSignature(ext, buf)) return c.json({ error: 'ファイルの中身が拡張子と合いません' }, 400);

  const id = generateUlid();
  const rel = path.join('user', `${id}${ext}`);
  fs.writeFileSync(path.join(getAudioDir(), rel), buf);
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : path.basename(file.name, ext);
  const row = { id, title, path: rel, mime: TYPES[ext], size: buf.length, duration_sec: null, created_at: Date.now() };
  db.insert(audio).values(row).run();
  return c.json({ audio: row }, 201);
});

// DELETE /api/audio/:id（GM）
audioRoutes.delete('/audio/:id', requireGm, (c) => {
  const row = db.select().from(audio).where(eq(audio.id, c.req.param('id')!)).get();
  if (!row) return c.json({ error: 'Audio not found' }, 404);
  const file = path.join(getAudioDir(), row.path);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.delete(audio).where(eq(audio.id, row.id)).run();
  return c.json({ success: true });
});

// GET /api/audio/:id/file: 音声ファイル（表示ウィンドウが読む。プレイヤー向けの画像と同じく LAN 内に公開）
audioRoutes.get('/audio/:id/file', (c) => {
  const row = db.select().from(audio).where(eq(audio.id, c.req.param('id')!)).get();
  if (!row) return c.json({ error: 'Audio not found' }, 404);
  const base = getAudioDir();
  const file = path.resolve(base, row.path);
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) return c.json({ error: 'Audio file not found' }, 404);
  return new Response(fs.readFileSync(file), { headers: { 'Content-Type': row.mime, 'Cache-Control': 'no-cache' } });
});
