# Stay Agent (Local)

[English](./README.md) · [繁體中文](./README.zh-Hant.md) · [日本語](./README.ja.md)

Booking.com / Agoda / Airbnb / Trip.com を対象にしたローカル宿泊検索

自分の PC 上で動作、Next.js + Playwright Chromium + SQLite  
条件を入れると物件ページを開き、空室と料金を確認して結果を表示する

UI：English / 繁體中文 / 日本語

---

## 注意事項

| | |
|---|---|
| ライセンス | [MIT](./LICENSE) © [ReiKama414](https://github.com/ReiKama414) |
| 最終更新 | **2026-10-07** |
| それ以降 | 各サイト向けの対応は**更新していない** |

予約サイトはよく変わる、セレクタが壊れたり、CAPTCHA が厳しくなったり、クローラ方針が変わったりしうる  
最終更新以降に取れなくなった場合はサイト側の変更の可能性が高い、利用規約とリスクは各自で確認すること

個人の調査／学習向け、各サービスの規約と法令を守ること、頻度が高すぎるとアカウントや IP が制限されることがある

---

## 機能

- Booking.com / Agoda / Airbnb / Trip.com を検索
- 予算、寝室、浴室、駅まで徒歩、評価などで絞り込み
- 認証が必要なときは一時停止し、ブラウザで手動対応してから再開
- 検索履歴、お気に入り、プリセット、HTML エクスポート

---

## 動作環境

- Node.js 20+ 推奨
- Windows / macOS / Linux
- `npm install` で Playwright 経由の Chromium をインストール

---

## クイックスタート

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開き、目的地と日程を選んで検索

```bash
npm run build && npm start
npm run typecheck
```

データは `data/`（SQLite）  
ブラウザ設定は `browser-profile/`（gitignore 済み）

---

## 補足

- 初回は headed（非 headless）推奨、認証しやすい
- 部屋を 2 室以上取る場合は Airbnb をスキップ（一棟貸し向きのため）
- 最寄駅は OpenStreetMap 由来のことがあり、OSM 障害時は駅名が付かないことがある

---

## 技術構成

Next.js 15、React 19、Playwright、better-sqlite3、Tailwind CSS 4、TypeScript

流れ：UI → search API → job → providers（Playwright）→ SQLite → 状態ポーリング

---

## ライセンス

MIT © [ReiKama414](https://github.com/ReiKama414)  
[LICENSE](./LICENSE) を参照

利用・複製・改変・再配布（商用含む）は自由  
著作権表示とライセンス文の保持が条件、無保証
