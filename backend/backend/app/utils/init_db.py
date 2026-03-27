"""
Database initialization script
Creates tables and loads sample OEM schedule data
"""

from sqlalchemy import create_engine
from app.models.models import Base, OEMSchedule
from app.utils.database import SessionLocal
import os

def init_database():
    """Initialize database with tables and sample data"""
    
    print("Initializing database...")
    
    # Create all tables
    from app.utils.database import engine
    Base.metadata.create_all(bind=engine)
    print("✓ Tables created")
    
    # Load sample OEM schedules
    db = SessionLocal()
    
    try:
        # Check if we already have data
        existing = db.query(OEMSchedule).count()
        if existing > 0:
            print(f"✓ Database already has {existing} OEM schedule entries")
            return
        
        print("Loading sample OEM schedules...")
        
        # Sample OEM schedules for common vehicles
        sample_schedules = [
            # Toyota Camry 2018-2023
            {
                "year": 2020, "make": "Toyota", "model": "Camry",
                "service_type": "Oil Change",
                "interval_miles": 10000, "interval_months": 12,
                "citation": "2020 Toyota Camry Owner's Manual, p. 468"
            },
            {
                "year": 2020, "make": "Toyota", "model": "Camry",
                "service_type": "Tire Rotation",
                "interval_miles": 5000, "interval_months": 6,
                "citation": "2020 Toyota Camry Owner's Manual, p. 468"
            },
            {
                "year": 2020, "make": "Toyota", "model": "Camry",
                "service_type": "Air Filter Replacement",
                "interval_miles": 30000, "interval_months": 36,
                "citation": "2020 Toyota Camry Owner's Manual, p. 469"
            },
            {
                "year": 2020, "make": "Toyota", "model": "Camry",
                "service_type": "Cabin Air Filter Replacement",
                "interval_miles": 20000, "interval_months": 24,
                "citation": "2020 Toyota Camry Owner's Manual, p. 469"
            },
            {
                "year": 2020, "make": "Toyota", "model": "Camry",
                "service_type": "Transmission Fluid Change",
                "interval_miles": 60000, "interval_months": None,
                "citation": "2020 Toyota Camry Owner's Manual, p. 470",
                "notes": "Severe driving conditions only"
            },
            {
                "year": 2020, "make": "Toyota", "model": "Camry",
                "service_type": "Brake Fluid Change",
                "interval_miles": None, "interval_months": 24,
                "citation": "2020 Toyota Camry Owner's Manual, p. 470"
            },
            
            # Honda Accord 2018-2023
            {
                "year": 2020, "make": "Honda", "model": "Accord",
                "service_type": "Oil Change",
                "interval_miles": 7500, "interval_months": 12,
                "citation": "2020 Honda Accord Owner's Manual, p. 523"
            },
            {
                "year": 2020, "make": "Honda", "model": "Accord",
                "service_type": "Tire Rotation",
                "interval_miles": 7500, "interval_months": 12,
                "citation": "2020 Honda Accord Owner's Manual, p. 523"
            },
            {
                "year": 2020, "make": "Honda", "model": "Accord",
                "service_type": "Air Filter Replacement",
                "interval_miles": 30000, "interval_months": None,
                "citation": "2020 Honda Accord Owner's Manual, p. 524"
            },
            {
                "year": 2020, "make": "Honda", "model": "Accord",
                "service_type": "Transmission Fluid Change",
                "interval_miles": 90000, "interval_months": None,
                "citation": "2020 Honda Accord Owner's Manual, p. 525"
            },
            
            # Ford F-150 2018-2023
            {
                "year": 2020, "make": "Ford", "model": "F-150",
                "service_type": "Oil Change",
                "interval_miles": 10000, "interval_months": 12,
                "citation": "2020 Ford F-150 Owner's Manual, p. 612"
            },
            {
                "year": 2020, "make": "Ford", "model": "F-150",
                "service_type": "Tire Rotation",
                "interval_miles": 10000, "interval_months": 12,
                "citation": "2020 Ford F-150 Owner's Manual, p. 612"
            },
            {
                "year": 2020, "make": "Ford", "model": "F-150",
                "service_type": "Air Filter Replacement",
                "interval_miles": 30000, "interval_months": None,
                "citation": "2020 Ford F-150 Owner's Manual, p. 613"
            },
        ]
        
        # Insert sample schedules
        for schedule_data in sample_schedules:
            schedule = OEMSchedule(**schedule_data)
            db.add(schedule)
        
        db.commit()
        print(f"✓ Loaded {len(sample_schedules)} OEM schedule entries")
        
        # Print summary
        print("\n✓ Database initialization complete!")
        print(f"  - Vehicles supported: Toyota Camry, Honda Accord, Ford F-150 (2020)")
        print(f"  - OEM schedule entries: {len(sample_schedules)}")
        
    except Exception as e:
        print(f"✗ Error loading sample data: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    init_database()
