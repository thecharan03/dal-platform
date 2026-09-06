from fastapi import APIRouter, HTTPException
from typing import Any, Dict

from app.ml.predictor import DisruptionPredictor
from app.services.live_weather import get_live_weather


router = APIRouter()

predictor = DisruptionPredictor()


# ============================================================
# HELPERS
# ============================================================

def validate_coordinates(lat: float, lon: float):
    """Validate geographic coordinates."""

    if not -90 <= lat <= 90:
        raise HTTPException(
            status_code=400,
            detail="Latitude must be between -90 and 90",
        )

    if not -180 <= lon <= 180:
        raise HTTPException(
            status_code=400,
            detail="Longitude must be between -180 and 180",
        )


def validate_risk_score(
    value: float,
    field_name: str,
) -> float:
    """Validate a risk score between 0 and 1."""

    if not 0 <= value <= 1:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be between 0 and 1",
        )

    return value


def build_ml_inputs(weather: Dict[str, Any]) -> Dict[str, float]:
    """Build the exact five ML model inputs."""

    return {
        "rainfall_mm": float(
            weather.get("rainfall_mm", 0)
        ),
        "temperature_c": float(
            weather.get("temperature_c", 25)
        ),
        "wind_speed_kmh": float(
            weather.get("wind_speed_kmh", 0)
        ),
        "flood_risk_score": float(
            weather.get("flood_risk_score", 0)
        ),
        "landslide_risk_score": float(
            weather.get("landslide_risk_score", 0)
        ),
    }


# ============================================================
# LIVE WEATHER
# ============================================================

@router.get("/current")
async def current_weather(
    lat: float,
    lon: float,
):
    """
    Get live weather conditions for a location.

    Data comes from the live weather service.
    """

    validate_coordinates(lat, lon)

    try:
        weather = get_live_weather(
            latitude=lat,
            longitude=lon,
        )

        return {
            "success": True,
            "location": {
                "latitude": lat,
                "longitude": lon,
            },
            "data_status": {
                "weather": "LIVE",
                "source": "Open-Meteo",
            },
            "weather": weather,
        }

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Live weather request failed: {exc}",
        )


# ============================================================
# LIVE WEATHER + ML RISK
# ============================================================

@router.get("/live-risk")
async def live_risk(
    lat: float,
    lon: float,
):
    """
    Combine live weather data with the trained
    disruption prediction model.
    """

    validate_coordinates(lat, lon)

    try:
        # ----------------------------------------------------
        # 1. Get live weather
        # ----------------------------------------------------

        weather = get_live_weather(
            latitude=lat,
            longitude=lon,
        )

        # ----------------------------------------------------
        # 2. Prepare ML inputs
        # ----------------------------------------------------

        ml_inputs = build_ml_inputs(weather)

        validate_risk_score(
            ml_inputs["flood_risk_score"],
            "flood_risk_score",
        )

        validate_risk_score(
            ml_inputs["landslide_risk_score"],
            "landslide_risk_score",
        )

        # ----------------------------------------------------
        # 3. Run ML prediction
        # ----------------------------------------------------

        prediction = predictor.predict(
            **ml_inputs
        )

        # ----------------------------------------------------
        # 4. Determine overall risk
        # ----------------------------------------------------

        weather_risk = float(
            weather.get(
                "weather_risk_score",
                0,
            )
        )

        ml_risk = float(
            prediction.get(
                "risk_score",
                prediction.get(
                    "disruption_risk_score",
                    0,
                ),
            )
            or 0
        )

        # ML + weather combined intelligence.
        combined_risk = (
            (ml_risk * 0.70)
            + (weather_risk * 0.30)
        )

        combined_risk = max(
            0.0,
            min(1.0, combined_risk),
        )

        if combined_risk >= 0.75:
            risk_level = "critical"
        elif combined_risk >= 0.60:
            risk_level = "high"
        elif combined_risk >= 0.40:
            risk_level = "moderate"
        else:
            risk_level = "low"

        reroute_recommended = (
            combined_risk >= 0.60
            or bool(
                prediction.get(
                    "reroute_recommended",
                    False,
                )
            )
            or bool(
                weather.get(
                    "reroute_recommended",
                    False,
                )
            )
        )

        return {
            "success": True,

            "location": {
                "latitude": lat,
                "longitude": lon,
            },

            "live_weather": weather,

            "risk": prediction,

            "combined_intelligence": {
                "risk_score": round(
                    combined_risk,
                    3,
                ),
                "risk_percent": round(
                    combined_risk * 100
                ),
                "risk_level": risk_level,
                "reroute_recommended": (
                    reroute_recommended
                ),
            },

            "ml_inputs": ml_inputs,

            "data_status": {
                "weather": "LIVE",
                "weather_source": "Open-Meteo",
                "ml_model": (
                    "TRAINED"
                    if prediction.get(
                        "ml_available",
                        True,
                    )
                    else "UNAVAILABLE"
                ),
                "flood_risk": "ESTIMATED",
                "landslide_risk": "ESTIMATED",
            },
        }

    except HTTPException:
        raise

    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid weather/ML data: {exc}",
        )

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Live risk prediction failed: {exc}",
        )


# ============================================================
# SIMULATED WEATHER / TESTING
# ============================================================

@router.post("/predict-disruption")
async def predict_disruption(
    weather: dict,
):
    """
    Run the ML model using manually supplied weather values.

    Useful for testing disaster scenarios during the SIH demo.
    """

    if not isinstance(weather, dict):
        raise HTTPException(
            status_code=400,
            detail="Weather data must be a JSON object",
        )

    try:
        rainfall_mm = float(
            weather.get(
                "rainfall_mm",
                0,
            )
        )

        temperature_c = float(
            weather.get(
                "temperature_c",
                25,
            )
        )

        wind_speed_kmh = float(
            weather.get(
                "wind_speed_kmh",
                0,
            )
        )

        flood_risk_score = validate_risk_score(
            float(
                weather.get(
                    "flood_risk_score",
                    0,
                )
            ),
            "flood_risk_score",
        )

        landslide_risk_score = validate_risk_score(
            float(
                weather.get(
                    "landslide_risk_score",
                    0,
                )
            ),
            "landslide_risk_score",
        )

        if rainfall_mm < 0:
            raise HTTPException(
                status_code=400,
                detail="rainfall_mm cannot be negative",
            )

        if wind_speed_kmh < 0:
            raise HTTPException(
                status_code=400,
                detail="wind_speed_kmh cannot be negative",
            )

        ml_inputs = {
            "rainfall_mm": rainfall_mm,
            "temperature_c": temperature_c,
            "wind_speed_kmh": wind_speed_kmh,
            "flood_risk_score": flood_risk_score,
            "landslide_risk_score": landslide_risk_score,
        }

        prediction = predictor.predict(
            **ml_inputs
        )

        return {
            "success": True,

            "data_status": {
                "weather": "SIMULATED",
                "ml_model": (
                    "TRAINED"
                    if prediction.get(
                        "ml_available",
                        True,
                    )
                    else "UNAVAILABLE"
                ),
            },

            "scenario": ml_inputs,

            "risk": prediction,

            # Compatibility with older frontend code.
            **prediction,
        }

    except HTTPException:
        raise

    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid weather data: {exc}",
        )

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Disruption prediction failed: {exc}",
        )