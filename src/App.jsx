import React, { useState, useRef, useEffect } from 'react';
import { callGeminiApi } from '../lib/gemini.js';
import './index.css';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const ANALYSIS_PROMPT = `You are a precise AI nutritionist. Analyze the food image provided and return ONLY valid JSON (no markdown, no prose):
{
  "meal_name": "string",
  "meal_description": "A detailed 2-4 sentence description of the meal, ingredients, cooking style, and overall nutritional character",
  "total_calories": number,
  "macros": { "protein_g": number, "carbs_g": number, "fats_g": number },
  "items_detected": [{ "name": "string", "emoji": "string", "estimated_weight_g": number, "calories": number }],
  "dietary_advice": "string with practical dietary tips for this meal"
}`;

function parseNutritionResponse(textOutput) {
  const cleanedJson = textOutput.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(cleanedJson);
}

async function analyzeWithGemini(apiKey, base64Image, prompt) {
  const text = await callGeminiApi(apiKey, base64Image, prompt);
  return parseNutritionResponse(text);
}

async function callGeminiProxy(base64Image, prompt) {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Image, prompt }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(data.error || `Server error (${response.status})`);
    err.status = response.status;
    throw err;
  }

  if (!data.text) throw new Error('No response from server');
  return parseNutritionResponse(data.text);
}

function isQuotaError(message = '') {
  const msg = message.toLowerCase();
  return msg.includes('quota') || msg.includes('limit: 0') || msg.includes('429');
}

function isTrafficError(message = '') {
  const msg = message.toLowerCase();
  return (
    msg.includes('high traffic') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable') ||
    msg.includes('try again') ||
    msg.includes('capacity') ||
    msg.includes('resource_exhausted')
  );
}

function compressImage(base64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) {
          height = Math.round(height * (MAX / width));
          width = MAX;
        } else {
          width = Math.round(width * (MAX / height));
          height = MAX;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1]);
    };
    img.onerror = () => reject(new Error('Failed to process image'));
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

