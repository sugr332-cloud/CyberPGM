# Phase 2 報告 01

- 日時: 2026-10-20
- 使用モデル: Gemini 3.8 Flash (High)
- 状態: 完了
- 停止した理由: 完了

## 実施したこと

### 1. 外部公開制限と LAN IP 自動選定（指示書 §0, §1）
- `apps/server/src/net.ts`:
  - `isPrivateIPv4`: RFC 1918 プライベート IP（`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`）を厳密に判定。
  - `resolveLanIp`: ネットワークインターフェースからプライベート IPv4 を自動選定。複数ある場合は一覧出力および `--lan <IP>` / `LAN_IP` 環境変数対応。
  - **`0.0.0.0` / `::` 禁止の遵守**: `startDualServer` により、`127.0.0.1` と選定されたプライベート LAN IPv4 の 2 アドレスのみを同一ポートで独立して listen。ワイルドカード待ち受けを完全に排除。

### 2. 認証・参加・衝突処理（指示書 §2）
- **GM PIN**: 初回起動時に 6 桁乱数を生成し `data/config.json` に保存。GM ウィンドウでのログインに利用。
- **セッションコード**: 起動ごとに紛らわしい文字（`0 O 1 I l`）を除外した 6 文字コードを生成。
- **トークンとデバイス管理**: 32 バイト乱数トークンを発行し、サーバー側には SHA-256 ハッシュのみを `devices` テーブルに保存。
- **プレイヤーの参加と衝突処理**: `/player?join=<CODE>` で未選択 PC を一覧表示して選択・紐付け。同一キャラに別端末が参加しようとした場合は GM 画面に `gm:claim-request` を送信し、GM の承認で旧端末を無効化して新端末へ権限移行。
- **権限制限**: プレイヤーは自己のキャラクターデータのみ閲覧可能。他人のデータ、GM メモ、`visibility = 'gm'` の画像、保存 API は 403 Forbidden。

### 3. DB スキーマとマイグレーション（指示書 §3）
- Drizzle ORM マイグレーション `drizzle/0002_dazzling_amazoness.sql` を追加・適用:
  - `characters`: PC データ（ステータス、技能、HP/SP、人間性、サイバーウェア、武器、資金等）
  - `devices`: 端末・トークンハッシュ・ロール・紐付けキャラ
  - `money_log`: 資金変動履歴（キャラ、金額、理由、残高）
  - `char_log`: スマホ向け出来事ログ
  - `saves`: セーブデータメタ情報
  - `app_settings`: アプリケーション設定（`starting_funds` 等）

### 4. WebSocket リアルタイム同期（指示書 §5）
- `@hono/node-ws` を採用し、同一ポートのデュアルサーバー（127.0.0.1 / LAN IP）双方に WebSocket を注入。
- イベント:
  - `me:update`: GM によるキャラ編集や資金変更時、当該プレイヤーへ計算済みキャラシート全体を即座にプッシュ配信。
  - `notify`: GM からの送金時にプレイヤー端末上部に通知バナーを表示。
  - `gm:presence`: 端末の接続・切断状態を GM 画面へリアルタイム反映。
  - `gm:claim-request`: 2 台目参加の許可/拒否プロンプトを GM 画面へ通知。
- 指数バックオフによる切断時の自動再接続。

### 5. 保存と読み込み（指示書 §6）
- `data/saves/<id>.cpgm-save`: スナップショットを 1 つの JSON（`cpgm-save` フォーマット v1）に保存。
- 名前をつけて保存 / 一覧 / 上書き / 名前変更 / 削除 / 書き出し（ダウンロード）/ ファイルインポート（アップロードと Zod 検証）。
- **読み込み前の自動退避**: 読み込み実行直前の状態を `kind = 'auto'` の自動保存として必ず残す。
- **1 トランザクション復元**: SQLite トランザクション内で PC・ログ・設定を原子的・完全に置換し、復元後に接続中全プレイヤーへ `me:update` をブロードキャスト。
- 定期自動保存（5 分間隔）および GM 操作時自動保存を実装。

