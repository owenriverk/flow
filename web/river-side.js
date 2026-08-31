// The run's real map beside its oracle page: kilometres on both axes, 40 m
// contours, the named rapids and camps. The blue line draws itself as you read
// and an orange boat rides its tip, so the boat is where you are in the report.
// Generic engine for every run's rail; each page names its data module in
// data-river-side (built by scripts/build-river-sides.mjs; the Stikine page
// still uses its original stikine-river.js — same behavior, older markup).

const SVG_NS = "http://www.w3.org/2000/svg";
const host = document.querySelector("[data-river-side]");
const box = host?.querySelector("[data-river-map]");
const svg = host?.querySelector("[data-river-svg]");
const topoSvg = host?.querySelector("[data-topo-svg]");
const topo = host?.querySelector("[data-topo]");
const flow = host?.querySelector("[data-flow]");
const bed = host?.querySelector("[data-bed]");
const trib = host?.querySelector("[data-trib]");
const marks = host?.querySelector("[data-marks]");
const north = host?.querySelector("[data-north]");
const boat = host?.querySelector("[data-boat]");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (host && box && svg && topoSvg && topo && flow && bed && trib && marks && north && boat) {
  const { FRAME, MARKS, NORTH, RIVER, TRIBS, TOPO } = await import(host.dataset.riverSide);
  let length = 0;
  let topoLoad = null;

  // Contour sheet: fetched once, inlined so it takes the page's styles and scale.
  const loadTopo = () => {
    if (!topoLoad) {
      topoLoad = fetch(TOPO.href)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then((text) => {
          const doc = new DOMParser().parseFromString(text, "image/svg+xml");
          const frag = document.createDocumentFragment();
          for (const g of Array.from(doc.documentElement.children)) frag.appendChild(document.importNode(g, true));
          topo.appendChild(frag);
        })
        .catch(() => {});
    }
    return topoLoad;
  };

  const smoothPath = (px) => {
    let d = `M ${px[0][0].toFixed(1)} ${px[0][1].toFixed(1)}`;
    for (let i = 1; i < px.length - 1; i += 1) {
      const mx = (px[i][0] + px[i + 1][0]) / 2;
      const my = (px[i][1] + px[i + 1][1]) / 2;
      d += ` Q ${px[i][0].toFixed(1)} ${px[i][1].toFixed(1)}, ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    d += ` L ${px[px.length - 1][0].toFixed(1)} ${px[px.length - 1][1].toFixed(1)}`;
    return d;
  };

  const build = () => {
    const w = box.clientWidth || 200;
    const h = box.clientHeight || 600;
    if (!w || !h || getComputedStyle(host).display === "none") return;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    topoSvg.setAttribute("viewBox", `0 0 ${w} ${h}`);

    // Kilometres to pixels: the canyon fills the height; the same scale
    // sideways when the column allows, squashed to fit when it does not.
    const pad = 8;
    const sy = h / FRAME.h;
    const sx = Math.min(sy, (w - pad * 2) / FRAME.w);
    const ox = (w - FRAME.w * sx) / 2;
    const X = (x) => ox + x * sx;
    const Y = (y) => y * sy;

    const d = smoothPath(RIVER.map(([x, y]) => [X(x), Y(y)]));
    flow.setAttribute("d", d);
    bed.setAttribute("d", d);
    trib.setAttribute(
      "d",
      TRIBS.filter((t) => t.length >= 2)
        .map((t) => smoothPath(t.map(([x, y]) => [X(x), Y(y)])))
        .join(" ")
    );

    const k = 1 / TOPO.unitsPerKm;
    topo.setAttribute("transform", `matrix(${(sx * k).toFixed(6)} 0 0 ${(sy * k).toFixed(6)} ${ox.toFixed(2)} 0)`);
    void loadTopo();

    // Rapids and camps, labelled on whichever side has more room; neighbours
    // too close for the type flip sides.
    marks.replaceChildren();
    const lastY = { left: -Infinity, right: -Infinity };
    for (const m of [...MARKS].sort((a, b) => a.y - b.y)) {
      const cx = X(m.x);
      const cy = Y(m.y);
      let side = cx < w / 2 ? "right" : "left";
      const other = side === "right" ? "left" : "right";
      if (cy - lastY[side] < 12 && cy - lastY[other] >= 12) side = other;
      lastY[side] = cy;
      let glyph;
      if (m.kind === "camp") {
        glyph = document.createElementNS(SVG_NS, "path");
        glyph.setAttribute("d", "M-4 3 L0 -4 L4 3 Z");
        glyph.setAttribute("transform", `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`);
        glyph.setAttribute("class", "camp");
      } else {
        glyph = document.createElementNS(SVG_NS, "circle");
        glyph.setAttribute("cx", cx.toFixed(1));
        glyph.setAttribute("cy", cy.toFixed(1));
        glyph.setAttribute("r", "2.8");
      }
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", (side === "right" ? cx + 7 : cx - 7).toFixed(1));
      label.setAttribute("y", (cy + 3.2).toFixed(1));
      label.setAttribute("text-anchor", side === "right" ? "start" : "end");
      label.textContent = m.name;
      marks.append(glyph, label);
    }

    // North arrow, top-left; the arrow turns, the N stays upright.
    north.setAttribute("transform", "translate(16 20)");
    const rad = (NORTH * Math.PI) / 180;
    north.querySelector("[data-north-arrow]")?.setAttribute("transform", `rotate(${NORTH})`);
    const n = north.querySelector("[data-north-n]");
    n?.setAttribute("x", (Math.sin(rad) * 14).toFixed(1));
    n?.setAttribute("y", (-Math.cos(rad) * 14 + 3).toFixed(1));

    length = flow.getTotalLength();
    flow.style.strokeDasharray = `${length}`;
    flow.style.strokeDashoffset = `${length}`;
  };

  const update = () => {
    if (!length) return;
    const doc = document.documentElement;
    const range = doc.scrollHeight - window.innerHeight;
    const p = range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 1;
    flow.style.strokeDashoffset = `${length * (1 - p)}`;
    const tip = flow.getPointAtLength(length * p);
    const ahead = flow.getPointAtLength(Math.min(length, length * p + 6));
    const angle = (Math.atan2(ahead.y - tip.y, ahead.x - tip.x) * 180) / Math.PI;
    boat.setAttribute("transform", `translate(${tip.x.toFixed(1)} ${tip.y.toFixed(1)}) rotate(${angle.toFixed(1)}) scale(1.3)`);
    boat.style.opacity = p < 0.995 ? "1" : "0"; // takes out at the bottom
  };

  build();
  if (reduce) {
    flow.style.strokeDashoffset = "0";
    boat.style.opacity = "0";
  } else {
    update();
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
  }
  window.addEventListener("resize", () => {
    build();
    if (!reduce) update();
    else flow.style.strokeDashoffset = "0";
  });
}
