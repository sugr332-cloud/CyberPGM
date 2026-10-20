# Phase 4a 取り込みの差分判定（不具合 04）対応報告

- **作成日**: 2026-10-20
- **作業ブランチ**: `agy/phase4a-import-fix`
- **対象ドキュメント**: `docs/agy/phase4a-combat.md` §13

---

## 1. 修正概要

`docs/agy/phase4a-combat.md` §13「マージ後の不具合 04」に対応しました。
FVTT インポーター（`tools/import-fvtt/src/importer.ts`）において、既存品目の差分判定が `items` テーブルの列のみを対象としていたため、サブテーブル（`weapons`, `armors`, `cyberwares`）に新しい列が追加されたりサブテーブルの値が更新された場合に差分が検知されず、すべて「Unchanged」としてスキップされていた問題を修正しました。

サブテーブル（`weapons`, `armors`, `cyberwares`）の全列の差分判定関数（`isWeaponDiff`, `isArmorDiff`, `isCyberwareDiff`, `isSubtableDiff`）を追加し、サブテーブルに差分がある場合にも更新（Updated）として検知し、`insertOrUpdateSubtables` で正しく最新値を反映するように改修しました。

また、`weapons` テーブルの `suppressive` 列が `insertOrUpdateSubtables` の INSERT / UPDATE SQL に含まれていなかった不備も修正し、`sys.fireModes.suppressiveFire` が正しく格納・更新されるようにしました。

GM が手動編集する列（`name_ja_override`, `summary_ja`, `source_page_ja`, `verify_status`, `tags`, `notes` および画像の `visibility`）は従来どおり上書きされず保持されます。

---

## 2. 修正内容と対応テスト

### 2.1 サブテーブル差分判定の実装と更新処理の改修

- **修正ファイル**: `tools/import-fvtt/src/importer.ts`
- **内容**:
  1. **サブテーブル比較関数の追加**:
     - `isWeaponDiff`: `weapons` テーブルの各列（`weapon_type`, `skill`, `damage`, `rof`, `magazine_max`, `hands`, `concealable`, `quality`, `autofire`, `crit_fail_effect`, `dv_table_key`, `ammo_types`, `is_ranged`, `suppressive`, `ignore_armor_percent`）と FVTT の値を比較。
     - `isArmorDiff`: `armors` テーブルの各列（`sp_head`, `sp_body`, `is_head`, `is_body`, `is_shield`, `shield_hp`, `penalty`）と FVTT の値を比較。
     - `isCyberwareDiff`: `cyberwares` テーブルの各列（`cw_type`, `install_location`, `humanity_loss_roll`, `humanity_loss_static`, `is_core`, `slot_size`）と FVTT の値を比較。
     - `isSubtableDiff`: 品目の `kind` に応じて上記をディスパッチ。
  2. **差分判定への統合**:
     - `runImport` の既存品目ループで `const hasSubtableDiff = isSubtableDiff(sqlite, itemId, kind, doc);` を実行。
     - `isItemDiff || isImageDiff || hasSubtableDiff` の場合に更新処理を実行。
     - `hasSubtableDiff` が `true` の場合、`insertOrUpdateSubtables(sqlite, itemId, kind, doc)` を呼び出してサブテーブルを更新し、`items.updated_at` を更新。
  3. **`weapons.suppressive` 列の反映**:
     - `sys.fireModes?.suppressiveFire ? 1 : 0` を抽出し、`insertOrUpdateSubtables` の INSERT および UPDATE SQL に `suppressive` カラムを追加。
- **対応テスト**:
  - `tools/import-fvtt/test/import.test.ts` > `updates subtable columns when suppressive or ignore_armor_percent is null (migration update) and is unchanged on subsequent run (§13)`:
    - 既存 DB の `weapons` の `suppressive` と `ignore_armor_percent` を `NULL` に設定した状態（古い形の DB）で `runImport` を実行すると、差分が検知され `counts_by_kind.weapon.updated = 2`, `total.updated = 2` となり、正しく値が更新されることを検証。
    - 続けて 2 回目の `runImport` を実行すると、差分がなくなり `total.updated = 0`, `total.unchanged = 4` になることを検証。

---

## 3. テスト実行結果

### 3.1 インポーター単体テスト (`tools/import-fvtt/test/import.test.ts`)
- **結果**: 6 テスト全件成功 (パス)
  - `imports items correctly with expected column values`
  - `does not increase count on second run (idempotent)`
  - `does not overwrite GM edited columns on subsequent run`
  - `preserves image visibility when GM manually changes it to gm (Issue #14 Review 02)`
  - `sets license = unknown and attribution = see CREDITS.md when icon has no matching credits entry`
  - `updates subtable columns when suppressive or ignore_armor_percent is null (migration update) and is unchanged on subsequent run (§13)`

### 3.2 全単体テスト (`npm test`)
- **結果**: 22 ファイル、129 テスト全件成功 (パス)

### 3.3 E2E テスト (`npx playwright test`)
- **結果**: 4 テスト全件成功 (パス, 9.2s)

---

## 4. 制約遵守の確認

- `npm start`（ポート 8787）: 常駐プロセスに触れず、停止・再起動・実行を行っていません。
- 本番 DB（`data/cyberpgm.db`）: 一切読み書き・変更を行っていません（本番取り込み直しは指示書どおり Claude 側で行われます）。
- 複数行や隠れた行のある `node -e` コマンド: 一切実行していません。
