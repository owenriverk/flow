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
// low/high: paddling-knowledge estimates (AW's site was returning 502). Verify against
// AW reach pages or BCW/RiverApp when AW comes back online.
// Units: cfs for USGS/CDEC, cms for WSC.
export const GAUGES: GaugeConfig[] = [
  // ── USGS (cfs / ft) ──────────────────────────────────────────────
  { key: 'middle fork salmon', name: 'MF Salmon',        location: 'MF Lodge, ID',         source: 'usgs', site: '13309220', text_key: 'mf salmon',       gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13309220/', low: 2000,  high: 7000  },
  { key: 'main salmon',        name: 'Salmon R',         location: 'White Bird, ID',        source: 'usgs', site: '13317000', text_key: 'main salmon',      gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13317000/', low: 5000,  high: 20000 },
  { key: 'salmon shoup',       name: 'Salmon R',         location: 'Shoup, ID',             source: 'usgs', site: '13307000', text_key: 'salmon shoup',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13307000/', low: 2000,  high: 8000  },
  { key: 'selway',             name: 'Selway R',         location: 'Lowell, ID',            source: 'usgs', site: '13336500', text_key: 'selway',           gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13336500/', low: 2000,  high: 6000  },
  { key: 'grand canyon',       name: 'Colorado R',       location: 'Lees Ferry, AZ',        source: 'usgs', site: '09380000', text_key: 'grand canyon',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09380000/', low: 5000,  high: 25000 },
  { key: 'rogue',              name: 'Rogue R',          location: 'Agness, OR',            source: 'usgs', site: '14372300', text_key: 'rogue',            gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14372300/', low: 800,   high: 5000  },
  { key: 'owyhee',             name: 'Owyhee R',         location: 'Rome, OR',              source: 'usgs', site: '14096900', text_key: 'owyhee',           gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14096900/', low: 300,   high: 2500  },
  { key: 'dolores',            name: 'Dolores R',        location: 'below McPhee, CO',      source: 'usgs', site: '09169500', text_key: 'dolores',          gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09169500/', low: 800,   high: 2500  },
  { key: 'san juan',           name: 'San Juan R',       location: 'Bluff, UT',             source: 'usgs', site: '09379500', text_key: 'san juan',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09379500/', low: 500,   high: 5000  },
  { key: 'yampa',              name: 'Yampa R',          location: 'Maybell, CO',           source: 'usgs', site: '09251000', text_key: 'yampa',            gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09251000/', low: 1000,  high: 8000  },
  { key: 'green jensen',       name: 'Green R',          location: 'Jensen, UT',            source: 'usgs', site: '09261000', text_key: 'green jensen',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09261000/', low: 1500,  high: 5000  },
  { key: 'green river ut',     name: 'Green R',          location: 'Green River, UT',       source: 'usgs', site: '09315000', text_key: 'green river ut',   gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09315000/', low: 3000,  high: 15000 },
  { key: 'cataract',           name: 'Colorado R',       location: 'Cisco, UT',             source: 'usgs', site: '09180500', text_key: 'cataract',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09180500/', low: 6000,  high: 40000 },
  { key: 'rio grande',         name: 'Rio Grande',       location: 'Taos, NM',              source: 'usgs', site: '08276300', text_key: 'rio grande',       gauge_url: 'https://waterdata.usgs.gov/monitoring-location/08276300/', low: 250,   high: 900   },
  { key: 'illinois',           name: 'Illinois R',       location: 'Kerby, OR',             source: 'usgs', site: '14377100', text_key: 'illinois',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14377100/', low: 400,   high: 1500  },
  { key: 'klamath',            name: 'Klamath R',        location: 'Orleans, CA',           source: 'usgs', site: '11523000', text_key: 'klamath',          gauge_url: 'https://waterdata.usgs.gov/monitoring-location/11523000/', low: 1500,  high: 8000  },
  { key: 'tuolumne',           name: 'Tuolumne R',       location: 'Mather, CA',            source: 'usgs', site: '11276600', text_key: 'tuolumne',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/11276600/', low: 300,   high: 2500  },
  { key: 'john day',           name: 'John Day R',       location: 'Service Creek, OR',     source: 'usgs', site: '14046500', text_key: 'john day',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14046500/', low: 400,   high: 2500  },
  { key: 'grande ronde',       name: 'Grande Ronde R',   location: 'Troy, OR',              source: 'usgs', site: '13333000', text_key: 'grande ronde',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13333000/', low: 1500,  high: 5000  },
  { key: 'hells canyon',       name: 'Snake R',          location: 'Hells Canyon Dam',      source: 'usgs', site: '13290450', text_key: 'hells canyon',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13290450/', low: 3000,  high: 15000 },
  { key: 'alsek',              name: 'Alsek R',          location: 'Dry Bay, AK',           source: 'usgs', site: '15129000', text_key: 'alsek',            gauge_url: 'https://waterdata.usgs.gov/monitoring-location/15129000/', low: null,  high: null  },
  { key: 'flathead',           name: 'MF Flathead R',    location: 'West Glacier, MT',      source: 'usgs', site: '12358500', text_key: 'flathead',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/12358500/', low: 2000,  high: 10000 },
  { key: 'smith',              name: 'Smith R',          location: 'Eden, MT',              source: 'usgs', site: '06077500', text_key: 'smith',            gauge_url: 'https://waterdata.usgs.gov/monitoring-location/06077500/', low: 400,   high: 2000  },
  { key: 'allagash',           name: 'Allagash R',       location: 'Allagash, ME',          source: 'usgs', site: '01011000', text_key: 'allagash',         gauge_url: 'https://waterdata.usgs.gov/monitoring-location/01011000/', low: 500,   high: 3000  },
  { key: 'black canyon',       name: 'Gunnison R',       location: 'below Crystal, CO',     source: 'usgs', site: '09127800', text_key: 'black canyon',     gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09127800/', low: 250,   high: 1000  },
  { key: 'clarks fork',        name: 'Clarks Fork',      location: 'Belfry, MT',            source: 'usgs', site: '06207500', text_key: 'clarks fork',      gauge_url: 'https://waterdata.usgs.gov/monitoring-location/06207500/', low: 400,   high: 1200  },
  { key: 'poudre',             name: 'Cache la Poudre',  location: 'Canyon Mouth, CO',      source: 'usgs', site: '06752000', text_key: 'poudre',           gauge_url: 'https://waterdata.usgs.gov/monitoring-location/06752000/', low: 200,   high: 1200  },
  { key: 'bruneau',            name: 'Bruneau R',        location: 'Hot Springs, ID',       source: 'usgs', site: '13168500', text_key: 'bruneau',          gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13168500/', low: 300,   high: 1500  },
  { key: 'susitna',            name: 'Susitna R',        location: 'Gold Creek, AK',        source: 'usgs', site: '15292000', text_key: 'susitna',          gauge_url: 'https://waterdata.usgs.gov/monitoring-location/15292000/', low: 3000,  high: 10000 },
  { key: 'south salmon',       name: 'SF Salmon R',      location: 'Krassel, ID',           source: 'usgs', site: '13310700', text_key: 'sf salmon',        gauge_url: 'https://waterdata.usgs.gov/monitoring-location/13310700/', low: 1000,  high: 3500  },
  { key: 'deschutes',          name: 'Deschutes R',      location: 'Madras, OR',            source: 'usgs', site: '14092500', text_key: 'deschutes',        gauge_url: 'https://waterdata.usgs.gov/monitoring-location/14092500/', low: 3000,  high: 7000  },
  { key: 'salt',               name: 'Salt R',           location: 'Roosevelt, AZ',         source: 'usgs', site: '09498500', text_key: 'salt',             gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09498500/', low: 800,   high: 4000  },
  { key: 'chama',              name: 'Rio Chama',        location: 'bl El Vado, NM',        source: 'usgs', site: '08285500', text_key: 'chama',            gauge_url: 'https://waterdata.usgs.gov/monitoring-location/08285500/', low: 200,   high: 1000  },
  { key: 'ruby horsethief',    name: 'Colorado R',       location: 'CO-UT line',            source: 'usgs', site: '09163500', text_key: 'ruby',             gauge_url: 'https://waterdata.usgs.gov/monitoring-location/09163500/', low: 3000,  high: 15000 },

  // ── WSC / Water Survey of Canada (cms / m) ───────────────────────
  // Ranges in cms. Verify against bcwhitewater.ca or riverapp.net.
  { key: 'nahanni', name: 'S Nahanni R', location: 'Virginia Falls, NT', source: 'wsc', site: '10EB001', text_key: 'nahanni', gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=10EB001', low: 150,  high: 600  },
  { key: 'babine',  name: 'Babine R',    location: 'Babine Lake, BC',    source: 'wsc', site: '08EE001', text_key: 'babine',  gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08EE001', low: 80,   high: 300  },
  { key: 'chilko',  name: 'Chilko R',    location: 'Redstone, BC',       source: 'wsc', site: '08CH001', text_key: 'chilko',  gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08CH001', low: 150,  high: 600  },
  { key: 'firth',   name: 'Firth R',     location: 'near Mouth, YT',     source: 'wsc', site: '10HF001', text_key: 'firth',   gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=10HF001', low: 50,   high: 250  },
  { key: 'stikine', name: 'Stikine R',   location: 'Telegraph Creek, BC', source: 'wsc', site: '08CE001', text_key: 'stikine', gauge_url: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08CE001', low: 400,  high: 1500 },

  // ── CDEC / California (cfs / ft) ─────────────────────────────────
  { key: 'nf mokelumne', name: 'NF Mokelumne', location: 'ab Tiger Creek, CA', source: 'cdec', site: 'M38', sensor: 20, dur: 'H', text_key: 'nf mokelumne', gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=M38',  low: 200, high: 700  },
  { key: 'dinkey creek', name: 'Dinkey Ck',    location: 'Dinkey siphon, CA',  source: 'cdec', site: 'DKS', sensor: 20, dur: 'E', text_key: 'dinkey creek', gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=DKS',  low: 80,  high: 400  },
  { key: 'kern',         name: 'Kern R',        location: 'Kern Canyon, CA',    source: 'cdec', site: 'KRD', sensor: 20, dur: 'E', text_key: 'kern',         gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=KRD',  low: 500, high: 2500 },
  { key: 'kings',        name: 'SF Kings R',    location: 'Boyden Cavern, CA',  source: 'cdec', site: 'KBC', sensor: 20, dur: 'E', text_key: 'kings',        gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=KBC',  low: 500, high: 2500 },
  { key: 'cherry creek', name: 'Cherry Ck',     location: 'Early Intake, CA',   source: 'cdec', site: 'CEI', sensor: 20, dur: 'E', text_key: 'cherry creek', gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=CEI',  low: 300, high: 700  },
  { key: 'upper cherry', name: 'Upper Cherry Ck', location: 'CA',              source: 'cdec', site: 'UCC', sensor: 20, dur: 'E', text_key: 'west cherry', gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=UCC',  low: 100, high: 400  },
  { key: 'mf feather',   name: 'MF Feather R',  location: 'Merrimac, CA',       source: 'cdec', site: 'MER', sensor: 20, dur: 'H', text_key: 'mf feather',   gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=MER',  low: 600, high: 3000 },
  { key: 'mf american',  name: 'MF American R', location: 'Oxbow, CA',          source: 'cdec', site: 'OXB', sensor: 20, dur: 'H', text_key: 'mf american',  gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=OXB',  low: 300, high: 2000 },
  { key: 'rubicon',      name: 'Rubicon R',      location: 'bl Gerle Ck, CA',   source: 'cdec', site: 'RBG', sensor: 20, dur: 'H', text_key: 'rubicon',      gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=RBG',  low: 150, high: 800  },
  { key: 'nf american',  name: 'NF American R', location: 'North Fork Dam, CA', source: 'cdec', site: 'NFD', sensor: 20, dur: 'E', text_key: 'nf american',  gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=NFD',  low: 200, high: 1500 },
  { key: 'sf american',  name: 'SF American R', location: 'Chili Bar, CA',      source: 'cdec', site: 'CBR', sensor: 20, dur: 'H', text_key: 'sf american',  gauge_url: 'https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=CBR',  low: 800, high: 5000 },
];
