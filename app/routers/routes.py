from fastapi import APIRouter, HTTPException
from typing import Any, Dict

from app.services.route_optimizer import optimize_route

router = APIRouter()


def _to_float(value: Any, field_name: str, default: float = 0.0) -> float:
    """
    Safely convert an input value to float.
    """
    if value is None:
        return default

    try:
        return float(value)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be a valid number"
        )


def _validate_coordinate(value: Any, field_name: str, minimum: float, maximum: float):
    """
    Validate latitude / longitude values.
    """
    if value is None:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} is required"
        )

    value = _to_float(value, field_name)

    if not minimum <= value <= maximum:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be between {minimum} and {maximum}"
        )

    return value


def _normalize_priority(route_data: Dict[str, Any]) -> str:
    """
    Get shipment priority from either shipment_priority or category.
    """

    priority = route_data.get("shipment_priority")

    if not priority:
        priority = route_data.get("priority_level")

    if not priority:
        priority = route_data.get("category", "normal")

    priority = str(priority).strip().lower()

    priority_aliases = {
        "critical": "medicine",
        "high": "medicine",
        "medical": "medicine",
        "medicines": "medicine",

        "food": "food",
        "essential": "food",

        "construction": "construction",
        "materials": "construction",

        "normal": "normal",
        "standard": "normal",
    }

    return priority_aliases.get(priority, priority)


@router.post("/optimize")
async def optimize_route_api(route_data: dict):
    """
    Smart logistics route optimization.

    Considers:

    - Disaster risk
    - Weather risk
    - Road accessibility
    - Shipment priority
    - Distance
    - Estimated travel time
    - Real road geometry
    - Traffic data when available

    The actual route calculation is handled by:
        app.services.route_optimizer.optimize_route
    """

    try:
        # ----------------------------------------------------
        # VALIDATE REQUEST
        # ----------------------------------------------------

        if not isinstance(route_data, dict):
            raise HTTPException(
                status_code=400,
                detail="Route data must be a JSON object"
            )

        # ----------------------------------------------------
        # RISK INPUTS
        # ----------------------------------------------------

        base_risk_score = _to_float(
            route_data.get("base_risk_score", 0),
            "base_risk_score"
        )

        weather_risk_score = _to_float(
            route_data.get("weather_risk_score", 0),
            "weather_risk_score"
        )

        if not 0 <= base_risk_score <= 1:
            raise HTTPException(
                status_code=400,
                detail="base_risk_score must be between 0 and 1"
            )

        if not 0 <= weather_risk_score <= 1:
            raise HTTPException(
                status_code=400,
                detail="weather_risk_score must be between 0 and 1"
            )

        # ----------------------------------------------------
        # COORDINATES
        # ----------------------------------------------------

        origin_lat = _validate_coordinate(
            route_data.get("origin_lat"),
            "origin_lat",
            -90,
            90
        )

        origin_lon = _validate_coordinate(
            route_data.get("origin_lon"),
            "origin_lon",
            -180,
            180
        )

        destination_lat = _validate_coordinate(
            route_data.get("destination_lat"),
            "destination_lat",
            -90,
            90
        )

        destination_lon = _validate_coordinate(
            route_data.get("destination_lon"),
            "destination_lon",
            -180,
            180
        )

        # ----------------------------------------------------
        # PREVENT INVALID SAME-POINT ROUTES
        # ----------------------------------------------------

        if (
            abs(origin_lat - destination_lat) < 0.000001
            and
            abs(origin_lon - destination_lon) < 0.000001
        ):
            raise HTTPException(
                status_code=400,
                detail="Origin and destination cannot be the same"
            )

        # ----------------------------------------------------
        # SHIPMENT PRIORITY
        # ----------------------------------------------------

        shipment_priority = _normalize_priority(route_data)

        # ----------------------------------------------------
        # OPTIONAL DATA
        # ----------------------------------------------------

        shipment_id = route_data.get("shipment_id")
        vehicle_id = route_data.get("vehicle_id")

        # ----------------------------------------------------
        # OPTIMIZE
        # ----------------------------------------------------

        result = optimize_route(
            base_risk_score=base_risk_score,
            weather_risk_score=weather_risk_score,
            origin_lat=origin_lat,
            origin_lon=origin_lon,
            destination_lat=destination_lat,
            destination_lon=destination_lon,
            shipment_priority=shipment_priority
        )

        # ----------------------------------------------------
        # NORMALIZE RESULT
        # ----------------------------------------------------

        if not isinstance(result, dict):
            result = {
                "route": result
            }

        # ----------------------------------------------------
        # ADD LIVE CONTEXT
        # ----------------------------------------------------

        response = {
            "success": True,
            "message": "Smart route optimization completed",

            "request": {
                "shipment_id": shipment_id,
                "vehicle_id": vehicle_id,

                "origin": {
                    "lat": origin_lat,
                    "lon": origin_lon
                },

                "destination": {
                    "lat": destination_lat,
                    "lon": destination_lon
                },

                "base_risk_score": base_risk_score,
                "weather_risk_score": weather_risk_score,
                "shipment_priority": shipment_priority
            },

            **result
        }

        return response

    except HTTPException:
        raise

    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="Invalid route data. Please check the input values."
        )

    except Exception as e:
        print(f"Route optimization error: {e}")

        raise HTTPException(
            status_code=500,
            detail="Route optimization failed"
        )