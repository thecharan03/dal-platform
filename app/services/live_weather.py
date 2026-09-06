import requests
from datetime import datetime


# ============================================================
# OPEN-METEO CONFIGURATION
# ============================================================

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

REQUEST_TIMEOUT = 15

# Used for the 5 ML features
MAX_RISK_SCORE = 1.0


# ============================================================
# 1. UTILITY FUNCTIONS
# ============================================================

def clamp(value, minimum=0.0, maximum=1.0):
    """Keep a numeric value inside a defined range."""

    try:
        value = float(value)
    except (TypeError, ValueError):
        value = minimum

    return min(
        max(value, minimum),
        maximum
    )


def safe_float(value, default=0.0):
    """Safely convert a value to float."""

    try:
        if value is None:
            return default

        return float(value)

    except (TypeError, ValueError):
        return default


def sum_valid(values):
    """Safely sum numeric values."""

    if not values:
        return 0.0

    total = 0.0

    for value in values:
        if value is None:
            continue

        try:
            total += float(value)
        except (TypeError, ValueError):
            continue

    return total


def last_valid(values, default=None):
    """Return the last valid numeric value."""

    if not values:
        return default

    for value in reversed(values):
        if value is None:
            continue

        try:
            return float(value)
        except (TypeError, ValueError):
            continue

    return default


# ============================================================
# 2. FLOOD RISK
# ============================================================

def calculate_flood_risk(
    rain_1h,
    rain_24h,
    precipitation,
    soil_moisture
):
    """
    Estimate flood risk from recent rainfall,
    current precipitation and soil moisture.

    This is an operational estimate and NOT an
    official flood warning.
    """

    rain_1h = max(
        safe_float(rain_1h),
        0.0
    )

    rain_24h = max(
        safe_float(rain_24h),
        0.0
    )

    precipitation = max(
        safe_float(precipitation),
        0.0
    )

    # --------------------------------------------------------
    # Normalize environmental signals
    # --------------------------------------------------------

    recent_rain_score = clamp(
        rain_24h / 150.0
    )

    current_rain_score = clamp(
        rain_1h / 30.0
    )

    precipitation_score = clamp(
        precipitation / 50.0
    )

    if soil_moisture is None:
        soil_score = 0.0
    else:
        soil_score = clamp(
            safe_float(soil_moisture) / 0.5
        )

    # --------------------------------------------------------
    # Weighted flood risk
    # --------------------------------------------------------

    risk = (
        recent_rain_score * 0.45
        + current_rain_score * 0.20
        + precipitation_score * 0.15
        + soil_score * 0.20
    )

    return round(
        clamp(risk),
        3
    )


# ============================================================
# 3. LANDSLIDE RISK
# ============================================================

def calculate_landslide_risk(
    rain_24h,
    rain_7d,
    soil_moisture,
    elevation
):
    """
    Estimate landslide susceptibility using rainfall,
    soil moisture and elevation.

    This is an operational estimate and NOT an official
    landslide warning.
    """

    rain_24h = max(
        safe_float(rain_24h),
        0.0
    )

    rain_7d = max(
        safe_float(rain_7d),
        0.0
    )

    elevation = max(
        safe_float(elevation),
        0.0
    )

    # --------------------------------------------------------
    # Normalize environmental signals
    # --------------------------------------------------------

    rain_score = clamp(
        rain_24h / 180.0
    )

    weekly_score = clamp(
        rain_7d / 500.0
    )

    if soil_moisture is None:
        soil_score = 0.0
    else:
        soil_score = clamp(
            safe_float(soil_moisture) / 0.5
        )

    elevation_score = clamp(
        elevation / 2500.0
    )

    # --------------------------------------------------------
    # Weighted landslide risk
    # --------------------------------------------------------

    risk = (
        rain_score * 0.40
        + weekly_score * 0.25
        + soil_score * 0.20
        + elevation_score * 0.15
    )

    return round(
        clamp(risk),
        3
    )


# ============================================================
# 4. OVERALL WEATHER RISK
# ============================================================

def calculate_weather_risk(
    flood_risk_score,
    landslide_risk_score,
    rainfall_mm,
    wind_speed_kmh
):
    """
    Combine flood, landslide, rainfall and wind conditions
    into a single operational weather risk score.

    This value is useful for route intelligence.
    """

    flood = clamp(
        flood_risk_score
    )

    landslide = clamp(
        landslide_risk_score
    )

    rainfall = clamp(
        safe_float(rainfall_mm) / 150.0
    )

    wind = clamp(
        safe_float(wind_speed_kmh) / 60.0
    )

    weather_risk = (
        flood * 0.35
        + landslide * 0.35
        + rainfall * 0.15
        + wind * 0.15
    )

    return round(
        clamp(weather_risk),
        3
    )


# ============================================================
# 5. WEATHER CONDITION
# ============================================================

