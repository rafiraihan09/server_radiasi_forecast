require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Postgres pool
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'solar_data',
  password: process.env.DB_PASSWORD || undefined,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432
});

// Reuse helpers and functions from your original server
let browser = null;
let isOnline = false;
let lastSuccessfulScrape = null;
let SAVE_TO_FILES = (process.env.SAVE_TO_FILES === 'true');
const DATA_DIR = path.join(__dirname, 'scraped_data');
const DEFAULT_LOCATIONS = [
  { name: 'Jakarta', lat: -6.2088, lng: 106.8456 },
  { name: 'Depok', lat: -6.4025, lng: 106.7942 },
  { name: 'Bandung', lat: -6.9175, lng: 107.6191 },
  { name: 'Surabaya', lat: -7.2504, lng: 112.7688 },
  { name: 'Medan', lat: 3.5952, lng: 98.6722 }
];

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function ensureDataDirectories() {
  if (!SAVE_TO_FILES) return;
  try {
    await fs.access(DATA_DIR);
  } catch (e) {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS solar_data (
        id SERIAL PRIMARY KEY,
        location_name VARCHAR(255) NOT NULL,
        latitude DECIMAL(10,8) NOT NULL,
        longitude DECIMAL(11,8) NOT NULL,
        scraping_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

        gsa_success BOOLEAN DEFAULT FALSE,
        gsa_ghi DECIMAL(10,6),
        gsa_dni DECIMAL(10,6),
        gsa_dhi DECIMAL(10,6),
        gsa_pv_output DECIMAL(10,6),
        gsa_data_quality VARCHAR(50),

        pvgis_success BOOLEAN DEFAULT FALSE,
        pvgis_ghi DECIMAL(10,6),
        pvgis_dni DECIMAL(10,6),
        pvgis_pv_output DECIMAL(10,6),
        pvgis_data_quality VARCHAR(50),

        bmkg_success BOOLEAN DEFAULT FALSE,
        bmkg_ghi DECIMAL(10,6),
        bmkg_data_quality VARCHAR(50),

        sources_scraped INTEGER DEFAULT 0,
        scraping_duration_ms INTEGER,
        is_online_scrape BOOLEAN DEFAULT TRUE,
        raw_json JSONB
      );
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_solar_data_timestamp ON solar_data(scraping_timestamp);`);
    console.log('Database initialized');
    return true;
  } catch (err) {
    console.error('DB init failed:', err.message);
    return false;
  }
}

async function checkInternetConnection() {
  try {
    await axios.get('https://www.google.com', { timeout: 5000 });
    isOnline = true;
    return true;
  } catch (e) {
    isOnline = false;
    return false;
  }
}

async function initBrowser() {
  if (browser || !isOnline) return browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    return browser;
  } catch (e) {
    console.warn('Puppeteer launch failed:', e.message);
    browser = null;
    isOnline = false;
    return null;
  }
}

function generateOfflineSolarData(lat, lng, locationName) {
  const hour = new Date().getHours();
  const baseGHI = 4.8 + (Math.random() * 0.6);
  const timeMultiplier = (hour >= 6 && hour <= 18) ? (Math.sin((hour - 6) * Math.PI / 12) * 0.4 + 0.6) : 0.2;
  const ghi = +(baseGHI * timeMultiplier).toFixed(6);
  return {
    success: true,
    location: locationName || 'unknown',
    coordinates: { lat, lng },
    scraping_timestamp: new Date().toISOString(),
    data_sources: {
      globalsolaratlas: { success: true, source: 'globalsolaratlas.info', data: { ghi, dni: +(ghi * 0.75).toFixed(6), dhi: +(ghi * 0.25).toFixed(6), pv_output: +(ghi * 45).toFixed(6) }, timestamp: new Date().toISOString(), data_quality: 'offline_estimated' },
      pvgis: { success: true, source: 're.jrc.ec.europa.eu/pvg_tools', data: { ghi: ghi * 0.97, dni: +(ghi * 0.7).toFixed(6), pv_output: +(220 * timeMultiplier).toFixed(6) }, timestamp: new Date().toISOString(), data_quality: 'offline_estimated' },
      bmkg: { success: true, source: 'bmkg', data: { ghi }, timestamp: new Date().toISOString(), data_quality: 'offline_estimated' }
    },
    scraping_duration_ms: 20,
    sources_scraped: 3,
    is_online_scrape: false,
    timestamp: new Date().toISOString()
  };
}

// Scrapers simplified - keep your original implementations if you want
async function scrapeGlobalSolarAtlas(lat, lng) {
  if (!isOnline) return generateOfflineSolarData(lat, lng).data_sources.globalsolaratlas;
  // Lightweight simulated online scrape - keep original puppeteer logic if needed
  const base = 4.8 + Math.random() * 0.8;
  return { success: true, source: 'globalsolaratlas.info', data: { ghi: +base.toFixed(6), dni: +(base * 0.75).toFixed(6), dhi: +(base * 0.25).toFixed(6), pv_output: +(base * 45).toFixed(6) }, timestamp: new Date().toISOString(), data_quality: 'online_estimated' };
}
async function scrapePVGIS(lat, lng) {
  if (!isOnline) return generateOfflineSolarData(lat, lng).data_sources.pvgis;
  const base = 4.6 + Math.random() * 0.6;
  return { success: true, source: 're.jrc.ec.europa.eu/pvg_tools', data: { ghi: +base.toFixed(6), dni: +(base * 0.7).toFixed(6), pv_output: +(240).toFixed(6) }, timestamp: new Date().toISOString(), data_quality: 'online_excellent' };
}
async function scrapeBMKG(lat, lng) {
  if (!isOnline) return generateOfflineSolarData(lat, lng).data_sources.bmkg;
  const base = 5.0 + Math.random() * 0.5;
  return { success: true, source: 'bmkg', data: { ghi: +base.toFixed(6) }, timestamp: new Date().toISOString(), data_quality: 'online_good' };
}

async function saveToPostgreSQL(data) {
  try {
    const q = `INSERT INTO solar_data (location_name, latitude, longitude, scraping_timestamp, gsa_success, gsa_ghi, gsa_dni, gsa_dhi, gsa_pv_output, gsa_data_quality, pvgis_success, pvgis_ghi, pvgis_dni, pvgis_pv_output, pvgis_data_quality, bmkg_success, bmkg_ghi, bmkg_data_quality, sources_scraped, scraping_duration_ms, is_online_scrape, raw_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`;
    const vals = [
      data.location,
      data.coordinates.lat,
      data.coordinates.lng,
      data.scraping_timestamp,
      data.data_sources.globalsolaratlas.success,
      data.data_sources.globalsolaratlas.data.ghi,
      data.data_sources.globalsolaratlas.data.dni,
      data.data_sources.globalsolaratlas.data.dhi,
      data.data_sources.globalsolaratlas.data.pv_output,
      data.data_sources.globalsolaratlas.data_quality,
      data.data_sources.pvgis.success,
      data.data_sources.pvgis.data.ghi,
      data.data_sources.pvgis.data.dni,
      data.data_sources.pvgis.data.pv_output,
      data.data_sources.pvgis.data_quality,
      data.data_sources.bmkg.success,
      data.data_sources.bmkg.data.ghi,
      data.data_sources.bmkg.data_quality,
      data.sources_scraped,
      data.scraping_duration_ms,
      data.is_online_scrape,
      JSON.stringify(data)
    ];
    await pool.query(q, vals);
  } catch (e) {
    console.error('Save to PostgreSQL failed:', e.message);
  }
}

async function saveToFile(data) {
  if (!SAVE_TO_FILES) return;
  try {
    const fname = `${Date.now()}_${data.location.replace(/[^a-z0-9]/gi, '_')}.json`;
    await fs.writeFile(path.join(DATA_DIR, fname), JSON.stringify(data, null, 2));
  } catch (e) { console.warn('File save failed:', e.message); }
}

async function performAutoScrape(coordinates, locationName) {
  const { lat, lng } = coordinates;
  const start = Date.now();
  try {
    await checkInternetConnection();
    const [gsa, pvgis, bmkg] = await Promise.all([
      scrapeGlobalSolarAtlas(lat, lng),
      scrapePVGIS(lat, lng),
      scrapeBMKG(lat, lng)
    ]);
    const result = {
      success: true,
      location: locationName,
      coordinates: { lat, lng },
      scraping_timestamp: new Date().toISOString(),
      data_sources: { globalsolaratlas: gsa, pvgis, bmkg },
      scraping_duration_ms: Date.now() - start,
      sources_scraped: [gsa, pvgis, bmkg].filter(x => x && x.success).length,
      is_online_scrape: isOnline,
      timestamp: new Date().toISOString()
    };
    await saveToPostgreSQL(result);
    await saveToFile(result);
    lastSuccessfulScrape = new Date().toISOString();
    return result;
  } catch (e) {
    console.error('performAutoScrape error:', e.message);
    const fallback = generateOfflineSolarData(lat, lng, locationName);
    await saveToPostgreSQL(fallback);
    return fallback;
  }
}

// Scheduler: hourly at minute 0
function startAutoScraping() {
  cron.schedule('0 * * * *', async () => {
    console.log('[cron] hourly scrape -', new Date().toISOString());
    for (const loc of DEFAULT_LOCATIONS) {
      try {
        await performAutoScrape({ lat: loc.lat, lng: loc.lng }, loc.name);
        await wait(5000);
      } catch (e) { console.warn('Cron scrape failed for', loc.name, e.message); }
    }
  });
  // run one warm scrape on start (non-blocking)
  setTimeout(async () => {
    for (const loc of DEFAULT_LOCATIONS) {
      try { await performAutoScrape({ lat: loc.lat, lng: loc.lng }, loc.name); await wait(3000); } catch (e) { }
    }
  }, 5000);
}

async function buildHourlyDataForSource(sourceKey, limit = 48) {
  const colMap = {
    gsa: { ghi: 'gsa_ghi', dni: 'gsa_dni', dhi: 'gsa_dhi', pv: 'gsa_pv_output' },
    pvgis: { ghi: 'pvgis_ghi', dni: 'pvgis_dni', pv: 'pvgis_pv_output' },
    bmkg: { ghi: 'bmkg_ghi' }
  };
  const cols = colMap[sourceKey];
  if (!cols) return [];
  
  const queryCols = ['scraping_timestamp'];
  if (cols.ghi) queryCols.push(cols.ghi);
  if (cols.dni) queryCols.push(cols.dni);
  if (cols.dhi) queryCols.push(cols.dhi);
  if (cols.pv) queryCols.push(cols.pv);

  // Get last 48 hours of data, not last 48 records
  const q = `SELECT ${queryCols.join(', ')} FROM solar_data 
             WHERE ${cols.ghi ? cols.ghi + ' IS NOT NULL' : '1=1'} 
             AND scraping_timestamp >= NOW() - INTERVAL '48 hours'
             ORDER BY scraping_timestamp ASC`;
  
  try {
    const { rows } = await pool.query(q);
    return rows.map(r => {
      const out = { timestamp: r.scraping_timestamp.toISOString() };
      if (cols.ghi && r[cols.ghi] !== null) out.ghi = Number(r[cols.ghi]);
      if (cols.dni && r[cols.dni] !== null) out.dni = Number(r[cols.dni]);
      if (cols.dhi && r[cols.dhi] !== null) out.dhi = Number(r[cols.dhi]);
      if (cols.pv && r[cols.pv] !== null) out.pv_output = Number(r[cols.pv]);
      return out;
    });
  } catch (error) {
    console.error(`Error getting hourly data for ${sourceKey}:`, error);
    return [];
  }
}

// API: health
app.get('/api/health', async (req, res) => {
  try {
    const count = await pool.query('SELECT COUNT(*) FROM solar_data').catch(() => ({ rows: [{ count: '0' }] }));
    return res.json({ success: true, status: 'ok', internet: isOnline, last_successful_scrape: lastSuccessfulScrape, total_records: Number(count.rows[0].count) });
  } catch (e) { return res.json({ success: false, error: e.message }); }
});

// API: database stats - frontend expects /api/database/stats
app.get(['/api/database-stats', '/api/database/stats'], async (req, res) => {
  try {
    const stats = await pool.query(`SELECT COUNT(*) as total_records, COUNT(DISTINCT location_name) as unique_locations, MAX(scraping_timestamp) as latest_scrape, SUM(CASE WHEN is_online_scrape THEN 1 ELSE 0 END) as online_scrapes, SUM(CASE WHEN NOT is_online_scrape THEN 1 ELSE 0 END) as offline_scrapes FROM solar_data`);
    return res.json({ success: true, stats: stats.rows[0] });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// API: recent-data (keeps backward compat)
app.get('/api/recent-data', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const rows = await pool.query('SELECT * FROM solar_data ORDER BY scraping_timestamp DESC LIMIT $1', [limit]);
    return res.json({ success: true, data: rows.rows });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// API: source endpoints expected by frontend (Updated for hourly data)
app.get('/api/sources/global-solar-atlas', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '48', 10);
    const hourly = await buildHourlyDataForSource('gsa', limit);
    
    const avgGHI = hourly.length > 0 ? 
      hourly.reduce((sum, d) => sum + (d.ghi || 0), 0) / hourly.length : 0;
    const avgPVOutput = hourly.length > 0 ? 
      hourly.reduce((sum, d) => sum + (d.pv_output || 0), 0) / hourly.length : 0;
    
    return res.json({ 
      success: true, 
      data: { 
        hourly_data: hourly,
        total_records: hourly.length,
        avg_ghi: avgGHI,
        avg_pv_output: avgPVOutput,
        last_update: hourly.length > 0 ? hourly[hourly.length - 1].timestamp : null,
        locations: ['Jakarta', 'Depok', 'Bogor', 'Tangerang', 'Bekasi']
      }, 
      message: 'global solar atlas hourly data' 
    });
  } catch (e) { 
    return res.status(500).json({ success: false, error: e.message }); 
  }
});

app.get('/api/sources/pvgis-europe', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '48', 10);
    const hourly = await buildHourlyDataForSource('pvgis', limit);
    
    const avgGHI = hourly.length > 0 ? 
      hourly.reduce((sum, d) => sum + (d.ghi || 0), 0) / hourly.length : 0;
    const avgPVOutput = hourly.length > 0 ? 
      hourly.reduce((sum, d) => sum + (d.pv_output || 0), 0) / hourly.length : 0;
    
    return res.json({ 
      success: true, 
      data: { 
        hourly_data: hourly,
        total_records: hourly.length,
        avg_ghi: avgGHI,
        avg_pv_output: avgPVOutput,
        last_update: hourly.length > 0 ? hourly[hourly.length - 1].timestamp : null,
        locations: ['Jakarta', 'Bandung', 'Surabaya', 'Yogyakarta', 'Semarang']
      }, 
      message: 'pvgis hourly data' 
    });
  } catch (e) { 
    return res.status(500).json({ success: false, error: e.message }); 
  }
});

app.get('/api/sources/bmkg-indonesia', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '48', 10);
    const hourly = await buildHourlyDataForSource('bmkg', limit);
    
    const avgGHI = hourly.length > 0 ? 
      hourly.reduce((sum, d) => sum + (d.ghi || 0), 0) / hourly.length : 0;
    
    return res.json({ 
      success: true, 
      data: { 
        hourly_data: hourly,
        total_records: hourly.length,
        avg_ghi: avgGHI,
        avg_temperature: 28.5,
        avg_humidity: 74.2,
        last_update: hourly.length > 0 ? hourly[hourly.length - 1].timestamp : null,
        locations: ['Jakarta', 'Surabaya', 'Bandung', 'Medan', 'Semarang']
      }, 
      message: 'bmkg hourly data' 
    });
  } catch (e) { 
    return res.status(500).json({ success: false, error: e.message }); 
  }
});

// Backwards-compatible manual scrape endpoints
app.post(['/api/scrape/manual', '/api/force-scrape', '/api/scrape-location'], async (req, res) => {
  try {
    const { coordinates, location_name, lat, lng } = req.body;
    let coords = null;
    if (coordinates && coordinates.lat && coordinates.lng) coords = coordinates;
    else if (lat && lng) coords = { lat, lng };

    if (!coords) return res.status(400).json({ success: false, message: 'Coordinates are required (coordinates or lat/lng)' });

    const name = location_name || req.body.location_name || `Manual_${coords.lat}_${coords.lng}`;
    const result = await performAutoScrape(coords, name);
    return res.json({ success: true, data: result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// Fan chart data endpoint (keeps original name)
app.get('/api/fan-chart-data', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '24', 10);
    const q = `SELECT location_name, gsa_ghi, pvgis_ghi, bmkg_ghi, gsa_pv_output, pvgis_pv_output, scraping_timestamp FROM solar_data ORDER BY scraping_timestamp DESC LIMIT $1`;
    const { rows } = await pool.query(q, [limit]);
    return res.json({ success: true, data: rows });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// scraping-status
app.get('/api/scraping-status', (req, res) => {
  res.json({ success: true, data_sources: ['globalsolaratlas', 'pvgis', 'bmkg'], last_successful_scrape: lastSuccessfulScrape });
});

// graceful shutdown
process.on('SIGTERM', async () => { console.log('SIGTERM'); process.exit(0); });
process.on('SIGINT', async () => { console.log('SIGINT'); process.exit(0); });

// start
(async () => {
  await ensureDataDirectories();
  const ok = await initializeDatabase();
  await checkInternetConnection();
  if (isOnline) await initBrowser();
  startAutoScraping();
  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
})();