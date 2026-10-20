# Phase 2 指示書: セッションの土台（LAN 起動・QR 参加・同期・保存・PC 管理）

- 作成: 2026-10-20（Claude）
- 作業ブランチ: `agy/phase2-session`（main から切る。Phase 0・1 はマージ済み）
- 報告: `docs/agy/reports/phase2-session-<連番>.md`
- 前提として読むもの: `docs/SPEC.md`（§4 構成、§5.0 ウィンドウ、§5.0.1 結果の反映、§5.5 PC 管理、§5.7 保存と読み込み、§9 非機能、§10 UI モック）、`docs/agy/README.md`
- モック（承認済み）: <https://claude.ai/artifact/54Qt6LXbYVRxwfwH4Kkg5S> の「GM — PC 管理」「GM — 保存と読み込み」「プレイヤーのスマホ — キャラシート」。ブラウザで開けない場合は、この指示書の文章どおりに作る

## ゴール

GM の PC で `npm start` すると、自宅 Wi-Fi のスマホが QR コードから参加でき、自分のキャラシートを見られる。GM が資金を送ると、そのプレイヤーのスマホにすぐ届く。状態を名前つきで保存し、読み込める。

戦闘・商店・シナリオ・キャラ作成の画面は **作らない**（Phase 3〜5）。GM 画面のタブには置き場所だけ作り、「Phase N で実装」と表示する。

## 0. 外部公開についての許可と制限（README「止まる場面 2」の扱い）

SPEC §4（2026-10-20 ユーザー決定）で、**セッション中だけ LAN の IP で待ち受ける** ことは決まっている。この指示書の範囲で次のことをしてよい。

- 許可: `127.0.0.1` と、GM の PC の **プライベート IPv4 アドレス 1 つ**（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16` のどれか）で待ち受ける
- 禁止（やる必要が出たら止まる）: `0.0.0.0` や `::` での待ち受け、グローバル IP での待ち受け、ファイアウォール（firewalld など）の設定変更、ルーターの設定、トンネル（Tailscale・ngrok など）
- ファイアウォールでスマホからつながらない場合は、**設定を変えずに** 報告に「GM が手で行う手順」を書く

開発用の `npm run dev` は今までどおり `127.0.0.1` だけにする。

## 1. 起動（`npm start`）

- ルートの `npm start` = web をビルドして、server が **API・WebSocket・web の静的ファイルを 1 つのポート**（既定 8787、`PORT` で変更）で配信する
- 待ち受ける LAN の IP は、起動時にネットワークインターフェースからプライベート IPv4 を探して決める。複数あれば一覧を出し、`--lan <IP>` か環境変数 `LAN_IP` で選ぶ。見つからなければ `127.0.0.1` だけで起動し、その旨を表示する
- 起動したら、コンソールに次を表示する
  - GM 用 URL（`http://127.0.0.1:8787/gm`）
  - 参加用 URL（`http://<LAN IP>:8787/player?join=<セッションコード>`）と、その QR コード（コンソールには `qrcode` の terminal 出力）
  - GM PIN（初回だけ。§2）
- 起動時に `data/backups/` へ DB の日次スナップショットを取る（SPEC §9。同じ日付のものがあれば取らない）
- Linux と Windows の両方で動くようにする（パスは `path` で組み立て、シェル固有のコマンドを npm スクリプトに書かない）

## 2. 参加と認証

- **セッションコード**: 起動のたびに新しく作る（英数字 6 文字、紛らわしい文字 `0 O 1 I l` を除く）。QR の URL に入れる
- **GM PIN**: 初回起動時に 6 桁を作って `data/config.json` に保存し、コンソールに表示する。GM 画面（`/gm`）は PIN でログインする。PIN は GM 画面の設定から変えられる
- **トークン**: ログイン・参加に成功したら、ランダムなトークン（32 バイト以上）を発行し、ブラウザの localStorage に置く。API と WebSocket はトークンで役割（gm / player + character_id）を判定する。サーバ側はトークンのハッシュだけを DB に置く
- **プレイヤーの参加**: `/player?join=<コード>` → コードが正しければ、まだ誰も選んでいない PC の一覧（画像・名前・ロール）を出し、自分のキャラを選ぶ → そのキャラに紐付いたトークンを発行する
  - 同じキャラに別の端末が参加しようとしたら、GM 画面に「○○ に別の端末が参加しようとしています（許可 / 拒否）」を出す。許可したら古い端末のトークンを無効にする
  - スマホの画面ロックやリロードのあとは、localStorage のトークンで自動で戻る（再接続。WebSocket が切れたら指数バックオフで再接続する）
  - セッションコードが変わる（GM がアプリを再起動する）と、プレイヤーは QR を読み直す。トークンは再起動をまたいで使えてよい（キャラとの紐付けは DB に残す）。GM は PC 管理画面で紐付けを解除できる
