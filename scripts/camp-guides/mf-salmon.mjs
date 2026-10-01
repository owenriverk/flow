/**
 * Middle Fork Salmon profile for scripts/build-camp-guide.mjs.
 *
 * Every Middle Fork camp is assigned, so there is no reservable class. Instead
 * the Forest Service list gives three capacities, at 2.5 ft or less, about 4 ft
 * and 6 ft or more on the Middle Fork Lodge gauge (USGS 13309220, the gauge
 * height boaters quote: GoRafting and North Idaho Rivers both say so), plus
 * layover, hot-springs, heritage, no-wood and use-level columns. Rules checked
 * against the Salmon-Challis Middle Fork page on 2026-09-30.
 */

const lower = (s) => String(s).toLowerCase();

export default {
  span: "Boundary Creek to the confluence",
  wilderness: "Frank Church&ndash;River of No Return Wilderness",

  description: ({ river, n }) =>
    `Every camp on the Forest Service's ${river} list, Boundary Creek to the confluence: river mile, side, how many people it holds at 2.5 ft, about 4 ft and 6 ft on the Middle Fork Lodge gauge, which allow layovers, the hot-springs and heritage camps, and what each is like. ${n} camps; filter by group size and level.`,

  facts: ({ n, count, cap, lastLevel }) => [
    ["Camps", `${n} on the list, ${count((c) => c.lay)} allow layovers`],
    ["Hot springs", `${count((c) => c.hot)} camps, one per trip`],
    ["At 6 ft or more", `${count((c) => cap(c, lastLevel) > 0)} usable, ${count((c) => cap(c, lastLevel) === 0)} gone`],
    ["Camp requests", "Emailed form, 14 days before launch"],
  ],

  badges: (c) => [
    ...(c.hot ? [{ label: "Hot springs", cls: "solid" }] : []),
    ...(c.heritage ? [{ label: "Heritage site", cls: "outline" }] : []),
    ...(c.lay ? [{ label: "Layover OK", cls: "plain" }] : []),
  ],
  types: (c) => [...(c.hot ? ["hot"] : []), ...(c.heritage ? ["heritage"] : []), ...(c.lay ? ["layover"] : [])],
  typeFilter: [
    ["all", "All"],
    ["hot", "Hot springs"],
    ["heritage", "Heritage"],
    ["layover", "Layover OK"],
  ],
  glyph: (c) => (c.hot ? "filled" : c.heritage ? "open" : "dot"),
  legend: "▲ hot-springs camp · △ heritage site · ○ other camps.",

  chips: [
    ["shade", "Shade", ["shade"]],
    ["easy", "Easy landing", ["easy-landing"]],
    ["swim", "Swimming hole", ["swimming"]],
    ["hiking", "Hiking", ["hiking"]],
    ["history", "History & pictographs", ["history", "rock-art"]],
    ["quiet", "Low use in July–Aug", ["quiet-summer"]],
  ],
  // Filter-only tags the page does not print as chips.
  derivedTags: (c) => (c.use?.[1] === "Low" ? ["quiet-summer"] : []),

  noHighCapacity: "capacity at 6 ft or more",
  fsLine: (c) =>
    `Forest Service: layovers ${c.lay ? "allowed" : "not allowed"}; use ${lower(c.use[0])} in June, ${lower(c.use[1])} in July and August${c.noWood ? "; do not gather downed wood for fires here" : ""}.`,

  read: ({ n, camps, count, cap, lastLevel, links, esc }) => {
    const gone = count((c) => cap(c, lastLevel) === 0);
    const shrink = count((c) => cap(c, lastLevel) > 0 && cap(c, lastLevel) < cap(c, 0));
    const blank4 = count((c) => cap(c, 1) == null && cap(c, 0) != null);
    const none = camps.filter((c) => c.cap.every((v) => v == null));
    return `    <p>
      Every camp below carries three numbers from the Forest Service list: how
      many people it holds when the Middle Fork Lodge gauge reads
      <strong>2.5 ft or less</strong>, <strong>about 4 ft</strong>, and
      <strong>6 ft or more</strong>. The feet are that gauge&rsquo;s height
      (USGS 13309220), the number boaters trade, and the second number in a
      LateBoof reply (&ldquo;2,800 cfs / 4.21 ft&rdquo;). ${gone} of the ${n}
      camps are gone at 6 ft or more, and ${shrink} more shrink.
    </p>
    <p>
      A blank on the list means the Forest Service gives no number:
      ${blank4} camps have none at about 4 ft${none.length ? `, and ${none.map((c) => esc(c.n)).join(", ")} has none at any level` : ""}.
      Those show as &ldquo;Not listed&rdquo;, and the level filter leaves them
      out at that level rather than guess. Read the numbers either side.
    </p>
    <p>
      The capacities are limits. A group may not use a camp rated for fewer
      people than it has. Groups top out at 24 on the Middle Fork, so a camp
      rated for 30 takes any permitted group. Each camp also carries the Forest
      Service&rsquo;s use level for June and for July and August: low, mid,
      high or very high.
    </p>`;
  },

  rulesTitle: "Requesting camps",
  rules: ({ source, checked, n }) => `    <p>
      Every camp on the Middle Fork is assigned; none is first-come. The River
      Office emails the permit holder a camp request form 14 days before the
      launch date, and builds your itinerary from it.
    </p>
    <ul>
      <li>Complete the reservation on Recreation.gov and submit the camp request form at least 7 days before launch. The form can be submitted once. If it is late, or your requests do not fit your group or the rules, the River Clerk assigns the best camps left.</li>
      <li>One hot-springs camp per group at most, and it is not guaranteed. Ask for three and you still get one at most.</li>
      <li>During the lottery control season (May 28 to September 3) a group gets one night below Big Creek. The Forest Service web page puts that line at Big Creek, mile 77.9; its camp list draws it just below Last Chance, mile 78.</li>
      <li>Layovers only at camps marked for them, case by case, and sparingly in the control season.</li>
      <li>Groups of 12 or fewer are often put in smaller camps.</li>
      <li>Heritage camps come with extra instructions to protect cultural sites. At the ten camps asterisked on the list, do not gather downed wood for fires.</li>
      <li>An assigned camp is not exclusive. Backpackers and stock parties may share it, especially at hot springs and airstrips.</li>
      <li>Camp assignments are final once the permit is issued, by email 5 or 6 days before launch.</li>
    </ul>
    <p>
      Trip length follows group size: up to 8 days for 1&ndash;10 people, 7
      days for 11&ndash;20, and 6 days for 21&ndash;24. Rules change; the
      <a href="${source.fsRules.url}">Salmon-Challis National Forest page</a>
      is the authority, and this summary was checked against it on ${checked}.
    </p>`,

  groups: ({ count, links, has, cap, lastLevel }) => {
    const all30 = (c) => c.cap.every((v) => v === 30);
    const below = (c) => c.m > 78.2; // the one-night stretch, Pine Bluff down
    return `      <dt>Groups of 21 to 24</dt>
      <dd>You need a camp rated for 30: ${count((c) => cap(c, 0) === 30)} at 2.5 ft or less, ${count((c) => cap(c, 1) === 30)} at about 4 ft, ${count((c) => cap(c, lastLevel) === 30)} at 6 ft or more. ${count(all30)} hold 30 at every level.</dd>
      <dt>Layover days</dt>
      <dd>${count((c) => c.lay)} camps allow a layover${count((c) => c.lay && below(c)) === 0 ? ", none of them in the Impassable Canyon" : ""}. The ones that hold 30 at every level: ${links((c) => c.lay && all30(c))}.</dd>
      <dt>Groups of 12 or fewer</dt>
      <dd>The River Office often puts you in a smaller camp. These top out at 12 or fewer at every level: ${links((c) => c.cap.some((v) => v) && Math.max(...c.cap.map((v) => v ?? 0)) <= 12)}.</dd>
      <dt>Hot springs</dt>
      <dd>One per trip: ${links((c) => c.hot)}. These are close to a hot spring without being one of the six, so they do not use up your one: ${links((c) => has("hot-springs")(c) && !c.hot)}.</dd>
      <dt>The night in the Impassable Canyon</dt>
      <dd>One night only below Big Creek. Big enough for 21 or more at 2.5 ft or less: ${links((c) => below(c) && cap(c, 0) >= 21)}. Still open at 6 ft or more: ${links((c) => below(c) && cap(c, lastLevel) > 0)}.</dd>
      <dt>Early-season and high-water trips</dt>
      <dd>${count((c) => cap(c, lastLevel) > 0)} camps are open at 6 ft or more. Above Indian Creek, these hold 30 at that level: ${links((c) => c.m < 24.5 && cap(c, lastLevel) === 30)}.</dd>
      <dt>Hot-weather trips</dt>
      <dd>Shade: ${links(has("shade"))}. Little shade, or burned: ${links((c) => has("no-shade")(c) || has("burned")(c))}. Swimming holes: ${links(has("swimming"))}.</dd>
      <dt>Kids, new boaters, tired crews</dt>
      <dd>Easy landings: ${links(has("easy-landing"))}. Landings that need attention: ${links(has("tricky-landing"))}.</dd>
      <dt>History and rock art</dt>
      <dd>Heritage sites: ${links((c) => c.heritage)}. Pictographs: ${links(has("rock-art"))}. Homesteads, mines and cabins: ${links((c) => has("history")(c) && !c.heritage)}.</dd>
      <dt>Hikers</dt>
      <dd>${links(has("hiking"))}.</dd>
      <dt>If you want quiet</dt>
      <dd>Low use in July and August and room for 20 or more at 2.5 ft or less: ${links((c) => c.use[1] === "Low" && cap(c, 0) >= 20)}. Planes, lodges or visitors nearby: ${links(has("traffic"))}.</dd>`;
  },

  aerialSummary: ({ flown, cfs, ft, gaugeName, day }) => {
    if (!flown.length || !ft.length) return "";
    // "1.4 ft", not "1.4–1.4 ft", when every flight day read the same.
    const span = (vals, fmt) => {
      const [lo, hi] = [fmt(Math.min(...vals)), fmt(Math.max(...vals))];
      return lo === hi ? lo : `${lo}&ndash;${hi}`;
    };
    const flow = cfs.length ? ` (${span(cfs, (v) => v.toLocaleString("en-US"))} cfs)` : "";
    const reads = Math.max(...ft) <= 2.5 ? "in the 2.5-ft-or-less column: they show the camps at low water" : "so read each caption for the level it shows";
    return ` These were flown between ${day(flown[0])} and ${day(flown[flown.length - 1])}, with the ${gaugeName} gauge at ${span(ft, (v) => v.toFixed(1))} ft${flow}, ${reads}.`;
  },

  sourcesFs: ({ source, esc }) =>
    `Mile, river side, all three capacities, layovers, the hot-springs,
      heritage and no-wood flags, and the use levels on every camp come from the
      <a href="${source.fs.url}">${esc(source.fs.label)}</a>. It matches the
      table on the Forest Service&rsquo;s Middle Fork page except that the web
      table leaves out Airplane camp. That the feet are the Middle Fork Lodge
      gauge&rsquo;s height comes from
      <a href="${source.grFlows.url}">${esc(source.grFlows.label)}</a> and
      <a href="https://www.northidahorivers.com/Middle_Fork_Salmon.htm">North Idaho Rivers</a>.`,
};
