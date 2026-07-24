# ClanChat
## Complete Product Specification — v4.0
### Your Personal Clubhouse

Confidential · Feb 2026 · clanchat.app

ClanChat is a privacy-first social platform built around one idea: **an online version of chilling with your homies.** Not a stage. Not a broadcast channel. Your personal clubhouse — where you decide who gets in, what they see, and how they can reach you.

---

**Legend — implementation status**

| Marker | Meaning |
|:------:|:--------|
| ✅ | **Built** and live on preview + prod |
| 🧩 | **Built** but hidden / feature-flagged / partial coverage |
| 🕒 | **Planned** for the next phase — not built |
| 🆕 | **New in v4** — added since v3 spec was written |

---

| Concept | An online version of chilling with your homies |
|:--|:--|
| Tagline | ClanChat – Your Personal Clubhouse |
| Domain | clanchat.app *(deployed ✅)* |
| Handles | # format — not @ *(✅)* |
| Build Tool | Emergent.sh → Cursor (Phase 2) — code on GitHub *(✅)* |
| Authentication | Email/password + Google social login (Supabase-backed) *(✅ 🆕 Supabase swap)* |
| Backend | FastAPI + MongoDB + Supabase Storage *(✅ 🆕 Supabase Storage swap)* |
| Status | V1 shipped · Iter 23 · Feb 2026 |
| Version | v4.0 — Complete specification with implementation status |

| §  | Section |
|:--:|:--|
| 1 | Vision & Identity |
| 2 | The Three Tiers |
| 3 | Profile & Identity |
| 4 | Content & Posting |
| 5 | Tag System |
| 6 | Messaging & Calls |
| 7 | Safety & Moderation |
| 8 | AI Content Policy |
| 9 | Age Verification & Minor Protection |
| 10 | Comfort Zone |
| 11 | Choices & Discovery |
| 12 | Verified Accounts & Celebrities |
| 13 | Creator Tools & Live Streaming |
| 14 | Shop & Merch |
| 15 | Premium Subscription |
| 16 | Monetisation & Payment Structure *(updated v4)* |
| 17 | Design & UX |
| 18 | Company & Legal Structure |
| 19 | Financial Structure |
| 20 | Build Phases |
| 21 | Tech Stack & Infrastructure |
| 22 | Cursor Build Prompt |
| 23 | 🆕 What's Been Built (delta from v3) |

---

## 1. Vision & Identity

**Concept.** ClanChat is built around one idea: an online version of chilling with your homies. Every feature serves one goal — authentic connection with people you actually trust. Not a performance. Not a broadcast. Your personal clubhouse.

**Tagline.** ClanChat — Your Personal Clubhouse *(✅)*

**Core Philosophy**
- ✅ Privacy by architecture, not policy
- ✅ No algorithm. No ads in your personal feed. No toxic metrics.
- ✅ Adults can be adults — but kids are always protected by architecture not just policy
- ✅ Your circle. Your rules. No bullshit.
- ✅ Transparency is non-negotiable — especially around AI generated content
- ✅ Every feature serves authentic connection, not engagement farming
- ✅ ClanChat is not anti-AI — AI is creative and welcome. Transparency and consent are mandatory.
- ✅ Deliberately the opposite of Instagram, Facebook, and TikTok
- ✅ The responsible adult social network — fun without exploitation

**The "My" Language Pattern** *(✅ applied throughout the UI)*
- My Feed · My Choices *(🕒 P2)* · My Comfort Zone · My Inner Circle · My Wall

**Tone of Voice** *(✅)*
- Warm, casual, no corporate speak · direct and honest · never robotic · treats users like adults · direct call-out for bad behaviour

**Handle Format.** ClanChat uses `#` not `@`. You are `#YourName`. *(✅)*

**Real Name Policy** *(✅)*
- Held for internal verification and safety only — never public by default
- Visibility settings: Nobody / Inner Circle / All Followers / Everyone
- Changeable anytime in settings

**Anti-Meta Positioning** *(all ✅)*

| Instagram / Facebook / TikTok | ClanChat |
|:--|:--|
| Algorithmic feed | Chronological only |
| Ads everywhere | No ads in personal feed |
| Public follower counts | All metrics private |
| Anyone can DM you | DMs gated by tier |
| Open follow by default | Privacy first by default |
| Adult content poorly managed | Strictly tiered + verified |
| Kids poorly protected | Minor protection by architecture |
| Screenshot anything | Screenshot protection in DMs (Android ✅ · web/iOS unavoidable) |
| AI content unlabelled | All AI content mandatory labelled |

---

## 2. The Three Tiers

The three-tier system is the core architecture of ClanChat. No exceptions. **All ✅ live.**

