"""
ClanChat data migration → Supabase Storage.

WHAT THIS DOES
--------------
Walks every Mongo collection that references a media path and moves the
underlying bytes from the current backend `/api/files/...` endpoint to
Supabase Storage. The path stored in Mongo is rewritten to the Supabase
public URL so all existing render code (`fileUrl(path)`) works unchanged.

Collections touched:
  users.avatar_path              (single string)
  posts.media                    (array of strings)
  dms.media_paths                (array of strings)
  wall_notes.media_paths         (array of strings)

HOW TO RUN
----------
  1) Make sure the backend is running and reachable.
  2) Storage bucket must exist in Supabase (created + public-read).
  3) `cd /app/backend && python migrate_storage_to_supabase.py [--dry-run]`

IDEMPOTENT — a media path that already starts with `https://` (i.e. any
already-hosted URL) is treated as migrated and skipped.

SAFETY — nothing is deleted from the legacy storage. Migration audit log
in `media_migration_log` collection.
"""
from __future__ import annotations

import asyncio
import argparse
import logging
import mimetypes
import os
import sys
import uuid
from datetime import datetime, timezone

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

from supabase_helpers import upload_bytes  # noqa: E402

LOG = logging.getLogger("migrate")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
BACKEND = os.environ.get("FRONTEND_URL") or "http://localhost:8001"

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]


async def download(path: str) -> tuple[bytes, str]:
    """Fetch an old media file from the running backend."""
    url = f"{BACKEND.rstrip('/')}/api/files/{path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=60.0) as c:
        r = await c.get(url)
        r.raise_for_status()
        ct = r.headers.get("Content-Type") or mimetypes.guess_type(path)[0] or "application/octet-stream"
        return r.content, ct


def build_target_path(user_id: str, scope: str, original_filename: str) -> str:
    safe = original_filename.rsplit("/", 1)[-1][:80]
    return f"u/{user_id}/{scope}/{uuid.uuid4().hex[:10]}_{safe}"


async def migrate_field(coll_name: str, id_field: str, field: str, is_array: bool, scope: str, dry_run: bool):
    coll = db[coll_name]
    total_docs = await coll.count_documents({field: {"$exists": True, "$ne": None}})
    LOG.info("Scanning %d %s docs for %s...", total_docs, coll_name, field)
    scanned = migrated = skipped_https = errors = 0
    async for doc in coll.find({field: {"$exists": True, "$ne": None}}):
        scanned += 1
        user_id = doc.get("author_id") or doc.get("owner_id") or doc.get("user_id") or doc.get("from_id") or "unknown"
        original = doc.get(field)
        if not original:
            continue
        if is_array:
            new_paths = []
            changed = False
            for p in original:
                if not p or (isinstance(p, str) and p.startswith("http")):
                    new_paths.append(p)
                    if p and isinstance(p, str) and p.startswith("http"):
                        skipped_https += 1
                    continue
                try:
                    data, ct = await download(p)
                    if dry_run:
                        LOG.info("  DRY: would migrate %s (%d bytes, %s)", p, len(data), ct)
                        new_paths.append(p)
                    else:
                        target = build_target_path(user_id, scope, os.path.basename(p))
                        url = upload_bytes(target, data, ct)
                        new_paths.append(url)
                        await db.media_migration_log.insert_one({
                            "collection": coll_name, "doc_id": doc.get(id_field),
                            "field": field, "old_path": p, "new_url": url,
                            "provider": "supabase",
                            "at": datetime.now(timezone.utc).isoformat(),
                        })
                        migrated += 1
                        changed = True
                except Exception as e:
                    LOG.warning("  ERR migrating %s: %s", p, e)
                    errors += 1
                    new_paths.append(p)
            if changed and not dry_run:
                await coll.update_one({id_field: doc[id_field]}, {"$set": {field: new_paths}})
        else:
            p = original
            if isinstance(p, str) and p.startswith("http"):
                skipped_https += 1
                continue
            try:
                data, ct = await download(p)
                if dry_run:
                    LOG.info("  DRY: would migrate %s (%d bytes, %s)", p, len(data), ct)
                else:
                    target = build_target_path(user_id, scope, os.path.basename(p))
                    url = upload_bytes(target, data, ct)
                    await coll.update_one({id_field: doc[id_field]}, {"$set": {field: url}})
                    await db.media_migration_log.insert_one({
                        "collection": coll_name, "doc_id": doc.get(id_field),
                        "field": field, "old_path": p, "new_url": url,
                        "provider": "supabase",
                        "at": datetime.now(timezone.utc).isoformat(),
                    })
                    migrated += 1
            except Exception as e:
                LOG.warning("  ERR migrating %s: %s", p, e)
                errors += 1
    LOG.info("  %s.%s: scanned=%d migrated=%d skipped(already https)=%d errors=%d",
             coll_name, field, scanned, migrated, skipped_https, errors)


async def main(dry_run: bool):
    LOG.info("=== ClanChat media migration → Supabase Storage%s ===",
             "  [DRY RUN]" if dry_run else "")
    await migrate_field("users",      "user_id",   "avatar_path",  False, "avatar", dry_run)
    await migrate_field("posts",      "post_id",   "media",        True,  "post",   dry_run)
    await migrate_field("dms",        "message_id","media_paths",  True,  "dm",     dry_run)
    await migrate_field("wall_notes", "note_id",   "media_paths",  True,  "wall",   dry_run)
    LOG.info("=== done ===")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = ap.parse_args()
    asyncio.run(main(args.dry_run))