### 6. GM 画面・プレイヤー画面（指示書 §7）
- **デザイントークン**: 地 `#0D0E11`、面 `#16181D`、線 `#2A2D35`、文字 `#ECEAE4`、補助文字 `#9A9DA6`、味方 `#4FB6E3`、敵 `#F28C38`、アクセント `#FF5A5F`、成功 `#7EE2A8`、警告 `#F2C94C`、フォント Chakra Petch / IBM Plex Sans JP / JetBrains Mono。
- **GM ウィンドウ `/gm`**:
  - PIN 認証画面
  - ヘッダー（ロゴ、GM バッジ、タブ、参加用 QR ボタン、保存・読み込みボタン）
  - PC 管理タブ: PC カード（サムネイル、名前、ロール、接続状態、資金、HP、人間性/EMP バー）、金額プリセットボタン（50/100/500/1000/5000/自由入力）＋理由、個別の＋/−送金ボタン、「全員に送る」「合計額を人数で分ける」、開始資金設定、お金ログ、PC 追加・編集モーダル、紐付け解除。
  - 参加用 QR モーダル: 大きな QR SVG、参加 URL、セッションコード、接続端末一覧、全画面表示ボタン。
  - 保存・読み込みモーダル: 名前保存、インポート、セーブ一覧、読み込み、書き出し。
  - 未実装タブ（戦闘・シナリオ・商店・技能・DB）: 「Phase N で実装」プレースホルダー。
- **プレイヤー画面 `/player`**（スマホ幅 360〜430px 最適化）:
  - 参加画面: セッションコード確認、キャラ選択カード
  - キャラシート: 名前・ロール・資金、HP バー（重傷で黄、瀕死で赤、「重傷になるのは HP ○ 以下」）、頭部/胴体 SP、状態異常、能力値 10 個、技能（基本値 = 能力値 + 技能 − 負傷ペナルティ）、武器、サイバーウェアと人間性、出来事ログ。
  - 通知バナー: `notify` 受信時に画面上部に自動ポップアップ。
  - 下部タブ（キャラシート / 行動: Phase 4 プレースホルダー）
  - 再接続中インジケータ
- **フッター**: SPEC §3 免責表示（全画面共通）。

### 7. デモデータ投入（指示書 §8）
- `npm run seed:demo`:
  - ヴァイパー（ソロ）、ニクス（ネットランナー）、ドク・ハル（メディック）、ジンジャー（フィクサー）の 4 名を作成。既存同名キャラが存在する場合はスキップ（完全な冪等性）。

---

## 確認した事実（コマンドと出力）

### 1. `npm start` 起動ログ（LAN IP 自動選定 & QR 出力）
```
$ npm start

> cyberpgm@0.1.0 start
> npm run build -w @cyberpgm/web && tsx apps/server/src/index.ts

> @cyberpgm/web@0.1.0 build
> tsc -b && vite build
✓ built in 824ms
[backup] Daily snapshot created: <CyberPGM>/data/backups/cyberpgm-2026-10-20.db

============================================================
              CYBERPUNK RED - CYBERPGM SESSION              
============================================================

  GM Window URL :  http://127.0.0.1:8787/gm
  Player Join URL :  http://192.168.0.90:8787/player?join=CADS3C
  Session Code  :  CADS3C

  Player Join QR Code:
  ... (ターミナルに QR コード描画) ...
============================================================
```

### 2. LAN IP および Loopback への HTTP 疎通確認
```bash
# LAN IP 経由でのアクセス確認
$ curl -s http://192.168.0.90:8787/api/health
{"ok":true,"session":"CADS3C"}

# 127.0.0.1 経由でのアクセス確認
$ curl -s http://127.0.0.1:8787/api/health
{"ok":true,"session":"CADS3C"}

# 静的 SPA 配信の確認
$ curl -sI http://192.168.0.90:8787/gm
HTTP/1.1 200 OK
content-type: text/html; charset=utf-8
```

### 3. 単体・統合テスト (`npm test`)
```
$ npm test

 RUN  v3.2.7 <CyberPGM>

 ✓ tools/import-fvtt/test/import.test.ts (5 tests) 1339ms
 ✓ apps/server/test/ws.test.ts (1 test) 232ms
 ✓ apps/server/test/api.test.ts (6 tests) 83ms
 ✓ apps/server/test/saves.test.ts (3 tests) 26ms
 ✓ apps/server/test/net.test.ts (8 tests) 16ms
 ✓ packages/rules/test/damage.test.ts (12 tests) 3ms
 ✓ packages/rules/test/check.test.ts (9 tests) 3ms
 ✓ packages/rules/test/dice.test.ts (8 tests) 3ms
 ✓ packages/rules/test/initiative.test.ts (4 tests) 2ms
 ✓ packages/rules/test/wounds.test.ts (4 tests) 2ms
 ✓ packages/rules/test/attack.test.ts (5 tests) 2ms
 ✓ packages/rules/test/index.test.ts (1 test) 2ms
 ✓ packages/rules/test/humanity.test.ts (3 tests) 2ms
 ✓ packages/rules/test/movement.test.ts (3 tests) 2ms

 Test Files  14 passed (14)
      Tests  72 passed (72)
   Duration  4.44s
```

