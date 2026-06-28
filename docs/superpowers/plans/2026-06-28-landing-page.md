# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build lateboof.com — a two-page static site that explains the Flow bot and shows live flows for all ~45 canonical gauges, backed by Supabase.

**Architecture:** A Supabase `gauges` table holds both static metadata (name, location, ranges) and live readings. A Supabase Edge Function (`refresh-gauges`) polls USGS/WSC/CDEC every 15 minutes via pg_cron and upserts all fields. Two plain HTML pages fetch from Supabase's public REST API using the anon key — no framework, no build step.

**Tech Stack:** Supabase (PostgreSQL + Edge Functions + pg_cron), HTML/CSS/vanilla JS, Cloudflare Pages.

## Global Constraints

- No npm packages, no bundler, no frontend framework — plain HTML/CSS/vanilla JS only
- Domain: `lateboof.com`; bot address: `flow@lateboof.com`
- Supabase anon key is intentionally public (table is read-only via RLS) — hardcode in `gauges.js`
- Colors: low = `#fee2e2` (red), good = `#dcfce7` (green), high = `#dbeafe` (blue), unavailable = `#f3f4f6` (grey)
- Max page width 900px, mobile-friendly, system font stack
- Discharge units: `cfs` for USGS/CDEC, `cms` for WSC; stage: `ft` for USGS/CDEC, `m` for WSC
- Edge Function is Deno — no Node.js APIs; use only `fetch`, `AbortController`, `setTimeout`

---

## File Map

```
web/
  index.html                  explainer page
  gauges.html                 gauge directory page
  style.css                   shared styles
  gauges.js                   fetch + render logic for gauges.html
supabase/
  migrations/
    001_gauges.sql            CREATE TABLE + RLS
  functions/
    refresh-gauges/
      index.ts                Edge Function entry point
      gauges.ts               canonical gauge list (config, not code)
```

---

## Task 1: Supabase project + DB migration

**Files:**
- Create: `supabase/migrations/001_gauges.sql`

**Interfaces:**
- Produces: `gauges` table with schema that Tasks 3, 5, 6 all depend on

- [ ] **Step 1: Create a Supabase project**

