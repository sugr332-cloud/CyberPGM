# Phase 1 指示書: ルール計算エンジン（packages/rules）

- 作成: 2026-10-20（Claude）
- 作業ブランチ: `agy/phase1-rules-engine`（Phase 0 のマージ後に main から切る）
- 報告: `docs/agy/reports/phase1-rules-engine-<連番>.md`
- 前提として読むもの: `docs/SPEC.md`（§5.0.1、§5.1、§5.5〜5.6、§7）、`docs/RULES_CHECK.md`（全部）、`docs/agy/README.md`

## ゴール

`packages/rules` に、画面から独立した **純粋関数** のルール計算を実装し、vitest で全ケースを確かめる。画面・サーバ・DB には触らない（UI がないのでモック承認は不要）。

- 乱数を使わない。ダイスの出目は必ず引数で受け取る（リアルダイスが既定のため）。アプリで振る機能は Phase 1 では作らない
- ルールの数値で日本語版の確認が済んでいないもの（GitHub Issue のラベル `ルール確認`）は、**定数として外から渡せるようにする**。既定値はこの指示書の値を使い、コードに直書きしない
- 武器ごとの違いは **武器・弾薬データの値で分岐する**。武器名で `if` を書かない（RULES_CHECK.md §4）

## 1. ファイル構成

```
packages/rules/
├─ src/
│   ├─ index.ts          # 公開 API の再エクスポート
│   ├─ constants.ts      # RuleConstants 型と既定値
│   ├─ dice.ts           # 1d10 の追加ロール、出目の分布、成功率
│   ├─ check.ts          # 技能判定、対抗判定、必要な出目
│   ├─ initiative.ts     # イニシアチブ
│   ├─ attack.ts         # 命中（遠隔・近接・照準・オートファイア）、難易度の決定
│   ├─ damage.ts         # ダメージ、SP、アブレーション、クリティカル、盾、頭部
│   ├─ wounds.ts         # 負傷段階、ペナルティ、死亡セーブ
│   ├─ movement.ts       # 移動距離、マス数、距離の測り方
│   └─ humanity.ts       # 人間性と EMP
└─ test/                 # 各ファイルに対応するテスト
```

外部パッケージは追加しない（zod は `packages/shared` 側で使う。rules は依存なし）。

## 2. 定数 `RuleConstants`（constants.ts）

```ts
export interface RuleConstants {
  tieRule: 'fail' | 'success';          // 難易度と同値のとき（Issue #1）既定 'fail'
  opposedTieWinner: 'defender' | 'attacker'; // 対抗判定の同値（Issue #1）既定 'defender'
  rangedDodgeMinRef: number;            // 射撃を回避できる REF（Issue #2）既定 8
  aimedShotPenalty: number;             // 既定 -8（確認済み）
  critBonusDamage: number;              // 既定 5（確認済み）
  critSixesNeeded: number;              // 既定 2（確認済み）
  seriousWoundPenalty: number;          // 既定 -2（確認済み）
  mortalWoundPenalty: number;           // 既定 -4（確認済み）
  defaultAblation: number;              // 既定 1（確認済み）
  metersPerSquare: number;              // 既定 2
  diagonalRule: 'chebyshev' | 'alternate'; // 斜め移動（Issue #10）既定 'chebyshev'
  initiativeCrit: boolean;              // 既定 true（FVTT の既定）
  humanityPerCyberware: number;         // 既定 2（確認済み）
  humanityPerBorgware: number;          // 既定 4（確認済み）
}
export const DEFAULT_RULES: RuleConstants = { ... };
```

すべての関数は最後の引数に `rules: RuleConstants = DEFAULT_RULES` を取る。

## 3. ダイス（dice.ts）

- `resolveD10(first: number, extra?: number): { value: number; needsExtra: boolean }`
  - first が 10 → `10 + extra`、first が 1 → `1 − extra`。extra が未入力なら `needsExtra: true`（画面で「もう 1 回振って」を出すため）
  - 追加ロールは 1 回だけ。extra が 10 や 1 でも連鎖しない
  - 1〜10 以外は例外を投げる
