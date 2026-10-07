# Stay Agent (Local)

[English](./README.md) · [繁體中文](./README.zh-Hant.md) · [日本語](./README.ja.md)

Local accommodation search across Booking.com, Agoda, Airbnb, and Trip.com

Runs on your machine with Next.js, Playwright Chromium, and SQLite  
Set your criteria, the tool opens listings, checks availability and price, then shows results

UI: English / 繁體中文 / 日本語

---

## Notice

| | |
|---|---|
| License | [MIT](./LICENSE) © [ReiKama414](https://github.com/ReiKama414) |
| Last updated | **2026-10-07** |
| After that | adapters were **not** updated |

Sites change often, selectors break, CAPTCHAs get stricter, crawl policies may change  
If something fails after the last update, the site may have changed, check their terms yourself and use at your own risk

For personal research / learning only, respect each platform’s terms and local law, heavy use may get your account or IP blocked

---

## Features

- Search Booking.com, Agoda, Airbnb, Trip.com
- Filter by budget, bedrooms, bathrooms, walk to station, rating, etc
- Pause when a site needs manual verification in the browser window
- History, favorites, presets, HTML export

---

## Requirements

- Node.js 20+ recommended
- Windows / macOS / Linux
- `npm install` installs Chromium via Playwright

---

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), pick destination and dates, then search

```bash
npm run build && npm start
npm run typecheck
```

Data: `data/` (SQLite)  
Browser profile: `browser-profile/` (gitignored)

---

## Notes

- First run: prefer headed (not headless) so you can pass verification
- Airbnb is skipped when booking more than 1 room (whole-listing style)
- Nearest station may come from OpenStreetMap, sometimes missing when OSM is down

---

## Stack

Next.js 15, React 19, Playwright, better-sqlite3, Tailwind CSS 4, TypeScript

Flow: UI → search API → job → providers via Playwright → SQLite → poll status

---

## License

MIT © [ReiKama414](https://github.com/ReiKama414)  
See [LICENSE](./LICENSE)

You can use, copy, modify, and distribute this software, including commercially  
Just keep the copyright notice and license text, no warranty is provided
