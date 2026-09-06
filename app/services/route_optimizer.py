import requests


# ============================================================
# 1. DISASTER RISK
# ============================================================

def calculate_route_risk(base_risk_score, weather_risk_score):
    """
    Calculate final route disruption risk.

    Base risk  = existing road/environment risk
    Weather risk = current predicted weather disruption risk
    """

    risk_score = (
        (base_risk_score * 0.4)
        + (weather_risk_score * 0.6)
    )

    return round(min(max(risk_score, 0.0), 1.0), 3)


def should_reroute(risk_score):
    """
    Rerouting is recommended when risk reaches HIGH level.
    """

    return risk_score >= 0.6


# ============================================================
# 2. ROAD ACCESSIBILITY
# ============================================================

def calculate_accessibility_score(risk_score):
    """
    Estimate road accessibility from current disruption risk.

    1.0 = highly accessible
    0.0 = severely inaccessible

    This is the prototype accessibility layer.
    """

    accessibility = 1 - (risk_score * 0.65)

    return round(
        min(max(accessibility, 0.0), 1.0),
        3
    )


# ============================================================
# 3. SHIPMENT PRIORITY
# ============================================================

def normalize_priority(priority):
    """
    Convert different priority names into standard categories.
    """

    if not priority:
        return "normal"

    priority = str(priority).lower().strip()

    if priority in ["medicine", "medical", "emergency", "critical"]:
        return "medicine"

    if priority in ["food", "relief", "essential"]:
        return "food"

    if priority in ["construction", "construction_material"]:
        return "construction"

    return "normal"


def get_priority_weights(priority):
    """
    Critical shipments give more importance to
    risk and accessibility.

    Medicine > Food > Construction > Normal
    """

    priority = normalize_priority(priority)

    if priority == "medicine":
        return {
            "distance": 0.15,
            "time": 0.10,
            "risk": 0.55,
            "accessibility": 0.20
        }

    if priority == "food":
        return {
            "distance": 0.20,
            "time": 0.15,
            "risk": 0.45,
            "accessibility": 0.20
        }

    if priority == "construction":
        return {
            "distance": 0.35,
            "time": 0.20,
            "risk": 0.30,
            "accessibility": 0.15
        }

    return {
        "distance": 0.30,
        "time": 0.15,
        "risk": 0.40,
        "accessibility": 0.15
    }


# ============================================================
# 4. GET REAL ROAD ROUTES
# ============================================================

def get_road_route(
    origin_lat,
    origin_lon,
    destination_lat,
    destination_lon
):
    """
    Get real road routes from OpenStreetMap OSRM.
    """

    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{origin_lon},{origin_lat};"
        f"{destination_lon},{destination_lat}"
    )

    params = {
        "overview": "full",
        "geometries": "geojson",
        "alternatives": "true",
        "steps": "false"
    }

    try:
        response = requests.get(
            url,
            params=params,
            timeout=15
        )

        response.raise_for_status()

        data = response.json()

    except requests.RequestException:
        return None

    except ValueError:
        return None

    if data.get("code") != "Ok":
        return None

    return data


# ============================================================
# 5. ROUTE SCORE
# ============================================================

def calculate_route_score(
    route,
    risk_score,
    accessibility_score=1.0,
    shipment_priority="normal"
):
    """
    Calculate total route cost.

    Lower score = better route.

    Factors:
        - distance
        - travel time
        - disaster risk
        - accessibility
        - shipment criticality
    """

    distance_km = route["distance"] / 1000
    time_minutes = route["duration"] / 60

    priority = normalize_priority(
        shipment_priority
    )

    weights = get_priority_weights(
        priority
    )

    # Convert factors into comparable values
    distance_cost = distance_km
    time_cost = time_minutes

    risk_cost = risk_score * 100

    accessibility_penalty = (
        1 - accessibility_score
    ) * 100

    route_score = (
        distance_cost * weights["distance"]
        + time_cost * weights["time"]
        + risk_cost * weights["risk"]
        + accessibility_penalty
        * weights["accessibility"]
    )

    return round(route_score, 2)


