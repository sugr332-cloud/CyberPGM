/**
 * ネットランニング（Phase 5z。日本語版コアルールブック p.196〜218）
 */
import { generateUlid } from './ulid.js';

export type NetDifficultyKey = 'basic' | 'standard' | 'uncommon' | 'advanced';

export interface NetDifficultyDef {
  name: string;
  dv: number;
  floorCostEb: number;
}

export const NET_DIFFICULTIES: Record<NetDifficultyKey, NetDifficultyDef> = {
  basic: { name: '初歩的', dv: 6, floorCostEb: 1000 },
  standard: { name: '標準的', dv: 8, floorCostEb: 2500 },
  uncommon: { name: '例外的', dv: 10, floorCostEb: 5000 },
  advanced: { name: '先進的', dv: 12, floorCostEb: 10000 },
};

export const DECK_SLOTS: Record<'Poor' | 'Standard' | 'Excellent', number> = {
  Poor: 5,
  Standard: 7,
  Excellent: 9,
};

export interface BlackIceDef {
  en: string;
  name: string;
  class: 'antipersonnel' | 'antiprogram';
  per: number;
  spd: number;
  atk: number;
  def: number;
  rez: number;
  effect: 'destroy_program' | 'brain' | 'stats' | 'skunk' | 'program';
  dice?: number;
  forceOut?: boolean;
  fire?: boolean;
  pin?: boolean;
  statsDown?: Array<'int' | 'ref' | 'dex' | 'move'>;
  destroyDefender?: boolean;
  slow?: boolean;
  price: number;
}

export const BLACK_ICE_CATALOG: BlackIceDef[] = [
  { en: 'Asp', name: 'アスプ', class: 'antipersonnel', per: 4, spd: 6, atk: 2, def: 2, rez: 15, effect: 'destroy_program', price: 100 },
  { en: 'Giant', name: 'ジャイアント', class: 'antipersonnel', per: 2, spd: 2, atk: 8, def: 4, rez: 25, effect: 'brain', dice: 3, forceOut: true, price: 1000 },
  { en: 'Hellhound', name: 'ヘルハウンド', class: 'antipersonnel', per: 6, spd: 6, atk: 6, def: 2, rez: 20, effect: 'brain', dice: 2, fire: true, price: 500 },
  { en: 'Kraken', name: 'クラーケン', class: 'antipersonnel', per: 6, spd: 2, atk: 8, def: 4, rez: 30, effect: 'brain', dice: 3, pin: true, price: 1000 },
  { en: 'Liche', name: 'リッチ', class: 'antipersonnel', per: 8, spd: 2, atk: 6, def: 2, rez: 25, effect: 'stats', statsDown: ['int', 'ref', 'dex'], price: 500 },
  { en: 'Raven', name: 'レイヴン', class: 'antipersonnel', per: 6, spd: 4, atk: 4, def: 2, rez: 15, effect: 'brain', dice: 1, destroyDefender: true, price: 50 },
  { en: 'Scorpion', name: 'スコーピオン', class: 'antipersonnel', per: 2, spd: 6, atk: 2, def: 2, rez: 15, effect: 'stats', statsDown: ['move'], price: 100 },
  { en: 'Skunk', name: 'スカンク', class: 'antipersonnel', per: 2, spd: 4, atk: 4, def: 2, rez: 10, effect: 'skunk', price: 500 },
  { en: 'Wisp', name: 'ウィスプ', class: 'antipersonnel', per: 4, spd: 4, atk: 4, def: 2, rez: 15, effect: 'brain', dice: 1, slow: true, price: 50 },
  { en: 'Dragon', name: 'ドラゴン', class: 'antiprogram', per: 6, spd: 4, atk: 6, def: 6, rez: 30, effect: 'program', dice: 6, price: 1000 },
  { en: 'Killer', name: 'キラー', class: 'antiprogram', per: 4, spd: 8, atk: 6, def: 2, rez: 20, effect: 'program', dice: 4, price: 500 },
  { en: 'Sabertooth', name: 'セイバートゥース', class: 'antiprogram', per: 8, spd: 6, atk: 6, def: 2, rez: 25, effect: 'program', dice: 6, price: 1000 },
];

export interface DemonDef {
  en: string;
  name: string;
  rez: number;
  interface: number;
  actions: number;
  combat: number;
  price: number;
}

export const DEMON_CATALOG: DemonDef[] = [
  { en: 'Imp', name: 'インプ', rez: 15, interface: 3, actions: 2, combat: 14, price: 1000 },
  { en: 'Efreet', name: 'イフリート', rez: 25, interface: 4, actions: 3, combat: 14, price: 5000 },
  { en: 'Balron', name: 'バルロン', rez: 30, interface: 7, actions: 4, combat: 14, price: 10000 },
];

export type NetProgramClass = 'booster' | 'defender' | 'antipersonnelattacker' | 'antiprogramattacker';

export interface NetProgramDef {
  en: string;
  name: string;
  aliases?: string[];
  class: NetProgramClass;
  atk: number;
  def: number;
  rez: number;
  price: number;
  slots: number;
  effect: string;
}

