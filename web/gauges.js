// Gauge logic (freshness, status, formatting, trend, cache, fetch) lives in
// gauge-core.js so the per-river pages share exactly what the table uses —
// this file stays the homepage table's controller and nothing else.
import {
  CMS_TO_CFS,
  REFRESH_MS,
  ageInfo,
  escapeHtml,
  fetchGauges,
  flowText,
  readCache,
  rowClass,
  trendInfo,
  writeCache,
} from './gauge-core.js';

const COLSPAN = 5;

let allRows = [];
let sortCol = 'name';
let sortDir = 'asc';
let filterText = '';
let filterStatus = 'all';

// --- Favorites: star a run to pin it to the top. localStorage only — no
// accounts, ever. Keys are gauge `key` values (a stable contract; any future
// run rename ships an old→new remap here). Orphaned keys are KEPT, not
// pruned: a run temporarily off the roster gets its star back on return.
// Every storage touch is defensive — private-mode Safari throws on writes,
// and a broken favorites store must degrade to "unstarred, working page".
const FAVORITES_KEY = 'lateboof:favorites:v1';

function readFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(k => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeFavorites(keys) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(keys));
  } catch {
    // best-effort: the in-memory set still pins for this session
  }
}

const favorites = new Set(readFavorites());

function toggleFavorite(key) {
  if (favorites.has(key)) favorites.delete(key);
  else favorites.add(key);
  writeFavorites([...favorites]);
  applyFiltersAndSort();
}

function sortValue(g, col) {
  switch (col) {
    case 'name':     return g.name.toLowerCase();
    case 'location': return g.location.toLowerCase();
    case 'flow': {
      if (g.discharge == null) return -Infinity;
      // Normalize to cfs so cms (WSC) rows sort by true volume, not raw number.
      return g.discharge_unit === 'cms' ? Number(g.discharge) * CMS_TO_CFS : Number(g.discharge);
    }
    case 'text_key': return g.text_key.toLowerCase();
    case 'updated':  return g.reading_time ? new Date(g.reading_time).getTime() : -Infinity;
    default: return '';
  }
}

function applyFiltersAndSort() {
  let rows = allRows;

  if (filterText) {
    const q = filterText.toLowerCase();
    rows = rows.filter(g =>
      g.name.toLowerCase().includes(q) ||
      g.location.toLowerCase().includes(q) ||
      g.text_key.toLowerCase().includes(q)
    );
  }

  if (filterStatus !== 'all') {
    rows = rows.filter(g => rowClass(g) === filterStatus);
  }

  rows = [...rows].sort((a, b) => {
    const av = sortValue(a, sortCol);
    const bv = sortValue(b, sortCol);
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // Starred rows pin to the top; sort order is preserved within each group.
  // Pinning is ordering-only — the filters above already applied to everything.
  const pinned = rows.filter(g => favorites.has(g.key));
  const rest = rows.filter(g => !favorites.has(g.key));

  renderRows([...pinned, ...rest], pinned.length);
  updateHeaders();
}

function renderRows(rows, pinnedCount = 0) {
  const tbody = document.getElementById('gauge-body');
  if (!rows.length) {
    tbody.innerHTML = `<tr class="message-row"><td colspan="${COLSPAN}">No rivers match.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((g, i) => {
    const status   = rowClass(g);
    const gaugeUrl = escapeHtml(g.gauge_url);
    const name     = escapeHtml(g.name);
    const location = escapeHtml(g.location);
    const flow     = escapeHtml(flowText(g));
    const textKey  = escapeHtml(g.text_key);
    const { label, cls: ageCls } = ageInfo(g);
    const age = escapeHtml(label);
    const trend = trendInfo(g);
    const trendHtml = trend
      ? ` <span class="trend ${trend.cls}" title="${escapeHtml(trend.title)}">${trend.glyph}</span>`
      : '';
    const isFav = favorites.has(g.key);
    // The star is a <button>, not part of the run link — its click must never
    // open the gauge page, and it needs its own generous tap target on mobile.
    const starHtml = `<button class="fav-btn${isFav ? ' on' : ''}" data-key="${escapeHtml(g.key)}"` +
      ` aria-pressed="${isFav}" aria-label="${isFav ? 'Unpin' : 'Pin to top'}"` +
      ` title="${isFav ? 'Unpin' : 'Pin to top'}">${isFav ? '★' : '☆'}</button>`;
    const rowCls = status +
      (i < pinnedCount ? ' pinned' : '') +
      (pinnedCount > 0 && i === pinnedCount - 1 ? ' pinned-last' : '');
    return `<tr class="${rowCls}">
      <td data-label="Run">${starHtml}<a class="river-name" href="${gaugeUrl}" target="_blank" rel="noopener">${name}</a><span class="river-sub">${location}</span></td>
      <td class="location col-location" data-label="Location">${location}</td>
      <td class="flow" data-label="Flow">${flow}${trendHtml}</td>
      <td class="cmd" data-label="Text this">${textKey}</td>
      <td class="age${ageCls ? ' ' + ageCls : ''}" data-label="Updated">${age}</td>
    </tr>`;
  }).join('');
}

// ONE delegated listener on the (persistent) tbody — renderRows rebuilds row
// innerHTML every refresh, so per-row listeners would die on the first tick.
document.getElementById('gauge-body').addEventListener('click', e => {
  const btn = e.target.closest('.fav-btn');
  if (!btn) return;
  e.preventDefault();
  toggleFavorite(btn.dataset.key);
});

function updateHeaders() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    th.dataset.dir = th.dataset.col === sortCol ? sortDir : '';
  });
}

async function load() {
  const refreshNote = document.getElementById('refresh-note');
  try {
    // No client-side allowlist: refresh-gauges/index.ts already prunes any row
    // whose key isn't in the canonical GAUGES list, so the table itself is the
    // source of truth for "active." A duplicate list here only risks silently
    // hiding gauges the backend has already vetted (as happened with the SF
    // Flathead / Phantom Ranch / NZ additions).
    allRows = await fetchGauges();
    writeCache(allRows);
    applyFiltersAndSort();

    const fetchedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    refreshNote.className = 'refresh-note';
    refreshNote.textContent = `fetched at ${fetchedAt}`;
  } catch (e) {
    console.error(e);
    const cached = readCache();
    if (cached?.rows?.length) {
      allRows = cached.rows;
      applyFiltersAndSort();
      const cachedAt = new Date(cached.fetchedAt).toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      refreshNote.className = 'refresh-note stale';
      refreshNote.textContent = `Showing cached data from ${cachedAt} — could not reach live data.`;
      return;
    }
    refreshNote.className = 'refresh-note stale';
    refreshNote.textContent = 'Could not load gauge data — try refreshing.';
    document.getElementById('gauge-body').innerHTML =
      `<tr class="message-row"><td colspan="${COLSPAN}">Could not load gauge data. Try refreshing.</td></tr>`;
  }
}

// Sort: click header to sort asc; click again to flip desc
document.querySelectorAll('th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    sortDir = sortCol === col && sortDir === 'asc' ? 'desc' : 'asc';
    sortCol = col;
    applyFiltersAndSort();
  });
});

// Text search
document.getElementById('filter-input').addEventListener('input', e => {
  filterText = e.target.value.trim();
  applyFiltersAndSort();
});

// Status filter buttons
document.querySelectorAll('.status-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    filterStatus = btn.dataset.status;
    document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyFiltersAndSort();
  });
});

document.getElementById('gauge-body').innerHTML =
  `<tr class="message-row"><td colspan="${COLSPAN}">Loading…</td></tr>`;
load();
setInterval(load, REFRESH_MS);