export default function App() {
  const [stream, setStream] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nutrition, setNutrition] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [showBars, setShowBars] = useState(false);
  const [customApiKey, setCustomApiKey] = useState(() => {
    try { return localStorage.getItem('user_gemini_api_key') || ''; }
    catch { return ''; }
  });
  const [showSettings, setShowSettings] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const resultsRef = useRef(null);

  useEffect(() => {
    if (nutrition) {
      setShowBars(false);
      const timer = setTimeout(() => setShowBars(true), 100);
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return () => clearTimeout(timer);
    }
  }, [nutrition]);

  useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, [stream]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const toggleCamera = async () => {
    if (cameraOn) {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
      setCameraOn(false);
      setImagePreview(null);
    } else {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        setStream(mediaStream);
        setCameraOn(true);
        setImagePreview(null);
        setNutrition(null);
      } catch (err) {
        console.error('Camera error:', err);
        alert('Camera access denied. Please allow camera access or use the upload button.');
      }
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setCameraOn(false);
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setImagePreview(event.target.result);
      setNutrition(null);
    };
    reader.readAsDataURL(file);
  };

  const captureImage = () => {
    if (imagePreview) return imagePreview.split(',')[1];
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg').split(',')[1];
    }
    return null;
  };

  const analyzeImage = async () => {
    const activeKey = customApiKey || GEMINI_API_KEY;
    const rawImage = captureImage();
    if (!rawImage) return;

    setLoading(true);
    setNutrition(null);

    try {
      const base64Image = await compressImage(rawImage);
      let result;

      if (!import.meta.env.DEV) {
        try {
          result = await callGeminiProxy(base64Image, ANALYSIS_PROMPT);
        } catch (proxyErr) {
          if (!activeKey || isQuotaError(proxyErr.message) || isTrafficError(proxyErr.message) || proxyErr.status === 429) {
            throw proxyErr;
          }
          console.warn('Proxy unavailable, using client API:', proxyErr.message);
          result = await analyzeWithGemini(activeKey, base64Image, ANALYSIS_PROMPT);
        }
      } else if (activeKey) {
        result = await analyzeWithGemini(activeKey, base64Image, ANALYSIS_PROMPT);
      } else {
        alert('API Key missing! Click the settings gear at the top right to paste your Gemini API Key.\n\nGet a free key at: https://aistudio.google.com/apikey');
        return;
      }

      setNutrition(result);
    } catch (err) {
      console.error('API error:', err);
      const message = err.message || 'Unknown error';
      if (isTrafficError(message)) {
        alert(
          'Gemini servers are busy right now.\n\n' +
          'The app already retried multiple models automatically. Please:\n' +
          '1. Wait 30–60 seconds and try again\n' +
          '2. Use a fresh API key from https://aistudio.google.com/apikey\n' +
          '3. Avoid clicking Analyze repeatedly (that makes it worse)\n\n' +
          `Details: ${message.slice(0, 180)}`
        );
      } else if (isQuotaError(message)) {
        alert(
          'Gemini API quota exceeded.\n\n' +
          'Try these fixes:\n' +
          '1. Wait 1–2 minutes and try again\n' +
          '2. Create a new API key at https://aistudio.google.com/apikey\n' +
          '3. Link billing in Google AI Studio (free tier still works)\n' +
          '4. Paste a different key in Settings (gear icon)\n\n' +
          `Details: ${message.slice(0, 200)}`
        );
      } else if (message.includes('API key') || message.includes('403') || message.includes('401')) {
        alert(`Invalid or missing API key.\n\nOpen Settings (gear icon) and paste a valid Gemini key from https://aistudio.google.com/apikey\n\nDetails: ${message}`);
      } else {
        alert(`Error analyzing image: ${message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const saveApiKey = (value) => {
    setCustomApiKey(value);
    try { localStorage.setItem('user_gemini_api_key', value); }
    catch { /* private browsing — skip */ }
  };

  const clearApiKey = () => {
    setCustomApiKey('');
    try { localStorage.removeItem('user_gemini_api_key'); }
    catch { /* private browsing — skip */ }
  };

  const canAnalyze = cameraOn || imagePreview;

  const calculateMacroPercent = (macroVal, allMacros) => {
    const total = allMacros.protein_g + allMacros.carbs_g + allMacros.fats_g;
    if (total === 0) return 0;
    return Math.round((macroVal / total) * 100);
  };

  return (
    <>
      <div className="floating-background">
        <div className="glow-blob glow-1"></div>
        <div className="glow-blob glow-2"></div>
        <div className="glow-blob glow-3"></div>
        {/* Fixed icon names — only valid Tabler outline icons */}
        <i className="ti ti-cherry floating-item item-1" aria-hidden="true"></i>
        <i className="ti ti-plant floating-item item-2" aria-hidden="true"></i>
        <i className="ti ti-barbell floating-item item-3" aria-hidden="true"></i>
        <i className="ti ti-activity floating-item item-4" aria-hidden="true"></i>
        <i className="ti ti-salad floating-item item-5" aria-hidden="true"></i>
        <i className="ti ti-run floating-item item-6" aria-hidden="true"></i>
      </div>

      <div className="app-wrapper">
        <h2 className="sr-only">NutriSnap — AI-powered calorie and macro tracker. Point your camera at a meal to analyze its nutrition.</h2>

        <div className="header">
          <div className="header-icon">
            <i className="ti ti-salad" aria-hidden="true"></i>
          </div>
          <div className="header-text">
            <h1>NutriSnap</h1>
            <p>Analyze your meal with AI</p>
          </div>
          <button
            className="btn-settings"
            onClick={() => setShowSettings(!showSettings)}
            aria-label="Toggle API settings"
          >
            <i className="ti ti-settings" aria-hidden="true"></i>
          </button>
        </div>

        {showSettings && (
          <div className="card settings-card">
            <div className="settings-header">
              <h3>Gemini API Settings</h3>
              <button
                className="btn-close-settings"
                onClick={() => setShowSettings(false)}
                aria-label="Close settings"
              >
                <i className="ti ti-x" aria-hidden="true"></i>
              </button>
            </div>
            <p className="settings-description">
              Provide your own Gemini API key if the default key is rate-limited.
            </p>
            <div className="settings-input-group">
              <input
                type="password"
                placeholder="AIzaSy..."
                value={customApiKey}
                onChange={(e) => saveApiKey(e.target.value)}
              />
              {customApiKey && (
                <button className="btn-clear-key" onClick={clearApiKey}>
                  Clear
                </button>
              )}
            </div>
            <div className="settings-status">
              {customApiKey ? (
                <span className="status-badge status-custom">Using custom key</span>
              ) : GEMINI_API_KEY ? (
                <span className="status-badge status-env">Using environment key</span>
              ) : (
                <span className="status-badge status-fallback">No key set — enter one above</span>
              )}
            </div>
          </div>
        )}

        <div className="viewfinder">
          <div className="viewfinder-bracket bracket-tl"></div>
          <div className="viewfinder-bracket bracket-tr"></div>
          <div className="viewfinder-bracket bracket-bl"></div>
          <div className="viewfinder-bracket bracket-br"></div>

          {cameraOn && !imagePreview && (
            <video ref={videoRef} autoPlay playsInline muted></video>
          )}

          {imagePreview && (
            <img src={imagePreview} alt="Meal preview" />
          )}

          {!cameraOn && !imagePreview && (
            <div className="viewfinder-idle">
              <i className="ti ti-camera" aria-hidden="true"></i>
              <p>Point your camera at a meal to analyze calories and macros</p>
            </div>
          )}

          {loading && (
            <div className="scanline-overlay">
              <div className="loader-fruits">
                <span className="loader-fruit" aria-hidden="true">🥑</span>
                <span className="loader-fruit" aria-hidden="true">🍓</span>
                <span className="loader-fruit" aria-hidden="true">🍌</span>
              </div>
              <span className="scanline-text">Analyzing your meal...</span>
            </div>
          )}

          <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>
        </div>

        <div className="action-bar">
          <button
            onClick={toggleCamera}
            aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
          >
            <i className={`ti ${cameraOn ? 'ti-camera-off' : 'ti-camera'}`} aria-hidden="true"></i>
            {cameraOn ? 'Off' : 'Camera'}
          </button>

          <button
            className="btn-analyze"
            onClick={analyzeImage}
            disabled={!canAnalyze || loading}
            aria-label="Analyze meal"
          >
            <i className="ti ti-analyze" aria-hidden="true"></i>
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload image from device"
          >
            <i className="ti ti-upload" aria-hidden="true"></i>
            Upload
          </button>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept="image/*"
            onChange={handleFileUpload}
          />
        </div>

        <div className="results-panel" ref={resultsRef}>
          {loading && (
            <div className="card analysis-loading-card">
              <div className="analysis-loading-header">
                <i className="ti ti-loader-2 analysis-spinner" aria-hidden="true"></i>
                <span>Analyzing your meal...</span>
              </div>
              <p className="analysis-loading-text">Gemini AI is identifying ingredients and calculating nutrition.</p>
            </div>
          )}

          {nutrition && (
            <div className="results-area">
              <div className="results-section-label">Analysis Results</div>

              <div className="card meal-header-card">
                <div>
                  <div className="meal-name">{nutrition.meal_name}</div>
                  <div className="muted-label">Estimated total</div>
                </div>
                <div>
                  <div className="calories-value">{nutrition.total_calories}</div>
                  <div className="muted-label" style={{ textAlign: 'right' }}>kcal</div>
                </div>
              </div>

              {nutrition.meal_description && (
                <div className="card analysis-description-card">
                  <div className="analysis-description-header">
                    <i className="ti ti-file-description" aria-hidden="true"></i>
                    <span>Meal Description</span>
                  </div>
                  <p className="analysis-description-text">{nutrition.meal_description}</p>
                </div>
              )}

              <div className="macros-row">
                {[
                  { key: 'protein_g', label: 'Protein', icon: 'ti-egg-fried', cls: 'protein' },
                  { key: 'carbs_g',   label: 'Carbs',   icon: 'ti-bread',     cls: 'carbs'   },
                  { key: 'fats_g',    label: 'Fats',    icon: 'ti-droplet',   cls: 'fats'    },
                ].map(({ key, label, icon, cls }) => (
                  <div className="macro-card" key={key}>
                    <div className="macro-header">
                      <i className={`ti ${icon} ${cls}-icon`} aria-hidden="true"></i>
                      <span>{label}</span>
                    </div>
                    <div className="macro-value">{nutrition.macros?.[key] ?? 0}g</div>
                    <div className="progress-track">
                      <div
                        className={`progress-bar ${cls}-bar`}
                        style={{
                          width: showBars && nutrition.macros
                            ? `${calculateMacroPercent(nutrition.macros[key], nutrition.macros)}%`
                            : '0%'
                        }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>

              {nutrition.items_detected?.length > 0 && (
                <div className="card items-card">
                  <div className="items-header">Detected items</div>
                  {nutrition.items_detected.map((item, idx) => (
                    <div key={idx} className="item-row">
                      <div className="item-emoji">{item.emoji}</div>
                      <div className="item-details">
                        <div className="item-name">{item.name}</div>
                        <div className="muted-label">{item.estimated_weight_g}g</div>
                      </div>
                      <div className="item-calories">{item.calories} kcal</div>
                    </div>
                  ))}
                </div>
              )}

              {nutrition.dietary_advice && (
                <div className="card advice-card">
                  <i className="ti ti-bulb advice-icon" aria-hidden="true"></i>
                  <div>
                    <div className="advice-label">Dietary Advice</div>
                    <div className="advice-text">{nutrition.dietary_advice}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && !nutrition && (cameraOn || imagePreview) && (
            <div className="results-placeholder">
              <i className="ti ti-sparkles" aria-hidden="true"></i>
              <p>Tap <strong>Analyze</strong> to see calories, macros, and a full meal breakdown below.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}