def get_weather_condition(
    weather_code,
    rainfall_mm,
    wind_speed_kmh
):
    """
    Convert current weather information into a simple
    operational condition label.
    """

    rainfall_mm = safe_float(
        rainfall_mm
    )

    wind_speed_kmh = safe_float(
        wind_speed_kmh
    )

    if rainfall_mm >= 20:
        return "heavy_rain"

    if rainfall_mm >= 5:
        return "rain"

    if wind_speed_kmh >= 60:
        return "strong_wind"

    if wind_speed_kmh >= 40:
        return "windy"

    # Basic WMO weather-code interpretation.
    code = safe_float(
        weather_code,
        -1
    )

    if code == 0:
        return "clear"

    if code in [1, 2, 3]:
        return "cloudy"

    if code in [45, 48]:
        return "fog"

    if code in range(51, 68):
        return "rain"

    if code in range(71, 78):
        return "snow"

    if code in range(80, 83):
        return "rain_showers"

    if code in [95, 96, 99]:
        return "thunderstorm"

    return "unknown"


# ============================================================
# 6. WEATHER SEVERITY
# ============================================================

def get_weather_severity(
    weather_risk_score,
    rainfall_mm,
    wind_speed_kmh
):
    """Classify current weather operational severity."""

    risk = clamp(
        weather_risk_score
    )

    rainfall_mm = safe_float(
        rainfall_mm
    )

    wind_speed_kmh = safe_float(
        wind_speed_kmh
    )

    if (
        risk >= 0.75
        or rainfall_mm >= 150
        or wind_speed_kmh >= 60
    ):
        return "critical"

    if (
        risk >= 0.60
        or rainfall_mm >= 80
        or wind_speed_kmh >= 50
    ):
        return "high"

    if (
        risk >= 0.40
        or rainfall_mm >= 40
        or wind_speed_kmh >= 35
    ):
        return "moderate"

    return "low"


# ============================================================
# 7. LIVE WEATHER API
# ============================================================