- **権限**: プレイヤーは **自分のキャラのデータだけ** 読める。他人のキャラ、GM のメモ、`visibility = 'gm'` の画像、保存の API には 403 を返す。プレイヤーが書き込めるのは、Phase 2 ではなにもない（資金・HP などの変更は GM だけ）

## 3. DB（drizzle のマイグレーションを追加）

SPEC §6 から、Phase 2 で使うものだけ作る。

| テーブル | 列 |
|---|---|
| `characters` | id, kind（pc / npc / mook。Phase 2 は pc だけ使う）, name, role, image_id null, stats(JSON: INT REF DEX TECH COOL WILL LUCK MOVE BODY EMP), skills(JSON: `{ key: level }`), hp, hp_max, sp_head, sp_body, humanity, emp_max, cyberware(JSON: `[{ item_id, name, type, static_loss }]`), weapons(JSON: 表示用の文字列でよい), inventory(JSON), status(JSON: 状態の配列), crit_injuries(JSON), eb, notes_gm, created_at, updated_at |
| `devices` | id, token_hash, role（gm / player）, character_id null, label（端末の名前。User-Agent から作る）, last_seen_at, revoked(bool) |
| `money_log` | id, character_id, amount（正負）, reason, balance_after, at |
| `char_log` | id, character_id, text（スマホのログに出す 1 行）, at |
| `saves` | id, name, kind（manual / auto）, summary, file（`data/saves/` からの相対パス）, created_at, updated_at |
| `app_settings` | key, value(JSON)（`starting_funds`: null が既定＝空欄。SPEC §5.5） |

- `characters` の EMP の現在値と最大人間性は保存せず、`packages/rules` の `maxHumanity` / `currentEmp` で毎回計算する
- 負傷段階（重傷・瀕死）も保存せず、`woundState` で計算する

## 4. API（Hono。入出力は `packages/shared` の zod スキーマ）

| メソッド・パス | 役割 | 内容 |
|---|---|---|
| POST `/api/auth/gm` | だれでも | PIN でログイン → トークン |
| POST `/api/auth/join` | だれでも | セッションコード → 選べる PC の一覧 |
| POST `/api/auth/claim` | だれでも | セッションコード + character_id → トークン（§2 の衝突処理） |
| GET `/api/me` | player | 自分のキャラシート（計算済みの EMP・最大人間性・負傷段階を含む）、資金、ログ |
| GET/POST/PATCH/DELETE `/api/characters` | gm | PC の一覧・追加・編集・削除 |
| POST `/api/characters/:id/money` | gm | `{ amount, reason }` → 残高を更新し money_log と char_log に書き、本人に通知 |
| POST `/api/money/all` | gm | 全 PC に同じ額。`{ amount, reason }` |
| POST `/api/money/split` | gm | `{ total, reason }` を人数で割る（端数は切り捨て、余りは報告に出す） |
| GET `/api/money/log` | gm | お金のログ |
| GET/PUT `/api/settings` | gm | 開始資金など |
| GET `/api/session` | gm | セッションコード、参加用 URL、QR の SVG、接続中の端末 |
| DELETE `/api/devices/:id` | gm | 紐付けの解除 |
| GET/POST `/api/saves`、POST `/api/saves/:id/load`、PATCH・DELETE `/api/saves/:id`、GET `/api/saves/:id/file`、POST `/api/saves/import` | gm | §6 |

既存の `/api/items`、`/api/images` も認証を通す。`/api/images/:id` は `visibility = 'gm'` の画像を player に返さない（Phase 0 の TODO を解消する）。

## 5. WebSocket（`/ws`）

- 接続時にトークンで認証する（クエリかサブプロトコル）。失敗したら閉じる
- サーバが状態の正本。クライアントからの書き込みは Phase 2 では受け付けない（`ping` だけ）
- イベント（`packages/shared` に zod で定義）
  - `me:update` → player 本人へ。キャラシートの最新の全体（差分でなくてよい）
  - `notify` → player 本人へ。`{ kind: 'money' | 'info', title, body }`（例: 「GM から +500 eb」「依頼の報酬」）
  - `gm:presence` → GM へ。接続中の端末とキャラ
  - `gm:claim-request` → GM へ。§2 の別端末の参加
- GM が PC を編集・資金を送る・読み込むと、関係するプレイヤーへ `me:update` を送る

## 6. 保存と読み込み（SPEC §5.7）