- `d10Distribution(): Map<number, number>` — 2〜9 が各 0.1、11〜20 と 0〜−9 が各 0.01（合計 1）
- `successProbability(base: number, target: number, mode: 'dv' | 'defend', rules)` — `mode: 'dv'` は `base + 出目` が target を超える確率（`tieRule: 'success'` なら以上）。`'defend'` は対抗判定で防御側が target 以上を出す確率（`opposedTieWinner` に従う）。小数で返す

## 4. 判定（check.ts）

- `skillBase({ stat, level, woundPenalty, mods }: …): number` — 能力値 + 技能レベル + 負傷ペナルティ + 修正の合計。技能を持っていなければ level 0
- `neededRoll(base, target, mode, rules): NeededRoll`
  - `{ kind: 'any' }`（2 以上で成功。1 はファンブルなので「必ず成功」にはしない）
  - `{ kind: 'roll', n }`（n 以上。2〜10）
  - `{ kind: 'extra', n }`（10 を出して追加ロールで n 以上）
  - `{ kind: 'impossible' }`（10 + 10 でも届かない）
  - 計算: `dv` は `target − base + 1`（`tieRule: 'success'` なら `+ 0`）。`defend` は `target − base`（`opposedTieWinner: 'defender'` のとき）
- `formatNeeded(n: NeededRoll): string` — 「2 以上で成功」「6 以上で成功」「10 → 追加ロールで 3 以上」「成功しない」（画面の表記。SPEC §5.0.1）
- `resolveCheck({ base, first, extra, target, mode }, rules)` → `{ total, success, needsExtra }`
- `resolveOpposed({ attackerTotal, defenderTotal }, rules)` → `'attacker' | 'defender'`

## 5. イニシアチブ（initiative.ts）

- `initiativeTotal(ref, first, extra?, rules)` — `initiativeCrit` が true なら 10 / 1 の追加ロールを使う
- `sortInitiative(entries: { id, total, ref }[], tieBreak: 'ref' | 'manual')` — 合計の高い順。同値は `tieBreak: 'ref'` なら REF の高い順、それも同じなら `needsReroll` の印をつけて並び順は入力順のまま返す。`'manual'` なら全部の同値に印をつける（同値の扱いは GM 設定。RULES_CHECK §2）

## 6. 攻撃（attack.ts）

武器データは Phase 0 の `weapons` テーブルの列（`weapon_type`, `skill`, `damage`, `rof`, `autofire`, `dv_table_key`, `is_ranged` ほか）を、`packages/shared` に型として定義して受け取る。

- `rangedDv(dvTable: DvTable, distanceM: number): number | null` — 距離帯から難易度を引く。DvTable は rule_constants `dv_table.<key>`（Phase 0 で取り込んだ形: `[{ range: [0, 6], dv: 13 }, …, { range: [201, 400], dv: "N/A" }]`）。`dv` が `"N/A"` の帯と、どの帯にも入らない距離は null（撃てない）。帯の境界は両端を含む。距離が小数（斜めなど）のときは切り上げてから引く
  - テスト: `DV Pistol` で 6m → 13、7m → 15、8m → 15、50m → 25、300m → null
- `attackBase({ stat, skillLevel, woundPenalty, aimed, situational }, rules)` — 照準なら `aimedShotPenalty` を足す
- `canDodgeRanged(targetRef, rules)` — `targetRef >= rangedDodgeMinRef`
- `attacksPerAction(weapon)` — ROF の値（射撃・近接の単発攻撃を何回できるか）
- `autofireMultiplier({ attackTotal, dv, weaponCap, ammoCap? })` — `min(attackTotal − dv, cap)`。DV 以下なら 0（外れ）。cap は弾薬に上限があれば小さい方
- 制圧射撃・遮蔽物・爆発物は **作らない**（Issue #5・#6・#14 が未決）

