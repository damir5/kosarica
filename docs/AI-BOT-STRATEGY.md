# AI Bot & Community Strategy — Tvoja Košarica

**Version:** 1.1 — Post-review revision
**Date:** 2026-02-06
**Status:** Reviewed by GPT-5.3 Codex + Gemini 3 Pro (see docs/reviews/)

---

## Table of Contents

1. [Strategy Overview](#1-strategy-overview)
2. [Community Channels Setup](#2-community-channels-setup)
3. [Marketing Bot — Content Automation](#3-marketing-bot--content-automation)
4. [Product Bot — Price Intelligence](#4-product-bot--price-intelligence)
5. [Helpdesk Bot](#5-helpdesk-bot)
6. [Data Quality Bot](#6-data-quality-bot)
7. [Pre-Launch Marketing (Day -90 to Day 0)](#7-pre-launch-marketing-day--90-to-day-0)
8. [MVP Phase Integration](#8-mvp-phase-integration)
9. [Technical Architecture](#9-technical-architecture)
10. [Ethics & Safety](#10-ethics--safety)
11. [Metrics & KPIs](#11-metrics--kpis)

---

## 1. Strategy Overview

### Core Idea

Deploy "Pametnjaković" — the brand persona — as an AI-powered bot presence across external community platforms BEFORE the app launches. The bot:

- **Discovers deals** from our price data and posts them daily across channels
- **Generates content** (blog posts, reports, deal alerts) in the brand voice
- **Segments content** per audience (families, students, pensioners, professionals)
- **Monitors data quality** and alerts admin on issues
- **Handles helpdesk** (FAQ, bug reports, feature requests) in community channels
- **Builds community** before there's even an app to use

### What This Is NOT (For Now)

- **Not an in-app chatbot.** The consumer-facing app stays focused on its core UX (search, lists, optimization). The bot persona lives on external platforms.
- **Not a customer support replacement.** Bot handles Tier 1 FAQs and routes everything else to human admin.

### Platform: OpenClaw (miniclawd)

[OpenClaw](https://github.com/FoundDream/miniclawd) — TypeScript/Bun AI agent framework:
- Multi-channel: Telegram, Discord (via integrations)
- Multi-LLM: Claude, GPT, Gemini, Groq, OpenRouter
- Skills system: markdown-based capability extensions
- Scheduling: cron-based automation
- Memory: persistent per-user and per-channel context
- Subagents: background task spawning

---

## 2. Community Channels Setup

### 2.1 Channel Matrix (Phased — Review-Adjusted)

> **Review finding:** Both reviewers flagged channel-market mismatch. Croatian families/pensioners use WhatsApp, Viber, and Facebook — not Discord. Channel rollout must be sequenced, not simultaneous.

| Platform | Handle/Name | Type | Purpose | Phase |
|----------|-------------|------|---------|-------|
| **Telegram Channel** | @TvojaKosarica | Broadcast | Daily deals, weekly reports, alerts | V1.0 (Day -60) |
| **Facebook Page** | Tvoja Košarica | Page | Visual deal cards, viral sharing | V1.0 (Day -45) |
| **Blog** | tvoja-kosarica.hr/blog | Web | SEO content, inflation reports | V1.0 (Day -30) |
| **Telegram Group** | Tvoja Košarica Zajednica | Discussion | Community chat, feedback | V1.5 (+2mo) |
| **WhatsApp** | Tvoja Košarica | Business broadcast | Weekly digest for families/pensioners | V1.5 (+2mo) |
| **Discord** | Tvoja Košarica | Server | Tech/student niche, bot commands | V1.5 (+3mo) |
| **Reddit** | r/TvojaKosarica | Subreddit | Long-form analyses, weekly reports | V2.0 (+6mo) |

> **Viber:** Investigate Viber Community/Channels API for 40+ demographic (higher penetration than Telegram in Croatia). Evaluate for V1.5.

### 2.2 Discord Server Structure

```
TVOJA KOŠARICA
│
├── INFORMACIJE
│   ├── #pravila              (rules, CoC)
│   ├── #dobrodošli           (welcome + onboarding)
│   ├── #najave               (announcements — bot posts)
│   └── #changelog            (app updates)
│
├── CIJENE I PONUDE
│   ├── #deal-dana            (deal of the day — bot curated)
│   ├── #vikend-ponude        (Friday bot post — weekend deals)
│   ├── #akcije-konzum        (per-chain deal threads)
│   ├── #akcije-lidl
│   ├── #akcije-kaufland
│   └── #akcije-ostali
│
├── ZAJEDNICA
│   ├── #general              (free chat)
│   ├── #savjeti-štednja      (savings tips)
│   ├── #recepti-na-popustu   (recipes using deal ingredients)
│   └── #paparazzo            (user-submitted store photos)
│
├── PAMETNJAKOVIĆ BOT
│   ├── #provjeri-cijenu      (price check queries)
│   └── #pitanja              (ask the bot anything)
│
├── FEEDBACK
│   ├── #bug-prijave          (bug reports → bot creates tickets)
│   ├── #ideje                (feature requests + voting)
│   └── #kvaliteta-podataka   (report wrong prices)
│
└── ADMIN (private)
    ├── #bot-alerts           (data quality, anomalies)
    ├── #moderacija           (moderation log)
    └── #analytics            (engagement metrics)
```

### 2.3 Telegram Structure

**Broadcast Channel (@TvojaKosarica):**

| Day | Time (CET) | Content |
|-----|-----------|---------|
| Mon | 08:00 | Tjedni pregled (weekly savings recap) |
| Wed | 12:00 | Pojeftinjenje tjedna (price drop of the week) |
| Fri | 16:00 | Vikend ponude (weekend deal roundup) |
| 1st of month | 10:00 | Mjesečni izvještaj o inflaciji |
| Breaking | Anytime | Significant price anomalies (>25% drops) |

**Discussion Group (Tvoja Košarica Zajednica):**
- Bot monitors and answers price questions
- Users share finds and deals
- Moderation via bot + 2 human admins
- Pinned: current week's top deals

### 2.4 Reddit Strategy

**r/TvojaKosarica:**

| Flair | Content |
|-------|---------|
| `Analiza Cijena` | Bot-generated price analyses |
| `Ponuda Dana` | Daily deal highlights |
| `Tjedni Pregled` | Monday weekly recap (automated) |
| `Savjeti` | User savings tips |
| `Bug/Feedback` | Issues and suggestions |
| `Diskusija` | General discussion |

- Bot account: u/PametnjakovicBot
- Weekly automated posts: Monday recap, Friday roundup
- Monthly: Inflation deep-dive with charts
- AutoMod: anti-spam, minimum account age (7d), karma threshold (10)

### 2.5 Admin Structure

| Platform | Bot Role | Human Admin | Escalation |
|----------|----------|-------------|------------|
| Telegram Channel | All posting | 1 editor (override option) | N/A (broadcast) |
| Telegram Group | Answer questions, moderate | 2 admins | Bot `/eskaliraj` command |
| Discord | Auto-post, price checks, moderate | 2 community managers | Bot flags → #moderacija |
| Reddit | Post analyses, reply in comments | 1 mod + AutoMod | Flagged posts → mod queue |
| Blog | Generate + publish posts | 1 editor (review option) | N/A |

---

## 3. Marketing Bot — Content Automation

### 3.1 Brand Voice in Bot Messages

**Witty Mode** (social, marketing, community):
- Sarcastic but warm — punches UP at high prices, never down at consumers
- Self-aware about being a bot: "Dok vi spavate, ja pratim 195 milijuna cijena. Bez kave."
- Croatian colloquialisms, pop culture references
- Treats saving money as a competitive sport

**Clear Mode** (price data, comparisons, alerts):
- Concise, factual, zero ambiguity
- Numbers always formatted clearly (EUR with cents, comma decimal)
- No jokes in price comparisons — users need trust

### 3.2 Content Automation Pipeline

> **Review finding:** Both reviewers flagged LLM hallucination risk with price data. LLM must NEVER touch numbers. Enforce deterministic template pipeline.

After the daily ingestion completes:

```
06:00 UTC — Daily Ingestion (existing cron)
    │
09:00 UTC — Barcode Matching (existing)
    │
10:00 UTC — Trigram Matching (existing)
    │
12:00 UTC — NEW: "content-generation" cron
    │   ├── 1. Query ClickHouse for today's price changes
    │   ├── 2. Detect anomalies (significance threshold: >15% drop)
    │   ├── 3. DETERMINISTIC TEMPLATE: Slot-fill prices, chains, percentages
    │   │      (LLM never touches numbers — template inserts verified data)
    │   ├── 4. LLM COMMENTARY ONLY: Generate witty one-liner for the post
    │   ├── 5. VALIDATION: Compare output numbers against source ClickHouse data
    │   ├── 6. VISUAL: Generate price card image (sharp/canvas)
    │   └── 7. Queue for distribution (only if significance threshold met)
    │
12:30 UTC — NEW: "content-distribution" cron
        ├── Post to Telegram channel (text + image)
        ├── Post to Facebook page (image + link)
        └── Publish to blog (weekly/monthly reports only)
```

**Content quality gates:**
- Auto-publish: deterministic deal cards (template-only, no LLM commentary)
- Human review required: analysis/opinion posts, sarcasm-heavy commentary
- Weekly human audit: sample 10-20% of auto-published posts for voice/accuracy
- Kill switch: if error rate >1% in any week, pause auto-publishing
- Max frequency: 1 high-value post/day/channel (significance threshold required)

### 3.3 Content Types with Examples

#### Daily Deal Post (Telegram/Discord)

```
🏷️ DEAL DANA — Srijeda, 5.2.2026.

Mlijeko Dukat 1L
  Konzum:  0,89 € (bilo 1,19 €) ↓25%
  Lidl:    0,95 €
  Plodine: 1,09 €

Pametnjaković kaže: "Konzum je danas odlučio
da mlijeko ne mora koštati kao da ga muzu
krave sa Alpa. Svaka čast."

Top 3 najveća pojeftinjenja danas:
1. Maslinovo ulje Zvijezda 1L: ↓18% u Kauflandu
2. Tjestenina Barilla 500g: ↓22% u Plodinama
3. WC papir Paloma 10/1: ↓15% u Studencu

Usporedi sve cijene → tvoja-kosarica.hr
```

#### Weekly Recap (Monday — all channels)

```
📊 TJEDNI PREGLED #14 | 27.1.–2.2.2026.

Prosječna košarica (30 osnovnih namirnica):
  Ovaj tjedan:  47,82 €
  Prošli tjedan: 48,15 €
  Promjena:      −0,33 € (−0,7%)

Najjeftiniji lanac za osnovnu košaricu:
  1. Lidl     — 43,20 €
  2. Eurospin — 44,50 €
  3. Kaufland — 45,10 €

Pametnjaković kaže: "Da sam mogao štedjeti
0,33 € tjedno otkad sam nastao, imao bih
dovoljno za... jedan jogurt. U Intersparu."

Usporedi sve cijene → tvoja-kosarica.hr
```

#### Monthly Inflation Report (blog + all channels)

```
📈 IZVJEŠTAJ O CIJENAMA — Siječanj 2026.

KLJUČNI PODACI:
  Hrana & piće:     +2,1% m/m
  Mlijeko & jaja:   −1,3% m/m (konačno!)
  Meso:             +3,8% m/m
  Voće & povrće:    +0,5% m/m

INDEKS KOMPETITIVNOSTI LANACA:
  Najstabilniji:     Lidl (0,3% volatilnost)
  Najnestabilniji:   Konzum (2,1% volatilnost)

Pametnjaković kaže: "Kad vam netko kaže da
su cijene stabilne, pitajte ga je li ikad
kupio piletinu u četiri različita dućana."

Puni izvještaj s grafovima →
  tvoja-kosarica.hr/izvjestaji/01-2026
```

### 3.4 Audience Segmentation

Bot generates different content per segment:

| Segment | Content Focus | Example Topic | Primary Channel |
|---------|--------------|---------------|-----------------|
| **Obitelji** | Bulk items, weekly basket, school supplies | "Tjedna košarica za obitelj od 4 — optimizirano" | Telegram |
| **Studenti** | Budget meals, cheapest basics, beer deals | "Studentski meni za 3,67 €" | Discord, Instagram |
| **Umirovljenici** | Staples, pharmacy (dm), stable basics | "Osnovne namirnice — tko je najjeftiniji ovaj tjedan" | Telegram |
| **Profesionalci** | Quality-per-EUR, organic, premium | "Kvaliteta za novac — ranking ekoloških proizvoda" | Blog, X |

**Example: Student-focused Telegram post**

```
🎓 STUDENTSKI KUTAK — Ovaj tjedan

Tjestenina Barilla 500g: 0,79 € @ Lidl
  (dovoljno za 3 obroka, svaki 0,26 €!)
Umak Podravka 400g: 0,99 € @ Konzum
Jaja 10/1: 1,89 € @ Eurospin

Pametnjaković kaže: "Za 3,67 € imate
tjedni meni. Ne hvala, ne trebam Wolt."

Usporedi cijene → tvoja-kosarica.hr
```

### 3.5 Blog / SEO Content Automation

The bot generates and publishes:

| Content Type | Frequency | SEO Target |
|-------------|-----------|------------|
| Product price pages | Daily update | "cijena mlijeka danas" |
| Store comparison pages | Daily update | "Konzum vs Lidl cijene" |
| Category price reports | Weekly | "cijene mesa u Hrvatskoj" |
| Inflation reports | Monthly | "inflacija hrane 2026 Hrvatska" |
| Savings tips articles | 2x/month | "kako uštedjeti na namirnicama" |

Example URLs:
- `tvoja-kosarica.hr/cijene/mlijeko` — "Cijena mlijeka danas u svim dućanima"
- `tvoja-kosarica.hr/usporedba/konzum-vs-lidl` — "Konzum vs Lidl — tko je jeftiniji?"
- `tvoja-kosarica.hr/izvjestaji/inflacija-01-2026` — Monthly inflation report

Each page auto-updates daily after content-generation cron, includes structured data (JSON-LD), Croatian-language meta tags.

---

## 4. Product Bot — Price Intelligence

### 4.1 Price Anomaly Detection

New cron job `price-anomaly-detection` runs after daily ingestion. Queries ClickHouse for:

1. **Price drops >15%** vs 7-day average
2. **Price spikes >15%** vs 7-day average
3. **Sudden unavailability** — items missing today that were available yesterday
4. **Cross-chain divergence >30%** — same product (via `product_links`) priced wildly different

### 4.2 Alert Flow

**Admin channel** (Discord #bot-alerts, Telegram admin):

```
⚠️ ANOMALIJA CIJENA — 5.2.2026. 12:15 UTC

Maslinovo ulje Zvijezda 1L
  Konzum: 8,99 € (jučer: 12,49 €) ↓28%
  Plodine: 12,49 € (nepromijenjeno)
  Lidl: nema u ponudi

Status: Verificirano (cijena prisutna u službenom cjeniku)
Mogući razlog: Nova akcija ili cjenička promocija
```

**Public channels** get a curated version (deals only, not raw anomalies):

```
💰 VELIKO POJEFTINJENJE

Maslinovo ulje Zvijezda 1L
  Konzum: 8,99 € (bilo 12,49 €) ↓28%

Pametnjaković kaže: "Ili je maslinovo ulje pojeftinilo,
ili je Konzum odlučio biti velikodušan. U oba slučaja,
trčite dok traje."
```

### 4.3 Trend Analysis & Reporting

Automated from ClickHouse time-series data:

- **Category-level trends**: avg price per category over 30/90 days
- **Chain competitiveness index**: cheapest basket per category per chain
- **New product tracking**: items appearing in `retailer_items` with recent `created_at`
- **Seasonal patterns**: year-over-year when data accumulates

These feed into weekly and monthly content (Section 3.3).

---

## 5. Helpdesk Bot

### 5.1 Three-Tier Support

| Tier | Handler | Examples |
|------|---------|---------|
| **Tier 1: Auto-answer** | Bot (instant) | "Što je Tvoja Košarica?", "Koliko košta?", "Odakle dolaze podaci?", "Koje dućane pokrivate?" |
| **Tier 2: Bot attempts** | Bot + escalate if unclear | "Cijena nije točna", "Nedostaje dućan", "Aplikacija ne radi" |
| **Tier 3: Human** | Human admin | Account issues, billing, partnerships, complex complaints |

### 5.2 FAQ Knowledge Base

Bot maintains a structured FAQ:

| Question | Answer Source |
|----------|-------------|
| "Što je Tvoja Košarica?" | App description (static) |
| "Koliko košta?" | Pricing tiers (static) |
| "Odakle dolaze podaci?" | Croatian law NN 75/2025, mandatory daily price lists |
| "Koliko često se ažuriraju cijene?" | Daily at 06:00 UTC |
| "Koje dućane pokrivate?" | Dynamic: 11 chains (Konzum, Lidl, Plodine, Kaufland, Spar, Studenac, Eurospin, Tommy, KTC, dm, Interspar/Trgocentar) |
| "Kako radi optimizacija košarice?" | Basket optimizer explanation |

### 5.3 Bug Report Pipeline

```
User: Cijena mlijeka u Konzumu Dubrovnik je 2,99 €
      ali u aplikaciji piše 1,19 €

Pametnjaković: Hvala na prijavi! Zabilježio sam:

  Prijava #BUG-2026-0142
  Tip: Netočna cijena
  Artikl: Mlijeko (Konzum, Dubrovnik)
  Prijavljeno: 2,99 € | U sustavu: 1,19 €
  Status: U obradi

  Proslijedit ću ovo timu za provjeru.
  Javim vam kad bude riješeno!
```

→ Creates entry in admin tracking + posts to Discord #kvaliteta-podataka

### 5.4 Feature Request + Voting

```
User: /ideja Bilo bi super skenirati račun i
      usporediti s drugim dućanima

Pametnjaković: Odlična ideja! Zabilježio sam:

  Zahtjev #FR-0089
  Kategorija: Nova funkcionalnost
  Opis: Skeniranje računa + usporedba

  Slični zahtjevi:
  - #FR-0034: OCR računa (47 glasova)

  Glasajte: /glas FR-0034

  "Volim kad korisnici imaju bolje ideje od mene.
  Ne volim što se to događa tako često."
```

---

## 6. Data Quality Bot

### 6.1 Matching Quality Monitor

After each matching run, the bot reports to admin channels:

```
📋 DATA QUALITY REPORT — 5.2.2026. 10:30 UTC

BARCODE MATCHING:
  Novi proizvodi:       23
  Novi linkovi:         156
  Sumnjivi flagovi:     7 (4 name mismatch, 3 brand conflict)
  Preskočeni (barcode): 12

TRIGRAM MATCHING:
  Obrađeno:             200
  Auto-linked (≥0.95):  45
  Za pregled (0.8-0.95): 89
  Bez matcha:           66
  Flagovi: 8 private label, 3 unit mismatch

AKCIJA POTREBNA: 7 sumnjivih barcodeova + 89 za pregled
→ admin.tvoja-kosarica.hr/products/pending
```

### 6.2 Price Data Validation

Daily checks:

1. **Freshness**: Alert if any chain >24h stale
2. **Completeness**: Compare today's store count vs expected (e.g. Konzum ~188 stores)
3. **Outliers**: price_cents = 0, negative, or >10x the 30-day average
4. **Duplicates**: `retailer_items` with same name+chain+unit but `merged_into_id IS NULL`

### 6.3 Data Freshness Dashboard

```
🔄 SVJEŽINA PODATAKA — 5.2.2026. 07:00 UTC

  Konzum:     5.2. 06:15  ✅
  Lidl:       5.2. 06:08  ✅
  Plodine:    5.2. 06:22  ✅
  Kaufland:   5.2. 06:11  ✅
  Studenac:   5.2. 06:30  ✅
  Eurospin:   5.2. 06:18  ✅
  dm:         5.2. 06:05  ✅
  KTC:        4.2. 06:12  ⚠️ STALE (24h)
  Metro:      5.2. 06:25  ✅
  Trgocentar: 5.2. 06:33  ✅
  Interspar:  5.2. 06:20  ✅

⚠️ KTC ingestion may have failed
→ admin.tvoja-kosarica.hr/ingestion?chain=ktc
```

### 6.4 User Reliability Scoring (V2.0+)

For crowdsourced data (Paparazzo, price reports, availability reports):

| Trust Tier | Criteria | Data Handling |
|-----------|----------|---------------|
| `new` | <10 reports | All reports queued for verification |
| `trusted` | >10 reports, >80% accuracy | Reports accepted with spot-checks |
| `verified` | >50 reports, >90% accuracy | Reports auto-accepted |
| `flagged` | >30% rejection rate | All reports manually reviewed |

Scoring signals:
- Report confirmed by price data → +1 trust
- Report contradicted by price data → −2 trust
- Report matches other user reports → +0.5 trust
- Report flagged as spam/abuse → −5 trust

---

## 7. Launch Day Marketing — Bot Goes Live With App

> **Decision:** No pre-launch content posting. Channels set up beforehand but empty. Bot goes live Day −1 (teaser) and Day 0 (launch). Every post links to a live product.

### Pre-Launch Setup (Before Launch Day)

Prepare infrastructure only — no public content:
- Create Telegram channel (@TvojaKosarica) — empty, ready
- Create Facebook page — empty, ready
- Set up blog on tvoja-kosarica.hr/blog — empty, ready
- Build content pipeline (templates, LLM prompts, image generation)
- Test content quality internally (dry runs to admin channel)
- Prepare launch day content pack (5-7 posts queued)
- Prepare press kit: inflation report, brand assets, one-pager

### Day −1: Teaser

One single post across all channels:

```
Pametnjaković kaže: "Sutra u ovo vrijeme,
znat ćete točnu cijenu svake namirnice
u svakom dućanu u Hrvatskoj.

Besplatno. Svaki dan.

Vidimo se sutra. → tvoja-kosarica.hr"
```

### Day 0: Launch

Bot publishes its first content across all V1.0 channels simultaneously:

**Launch post (Telegram + Facebook):**

```
Pametnjaković kaže: "Dok vi uspoređujete letake,
ja sam upravo usporedio 195 milijuna cijena.

Tvoja Košarica je live. Pronađi najjeftinije
namirnice u svim dućanima u Hrvatskoj.

Besplatno. Svaki dan. Automatski.

→ tvoja-kosarica.hr"
```

**First deal post (same day, afternoon):**

```
PRVI DEAL DANA

Mlijeko Dukat 1L
  Lidl:     0,95 €
  Kaufland: 1,05 €
  Konzum:   1,19 €

Razlika: 25%. Na 30 namirnica tjedno,
to je 50+ € godišnje.

Pametnjaković kaže: "Rekao sam vam
da ću vam uštedjeti novac. Evo, počnimo."

→ tvoja-kosarica.hr/cijene/mlijeko
```

### Post-Launch Content Calendar (Week 1+)

| Day | Content | Channel |
|-----|---------|---------|
| Mon | Tjedni pregled (weekly recap) | Telegram, Blog |
| Wed | Pojeftinjenje tjedna (biggest price drop) | Telegram, Facebook |
| Fri | Vikend ponude (weekend deals) | Telegram, Facebook |
| Daily | Deal dana (if significance threshold met) | Telegram |
| Monthly | Izvještaj o inflaciji (inflation report) | Blog, Telegram, Facebook, Media |

### Marketing Channels: Bot's Role Summary

| Channel | Bot's Marketing Job | Frequency |
|---------|-------------------|-----------|
| Telegram Channel | Daily deal card, weekly recap, monthly report | 1/day max |
| Facebook Page | Visual price cards, shareable infographics | 3-5/week |
| Blog | SEO price pages, inflation reports, savings guides | 2-3/week |
| Facebook Groups | Share valuable content (human-reviewed, not spam) | 2-3/week |
| Media/PR | Generate press-ready inflation reports + media kit | Monthly |
| Influencers | Generate personalized savings data for partnerships | As needed |

---

## 8. MVP Phase Integration

> **Review finding:** Both reviewers scored original MVP phasing 3.5-4/10. "Over-scoped for a pre-launch MVP." Revised below with aggressive de-scoping and channel sequencing.

### V1.0 "Prove Trust" — Ship WITH App (4-6 weeks, 1 developer)

**Marketing & Community (PRIMARY FOCUS):**

| Feature | Effort | Priority |
|---------|--------|----------|
| Telegram broadcast channel (daily deals, weekly report) | 1 week | P0 |
| Facebook page (visual deal card auto-posting) | 3 days | P0 |
| Visual price card image generation (sharp/canvas) | 1 week | P0 |
| Content pipeline: Data → Template → LLM commentary → Validate → Post | 2 weeks | P0 |
| Blog: weekly inflation report + auto-updating price pages (SEO) | 1 week | P0 |
| Waitlist + launch countdown (pre-launch Phase 2-3) | 3 days | P0 |

**Operations (SECONDARY):**

| Feature | Effort | Priority |
|---------|--------|----------|
| Data freshness monitoring → admin Telegram alerts | 3 days | P0 |
| Price anomaly detection → admin alerts | 1 week | P1 |

### V1.5 "Expand Reach" (+2-3 months)

| Feature | Effort |
|---------|--------|
| Telegram discussion group (moderated) | 1 week |
| WhatsApp Business broadcast (families/pensioners) | 1 week |
| Discord server (tech/student niche) | 1 week |
| Helpdesk FAQ bot (Telegram) | 3 days |
| Bug report pipeline | 3 days |
| Audience segmentation (families/students/pensioners) | 2 weeks |
| Viber channel (if API permits — investigate) | 1 week |

### V2.0 "Community" (+6 months)

| Feature | Effort |
|---------|--------|
| Reddit auto-posting (weekly analyses) | 1 week |
| Feature request + voting system | 1 week |
| User reliability scoring (Paparazzo) | 2 weeks |
| `/cijena` price check commands (Telegram/Discord) | 1 week |
| Instagram/X automated posting | 2 weeks |
| Shopping list building via Telegram | 2 weeks |

### V3.0 "Platform" (+12 months)

| Feature | Effort |
|---------|--------|
| Personalized deal recommendations via bot DM | 3 weeks |
| Barcode scanning via Telegram photo | 2 weeks |
| Receipt OCR via Telegram photo | 4 weeks |
| AI-powered meal planning from deals | 4 weeks |

---

## 9. Technical Architecture

### 9.1 System Architecture

```
                     ┌──────────────────────────┐
                     │     OpenClaw Gateway      │
                     │  (Pametnjaković Agent)    │
                     │  LLM: Claude / GPT        │
                     │  Skills: košarica-*        │
                     │  Memory: per-user prefs    │
                     └─────────┬────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐ ┌──────▼───────┐ ┌──────▼──────┐
     │   Telegram    │ │   Discord    │ │   Reddit    │
     │ Channel+Group │ │   Server     │ │  r/TK Bot   │
     └───────────────┘ └──────────────┘ └─────────────┘
                               │
                     ┌─────────▼────────────────┐
                     │   Košarica API Client     │
                     │   (OpenClaw Skill)        │
                     │   HTTP → oRPC             │
                     │   Direct → ClickHouse     │
                     └─────────┬────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐ ┌──────▼───────┐ ┌──────▼──────┐
     │  Node.js oRPC │ │  ClickHouse  │ │ PostgreSQL  │
     │  (port 3000)  │ │  (port 8123) │ │ (port 5432) │
     │  search.*     │ │  prices      │ │ retailer_   │
     │  prices.*     │ │  argMax()    │ │   items     │
     │  basket.*     │ │  trends      │ │ products    │
     └───────────────┘ └──────────────┘ └─────────────┘
```

### 9.2 OpenClaw Skills

| Skill | Purpose | Backend Integration |
|-------|---------|-------------------|
| `kosarica-prices` | Price lookup, comparison | oRPC `prices.*`, `search.*` |
| `kosarica-analytics` | Trends, anomalies, reports | ClickHouse direct queries |
| `kosarica-content` | Content gen in Pametnjaković voice | LLM + brand voice system prompt |
| `kosarica-helpdesk` | FAQ, bug reports, feature requests | FAQ knowledge base + admin notif |
| `kosarica-data-quality` | Freshness, matching, validation | PostgreSQL matching tables + ClickHouse |

### 9.3 New Cron Jobs

Added to existing cron registry (`src/jobs/cron/jobs.ts`):

| Job ID | Schedule | Purpose |
|--------|----------|---------|
| `content-generation` | 12:00 UTC daily | Generate deal posts, analyses |
| `content-distribution` | 12:30 UTC daily | Post to all channels |
| `data-quality-report` | 08:00 UTC daily | Admin quality report |
| `weekly-report` | Sun 18:00 UTC | Weekly price recap |
| `monthly-report` | 1st, 10:00 UTC | Monthly inflation report |

Requires adding `"bot-content"` to `TaskType` union in `src/lib/taskqueue/index.ts`.

### 9.4 Integration Paths

| Path | Use Case | Method |
|------|----------|--------|
| **oRPC HTTP** | User-facing queries (price check, search) | HTTP calls to Node.js API |
| **ClickHouse direct** | Analytics, content generation, anomaly detection | Direct SQL via `getClickHouse()` |
| **PostgreSQL direct** | Data quality checks, matching reports | Direct SQL via `getDb()` |

### 9.5 Deployment

```
Production (Hetzner VPS) — Docker Compose
│
├── kosarica-app (existing)
│   ├── Node.js frontend + API
│   ├── Cron scheduler
│   └── Task worker
│
├── kosarica-bot (NEW)
│   ├── OpenClaw Gateway
│   ├── Pametnjaković Agent
│   └── Skills: košarica-*
│
├── postgres (existing)
└── clickhouse (existing)
```

Bot runs as separate Docker service with access to same DB instances.

---

## 10. Ethics & Safety

### 10.1 Bot Disclosure

Every bot interaction identifies itself as AI:

| Platform | Disclosure |
|----------|-----------|
| Telegram | Messages from `@PametnjakovicBot` (bot account) |
| Discord | Bot badge visible, bio: "AI asistent za cijene" |
| Reddit | User flair: `[BOT]` on all posts/comments |
| Blog | Footer: "Generirano uz pomoć AI-ja, verificirano podacima" |

First DM interaction:

```
Bok! Ja sam Pametnjaković, AI asistent za usporedbu
cijena. Nisam čovjek, ali pratim cijene bolje od većine.

Što mogu za vas? /pomoć za popis komandi.
```

### 10.2 Privacy (GDPR)

1. **Data minimization**: Bot stores only user ID, channel, and preferences. No PII beyond platform handle.
2. **Consent**: Joining channels = consent for community features. Explicit opt-in for: price alerts (notifications), location features, shopping list storage.
3. **Right to erasure**: `/obriši-podatke` deletes all user data. Confirmation required.
4. **Retention**: Conversation logs 90 days, then auto-purged. Anonymized analytics kept indefinitely.
5. **Transparency**: Privacy policy linked in `/pomoć` and all channel descriptions.

### 10.3 Price Misinformation Prevention

1. **Source attribution**: Every price includes chain name + data timestamp
2. **Staleness warning**: If data >24h old: "Zadnje ažuriranje: jučer u 06:00. Cijena se možda promijenila."
3. **No predictions**: Bot never predicts future prices — only current and historical
4. **Disclaimer**: "Cijene se odnose na online objavljene cjenike. Stvarne cijene u dućanu mogu se razlikovati."
5. **Error correction**: Confirmed wrong prices get correction posted in same channel

### 10.4 Community Moderation

- **Profanity filter**: Croatian + English
- **Rate limiting**: Max 5 messages/minute per user in groups
- **Anti-spam**: Duplicate message detection, link restrictions for new members
- **Discord**: 10-minute cooldown for new members
- **Reddit**: AutoMod minimum account age (7d), karma (10)
- **Three-strike system**: warn → 24h mute → ban

---

## 11. Metrics & KPIs

### 11.1 Community Growth Targets (Review-Adjusted)

> **Review finding:** Codex flagged 10K in 180d as over-optimistic for Croatian market (~4M pop). Track deduplicated reachable community, not raw totals.

| Metric | V1.0 (30d) | V1.5 (90d) | V2.0 (180d) |
|--------|-----------|-----------|-------------|
| Telegram Channel subscribers | 300 | 1,200 | 3,000 |
| Facebook Page followers | 200 | 1,000 | 3,000 |
| Telegram Group members | — | 200 | 600 |
| WhatsApp broadcast | — | 300 | 1,000 |
| Discord members | — | 300 | 800 |
| **Deduped reachable community** | **~400** | **~2,000** | **~5,000** |

Note: Cross-channel overlap estimated at 30-40%. Track unique users, not raw follower totals.

### 11.2 Content Engagement

| Metric | Target |
|--------|--------|
| Telegram post views / subscribers | >30% |
| Telegram post forwards / viewers | >5% |
| Discord weekly active / total members | >25% |
| Reddit post average upvotes | >50 |
| Content click-through to app | >8% |

### 11.3 Bot Effectiveness

| Metric | Target |
|--------|--------|
| Price query accuracy | >98% |
| FAQ resolution without human | >85% |
| Bug report follow-up rate | 100% |
| Median response time | <3 seconds |
| User satisfaction (thumbs up/down) | >4:1 |

### 11.4 Conversion Attribution

| Source | Tracking Method |
|--------|----------------|
| Telegram → App signup | `?utm_source=telegram&utm_medium=bot` |
| Discord → App signup | Unique Discord invite URL |
| Reddit → App signup | `?utm_source=reddit` |
| Bot DM → App signup | Bot-generated unique signup link |
| Blog → App signup | `?utm_source=blog&utm_medium=seo` |
| Content share → New user | Trackable links per deal post |

### 11.5 Growth Loop Metrics

| Loop | Key Metric | Target |
|------|-----------|--------|
| Share a Deal | Viral coefficient (new users per share) | K > 0.3 |
| Savings Counter | Organic social mentions/month | >50 |
| Media/PR | Media pickups per monthly report | >2 |
| Community → App | Community member → app signup rate | >40% |

---

*See also: [UX-BRANDING-GUIDELINES.md](./UX-BRANDING-GUIDELINES.md) | [CONVERSION-STRATEGY.md](./CONVERSION-STRATEGY.md)*
