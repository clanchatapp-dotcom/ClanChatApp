# ClanChat
## Founders' Sign-Up & Integration Roadmap
### Companion to Spec v4.0 · Feb 2026

Confidential · clanchat.app · ClanChat Ltd (in formation)

This is the ordered checklist of every account, integration, and legal step needed to reach the full vision described in the v4.0 spec. Stages are gated — later stages depend on earlier ones. Pick items off in order and nothing gets blocked.

**Priority key**

| Marker | Meaning |
|:--:|:--|
| 🟥 | Blocks everything downstream — do first |
| 🟧 | Blocks public launch |
| 🟨 | Blocks monetisation |
| 🟩 | Blocks safety compliance |
| 🟦 | Operational — gradual |
| 🟪 | App store publishing |
| 🟫 | Live streaming |
| 🎨 | Defensive brand handles |

---

## 🟥 Stage 0 — Legal Foundation (Do This Week)

**Nothing that touches money should happen before this.** Everything below depends on Stage 0 being complete.

| # | Action | Where | Cost | Why |
|:-:|:--|:--|:--:|:--|
| 1 | Register **ClanChat Ltd** | companieshouse.gov.uk | £12 | Legal entity for banks, investors, IP, contracts |
| 2 | **Founders' Agreement** (dual-class shares) | seedlegals.com | £200–400 | Locks equity, conduct clause, IP ownership before anyone leaves |
| 3 | **Business bank account** | Wise Business · Starling · Revolut Business | Free | Payment processors require Ltd + business bank |
| 4 | **ICO registration** (Data Protection fee) | ico.org.uk | £52/yr | Mandatory before you legally process UK user data |
| 5 | Trademark **"ClanChat"** (word mark) | ipo.gov.uk | £170 | Blocks squatters. Class 9 (software) + Class 45 (social network) |
| 6 | Trademark **"Your Personal Clubhouse"** | ipo.gov.uk | £170 | Same reasoning |
| 7 | Company email `founder@clanchat.app` | Google Workspace or Fastmail | ~£6/mo | Needed for every account below |

**Stage 0 total:** ~£620 + £6/mo · **Timeline:** 2–3 weeks (trademarks take ~4mo to grant but you can proceed once filed)

---

## 🟧 Stage 1 — Compliance Before Public Launch

Required before submitting to the Play Store or opening general signups.

| # | Action | Where | Cost |
|:-:|:--|:--|:--:|
| 8 | **IWF membership** (Internet Watch Foundation) | iwf.org.uk | £990/yr (charity rates negotiable initially) |
| 9 | **NCMEC CyberTipline** reporting account | report.cybertip.org | Free |
| 10 | **CEOP reporting** endpoint | ceop.police.uk (form request) | Free |
| 11 | **PhotoDNA** (Microsoft) — CSAM hash matching | microsoft.com/photodna | Free |
| 12 | Draft **Terms of Service · Privacy Policy · Content Policy · Cookie Policy** | Seedlegals templates + solicitor review | £500–1,000 |

**Once Stage 1 is done:** the CEOP live submission pipeline (already scaffolded in `server.py`) can be wired up. That unblocks Google Play submission.

---

## 🟨 Stage 2 — Payments (Monetisation)

Do these once Ltd is formed and Companies House number is issued.

| # | Provider | Signup URL | What It Unlocks | ClanChat Cut |
|:-:|:--|:--|:--|:--:|
| 13 | **Stripe** | stripe.com/gb (UK Ltd account) | Cards worldwide except Russia/CN — the workhorse | 10% subs / 7.5% tips + merch |
| 14 | **Xsolla Publisher** | publisher.xsolla.com | Gaming microtransactions + regional coverage Stripe misses | Same rates |
| 15 | **ЮMoney for Business** | yoomoney.ru | Russia/CIS rails | Same rates |
| 16 | **Printful** | printful.com | Print-on-demand merch (no inventory risk) | 7.5% on top of their cost |

### ⚠️ ЮMoney caveat

ЮMoney requires **one of the following:**

1. A Russian legal entity (subsidiary or partner)
2. A Russian resident co-founder registered as an individual entrepreneur
3. A payment-partner acting as merchant of record on your behalf

Worth deciding early. Option 3 is the fastest but takes a cut of its own. If you go option 1, that's a second Companies House-equivalent registration (roughly ₽4,000 + Russian accountant).

**Once signed up + KYC'd:** ping me the API keys and I'll wire them one at a time via `integration_playbook_expert_v2`. **Suggested order: Stripe first** (covers 90% of your users), Xsolla second (gaming crossover), ЮMoney last (Russia/CIS launch).

---

## 🟩 Stage 3 — Trust & Safety

After Ltd is formed.

| # | Provider | Signup URL | Purpose |
|:-:|:--|:--|:--|
| 17 | **Yoti Business** | yoti.com/business | Age verification for NSFW viewers (UK/EU/AU · Online Safety Act) |
| 18 | **Veriff** | veriff.com | ID verification for NSFW *uploaders* (worldwide) |
| 19 | **Hive Moderation** | hivemoderation.com | Replace manual AI label — auto-detects AI images / videos / deepfakes |

