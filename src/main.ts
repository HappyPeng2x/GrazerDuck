import './style.css';
import 'xterm/css/xterm.css';
import * as duckdb from '@duckdb/duckdb-wasm';
import * as shellLib from '@duckdb/duckdb-wasm-shell';

// Bundle these WASM / worker files locally — they are precached by the SW,
// so the app works fully offline after the first install.
import shellWasmUrl from '@duckdb/duckdb-wasm-shell/dist/shell_bg.wasm?url';
import mvpWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import ehWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import coiWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-coi.wasm?url';
import mvpWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import coiWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-coi.worker.js?url';
import coiPthreadWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-coi.pthread.worker.js?url';

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasmUrl, mainWorker: mvpWorkerUrl },
  eh:  { mainModule: ehWasmUrl,  mainWorker: ehWorkerUrl },
  coi: { mainModule: coiWasmUrl, mainWorker: coiWorkerUrl, pthreadWorker: coiPthreadWorkerUrl },
};

// DuckDB instance shared between the shell and our import/export helpers
let dbInstance: duckdb.AsyncDuckDB | null = null;

// ─── Service Worker registration ─────────────────────────────────────────────

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });

    // When the SW activates for the first time it sets the COI headers.
    // We need one reload so those headers are applied to this window.
    const reloadKey = 'grazerduck_coi_reload';
    if (!crossOriginIsolated && !sessionStorage.getItem(reloadKey)) {
      sessionStorage.setItem(reloadKey, '1');

      const doReload = () => {
        if (navigator.serviceWorker.controller) location.reload();
      };
      // Already controlled? Reload now; otherwise wait for controllerchange.
      doReload();
      navigator.serviceWorker.addEventListener('controllerchange', doReload);
    }

    // Listen for updates so we can offer a "New version available" nudge.
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'activated') {
          showUpdateBanner();
        }
      });
    });
  } catch (err) {
    console.error('[SW] Registration failed:', err);
  }
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function setStatus(text: string, variant: 'loading' | 'ready' | 'error' = 'loading') {
  const dot  = document.getElementById('status-dot')!;
  const label = document.getElementById('status-text')!;
  label.textContent = text;
  dot.className = `status-dot status-${variant}`;
}

function showToast(html: string, durationMs = 6000) {
  const container = document.getElementById('toast-container')!;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = html;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, durationMs);
}

function showUpdateBanner() {
  const banner = document.getElementById('update-banner');
  if (banner) banner.style.display = 'flex';
}

// ─── File import ─────────────────────────────────────────────────────────────

function sqlHintForFile(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const q = (fn: string) => `'${fn}'`;
  switch (ext) {
    case 'csv':   return `SELECT * FROM read_csv_auto(${q(filename)});`;
    case 'tsv':   return `SELECT * FROM read_csv_auto(${q(filename)}, delim='\\t');`;
    case 'parquet': return `SELECT * FROM read_parquet(${q(filename)});`;
    case 'json':  return `SELECT * FROM read_json_auto(${q(filename)});`;
    case 'ndjson':
    case 'jsonl': return `SELECT * FROM read_json(${q(filename)});`;
    case 'arrow': return `SELECT * FROM read_arrow(${q(filename)});`;
    default:      return `SELECT * FROM read_csv_auto(${q(filename)});`;
  }
}

async function pickAndRegisterFiles() {
  if (!dbInstance) {
    showToast('<span class="toast-icon">⚠</span> Database not ready yet.');
    return;
  }
  const db = dbInstance;

  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.csv,.tsv,.json,.jsonl,.ndjson,.parquet,.arrow,.db';

  await new Promise<void>((resolve) => {
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      for (const file of files) {
        await db.dropFile(file.name);
        await db.registerFileHandle(
          file.name,
          file,
          duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
          true,
        );
        const hint = sqlHintForFile(file.name);
        const escapedHint = hint.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        showToast(
          `<span class="toast-icon">✓</span>
           <div class="toast-body">
             <strong>${file.name}</strong> registered
             <code class="toast-code">${escapedHint}</code>
             <button class="toast-copy" onclick="navigator.clipboard.writeText(${JSON.stringify(hint)});this.textContent='Copied!'">📋 Copy</button>
           </div>`,
          9000,
        );
      }
      resolve();
    };
    input.click();
  });
}

// ─── Export dialog ───────────────────────────────────────────────────────────

function openExportDialog() {
  if (!dbInstance) {
    showToast('<span class="toast-icon">⚠</span> Database not ready yet.');
    return;
  }
  (document.getElementById('dialog-export') as HTMLDialogElement).showModal();
}

