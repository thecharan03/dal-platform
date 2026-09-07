from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Set, Optional
import uvicorn
import uuid
import json
import os
import requests
from datetime import datetime, timezone, timedelta
from math import radians, cos, sin, asin, sqrt

from app.database import get_db, init_db
from app.models import Shipment, Vehicle, Driver, ShipmentStatus, VehicleStatus
from app.schemas import ShipmentCreate, VehicleCreate, VehicleResponse, ShipmentResponse
from app.services.priority_classifier import classify_priority
from app.services.route_optimizer import optimize_route
from app.ml.predictor import DisruptionPredictor
from app.routers import weather, routes, alerts

try:
    init_db()
except Exception as e:
    print(f"Database init error: {e}")

try:
    disruption_predictor = DisruptionPredictor()
    print("✓ Disaster disruption predictor initialized")
except Exception as e:
    disruption_predictor = None
    print(f"⚠ ML predictor initialization failed: {e}")

MAPBOX_ACCESS_TOKEN = os.getenv("MAPBOX_ACCESS_TOKEN", "").strip()

app = FastAPI(
    title="Disaster-Aware Logistics Platform",
    description="Live smart logistics control room for disaster-aware routing in the North Eastern Region",
    version="3.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(weather.router, prefix="/api/v1/weather", tags=["Weather"])
app.include_router(routes.router, prefix="/api/v1/routes", tags=["Routes"])
app.include_router(alerts.router, prefix="/api/v1/alerts", tags=["Alerts"])

active_connections: Set[WebSocket] = set()


@app.websocket("/ws/control-room")
async def control_room_ws(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.discard(websocket)
    except Exception:
        active_connections.discard(websocket)


@app.websocket("/ws/vehicles")
async def vehicle_ws(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        active_connections.discard(websocket)


async def broadcast(event: dict):
    dead = set()
    for connection in list(active_connections):
        try:
            await connection.send_json(event)
        except Exception:
            dead.add(connection)
    for connection in dead:
        active_connections.discard(connection)


def calculate_distance(lat1, lon1, lat2, lon2):
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 6371 * (2 * asin(sqrt(a)))


def enum_value(value):
    return getattr(value, "value", value)


def safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def ensure_smart_tables(db: Session):
    """SQLite/PostgreSQL-compatible operational tables. They avoid requiring a risky schema migration."""
    statements = [
        """
        CREATE TABLE IF NOT EXISTS dal_vehicle_assignment (
            shipment_id VARCHAR(100) PRIMARY KEY,
            vehicle_id VARCHAR(100) NOT NULL,
            driver_id VARCHAR(100) NULL,
            assigned_at TIMESTAMP NOT NULL,
            unassigned_at TIMESTAMP NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS dal_vehicle_telemetry (
            vehicle_id VARCHAR(100) PRIMARY KEY,
            latitude DOUBLE PRECISION NULL,
            longitude DOUBLE PRECISION NULL,
            speed_kmh DOUBLE PRECISION NULL,
            status VARCHAR(50) NULL,
            source VARCHAR(50) NULL,
            updated_at TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS dal_shipment_events (
            id VARCHAR(100) PRIMARY KEY,
            shipment_id VARCHAR(100) NOT NULL,
            event_type VARCHAR(80) NOT NULL,
            message TEXT NOT NULL,
            payload TEXT NULL,
            created_at TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS dal_shipment_state (
            shipment_id VARCHAR(100) PRIMARY KEY,
            status VARCHAR(50) NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS dal_selected_routes (
            shipment_id VARCHAR(100) PRIMARY KEY,
            route_id VARCHAR(100) NULL,
            route_name VARCHAR(255) NULL,
            route_data TEXT NULL,
            selected_at TIMESTAMP NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS dal_route_snapshots (
            shipment_id VARCHAR(100) PRIMARY KEY,
            selected_route TEXT NULL,
            route_geometry TEXT NULL,
            distance_km DOUBLE PRECISION NULL,
            eta_minutes DOUBLE PRECISION NULL,
            risk_percent DOUBLE PRECISION NULL,
            route_condition VARCHAR(50) NULL,
            reroute_required BOOLEAN NULL,
            updated_at TIMESTAMP NOT NULL
        )
        """,
    ]
    for statement in statements:
        db.execute(text(statement))
    try:
        db.execute(text("ALTER TABLE dal_vehicle_assignment ADD COLUMN driver_id VARCHAR(100) NULL"))
    except Exception:
        pass
    db.commit()


def log_event(db, shipment_id, event_type, message, payload=None):
    db.execute(
        text("""
            INSERT INTO dal_shipment_events
            (id, shipment_id, event_type, message, payload, created_at)
            VALUES (:id, :shipment_id, :event_type, :message, :payload, :created_at)
        """),
        {
            "id": str(uuid.uuid4()),
            "shipment_id": shipment_id,
            "event_type": event_type,
            "message": message,
            "payload": json.dumps(payload or {}),
            "created_at": datetime.utcnow(),
        },
    )


def get_driver(db, driver_id):
    if not driver_id:
        return None
    return db.query(Driver).filter(Driver.id == driver_id).first()


def serialize_driver(driver):
    if not driver:
        return None
    vehicle = getattr(driver, "vehicle", None)
    return {
        "id": driver.id,
        "name": driver.name,
        "phone": driver.phone,
        "license_number": driver.license_number,
        "vehicle_id": driver.vehicle_id,
        "vehicle_number": vehicle.vehicle_number if vehicle else None,
        "status": enum_value(driver.status),
        "created_at": driver.created_at.isoformat() if driver.created_at else None,
    }


def get_assignment(db, shipment_id):
    return db.execute(
        text("SELECT shipment_id, vehicle_id, driver_id, assigned_at FROM dal_vehicle_assignment WHERE shipment_id=:id AND unassigned_at IS NULL"),
        {"id": shipment_id},
    ).mappings().first()


def get_telemetry(db, vehicle_id):
    if not vehicle_id:
        return None
    return db.execute(
        text("SELECT vehicle_id, latitude, longitude, speed_kmh, status, source, updated_at FROM dal_vehicle_telemetry WHERE vehicle_id=:id"),
        {"id": vehicle_id},
    ).mappings().first()


def get_operational_status(db, shipment_id, fallback):
    row = db.execute(text("SELECT status FROM dal_shipment_state WHERE shipment_id=:id"), {"id": shipment_id}).mappings().first()
    return row["status"] if row else enum_value(fallback)


def set_operational_status(db, shipment_id, status):
    db.execute(text("""
        INSERT INTO dal_shipment_state (shipment_id, status, updated_at)
        VALUES (:id, :status, :updated_at)
        ON CONFLICT (shipment_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at
    """), {"id": shipment_id, "status": status, "updated_at": datetime.utcnow()})


def fetch_live_weather(lat, lon):
    response = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,rain,precipitation,wind_speed_10m,weather_code",
            "forecast_days": 1,
            "timezone": "auto",
        },
        timeout=8,
    )
    response.raise_for_status()
    current = response.json().get("current", {})
    rainfall = safe_float(current.get("rain", current.get("precipitation")))
    wind = safe_float(current.get("wind_speed_10m"))
    temperature = safe_float(current.get("temperature_2m"))
    humidity = safe_float(current.get("relative_humidity_2m"))
    flood = min(1, max(0, rainfall / 45 * 0.65 + humidity / 100 * 0.2))
    landslide = min(1, max(0, rainfall / 50 * 0.65 + wind / 90 * 0.2))
    if disruption_predictor:
        prediction = disruption_predictor.predict(
            rainfall_mm=rainfall,
            temperature_c=temperature,
            wind_speed_kmh=wind,
            flood_risk_score=flood,
            landslide_risk_score=landslide,
        )
    else:
        hazard = flood * 0.45 + landslide * 0.55
        prediction = {
            "risk_score": hazard,
            "risk_percent": round(hazard * 100),
            "risk_level": "MODEL UNAVAILABLE",
            "ml_probability": hazard,
            "disrupted": hazard >= 0.6,
        }
    return {
        "status": "LIVE",
        "source": "Open-Meteo",
        "temperature_c": temperature,
        "rainfall_mm": rainfall,
        "wind_speed_kmh": wind,
        "humidity_percent": humidity,
        "weather_code": current.get("weather_code"),
        "flood_risk_score": round(flood, 3),
        "landslide_risk_score": round(landslide, 3),
        "risk": prediction,
    }



def traffic_level(congestion_value):
    if congestion_value is None:
        return "unknown"
    if isinstance(congestion_value, (int, float)):
        if congestion_value >= 0.75:
            return "severe"
        if congestion_value >= 0.45:
            return "heavy"
        if congestion_value >= 0.2:
            return "moderate"
        return "free"
    value = str(congestion_value).lower()
    if value in {"severe", "heavy", "moderate", "low"}:
        return value
    return "unknown"


def fetch_mapbox_traffic_routes(origin_lat, origin_lon, destination_lat, destination_lon):
    """
    Real road + live traffic routing when MAPBOX_ACCESS_TOKEN is configured.
    Returns route alternatives with congestion annotations.
    """
    if not MAPBOX_ACCESS_TOKEN:
        return None

    url = (
        "https://api.mapbox.com/directions/v5/mapbox/"
        f"driving-traffic/{origin_lon},{origin_lat};{destination_lon},{destination_lat}"
    )
    params = {
        "access_token": MAPBOX_ACCESS_TOKEN,
        "alternatives": "true",
        "geometries": "geojson",
        "overview": "full",
        "steps": "true",
        "annotations": "distance,duration,congestion,speed",
        "language": "en",
    }
    response = requests.get(url, params=params, timeout=12)
    response.raise_for_status()
    payload = response.json()
    routes = payload.get("routes") or []
    if not routes:
        return None

    normalized = []
    for idx, route in enumerate(routes):
        geometry = (route.get("geometry") or {}).get("coordinates") or []
        congestion = route.get("congestion") or []
        durations = route.get("duration") or []
        distances = route.get("distance") or []
        # Mapbox may return annotations nested in a route leg.
        if not congestion:
            leg = (route.get("legs") or [{}])[0]
            ann = leg.get("annotation") or {}
            congestion = ann.get("congestion") or []
            durations = ann.get("duration") or durations
            distances = ann.get("distance") or distances

        levels = [traffic_level(v) for v in congestion]
        known = [v for v in levels if v != "unknown"]
        traffic_weight = {"free": 0, "moderate": 0.35, "heavy": 0.7, "severe": 1}
        traffic_score = (
            sum(traffic_weight.get(v, 0.5) for v in known) / len(known)
            if known else 0
        )

        # Traffic segments allow the manager to see what is ahead, not just
        # one overall traffic number.
        segments = []
        cumulative_distance = 0.0
        for i, level in enumerate(levels):
            if i + 1 >= len(geometry):
                break
            p1, p2 = geometry[i], geometry[i + 1]
            segment_distance = (
                float(distances[i]) if i < len(distances) and distances[i] is not None else None
            )
            segment_duration = (
                float(durations[i]) if i < len(durations) and durations[i] is not None else None
            )
            if segment_distance is not None:
                cumulative_distance += segment_distance
            segments.append({
                "index": i,
                "from": {"lat": p1[1], "lon": p1[0]},
                "to": {"lat": p2[1], "lon": p2[0]},
                "distance_m": segment_distance,
                "distance_from_start_m": cumulative_distance,
                "duration_s": segment_duration,
                "congestion": level,
            })

        normalized.append({
            "route_index": idx,
            "distance_km": round(float(route.get("distance", 0)) / 1000, 2),
            "estimated_time_minutes": round(float(route.get("duration", 0)) / 60, 1),
            "traffic_score": round(traffic_score, 3),
            "traffic_percent": round(traffic_score * 100, 1),
            "traffic_delay_minutes": round(float(route.get("duration", 0) - route.get("duration_typical", route.get("duration", 0))) / 60, 1)
                if route.get("duration_typical") is not None else None,
            "geometry": geometry,
            "traffic_segments": segments,
            "source": "Mapbox Traffic",
        })

    return normalized


def choose_traffic_route(routes, risk_score, shipment_priority):
    if not routes:
        return None
    weights = {
        "medicine": (0.45, 0.30, 0.25),
        "food": (0.40, 0.30, 0.30),
        "construction": (0.25, 0.30, 0.45),
        "normal": (0.35, 0.30, 0.35),
    }
    traffic_w, risk_w, distance_w = weights.get(str(shipment_priority).lower(), weights["normal"])
    max_distance = max((r["distance_km"] for r in routes), default=1) or 1
    max_time = max((r["estimated_time_minutes"] for r in routes), default=1) or 1
    for r in routes:
        distance_norm = r["distance_km"] / max_distance
        time_norm = r["estimated_time_minutes"] / max_tiDAL_API_URLme
        score = (
            traffic_w * r["traffic_score"]
            + risk_w * risk_score
            + distance_w * ((distance_norm + time_norm) / 2)
        )
        r["route_score"] = round(100 * (1 - min(1, score)), 1)
    return max(routes, key=lambda r: r.get("route_score", 0))


def compute_intelligence(shipment, vehicle, telemetry):
    origin_lat = safe_float(shipment.origin_lat)
    origin_lon = safe_float(shipment.origin_lon)

    print("DEBUG ORIGIN:")
    print("telemetry =", telemetry)
    print("vehicle current_lat =", vehicle.current_lat if vehicle else None)
    print("vehicle current_lon =", vehicle.current_lon if vehicle else None)
    print("shipment origin_lat =", shipment.origin_lat)
    print("shipment origin_lon =", shipment.origin_lon)
    print("FINAL origin =", origin_lat, origin_lon)

    destination_lat = safe_float(shipment.destination_lat)
    destination_lon = safe_float(shipment.destination_lon)

    # ============================================================
    # WEATHER
    # ============================================================

    weather_data = {}
    prediction = {}
    base_risk = 0.0
    hazard_risk = 0.0

    try:
        weather_data = fetch_live_weather(
            destination_lat,
            destination_lon
        )

        prediction = weather_data.get("risk", {})

        base_risk = safe_float(
         prediction.get("risk_score")
        )

        hazard_risk = safe_float(
            prediction.get("hazard_score"),
            safe_float(weather_data.get("flood_risk_score")) * 0.45
            + safe_float(weather_data.get("landslide_risk_score")) * 0.55,
        )

    except Exception as weather_exc:
        # Weather failure should NOT stop route calculation.
        print(f"⚠️ Weather unavailable: {weather_exc}")

        weather_data = {
            "status": "UNAVAILABLE",
            "source": "Open-Meteo",
            "error": str(weather_exc),
            "risk": {},
        }

        prediction = {}
        base_risk = 0.0
        hazard_risk = 0.0

    # ============================================================
    # MAPBOX TRAFFIC ROUTING
    # ============================================================

    traffic_routes = None

    try:
        traffic_routes = fetch_mapbox_traffic_routes(
            origin_lat,
            origin_lon,
            destination_lat,
            destination_lon
        )
    except Exception as traffic_exc:
        print(f"⚠️ Traffic routing unavailable: {traffic_exc}")

    # ============================================================
    # MAPBOX ROUTING AVAILABLE
    # ============================================================

    if traffic_routes:
        selected = choose_traffic_route(
            traffic_routes,
            base_risk,
            shipment.category or "normal",
        )

        alternatives = [
            r for r in traffic_routes
            if r["route_index"] != selected["route_index"]
        ]

        combined_condition_score = max(
            base_risk,
            selected.get("traffic_score", 0),
        )

        if combined_condition_score >= 0.75:
            condition = "critical"
        elif combined_condition_score >= 0.60:
            condition = "high"
        elif combined_condition_score >= 0.40:
            condition = "moderate"
        else:
            condition = "safe"

        reroute_required = (
            base_risk >= 0.60
            or selected.get("traffic_score", 0) >= 0.60
            or (
                alternatives
                and min(
                    r.get("traffic_score", 1)
                    for r in alternatives
                )
                + 0.15
                < selected.get("traffic_score", 1)
            )
        )

        traffic_ahead = []

        for seg in selected.get("traffic_segments", []):
            if seg.get("congestion") in {
                "moderate",
                "heavy",
                "severe"
            }:
                traffic_ahead.append(seg)

        traffic_ahead = traffic_ahead[:20]

        return {
            "weather": weather_data,
            "ml_prediction": prediction,
            "risk_percent": round(
                max(
                    base_risk,
                    selected.get("traffic_score", 0)
                ) * 100,
                1,
            ),
            "risk_score": max(
                base_risk,
                selected.get("traffic_score", 0)
            ),
            "selected_route": selected,
            "alternative_routes": alternatives,
            "route_comparison": traffic_routes,
            "route_geometry": selected.get("geometry", []),
            "distance_km": selected.get("distance_km"),
            "estimated_time_minutes": selected.get(
                "estimated_time_minutes"
            ),
            "reroute_required": reroute_required,
            "route_status": (
                "reroute_required"
                if reroute_required
                else "optimal"
            ),
            "route_condition": condition,
            "road_accessibility_percent": round(
                (1 - base_risk * 0.65) * 100,
                1,
            ),
            "decision_reason": (
                "Traffic-aware route selected because it minimizes "
                "live congestion and disruption risk."
                if selected.get("traffic_score", 0) > 0.20
                else "Safest route selected using live road, weather "
                "and ML disruption intelligence."
            ),
            "routes_found": len(traffic_routes),
            "traffic": {
                "available": True,
                "source": "Mapbox Traffic",
                "route_traffic_percent": selected.get(
                    "traffic_percent",
                    0
                ),
                "traffic_score": selected.get(
                    "traffic_score",
                    0
                ),
                "traffic_ahead": traffic_ahead,
                "traffic_segments": selected.get(
                    "traffic_segments",
                    []
                ),
            },
            "origin_for_route": {
                "lat": origin_lat,
                "lon": origin_lon
            },
            "updated_at": datetime.now(
                timezone.utc
            ).isoformat(),
        }

    # ============================================================
    # OSRM FALLBACK
    # ============================================================

    print("🛣️ Using OSRM fallback routing...")

    try:
        base_route = optimize_route(
            base_risk_score=max(
                0,
                min(1, base_risk)
            ),
            weather_risk_score=max(
                0,
                min(1, hazard_risk)
            ),
            origin_lat=origin_lat,
            origin_lon=origin_lon,
            destination_lat=destination_lat,
            destination_lon=destination_lon,
            shipment_priority=shipment.category or "normal",
        )

    except Exception as route_exc:
        print(f"❌ OSRM routing failed: {route_exc}")

        base_route = {
            "risk_score": 0,
            "risk_percent": 0,
            "route_condition": "unavailable",
            "route_status": "unavailable",
            "selected_route": None,
            "alternative_routes": [],
            "route_comparison": [],
            "route_geometry": [],
            "distance_km": None,
            "estimated_time_minutes": None,
            "reroute_required": False,
            "road_accessibility_percent": None,
            "decision_reason": f"Routing failed: {route_exc}",
            "routes_found": 0,
        }

    # ============================================================
    # FINAL RESPONSE
    # ============================================================

    return {
        "weather": weather_data,
        "ml_prediction": prediction,
        "risk_percent": base_route.get(
            "risk_percent",
            0
        ),
        "risk_score": base_route.get(
            "risk_score",
            0
        ),
        "selected_route": base_route.get(
            "selected_route"
        ),
        "alternative_routes": base_route.get(
            "alternative_routes",
            []
        ),
        "route_comparison": base_route.get(
            "route_comparison",
            []
        ),
        "route_geometry": base_route.get(
            "route_geometry",
            []
        ),
        "distance_km": base_route.get(
            "distance_km"
        ),
        "estimated_time_minutes": base_route.get(
            "estimated_time_minutes"
        ),
        "reroute_required": base_route.get(
            "reroute_required",
            False
        ),
        "route_status": base_route.get(
            "route_status"
        ),
        "route_condition": base_route.get(
            "route_condition"
        ),
        "road_accessibility_percent": base_route.get(
            "road_accessibility_percent"
        ),
        "decision_reason": base_route.get(
            "decision_reason"
        ),
        "routes_found": base_route.get(
            "routes_found",
            0
        ),
        "traffic": {
            "available": False,
            "source": "Not configured",
            "route_traffic_percent": None,
            "traffic_score": None,
            "traffic_ahead": [],
            "traffic_segments": [],
            "message": (
                "Configure MAPBOX_ACCESS_TOKEN for "
                "live traffic-aware routing."
            ),
        },
        "origin_for_route": {
            "lat": origin_lat,
            "lon": origin_lon
        },
        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),
    }