| Tier | Name | Who Sees It | How You Get In |
|:--:|:--|:--|:--|
| 1 | Public | Anyone — account or no account | No barrier |
| 2 | Followers | Approved followers only | Open follow or approval required |
| 3 | Inner Circle | Your closest chosen people only | YOU send the invite. Nobody can request it. |

**Tier 1 — Public** ✅
- Visible to anyone with an account (no logged-out view yet — 🕒 P2)
- No DMs from this level — ever
- No 18+ content — hardcoded, no exceptions
- No tagging without approval · anonymous likes · Tier 1 boards read-only for no-account viewers 🕒
- Tags fully searchable

**Tier 2 — Followers** ✅
- Two follow modes: Open / Approval Required *(✅)*
- Can participate in your Discussion Boards *(✅)*
- Optional DMs toggle *(✅)*
- 18+ content visible if account flagged & follower age-verified *(🧩 client-side NSFW toggle; age verification 🕒 P2)*
- Tag thumbnails with follow prompt to non-followers *(🕒 P2 — Choices dependent)*
- Temporary preview on pending follow requests *(🕒 P2)*

**Tier 3 — Inner Circle** ✅
- Invite-only — you send invites *(✅)*
- Can comment on regular posts *(✅ — comments Tier 3 gated)*
- DMs always open *(✅)*
- Group chats · max 15 · consent-based joining *(✅)*
- Per-person controls (DMs / audio msg / audio call / video call) *(✅)*
- No tag field on Tier 3 posts *(✅)*
- **The Invisible Wall** — Tier 3 posts do not exist to Tier 1 & 2 *(✅)*

**Interaction Matrix** *(✅ enforced server-side)*

| Action | No Account | Tier 1 | Tier 2 | Tier 3 |
|:--|:--:|:--:|:--:|:--:|
| Read Tier 1 posts | 🕒 | ✅ | ✅ | ✅ |
| Read Tier 2 posts | ✕ | ✕ | ✅ | ✅ |
| See Tier 3 posts | ✕ | ✕ | ✕ | ✅ |
| Like posts | ✕ | T1 only | ✅ | ✅ |
| Comment | ✕ | ✕ | Boards | ✅ |
| DM the account | ✕ | ✕ | If toggle | Always |
| Wall write | ✕ | ✕ | If setting | If setting |
| Group chats | ✕ | ✕ | ✕ | With consent |

**Search Visibility — Hardcoded** *(✅)*

| Searcher | Can Find |
|:--|:--|
| Adult → adult | ✅ |
| Adult → minor | Invisible |
| Minor → clean adult | ✅ |
| Minor → 18+ adult | Invisible |
| No account | Account required |

**Wall Settings** *(✅)*
- Default: owner only · openable to Inner Circle / Followers · non-followers can never post

---

## 3. Profile & Identity

