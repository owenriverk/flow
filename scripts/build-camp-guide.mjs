/**
 * Builds a river's camp-by-camp guide page from its data file:
 *
 *   scripts/data/<slug>-camps.json  ->  web/<slug>-camps.html
 *
 * The page is static HTML on purpose (TODOS.md "Campsite guide"): every camp is
 * in the markup, so it reads without JavaScript, prints, and survives being
 * saved for a week with no signal. web/camps.js only adds the filters on top.
 *
 * The data file is the thing to edit — mile, side, capacities and reservable
 * status come from the Forest Service list and each camp records its sources
 * (see the _readme block at the top of the JSON). This script computes every
 * count on the page from that data, so the prose can never drift from the list.
 *
 * The site header and footer are lifted from the river's main guide page
 * (web/<slug>.html) at build time, because headers are still hand-authored per
 * page and a second copy here would be one more place to forget.
 *
 * The "requesting camps" and "picking camps for your group" prose in render()
 * is the Main Salmon's. When the Middle Fork guide arrives, move those two
 * blocks into the data file rather than branching on the slug here.
 *
 * Run: node scripts/build-camp-guide.mjs [slug ...]      (default: main-salmon)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const CSS_VERSION = "2026093002";

/** Attribute tags: the label on the chip, in the order chips are shown. */
export const TAGS = {
  sand: "Sand beach",
  bench: "Bench camp",
  shade: "Shade",
  "no-shade": "Little or no shade",
  "easy-landing": "Easy landing",
  "tricky-landing": "Tricky landing",
  carry: "Carry or climb",
  "hot-springs": "Hot springs",
  "rock-art": "Pictographs",
  history: "History",
  hiking: "Hiking",
  kids: "Good with kids",
  "poison-ivy": "Poison ivy",
  burned: "Burned",
  traffic: "Planes, boats or road",
};

/** The "good for" filter chips: label -> tags that satisfy it (any of). */
export const FILTERS = [
  ["shade", "Shade", ["shade"]],
  ["easy", "Easy landing", ["easy-landing"]],
  ["sand", "Sand beach", ["sand"]],
  ["springs", "Hot springs", ["hot-springs"]],
  ["history", "History & pictographs", ["history", "rock-art"]],
  ["hiking", "Hiking", ["hiking"]],
];

const RES_LABEL = { L: "Large reservable", S: "Small-medium reservable" };

const esc = (s) =>
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

const people = (n) => (n === 0 ? "No camp" : `${n} people`);
const side = (s) => (s === "L" ? "river left" : "river right");

/**
 * The low/high lines under a description. Capacities are in the strip above,
 * so a line appears only when the two levels differ or a note adds something.
 */
function levelLines(c) {
  const lines = [];
  const low = [];
  const high = [];
  if (c.lo === 0) low.push("No camp at low water.");
  if (c.lowNote) low.push(c.lowNote);
  if (c.hi === 0) high.push("No camp. The Forest Service gives it no high-water capacity.");
  else if (c.lo > 0 && c.hi < c.lo && !c.highNote) high.push(`Room for ${c.hi}, down from ${c.lo}.`);
  if (c.highNote) high.push(c.highNote);
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

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
  const flow = a.cfs != null && aerials.gauge ? `, ${aerials.gauge.name} at ${a.cfs.toLocaleString("en-US")} cfs` : "";
  return `      <figure class="camp-aerial">
        <img src="img/camps/${slug}/${esc(a.file)}" width="${w}" height="${h}" alt="Aerial view of the river around mile ${c.m}, where ${esc(c.n)} is on ${side(c.s)}" loading="lazy" decoding="async">
        <figcaption>From the air, ${day(a.date)}${flow}. North is up. The camp is on ${side(c.s)}, near the middle of the frame. <span class="credit">USDA NAIP, public domain.</span></figcaption>
      </figure>
`;
}

