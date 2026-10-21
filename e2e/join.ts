import { expect, type Page } from '@playwright/test';

/**
 * スマホで参加 QR を開き、「あなたは？」で名前を登録して、キャラを選ぶ（Phase 5i）。
 * 前のテストで別の人のキャラになっていたり、別のシナリオに入っていたりすると選べないので、先に外しておく。
 */
export async function joinAsPlayer(page: Page, code: string, charName: string, playerName = 'E2E') {
  const gm = (await (await page.request.post('/api/auth/gm-token')).json()).token;
  const H = { Authorization: `Bearer ${gm}`, 'Content-Type': 'application/json' };
  const chars: Array<{ id: string; name: string }> = (await (await page.request.get('/api/characters', { headers: H })).json()).characters;
  const target = chars.find((c) => c.name === charName);
  if (target) await page.request.patch(`/api/characters/${target.id}`, { headers: H, data: { player_id: null, scenario_id: null } });

  await page.goto(`/player?join=${code}`);
  await page.getByPlaceholder('例: たろう').fill(playerName);
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByText('キャラクターを選択:')).toBeVisible();
  await page.getByRole('button', { name: new RegExp(charName) }).click();
}
