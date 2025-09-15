import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Sun, Database, Globe, CheckCircle, AlertCircle, WifiOff, RefreshCw, Activity, TrendingUp, MapPin, Play, Pause, ExternalLink } from 'lucide-react';
import './SolarAI.css';

const BACKEND_URL = 'http://localhost:5000';

const sourceColors = {
  gsa: '#3b82f6',
  pvgis: '#10b981',
  bmkg: '#f59e0b'
};

const metricPalette = {
  gsa_ghi: '#2563eb',
  gsa_dni: '#1d4ed8',
  gsa_dhi: '#60a5fa',
  gsa_pv_output: '#4338ca',
  pvgis_ghi: '#059669',
  pvgis_dni: '#34d399',
  pvgis_pv_output: '#065f46',
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

const niceNumber = (val, digits = 2) =>
  typeof val === 'number' && isFinite(val) ? Number(val).toFixed(digits) : '—';

/**
 * Convert timestamp to a readable format for chart display
 */
const formatTimestamp = (timestamp) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
};

/**
 * Merge hourly data from multiple sources into unified chart series
 * This is the FIXED version that properly handles your backend data structure
 */
function mergeHourlyDataForChart({ gsa = [], pvgis = [], bmkg = [] }) {
  const map = new Map();

  // Helper to safely add data points to the map
  const safeUpsert = (timestamp) => {
    const key = timestamp || new Date().toISOString();
    if (!map.has(key)) {
      map.set(key, { 
        timestamp: key,
        displayTime: formatTimestamp(key)
      });
    }
    return map.get(key);
  };

  // Process GSA data
  gsa.forEach(d => {
    const row = safeUpsert(d.timestamp);
    if (d.ghi != null) row.gsa_ghi = Number(d.ghi);
    if (d.dni != null) row.gsa_dni = Number(d.dni);
    if (d.dhi != null) row.gsa_dhi = Number(d.dhi);
    if (d.pv_output != null) row.gsa_pv_output = Number(d.pv_output);
    if (d.pvOutput != null) row.gsa_pv_output = Number(d.pvOutput); // Fallback
  });

  // Process PVGIS data
  pvgis.forEach(d => {
    const row = safeUpsert(d.timestamp);
    if (d.ghi != null) row.pvgis_ghi = Number(d.ghi);
    if (d.dni != null) row.pvgis_dni = Number(d.dni);
    if (d.pv_output != null) row.pvgis_pv_output = Number(d.pv_output);
    if (d.pvOutput != null) row.pvgis_pv_output = Number(d.pvOutput); // Fallback
  });

  // Process BMKG data
  bmkg.forEach(d => {
    const row = safeUpsert(d.timestamp);
    if (d.ghi != null) row.bmkg_ghi = Number(d.ghi);
  });

  // Sort by timestamp and return
  const result = Array.from(map.values()).sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return result;
}

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
      <p style={{ fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>
        {formatTimestamp(label) || label}
      </p>
      {payload
        .filter(p => p && p.value != null && !isNaN(p.value))
        .map((entry, i) => (
          <p key={i} style={{ color: entry.color, margin: '4px 0', fontSize: '0.85rem' }}>
            {metricLabels[entry.dataKey] || entry.name}: {niceNumber(entry.value)}
          </p>
        ))}
    </div>
  );
};