**Profile Layout** *(✅ current: PP · #handle · display name · real name (tiered) · bio · links · Shop "coming soon" placeholder · tabs)*

**Tabs (current build)** *(✅ 🆕 restructured from v3)*
- **Media** · **Wall** · **Audio** · **Boards** (inside Wall) · **Pinned ribbon** above tabs
- v3 had 5 tabs (Feed / Wall / Audio / Boards / Pinned); v4 collapsed to 3 for mobile density with Pinned as a ribbon and Boards nested inside Wall.

**Profile Picture Rules** *(✅ SFW-only enforced by client scan · 🕒 human review queue for reports)*

**Bio** — Std 150 · Prem 300 · Verified 300 *(✅ std 150; 🕒 tiered limits P2)*

**Links Section** — Std 3 · Prem 8 · Verified unlimited *(✅ std 3; 🕒 tiered limits P2)*

**Profile Tabs by Account Type**

| Tab | Standard | Premium | Verified |
|:--|:--:|:--:|:--:|
| Feed / Media | ✅ | ✅ | ✅ |
| Wall | ✅ | ✅ | ✅ |
| Audio | ✅ | ✅ | ✅ |
| Boards | ✅ | ✅ | ✅ |
| Pinned | 3 ✅ | 6 🕒 | 6 🕒 |
| Music tab | — | — | 🕒 P3 |
| Shop tab | ✕ | 🕒 external | 🕒 native |

**Private Metrics** *(✅ all private: follower count owner-only, likes anonymous, no play counts exposed, no algorithm)*

**Tagging Controls** *(✅ Anyone/Followers/Inner/Nobody; approval mode ✅; 18+ tags always approval ✅; photo/video tags manual approval ✅; Tier 3 no tag field ✅)*

---

## 4. Content & Posting

**Post Types** *(all ✅)*
- Text · Photos · Videos · Audio · Discussion Boards
- Tier selector at post time *(✅)*

**File Size Limits**

| File | Std | Prem | Verified |
|:--|:--|:--|:--|
| Photos | 50MB ✅ | Unlimited 🕒 | Unlimited 🕒 |
| Videos | 500MB / 10min ✅ | 2GB / unlim 🕒 | 4GB / unlim 🕒 |
| Audio | 100MB / 30min ✅ | 1GB 🕒 | Unlimited 🕒 |
| Documents | 100MB 🕒 | 2GB 🕒 | 2GB 🕒 |

All media cloud-stored (Supabase Storage, bucket `ClanChatApp`) *(✅ 🆕 was Emergent Storage in v3)*

**18+ Content Rules** *(✅)*
- Accounts can be flagged 18+ · warning before follow · T2/T3 only · individual post NSFW flag · Tier 1 always clean · Veriff for upload 🕒 P2

**Discussion Boards** *(✅)*
- Any user creates boards · T2 follow to join · T3 always · T1 read w/ account · board creator moderates

**Commenting Rules** *(✅)*
- Regular posts: T3 only · Boards: T2+ · Non-followers → only T1 boards

**Audio Posts** *(✅)*
- Owner-only posting · no audio comments/wall · audio DMs via per-person toggle · waveform player *(basic; scrubbing/speed 🕒)* · Music tab 🕒 P3 · pre-release model 🕒 P3

---

## 5. Tag System

**How Tags Work** *(✅)*
- Field bottom of post (hidden on T3) · space/comma → chip · tap chip to remove · max 10 · lowercase · single word · visible below content

**Tag Visibility by Tier** *(✅)*

| Tier | Field | Search | Non-follower preview |
|:--|:--:|:--:|:--|
| T1 | ✅ | ✅ | Full post |
| T2 | ✅ | ✅ | Preview 🕒 P2 |
| T3 | Hidden | Never | Invisible |

**Banned Tags** *(✅ hardcoded, applies to usernames, display names, wall, board titles too; fuzzy-match 133tspeak 🕒 P2)*
- Racial · homophobic · transphobic · antisemitic · Islamophobic · ableist · sexist slurs · silent-fail (no error msg)

**Follow Prompt Discovery** *(🕒 P2 — Choices-dependent)*

---

## 6. Messaging & Calls

**DM Access by Tier** *(✅)*

| Tier | DM Access |
|:--|:--|
| T1 | No DMs. Ever. |
| T2 | Optional toggle ✅ |
| T3 | Always open ✅ |
| Verified receiving DMs | 🕒 P2 (off by default, thread-scoped reply) |

**Per-Person Inner Circle Controls** *(✅ — set on invite, adjustable later)*
- DMs · audio messages · audio calls · video calls

**Read Receipts** *(✅ on for everyone)*

**Group Chats** *(✅ T3 only · max 15 · everyone accepts · silent decline · silent leave · owner can remove)*

**Encryption** *(🧩 v4 state)*
- 🆕 **Server-side AES-256-GCM** on all DMs today (✅ live) — content_enc column in Mongo
- 🕒 Signal Protocol full E2E — P2

**Voice & Video Calls** *(✅ 🆕 v3 said "WebRTC P2" — we shipped it in V1 via LiveKit Cloud)*
- Voice · Video · IncomingCallRinger · in-call screen
- 🕒 Native Android earpiece audio routing plugin (`CallAudioPlugin.java` shipped, awaiting on-device test)

**Screenshot Protection** *(🧩)*
- ✅ Android FLAG_SECURE via native `PrivacyScreen` plugin (per-thread)
- ✕ Web/iOS — platform-impossible, honest banner shown

---

## 7. Safety & Moderation

**Block / Mute / Restrict / Remove Follower** *(✅ all four)*

**Report System** *(✅)*
- Categories: csam, underage, harassment, hate, self_harm, inappropriate, unlabelled_ai, impersonation, spam, other
- Anonymous reporter · human review · admin queue

**Soft Warning** *(✅ before any strike — polite auto-message)*

**3 Strike System** *(✅)*

| Stage | Action |
|:--|:--|
| Soft Warning | Message only |
| Strike 1 | 24-48h suspension · specific reason |
| Strike 2 | 7d suspension · final warning |
| Strike 3 | Permanent deletion · no appeal |

- Strike count visible in own settings ✅ · specific reason every time ✅ · expiry after 12mo clean 🕒 · ban-evasion device/IP flag 🕒 P2

**Immediate Strike 1 + 48h ban** *(✅ policy defined, admin-triggered)*
- AI of real person no consent · impersonation · doxxing · unlabelled AI confirmed

**Immediate Strike 3 — permanent** *(✅ policy defined)*
- AI sexual content of real person · NCII · doxxing severe · credible threats

**CSAM — Law Enforcement Matter** *(✅ 🆕 fully wired v1)*
- ✅ Auto-quarantine on CSAM report (immediate)
- ✅ Separate `csam_reports` collection
- ✅ Admin CSAM queue + audit log
- ✅ `CEOP_ENDPOINT` env plumbing built
- 🕒 Live CEOP/NCMEC submission (blocked on ClanChat Ltd registration)

**Minor Protection — Hardcoded** *(✅ all live)*
- DOB at signup · 18+ warning · T1 NSFW block · 18+ tag approval · minors invisible to adults · 18+ invisible to minors

**Adult → Minor Contact Rules — Hardcoded** *(✅ all live)*
- Adults cannot follow / DM / invite to IC minors unless minor initiates · not in follower suggestions · UK Online Safety Act aligned

**Human Support Response Times** *(policy defined; support flow 🕒 P2)*

| Account Type | Time | Handler |
|:--|:--|:--|
| Std free | 72h | Support team |
| Premium | 48h | Priority queue |
| Verified | 24h | Founding team |
| Verified major | Same day | Founder personally |
| Urgent CSAM/threat | 1-2h | Immediate escalation |

**Verified Account Conduct Policy** *(policy defined ✅ · enforcement 🕒 P2)*

---

## 8. AI Content Policy

**ClanChat's Position** *(✅ AI welcome · transparency + consent mandatory)*

**Detection System**
- V1 ✅ manual toggle on upload
- 🆕 🧩 Client-side `nsfwjs` scanner for image NSFW moderation (shipped this session)
- 🕒 P2 Hive Moderation API for full AI detection

**Mandatory Labelling** *(✅ label required to upload; options: AI Generated / AI Assisted / AI Altered; permanent label on post)*

**The Friendly Reminder** *(🕒 P2 — requires Hive detection first)*

**AI of Real People — Hard Rules** *(✅ policy · admin-enforced today · Hive automation 🕒 P2)*

**AI Sexual Content of Real People — Nuclear** *(✅ policy · admin-enforced today)*

**Viewer Controls** *(✅ AI toggle in Comfort Zone — "off" = completely gone from feed)*

---

## 9. Age Verification & Minor Protection

**Basic Signup — Worldwide** *(✅)*
- Email · DOB (self-declared V1) · email confirm · minor flag auto-applied · Google social login ✅

**Viewing NSFW Content** *(🧩)*
- ✅ Comfort Zone NSFW toggle (client + server)
- 🕒 P2: Yoti for UK/EU/AU · COPPA DOB for US · IP-based routing

**Uploading NSFW Content** *(🕒 P2 — Veriff worldwide gate)*

**Under 18 Full Signup Restrictions** *(✅ all live)*
- Cannot enable NSFW · cannot see 18+ · cannot see AI of real people 🕒 Hive · invisible to adults · adults cannot initiate

---

## 10. Comfort Zone

**Onboarding message** *(✅ OnboardingTour: "Before you enter the clubhouse let us set up your space")*

**Comfort Zone Settings** *(✅ all wired · minor override blocks are hardcoded)*

| Setting | Default | Notes |
|:--|:--|:--|
| NSFW content | Off | Age verification required 🕒 · minor block ✅ |
| Graphic violence | Off | 🕒 P2 UI toggle |
| Strong language | On | 🕒 P2 UI toggle |
| Sensitive topics | Off | 🕒 P2 UI toggle |
| AI generated content | On | ✅ toggle live |
| Anonymous accounts | On | 🕒 P2 UI toggle |

---

## 11. Choices & Discovery *(🕒 all Phase 2)*

Choices is ClanChat's opt-in discovery layer — completely separate from My Feed. Tag driven. Public facing. Where sponsored content lives (the only place ads ever appear).

- Categories · tag driven feed · sponsored posts · Choices opt-out toggle · initial categories list
- 🆕 v4 stopgap: `TrendingRail` (right sidebar at 2xl+) shows top 10 public tags last 24h — mini-Choices *(✅)*

---

## 12. Verified Accounts & Celebrities *(🕒 Phase 2)*

**Who can apply, shield colours, handle claim process, verified features vs standard, verified DM rules, inner circle pre-release model, direct access to founding team** — all as v3 spec. **Deferred per user directive: "Shields can wait."**

---

## 13. Creator Tools & Live Streaming

**Creator Tools — Verified** *(🕒 P2)*
- Analytics · scheduling · multi-upload · priority uploads · extended bio · pinned · custom themes · Music tab · native shop

**Live Streaming** *(🆕 promoted to P2 per user · was Phase 3 in v3)*
- Standard live · gaming live w/ screen capture · tier-gated streams · Inner Circle live · in-stream chat with tier rules
- 🕒 RTMP/HLS ingest + LiveKit (already integrated for calls — reuse!)

**Live Stream Monetisation** *(🕒 P2)* — live tips · super comments · Inner Circle-gated exclusive streams

**Audio & Music Features — Verified** *(🕒 P3)* — Music tab · chronological tracks · anonymous likes · share link · Choices integration · audio pre-release · high-res for IC

---

## 14. Shop & Merch

**Shop Access by Account Type**

| Account Type | Shop Access |
|:--|:--|
| Standard | No shop · placeholder "coming soon" ✅ |
| Premium | External link 🕒 P2 |
| Verified | Full native store 🕒 P2/P3 |

**Phase 2 — External Store Links** *(🕒)*
- Shopify · own website · Amazon · Simple Shop button · 0% cut

**Phase 2/3 — Native ClanChat Store** *(🕒 — user promoted from P3 to earlier)*
- In-app merch store · creator uploads products · fan purchases in-app · **ClanChat handles payments end-to-end via Stripe + Xsolla + ЮMoney (🆕 payment routing per region)**
- 🆕 **ClanChat cut: 7.5% of each transaction** (down from v3's stated 5-10%, aligned with tips rate)
- Printful integration for print-on-demand · zero inventory risk

**What Can Be Sold** *(as v3)*
- Physical merch · digital downloads · behind-the-scenes packs · signed digital prints · meet-and-greet tickets · IC-exclusive merch (unique)

**Tier System Applied to Merch** *(as v3)*
- Public store · Followers exclusive drops · IC exclusive ultra-limited

**Transparency on Shop Transactions** *(as v3)*
- Every txn shown · ClanChat cut in £ · creator net · payout dates · zero hidden fees

---

## 15. Premium Subscription

**Premium Features vs Free vs Verified** *(policy defined 🕒 P2 · Premium checkout not yet built)*

| Feature | Free | Premium | Verified |
|:--|:--|:--|:--|
| Photos | 50MB ✅ | Unlimited 🕒 | Unlimited 🕒 |
| Videos | 500MB / 10min ✅ | 2GB / unlim 🕒 | 4GB / unlim 🕒 |
| Audio | 100MB / 30min ✅ | 1GB 🕒 | Unlimited 🕒 |
| Pinned | 3 ✅ | 6 🕒 | 6 🕒 |
| Bio | 150 ✅ | 300 🕒 | 300 🕒 |
| Links | 3 ✅ | 8 🕒 | Unlim 🕒 |
| Themes | Default dark ✅ | Custom 🕒 | Custom 🕒 |
| Scheduling | ✕ | 🕒 | 🕒 |
| Analytics | Basic 🕒 | Advanced 🕒 | Full 🕒 |
| Support | 72h 🕒 | 48h 🕒 | 24h 🕒 |
| Badge | None | Premium 🕒 | Shield 🕒 |
| Read receipts | ✅ | ✅ | ✅ |
| Animated PP | ✕ | 🕒 P2 | 🕒 P2 |
| Shop | ✕ | External link 🕒 | Native 🕒 |

**Premium Never Includes** — boosted reach · algorithm priority · ads · unfair social advantage.

**Premium Pricing** — £3–£5/month TBC · **ClanChat keeps 100% of Premium revenue** (platform sub, no creator involved).

---

## 16. Monetisation & Payment Structure *(🆕 UPDATED v4)*

### Per-Stream Platform Fee

Flat, transparent, written into terms. **All below 🕒 not yet wired — payments integration is next up on the roadmap.**

| Revenue Stream | 🆕 v4 ClanChat Cut | Creator Gets | Notes |
|:--|:--:|:--:|:--|
| **Tier 3 subscriptions (paid Inner Circle)** | **10%** | 90% | Creator sets monthly price (🆕 v3 was 5%) |
| **Tips from followers** | **7.5%** | 92.5% | One-off direct payments (🆕 v3 was 5%) |
| **Merch sales — native store** | **7.5%** | 92.5% | Native store · Printful fulfilment (🆕 v3 was 5-10%) |
| Digital downloads | 7.5% | 92.5% | Music, art, content packs (aligned with tips) |
| Live stream tips | 7.5% | 92.5% | Phase 2 |
| Super comments (live) | 7.5% | 92.5% | Phase 2 |
| Sponsored posts | Revenue share | Majority | Choices feed only — never My Feed |
| **ClanChat Premium** | **100%** | N/A | Platform subscription — no creator involved |
| External store links | 0% | 100% | Just a link, no transaction |

### 🆕 Payment Rails (v4 architecture)

Regional routing so creators + fans get the best conversion:

| Region | Primary | Fallback |
|:--|:--|:--|
| UK / EU / US / AU / rest of world | **Stripe** | — |
| Russia / CIS | **ЮMoney** *(YooMoney)* | — |
| In-game / gaming / global microtransactions | **Xsolla** | — |

- All three rails feed the same **creator earnings dashboard** — transparency is universal.
- Region auto-detected from IP + user profile; fans can override.
- Payouts scheduled per creator in their local currency.

### Advertising Rules — Absolute *(unchanged from v3)*
- Sponsored posts ONLY in Choices — never in My Feed
- Category-scoped · always visibly labelled · creator account required · no banners · no pop-ups · no injected ads

### Creator Transparency Dashboard *(🕒 P2)*
- Monthly earnings broken down · per-stream breakdown · ClanChat's cut in exact £ · creator net · full payout history · scheduled dates · zero hidden fees

### Paid Inner Circle Subscriptions *(🕒 P2)*
- 🆕 **ClanChat cut: 10%** · creator keeps 90%
- Creator sets own price · fan subscribes · access auto-granted
- Free and paid slots coexist in same IC · paying subs never know who's free · access removed on cancel

### Why Creators Will Choose ClanChat
- Keep 90–92.5% of everything earned (🆕 subs slightly higher fee than v3; tips + merch competitive)
- Inner Circle pre-release built in · no algorithm suppression · direct fan relationships
- Merch / subs / tips / sponsored / downloads all in one platform · Stripe + Xsolla + ЮMoney routing
- Privacy first · direct line to founding team · a platform that respects creators

---

## 17. Design & UX

**Dark Mode by Default** *(✅ true-black OLED-friendly · optional light mode toggle in settings)*

**Colour System** *(✅ all live)*

| Colour | Use |
|:--|:--|
| True black | Base layer |
| Purple `#7c3aed` | Inner Circle · verification accents |
| Orange `#FF5A00` | Primary CTA (Post/Send/Follow) |
| Green `#10b981` | Public tier |
| Amber `#f59e0b` | Followers tier |

**Navigation** *(✅)*
- **Bottom nav (mobile)** — Feed · Search · Messages · Activity · Profile
- 🆕 **Desktop sidebar (lg+)** — full nav + brand + user chip + New Post CTA (v3 didn't specify desktop)
- 🆕 **Trending rail (2xl+)** — right sidebar with top 10 public tags last 24h

**Feed Display** *(✅ 🆕 v4 enhancements)*
- 🆕 **General ▾ / Followers scope selector** at top of feed (X-style · default: General)
- Words / Gallery toggle · chronological · no algorithm · no suggested posts
- Post shows: tier · #handle · timestamp · content · anonymous like count
- 🆕 **Gallery tap opens fullscreen Lightbox** with author footer + "Go to profile" pill

**Cloud Based Infrastructure** *(✅ Supabase Storage · Telegram-style device-independent · web primary · Android APK via Capacitor · Russia-accessible via Hetzner-style hosting on Emergent Cloud)*

---

## 18. Company & Legal Structure *(unchanged from v3 · all 🕒 pending)*

Company registration · dual-class shares · decision-making structure · IP protection · legal docs required before launch · recommended legal services (Seedlegals, Companies House, UKIPO) · estimated legal setup costs £1,050–£1,800.

---

## 19. Financial Structure *(unchanged from v3 · pending Ltd formation)*

- Each founder ×6 : 15% each = 90% total
- Company reserve : 10%
- Total : 100%
- 10% reserve for infra · legal · Yoti/Veriff · emergency · reinvestment · marketing · hiring

---

## 20. Build Phases

### ✅ Phase 1 — V1 MVP: **SHIPPED · Feb 2026**

All V1 items from v3 spec complete:
- ✅ Email/password + Google social login (Supabase)
- ✅ DOB + hardcoded minor flag
- ✅ # handle system throughout
- ✅ Three-tier system with server-side enforcement
- ✅ Invisible Tier 3 posts
- ✅ Follow (open + approval) · Inner Circle invite-only
- ✅ Profile layout (Media/Wall/Audio tabs + Pinned ribbon)
- ✅ 3-pinned hard limit
- ✅ Private metrics
- ✅ Chronological feed (Words/Gallery)
- ✅ Photo/video/audio uploads · manual AI toggle
- ✅ Tags · 10 max · banned words · tier rules
- ✅ DMs · tier-gated · per-person IC controls
- ✅ Block · mute · remove follower · restrict
- ✅ Anonymous report system · human review
- ✅ 3-strike moderation with soft warning
- ✅ Adult→minor contact protection hardcoded
- ✅ Minor search invisibility hardcoded
- ✅ Dark mode default + light toggle
- ✅ Bottom nav (Feed · Search · Messages · Activity · Profile)
- ✅ Comfort Zone (basic + hardcoded minor NSFW block)
- ✅ Search by #handle
- ✅ Discussion Boards
- ✅ Admin panel — reports queue · CSAM queue · audit log · strike 1/2/3 · dismiss
- ✅ CEOP pipeline scaffolding (env plumbed, live submission 🕒 pending Ltd)

### 🆕 Phase 1.5 — Beyond V1 spec, delivered before P2:

- ✅ **Voice & video calls (LiveKit)** — v3 said P2, shipped in V1
- ✅ **Server-side AES-256-GCM DM encryption** — interim before Signal Protocol
- ✅ **Group chats** (T3, ≤15, consent, silent leave)
- ✅ **Chronological activity feed** — likes / comments / follows / invites / tags
- ✅ **Editing** — posts, wall notes, DMs (with `edited` badge + edit history)
- ✅ **Voice notes** — inline `<VoiceRecorder />` in DMs + Audio posts
- ✅ **Giphy stickers/GIFs** — proxied through backend to keep API key server-side
- ✅ **Client-side NSFW image scanner** — `nsfwjs`
- ✅ **Screenshot block (Android)** — FLAG_SECURE via PrivacyScreen plugin
- ✅ **Push notifications (FCM)** — likes / comments / follows / DMs / group msgs / warnings
- ✅ **Capacitor Android APK** — self-contained build via GitHub Actions
- ✅ **Native Android CallAudioPlugin.java** — earpiece routing for LiveKit
- ✅ **Android back-button handler** — double-tap-to-exit on /feed, nav-to-feed elsewhere
- ✅ **Gallery deep-link** — thumb → Lightbox with author footer + "Go to profile"
- ✅ **Activity deep-link** — notification tap → scroll + highlight + open comments
- ✅ **Feed scope selector** — General / Followers (X-style)
- ✅ **PWA** — manifest, installable, branded SVG icon, service worker
- ✅ **SEO/OG/Twitter Card meta**
- ✅ **TrendingRail** — top 10 public tags last 24h (mini-Choices)
- ✅ **Onboarding tour** — 4-step, Esc/backdrop/button dismissible
- ✅ **Desktop sidebar** at lg+
- ✅ **Deployment to production** at `clanchat.app`

### 🕒 Phase 2 — Post-V1 Stabilisation

- Choices / Discovery feed — tag-driven, separate from My Feed
- Full NSFW system — Yoti (viewing) · Veriff (uploading) — **deferred until ClanChat Ltd registered**
- 🆕 **Creator monetisation** — the big one:
  - **Stripe** (UK/EU/US/AU/RoW)
  - **Xsolla** (in-app / gaming)
  - **ЮMoney** (Russia/CIS)
  - Paid Inner Circle subscriptions (**10%** platform fee)
  - Tips (**7.5%** platform fee)
  - Merch native store + Printful (**7.5%** platform fee)
  - Digital downloads · sponsored posts
  - Creator transparency dashboard
- 🆕 **Live streaming** (promoted from v3 P3 per user directive)
  - RTMP/HLS ingest · LiveKit reuse · tier-gated · IC-only exclusive streams
  - Live tips · super comments
- Signal Protocol E2E DM upgrade (replaces server-side AES)
- Verified account system — applications · shield colours · handle claim
- Post scheduling · advanced analytics · custom themes · animated profile pictures
- External store links (Premium)
- Hive Moderation API (replaces manual AI label)
- Ban-evasion device/IP flagging
- Full CEOP/NCMEC live submission pipeline

### 🕒 Phase 3 — Growth & Scale

- App Store / Play Store listings with full safety documentation
- iOS native build (Capacitor)
- Verified Music tab · pre-release audio model
- Advanced AI detection updates
- International trademark expansion
- Moderation team hiring
- Dedicated verified support team
- Regional server infrastructure expansion

---

## 21. Tech Stack & Infrastructure

### Current Build — V1 shipped

- **Frontend:** React 18 · Tailwind · shadcn/ui · Lucide icons · sonner toasts · Radix primitives · React Router
- **Backend:** FastAPI · Python 3.11 · Motor (Mongo async) · Pydantic
- **Database:** MongoDB
- **🆕 Auth + Storage:** Supabase (email/password + Google OAuth · Storage bucket `ClanChatApp` · SDK pinned to `2.45.4`) — *(v3 said Emergent Auth + Emergent Storage — swapped)*
- **Calls:** LiveKit Cloud
- **Push:** Firebase Cloud Messaging (FCM only — Firebase Auth removed)
- **Stickers:** Giphy API (backend-proxied)
- **AI moderation (client):** nsfwjs
- **Encryption (DMs):** AES-256-GCM server-side (interim before Signal Protocol)
- **Native shell:** Capacitor · GitHub Actions APK build
- **Code:** exported to GitHub · always own your code

### Future — Cursor Phase *(unchanged from v3)*

- React/Next.js · Supabase full-stack · TypeScript · Tailwind · Signal Protocol

### Hosting *(current: Emergent Cloud · Russia-accessible)*

- ✅ Emergent Cloud (managed) · Russia-accessible without VPN · no Cloudflare
- 🕒 Migration option: Hetzner (Finland/Germany) if needed
- ✅ HTTPS enforced · domain `clanchat.app` deployed

### Third Party Integrations Status

| Integration | Phase | Purpose | Status |
|:--|:--|:--|:--|
| Supabase Auth + Storage | V1 | Auth + file storage | ✅ 🆕 |
| LiveKit Cloud | V1 | Voice + video calls | ✅ 🆕 promoted from P2 |
| Firebase Cloud Messaging | V1 | Push notifications | ✅ 🆕 |
| Giphy | V1 | Stickers / GIFs (proxied) | ✅ 🆕 |
| nsfwjs (client) | V1 | Client-side image scan | ✅ 🆕 |
| Capacitor + native plugins | V1 | Android APK · earpiece · FLAG_SECURE | ✅ 🆕 |
| CEOP pipeline | V1 | CSAM law-enforcement handoff | 🧩 scaffolded · live 🕒 |
| Hive Moderation | P2 | Real AI content detection | 🕒 |
| Yoti | P2 | Age verification for NSFW viewing | 🕒 |
| Veriff | P2 | ID verification for NSFW uploaders | 🕒 |
| Signal Protocol | P2 | Full E2E DMs / groups | 🕒 |
| **Stripe** | **P2** | **Payments (UK/EU/US/AU/RoW)** | 🕒 🆕 |
| **Xsolla** | **P2** | **In-app / gaming microtxns** | 🕒 🆕 |
| **ЮMoney (YooMoney)** | **P2** | **Payments Russia/CIS** | 🕒 🆕 |
| Printful | P2/P3 | Print-on-demand merch | 🕒 |
| WebRTC (via LiveKit) | ✅ shipped V1 | Audio + video calls | ✅ 🆕 |

---

## 22. Cursor Build Prompt

*(unchanged from v3 — retained verbatim as reference for a future Cursor rebuild)*

---

## 23. 🆕 What's Been Built (delta from v3 spec)

This section captures features that either weren't in the v3 spec at all, or were slated for a later phase and got pulled forward.

### Delivered ahead of schedule (v3 said Phase 2/3 · shipped in V1)
- Voice + video calls (LiveKit)
- Push notifications (FCM)
- Screenshot protection on Android (per-thread FLAG_SECURE)
- Capacitor Android APK build with GitHub Actions
- Editing (posts / wall / DMs)
- Server-side encrypted DMs (AES-256-GCM interim)
- Discussion Boards with tier moderation
- Group chats with consent-based joining
- Comprehensive admin panel (Reports · CSAM · Audit log)

### Not in v3 at all — added because we needed them
- Chronological Activity feed (likes / comments / follows / invites / tags / warnings)
- Voice notes (inline `<VoiceRecorder />` recording, 60s max, WebM opus)
- Giphy stickers/GIFs (backend-proxied)
- Client-side NSFW image scanner (`nsfwjs`)
- Native Android earpiece audio routing plugin (`CallAudioPlugin.java`)
- Gallery → Lightbox deep-link with author "Go to profile" footer
- Feed scope selector (General ▾ / Followers)
- Notification → post scroll+highlight deep-link
- Android back-button double-tap-to-exit
- TrendingRail (mini-Choices) at 2xl+ desktop
- Desktop sidebar layout
- Onboarding tour
- PWA support (manifest + service worker)
- SEO / OG / Twitter Card meta

### Tech stack changes from v3
- 🆕 **Supabase** replaces Emergent Auth + Emergent Storage
- 🆕 **LiveKit Cloud** replaces "WebRTC someday"
- 🆕 **FCM** for push (Firebase Auth removed)
- 🆕 **AES-256-GCM** interim server-side DM encryption before Signal Protocol
- 🆕 **nsfwjs client** for image moderation before Hive

### Monetisation deltas (v4 vs v3)
- v3: flat **5%** on everything
- v4: **10% subs · 7.5% tips · 7.5% merch (native store) · 7.5% digital / live tips / super comments**
- 🆕 Three payment rails: **Stripe + Xsolla + ЮMoney** (was Stripe-implied only in v3)
- 🆕 **Live streaming promoted from P3 → P2**

### Deferred per user directive
- 🕒 Verified account shields ("Shields can wait")
- 🕒 Yoti / Veriff age verification (until ClanChat Ltd registered)
- 🕒 CEOP live pipeline (scaffolded, awaiting Ltd)
- 🕒 iOS Capacitor build

---

ClanChat Complete Product Specification **v4.0** · Confidential · Feb 2026 · clanchat.app
Built by the founder. All rights reserved. ClanChat Ltd (in formation).
