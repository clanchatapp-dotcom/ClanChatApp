# FIX #1: Add /posts/by-tag/{tag} endpoint
# Location: Add after line 3690 in backend/server.py (after @api.post("/notifications/mark-seen"))

@api.get("/posts/by-tag/{tag}")
async def posts_by_tag(tag: str, user=Depends(get_current_user)):
    """Get all public posts tagged with a specific hashtag.
    
    TagView.jsx calls this endpoint to display posts with a specific tag.
    Only returns public posts to the current user (respecting view permissions).
    """
    tag_lower = tag.lower().strip()
    if not tag_lower or not re.match(r'^[a-z0-9]+$', tag_lower):
        raise HTTPException(400, "Invalid tag format")
    
    cursor = db.posts.find(
        {
            "tags": tag_lower,
            "tier": "public",
            "quarantined": {"$ne": True}
        },
        {"_id": 0}
    ).sort("created_at", -1).limit(100)
    
    posts = []
    async for p in cursor:
        if await can_view_post(p, user):
            posts.append(await serialize_post(p, user))
    
    return {"posts": posts}
