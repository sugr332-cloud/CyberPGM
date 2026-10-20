# Phase 4a レビュー指摘 02 対応報告

- **作成日**: 2026-10-20
- **作業ブランチ**: `agy/phase4a-combat`
- **対象ドキュメント**: `docs/agy/phase4a-combat.md` §11

---

## 1. 修正概要

`docs/agy/phase4a-combat.md` §11「レビュー指摘 02」の全項目（11.1〜11.12）に対応しました。
計算ロジック内の推測値・既定値を全廃し、技能値の正規化変換、武器データからの防具無視率取得、所持品での弾数追跡、出目 10/1 および致命傷時の追加出目要求、ROF 2 順次解決、プレイヤーへの敵数値非開示を実装しました。

---

## 2. 指摘項目ごとの修正内容と対応テスト

### 11.1 作り話の値の全廃
- **修正内容**:
  - `apps/server/src/services/combat-resolver.ts` から以下すべての既定値・フォールバックを削除しました:
    - DV 表の既定値 `[0-6:13, 7-12:15, ...]`
    - `'dv_table.Pistol'` への逃げ、`wData?.skill || 'Handgun'`、`'射撃武器'`
    - 距離の既定 `?? 5`、出目の既定 `: 1`、ダメージの既定 `[1,1,1]` / `[1,1]`
    - オートファイア倍率上限の既定 `?? 3`、弾数の既定 10
    - 近接の固定 `ignoreArmorPercent: 50`
  - 必要項目が不足している場合は計算を行わず、不足内容（`missing_inputs`）を画面に返却し、「確定して反映」ボタンを無効化するように改修しました。
- **対応テスト**:
  - `apps/server/test/combat.test.ts` > `11.1: stops calculation and reports missing inputs when required data is not supplied`

### 11.2 オートファイアの DV 表の参照キー修正
- **修正内容**:
  - `apps/server/src/services/combat-resolver.ts` で、武器の `dv_table_key` に ` (Autofire)` を付与した定数名（例: `dv_table.Assault Rifle (Autofire)`）から DV 表を取得するように修正しました。表が存在しない場合は計算を中断し未入力警告を返します。
  - GM が入力した `ammo_spent`（消費弾数）に基づいて弾数を減算します。
- **対応テスト**:
  - `apps/server/test/combat.test.ts` > `11.2: resolves autofire using dv_table.${dvTableKey} (Autofire) and GM specified ammo_spent`

### 11.3 技能値のキー食い違い修正（`skillNameToKey`）
- **修正内容**:
  - `packages/shared/src/skills.ts` に、英語表記名（`Handgun`, `Shoulder Arms`, `Melee Weapon`, `Evasion` 等）や FVTT 名、日本語表記名から `characters.skills` のカタログキー（`handgun`, `evasion`, `melee_weapon` 等）へ変換する単一関数 `skillNameToKey()` を実装・export しました。
  - `combat-resolver.ts` の射撃・近接・回避・オートファイアの全箇所でこの関数を通して技能値を引き当てるように統一しました。
- **対応テスト**:
  - `packages/shared/test/skills.test.ts`（全 7 テスト）
  - `apps/server/test/combat.test.ts` > `11.3: resolves Viper base attack with Handgun (REF 8 + handgun 6 = 14) and Nyx defense (DEX 5 + evasion 4 = 9)`

### 11.4 近接の防具無視率を武器データで保持・適用
- **修正内容**:
  - `apps/server/src/db/schema.ts` の `weapons` テーブルおよび `packages/shared/src/types.ts` に `ignore_armor_percent` カラム（integer nullable）を追加しました。
  - Drizzle マイグレーション `drizzle/0006_wealthy_spiral.sql` を生成しました。
  - `tools/import-fvtt/src/importer.ts` で FVTT YAML の `system.ignoreArmorPercent` を取り込むよう拡張しました。
  - `combat-resolver.ts` で武器の `ignore_armor_percent` を `resolveDamage` に渡すように修正しました。
- **対応テスト**:
  - `tools/import-fvtt/test/import.test.ts`
  - `apps/server/test/combat.test.ts` > `11.4: resolves melee attack applying weapon ignore_armor_percent (50%) to target SP`

### 11.5 弾数管理の実装と反映
- **修正内容**:
  - `packages/shared/src/schemas.ts` および `types.ts` の `InventoryEntry` に `ammo?: number` を追加しました。
  - `apps/web/src/pages/PlayerPage.tsx` の所持品一覧に弾数表示（`残弾: {ammo}`）を追加しました。
  - GM 画面（`CombatView.tsx`）に装備武器選択ドロップダウンを追加し、手番キャラクターの武器を選択可能にしました。
  - 射撃時に残弾を減算し、`apply` および `undo` で `characters.inventory` の `ammo` 値を数値で記録・更新・復元するように改修しました。
  - リロード行動（`action_key === 'reload'`）で `magazine_max` まで弾数を補充し、予備弾薬アイテム（名前が bullet/ammo/弾 を含むもの）の `qty` を 1 消費する処理を実装しました。
