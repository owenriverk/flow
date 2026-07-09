// Oracle signup: submit inline, swap the row for the verdict. Without JS the
// form still POSTs to /api/subscribe and gets a plain confirmation page.
document.querySelectorAll('form.signup-row').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button');
    const email = form.querySelector('input[type="email"]').value;
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email }),
      });
      const { ok, message } = await res.json();
      if (ok) {
        form.outerHTML = `<div class="signup-done">${message}</div>`;
      } else {
        button.disabled = false;
        button.textContent = form.dataset.cta;
        showNote(form, message);
      }
    } catch {
      button.disabled = false;
      button.textContent = form.dataset.cta;
      showNote(form, 'Signup hiccuped — try again in a minute.');
    }
  });
});

function showNote(form, message) {
  let note = form.querySelector('.signup-err');
  if (!note) {
    note = document.createElement('span');
    note.className = 'signup-err';
    form.appendChild(note);
  }
  note.textContent = message;
}

// --- Live gauge strip (forecast-stikine) ---------------------------------
// The nightly build renders the strip from the last complete gauge day; the
// browser then overwrites reading, trend, and timestamp with a fresher one.
// Primary source is Environment Canada GeoMet realtime (5-minute readings — the
// same live feed the basin-instruments planner uses), so the number is truly
// live, not a day-old snapshot. If GeoMet is unreachable we fall back to the
// 15-minute Supabase mirror the gauge directory uses; if that fails too, the
// built values stand (never a blank). Contract with build_mock.gauge_strip:
//   [data-live-gauge] — gauge key; absent on the pinned time-travel mocks
//   [data-q]/[data-low] — the window thresholds (550 / 300 for the Stikine)
//   [data-tail-mode] — "threshold" tails are pure functions of the reading
//     and are recomputed live; "countdown" (a model output) and "prefreshet"
//     (season logic) are NEVER touched client-side.
// The 30-day sparkline is a nightly daily chart, left as built on purpose — it
// lags a day and that is fine.
const STRIP_SUPABASE = 'https://vfkoegvzllxvshcnfbox.supabase.co';
const STRIP_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZma29lZ3Z6bGx4dnNoY25mYm94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NzE1MTcsImV4cCI6MjA5ODI0NzUxN30.PdQ8fbjVE0s8LoTED5WHyb1zx8WU-X3QqO4td9XBHqo';
const STRIP_TREND_THRESHOLD = 0.02; // match gauges.js — jitter never flips the arrow
const STRIP_STALE_MS = 48 * 3600e3;
// Which Environment Canada (WSC) station backs each live strip.
const STRIP_STATION = { stikine: '08CE001' };
const GEOMET = 'https://api.weather.gc.ca/collections/hydrometric-realtime/items';

// Paint one reading into the strip. ageMs drives the "· live" stamp; pct (a
// fraction, or null) drives the trend arrow; the threshold tail recomputes only
// when the build marked it recomputable — countdown/prefreshet stay frozen.
function paintStrip(strip, v, ageMs, pct) {
  const val = strip.querySelector('.gval');
  if (val) val.textContent = Math.round(v).toLocaleString('en-US');

  const trend = strip.querySelector('.gtrend');
  if (trend && pct != null && Math.abs(pct) >= STRIP_TREND_THRESHOLD) {
    trend.textContent = pct > 0 ? '↑ rising' : '↓ falling';
  }

  const tail = strip.querySelector('.gtail');
  const q = Number(strip.dataset.q);
  const low = Number(strip.dataset.low);
  if (tail && strip.dataset.tailMode === 'threshold' && q) {
    if (low && v < low) {
      tail.textContent = `under ${low} — too low, done for the year`;
      tail.className = 'gtail';
    } else if (v <= q) {
      tail.textContent = `under ${q} — open`;
      tail.className = 'gtail ok';
    } else {
      tail.textContent = `${(v / q).toFixed(1)}× the ${q} line`;
      tail.className = 'gtail';
    }
  }

  const when = strip.querySelector('.gwhen');
  if (when) {
    const mins = Math.floor(ageMs / 60000);
    const label = mins < 60 ? `${Math.max(1, mins)} min ago` : `${Math.floor(mins / 60)} hr ago`;
    when.textContent = `gauge ${label} · live`;
    when.classList.remove('miss');
  }
}

// Primary: Environment Canada GeoMet realtime. DESCENDING sort so a 5-minute
// station doesn't hand back the oldest rows under the limit and read a
// mid-window value as "now" (that bug bit both the build pull and this strip).
async function liveFromGeoMet(strip, sid) {
  const url = `${GEOMET}?STATION_NUMBER=${sid}&properties=DATETIME,DISCHARGE&sortby=-DATETIME&limit=500&f=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('geomet');
  const j = await res.json();
  const rows = (j.features || []).map((x) => x.properties).filter((p) => p.DISCHARGE != null);
  if (!rows.length) throw new Error('empty');
  const newestMs = new Date(rows[0].DATETIME).getTime();
  const ageMs = Date.now() - newestMs;
  if (!Number.isFinite(ageMs) || ageMs > STRIP_STALE_MS) throw new Error('stale');
  const v = Number(rows[0].DISCHARGE);
  // Trend off a ~24h-old baseline (same time of day) — a 6-12h window would
  // read the diurnal melt cycle, not the day-over-day move paddlers ask about.
  const cutMs = newestMs - 24 * 3600e3;
  let prior = null;
  for (const p of rows) {
    if (new Date(p.DATETIME).getTime() <= cutMs) { prior = Number(p.DISCHARGE); break; }
  }
  if (prior == null) prior = Number(rows[rows.length - 1].DISCHARGE);
  paintStrip(strip, v, ageMs, prior ? (v - prior) / prior : null);
}

// Fallback: the 15-minute Supabase mirror (the row the gauge directory uses).
async function liveFromSupabase(strip, key) {
  const res = await fetch(
    `${STRIP_SUPABASE}/rest/v1/gauges?select=discharge,baseline_discharge,reading_time&key=eq.${encodeURIComponent(key)}`,
    { headers: { apikey: STRIP_ANON, Authorization: `Bearer ${STRIP_ANON}` } },
  );
  if (!res.ok) throw new Error('supabase');
  const [g] = await res.json();
  if (!g || g.discharge == null || !g.reading_time) throw new Error('empty');
  const ageMs = Date.now() - new Date(g.reading_time).getTime();
  if (!Number.isFinite(ageMs) || ageMs > STRIP_STALE_MS) throw new Error('stale');
  const v = Number(g.discharge);
  const pct = g.baseline_discharge ? (v - g.baseline_discharge) / g.baseline_discharge : null;
  paintStrip(strip, v, ageMs, pct);
}

async function refreshLiveStrip() {
  const strip = document.querySelector('[data-live-gauge]');
  if (!strip) return;
  const key = strip.dataset.liveGauge;
  const sid = STRIP_STATION[key];
  try {
    if (sid) await liveFromGeoMet(strip, sid); // realtime, matches the planner
    else await liveFromSupabase(strip, key);
  } catch {
    // GeoMet down/stale — try the Supabase mirror; if that fails too, the built
    // values stand (never a blank).
    try {
      await liveFromSupabase(strip, key);
    } catch {
      /* built values stand */
    }
  }
}

refreshLiveStrip();
setInterval(refreshLiveStrip, 10 * 60 * 1000);