export const NET_PROGRAMS: NetProgramDef[] = [
  // ブースター（4種）
  { en: 'Eraser', name: 'イレイサ', aliases: ['イレイサー'], class: 'booster', atk: 0, def: 0, rez: 7, price: 20, slots: 1, effect: '起動中クローク +2' },
  { en: 'See Ya', name: 'シーヤ', aliases: ['シー・ヤ'], class: 'booster', atk: 0, def: 0, rez: 7, price: 20, slots: 1, effect: '起動中パスファインダー +2' },
  { en: 'Speedy Gonzalvez', name: 'スピーディ・ゴンザルヴェス', class: 'booster', atk: 0, def: 0, rez: 7, price: 100, slots: 1, effect: '起動中 SPD +2' },
  { en: 'Worm', name: 'ワーム', class: 'booster', atk: 0, def: 0, rez: 7, price: 50, slots: 1, effect: '起動中バックドア +2' },
  // ディフェンダー（3種）
  { en: 'Armor', name: 'アーマー', class: 'defender', atk: 0, def: 0, rez: 7, price: 50, slots: 1, effect: '脳ダメージ −4（1枚のみ起動可、ネットラン1回につき1度）' },
  { en: 'Shield', name: 'シールド', class: 'defender', atk: 0, def: 0, rez: 7, price: 20, slots: 1, effect: '非ブラックICEからの最初の脳ダメージを防いで停止' },
  { en: 'Flak', name: 'フラック', class: 'defender', atk: 0, def: 0, rez: 7, price: 50, slots: 1, effect: '非ブラックICE攻撃プログラムの ATK を 0 にし停止（1枚のみ起動可）' },
  // 対人攻撃プログラム（6種）
  { en: 'DeckKRASH', name: 'デッキKRASH', aliases: ['デッキ・クラッシュ'], class: 'antipersonnelattacker', atk: 0, def: 0, rez: 0, price: 100, slots: 1, effect: '目標を強制的に安全でないジャックアウトさせる' },
  { en: 'Hellbolt', name: 'ヘルボルト', class: 'antipersonnelattacker', atk: 2, def: 0, rez: 0, price: 100, slots: 1, effect: '2d6 脳ダメージ＋着火（毎ターン末2ダメージ）' },
  { en: 'Nervescrub', name: 'ナーヴスクラブ', class: 'antipersonnelattacker', atk: 0, def: 0, rez: 0, price: 100, slots: 1, effect: 'INT・REF・DEX を 1時間 1d6 低下（最低 1）' },
  { en: 'Poison Flatline', name: 'ポイズン・フラットライン', class: 'antipersonnelattacker', atk: 0, def: 0, rez: 0, price: 100, slots: 1, effect: '敵デッキの非ブラックICEプログラム 1つを無作為に破壊' },
  { en: 'Superglue', name: 'スーパーグルー', class: 'antipersonnelattacker', atk: 2, def: 0, rez: 0, price: 100, slots: 1, effect: '1d6 ラウンド先へ進めず安全にジャックアウトも不可（1ネットラン1回）' },
  { en: 'Vrizzbolt', name: 'ヴリズボルト', class: 'antipersonnelattacker', atk: 1, def: 0, rez: 0, price: 50, slots: 1, effect: '1d6 脳ダメージ＋次ターンの NET アクション −1（最低 2）' },
  // 対プログラム攻撃プログラム（2種）
  { en: 'Banhammer', name: 'バンハンマー', class: 'antiprogramattacker', atk: 1, def: 0, rez: 0, price: 50, slots: 1, effect: '非ブラックICEに 3d6 REZ、ブラックICEに 2d6 REZ' },
  { en: 'Sword', name: 'ソード', aliases: ['剣'], class: 'antiprogramattacker', atk: 1, def: 0, rez: 0, price: 50, slots: 1, effect: 'ブラックICEに 3d6 REZ、非ブラックICEに 2d6 REZ' },
];

export interface NetHardwareDef {
  en: string;
  name: string;
  aliases?: string[];
  slots: number;
  price: number;
  effect: string;
}

export const NET_HARDWARE: NetHardwareDef[] = [
  { en: 'Backup Drive', name: 'バックアップ・ドライブ', aliases: ['バックアップ ・ドライブ'], slots: 2, price: 100, effect: '破壊された非ブラックICEプログラムを保存（肉体アクションで再インストール可）' },
  { en: 'DNA Lock', name: 'DNA ロック', aliases: ['DNAロック'], slots: 2, price: 100, effect: '生体認証ロック（電子／セキュリティ技術 DV17 で解除）' },
  { en: 'Hardened Circuitry', name: 'ハードンド・サーキット', slots: 1, price: 100, effect: 'EMP効果でデッキが無効化・破壊されない' },
  { en: 'Insulated Wiring', name: 'インスレーテッド・ワイヤリング', slots: 1, price: 100, effect: 'ヘルボルト・ヘルハウンド等でデッキや衣服が着火しない' },
  { en: 'KRASH Barrier', name: 'KRASHバリア', aliases: ['KRASH バリア'], slots: 2, price: 100, effect: '強制ジャックアウト効果（デッキKRASH・ジャイアント等）を無効化' },
  { en: 'Range Upgrade', name: 'レンジ・アップグレード', slots: 1, price: 100, effect: 'アクセスポイントへの接続距離を 6m → 8m に延長' },
];

