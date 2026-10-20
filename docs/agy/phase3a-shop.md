# Phase 3a 指示書: 商店

- 作成: 2026-10-20（Claude）
- 作業ブランチ: `agy/phase3a-shop`（main から切る。Phase 2 と PIN の廃止がマージ済みであること）
- 報告: `docs/agy/reports/phase3a-shop-<連番>.md`
- 前提として読むもの: `docs/SPEC.md`（§3 権利、§5.2 商店、§5.5 PC 管理、§6 データモデル、§10 UI）、`docs/agy/README.md`
- モック（承認済み）: <https://claude.ai/artifact/54Qt6LXbYVRxwfwH4Kkg5S> の「GM — 商店」

## ゴール

GM 画面の **商店タブ** で、FVTT から取り込んだ 518 品目を価格と画像つきで探し、PC に買わせ（所持金を減らして所持品に入れる）、売らせる。店ごとの在庫と価格倍率を GM が決められる。

- 商店は **GM 画面だけ** に置く（SPEC §5.0。プレイヤーのスマホには出さない）。買った物はプレイヤーのキャラシートの所持品と資金に反映される（Phase 2 の `me:update`）
- **仕様にない機能を足さない**。迷ったら作らずに報告に書く（2026-10-20 ユーザー指摘。PIN のように頼まれていない機能を作らない）

## 1. カタログ（GM 画面 › 商店）

モック「GM — 商店」の配置に合わせる: 左にカテゴリ（件数つき）と絞り込み、中央に品目のカード、右に選んだ品目の詳細とカート。

- カテゴリ: 武器 / 防具 / サイバーウェア / サイバーデッキ / ギア / 衣服 / 弾薬 / 改造パーツ / プログラム / 乗り物 / ドラッグ（Phase 0 の `kind`）
- 検索: 日本語名・英語名の部分一致（Phase 0 の `/api/items?q=`）
- 絞り込み: 価格カテゴリ、武器種別、隠匿の可否、品質、データの確認状態（verify_status）
- 並び替え: 価格、名前、ダメージ（武器）、SP（防具）
- 表示の切り替え: カード / 表
- カード: 画像、日本語名（`name_ja_override` があればそれ）、英語名、主要性能（武器はダメージ・ROF・装弾数、防具は SP、サイバーウェアは人間性の減少量 `固定値（ダイス）`）、価格、確認状態のバッジ（確認済み / 非公式 / 未確認）
- 詳細: 全性能（`weapons` / `armors` / `cyberwares` の列）、出典（英語版 p. / 日本語版 p.）、画像、GM の要約（`summary_ja`）、英語の説明文（`description_en`。GM 画面なので表示してよい。折りたたんで出す）
- **価格カテゴリ**: rule_constants `price_category` の境界で分類する。表示名（`label_ja`）が空のあいだは「〜10 eb」「〜20 eb」のように境界の数値で出す。GM が設定画面で表示名を入れられる（日本語版の訳語に合わせるため。SPEC §5.2）
- 検索は 518 件で 200ms 以内（SPEC §9）

## 2. 店舗

- GM が店を作る: 名前、価格倍率（例 1.0、1.2）、買取率（例 0.5）、扱うカテゴリ
- 在庫: 品目と数量（数量なし＝無制限）。カタログのカードから「この店の在庫に入れる」
- 商店タブの上部で「全カタログ」と「店: ○○」を切り替える。店を選ぶと、その店の在庫だけ・その店の価格（倍率をかけて 1 eb 未満切り捨て）で出す

## 3. 購入と売却

- カート: 品目と数量を入れる。合計を出す
- **買う PC を選んで確定** すると、1 トランザクションで次を行う
  - PC の `eb` を減らす（足りなければ確定できない。不足額を出す）
  - PC の所持品（`inventory`）に入れる。サイバーウェアは「所持品に入れる」と「取り付ける（`cyberware` に入れる）」を選べる。取り付けるときは人間性を減らす（減らす量は GM が「固定値 / 振った出目を入力」を選ぶ。`packages/rules` の `humanityAfterInstall`、最大人間性と EMP は `maxHumanity` / `currentEmp` で計算）
  - 店の在庫を減らす
  - `money_log` と `char_log` に書き、本人に `me:update` と `notify`（例: 「購入: 大型拳銃 −100 eb」）
  - 取引履歴（`transactions`）に残す
