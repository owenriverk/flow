// The strip map beside a camp guide (/main-salmon-camps): every camp on the
// river's real line, an orange boat that is at whichever camp you are reading,
// and mile markers where there is room for them.
//
// Sibling of river-side.js, and it reads the same <slug>-data.js centerline, but
// the job is different enough to be its own engine:
//   - river-side.js fits the whole run in the rail and moves the boat by scroll
//     percentage. Ninety camps cannot be labelled at that scale, so this one is
//     zoomed in (PX_PER_KM down the page) and PANS to keep the boat in view.
//   - The boat is tied to the camp entries, not to the page: when a camp's
//     heading reaches the reading line the boat is at that camp, it waits there
//     while you read, then runs to the next one.
// Camps are read from the page itself (the .camp articles the generator wrote),
// so the map can never disagree with the list, and filtered-out camps fade.
//
// Positions: river mile x 1.609 km laid along the OSM centerline. Checked
// against the surveyed creek mouths in the data (Bargamin, Big Mallard, South
// Fork) that agrees with the Forest Service miles to about a quarter mile.
// Sideways the line is squeezed into RIVER_COL pixels so both banks have room
// for labels — distances down the river are true, bends are flattened.

const SVG_NS = "http://www.w3.org/2000/svg";
const KM_PER_MILE = 1.609344;
const PX_PER_KM = 18;
const RIVER_COL = 44; // px the river's sideways wander is squeezed into
const LABEL_GAP = 10.5; // min px between stacked labels on one bank
const READ_AT = 0.38; // reading line / boat line, as a fraction of the height
const PAD = 26; // px of map above the put-in and below the take-out
const MILE_EVERY = 5;

const host = document.querySelector("[data-camp-rail]");
const box = host?.querySelector("[data-rail-map]");
const svg = host?.querySelector("[data-rail-svg]");
const pan = host?.querySelector("[data-rail-pan]");
const bed = host?.querySelector("[data-bed]");
const flow = host?.querySelector("[data-flow]");
const milesG = host?.querySelector("[data-miles]");
const campsG = host?.querySelector("[data-camps]");
const boat = host?.querySelector("[data-boat]");
const now = host?.querySelector("[data-rail-now]");
const guide = document.querySelector(".camp-guide");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Same wait as river-side.js: a module can run before the rail's stylesheet has
// applied, and an unstyled aside reads as visible. A hidden rail (phones)
// never imports the centerline.
if (document.readyState !== "complete") await new Promise((r) => window.addEventListener("load", r, { once: true }));
const shown = host && getComputedStyle(host).display !== "none";

