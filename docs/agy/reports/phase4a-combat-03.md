# Phase 4a レビュー指摘 03 対応報告

- **作成日**: 2026-10-20
- **作業ブランチ**: `agy/phase4a-combat`
- **対象ドキュメント**: `docs/agy/phase4a-combat.md` §12

---

## 1. 修正概要

`docs/agy/phase4a-combat.md` §12「レビュー指摘 03」の全 4 項目に対応しました。
残存していた作り話の既定値（`magazine_max ?? 8`、`autofire ?? 3`、`ignore_armor_percent ?? 50`、取り込み時の `isRanged ? 0 : 50`）を完全に撤廃し、予備弾薬の探索を品目の `kind = 'ammo'` に限定し予備なしリロード不可とし、武器選択欄を所持品（`inventory`）のうち `kind = 'weapon'` の行（`entry_id`、名前、残弾）から生成して計算武器と完全に一致させました。

---

## 2. 指摘項目ごとの修正内容と対応テスト

### 12.1 残っている作り話の既定値の全廃

- **修正内容**:
  - **リロード (`magazine_max`)**:
    - `apps/server/src/services/combat-resolver.ts` で `magazine_max ?? 8` を廃止。武器の `magazine_max` が `null` または未設定の場合は計算せず「装弾数が不明なためリロードできません」として停止するように修正しました。
  - **射撃時の弾数チェック (`magazine_max === null`)**:
    - `magazine_max` が未設定（`null`）の武器（投げナイフ・弓など）は弾数を「—」として扱い、弾数不足チェックを行わず、弾数減算の処理も行わないようにしました。
  - **オートファイア (`wData.autofire`)**:
    - `apps/server/src/services/combat-resolver.ts` で `wData.autofire ?? 3` を廃止。武器の `autofire`（倍率上限）が未設定または 0 以下の場合は「倍率の上限が不明です」として停止するように修正しました。
  - **近接の防具無視率 (`ignore_armor_percent`)**:
    - `apps/server/src/services/combat-resolver.ts` で `wData.ignore_armor_percent ?? 50` を廃止し、武器の数値をそのまま使用するようにしました。
    - 武器に防具無視率が設定されていない（`null`）場合は「防具無視率が不明です (GM が入力してください)」として計算を停止し、GM が入力した `ignore_armor_percent`（0〜100%）を受け取って計算するようにしました。
    - `apps/web/src/components/CombatView.tsx` で、近接選択時に武器データに防具無視率がない場合は「防具無視率が不明。GM が入力 (%)」の入力欄を表示し、値をサーバーへ送信するように実装しました。
  - **FVTT 取り込みの既定値 (`isRanged ? 0 : 50`)**:
    - `tools/import-fvtt/src/importer.ts` で `(isRanged ? 0 : 50)` のフォールバックを撤廃し、FVTT データに `system.ignoreArmorPercent` が存在しない場合はそのまま `null` を格納するように修正しました。
- **対応テスト**:
  - `apps/server/test/combat.test.ts` > `Phase 4a Review 03: Defaults cleanup, Spare ammo by kind, and Weapon entry alignment (§12)`:
    - `12.1: halts reload when magazine_max is undefined or null`
    - `12.1: halts autofire when autofire cap is missing or unconfigured`
    - `12.1: requires GM input for ignore_armor_percent when weapon value is missing, and resolves once provided`
    - `12.1: does not check or deduct ammo when weapon magazine_max is null`
  - `tools/import-fvtt/test/import.test.ts` > `imports items correctly with expected column values` (防具無視率未指定の射撃武器が `null` で取り込まれることを検証)

---

### 12.2 予備弾薬を `kind = 'ammo'` で探索 & 予備なしリロード不可

- **修正内容**:
  - `apps/server/src/services/combat-resolver.ts` のリロード処理で、名前の部分一致（`弾`, `ammo`, `bullet`）による探索を廃止し、所持品（`inventory`）のうち `kind === 'ammo'`（または `items` テーブルで `kind === 'ammo'`）の行のみを予備弾薬として探索するように修正しました。
  - 予備弾薬が所持品にない場合はリロード不可とし、「予備の弾薬がありません」として計算・反映を停止します。
  - 予備弾薬の `qty` が 1 の場合は、リロードで消費されて 0 になり、所持品（`inventory`）からそのエントリを完全に削除（splice）します（`qty > 1` の場合は `qty - 1` に減算）。
- **対応テスト**:
  - `apps/server/test/combat.test.ts` > `Phase 4a Review 03: Defaults cleanup, Spare ammo by kind, and Weapon entry alignment (§12)`:
    - `12.2: prohibits reload when no spare ammo with kind = ammo is present in inventory`
    - `12.2: consumes spare ammo of qty 1 on reload and removes the entry completely from inventory`