export interface NetSecurityDef {
  key: string;
  name: string;
  trigger: 'passive' | 'active' | 'both';
  triggerLabel: string;
  disarmDv: number;
  disarmTime: string;
  hp: number | null;
  sp: number;
  move: number;
  combat: number;
  stationary: boolean;
  defaultWeaponEn?: string;
  summary: string;
}

export const NET_SECURITIES: NetSecurityDef[] = [
  { key: 'laser_tripwire', name: 'レーザートリップワイヤー', trigger: 'passive', triggerLabel: '受動（知覚で発見可）', disarmDv: 13, disarmTime: '5 分', hp: null, sp: 0, move: 0, combat: 0, stationary: true, summary: '通過すると連動した防御手段を発動' },
  { key: 'hidden_camera', name: '隠しカメラ', trigger: 'passive', triggerLabel: '受動（知覚で発見可）', disarmDv: 13, disarmTime: '5 分', hp: null, sp: 0, move: 0, combat: 0, stationary: true, summary: '侵入者を監視・記録する' },
  { key: 'motion_sensor', name: '赤外線／動体センサー', trigger: 'passive', triggerLabel: '受動（知覚で発見可）', disarmDv: 15, disarmTime: '5 分', hp: 1, sp: 0, move: 0, combat: 0, stationary: true, summary: '熱や動きを検知して防御手段を発動' },
  { key: 'biometric_lock', name: '生体認証ロック', trigger: 'passive', triggerLabel: '受動', disarmDv: 17, disarmTime: '5 分', hp: null, sp: 0, move: 0, combat: 0, stationary: true, summary: '扉やコンテナの電子ロック' },
  { key: 'floodlight', name: '重点照明', trigger: 'both', triggerLabel: '受動／制御ノード', disarmDv: 13, disarmTime: '5 分', hp: 5, sp: 0, move: 0, combat: 0, stationary: true, summary: '眩惑により射撃・近接 −2（UV等対応サイバーアイで無効）' },
  { key: 'fire_suppression', name: '消火システム', trigger: 'both', triggerLabel: '受動／制御ノード', disarmDv: 13, disarmTime: '5 分', hp: 10, sp: 0, move: 0, combat: 0, stationary: true, summary: '消火泡・煙で視界悪化 −4（赤外線等で無効）' },
  { key: 'pit_trap', name: '落とし穴と隠し扉', trigger: 'both', triggerLabel: '受動／制御ノード', disarmDv: 15, disarmTime: '5 分', hp: 25, sp: 0, move: 0, combat: 0, stationary: true, summary: '10m 落下（落下ダメージと片脚損傷判定 DV15）' },
  { key: 'reinforced_door', name: '強化扉とシャッター', trigger: 'active', triggerLabel: '制御ノード', disarmDv: 17, disarmTime: '5 分', hp: 50, sp: 15, move: 0, combat: 0, stationary: true, summary: '通路を封鎖する重装甲の扉・シャッター' },
  { key: 'laser_grid', name: 'レーザーグリッド', trigger: 'both', triggerLabel: '受動／制御ノード', disarmDv: 17, disarmTime: '5 分', hp: 25, sp: 0, move: 0, combat: 14, stationary: true, summary: '通過者に 6d6 ダメージ（防具SP半分）' },
  { key: 'electric_floor', name: '電気床', trigger: 'both', triggerLabel: '受動／制御ノード', disarmDv: 17, disarmTime: '5 分', hp: 30, sp: 0, move: 0, combat: 14, stationary: true, summary: '床上の対象に 3d6 直接ダメージ（WILL+耐久 DV15 で行動可）' },
  { key: 'auto_turret', name: '固定式自動砲塔', trigger: 'active', triggerLabel: '自動（制御ノード）', disarmDv: 17, disarmTime: '5 分', hp: 25, sp: 0, move: 0, combat: 14, stationary: true, defaultWeaponEn: 'Assault Rifle', summary: '組み込まれた銃器で攻撃（デーモン戦闘値 14 または操作者の技能）' },
  { key: 'ceiling_drone', name: '天井搭載式ドローン', trigger: 'active', triggerLabel: '自動（制御ノード）', disarmDv: 17, disarmTime: '5 分', hp: 25, sp: 7, move: 6, combat: 14, stationary: false, defaultWeaponEn: 'Submachine Gun', summary: '天井レールに沿って MOVE 6 で移動し攻撃（戦闘値 14）' },
  { key: 'mini_drone', name: '自律小型ドローン', trigger: 'active', triggerLabel: '自動（制御ノード）', disarmDv: 17, disarmTime: '5 分', hp: 15, sp: 0, move: 8, combat: 14, stationary: false, defaultWeaponEn: 'Medium Pistol', summary: '飛行 MOVE 8（または歩行 MOVE 4）で追尾し攻撃（戦闘値 14）' },
];

