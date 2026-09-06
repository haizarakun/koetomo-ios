<h1 align="center">KoeTomo+ for iOS</h1>

<p align="center">
  <b>声のコミュニティ「koetomo（声とも）」の非公式 iOS クライアント</b><br>
  An unofficial iOS client for the "koetomo / 声とも" voice community.<br>
  <sub>Android 版はこちら → <a href="https://github.com/haizarakun/koetomoProject">koetomoProject</a></sub>
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.00%20beta-blue">
  <img alt="platform" src="https://img.shields.io/badge/platform-iOS%2014.0%2B-green">
  <img alt="install" src="https://img.shields.io/badge/install-Sileo%20%7C%20TrollStore%20%7C%20SideStore-purple">
  <img alt="license" src="https://img.shields.io/badge/license-source--available-lightgrey">
  <img alt="status" src="https://img.shields.io/badge/status-unofficial%20%2F%20test-orange">
</p>

> ⚠️ **非公式・ファンメイドのアプリです。** 運営元とは一切関係がありません。
> 公式に公開されていない API と通信するため、対象サービスの利用規約に抵触する可能性があります。
> 必ず [DISCLAIMER.md](DISCLAIMER.md) を読み、**自己責任**でご利用ください。
>
> 🧪 **iOS 版はベータ版です。** App Store では配布していません（できません）。脱獄機・TrollStore・SideStore 向けの配布です。

---

## これは何？

KoeTomo+ for iOS は、Android 版 KoeTomo+ と**同じ画面（HTML/CSS/JS）を iOS の WKWebView で動かす**非公式クライアントです。
Android 版の Java で書かれていた API 層を JavaScript に移植し、通信・キーチェーン・S3 アップロード・マイクなどの部分だけを薄い Objective-C のネイティブ層が担当します。

