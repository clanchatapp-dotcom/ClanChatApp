"""
MODIFICATIONS TO APPLY TO backend/server.py

This file contains all the code changes needed to fix the 7 bugs plus:
- Encrypted DMs with admin flagging
- Message notifications (in-app + push)
- Activity feed
- Fix auto-logout issue
- Remove Emergent branding

APPLY THESE CHANGES TO server.py IN THE ORDER SHOWN.
"""

# ============================================================================
# 1. ADD IMPORTS AT TOP OF FILE
# ============================================================================

# Add after existing imports:
from crypto import encrypt_message, decrypt_message
import json
from datetime import datetime, timedelta
from typing import Optional, List

# ============================================================================
# 2. ADD CONSTANTS SECTION
# ============================================================================

# Add after JWT_SECRET definition:
TOKEN_EXPIRY_MINUTES = 1440  # 24 hours
REFRESH_TOKEN_EXPIRY_DAYS = 30
SESSION_CHECK_INTERVAL = 15  # minutes, check if session still valid

# Remove Emergent references:
# DELETE: EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
# DELETE: STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
# DELETE: EMERGENT_AUTH_SESSION_DATA_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

# ============================================================================
# 3. UPDATE TOKEN EXPIRY (FIX AUTO-LOGOUT ISSUE)
# ============================================================================

# REPLACE create_access_token function:
def create_access_token(user_id: str) -> str:
    """Create JWT access token with proper expiry (24 hours, not instant expiry)."""
    expire = datetime.utcnow() + timedelta(minutes=TOKEN_EXPIRY_MINUTES)
    to_encode = {"sub": user_id, "exp": expire}
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt


def create_refresh_token(user_id: str) -> str:
    """Create refresh token (valid for 30 days)."""
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRY_DAYS)
    to_encode = {"sub": user_id, "exp": expire, "type": "refresh"}
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt

# ============================================================================
# 4. ADD NOTIFICATION HELPER FUNCTIONS
# ============================================================================

