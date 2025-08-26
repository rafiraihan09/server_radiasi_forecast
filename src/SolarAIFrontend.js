import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Sun, Database, Globe, CheckCircle, AlertCircle, WifiOff, RefreshCw, Activity, TrendingUp, MapPin, Play, Pause, ExternalLink } from 'lucide-react';
import './SolarAI.css';

/**
 * =============================================
 * SolarAI Frontend (Rewritten)
 * ---------------------------------------------
 * Key changes:
 * - "Unified Multi-Source Series" for charts. We now merge per-source daily data
 *   into a single series per date so the tooltip can show metrics from ALL sources
 *   for that date (e.g., GHI/DNI/DHI/PV Output from GSA + PVGIS + BMKG GHI).
 * - Robust merging util handles missing metrics gracefully.
 * - Custom tooltip prints friendly metric names from each source.
 * - Backward-compatible with your existing backend endpoints; when offline it
 *   generates rich demo data including DNI/DHI/PV output.
 * =============================================
 */

const BACKEND_URL = 'http://localhost:5000';

const sourceColors = {
  gsa: '#3b82f6', // Global Solar Atlas
  pvgis: '#10b981',
  bmkg: '#f59e0b'
};

const metricPalette = {
  // GSA
  gsa_ghi: '#2563eb',
  gsa_dni: '#1d4ed8',
  gsa_dhi: '#60a5fa',
  gsa_pv_output: '#4338ca',
  // PVGIS
  pvgis_ghi: '#059669',
  pvgis_dni: '#34d399',
  pvgis_pv_output: '#065f46',
  // BMKG
  bmkg_ghi: '#d97706'
};

const metricLabels = {
  gsa_ghi: 'Global Solar Atlas GHI',
  gsa_dni: 'Global Solar Atlas DNI',
  gsa_dhi: 'Global Solar Atlas DHI',
  gsa_pv_output: 'Global Solar Atlas PV Output',
  pvgis_ghi: 'PVGIS GHI',
  pvgis_dni: 'PVGIS DNI',
  pvgis_pv_output: 'PVGIS PV Output',
  bmkg_ghi: 'BMKG GHI'
};

// --- Utilities ---
const niceNumber = (val, digits = 2) =>
  typeof val === 'number' && isFinite(val) ? Number(val).toFixed(digits) : '—';

/**
 * Merges per-source daily series into a unified array keyed by date.
 * Each row has keys like: gsa_ghi, gsa_dni, gsa_dhi, gsa_pv_output, pvgis_ghi, ... , bmkg_ghi
 * Expected input items shape per source dailyData: { date: 'YYYY-MM-DD', ghi, dni, dhi, pvOutput }
 */
function mergeHourlySeries({ gsa = [], pvgis = [], bmkg = [] }) {
  const map = new Map();

  const safeUpsert = (timestamp) => {
    if (!map.has(timestamp)) map.set(timestamp, { timestamp });
    return map.get(timestamp);
  };

  // GSA
  gsa.forEach(d => {
    const row = safeUpsert(d.timestamp);
    if (d.ghi != null) row.gsa_ghi = d.ghi;
    if (d.dni != null) row.gsa_dni = d.dni;
    if (d.dhi != null) row.gsa_dhi = d.dhi;
    if (d.pvOutput != null) row.gsa_pv_output = d.pvOutput;
  });

  // PVGIS
  pvgis.forEach(d => {
    const row = safeUpsert(d.timestamp);
    if (d.ghi != null) row.pvgis_ghi = d.ghi;
    if (d.dni != null) row.pvgis_dni = d.dni;
    if (d.pvOutput != null) row.pvgis_pv_output = d.pvOutput;
  });

  // BMKG (often GHI only)
  bmkg.forEach(d => {
    const row = safeUpsert(d.timestamp);
    if (d.ghi != null) row.bmkg_ghi = d.ghi;
  });

  const out = Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}


// --- Tooltip ---
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      backgroundColor: 'white',
      padding: '12px',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
    }}>
      <p style={{ fontWeight: 700, marginBottom: 8 }}>{label}</p>
      {payload
        .filter(p => p && p.value != null)
        .map((entry, i) => (
          <p key={i} style={{ color: entry.color, margin: '4px 0' }}>
            {metricLabels[entry.dataKey] || entry.name}: {niceNumber(entry.value)}
          </p>
        ))}
    </div>
  );
};