export type NetSubActionKey =
  | 'jack_in'
  | 'jack_out'
  | 'unsafe_jack_out'
  | 'descend'
  | 'activate'
  | 'zap'
  | 'program'
  | 'backdoor'
  | 'cloak'
  | 'control'
  | 'eyedee'
  | 'pathfinder'
  | 'slide'
  | 'virus';

export const NET_SUB_ACTIONS: Array<{ key: NetSubActionKey; name: string; usesNetAction: boolean; desc: string }> = [
  { key: 'jack_in', name: 'ジャックイン', usesNetAction: true, desc: 'アクセスポイント（6m以内・射線あり）から NET アーキテクチャに接続' },
  { key: 'pathfinder', name: 'パスファインダー', usesNetAction: true, desc: 'インタフェース + 1d10（シーヤで+2）階層まで先を見通す（高DVパスワードで停止）' },
  { key: 'descend', name: '階層移動', usesNetAction: true, desc: '次の階層へ進む／戻る（移動自体は NET アクション不要、遭遇 ICE があれば先制判定）' },
  { key: 'backdoor', name: 'バックドア', usesNetAction: true, desc: 'インタフェース + 1d10（ワームで+2）vs パスワード DV でロック解除' },
  { key: 'eyedee', name: 'アイディール', usesNetAction: true, desc: 'インタフェース + 1d10 vs ファイル DV で中身を確認・コピー' },
  { key: 'control', name: 'コントロール', usesNetAction: true, desc: 'インタフェース + 1d10 vs 制御ノード DV で支配下に置く／装置を 1 回動かす' },
  { key: 'activate', name: 'プログラム起動・停止', usesNetAction: true, desc: 'デッキのプログラムまたはブラック ICE を起動（Rez）／停止（Derez）' },
  { key: 'zap', name: 'ザップ', usesNetAction: true, desc: 'インタフェース + 1d10 vs 防御で 1d6 ダメージ（プログラム REZ または脳ダメージ）' },
  { key: 'program', name: '攻撃プログラム', usesNetAction: true, desc: '剣・バンハンマー・対人攻撃プログラムで攻撃（各コピー1ターン1回）' },
  { key: 'slide', name: 'スライド', usesNetAction: true, desc: 'インタフェース + 1d10 vs ブラック ICE の PER + 1d10 で1体を振り切って隣階層へ移動（1ターン1回）' },
  { key: 'cloak', name: 'クローク', usesNetAction: true, desc: 'インタフェース + 1d10（イレイサで+2）を出目の難易度として痕跡を隠す' },
  { key: 'virus', name: 'ウイルス', usesNetAction: true, desc: '最下層（根）でのみ実行。指定 NET アクション数と難易度をクリアして改変を残す' },
  { key: 'jack_out', name: 'ジャックアウト', usesNetAction: true, desc: '安全に接続を切る（クラーケン・スーパーグルーの移動封じ中は不可）' },
  { key: 'unsafe_jack_out', name: '安全でないジャックアウト', usesNetAction: false, desc: '残っているブラック ICE すべての効果を受けて強制切断' },
];

export interface NetDeckConfig {
  quality?: 'Poor' | 'Standard' | 'Excellent';
  slots: number;
  programs: string[];
  black_ice: string[];
  hardware?: string[];
  backup_saved?: string[];
}

export interface NetStatDrain {
  hours: number;
  stats: Partial<Record<'int' | 'ref' | 'dex' | 'move', number>>;
}

export interface RezzedProgram {
  key: string;
  name: string;
  class: string;
  rez: number;
  rez_max: number;
  atk?: number;
  def?: number;
  spd?: number;
  per?: number;
  used_this_turn?: boolean;
  copy_index?: number;
  floor?: number;
}

export interface ActiveFloorIce {
  id: string;
  floor: number;
  en: string;
  name: string;
  class: 'antipersonnel' | 'antiprogram';
  per: number;
  spd: number;
  atk: number;
  def: number;
  rez: number;
  rez_max: number;
  participant_id?: string;
}

export interface NetRunState {
  arch_id?: string | null;
  depth: number;
  branch?: string;
  jacked_in: boolean;
  rezzed: RezzedProgram[];
  broken: string[];
  armor_used_copies?: number[];
  shield_used_copies?: number[];
  superglue_used_copies?: number[];
  controlled: string[];
  controlled_scores?: Record<string, number>;
  controlled_used_this_turn?: string[];
  unlocked_passwords?: number[];
  identified_files?: number[];
  slid_ice?: string[];
  slid_this_turn?: boolean;
  active_ice?: ActiveFloorIce[];
  net_used: number;
  skunk: number;
  pinned_until?: number;
  pinned_by_ice?: string;
  slowed?: boolean;
  slowed_just_set?: boolean;
  revealed: number[];
  cloak?: number;
  virus_progress?: {
    description: string;
    actions_needed: number;
    actions_spent: number;
    dv: number;
  } | null;
}