- **軽い** — IPA は約 1 MB。Android 版と同じ単一ページのフロントエンド
- **通信はすべて HTTPS** — 認証トークンは iOS のキーチェーンに保存し、meetscom.com 以外のサーバーへは送りません（アプリ側で強制）
- **Mac 不要でビルド** — Linux 上の Theos でビルドしています（ビルドは作者のみ。[ライセンス](#ライセンス)参照）
- **ソース公開** — 何をしているアプリか、誰でも読んで確認できます
- **自動アップデート** — 起動時と1時間ごとに新しい版を確認し、新しい版が出た古い版は使えなくなります（Sileo / TrollStore / SideStore それぞれの更新先を自動で開きます）
- **改変検知** — 同梱ファイルが書き換えられた・再パッケージされたビルドは起動しません

## 主な機能（v1.00 beta）

- ログイン（メール／X／LINE・Facebook（ID 指定）／トークン）、複数アカウント、Face ID ロック、新規登録、パスワード変更、SMS／メール認証
- タイムライン（つぶやく／話そう／フォロー中）、投稿の詳細、いいね、返信、投稿の作成・削除、画像・音声つき投稿
- 通知一覧・未読バッジ、プロフィール表示・編集、ユーザー設定
- 通話：枠の一覧・作成・参加・退出、挙手／承認／却下、キック、枠内チャット
- 応援トーク：受け手一覧・ランキング・おすすめ、通話の申込／応答／評価、コイン送付、履歴
- マッチング、ランダム通話（DIVE）、通話履歴・不在着信
- DM：会話一覧、本文、送信、既読、削除、画像・音声の送受信
- コミュニティ：一覧・検索・参加／退会、投稿・コメント・いいね、メンバー、通話枠
- 友達申請、フォロー／フォロワー一覧、相互、ブックマーク、投げ銭、ブロック、通報、ユーザー検索
- コイン／ポイント履歴、ポイント交換、装飾アイテム（一覧・購入・所持・履歴）
- 共有 BAN リスト連携（任意・同意制。閲覧・通報・業者の自動判定・異議申立）、規制対象になった自分の投稿の自動削除
- アプリを閉じている間の新着通知（iOS のバックグラウンド更新のタイミングで未読数を確認。設定でオン／オフ）
- アンケート、キャンペーン、通話録音（トークレコード）のコメント・いいね、通話アナウンス

**iOS 版でできないこと・Android 版と違うところ**
- コインの購入（アプリ内課金）。公式アプリまたは Android 版でご購入ください（購入したコインはそのまま使えます）
- 通話は iOS の制約で、アプリを離れると音声が止まる場合があります
- 通話中の小窓（PiP）・最前面バブルは iOS には無いので、代わりにアプリ内の通話パネルを使います
- バックグラウンド通知は iOS 側が決めるタイミング（数十分〜数時間おき）でしか確認できません。Android 版のような数十秒間隔の即時通知にはなりません

---

## 入れ方

自分の iPhone に合う方法を **1つ** 選んでください。どれも同じアプリが入ります。

| あなたの環境 | 使う方法 | 有効期限 | 難しさ |
|---|---|---|---|
| **脱獄している**（Dopamine、palera1n、checkra1n、unc0ver など） | [A. Sileo](#a-脱獄している人sileo--zebra) | 無期限 | ★☆☆ |
| **脱獄していないが TrollStore が入る**（iOS 14.0〜16.6.1、17.0） | [B. TrollStore](#b-trollstore-の人) | 無期限 | ★★☆ |
| **脱獄していない、TrollStore も入らない**（iOS 17.1 以降など） | [C. SideStore / AltStore](#c-脱獄していない人sidestore--altstore) | 7日ごとに自動更新 | ★★★ |

自分の iOS バージョンは「設定 → 一般 → 情報 → iOS バージョン」で確認できます。

### A. 脱獄している人（Sileo / Zebra）

rootless（Dopamine、palera1n rootless）と rootful（checkra1n、unc0ver、palera1n rootful）の**どちらにも対応**しています。Sileo が自分の環境に合う方を自動で選びます。

1. **Sileo** を開き、下の「ソース」タブ → 右上の **「＋」** をタップ
2. 次の URL を入力して「ソースを追加」

   ```
   https://raw.githubusercontent.com/haizarakun/koetomo-ios/main/repo/
   ```

3. 追加した「KoeTomo+ Repo」を開く → **KoeTomo+** → 右上の「入手」→「確認」
4. インストールが終わるとホーム画面に **KoeTomo+** のアイコンが自動で追加されます（出ない場合は「アイコンが出ない」を参照）

**更新**: 新しいバージョンが出ると Sileo の「アップデート」に表示されます。普通のパッケージと同じ操作で更新できます。
**削除**: Sileo → インストール済み → KoeTomo+ → 削除。

Zebra でも同じ URL でソースを追加できます。

### B. TrollStore の人

TrollStore は脱獄なしで IPA を**永久署名**して入れられる仕組みです（対応 iOS: 14.0〜16.6.1、17.0）。まだ入れていない人は [TrollStore の公式ガイド](https://ios.cfw.guide/installing-trollstore/) を見て先に導入してください。

1. iPhone の **Safari** で次の URL を開き、IPA をダウンロード（「ダウンロード」を許可）

   ```
   https://raw.githubusercontent.com/haizarakun/koetomo-ios/main/ipa/KoeTomoPlus_v1.00.ipa
   ```

2. 「ファイル」アプリ → ダウンロード → `KoeTomoPlus_v1.00.ipa` をタップ → 共有 → **TrollStore**
   （TrollStore を開き「Install IPA」でファイルを選んでもよい）
3. 「Install」をタップ。ホーム画面に **KoeTomo+** が追加されます

**更新**: 新しい IPA を同じ手順で入れると上書きされます（ログイン状態は残ります）。
**削除**: ホーム画面のアイコン長押し → アプリを削除。

### C. 脱獄していない人（SideStore / AltStore）

Apple ID で7日間の署名をして入れる方法です。**SideStore** または **AltStore** をまだ入れていない人は、それぞれの公式サイト（[sidestore.io](https://sidestore.io) / [altstore.io](https://altstore.io)）の手順で先に導入してください（PC または Mac が一度だけ必要です）。

1. SideStore（AltStore）を開く → 「Sources（ソース）」タブ → **「＋」**
2. 次の URL を追加

   ```
   https://raw.githubusercontent.com/haizarakun/koetomo-ios/main/source.json
   ```

3. 「KoeTomo+ Source」が追加されたら「Browse（見つける）」タブに **KoeTomo+** が出ます → **「FREE」／「入手」** をタップ
4. Apple ID の確認が出たら SideStore 側の案内に従います。ホーム画面に **KoeTomo+** が追加されます

**注意（Apple の制約）**
- 無料の Apple ID では **7日ごとの再署名**が必要です。SideStore / AltStore がバックグラウンドで自動更新しますが、切れた場合はストアを開いて「Refresh」
- 無料 Apple ID は同時に **3つ** までしかアプリを入れられません
- この方式ではバックグラウンド常駐と通知に制限があります（通話中はアプリを表に出しておいてください）

**更新**: 新しいバージョンが出るとストアの「Updates」に表示されます。

### 初回起動

1. 起動したらログイン方法を選びます（メール／トークン）。公式アプリで使っているアカウントがそのまま使えます
2. 通話をするには **マイク** の許可が必要です（初回に iOS が確認します。「設定 → KoeTomo+」から後で変えられます）

### うまくいかないとき

| 症状 | 対処 |
|---|---|
| Sileo で「KoeTomo+」が出てこない | ソースの URL 末尾の `/` まで正確に入力。追加後に上から下へ引っ張って更新 |
| Sileo で入れたのにアイコンが出ない | ホーム画面を再起動（Dopamine: 「Respring」／ Sileo の「Respring」ボタン）。それでも出ない場合はターミナルで `uicache -a` |
| TrollStore で「Install」が失敗する | IPA のダウンロードが途中で切れています。ファイルを削除してもう一度ダウンロード |
| SideStore で「Apple ID の上限」と出る | 無料 Apple ID は3アプリまで。使っていないアプリを1つ消してから |
| 起動直後に閉じる | 一度アンインストールしてから入れ直し。直らなければ [Issues](../../issues) に iOS バージョン・入れ方（A/B/C）・機種を書いて報告してください |
| ログインできない | 公式アプリで一度ログアウト→再ログインしてから試す。通信環境（VPN・広告ブロック）を切る |

- バンドル ID: `com.akun.koetomo`
- 対応: iOS 14.0 以上（arm64）
- 必要な権限: マイク（通話・音声投稿）、カメラ（アイコン撮影時のみ）、写真（画像投稿・保存時のみ）

---

## ソースコードについて

このリポジトリでは KoeTomo+ iOS 版の**ソースコードと配布物を公開**しています。
目的は「このアプリが何をしているか」を誰でも確認できるようにすることです。

```
.
├── repo/                    Sileo / Zebra 用リポジトリ（Packages・Release・debs/）
├── ipa/                     TrollStore / SideStore 用 IPA（未署名）
├── source.json              SideStore / AltStore 用ソース定義
├── src/                     ソースコード
│   ├── Sources/             ネイティブ Objective-C（WKWebView ホスト・HTTP 中継・キーチェーン・S3/Cognito）
│   ├── Resources/web/ios/   JavaScript の API 層（Android 版 KoeSession の移植）と AndroidApi 互換ブリッジ
│   ├── layout/DEBIAN/       .deb の postinst / postrm（アイコン登録）
│   └── Makefile  control  build_ios.sh  gen_dist.py
└── LICENSE  DISCLAIMER.md  NOTICE.md
```

画面（HTML/CSS/JS）は Android 版と共通で、[koetomoProject](https://github.com/haizarakun/koetomoProject) の `apk-skeleton/assets/web/` にあります。

公開しているのは**閲覧・検証のため**です。
このソースからのビルドや、ビルドした IPA／.deb の使用・配布は許可していません。
アプリはこのリポジトリの `repo/`・`ipa/`・Releases で配布しているものだけをご利用ください。

## ライセンス

本リポジトリは **ソースコードを公開していますが（source-available）、オープンソースではありません。**
Android 版と同じ [LICENSE](LICENSE) が適用されます（条文中の「APK」は本リポジトリでは IPA および .deb を指します）。

| | |
|---|---|
| ✅ できる | ソースの閲覧・学習・検証／不具合の報告・改善提案 |
| ❌ できない | **ソースからのビルド**／**改変版の公開・配布**／**IPA・.deb・ソースの再配布・ミラー**（他の Sileo リポジトリへの転載を含む）／**商用利用**／配布物の逆解析・改ざん・再署名／運営や他ユーザーへの迷惑行為／自動化・bot 利用 |

「koetomo」「声とも」等の名称・ロゴ・サービス上のコンテンツはそれぞれの権利者に帰属します（[DISCLAIMER.md](DISCLAIMER.md)）。
同梱・依存する第三者コンポーネントは [NOTICE.md](NOTICE.md) を参照してください。

---

<details>
<summary><b>English</b></summary>

**KoeTomo+ for iOS** is an unofficial, fan-made iOS client for the Japanese voice community
"koetomo / 声とも". It is not affiliated with or endorsed by the service operator, and it
talks to a non-public API, which may violate the service's Terms of Service. **Use at your own risk**
(see [DISCLAIMER.md](DISCLAIMER.md)). It is a test build and is not (and cannot be) on the App Store.

**Install (pick one):**
- **Jailbroken (rootless or rootful):** add `https://raw.githubusercontent.com/haizarakun/koetomo-ios/main/repo/` as a source in Sileo or Zebra and install *KoeTomo+*.
- **TrollStore (iOS 14.0–16.6.1 / 17.0):** download `https://raw.githubusercontent.com/haizarakun/koetomo-ios/main/ipa/KoeTomoPlus_v1.00.ipa` in Safari and open it with TrollStore.
- **SideStore / AltStore (no jailbreak):** add `https://raw.githubusercontent.com/haizarakun/koetomo-ios/main/source.json` as a source; free Apple IDs need a re-sign every 7 days.

**Not available on iOS:** in-app coin purchase (buy on the official app or the Android build; coins are shared).

**Source-viewable, not open source.** You may read the code for study and verification.
You may **not** build the app from this source, redistribute the IPA/.deb or source (including re-hosting
on other repos), publish modified versions, use it commercially, or reverse-engineer / re-sign the binaries.
See [LICENSE](LICENSE).

</details>
