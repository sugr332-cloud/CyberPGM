/**
 * ヴィークルと知名度（Phase 5y。日本語版コアルールブック p.161〜165、189〜193）
 */
export type VehicleKind = 'land' | 'air' | 'sea';

export interface VehicleRec {
  id: string;
  item_id?: string;
  name: string;
  kind: VehicleKind;
  sdp: number;
  sdp_max: number;
  /** 車体装甲のアップグレードで SP 13（p.163） */
  sp: number;
  move: number;
  seats: number;
  upgrades: string[];
  /** 制御不能（p.192） */
  out_of_control?: boolean;
  /** ノーマッドの家族のヴィークル */
  family?: boolean;
}

/** 英語名からヴィークルの種類（どの操縦技能を使うか） */
const AIR = ['Gyrocopter', 'Helicopter', 'AV-4 Multipurpose Aerodyne', 'AV-9 Super Aerodyne', 'Aerozep'];
const SEA = ['Jetski', 'Speedboat', 'Cabin Cruiser', 'Yacht'];
export function vehicleKindOf(nameEn: string): VehicleKind {
  return AIR.includes(nameEn) ? 'air' : SEA.includes(nameEn) ? 'sea' : 'land';
}
export const DRIVE_SKILL: Record<VehicleKind, string> = { land: 'drive_land_vehicle', air: 'pilot_air_vehicle', sea: 'pilot_sea_vehicle' };

/** 特殊機動（p.192）。失敗すると制御不能 */
export const MANEUVERS: Array<{ key: string; name: string; dv: number; air?: boolean }> = [
  { key: 'swerve', name: '急ハンドル', dv: 13 },
  { key: 'sharp_turn', name: '急角度のターン', dv: 13 },
  { key: 'hard_brake', name: '急ブレーキ', dv: 13 },
  { key: 'spin', name: 'スピンターン', dv: 17 },
  { key: 'jump', name: 'ジャンプ', dv: 17 },
  { key: 'landing', name: '着陸（飛行ヴィークル）', dv: 13, air: true },
  { key: 'aerobatics', name: '曲技飛行（飛行ヴィークル）', dv: 17, air: true },
];

/** ノーマッドのアップグレード（必要《モト》ランク。p.163〜165） */
export const VEHICLE_UPGRADES: Array<{ en: string; name: string; rank: number; effect: string }> = [
  { en: 'Heavy Chassis', name: '車体強化', rank: 1, effect: 'SDP +20。10 トンまで牽引' },
  { en: 'Armored Chassis', name: '車体装甲', rank: 5, effect: 'SP 13（窓ガラスは別）' },
  { en: 'Bulletproof Glass', name: '防弾ガラス', rank: 1, effect: '窓が薄い防弾ガラス（15HP）の遮蔽。2 回で厚い（30HP）' },
  { en: 'Communications Center', name: '通信センターコンソール', rank: 1, effect: '無線・スクランブラー・追跡装置などのセット' },
  { en: 'NOS', name: 'ニトロ', rank: 1, effect: '運転中にアクション 1 回で移動アクション +1（タンク 1 つにつき 1 日 1 回）' },
  { en: 'Onboard Flamethrower', name: '搭載型フレイムスロワー', rank: 1, effect: '運転手がアクションで使う。運転中は再装填できない' },
  { en: 'Onboard Machine Gun', name: '搭載型機関銃', rank: 1, effect: 'フルオート射撃だけの装弾数 30 のアサルト・ライフル（前方）' },
  { en: 'Seating Upgrade', name: 'シート・アップグレード', rank: 1, effect: '座席 +2。射出型シートにもできる' },
  { en: 'Security Upgrade', name: 'セキュリティ・アップグレード', rank: 5, effect: 'DNA ロック（〈電子／保安技術〉17）と光学迷彩（〈知覚〉17）' },
  { en: 'Smuggling Upgrade', name: '密輸用アップグレード', rank: 1, effect: '隠しホルスター 2 つと隠し収納（〈隠蔽／発見〉17）' },
  { en: 'Onboard Rocket Pod', name: '搭載型ロケット・ポッド', rank: 5, effect: '装弾数 3 のロケット・ランチャー（前方）。車体強化が必要' },
  { en: 'Vehicle Heavy Weapon Mount', name: 'ヴィークル用銃架', rank: 5, effect: '乗客が両手持ち遠隔武器を使える旋回銃架。車体強化が必要' },
  { en: 'Onboard Melee Weapon', name: '搭載型近接武器', rank: 1, effect: '超大型近接武器（前方・側面・後方）' },
  { en: 'Hover Upgrade', name: 'ホバー・アップグレード', rank: 5, effect: '水上をモーターボートの速さで走れる（陸上ヴィークル）' },
  { en: 'AV-4 Engine Upgrade', name: 'AV-4 用エンジン追加', rank: 7, effect: 'AV-4 と同じように飛べる（空中は〈航空ヴィークル操縦〉）' },
  { en: 'Combat Plow', name: '戦闘用プラウ', rank: 1, effect: '前面の衝突で乗員は頸椎損傷を受けず、ヴィークルも無傷。ニトロ中は体当たり +2d6' },
  { en: 'Enhanced Interface Plug Integration', name: 'インターフェイス・プラグ同調操作', rank: 5, effect: 'プラグで運転中、【反応】8 以上なら〈回避〉で回避できる（バイク）' },
  { en: 'Deployable Spike Strip', name: 'スパイク・ストリップ展開装置', rank: 1, effect: '後ろのタイヤ付きヴィークルは〈陸上ヴィークル運転〉17、失敗で弱点に 4d6（2 倍）' },
  { en: 'Housing Capacity', name: '居住容量', rank: 1, effect: 'ベッド・トイレ・シャワー・キッチン（コンビ）、または船室 +1' },
];

/** 体当たりのダメージ（双方 6d6）と、巻き込まれた全員の頸椎損傷（p.192） */
export const RAM_DICE = 6;
export const WHIPLASH = { table: 'head' as const, roll: 8 };

// ── 知名度・威圧（p.193） ──
export interface Reputation {
  level: number;
  deed: string;
  /** 臆病などの悪名（威圧ではマイナス） */
  bad?: boolean;
}
export const REPUTATION_LEVELS = [
  '',
  'その場に居合わせた者だけが知っている',
  '身近な友人の間で広まっている',
  '仕事仲間やちょっとした知り合いは全員知っている',
  '地元の地区全体に広まっている',
  '周辺の地区でも名前を知られている',
  '周辺の地区でも一目で誰だかわかる',
  'ニュース記事に 1〜2 回なった',
  'ニュースやスクリームシートの見出しを頻繁に飾る',
  'いつも TV やスクリームシートを賑わせる',
  '世界的な有名人',
];
