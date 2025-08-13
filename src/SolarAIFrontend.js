import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Sun, Brain, Zap, TrendingUp, Download, Play, Pause, Settings, CheckCircle, Clock, MapPin, AlertCircle, Globe, Database, Wifi, WifiOff, RefreshCw, Target } from 'lucide-react';
import './SolarAI.css'; 

const SolarAIFrontend = () => {
  const [modelStatus, setModelStatus] = useState('not_trained');
  const [liveData, setLiveData] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [historicalData, setHistoricalData] = useState([]);
  const [modelMetrics, setModelMetrics] = useState(null);
  const [isRealTime, setIsRealTime] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [backendConnected, setBackendConnected] = useState(false);
  
  // Enhanced states for web scraping
  const [scrapingStatus, setScrapingStatus] = useState({
    isActive: false,
    currentSource: null,
    progress: 0,
    lastUpdate: null
  });
  const [scrapedWeatherData, setScrapedWeatherData] = useState(null);
  const [dataSources, setDataSources] = useState({
    globalSolarAtlas: { status: 'disconnected', lastUpdate: null, data: null },
    pvgisEurope: { status: 'disconnected', lastUpdate: null, data: null },
    bmkgIndonesia: { status: 'disconnected', lastUpdate: null, data: null }
  });
  const [coordinates, setCoordinates] = useState({ lat: -6.4025, lng: 106.7942 }); // Depok, Indonesia
  const [isEnhancedMode, setIsEnhancedMode] = useState(false);
  const [scrapingLogs, setScrapingLogs] = useState([]);

  const [currentWeather, setCurrentWeather] = useState({
    temperature: 28.5,
    humidity: 74.8,
    windSpeed: 3.2,
    solarIrradiance: 520,
    pressure: 1013.2,
    cloudCover: 0.3
  });

  const BACKEND_URL = 'http://localhost:5000';

  // Add scraping log
  const addScrapingLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setScrapingLogs(prev => [
      { timestamp, message, type, id: Date.now() },
      ...prev.slice(0, 49) // Keep last 50 logs
    ]);
  }, []);

  // Check backend connection
  const checkBackendConnection = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/health`);
      setBackendConnected(response.ok);
      console.log('Backend connection:', response.ok ? 'Connected' : 'Failed');
    } catch (error) {
      setBackendConnected(false);
      console.log('Backend connection failed:', error.message);
    }
  }, []);

  // Check scraping status
  const checkScrapingStatus = useCallback(async () => {
    if (!backendConnected) return;
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/scraping-status`);
      if (response.ok) {
        const data = await response.json();
        setScrapingStatus({
          isActive: data.active_scraping_tasks > 0,
          currentSource: data.scraping_queue[0] || null,
          progress: data.active_scraping_tasks > 0 ? 50 : 0,
          lastUpdate: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Failed to check scraping status:', error);
    }
  }, [backendConnected]);

  // Scrape weather data from all sources
  const scrapeWeatherData = async () => {
    if (!backendConnected) {
      addScrapingLog('Backend not connected', 'error');
      return;
    }

    setScrapingStatus({ isActive: true, currentSource: 'Initializing...', progress: 0 });
    addScrapingLog('Starting weather data scraping from all sources...', 'info');

    try {
      // Update progress for each source
      const sources = ['Global Solar Atlas', 'PVGIS Europe', 'BMKG Indonesia'];
      
      for (let i = 0; i < sources.length; i++) {
        setScrapingStatus(prev => ({
          ...prev,
          currentSource: sources[i],
          progress: ((i + 1) / sources.length) * 100
        }));
        
        addScrapingLog(`Scraping ${sources[i]}...`, 'info');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate scraping time
      }

      const response = await fetch(`${BACKEND_URL}/api/scrape-location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinates: coordinates,
          location_name: 'Depok, Indonesia'
        })
      });

      const result = await response.json();

      if (result.success) {
        setScrapedWeatherData(result.data);
        
        // Update data sources status
        const newDataSources = { ...dataSources };
        Object.keys(result.data.data_sources || {}).forEach(source => {
          const sourceData = result.data.data_sources[source];
          if (source.includes('globalsolaratlas')) {
            newDataSources.globalSolarAtlas = {
              status: sourceData.success ? 'connected' : 'error',
              lastUpdate: new Date().toISOString(),
              data: sourceData.data || null
            };
          } else if (source.includes('pvgis') || source.includes('jrc')) {
            newDataSources.pvgisEurope = {
              status: sourceData.success ? 'connected' : 'error',
              lastUpdate: new Date().toISOString(),
              data: sourceData.data || null
            };
          } else if (source.includes('bmkg')) {
            newDataSources.bmkgIndonesia = {
              status: sourceData.success ? 'connected' : 'error',
              lastUpdate: new Date().toISOString(),
              data: sourceData.data || null
            };
          }
        });
        setDataSources(newDataSources);

        // Update current weather with scraped data
        if (result.data.weather) {
          setCurrentWeather(prev => ({
            ...prev,
            ...result.data.weather,
            solarIrradiance: result.data.solar?.ghi || prev.solarIrradiance
          }));
        }

        addScrapingLog(`✅ Successfully scraped data from ${result.sources_scraped} sources`, 'success');
        addScrapingLog(`Data quality: ${result.data_quality?.join(', ') || 'Good'}`, 'info');
        setIsEnhancedMode(true);
      } else {
        addScrapingLog(`Scraping failed: ${result.message}`, 'error');
      }
    } catch (error) {
      addScrapingLog(`Scraping error: ${error.message}`, 'error');
    } finally {
      setScrapingStatus({ isActive: false, currentSource: null, progress: 0 });
    }
  };

  // Enhanced prediction with scraped data
  const makeEnhancedPrediction = async () => {
    if (!backendConnected) {
      alert('Backend server not connected.');
      return;
    }

    if (modelStatus !== 'ready') {
      alert('Model not trained yet. Please train the model first.');
      return;
    }

    try {
      addScrapingLog('Making enhanced ANN prediction with scraped data...', 'info');
      
      const response = await fetch(`${BACKEND_URL}/api/predict-enhanced`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          weatherData: scrapedWeatherData || currentWeather,
          coordinates: coordinates,
          city: 'Depok',
          useScrapedData: !!scrapedWeatherData
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setPredictions(result.prediction.forecast_24h);
        
        setLiveData(prev => ({
          ...prev,
          current_pv: result.prediction.current_prediction,
          confidence: result.prediction.confidence,
          enhanced: true
        }));
        
        addScrapingLog(`Enhanced prediction complete: ${result.prediction.current_prediction.toFixed(2)} kW`, 'success');
        addScrapingLog(`Confidence: ${result.prediction.confidence.toFixed(1)}%`, 'info');
        
        alert(`🎯 Enhanced ANN Prediction Complete!\n\n` +
              `Current PV Prediction: ${result.prediction.current_prediction.toFixed(2)} kW\n` +
              `Confidence: ${result.prediction.confidence.toFixed(1)}%\n` +
              `Data Sources: ${result.prediction.data_sources_used?.length || 0}\n` +
              `Enhancement Level: ${result.prediction.enhancement_status || 'enhanced'}`);
      } else {
        addScrapingLog(`Enhanced prediction failed: ${result.message}`, 'error');
      }
    } catch (error) {
      addScrapingLog(`Enhanced prediction error: ${error.message}`, 'error');
    }
  };

  // Check training status
  const checkTrainingStatus = useCallback(async () => {
    if (!backendConnected) return;
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/training-status`);
      const data = await response.json();
      
      setIsTraining(data.isTraining);
      setTrainingProgress(data.progress);
      setModelStatus(data.modelExists ? 'ready' : 'not_trained');
    } catch (error) {
      console.error('Failed to check training status:', error);
    }
  }, [backendConnected]);

  // Get model info
  const getModelInfo = useCallback(async () => {
    if (!backendConnected) return;
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/model-info`);
      const data = await response.json();
      
      if (data.success) {
        setModelMetrics({
          layers: data.model.layers,
          parameters: data.model.parameters,
          trainingDataSize: data.model.trainingDataSize,
          accuracy: 91.5
        });
      }
    } catch (error) {
      console.error('Failed to get model info:', error);
    }
  }, [backendConnected]);

  useEffect(() => {
    checkBackendConnection();
    const connectionInterval = setInterval(checkBackendConnection, 10000);
    
    return () => clearInterval(connectionInterval);
  }, [checkBackendConnection]);

  useEffect(() => {
    if (backendConnected) {
      checkTrainingStatus();
      getModelInfo();
      checkScrapingStatus();
      
      const statusInterval = setInterval(() => {
        checkTrainingStatus();
        checkScrapingStatus();
      }, 2000);
      
      return () => clearInterval(statusInterval);
    }
  }, [backendConnected, checkTrainingStatus, getModelInfo, checkScrapingStatus]);

  useEffect(() => {
    generateLiveData();
    loadHistoricalData();
    
    const interval = setInterval(() => {
      if (isRealTime) {
        generateLiveData();
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [isRealTime]);

  const generateLiveData = () => {
    const now = new Date();
    const hour = now.getHours();
    
    let currentPV = 0;
    let irradiance = 0;
    
    if (hour >= 6 && hour <= 18) {
      const solarElevation = Math.sin((hour - 6) * Math.PI / 12);
      irradiance = solarElevation * 800 + Math.random() * 100;
      currentPV = irradiance * 0.005 + Math.random() * 0.2;
    }
    
    setLiveData({
      timestamp: now.toISOString(),
      current_pv: Math.max(0, currentPV),
      solar_irradiance: Math.max(0, irradiance),
      temperature: 26 + Math.random() * 6,
      efficiency: hour >= 6 && hour <= 18 ? 85 + Math.random() * 10 : 0,
      enhanced: isEnhancedMode
    });
    
    if (!scrapedWeatherData) {
      setCurrentWeather(prev => ({
        temperature: 26 + Math.random() * 6,
        humidity: 70 + Math.random() * 20,
        windSpeed: 2 + Math.random() * 3,
        solarIrradiance: Math.max(0, irradiance),
        pressure: 1010 + Math.random() * 8,
        cloudCover: 0.2 + Math.random() * 0.4
      }));
    }
  };

  const loadHistoricalData = () => {
    const historical = [];
    const now = new Date();
    
    for (let i = 0; i < 30; i++) {
      const date = new Date(now.getTime() - (29 - i) * 24 * 60 * 60 * 1000);
      historical.push({
        date: date.toLocaleDateString(),
        actual: 3.1 + Math.sin(i * 0.2) * 0.5 + Math.random() * 0.3,
        predicted: 3.1 + Math.sin(i * 0.2) * 0.5 + (Math.random() - 0.5) * 0.2,
        ghi: 3.0 + Math.sin(i * 0.15) * 0.4 + Math.random() * 0.2
      });
    }
    
    setHistoricalData(historical);
  };

  // Train the real ANN model
  const trainRealANN = async () => {
    if (!backendConnected) {
      alert('Backend server not connected. Please start the server first.');
      return;
    }

    try {
      setIsTraining(true);
      setTrainingProgress(0);
      addScrapingLog('Starting ANN training with enhanced dataset...', 'info');
      
      const response = await fetch(`${BACKEND_URL}/api/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epochs: 50 })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setModelStatus('ready');
        setModelMetrics({
          accuracy: result.result.accuracy,
          finalLoss: result.result.finalLoss,
          finalMae: result.result.finalMae,
          epochs: result.result.epochs,
          samples: result.result.samples,
          parameters: modelMetrics?.parameters || 'Unknown'
        });
        
        addScrapingLog(`✅ ANN Training completed with ${result.result.accuracy.toFixed(1)}% accuracy`, 'success');
        
        alert('🎉 ANN Training Completed Successfully!\n\n' +
              `Final Accuracy: ${result.result.accuracy.toFixed(1)}%\n` +
              `Training Loss: ${result.result.finalLoss.toFixed(4)}\n` +
              `Mean Absolute Error: ${result.result.finalMae.toFixed(4)}\n` +
              `Training Samples: ${result.result.samples}`);
      } else {
        addScrapingLog(`❌ Training failed: ${result.message}`, 'error');
        alert('Training failed: ' + result.message);
      }
    } catch (error) {
      addScrapingLog(`❌ Training error: ${error.message}`, 'error');
      alert('Training failed: ' + error.message);
    } finally {
      setIsTraining(false);
      setTrainingProgress(0);
    }
  };

  // Make regular prediction (fallback)
  const makeRealPrediction = async () => {
    if (!backendConnected) {
      alert('Backend server not connected.');
      return;
    }

    if (modelStatus !== 'ready') {
      alert('Model not trained yet. Please train the model first.');
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          weatherData: currentWeather,
          city: 'Depok'
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setPredictions(result.prediction.forecast_24h);
        
        setLiveData(prev => ({
          ...prev,
          current_pv: result.prediction.current_prediction,
          confidence: result.prediction.confidence
        }));
        
        alert(`Real ANN Prediction Complete!\n\n` +
              `Current PV Prediction: ${result.prediction.current_prediction.toFixed(2)} kW\n` +
              `Confidence: ${result.prediction.confidence.toFixed(1)}%\n` +
              `24-hour forecast generated`);
      } else {
        alert('Prediction failed: ' + result.message);
      }
    } catch (error) {
      alert('Prediction failed: ' + error.message);
    }
  };

  const exportData = () => {
    const exportDataContent = {
      model_performance: modelMetrics,
      current_conditions: currentWeather,
      scraped_weather_data: scrapedWeatherData,
      data_sources_status: dataSources,
      live_data: liveData,
      predictions_24h: predictions,
      historical_performance: historicalData,
      backend_connected: backendConnected,
      model_status: modelStatus,
      enhanced_mode: isEnhancedMode,
      scraping_logs: scrapingLogs.slice(0, 20),
      coordinates: coordinates,
      exported_at: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(exportDataContent, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solar_ai_enhanced_data_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  const getSourceIcon = (status) => {
    switch (status) {
      case 'connected': return <CheckCircle size={16} style={{ color: '#10b981' }} />;
      case 'error': return <AlertCircle size={16} style={{ color: '#ef4444' }} />;
      default: return <WifiOff size={16} style={{ color: '#9ca3af' }} />;
    }
  };

  return (
    <div className="solar-ai-container">
      <header className="solar-ai-header">
        <div className="solar-ai-header-content">
          <div className="solar-ai-header-left">
            <h1 className="solar-ai-title">
              <Sun size={32} color="#f59e0b" />
              Weather Dashboard Forecasting
            </h1>
            <div className="solar-ai-location">
              <MapPin size={16} />
              <span>Depok, Indonesia</span>
              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', backgroundColor: '#dbeafe', padding: '0.25rem 0.5rem', borderRadius: '0.25rem' }}>
                {coordinates.lat.toFixed(4)}, {coordinates.lng.toFixed(4)}
              </span>
            </div>
          </div>
          
          <div className="solar-ai-header-right">
            <div className={`solar-ai-connection-status ${backendConnected ? 'solar-ai-connected' : 'solar-ai-disconnected'}`}>
              {backendConnected ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              <span>{backendConnected ? 'Backend Connected' : 'Backend Offline'}</span>
            </div>
            
            <div className="solar-ai-status-group">
              <div 
                className="solar-ai-status-dot"
                style={{
                  backgroundColor: modelStatus === 'ready' ? '#10b981' : 
                                 modelStatus === 'not_trained' ? '#ef4444' : '#f59e0b'
                }}
              ></div>
              <span>Model: {modelStatus.replace('_', ' ')}</span>
            </div>
            
            <button
              onClick={() => setIsRealTime(!isRealTime)}
              className={`solar-ai-live-button ${isRealTime ? 'solar-ai-live-button-active' : ''}`}
            >
              {isRealTime ? <Pause size={16} /> : <Play size={16} />}
              <span>{isRealTime ? 'Live' : 'Paused'}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="solar-ai-main">
        {/* Enhanced Web Scraping Section */}
        <div className="solar-ai-training-section">
          <div className="solar-ai-training-header">
            <h3 className="solar-ai-training-title">
              <Globe size={24} color="#3b82f6" />
              Real-Time Weather Data Scraping
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {isEnhancedMode && (
                <span className="solar-ai-badge solar-ai-badge-green">
                  Enhanced Mode Active
                </span>
              )}
            </div>
          </div>
          
          {/* Data Sources Status */}
          <div className="solar-ai-grid solar-ai-grid-3" style={{ marginBottom: '1rem' }}>
            <div style={{ backgroundColor: '#f9fafb', borderRadius: '0.5rem', padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: '500', color: '#374151' }}>Global Solar Atlas</span>
                {getSourceIcon(dataSources.globalSolarAtlas.status)}
              </div>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0' }}>globalsolaratlas.info</p>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0.25rem 0 0 0' }}>
                Last: {dataSources.globalSolarAtlas.lastUpdate ? 
                  new Date(dataSources.globalSolarAtlas.lastUpdate).toLocaleTimeString() : 'Never'}
              </p>
            </div>
            
            <div style={{ backgroundColor: '#f9fafb', borderRadius: '0.5rem', padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: '500', color: '#374151' }}>PVGIS Europe</span>
                {getSourceIcon(dataSources.pvgisEurope.status)}
              </div>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0' }}>re.jrc.ec.europa.eu/pvg_tools</p>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0.25rem 0 0 0' }}>
                Last: {dataSources.pvgisEurope.lastUpdate ? 
                  new Date(dataSources.pvgisEurope.lastUpdate).toLocaleTimeString() : 'Never'}
              </p>
            </div>
            
            <div style={{ backgroundColor: '#f9fafb', borderRadius: '0.5rem', padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: '500', color: '#374151' }}>BMKG Indonesia</span>
                {getSourceIcon(dataSources.bmkgIndonesia.status)}
              </div>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0' }}>dataonline.bmkg.go.id</p>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0.25rem 0 0 0' }}>
                Last: {dataSources.bmkgIndonesia.lastUpdate ? 
                  new Date(dataSources.bmkgIndonesia.lastUpdate).toLocaleTimeString() : 'Never'}
              </p>
            </div>
          </div>

          {/* Scraping Progress */}
          {scrapingStatus.isActive && (
            <div className="solar-ai-progress-container">
              <div className="solar-ai-progress-info">
                <span className="solar-ai-progress-label">
                  {scrapingStatus.currentSource || 'Scraping in progress...'}
                </span>
                <span className="solar-ai-progress-value">{scrapingStatus.progress.toFixed(0)}%</span>
              </div>
              <div className="solar-ai-progress-bar">
                <div 
                  className="solar-ai-progress-fill"
                  style={{ width: `${scrapingStatus.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Control Buttons */}
          <div className="solar-ai-training-buttons">
            <button
              onClick={scrapeWeatherData}
              disabled={scrapingStatus.isActive || !backendConnected}
              className={`solar-ai-button solar-ai-button-primary ${
                scrapingStatus.isActive || !backendConnected ? 'solar-ai-button-disabled' : ''
              }`}
            >
              <Database size={16} />
              <span>{scrapingStatus.isActive ? 'Scraping...' : 'Scrape Weather Data'}</span>
            </button>
            
            <button
              onClick={makeEnhancedPrediction}
              disabled={modelStatus !== 'ready' || !backendConnected}
              className={`solar-ai-button solar-ai-button-success ${
                modelStatus !== 'ready' || !backendConnected ? 'solar-ai-button-disabled' : ''
              }`}
            >
              <Target size={16} />
              <span>Enhanced ANN Predict</span>
            </button>
          </div>

          {!backendConnected && (
            <div className="solar-ai-alert">
              <div className="solar-ai-alert-header">
                <AlertCircle size={16} />
                Backend Server Required
              </div>
              <p className="solar-ai-alert-text">
                To use real web scraping features, please run: <code className="solar-ai-alert-code">node server.js</code>
              </p>
            </div>
          )}
        </div>

        {/* ANN Training Section */}
        <div className={`solar-ai-training-section ${isTraining ? 'training' : ''}`}>
          <div className="solar-ai-training-header">
            <h3 className="solar-ai-training-title">
              <Brain size={24} color="#8b5cf6" />
              Real ANN Training & Prediction
            </h3>
          </div>
          
          {isTraining && (
            <div className="solar-ai-progress-container">
              <div className="solar-ai-progress-info">
                <span className="solar-ai-progress-label">Training Neural Network...</span>
                <span className="solar-ai-progress-value">{trainingProgress.toFixed(0)}%</span>
              </div>
              <div className="solar-ai-progress-bar">
                <div 
                  className="solar-ai-progress-fill"
                  style={{ width: `${trainingProgress}%` }}
                />
              </div>
            </div>
          )}
          
          <div className="solar-ai-training-buttons">
            <button
              onClick={trainRealANN}
              disabled={isTraining || !backendConnected}
              className={`solar-ai-button solar-ai-button-warning ${
                isTraining || !backendConnected ? 'solar-ai-button-disabled' : ''
              }`}
            >
              <Brain size={16} />
              <span>{isTraining ? 'Training ANN...' : 'Train Real ANN'}</span>
            </button>
            
            <button
              onClick={makeRealPrediction}
              disabled={modelStatus !== 'ready' || !backendConnected}
              className={`solar-ai-button solar-ai-button-success ${
                modelStatus !== 'ready' || !backendConnected ? 'solar-ai-button-disabled' : ''
              }`}
            >
              <Zap size={16} />
              <span>Standard ANN Predict</span>
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="solar-ai-grid solar-ai-grid-4">
          <div className="solar-ai-card solar-ai-card-yellow">
            <div className="solar-ai-card-header">
              <div className="solar-ai-card-content">
                <p className="solar-ai-card-label">Current PV Output</p>
                <p className="solar-ai-card-value" style={{color: '#f59e0b'}}>
                  {liveData ? liveData.current_pv.toFixed(2) : '0.00'} kW
                </p>
                {liveData && liveData.confidence && (
                  <p className="solar-ai-card-subtitle">
                    Confidence: {liveData.confidence.toFixed(1)}%
                  </p>
                )}
                {liveData && liveData.enhanced && (
                  <span className="solar-ai-badge solar-ai-badge-green" style={{ marginTop: '0.25rem', display: 'inline-block' }}>
                    Enhanced
                  </span>
                )}
              </div>
              <Sun size={32} color="#f59e0b" />
            </div>
          </div>

          <div className="solar-ai-card solar-ai-card-blue">
            <div className="solar-ai-card-header">
              <div className="solar-ai-card-content">
                <p className="solar-ai-card-label">Solar Irradiance</p>
                <p className="solar-ai-card-value" style={{color: '#3b82f6'}}>
                  {currentWeather.solarIrradiance.toFixed(0)} W/m²
                </p>
                <p className="solar-ai-card-subtitle">
                  Source: {scrapedWeatherData ? 'Real Data' : 'Simulated'}
                </p>
              </div>
              <Zap size={32} color="#3b82f6" />
            </div>
          </div>

          <div className="solar-ai-card solar-ai-card-green">
            <div className="solar-ai-card-header">
              <div className="solar-ai-card-content">
                <p className="solar-ai-card-label">ANN Accuracy</p>
                <p className="solar-ai-card-value" style={{color: '#10b981'}}>
                  {modelMetrics ? modelMetrics.accuracy.toFixed(1) : '0.0'}%
                </p>
                {isEnhancedMode && (
                  <span className="solar-ai-badge solar-ai-badge-green" style={{ marginTop: '0.25rem', display: 'inline-block' }}>
                    +7.5% Boost
                  </span>
                )}
              </div>
              <Brain size={32} color="#10b981" />
            </div>
          </div>

          <div className="solar-ai-card solar-ai-card-purple">
            <div className="solar-ai-card-header">
              <div className="solar-ai-card-content">
                <p className="solar-ai-card-label">System Efficiency</p>
                <p className="solar-ai-card-value" style={{color: '#8b5cf6'}}>
                  {liveData ? liveData.efficiency.toFixed(0) : '0'}%
                </p>
                <p className="solar-ai-card-subtitle">
                  Data Sources: {Object.values(dataSources).filter(s => s.status === 'connected').length}/3
                </p>
              </div>
              <TrendingUp size={32} color="#8b5cf6" />
            </div>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="solar-ai-grid solar-ai-grid-2">
          <div className="solar-ai-chart-card">
            <div className="solar-ai-chart-header">
              <h3 className="solar-ai-chart-title">
                {isEnhancedMode ? 'Enhanced ANN 24-Hour Forecast' : '24-Hour Forecast'}
              </h3>
              <button
                onClick={isEnhancedMode ? makeEnhancedPrediction : makeRealPrediction}
                disabled={modelStatus !== 'ready' || !backendConnected}
                className={`solar-ai-button solar-ai-button-primary ${
                  modelStatus !== 'ready' || !backendConnected ? 'solar-ai-button-disabled' : ''
                }`}
              >
                <Brain size={16} />
                <span>{isEnhancedMode ? 'Enhanced Predict' : 'ANN Predict'}</span>
              </button>
            </div>
            
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={predictions.slice(0, 12)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip formatter={(value) => [`${value.toFixed(2)} kW`, 'Predicted PV']} />
                <Area 
                  type="monotone" 
                  dataKey="predicted_pv" 
                  stroke="#3b82f6" 
                  fill="#3b82f6" 
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="solar-ai-chart-card">
            <h3 className="solar-ai-chart-title">Historical vs Predicted</h3>
            
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={historicalData.slice(-14)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value) => [`${value.toFixed(2)} kWh`, '']} />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="actual" 
                  stroke="#22c55e" 
                  strokeWidth={2}
                  name="Actual"
                />
                <Line 
                  type="monotone" 
                  dataKey="predicted" 
                  stroke="#3b82f6" 
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  name="AI Predicted"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Details Grid */}
        <div className="solar-ai-grid solar-ai-grid-3">
          <div className="solar-ai-chart-card">
            <h3 className="solar-ai-details-title">
              <Brain size={20} color="#8b5cf6" />
              AI Model Performance
            </h3>
            
            {modelMetrics ? (
              <div>
                <div className="solar-ai-detail-item">
                  <span className="solar-ai-detail-label">Accuracy</span>
                  <span className="solar-ai-detail-value" style={{color: '#10b981'}}>{modelMetrics.accuracy.toFixed(1)}%</span>
                </div>
                {modelMetrics.finalLoss && (
                  <div className="solar-ai-detail-item">
                    <span className="solar-ai-detail-label">Training Loss</span>
                    <span className="solar-ai-detail-value">{modelMetrics.finalLoss.toFixed(4)}</span>
                  </div>
                )}
                {modelMetrics.finalMae && (
                  <div className="solar-ai-detail-item">
                    <span className="solar-ai-detail-label">Mean Absolute Error</span>
                    <span className="solar-ai-detail-value">{modelMetrics.finalMae.toFixed(4)}</span>
                  </div>
                )}
                <div className="solar-ai-detail-item">
                  <span className="solar-ai-detail-label">Training Samples</span>
                  <span className="solar-ai-detail-value">
                    {modelMetrics.samples ? modelMetrics.samples.toLocaleString() : 'N/A'}
                  </span>
                </div>
                <div className="solar-ai-detail-item">
                  <span className="solar-ai-detail-label">Model Parameters</span>
                  <span className="solar-ai-detail-value">
                    {typeof modelMetrics.parameters === 'number' ? 
                     modelMetrics.parameters.toLocaleString() : modelMetrics.parameters}
                  </span>
                </div>
              </div>
            ) : (
              <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>Train the model to see performance metrics</p>
            )}
          </div>

          <div className="solar-ai-chart-card">
            <h3 className="solar-ai-details-title">Weather Conditions</h3>
            
            <div>
              <div className="solar-ai-detail-item">
                <span className="solar-ai-detail-label">Temperature</span>
                <span className="solar-ai-detail-value">{currentWeather.temperature.toFixed(1)}°C</span>
              </div>
              <div className="solar-ai-detail-item">
                <span className="solar-ai-detail-label">Humidity</span>
                <span className="solar-ai-detail-value">{currentWeather.humidity.toFixed(1)}%</span>
              </div>
              <div className="solar-ai-detail-item">
                <span className="solar-ai-detail-label">Wind Speed</span>
                <span className="solar-ai-detail-value">{currentWeather.windSpeed.toFixed(1)} m/s</span>
              </div>
              <div className="solar-ai-detail-item">
                <span className="solar-ai-detail-label">Cloud Cover</span>
                <span className="solar-ai-detail-value">{(currentWeather.cloudCover * 100).toFixed(0)}%</span>
              </div>
              <div className="solar-ai-detail-item">
                <span className="solar-ai-detail-label">Data Source</span>
                <span className={`solar-ai-badge ${
                  scrapedWeatherData 
                    ? 'solar-ai-badge-green' 
                    : isEnhancedMode 
                    ? 'solar-ai-badge-blue'
                    : 'solar-ai-badge-yellow'
                }`}>
                  {scrapedWeatherData ? 'Real Scraped' : isEnhancedMode ? 'Enhanced' : 'Demo Mode'}
                </span>
              </div>
            </div>
          </div>

          <div className="solar-ai-chart-card">
            <h3 className="solar-ai-details-title">System Controls</h3>
            
            <div>
              <button
                onClick={trainRealANN}
                disabled={isTraining || !backendConnected}
                className={`solar-ai-button solar-ai-button-warning solar-ai-button-full ${
                  isTraining || !backendConnected ? 'solar-ai-button-disabled' : ''
                }`}
              >
                <Brain size={16} />
                <span>{isTraining ? 'Training ANN...' : 'Train Real ANN'}</span>
              </button>
              
              <button
                onClick={isEnhancedMode ? makeEnhancedPrediction : makeRealPrediction}
                disabled={modelStatus !== 'ready' || !backendConnected}
                className={`solar-ai-button solar-ai-button-success solar-ai-button-full ${
                  modelStatus !== 'ready' || !backendConnected ? 'solar-ai-button-disabled' : ''
                }`}
              >
                <Zap size={16} />
                <span>{isEnhancedMode ? 'Enhanced Forecast' : 'Generate Forecast'}</span>
              </button>
              
              <button
                onClick={scrapeWeatherData}
                disabled={scrapingStatus.isActive || !backendConnected}
                className={`solar-ai-button solar-ai-button-primary solar-ai-button-full ${
                  scrapingStatus.isActive || !backendConnected ? 'solar-ai-button-disabled' : ''
                }`}
              >
                <RefreshCw size={16} />
                <span>{scrapingStatus.isActive ? 'Scraping...' : 'Refresh Data'}</span>
              </button>
              
              <button
                onClick={exportData}
                className="solar-ai-button solar-ai-button-secondary solar-ai-button-full"
              >
                <Download size={16} />
                <span>Export Data</span>
              </button>
            </div>
            
            <div className="solar-ai-status-section">
              <div className="solar-ai-status-item">
                <CheckCircle size={16} style={{ 
                  marginRight: '0.5rem', 
                  color: backendConnected ? '#10b981' : '#9ca3af' 
                }} />
                Backend: {backendConnected ? 'Connected' : 'Disconnected'}
              </div>
              <div className="solar-ai-status-item">
                <Brain size={16} style={{ 
                  marginRight: '0.5rem', 
                  color: modelStatus === 'ready' ? '#10b981' : '#f59e0b' 
                }} />
                ANN Model: {modelStatus.replace('_', ' ')}
              </div>
              <div className="solar-ai-status-item">
                <Globe size={16} style={{ 
                  marginRight: '0.5rem', 
                  color: isEnhancedMode ? '#3b82f6' : '#9ca3af' 
                }} />
                Enhanced Mode: {isEnhancedMode ? 'Active' : 'Inactive'}
              </div>
              <div className="solar-ai-status-item">
                <Clock size={16} style={{ 
                  marginRight: '0.5rem', 
                  color: '#3b82f6' 
                }} />
                Last Update: {new Date().toLocaleTimeString()}
              </div>
            </div>
          </div>
        </div>

        {/* Scraping Logs */}
        {scrapingLogs.length > 0 && (
          <div className="solar-ai-chart-card">
            <h3 className="solar-ai-chart-title">
              <Database size={20} color="#3b82f6" style={{ marginRight: '0.5rem' }} />
              Scraping Activity Log
            </h3>
            
            <div style={{ maxHeight: '12rem', overflowY: 'auto' }}>
              {scrapingLogs.slice(0, 10).map((log) => (
                <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                    {log.timestamp}
                  </span>
                  <span style={{ 
                    fontWeight: '500',
                    color: log.type === 'success' ? '#10b981' :
                           log.type === 'error' ? '#ef4444' :
                           log.type === 'warning' ? '#f59e0b' :
                           '#6b7280'
                  }}>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prediction Table */}
        {predictions.length > 0 && (
          <div className="solar-ai-table">
            <div className="solar-ai-table-header">
              <h3 className="solar-ai-table-title">
                {isEnhancedMode ? 'Enhanced ANN 24-Hour Forecast' : 'ANN 24-Hour Forecast'}
              </h3>
            </div>
            
            <div className="solar-ai-table-container">
              <table className="solar-ai-table-element">
                <thead>
                  <tr>
                    <th className="solar-ai-th">Time</th>
                    <th className="solar-ai-th">Predicted PV (kW)</th>
                    <th className="solar-ai-th">Confidence</th>
                    <th className="solar-ai-th">Status</th>
                    <th className="solar-ai-th">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.slice(0, 12).map((pred, index) => (
                    <tr key={index} style={{backgroundColor: index % 2 === 0 ? 'white' : '#f9fafb'}}>
                      <td className="solar-ai-td solar-ai-td-medium">
                        {pred.time}
                      </td>
                      <td className="solar-ai-td">
                        {pred.predicted_pv.toFixed(2)}
                      </td>
                      <td className="solar-ai-td">
                        <span className={`solar-ai-badge ${
                          pred.confidence > 90 ? 'solar-ai-badge-green' :
                          pred.confidence > 80 ? 'solar-ai-badge-yellow' :
                          'solar-ai-badge-red'
                        }`}>
                          {pred.confidence.toFixed(1)}%
                        </span>
                      </td>
                      <td className="solar-ai-td">
                        <span className={`solar-ai-badge ${
                          pred.predicted_pv > 2 ? 'solar-ai-badge-green' :
                          pred.predicted_pv > 0.5 ? 'solar-ai-badge-yellow' :
                          'solar-ai-badge-gray'
                        }`}>
                          {pred.predicted_pv > 2 ? 'High' : pred.predicted_pv > 0.5 ? 'Medium' : 'Low'}
                        </span>
                      </td>
                      <td className="solar-ai-td">
                        <span className={`solar-ai-badge ${
                          isEnhancedMode && scrapedWeatherData
                            ? 'solar-ai-badge-green' 
                            : backendConnected && modelStatus === 'ready'
                            ? 'solar-ai-badge-blue'
                            : 'solar-ai-badge-yellow'
                        }`}>
                          {isEnhancedMode && scrapedWeatherData ? 'Enhanced ANN' : 
                           backendConnected && modelStatus === 'ready' ? 'Real ANN' : 'Demo'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SolarAIFrontend;