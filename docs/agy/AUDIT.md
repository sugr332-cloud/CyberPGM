# Claude の代わりに Codex が監査・指示をするとき

ユーザー決定（2026-10-24）:

> もし、監査用の claude のトークンがなくなった場合、codex に claude の役割を担わせる

Claude の利用上限で Claude が動けないあいだは、Codex が Claude の役割（指示書を書く・実装を監査する・main へマージする）を引き継ぐ。実装担当（agy、または agy が上限のときの Codex）とは**別のセッション**で動かす。自分が実装したブランチを自分で監査しない。

## 起動

```
cd /var/home/hankyuu1/orca/projects/CyberPGM-codex
CODEX_HOME=$HOME/.codex codex -s workspace-write -a on-request
```

最初の指示の例:「docs/agy/AUDIT.md に従って、ブランチ agy/<フェーズ名> を監査して」

- 作業場所は Codex 用のクローン `/var/home/hankyuu1/orca/projects/CyberPGM-codex`。実装担当がまだ動いていないこと（作業が終わって止まっていること）を確かめてから始める
- 本番のクローン `/var/home/hankyuu1/orca/projects/CyberPGM` とポート 8787 には触らない。テスト用のサーバーは 8790 か 8791
- 返答・報告は日本語で書く

## 監査の手順

1. `git fetch` して、作業ブランチ `agy/<フェーズ名>`（または `codex/<フェーズ名>`）を checkout する
2. 指示書 `docs/agy/<フェーズ名>.md` と報告 `docs/agy/reports/<フェーズ名>-<連番>.md` を読む
3. `git diff origin/main...HEAD` を全部読み、次を確かめる
   - 指示書に書いたことが全部できているか。書いていない機能を足していないか（頼まれていない機能は入れない）
   - ルールの数値・名前が `data/sources/` のルール資料（日本語版）と合っているか。数値を作っていないか
   - 画面の表示（案内）と実際の計算が同じ関数から出ているか
   - `data/` やルールブックの本文、個人のパスがコミットに入っていないか
   - 「一手戻る」で戻せるか、スマホと GM 画面の両方で動くか
4. 自分でコマンドを流して結果を確かめる（報告の数字をそのまま信じない）
   - `npm run lint`、`npm run typecheck`、`npm test`
   - 指示書に書いた E2E を `PORT=8791 npm run test:e2e -- <ファイル>` で
   - E2E で書き換わった `docs/agy/reports/img/*` のうち関係ないものは `git checkout` で戻す
5. 不具合が見つかったら
   - 小さい修正（数行）は自分で直して、そのブランチにコミットしてよい。何を直したかを監査報告に書く
   - 大きい修正は、指示書に「監査で見つかったこと」を追記して push し、実装担当にやり直させる
6. 問題がなければ main にマージして push する
   - `git checkout main && git pull --ff-only && git merge --no-ff agy/<フェーズ名> -m "Merge agy/<フェーズ名>: <内容>（agy 実装、Codex 監査）"`
   - force push はしない
7. 監査報告 `docs/agy/reports/<フェーズ名>-audit.md` を書いて main に push する
   - 確かめたこと（コマンドと結果）、見つけて直したこと、残った問題、ユーザーに確かめてほしい画面
8. 本番への反映（サーバーの再起動）はしない。ユーザーに次の 1 行を伝える

```
! cd /var/home/hankyuu1/orca/projects/CyberPGM && git checkout -q main && git pull -q --ff-only && npm run build && npm run db:migrate && (pkill -f "tsx [a]pps/server/src/index.ts"; sleep 2; setsid nohup npx tsx apps/server/src/index.ts > audit/server-8787.log 2>&1 < /dev/null &) && sleep 6 && ss -ltnp | grep 8787
```

## 指示書を書くとき

- ユーザーが頼んだこと、または `docs/SPEC.md` に書いてあってまだできていないことだけを指示書にする
- 形は既存の `docs/agy/phase6*.md` に合わせる（作業ブランチ、作業場所、してはいけないこと、テスト、報告に必ず書くこと）
- ルールの数値は `data/sources/` の資料から引き、ページ番号を書く
- 決められないこと（仕様が未決のもの）は、指示書に書かずに GitHub Issue（sugr332-cloud/CyberPGM）にしてユーザーに聞く

Claude の利用上限が戻ったら、Claude が監査に戻る。Codex がマージしたものは、Claude があとで見直す。
