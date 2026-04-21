/** Base URL path for bundled assets (from this module). */
const __seasonCardDir = (() => {
  try {
    return new URL(".", import.meta.url).pathname.replace(/\/+$/, "");
  } catch {
    return "/local/community/season-card/dist";
  }
})();
class SeasonCard extends HTMLElement {
  static iconCache = new Map();
  static temperatureScaleCache = new Map();
  static sensorSeasonKeys = ["winter", "spring", "summer", "autumn"];
  static sensorSeasonIcons = { winter: "❄️", spring: "🍃", summer: "☀️", autumn: "🍂" };

  constructor() {
    super();
    this._built = false;
    this._dragging = false;
    this._currentIndex = 0;
    this._previewIndex = null;
    this._pointerId = null;
    this._hass = null;
    this._sceneGradientId = `season-scene-sky-${Math.random().toString(36).slice(2, 10)}`;
    /** Cache parapluie (prévisions horaires) : clé bucket → { show, title, ariaLabel, leadText } */
    this._rainUmbrellaCacheKey = "";
    this._rainUmbrellaCached = undefined;
  }

  setConfig(config) {
    if (!config.entity && !config.weather_entity) throw new Error("entity ou weather_entity requis");
    this._config = {
      weather_entity: null,
      weather_label: true,
      weather_color: "var(--primary-text-color)",
      weather_icon_path: `${__seasonCardDir}/season-icons`,
      weather_sunrise_entity: "sensor.sun_next_rising_short",
      weather_sunset_entity: "sensor.sun_next_setting_short",
      weather_ambiance: "gradient",
      weather_temperature_colorscale_path: `${__seasonCardDir}/temperature-colorscale.json`,
      weather_motif_winter_path: `${__seasonCardDir}/season-icons/winter.png`,
      weather_motif_midseason_path: `${__seasonCardDir}/season-icons/mid-season.png`,
      weather_motif_summer_path: `${__seasonCardDir}/season-icons/summer.png`,
      weather_pattern_opacity: 0.2,
      low_temp: 12,
      high_temp: 25,
      /** Afficher ☂️ si pluie probable d’ici 24 h (prévisions horaires HA). */
      weather_rain_umbrella: true,
      /** Forcer l’affichage du ☂️ (démo / mise en page), sans appeler les prévisions. Ignoré si `weather_rain_umbrella: false`. */
      weather_rain_umbrella_force: false,
      /** Si force actif : `aria-label` du bloc pluie (détail accessibilité). Chaîne vide = libellé par défaut. */
      weather_rain_umbrella_force_hint: null,
      /** Si force actif : heure affichée à côté du ☂️ (ex. `13:00` ou `1:00 PM`). Défaut `13:00` si absent ou vide. */
      weather_rain_umbrella_force_lead: "13:00",
      /** Mode sensor.season: force l'affichage d'une saison (winter|spring|summer|autumn) pour test visuel. */
      season_force: null,
      ...config,
    };
    this._weatherOnlyMode = !this._config.entity;
    this._sensorSeasonMode = false;
    this._sensorSeasonLabel = "";
    this._built = false;
    this._rainUmbrellaCacheKey = "";
    this._rainUmbrellaCached = undefined;
  }

