const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const ANON_KEY = 'YOUR_ANON_KEY';
const REFRESH_MS = 10 * 60 * 1000; // re-fetch every 10 min

function ageLabel(isoString) {
  if (!isoString) return '—';
  const mins = Math.floor((Date.now() - new Date(isoString).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h === 1 ? '1 hr ago' : `${h} hr ago`;
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

async function load() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gauges?select=*&order=name.asc`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    render(rows);
  } catch (e) {
    document.getElementById('refresh-note').textContent =
      'Could not load gauge data — try refreshing.';
    console.error(e);
  }
}

function render(rows) {
  const tbody = document.getElementById('gauge-body');
  tbody.innerHTML = rows
    .map(
      (g) => `<tr class="${rowClass(g)}">
        <td><a href="${g.gauge_url}" target="_blank" rel="noopener">${g.name}</a></td>
        <td>${g.location}</td>
        <td class="flow">${flowText(g)}</td>
        <td class="cmd">${g.text_key}</td>
        <td class="age">${ageLabel(g.reading_time)}</td>
      </tr>`,
    )
    .join('');

  const fetchedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  document.getElementById('refresh-note').textContent =
    `Gauge data refreshes every 15 min · fetched at ${fetchedAt}`;
}

load();
setInterval(load, REFRESH_MS);
