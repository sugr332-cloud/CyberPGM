# Phase 5c 指示書: 品目の効果とフレーバー

- 作成: 2026-10-21（Claude）
- 作業ブランチ: `agy/phase5c-item-info`（main から切る。Phase 5b がマージ済みであること）
- 報告: `docs/agy/reports/phase5c-item-info-<連番>.md`
- 前提として読むもの: `docs/SPEC.md` §3 権利、§5.2 商店、§5.1 戦闘（参加者カード）、`docs/agy/phase3a-shop.md`、`docs/agy/phase4a-combat.md`
- **仕様にない機能を足さない**。**文章を作らない・書き換えない**（用意した下書きをそのまま入れる）。報告にはやったことだけを、項目ごとのテスト名つきで書く

## ゴール（2026-10-21 ユーザー決定）

GM が、持ち物の **効果**（何ができるか）と **フレーバー**（雰囲気の一文）を日本語で見られる。どちらも Claude が書いた下書きを最初に入れておき、GM が書き換えられる。表示する場所は **GM の商店と戦闘の参加者カードだけ**（プレイヤーのスマホには出さない）。

## 1. データ

- `docs/data/item-notes.ja.json`（Claude が用意した。改変しない）: `notes` のキーは FVTT の id（`items.fvtt_id`）、値は `{ name_ja, name_en, effect, flavor }`。518 件すべてにある。`effect` が空の品目は「特別な効果なし」（性能の欄だけで足りるもの）
- `items` に列を足す: `effect_ja`、`flavor_ja`、`effect_is_draft`（真偽）、`flavor_is_draft`（真偽）
- シード（起動時。Phase 3b の skill-notes と同じ扱い）: `effect_ja` / `flavor_ja` が null の品目にだけ JSON の値を入れ、`*_is_draft = true`。**GM が編集した値（`*_is_draft = false`）は上書きしない**。FVTT の取り込み直し（`import:fvtt`）でも消えないこと
- GM が編集して保存したら `*_is_draft = false`
- 保存ファイル（cpgm-save）に、GM が編集した品目の `effect_ja`・`flavor_ja` を含める（いまの版の形に合わせて足す。版を上げる場合は古い版も読めること）

## 2. 商店の詳細（GM。Phase 3a の詳細欄）

- 詳細の上の方に「効果」と「フレーバー」を出す。下書きのあいだは小さな「下書き」の印を付ける
- 効果が空なら「特別な効果なし（性能の欄を参照）」と出す
- 「編集」で 2 つの欄を書き換えて保存できる。「下書きに戻す」で JSON の値に戻せる
- これまでの英語の説明（`description_en`）は、折りたたみのまま残す
- カード表示・表表示には出さない（詳細だけ）

## 3. 戦闘の参加者カード（GM。Phase 4a のカードの詳細）

- カードの詳細の所持品・武器・防具・サイバーウェアの各行をタップ（クリック）すると、その品目の性能・効果・フレーバーを小さな窓で出す
- 品目 ID のない行（`characters.weapons` の文字列など）は「品目の情報なし」と出す
- 戦闘の別ウィンドウ（`/gm/combat`）のカードでも同じ
- TV（`/screen`）とプレイヤーのスマホには **送らない**（サーバ側で出し分け。既存の権限分けを維持）

## 4. API

- `GET /api/items`・`GET /api/items/:id` に `effect_ja`・`flavor_ja`・`*_is_draft` を足す（GM だけ）
- `PATCH /api/items/:id` で `effect_ja`・`flavor_ja` を受け付ける（編集すると draft が false）。`POST /api/items/:id/reset-notes` で下書きに戻す

## 5. テスト

- シード: 空の DB で起動すると 518 件に効果とフレーバーが入り、`*_is_draft = true`
- GM が編集 → 再起動しても編集した値のまま、`*_is_draft = false`。「下書きに戻す」で JSON の値に戻る
- `import:fvtt` を流しても、編集した値が消えない
- 権限: player のトークンで `effect_ja` / `flavor_ja` が取れない。`screen:update` に入らない
- 保存: 編集した値が保存と読み込みで残る
- E2E: 商店で大型拳銃の詳細に効果とフレーバー（下書き）が出る → 編集して保存 → 下書きの印が消える。戦闘の参加者カードでヴァイパーの武器をクリックすると同じ内容が出る
- スクリーンショット: 商店の詳細（1440px）、参加者カードの品目の窓（1440px）

## 6. やらないこと

- プレイヤーのスマホへの表示（ユーザー決定で GM だけ）
- 文章の作成・言い換え・翻訳（下書きは Claude が用意した。足りない・おかしいところは報告に書く）
- ログイン・パスワード・PIN など、指示書にない仕組み

## 7. 完了条件

- `npm run lint`、`npm run typecheck`、`npm test`、E2E が通る
- **テスト用に動いている `npm start`（8787）は止めない・実行しない**。E2E は 8788（`IMAGES_DIR` は一時フォルダ）
- 本番の `data/cyberpgm.db` と `data/images/` に触らない（マイグレーションも。マージ後に Claude が行う）
- ソースの変更は編集ツールで行う。作業を捨てる前は途中のコミットを残す