function campArticle(slug, c, id, aerials) {
  const tags = c.t.map((t) => `<li>${esc(TAGS[t])}</li>`).join("");
  const res = c.r
    ? `<span class="camp-res camp-res-${c.r}">${RES_LABEL[c.r]}</span>`
    : `<span class="camp-res">First-come</span>`;
  const conflict = c.conflict ? `\n      <p class="camp-conflict"><strong>Sources disagree:</strong> ${esc(c.conflict)}</p>` : "";
  return `    <article class="camp" id="${id}" data-mile="${c.m}" data-side="${c.s}" data-lo="${c.lo}" data-hi="${c.hi}" data-res="${c.r ?? "F"}" data-tags="${c.t.join(" ")}">
      <div class="camp-top"><span class="camp-mile">Mile ${c.m} · ${side(c.s)}</span>${res}</div>
      <h3>${esc(c.n)}</h3>
      <dl class="camp-cap">
        <div class="camp-cap-lo${c.lo === 0 ? " none" : ""}"><dt>Low water</dt><dd>${people(c.lo)}</dd></div>
        <div class="camp-cap-hi${c.hi === 0 ? " none" : ""}"><dt>High water</dt><dd>${people(c.hi)}</dd></div>
      </dl>
      <p>${esc(c.d)}</p>
${levelLines(c).map((l) => `      ${l}`).join("\n")}${conflict}
${aerialFigure(slug, { ...c, id }, aerials)}${photoFigure(slug, c)}      ${tags ? `<ul class="camp-tags">${tags}</ul>` : ""}
      <p class="camp-fs">Forest Service note: &ldquo;${esc(c.fs)}&rdquo;</p>
    </article>`.replace(/\n\s*\n/g, "\n");
}

/** Linked, comma-separated camp names for the "picking camps" lists. */
function linkList(camps, ids, pick) {
  const out = camps.map((c, i) => [c, ids[i]]).filter(([c]) => pick(c));
  return out.map(([c, id]) => `<a href="#${id}">${esc(c.n)}</a> <span class="camp-at">${c.m}</span>`).join(", ");
}

/** Pull one top-level block (the site header or footer) out of a sibling page. */
function shellBlock(html, tag) {
  const m = html.match(new RegExp(`<${tag} class="site-${tag}">[\\s\\S]*?</${tag}>`));
  if (!m) throw new Error(`no <${tag} class="site-${tag}"> in the shell page`);
  return m[0];
}

