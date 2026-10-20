# Phase 5a 指示書: シナリオメーカー

- 作成: 2026-10-21（Claude）
- 作業ブランチ: `agy/phase5a-scenario-maker`（main から切る。Phase 4b がマージ済みであること）
- 報告: `docs/agy/reports/phase5a-scenario-maker-<連番>.md`
- 前提として読むもの: `docs/SPEC.md`（§3 権利、§5.3 シナリオ、§5.3.1 ステージ、§5.3.2 ストーリー進行、§6、§10）、`docs/agy/phase4a-combat.md` §11〜§13 と `docs/agy/phase4b-board.md` §12〜§13（過去の指摘。同じ間違いをしない）
- モック（承認済み）: <https://claude.ai/artifact/54Qt6LXbYVRxwfwH4Kkg5S> の「GM — シナリオメーカー」
- **仕様にない機能を足さない**。**ルールの数値を推測で入れない**。**AI による生成はしない**（SPEC §5.3）。報告にはやったことだけを、項目ごとのテスト名つきで書く

## ゴール

GM 画面の **シナリオタブ** で、シナリオを作って保存できる。シーン・分岐・NPC・エンカウンター・ハンドアウト・手がかり・ランダム表をそろえ、フローチャートで全体を見られる。

Phase 5 は 2 つに分ける。

- **5a（この指示書）**: シナリオメーカー（作る・編集する・書き出す）と画像の一覧
- **5b（次）**: 進行モード（シーンの表示、背景と盤面、視界を隠す、選択肢と判定ボード、プレイヤーへの公開、セッションログ、エンカウンターの戦闘投入）

## 1. データ（drizzle のマイグレーションを追加）

| テーブル | 列 |
|---|---|
| `scenarios` | id, title, summary, meta(JSON: players_min, players_max, hours, reward_note, tags[]), version, created_at, updated_at |
| `scenario_versions` | id, scenario_id, version, snapshot(JSON), saved_at |
| `scenes` | id, scenario_id, title, read_aloud, gm_notes, location, npc_ids(JSON), position(JSON: x, y), background_image_id null, board_id null, sort_index |
| `scene_links` | id, scenario_id, from_scene_id, to_scene_id, condition（文字） |
| `scene_choices` | id, scene_id, label, skill_key null, dv null, who（全員 / ロール名の配列 / キャラ ID の配列）, on_success(JSON), on_failure(JSON), sort_index |
| `clues` | id, scenario_id, scene_id null, title, body, image_id null |
| `handouts` | id, scenario_id, scene_id null, title, body, image_id null |
| `encounters` | id, scenario_id, scene_id null, title, participants(JSON: character_id, side, count, x?, y?), notes |
| `random_tables` | id, scenario_id null, title, dice（`d6` / `d10` / `2d6` など）, rows(JSON: from, to, text) |

- `on_success` / `on_failure` に持てる結果（5b で反映する。5a では入力と保存だけ）: 次のシーン、手がかりの公開、ハンドアウトの公開、HP の増減、状態の付与、アイテムの入手、メモ。種類はこの一覧だけにして増やさない
- `dv` は空でよい（GM が進行中に決める）。目安のボタンは Phase 3b の「難易度目安（DV値）」（`rule_constants`。Issue #3）を使い、数値を新しく作らない
- シナリオの店舗（SPEC §5.3「店舗」）は `scenarios.meta.shop_ids` に Phase 3a の店の ID を持つだけにする
- 保存ファイル（cpgm-save）の `version` を 5 に上げ、上の表をすべて含める。1〜4 も読めるようにする

## 2. シナリオの一覧と基本情報

- シナリオタブの左に一覧（新規作成・複製・削除・JSON の書き出し / 取り込み）
- 基本情報: タイトル、概要、推奨人数、想定時間、報酬（文字）、タグ、使う店
- **バージョン履歴**: 「保存」のたびに `scenario_versions` にスナップショットを残す。一覧から選んで中身を見られ、「この版に戻す」で戻せる（戻す前の状態も 1 つの版として残す）
- **テンプレート**: 「依頼 → 調査 → 潜入 → 戦闘 → 報酬」の 5 シーンと 4 本の分岐を作るだけの雛形を 1 つ用意する。シーンの中身（読み上げ文など）は空にする（文章を作らない）

## 3. シーンとフローチャート（モック「GM — シナリオメーカー」）

- フローチャート: シーンをノード、`scene_links` を矢印で描く。ノードはドラッグで動かせ、位置は `scenes.position` に保存。ノードの端から別のノードへドラッグで分岐を作る。矢印をクリックで条件の文字を編集・削除
- スマホ幅（390px）では一覧表示に切り替える（ドラッグなし。分岐は「次のシーン」の選択で作る）
- シーンを選ぶと右に編集欄: タイトル、読み上げ文、GM メモ、場所、登場 NPC（DB の NPC から選ぶ。PC タブで作った NPC。新規作成は PC タブの「NPC/モブ追加」を開く）、背景画像（§5 の一覧から）、盤面（Phase 4b の盤面から選ぶか「新しい盤面」）、選択肢（§1 の `scene_choices`）、手がかり、ハンドアウト、エンカウンター
- 選択肢の技能は Phase 3b の技能カタログから選ぶ。日本語名を出す