export interface NetFloor {
  floor: number;       // 1-based index in the architecture
  depth: number;       // Distance from entry (1 = first floor)
  branch: string;      // 'main' | 'B1' | 'B2' ...
  parent_floor?: number | null;
  raw: string;         // e.g. 'password:8', 'file:6', 'control:10', 'ice:Hellhound', 'demon:Imp'
  kind: 'file' | 'password' | 'control' | 'ice' | 'demon' | 'empty';
  dv?: number;
  label?: string;
  node?: string;
  note?: string;
  ice?: string[];      // Black ICE English or Japanese names on this floor
  demon?: string;      // Demon English or Japanese name on this floor
}

export interface NetVirusRecord {
  id: string;
  author_name: string;
  description: string;
  dv: number;
  created_at: number;
}

export interface NetArchitecture {
  id: string;
  name: string;
  difficulty: NetDifficultyKey;
  dv: number;
  floors: NetFloor[];
  viruses?: NetVirusRecord[];
  notes?: string;
  created_at: number;
  updated_at: number;
}

export interface NetrunData {
  blackIce: BlackIceDef[];
  demons: DemonDef[];
  difficulties: Record<NetDifficultyKey, { name: string; dv: number }>;
  lobby: string[];
  floors: Record<NetDifficultyKey, Record<string, string>>;
  decks: Record<'Poor' | 'Standard' | 'Excellent', number>;
}

export const DEFAULT_LOBBY_TABLE: string[] = [
  'file:6',
  'password:6',
  'password:8',
  'ice:Skunk',
  'ice:Wisp',
  'ice:Killer',
];

export const DEFAULT_FLOORS_TABLE: Record<NetDifficultyKey, Record<string, string>> = {
  basic: {
    '3': 'ice:Hellhound',
    '4': 'ice:Sabertooth',
    '5': 'ice:Kraken',
    '6': 'ice:Raven',
    '7': 'password:6',
    '8': 'file:6',
    '9': 'control:6',
    '10': 'password:6',
    '11': 'demon:Imp',
    '12': 'password:6',
    '13': 'control:6',
    '14': 'file:6',
    '15': 'ice:Wisp',
    '16': 'ice:Scorpion',
    '17': 'ice:Killer',
    '18': 'ice:Skunk,Scorpion',
  },
  standard: {
    '3': 'ice:Hellhound,Hellhound',
    '4': 'ice:Hellhound,Killer',
    '5': 'ice:Skunk,Skunk',
    '6': 'ice:Sabertooth',
    '7': 'ice:Scorpion',
    '8': 'ice:Hellhound',
    '9': 'password:8',
    '10': 'file:8',
    '11': 'demon:Efreet',
    '12': 'control:8',
    '13': 'password:8',
    '14': 'ice:Asp',
    '15': 'ice:Wisp,Wisp',
    '16': 'ice:Liche',
    '17': 'ice:Raven',
    '18': 'ice:Raven,Raven',
  },
  uncommon: {
    '3': 'ice:Kraken',
    '4': 'ice:Hellhound,Scorpion',
    '5': 'ice:Hellhound,Killer',
    '6': 'ice:Raven,Raven',
    '7': 'ice:Sabertooth',
    '8': 'ice:Hellhound',
    '9': 'password:10',
    '10': 'file:10',
    '11': 'demon:Efreet',
    '12': 'control:10',
    '13': 'password:10',
    '14': 'ice:Killer',
    '15': 'ice:Liche',
    '16': 'ice:Dragon',
    '17': 'ice:Asp,Raven',
    '18': 'ice:Dragon,Wisp',
  },
  advanced: {
    '3': 'ice:Hellhound,Hellhound,Hellhound',
    '4': 'ice:Asp,Asp',
    '5': 'ice:Hellhound,Liche',
    '6': 'ice:Wisp,Wisp,Wisp',
    '7': 'ice:Hellhound,Sabertooth',
    '8': 'ice:Kraken',
    '9': 'password:12',
    '10': 'file:12',
    '11': 'demon:Balron',
    '12': 'control:12',
    '13': 'password:12',
    '14': 'ice:Giant',
    '15': 'ice:Dragon',
    '16': 'ice:Killer,Scorpion',
    '17': 'ice:Kraken',
    '18': 'ice:Raven,Wisp,Hellhound',
  },
};

/**
 * インタフェースのランク（1〜10）から 1 ターンの NET アクション回数を返す（p.197）。
 * 1〜3: 2回、4〜6: 3回、7〜9: 4回、10: 5回。
 * ウィスプやヴリズボルトで slowed のときは −1（最低 2）
 */
export function netActionsForRank(rank: number, slowed = false): number {
  if (rank <= 0) return 0;
  const base = rank <= 3 ? 2 : rank <= 6 ? 3 : rank <= 9 ? 4 : 5;
  return slowed ? Math.max(2, base - 1) : base;
}

export function findNetProgram(keyOrName: string | undefined | null): NetProgramDef | undefined {
  if (!keyOrName) return undefined;
  const q = keyOrName.trim().toLowerCase();
  return NET_PROGRAMS.find(
    (p) =>
      p.en.toLowerCase() === q ||
      p.name.toLowerCase() === q ||
      (p.aliases ?? []).some((a) => a.toLowerCase() === q),
  );
}