## 7. ダメージ（damage.ts）

```ts
resolveDamage({
  dice: number[],               // ダメージダイスの出目（例: [6,6,4]）。オートファイアは 2d6 の出目
  multiplier?: number,          // オートファイアの倍率（既定 1）
  location: 'body' | 'head',
  sp: number,                   // その部位の現在の SP
  ignoreArmorPercent?: number,  // 武器・弾薬データ（近接武器は 50 など）
  ignoreBelowSP?: number,       // この値以下の SP を 0 とみなす
  ablation?: number,            // 弾薬などの値。既定 rules.defaultAblation
  shieldHp?: number,            // 盾を使うとき
  isExplosive?: boolean,        // 爆発物は盾で止まらない
}, rules) => {
  rawTotal, critical, critBonus, effectiveSp,
  penetrating,                  // SP を超えた分（頭部は 2 倍した後）
  hpLoss,                       // penetrating + critBonus
  spAfter, shieldHpAfter,
  criticalInjuryTable: 'head' | 'body' | null,
}
```

計算順（RULES_CHECK §3。すべて FVTT で確認済み）:

1. `rawTotal = sum(dice) × multiplier`
2. `critical = dice の中の 6 の数 >= critSixesNeeded`（オートファイアでも 2d6 の出目で判定する）
3. 盾: `shieldHp` があり爆発物でなければ、先に盾が rawTotal を受ける。盾の HP を超えた分だけ次へ進む
4. 防具: `effectiveSp` = ignoreBelowSP 以下なら 0、そうでなければ `round(sp × (1 − ignoreArmorPercent / 100))`（四捨五入は Math.round）
5. `penetrating = max(0, 残りダメージ − effectiveSp)`。頭部なら `× 2`
6. SP を貫通したとき（penetrating > 0）だけ `spAfter = max(0, sp − ablation)`
7. `critBonus = critical ? critBonusDamage : 0`。**SP で減らず、貫通していなくても入り、頭部でも 2 倍にしない**
8. `hpLoss = penetrating + critBonus`、`criticalInjuryTable = critical ? location : null`

致命傷表の結果（どの致命傷か）は出目を受け取って rule_constants `critical_injury.<table>` から引く関数 `lookupCriticalInjury(table, roll2d6)` にする。取り込んだ形は `[{ range: [2, 2], name, summary, quickFix: { dvFirstAid, dvParamedic, type }, treatment: { dvParamedic, dvSurgery, type }, sources }]`。戻り値に応急処置と治療の難易度も含める（画面と治療の手順で使う。Issue #9）。`summary` は英語の HTML なので、rules では加工せずそのまま返す。効果の適用は Phase 4（戦闘）で行う。

## 8. 負傷（wounds.ts）

- `woundState(hp, maxHp)` → `'ok' | 'seriously' | 'mortally' | 'dead'`。`hp < ceil(maxHp / 2)` で重傷、`hp < 1` で瀕死。dead は外から渡す（死亡セーブ失敗）ので、hp だけでは dead にしない
- `woundPenalty(state, rules)` → 0 / −2 / −4
- `deathSave({ roll, penalty, body })` → `{ success, nextPenalty }`。`roll === 10` は必ず失敗。成功は `roll + penalty < body`。成功したら `nextPenalty = penalty + 1`

## 9. 移動（movement.ts）

- `moveSquares(move)` = MOVE（1 マス `metersPerSquare` m）。走ると 2 倍
- `gridDistance(a, b, rules)` — `chebyshev` は `max(|dx|, |dy|)`。`alternate` は斜めを 1・2・1・2… と数える
- `distanceMeters(a, b, rules)` = マス数 × metersPerSquare（遠隔の難易度を引くのに使う）

## 10. 人間性（humanity.ts）

