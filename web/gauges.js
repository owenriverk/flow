const SUPABASE_URL = 'https://vfkoegvzllxvshcnfbox.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZma29lZ3Z6bGx4dnNoY25mYm94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NzE1MTcsImV4cCI6MjA5ODI0NzUxN30.PdQ8fbjVE0s8LoTED5WHyb1zx8WU-X3QqO4td9XBHqo';
const REFRESH_MS = 10 * 60 * 1000;
const COLSPAN = 5;

// Reading timestamps older than this are flagged visually.
const STALE_WARN_HRS  = 2;   // muted warning style
const OFFLINE_HRS     = 72;  // [OFFLINE] — clearly broken

let allRows = [];
let sortCol = 'name';
let sortDir = 'asc';
let filterText = '';
let filterStatus = 'all';

/**
 * Returns { label, cls } for a reading timestamp.
 * cls is '' (fresh), 'age-stale' (> 2 hr), or 'age-offline' (> 72 hr or missing).
 */
function ageInfo(isoString) {
  if (!isoString) return { label: '—', cls: 'age-offline' };
  const mins = (Date.now() - new Date(isoString).getTime()) / 60000;
  if (mins < 1)  return { label: 'just now', cls: '' };
  if (mins < 60) return { label: `${Math.floor(mins)} min ago`, cls: '' };
  const h = Math.floor(mins / 60);
  if (h >= OFFLINE_HRS) return { label: '[OFFLINE]', cls: 'age-offline' };
  if (h >= STALE_WARN_HRS) return { label: `${h} hr ago`, cls: 'age-stale' };
  return { label: '1 hr ago', cls: '' };
}

function rowClass(g) {
  const d = g.discharge;
  if (d == null && g.stage == null) return 'grey';
  if (g.low == null || g.high == null || d == null) return '';
  if (d < g.low) return 'low';
  if (d > g.high) return 'high';
  return 'good';
}

function flowText(g) {
  if (g.discharge != null) {
    const n = g.discharge_unit === 'cms'
      ? Number(g.discharge).toLocaleString('en-US', { maximumFractionDigits: 1 })
      : Math.round(g.discharge).toLocaleString('en-US');
    const stg = g.stage != null
      ? ` / ${Number(g.stage).toFixed(2)} ${g.stage_unit}`
      : '';
    return `${n} ${g.discharge_unit}${stg}`;
  }
  if (g.stage != null) return `${Number(g.stage).toFixed(2)} ${g.stage_unit}`;
  return '—';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function sortValue(g, col) {
  switch (col) {
    case 'name':     return g.name.toLowerCase();
    case 'location': return g.location.toLowerCase();
    case 'flow':     return g.discharge != null ? Number(g.discharge) : -Infinity;
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

  renderRows(rows);
  updateHeaders();
}

function renderRows(rows) {
  const tbody = document.getElementById('gauge-body');
  if (!rows.length) {
    tbody.innerHTML = `<tr class="message-row"><td colspan="${COLSPAN}">No rivers match.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(g => {
    const status   = rowClass(g);
    const gaugeUrl = escapeHtml(g.gauge_url);
    const name     = escapeHtml(g.name);
    const location = escapeHtml(g.location);
    const flow     = escapeHtml(flowText(g));
    const textKey  = escapeHtml(g.text_key);
    const { label, cls: ageCls } = ageInfo(g.reading_time);
    const age = escapeHtml(label);
    return `<tr class="${status}">
      <td data-label="River"><a class="river-name" href="${gaugeUrl}" target="_blank" rel="noopener">${name}</a><span class="river-sub">${location}</span></td>
      <td class="location col-location" data-label="Location">${location}</td>
      <td class="flow" data-label="Flow">${flow}</td>
      <td class="cmd" data-label="Text this">${textKey}</td>
      <td class="age${ageCls ? ' ' + ageCls : ''}" data-label="Updated">${age}</td>
    </tr>`;
  }).join('');
}

function updateHeaders() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    th.dataset.dir = th.dataset.col === sortCol ? sortDir : '';
  });
}

async function load() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gauges?select=*`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allRows = await res.json();
    applyFiltersAndSort();

    const fetchedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('refresh-note').textContent = `fetched at ${fetchedAt}`;
  } catch (e) {
    document.getElementById('refresh-note').textContent =
      'Could not load gauge data — try refreshing.';
    document.getElementById('gauge-body').innerHTML =
      `<tr class="message-row"><td colspan="${COLSPAN}">Could not load gauge data. Try refreshing.</td></tr>`;
    console.error(e);
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
