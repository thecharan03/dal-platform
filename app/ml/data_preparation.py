import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler


# ============================================================
# NEXORA ML DATA PREPARATION
# ============================================================

FEATURES = [
    "rainfall_mm",
    "temperature_c",
    "wind_speed_kmh",
    "flood_risk_score",
    "landslide_risk_score",
]

TARGET = "disrupted"


# ============================================================
# 1. VALIDATE DATA
# ============================================================

def validate_data(data):
    """
    Validate that the required ML columns are available.
    """

    if not isinstance(data, pd.DataFrame):
        raise TypeError("data must be a pandas DataFrame")

    required_columns = FEATURES + [TARGET]

    missing_columns = [
        column
        for column in required_columns
        if column not in data.columns
    ]

    if missing_columns:
        raise ValueError(
            "Missing required columns: "
            + ", ".join(missing_columns)
        )

    if data.empty:
        raise ValueError("Training data cannot be empty")

    return True


# ============================================================
# 2. CLEAN FEATURE DATA
# ============================================================

def clean_features(data):
    """
    Clean and normalize the five weather/disaster features.
    """

    X = data[FEATURES].copy()

    # Convert all feature columns to numeric.
    for column in FEATURES:
        X[column] = pd.to_numeric(
            X[column],
            errors="coerce"
        )

    # Replace invalid/missing values.
    X = X.replace(
        [np.inf, -np.inf],
        np.nan
    )

    X = X.fillna(0)

    # Risk values must stay within 0–1.
    X["flood_risk_score"] = (
        X["flood_risk_score"]
        .clip(0.0, 1.0)
    )

    X["landslide_risk_score"] = (
        X["landslide_risk_score"]
        .clip(0.0, 1.0)
    )

    # Physical values cannot be negative.
    X["rainfall_mm"] = (
        X["rainfall_mm"]
        .clip(lower=0)
    )

    X["wind_speed_kmh"] = (
        X["wind_speed_kmh"]
        .clip(lower=0)
    )

    return X


# ============================================================
# 3. PREPARE DATA
# ============================================================

def prepare_data(data):
    """
    Prepare weather and route data for the ML model.

    Returns:
        X_scaled
        scaler
    """

    validate_data(data)

    X = clean_features(data)

    scaler = StandardScaler()

    X_scaled = scaler.fit_transform(X)

    return X_scaled, scaler


# ============================================================
# 4. PREPARE FEATURES WITH EXISTING SCALER
# ============================================================

def transform_features(data, scaler):
    """
    Transform new data using an already-fitted scaler.

    This is useful when predicting live weather data.
    """

    if scaler is None:
        raise ValueError("A fitted scaler is required")

    if not isinstance(data, pd.DataFrame):
        raise TypeError("data must be a pandas DataFrame")

    missing_columns = [
        column
        for column in FEATURES
        if column not in data.columns
    ]

    if missing_columns:
        raise ValueError(
            "Missing feature columns: "
            + ", ".join(missing_columns)
        )

    X = clean_features(
        data.assign(**{TARGET: 0})
    )

    return scaler.transform(X)


# ============================================================
# 5. CREATE TRAINING DATA
# ============================================================

def create_training_data():
    """
    Create sample training data for disruption prediction.

    Features:
        rainfall_mm
        temperature_c
        wind_speed_kmh
        flood_risk_score
        landslide_risk_score

    Target:
        disrupted
    """

    data = pd.DataFrame({
        "rainfall_mm": [
            5, 20, 50, 80,
            120, 10, 60, 100,
            150, 180, 30, 90
        ],

        "temperature_c": [
            28, 27, 26, 25,
            24, 29, 26, 25,
            23, 22, 27, 25
        ],

        "wind_speed_kmh": [
            10, 15, 25, 35,
            50, 12, 30, 45,
            65, 75, 20, 55
        ],

        "flood_risk_score": [
            0.1, 0.2, 0.4, 0.7,
            0.9, 0.1, 0.6, 0.8,
            0.95, 0.98, 0.2, 0.75
        ],

        "landslide_risk_score": [
            0.1, 0.2, 0.3, 0.6,
            0.8, 0.1, 0.5, 0.7,
            0.9, 0.95, 0.2, 0.75
        ],

        "disrupted": [
            0, 0, 0, 1,
            1, 0, 1, 1,
            1, 1, 0, 1
        ]
    })

    X, scaler = prepare_data(data)

    y = (
        pd.to_numeric(
            data[TARGET],
            errors="coerce"
        )
        .fillna(0)
        .astype(int)
        .clip(0, 1)
    )

    return X, y, scaler


# ============================================================
# 6. FEATURE INFORMATION
# ============================================================

def get_feature_names():
    """
    Return the exact feature order used by the ML model.
    """

    return FEATURES.copy()


def get_target_name():
    """
    Return the ML target column name.
    """

    return TARGET