Yoti/Veriff pricing: typically £0.50–£2 per verification, invoiced monthly. Free trial credits usually available.

Hive: usage-based, ~$0.001–$0.003 per image scanned. Free tier for testing.

---

## 🟦 Stage 4 — Ops (Gradual, Low Priority)

| # | Provider | Cost | Why |
|:-:|:--|:--:|:--|
| 20 | **Sentry** | Free tier | Backend + frontend error tracking |
| 21 | **Better Stack / UptimeRobot** | Free tier | Uptime pings on `clanchat.app` |
| 22 | **Resend** | Free tier (100/day) | Transactional email (cleaner than Supabase default) |
| 23 | **Plausible** or **PostHog** (self-hosted) | Free / self-host | Privacy-friendly analytics — never Google Analytics, clashes with brand |
| 24 | **GitHub Pro** | $4/mo | Codeowners, protected branches, more Actions minutes |

---

## 🟪 Stage 5 — App Stores (Phase 3)

| # | Action | Where | Cost |
|:-:|:--|:--|:--:|
| 25 | **Google Play Developer** | play.google.com/console | $25 one-time |
| 26 | **Apple Developer Program** | developer.apple.com | $99/year (needed for iOS Capacitor build) |

Both require the Ltd registration and full policy suite from Stage 1.

---

## 🟫 Stage 6 — Live Streaming (Phase 2/3)

**LiveKit Cloud** is already integrated for voice/video calls — I can extend it to public and tier-gated live streams without adding a new provider.

Fallback options if we need RTMP ingest (for OBS support):

- **Mux** — mux.com — pay per streaming minute
- **Cloudflare Stream** — cloudflare.com/products/stream — flat per-minute pricing (⚠️ verify Russia accessibility before committing)

---

## 🎨 Bonus — Marketing / Presence Handles to Grab Now

**Free. Defensive. Do today.** Grab the handles before anyone else does.

| Platform | Handle | Notes |
|:--|:--|:--|
| X / Twitter | `@ClanChatApp` | Primary marketing channel |
| Instagram | `@ClanChatApp` | Visual campaigns · reels |
| TikTok | `@ClanChatApp` | Short-form growth |
| YouTube | `youtube.com/@ClanChat` | Demos + founder content |
| LinkedIn | ClanChat Ltd (company page) | Investor + hiring channel |
| Reddit | `r/ClanChat` (as moderator) | Community control |
| GitHub Org | `github.com/clanchat` | Already secured ✅ |
| Discord | ClanChat server | Community + support pre-app |

---

## 💰 Total Estimated Setup Cost (Stage 0 + 1)

| Bucket | Cost |
|:--|--:|
| Companies House registration | £12 |
| ICO annual fee | £52 |
| Trademark ClanChat | £170 |
| Trademark tagline | £170 |
| Founders' Agreement | £200–400 |
| Solicitor review of legal docs | £500–1,000 |
| IWF membership (year 1) | £990 (charity waivable) |
| Company email (year 1) | £72 |
| **Stage 0 + 1 total** | **~£2,166 – £2,866** |

Everything from Stage 2 onward is either **usage-priced** (only pay when you take payments / verify users) or **free tier eligible** at your current scale.

---

## 📋 Suggested First Moves (This Week)

1. **Register ClanChat Ltd** (30 min, £12) → gets the company number
2. **Grab all social handles** (30 min, free) → defensive
3. **File both trademarks** (1 hour, £340) → protects the brand
4. **Reply with the Ltd company number** → I'll update:
   - Terms/Privacy footer with proper legal identification
   - ICO registration number placeholder
   - "ClanChat Ltd" branding across the admin panel
   - Kick off the **Stripe** integration playbook (needs Ltd + UK bank)

---

## Dependency Chart (What Blocks What)

```
Stage 0 (Legal Foundation)
├─ Stage 1 (Compliance)
│  └─ Stage 5 (App Stores)
├─ Stage 2 (Payments — Stripe, Xsolla, ЮMoney, Printful)
├─ Stage 3 (Yoti, Veriff, Hive)
├─ Stage 5 (App Stores — requires Stage 1)
└─ Stage 6 (Live Streaming — LiveKit already live)

Stage 4 (Ops) — no dependencies, do anytime
Bonus Handles — do today, free
```

---

## Contact & Questions

Anything on this roadmap needs research (e.g. ЮMoney partner options, Yoti pricing negotiation, Hive credit tiers), just ask. I can dig via `integration_playbook_expert_v2` for anything payment- or auth-related, and the wider founding team can pick up policy drafting once Seedlegals templates are in hand.

---

ClanChat Founders' Roadmap · Companion to Spec v4.0 · Confidential · Feb 2026 · clanchat.app
Built by the founder. All rights reserved. ClanChat Ltd (in formation).
