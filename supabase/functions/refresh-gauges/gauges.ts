export type GaugeSource = 'usgs' | 'wsc' | 'cdec' | 'dreamflows' | 'noaa';

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

// Units: cfs for USGS/CDEC/Dreamflows, cms for WSC.
export const GAUGES: GaugeConfig[] = [

  // ── Dreamflows / California virtual gauges (cfs) ──────────────────
  { key: 'kings',                  name: 'Kings R (Middle Fork)',            location: 'At Rodgers Crossing, CA',           source: 'dreamflows',  site: '100',  text_key: 'kings',                  gauge_url: 'https://www.dreamflows.com/graphs/day.100.php',  low: 1000,  high: 3000 },
  { key: 'fantasy',                name: 'NF Mokelumne R (Fantasy Falls)',   location: 'Above Salt Springs, CA',            source: 'dreamflows',  site: '111',  text_key: 'fantasy',                gauge_url: 'https://www.dreamflows.com/graphs/mon.111.php',  low: 300,   high: 700 },
  { key: 'royal gorge',            name: 'N Fork American R (Royal Gorge)',  location: 'Above Lake Clementine, CA',         source: 'dreamflows',  site: '69',   text_key: 'royal gorge',            gauge_url: 'https://www.dreamflows.com/graphs/day.069.php',  low: 300,   high: 1200 },
  { key: 'postpile',               name: 'San Joaquin R (Postpile)',         location: 'At Devils Postpile, CA',            source: 'dreamflows',  site: '494',  text_key: 'postpile',               gauge_url: 'https://www.dreamflows.com/graphs/day.494.php',  low: 300,   high: 1000 },
  { key: 'south merced',           name: 'Merced R (South Fork)',            location: 'At Wawona, CA',                     source: 'dreamflows',  site: '181',  text_key: 'south merced',           gauge_url: 'https://www.dreamflows.com/graphs/day.181.php',  low: 300,   high: 800 },
  { key: 'tuolumne grand canyon',  name: 'Tuolumne R (Grand Canyon)',        location: 'Above Hetch Hetchy Reservoir, CA',  source: 'dreamflows',  site: '531',  text_key: 'tuolumne grand canyon',  gauge_url: 'https://www.dreamflows.com/graphs/day.531.php',  low: 700,   high: 2000 },
  { key: 'tuolumne',               name: 'Tuolumne R',                       location: 'Above Hetch Hetchy Reservoir, CA',  source: 'dreamflows',  site: '531',  text_key: 'tuolumne',               gauge_url: 'https://www.dreamflows.com/graphs/day.531.php',  low: 700,   high: 2000 },
  { key: 'upper cherry',           name: 'Cherry Creek (Upper)',             location: 'Above Cherry Lake, CA',             source: 'dreamflows',  site: '665',  text_key: 'upper cherry',           gauge_url: 'https://www.dreamflows.com/graphs/day.665.php',  low: 200,   high: 500 },
  { key: 'bald rock feather',      name: 'Feather R (Bald Rock)',            location: 'At Milsap Bar, CA',                 source: 'dreamflows',  site: '54',   text_key: 'bald rock',              gauge_url: 'https://www.dreamflows.com/graphs/day.054.php',  low: 1000,  high: 4000 },

  // ── Pacific Northwest USGS (cfs) ─────────────────────────────────
  { key: 'rogue',               name: 'Rogue R',                 location: 'Near Agness, OR',                  source: 'usgs',  site: '14372300',  text_key: 'rogue',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14372300/',  low: 800,   high: 5000 },
  { key: 'deschutes',           name: 'Deschutes R',             location: 'At Moody, OR',                     source: 'usgs',  site: '14103000',  text_key: 'deschutes',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14103000/',  low: 3000,  high: 8000 },
  { key: 'john day',            name: 'John Day R',              location: 'At Service Creek, OR',             source: 'usgs',  site: '14046500',  text_key: 'john day',      gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14046500/',  low: 400,   high: 2500 },
  { key: 'grande ronde',        name: 'Grande Ronde R',          location: 'At Troy, OR',                      source: 'usgs',  site: '13333000',  text_key: 'grande ronde',  gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13333000/',  low: 1500,  high: 5000 },
  { key: 'selway',              name: 'Selway R',                location: 'Near Lowell, ID',                  source: 'usgs',  site: '13336500',  text_key: 'selway',        gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13336500/',  low: 2000,  high: 6000 },
  { key: 'hells canyon',        name: 'Snake R (Hells Canyon)',  location: 'At Hells Canyon Dam, OR-ID',       source: 'usgs',  site: '13290450',  text_key: 'hells canyon',  gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13290450/',  low: 3000,  high: 15000 },
  { key: 'main salmon',         name: 'Salmon R (Main)',         location: 'At White Bird, ID',                source: 'usgs',  site: '13317000',  text_key: 'main salmon',   gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13317000/',  low: 5000,  high: 20000 },
  { key: 'middle fork salmon',  name: 'Salmon R (Middle Fork)',  location: 'At MF Lodge, ID',                  source: 'usgs',  site: '13309220',  text_key: 'mf salmon',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13309220/',  low: 2000,  high: 7000 },
  { key: 'south salmon',        name: 'Salmon R (South Fork)',   location: 'Near Krassel Ranger Station, ID',  source: 'usgs',  site: '13310700',  text_key: 'sf salmon',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13310700/',  low: 1000,  high: 3500 },
  { key: 'owyhee',              name: 'Owyhee R',                location: 'Near Rome, OR',                    source: 'usgs',  site: '13181000',  text_key: 'owyhee',        gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13181000/',  low: 300,   high: 2500 },

  // ── Montana / Idaho USGS (cfs) ──────────────────────────────────
  { key: 'clarks fork',  name: 'Clarks Fork',               location: 'Near Belfry, MT',          source: 'usgs',  site: '06207500',  text_key: 'clarks fork',  gauge_url: 'https://waterdata.usgs.gov/monitoring-location/06207500/',  low: 400,   high: 1200 },
  { key: 'flathead mf',  name: 'Flathead R (Middle Fork)',  location: 'Near West Glacier, MT',    source: 'usgs',  site: '12358500',  text_key: 'flathead',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/12358500/',  low: 2000,  high: 10000 },
  { key: 'flathead nf',  name: 'Flathead R (North Fork)',   location: 'Near Columbia Falls, MT',  source: 'usgs',  site: '12355500',  text_key: 'nf flathead',  gauge_url: 'https://waterdata.usgs.gov/monitoring-location/12355500/',  low: 2000,  high: 8000 },

  // ── Rocky Mountain / Southwest USGS (cfs) ───────────────────────
  { key: 'yampa',            name: 'Yampa R',                    location: 'At Deerlodge Park, CO',  source: 'usgs',  site: '09260050',  text_key: 'yampa',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09260050/',  low: 1000,  high: 8000 },
  { key: 'gates of lodore',  name: 'Green R (Gates of Lodore)',  location: 'Near Greendale, UT',     source: 'usgs',  site: '09234500',  text_key: 'lodore',        gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09234500/',  low: 1500,  high: 5000 },
  { key: 'deso grey',        name: 'Green R (Desolation)',       location: 'At Green River, UT',     source: 'usgs',  site: '09315000',  text_key: 'deso grey',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09315000/',  low: 3000,  high: 15000 },
  { key: 'san juan',         name: 'San Juan R',                 location: 'Near Bluff, UT',         source: 'usgs',  site: '09379500',  text_key: 'san juan',      gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09379500/',  low: 500,   high: 5000 },
  { key: 'cataract',         name: 'Colorado R (Cataract)',      location: 'Near Hite, UT',          source: 'usgs',  site: '09328960',  text_key: 'cataract',      gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09328960/',  low: 5000,  high: 40000 },
  { key: 'grand canyon',     name: 'Colorado R (Grand Canyon)',  location: 'At Lees Ferry, AZ',      source: 'usgs',  site: '09380000',  text_key: 'grand canyon',  gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09380000/',  low: 5000,  high: 25000 },
  { key: 'salt',             name: 'Salt R',                     location: 'Near Chrysotile, AZ',    source: 'usgs',  site: '09497500',  text_key: 'salt',          gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09497500/',  low: 800,   high: 3000 },

  // ── Alaska USGS (cfs) ────────────────────────────────────────────
  { key: 'susitna',  name: 'Susitna R',  location: 'At Gold Creek, AK',  source: 'usgs',  site: '15292000',  text_key: 'susitna',  gauge_url: 'https://waterdata.usgs.gov/monitoring-location/15292000/',  low: 3000,  high: 10000 },

  // ── BC / Yukon WSC (cms) ──────────────────────────────────────────
  { key: 'tatshenshini',  name: 'Tatshenshini R',      location: 'Near Dalton Post, YT',         source: 'wsc',   site: '08AC002',  text_key: 'tat',         gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08AC002', low: 85,    high: 184 },
  { key: 'alsek',         name: 'Alsek R',             location: 'Above Bates River, YT',        source: 'wsc',   site: '08AB001',  text_key: 'alsek',       gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08AB001',  low: 565,   high: 1135 },
  { key: 'stikine',       name: 'Stikine R',           location: 'At Telegraph Creek, BC',       source: 'wsc',   site: '08CE001',  text_key: 'stikine',     gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08CE001',  low: 400,   high: 1500 },
  { key: 'iskut',         name: 'Iskut R',             location: 'Below Johnson River, BC',      source: 'wsc',   site: '08CG001',  text_key: 'iskut',       gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08CG001',  low: 100,   high: 500 },
  { key: 'calor',         name: 'Zymoetz R (Copper)',  location: 'Above O.K. Creek, BC',         source: 'wsc',   site: '08EF005',  text_key: 'calor',       gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08EF005',  low: 50,    high: 200 },
  { key: 'clearwater',    name: 'Clearwater R',        location: 'Near Clearwater Station, BC',  source: 'wsc',   site: '08LA001',  text_key: 'clearwater',  gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08LA001',  low: 50,    high: 200 },
];