- **値引き**: カートの各行で、GM が価格を手で上書きできる（取引技能の判定は GM がリアルダイスで行う。SPEC §5.2）
- **売却**: PC の所持品から選び、店の買取率で eb を戻す（1 eb 未満切り捨て）。所持品から外す。ログと通知は購入と同じ
- 取引履歴: 日時、PC、店、品目、数量、金額、上書きした価格

## 4. 画像

- 表示の優先順位: ① GM が登録した本のスキャン画像 → ② GM がアップロードした画像 → ③ FVTT のアイコン → ④ カテゴリの既定アイコン（SPEC §5.2）
- GM の画像登録: 詳細画面から画像ファイルを選ぶ（スマホなら撮影も）→ ブラウザ上で四角く切り抜く（canvas で実装してよい）→ アップロード。保存先は `data/images/user/`。`images` に `origin`（book_scan / user）、出典の本とページ、`visibility`（**book_scan は既定で gm、user は既定で players**。SPEC §3）を記録する
- アップロードは png / jpeg / webp だけ受け付ける（SVG は受け付けない）。サイズ上限 10MB。サーバ側で拡張子と中身（先頭のバイト）を確かめる
- 画像は git に入れない（`data/` は管理外）

## 5. DB（drizzle のマイグレーションを追加）

| テーブル | 列 |
|---|---|
| `shops` | id, name, price_multiplier, buyback_rate, categories(JSON), created_at, updated_at |
| `shop_stock` | id, shop_id, item_id, quantity null（null は無制限） |
| `transactions` | id, character_id, shop_id null, kind（buy / sell）, lines(JSON: item_id, name, qty, unit_price, overridden), total_eb, at |

`characters.inventory` の形を決める: `[{ entry_id, item_id, name, qty, equipped?: boolean, notes? }]`。Phase 2 の既存データ（文字列の配列などになっていれば）を移行する。保存ファイル（cpgm-save）の `version` を 2 に上げ、`shops`・`shop_stock`・`transactions` を含める。version 1 のファイルも読めるようにする。

## 6. API（gm だけ。入出力は zod）

- `GET /api/items`（既存）に絞り込み・並び替えの引数を足す。`GET /api/items/:id` に詳細（サブテーブル、画像の一覧）
- `PATCH /api/items/:id`（GM が編集する列だけ: name_ja_override, summary_ja, source_page_ja, verify_status, tags, notes）
- `GET/POST/PATCH/DELETE /api/shops`、`/api/shops/:id/stock`
- `POST /api/purchase` `{ character_id, shop_id?, lines: [{ item_id, qty, unit_price_override? }], install_cyberware?: [{ item_id, humanity_loss }] }`
- `POST /api/sell` `{ character_id, shop_id?, entries: [{ entry_id, qty }] }`
- `GET /api/transactions`
- `POST /api/items/:id/images`（multipart）、`PATCH/DELETE /api/images/:id`
- `GET/PUT /api/settings/price-categories`（表示名の設定）

## 7. テスト

- 購入: 残高が減る・所持品に入る・在庫が減る・ログと通知・不足時は確定しない・価格の上書き・店の倍率
- サイバーウェアの取り付け: 人間性が減り、最大人間性と EMP が `packages/rules` どおりになる
- 売却: 買取率、所持品から外れる
- 保存: version 2 の保存と読み込み、version 1 の読み込み
- 画像: png は受け付け、svg と偽の拡張子は拒否する。player は gm の画像を取れない（既存のテストを維持）
- E2E: GM が商店で大型拳銃をヴァイパーに買わせる → スマホのキャラシートの資金と所持品が変わり、通知が出る
- スクリーンショット: 商店（1440px、カード表示と詳細）、購入後のスマホのキャラシート（390px）

## 8. やらないこと

- プレイヤーのスマホでの商店画面（SPEC §5.0 で、スマホは自分のキャラシートと行動だけ）
- キャラ作成画面（Phase 3b）、技能一覧（Phase 3b）
- 取引技能の判定の自動化
- ログイン・パスワード・PIN など、指示書にない仕組み

## 9. 完了条件

- `npm run lint`、`npm run typecheck`、`npm test`、E2E が通る
- 報告に、スクリーンショット、指示書と違う判断をした箇所、ユーザーに確認してほしいことを書く
- **テスト用に動いている `npm start` のサーバ（ポート 8787）は止めない**。E2E は別のポートで動かす
