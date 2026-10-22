import React, { useEffect, useState } from 'react';
import {
  getSkillDef,
  splitSkillKey,
  SPECIALIZED_SKILLS,
  MEDTECH_SKILLS,
  STAT_NAMES_JA,
  SkillInfoResponse,
} from '@cyberpgm/shared';
import { api } from '../api.js';

/**
 * このアプリの戦闘アクションやロール特技の欄で、各技能がどのボタンに対応するかの案内（Phase 6a）。
 * ルールブックの文章ではなく、このアプリ自身のボタン名（docs/data/combat-actions.ja.json など）との対応を表す。
 */
const APP_COMBAT_ACTION_MAP: Record<string, string> = {
  handgun: '戦闘の「射撃」「照準射撃」「ヴィークルを攻撃」（ピストル・SMG）',
  shoulder_arms:
    '戦闘の「射撃」「照準射撃」「ヴィークルを攻撃」（アサルト・ライフル・ショットガン・スナイパー・ライフル）',
  heavy_weapons: '戦闘の「射撃」「照準射撃」「ヴィークルを攻撃」（グレネード・ランチャー・ロケット・ランチャー）',
  archery: '戦闘の「射撃」「照準射撃」「ヴィークルを攻撃」（弓・クロスボウ）',
  autofire: '戦闘の「フルオート射撃」「制圧射撃」（SMG・アサルト・ライフルなど連射武器）',
  melee_weapon:
    '戦闘の「近接攻撃」「ヴィークルを攻撃」（近接武器）、非同意の相手への「ドラッグ・薬品を使う」（エアハイポ）',
  brawling: '戦闘の「格闘」「つかむ」（つかむ・持ち物を奪う・つかみからの脱出）',
  martial_arts: '戦闘の「武術攻撃」「武術奥義」、伏せからの「立ち上がる」（跳ね起き）',
  evasion: '戦闘の「回避」（近接攻撃、または【反応】8 以上で射撃も）、「体当たり」の回避',
  athletics: '戦闘の「投げる」（グレネード・近接武器などの投擲）',
  concentration: '戦闘の「制圧射撃」を受けたときの抵抗判定',
  stealth: '戦闘の「身を隠す」',
  perception: '戦闘の「身を隠す」相手を探す対抗判定',
  first_aid: '戦闘の「応急手当」（負傷者の安定化）',
  paramedic: '戦闘の「応急手当」（負傷者の安定化）、医療欄での致命的損傷の治療',
  surgery: '医療欄での重度の致命的損傷の手術治療・サイバーウェア移植',
  medical_tech: 'ロール特技欄（メドテク《メディシン》）での薬品の調合・クリオシステム操作',
  drive_land_vehicle: '戦闘の「操縦」「特殊機動」（陸上ヴィークル）',
  pilot_air_vehicle: '戦闘の「操縦」「特殊機動」（航空ヴィークル）',
  pilot_sea_vehicle: '戦闘の「操縦」「特殊機動」（海洋ヴィークル）',
  electronics_security_tech:
    '戦闘の「アクセスポイントを探す（スキャナ）」「技能を使う」、ロール特技欄の修理・改造',
  basic_tech: '戦闘の「技能を使う」、ロール特技欄（テク《メイカー》）での修理・改造・作成・発明',
  cybertech: '戦闘の「技能を使う」、ロール特技欄（テク《メイカー》）での修理・改造・作成・発明',
  weaponstech: '戦闘の「技能を使う」、ロール特技欄（テク《メイカー》）での修理・改造・作成・発明',
  land_vehicle_tech: '戦闘の「技能を使う」、ロール特技欄（テク《メイカー》）での修理・改造・作成・発明',
  sea_vehicle_tech: '戦闘の「技能を使う」、ロール特技欄（テク《メイカー》）での修理・改造・作成・発明',
  air_vehicle_tech: '戦闘の「技能を使う」、ロール特技欄（テク《メイカー》）での修理・改造・作成・発明',
  trading: '戦闘の「技能を使う」、ロール特技欄（フィクサー《オペレーター》）での値切り判定',
};

export interface SkillInfoBoxProps {
  skillKey: string;
  /** いま編集中のキャラの該当能力値の値（未入力なら null） */
  statValue: number | null;
  /** いま編集中のキャラの該当技能レベル（未取得なら 0） */
  skillLevel: number;
}

/**
 * 技能名の横の「？」ボタン（Phase 6a）
 */