- **対応テスト**:
  - `apps/server/test/combat.test.ts` > `11.5: tracks weapon ammo on attack, restores on undo, and refills on reload`

### 11.6 出目 10 / 1 の追加ロール要求
- **修正内容**:
  - 攻撃出目または防御出目が 10（クリティカル）または 1（ファンブル）の場合に、追加出目（1d10）が未入力なら計算を中断し、追加出目の入力を促すメッセージを返すようにしました。
  - GM 画面（`CombatView.tsx`）に出目 10/1 時に追加出目入力欄を表示するようにしました。
- **対応テスト**:
  - `apps/server/test/combat.test.ts` > `11.6: requires extra roll when attack or defense roll is 10 or 1`

### 11.7 ROF 2 複数回攻撃の順次解決
- **修正内容**:
  - `SingleAttackInput` および `attacks` 配列を定義し、1 回のアクションで複数回の攻撃判定・出目・ダメージを順次計算できるようにしました。
  - 1 発目の命中・SP 削れを反映した状態で 2 発目を解決し、弾数（2 発消費）と防御側の HP/SP 変化を 1 回のログ・トランザクションでまとめて確定・反映できるようにしました。
  - GM 画面（`CombatView.tsx`）に「第2攻撃を行う（ROF 2 武器用）」チェックボックスと第2攻撃の出目入力欄を追加しました。
- **対応テスト**:
  - `apps/server/test/combat.test.ts` > `11.7: resolves ROF 2 sequential attacks in one action, applying 2 hits and spending 2 ammo`

### 11.8 致命傷表出目の要求と HTML タグ除去
- **修正内容**:
  - ダメージダイスで 6 が 2 つ以上出た場合、致命傷表の出目（2d6）が指定されていなければ計算を中断し、「致命傷表 (2d6) の出目を入力してください」を返すようにしました。
  - 致命傷表の名称および説明文に含まれる `<p>…</p>` 等の HTML タグを除去する `stripHtml()` 関数を適用して保存・表示するように修正しました。
- **対応テスト**:
  - `apps/server/test/combat.test.ts` > `11.8: requires 2d6 roll on critical injury and strips HTML tags from description`

### 11.9 プレイヤーへの敵数値の非開示
- **修正内容**:
  - `apps/server/src/routes/combat.ts` の `notifyCombatResult` で、攻撃側プレイヤーへ送る通知から敵の生 HP・生 SP の数値変化を除外しました。
  - 代わりに「命中 · ガンガー #1 に X ダメージ → 重傷」の形式でダメージ値と負傷状態バッジのみを通知するように改修しました。
- **対応テスト**:
  - `apps/server/test/combat.test.ts` > `11.9: does not leak enemy numeric HP and SP to player in combat:result notification`

### 11.10 指示書にない機能の除外と手入力化
- **修正内容**:
  - 照準射撃（脚）での移動力半減の自動付与を削除し、GM 手入力（`manual_changes`）に変更しました。
  - 被弾時の画面赤フラッシュ演出は追加せず、SPEC 規定のトースト通知のみとしています。
  - 行動順の同値判定について、指示書どおり REF 比較（同値は GM によるダイス振り直し）とし、「PC優先」などの非規定処理を排除しました。

### 11.11 報告の正確性
- 実際にコードを実装しテストで確認した事実のみを本報告書に記載しています。

### 11.12 本番 DB の保護
- 本番 DB（`data/cyberpgm.db`）へのマイグレーション実行やデータ直接変更は一切行っていません。
- テストは `vitest.setup.ts` による一時 DB（`os.tmpdir()` 配下）および E2E 用の `data/test-e2e.db` でマイグレーションを当てて検証しました。
- ポート 8787 で稼働中の常駐サーバープロセスは停止せず、`npm start` も実行していません。

---

## 3. テスト実行結果

### 単体テスト（Vitest）
```bash
npm test
# 結果: 22 テストファイル全パス (121 テスト成功)
```

### E2E テスト（Playwright）
- `e2e/global-setup.ts` を追加し、E2E 起動時に `data/test-e2e.db` へマイグレーションを適用。
- ポート 8788 で実行。
```bash
npx playwright test e2e/combat.spec.ts
# 結果: 1 passed (2.5s)
```

### スクリーンショット再撮影
E2E 実行により、以下の 4 枚を再撮影・更新しました:
- `docs/agy/reports/img/phase4a-participants-check.png`
- `docs/agy/reports/img/phase4a-combat-resolve.png`
- `docs/agy/reports/img/phase4a-combat-mobile.png`
- `docs/agy/reports/img/phase4a-player-action.png`

### 型チェック（TypeScript）および Lint
```bash
npm run typecheck # エラー 0 件
npm run build     # 正常終了
```
