# ClanChat — Phase 2 Kickoff Plan

_Compiled from the CLANCHAT 3.pdf spec + the four user asks on the phase-2 kickoff message._

---

## 1. User's four immediate asks — recommendation summary

### A. Stickers / GIFs (Tenor blocked)
Tenor stopped accepting new API clients. Options ranked by fit:

| Provider | Fit for ClanChat | Notes |
|---|---|---|
| **Giphy Developer API** | ★★★★★ | Still open, free tier is generous, unified GIF + sticker search, has SDKs for React & Capacitor. Works in Russia. **Recommended.** |
| **Klipy** | ★★★★ | Newer alt, curated + moderated, cleaner brand fit. Free tier smaller. |
| **Google Tenor v2** | ★★ | Same block as Tenor v1 for new signups — skip. |
| **Custom sticker uploads** (Verified only) | ★★★ | Aligns with the PDF shop/monetisation model. Slower to ship. Best as a **Phase 3** premium feature. |
| **Emoji-only fallback** (current) | Ship-blocker mitigation only | Keep as a permanent fallback. |

**Recommended plan:** Ship **Giphy** in Phase 2, add custom sticker uploads for Verified accounts in Phase 3.
Key filter: SFW-only search parameter (`content_filter=medium` or `high`), pass through the same NSFW-tag blocklist we already built.

### B. Rework reporting system
Current state: single "Report" endpoint with free-text reason + admin queue. Spec calls for six categories + soft-warning-first flow. Rework needs:

- Structured category picker (`spam` / `harassment` / `inappropriate` / `underage` / `unlabelled_ai` / `other + free text`)
- **Reporter follow-up screen** — "Was your report actioned?" so people who report feel heard
- Multi-report aggregation → automatic **soft warning** to the target when the same target gets N reports for the same category in a window (still human-reviewed, but pre-flagged)
- Admin queue improvements: filter by category, sort by report count, bulk-action, "similar-report" grouping
- **Dedicated CSAM lane** — separate collection, goes to CSAM-only admin queue that already exists (`AdminWatch`), triggers the mandated CEOP pipeline (currently mocked)
- Reporter identity **hashed** so admins can spot mass-reporting abuse without knowing who the reporter is

### C. Video call cross-device
1. **Camera switch on mobile** — **already implemented** in the last session (`SwitchCamera` button in `Call.jsx`; calls `localParticipant.setCameraEnabled(true, { facingMode: nextFacing })`). Needs live test on device to confirm.
2. **Fix video call on PC** — needs a proper desktop responsive pass on `Call.jsx`:
   - Detect desktop viewport → use 2-column grid layout instead of remote-fullscreen + local-PiP
   - Larger control bar, keyboard shortcuts (M = mute, V = camera, End = hang up)
   - Screen-share button (LiveKit supports this natively; just needs a UI button)
   - Test in Chrome / Firefox / Safari — Safari WebRTC has known quirks around `getUserMedia` and speaker selection

### D. Data storage for large-scale
Current stack:
- **MongoDB** (single instance) via `MONGO_URL`
- **Emergent Object Storage** for uploaded media
- **FastAPI backend** (single process, K8s-managed by Emergent)
- No cache layer, no message queue, no CDN in front

At 10k users you're fine. At 100k+ you'll hit these walls. My scaling recommendations, prioritised by pain-point:

