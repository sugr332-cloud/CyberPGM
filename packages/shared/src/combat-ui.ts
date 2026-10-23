/** Inputs consumed by combat resolution. The same definitions drive the GM guide and player roll pad. */
export type CombatInputField = 'attack_roll' | 'attack_extra' | 'defense_roll' | 'defense_extra' | 'damage_rolls' | 'crit_roll' | 'extra_crit_roll' | 'death_save_roll' | 'target' | 'weapon' | 'distance' | 'destination' | 'armor_ignore' | 'cover_hp' | 'cover_damage' | 'technique' | 'vehicle' | 'target_vehicle' | 'maneuver' | 'item' | 'held_item' | 'grab_mode' | 'aimed_location' | 'weakpoint' | 'dodge_mode' | 'hazard' | 'hazard_level' | 'hazard_status' | 'fall_height' | 'drug' | 'net_architecture' | 'net_target' | 'net_program' | 'net_floor' | 'net_dv' | 'solo_alloc' | 'manual_notes' | 'manual_changes';
export interface MissingCombatInput { field: CombatInputField; attack_index?: number }
export type CombatDiceInput = 'attack_roll' | 'attack_extra' | 'defense_roll' | 'defense_extra' | 'damage_rolls' | 'crit_roll' | 'extra_crit_roll' | 'death_save_roll';
export interface CombatActionInputSpec {
  label: string;
  /** Dice inputs this action can consume. Conditional inputs are still listed, with their trigger. */
  dice: Array<{ field: CombatDiceInput; who: 'actor' | 'target' | 'either'; purpose: string; dice: string; when?: string }>;
  selectors: CombatInputField[];
}

const attack = (purpose: string, when?: string) => ({ field: 'attack_roll' as const, who: 'actor' as const, purpose, dice: '1d10', ...(when ? { when } : {}) });
const defense = (purpose: string, when?: string) => ({ field: 'defense_roll' as const, who: 'target' as const, purpose, dice: '1d10', ...(when ? { when } : {}) });
const damage = (purpose: string, dice: string, when?: string) => ({ field: 'damage_rolls' as const, who: 'actor' as const, purpose, dice, ...(when ? { when } : {}) });
const crit = (purpose: string, when?: string) => ({ field: 'crit_roll' as const, who: 'actor' as const, purpose, dice: '2d6', ...(when ? { when } : {}) });
const spec = (label: string, dice: CombatActionInputSpec['dice'] = [], selectors: CombatInputField[] = []): CombatActionInputSpec => {
  const expanded = [...dice];
  if (dice.some((d) => d.field === 'attack_roll')) expanded.push({ field: 'attack_extra', who: 'actor', purpose: 'クリティカル／ファンブルの追加出目', dice: '1d10', when: '最初の出目が 1 または 10 のとき' });
  const defenseInput = dice.find((d) => d.field === 'defense_roll');
  if (defenseInput) expanded.push({ field: 'defense_extra', who: defenseInput.who, purpose: '回避の追加出目', dice: '1d10', when: '最初の出目が 1 または 10 のとき' });
  if (dice.some((d) => d.field === 'crit_roll')) expanded.push({ field: 'extra_crit_roll', who: 'actor', purpose: '2 つ目の致命傷表', dice: '2d6', when: '致命傷条件が重なったとき' });
  return { label, dice: expanded, selectors };
};

