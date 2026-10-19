# CyberPGM 仕様書 v0.1

作成: 2026-10-20（Claude）／実装: agy／承認: ユーザー

サイバーパンクRED を遊ぶ **人間GM向け** のセッション支援 Web アプリ。ルール・装備のデータベースを持ち、「戦闘」「商店」「シナリオ」の 3 画面でセッション進行を助ける。

---

## 1. 前提と方針（2026-10-20 ユーザー決定）

| 項目 | 決定 |
|---|---|
| 対象ルール | **サイバーパンクRED**（日本語版：ホビージャパン）。2020 は対象外 |
| GM | 人間。AI による会話生成・シナリオ自動生成・裁定は **実装しない** |
| ダイス | リアルダイス。出目を入力し、アプリが修正値・DV と比べて成否やダメージを計算する。アプリ内ダイスは補助機能（任意） |
| 端末 | PC とスマートフォン（ブラウザ。レスポンシブ／PWA） |
| 公開範囲 | **自宅 LAN と Tailscale 内のみ**。インターネットには公開しない |
| 画面 | **戦闘・商店・シナリオ** の 3 タブ（+ 管理用のデータベース画面） |
| 実装担当 | **コードは agy が書く**。Claude は調査・仕様・agy への指示書・レビューを担当 |

---

## 2. 調査結果：使えるデータ源

### 2.1 本命：Foundry VTT「Cyberpunk RED - Core」システム

- リポジトリ: <https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core>（配布ページ: <https://foundryvtt.com/packages/cyberpunk-red-core>）
- ライセンス: コードは **GPLv3**。収録アイテムは「RTG Homebrew Content Policy に基づく非公式コンテンツ」と明記（`CREDITS.md`）
- 2026-10-20 時点で `git clone --depth 1` して中身を確認した。

**`src/packs/core/` 以下に、1 アイテム 1 ファイルの YAML で構造化データがある**:

| パック | 件数 | 主なフィールド |
|---|---:|---|
| weapons | 100 | `damage`, `rof`, `magazine.max`, `weaponType`, `weaponSkill`, `dvTable`, `handsReq`, `concealable`, `quality`, `fireModes.autoFire`, `price.market` |
| armor | 18 | 頭・胴の SP、ペナルティ、価格 |
| cyberware | 109 | `type`（cyberEye 等）, `installLocation`（mall/clinic 等）, `humanityLoss.roll/static`, `core`, 価格 |
| gear / clothing / drugs | 56 / 90 / 10 | 価格、説明 |
| ammo / upgrades / programs / vehicles | 55 / 51 / 15 / 14 | 各種 |
| critical-injuries-head / body | 11 / 11 | 致命傷表 |
| roles / skills-* | 10 / ほか | ロール・技能 |
| internal/dv-tables | 10 | 武器種別の距離ごとの DV 表 |

- すべてのアイテムに **`sources: [{book, page}]`（英語版コアルールの掲載ページ）** がある。
- **日本語訳**: `src/babele/ja-JP/*.json` に名前の日本語訳がある（例: Assault Rifle → アサルト・ライフル）。説明文の多くは英語のまま。**訳語はホビージャパン公式訳と一致するとは限らない**ので、表示名は GM が上書きできるようにする。
- 画像: `src/icons/compendium/**.svg`。出典は game-icons.net（CC-BY 3.0）などで、`CREDITS.md` に記載がある。**本のイラストではない**ので、ライセンス表記を付ければ使える。