const SolarAIDashboard = () => {
  // Core states
  const [backendConnected, setBackendConnected] = useState(false);
  const [isRealTime, setIsRealTime] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  // Database states
  const [databaseStats, setDatabaseStats] = useState({
    totalRecords: 0,
    uniqueLocations: 0,
    onlineScrapes: 0,
    offlineScrapes: 0
  });

  // Source states (keep raw, then merge for charts)
  const [sourceData, setSourceData] = useState({
    globalSolarAtlas: {
      status: 'disconnected',
      totalRecords: 0,
      avgGHI: 0,
      avgPVOutput: 0,
      lastUpdate: null,
      locations: [],
      dailyData: []
    },
    pvgisEurope: {
      status: 'disconnected',
      totalRecords: 0,
      avgGHI: 0,
      avgPVOutput: 0,
      lastUpdate: null,
      locations: [],
      dailyData: []
    },
    bmkgIndonesia: {
      status: 'disconnected',
      totalRecords: 0,
      avgTemp: 0,
      avgHumidity: 0,
      lastUpdate: null,
      locations: [],
      dailyData: []
    }
  });

const mergedSeries = useMemo(() => {
  const result = mergeHourlySeries({
    gsa: sourceData.globalSolarAtlas.hourlyData,
    pvgis: sourceData.pvgisEurope.hourlyData,
    bmkg: sourceData.bmkgIndonesia.hourlyData
  });

  // Debug logs (before the return)
  console.log('Backend Connected:', backendConnected);
  console.log('Source Data:', sourceData);
  console.log('GSA Hourly Data Length:', sourceData.globalSolarAtlas.hourlyData?.length);
  console.log('GSA Hourly Data Sample:', sourceData.globalSolarAtlas.hourlyData?.[0]);
  console.log('PVGIS Hourly Data Length:', sourceData.pvgisEurope.hourlyData?.length);
  console.log('PVGIS Hourly Data Sample:', sourceData.pvgisEurope.hourlyData?.[0]);
  console.log('BMKG Hourly Data Length:', sourceData.bmkgIndonesia.hourlyData?.length);
  console.log('BMKG Hourly Data Sample:', sourceData.bmkgIndonesia.hourlyData?.[0]);
  console.log('Merged Result Length:', result.length);
  console.log('Merged Result Sample:', result[0]);

  return result;
}, [sourceData]);

  // --- Networking helpers ---
  const fetchDatabaseData = useCallback(async () => {
    if (!backendConnected) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/database/stats`);
      const data = await res.json();
      if (data?.success) {
        setDatabaseStats({
          totalRecords: data.stats.total_records ?? 7280,
          uniqueLocations: data.stats.unique_locations ?? 25,
          onlineScrapes: data.stats.online_scrapes ?? 3420,
          offlineScrapes: data.stats.offline_scrapes ?? 3860
        });
      }
    } catch (e) {
      // Fallback demo stats
      setDatabaseStats({ totalRecords: 7280, uniqueLocations: 25, onlineScrapes: 3420, offlineScrapes: 3860 });
    }
  }, [backendConnected]);

const fetchSourceData = useCallback(async () => {
  if (!backendConnected) {
    generateDemoSourceData();
    return;
  }
  try {
    const [gsaRes, pvgisRes, bmkgRes] = await Promise.all([
      fetch(`${BACKEND_URL}/api/sources/global-solar-atlas`),
      fetch(`${BACKEND_URL}/api/sources/pvgis-europe`),
      fetch(`${BACKEND_URL}/api/sources/bmkg-indonesia`)
    ]);

    const [gsaData, pvgisData, bmkgData] = await Promise.all([
      gsaRes.json(), pvgisRes.json(), bmkgRes.json()
    ]);

    setSourceData({
      globalSolarAtlas: {
        status: gsaData.success ? 'connected' : 'error',
        totalRecords: gsaData.data?.total_records ?? 0,
        avgGHI: gsaData.data?.avg_ghi ?? 0,
        avgPVOutput: gsaData.data?.avg_pv_output ?? 0,
        lastUpdate: gsaData.data?.last_update ?? new Date().toISOString(),
        locations: gsaData.data?.locations ?? [],
        hourlyData: (gsaData.data?.hourly_data ?? []).map(d => ({
          timestamp: d.timestamp,
          ghi: d.ghi,
          dni: d.dni ?? null,
          dhi: d.dhi ?? null,
          pv_output: d.pv_output ?? null  // Changed from pvOutput to pv_output
        }))
      },
      pvgisEurope: {
        status: pvgisData.success ? 'connected' : 'error',
        totalRecords: pvgisData.data?.total_records ?? 0,
        avgGHI: pvgisData.data?.avg_ghi ?? 0,
        avgPVOutput: pvgisData.data?.avg_pv_output ?? 0,
        lastUpdate: pvgisData.data?.last_update ?? new Date().toISOString(),
        locations: pvgisData.data?.locations ?? [],
        hourlyData: (pvgisData.data?.hourly_data ?? []).map(d => ({
          timestamp: d.timestamp,
          ghi: d.ghi,
          dni: d.dni ?? null,
          pv_output: d.pv_output ?? null  // Changed from pvOutput to pv_output
        }))
      },
      bmkgIndonesia: {
        status: bmkgData.success ? 'connected' : 'error',
        totalRecords: bmkgData.data?.total_records ?? 0,
        avgTemp: bmkgData.data?.avg_temperature ?? 28.5,
        avgHumidity: bmkgData.data?.avg_humidity ?? 74.2,
        lastUpdate: bmkgData.data?.last_update ?? new Date().toISOString(),
        locations: bmkgData.data?.locations ?? [],
        hourlyData: (bmkgData.data?.hourly_data ?? []).map(d => ({
          timestamp: d.timestamp,
          ghi: d.ghi
        }))
      }
    });

    console.log('Successfully fetched source data');
  } catch (e) {
    console.error('Failed to fetch source data:', e);
    generateDemoSourceData();
  }
}, [backendConnected]);

// Replace your existing generateDemoSourceData function with this fixed version:

const generateDemoSourceData = () => {
  const days = 30;
  const baseDate = new Date();

  const mkDate = (i) => {
    const d = new Date(baseDate.getTime() - (days - i) * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  };

  // Generate daily data for GSA
  const gsaDaily = Array.from({ length: days }, (_, i) => ({
    date: mkDate(i),
    ghi: 3.5 + Math.sin(i * 0.2) * 1.5 + Math.random() * 0.3,
    dni: 2.9 + Math.cos(i * 0.22) * 1.2 + Math.random() * 0.3,
    dhi: 1.1 + Math.sin(i * 0.18) * 0.5 + Math.random() * 0.2,
    pvOutput: 200 + Math.sin(i * 0.15) * 40 + Math.random() * 10
  }));

  // Generate daily data for PVGIS
  const pvgisDaily = Array.from({ length: days }, (_, i) => ({
    date: mkDate(i),
    ghi: 3.2 + Math.sin(i * 0.2 + 0.6) * 1.3 + Math.random() * 0.3,
    dni: 2.6 + Math.cos(i * 0.22 + 0.3) * 1.0 + Math.random() * 0.3,
    pvOutput: 210 + Math.sin(i * 0.15 + 0.4) * 38 + Math.random() * 10
  }));

  // Generate daily data for BMKG
  const bmkgDaily = Array.from({ length: days }, (_, i) => ({
    date: mkDate(i),
    ghi: 3.4 + Math.sin(i * 0.19 + 0.2) * 1.4 + Math.random() * 0.25
  }));

  setSourceData({
    globalSolarAtlas: {
      status: 'connected',
      totalRecords: 2450,
      avgGHI: 4.85,
      avgPVOutput: 4.12,
      lastUpdate: new Date().toISOString(),
      locations: ['Jakarta', 'Depok', 'Bogor', 'Tangerang', 'Bekasi'],
      dailyData: gsaDaily, // ← KEY FIX: Add the daily data here
      hourlyData: Array.from({ length: 24 }, (_, h) => ({
        timestamp: `2025-08-25T${String(h).padStart(2, "0")}:00:00Z`,
        ghi: Math.random() * 5,
        dni: Math.random() * 4,
        dhi: Math.random() * 2,
        pvOutput: Math.random() * 260
      }))
    },
    pvgisEurope: {
      status: 'connected',
      totalRecords: 1850,
      avgGHI: 3.92,
      avgPVOutput: 3.68,
      lastUpdate: new Date().toISOString(),
      locations: ['Jakarta', 'Bandung', 'Surabaya', 'Yogyakarta', 'Semarang'],
      dailyData: pvgisDaily, // ← KEY FIX: Add the daily data here
      hourlyData: Array.from({ length: 24 }, (_, h) => ({
        timestamp: `2025-08-25T${String(h).padStart(2, "0")}:00:00Z`,
        ghi: Math.random() * 5,
        dni: Math.random() * 4,
        dhi: Math.random() * 2,
        pvOutput: Math.random() * 260
      }))
    },
    bmkgIndonesia: {
      status: 'connected',
      totalRecords: 2980,
      avgTemp: 28.5,
      avgHumidity: 74.2,
      lastUpdate: new Date().toISOString(),
      locations: ['Jakarta', 'Surabaya', 'Bandung', 'Medan', 'Semarang'],
      dailyData: bmkgDaily, // ← KEY FIX: Add the daily data here
      hourlyData: Array.from({ length: 24 }, (_, h) => ({
        timestamp: `2025-08-25T${String(h).padStart(2, "0")}:00:00Z`,
        ghi: Math.random() * 5,
        dni: Math.random() * 4,
        dhi: Math.random() * 2,
        pvOutput: Math.random() * 260
      }))
    }
  });
};

const checkBackendConnection = useCallback(async () => {
  try {
    console.log('🔍 Testing connection to:', `${BACKEND_URL}/api/health`);
    const response = await fetch(`${BACKEND_URL}/api/health`);
    console.log('📡 Response status:', response.status, 'OK:', response.ok);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Health response:', data);
    }
    
    setBackendConnected(response.ok);
    if (response.ok) setLastUpdate(new Date());
  } catch (e) {
    console.error('❌ Backend connection failed:', e);
    setBackendConnected(false);
  }
}, []);

  const triggerManualScrape = async () => {
    if (!backendConnected) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/scrape/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: ['all'] })
      });
      const result = await response.json();
      if (result?.success) {
        setTimeout(() => {
          fetchDatabaseData();
          fetchSourceData();
        }, 2000);
      }
    } catch (e) {
      // noop
    }
  };

  const getSourceIcon = (status) => {
    switch (status) {
      case 'connected':
        return <CheckCircle size={16} style={{ color: '#10b981' }} />;
      case 'error':
        return <AlertCircle size={16} style={{ color: '#ef4444' }} />;
      default:
        return <WifiOff size={16} style={{ color: '#9ca3af' }} />;
    }
  };

  // Effects
  useEffect(() => {
    checkBackendConnection();
    const connectionInterval = setInterval(checkBackendConnection, 10000);
    return () => clearInterval(connectionInterval);
  }, [checkBackendConnection]);

  useEffect(() => {
    fetchDatabaseData();
    fetchSourceData();
  }, [fetchDatabaseData, fetchSourceData]);

  useEffect(() => {
    if (!isRealTime) return;
    const interval = setInterval(() => {
      fetchDatabaseData();
      fetchSourceData();
    }, 30000);
    return () => clearInterval(interval);
  }, [isRealTime, fetchDatabaseData, fetchSourceData]);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header */}
      <header style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', padding: '1rem 2rem', boxShadow: '0 1px 3px 0 rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1200px', margin: '0 auto' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1f2937' }}>
              <Sun size={32} color="#f59e0b" />
              Solar Data Sources Dashboard
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', color: '#6b7280', fontSize: '0.875rem' }}>
              <MapPin size={16} />
              <span>Multi-Source Database Integration</span>
              <span style={{ marginLeft: '1rem', fontSize: '0.75rem' }}>Last Updated: {lastUpdate.toLocaleTimeString()}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', borderRadius: 8, backgroundColor: backendConnected ? '#f0f9ff' : '#fef2f2', border: `1px solid ${backendConnected ? '#bae6fd' : '#fecaca'}` }}>
              {backendConnected ? <CheckCircle size={16} color="#10b981" /> : <AlertCircle size={16} color="#ef4444" />}
              <span style={{ fontSize: '0.875rem', color: backendConnected ? '#0369a1' : '#dc2626' }}>
                {backendConnected ? 'Database Connected' : 'Database Offline'}
              </span>
            </div>

            <button onClick={() => setIsRealTime(!isRealTime)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', border: 'none', borderRadius: 8, backgroundColor: isRealTime ? '#10b981' : '#6b7280', color: 'white', fontSize: '0.875rem', cursor: 'pointer', fontWeight: 500 }}>
              {isRealTime ? <Pause size={16} /> : <Play size={16} />}
              <span>{isRealTime ? 'Live Mode' : 'Manual Mode'}</span>
            </button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
        {/* Overview cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          {[{
            label: 'Total Records', value: databaseStats.totalRecords.toLocaleString(), color: '#3b82f6'
          }, { label: 'Locations', value: databaseStats.uniqueLocations, color: '#10b981' }, { label: 'Online Scrapes', value: databaseStats.onlineScrapes.toLocaleString(), color: '#f59e0b' }, { label: 'Offline Scrapes', value: databaseStats.offlineScrapes.toLocaleString(), color: '#8b5cf6' }].map((c, i) => (
            <div key={i} style={{ backgroundColor: 'white', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: c.color }}>{c.value}</div>
              <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>{c.label}</div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <button onClick={fetchDatabaseData} style={{ marginRight: '1rem', padding: '0.75rem 1.5rem', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <RefreshCw size={16} />
            Refresh Data
          </button>
          <button onClick={triggerManualScrape} disabled={!backendConnected} style={{ padding: '0.75rem 1.5rem', backgroundColor: backendConnected ? '#10b981' : '#9ca3af', color: 'white', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500, cursor: backendConnected ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <Database size={16} />
            Manual Scrape
          </button>
        </div>

        {/* Data Sources Overview */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
          {/* GSA */}
          <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Global Solar Atlas</h4>
              {getSourceIcon(sourceData.globalSolarAtlas.status)}
            </div>
            <button onClick={() => window.open('https://globalsolaratlas.info', '_blank')} style={{ width: '100%', padding: '0.75rem', backgroundColor: sourceColors.gsa, color: 'white', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              <ExternalLink size={16} /> globalsolaratlas.info
            </button>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
              <p>Records: {sourceData.globalSolarAtlas.totalRecords.toLocaleString()}</p>
              <p>Avg GHI: {niceNumber(sourceData.globalSolarAtlas.avgGHI)} kWh/m²/day</p>
              <p>Avg PV Output: {niceNumber(sourceData.globalSolarAtlas.avgPVOutput)} kWh/kWp/day</p>
              <p>Locations: {sourceData.globalSolarAtlas.locations.length}</p>
            </div>
          </div>

          {/* PVGIS */}
          <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>PVGIS Europe</h4>
              {getSourceIcon(sourceData.pvgisEurope.status)}
            </div>
            <button onClick={() => window.open('https://re.jrc.ec.europa.eu/pvg_tools/en/', '_blank')} style={{ width: '100%', padding: '0.75rem', backgroundColor: sourceColors.pvgis, color: 'white', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              <ExternalLink size={16} /> re.jrc.ec.europa.eu/pvg_tools
            </button>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
              <p>Records: {sourceData.pvgisEurope.totalRecords.toLocaleString()}</p>
              <p>Avg GHI: {niceNumber(sourceData.pvgisEurope.avgGHI)} kWh/m²/day</p>
              <p>Avg PV Output: {niceNumber(sourceData.pvgisEurope.avgPVOutput)} kWh/kWp/day</p>
              <p>Locations: {sourceData.pvgisEurope.locations.length}</p>
            </div>
          </div>

          {/* BMKG */}
          <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>BMKG Indonesia</h4>
              {getSourceIcon(sourceData.bmkgIndonesia.status)}
            </div>
            <button onClick={() => window.open('https://dataonline.bmkg.go.id', '_blank')} style={{ width: '100%', padding: '0.75rem', backgroundColor: sourceColors.bmkg, color: 'white', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              <ExternalLink size={16} /> dataonline.bmkg.go.id
            </button>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
              <p>Records: {sourceData.bmkgIndonesia.totalRecords.toLocaleString()}</p>
              <p>Avg Temperature: {niceNumber(sourceData.bmkgIndonesia.avgTemp, 1)}°C</p>
              <p>Avg Humidity: {niceNumber(sourceData.bmkgIndonesia.avgHumidity, 1)}%</p>
              <p>Locations: {sourceData.bmkgIndonesia.locations.length}</p>
            </div>
          </div>
        </div>

        {/* Charts: 30-Day Multi-Source Trends + Distribution */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
          <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb' }}>
            <h3 style={{ margin: 0, marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={20} color="#3b82f6" /> 30-Day Multi-Source Metrics
            </h3>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={mergedSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="date" stroke="#6b7280" />
                <YAxis stroke="#6b7280" />
                <Tooltip content={<CustomTooltip />} />
                <Legend />

                {/* GSA */}
                <Line type="monotone" dataKey="gsa_ghi" stroke={metricPalette.gsa_ghi} strokeWidth={2} name={metricLabels.gsa_ghi} dot={false} />
                <Line type="monotone" dataKey="gsa_dni" stroke={metricPalette.gsa_dni} strokeWidth={2} name={metricLabels.gsa_dni} dot={false} />
                <Line type="monotone" dataKey="gsa_dhi" stroke={metricPalette.gsa_dhi} strokeWidth={2} name={metricLabels.gsa_dhi} dot={false} />
                <Line type="monotone" dataKey="gsa_pv_output" stroke={metricPalette.gsa_pv_output} strokeWidth={2} name={metricLabels.gsa_pv_output} dot={false} />

                {/* PVGIS */}
                <Line type="monotone" dataKey="pvgis_ghi" stroke={metricPalette.pvgis_ghi} strokeWidth={2} name={metricLabels.pvgis_ghi} dot={false} />
                <Line type="monotone" dataKey="pvgis_dni" stroke={metricPalette.pvgis_dni} strokeWidth={2} name={metricLabels.pvgis_dni} dot={false} />
                <Line type="monotone" dataKey="pvgis_pv_output" stroke={metricPalette.pvgis_pv_output} strokeWidth={2} name={metricLabels.pvgis_pv_output} dot={false} />

                {/* BMKG */}
                <Line type="monotone" dataKey="bmkg_ghi" stroke={metricPalette.bmkg_ghi} strokeWidth={2} name={metricLabels.bmkg_ghi} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb' }}>
            <h3 style={{ margin: 0, marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Database size={20} color="#10b981" /> Records Distribution
            </h3>
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={[
                    { name: 'Global Solar Atlas', value: sourceData.globalSolarAtlas.totalRecords },
                    { name: 'PVGIS Europe', value: sourceData.pvgisEurope.totalRecords },
                    { name: 'BMKG Indonesia', value: sourceData.bmkgIndonesia.totalRecords }
                  ]}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${Number(value).toLocaleString()}`}
                >
                  <Cell fill={sourceColors.gsa} />
                  <Cell fill={sourceColors.pvgis} />
                  <Cell fill={sourceColors.bmkg} />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Detailed Table */}
        <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: 0, marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Globe size={20} color="#8b5cf6" /> Data Sources Detailed Table
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e5e7eb' }}>
                  {['Source', 'Status', 'Records', 'Locations', 'Primary Metric', 'Last Update', 'Actions'].map((h, i) => (
                    <th key={i} style={{ padding: '0.75rem', textAlign: i === 0 ? 'left' : i === 1 || i === 5 || i === 6 ? 'center' : 'right', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* GSA Row */}
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '1rem 0.75rem', borderBottom: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: sourceColors.gsa }} />
                      <div>
                        <div style={{ fontWeight: 500, color: '#1f2937' }}>Global Solar Atlas</div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>globalsolaratlas.info</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>{getSourceIcon(sourceData.globalSolarAtlas.status)}</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', fontWeight: 600, color: sourceColors.gsa, borderBottom: '1px solid #e5e7eb' }}>{sourceData.globalSolarAtlas.totalRecords.toLocaleString()}</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{sourceData.globalSolarAtlas.locations.length}</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{niceNumber(sourceData.globalSolarAtlas.avgGHI)} kWh/m²/day</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', fontSize: '0.875rem', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>{sourceData.globalSolarAtlas.lastUpdate ? new Date(sourceData.globalSolarAtlas.lastUpdate).toLocaleTimeString() : 'Never'}</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                    <button onClick={() => window.open('https://globalsolaratlas.info', '_blank')} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', backgroundColor: sourceColors.gsa, color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>View</button>
                  </td>
                </tr>

                {/* PVGIS Row */}
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '1rem 0.75rem', borderBottom: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: sourceColors.pvgis }} />
                      <div>
                        <div style={{ fontWeight: 500, color: '#1f2937' }}>PVGIS Europe</div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>re.jrc.ec.europa.eu</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>{getSourceIcon(sourceData.pvgisEurope.status)}</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', fontWeight: 600, color: sourceColors.pvgis, borderBottom: '1px solid #e5e7eb' }}>{sourceData.pvgisEurope.totalRecords.toLocaleString()}</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{sourceData.pvgisEurope.locations.length}</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{niceNumber(sourceData.pvgisEurope.avgPVOutput)} kWh/kWp/day</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', fontSize: '0.875rem', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>{sourceData.pvgisEurope.lastUpdate ? new Date(sourceData.pvgisEurope.lastUpdate).toLocaleTimeString() : 'Never'}</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                    <button onClick={() => window.open('https://re.jrc.ec.europa.eu/pvg_tools/en/', '_blank')} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', backgroundColor: sourceColors.pvgis, color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>View</button>
                  </td>
                </tr>

                {/* BMKG Row */}
                <tr>
                  <td style={{ padding: '1rem 0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: sourceColors.bmkg }} />
                      <div>
                        <div style={{ fontWeight: 500, color: '#1f2937' }}>BMKG Indonesia</div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>dataonline.bmkg.go.id</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center' }}>{getSourceIcon(sourceData.bmkgIndonesia.status)}</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', fontWeight: 600, color: sourceColors.bmkg }}>{sourceData.bmkgIndonesia.totalRecords.toLocaleString()}</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right' }}>{sourceData.bmkgIndonesia.locations.length}</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right' }}>{niceNumber(sourceData.bmkgIndonesia.avgTemp, 1)}°C</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', fontSize: '0.875rem', color: '#6b7280' }}>{sourceData.bmkgIndonesia.lastUpdate ? new Date(sourceData.bmkgIndonesia.lastUpdate).toLocaleTimeString() : 'Never'}</td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center' }}>
                    <button onClick={() => window.open('https://dataonline.bmkg.go.id', '_blank')} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', backgroundColor: sourceColors.bmkg, color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>View</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Real-time Activity */}
        <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb', marginTop: '2rem' }}>
          <h3 style={{ margin: 0, marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={20} color="#f59e0b" /> Real-time Data Activity
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
            {[{
              title: 'Global Solar Atlas', status: sourceData.globalSolarAtlas.status, last: sourceData.globalSolarAtlas.lastUpdate, color: sourceColors.gsa
            }, { title: 'PVGIS Europe', status: sourceData.pvgisEurope.status, last: sourceData.pvgisEurope.lastUpdate, color: sourceColors.pvgis }, { title: 'BMKG Indonesia', status: sourceData.bmkgIndonesia.status, last: sourceData.bmkgIndonesia.lastUpdate, color: sourceColors.bmkg }].map((card, i) => (
              <div key={i} style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: 8, borderLeft: `4px solid ${card.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500 }}>{card.title}</span>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: card.status === 'connected' ? '#10b981' : '#ef4444', animation: card.status === 'connected' ? 'pulse 2s infinite' : 'none' }} />
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
                  Last sync: {card.last ? new Date(card.last).toLocaleString() : 'Never'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: backendConnected ? '#f0f9ff' : '#fef2f2', borderRadius: 8, border: `1px solid ${backendConnected ? '#bae6fd' : '#fecaca'}`, textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: backendConnected ? '#0369a1' : '#dc2626', fontSize: '0.875rem' }}>
            {backendConnected ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            <span>{backendConnected ? 'Database is connected and auto-fetching data every 30 seconds' : 'Database is offline. Please start your backend server to enable real-time data fetching.'}</span>
          </div>
          {!backendConnected && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
              Run: <code style={{ backgroundColor: '#f3f4f6', padding: '0.25rem', borderRadius: 4 }}>node server.js</code>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
};

export default SolarAIDashboard;