/** Complete allowlist for docs/data/combat-actions.ja.json. Unlisted inputs are never rendered. */
export const COMBAT_ACTION_INPUTS: Record<string, CombatActionInputSpec> = {
  move: spec('移動', [], ['destination']), take_cover: spec('遮蔽に入る', [], ['destination']),
  ranged: spec('射撃', [attack('命中の判定'), defense('回避', '遠隔攻撃で、対象の REF が 8 以上かつ回避を選んだとき'), damage('命中時のダメージ', '武器のダメージ式', '命中したとき'), crit('致命傷表', '命中し、致命傷条件を満たしたとき')], ['target', 'weapon', 'distance']),
  aimed: spec('照準射撃', [attack('狙った部位への命中判定'), defense('回避', '遠隔攻撃で、対象の REF が 8 以上かつ回避を選んだとき'), damage('命中時のダメージ', '武器のダメージ式', '命中したとき'), crit('致命傷表', '命中し、致命傷条件を満たしたとき')], ['target', 'weapon', 'distance']),
  autofire: spec('フルオート射撃', [attack('命中の判定'), defense('回避', '対象の REF が 8 以上かつ回避を選んだとき'), damage('命中時のダメージ', '2d6', '命中したとき'), crit('致命傷表', '命中し、致命傷条件を満たしたとき')], ['target', 'weapon', 'distance']),
  suppressive: spec('制圧射撃', [attack('射手の制圧判定'), defense('対象ごとの抵抗判定')], ['target', 'weapon']),
  repair_weapon: spec('動作不良を直す', [], ['weapon']),
  melee: spec('近接攻撃', [attack('命中の判定'), defense('回避'), damage('命中時のダメージ', '武器のダメージ式', '命中したとき'), crit('致命傷表', '命中し、致命傷条件を満たしたとき')], ['target', 'weapon', 'armor_ignore']),
  brawl: spec('格闘', [attack('命中の判定'), defense('回避'), damage('命中時のダメージ', 'BODY による d6', '命中したとき'), crit('致命傷表', '命中し、致命傷条件を満たしたとき')], ['target']),
  martial_arts: spec('武術攻撃', [attack('命中の判定'), defense('回避'), damage('命中時のダメージ', 'BODY による d6', '命中したとき'), crit('致命傷表', '命中し、致命傷条件を満たしたとき')], ['target']),
  martial_technique: spec('武術奥義', [attack('奥義の判定'), defense('回避する奥義の場合'), damage('命中時のダメージ', 'BODY による d6', '攻撃系奥義が命中したとき'), crit('致命傷表', '命中し、致命傷条件を満たしたとき')], ['target', 'technique', 'held_item', 'aimed_location']),
  grab: spec('つかむ', [attack('つかみの対抗判定'), { ...defense('つかみを受ける対抗判定'), who: 'target' }], ['target', 'item', 'held_item', 'grab_mode']),
  choke: spec('締め', [], ['target']), throw: spec('投げ', [], ['target']), release: spec('放す', [], ['target']),
  stand: spec('立ち上がる', [attack('跳ね起き判定', '跳ね起きを試みるとき')], ['technique']),
  throw_object: spec('物を投げる', [attack('投擲の命中判定'), defense('回避', '対象の REF が 8 以上のとき'), damage('命中時のダメージ', '投げた物の式', '命中したとき'), crit('致命傷表', '命中し、致命傷条件を満たしたとき')], ['target', 'item', 'distance']),
  reload: spec('リロード', [], ['weapon', 'item']), hide: spec('身を隠す'), run: spec('走る', [], ['destination']), pickup: spec('拾う', [], ['item']),
  use_skill: spec('技能を使う', [], ['manual_notes']), item_cyberware: spec('アイテム・サイバーウェア', [], ['item', 'manual_notes']),
  first_aid: spec('応急手当', [attack('応急手当の判定')], ['target']),
  use_drug: spec('ドラッグ・薬品を使う', [attack('薬品投与の近接判定', '相手が同意しないとき'), { ...defense('投与を避ける判定', '相手が同意しないとき'), who: 'target' }, damage('薬品の効果ダイス', '薬品ごとの式')], ['target', 'item', 'drug']),
  call_backup: spec('支援を呼ぶ', [attack('支援要請'), damage('到着までのラウンド数', '1d6', '要請が成功したとき')]),
  solo_realloc: spec('コンバット・アウェアネスを割り振り直す', [], ['solo_alloc']),
  vehicle_board: spec('車両に乗る', [], ['vehicle']), vehicle_start: spec('ヴィークル始動'), vehicle_stop: spec('ヴィークル停止'), vehicle_exit: spec('ヴィークルから降りる'),
  vehicle_control: spec('操縦', [attack('操縦判定', 'REF + 操縦技能が 10 未満のとき')]),
  vehicle_maneuver: spec('特殊機動', [attack('特殊機動の判定')], ['maneuver']),
  vehicle_ram: spec('体当たり', [defense('歩行者の回避', '歩行者を対象にするとき'), damage('衝突ダメージ', '6d6')], ['target', 'target_vehicle']),
  attack_vehicle: spec('車両への攻撃', [attack('命中の判定'), damage('命中時のダメージ', '武器のダメージ式', '命中したとき')], ['target_vehicle', 'weapon', 'distance']),
  net_action: spec('NET アクション', [], ['net_architecture', 'net_target', 'net_program', 'net_floor', 'net_dv']),
  net_ice_attack: spec('ブラック ICE の攻撃', [attack('ICE の攻撃判定'), defense('対象の防御判定'), damage('ICE のダメージ', 'ICE の式')], ['net_architecture', 'net_target']),
  scanner: spec('アクセスポイントを探す', [attack('スキャナ探知判定')], ['net_dv']),
  hazard: spec('環境ダメージ', [attack('抵抗・落下時の判定', '環境や選んだ状況が判定を求めるとき'), damage('環境のダメージ', '環境・段階ごとの式', '選んだ環境がダメージを求めるとき')], ['target', 'hazard', 'hazard_level', 'fall_height']),
  hazard_end: spec('環境の状態を終える', [], ['target', 'hazard_status']), other: spec('その他（GM 裁定）', [], ['manual_notes', 'manual_changes']),
  dodge: spec('回避', [{ field: 'defense_roll', who: 'actor', purpose: 'GM に指示された回避', dice: '1d10' }]),
  death_save: spec('死亡セーヴ', [{ field: 'death_save_roll', who: 'actor', purpose: '死亡セーヴ', dice: '1d10' }]),
};

