# KoeTomo+ iOS 版

Android 版と同じ画面（HTML/JS）を iOS の WKWebView で動かす、声とも（koetomo）の非公式クライアントです。
ログイン・タイムライン・通話・DM・コミュニティ・応援トーク・マッチング・友達／フォロー・ブックマーク・投げ銭・装飾など、Android 版の機能をひと通り移植しています（コインの購入＝アプリ内課金だけは iOS 版では使えません）。

## 入れ方

### 脱獄している人（Sileo / Zebra）
Sileo で「ソース」→「+」→ 次の URL を追加 → 「KoeTomo+」をインストール。
rootless（Dopamine、palera1n rootless）と rootful（checkra1n、unc0ver、palera1n rootful）のどちらにも対応しています。インストール後、ホーム画面にアイコンが自動で追加されます。

```
https://raw.githubusercontent.com/haizarakun/koetomo-ios/main/repo/
```

### TrollStore の人（iOS 14.0〜16.6.1 / 17.0）
`https://raw.githubusercontent.com/haizarakun/koetomo-ios/main/ipa/` にある最新の `KoeTomoPlus_vX.X.X.ipa` を Safari でダウンロードし、TrollStore で開いてインストール（永久有効・再署名不要）。

### 脱獄していない人（SideStore / AltStore）
SideStore の「ソース」に次の URL を追加すると、ストア内に KoeTomo+ が出てきます（更新も通知されます）。

```
https://raw.githubusercontent.com/haizarakun/koetomo-ios/main/source.json
```

無料 Apple ID の制約で **7日ごとに再署名**が必要です（SideStore が自動で行います）。この方式ではバックグラウンド常駐と通知に制限があります。

## 安全面
- 認証トークンは iOS のキーチェーンに保存し、meetscom.com 以外のサーバーには送りません（アプリ側で強制）。
- 通信はすべて HTTPS のみ。同梱ページ以外の Web コンテンツはアプリ内で開かず、外部ブラウザに渡します。
- 診断ログにトークンや署名は記録しません。

## ビルド（Mac 不要）
Linux 上の [Theos](https://theos.dev) + iOS SDK でビルドしています（`src/`）。`build_ios.sh` が rootless / rootful の .deb と未署名 IPA を同じソースから作ります。