if (shown && guide && box && svg && pan && bed && flow && milesG && campsG && boat) {
  // Tributaries are left out on purpose: squeezed sideways this hard they read
  // as stray lines beside the river, not as creeks.
  const { FRAME, RIVER } = await import(host.dataset.campRail);
  const landmarks = JSON.parse(host.dataset.landmarks || "[]");

  const camps = [...guide.querySelectorAll(".camp")].map((el) => ({
    el,
    id: el.id,
    mile: Number(el.dataset.mile),
    bank: el.dataset.side, // "L" | "R", looking downstream
    res: el.dataset.res,
    name: el.querySelector("h3").textContent.replace(/ Campsite$/, ""),
  }));

  // Distance along the centerline, in km, at every vertex.
  const cumKm = [0];
  for (let i = 1; i < RIVER.length; i += 1) {
    cumKm.push(cumKm[i - 1] + Math.hypot(RIVER[i][0] - RIVER[i - 1][0], RIVER[i][1] - RIVER[i - 1][1]));
  }
  const totalKm = cumKm[cumKm.length - 1];
  const totalMiles = totalKm / KM_PER_MILE;

  // Vertex index + fraction for a distance down the river.
  const locate = (km) => {
    const d = Math.min(totalKm, Math.max(0, km));
    let lo = 0;
    let hi = cumKm.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumKm[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = cumKm[hi] - cumKm[lo];
    return { i: lo, t: span > 0 ? (d - cumKm[lo]) / span : 0 };
  };

  let px = []; // the centerline in pixels
  let cumPx = [0];
  let mapH = 0;
  let viewH = 0;
  let stops = []; // [document y, river mile], ascending
  let labels = new Map(); // camp id -> its <g>
  let active = null;

  const at = (mile) => {
    const { i, t } = locate(mile * KM_PER_MILE);
    const a = px[i];
    const b = px[Math.min(px.length - 1, i + 1)];
    return {
      x: a[0] + (b[0] - a[0]) * t,
      y: a[1] + (b[1] - a[1]) * t,
      len: cumPx[i] + (cumPx[Math.min(cumPx.length - 1, i + 1)] - cumPx[i]) * t,
      angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
    };
  };

  const el = (tag, attrs = {}, text) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text != null) node.textContent = text;
    return node;
  };

  const build = () => {
    const w = box.clientWidth;
    viewH = box.clientHeight;
    if (!w || !viewH) return;
    svg.setAttribute("viewBox", `0 0 ${w} ${viewH}`);

    const sx = RIVER_COL / FRAME.w;
    const ox = (w - RIVER_COL) / 2;
    px = RIVER.map(([x, y]) => [ox + x * sx, PAD + y * PX_PER_KM]);
    cumPx = [0];
    for (let i = 1; i < px.length; i += 1) {
      cumPx.push(cumPx[i - 1] + Math.hypot(px[i][0] - px[i - 1][0], px[i][1] - px[i - 1][1]));
    }
    mapH = FRAME.h * PX_PER_KM + PAD * 2;

    const line = (pts) => `M ${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L ")}`;
    const d = line(px);
    bed.setAttribute("d", d);
    flow.setAttribute("d", d);
    flow.style.strokeDasharray = `${cumPx[cumPx.length - 1]}`;

    // Looking down the page is looking downstream, so river LEFT is the
    // right-hand side of the map. Labels sit in a column on the camp's own bank.
    const col = { L: ox + RIVER_COL + 9, R: ox - 9 };
    const anchor = { L: "start", R: "end" };
    const lastY = { L: -Infinity, R: -Infinity };
    const taken = { L: [], R: [] };

    const place = (bank, y) => {
      const ly = Math.max(y, lastY[bank] + LABEL_GAP);
      lastY[bank] = ly;
      taken[bank].push(ly);
      return ly;
    };
    const leader = (p, bank, ly) =>
      el("path", {
        class: "camp-rail__leader",
        d: `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${(col[bank] + (bank === "L" ? -3 : 3)).toFixed(1)} ${ly.toFixed(1)}`,
      });

    campsG.replaceChildren();
    labels = new Map();
    // Put-in, take-outs, the end of the Wild section: placed first so the camp
    // labels stack around them rather than on top.
    const items = [
      ...landmarks.map((l) => ({ ...l, landmark: true })),
      ...camps.map((c) => ({ m: c.mile, s: c.bank, camp: c })),
    ].sort((a, b) => a.m - b.m || (a.landmark ? -1 : 1));

    for (const it of items) {
      const p = at(it.m);
      const bank = it.s === "R" ? "R" : "L";
      const ly = place(bank, p.y);
      const g = el("g", { class: it.landmark ? "camp-rail__landmark" : `camp-rail__camp res-${it.camp.res}` });
      g.append(leader(p, bank, ly));
      if (it.landmark) {
        g.append(el("rect", { x: (p.x - 3).toFixed(1), y: (p.y - 3).toFixed(1), width: 6, height: 6 }));
        g.append(el("text", { x: col[bank].toFixed(1), y: (ly + 3).toFixed(1), "text-anchor": anchor[bank] }, it.n));
      } else {
        const glyph =
          it.camp.res === "F"
            ? el("circle", { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 2.4 })
            : el("path", { d: "M-4 3 L0 -4 L4 3 Z", transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})` });
        g.append(glyph);
        g.append(el("text", { x: col[bank].toFixed(1), y: (ly + 3).toFixed(1), "text-anchor": anchor[bank] }, it.camp.name));
        g.dataset.id = it.camp.id;
        labels.set(it.camp.id, g);
      }
      campsG.append(g);
    }

    // Mile markers: a tick on the river every MILE_EVERY miles, and the number
    // on whichever bank has a clear line for it. No room, no number.
    milesG.replaceChildren();
    const clear = (bank, y) => taken[bank].every((ly) => Math.abs(ly - y) >= LABEL_GAP);
    for (let m = MILE_EVERY; m < totalMiles; m += MILE_EVERY) {
      const p = at(m);
      milesG.append(el("path", { class: "camp-rail__tick", d: `M ${(p.x - 5).toFixed(1)} ${p.y.toFixed(1)} h 10` }));
      const bank = clear("L", p.y) ? "L" : clear("R", p.y) ? "R" : null;
      if (!bank) continue;
      taken[bank].push(p.y);
      milesG.append(
        el("text", { class: "camp-rail__mile", x: col[bank].toFixed(1), y: (p.y + 3).toFixed(1), "text-anchor": anchor[bank] }, `mile ${m}`)
      );
    }
  };

  // Where the boat should be for a given scroll position: a list of
  // [document y, mile] stops. Each visible camp contributes two — arrive when
  // its top reaches the reading line, stay until half of it has gone by — so
  // the boat is AT the camp while you read it and travels during the rest.
  const measure = () => {
    const y0 = window.scrollY;
    const top = (node) => node.getBoundingClientRect().top + y0;
    const visible = camps.filter((c) => !c.el.hidden);
    stops = [];
    const find = document.getElementById("find");
    stops.push([find ? top(find) : 0, 0]);
    for (const c of visible) {
      const r = c.el.getBoundingClientRect();
      stops.push([r.top + y0, c.mile], [r.top + y0 + r.height * 0.5, c.mile]);
    }
    const last = visible[visible.length - 1];
    const end = document.documentElement.scrollHeight - window.innerHeight * (1 - READ_AT);
    if (last) stops.push([Math.max(end, last.el.getBoundingClientRect().bottom + y0), totalMiles]);
    for (const [id, g] of labels) g.classList.toggle("off", document.getElementById(id).hidden);
  };

  const mileAt = (y) => {
    if (stops.length === 0 || y <= stops[0][0]) return 0;
    for (let i = 1; i < stops.length; i += 1) {
      const [y1, m1] = stops[i];
      if (y > y1) continue;
      const [y0, m0] = stops[i - 1];
      if (reduce) return m0; // no gliding between camps: step from one to the next
      return y1 > y0 ? m0 + ((m1 - m0) * (y - y0)) / (y1 - y0) : m1;
    }
    return stops[stops.length - 1][1];
  };

  const update = () => {
    if (!px.length) return;
    const y = window.scrollY + window.innerHeight * READ_AT;
    const mile = mileAt(y);
    const p = at(mile);
    boat.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.angle.toFixed(1)}) scale(1.25)`);
    flow.style.strokeDashoffset = `${cumPx[cumPx.length - 1] - p.len}`;
    // Keep the boat on the reading line, without scrolling past either end.
    const ty = Math.min(0, Math.max(viewH - mapH, viewH * READ_AT - p.y));
    pan.setAttribute("transform", `translate(0 ${ty.toFixed(1)})`);

    // The camp you are reading: the last visible one whose top has passed.
    let reading = null;
    for (const c of camps) {
      if (c.el.hidden) continue;
      const r = c.el.getBoundingClientRect();
      if (r.top <= window.innerHeight * READ_AT && r.bottom > window.innerHeight * READ_AT) reading = c;
    }
    if (reading !== active) {
      if (active) labels.get(active.id)?.classList.remove("on");
      if (reading) labels.get(reading.id)?.classList.add("on");
      active = reading;
    }
    if (now) now.textContent = reading ? `Mile ${reading.mile} · ${reading.name}` : `Mile ${mile.toFixed(1)}`;
  };

  const refresh = () => {
    measure();
    update();
  };

  build();
  refresh();

  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    },
    { passive: true }
  );
  window.addEventListener("resize", () => {
    build();
    refresh();
  });
  // camps.js announces every filter change; hidden camps drop out of the stops.
  document.addEventListener("camps:change", refresh);

  // The map is decoration for screen readers (the list is the content), but a
  // pointer can still use it: click a camp to jump to its entry.
  campsG.addEventListener("click", (event) => {
    const g = event.target.closest("[data-id]");
    if (!g) return;
    // Same camp twice: the hash would not change, so scroll by hand.
    if (location.hash === `#${g.dataset.id}`) document.getElementById(g.dataset.id)?.scrollIntoView();
    else location.hash = `#${g.dataset.id}`;
  });
}
