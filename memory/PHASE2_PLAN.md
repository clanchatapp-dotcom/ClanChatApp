# ClanChat — Phase 2 Kickoff Plan (LOCKED)

_User decisions received; sprint order re-cut around the Ltd-registration timeline._

---

## Locked decisions
1. **Stickers/GIFs provider:** **Giphy** (bigger library, more recognisable)
2. **AI detection:** **Hive Moderation free tier** until revenue; upgrade later
3. **Data-storage migration:** **Defer** until ~10k users. Stay on current stack (MongoDB + Emergent Object Storage) for the foreseeable
4. **Reporting UX:** Reporter sees **yes-actioned / not-actioned only** — never the moderation reason
5. **ClanChat Ltd registration:** Not yet — expected in **12-16 weeks** during private trial. **This blocks:** Yoti, Veriff, Stripe creator payouts, formal CEOP reporter registration

---

## Sprint order (locked around Ltd timing)

### **Sprint A — weeks 1-2 · Safety hardening + video call polish**
No external integrations that require Ltd. Everything shippable in preview.
1. **Reworked reporting system** (P0)
   - 6-category picker: `spam / harassment / inappropriate / underage / unlabelled_ai / other`
   - Multi-report aggregation → auto soft-warning suggestion when N reports on same target-category hit threshold (still human-reviewed)
   - Dedicated CSAM lane (separate collection, admin CSAM queue already exists at `/admin/watchlist`)
   - Reporter identity hashed so mass-reporting can be detected without unmasking reporter
   - Reporter follow-up screen: "Your report was reviewed" — yes/no only, no reason surfaced
2. **CEOP pipeline scaffolding** (P0)
   - Build the evidence-bundling code (post + user + IP hash + timestamps)
   - Format the CEOP submission email template
   - Ship as "dev-mode" — logs the payload, doesn't actually send until Ltd + CEOP registration land
   - Formal registration + real submission goes live in Sprint F
3. **Hive Moderation free tier** (P0)
   - Sign up needed from user side; API key
   - Scans every image/video upload async on ingest
   - AI-of-real-person detection → hard block + Strike 1 + 48h ban (already wired for manual label; auto-triggers with real detection)
   - Ordinary AI content: if unlabelled + high confidence → hold upload with friendly reminder ("Looks like this might be AI generated. Label it and you're good to go.")
4. **Desktop video call pass** (P0)
   - Detect viewport → 2-column grid at ≥1024px, remote-fullscreen + PiP at <1024px
   - Screen-share button (LiveKit built-in, just needs UI)
   - Keyboard shortcuts: M mute, V camera, End hang up
   - Safari WebRTC compatibility check + fix
   - _Camera front/back switch (mobile) already implemented in prior session, needs device test_

### **Sprint B — weeks 3-4 · Content + accessibility**
5. **Giphy stickers/GIFs** — needs Giphy API key from user
   - Sticker/GIF picker in DM composer + post composer
   - SFW-only content filter (`content_filter=high`)
   - Pipe result URLs through the NSFW-tag blocklist we already built
6. **PWA packaging** — install ClanChat to home screen from browser
   - Manifest + service worker + install prompt
   - Offline read-only view of last-seen feed
7. **Screenshot protection in DMs** (P1)
   - Android: `PrivacyScreen` plugin (already in Capacitor config) — scope to only fire on `/messages/*` routes
   - iOS: `yoxisem544/ScreenshotPreventing-iOS` Swift package (when iOS build is added — Sprint F+)
   - Notify sender when screenshot attempt detected

### **Sprint C — weeks 5-6 · Discovery + profile controls**
Ltd not required. Ships high user-value in-app features.
8. **Choices / Discovery feed** (P1)
   - Separate feed distinct from My Feed
   - Interest categories from the PDF: Music / Gaming / Fitness / Photography / Lifestyle / Art / Food / Travel / Tech / Podcast / AI+Creative
   - Tier-1 posts fully; Tier-2 as follow-prompt thumbnails; Tier-3 never appears
   - Opt-out toggle in settings (default off — you opt IN to be discoverable)
9. **Wall settings** (P2) — quick win
   - Owner-only / Inner Circle / Followers who can post on wall
10. **Real-name visibility control** (P1) — Nobody / IC / Followers / Everyone
11. **18+ tag manual-approval flow** (P2) — always required regardless of general tag settings

### **Sprint D — weeks 7-8 · Creator platform prep**
Ltd may still be pending; build the surface, defer the money.
12. **Verified account applications flow** (P1)
    - Application form + admin review queue
    - Shield colours: Gold (celeb) / Silver (music) / Purple (adult creator) / Blue (brand) / White (media)
    - Handle-claim: 30-day notice to original holder + Early Member badge transfer
    - No money yet — verification is manual + free during trial
13. **Post scheduling** (P1) — Premium/Verified only
14. **Advanced analytics dashboard** (P1) — Premium/Verified only, no monetisation yet

### **Sprint E — Ltd + Yoti/Veriff (post-registration)**
Blocked on ClanChat Ltd registration.
15. **Yoti** — NSFW viewing gate for UK/EU/AU (Online Safety Act compliance)
16. **Veriff** — creator ID for NSFW uploads worldwide + Purple Shield issuance
17. **Adult content creator flag + NSFW upload gating**
18. **Warning prompt before following 18+ accounts** (second age confirmation)

### **Sprint F — Monetisation + CEOP go-live**
Blocked on Ltd + business Stripe.
19. **Creator monetisation MVP:** tips + paid Inner Circle subscriptions (5% ClanChat / 95% creator per spec)
20. **CEOP pipeline goes live** — register as CEOP reporter, flip dev-mode off
21. **Creator transparency dashboard** — real earnings + payout schedule

### **Sprint G+ — E2E encryption + polish**
22. **Signal Protocol E2E upgrade** (replaces current server-side AES-256)
23. **Audio pre-release model** — IC first → Followers → Public with configurable delay
24. **Custom profile themes** (Premium/Verified)
25. **Animated profile pictures** (Premium/Verified)
26. **External store links** (Verified)

### **Phase 3 — post-launch**
- Live streaming (standard + gaming)
- Native store via Printful
- App Store + Play Store submission with safety documentation
- Custom sticker uploads (Verified creators)
- Regional server / infra expansion
- Data-storage migration to Atlas + Backblaze + Bunny CDN + Redis + Meilisearch (only when 10k+ users)

---

## What I need from you to kick off Sprint A

**Nothing blocking for the first 3 items.** Ready to start immediately.

**For item 3 (Hive) only:**
- Sign up at https://hivemoderation.com (free tier)
- Generate API key
- Send it here (I'll add to backend `.env` as `HIVE_API_KEY`)

Everything in Sprint A can ship to preview and be live-tested before you redeploy to production.

---

## Deferred to when Ltd is registered
- Yoti developer account
- Veriff developer account
- Business Stripe account for creator payouts
- CEOP formal reporter registration
- All Sprint E + F work

I'll build the scaffolding for these during Sprints A-D so when Ltd lands, we plug in credentials and flip switches rather than starting from scratch.
