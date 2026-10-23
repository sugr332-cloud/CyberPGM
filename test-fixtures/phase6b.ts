import type { LoreData, NpcTemplatesData } from '@cyberpgm/shared';

// 自作の試験用資料。本の本文・NPC データを収録しない。
export const loreFixture: LoreData = {
  categories: { timeline: '年表', world: '世界観', corp: '企業' },
  entries: [
    { id: 'test-late', category: 'timeline', title: 'テスト都市の再開発', year: '2045', pages: [12], summary: '試験用の年表。ＮＥＯ社が港を再開発する。', body: ['物資を運ぶ運河が完成。'], tags: ['港', '開発'], related: ['test-corp'] },
    { id: 'test-early', category: 'timeline', title: 'テスト都市の設立', year: '1999〜2001', pages: [15], summary: '試験用の都市が設立された。', body: ['試験用の年表項目。'], tags: ['都市'] },
    { id: 'test-corp', category: 'corp', title: 'NEO 社（テスト資料）', pages: [5], summary: '運河の運送を行う架空の会社。', body: ['シナリオ用の試験メモ。'], tags: ['運送'], related: ['test-late'] },
    { id: 'test-world', category: 'world', title: '試験用の生活風景', pages: [8], summary: '港の朝は賑やか。', body: ['市場に船が集まる。'], tags: ['日常'] },
    { id: 'test-width', category: 'timeline', title: '運河の計画', year: '２００２', pages: [14], summary: '試験用の計画記録。', body: [], tags: [] },
  ],
};

const stats = { int: 3, ref: 6, dex: 5, tech: 2, cool: 4, will: 4, luck: 0, move: 4, body: 6, emp: 3 };
export const npcFixture: NpcTemplatesData = {
  tiers: { 雑魚: 'テスト用: PC と同じ人数を目安にする', 幹部: 'テスト用: PC 2 人に 1 人を目安にする' },
  npcs: [
    { key: 'test-guard', name: 'テスト護衛6b', tier: '雑魚', page: 1, stats, hp: 35,
      armor: { name: '試験用防具6b', head: 7, body: 7, penalty: 2 },
      weapons: [{ name: '低品質のヘビー・ピストル', damage: '3d6' }, { name: '未知の試験武器6b', damage: '2d6' }],
      skills: { ハンドガン: 10, '言語：母語': 5, '土地鑑：自分の居住地': 6, '科学：化学': 7, 知覚: 1, 未知の技能6b: 10 },
      gear: ['試験用装備6b×2', '未知の装備6b'], programs: ['試験用プログラム6b', '未知のプログラム6b'] },
    ...([{ key: 'test-net', role: 'Netrunner', ability: 'インターフェイス' },
      { key: 'test-nomad', role: 'Nomad', ability: 'モト' },
      { key: 'test-solo', role: 'Solo', ability: 'コンバット・アウェアネス' }]).map(({ key, role, ability }) => ({
      key, name: `試験用${role}`, tier: '幹部', page: 2, stats, hp: 25,
      armor: { name: '試験用防具6b', head: 7, body: 7 }, weapons: [],
      role, role_rank: 3, skills: { [ability]: 3, ハンドガン: 10 },
    })),
  ],
};
