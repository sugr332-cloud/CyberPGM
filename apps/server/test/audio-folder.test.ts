import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { app } from '../src/index.js';
import { getAudioDir } from '../src/routes/audio.js';

// Phase 5n: BGM フォルダ（data/audio）に置いた曲が一覧に出て、消すと一覧からも消える
describe('BGM folder', () => {
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]);

  it('lists songs placed in the BGM folder (with subfolders) and drops removed ones', async () => {
    const gm = (await (await app.request('/api/auth/gm-token', { method: 'POST' })).json()).token;
    const H = { Authorization: `Bearer ${gm}` };
    const dir = getAudioDir();
    fs.mkdirSync(path.join(dir, '戦闘'), { recursive: true });
    fs.writeFileSync(path.join(dir, '雨の街.mp3'), mp3);
    fs.writeFileSync(path.join(dir, '戦闘', 'ボス戦.mp3'), mp3);
    fs.writeFileSync(path.join(dir, 'メモ.txt'), 'x');

    const list = (await (await app.request('/api/audio', { headers: H })).json()).audio as Array<{ id: string; title: string }>;
    const titles = list.map((a) => a.title);
    expect(titles).toContain('雨の街');
    expect(titles).toContain('戦闘 / ボス戦');
    expect(titles).not.toContain('メモ');

    // 曲ファイルを再生できる
    const rain = list.find((a) => a.title === '雨の街')!;
    const file = await app.request(`/api/audio/${rain.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Type')).toBe('audio/mpeg');

    fs.unlinkSync(path.join(dir, '雨の街.mp3'));
    const after = (await (await app.request('/api/audio', { headers: H })).json()).audio as Array<{ title: string }>;
    expect(after.map((a) => a.title)).not.toContain('雨の街');
    expect(after.map((a) => a.title)).toContain('戦闘 / ボス戦');
  });
});
