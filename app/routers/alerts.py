from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Alert, AlertSeverity


router = APIRouter()


# ============================================================
# HELPERS
# ============================================================

def normalize_severity(value: Optional[str]) -> AlertSeverity:
    """Convert incoming severity text into AlertSeverity."""

    severity = str(value or "high").strip().lower()

    mapping = {
        "low": AlertSeverity.LOW,
        "medium": AlertSeverity.MEDIUM,
        "moderate": AlertSeverity.MEDIUM,
        "high": AlertSeverity.HIGH,
        "critical": AlertSeverity.CRITICAL,
        "severe": AlertSeverity.CRITICAL,
    }

    return mapping.get(
        severity,
        AlertSeverity.HIGH,
    )


def serialize_alert(alert: Alert) -> dict:
    """Convert database alert into API response."""

    severity = (
        alert.severity.value
        if hasattr(alert.severity, "value")
        else str(alert.severity)
    )

    return {
        "id": alert.id,
        "shipment_id": alert.shipment_id,
        "vehicle_id": alert.vehicle_id,
        "alert_type": alert.alert_type,
        "severity": severity,
        "message": alert.message,
        "is_acknowledged": alert.is_acknowledged,
        "created_at": alert.created_at,
    }


# ============================================================
# CREATE ALERT
# ============================================================

@router.post("/create")
async def create_alert(
    alert_data: dict,
    db: Session = Depends(get_db)
):
    """
    Create and persist a logistics alert.

    Alerts can belong to either a shipment, vehicle,
    or the overall logistics system.
    """

    if not isinstance(alert_data, dict):
        raise HTTPException(
            status_code=400,
            detail="Alert data must be an object",
        )

    alert_type = str(
        alert_data.get(
            "alert_type",
            "route_disruption",
        )
    ).strip()

    message = str(
        alert_data.get(
            "message",
            "Route disruption detected",
        )
    ).strip()

    if not alert_type:
        alert_type = "route_disruption"

    if not message:
        message = "Route disruption detected"

    severity = normalize_severity(
        alert_data.get("severity")
    )

    shipment_id = alert_data.get("shipment_id")
    vehicle_id = alert_data.get("vehicle_id")

    alert = Alert(
        shipment_id=shipment_id,
        vehicle_id=vehicle_id,
        alert_type=alert_type,
        severity=severity,
        message=message,
        is_acknowledged=False,
        created_at=datetime.utcnow(),
    )

    try:
        db.add(alert)
        db.commit()
        db.refresh(alert)

        return {
            "success": True,
            "message": "Alert created successfully",
            "alert": serialize_alert(alert),
        }

    except Exception as exc:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Failed to create alert: {exc}",
        )


# ============================================================
# ACTIVE ALERTS
# ============================================================

@router.get("/active")
async def get_active_alerts(
    db: Session = Depends(get_db)
):
    """
    Return all currently active/unacknowledged alerts.
    """

    try:
        alerts = (
            db.query(Alert)
            .filter(
                Alert.is_acknowledged == False
            )
            .order_by(
                Alert.created_at.desc()
            )
            .all()
        )

        return {
            "success": True,
            "count": len(alerts),
            "alerts": [
                serialize_alert(alert)
                for alert in alerts
            ],
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load alerts: {exc}",
        )


# ============================================================
# ALL ALERTS
# ============================================================

@router.get("/all")
async def get_all_alerts(
    db: Session = Depends(get_db)
):
    """Return alert history."""

    try:
        alerts = (
            db.query(Alert)
            .order_by(
                Alert.created_at.desc()
            )
            .all()
        )

        return {
            "success": True,
            "count": len(alerts),
            "alerts": [
                serialize_alert(alert)
                for alert in alerts
            ],
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load alert history: {exc}",
        )


# ============================================================
# ACKNOWLEDGE ALERT
# ============================================================

@router.post("/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: str,
    db: Session = Depends(get_db)
):
    """Acknowledge an active alert."""

    alert = (
        db.query(Alert)
        .filter(Alert.id == alert_id)
        .first()
    )

    if not alert:
        raise HTTPException(
            status_code=404,
            detail="Alert not found",
        )

    alert.is_acknowledged = True

    try:
        db.commit()
        db.refresh(alert)

        return {
            "success": True,
            "message": "Alert acknowledged",
            "alert": serialize_alert(alert),
        }

    except Exception as exc:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Failed to acknowledge alert: {exc}",
        )