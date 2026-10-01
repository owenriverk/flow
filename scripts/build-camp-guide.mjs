/**
 * Builds a river's camp-by-camp guide page from its data file:
 *
 *   scripts/data/<slug>-camps.json  ->  web/<slug>-camps.html
 *
 * The page is static HTML on purpose (TODOS.md "Campsite guide"): every camp is
 * in the markup, so it reads without JavaScript, prints, and survives being
 * saved for a week with no signal. web/camps.js only adds the filters on top,
 * and web/camp-rail.js the strip map.
 *
 * The data file is the thing to edit — mile, side, capacities and the river's
 * own flags come from the Forest Service list and each camp records its
 * sources (see the _readme block at the top of each JSON). This script
 * computes every count on the page from that data, so the prose can never
 * drift from the list.
 *
 * What differs between rivers lives in scripts/camp-guides/<slug>.mjs: the
 * rules, the "picking camps for your group" lists, the badges and filters.
 * Those are functions of the data rather than text in the JSON, because their
 * numbers are counted from it. This file knows nothing river-specific: water
 * levels come from `levels` in the data (default: low water / high water) and
 * capacities from each camp's `cap` array (or the Main's original lo/hi).
 *
 * The site header and footer are lifted from the river's main guide page
 * (web/<slug>.html) at build time, because headers are still hand-authored per
 * page and a second copy here would be one more place to forget.
 *
 * Run: node scripts/build-camp-guide.mjs [slug ...]      (default: every river with a profile)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import mainSalmon from "./camp-guides/main-salmon.mjs";
import mfSalmon from "./camp-guides/mf-salmon.mjs";

const ROOT = new URL("../", import.meta.url);
const CSS_VERSION = "2026093003";

export const PROFILES = { "main-salmon": mainSalmon, "mf-salmon": mfSalmon };

/** Attribute tags: the label on the chip, in the order chips are shown. */
export const TAGS = {
  sand: "Sand beach",
  bench: "Bench camp",
  shade: "Shade",
  "no-shade": "Little or no shade",
  "easy-landing": "Easy landing",
  "tricky-landing": "Tricky landing",
  carry: "Carry or climb",
  swimming: "Swimming hole",
  "hot-springs": "Hot springs nearby",
  "rock-art": "Pictographs",
  history: "History",
  hiking: "Hiking",
  kids: "Good with kids",
  "poison-ivy": "Poison ivy",
  burned: "Burned",
  traffic: "Visitors, planes or road",
};

const DEFAULT_LEVELS = [{ label: "Low water" }, { label: "High water" }];

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const slugify = (s) => s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Stable id per camp; a repeated name (two Pebble Beaches) gets its mile. */
export function campIds(camps) {
  const counts = new Map();
  for (const c of camps) counts.set(slugify(c.n), (counts.get(slugify(c.n)) ?? 0) + 1);
  return camps.map((c) => {
    const base = slugify(c.n);
    return counts.get(base) > 1 ? `${base}-mile-${String(c.m).replace(".", "-")}` : base;
  });
}

/** Capacities in level order; null means the list gives no number at that level. */
export const caps = (c) => c.cap ?? [c.lo, c.hi];