→ **初期データはここから一括取り込みする**（[§8](#8-データ取り込み)）。手入力は日本語版のページ番号、公式訳語、本の画像の紐付けに絞れる。

### 2.2 その他の参照先（照合用。取り込みには使わない）

| サイト | 用途 | 備考 |
|---|---|---|
| [Cyberpunk Wiki: Cyberpunk RED Weapons](https://cyberpunk.fandom.com/wiki/Cyberpunk_RED_Weapons) | 武器データの照合 | 人間向けの表。Fandom の CC-BY-SA。一括取得手段はない |
| [Cyberpunk Wiki: Cyberpunk RED Cyberware](https://cyberpunk.fandom.com/wiki/Cyberpunk_RED_Cyberware) | サイバーウェアの照合 | 同上 |
| [Cyberpunk RED 2045 wiki](https://cyberpunk-red-2047.fandom.com/wiki/Weapons_and_Armor) / [wikidot 版](https://cyberpunkred2045.wikidot.com/starting-gear) | 参考 | キャンペーン独自データが混在するので取り込まない |
| [Fantasy Grounds: Cyberpunk RED Items](https://fantasygroundsunity.atlassian.net/wiki/spaces/FGCP/pages/2140602405/Cyberpunk+RED+Items) | DB 設計の参考 | 価格からコストカテゴリを自動表示する設計が参考になる |
| [R. Talsorian Games 公式 DLC](https://rtalsoriangames.com/downloadable-content/) | 追加装備（12 Days of Gunmas/Gearmas/Cybermas など）、キャラクターシート | PDF。必要な分だけ GM が手入力する |
| ホビージャパン 日本語版公式サイト | 入門ルール「イージー・モード」（無料）、訳語の確認 | [Game*Spark の記事](https://www.gamespark.jp/article/2022/10/12/123367.html) |

---

## 3. 権利・ライセンス方針

[RTG Homebrew Content Policy](https://rtalsoriangames.com/homebrew-content-policy/) の要点（2026-10-20 確認）:

- 本のテキスト（データブロックやルール文を含む）を転載してはいけない。要約まではよい。
- ゲーム補助ツールは、必要なら表やチャートを再現してよい。ただし、本を持たなくても遊べるほど完全にルールを載せてはいけない。
- 本のアートやロゴは、書面の許可なしに他の用途へ使ってはいけない。
- 配布する場合は所定の免責表示が必要。

これを受けて、本アプリは次のように作る。

1. **個人の LAN 内で使う私的ツール** として作る。リポジトリにはルール本文・本の画像・取り込み後のデータを **含めない**（`.gitignore`）。リポジトリに入れるのは、コード・スキーマ・取り込みスクリプト・GM が自作したデータだけ。
2. ルールは **計算に必要な数値と短い要約** だけを持ち、詳しくは「出典：日本語版 p.xxx」で本を参照させる。
3. 本のスキャン画像は、ユーザーのローカルストレージにだけ置く。画像ごとに `visibility` を持たせ、既定は **GM のみ表示**。プレイヤー端末にも出すかは GM が画像ごとに決める。
   - 参考: 著作権法 30 条の私的使用の範囲は「個人的に又は家庭内その他これに準ずる限られた範囲」。卓の友人に配信する場合は、この範囲を超えるおそれがある。判断は GM が行う。
4. アプリのフッターに RTG Homebrew Content Policy の免責表示を出す。FVTT 由来のデータやアイコンを使うので、GPLv3 と CC-BY のクレジットも表示する。

---

## 4. システム構成

```
[スマホ/PC ブラウザ] --(Tailscale or LAN)--> [LivingPC: CyberPGM サーバ]
                                               ├─ Web API + 静的配信
                                               ├─ SQLite (data/cyberpgm.db)
                                               └─ data/images/ (本のスキャン等, git 管理外)
```

| 層 | 採用（推奨） | 理由 |
|---|---|---|
| 言語 | TypeScript（フロントエンドとバックエンドで共通） | 型を共有でき、agy が扱いやすい |
| フロントエンド | React + Vite、PWA | スマホでも動く。ホーム画面に追加できる |
| リアルタイム同期 | WebSocket（または SSE） | 戦闘の状態（イニシアチブや HP）を GM 端末とプレイヤー端末で同期する |
| バックエンド | Node.js + Hono（または Fastify） | 軽量 |
| DB | SQLite + Drizzle ORM | 1 ファイルなのでバックアップが簡単 |
| 実行 | LivingPC 上の systemd user service。待ち受けは Tailscale IP と LAN IP のみ | 外部に公開しない |
| 認証 | 簡易 PIN（GM 用とプレイヤー用） | LAN 内なので最低限でよい。役割で表示を切り替える |

---

## 5. 画面仕様

全画面共通: 上部タブ（**戦闘 / 商店 / シナリオ**、GM には **DB** タブも表示）、全文検索、GM ビューとプレイヤービューの切り替え。スマホでは下部タブにする。

### 5.1 戦闘

リアルダイスの出目を入力し、判定・ダメージ・状態変化を計算・記録する。

**戦闘の準備**
- 参加者を追加する: PC、DB の NPC・モブ、シナリオのエンカウンターから一括投入
- 参加者ごとの値: 能力値（REF/DEX/BODY/WILL ほか）、技能、HP（現在/最大）、SP（頭/胴、現在/最大）、装備武器（残弾）、状態異常、致命傷

**イニシアチブ**
- 各自の出目（1d10）を入力すると REF + 出目で順番を並べる。同値は GM が手で並べ替える
- 手番の進行（次へ／戻る）、ラウンド数の表示、手番中の参加者のハイライト

**攻撃判定**（入力: 攻撃者、武器、対象、距離 or 回避の選択、出目）
- 遠隔: `能力値 + 技能 + 修正 + 1d10` を、距離帯ごとの DV（武器種別の DV 表）、または防御側の回避ロールと比べる
- 近接: 攻撃側のロールと防御側の回避ロールを比べる（同値は防御側の勝ち）
- 1d10 で 10 が出たら追加で 1d10 を加算し、1 が出たら追加の 1d10 を減算する（追加の出目も入力させる）
- オプション: 照準（頭部 −8）、オートファイア、制圧射撃、無音・隠匿状態などの修正
- 修正値は内訳を表示する（例: REF 7 + 技能 6 + 照準 −8 + 出目 9 = 14 vs DV 13 → 命中）

**ダメージ**（入力: ダメージダイスの各出目）
- 合計から部位の SP を引いた値を HP から減らす。SP を貫通したら SP を 1 減らす（アブレーション）
- 頭部命中は SP を引いた後のダメージを 2 倍にする
- 出目に 6 が 2 個以上あればクリティカル: ボーナスダメージを加え、致命傷表へ誘導する（致命傷の出目を入力すると表から結果を引き、参加者に付与する）
- 重傷（HP が最大の半分未満）や瀕死の状態は自動判定し、ペナルティを表示する。死亡セーヴは入力補助のみ

**その他**
- 残弾の管理（射撃で減らし、リロードは 1 アクション）
- 状態異常・効果時間の管理（ラウンド経過で減らす）
- 戦闘ログ（判定の内訳つき）。終了時にシナリオのセッションログへ保存する
- 一つ前の操作に戻す（直前の HP や弾数を戻す）
- プレイヤービューでは、自分の HP・SP・弾数・手番だけを見られる。NPC の数値は隠す

> ルールの数値（DV 表、致命傷表、修正値、価格カテゴリ）はコードに直接書かず、DB の「ルール定数」テーブルに置く。GM が版の差分やハウスルールを編集できるようにする。

### 5.2 商店

武器・防具・サイバーウェア・ギアなどを **価格と画像つき** で一覧・検索・購入する。

**カタログ**
- カード表示（画像・名称・価格・主要性能）と表表示を切り替えられる
- フィルタ: カテゴリ（武器／防具／サイバーウェア／ギア／衣服／弾薬／改造パーツ／プログラム／乗り物／ドラッグ）、価格カテゴリ、武器種別、隠匿可否、品質、出典、データ確認状態
- 並び替え: 価格、名称、ダメージ、SP
- 詳細: 全性能、要約説明、出典（英語版 p./日本語版 p.）、画像（複数可）、サイバーウェアの人間性損失や取り付け場所
- 価格カテゴリの表示（安価 10eb／日用 20／やや高価 50／高級 100／高価 500／超高価 1000／贅沢 5000／超贅沢 10000+）。境界値と名称は GM が日本語版の訳語に合わせて設定する

**店舗**（GM が作成）
- 店（例: ナイトマーケット、故買屋、クリニック）ごとに、在庫（取り扱う品と数量）、価格倍率、品揃えのカテゴリを設定する
- 「全カタログ」モードと「この店の在庫だけ」モードを切り替えられる

**購入・売却**
- カートに入れた品を、購入する PC を選んで確定すると、所持金（eb）を減らして所持品に追加する。在庫も減らす
- 値引き交渉の結果は GM が価格を手で上書きする（取引技能の判定は GM がリアルダイスで行う）
- 売却: GM が設定した買取率で eb を戻す
- 取引の履歴を保存する

**画像**
- 優先順位: ① GM が登録した本のスキャン画像（visibility に従う）→ ② GM がアップロードした画像 → ③ FVTT のアイコン（CC-BY）→ ④ カテゴリの既定アイコン
- 画像の登録: スマホで撮影または画像ファイルをアップロードし、ブラウザ上でトリミングしてアイテムに紐付ける。出典とページを記録する

### 5.3 シナリオ

GM が作る **シナリオメーカー** と、セッション中に使う **進行モード** の 2 つで構成する。AI による生成は行わない。

**シナリオメーカー（作成・編集）**
- シナリオの基本情報: タイトル、概要、推奨人数、想定時間、報酬、タグ
- **シーン**: タイトル、読み上げ文、GM メモ、場所、登場 NPC、手がかり、判定（技能・DV・成功時と失敗時の結果）、次のシーンへの分岐（条件つき）
- **フローチャート表示**: シーンをノード、分岐を矢印で描く。ドラッグで並べ替える。スマホでは一覧表示に切り替える
- **NPC**: DB の NPC を引用するか新規作成する（能力値・技能・装備・HP・SP・台詞メモ）。モブは人数を指定して量産できる
- **エンカウンター**: 敵の構成と初期配置メモ。ボタン一つで戦闘タブに投入できる
- **店舗**: シナリオ内の店を商店タブの店舗と紐付ける
- **ハンドアウト**: 画像・文章。プレイヤー端末への公開・非公開を切り替えられる
- **ランダム表**: GM が自作する表（d6、d10、2d6 など）。リアルダイスの出目を入れて結果を引く
- **テンプレート**: 「依頼 → 調査 → 潜入 → 戦闘 → 報酬」などの雛形から作り始められる
- エクスポート／インポート（JSON）、複製、バージョン履歴（保存のたびにスナップショットを残す）

**進行モード（セッション中）**
- 現在のシーンを表示し、分岐を選んで次のシーンへ進む
- 手がかり・ハンドアウトをプレイヤーへ公開する
- セッションログ: 時刻つきメモ、戦闘ログ、取引ログ、獲得報酬・経験点（IP）
- 予定外の出来事は「臨時シーン」としてその場で追加できる

### 5.4 DB（GM のみ）

- 全エンティティの一覧と編集、CSV/JSON の入出力、FVTT の取り込み（[§8](#8-データ取り込み)）
- 確認状態（下記）の一括変更、未確認品の一覧
- キャラクター（PC）: 能力値、技能、HP、人間性/EMP、所持金、所持品、装着中のサイバーウェア、装備中の武器と防具

---

## 6. データモデル（概要）

```
Item(共通)
  id, kind[weapon|armor|cyberware|gear|clothing|ammo|upgrade|program|vehicle|drug],
  name_en, name_ja, name_ja_override, summary_ja, price_eb, price_category,
  source_book, source_page_en, source_page_ja,
  origin[fvtt|manual|homebrew], verify_status[official_verified|unofficial|unverified|homebrew],
  fvtt_id, tags[], notes
Weapon(item_id) : weapon_type, skill, damage, rof, magazine, hands, concealable, quality,
                  autofire, dv_table_id, ammo_types[]
Armor(item_id)  : sp, location[head|body|shield], penalty
Cyberware(item_id): cw_type, install_location, humanity_loss_roll, humanity_loss_static,
                  slots, requires[]
Image           : id, item_id?|npc_id?|scenario_id?, path, origin[book_scan|user|fvtt_icon],
                  license, source_book, source_page, visibility[gm|players]
RuleConstant    : key, value(JSON), source_page_ja, note     (DV表, 致命傷表, 価格カテゴリ等)
Character       : id, kind[pc|npc|mook], stats(JSON), skills(JSON), hp, hp_max, sp_head, sp_body,
                  humanity, eb, inventory→InventoryEntry[], cyberware→InstalledCyberware[]
Shop            : id, name, price_multiplier, buyback_rate, stock→ShopStock[]
Transaction     : id, session_id?, character_id, shop_id, items, total_eb, at
Scenario        : id, title, summary, meta(JSON), version
Scene           : id, scenario_id, title, read_aloud, gm_notes, checks(JSON), position(x,y)
SceneLink       : from_scene, to_scene, condition
Encounter       : id, scenario_id, scene_id?, participants(JSON)
Handout / RandomTable / Clue
Session         : id, scenario_id, started_at, log→SessionLogEntry[]
Combat          : id, session_id?, round, turn_index, participants(JSON), log(JSON)
```

`verify_status` の 4 値は、それぞれ「公式資料で確認済み」「非公式データ（FVTT 等）」「未確認・欠損」「GM 独自」に対応する。

---

## 7. ルール計算エンジン

- `packages/rules`（純粋関数のみ。UI と DB に依存しない）にまとめる。単体テストを必須とする
- 入力は出目、能力値、修正、`RuleConstant`。出力は結果と **計算の内訳**（UI に表示する）
- 対象範囲（Phase 1）: 技能判定、クリティカル（10 と 1 の追加ロール）、遠隔と近接の命中、回避、照準、オートファイア、ダメージと SP とアブレーション、頭部 2 倍、致命傷のトリガー、重傷と瀕死の判定、イニシアチブ
- 後回し（Phase 3 以降）: ネットラン、車両戦闘、人間性損失による EMP 低下の自動計算、施術
- 仕様の数値は **日本語版ルールブックで GM が確認してから** テストケースに固定する（テストのコメントに日本語版のページを書く）

---

## 8. データ取り込み

`tools/import-fvtt/`（agy が実装する）:

1. 取り込み元: ユーザーが手元に clone した FVTT リポジトリのパスを引数で渡す。**リポジトリには同梱しない**
2. `src/packs/core/*/*.yaml` と `internal/dv-tables`、`critical-injury-tables` を読み、§6 のスキーマに変換して SQLite へ upsert する（キーは `fvtt_id`）
3. `src/babele/ja-JP/*.json` から `name_ja` を設定する
4. `origin=fvtt`、`verify_status=unofficial` で登録する。GM が本と照合したら `official_verified` にする
5. 再実行しても GM が編集した項目（`name_ja_override`、`source_page_ja`、画像、`verify_status`）は上書きしない
6. アイコン SVG は `data/images/fvtt/` へコピーし、CREDITS の情報を `license` に記録する
7. 取り込みレポート（件数、欠損フィールド、訳のない品目）を出力する

---

## 9. 非機能要件

- スマホ幅（360px）で全画面を操作できる。戦闘タブは片手で操作できるようにする（大きな数字入力パッド）
- PWA。オフライン時はカタログを閲覧だけできる
- バックアップ: `data/` を丸ごとコピーするだけで済む構成にする。起動時に SQLite の日次スナップショットを取る
- レスポンス: カタログ検索は 200ms 以内（数千件規模）
- ログ・エラーはサーバ側でファイルに出す
- i18n: UI は日本語のみ。データは英語名と日本語名の両方を持つ

---

## 10. 開発フェーズ

| Phase | 内容 | 完了条件 |
|---|---|---|
| 0 | リポジトリ雛形、CI（lint, test）、DB スキーマ、FVTT 取り込み | 700 件前後が DB に入り、取り込みレポートが出る |
| 1 | **商店**（カタログ、詳細、画像登録、店舗、購入）＋ PC の所持品と所持金 | スマホで購入まで操作できる |
| 2 | **戦闘**（イニシアチブ、攻撃判定、ダメージ、致命傷、ログ、プレイヤービューの同期）＋ルールエンジンのテスト | 日本語版の作例どおりの計算結果になる |
| 3 | **シナリオ**（メーカー、フローチャート、エンカウンターの戦闘投入、進行モード、ログ） | 1 本のシナリオを作成し、通しで進行できる |
| 4 | 仕上げ（PWA オフライン、バックアップ、ネットラン等の拡張） | — |

### agy の運用

- 各 Phase の指示書を Claude が `docs/agy/<phase>.md` に書き、agy が実装して `docs/agy/reports/` に報告する。Claude はレビューする
- agy は LivingPC 上で `agy --mode accept-edits --model gemini-3.8-flash-high` で起動する（起動前に `agy models` を確認し、より新しい `gemini-*-flash-high` があればそれを使う。`claude-*` モデルは使わない）

---

## 11. 未決事項

1. 日本語版の訳語とページ対応表をどう作るか（GM が手入力するのか、照合用の表を作るのか）
2. 本のスキャン画像をプレイヤー端末に表示する範囲（§3-3。既定は GM のみ）
3. 追加サプリ（ブラックRAM、データパック、インターフェイスRED 等）を対象に含めるか
4. FVTT データの追従方針（定期的に再取り込みするか、固定バージョンで止めるか）
5. サーバを LivingPC で常時稼働させるか、セッション時だけ起動するか
