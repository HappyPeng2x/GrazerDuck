# GrazerDuck

A fully offline DuckDB SQL terminal that runs entirely in your browser.  
Install it once — it never touches the network again.

![GrazerDuck logo](public/icons/icon-192.png)

---

## What it is

GrazerDuck is a [Progressive Web App](https://web.dev/progressive-web-apps/) that embeds [DuckDB](https://duckdb.org/) compiled to WebAssembly alongside an [xterm.js](https://xtermjs.org/) terminal shell.  
You get a full analytical SQL engine — CSV, Parquet, JSON, Arrow — with zero server, zero telemetry, and zero data leaving your device.

**Key properties:**

| Property | Detail |
|----------|--------|
| Offline | All assets precached on first install; works with no network thereafter |
| Private | Queries and data never leave the browser tab |
| Installable | PWA — add to desktop/home screen from Chrome, Edge, or Safari |
| Powerful | DuckDB 1.32 — window functions, JSON, Parquet, Arrow, regex, COPY … |
| Fast | Automatically selects the COI (multi-threaded) WASM bundle when available |

---

## Demo / install

Deploy to GitHub Pages with one push (see [Deployment](#deployment)), then open the URL in Chrome and click **+ Install App** in the toolbar.

---

## Features

### Terminal
The shell is the standard DuckDB interactive shell, compiled to WASM.  
Everything that works in `duckdb` on the command line works here.

### Import files
Click **📂 Import File** to pick one or more local files.  
Supported formats: CSV, TSV, JSON, NDJSON, Parquet, Arrow.  
After import a toast appears with the exact SQL to query the file:

```sql
SELECT * FROM read_csv_auto('sales.csv');
SELECT * FROM read_parquet('events.parquet');
SELECT * FROM read_json_auto('data.json');
```

Files are registered in DuckDB's virtual filesystem — they are never uploaded anywhere.

### Export
Two export paths are available:

**Via the Export dialog** (📂 footer button): type any SQL query, choose CSV or JSON, click *Export & Download* — the result lands in your Downloads folder.

**Via the shell** (full DuckDB COPY syntax):
```sql
COPY my_table TO 'output.csv' (FORMAT CSV, HEADER);
COPY (SELECT id, name FROM users WHERE active) TO 'active.parquet';
COPY my_table TO 'dump.json' (FORMAT JSON, ARRAY true);
```

### Commands cheat sheet
Click **⌨ Commands** to open a slide-in panel with common shell commands and SQL snippets. Every code block is click-to-copy.

---

## How the offline + COI trick works

GitHub Pages does not allow setting HTTP response headers, but DuckDB's fastest WASM bundle (COI — cross-origin isolated, multi-threaded) requires:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

GrazerDuck ships a custom service worker (`src/sw.js`) that **injects these headers into every response it serves**, including the main HTML navigation request. After the service worker activates (which triggers one automatic page reload on first visit), `crossOriginIsolated` becomes `true` and DuckDB switches to the COI bundle automatically.

On the very first visit (before the SW is active) DuckDB falls back to the EH bundle — still fully functional, just single-threaded.

---

## Getting started

**Requirements:** Node 20+, npm 9+

```bash
git clone https://github.com/YOUR_USERNAME/GrazerDuck.git
cd GrazerDuck
npm install
```

### Development

```bash
npm run dev
```

Opens at `http://localhost:5173`. The service worker is not active in dev mode (`vite dev` bypasses it), so DuckDB runs in EH mode. To test the full PWA including SW and COI:

```bash
npm run build && npm run preview
```

Then open `http://localhost:4173` — the SW registers, the page reloads once, and you get the COI bundle.

### Build

```bash
npm run build   # output → dist/
```

The build bundles all three DuckDB WASM bundles (MVP / EH / COI) and all worker scripts as local assets. The service worker precaches everything so the app is fully self-contained after the first install.

---

## Deployment

### GitHub Pages (recommended)

1. Push to GitHub.
2. Go to **Settings → Pages** and set source to *GitHub Actions*.
3. The workflow in `.github/workflows/deploy.yml` runs on every push to `main` and deploys `dist/` automatically.

If your repo is at `github.io/GrazerDuck` (i.e. not a root Pages site), add a repository variable:

**Settings → Variables → Actions → New repository variable**  
Name: `BASE_URL` Value: `/GrazerDuck/`

The deploy workflow passes this through to Vite's `base` config.

### Any static host

```bash
npm run build
# upload dist/ to Netlify, Cloudflare Pages, S3, etc.
```

No server-side configuration is required — the service worker handles the COOP/COEP headers.

---

## Project structure

```
GrazerDuck/
├── src/
│   ├── main.ts       # App entry: SW registration, DuckDB init, shell embed, UI wiring
│   ├── sw.js         # Service worker: COI headers + Workbox-style precache
│   └── style.css     # All styles (CSS custom properties, dark theme)
├── public/
│   └── icons/        # PWA icons (32, 192, 512, maskable-512, apple-touch-icon)
├── index.html        # Single-page shell: header, terminal div, footer, dialogs
├── vite.config.ts    # Vite + vite-plugin-pwa (injectManifest strategy)
├── tsconfig.json
├── LICENSE           # AGPLv3-or-later
└── THIRD_PARTY_NOTICES
```

---

## Useful DuckDB shell commands

```sql
-- Inspect what's loaded
SELECT * FROM duckdb_tables();
DESCRIBE my_table;
SUMMARIZE my_table;          -- column statistics

-- Query files directly (no import step needed)
SELECT * FROM read_csv_auto('file.csv') LIMIT 100;
SELECT COUNT(*) FROM read_parquet('*.parquet');

-- Persist a query result
CREATE TABLE t AS SELECT * FROM read_csv_auto('data.csv');

-- Timer
.timer on

-- Help
.help
```

---

## License

GrazerDuck is released under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later).  
See [`LICENSE`](LICENSE) for the full text.

Third-party dependencies are MIT, Apache-2.0, or 0BSD — all permissive and compatible with AGPL.  
Attribution notices required by Apache-2.0 (apache-arrow, flatbuffers, @swc/helpers) are in [`THIRD_PARTY_NOTICES`](THIRD_PARTY_NOTICES).
