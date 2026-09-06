import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models import Base


load_dotenv()


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:password@db:5432/dal_logistics",
)


engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=20,
    max_overflow=40,
    future=True,
)


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


def init_db():
    try:
        # Enable PostGIS before creating tables that use Geometry columns.
        with engine.begin() as connection:
            if engine.dialect.name == "postgresql":
                connection.execute(
                    text("CREATE EXTENSION IF NOT EXISTS postgis")
                )

        # Create all application tables.
        Base.metadata.create_all(bind=engine)

        print("✓ Database initialized successfully")

    except Exception as exc:
        print(f"✗ Database initialization failed: {exc}")
        raise


def check_database_connection() -> bool:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        return True

    except Exception as exc:
        print(f"✗ Database connection failed: {exc}")
        return False


def get_db():
    db = SessionLocal()

    try:
        yield db

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


def close_database():
    try:
        engine.dispose()
        print("✓ Database connections closed")

    except Exception as exc:
        print(f"Database shutdown warning: {exc}")