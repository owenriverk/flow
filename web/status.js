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
    el.innerHTML =
      `<p>${channelLine('InReach replies', summary.inreach)}</p>` +
      `<p>${channelLine('Email replies', summary.email)}</p>`;
  } catch (e) {
    console.error(e);
    el.innerHTML =
      '<p class="warn">⚠ Could not load live status. This does not necessarily mean the bot ' +
      'itself is down — the status endpoint may just be unreachable from here. If you need to know ' +
      'right now, the most reliable check is to text a gauge name directly.</p>';
  }
}

loadStatus();