def serialize_vehicle(vehicle, telemetry=None):
    return {
        "id": vehicle.id,
        "vehicle_number": vehicle.vehicle_number,
        "latitude": telemetry["latitude"] if telemetry and telemetry["latitude"] is not None else vehicle.current_lat,
        "longitude": telemetry["longitude"] if telemetry and telemetry["longitude"] is not None else vehicle.current_lon,
        "speed_kmh": telemetry["speed_kmh"] if telemetry else None,
        "status": telemetry["status"] if telemetry and telemetry["status"] else enum_value(vehicle.status),
        "source": telemetry["source"] if telemetry else "database",
        "last_updated": telemetry["updated_at"].isoformat() if telemetry and telemetry["updated_at"] else None,
        "capacity_kg": vehicle.capacity_kg,
    }


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "3.1.0", "ml_available": disruption_predictor is not None, "live_weather": True, "live_gps": True, "driver_workflow": True}


@app.get("/")
async def root():
    return {"name": "Disaster-Aware Logistics Platform", "version": "3.1.0", "docs": "/docs"}


@app.post("/api/v1/risk/predict")
async def predict_disaster_risk(risk_data: dict):
    if disruption_predictor is None:
        raise HTTPException(status_code=503, detail="Disruption prediction model is unavailable")
    try:
        result = disruption_predictor.predict(
            rainfall_mm=risk_data.get("rainfall_mm", 0),
            temperature_c=risk_data.get("temperature_c", 0),
            wind_speed_kmh=risk_data.get("wind_speed_kmh", 0),
            flood_risk_score=risk_data.get("flood_risk_score", 0),
            landslide_risk_score=risk_data.get("landslide_risk_score", 0),
        )
        return {"success": True, "prediction": result}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid risk input: {exc}")