| Layer | ClanChat now | Recommended at scale | Why |
|---|---|---|---|
| **Database** | MongoDB single | **MongoDB Atlas M10+**, then sharded at 500k+ users | Managed, backups, auto-scale, still native to your code. Hetzner-region if possible to keep Russia access good. |
| **Object storage / media** | Emergent Object Storage | **Backblaze B2** + **Bunny CDN** | ~1/4 the cost of S3+CloudFront, Bunny works in Russia (Cloudflare doesn't — matches your PDF constraint). |
| **Cache** | None | **Redis (Upstash or self-hosted)** | Session store, rate limiting, tag counts, trending computation offloaded from Mongo. Cuts DB hits by ~80%. |
| **Job queue** | Synchronous (blocks HTTP) | **Redis + RQ or Celery** | FCM pushes, AI scans, moderation queue, thumbnail generation. Stops slow tasks from blocking API responses. |
| **Search** | MongoDB text index | **Meilisearch** (self-hosted, small) or **Typesense** | Handle-search + tag-search stays fast and typo-tolerant. Both are Russia-friendly. |
| **Analytics** | None | **PostHog self-hosted** | Privacy-first, EU-hosted, product analytics + feature flags. Matches your "no toxic metrics" ethos. |
| **Backend host** | Emergent K8s | Stay on Emergent until $X MRR; then **Hetzner Cloud** (Finland/Germany) with K3s | Matches your PDF's "avoid Cloudflare, need Russia access" requirement. |
| **DB backups** | Whatever Emergent gives | **Point-in-time recovery** on Atlas + weekly encrypted dump to B2 in a different region | Real production redundancy. |

**Cost sketch at 50k active users, monthly:**
- Atlas M10: ~$60
- Backblaze B2 + Bunny CDN (10 TB): ~$80
- Upstash Redis: ~$10
- Meilisearch on Hetzner CX21: ~$8
- PostHog self-hosted on same node: $0 (bundled)
- **Total: ~$160/month** for a 50k-user privacy-first stack. Compares to ~$500-800 for the equivalent on AWS.

---

## 2. Full Phase 2 backlog — prioritised

### **P0 — must ship in Phase 2 (spec-critical / launch blockers)**
1. **CEOP reporting pipeline** — mandated by UK Sexual Offences Act, currently mocked. Non-negotiable per PDF ("before launch"). Auto-report + preserve evidence + notify law enforcement email.
2. **Reworked reporting system** (asked above) — categories, aggregation, dedicated CSAM lane.
3. **Real AI detection via Hive Moderation API** — replaces the voluntary label. AI-of-real-people hard block only works with actual detection.
4. **Full NSFW system**: **Yoti** (viewing, UK/EU/AU) + **Veriff** (creator ID, worldwide) — hard requirement for 18+ tier + Online Safety Act compliance.
5. **Video call desktop UX + PC test** (asked above).
6. **Stickers/GIFs via Giphy** (asked above).
7. **PWA packaging** — install-to-home-screen from browser. Small work, big adoption impact.

### **P1 — high-value Phase 2 (per PDF)**
8. **Choices / Discovery feed** — tag-driven, separate from My Feed. Where sponsored content lives. Foundation for monetisation.
9. **Verified account system** — shield colours (Gold/Silver/Purple/Blue/White), applications flow, handle-claim (30-day notice), founding-team review queue. Big brand differentiator.
10. **Signal Protocol E2E encryption** upgrade — replaces current server-side AES-256. Truly zero-knowledge DMs. Ties into PDF's "we can't read your messages even if legally compelled" promise.
11. **Creator monetisation MVP** — tips + paid Inner Circle subscriptions. 5% ClanChat / 95% creator per PDF.
12. **Screenshot protection in DMs** — iOS: the Swift library you already found; Android: PrivacyScreen plugin (already installed) needs to be scoped to DM threads only.
13. **Post scheduling** (Premium/Verified) — most-requested creator feature.
14. **Advanced analytics dashboard** for Premium/Verified — per PDF "Creator Transparency" section.
15. **Real name visibility system** — Nobody / Inner Circle / Followers / Everyone. Currently only stored, not exposed as a control.

### **P2 — nice-to-have Phase 2**
16. **Wall settings** — open to Inner Circle or Followers (currently owner-only hardcoded).
17. **18+ tag manual-approval flow** — always required regardless of user settings, per PDF.
18. **Warning prompt before following 18+ account** — second age confirmation.
19. **Audio pre-release model** — IC first → Followers → Public with configurable delay.
20. **Custom profile themes** (Premium/Verified).
21. **Animated profile pictures** (Premium/Verified).
22. **External store links** for Verified — simple button on profile, no payment handling.
23. **Adult content creator flow** — creator flag + Veriff verification result stored + Purple Shield awarded.

### **P3 — deferred to Phase 3 (per PDF)**
- Live streaming
- Native ClanChat store via Printful
- iOS App Store + Play Store submission (with safety documentation)
- Custom sticker uploads (Verified)
- Regional server infrastructure expansion
- Moderation team hiring

---

## 3. Suggested build order

**Sprint A (weeks 1-2) — safety + core Phase-2 utility:**
- CEOP pipeline (P0-1)
- Reporting rework (P0-2)
- Hive AI detection (P0-3)
- Video call desktop pass (P0-5)

**Sprint B (weeks 3-4) — content stack:**
- Giphy stickers/GIFs (P0-6)
- PWA packaging (P0-7)
- Screenshot protection scoped to DMs (P1-12)

**Sprint C (weeks 5-6) — age verification + creator platform:**
- Yoti + Veriff (P0-4)
- Verified account system (P1-9)
- Handle-claim flow (P1-9)

**Sprint D (weeks 7-8) — discovery + monetisation:**
- Choices feed (P1-8)
- Tips + paid Inner Circle (P1-11)

**Sprint E (week 9+) — creator productivity:**
- Post scheduling (P1-13)
- Advanced analytics (P1-14)
- Signal Protocol upgrade (P1-10)

**Continuous:** infra migration to scaled data-storage stack (data-storage section above), rolled out sprint-by-sprint as usage warrants.

---

## 4. Decisions the user needs to make before Sprint A starts

- **Giphy vs Klipy** for stickers/GIFs?
- **Hive Moderation API** — do we get the paid plan ($99/mo starter) or start with their free tier?
- **Yoti + Veriff** — sign up for developer accounts now? Both require KYB (company registration). The PDF says register ClanChat Ltd before spending money — is that done?
- **Data-storage migration timing** — hold off until we hit 10k users, or start Sprint A with the Atlas migration to avoid a painful move later?
- **Reporting rework** — should the "was your report actioned?" screen surface the moderator's decision reason to the reporter, or just a yes/no?
