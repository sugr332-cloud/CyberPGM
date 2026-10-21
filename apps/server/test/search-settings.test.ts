import { describe, it, expect } from 'vitest';
import { app } from '../src/index.js';
import { runDemoSeed } from '../src/db/seed-demo.js';
import { showDvToPlayers } from '../src/routes/scenario-play.js';

// Phase 5n: 全文検索と、スマホに難易度を見せる設定
describe('Search and show-dv setting', () => {
  it('finds characters and items by name', async () => {
    runDemoSeed();
    const gm = (await (await app.request('/api/auth/gm-token', { method: 'POST' })).json()).token;
    const H = { Authorization: `Bearer ${gm}` };
    const res = await (await app.request(`/api/search?q=${encodeURIComponent('ヴァイパー')}`, { headers: H })).json();
    expect(res.hits.some((h: { kind: string; title: string }) => h.kind === 'character' && h.title === 'ヴァイパー')).toBe(true);
    expect((await app.request('/api/search?q=x')).status).toBeGreaterThanOrEqual(401); // GM でなければ見られない
  });

  it('stores whether phones see the difficulty', async () => {
    const gm = (await (await app.request('/api/auth/gm-token', { method: 'POST' })).json()).token;
    const H = { Authorization: `Bearer ${gm}`, 'Content-Type': 'application/json' };
    expect(showDvToPlayers()).toBe(true);
    await app.request('/api/settings/show-dv', { method: 'PUT', headers: H, body: JSON.stringify({ show_dv_to_players: false }) });
    expect(showDvToPlayers()).toBe(false);
    const got = await (await app.request('/api/settings/show-dv', { headers: H })).json();
    expect(got.show_dv_to_players).toBe(false);
    await app.request('/api/settings/show-dv', { method: 'PUT', headers: H, body: JSON.stringify({ show_dv_to_players: true }) });
  });
});
