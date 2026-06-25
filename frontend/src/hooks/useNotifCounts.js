import { useEffect, useState, useCallback } from "react";
import api from "../lib/api";

const POLL_MS = 30000;

/**
 * Polls /api/notifications/counts and exposes:
 *   - counts: { follow_requests, inner_invites, unread_dms, new_followers,
 *               tag_pending, group_invites, warnings, total }
 *   - markSeen(): POST /api/notifications/mark-seen and refetch.
 *   - refresh(): manual refetch.
 *
 * Falls back to zeros on error so the UI never crashes.
 */
export default function useNotifCounts(enabled = true) {
  const [counts, setCounts] = useState({
    follow_requests: 0, inner_invites: 0, unread_dms: 0,
    new_followers: 0, tag_pending: 0, group_invites: 0,
    warnings: 0, total: 0,
  });

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications/counts");
      setCounts(data);
    } catch (e) { console.warn("notif counts failed", e); }
  }, []);

  const markSeen = useCallback(async () => {
    try { await api.post("/notifications/mark-seen"); refresh(); }
    catch (e) { console.warn("mark-seen failed", e); }
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    // Instant refresh trigger — components dispatch this after taking an
    // action that should drop the badge (e.g. opening a DM thread, dismissing
    // a warning, accepting a follow request).
    const handler = () => refresh();
    window.addEventListener("clanchat:notif-refresh", handler);
    return () => {
      clearInterval(id);
      window.removeEventListener("clanchat:notif-refresh", handler);
    };
  }, [enabled, refresh]);

  return { counts, refresh, markSeen };
}