async function runExport() {
  if (!dbInstance) return;
  const query    = (document.getElementById('export-query')    as HTMLTextAreaElement).value.trim();
  const filename = (document.getElementById('export-filename') as HTMLInputElement).value.trim() || 'export.csv';
  const format   = (document.querySelector('input[name="export-format"]:checked') as HTMLInputElement).value as 'csv' | 'json';

  if (!query) { showToast('<span class="toast-icon">⚠</span> Enter a SQL query.'); return; }

  try {
    const conn   = await dbInstance.connect();
    const result = await conn.query(query);
    await conn.close();

    const rows    = result.toArray();
    const fields  = result.schema.fields.map((f) => f.name);

    let content: string;
    let mime: string;

    if (format === 'csv') {
      const csvRow = (vals: unknown[]) =>
        vals.map((v) => {
          if (v === null || v === undefined) return '';
          const s = String(v);
          return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',');
      content = [csvRow(fields), ...rows.map((r) => csvRow(fields.map((f) => (r as Record<string,unknown>)[f])))].join('\n');
      mime = 'text/csv';
    } else {
      content = JSON.stringify(rows, null, 2);
      mime = 'application/json';
    }

    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    (document.getElementById('dialog-export') as HTMLDialogElement).close();
    showToast(`<span class="toast-icon">✓</span> Exported <strong>${filename}</strong>`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast(`<span class="toast-icon">✗</span> Export failed: ${msg}`, 8000);
  }
}

// ─── Help panel toggle ────────────────────────────────────────────────────────

function toggleHelp() {
  const panel = document.getElementById('help-panel')!;
  panel.classList.toggle('help-visible');
}

// ─── PWA install prompt ───────────────────────────────────────────────────────

let deferredInstall: Event | null = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  const btn = document.getElementById('btn-install')!;
  btn.style.display = 'flex';
});

window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  const btn = document.getElementById('btn-install')!;
  btn.style.display = 'none';
  showToast('<span class="toast-icon">✓</span> GrazerDuck installed! Launch it from your desktop.');
});

function installPWA() {
  if (!deferredInstall) return;
  (deferredInstall as BeforeInstallPromptEvent).prompt();
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

// ─── DuckDB + Shell bootstrap ─────────────────────────────────────────────────

async function bootstrap() {
  await registerServiceWorker();

  // Show bundle info once we know which one was chosen
  let chosenBundle = 'DuckDB';

  await shellLib.embed({
    shellModule: shellWasmUrl,
    container: document.getElementById('terminal') as HTMLDivElement,
    fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', monospace",
    backgroundColor: '#0d1117',
    resolveDatabase: async (progressHandler) => {
      setStatus('Loading DuckDB…', 'loading');

      const bundle = await duckdb.selectBundle(BUNDLES);

      // Identify which bundle was selected
      if (bundle.mainModule === coiWasmUrl)      chosenBundle = 'DuckDB (COI · threaded)';
      else if (bundle.mainModule === ehWasmUrl)  chosenBundle = 'DuckDB (EH)';
      else                                        chosenBundle = 'DuckDB (MVP)';

      const worker = new Worker(bundle.mainWorker!);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      const db = new duckdb.AsyncDuckDB(logger, worker);

      await db.instantiate(bundle.mainModule, bundle.pthreadWorker ?? null, progressHandler);

      dbInstance = db;
      setStatus('Ready', 'ready');
      document.getElementById('bundle-badge')!.textContent = chosenBundle;
      return db;
    },
  });
}

// ─── Wire up interactive elements ────────────────────────────────────────────

document.getElementById('btn-import')!.addEventListener('click', () => pickAndRegisterFiles());
document.getElementById('btn-export')!.addEventListener('click', () => openExportDialog());
document.getElementById('btn-help')!.addEventListener('click', () => toggleHelp());
document.getElementById('btn-install')!.addEventListener('click', () => installPWA());

document.getElementById('btn-export-run')!.addEventListener('click', () => runExport());
document.getElementById('btn-export-cancel')!.addEventListener('click', () =>
  (document.getElementById('dialog-export') as HTMLDialogElement).close()
);

document.getElementById('btn-update')?.addEventListener('click', () => location.reload());
document.getElementById('btn-help-close')?.addEventListener('click', () => toggleHelp());

// Dismiss help panel on backdrop click
document.getElementById('help-panel')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) toggleHelp();
});

// ─── Start ───────────────────────────────────────────────────────────────────

bootstrap().catch((err) => {
  console.error('[GrazerDuck] Bootstrap failed:', err);
  setStatus('Failed to start', 'error');
});
