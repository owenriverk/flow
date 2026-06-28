# Run roster

What to text the bot (the alias), the run it maps to, the gauge, and where it reads.
Units are native: US runs cfs/ft, Canadian runs cms/m. Generated/verified against
live USGS / WSC / CDEC data.

## Class III–IV multiday overnighters

| Text this | Run / AKA | Gauge | Location |
|---|---|---|---|
| `middle fork salmon` / `mf salmon` | MF Salmon — "the Middle Fork" | USGS 13309220 | MF Lodge, ID |
| `main salmon` | Main Salmon — "River of No Return" | USGS 13317000 | White Bird, ID |
| `lower salmon` | Lower Salmon | USGS 13317000 | White Bird, ID |
| `salmon shoup` | Salmon — upper | USGS 13307000 | Shoup, ID |
| `selway` | Selway | USGS 13336500 | Lowell, ID |
| `hells canyon` | Snake — Hells Canyon | USGS 13290450 | Hells Canyon Dam |
| `grande ronde` | Grande Ronde | USGS 13333000 | Troy, OR |
| `rogue` | Wild Rogue | USGS 14372300 | Agness, OR |
| `illinois` | Illinois | USGS 14377100 | Kerby, OR |
| `deschutes` | Lower Deschutes | USGS 14092500 | Madras, OR |
| `john day` | John Day | USGS 14046500 | Service Creek, OR |
| `owyhee` | Owyhee | USGS 14096900 | Rome, OR |
| `bruneau` | Bruneau–Jarbidge | USGS 13168500 | Hot Springs, ID |
| `flathead` | MF Flathead | USGS 12358500 | West Glacier, MT |
| `smith` | Smith | USGS 06077500 | Eden, MT |
| `allagash` | Allagash | USGS 01011000 | Allagash, ME |

## Desert / Colorado Plateau

| Text this | Run / AKA | Gauge | Location |
|---|---|---|---|
| `grand canyon` / `lees ferry` | Grand Canyon | USGS 09380000 | Lees Ferry, AZ |
| `cataract` | Cataract Canyon — "Cat" | USGS 09180500 | Cisco, UT |
| `westwater` | Westwater Canyon | USGS 09180500 | Cisco, UT |
| `ruby` / `ruby horsethief` | Ruby–Horsethief | USGS 09163500 | CO–UT line |
| `green river ut` | Desolation/Gray — "Deso" | USGS 09315000 | Green River, UT |
| `green jensen` | Gates of Lodore — "Lodore" | USGS 09261000 | Jensen, UT |
| `yampa` | Yampa | USGS 09251000 | Maybell, CO |
| `san juan` | San Juan | USGS 09379500 | Bluff, UT |
| `dolores` | Dolores | USGS 09169500 | bl McPhee, CO |
| `salt` / `salt river` | Salt River Canyon (AZ) | USGS 09498500 | Roosevelt, AZ |
| `chama` / `rio chama` | Rio Chama Wilderness | USGS 08285500 | bl El Vado, NM |
| `rio grande` | Rio Grande — "Taos Box" | USGS 08276300 | Taos, NM |
| `poudre` / `big south` | Cache la Poudre / Big South | USGS 06752000 | Canyon Mouth, CO |

## Far North

| Text this | Run / AKA | Gauge | Location |
|---|---|---|---|
| `alsek` / `tatshenshini` | Tat–Alsek — "the Tat" | USGS 15129000 | Dry Bay, AK |
| `susitna` | Susitna — Devils Canyon | USGS 15292000 | Gold Creek, AK |
| `nahanni` | South Nahanni | WSC 10EB001 | Virginia Falls, NT |
| `firth` | Firth | WSC 10HF001 | near mouth, YT |
| `babine` | Babine | WSC 08EE001 | Babine Lake, BC |
| `chilko` | Chilko | WSC 08CH001 | Redstone, BC |

