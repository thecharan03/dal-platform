import os
import joblib

from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report

from app.ml.data_preparation import (
    create_training_data,
    get_feature_names,
)


# ============================================================
# MODEL PATHS
# ============================================================

MODEL_DIR = "app/ml/models"

MODEL_PATH = os.path.join(
    MODEL_DIR,
    "disruption_predictor.pkl"
)

SCALER_PATH = os.path.join(
    MODEL_DIR,
    "scaler.pkl"
)


# ============================================================
# TRAIN MODEL
# ============================================================

def train_model():
    """
    Train the NEXORA disaster disruption prediction model.

    Uses:
        Random Forest Classifier

    Features:
        rainfall_mm
        temperature_c
        wind_speed_kmh
        flood_risk_score
        landslide_risk_score

    Saves:
        disruption_predictor.pkl
        scaler.pkl
    """

    print("=" * 60)
    print("NEXORA DISASTER DISRUPTION MODEL TRAINING")
    print("=" * 60)

    # --------------------------------------------------------
    # STEP 1: Load training data
    # --------------------------------------------------------

    X, y, scaler = create_training_data()

    print("\n✓ Training data prepared")
    print(f"✓ Samples: {len(y)}")
    print(f"✓ Features: {get_feature_names()}")

    # --------------------------------------------------------
    # STEP 2: Validate target
    # --------------------------------------------------------

    if len(set(y)) < 2:
        raise ValueError(
            "Training data must contain both disrupted and "
            "non-disrupted examples."
        )

    # --------------------------------------------------------
    # STEP 3: Create Random Forest
    # --------------------------------------------------------

    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=8,
        min_samples_split=2,
        min_samples_leaf=1,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )

    print("\n✓ Random Forest model created")

    # --------------------------------------------------------
    # STEP 4: Train
    # --------------------------------------------------------

    model.fit(X, y)

    print("✓ Model training completed")

    # --------------------------------------------------------
    # STEP 5: Training evaluation
    # --------------------------------------------------------

    predictions = model.predict(X)

    accuracy = accuracy_score(
        y,
        predictions
    )

    print(
        f"\nTraining accuracy: "
        f"{accuracy * 100:.2f}%"
    )

    # --------------------------------------------------------
    # STEP 6: Feature importance
    # --------------------------------------------------------

    print("\nFeature importance:")

    for feature, importance in zip(
        get_feature_names(),
        model.feature_importances_
    ):
        print(
            f"  {feature}: "
            f"{importance:.4f}"
        )

    # --------------------------------------------------------
    # STEP 7: Create model directory
    # --------------------------------------------------------

    os.makedirs(
        MODEL_DIR,
        exist_ok=True
    )

    # --------------------------------------------------------
    # STEP 8: Save model
    # --------------------------------------------------------

    joblib.dump(
        model,
        MODEL_PATH
    )

    joblib.dump(
        scaler,
        SCALER_PATH
    )

    print("\n✓ Model saved:")
    print(f"  {MODEL_PATH}")

    print("✓ Scaler saved:")
    print(f"  {SCALER_PATH}")

    # --------------------------------------------------------
    # STEP 9: Verify saved files
    # --------------------------------------------------------

    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(
            "Model file was not created."
        )

    if not os.path.exists(SCALER_PATH):
        raise RuntimeError(
            "Scaler file was not created."
        )

    print("\n✓ Model files verified")
    print("=" * 60)
    print("TRAINING COMPLETE")
    print("=" * 60)

    return {
        "success": True,
        "model_path": MODEL_PATH,
        "scaler_path": SCALER_PATH,
        "samples": len(y),
        "features": get_feature_names(),
        "training_accuracy": round(
            float(accuracy),
            4
        ),
    }


# ============================================================
# RUN DIRECTLY
# ============================================================

if __name__ == "__main__":
    train_model()