/**
 * Main Salmon profile for scripts/build-camp-guide.mjs: the prose, rules and
 * labels that are this river's and not the generator's. Counts come from the
 * data through ctx, so none of the numbers below can drift from the list.
 *
 * The Main's list has two water levels and a reservable class per camp
 * (large / small-medium / first-come). Rules checked against the Salmon-Challis
 * page on 2026-09-30.
 */

const RES = {
  L: { label: "Large reservable", cls: "solid" },
  S: { label: "Small-medium reservable", cls: "outline" },
};

export default {
  span: "Corn Creek to Long Tom Bar",
  wilderness: "Frank Church&ndash;River of No Return Wilderness",

  description: ({ river, n, count }) =>
    `Every named camp on the ${river}, Corn Creek to Long Tom Bar: river mile, side, how many people it holds at low and at high water, which ${count((c) => c.r)} are reservable, and what each is like. Filter by group size and water level.`,

  facts: ({ n, count, cap, lastLevel }) => {
    const large = count((c) => c.r === "L");
    const small = count((c) => c.r === "S");
    return [
      ["Camps", `${n} named, ${large + small} reservable`],
      ["Reservable", `${large} large, ${small} small-medium`],
      ["At high water", `${count((c) => cap(c, lastLevel) > 0)} usable, ${count((c) => cap(c, lastLevel) === 0)} gone`],
      ["Camp requests", "Emailed form, 14 days before launch"],
    ];
  },

  badges: (c) => (c.r ? [RES[c.r]] : [{ label: "First-come", cls: "plain" }]),
  types: (c) => [c.r ?? "F"],
  typeFilter: [
    ["all", "All"],
    ["L", "Large res."],
    ["S", "Small res."],
    ["F", "First-come"],
  ],
  glyph: (c) => (c.r === "L" ? "filled" : c.r === "S" ? "open" : "dot"),
  legend: "▲ large reservable · △ small-medium · ○ first-come.",

  chips: [
    ["shade", "Shade", ["shade"]],
    ["easy", "Easy landing", ["easy-landing"]],
    ["sand", "Sand beach", ["sand"]],
    ["springs", "Hot springs", ["hot-springs"]],
    ["history", "History & pictographs", ["history", "rock-art"]],
    ["hiking", "Hiking", ["hiking"]],
  ],

  noHighCapacity: "high-water capacity",
  fsLine: (c, { esc }) => `Forest Service note: &ldquo;${esc(c.fs)}&rdquo;`,

  read: ({ n, slug, count, cap, lastLevel }) => {
    const lowOnly = count((c) => cap(c, lastLevel) === 0);
    const shrink = count((c) => cap(c, lastLevel) > 0 && cap(c, lastLevel) < cap(c, 0));
    const highOnly = count((c) => cap(c, 0) === 0);
    return `    <p>
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
    </p>`;
  },

  rulesTitle: "Requesting reserved camps",
  rules: ({ source, checked }) => `    <p>
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
    </p>`,

  groups: ({ count, links, has, cap, lastLevel }) => {
    const hi = (c) => cap(c, lastLevel);
    return `      <dt>Groups of 21 to 30</dt>
      <dd>Only the 30-person camps are open to you: ${count((c) => cap(c, 0) >= 30)} at low water, ${count((c) => hi(c) >= 30)} at high. Large reservable camps that hold 30 at any level: ${links((c) => c.r === "L" && hi(c) >= 30)}.</dd>
      <dt>Groups of 10 or fewer</dt>
      <dd>${count((c) => Math.max(cap(c, 0), hi(c)) <= 10)} camps are capped at 10 people, so no larger group can take them. The reservable ones: ${links((c) => c.r === "S" && cap(c, 0) <= 10)}.</dd>
      <dt>Early-season and high-water trips</dt>
      <dd>Plan around the ${count((c) => hi(c) > 0)} camps with a high-water capacity. First-come camps that hold 30 at high water: ${links((c) => !c.r && hi(c) >= 30)}.</dd>
      <dt>Hot-weather trips</dt>
      <dd>Camps a source describes as shaded: ${links(has("shade"))}. Described as exposed or hot: ${links(has("no-shade"))}.</dd>
      <dt>Kids, new boaters, tired crews</dt>
      <dd>Easy landings: ${links(has("easy-landing"))}. ${links(has("kids"))} has a sand dune to jump from. Landings that need attention: ${links(has("tricky-landing"))}.</dd>
      <dt>Hot springs</dt>
      <dd>Camps at the Barth hot springs: ${links(has("hot-springs"))}.</dd>
      <dt>History and rock art</dt>
      <dd>Pictographs: ${links(has("rock-art"))}. Homesteads, graves and relics: ${links(has("history"))}.</dd>
      <dt>Hikers</dt>
      <dd>${links(has("hiking"))}.</dd>
      <dt>If you want quiet</dt>
      <dd>These have planes, jet boats, vehicles or day visitors nearby: ${links(has("traffic"))}.</dd>`;
  },

  aerialSummary: ({ flown, cfs, gaugeName, day }) =>
    flown.length && cfs.length
      ? ` These were flown between ${day(flown[0])} and ${day(flown[flown.length - 1])}, with the river at ${Math.min(...cfs).toLocaleString("en-US")}&ndash;${Math.max(...cfs).toLocaleString("en-US")} cfs at ${gaugeName}: very low water, so they show the beaches at close to their largest.`
      : "",

  sourcesFs: ({ source, esc }) =>
    `Mile, river side, both capacities, reservable status and the quoted note
      on every camp come from the
      <a href="${source.fs.url}">${esc(source.fs.label)}</a>.`,
};
