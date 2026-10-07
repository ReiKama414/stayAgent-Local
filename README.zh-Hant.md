# Stay Agent（Local）

[English](./README.md) · [繁體中文](./README.zh-Hant.md) · [日本語](./README.ja.md)

本機住宿搜尋，支援 Booking.com、Agoda、Airbnb、Trip.com

在自己電腦跑，Next.js + Playwright Chromium + SQLite  
設好條件後會開房源頁、核對空房與價格、再顯示結果

介面：English / 繁體中文 / 日本語

---

## 聲明

| | |
|---|---|
| 授權 | [MIT](./LICENSE) © [ReiKama414](https://github.com/ReiKama414) |
| 最後更新 | **2026-10-07** |
| 之後 | **未再**更新各平台適配 |

訂房站常改版，選擇器會壞、驗證會變嚴、爬蟲政策也可能改  
若最後更新之後某站抓不到，多半是對方改了，請自行確認條款與風險

僅供個人研究／學習，請遵守各站條款與法規，請求太頻繁可能被擋帳號或 IP

---

## 功能

- 搜尋 Booking.com、Agoda、Airbnb、Trip.com
- 依預算、臥室、衛浴、步行到車站、評分等篩選
- 需要驗證時可暫停，在瀏覽器視窗手動處理後再繼續
- 搜尋歷史、收藏、預設條件、匯出 HTML

---

## 環境需求

- Node.js 20+（建議）
- Windows / macOS / Linux
- `npm install` 會透過 Playwright 安裝 Chromium

---

## 快速開始

```bash
npm install
npm run dev
```

開啟 [http://localhost:3000](http://localhost:3000)，選目的地與日期後搜尋

```bash
npm run build && npm start
npm run typecheck
```

資料在 `data/`（SQLite）  
瀏覽器設定在 `browser-profile/`（已忽略進 git）

---

## 注意

- 第一次建議用有頭模式，方便過驗證
- 一次要訂多於 1 間「房間」時會略過 Airbnb（偏整間出租）
- 最近車站可能來自 OpenStreetMap，對方掛掉時可能暫時沒有站名

---

## 技術棧

Next.js 15、React 19、Playwright、better-sqlite3、Tailwind CSS 4、TypeScript

流程：UI → search API → job → providers（Playwright）→ SQLite → 輪詢狀態

---

## 授權

MIT © [ReiKama414](https://github.com/ReiKama414)  
見 [LICENSE](./LICENSE)

可自由使用、複製、修改、散佈（含商業用途）  
需保留版權與授權聲明，軟體不提供任何擔保
