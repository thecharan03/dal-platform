from typing import Dict

from app.models import PriorityLevel


# ============================================================
# NEXORA SHIPMENT PRIORITY CLASSIFIER
# ============================================================

CATEGORY_PRIORITY = {
    # Critical
    "medicine": 0.90,
    "medical": 0.90,
    "hospital_supplies": 0.90,
    "hospital supply": 0.90,
    "vaccine": 0.95,
    "vaccines": 0.95,
    "emergency_medical": 0.95,

    # High
    "food": 0.70,
    "perishables": 0.70,
    "relief": 0.75,
    "essential": 0.75,

    # Low/normal
    "construction": 0.20,
    "materials": 0.20,
    "construction_material": 0.20,

    # Normal
    "normal": 0.40,
    "standard": 0.40,
}


def normalize_category(category: str) -> str:
    """Normalize shipment category."""

    if not category:
        return "normal"

    return (
        str(category)
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


def calculate_priority_score(
    category: str,
    destination_distance: float
) -> float:
    """
    Calculate shipment priority score.

    Core priority:
        Medicine > Food > Construction

    Short-distance shipments receive a small
    additional urgency factor, preserving the
    original project logic.
    """

    category = normalize_category(category)

    try:
        destination_distance = float(
            destination_distance
        )
    except (TypeError, ValueError):
        destination_distance = 0.0

    destination_distance = max(
        destination_distance,
        0.0
    )

    priority_score = CATEGORY_PRIORITY.get(
        category,
        0.40
    )

    # Existing distance rule:
    # nearby destination gets +0.1 urgency.
    if destination_distance < 50:
        priority_score += 0.10

    return round(
        min(max(priority_score, 0.0), 1.0),
        3
    )


def classify_priority(
    category: str,
    destination_distance: float
) -> PriorityLevel:
    """Classify shipment priority."""

    priority_score = calculate_priority_score(
        category,
        destination_distance
    )

    if priority_score > 0.8:
        return PriorityLevel.CRITICAL

    if priority_score > 0.6:
        return PriorityLevel.HIGH

    if priority_score > 0.4:
        return PriorityLevel.MEDIUM

    return PriorityLevel.LOW


def get_priority_details(
    category: str,
    destination_distance: float
) -> Dict:
    """
    Return complete priority intelligence for
    dashboard, manager and driver applications.
    """

    normalized_category = normalize_category(
        category
    )

    score = calculate_priority_score(
        normalized_category,
        destination_distance
    )

    priority = classify_priority(
        normalized_category,
        destination_distance
    )

    priority_name = (
        priority.value
        if hasattr(priority, "value")
        else str(priority)
    )

    if normalized_category in [
        "medicine",
        "medical",
        "hospital_supplies",
        "hospital_supply",
        "vaccine",
        "vaccines",
        "emergency_medical",
    ]:
        operational_class = "MEDICAL"

        reason = (
            "Medical shipment receives the highest "
            "priority because timely and safe delivery "
            "is critical."
        )

    elif normalized_category in [
        "food",
        "perishables",
        "relief",
        "essential",
    ]:
        operational_class = "RELIEF"

        reason = (
            "Food/relief shipment receives high priority "
            "to support essential supplies."
        )

    elif normalized_category in [
        "construction",
        "materials",
        "construction_material",
    ]:
        operational_class = "CONSTRUCTION"

        reason = (
            "Construction shipment receives lower urgency "
            "while still considering route safety."
        )

    else:
        operational_class = "NORMAL"

        reason = (
            "Standard shipment follows normal logistics "
            "priority rules."
        )

    return {
        "category": normalized_category,
        "priority": priority_name,
        "priority_score": score,
        "priority_percent": round(score * 100),
        "operational_class": operational_class,
        "reason": reason,
        "distance_km": round(
            float(destination_distance),
            2
        ),
    }


def get_priority_weight(category: str) -> Dict[str, float]:
    """
    Return routing weights based on shipment category.

    These weights can be consumed by the route optimizer.
    """

    category = normalize_category(category)

    if category in [
        "medicine",
        "medical",
        "hospital_supplies",
        "hospital_supply",
        "vaccine",
        "vaccines",
        "emergency_medical",
    ]:
        return {
            "distance": 0.15,
            "time": 0.10,
            "risk": 0.55,
            "accessibility": 0.20,
        }

    if category in [
        "food",
        "perishables",
        "relief",
        "essential",
    ]:
        return {
            "distance": 0.20,
            "time": 0.15,
            "risk": 0.45,
            "accessibility": 0.20,
        }

    if category in [
        "construction",
        "materials",
        "construction_material",
    ]:
        return {
            "distance": 0.35,
            "time": 0.20,
            "risk": 0.30,
            "accessibility": 0.15,
        }

    return {
        "distance": 0.30,
        "time": 0.15,
        "risk": 0.40,
        "accessibility": 0.15,
    }