const people = (n) => (n == null ? "Not listed" : n === 0 ? "No camp" : `${n} people`);
const side = (s) => (s === "L" ? "river left" : s === "R" ? "river right" : "an island mid-river");
const onSide = (s) => (s === "C" ? "on the island" : `on ${side(s)}`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const day = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/**
 * The low/high lines under a description. Capacities are in the strip above,
 * so a line appears only when the extreme levels differ or a note adds something.
 */
function levelLines(c, levels, profile) {
  const cs = caps(c);
  const lo = cs[0];
  const hi = cs[cs.length - 1];
  const low = [];
  const high = [];
  if (lo === 0) low.push(`No camp at ${levels[0].label.toLowerCase()}.`);
  if (c.lowNote) low.push(c.lowNote);
  if (hi === 0) high.push(`No camp. The Forest Service gives it no ${profile.noHighCapacity}.`);
  else if (lo > 0 && hi != null && hi < lo && !c.highNote) high.push(`Room for ${hi}, down from ${lo}.`);
  if (c.highNote) high.push(c.highNote);
  const lines = [];
  if (low.length) lines.push(`<p class="camp-level"><strong>Low water:</strong> ${esc(low.join(" "))}</p>`);
  if (high.length) lines.push(`<p class="camp-level"><strong>High water:</strong> ${esc(high.join(" "))}</p>`);
  return lines;
}

function photoFigure(slug, c) {
  if (!c.photos) return "";
  const shots = ["low", "high"].filter((k) => c.photos[k]);
  if (shots.length === 0) return "";
  const dir = `img/camps/${slug}`;
  const figs = shots.map((k) => {
    const p = c.photos[k];
    const label = k === "low" ? "Low water" : "High water";
    return `        <figure class="camp-photo">
          <img src="${dir}/${esc(p.src)}-720.webp" srcset="${dir}/${esc(p.src)}-720.webp 720w, ${dir}/${esc(p.src)}-1200.webp 1200w" sizes="(min-width: 736px) 344px, calc(100vw - 2rem)" width="720" height="540" alt="${esc(p.alt)}" loading="lazy" decoding="async">
          <figcaption><strong>${label}.</strong> ${esc(p.caption ?? "")} <span class="credit">Photo: ${esc(p.credit)}</span></figcaption>
        </figure>`;
  });
  return `      <div class="camp-photos">\n${figs.join("\n")}\n      </div>\n`;
}

/**
 * The camp's aerial (scripts/build-camp-aerials.mjs), north up. Nothing is drawn
 * on it: a flow arrow was tried and removed at Owen's request (2026-09-30), and
 * there is no marker because positions come from river miles and are only good
 * to a quarter mile. The caption names the bank and says "near the middle".
 */
function aerialFigure(slug, c, aerials) {
  const a = aerials?.camps?.[c.id];
  if (!a) return "";
  const [w, h] = aerials.size;
  const g = aerials.gauge?.name;
  const reading =
    a.ft != null && g
      ? `, ${g} gauge at ${a.ft.toFixed(1)} ft${a.cfs != null ? ` (${a.cfs.toLocaleString("en-US")} cfs)` : ""}`
      : a.cfs != null && g
        ? `, ${g} at ${a.cfs.toLocaleString("en-US")} cfs`
        : "";
  return `      <figure class="camp-aerial">
        <img src="img/camps/${slug}/${esc(a.file)}" width="${w}" height="${h}" alt="Aerial view of the river around mile ${c.m}, where ${esc(c.n)} is ${onSide(c.s)}" loading="lazy" decoding="async">
        <figcaption>From the air, ${day(a.date)}${reading}. North is up. The camp is ${onSide(c.s)}, near the middle of the frame. <span class="credit">USDA NAIP, public domain.</span></figcaption>
      </figure>
`;
}

function campArticle(ctx, c, id) {
  const { slug, levels, profile, aerials } = ctx;
  const cs = caps(c);
  const tags = c.t.map((t) => `<li>${esc(TAGS[t])}</li>`).join("");
  const filterTags = [...c.t, ...(profile.derivedTags?.(c) ?? [])];
  const badges = profile.badges(c).map((b) => `<span class="camp-badge ${b.cls}">${esc(b.label)}</span>`).join("");
  const conflict = c.conflict ? `\n      <p class="camp-conflict"><strong>Sources disagree:</strong> ${esc(c.conflict)}</p>` : "";
  const cells = cs
    .map((v, i) => {
      const cls = v === 0 ? " none" : v == null ? " unknown" : "";
      return `        <div class="camp-cap-cell${cls}" data-i="${i}"><dt>${esc(levels[i].label)}</dt><dd>${people(v)}</dd></div>`;
    })
    .join("\n");
  return `    <article class="camp" id="${id}" data-mile="${c.m}" data-side="${c.s}" data-cap="${cs.map((v) => (v == null ? "-" : v)).join(" ")}" data-types="${profile.types(c).join(" ")}" data-glyph="${profile.glyph(c)}" data-tags="${filterTags.join(" ")}">
      <div class="camp-top"><span class="camp-mile">Mile ${c.m} · ${side(c.s)}</span><span class="camp-badges">${badges}</span></div>
      <h3>${esc(c.n)}</h3>
      <dl class="camp-cap">
${cells}
      </dl>
      <p>${esc(c.d)}</p>
${levelLines(c, levels, profile).map((l) => `      ${l}`).join("\n")}${conflict}
${aerialFigure(slug, { ...c, id }, aerials)}${photoFigure(slug, c)}      ${tags ? `<ul class="camp-tags">${tags}</ul>` : ""}
      <p class="camp-fs">${profile.fsLine(c, ctx)}</p>
    </article>`.replace(/\n\s*\n/g, "\n");
}

/** Pull one top-level block (the site header or footer) out of a sibling page. */
function shellBlock(html, tag) {
  const m = html.match(new RegExp(`<${tag} class="site-${tag}">[\\s\\S]*?</${tag}>`));
  if (!m) throw new Error(`no <${tag} class="site-${tag}"> in the shell page`);
  return m[0];
}

/** Everything a profile function may need, computed once from the data. */
function context(data, aerials, profile) {
  const { camps } = data;
  const ids = campIds(camps);
  const levels = data.levels ?? DEFAULT_LEVELS;
  const cap = (c, i) => caps(c)[i];
  const count = (pick) => camps.filter(pick).length;
  const links = (pick) =>
    camps
      .map((c, i) => [c, ids[i]])
      .filter(([c]) => pick(c))
      .map(([c, id]) => `<a href="#${id}">${esc(c.n)}</a> <span class="camp-at">${c.m}</span>`)
      .join(", ");
  const flights = Object.values(aerials?.camps ?? {});
  return {
    ...data,
    data,
    profile,
    aerials,
    ids,
    levels,
    lastLevel: levels.length - 1,
    n: camps.length,
    cap,
    count,
    links,
    has: (tag) => (c) => c.t.includes(tag),
    esc,
    day,
    flown: [...new Set(flights.map((a) => a.date))].sort(),
    cfs: flights.map((a) => a.cfs).filter((v) => v != null),
    ft: flights.map((a) => a.ft).filter((v) => v != null),
    gaugeName: aerials?.gauge?.name ?? "",
  };
}

export function render(data, shellHtml, aerials = null) {
  const profile = PROFILES[data.slug];
  if (!profile) throw new Error(`no profile for ${data.slug} in scripts/camp-guides/`);
  const ctx = context(data, aerials, profile);
  const { camps, slug, river, sections, source, checked, ids, n, levels, count } = ctx;
  for (const c of camps) {
    if (caps(c).length !== levels.length) throw new Error(`${c.n}: ${caps(c).length} capacities for ${levels.length} levels`);
    for (const t of c.t) if (!TAGS[t]) throw new Error(`${c.n}: unknown tag ${t}`);
  }
  const first = camps[0].m;
  const last = camps[n - 1].m;

  const sectionHtml = sections
    .map((s) => {
      const inSection = camps.map((c, i) => [c, ids[i]]).filter(([c]) => c.m >= s.from && c.m < s.to);
      return `    <section class="camp-section" id="${s.id}">
    <h2>${esc(s.title)} <span class="camp-range">miles ${inSection[0][0].m}&ndash;${inSection[inSection.length - 1][0].m} · ${inSection.length} camps</span></h2>
    <p>${esc(s.blurb)}</p>
${inSection.map(([c, id]) => campArticle(ctx, c, id)).join("\n")}
    </section>`;
    })
    .join("\n\n");

  const placed = sections.reduce((sum, s) => sum + count((c) => c.m >= s.from && c.m < s.to), 0);
  if (placed !== n) throw new Error(`${n - placed} camps fall outside every section`);

  const title = `${river} Camps — All ${n} by Mile, Size &amp; Water Level | LateBoof`;
  const description = profile.description(ctx);
  const url = `https://lateboof.com/${slug}-camps`;
  const breadcrumb = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "LateBoof", item: "https://lateboof.com/" },
      { "@type": "ListItem", position: 2, name: river, item: `https://lateboof.com/${slug}` },
      { "@type": "ListItem", position: 3, name: "Camps", item: url },
    ],
  });
  // A live "today's level" line, for rivers whose list is rated in gauge feet.
  const liveLevels = data.gauge?.key && levels.every((l) => l.ft != null);
  const live = liveLevels
    ? `\n      <p class="camp-live" id="camp-live" data-gauge-key="${esc(data.gauge.key)}" data-gauge-name="${esc(data.gauge.name)}" data-levels-ft="${levels.map((l) => l.ft).join(",")}" hidden></p>`
    : "";
  const anchors = (data.anchors ?? []).filter((a) => a.mark).map((a) => ({ mile: a.mile, mark: a.mark }));

  return `<!DOCTYPE html>
<!-- Generated by scripts/build-camp-guide.mjs from scripts/data/${slug}-camps.json — edit the data, not this file. -->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${url}">
  <script type="application/ld+json">${breadcrumb}</script>
  <meta property="og:title" content="${river} Camps — All ${n} by Mile, Size &amp; Water Level">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:site_name" content="LateBoof">
  <meta property="og:type" content="website">
  <meta property="og:image" content="https://lateboof.com/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="style.css?v=${CSS_VERSION}">
  <link rel="stylesheet" href="river.css?v=${CSS_VERSION}">
  <link rel="stylesheet" href="river-rail.css?v=${CSS_VERSION}">
</head>
<body>
  ${shellBlock(shellHtml, "header")}

  <div class="river-wrap camp-wrap">
  <div class="river-page camp-guide" data-level="any">
    <div class="river-head">
      <span class="river-kicker">Camp guide · <a href="/${slug}">${river}</a>, ${profile.wilderness}</span>
      <h1>${river} camps</h1>
      <span class="river-where">${n} named camps, ${profile.span} · river miles ${first}&ndash;${last}</span>
    </div>

    <dl class="river-facts">
${profile
  .facts(ctx)
  .map(([dt, dd]) => `      <div><dt>${dt}</dt><dd>${dd}</dd></div>`)
  .join("\n")}
    </dl>

    <div class="river-body">
    <nav class="river-toc" aria-label="On this page">
      On this page:
      <a href="#read">How to read it</a> ·
      <a href="#rules">Requesting camps</a> ·
      <a href="#groups">By group</a> ·
      <a href="#find">Find a camp</a> ·
${sections.map((s) => `      <a href="#${s.id}">${esc(s.title)}</a> ·`).join("\n")}
      <a href="#photos">Photos</a> ·
      <a href="#sources">Sources</a>
    </nav>

    <h2 id="read">How to read this</h2>
${profile.read(ctx)}

    <h2 id="rules">${profile.rulesTitle}</h2>
${profile.rules(ctx)}

    <h2 id="groups">Picking camps for your group</h2>
    <dl class="river-list">
${profile.groups(ctx)}
    </dl>

    <h2 id="find">Find a camp</h2>
    <div class="camp-filters" id="camp-filters" hidden>${live}
      <div class="camp-filter">
        <span class="camp-filter-label" id="level-label">Water level</span>
        <div class="status-btns" role="group" aria-labelledby="level-label">
          <button type="button" class="status-btn active" data-level="any" aria-pressed="true">Any</button>
${levels.map((l, i) => `          <button type="button" class="status-btn" data-level="${i}" data-label="${esc(l.label.toLowerCase())}" aria-pressed="false">${esc(l.label)}</button>`).join("\n")}
        </div>
      </div>
      <div class="camp-filter">
        <label class="camp-filter-label" for="camp-size">Group size</label>
        <input type="number" id="camp-size" class="search-input camp-size" min="1" max="30" inputmode="numeric" placeholder="people">
      </div>
      <div class="camp-filter">
        <span class="camp-filter-label" id="type-label">Type</span>
        <div class="status-btns" role="group" aria-labelledby="type-label">
${profile.typeFilter.map(([v, label], i) => `          <button type="button" class="status-btn${i === 0 ? " active" : ""}" data-type="${v}" aria-pressed="${i === 0}">${esc(label)}</button>`).join("\n")}
        </div>
      </div>
      <div class="camp-filter camp-filter-wide">
        <span class="camp-filter-label" id="want-label">Must have</span>
        <div class="camp-chips" role="group" aria-labelledby="want-label">
${profile.chips.map(([key, label, tags]) => `          <button type="button" class="camp-chip" data-want="${tags.join(" ")}" data-key="${key}" aria-pressed="false">${esc(label)}</button>`).join("\n")}
        </div>
      </div>
      <p class="camp-count"><span id="camp-count" role="status" aria-live="polite">Showing all ${n} camps.</span> <button type="button" class="camp-reset" id="camp-reset" hidden>Clear filters</button></p>
    </div>
    <noscript><p>The filters need JavaScript. Every camp is listed below without it.</p></noscript>
    <p class="camp-empty" id="camp-empty" hidden>No camp matches all of that. Loosen a filter.</p>

${sectionHtml}

    <h2 id="photos">The aerials, and the photos still missing</h2>
    <p>
      Every camp has an aerial from the USDA&rsquo;s National Agriculture
      Imagery Program, which is public domain.${profile.aerialSummary(ctx)} Each frame is
      ${aerials ? aerials.frameKm[0] : "about a"} km across with north at the
      top. The Forest Service publishes river miles, not coordinates, so a
      frame is centred on the camp&rsquo;s mile along the river&rsquo;s mapped
      centerline, which is good to about a quarter mile: the camp is in the
      picture, near the middle, on the bank the entry names.
    </p>
    <p>
      What an aerial cannot show is the camp from the boat, or the same beach
      at high water. Nobody publishes ground photos of these camps that can be
      reused, so each entry has room for a low-water and a high-water
      photograph, and they are empty.
    </p>
    <aside class="river-tip">
      <strong>Send one in.</strong> If you have a photo of a named camp, email it
      to <a href="mailto:owen@lateboof.com?subject=${encodeURIComponent(`${river} camp photo`)}">owen@lateboof.com</a>
      with the camp name, the date, and the flow if you know it. The same camp
      at two different levels is the most useful thing you can send. Corrections
      to anything on this page go to the same address.
    </aside>

    <h2 id="sources">Sources and what this is not</h2>
    <p>
      ${profile.sourcesFs(ctx)} Camp names are
      spelled as that list spells them, because that is what the request form
      uses. The descriptions are LateBoof&rsquo;s own wording; details beyond
      the Forest Service list were checked against
      <a href="${source.gr.url}">${esc(source.gr.label)}</a>, and where the two
      disagree the Forest Service figure is used and the camp says so.
    </p>
    <p>
      Nothing here comes from a LateBoof trip yet. Beaches move, creeks blow
      out, and camps burn; a description is a starting point for a
      conversation with someone who was there last season, not a promise.
      Checked ${checked}.
    </p>

    <div class="river-related">
      <h2>More on the ${river}</h2>
      <p>
        <a href="/${slug}">${river} river guide</a>: live flow, the shuttle,
        permits and take-outs. ·
        <a href="/rivers">All river guides</a>
      </p>
    </div>
    </div>
  </div>

    <aside class="river-side camp-rail" aria-hidden="true" data-camp-rail="/${slug}-data.js" data-landmarks="${esc(JSON.stringify(data.landmarks ?? []))}" data-anchors="${esc(JSON.stringify(anchors))}">
      <div class="river-side__head">Camps down the river<span data-rail-now>Mile 0</span></div>
      <div class="river-map camp-rail__map" data-rail-map>
        <svg class="camp-rail__svg" data-rail-svg>
          <g data-rail-pan>
            <path class="river-map__bed" data-bed d=""/>
            <path class="river-map__flow" data-flow d=""/>
            <g data-miles></g>
            <g data-camps></g>
            <g class="river-map__boat" data-boat><path d="M-9 0 L-3 -3 L9 0 L-3 3 Z"/></g>
          </g>
        </svg>
      </div>
      <div class="river-side__foot">${profile.legend} River left is on the right: the map looks downstream. Miles are true, bends are flattened.</div>
    </aside>
  </div>

  ${shellBlock(shellHtml, "footer")}

  <script type="module" src="camps.js?v=${CSS_VERSION}"></script>
  <script type="module" src="camp-rail.js?v=${CSS_VERSION}"></script>
</body>
</html>
`;
}

