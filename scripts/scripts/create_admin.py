#!/usr/bin/env python3
"""
scripts/create_admin.py

Creates a MaintenanceGuard admin account with email and password only.
No TOTP setup required — the admin can log in directly via the console.

Usage (from project root inside Docker):
    docker exec -it <backend_container> python scripts/create_admin.py

Custom credentials:
    docker exec -it <backend_container> python scripts/create_admin.py \
        --email anilvasudev2021@gmail.com \
        --password "MGuard_Admin@2026!"
"""

import argparse
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app.utils.database import SessionLocal, engine, Base
from app.models import models, admin_models  # noqa: F401
from app.models.admin_models import Admin
from app.utils.admin_auth import hash_password


def create_admin(email: str, password: str, role: str = "super_admin") -> None:
    Base.metadata.create_all(bind=engine)

    if len(password) < 8:
        print("ERROR: Password must be at least 8 characters.")
        sys.exit(1)

    db = SessionLocal()
    try:
        existing = db.query(Admin).filter(Admin.email == email).first()
        if existing:
            print(f"\n⚠️  Admin already exists: {email} (ID #{existing.id})")
            print("    Use the Admin Console to update credentials.\n")
            return

        admin = Admin(
            email=email,
            password_hash=hash_password(password),
            role=role,
            totp_secret=None,   # No TOTP — login uses password only
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

        print()
        print("=" * 50)
        print("  Admin account created successfully")
        print("=" * 50)
        print(f"  ID       : #{admin.id}")
        print(f"  Email    : {admin.email}")
        print(f"  Password : {password}")
        print(f"  Role     : {admin.role}")
        print()
        print("  Login at: http://localhost:5173/index-admin.html")
        print("=" * 50)
        print()

    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a MaintenanceGuard admin account")
    parser.add_argument("--email",    default="anilvasudev2021@gmail.com")
    parser.add_argument("--password", default="Admin@12345!")
    parser.add_argument("--role",     default="super_admin",
                        choices=["super_admin", "support_admin"])
    args = parser.parse_args()

    create_admin(args.email, args.password, args.role)