export const SkillHelpButton: React.FC<{
  skillKey: string;
  skillName: string;
  open: boolean;
  onToggle: () => void;
}> = ({ skillKey, skillName, open, onToggle }) => (
  <button
    type="button"
    aria-label={`${skillName} の詳細`}
    data-testid={`skill-info-btn-${skillKey}`}
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
    style={{
      width: '20px',
      height: '20px',
      borderRadius: '50%',
      border: open ? '1px solid var(--color-ally)' : '1px solid var(--color-border-light)',
      backgroundColor: open ? 'var(--color-ally)' : 'var(--color-surface-elevated)',
      color: open ? '#000' : 'var(--color-text-muted)',
      fontSize: '0.72rem',
      fontWeight: 700,
      lineHeight: 1,
      padding: 0,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}
    title={`${skillName} の計算のしかた・効果を見る`}
  >
    ？
  </button>
);

/**
 * 技能の詳細パネル（Phase 6a）。
 * 1. 計算のしかた（コードの定義と今のキャラの値から組み立てる）
 * 2. 効果・使い道（手元のルール資料 data/sources/core-ja/skills.json と戦闘アクション定義から出す）
 */
export const SkillInfoBox: React.FC<SkillInfoBoxProps> = ({ skillKey, statValue, skillLevel }) => {
  const [infoData, setInfoData] = useState<SkillInfoResponse | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getSkillInfo()
      .then((res) => {
        if (active) setInfoData(res);
      })
      .catch(() => {
        if (active) setInfoData({ skills: {}, hasSource: false });
      });
    return () => {
      active = false;
    };
  }, [skillKey]);

  const def = getSkillDef(skillKey);
  const { base } = splitSkillKey(skillKey);
  const skillName = def?.name || skillKey;
  const statKey = def?.stat || 'ref';
  const statJa = STAT_NAMES_JA[statKey] || statKey.toUpperCase();
  const baseTotal = statValue !== null ? statValue + skillLevel : null;
  const isSpecialized =
    Boolean(SPECIALIZED_SKILLS[base]) ||
    base === 'language_streetslang' ||
    base === 'local_expert_your_home';
  const isMedtechOnly = Boolean(MEDTECH_SKILLS[base]);

  const entry = infoData?.skills?.[skillKey] ?? infoData?.skills?.[base];
  const combatActionText =
    APP_COMBAT_ACTION_MAP[base] ||
    '戦闘の「技能を使う」（戦闘中に GM が難易度を決め、能力値 + 技能 + 1d10 で判定）';

  return (
    <div
      data-testid={`skill-info-panel-${skillKey}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        backgroundColor: 'var(--color-bg)',
        border: '1px solid var(--color-border-light)',
        borderRadius: '6px',
        padding: '10px 12px',
        fontSize: '0.8rem',
        lineHeight: 1.5,
        color: 'var(--color-text)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        marginTop: '4px',
        wordBreak: 'break-word',
      }}
    >
      {/* 1. 計算のしかた */}
      <div
        data-testid="skill-info-calc"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '3px',
          paddingBottom: '6px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div style={{ fontWeight: 700, color: 'var(--color-ally)' }}>1. 計算のしかた</div>
        <div>
          判定の式: <strong>判定 = 能力値 + 技能レベル + 1d10</strong>
        </div>
        <div>
          このキャラでの式:{' '}
          <strong>
            【{statJa}】{statValue !== null ? statValue : '（未入力）'} + 〈{skillName}〉{skillLevel} + 1d10
          </strong>
          {baseTotal !== null && (
            <span style={{ marginLeft: '6px', color: 'var(--color-text-muted)' }}>
              （合計の基本値 {baseTotal}）
            </span>
          )}
        </div>
        {def?.multiplier === 2 && (
          <div style={{ color: 'var(--color-accent)', fontWeight: 600 }}>
            ・×2 技能（技能ポイントを 2 使う）
          </div>
        )}
        {def?.basic && (
          <div style={{ color: 'var(--color-ally)', fontWeight: 600 }}>
            ・基本技能（パッケージ／ストリートラットで最初からレベル 2 入る技能）
          </div>
        )}
        {isSpecialized && (
          <div style={{ color: 'var(--color-text-muted)' }}>
            ・分野・流派・言語・地域を選んで別々に取る技能
          </div>
        )}
        {isMedtechOnly && (
          <div style={{ color: 'var(--color-text-muted)' }}>
            ・メドテクのロール特技《メディシン》で取る技能
          </div>
        )}
      </div>

      {/* 2. 効果・使い道 */}
      <div
        data-testid="skill-info-effect"
        style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
      >
        <div style={{ fontWeight: 700, color: 'var(--color-ally)' }}>2. 効果・使い道</div>
        {infoData === null ? (
          <div style={{ color: 'var(--color-text-muted)' }}>読み込み中...</div>
        ) : entry ? (
          <>
            <div>{entry.summary}</div>
            {entry.uses && entry.uses.length > 0 && (
              <ul style={{ margin: '2px 0', paddingLeft: '18px' }}>
                {entry.uses.map((u, idx) => (
                  <li key={idx}>{u}</li>
                ))}
              </ul>
            )}
            <div>
              <strong>アプリでの使い道:</strong> {combatActionText}
            </div>
            {entry.opposed && entry.opposed.length > 0 && (
              <div>
                <strong>対抗判定で組み合わさる技能:</strong> {entry.opposed.join('、')}
              </div>
            )}
            {entry.pages && entry.pages.length > 0 && (
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                参照ページ: 日本語版 {entry.pages.map((p) => `p.${p}`).join('、')}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ color: 'var(--color-text-muted)' }}>
              技能の説明（手元のルール資料）がありません
            </div>
            <div>
              <strong>アプリでの使い道:</strong> {combatActionText}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