  _fireMoreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      })
    );
  }

  _bindMoreInfo(el, entityId) {
    if (!el || !entityId) return;
    el.style.cursor = "pointer";
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._fireMoreInfo(entityId);
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        this._fireMoreInfo(entityId);
      }
    });
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    if (!el.hasAttribute("role")) el.setAttribute("role", "button");
  }

  _formatSceneTime(value) {
    if (value == null) return "--";
    const s = String(value).trim();
    if (!s) return "--";
    const m = s.match(/(\d{1,2})\s*h\s*(\d{2})/i) || s.match(/(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    }
    return s;
  }

  _updateWeatherScene(weather, sunriseState, sunsetState, windSpeed) {
    const svg = this.querySelector("#weather-scene");
    if (!svg) return;
    svg.style.color = this._config.weather_color || "var(--primary-text-color)";
  }

  /** Vent en km/h pour le ressenti (attributs météo HA). */
  _windSpeedKmh(weather) {
    const raw = weather?.attributes?.wind_speed;
    if (raw == null || raw === "") return NaN;
    const unit = String(weather?.attributes?.wind_speed_unit || "").toLowerCase();
    const n = parseFloat(String(raw).replace(",", ".").replace(/\s*(km\/h|kmh|m\/s|ms|mph)\s*/gi, "").trim());
    if (!Number.isFinite(n) || n < 0) return NaN;
    if (unit.includes("m/s") || unit.includes("m s")) return n * 3.6;
    if (unit.includes("mph")) return n * 1.60934;
    return n;
  }

  /**
   * Température ressentie (approximation) :
   * Teq = Tair - 1{Tair<15} * V^0.5/2 + 1{Tair>25} * 1{HR>40} * (HR-40) * 0.15
   * (V = vent km/h)
   */
  _feltTemperature(tair, hrPct, windKmh) {
    if (tair == null || Number.isNaN(tair)) return null;
    const T = Number(tair);
    const HR = hrPct == null || Number.isNaN(Number(hrPct)) ? null : Number(hrPct);
    let teq = T;
    const V = Number(windKmh);
    if (T < 15 && Number.isFinite(V) && V > 0) {
      teq -= Math.sqrt(V) / 2;
    }
    if (T > 25 && HR != null && HR > 40) {
      teq += (HR - 40) * 0.15;
    }
    return teq;
  }

  _patternDisplayOpacity() {
    let o = Number(this._config.weather_pattern_opacity);
    if (!Number.isFinite(o)) o = Number(this._config.weather_motif_opacity);
    if (!Number.isFinite(o)) o = 0.2;
    return Math.min(1, Math.max(0, o));
  }

  /** Température °C pour motifs / ambiance / ressenti (override YAML `external_temp`). */
  _effectiveOutdoorTempC(weather) {
    const raw = this._config.external_temp;
    if (raw != null && raw !== "") {
      const ext = Number(raw);
      if (Number.isFinite(ext)) return ext;
    }
    const t = parseFloat(weather?.attributes?.temperature);
    return Number.isFinite(t) ? t : null;
  }

  _localizeWeatherState(hass, state) {
    if (!hass?.localize || !state) return state;
    const keys = [`component.weather.state.${state}`, `state.weather.${state}`];
    for (const k of keys) {
      const t = hass.localize(k);
      if (t && t !== k) return t;
    }
    return state;
  }

  _defaultTemperatureScale() {
    return {
      zmin: -10,
      zmax: 50,
      colorscale: [
        [0.0, "#1a1a1a"],
        [0.116667, "#dcd0ff"],
        [0.216667, "#ffffff"],
        [0.333333, "#c1e8ff"],
        [0.416667, "#8eb9f5"],
        [0.45, "#a1d6b2"],
        [0.5, "#fef3c7"],
        [0.583333, "#ffb38a"],
        [0.666667, "#e57373"],
        [0.75, "#5e271a"],
        [1.0, "#000000"],
      ],
    };
  }

  async _loadTemperatureScale() {
    const path = this._config.weather_temperature_colorscale_path;
    if (!path) return this._defaultTemperatureScale();
    if (SeasonCard.temperatureScaleCache.has(path)) return SeasonCard.temperatureScaleCache.get(path);
    try {
      const res = await fetch(path, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = await res.json();
      if (!Array.isArray(parsed.colorscale) || parsed.colorscale.length < 2) throw new Error("invalid colorscale");
      SeasonCard.temperatureScaleCache.set(path, parsed);
      return parsed;
    } catch (_e) {
      const fallback = this._defaultTemperatureScale();
      SeasonCard.temperatureScaleCache.set(path, fallback);
      return fallback;
    }
  }

  _hexToRgb(hex) {
    const h = String(hex || "").trim().replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 127, g: 127, b: 127 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  _interpolateHex(a, b, t) {
    const c1 = this._hexToRgb(a);
    const c2 = this._hexToRgb(b);
    const mix = (x, y) => Math.round(x + (y - x) * t);
    return `rgb(${mix(c1.r, c2.r)}, ${mix(c1.g, c2.g)}, ${mix(c1.b, c2.b)})`;
  }

  _temperatureColor(temp, scaleDef) {
    if (temp == null || Number.isNaN(temp)) return "rgb(150,170,200)";
    const zmin = Number(scaleDef?.zmin ?? -10);
    const zmax = Number(scaleDef?.zmax ?? 50);
    const stops = Array.isArray(scaleDef?.colorscale) ? scaleDef.colorscale : [];
    if (stops.length < 2 || zmax <= zmin) return "rgb(150,170,200)";
    const n = Math.min(1, Math.max(0, (temp - zmin) / (zmax - zmin)));
    for (let i = 0; i < stops.length - 1; i += 1) {
      const [p1, c1] = stops[i];
      const [p2, c2] = stops[i + 1];
      if (n >= p1 && n <= p2) {
        const r = p2 === p1 ? 0 : (n - p1) / (p2 - p1);
        return this._interpolateHex(c1, c2, r);
      }
    }
    const c = this._hexToRgb(stops[stops.length - 1][1]);
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  }

  /** Luminance ~ [0,1] depuis une chaîne `rgb(...)` / `rgba(...)`. */
  _luminanceFromRgbCss(s) {
    const m = String(s || "")
      .trim()
      .match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    const r = +m[1] / 255;
    const g = +m[2] / 255;
    const b = +m[3] / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** Résout `var(--primary-text-color)` en `rgb(...)` pour la teinte des motifs. */
  _resolvedPrimaryTextRgbForMotif() {
    if (!this.isConnected || !this.ownerDocument?.body) return "rgb(224, 224, 224)";
    try {
      const el = this.ownerDocument.createElement("span");
      el.style.cssText = "position:fixed;left:-9999px;top:0;color:var(--primary-text-color)";
      this.ownerDocument.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      if (c && !/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(c)) return c;
    } catch (_e) {
      /* ignore */
    }
    return "rgb(224, 224, 224)";
  }

  /** Évite noir / gris très foncé sur les masques d’ambiance (motifs invisibles en dark). */
  _motifTintFromTemperatureColor(tempColor) {
    const L = this._luminanceFromRgbCss(tempColor);
    if (L != null && L < 0.18) return this._resolvedPrimaryTextRgbForMotif();
    return tempColor;
  }

  /**
   * Luminance relative du texte principal L ∈ [0, 1] → facteur f ∈ [0.01, 0.99].
   * Sert à assombrir / éclaircir la **teinte** `--motif-tint` (plus de `filter: brightness` sur le bloc).
   */
  _motifThemeFactorFromPrimaryText() {
    const rgb = this._resolvedPrimaryTextRgbForMotif();
    let L = this._luminanceFromRgbCss(rgb);
    if (L == null) L = 0.5;
    L = Math.min(1, Math.max(0, L));
    return 0.01 + L * 0.98;
  }

  /**
   * Ajuste la couleur de teinte du motif selon le thème : mélange OKLCH avec noir (UI claire, texte foncé)
   * ou blanc (UI sombre, texte clair), en conservant la teinte mieux qu’un `brightness()` global.
   * @param {string} tintCss couleur résolue (ex. `rgb(...)`)
   * @param {number} f facteur dans [0.01, 0.99], même sens qu’avant (bas = assombrir, haut = éclaircir)
   */
  _motifTintAdjustedForTheme(tintCss, f) {
    const tint = String(tintCss || "rgb(150,170,200)").trim();
    const mid = 0.5;
    const eps = 1e-6;
    const half = (0.99 - 0.01) / 2;
    if (Math.abs(f - mid) < eps) return tint;
    const t = Math.min(1, Math.abs(f - mid) / half);
    /** Part du noir / blanc aux extrêmes de f (0 = teinte pure au centre). */
    const maxMixPct = 58;
    const p = Math.round(t * maxMixPct);
    const a = 100 - p;
    if (f < mid) {
      return `color-mix(in oklch, ${tint} ${a}%, black ${p}%)`;
    }
    return `color-mix(in oklch, ${tint} ${a}%, white ${p}%)`;
  }

  _motifThresholds() {
    let low = Number(this._config.low_temp);
    let high = Number(this._config.high_temp);
    if (!Number.isFinite(low)) low = 12;
    if (!Number.isFinite(high)) high = 25;
    if (low >= high) {
      low = 12;
      high = 25;
    }
    return { low, high };
  }

  _updateMotifLayer(temp, tintColor) {
    const motifs = this.querySelector("#season-card-motifs");
    if (!motifs) return;
    const winter = this.querySelector("#motif-winter");
    const mid = this.querySelector("#motif-mid");
    const summer = this.querySelector("#motif-summer");
    if (!winter || !mid || !summer) return;

    if (temp == null || Number.isNaN(temp)) {
      motifs.style.display = "none";
      motifs.style.filter = "";
      motifs.style.webkitFilter = "";
      return;
    }

    const { low, high } = this._motifThresholds();
    const showWinter = temp < low;
    const showSummer = temp > high;
    const showMid = !showWinter && !showSummer;

    const vis = String(this._patternDisplayOpacity());
    motifs.style.display = "block";
    motifs.style.filter = "";
    motifs.style.webkitFilter = "";
    const rawTint = tintColor || "rgb(150,170,200)";
    const fTheme = this._motifThemeFactorFromPrimaryText();
    motifs.style.setProperty("--motif-tint", this._motifTintAdjustedForTheme(rawTint, fTheme));
    winter.style.opacity = showWinter ? vis : "0";
    mid.style.opacity = showMid ? vis : "0";
    summer.style.opacity = showSummer ? vis : "0";
  }

  _ambianceGradient(condition, temp, scaleDef) {
    const t = typeof temp === "number" && !Number.isNaN(temp) ? temp : null;
    const subtle = (a, b) => `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;

    if (t != null) {
      const tempColor = this._temperatureColor(t, scaleDef);
      return subtle(`color-mix(in srgb, ${tempColor} 28%, transparent)`, `color-mix(in srgb, ${tempColor} 8%, transparent)`);
    }

    switch (condition) {
      case "sunny":
      case "clear-night":
        return subtle("rgba(255, 200, 100, 0.1)", "rgba(255, 255, 255, 0.02)");
      case "rainy":
      case "pouring":
      case "lightning-rainy":
        return subtle("rgba(80, 140, 220, 0.14)", "rgba(120, 160, 200, 0.06)");
      case "snowy":
      case "snowy-rainy":
      case "hail":
        return subtle("rgba(200, 220, 255, 0.12)", "rgba(255, 255, 255, 0.08)");
      case "windy":
      case "windy-variant":
        return subtle("rgba(160, 180, 200, 0.1)", "rgba(220, 230, 240, 0.04)");
      case "fog":
        return subtle("rgba(180, 190, 200, 0.12)", "rgba(220, 220, 225, 0.05)");
      case "lightning":
      case "exceptional":
        return subtle("rgba(255, 180, 80, 0.1)", "rgba(200, 100, 100, 0.06)");
      case "partlycloudy":
      case "cloudy":
      default:
        return subtle("rgba(150, 170, 200, 0.08)", "rgba(230, 235, 245, 0.03)");
    }
  }

  async _updateAmbiance(weather) {
    const layer = this.querySelector("#season-card-ambiance");
    if (!layer) return;

    const mode = this._config.weather_ambiance;
    if (!mode || mode === false) {
      layer.style.display = "none";
      this._updateMotifLayer(null, null);
      return;
    }

    if (!weather) {
      layer.style.display = "none";
      this._updateMotifLayer(null, null);
      return;
    }

    const temp = this._effectiveOutdoorTempC(weather);
    const scaleDef = await this._loadTemperatureScale();
    const tempColor = this._temperatureColor(temp, scaleDef);
    const grad = this._ambianceGradient(weather.state, temp, scaleDef);
    layer.style.display = "block";
    layer.style.background = grad;
    layer.style.opacity = mode === true || mode === "gradient" ? "1" : "0.6";
    this._updateMotifLayer(temp, this._motifTintFromTemperatureColor(tempColor));
  }

  _optionKey(option) {
    return String(option || "").toUpperCase();
  }

  _normalizeSeasonState(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  _seasonIndexFromState(value) {
    const s = this._normalizeSeasonState(value);
    if (!s) return 1;
    if (s === "winter" || s.includes("hiver")) return 0;
    if (s === "summer" || s.includes("ete")) return 2;
    if (s === "spring" || s.includes("printemps")) return 1;
    if (s === "autumn" || s === "fall" || s.includes("automne")) return 3;
    return 1;
  }

  _coerceSeasonKey(value) {
    const s = this._normalizeSeasonState(value);
    if (s === "winter" || s.includes("hiver")) return "winter";
    if (s === "summer" || s.includes("ete")) return "summer";
    if (s === "spring" || s.includes("printemps")) return "spring";
    if (s === "autumn" || s === "fall" || s.includes("automne")) return "autumn";
    return null;
  }

  _sensorSeasonKeys() {
    return SeasonCard.sensorSeasonKeys;
  }

  _isInputSelectEntity(entityId) {
    return String(entityId || "").startsWith("input_select.");
  }

  _localizeSeasonKey(hass, key) {
    const k = String(key || "").toLowerCase();
    const candidates = [`component.season.state.${k}`, `component.sensor.state.season.${k}`, `state.default.${k}`];
    for (const c of candidates) {
      const t = hass?.localize?.(c);
      if (t && t !== c) return t;
    }
    const fallback = { winter: "Winter", spring: "Spring", summer: "Summer", autumn: "Autumn" };
    return fallback[k] || k;
  }

  _sensorSeasonOptions(hass) {
    return this._sensorSeasonKeys().map((k) => `${SeasonCard.sensorSeasonIcons[k]} ${this._localizeSeasonKey(hass, k)}`);
  }

  _railColor(option) {
    const key = this._optionKey(option);
    if (key.includes("WINTER") || key.includes("HIVER")) return "var(--accent-color)";
    if (key.includes("SPRING") || key.includes("PRINTEMPS")) return "var(--disabled-color, var(--secondary-text-color))";
    if (key.includes("AUTUMN") || key.includes("AUTOMN") || key.includes("FALL") || key.includes("AUTOMNE")) {
      return "var(--disabled-color, var(--secondary-text-color))";
    }
    if (key.includes("MID") || key.includes("SEASON") || key.includes("MI-SAISON")) {
      return "var(--disabled-color, var(--secondary-text-color))";
    }
    if (key.includes("SUMMER") || key.includes("ETE") || key.includes("ÉTÉ")) return "var(--primary-color)";
    return "var(--primary-color)";
  }

  _sensorRailColorForIndex(index) {
    if (index === 0) return "var(--primary-color)";
    if (index === 2) return "var(--accent-color)";
    return "var(--disabled-color, var(--secondary-text-color))";
  }

  _weatherIconForCondition(condition) {
    const map = {
      "clear-night": "clear-night.svg",
      cloudy: "cloudy.svg",
      exceptional: "exceptional.svg",
      fog: "fog.svg",
      hail: "hail.svg",
      lightning: "lightning.svg",
      "lightning-rainy": "lightning-rain.svg",
      partlycloudy: "partlycloudy-day.svg",
      pouring: "pouring.svg",
      rainy: "rain.svg",
      snowy: "snow.svg",
      "snowy-rainy": "sleet.svg",
      sunny: "clear-day.svg",
      windy: "wind.svg",
      "windy-variant": "wind.svg",
    };
    return map[condition] || "cloudy.svg";
  }

  async _loadWeatherIconSvg(condition) {
    const iconName = this._weatherIconForCondition(condition);
    const iconPath = `${this._config.weather_icon_path}/${iconName}`;
    if (SeasonCard.iconCache.has(iconPath)) return SeasonCard.iconCache.get(iconPath);

    const response = await fetch(iconPath, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Impossible de charger ${iconPath}`);
    const svg = await response.text();
    SeasonCard.iconCache.set(iconPath, svg);
    return svg;
  }

  /** Météo déjà « pluvie » (parapluie même sans prévision horaire). */
  _weatherStateIsRainy(state) {
    return ["rainy", "pouring", "lightning-rainy", "hail", "snowy-rainy"].includes(String(state || ""));
  }

  /** Prévisions horaires fournies via les attributs de l’entité météo. */
  _legacyHourlyForecastFromAttributes(weather) {
    const fc = weather?.attributes?.forecast;
    if (!Array.isArray(fc) || fc.length < 3) return null;
    const t0 = new Date(fc[0]?.datetime).getTime();
    const t1 = new Date(fc[1]?.datetime).getTime();
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
    const hours = (t1 - t0) / (3600 * 1000);
    if (hours > 0 && hours < 3) return fc;
    return null;
  }

  _extractHourlyForecastRows(serviceResponse, entityId) {
    if (!serviceResponse || !entityId) return null;
    const pick = (obj) => {
      if (!obj || typeof obj !== "object") return null;
      if (obj[entityId]?.forecast && Array.isArray(obj[entityId].forecast)) return obj[entityId].forecast;
      const hit = Object.keys(obj).find((k) => k === entityId);
      if (hit && Array.isArray(obj[hit]?.forecast)) return obj[hit].forecast;
      return null;
    };
    const root = serviceResponse.result ?? serviceResponse;
    return pick(root) || pick(serviceResponse.response);
  }

  async _callWeatherGetForecasts(hass, entityId) {
    if (!hass || !entityId) return null;
    const msg = {
      type: "call_service",
      domain: "weather",
      service: "get_forecasts",
      target: { entity_id: entityId },
      service_data: { type: "hourly" },
      return_response: true,
    };
    try {
      if (typeof hass.callWS === "function") return await hass.callWS(msg);
      if (hass.connection?.sendMessagePromise) return await hass.connection.sendMessagePromise(msg);
    } catch (_e) {
      /* service indisponible ou entité sans prévisions horaires */
    }
    return null;
  }

  /**
   * Première tranche pluvieuse dans les 24 h (mêmes seuils que l’affichage parapluie).
   * @returns {{ hit: boolean, firstHitMs: number | null }}
   */
  _scanHourlyRainRisk24h(rows, nowMs) {
    const horizon = nowMs + 24 * 60 * 60 * 1000;
    const minMm = 0.1;
    const minProb = 45;
    let firstHitMs = null;
    for (const row of rows) {
      const dt = new Date(row?.datetime).getTime();
      if (!Number.isFinite(dt) || dt < nowMs - 60 * 1000 || dt > horizon) continue;
      const mm = Number(row?.precipitation);
      const prob = Number(row?.precipitation_probability);
      const hitMm = Number.isFinite(mm) && mm >= minMm;
      const hitProb = Number.isFinite(prob) && prob >= minProb;
      if (!hitMm && !hitProb) continue;
      if (firstHitMs == null || dt < firstHitMs) firstHitMs = dt;
    }
    return { hit: firstHitMs != null, firstHitMs };
  }

  /** Heure locale de la première tranche à risque (affichage à côté du ☂️, même style que le ressenti). */
  _formatFirstRainClock(firstHitMs, hass) {
    if (firstHitMs == null || !Number.isFinite(firstHitMs)) return "";
    const d = new Date(firstHitMs);
    if (Number.isNaN(d.getTime())) return "";
    const lang = hass?.locale?.language ?? hass?.language ?? undefined;
    return d.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" });
  }

  /**
   * @returns {{ show: boolean, title: string, ariaLabel: string, leadText: string }}
   */
  async _computeRainUmbrellaHint(hass, weatherEntityId, weatherState, weatherObj) {
    const empty = { show: false, title: "", ariaLabel: "", leadText: "" };
    if (this._config.weather_rain_umbrella === false) return empty;
    if (this._config.weather_rain_umbrella_force === true) {
      const rawLead = this._config.weather_rain_umbrella_force_lead;
      const leadText = rawLead != null && String(rawLead).trim() !== "" ? String(rawLead).trim() : "13:00";
      const rawAria = this._config.weather_rain_umbrella_force_hint;
      const ariaLabel =
        rawAria != null && String(rawAria).trim() !== ""
          ? String(rawAria).trim()
          : `Test : parapluie et heure ${leadText} affichés par YAML (retirer weather_rain_umbrella_force).`;
      return { show: true, title: "", ariaLabel, leadText };
    }
    const now = Date.now();
    const bucket = Math.floor(now / (5 * 60 * 1000));
    const cacheKey = `${weatherEntityId}|${bucket}|${weatherState}`;
    if (this._rainUmbrellaCacheKey === cacheKey && this._rainUmbrellaCached && typeof this._rainUmbrellaCached.show === "boolean") {
      return this._rainUmbrellaCached;
    }

    const rainyNow = this._weatherStateIsRainy(weatherState);
    let rows = this._legacyHourlyForecastFromAttributes(weatherObj);
    if (!rows) {
      const res = await this._callWeatherGetForecasts(hass, weatherEntityId);
      rows = this._extractHourlyForecastRows(res, weatherEntityId);
    }
    const scan = Array.isArray(rows) && rows.length ? this._scanHourlyRainRisk24h(rows, now) : { hit: false, firstHitMs: null };
    const show = rainyNow || scan.hit;

    let ariaLabel = "Risque de pluie dans les prochaines vingt-quatre heures";
    let leadText = "";
    if (show && rainyNow && !scan.hit) {
      leadText = "--";
      ariaLabel = "Précipitations indiquées pour l’instant présent ; heure de la prochaine pluie indisponible.";
    } else if (show && scan.hit && scan.firstHitMs != null) {
      const clock = this._formatFirstRainClock(scan.firstHitMs, hass);
      leadText = clock || "--";
      ariaLabel = clock
        ? `Précipitation probable vers ${clock} (prévisions horaires).`
        : "Précipitation probable selon les prévisions horaires ; heure indisponible.";
    } else if (show) {
      leadText = "--";
      ariaLabel = "Risque de pluie signalé ; heure de la première pluie indisponible.";
    }

    const out = { show, title: "", ariaLabel, leadText };
    this._rainUmbrellaCacheKey = cacheKey;
    this._rainUmbrellaCached = out;
    return out;
  }

  async _renderWeather(hass) {
    if (!this._weather || !this._config.weather_entity) return;
    const weather = hass.states?.[this._config.weather_entity];
    if (!weather) {
      this._weather.style.display = "none";
      this._updateAmbiance(null);
      return;
    }

    const sunriseState = hass.states?.[this._config.weather_sunrise_entity];
    const sunsetState = hass.states?.[this._config.weather_sunset_entity];
    const humidity = weather.attributes?.humidity;
    const windSpeed = weather.attributes?.wind_speed;
    const tEffective = this._effectiveOutdoorTempC(weather);

    this._weather.style.display = "block";

    this._weatherTemp.textContent =
      tEffective == null || Number.isNaN(tEffective)
        ? "--"
        : `${Math.abs(tEffective - Math.round(tEffective)) < 1e-6 ? Math.round(tEffective) : (Math.round(tEffective * 10) / 10).toFixed(1)}°C`;
    this._weatherHumidity.textContent = humidity == null ? "RH --" : `RH ${humidity}%`;
    this._weatherWind.textContent =
      windSpeed == null || windSpeed === "" ? "--" : `${String(windSpeed).replace(/\s*km\/h\s*$/i, "").trim()} km/h`;
    this._weatherSunrise.textContent = this._formatSceneTime(sunriseState?.state);
    this._weatherSunset.textContent = this._formatSceneTime(sunsetState?.state);

    const windKmh = this._windSpeedKmh(weather);
    const teq = this._feltTemperature(tEffective, humidity, windKmh);
    if (this._weatherFeels) {
      this._weatherFeels.textContent = teq == null || Number.isNaN(teq) ? "--" : `${teq.toFixed(1)}°C`;
    }

    await this._updateAmbiance(weather);
    this._updateWeatherScene(weather, sunriseState, sunsetState, windSpeed);

    const slot = this.querySelector("#weather-condition-slot");
    if (!slot) return;
    try {
      const svg = await this._loadWeatherIconSvg(weather.state);
      slot.innerHTML = svg;
      const svgEl = slot.querySelector("svg");
      if (svgEl) {
        const iw = 76;
        const ih = 66;
        svgEl.setAttribute("width", String(iw));
        svgEl.setAttribute("height", String(ih));
        svgEl.style.display = "block";
        svgEl.style.color = this._config.weather_color;
        svgEl.style.opacity = "0.95";
        const sky = this.querySelector("#weather-sky-row");
        if (sky) sky.style.setProperty("--weather-icon-h", `${ih}px`);
      }
    } catch (_err) {
      slot.textContent = "";
    }

    const rainWrap = this.querySelector("#weather-rain-wrap");
    const rainLead = this.querySelector("#weather-rain-lead");
    if (rainWrap && rainLead) {
      const hint = await this._computeRainUmbrellaHint(hass, this._config.weather_entity, weather.state, weather);
      rainWrap.style.display = hint.show ? "inline-flex" : "none";
      rainWrap.setAttribute("aria-hidden", hint.show ? "false" : "true");
      rainWrap.setAttribute("aria-label", hint.show ? hint.ariaLabel : "Risque de pluie à 24 h");
      rainWrap.removeAttribute("title");
      rainLead.textContent = hint.show && hint.leadText ? hint.leadText : "";
    }
  }

  _build(options, hass, weatherOnly = false, sensorMode = false) {
    this._built = true;
    this.style.containerType = "inline-size";
    const gid = this._sceneGradientId;
    const br = "var(--ha-card-border-radius, 12px)";
    const we = this._config.weather_entity;

    this.innerHTML = `
      <ha-card style="
        padding: 0;
        overflow: hidden;
        position: relative;
        border-radius: ${br};
        background: var(--card-background-color, var(--ha-card-background, var(--secondary-background-color)));
        box-shadow: var(--ha-card-box-shadow, none);
      ">
        <div id="season-card-motifs" style="
          display: none;
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: clamp(88px, 24%, 170px);
          pointer-events: none;
          z-index: 0;
          --motif-tint: rgb(150,170,200);
        ">
          <span id="motif-winter" style="
            position: absolute;
            inset: 0;
            opacity: 0;
            background-color: var(--motif-tint);
            -webkit-mask-image: url('${this._config.weather_motif_winter_path}');
            mask-image: url('${this._config.weather_motif_winter_path}');
            -webkit-mask-size: auto 100%;
            mask-size: auto 100%;
            -webkit-mask-repeat: no-repeat;
            mask-repeat: no-repeat;
            -webkit-mask-position: left center;
            mask-position: left center;
          "></span>
          <span id="motif-mid" style="
            position: absolute;
            inset: 0;
            opacity: 0;
            background-color: var(--motif-tint);
            -webkit-mask-image: url('${this._config.weather_motif_midseason_path}');
            mask-image: url('${this._config.weather_motif_midseason_path}');
            -webkit-mask-size: auto 100%;
            mask-size: auto 100%;
            -webkit-mask-repeat: no-repeat;
            mask-repeat: no-repeat;
            -webkit-mask-position: left center;
            mask-position: left center;
          "></span>
          <span id="motif-summer" style="
            position: absolute;
            inset: 0;
            opacity: 0;
            background-color: var(--motif-tint);
            -webkit-mask-image: url('${this._config.weather_motif_summer_path}');
            mask-image: url('${this._config.weather_motif_summer_path}');
            -webkit-mask-size: auto 100%;
            mask-size: auto 100%;
            -webkit-mask-repeat: no-repeat;
            mask-repeat: no-repeat;
            -webkit-mask-position: left center;
            mask-position: left center;
          "></span>
        </div>
        <div id="season-card-ambiance" style="
          display: none;
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 1;
          transition: background 0.35s ease, opacity 0.35s ease;
        "></div>
        <div style="position: relative; z-index: 2; display: flex; flex-direction: column; gap: 0;">
          <div style="padding: 6px 12px 6px; ${weatherOnly ? "display:none;" : ""}">
            <div id="track" style="
              position: relative;
              width: 100%;
              height: 28px;
              border-radius: 999px;
              box-sizing: border-box;
              overflow: hidden;
              user-select: none;
              touch-action: pan-y;
              cursor: pointer;
              background: transparent;
            ">
              <div id="rail" style="position: absolute; left: 3px; right: 3px; top: 50%; transform: translateY(-50%); height: 7px; border-radius: 999px; background: color-mix(in srgb, var(--secondary-background-color) 92%, var(--divider-color) 8%); box-shadow: inset 0 1px 2px color-mix(in srgb, black 18%, transparent), inset 0 -1px 1px color-mix(in srgb, black 8%, transparent); transition: background 180ms ease, box-shadow 180ms ease; z-index: 0;"></div>
              <div id="labels" style="position: absolute; left: 3px; right: 3px; top: 50%; transform: translateY(-50%); height: 15px; max-height: calc(100% - 4px); min-height: 0; display: grid; grid-template-columns: repeat(${options.length}, minmax(0, 1fr)); align-items: stretch; justify-items: stretch; text-align: center; box-sizing: border-box; pointer-events: none; z-index: 2; overflow: hidden; border-radius: 999px;">
                ${options
                  .map(
                    (o) =>
                      `<span class="season-slider-label-clip" style="display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 0; width: 100%; height: 100%; max-height: 100%; overflow: hidden; box-sizing: border-box;"><span data-option="${o}" style="display: block; max-width: 100%; max-height: 100%; min-width: 0; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 2px; font-weight: 500; line-height: 1; font-size: calc(clamp(0.5em, 2.1cqi, 0.82em) - 1px);">${o}</span></span>`
                  )
                  .join("")}
              </div>
              <div id="thumb" style="position: absolute; top: 2px; left: 3px; width: calc((100% - 6px) / ${options.length}); height: calc(100% - 8px); border-radius: 999px; background: #ffffff; border: 1px solid color-mix(in srgb, var(--divider-color) 40%, transparent); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18); transition: transform 180ms ease; will-change: transform; box-sizing: border-box; pointer-events: none; z-index: 3; display: flex; align-items: center; justify-content: center; padding: 0 6px;">
                <span id="thumb-label" style="font-size: clamp(0.6em, 2.7cqi, 0.98em); color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700; line-height: 1;"></span>
              </div>
            </div>
          </div>
          <div style="height: 1px; margin: 0 12px; background: color-mix(in srgb, var(--divider-color) 55%, transparent); ${weatherOnly ? "display:none;" : ""}"></div>
          <div id="weather" style="display: ${weatherOnly ? "block" : "none"}; padding: ${weatherOnly ? "4px 10px 0" : "0 10px 0"};">
            <div id="weather-scene-wrap" style="position: relative; width: 100%; border-radius: 0; overflow: visible; border: none; background: transparent;">
              <div id="weather-horizon-stack" style="position: relative; width: 100%;">
                <svg id="weather-scene" viewBox="0 0 360 44" width="100%" style="display: block; height: auto; aspect-ratio: 360 / 44; margin: 0; margin-bottom: -10px; padding: 0; position: relative; z-index: 1;" preserveAspectRatio="xMidYMid meet">
                  <defs>
                    <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="white" stop-opacity="0.14"/>
                      <stop offset="100%" stop-color="white" stop-opacity="0.02"/>
                    </linearGradient>
                  </defs>
                  <path id="scene-arc" d="M 0 32 Q 180 -12 360 32" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="1.05" stroke-dasharray="2.8 2.8"/>
                  <line x1="0" y1="32" x2="360" y2="32" stroke="currentColor" stroke-opacity="0.42" stroke-width="1.35"/>
                  <path d="M 6 32 A 11 11 0 0 1 28 32 L 6 32 Z" fill="currentColor" fill-opacity="0.35"/>
                  <path d="M 332 32 A 11 11 0 0 1 354 32 L 332 32 Z" fill="currentColor" fill-opacity="0.35"/>
                  <polygon points="17,2 8,13 26,13" fill="currentColor" fill-opacity="0.55" aria-hidden="true"/>
                  <polygon points="334,3 352,3 343,16" fill="currentColor" fill-opacity="0.55" aria-hidden="true"/>
                </svg>
                <div id="weather-sky-row" style="
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  gap: clamp(8px, 2.2vw, 16px);
                  min-height: 48px;
                  margin-top: -55px;
                  position: relative;
                  z-index: 2;
                  line-height: 0;
                  --weather-icon-h: 66px;
                  pointer-events: none;
                ">
                  <span id="weather-feels-wrap" class="wc-metric" data-entity="${we}" title="Température ressentie" style="display: inline-flex; align-items: center; gap: 5px; line-height: 1; white-space: nowrap; color: var(--primary-text-color); pointer-events: auto; transform: translateY(-5px);">
                    <span aria-hidden="true" style="display: inline-block; font-size: calc(var(--weather-icon-h) * 0.22); line-height: 1; opacity: 0.92; filter: grayscale(1) saturate(0); -webkit-filter: grayscale(1) saturate(0);">🌡️</span>
                    <span id="weather-feels" style="font-size: calc(var(--weather-icon-h) * 0.3); font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; color: var(--primary-text-color);">--</span>
                  </span>
                  <span id="weather-icon-cluster" style="display: inline-flex; align-items: center; justify-content: center; gap: clamp(2px, 0.9vw, 8px); flex: 0 0 auto; line-height: 0; transform: translateY(-15px);">
                    <span id="weather-condition-slot" style="display: flex; align-items: center; justify-content: center; line-height: 0; pointer-events: auto;"></span>
                  </span>
                  <span id="weather-rain-wrap" class="wc-metric" data-entity="${we}" aria-label="Risque de pluie à 24 h" aria-hidden="true" style="display: none; align-items: center; gap: 5px; line-height: 1; white-space: nowrap; color: var(--primary-text-color); pointer-events: auto; transform: translateY(-5px);">
                    <span id="weather-rain-hint" aria-hidden="true" style="display: inline-block; font-size: calc(var(--weather-icon-h) * 0.22); line-height: 1; opacity: 0.88; filter: grayscale(0.9); -webkit-filter: grayscale(0.9);">☂️</span>
                    <span id="weather-rain-lead" style="font-size: calc(var(--weather-icon-h) * 0.3); font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; color: var(--primary-text-color);"></span>
                  </span>
                </div>
                <div id="weather-metrics" style="
                  display: grid;
                  grid-template-columns: minmax(40px, 8.5%) 1fr minmax(40px, 8.5%);
                  align-items: center;
                  justify-items: center;
                  column-gap: 2px;
                  row-gap: 0;
                  padding: 0 0 2px;
                  margin-top: clamp(-22px, -5.5vw, -12px);
                  position: relative;
                  z-index: 2;
                  width: 100%;
                  box-sizing: border-box;
                  line-height: 1.1;
                  color: var(--primary-text-color);
                  font-size: clamp(0.72rem, 2.7vw, 0.98rem);
                ">
                  <span id="metric-sunrise" class="wc-metric" data-entity="${this._config.weather_sunrise_entity}" style="display: inline-flex; justify-content: center; width: 100%; white-space: nowrap; text-align: center;"><span id="weather-sunrise">--</span></span>
                  <div id="weather-core-inline" style="display: flex; justify-content: center; align-items: center; gap: clamp(4px, 1.6vw, 10px); flex-wrap: nowrap; overflow-x: auto; max-width: 100%; min-width: 0;">
                    <span class="wc-metric" data-entity="${we}" style="display: inline-flex; align-items: center;"><span id="weather-temp">--</span></span>
                    <span class="wc-metric" data-entity="${we}" style="display: inline-flex; align-items: center;"><span id="weather-humidity">--</span></span>
                    <span class="wc-metric" data-entity="${we}" style="display: inline-flex; align-items: center;"><span id="weather-wind">--</span></span>
                  </div>
                  <span id="metric-sunset" class="wc-metric" data-entity="${this._config.weather_sunset_entity}" style="display: inline-flex; justify-content: center; width: 100%; white-space: nowrap; text-align: center;"><span id="weather-sunset">--</span></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ha-card>
    `;

    this._track = this.querySelector("#track");
    this._rail = this.querySelector("#rail");
    this._thumb = this.querySelector("#thumb");
    this._thumbLabel = this.querySelector("#thumb-label");
    this._labels = Array.from(this.querySelectorAll("#labels span[data-option]"));
    this._weather = this.querySelector("#weather");
    this._weatherText = this.querySelector("#weather-text");
    this._weatherTemp = this.querySelector("#weather-temp");
    this._weatherHumidity = this.querySelector("#weather-humidity");
    this._weatherWind = this.querySelector("#weather-wind");
    this._weatherSunrise = this.querySelector("#weather-sunrise");
    this._weatherSunset = this.querySelector("#weather-sunset");
    this._weatherFeels = this.querySelector("#weather-feels");

    this._bindMoreInfo(this.querySelector("#weather-scene-wrap"), we);
    this.querySelectorAll(".wc-metric").forEach((el) => {
      this._bindMoreInfo(el, el.getAttribute("data-entity"));
    });

    if (weatherOnly || sensorMode) {
      if (sensorMode && this._track) {
        this._track.style.cursor = "default";
        this._track.style.touchAction = "auto";
      }
      return;
    }

    const indexFromClientX = (clientX) => {
      const rect = this._track.getBoundingClientRect();
      const relX = Math.min(Math.max(clientX - rect.left, 0), rect.width - 1);
      const slotWidth = rect.width / options.length;
      return Math.min(options.length - 1, Math.max(0, Math.floor(relX / slotWidth)));
    };

    const commitIndex = (index, serviceHass) => {
      const option = options[index];
      if (!option || option === options[this._currentIndex]) return;
      serviceHass.callService("input_select", "select_option", { entity_id: this._config.entity, option });
    };

    this._track.addEventListener("click", (ev) => {
      if (this._dragging) return;
      commitIndex(indexFromClientX(ev.clientX), hass);
    });

    this._track.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      this._dragging = true;
      this._pointerId = ev.pointerId;
      this._track.setPointerCapture?.(ev.pointerId);
      this._previewIndex = indexFromClientX(ev.clientX);
      this._render(options);
      ev.preventDefault();
    });

    this._track.addEventListener("pointermove", (ev) => {
      if (!this._dragging || ev.pointerId !== this._pointerId) return;
      const idx = indexFromClientX(ev.clientX);
      if (idx !== this._previewIndex) {
        this._previewIndex = idx;
        this._render(options);
      }
      ev.preventDefault();
    });

    const endDrag = (ev) => {
      if (!this._dragging || ev.pointerId !== this._pointerId) return;
      this._dragging = false;
      this._track.releasePointerCapture?.(ev.pointerId);
      const idx = this._previewIndex ?? this._currentIndex;
      this._previewIndex = null;
      this._pointerId = null;
      commitIndex(idx, hass);
      this._render(options);
      ev.preventDefault();
    };

    this._track.addEventListener("pointerup", endDrag);
    this._track.addEventListener("pointercancel", endDrag);
  }

  _render(options) {
    if (!this._thumb || !this._rail || !this._thumbLabel) return;
    const activeIndex = this._previewIndex ?? this._currentIndex;
    const activeOption = options[activeIndex] || options[0] || "";
    this._rail.style.background = this._sensorSeasonMode
      ? this._sensorRailColorForIndex(activeIndex)
      : this._railColor(activeOption);
    this._thumb.style.transform = `translateX(${activeIndex * 100}%)`;
    this._thumb.style.transition = this._dragging ? "none" : "transform 180ms ease";
    this._thumbLabel.textContent = this._sensorSeasonMode && this._sensorSeasonLabel ? this._sensorSeasonLabel : activeOption;
    const onRail = "var(--text-primary-on-primary-color, rgb(255, 255, 255))";
    this._labels.forEach((el, idx) => {
      const clip = el.closest(".season-slider-label-clip");
      if (idx === activeIndex) {
        el.style.opacity = "0";
        el.style.color = "";
        el.style.filter = "";
        el.style.webkitFilter = "";
        if (clip) {
          clip.style.filter = "";
          clip.style.webkitFilter = "";
        }
      } else {
        el.style.opacity = "1";
        el.style.color = onRail;
        el.style.filter = "";
        el.style.webkitFilter = "";
        if (clip) {
          clip.style.filter = "grayscale(1)";
          clip.style.webkitFilter = "grayscale(1)";
        }
      }
    });
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config?.entity) {
      const entityId = this._config.entity;
      const entity = hass.states?.[entityId];
      if (!entity) return;
      const options = entity.attributes?.options || [];
      if (this._isInputSelectEntity(entityId) && options.length) {
        this._sensorSeasonMode = false;
        if (!this._built) this._build(options, hass);
        const idx = options.indexOf(entity.state);
        this._currentIndex = idx >= 0 ? idx : 0;
        if (!this._dragging) this._previewIndex = null;
        this._render(options);
        this._renderWeather(hass);
        return;
      }

      this._sensorSeasonMode = true;
      const forcedKey = this._coerceSeasonKey(this._config?.season_force);
      const realKey = this._coerceSeasonKey(entity.state);
      const key = forcedKey || realKey || "spring";
      this._sensorSeasonLabel = `${SeasonCard.sensorSeasonIcons[key] || "🍃"} ${this._localizeSeasonKey(hass, key || "spring")}`;
      const sensorOptions = this._sensorSeasonOptions(hass);
      if (!this._built) this._build(sensorOptions, hass, false, true);
      this._currentIndex = this._seasonIndexFromState(key);
      this._previewIndex = null;
      this._render(sensorOptions);
      this._renderWeather(hass);
      return;
    }

    if (!this._built) this._build([], hass, true);
    this._renderWeather(hass);
  }
}

if (!customElements.get("season-card")) {
  customElements.define("season-card", SeasonCard);
}
