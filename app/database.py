
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker

from app.models import Base


# ============================================================
# DATABASE CONFIGURATION
# ============================================================

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:password@db:5432/dal_logistics"
)


# ============================================================
# DATABASE ENGINE
# ============================================================

engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=20,
    max_overflow=40,
    future=True,
)


# ============================================================
# SESSION
# ============================================================

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


# ============================================================
# OPERATIONAL TABLES
# ============================================================

def create_operational_tables(connection):
    """
    Create DAL operational tables that are used directly by
    main.py for assignments, telemetry, events, state, routes,
    and route snapshots.
    """

    tables = [

        # --------------------------------------------------------
        # VEHICLE ASSIGNMENTS
        # --------------------------------------------------------
        """
        CREATE TABLE IF NOT EXISTS dal_vehicle_assignment (
            shipment_id VARCHAR(100) PRIMARY KEY,
            vehicle_id VARCHAR(100) NOT NULL,
            driver_id VARCHAR(100) NULL,
            assigned_at TIMESTAMP NOT NULL,
            unassigned_at TIMESTAMP NULL
        )
        """,

        # --------------------------------------------------------
        # VEHICLE TELEMETRY
        # --------------------------------------------------------
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

        # --------------------------------------------------------
        # SHIPMENT EVENTS
        # --------------------------------------------------------
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

        # --------------------------------------------------------
        # SHIPMENT STATE
        # --------------------------------------------------------
        """
        CREATE TABLE IF NOT EXISTS dal_shipment_state (
            shipment_id VARCHAR(100) PRIMARY KEY,
            status VARCHAR(50) NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
        """,

        # --------------------------------------------------------
        # SELECTED ROUTES
        # --------------------------------------------------------
        """
        CREATE TABLE IF NOT EXISTS dal_selected_routes (
            shipment_id VARCHAR(100) PRIMARY KEY,
            route_id VARCHAR(100) NULL,
            route_name VARCHAR(255) NULL,
            route_data TEXT NULL,
            selected_at TIMESTAMP NOT NULL
        )
        """,

        # --------------------------------------------------------
        # ROUTE SNAPSHOTS
        # --------------------------------------------------------
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

    for sql_statement in tables:
        connection.execute(text(sql_statement))

    # ------------------------------------------------------------
    # BACKWARD-COMPATIBILITY MIGRATION
    # ------------------------------------------------------------

    connection.execute(text("""
        ALTER TABLE dal_vehicle_assignment
        ADD COLUMN IF NOT EXISTS driver_id VARCHAR(100) NULL
    """))

    # ------------------------------------------------------------
    # INDEXES
    # ------------------------------------------------------------

    connection.execute(text("""
        CREATE INDEX IF NOT EXISTS
        idx_dal_vehicle_assignment_vehicle_active
        ON dal_vehicle_assignment(vehicle_id, unassigned_at)
    """))

    connection.execute(text("""
        CREATE INDEX IF NOT EXISTS
        idx_dal_vehicle_assignment_driver_active
        ON dal_vehicle_assignment(driver_id, unassigned_at)
    """))

    connection.execute(text("""
        CREATE INDEX IF NOT EXISTS
        idx_dal_shipment_events_shipment
        ON dal_shipment_events(shipment_id, created_at)
    """))

    connection.execute(text("""
        CREATE INDEX IF NOT EXISTS
        idx_dal_vehicle_telemetry_updated
        ON dal_vehicle_telemetry(updated_at)
    """))


# ============================================================
# DATABASE INITIALIZATION
# ============================================================

def init_db():
    """
    Initialize the complete DAL database.

    This creates:
      1. PostGIS extension
      2. SQLAlchemy ORM tables
      3. DAL operational tables
      4. Required indexes

    Existing tables/data are preserved.
    """

    try:

        with engine.begin() as connection:

            # ----------------------------------------------------
            # POSTGIS
            # ----------------------------------------------------

            if engine.dialect.name == "postgresql":
                connection.execute(
                    text("CREATE EXTENSION IF NOT EXISTS postgis")
                )

                print("✓ PostGIS ready")

            # ----------------------------------------------------
            # SQLALCHEMY TABLES
            # ----------------------------------------------------

            Base.metadata.create_all(bind=connection)

            print("✓ SQLAlchemy tables ready")

            # ----------------------------------------------------
            # DAL OPERATIONAL TABLES
            # ----------------------------------------------------

            create_operational_tables(connection)

            print("✓ DAL operational tables ready")

            # ----------------------------------------------------
            # VERIFY REQUIRED TABLES
            # ----------------------------------------------------

            inspector = inspect(connection)

            required_tables = [
                "dal_vehicle_assignment",
                "dal_vehicle_telemetry",
                "dal_shipment_events",
                "dal_shipment_state",
                "dal_selected_routes",
                "dal_route_snapshots",
            ]

            missing_tables = [
                table
                for table in required_tables
                if not inspector.has_table(table)
            ]

            if missing_tables:
                raise RuntimeError(
                    "Required DAL tables were not created: "
                    + ", ".join(missing_tables)
                )

        print("✓ Database initialized successfully")

    except Exception as exc:
        print(f"✗ Database initialization failed: {exc}")
        raise


# ============================================================
# DATABASE HEALTH CHECK
# ============================================================

def check_database_connection() -> bool:
    """
    Check whether the database is reachable.
    """

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        return True

    except Exception as exc:
        print(f"✗ Database connection failed: {exc}")
        return False


# ============================================================
# DATABASE DEPENDENCY
# ============================================================

def get_db():
    """
    FastAPI dependency for obtaining a database session.

    The session is always closed after the request.
    """

    db = SessionLocal()

    try:
        yield db

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


# ============================================================
# DATABASE SHUTDOWN
# ============================================================

def close_database():
    """
    Dispose database connection pool cleanly.
    """

    try:
        engine.dispose()
        print("✓ Database connections closed")

    except Exception as exc:
        print(f"Database shutdown warning: {exc}")