export function render(data, shellHtml, aerials = null) {
  const { camps, slug, river, sections, source, checked } = data;
  const ids = campIds(camps);
  const n = camps.length;
  const count = (pick) => camps.filter(pick).length;
  const large = count((c) => c.r === "L");
  const small = count((c) => c.r === "S");
  const lowOnly = count((c) => c.hi === 0);
  const highOk = count((c) => c.hi > 0);
  const shrink = count((c) => c.hi > 0 && c.hi < c.lo);
  const highOnly = count((c) => c.lo === 0);
  const tiny = count((c) => Math.max(c.lo, c.hi) <= 10);
  const full = count((c) => c.lo >= 30);
  const fullHigh = count((c) => c.hi >= 30);
  const has = (t) => (c) => c.t.includes(t);
  const flown = aerials ? [...new Set(Object.values(aerials.camps).map((a) => a.date))].sort() : [];
  const cfs = aerials ? Object.values(aerials.camps).map((a) => a.cfs).filter((v) => v != null) : [];
  const aerialNote =
    flown.length && cfs.length && aerials.gauge
      ? ` These were flown between ${day(flown[0])} and ${day(flown[flown.length - 1])}, with the river at ${Math.min(...cfs).toLocaleString("en-US")}&ndash;${Math.max(...cfs).toLocaleString("en-US")} cfs at ${aerials.gauge.name}: very low water, so they show the beaches at close to their largest.`
      : "";
  const first = camps[0].m;
  const last = camps[n - 1].m;

  const sectionHtml = sections
    .map((s) => {
      const inSection = camps.map((c, i) => [c, ids[i]]).filter(([c]) => c.m >= s.from && c.m < s.to);
      return `    <section class="camp-section" id="${s.id}">
    <h2>${esc(s.title)} <span class="camp-range">miles ${inSection[0][0].m}&ndash;${inSection[inSection.length - 1][0].m} · ${inSection.length} camps</span></h2>
    <p>${esc(s.blurb)}</p>
${inSection.map(([c, id]) => campArticle(slug, c, id, aerials)).join("\n")}
    </section>`;
    })
    .join("\n\n");

  const placed = sections.reduce((sum, s) => sum + count((c) => c.m >= s.from && c.m < s.to), 0);
  if (placed !== n) throw new Error(`${n - placed} camps fall outside every section`);

  const title = `${river} Camps — All ${n} by Mile, Size &amp; Water Level | LateBoof`;
  const description = `Every named camp on the ${river}, Corn Creek to Long Tom Bar: river mile, side, how many people it holds at low and at high water, which ${large + small} are reservable, and what each is like. Filter by group size and water level.`;
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
      <span class="river-kicker">Camp guide · <a href="/${slug}">${river}</a>, Frank Church&ndash;River of No Return Wilderness</span>
      <h1>${river} camps</h1>
      <span class="river-where">${n} named camps, Corn Creek to Long Tom Bar · river miles ${first}&ndash;${last}</span>
    </div>

    <dl class="river-facts">
      <div><dt>Camps</dt><dd>${n} named, ${large + small} reservable</dd></div>
      <div><dt>Reservable</dt><dd>${large} large, ${small} small-medium</dd></div>
      <div><dt>At high water</dt><dd>${highOk} usable, ${lowOnly} gone</dd></div>
      <div><dt>Camp requests</dt><dd>Emailed form, 14 days before launch</dd></div>
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
    <p>
      Every camp below carries two numbers from the Forest Service list: how
      many people it holds at <strong>low water</strong> and how many at
      <strong>high water</strong>. They are often different, and that
      difference is the most useful thing on this page. ${lowOnly} of the
      ${n} camps are beaches that do not exist at high water. ${shrink} more
      shrink.${highOnly ? ` ${highOnly === 1 ? "One exists" : `${highOnly} exist`} only at high water.` : ""}
    </p>
    <p>
      The capacities are limits, not suggestions. A group may not use a camp
      that is rated for fewer people than it has, so a party of 12 cannot take
      a 10-person beach, reserved or not.
    </p>
    <p>
      The list does not say what flow separates low from high. Treat the June
      runoff as high water and expect the low-water beaches to come out as the
      river drops through July. If you launch early, or the year is a big one,
      plan on the high-water numbers and check
      <a href="/${slug}">today&rsquo;s flow</a> before you fill in a request.
    </p>

    <h2 id="rules">Requesting reserved camps</h2>
    <p>
      The Forest Service now assigns reservable camps ahead of time, by
      email, not at the Corn Creek launch. For launches from June 15 through
      September 7 the River Office emails the permit holder a camp request
      form 14 days before the launch date.
    </p>
    <ul>
      <li>Submit the form at least 7 days before launch. It can be submitted once. Miss it and you get no reservable camps.</li>
      <li>A permit can hold at most 5 reservable camps.</li>
      <li>Groups of fewer than 21 on a 7- or 8-day trip may not reserve large camps. On a trip of 6 days or fewer they may ask, but groups of 21 or more are assigned large camps first.</li>
      <li>No layovers in a reservable camp, and you must be in the camp on the date printed on the permit.</li>
      <li>Be in a reserved camp by 7 PM Mountain time and out by noon. After 7 PM an empty reservable camp is open to anyone.</li>
      <li>Reserved camps are final once the permit is issued, which happens by email 5 or 6 days before launch.</li>
      <li>Everything not marked reservable is first-come.</li>
    </ul>
    <p>
      Trip length follows group size during the control season: up to 8 days
      for 1&ndash;10 people, 7 days for 11&ndash;20, and 6 days for
      21&ndash;30. Rules change; the
      <a href="${source.fsRules.url}">Salmon-Challis National Forest page</a>
      is the authority, and this summary was checked against it on ${checked}.
    </p>

    <h2 id="groups">Picking camps for your group</h2>
    <dl class="river-list">
      <dt>Groups of 21 to 30</dt>
      <dd>Only the 30-person camps are open to you: ${full} at low water, ${fullHigh} at high. Large reservable camps that hold 30 at any level: ${linkList(camps, ids, (c) => c.r === "L" && c.hi >= 30)}.</dd>
      <dt>Groups of 10 or fewer</dt>
      <dd>${tiny} camps are capped at 10 people, so no larger group can take them. The reservable ones: ${linkList(camps, ids, (c) => c.r === "S" && c.lo <= 10)}.</dd>
      <dt>Early-season and high-water trips</dt>
      <dd>Plan around the ${highOk} camps with a high-water capacity. First-come camps that hold 30 at high water: ${linkList(camps, ids, (c) => !c.r && c.hi >= 30)}.</dd>
      <dt>Hot-weather trips</dt>
      <dd>Camps a source describes as shaded: ${linkList(camps, ids, has("shade"))}. Described as exposed or hot: ${linkList(camps, ids, has("no-shade"))}.</dd>
      <dt>Kids, new boaters, tired crews</dt>
      <dd>Easy landings: ${linkList(camps, ids, has("easy-landing"))}. ${linkList(camps, ids, has("kids"))} has a sand dune to jump from. Landings that need attention: ${linkList(camps, ids, has("tricky-landing"))}.</dd>
      <dt>Hot springs</dt>
      <dd>Camps at the Barth hot springs: ${linkList(camps, ids, has("hot-springs"))}.</dd>
      <dt>History and rock art</dt>
      <dd>Pictographs: ${linkList(camps, ids, has("rock-art"))}. Homesteads, graves and relics: ${linkList(camps, ids, has("history"))}.</dd>
      <dt>Hikers</dt>
      <dd>${linkList(camps, ids, has("hiking"))}.</dd>
      <dt>If you want quiet</dt>
      <dd>These have planes, jet boats, vehicles or day visitors nearby: ${linkList(camps, ids, has("traffic"))}.</dd>
    </dl>

    <h2 id="find">Find a camp</h2>
    <div class="camp-filters" id="camp-filters" hidden>
      <div class="camp-filter">
        <span class="camp-filter-label" id="level-label">Water level</span>
        <div class="status-btns" role="group" aria-labelledby="level-label">
          <button type="button" class="status-btn active" data-level="any" aria-pressed="true">Any</button>
          <button type="button" class="status-btn" data-level="low" aria-pressed="false">Low water</button>
          <button type="button" class="status-btn" data-level="high" aria-pressed="false">High water</button>
        </div>
      </div>
      <div class="camp-filter">
        <label class="camp-filter-label" for="camp-size">Group size</label>
        <input type="number" id="camp-size" class="search-input camp-size" min="1" max="30" inputmode="numeric" placeholder="people">
      </div>
      <div class="camp-filter">
        <span class="camp-filter-label" id="res-label">Type</span>
        <div class="status-btns" role="group" aria-labelledby="res-label">
          <button type="button" class="status-btn active" data-res="all" aria-pressed="true">All</button>
          <button type="button" class="status-btn" data-res="L" aria-pressed="false">Large res.</button>
          <button type="button" class="status-btn" data-res="S" aria-pressed="false">Small res.</button>
          <button type="button" class="status-btn" data-res="F" aria-pressed="false">First-come</button>
        </div>
      </div>
      <div class="camp-filter camp-filter-wide">
        <span class="camp-filter-label" id="want-label">Must have</span>
        <div class="camp-chips" role="group" aria-labelledby="want-label">
${FILTERS.map(([key, label, tags]) => `          <button type="button" class="camp-chip" data-want="${tags.join(" ")}" data-key="${key}" aria-pressed="false">${esc(label)}</button>`).join("\n")}
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
      Imagery Program, which is public domain.${aerialNote} Each frame is
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
      Mile, river side, both capacities, reservable status and the quoted note
      on every camp come from the
      <a href="${source.fs.url}">${esc(source.fs.label)}</a>. Camp names are
      spelled as that list spells them, because that is what the request form
      uses. The descriptions are LateBoof&rsquo;s own wording; details beyond
      the Forest Service note were checked against
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

    <aside class="river-side camp-rail" aria-hidden="true" data-camp-rail="/${slug}-data.js" data-landmarks="${esc(JSON.stringify(data.landmarks ?? []))}">
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
      <div class="river-side__foot">▲ large reservable · △ small-medium · ○ first-come. River left is on the right: the map looks downstream. Miles are true, bends are flattened.</div>
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
  for (const slug of slugs.length ? slugs : ["main-salmon"]) {
    const { data, html } = build(slug);
    writeFileSync(new URL(`web/${slug}-camps.html`, ROOT), html);
    console.log(`web/${slug}-camps.html — ${data.camps.length} camps, ${(html.length / 1024).toFixed(0)} KB`);
  }
}
