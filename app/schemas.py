from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ============================================================
# VEHICLE SCHEMAS
# ============================================================

class VehicleCreate(BaseModel):
    vehicle_number: str = Field(..., min_length=1, max_length=20)
    capacity_kg: int = Field(..., gt=0)


class VehicleResponse(BaseModel):
    id: str
    vehicle_number: str
    capacity_kg: int

    current_lat: Optional[float] = None
    current_lon: Optional[float] = None

    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class VehicleLocationUpdate(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)

    speed_kmh: Optional[float] = Field(
        default=None,
        ge=0,
        le=300,
    )

    status: str = "in_transit"


class VehicleTelemetryResponse(BaseModel):
    vehicle_id: str
    latitude: float
    longitude: float
    speed_kmh: Optional[float] = None
    status: Optional[str] = None
    recorded_at: datetime


# ============================================================
# DRIVER SCHEMAS
# ============================================================

class DriverCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=20)
    license_number: Optional[str] = Field(default=None, max_length=50)
    vehicle_id: str = Field(..., min_length=1)


class DriverResponse(BaseModel):
    id: str
    name: str
    phone: Optional[str] = None
    license_number: Optional[str] = None
    vehicle_id: Optional[str] = None
    vehicle_number: Optional[str] = None
    status: str = "available"
    created_at: datetime

    class Config:
        from_attributes = True


# ============================================================
# SHIPMENT SCHEMAS
# ============================================================

class ShipmentCreate(BaseModel):
    origin_lat: float = Field(..., ge=-90, le=90)
    origin_lon: float = Field(..., ge=-180, le=180)

    destination_lat: float = Field(..., ge=-90, le=90)
    destination_lon: float = Field(..., ge=-180, le=180)

    weight_kg: int = Field(..., gt=0)

    category: str = Field(
        ...,
        min_length=1,
        max_length=50,
    )

    urgency_level: Optional[str] = None


class ShipmentResponse(BaseModel):
    id: str

    priority_level: str
    category: str
    weight_kg: int
    status: str

    origin_lat: Optional[float] = None
    origin_lon: Optional[float] = None

    destination_lat: Optional[float] = None
    destination_lon: Optional[float] = None

    vehicle_id: Optional[str] = None
    assigned_vehicle_id: Optional[str] = None

    expected_delivery: Optional[datetime] = None
    actual_delivery: Optional[datetime] = None

    created_at: datetime

    class Config:
        from_attributes = True


# ============================================================
# ROUTE SCHEMAS
# ============================================================

class RouteOptimizeRequest(BaseModel):
    origin_lat: float = Field(..., ge=-90, le=90)
    origin_lon: float = Field(..., ge=-180, le=180)

    destination_lat: float = Field(..., ge=-90, le=90)
    destination_lon: float = Field(..., ge=-180, le=180)

    base_risk_score: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
    )

    weather_risk_score: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
    )

    shipment_priority: str = "normal"

    shipment_id: Optional[str] = None
    vehicle_id: Optional[str] = None


class RouteOption(BaseModel):
    route_id: str
    route_name: Optional[str] = None

    distance_km: Optional[float] = None
    estimated_time_minutes: Optional[float] = None

    risk_score: Optional[float] = None
    risk_level: Optional[str] = None

    accessibility_score: Optional[float] = None

    traffic_level: Optional[str] = None
    traffic_delay_minutes: Optional[float] = None
    traffic_available: Optional[bool] = None

    geometry_geojson: Optional[Dict[str, Any]] = None

    is_selected: bool = False


class RouteSelectionRequest(BaseModel):
    route_id: str = Field(..., min_length=1)
    route_name: Optional[str] = None


# ============================================================
# WEATHER / INTELLIGENCE SCHEMAS
# ============================================================

class WeatherRiskResponse(BaseModel):
    rainfall_mm: Optional[float] = None
    temperature_c: Optional[float] = None
    wind_speed_kmh: Optional[float] = None

    flood_risk_score: Optional[float] = None
    landslide_risk_score: Optional[float] = None

    weather_risk_score: Optional[float] = None

    weather_condition: Optional[str] = None
    weather_severity: Optional[str] = None

    reroute_recommended: Optional[bool] = None
    emergency_weather: Optional[bool] = None


class ShipmentIntelligenceResponse(BaseModel):
    success: bool

    shipment: Optional[Dict[str, Any]] = None
    assignment: Optional[Dict[str, Any]] = None
    vehicle: Optional[Dict[str, Any]] = None

    intelligence: Optional[Dict[str, Any]] = None

    selected_route: Optional[Dict[str, Any]] = None

    message: Optional[str] = None


# ============================================================
# ALERT SCHEMAS
# ============================================================

class AlertResponse(BaseModel):
    id: str

    alert_type: str
    severity: str
    message: str

    shipment_id: Optional[str] = None
    vehicle_id: Optional[str] = None

    is_acknowledged: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class AlertAcknowledgeRequest(BaseModel):
    acknowledged: bool = True


# ============================================================
# EVENT SCHEMAS
# ============================================================

class ShipmentEventResponse(BaseModel):
    id: str
    shipment_id: str

    event_type: str
    message: Optional[str] = None

    event_data: Optional[Any] = None

    created_at: datetime


# ============================================================
# LIVE CONTROL ROOM SCHEMA
# ============================================================

class LiveVehicle(BaseModel):
    id: str
    vehicle_number: str

    latitude: Optional[float] = None
    longitude: Optional[float] = None

    speed_kmh: Optional[float] = None
    status: str

    shipment_id: Optional[str] = None
    shipment_priority: Optional[str] = None

    last_updated: Optional[datetime] = None


class LiveControlRoomResponse(BaseModel):
    success: bool

    vehicles: List[Dict[str, Any]] = []
    shipments: List[Dict[str, Any]] = []
    alerts: List[Dict[str, Any]] = []

    summary: Dict[str, Any] = {}


# ============================================================
# GENERIC API RESPONSE
# ============================================================

class APIResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    data: Optional[Any] = None