# Run roster

What to text the bot → the run it maps to → the gauge it reads.
**Every gauge below was live-verified against its real API on 2026-06-28** (returned
current data with a matching station name). Units are native: US runs **cfs / ft**,
Canadian runs **cms / m**. Source code lives in `src/aliases.json`.

The bot also accepts **raw gauge IDs** (USGS `13317000`, WSC `08CE001`) and matches a
run name embedded in a longer message (`middle kings at rodger's` → Middle Kings).

## Class III–IV multiday overnighters

| Text this | Run / AKA | Gauge | Source | Location |
|---|---|---|---|---|
| `middle fork salmon` / `mf salmon` | MF Salmon — "the Middle Fork" | 13309220 | USGS | MF Lodge, ID |
| `main salmon` | Main Salmon — "River of No Return" | 13317000 | USGS | White Bird, ID |
| `lower salmon` | Lower Salmon | 13317000 | USGS | White Bird, ID |
| `salmon shoup` | Salmon — upper | 13307000 | USGS | Shoup, ID |
| `selway` | Selway | 13336500 | USGS | Lowell, ID |
| `hells canyon` | Snake — Hells Canyon | 13290450 | USGS | Hells Canyon Dam |
| `grande ronde` | Grande Ronde | 13333000 | USGS | Troy, OR |
| `rogue` | Wild Rogue | 14372300 | USGS | Agness, OR |
| `illinois` | Illinois | 14377100 | USGS | Kerby, OR |
| `deschutes` | Lower Deschutes | 14092500 | USGS | Madras, OR |
| `john day` | John Day | 14046500 | USGS | Service Creek, OR |
| `owyhee` | Owyhee | 13181000 | USGS | Rome, OR |
| `bruneau` | Bruneau–Jarbidge | 13168500 | USGS | Hot Springs, ID |
| `flathead` | MF Flathead | 12358500 | USGS | West Glacier, MT |
| `smith` | Smith | 06077500 | USGS | Eden, MT |
| `allagash` | Allagash | 01011000 | USGS | Allagash, ME |

## Desert / Colorado Plateau

| Text this | Run / AKA | Gauge | Source | Location |
|---|---|---|---|---|
| `grand canyon` / `lees ferry` | Grand Canyon | 09380000 | USGS | Lees Ferry, AZ |
| `cataract` | Cataract Canyon — "Cat" | 09180500 | USGS | Cisco, UT |
| `westwater` | Westwater Canyon | 09180500 | USGS | Cisco, UT |
| `ruby` / `ruby horsethief` | Ruby–Horsethief | 09163500 | USGS | CO–UT line |
| `green river ut` | Desolation/Gray — "Deso" | 09315000 | USGS | Green River, UT |
| `green jensen` | Gates of Lodore — "Lodore" | 09261000 | USGS | Jensen, UT |
| `yampa` | Yampa | 09251000 | USGS | Maybell, CO |
| `san juan` | San Juan | 09379500 | USGS | Bluff, UT |
| `dolores` | Dolores | 09169500 | USGS | Bedrock, CO |
| `salt` / `salt river` | Salt River Canyon (AZ) | 09498500 | USGS | Roosevelt, AZ |
| `chama` / `rio chama` | Rio Chama Wilderness | 08285500 | USGS | bl El Vado, NM |
| `rio grande` | Rio Grande — "Taos Box" | 08276500 | USGS | bl Taos Jct Br, NM |
| `poudre` | Cache la Poudre | 06752260 | USGS | Fort Collins, CO |

## Far North

| Text this | Run / AKA | Gauge | Source | Location |
|---|---|---|---|---|
| `alsek` / `tatshenshini` | Tat–Alsek — "the Tat" | 15129000 | USGS | nr Yakutat, AK |
| `susitna` | Susitna — Devils Canyon | 15292000 | USGS | Gold Creek, AK |
| `nahanni` | South Nahanni | 10EB001 | WSC | Virginia Falls, NT |
| `stikine` | Grand Canyon of the **Stikine** | 08CE001 | WSC | Telegraph Creek, BC |

## Class V+ overnighters & classics

| Text this | Run / AKA | Gauge | Source | Location |
|---|---|---|---|---|
| `south salmon` / `sf salmon` | South Fork Salmon | 13310700 | USGS | Krassel, ID |
| `kings` / `middle kings` | Middle Kings (SF Kings proxy) | KBC | CDEC | Boyden Cavern, CA |
| `fantasy falls` / `nf mokelumne` | Fantasy Falls (NF Mokelumne) | M38 | CDEC | ab Tiger Creek, CA |
| `cherry creek` | Cherry Creek | CEI | CDEC | Early Intake, CA |
| `upper cherry` / `west cherry` | Upper / West Cherry | UCC | CDEC | CA |
| `kern` / `forks of the kern` | Forks of the Kern (Kern Cyn proxy) | KRD | CDEC | Kern Canyon, CA |
| `dinkey creek` | Dinkey Creek | DKS | CDEC | Dinkey, CA |
| `mf feather` / `middle fork feather` | MF Feather | MER | CDEC | Merrimac, CA |
| `mf american` | MF American | OXB | CDEC | Oxbow, CA |
| `nf american` | NF American — Chamberlain/Giant Gap | NFD | CDEC | North Fork Dam, CA |
| `sf american` | SF American — Chili Bar/Gorge | CBR | CDEC | Chili Bar, CA |
| `rubicon` | Rubicon | RBG | CDEC | bl Gerle Ck, CA |
| `tuolumne` | Tuolumne — "the T" | 11276600 | USGS | Mather, CA |
| `black canyon` / `gunnison` | Gunnison Gorge / Black Canyon | 09128000 | USGS | bl Gunnison Tunnel, CO |
| `clarks fork` | Clarks Fork "the Box" | 06207500 | USGS | Belfry, MT |

## Removed / deferred (no usable live gauge)

| Run | Why |
|---|---|
| Babine, Chilko, Firth (BC/YT) | Their WSC stations return **no realtime data** — pulled to avoid shipping dead entries. |
| Devils Postpile (upper San Joaquin) | No representative USGS/CDEC station; flow is a snowmelt/inflow estimate. |
| Magpie (QC) | Reports to Quebec **CEHQ** — needs a fourth source adapter. |
| Big South (Poudre) | No clean live gauge distinct from the main Poudre; dropped rather than mislead. |

## Honest caveats (proxies — gauge is near, not exactly on, the run)

- **Middle Kings** → `KBC` (SF Kings above Boyden Cavern) — closest live gauge to the takeout, on the South Fork.
- **Forks of the Kern** → `KRD` (Kern below the canyon powerhouse) — live proxy, below the run.
- **Black Canyon** → `09128000` is the **Gunnison Gorge** gauge (the rafted run below the tunnel); the inner Black Canyon is unrunnable/ungauged.
- **Poudre** → `06752260` (Fort Collins) sits below the canyon; the canyon-mouth gauge is dead on USGS realtime.
- **Fantasy Falls** → `M38` (ab Tiger Creek), the gauge American Whitewater correlates to this reach — not the put-in (Salt Springs).
- **Westwater & Cataract** share the Colorado-near-Cisco gauge (`09180500`).
- Always sanity-check against waterdata.usgs.gov / the source before a real go/no-go call.