export function findBlackIce(keyOrName: string | undefined | null, customList?: BlackIceDef[]): BlackIceDef | undefined {
  if (!keyOrName) return undefined;
  const q = keyOrName.trim().toLowerCase();
  // Normalize known typo 'Rave' -> 'Raven'
  const norm = q === 'rave' ? 'raven' : q;
  const list = customList && customList.length > 0 ? customList : BLACK_ICE_CATALOG;
  return (
    list.find((b) => b.en.toLowerCase() === norm || b.name.toLowerCase() === norm) ??
    BLACK_ICE_CATALOG.find((b) => b.en.toLowerCase() === norm || b.name.toLowerCase() === norm)
  );
}

export function findDemon(keyOrName: string | undefined | null, customList?: DemonDef[]): DemonDef | undefined {
  if (!keyOrName) return undefined;
  const q = keyOrName.trim().toLowerCase();
  const list = customList && customList.length > 0 ? customList : DEMON_CATALOG;
  return (
    list.find((d) => d.en.toLowerCase() === q || d.name.toLowerCase() === q) ??
    DEMON_CATALOG.find((d) => d.en.toLowerCase() === q || d.name.toLowerCase() === q)
  );
}

export function findNetHardware(keyOrName: string | undefined | null): NetHardwareDef | undefined {
  if (!keyOrName) return undefined;
  const q = keyOrName.trim().toLowerCase().replace(/\s+/g, ' ');
  return NET_HARDWARE.find(
    (h) =>
      h.en.toLowerCase() === q ||
      h.name.toLowerCase() === q ||
      (h.aliases ?? []).some((a) => a.toLowerCase().replace(/\s+/g, ' ') === q),
  );
}

/** サイバーデッキの使用スロット数を計算（プログラム1、ブラックICE 2、ハードウェア 1〜2） */
export function deckSlotsUsed(deck: Partial<NetDeckConfig> | undefined | null): number {
  if (!deck) return 0;
  const progSlots = (deck.programs ?? []).length * 1;
  const iceSlots = (deck.black_ice ?? []).length * 2;
  const hwSlots = (deck.hardware ?? []).reduce((sum, h) => sum + (findNetHardware(h)?.slots ?? 1), 0);
  return progSlots + iceSlots + hwSlots;
}

export function validateCyberdeck(deck: Partial<NetDeckConfig> | undefined | null): {
  ok: boolean;
  used: number;
  max: number;
  error?: string;
} {
  const max = deck?.slots ?? (deck?.quality ? DECK_SLOTS[deck.quality] : 7);
  const used = deckSlotsUsed(deck);
  if (used > max) {
    return {
      ok: false,
      used,
      max,
      error: `サイバーデッキのスロット上限（${max} スロット）を超えています（現在 ${used} スロット使用: ブラック ICE は 1 体につき 2 スロット消費）`,
    };
  }
  return { ok: true, used, max };
}

/** バーチャリティ・ゴーグル（装備品）またはヴァーチャリティ（サイバーアイ）を持っているか */
export function hasVirtualityGoggles(char: {
  inventory?: unknown[];
  cyberware?: unknown[];
  extra?: Record<string, any>;
}): boolean {
  if (char.extra?.virtuality_goggles === true) return true;
  if (char.extra?.virtuality_goggles === false) return false;
  const inv = (char.inventory ?? []) as Array<{ name?: string; equipped?: boolean }>;
  const cw = (char.cyberware ?? []) as Array<{ name?: string }>;
  const matchName = (n?: string) => /virtuality|バーチャリティ|ヴァーチャリティ/i.test(n ?? '');
  return inv.some((i) => i?.equipped !== false && matchName(i?.name)) || cw.some((c) => matchName(c?.name));
}

/** 特定のサイバーデッキ・ハードウェアが組み込まれているか */
export function hasDeckHardware(
  char: { extra?: Record<string, any>; inventory?: unknown[] },
  hwEnOrJa: string,
): boolean {
  const target = findNetHardware(hwEnOrJa);
  if (!target) return false;
  const deckHw: string[] = char.extra?.deck?.hardware ?? [];
  if (deckHw.some((h) => findNetHardware(h)?.en === target.en)) return true;
  const inv = (char.inventory ?? []) as Array<{ name?: string; equipped?: boolean }>;
  return inv.some((i) => i?.equipped !== false && findNetHardware(i?.name)?.en === target.en);
}

/** アクセスポイントの有効距離（基本 6m、レンジ・アップグレードで 8m） */
export function netAccessRangeM(char: { extra?: Record<string, any>; inventory?: unknown[] }): number {
  return hasDeckHardware(char, 'Range Upgrade') ? 8 : 6;
}

