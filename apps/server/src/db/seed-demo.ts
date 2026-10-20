import { eq } from 'drizzle-orm';
import { db } from './client.js';
import { characters } from './schema.js';
import { generateUlid } from '@cyberpgm/shared';

export interface DemoPcSeed {
  name: string;
  role: string;
  stats: {
    int: number;
    ref: number;
    dex: number;
    tech: number;
    cool: number;
    will: number;
    luck: number;
    move: number;
    body: number;
    emp: number;
  };
  skills: Record<string, number>;
  hp: number;
  hp_max: number;
  sp_head: number;
  sp_body: number;
  humanity: number;
  emp_max: number;
  cyberware: Array<{ name: string; type?: string; static_loss?: number }>;
  weapons: string[];
  eb: number;
}

const DEMO_PCS: DemoPcSeed[] = [
  {
    name: 'ヴァイパー',
    role: 'ソロ',
    stats: { int: 4, ref: 8, dex: 7, tech: 3, cool: 6, will: 5, luck: 5, move: 6, body: 7, emp: 5 },
    skills: {
      handgun: 6,
      evasion: 6,
      brawling: 4,
      shoulder_arms: 4,
      athletics: 4,
      perception: 5,
      stealth: 4,
    },
    hp: 35,
    hp_max: 35,
    sp_head: 11,
    sp_body: 11,
    humanity: 42,
    emp_max: 5,
    cyberware: [{ name: 'サイバーアイ', type: 'cyberoptics', static_loss: 2 }],
    weapons: ['ヘビー・ピストル', 'アサルト・ライフル'],
    eb: 800,
  },
  {
    name: 'ニクス',
    role: 'ネットランナー',
    stats: { int: 8, ref: 6, dex: 5, tech: 7, cool: 5, will: 6, luck: 6, move: 5, body: 4, emp: 6 },
    skills: {
      basic_tech: 6,
      cybertech: 6,
      electronics_security_tech: 6,
      handgun: 4,
      evasion: 4,
      perception: 6,
    },
    hp: 30,
    hp_max: 30,
    sp_head: 7,
    sp_body: 7,
    humanity: 52,
    emp_max: 6,
    cyberware: [{ name: 'ニューラル・リンク', type: 'neuralware', static_loss: 4 }],
    weapons: ['ミディアム・ピストル'],
    eb: 1200,
  },
  {
    name: 'ドク・ハル',
    role: 'メディック',
    stats: { int: 7, ref: 5, dex: 6, tech: 8, cool: 5, will: 6, luck: 4, move: 5, body: 6, emp: 7 },
    skills: {
      first_aid: 6,
      paramedic: 6,
      basic_tech: 4,
      handgun: 4,
      evasion: 4,
      human_perception: 5,
    },
    hp: 35,
    hp_max: 35,
    sp_head: 7,
    sp_body: 11,
    humanity: 60,
    emp_max: 7,
    cyberware: [],
    weapons: ['ヘビー・ピストル'],
    eb: 500,
  },
  {
    name: 'ジンジャー',
    role: 'フィクサー',
    stats: { int: 6, ref: 6, dex: 5, tech: 4, cool: 8, will: 6, luck: 7, move: 6, body: 5, emp: 7 },
    skills: {
      trading: 6,
      persuasion: 6,
      streetwise: 6,
      conversation: 5,
      human_perception: 5,
      handgun: 4,
      evasion: 4,
    },
    hp: 30,
    hp_max: 30,
    sp_head: 7,
    sp_body: 7,
    humanity: 64,
    emp_max: 7,
    cyberware: [{ name: 'ボイス・シンセサイザー', type: 'cyberaudio', static_loss: 2 }],
    weapons: ['ミディアム・ピストル'],
    eb: 2500,
  },
];

export function runDemoSeed(): { created: string[]; skipped: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];
  const now = Date.now();

  for (const pc of DEMO_PCS) {
    const existing = db
      .select()
      .from(characters)
      .where(eq(characters.name, pc.name))
      .get();

    if (existing) {
      skipped.push(pc.name);
      continue;
    }

    const id = generateUlid();
    db.insert(characters)
      .values({
        id,
        kind: 'pc',
        name: pc.name,
        role: pc.role,
        image_id: null,
        stats: JSON.stringify(pc.stats),
        skills: JSON.stringify(pc.skills),
        hp: pc.hp,
        hp_max: pc.hp_max,
        sp_head: pc.sp_head,
        sp_body: pc.sp_body,
        humanity: pc.humanity,
        emp_max: pc.emp_max,
        cyberware: JSON.stringify(pc.cyberware),
        weapons: JSON.stringify(pc.weapons),
        inventory: JSON.stringify([]),
        status: JSON.stringify([]),
        crit_injuries: JSON.stringify([]),
        eb: pc.eb,
        notes_gm: null,
        created_at: now,
        updated_at: now,
      })
      .run();

    created.push(pc.name);
  }

  return { created, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = runDemoSeed();
  console.log(`Demo seed completed. Created: ${res.created.join(', ') || 'none'}, Skipped: ${res.skipped.join(', ') || 'none'}`);
}
