import os
from typing import Any, Dict, Optional

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
    "disruption_predictor.pkl"
)

SCALER_PATH = os.path.join(
    BASE_DIR,
    "ml",
    "models",
    "scaler.pkl"
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

    The trained model still uses the exact five features:
        rainfall_mm
        temperature_c
        wind_speed_kmh
        flood_risk_score
        landslide_risk_score

    Final risk combines:
        ML probability + environmental hazard score
        + severe-weather safety adjustments.
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

            print("✓ Disruption model loaded")
            print("✓ Scaler loaded")

        except Exception as e:
            self.model = None
            self.scaler = None
            self.model_loaded = False
            self.load_error = str(e)

            print(f"❌ Failed to load ML model: {e}")

    # --------------------------------------------------------
    # VALIDATION
    # --------------------------------------------------------

    @staticmethod
    def _safe_float(
        value: Any,
        name: str,
        minimum: Optional[float] = None,
        maximum: Optional[float] = None,
    ) -> float:
        """Convert and validate a numeric input."""

        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError(
                f"{name} must be a valid number"
            )

        if minimum is not None and number < minimum:
            raise ValueError(
                f"{name} must be >= {minimum}"
            )

        if maximum is not None and number > maximum:
            raise ValueError(
                f"{name} must be <= {maximum}"
            )

        return number

    def _validate_inputs(
        self,
        rainfall_mm: Any,
        temperature_c: Any,
        wind_speed_kmh: Any,
        flood_risk_score: Any,
        landslide_risk_score: Any,
    ) -> Dict[str, float]:
        """
        Validate all model inputs.

        Risk scores are expected between 0 and 1.
        Physical weather values must be non-negative where applicable.
        """

        return {
            "rainfall_mm": self._safe_float(
                rainfall_mm,
                "rainfall_mm",
                minimum=0.0,
            ),
            "temperature_c": self._safe_float(
                temperature_c,
                "temperature_c",
            ),
            "wind_speed_kmh": self._safe_float(
                wind_speed_kmh,
                "wind_speed_kmh",
                minimum=0.0,
            ),
            "flood_risk_score": self._safe_float(
                flood_risk_score,
                "flood_risk_score",
                minimum=0.0,
                maximum=1.0,
            ),
            "landslide_risk_score": self._safe_float(
                landslide_risk_score,
                "landslide_risk_score",
                minimum=0.0,
                maximum=1.0,
            ),
        }

    # --------------------------------------------------------
    # MODEL STATUS
    # --------------------------------------------------------

    def status(self) -> Dict[str, Any]:
        """Return ML model health information."""

        return {
            "model_loaded": self.model_loaded,
            "model_path": MODEL_PATH,
            "scaler_path": SCALER_PATH,
            "features": FEATURE_NAMES,
            "error": self.load_error,
        }

    # --------------------------------------------------------
    # FALLBACK RESPONSE
    # --------------------------------------------------------

    def _unavailable_response(
        self,
        message: str,
        inputs: Optional[Dict[str, float]] = None,
        status: str = "MODEL UNAVAILABLE",
    ) -> Dict[str, Any]:
        """
        Safe response when the trained model cannot be used.

        IMPORTANT:
        This is explicitly marked as unavailable. It is not presented
        as a real ML prediction.
        """

        return {
            "success": False,
            "disrupted": False,
            "ml_available": False,
            "ml_probability": None,
            "hazard_score": None,
            "risk_score": None,
            "risk_percent": None,
            "risk_level": status,
            "flood_risk_percent": (
                round(inputs["flood_risk_score"] * 100)
                if inputs
                else None
            ),
            "landslide_risk_percent": (
                round(inputs["landslide_risk_score"] * 100)
                if inputs
                else None
            ),
            "recommendation": message,
            "error": message,
            "inputs": inputs or {},
        }

    # --------------------------------------------------------
    # RISK CLASSIFICATION
    # --------------------------------------------------------

    @staticmethod
    def _classify_risk(final_risk: float):
        """Convert continuous risk into operational risk levels."""

        if final_risk >= 0.75:
            return (
                "CRITICAL",
                "🚨 Reroute recommended. "
                "High probability of route disruption."
            )

        if final_risk >= 0.60:
            return (
                "HIGH",
                "⚠️ Monitor route closely and "
                "prepare for rerouting."
            )

        if final_risk >= 0.40:
            return (
                "MODERATE",
                "🟡 Proceed with caution and "
                "monitor conditions."
            )

        return (
            "LOW",
            "🟢 Route is currently safe to proceed."
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

        Extra keyword arguments are accepted intentionally so the
        predictor can be called by the live intelligence engine
        without breaking when additional operational data exists.
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
            [inputs],
            columns=FEATURE_NAMES,
        )

        # ----------------------------------------------------
        # ML PREDICTION
        # ----------------------------------------------------

        try:
            features_scaled = self.scaler.transform(features)

            prediction = self.model.predict(
                features_scaled
            )[0]

            # Some models may expose predict_proba while others do not.
            if hasattr(self.model, "predict_proba"):
                probabilities = self.model.predict_proba(
                    features_scaled
                )[0]

                if len(probabilities) >= 2:
                    probability = float(probabilities[1])
                else:
                    probability = float(probabilities[0])
            else:
                # If the trained model has no probability interface,
                # use its binary prediction as an explicit model signal.
                probability = float(bool(prediction))

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
        # These are safety adjustments on top of the ML probability,
        # not replacements for the trained model.

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

        risk_level, recommendation = self._classify_risk(
            final_risk
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

            "ml_prediction": int(prediction)
            if isinstance(prediction, (int, float))
            else str(prediction),

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

            "severe_conditions": severe_conditions,

            "risk_score": round(
                final_risk,
                3,
            ),

            "risk_percent": round(
                final_risk * 100,
            ),

            "risk_level": risk_level,

            "reroute_required": reroute_required,

            "emergency_reroute": emergency_reroute,

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