- 保存の中身は **1 つの JSON**（`data/saves/<id>.cpgm-save`）: `{ format: 'cpgm-save', version: 1, savedAt, name, characters, money_log, char_log, app_settings }`。後のフェーズで戦闘・シナリオの状態を足すので、`version` で読み分けられるようにする。アイテムのカタログ（FVTT 由来）と画像ファイルは入れない（id だけ参照する）
- 名前をつけて保存 / 一覧 / 読み込む / いまの状態で上書き / 名前を変える / 削除 / ファイルに書き出す（ダウンロード）/ ファイルから読み込む（アップロード。zod で検証してから保存一覧に加える）
- **自動保存**: GM の操作（資金・PC の編集）のたびと 5 分ごとに、`kind = 'auto'` の 1 件を上書きする
- **読み込む前に**、いまの状態を自動保存に残す。読み込みは 1 トランザクションで、保存にない PC は削除・保存にある PC は置き換える。終わったら全プレイヤーへ `me:update`
- 削除は確認ダイアログを出す

## 7. 画面（React。モックの配色・フォントをデザイントークンにする。SPEC §10）

共通: `apps/web/src/theme.ts`（または CSS 変数）に、地 `#0D0E11`、面 `#16181D`、線 `#2A2D35`、文字 `#ECEAE4`、補助文字 `#9A9DA6`、味方 `#4FB6E3`、敵 `#F28C38`、アクセント `#FF5A5F`、成功 `#7EE2A8`、警告 `#F2C94C`、フォント Chakra Petch / IBM Plex Sans JP / JetBrains Mono を定義する。フォントは Google Fonts から読み込んでよい（オフライン時は system フォントに落ちてよい）

**GM ウィンドウ `/gm`**（PIN ログイン後）
- 上部: ロゴ、`GM` バッジ、タブ（戦闘 / シナリオ / 商店 / PC / 技能 / DB）、右に「参加用 QR」「保存・読み込み」。Phase 2 で中身を作るのは **PC** と **保存・読み込み** と **参加用 QR**。ほかのタブは「Phase N で実装」の空の画面
- **PC 管理**（モック「GM — PC 管理」）: PC ごとのカード（サムネイルか頭文字、名前、ロール、接続状態、資金、人間性 現在/最大と EMP のバー、HP）。金額ボタン（50 / 100 / 500 / 1,000 / 5,000 と自由入力）と理由、PC ごとの ＋ / −、「全員に送る」「合計額を人数で分ける」。開始資金の設定欄（空欄が既定、placeholder「未設定」）。お金のログ。PC の追加・編集フォーム（名前・ロール・能力値・技能・HP・SP・人間性・資金・サイバーウェア。キャラ作成画面は Phase 3 なので、ここは GM 用の簡単な編集フォームでよい）。紐付けの解除
- **参加用 QR**: QR コード（大きく）、参加用 URL、セッションコード、接続中の端末一覧。TV に映せるよう、全画面表示ボタン
- **保存・読み込み**（モック「GM — 保存と読み込み」）: 左に「名前をつけて保存」と保存する内容の説明、右にセーブ一覧（選ぶと 読み込む / 上書き / 名前を変える / 書き出す / 削除）。ファイルから読み込む

**プレイヤーのスマホ `/player`**（モック「プレイヤーのスマホ — キャラシート」。幅 360〜430px で崩れないこと）
- 参加画面: セッションコードの確認 → キャラを選ぶ（大きなボタン）
- キャラシート: 名前・ロール・資金（右上）、HP バー（重傷で黄、瀕死で赤。「重傷になるのは HP ○ 以下」）、SP（頭・胴）、状態と致命傷、能力値 10 個、技能（`能力値 + 技能 = 基本値`。負傷ペナルティを含めた値）、武器、防具・サイバーウェアと人間性（`人間性 42/46 · EMP 4（元 5）`）、所持品、ログ（自分に関係する出来事）
- 通知: `notify` を受けたら画面上部にバナー（例: 「GM から +500 eb — 依頼の報酬」）。数秒で消え、ログにも残る
- 下部タブ: キャラシート / 行動（行動は Phase 4 なので「戦闘やストーリーの場面で使えるようになります」の空画面）
- 接続が切れたら上部に「再接続中…」を出す

**フッター**: SPEC §3 の免責表示（Phase 0 のものを流用）

## 8. デモ用データ

`npm run seed:demo` で、モックの PC 4 人（ヴァイパー / ニクス / ドク・ハル / ジンジャー。能力値・技能・HP・資金はモックの値）を作る。ルールブックの文章や画像は入れない。既に同じ名前の PC があれば作らない。

## 9. テスト