## Class V+ overnighters & classics

| Text this | Run / AKA | Gauge | Location |
|---|---|---|---|
| `stikine` | Grand Canyon of the **Stikine** | WSC 08CE001 | Telegraph Creek, BC |
| `south salmon` / `sf salmon` | South Fork Salmon | USGS 13310700 | Krassel, ID |
| `kings` / `middle kings` | Middle Kings (SF Kings proxy) | CDEC KBC | Boyden Cavern, CA |
| `fantasy falls` / `nf mokelumne` | Fantasy Falls (NF Mokelumne) | CDEC M38 | ab Tiger Creek, CA |
| `upper cherry` | Upper Cherry Creek | CDEC UCC | CA |
| `west cherry` | West Cherry (Upper Cherry drainage) | CDEC UCC | CA |
| `cherry creek` | Cherry Creek | CDEC CEI | Early Intake, CA |
| `kern` / `forks of the kern` | Forks of the Kern (Kern Cyn proxy) | CDEC KRD | Kern Canyon, CA |
| `dinkey creek` | Dinkey Creek | CDEC DKS | Dinkey, CA |
| `mf american` | MF American | CDEC OXB | Oxbow, CA |
| `nf american` | NF American — Chamberlain/Giant Gap | CDEC NFD | North Fork Dam, CA |
| `sf american` | SF American — Chili Bar/Gorge | CDEC CBR | Chili Bar, CA |
| `rubicon` | Rubicon | CDEC RBG | bl Gerle Ck, CA |
| `tuolumne` | Tuolumne — "the T" | USGS 11276600 | Mather, CA |
| `black canyon` | Black Canyon of the Gunnison | USGS 09127800 | bl Crystal, CO |
| `clarks fork` | Clarks Fork "the Box" | USGS 06207500 | Belfry, MT |

## No live gauge (deferred)

| Run | Why |
|---|---|
| Devils Postpile (upper San Joaquin) | No representative USGS/CDEC station; flow is a snowmelt/inflow estimate. Nearest gauge (Auberry) is far downstream and would mislead. |
| Magpie (QC) | Reports to Quebec CEHQ — needs a fourth source adapter. |

## Notes / honest caveats
- **Middle Kings** uses `KBC` (SF Kings above Boyden Cavern) — the closest *live* gauge to
  the takeout, on the South Fork, not the Middle. Labeled by its real location.
- **Forks of the Kern** uses `KRD` (Kern below the canyon powerhouse) — live proxy, not the
  exact Forks reach.
- **Westwater & Cataract** share the Colorado-near-Cisco gauge (`09180500`).
- Verify any gauge against waterdata.usgs.gov / the source before a real go/no-go call.

## American Whitewater cross-reference (2026-06-28)
AW's reach pages are the authority for which gauge a run uses. Status of the check:
- **Fantasy Falls / NF Mokelumne** — AW correlates this reach to CDEC **M38** (ab Tiger
  Creek), not M11 (bl Salt Springs Dam). **Changed M11 → M38** to match AW's beta.
- **Forks of the Kern** — AW uses a **Dreamflows estimate** (Chris Shackleton), not a clean
  station. Our `KRD` (Kern bl Kern Cyn PH) is a live proxy that trends right but won't match
  Dreamflows numbers exactly. Flagged.
- **Middle Kings** — AW reach is "Dusy Branch → S. Fork confluence"; our `KBC` (SF Kings ab
  Boyden Cavern) sits at that takeout. Geographically aligned.
- **Canonical USGS runs** (Grand Canyon/Lees Ferry, Main Salmon/White Bird, etc.) — AW uses
  the same standard gauges; not in doubt.
- **Not yet cross-referenced:** AW's site was returning HTTP 502 (their outage) during this
  pass, so the remaining CA CDEC runs (Cherry, Dinkey, MF/NF/SF American, Rubicon) still need
  an AW check. Re-run when AW is back up.