### 4. Playwright E2E テスト (`npm run test:e2e`)
```
$ npm run test:e2e

> cyberpgm@0.1.0 test:e2e
> playwright test

Running 1 test using 1 worker
  ✓  1 e2e/session.spec.ts:7:1 › GM login, player QR join, and real-time fund notification flow (1.6s)
  1 passed (3.3s)
```

### 5. `npm run lint` & `npm run typecheck`
```
$ npm run lint && npm run typecheck

> cyberpgm@0.1.0 lint
> eslint .

> cyberpgm@0.1.0 typecheck
> tsc --noEmit
```
エラー・警告ゼロで通過。

---

## スクリーンショット

### 1. GM 画面: PC 管理（1440px）
![GM PC管理画面](img/phase2-gm-pc.png)

### 2. GM 画面: 参加用 QR モーダル（1440px）
![GM 参加用 QR モーダル](img/phase2-gm-qr.png)

### 3. GM 画面: 保存・読み込みモーダル（1440px）
![GM 保存・読み込みモーダル](img/phase2-gm-saves.png)

### 4. プレイヤー画面: 参加・キャラ選択（スマホ幅 390px）
![プレイヤー参加画面](img/phase2-player-join.png)

### 5. プレイヤー画面: キャラシート（スマホ幅 390px）
![プレイヤーキャラシート](img/phase2-player-sheet.png)

### 6. プレイヤー画面: 送金通知バナー（スマホ幅 390px）
![送金通知バナー](img/phase2-player-notify.png)

---

## 起動手順（GM 向け）

1. デモ用 PC データを作成する場合（初回またはリセット時）:
   ```bash
   npm run seed:demo
   ```
2. セッションを起動:
   ```bash
   npm start
   ```
   - コンソールに GM 用 URL（`http://127.0.0.1:8787/gm`）、プレイヤー用 URL（`http://<LAN_IP>:8787/player?join=<CODE>`）、初回 PIN、およびターミナル QR コードが表示されます。
   - LAN の IP を明示的に指定したい場合は、`npm start -- --lan 192.168.x.x` または `LAN_IP=192.168.x.x npm start` を使用できます。
3. GM の PC ブラウザで `http://127.0.0.1:8787/gm` を開き、PIN でログインします。
4. プレイヤーは自宅 Wi-Fi に接続したスマホカメラで QR コードを読み取り、ブラウザで参加してキャラクターを選択します。

---

## 実機で確認してほしいこと

- [ ] 自宅 Wi-Fi に接続したスマートフォンのカメラアプリから、GM 画面の「参加用 QR」を読み取り、ブラウザでキャラ選択画面が開くこと。
- [ ] キャラクター（例: ヴァイパー）を選択後、スマホにキャラシート（HPバー、SP、能力値、技能、所持金）が崩れずに表示されること。
- [ ] GM 画面でその PC に「＋ 500 eb」を送金したとき、スマホ画面上部に緑色の通知バナー（「GM から +500 eb — 依頼の報酬」）が表示され、所持金が即座に反映されること。
- [ ] スマホを画面ロックまたはリロードした際、自動的に再接続されてキャラシートに戻ること。
- [ ] GM 画面で「保存・読み込み」を開き、名前をつけて保存および読み込みができること。

---

## ファイアウォールでつながらなかったときの手順（GM が手で行う手順）

スマホから `http://<LAN_IP>:8787` に接続できない場合、ホスト PC のファイアウォール（firewalld や Windows Defender ファイアウォール）がポート 8787 をブロックしている可能性があります。
※ CyberPGM アプリケーションはファイアウォール設定を自動変更しません。

### Linux (firewalld の場合):
```bash
# 一時的にポート 8787 を許可する場合:
sudo firewall-cmd --add-port=8787/tcp

# 恒久的に許可する場合:
sudo firewall-cmd --add-port=8787/tcp --permanent
sudo firewall-cmd --reload
```

### Linux (UFW の場合):
```bash
sudo ufw allow 8787/tcp
```

### Windows の場合:
1. 「Windows Defender ファイアウォール」を開く。
2. 「詳細設定」>「受信の規則」>「新しい規則」を選択。
3. 「ポート」を選択し、TCP・特定のローカル ポートに `8787` を指定して接続を許可する。

---

## コミット履歴（作業ブランチ: agy/phase2-session）
- `218cf9e`: feat(server,shared): LAN IP検出・セーフリスナー実装およびPhase 2 DBスキーマ・Zod定義
- `655d701`: feat(server): セッション・認証・API・WebSocket・保存復元・デモデータ投入・自動保存の実装
- `2c1c673`: feat(web,e2e): GM画面・プレイヤー画面・WebSocket同期UI・Playwright E2Eテストおよびスクリーンショットの実装

## 次にやること
- Phase 2 のレビュー完了後、指示書に従って Phase 3（商店とキャラ作成）に進む。