def get_live_weather(
    latitude,
    longitude
):
    """
    Fetch live weather and recent rainfall data
    from Open-Meteo.

    Returns:
        Live weather
        Flood risk
        Landslide risk
        Weather risk
        Operational severity
    """

    # --------------------------------------------------------
    # Validate coordinates
    # --------------------------------------------------------

    try:
        latitude = float(latitude)
        longitude = float(longitude)

    except (TypeError, ValueError):
        raise ValueError(
            "Latitude and longitude must be valid numbers"
        )

    if not -90 <= latitude <= 90:
        raise ValueError(
            "Latitude must be between -90 and 90"
        )

    if not -180 <= longitude <= 180:
        raise ValueError(
            "Longitude must be between -180 and 180"
        )

    # --------------------------------------------------------
    # Open-Meteo request
    # --------------------------------------------------------

    params = {
        "latitude": latitude,
        "longitude": longitude,

        "current": ",".join([
            "temperature_2m",
            "relative_humidity_2m",
            "precipitation",
            "rain",
            "showers",
            "weather_code",
            "wind_speed_10m",
            "wind_gusts_10m"
        ]),

        "hourly": ",".join([
            "rain",
            "precipitation",
            "soil_moisture_0_to_7cm",
            "temperature_2m",
            "wind_speed_10m"
        ]),

        # 7 days of historical hourly information
        "past_hours": 168,

        # Small forward window for current operations
        "forecast_hours": 1,

        "timezone": "auto",

        "temperature_unit": "celsius",
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm"
    }

    try:
        response = requests.get(
            OPEN_METEO_URL,
            params=params,
            timeout=REQUEST_TIMEOUT
        )

        response.raise_for_status()

        data = response.json()

    except requests.Timeout:
        raise RuntimeError(
            "Open-Meteo request timed out"
        )

    except requests.ConnectionError:
        raise RuntimeError(
            "Unable to connect to Open-Meteo"
        )

    except requests.HTTPError as e:
        raise RuntimeError(
            f"Open-Meteo HTTP error: {str(e)}"
        )

    except requests.RequestException as e:
        raise RuntimeError(
            f"Open-Meteo request failed: {str(e)}"
        )

    except ValueError:
        raise RuntimeError(
            "Open-Meteo returned invalid JSON"
        )

    # --------------------------------------------------------
    # Extract API sections
    # --------------------------------------------------------

    current = data.get(
        "current",
        {}
    )

    hourly = data.get(
        "hourly",
        {}
    )

    if not current:
        raise RuntimeError(
            "Open-Meteo returned no current weather data"
        )

    # --------------------------------------------------------
    # Hourly data
    # --------------------------------------------------------

    rain_values = hourly.get(
        "rain",
        []
    )

    precipitation_values = hourly.get(
        "precipitation",
        []
    )

    soil_values = hourly.get(
        "soil_moisture_0_to_7cm",
        []
    )

    # --------------------------------------------------------
    # Rainfall calculations
    # --------------------------------------------------------

    rain_1h = (
        last_valid(
            rain_values,
            safe_float(
                current.get(
                    "rain",
                    0
                )
            )
        )
    )

    rain_1h = max(
        rain_1h,
        0.0
    )

    # Last 24 hourly observations
    rain_24_values = (
        rain_values[-24:]
        if rain_values
        else []
    )

    rain_24h = sum_valid(
        rain_24_values
    )

    # Last 168 hourly observations
    rain_7_values = (
        rain_values[-168:]
        if rain_values
        else []
    )

    rain_7d = sum_valid(
        rain_7_values
    )

    # --------------------------------------------------------
    # Current precipitation
    # --------------------------------------------------------

    precipitation = max(
        safe_float(
            current.get(
                "precipitation",
                0
            )
        ),
        0.0
    )

    # --------------------------------------------------------
    # Soil moisture
    # --------------------------------------------------------

    soil_moisture = last_valid(
        soil_values,
        None
    )

    if soil_moisture is not None:
        soil_moisture = max(
            soil_moisture,
            0.0
        )

    # --------------------------------------------------------
    # Current weather values
    # --------------------------------------------------------

    temperature = safe_float(
        current.get(
            "temperature_2m",
            25
        ),
        25
    )

    wind_speed = max(
        safe_float(
            current.get(
                "wind_speed_10m",
                0
            )
        ),
        0.0
    )

    wind_gust = max(
        safe_float(
            current.get(
                "wind_gusts_10m",
                0
            )
        ),
        0.0
    )

    weather_code = current.get(
        "weather_code"
    )

    humidity = current.get(
        "relative_humidity_2m"
    )

    elevation = max(
        safe_float(
            data.get(
                "elevation",
                0
            )
        ),
        0.0
    )

    # --------------------------------------------------------
    # Risk calculations
    # --------------------------------------------------------

    flood_risk = calculate_flood_risk(
        rain_1h=rain_1h,
        rain_24h=rain_24h,
        precipitation=precipitation,
        soil_moisture=soil_moisture
    )

    landslide_risk = calculate_landslide_risk(
        rain_24h=rain_24h,
        rain_7d=rain_7d,
        soil_moisture=soil_moisture,
        elevation=elevation
    )

    weather_risk = calculate_weather_risk(
        flood_risk_score=flood_risk,
        landslide_risk_score=landslide_risk,
        rainfall_mm=rain_1h,
        wind_speed_kmh=wind_speed
    )

    # --------------------------------------------------------
    # Operational condition
    # --------------------------------------------------------

    weather_condition = get_weather_condition(
        weather_code=weather_code,
        rainfall_mm=rain_1h,
        wind_speed_kmh=wind_speed
    )

    severity = get_weather_severity(
        weather_risk_score=weather_risk,
        rainfall_mm=rain_1h,
        wind_speed_kmh=wind_speed
    )

    # --------------------------------------------------------
    # Return live intelligence
    # --------------------------------------------------------

    return {
        "success": True,

        "source": "Open-Meteo",

        "live": True,

        "timestamp": datetime.utcnow().isoformat(),

        "latitude": latitude,

        "longitude": longitude,

        "elevation_m": round(
            elevation,
            2
        ),

        "time": current.get(
            "time"
        ),

        # ----------------------------------------------------
        # Current weather
        # ----------------------------------------------------

        "temperature_c": round(
            temperature,
            2
        ),

        "rainfall_mm": round(
            rain_1h,
            2
        ),

        "rainfall_24h_mm": round(
            rain_24h,
            2
        ),

        "rainfall_7d_mm": round(
            rain_7d,
            2
        ),

        "precipitation_mm": round(
            precipitation,
            2
        ),

        "wind_speed_kmh": round(
            wind_speed,
            2
        ),

        "wind_gust_kmh": round(
            wind_gust,
            2
        ),

        "weather_code": weather_code,

        "weather_condition": weather_condition,

        "weather_severity": severity,

        "relative_humidity": humidity,

        "soil_moisture": (
            round(
                soil_moisture,
                4
            )
            if soil_moisture is not None
            else None
        ),

        # ----------------------------------------------------
        # Disaster risks
        # ----------------------------------------------------

        "flood_risk_score": flood_risk,

        "flood_risk_percent": round(
            flood_risk * 100
        ),

        "landslide_risk_score": landslide_risk,

        "landslide_risk_percent": round(
            landslide_risk * 100
        ),

        "weather_risk_score": weather_risk,

        "weather_risk_percent": round(
            weather_risk * 100
        ),

        # ----------------------------------------------------
        # Operational flags
        # ----------------------------------------------------

        "reroute_recommended": (
            weather_risk >= 0.60
        ),

        "emergency_weather": (
            severity == "critical"
        ),

        "ml_inputs": {
            "rainfall_mm": round(
                rain_1h,
                2
            ),

            "temperature_c": round(
                temperature,
                2
            ),

            "wind_speed_kmh": round(
                wind_speed,
                2
            ),

            "flood_risk_score": flood_risk,

            "landslide_risk_score": landslide_risk
        }
    }