# ============================================================
# 6. ROUTE CLASSIFICATION
# ============================================================

def get_route_condition(
    risk_score,
    accessibility_score
):
    """
    Classify route condition for dashboard/map.
    """

    if risk_score >= 0.75 or accessibility_score < 0.40:
        return "critical"

    if risk_score >= 0.60 or accessibility_score < 0.55:
        return "high"

    if risk_score >= 0.40 or accessibility_score < 0.70:
        return "moderate"

    return "safe"


# ============================================================
# 7. MAIN ROUTE OPTIMIZER
# ============================================================

def optimize_route(
    base_risk_score,
    weather_risk_score,
    origin_lat=None,
    origin_lon=None,
    destination_lat=None,
    destination_lon=None,
    shipment_priority="normal"
):
    """
    NEXORA Risk-Aware Route Optimization Engine.

    Pipeline:

    Disaster Risk
          ↓
    Accessibility
          ↓
    Shipment Priority
          ↓
    Route Scoring
          ↓
    Best Route Selection
    """

    # --------------------------------------------------------
    # STEP 1: Calculate final disaster risk
    # --------------------------------------------------------

    risk_score = calculate_route_risk(
        base_risk_score,
        weather_risk_score
    )

    # --------------------------------------------------------
    # STEP 2: Calculate accessibility
    # --------------------------------------------------------

    accessibility_score = (
        calculate_accessibility_score(
            risk_score
        )
    )

    accessibility_percent = round(
        accessibility_score * 100
    )

    # --------------------------------------------------------
    # STEP 3: Rerouting decision
    # --------------------------------------------------------

    reroute = should_reroute(
        risk_score
    )

    priority = normalize_priority(
        shipment_priority
    )

    # --------------------------------------------------------
    # STEP 4: Initial result
    # --------------------------------------------------------

    result = {
        "risk_score": risk_score,

        "risk_percent": round(
            risk_score * 100
        ),

        "reroute_required": reroute,

        "route_status": (
            "reroute_recommended"
            if reroute
            else "normal_route"
        ),

        "shipment_priority": priority,

        "road_accessibility_score":
            accessibility_score,

        "road_accessibility_percent":
            accessibility_percent,

        "route_condition":
            get_route_condition(
                risk_score,
                accessibility_score
            ),

        "routing_method":
            "Risk + Accessibility + Priority + Distance + ETA",

        "route_source":
            "OpenStreetMap OSRM"
    }

    # --------------------------------------------------------
    # STEP 5: Get actual road routes
    # --------------------------------------------------------

    if (
        origin_lat is None
        or origin_lon is None
        or destination_lat is None
        or destination_lon is None
    ):
        return result

    road_data = get_road_route(
        origin_lat,
        origin_lon,
        destination_lat,
        destination_lon
    )

    if not road_data:
        result["routing_error"] = (
            "Unable to retrieve road routes"
        )

        return result

    routes = road_data.get(
        "routes",
        []
    )

    if not routes:
        result["routing_error"] = (
            "No road routes found"
        )

        return result

    # --------------------------------------------------------
    # STEP 6: Score every route returned by OSRM
    # --------------------------------------------------------

    scored_routes = []

    for index, route in enumerate(routes):

        distance_km = (
            route["distance"] / 1000
        )

        time_minutes = (
            route["duration"] / 60
        )

        route_score = calculate_route_score(
            route=route,
            risk_score=risk_score,
            accessibility_score=accessibility_score,
            shipment_priority=priority
        )

        condition = get_route_condition(
            risk_score,
            accessibility_score
        )

        scored_routes.append({

            # Stable identifier used by the driver app when a route is selected.
            "route_id": f"osrm-route-{index + 1}",

            "route_index": index,

            "route_name":
                f"Route {index + 1}",

            "distance_km":
                round(distance_km, 2),

            "estimated_time_minutes":
                round(time_minutes, 2),

            "route_score":
                route_score,

            "risk_percent":
                round(risk_score * 100),

            "accessibility_percent":
                accessibility_percent,

            "condition":
                condition,

            "shipment_priority":
                priority,

            "geometry":
                route["geometry"]["coordinates"],

            "geometry_geojson": {
                "type": "LineString",
                "coordinates": route["geometry"]["coordinates"]
            },

            # OSRM does not provide live congestion in this fallback service.
            # Keep traffic explicitly unknown instead of inventing a value.
            "traffic_level": "unknown",
            "traffic_delay_minutes": None,
            "traffic_available": False,
            "risk_source": "weather_and_disaster_inputs"
        })

    # --------------------------------------------------------
    # STEP 7: Select lowest-cost route
    # --------------------------------------------------------

    best_route = min(
        scored_routes,
        key=lambda route:
            route["route_score"]
    )

    # --------------------------------------------------------
    # STEP 8: Alternatives
    # --------------------------------------------------------

    alternative_routes = [
        route
        for route in scored_routes
        if route["route_index"]
        != best_route["route_index"]
    ]

    # --------------------------------------------------------
    # STEP 9: Explain decision
    # --------------------------------------------------------

    if len(scored_routes) == 1:

        decision_reason = (
            "Only one road route was returned by "
            "OSRM. The available route was evaluated "
            "using disaster risk, accessibility, "
            "shipment priority, distance and ETA."
        )

    elif priority == "medicine":

        decision_reason = (
            "Medicine shipment detected. "
            "The routing engine gives stronger "
            "weight to safety, accessibility and "
            "disruption risk."
        )

    elif priority == "food":

        decision_reason = (
            "Food/relief shipment detected. "
            "The routing engine balances delivery "
            "time with route safety and accessibility."
        )

    elif priority == "construction":

        decision_reason = (
            "Construction shipment detected. "
            "The routing engine gives greater "
            "weight to distance and travel efficiency "
            "while still considering risk."
        )

    else:

        decision_reason = (
            "Route selected using the combined "
            "risk, accessibility, distance and "
            "travel-time score."
        )

    # --------------------------------------------------------
    # STEP 10: Final result
    # --------------------------------------------------------

    result["selected_route"] = best_route

    # Driver applications can use this directly without guessing which
    # route identifier belongs to the selected geometry.
    result["selected_route_id"] = best_route.get("route_id")

    result["alternative_routes"] = (
        alternative_routes
    )

    result["routes_found"] = len(
        scored_routes
    )

    result["distance_km"] = (
        best_route["distance_km"]
    )

    result["estimated_time_minutes"] = (
        best_route["estimated_time_minutes"]
    )

    result["route_geometry"] = (
        best_route["geometry"]
    )

    result["decision_reason"] = (
        decision_reason
    )

    result["route_comparison"] = (
        scored_routes
    )

    # --------------------------------------------------------
    # IMPORTANT: distinguish real alternatives
    # --------------------------------------------------------

    if len(scored_routes) > 1:

        result["route_selection_mode"] = (
            "multi_route_comparison"
        )

        result["route_selection_note"] = (
            "Multiple real road alternatives were returned by OSRM. "
            "The fallback engine compares them using the available "
            "risk, accessibility, distance and ETA inputs. Live traffic "
            "is not fabricated here; Mapbox traffic is handled by the "
            "smart control-room intelligence layer when configured."
        )

        result["alternative_routes_available"] = True

    else:

        result["route_selection_mode"] = (
            "single_route_evaluation"
        )

        result["route_selection_note"] = (
            "OSRM returned one real road route. No additional route "
            "was invented. Live traffic is not fabricated in this "
            "fallback engine."
        )

        result["alternative_routes_available"] = False

    return result