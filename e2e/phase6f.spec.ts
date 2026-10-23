import { test, expect, type Page } from '@playwright/test';
import { createDb } from '../apps/server/src/db/client.js';
import { boards, board_tokens, characters, combat_participants, combats, items, weapons } from '../apps/server/src/db/schema.js';
import { joinAsPlayer } from './join.js';

const combatId='phase6f-combat', boardId='phase6f-board', gunId='phase6f-gun', smartId='phase6f-smart';
const ids=['phase6f-shooter','phase6f-target-pc','phase6f-target-npc'];
const names=['制圧射手','制圧対象PC','制圧対象NPC'];

test('Phase 6f suppressive rolls, shared ranged modifiers and phone equipment', async ({ browser, request }) => {
  test.setTimeout(90000);
  const { db, sqlite }=createDb(process.env.DATABASE_URL || 'data/test-e2e.db');
  const contexts=[] as Array<Awaited<ReturnType<typeof browser.newContext>>>;
  let phoneTarget: Page | undefined;
  try {
    for (const table of ['combat_log','combat_participants','combats']) sqlite.prepare(`DELETE FROM ${table}`).run();
    sqlite.prepare('DELETE FROM board_tokens WHERE board_id = ?').run(boardId);
    sqlite.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
    for (const id of ids) sqlite.prepare('DELETE FROM characters WHERE id = ?').run(id);
    for (const id of [gunId,smartId]) { sqlite.prepare('DELETE FROM weapons WHERE item_id = ?').run(id); sqlite.prepare('DELETE FROM items WHERE id = ?').run(id); }
    const now=Date.now();
    db.insert(items).values([
      {id:gunId,kind:'weapon',name_en:'Phase 6f Handgun',name_ja:'6f試験拳銃',origin:'homebrew',verify_status:'homebrew',created_at:now,updated_at:now},
      {id:smartId,kind:'upgrade',name_en:'Smartgun Link',name_ja:'スマートガン・リンク',raw_system:JSON.stringify({type:'weapon'}),origin:'homebrew',verify_status:'homebrew',created_at:now,updated_at:now},
    ] as any).run();
    db.insert(weapons).values({item_id:gunId,weapon_type:'heavyPistol',skill:'Handgun',damage:'2d6',rof:1,magazine_max:20,dv_table_key:'DV Pistol',is_ranged:true,suppressive:true} as any).run();
    const stats={int:6,ref:8,dex:6,tech:6,cool:6,will:6,luck:6,move:6,body:6,emp:6};
    db.insert(characters).values(ids.map((id,index)=>({
      id,kind:index===2?'npc':'pc',name:names[index],role:'Solo',stats:JSON.stringify(index===2?{...stats,will:50}:stats),skills:JSON.stringify({handgun:6,autofire:6,concentration:0,evasion:4}),hp:40,hp_max:40,sp_head:0,sp_body:0,humanity:60,emp_max:6,
      inventory:JSON.stringify(index===0?[{entry_id:'phase6f-weapon',item_id:gunId,name:'6f試験拳銃',kind:'weapon',qty:1,equipped:true,ammo:20,quality:'excellent',attachments:['phase6f-attachment']},{entry_id:'phase6f-lowweapon',item_id:gunId,name:'6f低品質拳銃',kind:'weapon',qty:1,ammo:20,quality:'poor'},{entry_id:'phase6f-attachment',item_id:smartId,name:'スマートガン・リンク',kind:'upgrade',qty:1}]:[]),
      cyberware:index===0?JSON.stringify([{name:'インターフェイス・プラグ'}]):'[]',created_at:now,updated_at:now,
    })) as any).run();
    db.insert(boards).values({id:boardId,name:'Phase 6f',grid:JSON.stringify({show:true,cell_m:2,cell_px:80,origin_x:0,origin_y:0,cols:20,rows:12}),created_at:now,updated_at:now}).run();
    db.insert(board_tokens).values(ids.map((id,index)=>({id:`phase6f-token-${index}`,board_id:boardId,character_id:id,x:[1,3,5][index],y:[4,4,5][index]})) as any).run();
    db.insert(combats).values({id:combatId,board_id:boardId,status:'active',round:1,turn_index:0,settings:JSON.stringify({hideEnemyStats:false}),created_at:now} as any).run();
    db.insert(combat_participants).values(ids.map((id,index)=>({id:`phase6f-part-${index}`,combat_id:combatId,character_id:id,side:index?'enemy':'ally',name:names[index],initiative:30-index,order_index:index,active:true,out:false,move_used:false,action_used:false,state:'{}'})) as any).run();

    const gmContext=await browser.newContext({viewport:{width:1440,height:1000}}); contexts.push(gmContext);
    const gm=await gmContext.newPage();
    const gmToken=(await (await request.post('/api/auth/gm-token')).json()).token;
    await gm.addInitScript((value)=>localStorage.setItem('cpgm_gm_token',value),gmToken);
    await gm.goto('/gm/combat');
    await gm.getByTestId('action-btn-ranged').click();
    await gm.getByRole('button',{name:names[1],exact:true}).click();
    await expect(gm.getByTestId('attack-line')).toContainText('高品質');
    await expect(gm.getByTestId('attack-line')).toContainText('スマートガン');
    await gm.screenshot({path:'docs/agy/reports/img/phase6f-modifier-line-1440.png',fullPage:true});

    const health=await (await request.get('/api/health')).json();
    const phoneContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}); contexts.push(phoneContext);
    const phone=await phoneContext.newPage();
    await joinAsPlayer(phone,health.session,names[0],'Phase 6f');
    await phone.getByTestId('player-tab-act').click();
    await phone.getByRole('button',{name:names[1],exact:true}).click();
    await expect(phone.getByTestId('bands-ranged')).toContainText('距離帯');
    await phone.screenshot({path:'docs/agy/reports/img/phase6f-modifier-line-390.png',fullPage:true});
    await phone.getByTestId('player-tab-gear').click();
    const weaponAttachments = phone.getByTestId('player-weapon-attachments').first();
    const attachment = weaponAttachments.getByRole('checkbox');
    await expect(weaponAttachments).toContainText('スマートガン・リンク');
    await expect(attachment).toBeChecked();
    await phone.screenshot({path:'docs/agy/reports/img/phase6f-weapon-attachments-390.png',fullPage:true});
    let attachmentUpdate = phone.waitForResponse((response) => response.url().endsWith('/api/me/weapon-attachments'));
    await attachment.click();
    expect((await attachmentUpdate).ok()).toBe(true);
    expect(JSON.parse((sqlite.prepare('SELECT inventory FROM characters WHERE id = ?').get(ids[0]) as any).inventory).find((entry:any)=>entry.entry_id==='phase6f-weapon').attachments).toEqual([]);
    attachmentUpdate = phone.waitForResponse((response) => response.url().endsWith('/api/me/weapon-attachments'));
    await attachment.click();
    expect((await attachmentUpdate).ok()).toBe(true);
    expect(JSON.parse((sqlite.prepare('SELECT inventory FROM characters WHERE id = ?').get(ids[0]) as any).inventory).find((entry:any)=>entry.entry_id==='phase6f-weapon').attachments).toEqual(['phase6f-attachment']);

    await gm.getByTestId('action-btn-ranged').click();
    await gm.locator('select').filter({hasText:'6f低品質拳銃'}).selectOption('phase6f-lowweapon');
    await gm.getByRole('button',{name:names[1],exact:true}).click();
    await gm.getByTestId('attack-roll-input').fill('1');
    await gm.getByTestId('attack-extra-input').fill('10');
    await gm.getByRole('button',{name:'判定と反映内容を計算',exact:true}).click();
    await expect(gm.getByText(/動作不良/)).toBeVisible();
    const malfunctionApply = gm.waitForResponse((response) => response.url().endsWith(`/api/combats/${combatId}/apply`));
    await gm.getByRole('button',{name:'確定して反映',exact:true}).click();
    expect((await malfunctionApply).ok()).toBe(true);
    expect(JSON.parse((sqlite.prepare('SELECT inventory FROM characters WHERE id = ?').get(ids[0]) as any).inventory).find((entry:any)=>entry.entry_id==='phase6f-lowweapon').malfunctioned).toBe(true);
    sqlite.prepare('UPDATE combat_participants SET action_used = 0 WHERE id = ?').run('phase6f-part-0');
    await gm.reload();
    await gm.getByTestId('action-btn-ranged').click();
    await gm.locator('select').filter({hasText:'6f低品質拳銃'}).selectOption('phase6f-lowweapon');
    await expect(gm.getByRole('button',{name:'判定と反映内容を計算',exact:true})).toBeDisabled();
    sqlite.prepare('UPDATE combat_participants SET action_used = 0 WHERE id = ?').run('phase6f-part-0');
    await gm.reload();
    await gm.getByTestId('action-btn-repair_weapon').click();
    await gm.locator('select').filter({hasText:'6f低品質拳銃'}).selectOption('phase6f-lowweapon');
    await gm.getByRole('button',{name:'判定と反映内容を計算',exact:true}).click();
    await expect(gm.getByText(/動作不良を直した/)).toBeVisible();
    const repairApply = gm.waitForResponse((response) => response.url().endsWith(`/api/combats/${combatId}/apply`));
    await gm.getByRole('button',{name:'確定して反映',exact:true}).click();
    expect((await repairApply).ok()).toBe(true);
    expect(JSON.parse((sqlite.prepare('SELECT inventory FROM characters WHERE id = ?').get(ids[0]) as any).inventory).find((entry:any)=>entry.entry_id==='phase6f-lowweapon').malfunctioned).toBe(false);
    sqlite.prepare('UPDATE combat_participants SET action_used = 0 WHERE id = ?').run('phase6f-part-0');
    await gm.reload();

    const targetContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}); contexts.push(targetContext);
    phoneTarget=await targetContext.newPage();
    await joinAsPlayer(phoneTarget,health.session,names[1],'Phase 6f target');
    await phoneTarget.getByTestId('player-tab-act').click();

    await gm.getByTestId('action-btn-suppressive').click();
    await gm.getByLabel('制圧射撃の向き').selectOption('E');
    await expect(gm.getByTestId('suppressive-targets')).toContainText('盤面候補');
    await gm.getByTestId('attack-roll-input').fill('10');
    await gm.getByTestId('attack-extra-input').fill('10');
    await gm.getByRole('button',{name:'スマホで出目を入力'}).first().click();
    await expect(phoneTarget.getByText('制圧射撃への抵抗')).toBeVisible();
    await phoneTarget.getByRole('button',{name:'2',exact:true}).click();
    await phoneTarget.getByRole('button',{name:'GM に出目を送信',exact:true}).click();
    await expect(gm.getByLabel(`${names[1]} の制圧抵抗出目`)).toHaveValue('2');
    await gm.getByLabel(`${names[2]} の制圧抵抗出目`).fill('10');
    await gm.getByLabel(`${names[2]} の抵抗追加出目`).fill('10');
    await gm.getByRole('button',{name:'判定と反映内容を計算',exact:true}).click();
    await expect(gm.getByText(/制圧対象PC:.*敗北・制圧/)).toBeVisible();
    await expect(gm.getByText(/制圧対象NPC:.*抵抗/)).toBeVisible();
    await gm.screenshot({path:'docs/agy/reports/img/phase6f-suppressive-1440.png',fullPage:true});
    const applied = gm.waitForResponse((response) => response.url().endsWith(`/api/combats/${combatId}/apply`));
    await gm.getByRole('button',{name:'確定して反映',exact:true}).click();
    expect((await applied).ok()).toBe(true);
    const state=JSON.parse((sqlite.prepare('SELECT state FROM combat_participants WHERE id = ?').get('phase6f-part-1') as any).state);
    expect(state.suppressive_move_to_cover).toBeTruthy();
  } finally {
    for (const context of contexts) await context.close();
    sqlite.prepare('DELETE FROM combat_participants WHERE combat_id = ?').run(combatId);
    sqlite.prepare('DELETE FROM combats WHERE id = ?').run(combatId);
    sqlite.prepare('DELETE FROM board_tokens WHERE board_id = ?').run(boardId);
    sqlite.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
    for (const id of ids) sqlite.prepare('DELETE FROM characters WHERE id = ?').run(id);
    for (const id of [gunId,smartId]) { sqlite.prepare('DELETE FROM weapons WHERE item_id = ?').run(id); sqlite.prepare('DELETE FROM items WHERE id = ?').run(id); }
    sqlite.close();
  }
});
