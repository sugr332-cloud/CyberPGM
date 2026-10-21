import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/index.js';
import { db } from '../src/db/client.js';
import { scenario_sessions } from '../src/db/schema.js';
import { isNull } from 'drizzle-orm';

// Phase 5j: 中断したシナリオを前回のシーンから再開する
describe('Resume an interrupted scenario (Phase 5j)', () => {
  let gm: string;
  const H = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${gm}` });
  const post = async (path: string, body: unknown = {}) =>
    app.request(path, { method: 'POST', headers: H(), body: JSON.stringify(body) });
  const resumable = async () =>
    (await (await app.request('/api/scenario-sessions/resumable', { headers: H() })).json()).resumable as Array<{
      session_id: string;
      scenario_id: string;
      scene_title: string | null;
    }>;

  beforeAll(async () => {
    gm = (await (await app.request('/api/auth/gm-token', { method: 'POST' })).json()).token;
    db.update(scenario_sessions).set({ ended_at: Date.now() }).where(isNull(scenario_sessions.ended_at)).run();
  });

  it('resumes from the last scene with revealed clues, and not after clear', async () => {
    const scenarioId = (await (await post('/api/scenarios', { title: '再開テスト', use_template: false })).json()).scenario.id;
    await post(`/api/scenarios/${scenarioId}/scenes`, { title: '導入', sort_index: 0 });
    const second = await (await post(`/api/scenarios/${scenarioId}/scenes`, { title: '倉庫', sort_index: 1 })).json();

    const sessionId = (await (await post('/api/scenario-sessions/start', { scenario_id: scenarioId })).json()).sessionId;
    await post(`/api/scenario-sessions/${sessionId}/move-scene`, { scene_id: second.id });
    db.update(scenario_sessions).set({ revealed: JSON.stringify({ clue_ids: ['x'], handout_ids: [] }) }).run();
    await post(`/api/scenario-sessions/${sessionId}/end`);

    const entry = (await resumable()).find((r) => r.scenario_id === scenarioId)!;
    expect(entry.session_id).toBe(sessionId);
    expect(entry.scene_title).toBe('倉庫');

    const res = await (await post(`/api/scenario-sessions/${sessionId}/resume`)).json();
    expect(res.current_scene_id).toBe(second.id);
    const active = (await (await app.request('/api/scenario-sessions/active', { headers: H() })).json()).session;
    expect(active.id).toBe(sessionId);
    expect(active.revealed.clue_ids).toEqual(['x']);
    expect((await resumable()).some((r) => r.scenario_id === scenarioId)).toBe(false);

    await post(`/api/scenario-sessions/${sessionId}/clear`);
    expect((await resumable()).some((r) => r.scenario_id === scenarioId)).toBe(false);
    expect((await post(`/api/scenario-sessions/${sessionId}/resume`)).status).toBe(409);
  });
});