const SolarAIDashboard = () => {
  const [backendConnected, setBackendConnected] = useState(false);
  const [isRealTime, setIsRealTime] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const [databaseStats, setDatabaseStats] = useState({
    totalRecords: 0,
    uniqueLocations: 0,
    onlineScrapes: 0,
    offlineScrapes: 0
  });

  const [sourceData, setSourceData] = useState({
    globalSolarAtlas: {
      status: 'disconnected',
      totalRecords: 0,
      avgGHI: 0,
      avgPVOutput: 0,
      lastUpdate: null,
      locations: [],
      hourlyData: []
    },
    pvgisEurope: {
      status: 'disconnected',
      totalRecords: 0,
      avgGHI: 0,
      avgPVOutput: 0,
      lastUpdate: null,
      locations: [],
      hourlyData: []
    },
    bmkgIndonesia: {
      status: 'disconnected',
      totalRecords: 0,
      avgTemp: 0,
      avgHumidity: 0,
      lastUpdate: null,
      locations: [],
      hourlyData: []
    }
  });

  // FIXED: Properly merge hourly data for charts
  const mergedSeries = useMemo(() => {
    console.log('🔄 Merging chart data...');
    console.log('GSA hourly data length:', sourceData.globalSolarAtlas.hourlyData?.length || 0);
    console.log('PVGIS hourly data length:', sourceData.pvgisEurope.hourlyData?.length || 0);
    console.log('BMKG hourly data length:', sourceData.bmkgIndonesia.hourlyData?.length || 0);
    
    const result = mergeHourlyDataForChart({
      gsa: sourceData.globalSolarAtlas.hourlyData || [],
      pvgis: sourceData.pvgisEurope.hourlyData || [],
      bmkg: sourceData.bmkgIndonesia.hourlyData || []
    });
    
    console.log('📊 Merged result length:', result.length);
    console.log('📊 First few merged items:', result.slice(0, 3));
    
    return result;
  }, [sourceData]);

  const fetchDatabaseData = useCallback(async () => {
    if (!backendConnected) {
      console.log('⚠️ Backend not connected, skipping database stats fetch');
      return;
    }
    
    try {
      console.log('📡 Fetching database stats...');
      const res = await fetch(`${BACKEND_URL}/api/database/stats`);
      const data = await res.json();
      
      console.log('📊 Database stats response:', data);
      
      if (data?.success) {
        setDatabaseStats({
          totalRecords: Number(data.stats.total_records) || 0,
          uniqueLocations: Number(data.stats.unique_locations) || 0,
          onlineScrapes: Number(data.stats.online_scrapes) || 0,
          offlineScrapes: Number(data.stats.offline_scrapes) || 0
        });
      }
    } catch (error) {
      console.error('❌ Error fetching database stats:', error);
      setDatabaseStats({ totalRecords: 0, uniqueLocations: 0, onlineScrapes: 0, offlineScrapes: 0 });
    }
  }, [backendConnected]);

  const fetchSourceData = useCallback(async () => {
    if (!backendConnected) {
      console.log('⚠️ Backend not connected, generating demo data');
      generateDemoSourceData();
      return;
    }
    
    try {
      console.log('📡 Fetching source data from backend...');
      
      const [gsaRes, pvgisRes, bmkgRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/sources/global-solar-atlas`),
        fetch(`${BACKEND_URL}/api/sources/pvgis-europe`),
        fetch(`${BACKEND_URL}/api/sources/bmkg-indonesia`)
      ]);

      const [gsaData, pvgisData, bmkgData] = await Promise.all([
        gsaRes.json(), pvgisRes.json(), bmkgRes.json()
      ]);

      console.log('🌞 GSA response:', gsaData);
      console.log('🌍 PVGIS response:', pvgisData);
      console.log('🇮🇩 BMKG response:', bmkgData);

      setSourceData({
        globalSolarAtlas: {
          status: gsaData.success ? 'connected' : 'error',
          totalRecords: Number(gsaData.data?.total_records) || 0,
          avgGHI: Number(gsaData.data?.avg_ghi) || 0,
          avgPVOutput: Number(gsaData.data?.avg_pv_output) || 0,
          lastUpdate: gsaData.data?.last_update || new Date().toISOString(),
          locations: gsaData.data?.locations || [],
          hourlyData: (gsaData.data?.hourly_data || []).map(d => ({
            timestamp: d.timestamp,
            ghi: d.ghi,
            dni: d.dni,
            dhi: d.dhi,
            pv_output: d.pv_output
          }))
        },
        pvgisEurope: {
          status: pvgisData.success ? 'connected' : 'error',
          totalRecords: Number(pvgisData.data?.total_records) || 0,
          avgGHI: Number(pvgisData.data?.avg_ghi) || 0,
          avgPVOutput: Number(pvgisData.data?.avg_pv_output) || 0,
          lastUpdate: pvgisData.data?.last_update || new Date().toISOString(),
          locations: pvgisData.data?.locations || [],
          hourlyData: (pvgisData.data?.hourly_data || []).map(d => ({
            timestamp: d.timestamp,
            ghi: d.ghi,
            dni: d.dni,
            pv_output: d.pv_output
          }))
        },
        bmkgIndonesia: {
          status: bmkgData.success ? 'connected' : 'error',
          totalRecords: Number(bmkgData.data?.total_records) || 0,
          avgTemp: Number(bmkgData.data?.avg_temperature) || 0,
          avgHumidity: Number(bmkgData.data?.avg_humidity) || 0,
          lastUpdate: bmkgData.data?.last_update || new Date().toISOString(),
          locations: bmkgData.data?.locations || [],
          hourlyData: (bmkgData.data?.hourly_data || []).map(d => ({
            timestamp: d.timestamp,
            ghi: d.ghi
          }))
        }
      });

      console.log('✅ Source data updated successfully');
    } catch (error) {
      console.error('❌ Error fetching source data:', error);
      generateDemoSourceData();
    }
  }, [backendConnected]);

  // Generate realistic demo data when backend is offline
  const generateDemoSourceData = useCallback(() => {
    console.log('🎭 Generating demo source data...');
    
    const hours = 48; // Last 48 hours of data
    const now = new Date();
    
    // Generate realistic hourly solar data
    const generateHourlyData = (baseGHI, variation = 0.3) => {
      return Array.from({ length: hours }, (_, i) => {
        const timeAgo = new Date(now.getTime() - (hours - i) * 60 * 60 * 1000);
        const hour = timeAgo.getHours();
        
        // Simulate daily solar cycle (0 at night, peak at noon)
        const solarFactor = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
        const randomVariation = 1 + (Math.random() - 0.5) * variation;
        
        const ghi = baseGHI * solarFactor * randomVariation;
        const dni = ghi * (0.7 + Math.random() * 0.3); // DNI typically 70-100% of GHI
        const dhi = ghi - dni * Math.cos(Math.PI/4); // Simplified DHI calculation
        const pvOutput = ghi * (4.2 + Math.random() * 0.8) * 10; // Realistic PV conversion
        
        return {
          timestamp: timeAgo.toISOString(),
          ghi: Math.max(0, ghi),
          dni: Math.max(0, dni),
          dhi: Math.max(0, dhi),
          pv_output: Math.max(0, pvOutput)
        };
      });
    };

    setSourceData({
      globalSolarAtlas: {
        status: 'connected',
        totalRecords: 2450,
        avgGHI: 4.85,
        avgPVOutput: 4.12,
        lastUpdate: new Date().toISOString(),
        locations: ['Jakarta', 'Depok', 'Bogor', 'Tangerang', 'Bekasi'],
        hourlyData: generateHourlyData(5.2, 0.25)
      },
      pvgisEurope: {
        status: 'connected',
        totalRecords: 1850,
        avgGHI: 3.92,
        avgPVOutput: 3.68,
        lastUpdate: new Date().toISOString(),
        locations: ['Jakarta', 'Bandung', 'Surabaya', 'Yogyakarta', 'Semarang'],
        hourlyData: generateHourlyData(4.8, 0.3).map(d => ({
          ...d,
          dhi: undefined // PVGIS might not have DHI
        }))
      },
      bmkgIndonesia: {
        status: 'connected',
        totalRecords: 2980,
        avgTemp: 28.5,
        avgHumidity: 74.2,
        lastUpdate: new Date().toISOString(),
        locations: ['Jakarta', 'Surabaya', 'Bandung', 'Medan', 'Semarang'],
        hourlyData: generateHourlyData(4.6, 0.35).map(d => ({
          timestamp: d.timestamp,
          ghi: d.ghi
          // BMKG typically only has GHI
        }))
      }
    });
    
    console.log('✅ Demo data generated successfully');
  }, []);

  const checkBackendConnection = useCallback(async () => {
    try {
      console.log('🔍 Checking backend connection...');
      const response = await fetch(`${BACKEND_URL}/api/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const isConnected = response.ok;
      setBackendConnected(isConnected);
      
      if (isConnected) {
        setLastUpdate(new Date());
        console.log('✅ Backend connected');
      } else {
        console.log('❌ Backend not responding');
      }
    } catch (error) {
      console.error('❌ Backend connection failed:', error.message);
      setBackendConnected(false);
    }
  }, []);

  const triggerManualScrape = async () => {
    if (!backendConnected) return;
    
    try {
      console.log('🚀 Triggering manual scrape...');
      const response = await fetch(`${BACKEND_URL}/api/scrape/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinates: { lat: -6.4025, lng: 106.7942 },
          location_name: 'Depok_Manual'
        })
      });
      
      const result = await response.json();
      console.log('📤 Manual scrape result:', result);
      
      if (result?.success) {
        // Refresh data after successful scrape
        setTimeout(() => {
          fetchDatabaseData();
          fetchSourceData();
        }, 2000);
      }
    } catch (error) {
      console.error('❌ Manual scrape failed:', error);
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
          <button onClick={fetchSourceData} style={{ marginRight: '1rem', padding: '0.75rem 1.5rem', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
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
              <p>Data Points: {sourceData.bmkgIndonesia.hourlyData.length}</p>
            </div>
          </div>
        </div>

        {/* Charts: 48-Hour Multi-Source Trends + Distribution */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
          <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb' }}>
            <h3 style={{ margin: 0, marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={20} color="#3b82f6" /> 48-Hour Multi-Source Metrics
              <span style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 400, marginLeft: '1rem' }}>
                ({mergedSeries.length} data points)
              </span>
            </h3>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={mergedSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis 
                  dataKey="displayTime" 
                  stroke="#6b7280" 
                  fontSize={12}
                  interval="preserveStartEnd"
                  tick={{ fontSize: 10 }}
                />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />

                {/* GSA Lines */}
                <Line 
                  type="monotone" 
                  dataKey="gsa_ghi" 
                  stroke={metricPalette.gsa_ghi} 
                  strokeWidth={2} 
                  name="GSA GHI" 
                  dot={false} 
                  connectNulls={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="gsa_dni" 
                  stroke={metricPalette.gsa_dni} 
                  strokeWidth={2} 
                  name="GSA DNI" 
                  dot={false} 
                  connectNulls={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="gsa_dhi" 
                  stroke={metricPalette.gsa_dhi} 
                  strokeWidth={2} 
                  name="GSA DHI" 
                  dot={false} 
                  connectNulls={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="gsa_pv_output" 
                  stroke={metricPalette.gsa_pv_output} 
                  strokeWidth={2} 
                  name="GSA PV Output" 
                  dot={false} 
                  connectNulls={false}
                />

                {/* PVGIS Lines */}
                <Line 
                  type="monotone" 
                  dataKey="pvgis_ghi" 
                  stroke={metricPalette.pvgis_ghi} 
                  strokeWidth={2} 
                  name="PVGIS GHI" 
                  dot={false} 
                  connectNulls={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="pvgis_dni" 
                  stroke={metricPalette.pvgis_dni} 
                  strokeWidth={2} 
                  name="PVGIS DNI" 
                  dot={false} 
                  connectNulls={false}
                />
                <Line 
                  type="monotone" 
                  dataKey="pvgis_pv_output" 
                  stroke={metricPalette.pvgis_pv_output} 
                  strokeWidth={2} 
                  name="PVGIS PV Output" 
                  dot={false} 
                  connectNulls={false}
                />

                {/* BMKG Lines */}
                <Line 
                  type="monotone" 
                  dataKey="bmkg_ghi" 
                  stroke={metricPalette.bmkg_ghi} 
                  strokeWidth={2} 
                  name="BMKG GHI" 
                  dot={false} 
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb' }}>
            <h3 style={{ margin: 0, marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Database size={20} color="#10b981" /> Data Points Distribution
            </h3>
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={[
                    { name: 'Global Solar Atlas', value: sourceData.globalSolarAtlas.hourlyData.length },
                    { name: 'PVGIS Europe', value: sourceData.pvgisEurope.hourlyData.length },
                    { name: 'BMKG Indonesia', value: sourceData.bmkgIndonesia.hourlyData.length }
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

        {/* Debug Information */}
        {!backendConnected && (
          <div style={{ backgroundColor: '#fef3c7', borderRadius: 12, padding: '1rem', marginBottom: '2rem', border: '1px solid #fbbf24' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <AlertCircle size={16} color="#d97706" />
              <span style={{ fontWeight: 600, color: '#92400e' }}>Demo Mode Active</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#92400e' }}>
              Backend server is offline. Displaying realistic demo data with {mergedSeries.length} simulated data points.
              Start your server with <code>node server.js</code> to see real data.
            </p>
          </div>
        )}

        {/* Detailed Table */}
        <div style={{ backgroundColor: 'white', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: 0, marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Globe size={20} color="#8b5cf6" /> Data Sources Detailed Table
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e5e7eb' }}>
                  {['Source', 'Status', 'Records', 'Data Points', 'Primary Metric', 'Last Update', 'Actions'].map((h, i) => (
                    <th key={i} style={{ 
                      padding: '0.75rem', 
                      textAlign: i === 0 ? 'left' : i === 1 || i === 5 || i === 6 ? 'center' : 'right', 
                      fontWeight: 600, 
                      color: '#374151', 
                      borderBottom: '1px solid #e5e7eb' 
                    }}>{h}</th>
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
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                    {getSourceIcon(sourceData.globalSolarAtlas.status)}
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', fontWeight: 600, color: sourceColors.gsa, borderBottom: '1px solid #e5e7eb' }}>
                    {sourceData.globalSolarAtlas.totalRecords.toLocaleString()}
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>
                    {sourceData.globalSolarAtlas.hourlyData.length}
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>
                    {niceNumber(sourceData.globalSolarAtlas.avgGHI)} kWh/m²/day
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', fontSize: '0.875rem', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                    {sourceData.globalSolarAtlas.lastUpdate ? new Date(sourceData.globalSolarAtlas.lastUpdate).toLocaleTimeString() : 'Never'}
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                    <button 
                      onClick={() => window.open('https://globalsolaratlas.info', '_blank')} 
                      style={{ 
                        padding: '0.25rem 0.5rem', 
                        fontSize: '0.75rem', 
                        backgroundColor: sourceColors.gsa, 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: 4, 
                        cursor: 'pointer' 
                      }}
                    >
                      View
                    </button>
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
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                    {getSourceIcon(sourceData.pvgisEurope.status)}
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', fontWeight: 600, color: sourceColors.pvgis, borderBottom: '1px solid #e5e7eb' }}>
                    {sourceData.pvgisEurope.totalRecords.toLocaleString()}
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>
                    {sourceData.pvgisEurope.hourlyData.length}
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>
                    {niceNumber(sourceData.pvgisEurope.avgPVOutput)} kWh/kWp/day
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', fontSize: '0.875rem', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                    {sourceData.pvgisEurope.lastUpdate ? new Date(sourceData.pvgisEurope.lastUpdate).toLocaleTimeString() : 'Never'}
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                    <button 
                      onClick={() => window.open('https://re.jrc.ec.europa.eu/pvg_tools/en/', '_blank')} 
                      style={{ 
                        padding: '0.25rem 0.5rem', 
                        fontSize: '0.75rem', 
                        backgroundColor: sourceColors.pvgis, 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: 4, 
                        cursor: 'pointer' 
                      }}
                    >
                      View
                    </button>
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
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center' }}>
                    {getSourceIcon(sourceData.bmkgIndonesia.status)}
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right', fontWeight: 600, color: sourceColors.bmkg }}>
                    {sourceData.bmkgIndonesia.totalRecords.toLocaleString()}
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right' }}>
                    {sourceData.bmkgIndonesia.hourlyData.length}
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'right' }}>
                    {niceNumber(sourceData.bmkgIndonesia.avgTemp, 1)}°C
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center', fontSize: '0.875rem', color: '#6b7280' }}>
                    {sourceData.bmkgIndonesia.lastUpdate ? new Date(sourceData.bmkgIndonesia.lastUpdate).toLocaleTimeString() : 'Never'}
                  </td>
                  <td style={{ padding: '1rem 0.75rem', textAlign: 'center' }}>
                    <button 
                      onClick={() => window.open('https://dataonline.bmkg.go.id', '_blank')} 
                      style={{ 
                        padding: '0.25rem 0.5rem', 
                        fontSize: '0.75rem', 
                        backgroundColor: sourceColors.bmkg, 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: 4, 
                        cursor: 'pointer' 
                      }}
                    >
                      View
                    </button>
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
            {[
              {
                title: 'Global Solar Atlas', 
                status: sourceData.globalSolarAtlas.status, 
                last: sourceData.globalSolarAtlas.lastUpdate, 
                color: sourceColors.gsa,
                dataPoints: sourceData.globalSolarAtlas.hourlyData.length
              }, 
              { 
                title: 'PVGIS Europe', 
                status: sourceData.pvgisEurope.status, 
                last: sourceData.pvgisEurope.lastUpdate, 
                color: sourceColors.pvgis,
                dataPoints: sourceData.pvgisEurope.hourlyData.length
              }, 
              { 
                title: 'BMKG Indonesia', 
                status: sourceData.bmkgIndonesia.status, 
                last: sourceData.bmkgIndonesia.lastUpdate, 
                color: sourceColors.bmkg,
                dataPoints: sourceData.bmkgIndonesia.hourlyData.length
              }
            ].map((card, i) => (
              <div key={i} style={{ 
                padding: '1rem', 
                backgroundColor: '#f8fafc', 
                borderRadius: 8, 
                borderLeft: `4px solid ${card.color}` 
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500 }}>{card.title}</span>
                  <div style={{ 
                    width: 8, 
                    height: 8, 
                    borderRadius: '50%', 
                    backgroundColor: card.status === 'connected' ? '#10b981' : '#ef4444', 
                    animation: card.status === 'connected' ? 'pulse 2s infinite' : 'none' 
                  }} />
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
                  Data points: {card.dataPoints}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  Last sync: {card.last ? new Date(card.last).toLocaleString() : 'Never'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ 
          marginTop: '2rem', 
          padding: '1rem', 
          backgroundColor: backendConnected ? '#f0f9ff' : '#fef2f2', 
          borderRadius: 8, 
          border: `1px solid ${backendConnected ? '#bae6fd' : '#fecaca'}`, 
          textAlign: 'center' 
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '0.5rem', 
            color: backendConnected ? '#0369a1' : '#dc2626', 
            fontSize: '0.875rem' 
          }}>
            {backendConnected ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            <span>
              {backendConnected 
                ? `Database connected with ${mergedSeries.length} chart data points. Auto-fetching every 30 seconds.`
                : 'Database offline. Displaying demo data. Start server to see real data.'
              }
            </span>
          </div>
          {!backendConnected && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
              Run: <code style={{ backgroundColor: '#f3f4f6', padding: '0.25rem', borderRadius: 4 }}>node server.js</code>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 
          0%, 100% { opacity: 1; } 
          50% { opacity: 0.5; } 
        }
      `}</style>
    </div>
  );
};

export default SolarAIDashboard;