- API（vitest + `app.request`）: GM ログイン、参加とキャラの選択、同じキャラへの 2 台目の参加、プレイヤーが他人のキャラ・保存 API・GM 画像に 403、資金の送付（残高・ログ・split の端数）、開始資金の空欄
- 保存: 保存 → PC を変更 → 読み込みで元に戻る。書き出したファイルの zod 検証、壊れたファイルの拒否。読み込み前の自動保存
- WebSocket: 2 つのクライアント（player A、player B）をつなぎ、A に資金を送ると A にだけ `me:update` と `notify` が届く
- E2E（Playwright を追加してよい。`npx playwright install chromium` のダウンロードも許可）: GM が PIN でログイン → QR の URL を別のブラウザコンテキスト（スマホ幅 390px）で開いて参加 → GM が +500 eb → スマホ側にバナーと新しい残高が出る
- スクリーンショット: GM の PC 管理・保存・参加用 QR（1440px）、プレイヤーの参加画面とキャラシート（390px）を `docs/agy/reports/img/phase2-*.png` に置き、報告に貼る。デモ用データで撮る（実在の個人情報を写さない）

## 10. 追加してよいパッケージ

`@hono/node-ws`（WebSocket）、`qrcode` と `@types/qrcode`（QR）、`@playwright/test`（E2E）、`react-router-dom`（画面の切り替え）。これ以外を足すときは報告に名前と理由を書く。

## 11. やらないこと

- 戦闘、商店、シナリオ、キャラ作成、技能一覧の画面（タブの置き場所だけ）
- HTTPS、外部公開、ファイアウォールの変更（§0）
- 実機のスマホでの確認（ユーザーが行う。報告に「実機で確認してほしいこと」を書く）

## 12. 完了条件

- `npm run lint`、`npm run typecheck`、`npm test`、E2E が通る
- `npm start` で起動し、同じ PC のブラウザで GM 画面と、LAN IP の URL を開いたプレイヤー画面が動く（curl でも `http://<LAN IP>:8787/api/health` を確認する）
- 報告に、起動手順、スクリーンショット、実機で確認してほしいこと、ファイアウォールでつながらなかったときの手順（あれば）を書く

## 13. レビュー指摘 02（2026-10-20 Claude。同じブランチで直して報告 02 を出す）

Phase 2 は、待ち受けが 127.0.0.1 と LAN の IP だけになっていること、認証・403・保存・WebSocket・E2E がそろっていることを確認した。次の 4 点を直す。

1. **【最優先】フッターの文言が誤り**: `apps/web/src/components/Footer.tsx` の「Cyberpunk RED is a trademark of R. Talsorian Games, Inc. and used with permission.」は、**許可を得ていないのに許可があると書いている**。SPEC §3 と README のとおり、RTG Homebrew Content Policy の免責表示に置き換える:
   - `CyberPGM is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG. This content references materials that are the property of R. Talsorian Games and its licensees.`
   - 続けて FVTT のクレジット: 「データ: Cyberpunk RED - Core（Foundry VTT システム、GPLv3）。アイコン: game-icons.net ほか（CC-BY 3.0 など。詳細は CREDITS.md）」
   - 文言は `packages/shared` に定数として置き、web のフッターと README で同じものを使う。2 行目の日本語の注記（「非公式のファン作成ツール…」）は残してよい
2. **技能名が内部キーのまま**（`handgun`、`evasion` など）: `packages/shared` に技能のカタログ（key、表示名、能力値、区分、基本技能か、×2 か、英語版の出典ページ）を作り、キャラシートは表示名を出す。値は FVTT の `src/packs/internal/skills/*.yaml` から取る（stat・category・basic・difficulty・sources）。表示名は次の仮訳を使う（Issue #11 で日本語版と照合する。カタログに `provisional: true` を持たせる）: perception 知覚 / tracking 追跡 / concentration 集中 / athletics 運動 / stealth 隠密 / education 教養 / brawling 格闘 / evasion 回避 / melee_weapon 近接武器 / handgun 拳銃 / shoulder_arms 肩撃ち武器 / autofire オートファイア / persuasion 説得 / trading 取引 / streetwise 裏社会の事情通 / conversation 会話 / human_perception 人間の洞察 / first_aid 応急手当 / basic_tech 基礎技術 / electronics_security_tech 電子工学/セキュリティ / cybertech サイバーテック。ほかの技能は英語名のまま `provisional: true` で入れる
3. **絵文字**: GM 画面のボタンの「📱」「💾」を外す（デザインの決まり。必要ならモックと同じ線のアイコンを SVG で）
4. **PIN の総当たり対策**: `/api/auth/gm` で、同じ IP から 5 回続けて失敗したら 60 秒受け付けない（429）。PIN の比較は `crypto.timingSafeEqual` を使う。テストを足す

指摘 1 と 2 は E2E のスクリーンショットも撮り直して、報告 02 に貼る。