/** 階層文字列（"file:6", "password:8", "ice:Wispx2", "ice:Skunk,Scorpion", "demon:Imp" 等）を解析 */
export function parseFloorRaw(raw: string, defaultDv = 8): Omit<NetFloor, 'floor' | 'depth' | 'branch' | 'parent_floor'> {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { raw: 'empty', kind: 'empty', label: '空の階層' };
  const [prefix, rest = ''] = trimmed.split(':');
  const p = prefix.toLowerCase();
  if (p === 'file' || p === 'password' || p === 'control') {
    const dv = Number(rest) || defaultDv;
    const kindName = p === 'file' ? 'ファイル' : p === 'password' ? 'パスワード' : '制御ノード';
    return { raw: `${p}:${dv}`, kind: p, dv, label: `${kindName} (DV${dv})` };
  }
  if (p === 'demon') {
    const d = findDemon(rest);
    const name = d?.name ?? rest;
    return { raw: `demon:${d?.en ?? rest}`, kind: 'demon', demon: d?.en ?? rest, label: `デーモン: ${name}` };
  }
  if (p === 'ice') {
    const iceList: string[] = [];
    for (const token of rest.split(',').map((s) => s.trim()).filter(Boolean)) {
      const m = /^(.+?)x(\d+)$/i.exec(token);
      if (m) {
        const b = findBlackIce(m[1]);
        const count = Math.max(1, Number(m[2]));
        for (let i = 0; i < count; i++) iceList.push(b?.en ?? m[1]);
      } else {
        const b = findBlackIce(token);
        iceList.push(b?.en ?? token);
      }
    }
    const jaNames = iceList.map((k) => findBlackIce(k)?.name ?? k).join('、');
    return { raw: trimmed, kind: 'ice', ice: iceList, label: `ブラックICE: ${jaNames}` };
  }
  return { raw: trimmed, kind: 'empty', label: trimmed };
}

/** 6 階層ごとに最大 1 体のデーモン上限（1〜6階: 1体、7〜12階: 2体、13〜18階: 3体） */
export function maxDemonsForFloors(floorCount: number): number {
  if (floorCount <= 0) return 0;
  return Math.max(1, Math.ceil(floorCount / 6));
}

/** アーキテクチャ内のデーモン配置制限（6階層ごとに最大1体、1階層に1体まで）を検証 */
export function validateNetArchitectureDemons(floors: NetFloor[]): string | null {
  const maxDemons = maxDemonsForFloors(floors.length);
  let demonCount = 0;
  for (const f of floors) {
    if (f.kind === 'demon' || f.demon) {
      demonCount++;
      if (f.ice && f.ice.some((x) => findDemon(x))) {
        return `第 ${f.floor} 階層に複数のデーモンは配置できません（1 階層に 1 体まで）`;
      }
    }
  }
  if (demonCount > maxDemons) {
    return `デーモンは 6 階層ごとに最大 1 体までです（${floors.length} 階層では最大 ${maxDemons} 体、現在 ${demonCount} 体）`;
  }
  return null;
}

/** 自宅用 NET アーキテクチャの参考購入価格を計算（p.216） */
export function calculateArchitecturePriceEb(arch: Pick<NetArchitecture, 'difficulty' | 'floors'>): {
  floorCost: number;
  iceAndDemonCost: number;
  totalCost: number;
  portable: boolean;
} {
  const diff = NET_DIFFICULTIES[arch.difficulty] ?? NET_DIFFICULTIES.standard;
  const floorCount = Math.max(3, arch.floors.length);
  const floorCost = floorCount * diff.floorCostEb;
  let iceAndDemonCost = 0;
  for (const f of arch.floors) {
    if (f.demon) {
      iceAndDemonCost += findDemon(f.demon)?.price ?? 0;
    }
    for (const iceKey of f.ice ?? []) {
      iceAndDemonCost += findBlackIce(iceKey)?.price ?? 0;
    }
  }
  return {
    floorCost,
    iceAndDemonCost,
    totalCost: floorCost + iceAndDemonCost,
    portable: arch.floors.length <= 2,
  };
}

/**
 * NET アーキテクチャの自動生成（p.210〜211）
 * - 3d6 階層（3〜18階）
 * - ロビー（第1・第2階層）は分岐せず、lobby 表（1d6）で決める
 * - 第3階層以降は difficulty 表（3d6）。同じプログラム（ICE/デーモン）か同じパスワードが既にあれば振り直す
 * - 分岐は 1d10 で 7 以上なら発生（6 以下が出るまで繰り返す）。ただしロビーは分岐せず、最長ルートは必ず 1 本だけにする
 * - デーモンは 6 階層ごとに最大 1 体（1 階層に 1 体まで）
 */