---

### 12.3 武器選択欄と計算武器の不一致解消

- **修正内容**:
  - **フロントエンド（`apps/web/src/components/CombatView.tsx`）**:
    - 武器選択ドロップダウンの選択肢生成から `characters.weapons`（ID を持たない表示用文字列）を除外し、**手番キャラクターの所持品（`inventory`）のうち `kind = 'weapon'` の行**（`entry_id`、名前、残弾数）のみから選択肢を作成するように改修しました。
    - ドロップダウンの `option` の `value` に `entry_id` を設定し、選択された `entry_id` を `weapon_entry_id` として `resolve` および `apply` API に送信します。
    - 手番切り替え時に、現在の参加者の所持品武器エントリから最初の武器を自動選択するようにしました。
  - **サーバー（`apps/server/src/services/combat-resolver.ts` & `apps/server/src/routes/combat.ts`）**:
    - `apps/server/src/routes/combat.ts` の `getHydratedCombat` で、キャラクターの所持品各行に対して `weapons` テーブルの存在や `items.kind` に基づき `kind: 'weapon'` および初期残弾（`magazine_max`）を自動ハイドレーションするようにしました。
    - `combat-resolver.ts` で、リロード・射撃・近接攻撃の判定時に `input.weapon_entry_id` を最優先して所持品エントリを引き当て、そのエントリに対して残弾の減算およびリロードを行うように修正しました。
- **対応テスト**:
  - `apps/server/test/combat.test.ts` > `Phase 4a Review 03: Defaults cleanup, Spare ammo by kind, and Weapon entry alignment (§12)`:
    - `12.3: resolves action and deducts ammo by weapon_entry_id from kind = weapon inventory entries` (同種武器を 2 挺所持していても、指定した `weapon_entry_id` の武器の残弾のみが正確に減算されることを検証)
  - `e2e/combat.spec.ts` (E2E テストで所持品の大型拳銃の `weapon_entry_id` を選択して射撃・反映・取り消しが通ることを検証)

---

## 3. テスト実行結果

### 3.1 単体テスト (`npm test`)

- **テスト件数**: 22 ファイル、128 テスト全件成功 (パス)
- **Phase 4a 関連テスト (`apps/server/test/combat.test.ts`)**: 16 テスト全件成功
  - `11.1: stops calculation and reports missing inputs when required data is not supplied`
  - `11.2: resolves autofire using dv_table.${dvTableKey} (Autofire) and GM specified ammo_spent`
  - `11.3: resolves Viper base attack with Handgun (REF 8 + handgun 6 = 14) and Nyx defense (DEX 5 + evasion 4 = 9)`
  - `11.4: resolves melee attack applying weapon ignore_armor_percent (50%) to target SP`
  - `11.5: tracks weapon ammo on attack, restores on undo, and refills on reload`
  - `11.6: requires extra roll when attack or defense roll is 10 or 1`
  - `11.7: resolves ROF 2 sequential attacks in one action, applying 2 hits and spending 2 ammo`
  - `11.8: requires 2d6 roll on critical injury and strips HTML tags from description`
  - `11.9: does not leak enemy numeric HP and SP to player in combat:result notification`
  - `12.1: halts reload when magazine_max is undefined or null`
  - `12.1: halts autofire when autofire cap is missing or unconfigured`
  - `12.1: requires GM input for ignore_armor_percent when weapon value is missing, and resolves once provided`
  - `12.1: does not check or deduct ammo when weapon magazine_max is null`
  - `12.2: prohibits reload when no spare ammo with kind = ammo is present in inventory`
  - `12.2: consumes spare ammo of qty 1 on reload and removes the entry completely from inventory`
  - `12.3: resolves action and deducts ammo by weapon_entry_id from kind = weapon inventory entries`
- **インポーターテスト (`tools/import-fvtt/test/import.test.ts`)**: 5 テスト全件成功

### 3.2 E2E テスト (`npx playwright test`)

- **実行コマンド**: `npx playwright test`
- **結果**: 4 テスト全件成功 (9.4s)
  - `e2e/combat.spec.ts` (2.1s パス)
  - `e2e/character-creation.spec.ts` (2.4s パス)
  - `e2e/session.spec.ts` (1.3s パス)
  - `e2e/shop.spec.ts` (1.8s パス)

---

## 4. 制約遵守の確認

- `npm start`（ポート 8787）: 常駐プロセスに触れず、停止・再起動・実行を行っていません。
- 本番 DB（`data/cyberpgm.db`）: 一切読み書き・変更を行っていません。
- 複数行や隠れた行のある `node -e` コマンド: 一切実行していません。
- 指示書・指摘書にない推測の追加機能: 一切追加していません。
