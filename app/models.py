from datetime import datetime
import enum
import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Index,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

from geoalchemy2 import Geometry


# ============================================================
# BASE
# ============================================================

Base = declarative_base()


# ============================================================
# ENUMS
# ============================================================

class VehicleStatus(str, enum.Enum):
    AVAILABLE = "available"
    IN_TRANSIT = "in_transit"
    IDLE = "idle"


class ShipmentStatus(str, enum.Enum):
    PENDING = "pending"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    DELAYED = "delayed"


class PriorityLevel(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AlertSeverity(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class RoadBlockSeverity(str, enum.Enum):
    MINOR = "minor"
    MODERATE = "moderate"
    SEVERE = "severe"
    IMPASSABLE = "impassable"


# ============================================================
# VEHICLES
# ============================================================

class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    vehicle_number = Column(
        String(20),
        unique=True,
        nullable=False,
        index=True,
    )

    capacity_kg = Column(
        Integer,
        nullable=False,
    )

    current_lat = Column(
        Float,
        nullable=True,
    )

    current_lon = Column(
        Float,
        nullable=True,
    )

    status = Column(
        Enum(VehicleStatus),
        default=VehicleStatus.AVAILABLE,
        nullable=False,
        index=True,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # --------------------------------------------------------
    # Relationships
    # --------------------------------------------------------

    shipments = relationship(
        "Shipment",
        back_populates="vehicle",
    )

    alerts = relationship(
        "Alert",
        back_populates="vehicle",
    )

    telemetry = relationship(
        "VehicleTelemetry",
        back_populates="vehicle",
        cascade="all, delete-orphan",
    )


# ============================================================
# SHIPMENTS
# ============================================================

class Shipment(Base):
    __tablename__ = "shipments"

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    vehicle_id = Column(
        String(36),
        ForeignKey("vehicles.id"),
        nullable=True,
        index=True,
    )

    priority_level = Column(
        Enum(PriorityLevel),
        nullable=False,
        index=True,
    )

    origin_lat = Column(
        Float,
        nullable=False,
    )

    origin_lon = Column(
        Float,
        nullable=False,
    )

    destination_lat = Column(
        Float,
        nullable=False,
    )

    destination_lon = Column(
        Float,
        nullable=False,
    )

    weight_kg = Column(
        Integer,
        nullable=False,
    )

    category = Column(
        String(50),
        nullable=False,
        index=True,
    )

    status = Column(
        Enum(ShipmentStatus),
        default=ShipmentStatus.PENDING,
        nullable=False,
        index=True,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    expected_delivery = Column(
        DateTime,
        nullable=True,
    )

    actual_delivery = Column(
        DateTime,
        nullable=True,
    )

    # --------------------------------------------------------
    # Relationships
    # --------------------------------------------------------

    vehicle = relationship(
        "Vehicle",
        back_populates="shipments",
    )

    alerts = relationship(
        "Alert",
        back_populates="shipment",
    )

    routes = relationship(
        "Route",
        back_populates="shipment",
        cascade="all, delete-orphan",
    )

    events = relationship(
        "ShipmentEvent",
        back_populates="shipment",
        cascade="all, delete-orphan",
    )


# ============================================================
# ROUTES
# ============================================================

class Route(Base):
    __tablename__ = "routes"

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    shipment_id = Column(
        String(36),
        ForeignKey("shipments.id"),
        nullable=True,
        index=True,
    )

    waypoints = Column(
        Geometry(
            "LINESTRING",
            srid=4326,
        ),
        nullable=False,
    )

    distance_km = Column(
        Float,
        nullable=False,
    )

    estimated_time_minutes = Column(
        Integer,
        nullable=False,
    )

    disruption_risk_score = Column(
        Float,
        default=0.0,
    )

    is_alternate = Column(
        Boolean,
        default=False,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    shipment = relationship(
        "Shipment",
        back_populates="routes",
    )


# ============================================================
# WEATHER DATA
# ============================================================

class WeatherData(Base):
    __tablename__ = "weather_data"

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    location = Column(
        Geometry(
            "POINT",
            srid=4326,
        ),
        nullable=False,
    )

    rainfall_mm = Column(
        Float,
        nullable=True,
    )

    temperature_c = Column(
        Float,
        nullable=True,
    )

    wind_speed_kmh = Column(
        Float,
        nullable=True,
    )

    flood_risk_score = Column(
        Float,
        default=0.0,
    )

    landslide_risk_score = Column(
        Float,
        default=0.0,
    )

    weather_risk_score = Column(
        Float,
        default=0.0,
    )

    weather_condition = Column(
        String(50),
        nullable=True,
    )

    recorded_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True,
    )


# ============================================================
# ALERTS
# ============================================================

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    shipment_id = Column(
        String(36),
        ForeignKey("shipments.id"),
        nullable=True,
        index=True,
    )

    vehicle_id = Column(
        String(36),
        ForeignKey("vehicles.id"),
        nullable=True,
        index=True,
    )

    alert_type = Column(
        String(50),
        nullable=False,
    )

    severity = Column(
        Enum(AlertSeverity),
        nullable=False,
        index=True,
    )

    message = Column(
        Text,
        nullable=False,
    )

    is_acknowledged = Column(
        Boolean,
        default=False,
        nullable=False,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True,
    )

    shipment = relationship(
        "Shipment",
        back_populates="alerts",
    )

    vehicle = relationship(
        "Vehicle",
        back_populates="alerts",
    )


# ============================================================
# ROAD BLOCKS
# ============================================================

class RoadBlock(Base):
    __tablename__ = "road_blocks"

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    location = Column(
        Geometry(
            "POINT",
            srid=4326,
        ),
        nullable=False,
    )

    description = Column(
        Text,
        nullable=False,
    )

    severity = Column(
        Enum(RoadBlockSeverity),
        nullable=False,
        index=True,
    )

    reported_by = Column(
        String(50),
        nullable=False,
    )

    confirmed = Column(
        Boolean,
        default=False,
        nullable=False,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    cleared_at = Column(
        DateTime,
        nullable=True,
    )


# ============================================================
# VEHICLE TELEMETRY
# ============================================================

class VehicleTelemetry(Base):
    """
    Stores the live GPS/telemetry history of vehicles.

    Driver app sends location updates here through the
    existing vehicle location endpoint.
    """

    __tablename__ = "vehicle_telemetry"

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    vehicle_id = Column(
        String(36),
        ForeignKey("vehicles.id"),
        nullable=False,
        index=True,
    )

    latitude = Column(
        Float,
        nullable=False,
    )

    longitude = Column(
        Float,
        nullable=False,
    )

    speed_kmh = Column(
        Float,
        nullable=True,
    )

    status = Column(
        String(30),
        nullable=True,
    )

    recorded_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True,
    )

    vehicle = relationship(
        "Vehicle",
        back_populates="telemetry",
    )


# ============================================================
# DRIVERS
# ============================================================

class Driver(Base):
    """
    Driver identity and availability.

    A driver can be linked to one vehicle.
    The driver app uses this identity when accepting
    and operating a shipment.
    """

    __tablename__ = "drivers"

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    name = Column(
        String(100),
        nullable=False,
    )

    phone = Column(
        String(20),
        nullable=True,
    )

    license_number = Column(
        String(50),
        unique=True,
        nullable=True,
    )

    vehicle_id = Column(
        String(36),
        ForeignKey("vehicles.id"),
        nullable=True,
        index=True,
    )

    status = Column(
        String(30),
        default="available",
        nullable=False,
        index=True,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    vehicle = relationship(
        "Vehicle",
        backref="driver",
    )

# ============================================================
# SHIPMENT EVENTS
# ============================================================

class ShipmentEvent(Base):
    """
    Timeline of important shipment operations.

    Examples:
        ASSIGNED
        ROUTE_SELECTED
        REROUTED
        GPS_UPDATE
        DELIVERED
        CANCELLED
        ALERT
    """

    __tablename__ = "shipment_events"

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    shipment_id = Column(
        String(36),
        ForeignKey("shipments.id"),
        nullable=False,
        index=True,
    )

    event_type = Column(
        String(50),
        nullable=False,
        index=True,
    )

    message = Column(
        Text,
        nullable=True,
    )

    event_data = Column(
        Text,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True,
    )

    shipment = relationship(
        "Shipment",
        back_populates="events",
    )


# ============================================================
# INDEXES
# ============================================================

Index(
    "idx_vehicle_location",
    Vehicle.current_lat,
    Vehicle.current_lon,
)

Index(
    "idx_shipment_status_priority",
    Shipment.status,
    Shipment.priority_level,
)

Index(
    "idx_telemetry_vehicle_time",
    VehicleTelemetry.vehicle_id,
    VehicleTelemetry.recorded_at,
)

Index(
    "idx_events_shipment_time",
    ShipmentEvent.shipment_id,
    ShipmentEvent.created_at,
)