export function build(slug) {
  const data = JSON.parse(readFileSync(new URL(`scripts/data/${slug}-camps.json`, ROOT), "utf8"));
  const shell = readFileSync(new URL(`web/${slug}.html`, ROOT), "utf8");
  const aerialsUrl = new URL(`scripts/data/${slug}-aerials.json`, ROOT);
  const aerials = existsSync(aerialsUrl) ? JSON.parse(readFileSync(aerialsUrl, "utf8")) : null;
  return { data, aerials, html: render(data, shell, aerials) };
}

/** Aerial files the manifest names but web/img/camps/ does not have. */
export function missingAerials(slug, aerials) {
  return Object.values(aerials?.camps ?? {})
    .map((a) => a.file)
    .filter((file) => !existsSync(new URL(`web/img/camps/${slug}/${file}`, ROOT)));
}

/** The page as it currently sits in web/ — test/campGuide.test.ts checks it is not stale. */
export function onDisk(slug) {
  return readFileSync(new URL(`web/${slug}-camps.html`, ROOT), "utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const slugs = process.argv.slice(2);
  for (const slug of slugs.length ? slugs : Object.keys(PROFILES)) {
    const { data, html } = build(slug);
    writeFileSync(new URL(`web/${slug}-camps.html`, ROOT), html);
    console.log(`web/${slug}-camps.html — ${data.camps.length} camps, ${(html.length / 1024).toFixed(0)} KB`);
  }
}
