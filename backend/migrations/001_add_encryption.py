"""
Migration: Add encryption fields and admin flagging.
Run: python3 migrations/001_add_encryption.py
"""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os


async def migrate():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ.get("DB_NAME", "clanchat")]

    # Add admin flagging fields to users collection
    print("Adding admin flagging fields to users...")
    result = await db.users.update_many(
        {},
        {
            "$set": {
                "admin_flagged": False,
                "admin_flag_reason": None,
                "admin_flag_type": None,
                "admin_flagged_at": None,
                "admin_flagged_by": None,
            }
        },
    )
    print(f"  Updated {result.modified_count} users")

    # Create indexes for faster lookups
    print("Creating indexes...")
    await db.users.create_index("admin_flagged")
    await db.dms.create_index([("from_id", 1), ("to_id", 1), ("created_at", -1)])
    await db.audit_events.create_index([("event", 1), ("at", -1)])
    print("  ✓ Indexes created")

    client.close()
    print("✓ Migration complete")


if __name__ == "__main__":
    asyncio.run(migrate())