## 4. エンカウンター・ハンドアウト・手がかり・ランダム表

- エンカウンター: 参加者（NPC・モブと人数、敵か味方か）、盤面に置く位置（任意）、メモ。5a では作って保存するだけ（戦闘への投入は 5b）
- ハンドアウト・手がかり: タイトル、本文、画像（任意）。5a では作って保存するだけ（公開は 5b）
- ランダム表: ダイスの種類を選び、行（出目の範囲と結果の文字）を入れる。**出目を入れて結果を引く**（リアルダイス。アプリで振るボタンもつける）。範囲の重なり・抜けがあれば保存の前に警告する。シナリオに属さない共通の表も作れる（`scenario_id` が null）

## 5. 画像の一覧と本の画像の登録

- `GET /api/images`（GM だけ）: 画像の一覧（origin・出典・visibility・タイトルで絞り込み）。シーンの背景・ハンドアウト・手がかりの画像はここから選ぶ。アップロード（Phase 3a と同じ制限）もここからできる
- `images` に `title` 列を足す
- **本の画像の登録ツール** `tools/import-images`: `--dir <フォルダ> --db <DB のパス>` で、フォルダの `manifest.json`（形式は `data/images/book_scan/easymode/manifest.json`。`file`・`title`・`source`・`page_ja`・`visibility`）を読み、`images` に `origin = 'book_scan'`、`visibility` は manifest の値（なければ `gm`）、`source_book`・`source_page`・`title` を入れる。同じ `path` は二重に登録しない。画像ファイルはコピーせず、その場所を `path` に記録する
  - テスト用には、テストの中で一時フォルダに小さな png と manifest を作って確かめる。**`data/images/book_scan/` の本物の画像をテストに使わない・コミットしない**
  - 本番 DB への登録はマージ後に Claude が行う
- 本のスキャン（`visibility = gm`）を TV やスマホに出すときの警告は Phase 4b と同じ（5b で使う）

## 6. API（GM だけ。入出力は zod）

- `GET/POST/PATCH/DELETE /api/scenarios`、`POST /api/scenarios/:id/duplicate`、`GET /api/scenarios/:id/export`、`POST /api/scenarios/import`
- `GET /api/scenarios/:id/versions`、`POST /api/scenarios/:id/versions/:vid/restore`
- シーン・分岐・選択肢・手がかり・ハンドアウト・エンカウンター・ランダム表の CRUD
- `POST /api/random-tables/:id/roll`（出目 → 行）
- 取り込み（import）は zod で中身を確かめ、ID を振り直す（既存のシナリオを上書きしない）

## 7. テスト

- シナリオの作成・複製・削除・書き出し → 取り込み（ID が振り直され、中身が同じ）
- バージョン: 保存 3 回で 3 版、2 版目に戻すと中身が 2 版目と同じ、戻す前の状態も版に残る
- テンプレート: 5 シーンと 4 本の分岐ができ、シーンの文章が空
- ランダム表: 2d6 の表で出目 7 の行が引ける、範囲の重なり・抜けで警告
- 選択肢: `on_success` に一覧外の種類を入れると 400
- 画像の登録ツール: 一時フォルダの manifest から登録、2 回目は二重登録しない、visibility の既定が gm
- 保存: version 5 の保存と読み込み、1〜4 の読み込み
- E2E: テンプレートからシナリオを作る → シーンに読み上げ文と選択肢（知覚・難易度は目安ボタンから）を入れる → フローチャートでノードを動かし分岐を足す → 保存して再読み込みしても残っている
- スクリーンショット: フローチャートとシーンの編集（1440px）、スマホ幅の一覧表示（390px）、ランダム表（1440px）

## 8. やらないこと

- 進行モード、背景の表示、視界を隠す、判定ボード、プレイヤーへの公開、戦闘への投入（5b）
- AI による文章や画像の生成、シナリオの文章の自動作成
- 成長ポイント（IP）の配布（Issue #17 で仕様未決）
- ログイン・パスワード・PIN など、指示書にない仕組み

## 9. 完了条件

- `npm run lint`、`npm run typecheck`、`npm test`、E2E が通る
- 報告に、スクリーンショット、指示書と違う判断をした箇所、ユーザーに確認してほしいこと、**項目ごとのテスト名** を書く
- **テスト用に動いている `npm start`（8787）は止めない・実行しない**。E2E は 8788
- 本番の `data/cyberpgm.db` に触らない（マイグレーションも、画像の登録も。マージ後に Claude が行う）
- 作業を捨てる前（`git checkout -- <ソース>` など）は、途中のコミットを作業ブランチに残す
