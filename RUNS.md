# Run roster

What to text the bot → the run it maps to → the gauge it reads.
This roster is generated from `src/aliases.json` **as of 2026-08-30** and lists
every phrase the bot will currently resolve to a gauge. It is **not** a live-API
verification pass — it reflects what's configured, not a fresh check that every
upstream station is reporting data right now. The 45-gauge set here matches
`supabase/functions/refresh-gauges/gauges.ts` (the website's source list).
Units are native: US runs **cfs / ft**, Canadian runs **cms / m**, New Zealand
runs **cms** (discharge only, no stage).

The bot also accepts **raw gauge IDs** (USGS `13317000`, WSC `08CE001` — any
station in either network, not just this roster), matches a run name embedded in
a longer message (`middle kings at rodger's` → Middle Kings), knows the **place
names** off the official station names (`white bird`, `banks`, `lowman`,
`greendale`, `agness`, …), and tolerates punctuation (`kings?` works). A gauge
can be named alongside its run (`grand canyon at phantom`, `san juan, four
corners`). A message naming **two different rivers** (`stikine, clore`) comes
back "not found" on purpose — one reply can't carry two readings, and half an
answer on a satellite link is worse than none.

## Class III–IV multiday overnighters

| Text this | Run / AKA | Gauge | Source | Location |
|---|---|---|---|---|
| `middle fork salmon` / `mf salmon` | Middle Fork Salmon — "the Middle Fork" (AKA: `mfs`, `the middle fork`) | 13309220 | USGS | At MF Lodge, ID |
| `main salmon` / `lower salmon` | Main Salmon — "River of No Return" (AKA: `river of no return`, `rnr`, `lower salmon`) | 13317000 | USGS | At White Bird, ID |
| `selway` | Selway | 13336500 | USGS | Near Lowell, ID |
| `hells canyon` | Hells Canyon (Snake R) (AKA: `snake`, `hells`, `hc`) | 13290450 | USGS | At Hells Canyon Dam, OR-ID |
| `grande ronde` | Grande Ronde (AKA: `ronde`, `the ronde`) | 13333000 | USGS | At Troy, OR |
| `rogue` | Wild Rogue | 14372300 | USGS | Near Agness, OR |
| `deschutes` | Lower Deschutes (AKA: `deschy`) | 14103000 | USGS | At Moody, OR |
| `john day` | John Day (AKA: `jd`) | 14046500 | USGS | At Service Creek, OR |
| `owyhee` | Owyhee | 13181000 | USGS | Near Rome, OR |
| `flathead` / `mf flathead` | Middle Fork Flathead (AKA: `middle flathead`) | 12358500 | USGS | Near West Glacier, MT |
| `nf flathead` | North Fork Flathead (AKA: `north flathead`) | 12355500 | USGS | Near Columbia Falls, MT |
| `sf flathead` / `south fork flathead` | South Fork Flathead (AKA: `south flathead`) | 12359800 | USGS | Above Twin Cr, MT |

## Desert / Colorado Plateau

| Text this | Run / AKA | Gauge | Source | Location |
|---|---|---|---|---|
| `grand canyon` / `lees ferry` | Grand Canyon (Colorado R) (AKA: `gc`, `the ditch`) | 09380000 | USGS | At Lees Ferry, AZ |
| `phantom` / `phantom ranch` | Grand Canyon — Phantom (Colorado R) — mid-canyon reading (AKA: `grand canyon phantom`; same trip as `grand canyon`, see caveats) | 09402500 | USGS | Near Phantom Ranch, AZ |
| `diamond` / `diamond creek` | Grand Canyon — Diamond (Colorado R) — takeout gauge, river mile 226 (AKA: `grand canyon diamond`) | 09404200 | USGS | Above Diamond Creek, AZ |
| `cataract` | Cataract Canyon (Colorado R) (AKA: `cat`) | 09328960 | USGS | Near Hite, UT |
| `yampa` | Yampa | 09260050 | USGS | At Deerlodge Park, CO |
| `gates of lodore` / `lodore` | Gates of Lodore (Green R) (AKA: `gates`) | 09234500 | USGS | Near Greendale, UT |
| `desolation` / `deso` | Desolation (Green R) — Deso/Gray Canyon (AKA: `deso grey`) | 09315000 | USGS | At Green River, UT |
| `san juan` | San Juan (AKA: `the juan`) | 09379500 | USGS | Near Bluff, UT |
| `four corners` / `4 corners` | San Juan — Four Corners — upstream indicator, ~1 day above Bluff (AKA: `san juan four corners`) | 09371010 | USGS | At Four Corners, CO |
| `salt` / `salt river` | Salt River Canyon | 09497500 | USGS | Near Chrysotile, AZ |

## Far North

| Text this | Run / AKA | Gauge | Source | Location |
|---|---|---|---|---|
| `tatshenshini` / `tat` | Tatshenshini | 08AC002 | WSC | Near Dalton Post, YT |
| `alsek` | Alsek | 08AB001 | WSC | Above Bates River, YT |
| `susitna` | Susitna (Devils Canyon) (AKA: `the su`) | 15292000 | USGS | At Gold Creek, AK |
| `stikine` | Stikine (Grand Canyon) — "Grand Canyon of the Stikine" (AKA: `gc stikine`) | 08CE001 | WSC | At Telegraph Creek, BC |
| `iskut` | Iskut | 08CG001 | WSC | Below Johnson River, BC |
| `copper` / `zymoetz` | Clore (Zymoetz R) — the Copper (AKA: `calor`, `clore`, `gc clore`, `grand canyon clore`, `copper river`) | 08EF005 | WSC | Above O.K. Creek, BC |
| `clearwater` | Clearwater, BC (AKA: `bc clearwater`) | 08LA001 | WSC | Near Clearwater Station, BC |

## New Zealand

| Text this | Run / AKA | Gauge | Source | Location |
|---|---|---|---|---|
| `wairaurahiri` | Wairaurahiri R | `Wairaurahiri at Lake Hauroko` | Environment Southland (`envdata`) | At Lake Hauroko outlet, Southland, NZ |
| `landsborough` / `roaring billy` / `haast` | Landsborough R — proxy gauge on the Haast (see caveats) | 61 | flowrate.co.nz (`flowrate`) | Via Haast R gauge at Roaring Billy, West Coast, NZ |

## Class V+ overnighters & classics

| Text this | Run / AKA | Gauge | Source | Location |
|---|---|---|---|---|
| `south salmon` / `sf salmon` | South Fork Salmon (AKA: `sfs`) | 13310700 | USGS | Near Krassel Ranger Station, ID |
| `kings` / `middle kings` | Middle Kings — proxy gauge (AKA: `mk`) | 100 | Dreamflows | At Rodgers Crossing, CA |
| `fantasy falls` / `fantasy` | Fantasy Falls (NF Mokelumne) (AKA: `nf mokelumne`, `nf moke`, `the moke`, `ff`) | 111 | Dreamflows | Above Salt Springs, CA |
| `upper cherry` | Upper Cherry Creek (AKA: `uc`) | 665 | Dreamflows | Above Cherry Lake, CA |
| `west cherry` / `west cherry creek` | West Cherry Creek — proxy gauge (shares 665 with `upper cherry`, see caveats) | 665 | Dreamflows | Via Upper Cherry gauge above Cherry Lake, CA |
| `mf feather` / `bald rock` | Bald Rock (MF Feather) (AKA: `devils canyon feather`, `devils`, `the feather`) | 54 | Dreamflows | At Milsap Bar, CA |
| `royal gorge` | Royal Gorge (NF American) (AKA: `royal`, `nf american` — see caveats) | 69 | Dreamflows | Above Lake Clementine, CA |
| `postpile` | Devils Postpile (San Joaquin) (AKA: `devils postpile`, `sj`, `san joaquin`) | 494 | Dreamflows | At Devils Postpile, CA |
| `south merced` | South Fork Merced (AKA: `s merced`, `sf merced`) | 181 | Dreamflows | At Wawona, CA |
| `tuolumne grand canyon` / `tgc` | Grand Canyon of the Tuolumne (AKA: `gc t`, `tuolumne gc`; shares gauge 531 with `tuolumne`) | 531 | Dreamflows | Above Hetch Hetchy Reservoir, CA |
| `tuolumne` / `the t` | Tuolumne (Main) — "the T" (AKA: `main t`; shares gauge 531 with `tuolumne grand canyon`) | 531 | Dreamflows | Above Hetch Hetchy Reservoir, CA |
| `clarks fork` | Clarks Fork (the Box) (AKA: `clarks fork box`, `the box`, `clarks`) | 06207500 | USGS | Near Belfry, MT |
| `nf payette` | North Fork Payette — Smiths Ferry to Banks (AKA: `north fork payette`) | 13246000 | USGS | Near Banks, ID |
| `sf payette` | South Fork Payette (AKA: `south fork payette`) | 13235000 | USGS | At Lowman, ID |

## Removed / deferred (no usable live gauge)

Unless noted otherwise, everything below was cut in the 2026-06-30 gauge-list
compaction (per `aliases.json` / `gauges.ts` git history, roughly 62 gauges
trimmed to the current 36). Old DB rows aren't deleted, just filtered out
client-side; the site ID shown is what the phrase used to point to.

| Run | Why |
|---|---|
| Babine, Chilko, Firth (BC/YT) | Predates this compaction — WSC stations returned no realtime data, pulled to avoid shipping dead entries. |
| Magpie (QC) | Predates this compaction — reports to Quebec CEHQ, needs a fourth source adapter. |
| Cache la Poudre | Was USGS `06752260`. |
| Big South (Poudre) | Predates this compaction — no live gauge distinct from the main Poudre. |
| Westwater Canyon | Was USGS `09180500`, shared with the old Cataract entry — Cataract now reads its own dedicated gauge (`09328960`) instead. |
| Ruby / Ruby–Horsethief | Was USGS `09163500`. |
| Dolores | Was USGS `09169500`. |
| Rio Chama | Was USGS `08285500`. |
| Rio Grande — Taos Box | Was USGS `08276500`. |
| Black Canyon / Gunnison Gorge | Was USGS `09128000` — already flagged as a proxy (the inner Black Canyon is unrunnable/ungauged) even before it was removed. |
| South Nahanni | Was WSC `10EB001`. |
| Illinois | Was USGS `14377100`. |
| Bruneau–Jarbidge | Was USGS `13168500`. |
| Smith (MT) | Was USGS `06077500`. |
| Allagash (ME) | Was USGS `01011000`. |
| Salmon — upper (Shoup) | Was USGS `13307000`. |
| Kern / Forks of the Kern | Was CDEC `KRD`. No CDEC-sourced gauge remains in the alias table at all anymore. |
| Dinkey Creek | Was CDEC `DKS`. |
| Cherry Creek (not Upper) | Was CDEC `CEI`. Upper Cherry survived separately via a new Dreamflows gauge. |
| SF American | Was CDEC `CBR`. |
| Rubicon | Was CDEC `RBG`. |
| MF American | Was CDEC `OXB`. |

Note: Devils Postpile was previously in this section (no representative
station) but is back in the live table above — it now reads a Dreamflows
gauge (`494`).

## Honest caveats (proxies — gauge is near, not exactly on, the run)

- **Middle Kings** → `kings` / `middle kings` / `mk` reads a Dreamflows gauge
  at Rodgers Crossing (site `100`) — the closest live proxy, not a station on
  the Middle Kings run itself.
- **Fantasy Falls** → Dreamflows site `111` is a monthly-updated virtual gauge
  (`mon.111.php`) that drops out of the realtime feed entirely when dormant.
  Off-season the bot replies with the last cached reading plus a "no fresh
  data" warning — or "couldn't reach gauge data" if nothing was ever cached.
  Worth revisiting in the gauge audit whether a better source exists.
- **West Cherry Creek** → `west cherry` / `west cherry creek` reads the same
  Dreamflows gauge (site `665`, above Cherry Lake) as `upper cherry` — the
  reference gauge paddlers use for both forks, with Upper Cherry's 200–500 cfs
  band carried over. It's a same-basin proxy, not a West Cherry station; and
  because two runs share the site, a 665 outage shows up twice in canary
  findings (once per run), same as the Tuolumne pair on 531.
- **Tuolumne (Main) — "the T" vs. Grand Canyon of the Tuolumne** → `tuolumne` and
  `tuolumne grand canyon` are different named runs that both read the
  identical Dreamflows gauge (site `531`, above Hetch Hetchy). Either phrase
  returns the same number.
- **NF American** → `nf american` now resolves to the Royal Gorge gauge
  (site `69`, above Lake Clementine) rather than a distinct Chamberlain
  Falls/Giant Gap station. If you're running the lower reach, treat the
  number as approximate.
- **Grand Canyon "Phantom" gauge** → `phantom` / `phantom ranch` is the same
  trip as `grand canyon` / `lees ferry` (Lee's Ferry to Lake Mead), not a
  separate run — it's a second real-time reading ~87 river miles downstream
  at Phantom Ranch (USGS `09402500`). Useful because Lees Ferry reflects
  what Glen Canyon Dam is releasing *now*, which can be a day or more ahead
  of what's actually passing a party already mid-canyon; checking `phantom`
  instead gives the locally-current number once you're down there.
- **Landsborough** → `landsborough` / `roaring billy` / `haast` all read the
  same flowrate.co.nz station (site `61`), which flowrate itself labels
  "Haast River — Roaring Billy." The gauge sits on the Haast mainstem a few
  km below the Haast/Landsborough confluence, but it's the reference gauge
  paddlers actually use for the Landsborough R trip, not a distinct Haast R
  run. Bands per packraftingtrips.nz/landsborough: 50-85 cumecs very low,
  85-100 low but good, 100-150 moderate (our low/high), 150-250 high/experts
  only — the combined Landsborough+Haast flow at that point, so treat it as
  a same-basin proxy, not a precise Landsborough-only number.
- **New Zealand reading times** → `wairaurahiri` and `landsborough` /
  `haast` pin the displayed clock time to NZST (+12:00) year-round rather
  than tracking NZDT — the flow number is always current, but the "reading
  time" line can read up to an hour off during NZ summer (late Sep–early
  Apr). Same tradeoff the California/Nevada Dreamflows gauges make for
  Pacific time.
- Always sanity-check against the source (dreamflows.com, waterdata.usgs.gov,
  wateroffice.ec.gc.ca, water.noaa.gov, envdata.es.govt.nz, or flowrate.co.nz)
  before a real go/no-go call.