async def notify_message_sent(from_user: dict, to_user: dict, message_id: str, content: str):
    """
    Send notification that message was sent.
    - In-app: Store notification in DB
    - Push: Send via FCM (Firebase Cloud Messaging)
    """
    if to_user[\"user_id\"] == from_user[\"user_id\"]:
        # Skip self-notifications
        return
    
    # In-app notification
    notif = {
        \"notification_id\": f\"notif_{uuid.uuid4().hex[:12]}\",
        \"user_id\": to_user[\"user_id\"],
        \"type\": \"new_message\",
        \"from_user_id\": from_user[\"user_id\"],
        \"from_handle\": from_user[\"handle\"],
        \"from_avatar\": from_user.get(\"avatar_path\"),
        \"message_id\": message_id,
        \"preview\": content[:50] if content else \"[media]\",
        \"read\": False,
        \"created_at\": now_iso(),
    }
    await db.notifications.insert_one(notif)
    
    # Push notification (if user has FCM token)
    fcm_token = to_user.get(\"fcm_token\")
    if fcm_token:
        await send_push_notification(
            fcm_token=fcm_token,
            title=f\"Message from @{from_user['handle']}\",
            body=content[:100] if content else \"📸 Photo\",
            data={
                \"notification_id\": notif[\"notification_id\"],
                \"type\": \"new_message\",
                \"message_id\": message_id,
            },
        )


async def send_push_notification(fcm_token: str, title: str, body: str, data: dict = None):
    \"\"\"
    Send FCM push notification.
    Requires Firebase Admin SDK setup.
    For MVP: log and defer to frontend polling.
    \"\"\"
    try:
        # TODO: Integrate Firebase Admin SDK
        # import firebase_admin
        # from firebase_admin import messaging
        # message = messaging.Message(
        #     notification=messaging.Notification(title=title, body=body),
        #     data=data or {},
        #     token=fcm_token,
        # )
        # messaging.send(message)
        
        # For now, log it
        print(f\"[PUSH] {title}: {body}\")
    except Exception as e:
        print(f\"Push notification failed: {e}\")


# ============================================================================
# 5. ADD ACTIVITY FEED ENDPOINTS
# ============================================================================

@api.get(\"/activity/feed\")
async def get_activity_feed(user=Depends(get_current_user), limit: int = 50):
    \"\"\"
    Get activity feed: posts from followed users, new followers, likes, etc.
    Timeline of events user cares about.
    \"\"\"
    user_id = user[\"user_id\"]
    
    # Get list of people user follows
    following = []
    cursor = db.follows.find({\"follower_id\": user_id}, {\"_id\": 0})
    async for f in cursor:
        following.append(f[\"following_id\"])
    
    # Get recent posts from followed users (last 7 days)
    seven_days_ago = (datetime.utcnow() - timedelta(days=7)).isoformat()
    
    query = {
        \"author_id\": {\"$in\": following},
        \"tier\": \"public\",
        \"created_at\": {\"$gte\": seven_days_ago},
        \"quarantined\": {\"$ne\": True},
    }
    
    cursor = db.posts.find(query, {\"_id\": 0}).sort(\"created_at\", -1).limit(limit)
    activity = []
    async for post in cursor:
        activity.append({
            \"type\": \"post\",
            \"post_id\": post[\"post_id\"],
            \"author_id\": post[\"author_id\"],
            \"content\": post.get(\"content\", \"\")[:100],
            \"created_at\": post[\"created_at\"],
        })
    
    # Get new followers (last 7 days)
    cursor = db.follows.find({
        \"following_id\": user_id,
        \"created_at\": {\"$gte\": seven_days_ago},
    }, {\"_id\": 0}).sort(\"created_at\", -1).limit(limit)
    
    async for follow in cursor:
        follower = await db.users.find_one({\"user_id\": follow[\"follower_id\"]}, {\"_id\": 0})
        if follower:
            activity.append({
                \"type\": \"follow\",
                \"user_id\": follower[\"user_id\"],
                \"handle\": follower[\"handle\"],
                \"display_name\": follower.get(\"display_name\"),
                \"created_at\": follow[\"created_at\"],
            })
    
    # Get recent likes on user's posts (last 7 days)
    user_posts = []
    cursor = db.posts.find({\"author_id\": user_id}, {\"post_id\": 1})
    async for p in cursor:
        user_posts.append(p[\"post_id\"])
    
    cursor = db.likes.find({
        \"post_id\": {\"$in\": user_posts},
        \"created_at\": {\"$gte\": seven_days_ago},
    }, {\"_id\": 0}).sort(\"created_at\", -1).limit(limit)
    
    async for like in cursor:
        liker = await db.users.find_one({\"user_id\": like[\"user_id\"]}, {\"_id\": 0})
        post = await db.posts.find_one({\"post_id\": like[\"post_id\"]}, {\"_id\": 0})
        if liker and post:
            activity.append({
                \"type\": \"like\",
                \"user_id\": liker[\"user_id\"],
                \"handle\": liker[\"handle\"],
                \"post_id\": post[\"post_id\"],
                \"post_preview\": post.get(\"content\", \"\")[:50],
                \"created_at\": like[\"created_at\"],
            })
    
    # Sort by date
    activity.sort(key=lambda x: x[\"created_at\"], reverse=True)
    
    return {\"activity\": activity[:limit]}


@api.get(\"/notifications\")
async def get_notifications(user=Depends(get_current_user), limit: int = 50):
    \"\"\"Get all notifications (messages, follows, tags, etc).\"\"\\"
    user_id = user[\"user_id\"]
    
    cursor = db.notifications.find(
        {\"user_id\": user_id},
        {\"_id\": 0}
    ).sort(\"created_at\", -1).limit(limit)
    
    notifications = []
    async for notif in cursor:
        notifications.append(notif)
    
    return {\"notifications\": notifications}


@api.post(\"/notifications/{notification_id}/mark-read\")
async def mark_notification_read(notification_id: str, user=Depends(get_current_user)):
    \"\"\"Mark notification as read.\"\"\""
    user_id = user[\"user_id\"]
    
    await db.notifications.update_one(
        {\"notification_id\": notification_id, \"user_id\": user_id},
        {\"$set\": {\"read\": True, \"read_at\": now_iso()}},
    )
    
    return {\"ok\": True}


# ============================================================================
# 6. UPDATE send_dm TO ENCRYPT & NOTIFY
# ============================================================================

# REPLACE send_dm endpoint:
@api.post(\"/dms\")
async def send_dm(payload: DMIn, user=Depends(get_current_user)):
    \"\"\"Send DM with server-side encryption and notifications.\"\"\"
    user_id = user[\"user_id\"]
    recipient_id = payload.recipient_id
    
    # Validate recipient exists
    recipient = await db.users.find_one({\"user_id\": recipient_id}, {\"_id\": 0})
    if not recipient:
        raise HTTPException(404, \"Recipient not found\")
    
    # Can-DM gating
    can_send, reason = await can_dm(user, recipient)
    if not can_send:
        raise HTTPException(403, reason)
    
    # Validate content
    content = payload.content.strip() if payload.content else \"\"
    media_paths = payload.media_paths or []
    
    if not content and not media_paths:
        raise HTTPException(400, {
            \"detail\": \"Message cannot be empty. Please add text or attach media.\",
            \"code\": \"dm_empty\"
        })
    
    message_id = f\"dm_{uuid.uuid4().hex[:12]}\"
    now = now_iso()
    
    # ENCRYPT message content before storage
    encrypted_content = encrypt_message(content) if content else \"\"
    
    dm_doc = {
        \"message_id\": message_id,
        \"from_id\": user_id,
        \"to_id\": recipient_id,
        \"content\": encrypted_content,  # ENCRYPTED AT REST
        \"media_paths\": media_paths,
        \"read\": (user_id == recipient_id),  # Self-DM is pre-read
        \"read_at\": now if user_id == recipient_id else None,
        \"created_at\": now,
    }
    
    await db.dms.insert_one(dm_doc)
    
    # NOTIFY recipient (unless self-DM)
    if user_id != recipient_id:
        await notify_message_sent(user, recipient, message_id, content)
    
    # Audit log
    await db.audit_events.insert_one({
        \"event\": \"dm_sent\",
        \"user_id\": user_id,
        \"recipient_id\": recipient_id,
        \"message_id\": message_id,
        \"at\": now,
    })
    
    # Return decrypted version to sender
    return {
        \"message_id\": message_id,
        \"from_id\": user_id,
        \"to_id\": recipient_id,
        \"content\": content,
        \"media_paths\": media_paths,
        \"read\": dm_doc[\"read\"],
        \"created_at\": now,
        \"encrypted\": True,
    }


# ============================================================================
# 7. UPDATE dm_history TO DECRYPT & MARK READ
# ============================================================================

# REPLACE dm_history endpoint:
@api.get(\"/dms/with/{other_id}\")
async def dm_history(other_id: str, user=Depends(get_current_user)):
    \"\"\"Get DM thread with decryption and read-state management.\"\"\"
    user_id = user[\"user_id\"]
    
    # Fetch all DMs in thread
    query = {
        \"$or\": [
            {\"from_id\": user_id, \"to_id\": other_id},
            {\"from_id\": other_id, \"to_id\": user_id},
        ]
    }
    
    cursor = db.dms.find(query, {\"_id\": 0}).sort(\"created_at\", 1)
    messages = []
    async for dm in cursor:
        # DECRYPT for display
        decrypted_content = decrypt_message(dm.get(\"content\", \"\"))
        
        messages.append({
            \"message_id\": dm[\"message_id\"],
            \"from_id\": dm[\"from_id\"],
            \"to_id\": dm[\"to_id\"],
            \"content\": decrypted_content,
            \"media_paths\": dm.get(\"media_paths\", []),
            \"read\": dm.get(\"read\", False),
            \"read_at\": dm.get(\"read_at\"),
            \"created_at\": dm[\"created_at\"],
        })
    
    # Mark unread messages as read
    await db.dms.update_many(
        {
            \"from_id\": other_id,
            \"to_id\": user_id,
            \"read\": False,
        },
        {
            \"$set\": {
                \"read\": True,
                \"read_at\": now_iso(),
            }
        },
    )
    
    # Fetch other user info
    other = await db.users.find_one({\"user_id\": other_id}, {\"_id\": 0})
    if not other:
        raise HTTPException(404, \"User not found\")
    
    # Check screenshots permission (AND-gate)
    screenshots_allowed = False
    if user_id != other_id:
        my_pref = user.get(\"settings\", {}).get(\"dm_screenshots_allowed\", False)
        their_pref = other.get(\"settings\", {}).get(\"dm_screenshots_allowed\", False)
        screenshots_allowed = my_pref and their_pref
    else:
        screenshots_allowed = True
    
    return {
        \"with\": {
            \"user_id\": other[\"user_id\"],
            \"handle\": other[\"handle\"],
            \"display_name\": other[\"display_name\"],
            \"avatar_path\": other.get(\"avatar_path\"),
            \"is_self\": (user_id == other_id),
        },
        \"messages\": messages,
        \"can_send\": True,
        \"reason\": \"\",
        \"screenshots_allowed\": screenshots_allowed,
    }


# ============================================================================
# 8. ADD ADMIN FLAGGING ENDPOINTS
# ============================================================================

class AdminFlagUserIn(BaseModel):
    user_id: str
    reason: str = Field(min_length=1, max_length=500)
    flag_type: str  # \"suspicious\" | \"under_investigation\" | \"legal_hold\"


@api.post(\"/admin/users/{user_id}/flag\")
async def admin_flag_user(user_id: str, payload: AdminFlagUserIn, admin=Depends(require_admin)):
    \"\"\"Flag user account for admin DM review.\"\"\"
    user = await db.users.find_one({\"user_id\": user_id}, {\"_id\": 0})
    if not user:
        raise HTTPException(404, \"User not found\")
    
    await db.users.update_one(
        {\"user_id\": user_id},
        {
            \"$set\": {
                \"admin_flagged\": True,
                \"admin_flag_reason\": payload.reason,
                \"admin_flag_type\": payload.flag_type,
                \"admin_flagged_at\": now_iso(),
                \"admin_flagged_by\": admin[\"user_id\"],
            }
        },
    )
    
    await db.audit_events.insert_one({
        \"event\": \"admin_flag_user\",
        \"admin_id\": admin[\"user_id\"],
        \"target_user_id\": user_id,
        \"flag_type\": payload.flag_type,
        \"reason\": payload.reason,
        \"at\": now_iso(),
    })
    
    return {\"ok\": True, \"message\": f\"User {user['handle']} flagged for review\"}


@api.delete(\"/admin/users/{user_id}/flag\")
async def admin_unflag_user(user_id: str, admin=Depends(require_admin)):
    \"\"\"Remove flag from user.\"\"\"
    user = await db.users.find_one({\"user_id\": user_id}, {\"_id\": 0})
    if not user:
        raise HTTPException(404, \"User not found\")
    
    await db.users.update_one(
        {\"user_id\": user_id},
        {
            \"$unset\": {
                \"admin_flagged\": \"\",
                \"admin_flag_reason\": \"\",
                \"admin_flag_type\": \"\",
                \"admin_flagged_at\": \"\",
                \"admin_flagged_by\": \"\",
            }
        },
    )
    
    await db.audit_events.insert_one({
        \"event\": \"admin_unflag_user\",
        \"admin_id\": admin[\"user_id\"],
        \"target_user_id\": user_id,
        \"at\": now_iso(),
    })
    
    return {\"ok\": True}


@api.get(\"/admin/flagged-users\")
async def admin_list_flagged(admin=Depends(require_admin)):
    \"\"\"List all flagged accounts.\"\"\"
    cursor = db.users.find(
        {\"admin_flagged\": True},
        {\"_id\": 0, \"password_hash\": 0}
    )
    flagged = []
    async for user in cursor:
        flagged.append({
            \"user_id\": user[\"user_id\"],
            \"handle\": user[\"handle\"],
            \"flag_type\": user.get(\"admin_flag_type\"),
            \"reason\": user.get(\"admin_flag_reason\"),
            \"flagged_at\": user.get(\"admin_flagged_at\"),
            \"flagged_by\": user.get(\"admin_flagged_by\"),
        })
    return {\"flagged_users\": flagged}


@api.get(\"/admin/users/{user_id}/dms-decrypted\")
async def admin_view_flagged_dms(user_id: str, admin=Depends(require_admin)):
    \"\"\"
    View DECRYPTED DMs for flagged user (admin only).
    Only available if user is flagged.
    Logs every access.
    \"\"\"
    user = await db.users.find_one({\"user_id\": user_id}, {\"_id\": 0})
    if not user:
        raise HTTPException(404, \"User not found\")
    
    # CRITICAL: Only for flagged accounts
    if not user.get(\"admin_flagged\"):
        raise HTTPException(403, \"User is not flagged for review\")
    
    # Fetch incoming DMs
    incoming = []
    cursor = db.dms.find({\"to_id\": user_id}, {\"_id\": 0})
    async for dm in cursor:
        incoming.append({
            **dm,
            \"content\": decrypt_message(dm.get(\"content\", \"\")),
            \"decrypted\": True,
        })
    
    # Fetch outgoing DMs
    outgoing = []
    cursor = db.dms.find({\"from_id\": user_id}, {\"_id\": 0})
    async for dm in cursor:
        outgoing.append({
            **dm,
            \"content\": decrypt_message(dm.get(\"content\", \"\")),
            \"decrypted\": True,
        })
    
    # AUDIT: Log this access
    await db.audit_events.insert_one({
        \"event\": \"admin_viewed_flagged_dms\",
        \"admin_id\": admin[\"user_id\"],
        \"target_user_id\": user_id,
        \"num_dms_viewed\": len(incoming) + len(outgoing),
        \"reason\": user.get(\"admin_flag_reason\"),
        \"at\": now_iso(),
    })
    
    return {
        \"user_id\": user_id,
        \"handle\": user[\"handle\"],
        \"flag_reason\": user.get(\"admin_flag_reason\"),
        \"flag_type\": user.get(\"admin_flag_type\"),
        \"incoming_dms\": incoming,
        \"outgoing_dms\": outgoing,
    }


# ============================================================================
# 9. FIX BUG #1: MINOR VISIBILITY ON WALL
# ============================================================================

# UPDATE get_wall endpoint:
@api.get(\"/wall/{owner_id}\")
async def get_wall(owner_id: str, viewer=Depends(get_current_user)):
    \"\"\"Get wall posts. Minors are invisible (hardcoded, no override).\"\"\""
    owner = await db.users.find_one({\"user_id\": owner_id}, {\"_id\": 0})
    if not owner:
        raise HTTPException(404, \"User not found\")
    
    # HARDCODED: Minors are invisible on any public wall
    if owner.get(\"is_minor\"):
        raise HTTPException(404, \"Wall not found\")
    
    wall_perm = owner.get(\"settings\", {}).get(\"wall_post_permission\", \"owner\")
    viewer_id = viewer[\"user_id\"] if viewer else None
    
    # Permission check
    if wall_perm == \"owner\":
        if not viewer_id or viewer_id != owner_id:
            raise HTTPException(403, \"Only owner can view this wall\")
    elif wall_perm == \"followers\":
        if viewer_id:
            is_follower = bool(await db.follows.find_one({
                \"follower_id\": viewer_id,
                \"following_id\": owner_id,
            }))
            if not is_follower and viewer_id != owner_id:
                raise HTTPException(403, \"Must follow to view this wall\")
        else:
            raise HTTPException(403, \"Must be logged in\")
    
    # Return wall posts
    cursor = db.wall_posts.find({\"owner_id\": owner_id}, {\"_id\": 0}).sort(\"created_at\", -1)
    posts = []
    async for post in cursor:
        posts.append(post)
    return {\"posts\": posts}


# UPDATE posts_by_user endpoint:
@api.get(\"/posts/by-user/{user_id}\")
async def posts_by_user(user_id: str, viewer=Depends(get_current_user)):
    \"\"\"Get posts by user. Minors are invisible (hardcoded).\"\"\""
    user = await db.users.find_one({\"user_id\": user_id}, {\"_id\": 0})
    if not user:
        raise HTTPException(404, \"User not found\")
    
    # HARDCODED MINOR INVISIBILITY
    if user.get(\"is_minor\"):
        raise HTTPException(404, \"User not found\")  # Silent 404
    
    viewer_id = viewer[\"user_id\"] if viewer else None
    cursor = db.posts.find({\"author_id\": user_id}, {\"_id\": 0}).sort(\"created_at\", -1)
    posts = []
    async for post in cursor:
        if await can_view_post(post, viewer):
            p = await serialize_post(post, viewer)
            posts.append(p)
    return {\"posts\": posts}


# ============================================================================
# 10. FIX BUG #5: INNER CIRCLE REMOVAL ON UNFOLLOW
# ============================================================================

# UPDATE unfollow endpoint:
@api.delete(\"/follow/{target_id}\")
async def unfollow(target_id: str, user=Depends(get_current_user)):
    \"\"\"Unfollow target and remove from their Inner Circle.\"\"\""
    user_id = user[\"user_id\"]
    
    await db.follows.delete_one({
        \"follower_id\": user_id,
        \"following_id\": target_id,
    })
    
    # NEW: Remove from target's Inner Circle
    await db.inner_circle.delete_many({
        \"owner_id\": target_id,
        \"member_id\": user_id,
    })
    
    await db.audit_events.insert_one({
        \"event\": \"unfollow\",
        \"user_id\": user_id,
        \"target_id\": target_id,
        \"at\": now_iso(),
    })
    
    return {\"ok\": True}


# ============================================================================
# 11. FIX REFRESH TOKEN ENDPOINT (for auto-logout issue)
# ============================================================================

# ADD new endpoint for token refresh:
class RefreshTokenIn(BaseModel):
    refresh_token: str


@api.post(\"/auth/refresh\")
async def refresh_access_token(payload: RefreshTokenIn, response: Response):
    \"\"\"
    Refresh access token using refresh token.
    Fixes auto-logout by allowing clients to refresh before expiry.
    \"\"\"
    refresh_token = payload.refresh_token
    
    try:
        payload_decoded = jwt.decode(refresh_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload_decoded.get(\"sub\")
        token_type = payload_decoded.get(\"type\")
        
        if token_type != \"refresh\":
            raise HTTPException(401, \"Invalid token type\")
        
        if not user_id:
            raise HTTPException(401, \"Invalid token\")
        
        # Verify user still exists
        user = await db.users.find_one({\"user_id\": user_id}, {\"_id\": 0})
        if not user:
            raise HTTPException(401, \"User not found\")
        
        # Generate new access token
        new_access = create_access_token(user_id)
        
        # Set cookie
        response.set_cookie(
            \"access_token\",
            new_access,
            max_age=TOKEN_EXPIRY_MINUTES * 60,
            httponly=True,
            samesite=\"Lax\",
        )
        
        return {
            \"access_token\": new_access,
            \"token_type\": \"bearer\",
        }
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, \"Refresh token expired\")
    except jwt.InvalidTokenError:
        raise HTTPException(401, \"Invalid refresh token\")


# ============================================================================
# SUMMARY OF CHANGES
# ============================================================================
\"\"\"
ALL CHANGES TO APPLY TO server.py:

1. Add imports: crypto, json, datetime, timedelta
2. Update TOKEN_EXPIRY_MINUTES to 1440 (24 hours, not instant)
3. Update create_access_token() - add proper expiry
4. Add create_refresh_token() - for refresh flow
5. Add notify_message_sent() - in-app & push notifications
6. Add send_push_notification() - FCM integration stub
7. Add get_activity_feed() - timeline of followed users
8. Add get_notifications() - all notifications
9. Add mark_notification_read() - mark as read
10. REPLACE send_dm() - add encryption + notify
11. REPLACE dm_history() - add decryption + read-state
12. Add admin_flag_user() - flag account for review
13. Add admin_unflag_user() - remove flag
14. Add admin_list_flagged() - list flagged accounts
15. Add admin_view_flagged_dms() - view encrypted DMs (flagged only)
16. REPLACE get_wall() - enforce minor invisibility
17. REPLACE posts_by_user() - enforce minor invisibility
18. REPLACE unfollow() - remove from IC on unfollow
19. Add refresh_access_token() - fix auto-logout
20. Remove all Emergent references

DATABASE MIGRATIONS NEEDED:
- Run: python3 backend/migrations/001_add_encryption.py
- Creates indexes for faster queries
- Adds admin flagging fields to users

ENVIRONMENT SETUP:
- Generate DM_ENCRYPTION_KEY and set in .env
- Configure S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY
- Optional: Firebase Admin SDK for push notifications
\"\"\"