# ============================================================
# DRIVER OPERATIONS
# ============================================================

@app.post("/api/v1/drivers/create")
async def create_driver(driver_data: dict, db: Session = Depends(get_db)):
    name = str(driver_data.get("name", "")).strip()
    phone = str(driver_data.get("phone", "")).strip() or None
    license_number = str(driver_data.get("license_number", "")).strip() or None
    vehicle_id = str(driver_data.get("vehicle_id", "")).strip() or None
    if not name:
        raise HTTPException(status_code=400, detail="Driver name is required")
    if vehicle_id:
        vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
        if not vehicle:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        if db.query(Driver).filter(Driver.vehicle_id == vehicle_id).first():
            raise HTTPException(status_code=409, detail="Vehicle is already linked to a driver")
    if license_number and db.query(Driver).filter(Driver.license_number == license_number).first():
        raise HTTPException(status_code=409, detail="License number already exists")
    driver = Driver(id=str(uuid.uuid4()), name=name, phone=phone, license_number=license_number,
                    vehicle_id=vehicle_id, status="available", created_at=datetime.utcnow())
    db.add(driver); db.commit(); db.refresh(driver)
    await broadcast({"type": "driver_created", "driver_id": driver.id, "driver_name": driver.name})
    return {"success": True, "driver": serialize_driver(driver)}


