import os
from typing import Optional

import joblib
import pandas as pd


# ------------------------------------------------------------
# MODEL CONFIGURATION
# ------------------------------------------------------------

BASE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
)

MODEL_PATH = os.path.join(
    BASE_DIR,
    "ml",
    "models",
    "disruption_predictor.pkl",
)

SCALER_PATH = os.path.join(
    BASE_DIR,
    "ml",
    "models",
    "scaler.pkl",
)

FEATURE_NAMES = [
    "rainfall_mm",
    "temperature_c",
    "wind_speed_kmh",
    "flood_risk_score",
    "landslide_risk_score",
]


class DisruptionPredictor:
    """
    NEXORA Disaster-Aware Logistics ML Predictor.

    Uses five trained features:

        rainfall_mm
        temperature_c
        wind_speed_kmh
        flood_risk_score
        landslide_risk_score

    Final risk combines:
        ML probability
        environmental hazard score
        severe-weather safety adjustments
    """

    def __init__(self):
        self.model = None
        self.scaler = None
        self.model_loaded = False
        self.load_error: Optional[str] = None

        self.load_model()

    # --------------------------------------------------------
    # MODEL LOADING
    # --------------------------------------------------------

    def load_model(self):
        """Load the trained disruption model and scaler."""

        try:
            if not os.path.exists(MODEL_PATH):
                self.load_error = (
                    f"Disruption model not found: {MODEL_PATH}"
                )
                print(f"❌ {self.load_error}")
                return

            if not os.path.exists(SCALER_PATH):
                self.load_error = (
                    f"Scaler not found: {SCALER_PATH}"
                )
                print(f"❌ {self.load_error}")
                return

            self.model = joblib.load(MODEL_PATH)
            self.scaler = joblib.load(SCALER_PATH)

            self.model_loaded = True
            self.load_error = None

            print("✓ Disaster disruption predictor initialized")
            print(f"✓ Model loaded: {MODEL_PATH}")
            print(f"✓ Scaler loaded: {SCALER_PATH}")

        except Exception as e:
            self.model = None
            self.scaler = None
            self.model_loaded = False

            self.load_error = (
                f"Failed to load disruption model: {str(e)}"
            )

            print(f"❌ {self.load_error}")

    # --------------------------------------------------------
    # INPUT VALIDATION
    # --------------------------------------------------------

    def _validate_inputs(
        self,
        rainfall_mm,
        temperature_c,
        wind_speed_kmh,
        flood_risk_score,
        landslide_risk_score,
    ):
        """Validate and normalize prediction inputs."""

        try:
            rainfall_mm = float(rainfall_mm)
            temperature_c = float(temperature_c)
            wind_speed_kmh = float(wind_speed_kmh)
            flood_risk_score = float(flood_risk_score)
            landslide_risk_score = float(landslide_risk_score)

        except (TypeError, ValueError):
            raise ValueError(
                "All ML prediction inputs must be numeric."
            )

        values = {
            "rainfall_mm": rainfall_mm,
            "temperature_c": temperature_c,
            "wind_speed_kmh": wind_speed_kmh,
            "flood_risk_score": flood_risk_score,
            "landslide_risk_score": landslide_risk_score,
        }

        for name, value in values.items():
            if not pd.notna(value):
                raise ValueError(
                    f"{name} must be a valid numeric value."
                )

        if rainfall_mm < 0:
            raise ValueError(
                "rainfall_mm cannot be negative."
            )

        if wind_speed_kmh < 0:
            raise ValueError(
                "wind_speed_kmh cannot be negative."
            )

        flood_risk_score = min(
            max(flood_risk_score, 0.0),
            1.0,
        )

        landslide_risk_score = min(
            max(landslide_risk_score, 0.0),
            1.0,
        )

        return {
            "rainfall_mm": rainfall_mm,
            "temperature_c": temperature_c,
            "wind_speed_kmh": wind_speed_kmh,
            "flood_risk_score": flood_risk_score,
            "landslide_risk_score": landslide_risk_score,
        }

    # --------------------------------------------------------
    # UNAVAILABLE RESPONSE
    # --------------------------------------------------------

    def _unavailable_response(self, message, inputs):
        """Return a safe response when ML is unavailable."""

        return {
            "success": False,
            "disrupted": False,
            "ml_available": False,
            "ml_probability": None,
            "hazard_score": None,
            "risk_score": None,
            "risk_percent": None,
            "risk_level": "UNAVAILABLE",
            "reroute_required": False,
            "emergency_reroute": False,
            "recommendation": message,
            "error": self.load_error,
            "inputs": inputs,
        }

    # --------------------------------------------------------
    # RISK CLASSIFICATION
    # --------------------------------------------------------

    def _classify_risk(self, final_risk):
        """Classify final route risk."""

        if final_risk >= 0.75:
            return (
                "CRITICAL",
                "🚨 Avoid this route and reroute immediately.",
            )

        if final_risk >= 0.60:
            return (
                "HIGH",
                "⚠️ High disruption risk. Rerouting is recommended.",
            )

        if final_risk >= 0.40:
            return (
                "MODERATE",
                "🟡 Proceed with caution and monitor conditions.",
            )

        return (
            "LOW",
            "🟢 Route is currently safe to proceed.",
        )

    # --------------------------------------------------------
    # MAIN PREDICTION
    # --------------------------------------------------------

    def predict(
        self,
        rainfall_mm,
        temperature_c,
        wind_speed_kmh,
        flood_risk_score,
        landslide_risk_score,
        **kwargs,
    ):
        """
        Predict route disruption risk.

        Extra keyword arguments are accepted intentionally so
        the live intelligence engine can provide additional
        operational information without breaking prediction.
        """

        # ----------------------------------------------------
        # INPUT VALIDATION
        # ----------------------------------------------------

        try:
            inputs = self._validate_inputs(
                rainfall_mm,
                temperature_c,
                wind_speed_kmh,
                flood_risk_score,
                landslide_risk_score,
            )

        except ValueError as e:
            return {
                "success": False,
                "disrupted": False,
                "ml_available": False,
                "ml_probability": None,
                "hazard_score": None,
                "risk_score": None,
                "risk_percent": None,
                "risk_level": "INVALID INPUT",
                "reroute_required": False,
                "emergency_reroute": False,
                "recommendation": str(e),
                "error": str(e),
                "inputs": {},
            }

        # ----------------------------------------------------
        # MODEL CHECK
        # ----------------------------------------------------

        if not self.model_loaded:
            return self._unavailable_response(
                message=(
                    "ML model is not loaded. "
                    "Live ML disruption prediction is unavailable."
                ),
                inputs=inputs,
            )

        # ----------------------------------------------------
        # EXACT TRAINING FEATURES
        # ----------------------------------------------------

        features = pd.DataFrame(
            [[
                inputs["rainfall_mm"],
                inputs["temperature_c"],
                inputs["wind_speed_kmh"],
                inputs["flood_risk_score"],
                inputs["landslide_risk_score"],
            ]],
            columns=FEATURE_NAMES,
        )

        # ----------------------------------------------------
        # ML PREDICTION
        # ----------------------------------------------------

        try:
            features_scaled = self.scaler.transform(
                features
            )

            prediction = self.model.predict(
                features_scaled
            )[0]

            # Models with probability support
            if hasattr(self.model, "predict_proba"):

                probabilities = self.model.predict_proba(
                    features_scaled
                )[0]

                if len(probabilities) >= 2:
                    probability = float(
                        probabilities[1]
                    )
                else:
                    probability = float(
                        probabilities[0]
                    )

            else:
                probability = float(
                    bool(prediction)
                )

            probability = min(
                max(probability, 0.0),
                1.0,
            )

        except Exception as e:
            return {
                "success": False,
                "disrupted": False,
                "ml_available": False,
                "ml_probability": None,
                "hazard_score": None,
                "risk_score": None,
                "risk_percent": None,
                "risk_level": "PREDICTION ERROR",
                "reroute_required": False,
                "emergency_reroute": False,
                "recommendation": (
                    "ML prediction failed. "
                    "Check the trained model and scaler."
                ),
                "error": str(e),
                "inputs": inputs,
            }

        # ----------------------------------------------------
        # ENVIRONMENTAL HAZARD SCORE
        # ----------------------------------------------------

        hazard_score = (
            inputs["flood_risk_score"] * 0.45
            + inputs["landslide_risk_score"] * 0.55
        )

        # ----------------------------------------------------
        # COMBINED RISK
        # ----------------------------------------------------

        final_risk = (
            probability * 0.70
            + hazard_score * 0.30
        )

        # ----------------------------------------------------
        # SEVERE WEATHER ADJUSTMENTS
        # ----------------------------------------------------

        severe_adjustment = 0.0
        severe_conditions = []

        if inputs["rainfall_mm"] >= 150:
            severe_adjustment += 0.10
            severe_conditions.append(
                "extreme rainfall"
            )

        if inputs["wind_speed_kmh"] >= 60:
            severe_adjustment += 0.05
            severe_conditions.append(
                "high wind"
            )

        if inputs["landslide_risk_score"] >= 0.80:
            severe_adjustment += 0.10
            severe_conditions.append(
                "high landslide risk"
            )

        if inputs["flood_risk_score"] >= 0.80:
            severe_adjustment += 0.10
            severe_conditions.append(
                "high flood risk"
            )

        final_risk += severe_adjustment

        final_risk = min(
            max(final_risk, 0.0),
            1.0,
        )

        # ----------------------------------------------------
        # RISK LEVEL
        # ----------------------------------------------------

        risk_level, recommendation = (
            self._classify_risk(final_risk)
        )

        # ----------------------------------------------------
        # OPERATIONAL FLAGS
        # ----------------------------------------------------

        reroute_required = final_risk >= 0.60
        emergency_reroute = final_risk >= 0.75

        # ----------------------------------------------------
        # RESULT
        # ----------------------------------------------------

        return {
            "success": True,

            "disrupted": bool(prediction),

            "ml_available": True,

            "ml_prediction": (
                int(prediction)
                if isinstance(
                    prediction,
                    (int, float),
                )
                else str(prediction)
            ),

            "ml_probability": round(
                probability,
                3,
            ),

            "hazard_score": round(
                hazard_score,
                3,
            ),

            "severe_weather_adjustment": round(
                severe_adjustment,
                3,
            ),

            "severe_conditions": (
                severe_conditions
            ),

            "risk_score": round(
                final_risk,
                3,
            ),

            "risk_percent": round(
                final_risk * 100,
            ),

            "risk_level": risk_level,

            "reroute_required": (
                reroute_required
            ),

            "emergency_reroute": (
                emergency_reroute
            ),

            "flood_risk_percent": round(
                inputs["flood_risk_score"] * 100
            ),

            "landslide_risk_percent": round(
                inputs["landslide_risk_score"] * 100
            ),

            "recommendation": recommendation,

            "inputs": inputs,

            "model": {
                "loaded": True,
                "features": FEATURE_NAMES,
            },
        }


# ------------------------------------------------------------
# SINGLE SHARED PREDICTOR INSTANCE
# ------------------------------------------------------------

predictor = DisruptionPredictor()


def predict_route_risk(**kwargs):
    """
    Public helper used by the rest of the DAL backend.
    """

    return predictor.predict(**kwargs)