export function generateNetArchitecture(opts: {
  name?: string;
  difficulty: NetDifficultyKey;
  data?: Partial<NetrunData>;
  rng?: () => number;
  floorCount?: number;
}): NetArchitecture {
  const rng = opts.rng ?? Math.random;
  const rollDie = (sides: number) => Math.min(sides, Math.max(1, Math.floor(rng() * sides) + 1));
  const roll3d6 = () => rollDie(6) + rollDie(6) + rollDie(6);

  const difficulty = opts.difficulty || 'standard';
  const diffDef = NET_DIFFICULTIES[difficulty] ?? NET_DIFFICULTIES.standard;
  const lobbyTable = opts.data?.lobby && opts.data.lobby.length >= 6 ? opts.data.lobby : DEFAULT_LOBBY_TABLE;
  const floorTable =
    opts.data?.floors?.[difficulty] && Object.keys(opts.data.floors[difficulty]).length > 0
      ? opts.data.floors[difficulty]
      : DEFAULT_FLOORS_TABLE[difficulty];

  const totalFloors = Math.min(18, Math.max(3, opts.floorCount ?? roll3d6()));
  const maxDemons = maxDemonsForFloors(totalFloors);

  // 分岐数の決定: 1d10 で 7 以上なら分岐（6 以下が出るまで）
  let branchRolls = 0;
  while (rollDie(10) >= 7 && branchRolls < 5) {
    branchRolls++;
  }

  // ロビー（1, 2階）は分岐しない。最長ルートが必ず 1 本（main）になるよう深さと分岐を割り当てる
  // 分岐は第 3 階層以降から生え、その最大の深さが main の最大の深さ未満になるようにする
  // 例: totalFloors >= 5 のときだけ枝を作れる（main が深さ 4 以上、枝は深さ 3 の第3階層から分岐して深さ 4 未満または main より浅い）
  const layout: Array<{ floor: number; depth: number; branch: string; parent_floor: number | null }> = [];
  layout.push({ floor: 1, depth: 1, branch: 'main', parent_floor: null });
  layout.push({ floor: 2, depth: 2, branch: 'main', parent_floor: 1 });

  // 残りの階層数: totalFloors - 2
  const remaining = totalFloors - 2;
  // 枝を作れるのは remaining >= 3（totalFloors >= 5）のとき（main に最低 2 つ＝深さ 4、枝に 1 つ＝第2階層の下ではなく第3階層の下で深さ4になるため main は深さ 5 必要）
  // 第3階層（depth 3）から分岐させると枝の最初の階層は depth 4 になるので、main が depth >= 5 なら最長ルートは必ず main 1本になる！
  const maxBranchFloors = totalFloors >= 6 ? Math.min(branchRolls, totalFloors - 5) : 0;
  const mainExtraFloors = remaining - maxBranchFloors; // totalFloors >= 6 なら >= 3 なので main の最大深さは 2 + mainExtraFloors >= 5

  let nextFloorNum = 3;
  for (let i = 0; i < mainExtraFloors; i++) {
    const depth = 3 + i;
    layout.push({
      floor: nextFloorNum,
      depth,
      branch: 'main',
      parent_floor: nextFloorNum - 1,
    });
    nextFloorNum++;
  }

  // 枝の配置（第3階層＝floor 3 から分岐し、深さが本幹より浅くなるようにする）
  for (let b = 0; b < maxBranchFloors; b++) {
    const branchName = `B${b + 1}`;
    // 親は floor 3（depth 3）。深さは 4（mainMaxDepth >= 5 なので必ず mainMaxDepth より浅い）
    layout.push({
      floor: nextFloorNum,
      depth: 4,
      branch: branchName,
      parent_floor: 3,
    });
    nextFloorNum++;
  }

  const usedSpecs = new Set<string>();
  let demonCount = 0;
  const floors: NetFloor[] = [];

  for (const item of layout) {
    let chosenRaw = 'file:6';
    if (item.floor <= 2) {
      // ロビー（1〜2階）は 1d6
      for (let attempt = 0; attempt < 20; attempt++) {
        const r = rollDie(6);
        const cand = lobbyTable[r - 1] ?? 'password:6';
        const isDupCheckTarget = cand.startsWith('ice:') || cand.startsWith('password:') || cand.startsWith('demon:');
        if (attempt < 15 && isDupCheckTarget && usedSpecs.has(cand)) continue;
        chosenRaw = cand;
        break;
      }
    } else {
      // 第3階層以降は 3d6
      for (let attempt = 0; attempt < 40; attempt++) {
        const r = roll3d6();
        const cand = floorTable[String(r)] ?? `password:${diffDef.dv}`;
        if (cand.startsWith('demon:') && demonCount >= maxDemons) continue;
        const isDupCheckTarget = cand.startsWith('ice:') || cand.startsWith('password:') || cand.startsWith('demon:');
        if (attempt < 30 && isDupCheckTarget && usedSpecs.has(cand)) continue;
        chosenRaw = cand;
        break;
      }
    }
    usedSpecs.add(chosenRaw);
    const parsed = parseFloorRaw(chosenRaw, diffDef.dv);
    if (parsed.kind === 'demon') demonCount++;
    floors.push({
      floor: item.floor,
      depth: item.depth,
      branch: item.branch,
      parent_floor: item.parent_floor,
      ...parsed,
    });
  }

  const now = Date.now();
  return {
    id: generateUlid(),
    name: opts.name?.trim() || `${diffDef.name} NET アーキテクチャ`,
    difficulty,
    dv: diffDef.dv,
    floors,
    viruses: [],
    created_at: now,
    updated_at: now,
  };
}
