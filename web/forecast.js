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
// The nightly build renders the strip from the last complete gauge day; this
// overwrites the reading, trend, and timestamp from the same 15-minute
// Supabase row the gauge directory uses. Contract with build_mock.gauge_strip:
//   [data-live-gauge] — gauge key; absent on the pinned time-travel mocks
//   [data-q]/[data-low] — the window thresholds (550 / 300 for the Stikine)
//   [data-tail-mode] — "threshold" tails are pure functions of the reading
//     and are recomputed live; "countdown" (a model output) and "prefreshet"
//     (season logic) are NEVER touched client-side.
// Every failure path leaves the built strip exactly as rendered — the nightly
// values are the fallback, never a blank.
const STRIP_SUPABASE = 'https://vfkoegvzllxvshcnfbox.supabase.co';
const STRIP_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZma29lZ3Z6bGx4dnNoY25mYm94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NzE1MTcsImV4cCI6MjA5ODI0NzUxN30.PdQ8fbjVE0s8LoTED5WHyb1zx8WU-X3QqO4td9XBHqo';
const STRIP_TREND_THRESHOLD = 0.02; // match gauges.js — jitter never flips the arrow

async function refreshLiveStrip() {
  const strip = document.querySelector('[data-live-gauge]');
  if (!strip) return;
  try {
    const key = strip.dataset.liveGauge;
    const res = await fetch(
      `${STRIP_SUPABASE}/rest/v1/gauges?select=discharge,baseline_discharge,reading_time&key=eq.${encodeURIComponent(key)}`,
      { headers: { apikey: STRIP_ANON, Authorization: `Bearer ${STRIP_ANON}` } },
    );
    if (!res.ok) return;
    const [g] = await res.json();
    if (!g || g.discharge == null || !g.reading_time) return;
    // If the live row itself is stale (source outage), keep the built strip —
    // its "gauge stale" warning is more honest than a confident old number.
    const ageMs = Date.now() - new Date(g.reading_time).getTime();
    if (!Number.isFinite(ageMs) || ageMs > 48 * 3600e3) return;

    const v = Number(g.discharge);
    const val = strip.querySelector('.gval');
    if (val) val.textContent = Math.round(v).toLocaleString('en-US');

    const trend = strip.querySelector('.gtrend');
    if (trend && g.baseline_discharge) {
      const pct = (v - g.baseline_discharge) / g.baseline_discharge;
      if (Math.abs(pct) >= STRIP_TREND_THRESHOLD) {
        trend.textContent = pct > 0 ? '↑ rising' : '↓ falling';
      }
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
  } catch {
    // network hiccup — the built strip stands
  }
}

refreshLiveStrip();
setInterval(refreshLiveStrip, 10 * 60 * 1000);
