# CyberPGM

サイバーパンクRED を遊ぶ人間GM向けのセッション支援 Web アプリ（戦闘・商店・シナリオ）。GM の PC（ノートパソコンなど）とプレイヤーのスマホを同じ Wi-Fi につないで使う私的ツール。インターネットには公開しない。

- 仕様: `docs/SPEC.md`
- 実装は agy が担当する。指示書と報告は `docs/agy/` に置く

## セッションの始め方

1. GM の PC を、プレイヤーと同じ Wi-Fi につなぐ（自宅でも出先でもよい）
2. `npm start` で起動する。Wi-Fi を変えたら起動し直す
3. GM は `http://127.0.0.1:8787/gm` を開く。参加 QR は、どのアドレスで開いても PC の Wi-Fi のアドレスで作られる
4. プレイヤーはスマホで QR を読む

### スマホから開けないとき

- スマホと PC が同じ Wi-Fi か確かめる
- カフェやホテルの Wi-Fi は、つないだ端末どうしの通信を止めていることが多い。その場合は、スマホのテザリングに PC とほかのスマホをつなぐか、PC のモバイルホットスポットを使う
- Wi-Fi のアドレスが複数あると、起動時に一覧が出る。違うものが選ばれたら `npm start -- --lan 192.168.x.x` で指定する
- **Windows のファイアウォール**: 出先の Wi-Fi は「パブリック」扱いになり、8787 番が止められる。管理者の PowerShell で一度だけ次を実行する

  ```powershell
  New-NetFirewallRule -DisplayName "CyberPGM 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Any
  ```

  使わないときは `Remove-NetFirewallRule -DisplayName "CyberPGM 8787"` で消せる。CyberPGM を起動していなければ、8787 番では何も応答しない

> CyberPGM is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG. This content references materials that are the property of R. Talsorian Games and its licensees.
> データ: Cyberpunk RED - Core（Foundry VTT システム、GPLv3）。アイコン: game-icons.net ほか（CC-BY 3.0 など。詳細は CREDITS.md）

## BGM

- 曲（mp3 / ogg / m4a / wav）は `data/audio/` に置く。サブフォルダも使える（例: `data/audio/戦闘/ボス戦.mp3` は「戦闘 / ボス戦」と出る）
- 置いた曲は、シナリオメーカーのシーンの「BGM」と、シナリオ進行の「舞台」の BGM の一覧に自動で出る（「フォルダを読み直す」で更新）
- 曲は表示ウィンドウ（TV）で流れる。表示ウィンドウを開かないときは、舞台の「この PC（GM 画面）で鳴らす」をオンにする

## ログ

サーバーのログとエラーは `data/logs/cyberpgm-YYYY-MM-DD.log` にも残る。