- `maxHumanity(empMax, installed: { type: string; staticLoss: number }[], bonus = 0, rules)` = `empMax × 10 − Σ(type が borgware なら humanityPerBorgware、staticLoss > 0 なら humanityPerCyberware、それ以外 0) + bonus`
- `currentEmp(humanity, maxHumanity)` = `floor(min(humanity, maxHumanity) / 10)`
- `humanityAfterInstall(humanity, loss)` — loss は「固定値」か「振った出目の合計」を呼び出し側が決めて渡す

## 11. テスト（必須）

vitest で、**各関数に正常系と境界のテスト** を書く。少なくとも次のケースを入れる（数値は SPEC・モックで使ったもの）。テスト名に根拠（`FVTT cpr-actor.js` など）か Issue 番号を書く。

| ケース | 期待値 |
|---|---|
| 基本値 14 vs 難易度 15 | 必要な出目 2 以上（`roll n=2`）… `15 − 14 + 1 = 2` |
| 基本値 6 vs 難易度 15 | `roll n=10` |
| 基本値 6 vs 難易度 20 | `extra n=5` |
| 基本値 12 で防御、攻撃合計 18 | `roll n=6`（同値は防御側の勝ち） |
| tieRule 'success' に切り替え | 14 vs 15 は `roll n=1` → `any` |
| 成功率: 基本値 11 vs 難易度 13 | 0.80 |
| 成功率: 分布の合計 | 1.0（誤差 1e-9 以内） |
| resolveD10(10, 3) | 13。resolveD10(1, 4) は −3。resolveD10(10) は needsExtra |
| ダメージ [6,6,4]・胴 SP 7 | rawTotal 16、penetrating 9、critBonus 5、hpLoss 14、spAfter 6、表 body |
| ダメージ [3,2,1]・胴 SP 7 | penetrating 0、hpLoss 0、spAfter 7（貫通しないので減らない） |
| ダメージ [6,6,1]・胴 SP 15 | penetrating 0、hpLoss 5（クリティカルは SP を貫通しなくても入る）、spAfter 15 |
| 頭部 [5,4,2]・頭 SP 7 | penetrating 8、hpLoss 8、spAfter 6 |
| 頭部 [6,6,3]・頭 SP 7 | penetrating 16、critBonus 5、hpLoss 21（+5 は 2 倍にしない） |
| 近接 ignoreArmorPercent 50・[5,4]・SP 7 | effectiveSp 4（3.5 を四捨五入）、penetrating 5 |
| オートファイア: 攻撃 19 vs 難易度 17・上限 3・2d6 [4,3] | 倍率 2、rawTotal 14 |
| 盾 HP 10・ダメージ 16 | 盾 0、残り 6 が体へ |
| woundState(11, 25) | seriously（11 < 13）。woundState(13, 25) は ok。woundState(0, 35) は mortally |
| woundState(17, 35) | seriously（17 < 18）。woundState(18, 35) は ok |
| 死亡セーブ roll 10・penalty 0・BODY 8 | 失敗。roll 3・penalty 1・BODY 5 は成功で nextPenalty 2 |
| maxHumanity(5, [cybereye static 7, biomonitor static 0]) | 48。currentEmp(43, 48) は 4 |
| gridDistance((4,6),(8,4)) chebyshev | 4 マス = 8m |

カバレッジは `packages/rules` で行 90% 以上を目安にする（`vitest --coverage` に `@vitest/coverage-v8` を追加してよい。報告に書く）。

## 12. やらないこと

- 画面、API、DB の変更（Phase 0 の `rule_constants` を読む処理も Phase 4 で作る）
- 乱数でダイスを振る機能
- 制圧射撃、遮蔽物、爆発物、ネットランニング、ロール能力、治療（Issue 未決）
- 日本語版の数値の推測。分からない値は定数にして報告に書く

## 13. 完了条件

- 上のテストがすべて通り、`npm run lint`、`npm run typecheck`、`npm test` が通る
- 報告に、実装した関数の一覧、テスト結果、カバレッジ、指示書と違う判断をした箇所を書く
