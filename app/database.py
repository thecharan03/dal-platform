import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
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
# DATABASE INITIALIZATION
# ============================================================

def init_db():
    """
    Initialize all SQLAlchemy tables.

    Existing tables are preserved.
    Missing tables are created automatically.
    """

    try:
        Base.metadata.create_all(bind=engine)

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