export const COMBAT_ACTION_KEYS = Object.keys(COMBAT_ACTION_INPUTS);
const NET_SUBACTION_INPUTS: Record<string, CombatActionInputSpec> = {
  jack_in: spec('ジャックイン'), pathfinder: spec('パスファインダ', [attack('NET 構造視認判定')]),
  descend: spec('階層移動'), backdoor: spec('バックドア', [attack('パスワード突破判定')]),
  eyedee: spec('アイディール', [attack('ファイル確認判定')]), eye_dee: spec('アイディール', [attack('ファイル確認判定')]),
  control: spec('コントロール', [attack('制御ノード判定', '操作に判定が必要なとき')]),
  operate_node: spec('ノード操作'), activate: spec('プログラム起動'), derez: spec('プログラム停止'),
  program: spec('攻撃プログラム', [attack('攻撃判定'), defense('対象の防御判定'), damage('命中時の効果ダイス', 'プログラムの式', '命中したとき')]),
  zap: spec('ザップ', [attack('ザップ攻撃判定'), defense('対象の防御判定'), damage('命中時のダメージ', '1d6', '命中したとき')]),
  slide: spec('スライド', [attack('逃走判定'), defense('ブラック ICE の PER 判定')]), cloak: spec('クローク', [attack('痕跡隠蔽判定')]),
  virus: spec('ウイルス', [attack('ウイルス判定', 'ウイルス作成が完了するとき')]),
  jack_out: spec('安全なジャックアウト'), unsafe_jack_out: spec('安全でないジャックアウト', [damage('強制切断の効果ダイス', '結果により変化')]),
};
const HAZARD_INPUTS: Record<string, CombatActionInputSpec> = {
  fire: spec('着火'), radiation: spec('放射線'),
  electric: spec('感電', [damage('感電ダメージ', '6d6')], ['target', 'hazard', 'hazard_level']),
  fall: spec('落下', [attack('〈運動〉判定'), damage('落下ダメージ', '高さに応じた d6')], ['target', 'hazard', 'fall_height']),
  poison: spec('毒', [attack('抵抗判定'), damage('毒ダメージ', '段階ごとの d6', '抵抗に失敗したとき')], ['target', 'hazard', 'hazard_level']),
  drug: spec('薬物抵抗', [attack('抵抗判定')], ['target', 'hazard', 'hazard_level']),
  drown: spec('溺れ・窒息'), vacuum: spec('真空'),
  weather: spec('過酷な気候', [damage('環境ダメージ', '1d6')], ['target', 'hazard']),
};
export function combatActionInputs(action: string, variant?: string): CombatActionInputSpec {
  if (action === 'net_action' && variant) return NET_SUBACTION_INPUTS[variant] ?? COMBAT_ACTION_INPUTS.net_action;
  if (action === 'hazard' && variant) return HAZARD_INPUTS[variant] ?? COMBAT_ACTION_INPUTS.hazard;
  return COMBAT_ACTION_INPUTS[action] ?? spec(action);
}
export function combatActionHasDice(action: string, field: CombatDiceInput): boolean {
  return combatActionInputs(action).dice.some((d) => d.field === field);
}

export const VEHICLE_ACTIONS = [
  { key: 'vehicle_board', label: '乗る' }, { key: 'vehicle_exit', label: '降りる' },
  { key: 'vehicle_start', label: '始動' }, { key: 'vehicle_stop', label: '停止' },
  { key: 'vehicle_control', label: '操縦' }, { key: 'vehicle_maneuver', label: '特殊機動' },
  { key: 'vehicle_ram', label: '体当たり' }, { key: 'attack_vehicle', label: '車両への攻撃' },
] as const;
export const isVehicleAction = (key: string) => VEHICLE_ACTIONS.some((a) => a.key === key);
