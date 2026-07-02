// Renders live reply-delivery health on status.html from the Worker's public
// /api/status endpoint (src/worker.ts fetch handler + src/statusTracking.ts).
// Deliberately never falls back to a static "operational" claim — if the fetch
// fails, that's shown as "could not load," not silently treated as good news.

function timeAgo(isoString) {
  if (!isoString) return null;
  const mins = (Date.now() - new Date(isoString).getTime()) / 60000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.floor(mins)} min ago`;
  const hrs = mins / 60;
  if (hrs < 48) return `${Math.floor(hrs)} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

// Renders one nightly self-check line ("last self-check 2 hr ago — gauge
// sweep: ok · email-canary watchdog: ok"). Returns null when the Worker
// hasn't shipped self-check data yet — the page must render fine either way,
// since the Worker and this static page deploy on independent pipelines.
function selfCheckLine(selfCheck) {
  if (!selfCheck || typeof selfCheck !== 'object' || !selfCheck.lastRunAt) return null;
  const names = Object.keys(selfCheck.checks ?? {});
  const parts = names.map((name) => {
    const check = selfCheck.checks[name] ?? {};
    const bad = check.status === 'error' || check.status === 'findings';
    const cls = bad ? 'warn' : 'ok';
    return `<span class="${cls}">${escapeHtml(name)}: ${escapeHtml(check.status ?? '?')}</span>`;
  });
  const anyBad = names.some((name) => {
    const s = (selfCheck.checks[name] ?? {}).status;
    return s === 'error' || s === 'findings';
  });
  const head = anyBad
    ? '<span class="warn">⚠ Self-check</span>'
    : '<span class="ok">● Self-check</span>';
  return `${head}: last ran ${timeAgo(selfCheck.lastRunAt)}${parts.length ? '<br>' + parts.join(' · ') : ''}`;
}

function channelLine(label, channel) {
  const failing = channel.consecutiveFailures > 0;
  if (failing) {
    const since = timeAgo(channel.lastFailureAt) ?? 'recently';
    const detail = channel.lastFailureDetail ? ` — ${escapeHtml(channel.lastFailureDetail)}` : '';
    const successNote = channel.lastSuccessAt
      ? ` Last success ${timeAgo(channel.lastSuccessAt)}.`
      : ' No successful reply recorded yet.';
    const plural = channel.consecutiveFailures === 1 ? '' : 's';
    return (
      `<span class="warn">⚠ ${label}: ${channel.consecutiveFailures} failed attempt${plural} in a row</span><br>` +
      `Last failure ${since}${detail}.${successNote}`
    );
  }
  if (channel.lastSuccessAt) {
    return `<span class="ok">● ${label}: OK</span><br>Last successful reply ${timeAgo(channel.lastSuccessAt)}.`;
  }
  return `<span class="ok">● ${label}: no failures recorded</span><br>No replies sent on this channel yet.`;
}

async function loadStatus() {
  const el = document.getElementById('live-status');
  if (!el) return;
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const summary = await res.json();
    // Defensive by design: the Worker (/api/status) and this static page deploy
    // on independent pipelines, so render whatever channels exist and skip the
    // rest — a shape mismatch must never blank the status page.
    const sections = [];
    const channels = [
      ['InReach replies', summary.inreach],
      ['Email replies', summary.email],
      ['Nightly canary delivery', summary.canary],
    ];
    for (const [label, channel] of channels) {
      if (channel && typeof channel === 'object') {
        // The canary channel is monitor plumbing — only show it once it has data.
        if (label.startsWith('Nightly') && !channel.lastSuccessAt && !channel.lastFailureAt) continue;
        sections.push(`<p>${channelLine(label, channel)}</p>`);
      }
    }
    const self = selfCheckLine(summary.selfCheck);
    if (self) sections.push(`<p>${self}</p>`);
    if (sections.length === 0) throw new Error('status payload had no renderable sections');
    el.innerHTML = sections.join('');
  } catch (e) {
    console.error(e);
    el.innerHTML =
      '<p class="warn">⚠ Could not load live status. This does not necessarily mean the bot ' +
      'itself is down — the status endpoint may just be unreachable from here. If you need to know ' +
      'right now, the most reliable check is to text a gauge name directly.</p>';
  }
}

loadStatus();