@app.get("/api/v1/drivers/")
async def list_drivers(db: Session = Depends(get_db)):
    return [serialize_driver(d) for d in db.query(Driver).all()]


@app.get("/api/v1/drivers/available")
async def available_drivers(db: Session = Depends(get_db)):
    result = []
    for driver in db.query(Driver).filter(Driver.status == "available").all():
        vehicle = driver.vehicle
        if not vehicle or str(enum_value(vehicle.status)).upper() == "IN_TRANSIT":
            continue
        telemetry = get_telemetry(db, vehicle.id)
        result.append({**serialize_driver(driver), "vehicle_available": True,
                       "vehicle_status": enum_value(vehicle.status),
                       "gps_online": bool(telemetry and telemetry.get("updated_at"))})
    return {"success": True, "count": len(result), "drivers": result}


@app.get("/api/v1/drivers/{driver_id}")
async def get_driver_profile(driver_id: str, db: Session = Depends(get_db)):
    driver = get_driver(db, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    return {"success": True, "driver": serialize_driver(driver)}


@app.get("/api/v1/drivers/{driver_id}/trips")
async def driver_trips(driver_id: str, db: Session = Depends(get_db)):
    driver = get_driver(db, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    ensure_smart_tables(db)
    available, current = [], []
    for shipment in db.query(Shipment).all():
        status = get_operational_status(db, shipment.id, shipment.status)
        assignment = get_assignment(db, shipment.id)
        base = {"id": shipment.id, "priority_level": enum_value(shipment.priority_level),
                "category": shipment.category, "weight_kg": shipment.weight_kg, "status": status,
                "origin": {"lat": shipment.origin_lat, "lon": shipment.origin_lon},
                "destination": {"lat": shipment.destination_lat, "lon": shipment.destination_lon},
                "created_at": shipment.created_at}
        if status == "PENDING" and not assignment:
            available.append(base)
        if assignment and assignment.get("driver_id") == driver_id and status not in {"DELIVERED", "CANCELLED"}:
            base["assignment"] = dict(assignment); current.append(base)
    return {"success": True, "driver": serialize_driver(driver),
            "available_trips": available, "current_trips": current}


@app.post("/api/v1/drivers/{driver_id}/accept-trip/{shipment_id}")
async def driver_accept_trip(driver_id: str, shipment_id: str, db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    driver = get_driver(db, driver_id)
    shipment = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    if not driver.vehicle_id:
        raise HTTPException(status_code=409, detail="Driver has no vehicle assigned")
    if str(driver.status).lower() != "available":
        raise HTTPException(status_code=409, detail="Driver is not available")
    if get_assignment(db, shipment_id):
        raise HTTPException(status_code=409, detail="Shipment was already accepted by another driver")
    if get_operational_status(db, shipment_id, shipment.status) != "PENDING":
        raise HTTPException(status_code=409, detail="Shipment is not available")
    vehicle = db.query(Vehicle).filter(Vehicle.id == driver.vehicle_id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Driver vehicle not found")
    if shipment.weight_kg > vehicle.capacity_kg:
        raise HTTPException(status_code=409, detail=f"Vehicle capacity is {vehicle.capacity_kg} kg, but shipment requires {shipment.weight_kg} kg")
    busy = db.execute(text("SELECT shipment_id FROM dal_vehicle_assignment WHERE vehicle_id=:vehicle_id AND unassigned_at IS NULL LIMIT 1"),
                       {"vehicle_id": vehicle.id}).mappings().first()
    if busy:
        raise HTTPException(status_code=409, detail="Driver vehicle is already on another active trip")
    now = datetime.utcnow()
    db.execute(text("""INSERT INTO dal_vehicle_assignment
        (shipment_id, vehicle_id, driver_id, assigned_at, unassigned_at)
        VALUES (:shipment_id, :vehicle_id, :driver_id, :now, NULL)"""),
        {"shipment_id": shipment_id, "vehicle_id": vehicle.id, "driver_id": driver.id, "now": now})
    set_operational_status(db, shipment_id, "IN_TRANSIT")
    try: shipment.status = ShipmentStatus.IN_TRANSIT
    except Exception: pass
    vehicle.status = VehicleStatus.IN_TRANSIT; driver.status = "on_trip"
    log_event(db, shipment_id, "DRIVER_ACCEPTED_TRIP", f"Driver {driver.name} accepted the shipment",
              {"driver_id": driver.id, "driver_name": driver.name, "vehicle_id": vehicle.id})
    db.commit()
    await broadcast({"type": "driver_trip_accepted", "shipment_id": shipment_id, "driver_id": driver.id,
                     "driver_name": driver.name, "vehicle_id": vehicle.id})
    return {"success": True, "message": "Trip accepted successfully", "shipment_id": shipment_id,
            "driver": serialize_driver(driver), "vehicle": serialize_vehicle(vehicle, get_telemetry(db, vehicle.id)),
            "status": "IN_TRANSIT"}


@app.post("/api/v1/drivers/{driver_id}/available")
async def set_driver_available(driver_id: str, db: Session = Depends(get_db)):
    driver = get_driver(db, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    active = db.execute(text("SELECT shipment_id FROM dal_vehicle_assignment WHERE driver_id=:driver_id AND unassigned_at IS NULL LIMIT 1"),
                        {"driver_id": driver_id}).mappings().first()
    if active:
        raise HTTPException(status_code=409, detail="Driver still has an active shipment")
    driver.status = "available"
    if driver.vehicle: driver.vehicle.status = VehicleStatus.AVAILABLE
    db.commit()
    return {"success": True, "driver": serialize_driver(driver)}


@app.post("/api/v1/shipments/create", response_model=ShipmentResponse)
async def create_shipment(shipment: ShipmentCreate, db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    distance = calculate_distance(shipment.origin_lat, shipment.origin_lon, shipment.destination_lat, shipment.destination_lon)
    priority = classify_priority(shipment.category, distance)
    db_shipment = Shipment(
        id=str(uuid.uuid4()),
        priority_level=priority,
        origin_lat=shipment.origin_lat,
        origin_lon=shipment.origin_lon,
        destination_lat=shipment.destination_lat,
        destination_lon=shipment.destination_lon,
        weight_kg=shipment.weight_kg,
        category=shipment.category,
        status=ShipmentStatus.PENDING,
        created_at=datetime.utcnow(),
    )
    db.add(db_shipment)
    db.commit()
    db.refresh(db_shipment)
    set_operational_status(db, db_shipment.id, "PENDING")
    log_event(db, db_shipment.id, "CREATED", f"Shipment created with {enum_value(priority)} priority", {"category": shipment.category, "weight_kg": shipment.weight_kg})
    db.commit()
    return db_shipment


@app.get("/api/v1/shipments/live-control-room")
async def live_control_room(db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    shipments = db.query(Shipment).all()
    vehicles = db.query(Vehicle).all()
    vehicle_map = {v.id: v for v in vehicles}
    output = []

    for shipment in shipments:
        assignment = get_assignment(db, shipment.id)
        vehicle = vehicle_map.get(assignment["vehicle_id"]) if assignment else None
        telemetry = get_telemetry(db, vehicle.id) if vehicle else None
        status = get_operational_status(db, shipment.id, shipment.status)

        # Historical records remain visible, but expensive live intelligence is
        # calculated only for active operations.
        intelligence = (
            compute_intelligence(shipment, vehicle, telemetry)
            if status not in {"DELIVERED", "CANCELLED"}
            else {
                "risk_percent": None,
                "risk_score": None,
                "route_condition": status.lower(),
                "route_status": "closed",
                "selected_route": None,
                "alternative_routes": [],
                "route_comparison": [],
                "route_geometry": [],
                "distance_km": None,
                "estimated_time_minutes": None,
                "reroute_required": False,
                "road_accessibility_percent": None,
                "decision_reason": f"Shipment is {status.lower()} and is no longer under live routing.",
                "routes_found": 0,
                "weather": {},
                "ml_prediction": {},
                "traffic": {"available": False, "source": "Not active"},
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )

        if status not in {"DELIVERED", "CANCELLED"}:
            db.execute(text("""
                INSERT INTO dal_route_snapshots
                (shipment_id, selected_route, route_geometry, distance_km, eta_minutes,
                 risk_percent, route_condition, reroute_required, updated_at)
                VALUES (:shipment_id, :selected_route, :route_geometry, :distance_km,
                        :eta_minutes, :risk_percent, :route_condition, :reroute_required, :updated_at)
                ON CONFLICT (shipment_id) DO UPDATE SET
                  selected_route=excluded.selected_route,
                  route_geometry=excluded.route_geometry,
                  distance_km=excluded.distance_km,
                  eta_minutes=excluded.eta_minutes,
                  risk_percent=excluded.risk_percent,
                  route_condition=excluded.route_condition,
                  reroute_required=excluded.reroute_required,
                  updated_at=excluded.updated_at
            """), {
                "shipment_id": shipment.id,
                "selected_route": json.dumps(intelligence.get("selected_route")),
                "route_geometry": json.dumps(intelligence.get("route_geometry", [])),
                "distance_km": intelligence.get("distance_km"),
                "eta_minutes": intelligence.get("estimated_time_minutes"),
                "risk_percent": intelligence.get("risk_percent"),
                "route_condition": intelligence.get("route_condition"),
                "reroute_required": bool(intelligence.get("reroute_required")),
                "updated_at": datetime.utcnow(),
            })

        output.append({
            "id": shipment.id,
            "priority_level": enum_value(shipment.priority_level),
            "category": shipment.category,
            "weight_kg": shipment.weight_kg,
            "status": status,
            "created_at": shipment.created_at,
            "origin": {"lat": shipment.origin_lat, "lon": shipment.origin_lon},
            "destination": {"lat": shipment.destination_lat, "lon": shipment.destination_lon},
            "vehicle": serialize_vehicle(vehicle, telemetry) if vehicle else None,
            "assignment": dict(assignment) if assignment else None,
            "driver": serialize_driver(get_driver(db, assignment.get("driver_id"))) if assignment and assignment.get("driver_id") else None,
            "intelligence": intelligence,
        })

    db.commit()
    active = [x for x in output if x["status"] not in {"DELIVERED", "CANCELLED"}]
    return {
        "success": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "traffic_provider": "Mapbox Traffic" if MAPBOX_ACCESS_TOKEN else "Not configured",
        "shipments": output,
        "active_shipments": active,
        "vehicles": [serialize_vehicle(v, get_telemetry(db, v.id)) for v in vehicles],
        "summary": {
            "total": len(output),
            "active": len(active),
            "delivered": sum(x["status"] == "DELIVERED" for x in output),
            "cancelled": sum(x["status"] == "CANCELLED" for x in output),
            "at_risk": sum(
                x["status"] not in {"DELIVERED", "CANCELLED"}
                and safe_float(x["intelligence"].get("risk_percent")) >= 60
                for x in output
            ),
        },
    }


@app.post("/api/v1/shipments/{shipment_id}/assign-vehicle")
async def assign_vehicle(shipment_id: str, vehicle_id: str, driver_id: Optional[str] = None, db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    shipment = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    driver = get_driver(db, driver_id) if driver_id else None
    if driver_id and not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    if driver and driver.vehicle_id != vehicle_id:
        raise HTTPException(status_code=409, detail="Driver is not linked to this vehicle")
    if driver and str(driver.status).lower() != "available":
        raise HTTPException(status_code=409, detail="Driver is not available")

    current_status = get_operational_status(db, shipment_id, shipment.status)
    if current_status in {"DELIVERED", "CANCELLED"}:
        raise HTTPException(status_code=409, detail=f"{current_status.title()} shipment cannot be assigned")

    if shipment.weight_kg > vehicle.capacity_kg:
        raise HTTPException(
            status_code=409,
            detail=f"Vehicle capacity is {vehicle.capacity_kg} kg, but shipment requires {shipment.weight_kg} kg."
        )

    # A vehicle may serve only one active shipment at a time.
    busy = db.execute(text("""
        SELECT shipment_id
        FROM dal_vehicle_assignment
        WHERE vehicle_id=:vehicle_id
          AND unassigned_at IS NULL
          AND shipment_id <> :shipment_id
        LIMIT 1
    """), {"vehicle_id": vehicle_id, "shipment_id": shipment_id}).mappings().first()
    if busy:
        other_status = db.execute(
            text("SELECT status FROM dal_shipment_state WHERE shipment_id=:id"),
            {"id": busy["shipment_id"]},
        ).mappings().first()
        if other_status and other_status["status"] not in {"DELIVERED", "CANCELLED"}:
            raise HTTPException(status_code=409, detail="Vehicle is already assigned to another active shipment.")

    existing = get_assignment(db, shipment_id)
    if existing and existing["vehicle_id"] != vehicle_id:
        db.execute(
            text("UPDATE dal_vehicle_assignment SET unassigned_at=:now WHERE shipment_id=:id"),
            {"now": datetime.utcnow(), "id": shipment_id},
        )

    db.execute(text("""
        INSERT INTO dal_vehicle_assignment (shipment_id, vehicle_id, driver_id, assigned_at, unassigned_at)
        VALUES (:shipment_id, :vehicle_id, :driver_id, :now, NULL)
        ON CONFLICT (shipment_id) DO UPDATE SET
          vehicle_id=excluded.vehicle_id,
          driver_id=excluded.driver_id,
          assigned_at=excluded.assigned_at,
          unassigned_at=NULL
    """), {"shipment_id": shipment_id, "vehicle_id": vehicle_id, "driver_id": driver_id, "now": datetime.utcnow()})

    set_operational_status(db, shipment_id, "IN_TRANSIT")
    try:
        shipment.status = ShipmentStatus.IN_TRANSIT
    except Exception:
        pass
    vehicle.status = VehicleStatus.IN_TRANSIT
    if driver:
        driver.status = "on_trip"
    log_event(db, shipment_id, "VEHICLE_ASSIGNED",
              f"Vehicle {vehicle.vehicle_number} assigned" + (f" with driver {driver.name}" if driver else ""),
              {"vehicle_id": vehicle.id, "driver_id": driver.id if driver else None})
    db.commit()
    await broadcast({"type": "assignment", "shipment_id": shipment_id, "vehicle_id": vehicle_id})
    return {
        "success": True,
        "shipment_id": shipment_id,
        "vehicle_id": vehicle_id,
        "vehicle_number": vehicle.vehicle_number,
        "status": "IN_TRANSIT",
    }


@app.post("/api/v1/shipments/{shipment_id}/unassign-vehicle")
async def unassign_vehicle(shipment_id: str, db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    assignment = get_assignment(db, shipment_id)
    if not assignment:
        return {"success": True, "message": "Shipment is already unassigned"}
    vehicle = db.query(Vehicle).filter(Vehicle.id == assignment["vehicle_id"]).first()
    if vehicle:
        vehicle.status = VehicleStatus.AVAILABLE
    driver = get_driver(db, assignment.get("driver_id")) if assignment.get("driver_id") else None
    if driver:
        driver.status = "available"
    db.execute(text("UPDATE dal_vehicle_assignment SET unassigned_at=:now WHERE shipment_id=:id"), {"now": datetime.utcnow(), "id": shipment_id})
    log_event(db, shipment_id, "VEHICLE_UNASSIGNED", "Vehicle assignment removed")
    db.commit()
    await broadcast({"type": "assignment_removed", "shipment_id": shipment_id})
    return {"success": True}


@app.post("/api/v1/shipments/{shipment_id}/cancel")
async def cancel_shipment(shipment_id: str, reason: str = "Cancelled by manager", db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    shipment = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    current = get_operational_status(db, shipment.id, shipment.status)
    if str(current).upper() == "DELIVERED":
        raise HTTPException(status_code=409, detail="Delivered shipment cannot be cancelled")
    if str(current).upper() == "CANCELLED":
        raise HTTPException(status_code=409, detail="Shipment is already cancelled")
    assignment = get_assignment(db, shipment_id)
    if assignment:
        vehicle = db.query(Vehicle).filter(Vehicle.id == assignment["vehicle_id"]).first()
        if vehicle:
            vehicle.status = VehicleStatus.AVAILABLE
        db.execute(text("UPDATE dal_vehicle_assignment SET unassigned_at=:now WHERE shipment_id=:id"), {"now": datetime.utcnow(), "id": shipment_id})
    set_operational_status(db, shipment_id, "CANCELLED")
    try:
        shipment.status = ShipmentStatus.CANCELLED
    except Exception:
        pass
    log_event(db, shipment_id, "CANCELLED", reason)
    db.commit()
    await broadcast({"type": "shipment_cancelled", "shipment_id": shipment_id, "reason": reason})
    return {"success": True, "shipment_id": shipment_id, "status": "CANCELLED", "reason": reason}


@app.post("/api/v1/shipments/{shipment_id}/deliver")
async def deliver_shipment(shipment_id: str, db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    shipment = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    current = get_operational_status(db, shipment.id, shipment.status)
    if str(current).upper() == "DELIVERED":
        raise HTTPException(status_code=409, detail="Shipment is already delivered")
    if str(current).upper() == "CANCELLED":
        raise HTTPException(status_code=409, detail="Cancelled shipment cannot be delivered")
    set_operational_status(db, shipment_id, "DELIVERED")
    try:
        shipment.status = ShipmentStatus.DELIVERED
    except Exception:
        pass
    assignment = get_assignment(db, shipment_id)
    if assignment:
        vehicle = db.query(Vehicle).filter(Vehicle.id == assignment["vehicle_id"]).first()
        if vehicle:
            vehicle.status = VehicleStatus.AVAILABLE
        db.execute(text("UPDATE dal_vehicle_assignment SET unassigned_at=:now WHERE shipment_id=:id"), {"now": datetime.utcnow(), "id": shipment_id})
    log_event(db, shipment_id, "DELIVERED", "Shipment marked delivered")
    db.commit()
    await broadcast({"type": "shipment_delivered", "shipment_id": shipment_id})
    return {"success": True, "shipment_id": shipment_id, "status": "DELIVERED"}


@app.get("/api/v1/shipments/{shipment_id}/intelligence")
async def shipment_intelligence(shipment_id: str, db: Session = Depends(get_db)):
    """Live driver-facing intelligence for one assigned shipment."""
    ensure_smart_tables(db)
    shipment = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    status = get_operational_status(db, shipment_id, shipment.status)
    assignment = get_assignment(db, shipment_id)
    vehicle = None
    telemetry = None
    if assignment:
        vehicle = db.query(Vehicle).filter(Vehicle.id == assignment["vehicle_id"]).first()
        telemetry = get_telemetry(db, assignment["vehicle_id"])

    if status in {"DELIVERED", "CANCELLED"}:
        return {
            "success": True,
            "shipment_id": shipment_id,
            "status": status,
            "assignment": dict(assignment) if assignment else None,
            "vehicle": serialize_vehicle(vehicle, telemetry) if vehicle else None,
            "intelligence": {
                "route_status": "closed",
                "route_condition": status.lower(),
                "routes_found": 0,
                "alternative_routes": [],
                "route_comparison": [],
            },
        }

    intelligence = compute_intelligence(shipment, vehicle, telemetry)
    selected = intelligence.get("selected_route")
    saved = db.execute(
        text("SELECT route_id, route_name, route_data, selected_at FROM dal_selected_routes WHERE shipment_id=:id"),
        {"id": shipment_id},
    ).mappings().first()

    intelligence["selected_route_persisted"] = dict(saved) if saved else None
    return {
        "success": True,
        "shipment_id": shipment_id,
        "status": status,
        "shipment": {
            "id": shipment.id,
            "category": shipment.category,
            "priority_level": enum_value(shipment.priority_level),
            "weight_kg": shipment.weight_kg,
            "origin": {"lat": shipment.origin_lat, "lon": shipment.origin_lon},
            "destination": {"lat": shipment.destination_lat, "lon": shipment.destination_lon},
        },
        "assignment": dict(assignment) if assignment else None,
        "vehicle": serialize_vehicle(vehicle, telemetry) if vehicle else None,
        "intelligence": intelligence,
    }


@app.post("/api/v1/shipments/{shipment_id}/route/select")
async def select_shipment_route(shipment_id: str, route_data: dict, db: Session = Depends(get_db)):
    """Persist the route selected by the driver."""
    ensure_smart_tables(db)
    shipment = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    status = get_operational_status(db, shipment_id, shipment.status)
    if status in {"DELIVERED", "CANCELLED"}:
        raise HTTPException(status_code=409, detail=f"{status.title()} shipment cannot change route")

    route_id = str(route_data.get("route_id", ""))
    route_name = str(route_data.get("route_name", "Selected route"))
    if not route_id:
        raise HTTPException(status_code=400, detail="route_id is required")

    db.execute(text("""
        INSERT INTO dal_selected_routes (shipment_id, route_id, route_name, route_data, selected_at)
        VALUES (:shipment_id, :route_id, :route_name, :route_data, :selected_at)
        ON CONFLICT (shipment_id) DO UPDATE SET
            route_id=excluded.route_id,
            route_name=excluded.route_name,
            route_data=excluded.route_data,
            selected_at=excluded.selected_at
    """), {
        "shipment_id": shipment_id,
        "route_id": route_id,
        "route_name": route_name,
        "route_data": json.dumps(route_data),
        "selected_at": datetime.utcnow(),
    })
    log_event(db, shipment_id, "ROUTE_SELECTED", f"Driver selected {route_name}", {"route_id": route_id, "route_name": route_name})
    db.commit()
    await broadcast({"type": "route_selected", "shipment_id": shipment_id, "route_id": route_id, "route_name": route_name})
    return {"success": True, "shipment_id": shipment_id, "route_id": route_id, "route_name": route_name}


@app.get("/api/v1/shipments/{shipment_id}/events")
async def shipment_events(shipment_id: str, db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    rows = db.execute(text("SELECT id, event_type, message, payload, created_at FROM dal_shipment_events WHERE shipment_id=:id ORDER BY created_at DESC"), {"id": shipment_id}).mappings().all()
    return [dict(row) for row in rows]


@app.get("/api/v1/shipments/{shipment_id}", response_model=ShipmentResponse)
async def get_shipment(shipment_id: str, db: Session = Depends(get_db)):
    shipment = db.query(Shipment).filter(Shipment.id == shipment_id).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return shipment


@app.get("/api/v1/shipments/")
async def list_shipments(db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    shipments = db.query(Shipment).all()
    result = []
    for shipment in shipments:
        assignment = get_assignment(db, shipment.id)
        status = get_operational_status(db, shipment.id, shipment.status)
        result.append({
            "id": shipment.id,
            "priority_level": enum_value(shipment.priority_level),
            "origin_lat": shipment.origin_lat,
            "origin_lon": shipment.origin_lon,
            "destination_lat": shipment.destination_lat,
            "destination_lon": shipment.destination_lon,
            "weight_kg": shipment.weight_kg,
            "category": shipment.category,
            "status": status,
            "created_at": shipment.created_at,
            "vehicle_id": assignment["vehicle_id"] if assignment else None,
            "assigned_vehicle_id": assignment["vehicle_id"] if assignment else None,
            "assignment": dict(assignment) if assignment else None,
            "driver_id": assignment.get("driver_id") if assignment else None,
            "driver_name": (
                get_driver(db, assignment.get("driver_id")).name
                if assignment and assignment.get("driver_id") and get_driver(db, assignment.get("driver_id"))
                else None
            ),
        })
    return result


@app.post("/api/v1/vehicles/create", response_model=VehicleResponse)
async def create_vehicle(vehicle: VehicleCreate, db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    db_vehicle = Vehicle(id=str(uuid.uuid4()), vehicle_number=vehicle.vehicle_number, capacity_kg=vehicle.capacity_kg, status=VehicleStatus.AVAILABLE)
    db.add(db_vehicle)
    db.commit()
    db.refresh(db_vehicle)
    return db_vehicle


@app.post("/api/v1/vehicles/{vehicle_id}/update-location")
async def update_vehicle_location(vehicle_id: str, location: dict, db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    lat = location.get("latitude")
    lon = location.get("longitude")
    speed = location.get("speed_kmh", 0)
    status = location.get("status", enum_value(vehicle.status))
    source = location.get("source", "gps")
    vehicle.current_lat = lat
    vehicle.current_lon = lon
    try:
        vehicle.status = status
    except Exception:
        pass
    db.execute(text("""
        INSERT INTO dal_vehicle_telemetry (vehicle_id, latitude, longitude, speed_kmh, status, source, updated_at)
        VALUES (:vehicle_id, :latitude, :longitude, :speed, :status, :source, :updated_at)
        ON CONFLICT (vehicle_id) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude, speed_kmh=excluded.speed_kmh, status=excluded.status, source=excluded.source, updated_at=excluded.updated_at
    """), {"vehicle_id": vehicle_id, "latitude": lat, "longitude": lon, "speed": speed, "status": status, "source": source, "updated_at": datetime.utcnow()})
    db.commit()
    event = {"type": "vehicle_gps", "vehicle_id": vehicle_id, "latitude": lat, "longitude": lon, "speed_kmh": speed, "status": status, "source": source, "timestamp": datetime.now(timezone.utc).isoformat()}
    await broadcast(event)
    return {"success": True, **event}


@app.get("/api/v1/vehicles/live")
async def live_vehicles(db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    vehicles = db.query(Vehicle).all()
    return {"success": True, "updated_at": datetime.now(timezone.utc).isoformat(), "vehicles": [serialize_vehicle(v, get_telemetry(db, v.id)) for v in vehicles]}


@app.get("/api/v1/vehicles/")
async def list_vehicles(db: Session = Depends(get_db)):
    return db.query(Vehicle).all()


@app.get("/api/v1/vehicles/{vehicle_id}", response_model=VehicleResponse)
async def get_vehicle(vehicle_id: str, db: Session = Depends(get_db)):
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return vehicle


@app.get("/api/v1/alerts/active")
async def active_alerts(db: Session = Depends(get_db)):
    ensure_smart_tables(db)
    rows = db.execute(text("""
        SELECT id, shipment_id, event_type, message, created_at
        FROM dal_shipment_events
        WHERE event_type IN ('REROUTE_REQUIRED','CRITICAL_RISK','VEHICLE_OFFLINE')
        ORDER BY created_at DESC LIMIT 50
    """)).mappings().all()
    return [dict(row) for row in rows]


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
