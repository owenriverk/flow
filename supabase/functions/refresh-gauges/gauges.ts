export type GaugeSource = 'usgs' | 'wsc' | 'cdec' | 'dreamflows';

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
  { key: 'kings',               name: 'Middle Kings R',   location: 'Rodgers Crossing, CA', source: 'dreamflows', site: '100', text_key: 'kings',               gauge_url: 'https://www.dreamflows.com/graphs/day.100.php', low: 1000, high: 3000 },
  { key: 'fantasy',             name: 'Fantasy Falls',    location: 'NF Mokelumne, CA',     source: 'dreamflows', site: '111', text_key: 'fantasy',             gauge_url: 'https://www.dreamflows.com/graphs/mon.111.php', low: 300,  high: 700  },
  { key: 'royal gorge',         name: 'Royal Gorge',      location: 'CA',                   source: 'dreamflows', site: '69',  text_key: 'royal gorge',         gauge_url: 'https://www.dreamflows.com/graphs/day.069.php', low: 300,  high: 1200 },
  { key: 'postpile',            name: 'Postpile',         location: 'MF San Joaquin, CA',   source: 'dreamflows', site: '494', text_key: 'postpile',            gauge_url: 'https://www.dreamflows.com/graphs/day.494.php', low: 300,  high: 1000 },
  { key: 'south merced',        name: 'South Merced R',   location: 'CA',                   source: 'dreamflows', site: '181', text_key: 'south merced',        gauge_url: 'https://www.dreamflows.com/graphs/day.181.php', low: 300,  high: 800  },
  { key: 'tuolumne grand canyon',name: 'Tuolumne R',      location: 'Grand Canyon, CA',     source: 'dreamflows', site: '531', text_key: 'tuolumne grand canyon',gauge_url: 'https://www.dreamflows.com/graphs/day.531.php', low: 700,  high: 2000 },
  { key: 'tuolumne',            name: 'Tuolumne R',       location: 'at Mather, CA',        source: 'dreamflows', site: '531', text_key: 'tuolumne',            gauge_url: 'https://www.dreamflows.com/graphs/day.531.php', low: 700,  high: 2000 },
  { key: 'upper cherry',        name: 'Upper Cherry Ck',  location: 'CA',                   source: 'dreamflows', site: '665', text_key: 'upper cherry',        gauge_url: 'https://www.dreamflows.com/graphs/day.665.php', low: 200,  high: 500  },
  { key: 'bald rock feather',   name: 'Bald Rock Canyon', location: 'Feather R, CA',        source: 'dreamflows', site: '54',  text_key: 'bald rock',           gauge_url: 'https://www.dreamflows.com/graphs/day.054.php', low: 1000, high: 4000 },

  // ── Pacific Northwest USGS (cfs) ─────────────────────────────────
  { key: 'rogue',         name: 'Rogue R',        location: 'Agness, OR',          source: 'usgs', site: '14372300', text_key: 'rogue',        gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14372300/', low: 800,  high: 5000  },
  { key: 'deschutes',     name: 'Deschutes R',    location: 'Moody, OR',           source: 'usgs', site: '14103000', text_key: 'deschutes',    gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14103000/', low: 3000, high: 8000  },
  { key: 'john day',      name: 'John Day R',     location: 'Service Creek, OR',   source: 'usgs', site: '14046500', text_key: 'john day',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14046500/', low: 400,  high: 2500  },
  { key: 'grande ronde',  name: 'Grande Ronde R', location: 'Troy, OR',            source: 'usgs', site: '13333000', text_key: 'grande ronde', gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13333000/', low: 1500, high: 5000  },
  { key: 'selway',        name: 'Selway R',       location: 'Lowell, ID',          source: 'usgs', site: '13336500', text_key: 'selway',       gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13336500/', low: 2000, high: 6000  },
  { key: 'hells canyon',  name: 'Snake R',        location: 'Hells Canyon Dam',    source: 'usgs', site: '13290450', text_key: 'hells canyon', gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13290450/', low: 3000, high: 15000 },
  { key: 'main salmon',   name: 'Salmon R',       location: 'White Bird, ID',      source: 'usgs', site: '13317000', text_key: 'main salmon',  gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13317000/', low: 5000, high: 20000 },
  { key: 'middle fork salmon', name: 'MF Salmon', location: 'MF Lodge, ID',        source: 'usgs', site: '13309220', text_key: 'mf salmon',    gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13309220/', low: 2000, high: 7000  },
  { key: 'south salmon',  name: 'SF Salmon R',    location: 'Krassel, ID',         source: 'usgs', site: '13310700', text_key: 'sf salmon',    gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13310700/', low: 1000, high: 3500  },
  { key: 'owyhee',        name: 'Owyhee R',       location: 'Rome, OR',            source: 'usgs', site: '13181000', text_key: 'owyhee',       gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13181000/', low: 300,  high: 2500  },

  // ── Montana / Idaho USGS (cfs) ──────────────────────────────────
  { key: 'clarks fork',  name: 'Clarks Fork',    location: 'Belfry, MT',          source: 'usgs', site: '06207500', text_key: 'clarks fork',  gauge_url: 'https://waterdata.usgs.gov/monitoring-location/06207500/', low: 400,  high: 1200  },
  { key: 'flathead mf',  name: 'MF Flathead R',  location: 'West Glacier, MT',    source: 'usgs', site: '12358500', text_key: 'flathead',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/12358500/', low: 2000, high: 10000 },
  { key: 'flathead nf',  name: 'NF Flathead R',  location: 'Glacier NP, MT',      source: 'usgs', site: '12355500', text_key: 'nf flathead',  gauge_url: 'https://waterdata.usgs.gov/monitoring-location/12355500/', low: 2000, high: 8000  },

  // ── Rocky Mountain / Southwest USGS (cfs) ───────────────────────
  { key: 'yampa',          name: 'Yampa R',      location: 'Deerlodge Park, CO',  source: 'usgs', site: '09260050', text_key: 'yampa',        gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09260050/', low: 1000, high: 8000  },
  { key: 'gates of lodore',name: 'Green R',      location: 'Gates of Lodore, CO', source: 'usgs', site: '09234500', text_key: 'lodore',       gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09234500/', low: 1500, high: 5000  },
  { key: 'deso grey',      name: 'Green R',      location: 'Desolation Canyon, UT',source: 'usgs', site: '09315000', text_key: 'deso grey',   gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09315000/', low: 3000, high: 15000 },
  { key: 'san juan',       name: 'San Juan R',   location: 'Bluff, UT',           source: 'usgs', site: '09379500', text_key: 'san juan',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09379500/', low: 500,  high: 5000  },
  { key: 'cataract',       name: 'Colorado R',   location: 'Cataract Canyon, UT', source: 'usgs', site: '09328960', text_key: 'cataract',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09328960/', low: 5000, high: 40000 },
  { key: 'grand canyon',   name: 'Colorado R',   location: 'Lees Ferry, AZ',      source: 'usgs', site: '09380000', text_key: 'grand canyon', gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09380000/', low: 5000, high: 25000 },
  { key: 'salt',           name: 'Salt R',       location: 'Chrysotile, AZ',      source: 'usgs', site: '09497500', text_key: 'salt',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09497500/', low: 800,  high: 3000  },

  // ── Alaska USGS (cfs) ────────────────────────────────────────────
  { key: 'susitna', name: 'Susitna R', location: 'Gold Creek, AK', source: 'usgs', site: '15292000', text_key: 'susitna', gauge_url: 'https://waterdata.usgs.gov/monitoring-location/15292000/', low: 3000, high: 10000 },

  // ── BC / Yukon WSC (cms) ─────────────────────────────────────────
  { key: 'tatshenshini', name: 'Tatshenshini R', location: 'Dalton Post, YT',      source: 'wsc', site: '08AB004', text_key: 'tat',       gauge_url: 'https://water.noaa.gov/gauges/tatq9',                                low: 100, high: 400  },
  { key: 'alsek',        name: 'Alsek R',        location: 'above Bates R, YT',    source: 'wsc', site: '08AB001', text_key: 'alsek',     gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08AB001', low: null, high: null },
  { key: 'stikine',      name: 'Stikine R',      location: 'Telegraph Creek, BC',  source: 'wsc', site: '08CE001', text_key: 'stikine',   gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08CE001', low: 400, high: 1500 },
  { key: 'iskut',        name: 'Iskut R',        location: 'Bob Quinn, BC',        source: 'wsc', site: '08CG001', text_key: 'iskut',     gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08CG001', low: 100, high: 500  },
  { key: 'calor',        name: 'Calor R',        location: 'BC',                   source: 'wsc', site: '08EF005', text_key: 'calor',     gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08EF005', low: 50,  high: 200  },
  { key: 'clearwater',   name: 'Clearwater R',   location: 'Clearwater, BC',       source: 'wsc', site: '08LA001', text_key: 'clearwater',gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08LA001', low: 50,  high: 200  },
];