Go to [supabase.com/dashboard](https://supabase.com/dashboard), click **New project**.
- Name: `flow` (or `lateboof`)
- Region: closest to you (US East for East Coast, US West for West Coast)
- Password: save it somewhere

After creation (~2 min), grab from **Project Settings → API**:
- **Project URL** — looks like `https://abcdefgh.supabase.co`
- **anon (public)** key — starts with `eyJ...`
- **service_role** key — also starts with `eyJ...` (keep this secret — only for the Edge Function)

- [ ] **Step 2: Create the migration file**

Create `supabase/migrations/001_gauges.sql`:

```sql
create table if not exists gauges (
  key            text primary key,
  name           text not null,
  location       text not null,
  source         text not null check (source in ('usgs', 'wsc', 'cdec')),
  site           text not null,
  sensor         integer,
  dur            text,
  text_key       text not null,
  gauge_url      text not null,
  low            numeric,
  high           numeric,
  discharge      numeric,
  discharge_unit text not null default 'cfs',
  stage          numeric,
  stage_unit     text not null default 'ft',
  reading_time   timestamptz,
  updated_at     timestamptz
);

alter table gauges enable row level security;

create policy "public read"
  on gauges for select
  using (true);
```

- [ ] **Step 3: Run the migration**

In the Supabase dashboard: **SQL Editor → New query**, paste the contents of `001_gauges.sql`, click **Run**.

Verify:
- Go to **Table Editor** — `gauges` table appears with 17 columns
- No error in SQL editor

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/001_gauges.sql
git commit -m "feat: add gauges table migration"
```

---

## Task 2: Canonical gauge list + flow ranges

**Files:**
- Create: `supabase/functions/refresh-gauges/gauges.ts`

**Interfaces:**
- Produces: `GAUGES` array used by Task 3's Edge Function and by the initial data seed

This is the source of truth for every row in the `gauges` table. `low`/`high` thresholds drive the color coding on the web page. They're in native units: cfs for USGS/CDEC, cms for WSC.

**How to find AW flow ranges (US rivers):**
1. Go to `americanwhitewater.org`, search the river name
2. Open the reach detail page
3. Find the **Gauge** section — look for "Runnable Range" or "Low" / "High" values in CFS
4. Fill in `low` and `high` below. If AW doesn't list the run or shows no range, leave `null`.

**How to find Canadian ranges (WSC rivers):**
- BC Whitewater: `bcwhitewater.ca` — search the river, look for "Optimal flows" in CMS
- RiverApp: `riverapp.net` — search the river name, flow indicator thresholds

- [ ] **Step 1: Create `supabase/functions/refresh-gauges/gauges.ts`**

```typescript
export type GaugeSource = 'usgs' | 'wsc' | 'cdec';

export interface GaugeConfig {
  key: string;
  name: string;
  location: string;
  source: GaugeSource;
  site: string;
  sensor?: number;   // CDEC only
  dur?: string;      // CDEC only
  text_key: string;
  gauge_url: string;
  low: number | null;
  high: number | null;
}

// Deduped from aliases.json — one entry per physical gauge.
// Aliases that share a gauge (e.g. "mf salmon" / "middle fork salmon") are collapsed;
// text_key is the shortest usable alias a paddler can text.
// Fill in low/high from AW (US rivers) or BC Whitewater/RiverApp (Canadian).
export const GAUGES: GaugeConfig[] = [
  // ── USGS (cfs / ft) ──────────────────────────────────────────────
  { key: 'middle fork salmon', name: 'MF Salmon',        location: 'MF Lodge, ID',         source: 'usgs', site: '13309220', text_key: 'mf salmon',       gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13309220/', low: null, high: null },
  { key: 'main salmon',        name: 'Salmon R',         location: 'White Bird, ID',        source: 'usgs', site: '13317000', text_key: 'main salmon',      gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13317000/', low: null, high: null },
  { key: 'salmon shoup',       name: 'Salmon R',         location: 'Shoup, ID',             source: 'usgs', site: '13307000', text_key: 'salmon shoup',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13307000/', low: null, high: null },
  { key: 'selway',             name: 'Selway R',         location: 'Lowell, ID',            source: 'usgs', site: '13336500', text_key: 'selway',           gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13336500/', low: null, high: null },
  { key: 'grand canyon',       name: 'Colorado R',       location: 'Lees Ferry, AZ',        source: 'usgs', site: '09380000', text_key: 'grand canyon',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09380000/', low: null, high: null },
  { key: 'rogue',              name: 'Rogue R',          location: 'Agness, OR',            source: 'usgs', site: '14372300', text_key: 'rogue',            gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14372300/', low: null, high: null },
  { key: 'owyhee',             name: 'Owyhee R',         location: 'Rome, OR',              source: 'usgs', site: '14096900', text_key: 'owyhee',           gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14096900/', low: null, high: null },
  { key: 'dolores',            name: 'Dolores R',        location: 'below McPhee, CO',      source: 'usgs', site: '09169500', text_key: 'dolores',          gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09169500/', low: null, high: null },
  { key: 'san juan',           name: 'San Juan R',       location: 'Bluff, UT',             source: 'usgs', site: '09379500', text_key: 'san juan',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09379500/', low: null, high: null },
  { key: 'yampa',              name: 'Yampa R',          location: 'Maybell, CO',           source: 'usgs', site: '09251000', text_key: 'yampa',            gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09251000/', low: null, high: null },
  { key: 'green jensen',       name: 'Green R',          location: 'Jensen, UT',            source: 'usgs', site: '09261000', text_key: 'green jensen',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09261000/', low: null, high: null },
  { key: 'green river ut',     name: 'Green R',          location: 'Green River, UT',       source: 'usgs', site: '09315000', text_key: 'green river ut',   gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09315000/', low: null, high: null },
  { key: 'cataract',           name: 'Colorado R',       location: 'Cisco, UT',             source: 'usgs', site: '09180500', text_key: 'cataract',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09180500/', low: null, high: null },
  { key: 'rio grande',         name: 'Rio Grande',       location: 'Taos, NM',              source: 'usgs', site: '08276300', text_key: 'rio grande',       gauge_url: 'https://waterdata.usgs.gov/monitoring-location/08276300/', low: null, high: null },
  { key: 'illinois',           name: 'Illinois R',       location: 'Kerby, OR',             source: 'usgs', site: '14377100', text_key: 'illinois',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14377100/', low: null, high: null },
  { key: 'klamath',            name: 'Klamath R',        location: 'Orleans, CA',           source: 'usgs', site: '11523000', text_key: 'klamath',          gauge_url: 'https://waterdata.usgs.gov/monitoring-location/11523000/', low: null, high: null },
  { key: 'tuolumne',           name: 'Tuolumne R',       location: 'Mather, CA',            source: 'usgs', site: '11276600', text_key: 'tuolumne',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/11276600/', low: null, high: null },
  { key: 'john day',           name: 'John Day R',       location: 'Service Creek, OR',     source: 'usgs', site: '14046500', text_key: 'john day',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14046500/', low: null, high: null },
  { key: 'grande ronde',       name: 'Grande Ronde R',   location: 'Troy, OR',              source: 'usgs', site: '13333000', text_key: 'grande ronde',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13333000/', low: null, high: null },
  { key: 'hells canyon',       name: 'Snake R',          location: 'Hells Canyon Dam',      source: 'usgs', site: '13290450', text_key: 'hells canyon',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13290450/', low: null, high: null },
  { key: 'alsek',              name: 'Alsek R',          location: 'Dry Bay, AK',           source: 'usgs', site: '15129000', text_key: 'alsek',            gauge_url: 'https://waterdata.usgs.gov/monitoring-location/15129000/', low: null, high: null },
  { key: 'flathead',           name: 'MF Flathead R',    location: 'West Glacier, MT',      source: 'usgs', site: '12358500', text_key: 'flathead',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/12358500/', low: null, high: null },
  { key: 'smith',              name: 'Smith R',          location: 'Eden, MT',              source: 'usgs', site: '06077500', text_key: 'smith',            gauge_url: 'https://waterdata.usgs.gov/monitoring-location/06077500/', low: null, high: null },
  { key: 'allagash',           name: 'Allagash R',       location: 'Allagash, ME',          source: 'usgs', site: '01011000', text_key: 'allagash',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/01011000/', low: null, high: null },
  { key: 'black canyon',       name: 'Gunnison R',       location: 'below Crystal, CO',     source: 'usgs', site: '09127800', text_key: 'black canyon',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09127800/', low: null, high: null },
  { key: 'clarks fork',        name: 'Clarks Fork',      location: 'Belfry, MT',            source: 'usgs', site: '06207500', text_key: 'clarks fork',      gauge_url: 'https://waterdata.usgs.gov/monitoring-location/06207500/', low: null, high: null },
  { key: 'poudre',             name: 'Cache la Poudre',  location: 'Canyon Mouth, CO',      source: 'usgs', site: '06752000', text_key: 'poudre',           gauge_url: 'https://waterdata.usgs.gov/monitoring-location/06752000/', low: null, high: null },
  { key: 'bruneau',            name: 'Bruneau R',        location: 'Hot Springs, ID',       source: 'usgs', site: '13168500', text_key: 'bruneau',          gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13168500/', low: null, high: null },
  { key: 'susitna',            name: 'Susitna R',        location: 'Gold Creek, AK',        source: 'usgs', site: '15292000', text_key: 'susitna',          gauge_url: 'https://waterdata.usgs.gov/monitoring-location/15292000/', low: null, high: null },
  { key: 'south salmon',       name: 'SF Salmon R',      location: 'Krassel, ID',           source: 'usgs', site: '13310700', text_key: 'sf salmon',        gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13310700/', low: null, high: null },
  { key: 'deschutes',          name: 'Deschutes R',      location: 'Madras, OR',            source: 'usgs', site: '14092500', text_key: 'deschutes',        gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14092500/', low: null, high: null },
  { key: 'salt',               name: 'Salt R',           location: 'Roosevelt, AZ',         source: 'usgs', site: '09498500', text_key: 'salt',             gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09498500/', low: null, high: null },
  { key: 'chama',              name: 'Rio Chama',        location: 'bl El Vado, NM',        source: 'usgs', site: '08285500', text_key: 'chama',            gauge_url: 'https://waterdata.usgs.gov/monitoring-location/08285500/', low: null, high: null },
  { key: 'ruby horsethief',    name: 'Colorado R',       location: 'CO-UT line',            source: 'usgs', site: '09163500', text_key: 'ruby',             gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09163500/', low: null, high: null },

  // ── WSC / Water Survey of Canada (cms / m) ───────────────────────
  // Find ranges at bcwhitewater.ca or riverapp.net — values in cms
  { key: 'nahanni', name: 'S Nahanni R', location: 'Virginia Falls, NT', source: 'wsc', site: '10EB001', text_key: 'nahanni', gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=10EB001', low: null, high: null },
  { key: 'babine',  name: 'Babine R',    location: 'Babine Lake, BC',    source: 'wsc', site: '08EE001', text_key: 'babine',  gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08EE001', low: null, high: null },
  { key: 'chilko',  name: 'Chilko R',    location: 'Redstone, BC',       source: 'wsc', site: '08CH001', text_key: 'chilko',  gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08CH001', low: null, high: null },
  { key: 'firth',   name: 'Firth R',     location: 'near Mouth, YT',     source: 'wsc', site: '10HF001', text_key: 'firth',   gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=10HF001', low: null, high: null },
  { key: 'stikine', name: 'Stikine R',   location: 'Telegraph Creek, BC', source: 'wsc', site: '08CE001', text_key: 'stikine', gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08CE001', low: null, high: null },

  // ── CDEC / California (cfs / ft) ─────────────────────────────────
  { key: 'nf mokelumne', name: 'NF Mokelumne', location: 'ab Tiger Creek, CA', source: 'cdec', site: 'M38', sensor: 20, dur: 'H', text_key: 'nf mokelumne', gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=M38',  low: null, high: null },
  { key: 'dinkey creek', name: 'Dinkey Ck',    location: 'Dinkey siphon, CA',  source: 'cdec', site: 'DKS', sensor: 20, dur: 'E', text_key: 'dinkey creek', gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=DKS',  low: null, high: null },
  { key: 'kern',         name: 'Kern R',        location: 'Kern Canyon, CA',    source: 'cdec', site: 'KRD', sensor: 20, dur: 'E', text_key: 'kern',         gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=KRD',  low: null, high: null },
  { key: 'kings',        name: 'SF Kings R',    location: 'Boyden Cavern, CA',  source: 'cdec', site: 'KBC', sensor: 20, dur: 'E', text_key: 'kings',        gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=KBC',  low: null, high: null },
  { key: 'cherry creek', name: 'Cherry Ck',     location: 'Early Intake, CA',   source: 'cdec', site: 'CEI', sensor: 20, dur: 'E', text_key: 'cherry creek', gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=CEI',  low: null, high: null },
  { key: 'upper cherry', name: 'Upper Cherry Ck', location: 'CA',              source: 'cdec', site: 'UCC', sensor: 20, dur: 'E', text_key: 'upper cherry', gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=UCC',  low: null, high: null },
  { key: 'mf feather',   name: 'MF Feather R',  location: 'Merrimac, CA',       source: 'cdec', site: 'MER', sensor: 20, dur: 'H', text_key: 'mf feather',   gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=MER',  low: null, high: null },
  { key: 'mf american',  name: 'MF American R', location: 'Oxbow, CA',          source: 'cdec', site: 'OXB', sensor: 20, dur: 'H', text_key: 'mf american',  gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=OXB',  low: null, high: null },
  { key: 'rubicon',      name: 'Rubicon R',      location: 'bl Gerle Ck, CA',   source: 'cdec', site: 'RBG', sensor: 20, dur: 'H', text_key: 'rubicon',      gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=RBG',  low: null, high: null },
  { key: 'nf american',  name: 'NF American R', location: 'North Fork Dam, CA', source: 'cdec', site: 'NFD', sensor: 20, dur: 'E', text_key: 'nf american',  gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=NFD',  low: null, high: null },
  { key: 'sf american',  name: 'SF American R', location: 'Chili Bar, CA',      source: 'cdec', site: 'CBR', sensor: 20, dur: 'H', text_key: 'sf american',  gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=CBR',  low: null, high: null },
];
```

- [ ] **Step 2: Fill in AW flow ranges for US rivers**

For each USGS river above with `low: null, high: null`, look it up on americanwhitewater.org:
1. Search the river name → open the reach page
2. Find the Gauge section → look for runnable flow range (in CFS)
3. Set `low` to the bottom of the runnable range, `high` to the top
4. Leave `null` if AW doesn't list a range (the row will still show the flow, just without color)

For Canadian rivers (WSC), look up on `bcwhitewater.ca` or `riverapp.net` — values are in CMS.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/refresh-gauges/gauges.ts
git commit -m "feat: add canonical gauge config with metadata"
```

---

## Task 3: refresh-gauges Edge Function

**Files:**
- Create: `supabase/functions/refresh-gauges/index.ts`

**Interfaces:**
- Consumes: `GAUGES` from `./gauges.ts` (Task 2)
- Consumes: env vars `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (set automatically by Supabase runtime)
- Produces: upserted rows in `gauges` table — all fields including static metadata and live readings

This function is intentionally self-contained: it does not import from `src/`. The fetch logic is inlined (simplified versions of usgs.ts/wsc.ts/cdec.ts) to avoid Node.js/Deno compatibility concerns with the `.js` import extensions.

- [ ] **Step 1: Install Supabase CLI**

```bash
npm install -g supabase
supabase --version
```
Expected: `1.x.x` or higher.

- [ ] **Step 2: Link the CLI to your project**

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Find `YOUR_PROJECT_REF` in the Supabase dashboard URL: `https://supabase.com/dashboard/project/YOUR_PROJECT_REF`.

- [ ] **Step 3: Create the Edge Function file**

Create `supabase/functions/refresh-gauges/index.ts`:

```typescript
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { GAUGES } from './gauges.ts';

const NO_DATA = -999999;

interface Reading {
  discharge: number | null;
  stage: number | null;
  reading_time: string;
}

async function fetchUsgs(site: string): Promise<Reading> {
  const url =
    `https://waterservices.usgs.gov/nwis/iv/?format=json` +
    `&sites=${encodeURIComponent(site)}&parameterCd=00060,00065&siteStatus=all`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    // deno-lint-ignore no-explicit-any
    const body = (await res.json()) as any;
    const series: unknown[] = body.value?.timeSeries ?? [];
    let discharge: number | null = null;
    let stage: number | null = null;
    let dt = new Date().toISOString();
    for (const s of series as Array<Record<string, unknown>>) {
      // deno-lint-ignore no-explicit-any
      const code = (s.variable as any)?.variableCode?.[0]?.value as string | undefined;
      // deno-lint-ignore no-explicit-any
      const pt = (s.values as any)?.[0]?.value?.[0] as { value?: string; dateTime?: string } | undefined;
      if (pt?.dateTime) dt = pt.dateTime;
      const n = Number(pt?.value);
      if (Number.isFinite(n) && n !== NO_DATA) {
        if (code === '00060') discharge = n;
        if (code === '00065') stage = n;
      }
    }
    return { discharge, stage, reading_time: dt };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWsc(station: string): Promise<Reading> {
  const url =
    `https://api.weather.gc.ca/collections/hydrometric-realtime/items` +
    `?STATION_NUMBER=${encodeURIComponent(station)}&limit=1&sortby=-DATETIME&f=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    // deno-lint-ignore no-explicit-any
    const body = (await res.json()) as any;
    const props = body.features?.[0]?.properties;
    if (!props) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    const dt: string = props.DATETIME_LST ?? props.DATETIME ?? new Date().toISOString();
    const d = typeof props.DISCHARGE === 'number' && Number.isFinite(props.DISCHARGE) ? props.DISCHARGE as number : null;
    const s = typeof props.LEVEL === 'number' && Number.isFinite(props.LEVEL) ? props.LEVEL as number : null;
    return { discharge: d, stage: s, reading_time: dt };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCdec(station: string, sensor: number, dur: string): Promise<Reading> {
  const end = new Date();
  const start = new Date(end.getTime() - 5 * 86_400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const url =
    `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet` +
    `?Stations=${encodeURIComponent(station)}&SensorNums=${sensor}&dur_code=${dur}` +
    `&Start=${ymd(start)}&End=${ymd(end)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    const rows = (await res.json()) as Array<{ value?: number | null; obsDate?: string; units?: string }>;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    }
    const good = rows.filter(r => typeof r.value === 'number' && r.value > -9998);
    const last = good[good.length - 1];
    if (!last) return { discharge: null, stage: null, reading_time: new Date().toISOString() };
    // "2026-6-27 23:00" (CDEC PST, unpadded) → ISO with -08:00
    const m = (last.obsDate ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    const dt = m
      ? `${m[1]}-${m[2]!.padStart(2,'0')}-${m[3]!.padStart(2,'0')}T${m[4]!.padStart(2,'0')}:${m[5]}:00-08:00`
      : new Date().toISOString();
    const isStage = (last.units ?? '').toUpperCase() === 'FEET';
    return {
      discharge: isStage ? null : (last.value ?? null),
      stage:     isStage ? (last.value ?? null) : null,
      reading_time: dt,
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async () => {
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const results = await Promise.allSettled(
    GAUGES.map(async (g) => {
      let reading: Reading;
      if (g.source === 'wsc') {
        reading = await fetchWsc(g.site);
      } else if (g.source === 'cdec') {
        reading = await fetchCdec(g.site, g.sensor!, g.dur!);
      } else {
        reading = await fetchUsgs(g.site);
      }

      const { error } = await client.from('gauges').upsert({
        key: g.key,
        name: g.name,
        location: g.location,
        source: g.source,
        site: g.site,
        sensor: g.sensor ?? null,
        dur: g.dur ?? null,
        text_key: g.text_key,
        gauge_url: g.gauge_url,
        low: g.low,
        high: g.high,
        discharge: reading.discharge,
        discharge_unit: g.source === 'wsc' ? 'cms' : 'cfs',
        stage: reading.stage,
        stage_unit: g.source === 'wsc' ? 'm' : 'ft',
        reading_time: reading.reading_time,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(`${g.key}: ${error.message}`);
    }),
  );

  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => r.reason as string);

  return new Response(
    JSON.stringify({ updated: results.length - errors.length, errors }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
```

- [ ] **Step 4: Test locally**

```bash
supabase functions serve refresh-gauges --env-file .env.local
```

Create `.env.local` (not committed — add to `.gitignore`):
```
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

In a second terminal:
```bash
curl http://localhost:54321/functions/v1/refresh-gauges
```

Expected response: `{"updated": 45, "errors": []}` (or close — a few APIs may be slow/down)

Check in Supabase dashboard → Table Editor → `gauges`: rows should be populated with live data.

- [ ] **Step 5: Deploy the Edge Function**

```bash
supabase functions deploy refresh-gauges --no-verify-jwt
```

`--no-verify-jwt` allows the scheduler to call it without a Bearer token.

Expected output: `Deployed function refresh-gauges`

- [ ] **Step 6: Trigger a manual run to seed the table**

```bash
curl https://YOUR_PROJECT_ID.supabase.co/functions/v1/refresh-gauges
```

Expected: `{"updated": 45, "errors": []}`. If errors appear, check the Supabase dashboard → Edge Functions → Logs for detail.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/refresh-gauges/index.ts
git commit -m "feat: add refresh-gauges edge function"
```

---

## Task 4: Schedule the Edge Function every 15 minutes

**Files:** No new files — configured in Supabase dashboard.

**Interfaces:**
- Consumes: deployed `refresh-gauges` function (Task 3)
- Produces: automatic gauge refresh every 15 min

- [ ] **Step 1: Enable pg_cron extension**

Supabase dashboard → **Database → Extensions → Search "pg_cron" → Enable**.

- [ ] **Step 2: Create the cron job**

Supabase dashboard → **SQL Editor → New query**:

```sql
select cron.schedule(
  'refresh-gauges',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select 'https://' || current_setting('app.settings.supabase_url') || '/functions/v1/refresh-gauges'),
    headers := '{"Content-Type": "application/json"}'::jsonb
  )
  $$
);
```

If `current_setting` doesn't resolve, hardcode the URL directly:

```sql
select cron.schedule(
  'refresh-gauges',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/refresh-gauges',
    headers := '{"Content-Type": "application/json"}'::jsonb
  )
  $$
);
```

- [ ] **Step 3: Verify the schedule**

```sql
select jobname, schedule, active from cron.job;
```

Expected: one row — `refresh-gauges | */15 * * * * | t`

Wait ~15 minutes, then check the `gauges` table — `updated_at` timestamps should have advanced.

---

## Task 5: `web/index.html` + `web/style.css`

**Files:**
- Create: `web/style.css`
- Create: `web/index.html`

**Interfaces:**
- Produces: the shared CSS consumed by both HTML pages; the explainer page

- [ ] **Step 1: Create `web/style.css`**

```css
:root {
  --bg: #f9f7f4;
  --text: #1a1a1a;
  --muted: #6b7280;
  --border: #e5e7eb;
  --row-low:   #fee2e2;
  --row-good:  #dcfce7;
  --row-high:  #dbeafe;
  --row-grey:  #f3f4f6;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  padding: 2.5rem 1.25rem;
}

.container { max-width: 900px; margin: 0 auto; }

h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 0.35rem; }
h1 a { text-decoration: none; color: inherit; }

.tagline { font-size: 1.1rem; color: var(--muted); margin-bottom: 2rem; }

h2 {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 2rem 0 0.75rem;
}

.steps { list-style: none; }
.steps li {
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--border);
}
.steps li:first-child { border-top: 1px solid var(--border); }

.cta { margin-top: 1.5rem; }
.cta a { font-weight: 600; }

.footer {
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.85rem;
}

a { color: inherit; }
a:hover { text-decoration: underline; }

/* ── gauges page ── */
.meta-row {
  display: flex;
  align-items: baseline;
  gap: 1.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.legend { display: flex; gap: 1.25rem; font-size: 0.85rem; align-items: center; }
.dot {
  display: inline-block;
  width: 9px; height: 9px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
}
.dot-low  { background: #ef4444; }
.dot-good { background: #22c55e; }
.dot-high { background: #3b82f6; }

.refresh-note { font-size: 0.8rem; color: var(--muted); margin-left: auto; }

.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }

th {
  text-align: left;
  padding: 0.45rem 0.75rem;
  border-bottom: 2px solid var(--border);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted);
  white-space: nowrap;
}
td { padding: 0.45rem 0.75rem; border-bottom: 1px solid var(--border); }

tr.low   td { background: var(--row-low); }
tr.good  td { background: var(--row-good); }
tr.high  td { background: var(--row-high); }
tr.grey  td { background: var(--row-grey); color: var(--muted); }

.flow { font-variant-numeric: tabular-nums; white-space: nowrap; }
.cmd  { font-family: ui-monospace, "Cascadia Code", monospace; font-size: 0.82rem; }
.age  { color: var(--muted); font-size: 0.8rem; white-space: nowrap; }
```

- [ ] **Step 2: Create `web/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Flow — river gauges for paddlers</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1>Flow</h1>
    <p class="tagline">Text a river name from your InReach. Get the current flow back.</p>

    <h2>How it works</h2>
    <ol class="steps">
      <li>Add <strong>flow@lateboof.com</strong> as an InReach contact</li>
      <li>Text a gauge name — <em>mf salmon</em>, <em>grand canyon</em>, <em>chilko</em></li>
      <li>Get the current flow back in seconds, over satellite</li>
    </ol>

    <p class="cta">No app. No signal. No login. <a href="gauges.html">See all gauges →</a></p>

    <p class="footer">Built for paddlers, by a paddler.</p>
  </div>
</body>
</html>
```

- [ ] **Step 3: Open in browser and verify**

```bash
open web/index.html
```

Check: clean layout, off-white background, readable, link to gauges.html works.

- [ ] **Step 4: Commit**

```bash
git add web/style.css web/index.html
git commit -m "feat: add explainer landing page"
```

---

## Task 6: `web/gauges.html` + `web/gauges.js`

**Files:**
- Create: `web/gauges.html`
- Create: `web/gauges.js`

**Interfaces:**
- Consumes: Supabase REST endpoint `GET /rest/v1/gauges?select=*&order=name.asc`
- Consumes: `web/style.css` (Task 5)
- Produces: live gauge directory page with color-coded rows

- [ ] **Step 1: Create `web/gauges.js`**

Replace `YOUR_PROJECT_ID` and `YOUR_ANON_KEY` with the actual values from Supabase dashboard → Project Settings → API.

```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const ANON_KEY = 'YOUR_ANON_KEY';
const REFRESH_MS = 10 * 60 * 1000; // re-fetch every 10 min

function ageLabel(isoString) {
  if (!isoString) return '—';
  const mins = Math.floor((Date.now() - new Date(isoString).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h === 1 ? '1 hr ago' : `${h} hr ago`;
}

function rowClass(g) {
  const d = g.discharge;
  if (d == null && g.stage == null) return 'grey';
  if (g.low == null || g.high == null || d == null) return '';
  if (d < g.low) return 'low';
  if (d > g.high) return 'high';
  return 'good';
}

function flowText(g) {
  if (g.discharge != null) {
    const n = g.discharge_unit === 'cms'
      ? Number(g.discharge).toLocaleString('en-US', { maximumFractionDigits: 1 })
      : Math.round(g.discharge).toLocaleString('en-US');
    const stg = g.stage != null
      ? ` / ${Number(g.stage).toFixed(2)} ${g.stage_unit}`
      : '';
    return `${n} ${g.discharge_unit}${stg}`;
  }
  if (g.stage != null) return `${Number(g.stage).toFixed(2)} ${g.stage_unit}`;
  return '—';
}

async function load() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gauges?select=*&order=name.asc`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    render(rows);
  } catch (e) {
    document.getElementById('refresh-note').textContent =
      'Could not load gauge data — try refreshing.';
    console.error(e);
  }
}

function render(rows) {
  const tbody = document.getElementById('gauge-body');
  tbody.innerHTML = rows
    .map(
      (g) => `<tr class="${rowClass(g)}">
        <td><a href="${g.gauge_url}" target="_blank" rel="noopener">${g.name}</a></td>
        <td>${g.location}</td>
        <td class="flow">${flowText(g)}</td>
        <td class="cmd">${g.text_key}</td>
        <td class="age">${ageLabel(g.reading_time)}</td>
      </tr>`,
    )
    .join('');

  const fetchedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  document.getElementById('refresh-note').textContent =
    `Gauge data refreshes every 15 min · fetched at ${fetchedAt}`;
}

load();
setInterval(load, REFRESH_MS);
```

- [ ] **Step 2: Create `web/gauges.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gauges — Flow</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1><a href="index.html">Flow</a></h1>
    <p class="tagline">Live flows for all supported gauges</p>

    <div class="meta-row">
      <div class="legend">
        <span><span class="dot dot-low"></span>Low</span>
        <span><span class="dot dot-good"></span>Good</span>
        <span><span class="dot dot-high"></span>High</span>
      </div>
      <span class="refresh-note" id="refresh-note">Loading…</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>River</th>
            <th>Location</th>
            <th>Flow</th>
            <th>Text this</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody id="gauge-body"></tbody>
      </table>
    </div>

    <p class="footer">
      <a href="index.html">← How it works</a> · flow@lateboof.com
    </p>
  </div>
  <script src="gauges.js"></script>
</body>
</html>
```

- [ ] **Step 3: Verify in browser**

Open `web/gauges.html` in a browser (note: the fetch will fail if opening as `file://` due to CORS). Use a local server:

```bash
npx serve web
```

Expected: table loads with live data, rows colored (green/red/blue) where ranges are set, grey for unavailable, plain white where range is null.

- [ ] **Step 4: Commit**

```bash
git add web/gauges.html web/gauges.js
git commit -m "feat: add live gauge directory page"
```

---

## Task 7: Deploy to Cloudflare Pages

**Files:**
- No new files — uses the `web/` directory as the build output

- [ ] **Step 1: Push the repo to GitHub**

If no remote exists yet:

```bash
git remote add origin https://github.com/YOUR_USERNAME/flow.git
git push -u origin main
```

- [ ] **Step 2: Connect to Cloudflare Pages**

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create application → Pages → Connect to Git**
2. Select the `flow` repository
3. Configure:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `web`
4. Click **Save and Deploy**

First deployment takes ~1 min. Cloudflare assigns a `*.pages.dev` URL.

- [ ] **Step 3: Add the custom domain**

Cloudflare Pages → your project → **Custom domains → Set up a custom domain**:
- Enter `lateboof.com`
- Follow the DNS instructions (add a CNAME record in Cloudflare DNS)
- Also add `www.lateboof.com` and redirect it to `lateboof.com` via a Page Rule or Redirect Rule

- [ ] **Step 4: Verify production**

Open `https://lateboof.com` — index page loads.
Open `https://lateboof.com/gauges.html` — table loads with live data.

Check that colors are rendering correctly for rivers where you filled in `low`/`high` in Task 2.

- [ ] **Step 5: Add `.gitignore` entry for local env file**

```bash
echo ".env.local" >> .gitignore
git add .gitignore
git commit -m "chore: ignore local env file"
```

---

## Self-Review

**Spec coverage:**
- ✅ Two pages: explainer + gauge directory
- ✅ Supabase data layer with pg_cron refresh
- ✅ Color coding: red/green/blue by flow range
- ✅ Link from each row to gauge source page
- ✅ "Text this" column shows shortest alias
- ✅ Live refresh every 10 min on the page
- ✅ No login, no framework, no build step
- ✅ Cloudflare Pages deployment
- ✅ AW ranges (Task 2 step 2 — manual but explicit process)
- ✅ Canadian ranges (Task 2 step 2 — BCW/RiverApp process noted)

**Placeholders:** None. All code is complete. `YOUR_PROJECT_ID` / `YOUR_ANON_KEY` in `gauges.js` are intentional tokens for the implementer to replace with real values in Task 6 Step 1 — this is a runtime configuration step, not a placeholder.

**Type consistency:** `GaugeConfig` defined in Task 2 is the only type used in Task 3 — names match. `rowClass`, `flowText`, `ageLabel` defined and used within Task 6 only.
