# AI Marketing Copilot Strategy — Tvoja Košarica

**Version:** 1.0 — Initial draft
**Date:** 2026-02-06
**Status:** Draft — pending review
**Companion doc:** [AI-BOT-STRATEGY.md](./AI-BOT-STRATEGY.md) (autonomous bot deployment — separate concern)

---

## Table of Contents

1. [Philosophy — "AI Prepares, You Publish"](#1-philosophy--ai-prepares-you-publish)
2. [Cold Start — Master Account Setup](#2-cold-start--master-account-setup)
3. [The Content Pipeline](#3-the-content-pipeline)
4. [Platform Playbooks](#4-platform-playbooks)
5. [Content Templates Library](#5-content-templates-library)
6. [Guerrilla & Creative Tactics](#6-guerrilla--creative-tactics)
7. [Multi-AI Workflow](#7-multi-ai-workflow)
8. [Founder's Weekly Workflow](#8-founders-weekly-workflow)
9. [Pre-Launch Timeline](#9-pre-launch-timeline-day--90-to-day-0)
10. [Metrics & Growth Targets](#10-metrics--growth-targets)
11. [Technical Implementation Reference](#11-technical-implementation-reference)

---

## 1. Philosophy — "AI Prepares, You Publish"

### Why Copilot, Not Autopilot

The [AI-BOT-STRATEGY.md](./AI-BOT-STRATEGY.md) covers deploying Pametnjaković as an autonomous bot across community channels. That strategy is valuable post-launch when content volume demands automation.

**This document covers a different approach: AI as your marketing copilot.**

The distinction matters:

| | Bot Strategy (Autopilot) | Copilot Strategy (This Doc) |
|---|---|---|
| **Who posts** | Bot posts autonomously | Founder posts personally |
| **AI role** | Content creator + distributor | Content drafter + research assistant |
| **Human role** | Oversight, moderation | Review, edit, publish |
| **Best for** | Scale (high volume, owned channels) | Trust (new accounts, other people's platforms) |
| **Risk** | Content drift, spam perception | Slower pace, founder time |
| **When** | Post-launch, after community trust exists | Pre-launch and early growth |

### Core Principles

1. **AI does the heavy lifting, you hold the pen.** AI queries price data, generates drafts, suggests timing, formats images. You review, add your voice, and hit publish.

2. **Authenticity beats volume.** Three excellent posts per week from a real person outperform twenty bot-generated posts. New accounts on Reddit, forum.hr, Facebook groups get destroyed if they smell like promotion bots.

3. **Data is your unfair advantage.** You have real-time price data across 11 Croatian retail chains. Nobody else has this. Every piece of content should be backed by verifiable numbers. This is what makes organic marketing work without budget — you offer genuine value.

4. **Marketing ships with MVP, not after.** Content creation and community engagement start Day -90. By launch day, you already have reputation, followers, and SEO authority. Marketing is not a phase — it's a parallel workstream from day one.

5. **Zero budget, maximum leverage.** No paid ads. Every kuna of marketing value comes from genuine participation, valuable data, and smart content distribution. The AI copilot makes this sustainable for a solo founder.

---

## 2. Cold Start — Master Account Setup

Starting from zero. No pre-existing social accounts. Fresh Gmail created for this project.

### 2.1 Account Creation Checklist

Create all accounts in one session. Reserve handles early — even for platforms you won't use immediately.

| # | Platform | Handle/Name | Login | Phase | Notes |
|---|----------|-------------|-------|-------|-------|
| 1 | **Gmail** | tvoja.kosarica@gmail.com | — | Day -90 | Master account for all platforms |
| 2 | **Facebook (personal)** | Your real name | Gmail | Day -90 | Join groups as person, not brand |
| 3 | **Facebook Page** | Tvoja Košarica | Gmail | Day -60 | Create page, but focus on groups first |
| 4 | **Reddit** | Your real-ish username | Gmail | Day -90 | NOT u/TvojaKosarica — personal account builds trust |
| 5 | **forum.hr** | Personal username | Gmail | Day -90 | Same — be a person first |
| 6 | **Telegram** | @TvojaKosarica | Phone | Day -60 | Channel (broadcast), reserve name early |
| 7 | **Twitter/X** | @TvojaKosarica | Gmail | Day -60 | Reserve handle, low priority early |
| 8 | **GitHub** | Organization or personal | Gmail | Day -45 | For "building in public" |
| 9 | **Product Hunt** | Maker profile | Gmail | Day -30 | Needs community reputation pre-launch |
| 10 | **Viber** | Tvoja Košarica Community | Phone | Day -30 | Croatian 40+ demographic |
| 11 | **Google Search Console** | tvoja-kosarica.hr | Gmail | Day -75 | SEO tracking from first blog post |
| 12 | **Google Analytics** | tvoja-kosarica.hr | Gmail | Day -75 | Traffic attribution |

### 2.2 Account Security

- 2FA enabled on every account (TOTP preferred over SMS)
- Password manager (Bitwarden free tier)
- Separate recovery email if main Gmail gets locked
- Document all handles in a private spreadsheet

### 2.3 Cold Start Reputation Strategy

**The Rule: No promotion until your account has credibility.** New accounts that immediately post links get flagged, downvoted, or banned.

**Platform-specific reputation thresholds before any self-promotion:**

| Platform | Minimum Activity | Timeframe | What "Activity" Means |
|----------|-----------------|-----------|----------------------|
| Reddit | 200+ comment karma, 20+ comments | 4 weeks | Helpful comments in r/croatia, r/frugal, r/zagreb |
| forum.hr | 30+ posts, active in 2+ sections | 4 weeks | Answer real questions in Trgovine, Kućanstvo |
| Facebook Groups | Member for 2+ weeks, 10+ comments | 2 weeks | React, comment genuinely on deals others post |
| Product Hunt | 5+ upvotes, 3+ discussions | 2 weeks | Engage with other makers' products |

**AI helps with reputation building:**
- Each morning, AI generates a "Daily Engagement Brief" — 3-5 specific threads to comment on with drafted responses
- You review, personalize, and post
- This keeps effort to ~15 min/day during the reputation phase

---

## 3. The Content Pipeline

### 3.1 How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                   DAILY CONTENT PIPELINE                     │
│                     (12:00 UTC cron)                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. QUERY ClickHouse                                         │
│     ├── Top price drops (>15% threshold)                     │
│     ├── Weekly basket index (30 staple items × 11 chains)    │
│     ├── Chain competitiveness scores                         │
│     ├── Trending categories (week-over-week)                 │
│     └── Price anomalies and outliers                         │
│                                                              │
│  2. GENERATE DRAFTS                                          │
│     ├── Apply content template (deterministic structure)     │
│     ├── Slot-fill with real numbers (NEVER LLM-generated)    │
│     ├── LLM adds commentary only (Pametnjaković voice)      │
│     └── Generate visual cards (Sharp/Canvas)                 │
│                                                              │
│  3. VALIDATE                                                 │
│     ├── Compare output numbers vs. ClickHouse source         │
│     ├── Check for banned claims / hallucinated data          │
│     └── Verify links and UTM parameters                      │
│                                                              │
│  4. STORE IN REVIEW QUEUE                                    │
│     ├── Each draft tagged: platform, content type, timing    │
│     ├── Status: draft → approved → published / rejected      │
│     └── Data snapshot attached (for audit trail)             │
│                                                              │
│  5. FOUNDER REVIEWS                                          │
│     ├── Admin panel: /admin/content-drafts                   │
│     ├── Read draft, edit if needed, approve or reject        │
│     └── Approved drafts → copy text + download image → post  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 What Makes This Different From the Bot Strategy

| Aspect | Bot Strategy | Copilot Strategy |
|--------|-------------|-----------------|
| **Publishing** | Bot publishes directly to owned channels | Founder copies approved content and posts manually |
| **Channels** | Telegram, Discord, own Reddit sub | Other people's Facebook groups, forums, Reddit subs |
| **Voice** | Bot persona (Pametnjaković) | Founder's personal voice (sometimes with Pametnjaković quotes) |
| **Speed** | Automated, instant | Founder reviews daily, posts at optimal times |
| **Flexibility** | Template-bound | Founder can adapt on the fly, respond to comments |

### 3.3 Content Safety Rules

Inherited from [AI-BOT-STRATEGY.md](./AI-BOT-STRATEGY.md):

1. **LLM never touches price numbers.** All prices come from deterministic template slot-filling against ClickHouse data.
2. **Every post includes data timestamp and source.** Example: "Cijene iz službenih cjenika, ažurirano 5.2.2026. 06:00 UTC"
3. **Correction flow ready.** If a price is wrong, respond within 1 hour with correction + apology.
4. **No superlatives without data.** Never "cheapest ever" — always "cheapest this week in our data."

---

## 4. Platform Playbooks

### Priority Matrix

| Priority | Platform | Audience | Why This Priority |
|----------|----------|----------|-------------------|
| **P0** | Facebook Groups | Croatian families, deal hunters | Highest organic reach for Croatian consumers |
| **P0** | forum.hr / bug.hr | Croatian general public | Established communities, price discussion threads |
| **P0** | Blog/SEO | Search traffic | Compounds over time, permanent content |
| **P0** | Telegram Channel | Deal subscribers | Owned channel, direct reach |
| **P1** | Viber Communities | Croatian 40+ demographic | Critical demographic, high trust platform |
| **P1** | Reddit | Mixed (Croatian + international) | Data visualization potential, tech credibility |
| **P1** | Twitter/X | Tech/startup community | Building in public, data-driven tweets |
| **P2** | Hacker News / Indie Hackers | Developers, makers | Launch events, technical credibility |
| **P2** | Product Hunt | Early adopters, tech audience | Coordinated launch event |
| **P2** | Instagram | Young adults | Visual content, stories |
| **P2** | WhatsApp Business | Families, pensioners | Digest broadcasts |

---

### 4A. Facebook Groups (P0)

**Why P0:** Facebook groups are the #1 organic acquisition channel for grocery deals in Croatia. Groups like "Akcije i popusti" have tens of thousands of members actively discussing prices.

**Target Groups (search and join during reputation phase):**

| Group Type | Search Terms | Examples |
|-----------|-------------|---------|
| Deal-focused | "akcije", "popusti", "kuponi", "štednja" | "Akcije i popusti u Hrvatskoj", "Štedljivi Hrvati" |
| City/regional | "Zagreb akcije", "Split kupovina" | "Mame Zagreba" (has deal threads), "Splitske akcije" |
| Chain-specific | "Lidl akcije", "Konzum" | "Lidl Hrvatska - akcije i iskustva", "Kaufland kupci" |
| Budget living | "studentski život", "štednja savjeti" | "Studentski život Zagreb", "Život na budžetu" |

**AI Content Pack (Weekly — generated Monday, posted Wed/Fri/Sun):**

**Wednesday — "Vikend se planira" (mid-week deals):**
```
📊 Usporedba cijena: Mlijeko Dukat 1L

Konzum:  0,89 € (↓25% od prošlog tjedna)
Lidl:    0,95 €
Plodine: 1,09 €
Kaufland: 0,99 €
Studenac: 1,15 €

Izvor: tvoja-kosarica.hr | Cijene iz cjenika, 5.2.2026.

Tip: Ako kupujete tjednu zalihu mlijeka (7L),
razlika između Konzuma i Studenca = 1,82 € tjedno = 94,64 € godišnje.
```

**Friday — "Vikend ponude" (weekend deals roundup):**
```
🏷️ Top 5 pojeftinjenja ovaj vikend (7.-9.2.2026.)

1. Maslinovo ulje Zvijezda 1L → Kaufland: 5,99 € (↓18%)
2. Tjestenina Barilla 500g → Plodine: 0,89 € (↓22%)
3. WC papir Paloma 10/1 → Studenac: 2,49 € (↓15%)
4. Piletina svježa 1kg → Lidl: 4,99 € (↓12%)
5. Deterdžent Persil 2L → Konzum: 6,49 € (↓20%)

Kompletna usporedba: tvoja-kosarica.hr
Cijene iz službenih cjenika, ažurirano 7.2.2026. 06:00 UTC
```

**Sunday — "Košarica Index" (weekly basket comparison):**
```
📊 KOŠARICA INDEX — Tjedan 6/2026 (3.-9.2.)

Košarica od 30 osnovnih namirnica:

1. Lidl     — 43,20 €
2. Eurospin — 44,50 €
3. Kaufland — 45,10 €
4. Plodine  — 46,80 €
5. Konzum   — 47,90 €
...

Prosječna košarica: 46,12 € (↓0,7% vs prošli tjedan)

Razlika najjeftiniji↔najskuplji: 6,20 €/tjedan = 322 €/godišnje

Tko prati, uštedi. Cijene iz službenih cjenika.
tvoja-kosarica.hr
```

**Comment Templates (AI-drafted, for engaging in discussions):**

When someone asks "Gdje je najjeftinije X?":
```
Upravo sam provjerio/la — [proizvod] je trenutno najjeftiniji u [lanac]
za [cijena] €. U [lanac2] je [cijena2] €, razlika od [X] €.

Imam pristup dnevnim cjenicima svih lanaca pa mogu provjeriti.
Slobodno pitajte za bilo koji proizvod.
```

When someone posts a deal:
```
Odlična cijena! Za usporedbu, u [drugim lancima] to košta
[cijena1] € / [cijena2] € / [cijena3] €.
Definitivno se isplati uhvatiti ovu akciju.
```

**Rules:**
- Post as personal account, NEVER as brand page in other people's groups
- Clear Mode voice — no Pametnjaković persona in other people's groups
- Always include data source and timestamp
- Max 3 posts per week per group — respect the community
- If an admin asks you to stop or slow down, comply immediately
- Never argue about prices in comments — respond with data + correction flow

---

### 4B. Croatian Forums — forum.hr, bug.hr (P0)

**Why P0:** forum.hr is Croatia's largest online forum. Threads about prices, stores, and deals are active daily. Building reputation here creates long-term organic discovery.

**Target Sections:**
- forum.hr → "Trgovine i kupovina" → active price comparison threads
- forum.hr → "Kućanstvo" → household budget discussions
- forum.hr → "Računala i internet" → tech/app discussions (for launch)
- bug.hr → "Off-topic" → general lifestyle and budget threads

**Strategy (4 phases):**

**Phase 1 — Pure lurking (Week 1):**
- Read active threads, understand community norms and tone
- Identify regular posters who discuss prices
- Note which topics get the most engagement

**Phase 2 — Helpful comments (Weeks 2-4):**
AI drafts responses to questions like:
- "Gdje kupujete mlijeko?" → respond with current prices across chains
- "Je li Lidl stvarno najjeftiniji?" → respond with data for specific basket
- "Koliko su poskupile namirnice?" → respond with month-over-month data

Example AI-drafted forum response:
```
Upravo sam pogledao cjenike — situacija za osnovne namirnice
ovaj tjedan:

Mlijeko 1L: Konzum 0,89€ | Lidl 0,95€ | Kaufland 0,99€
Kruh bijeli: Konzum 1,29€ | Plodine 1,19€ | Lidl 0,99€
Jaja 10/1: Konzum 2,49€ | Studenac 2,29€ | Kaufland 2,39€

Pratim cijene svaki dan iz službenih cjenika. Ako vas zanima
neki konkretan proizvod, mogu provjeriti.
```

**Phase 3 — Thread starter (Week 5+):**
- Start a weekly price comparison thread: "Tjedna usporedba cijena — Tjedan 6/2026"
- Post your Košarica Index data
- Invite others to share their experiences
- This becomes your "owned thread" on a platform you don't own

**Phase 4 — Organic mention (Week 8+):**
- Only after you have 50+ helpful posts and community recognition
- Mention in context: "Inače radim na alatu koji automatski prati cijene svih lanaca..."
- Never lead with the app — always lead with the data

---

### 4C. Blog / SEO (P0)

**Why P0:** Blog content compounds over time. A well-optimized article about "usporedba cijena hrane" can drive organic traffic for years. This is your long-term acquisition engine.

**Content Types (AI drafts all, founder edits):**

**1. Evergreen SEO Pages (auto-updated daily):**
- "Usporedba cijena mlijeka u Hrvatskoj — [aktualno]"
- "Najjeftinije namirnice u Zagrebu — tjedni pregled"
- "Cijene u Konzumu vs. Lidlu — detaljna usporedba"
- These pages update daily with fresh price data → Google rewards freshness

**2. Monthly Inflation Reports:**
```markdown
# Cijene hrane u Hrvatskoj — Siječanj 2026.

## Ključni podaci
- Prosječna košarica (30 namirnica): 46,12 € (+2,1% vs. prosinac)
- Najjeftiniji lanac: Lidl (43,20 €)
- Najveće poskupljenje: Meso (+3,8%)
- Najveće pojeftinjenje: Mlijeko i jaja (−1,3%)

## Detaljna analiza po kategorijama
[Tablica s cijenama po kategoriji i lancu]

## Indeks kompetitivnosti lanaca
[Ranglista volatilnosti cijena po lancu]

## Metodologija
Podaci su prikupljeni iz službenih cjenika 11 hrvatskih
maloprodajnih lanaca. Košarica od 30 namirnica odabrana je
prema DZS metodologiji za prosječnu hrvatsku obitelj.
```

**3. Seasonal Shopping Guides:**
- "Kako uštedjeti na školskoj opremi — Rujan 2026"
- "Božićna košarica: usporedba cijena za tradicionalni ručak"
- "Ljetni roštilj: gdje kupiti meso, povrće i piće najjeftinije"

**4. Savings Strategy Articles:**
- "5 načina kako prosječna obitelj može uštedjeti 300€ godišnje na hrani"
- "Zašto je važno usporediti cijene — i koliko zapravo možete uštedjeti"
- "Analiza: Koja je stvarna razlika između premijskih i jeftinih proizvoda"

**Target Keywords (Croatian):**
| Keyword | Search Intent | Content Type |
|---------|--------------|-------------|
| "usporedba cijena hrane" | Informational | Evergreen comparison page |
| "najjeftinije namirnice" | Transactional | Weekly deals roundup |
| "cijene hrane Hrvatska 2026" | Informational | Monthly inflation report |
| "akcije konzum" / "akcije lidl" | Transactional | Chain-specific pages |
| "koliko košta prosječna košarica" | Informational | Košarica Index page |
| "kako uštedjeti na hrani" | Informational | Savings guide article |
| "inflacija hrane Hrvatska" | Informational | Monthly report, press-ready |

**SEO Technical:**
- Each product comparison page = auto-generated, auto-updated
- Internal linking between related pages (mlijeko → košarica index → savings guide)
- Schema.org structured data for product pricing (rich snippets)
- Sitemap auto-updated when new pages are generated
- Google Search Console monitoring from Day -75

---

### 4D. Telegram Channel (P0)

**Why P0:** Owned channel with direct reach. No algorithm between you and subscribers. Every subscriber sees every message.

**Handle:** @TvojaKosarica (reserve immediately)

**Content Cadence:**

| Day | Time (CET) | Content | AI Generates |
|-----|-----------|---------|-------------|
| Mon | 08:00 | Tjedni pregled (weekly recap) | Full draft + image |
| Wed | 12:00 | Pojeftinjenje tjedna (price drop spotlight) | Draft + card |
| Fri | 16:00 | Vikend ponude (weekend deals) | Full roundup + cards |
| 1st | 10:00 | Mjesečni izvještaj (monthly report) | Full draft + charts |
| Breaking | When threshold met | Significant price anomaly (>25% drop) | Alert draft |

**Voice:** Light Pametnjaković — this is your owned channel, so brand personality is appropriate here. But keep it subtle until audience grows.

**Growth:**
- Link from every Facebook group post: "Više usporedbi → @TvojaKosarica na Telegramu"
- Link from every forum post (once reputation is established)
- Link from blog articles: "Primaj dnevne obavijesti → Telegram"
- Cross-promote from Viber (for tech-savvy segment of Viber audience)

---

### 4E. Viber Communities (P1)

**Why P1 (not P0):** Viber has higher penetration than Telegram in Croatia for 40+ demographic — the family grocery decision-makers. But Viber's automation/API is limited, so start manual.

**Community name:** "Tvoja Košarica | Akcije u Hrvatskoj"

**Content:**
- 1-3 posts/week (don't overwhelm)
- Visual deal cards optimized for mobile: larger text, simpler layout, high contrast
- Weekly Košarica Index (Sunday evening)
- Weekend deals (Friday afternoon)
- Pinned: "Kako provjeravamo cijene (timestamp + izvor)"

**Voice:** Clear Mode only. No jokes, no persona. The 40+ demographic values trust and clarity over entertainment.

**Execution:**
- Manual posting for first 30 days — don't block growth on tooling
- AI prepares content + cards, founder copies to Viber
- If community grows past 200, evaluate Viber bot API for automation

---

### 4F. Reddit (P1)

**Why P1:** Reddit requires the longest reputation-building phase. But once established, data-driven OC posts can reach millions. The r/dataisbeautiful angle is unique — nobody is doing Croatian grocery price visualizations.

**Subreddits (by content type):**

| Subreddit | Language | Content | Approach |
|-----------|----------|---------|----------|
| r/croatia | Croatian | Price insights, weekly index, discussions | Helpful comments → weekly threads |
| r/zagreb | Croatian | Zagreb-specific deals and prices | Local relevance, helpful data |
| r/dataisbeautiful | English | OC price visualizations, charts | High-quality OC posts (monthly) |
| r/frugal | English | Tips + Croatian price data context | Occasional comments with local insight |
| r/EuropeFIRE | English | European cost of living data | Monthly data contributions |
| r/personalfinance | English | Grocery optimization strategies | Occasional relevant comments |

**Reddit Account Building (AI-assisted):**

**Weeks 1-4 — Comment Karma Building:**
AI generates daily engagement brief:
```
Today's Reddit Engagement Tasks:

1. r/croatia — Thread: "Koji supermarket vam je najdraži?"
   Drafted comment: "Pratim cijene svih lanaca svaki dan.
   Po čistoj matematici, Lidl je najjeftiniji za osnovnu
   košaricu, ali Konzum ima širi asortiman. Ovisi što kupujete."

2. r/frugal — Thread: "Grocery shopping tips?"
   Drafted comment: "In Croatia, price differences between
   chains can be €300+/year for the same basket. The key is
   checking prices before shopping, not brand loyalty."

3. r/dataisbeautiful — Upvote and comment on 2-3 OC posts
   (build commenting history before posting OC)
```

**Week 5+ — First OC Post (r/dataisbeautiful):**

Title: "[OC] I tracked grocery prices across 11 Croatian retail chains for 30 days. Here's what I found."

AI prepares:
- Visualization (chart/heatmap) showing price variance by category and chain
- Post text with methodology, data source, tool description
- Responses to anticipated questions ("How did you get this data?", "Can you do this for my country?")

**Monitoring:**
- Set up [F5Bot](https://f5bot.com) (free) to alert on keywords:
  - "cijene hrane" / "usporedba cijena" / "grocery Croatia"
  - "Konzum" / "Lidl" / "Kaufland" (when paired with "cijena" or "skupo")
  - "price comparison" / "grocery app"
- When alerted, AI drafts a helpful response → founder reviews and posts

---

### 4G. Twitter/X (P1)

**Why P1:** Quick micro-content distribution. Good for "building in public" narrative. Low effort per post.

**Content Types (AI generates daily):**

**Data Tweets (daily):**
```
Biggest price drop in Croatia today:

🥛 Dukat Milk 1L
Konzum: 0.89€ (was 1.19€) — ↓25%

Tracking 11 chains daily → tvoja-kosarica.hr
```

**Building in Public Threads (weekly):**
```
Week 6 of building a grocery price comparison tool for Croatia.

This week:
• Matched 12,400 products across 11 chains
• Our trigram matching algorithm hit 95% accuracy
• Found that Lidl is cheapest 68% of the time

Here's what I learned about matching product names across stores 🧵
```

**Price Fact Tweets:**
```
Fun fact from Croatian grocery data:

The same basket of 30 staples costs 43.20€ at Lidl
and 49.40€ at the most expensive chain.

That's 322€/year difference for buying the same stuff.
```

**Engagement:** Follow Croatian tech accounts, startup founders, data people. Retweet with insightful comments. Don't just broadcast.

---

### 4H. Hacker News / Indie Hackers (P2)

**Why P2:** These platforms spike at launch. Not for daily content — for high-impact events.

**Show HN Post (Launch Day):**

Title: "Show HN: I built a grocery price comparison tool that tracks 11 Croatian retail chains daily"

AI drafts the post covering:
- Technical approach (ClickHouse for analytics, pg_trgm for matching, daily ingestion pipeline)
- Problem (Croatian consumers have no easy way to compare grocery prices)
- What I learned about matching product names across retailers
- Link to try it

**Indie Hackers "Building in Public" Series:**
- Monthly updates on metrics, challenges, decisions
- Focus on data pipeline challenges, matching algorithm evolution
- Be honest about what's not working — IH community values transparency

---

### 4I. Instagram (P2)

**Content Types (AI generates visual layouts + captions):**

- **Carousel posts:** "Top 5 pojeftinjenja ovaj tjedan" — swipe through products
- **Stories:** Quick poll "Koji lanac je po vama najjeftiniji?" + reveal data
- **Reels:** Short data reveals (15-second price comparison animations)

**Hashtags (AI generates sets):**
- Croatian: #cijenehrane #akcije #štednja #usporedbacijena #trgovine #hrvatskakuhinja
- Category: #mlijeko #kruh #meso #voće #povrće

---

### 4J. WhatsApp Business (P2)

**Weekly Digest Broadcast:**
- One message per week (Sunday evening)
- Košarica Index + top 3 deals for the week
- Formatted for forwarding: short, clear, no links (just brand mention)
- Opt-in via link from other channels

---

## 5. Content Templates Library

Each template below specifies: what data it needs, what AI generates, platform adaptations, and a concrete example.

### Template 1: Deal Dana (Daily Deal Highlight)

**Data inputs:** ClickHouse query → top price drop today (>15% threshold, significance-weighted)

**Structure:**
```
🏷️ DEAL DANA — [Datum]

[Proizvod]
  [Lanac1]: [cijena] € (bilo [stara_cijena] €) ↓[postotak]%
  [Lanac2]: [cijena] €
  [Lanac3]: [cijena] €

[LLM commentary — Pametnjaković one-liner, owned channels only]

Usporedi sve cijene → tvoja-kosarica.hr?utm_source=[platform]

Cijene iz službenih cjenika, [datum] [vrijeme] UTC
```

**Platform Adaptations:**
- Facebook groups: Remove Pametnjaković commentary. Add "Izvor: službeni cjenici, ažurirano danas."
- Telegram: Include commentary. Add share button.
- forum.hr: Plain text, no emoji, more context about the deal.
- Twitter/X: Compress to 280 chars, link in reply.

---

### Template 2: Košarica Index (Weekly Basket Comparison)

**Data inputs:** ClickHouse → 30-staple basket price per chain, week-over-week change

**Structure:**
```
📊 KOŠARICA INDEX — Tjedan [N]/2026 ([datumi])

Košarica od 30 osnovnih namirnica:

1. [Lanac] — [cijena] €
2. [Lanac] — [cijena] €
...
11. [Lanac] — [cijena] €

Prosjek: [cijena] € ([promjena]% vs prošli tjedan)
Razlika najjeftiniji↔najskuplji: [razlika] €/tj = [godišnje] €/god

Top 3 promjene ovaj tjedan:
1. [Proizvod]: [promjena] u [lanac]
2. [Proizvod]: [promjena] u [lanac]
3. [Proizvod]: [promjena] u [lanac]

[LLM commentary — for owned channels]

Detalji → tvoja-kosarica.hr/index?utm_source=[platform]
```

---

### Template 3: Bitka Cijena (Product Price Battle)

**Data inputs:** ClickHouse → specific product across all chains

**Structure:**
```
⚔️ BITKA CIJENA: [Proizvod]

[Visual card with bar chart showing prices across chains]

Najjeftinije: [Lanac] — [cijena] €
Najskuplje:   [Lanac] — [cijena] €
Razlika: [X] € ([Y]%)

Na godišnjoj razini (kupnja 1x tjedno): [ušteda] €

Izvor: službeni cjenici, [datum]
```

---

### Template 4: Jeste li znali? (Price Facts)

**Data inputs:** ClickHouse → interesting statistical outliers, historical trends

**Examples:**
```
💡 Jeste li znali?

Cijena maslinovog ulja u Hrvatskoj je u zadnjih 6 mjeseci
porasla 34%. Ali razlika između najskupljeg i najjeftinijeg
lanca je čak 2,50 € po litri.

Tko uspoređuje, uštedi.
```

```
💡 Jeste li znali?

Prosječna hrvatska obitelj troši ~400 €/mj na hranu.
Prebacivanje na najjeftiniji lanac za svaku kategoriju
može uštedjeti do 27 €/mj = 324 €/god.

To je besplatan godišnji odmor. Ili 54 kave.
```

---

### Template 5: Mjesečni Pregled (Monthly Inflation Report)

**Data inputs:** ClickHouse → month-over-month changes by category, chain volatility

**Structure:**
```markdown
# Cijene hrane u Hrvatskoj — [Mjesec] 2026.

## Ključni podaci
- Prosječna košarica: [cijena] € ([promjena]% m/m)
- Najjeftiniji lanac: [lanac] ([cijena] €)
- Najveće poskupljenje: [kategorija] ([promjena]%)
- Najveće pojeftinjenje: [kategorija] ([promjena]%)

## Po kategorijama
| Kategorija | Prosječna cijena | Promjena m/m |
|-----------|-----------------|-------------|
[tablični podaci]

## Indeks kompetitivnosti
| Lanac | Prosjek | Volatilnost | Rang |
[tablični podaci]

## Metodologija
[standardni paragraf]
```

**Usage:** Blog post (primary), press pitch (adapted), social media fragments

---

### Template 6: Savjet za Štednju (Savings Tip)

**Structure:**
```
💰 SAVJET ZA ŠTEDNJU #[N]

[Praktičan savjet baziran na podacima]

Primjer iz naših podataka:
[Konkretan izračun s realnim cijenama]

Ušteda: [iznos] € [period]
```

---

### Template 7: Blog Post Draft (SEO Article)

**AI generates full draft (~800-1200 words):**

Structure:
1. H1: Keyword-optimized title
2. Intro paragraph with key takeaway (above the fold)
3. Current price data table (auto-updated)
4. Analysis section (AI-written, data-backed)
5. Practical tips (3-5 actionable suggestions)
6. Methodology note
7. Internal links to related pages
8. CTA: "Usporedi cijene → tvoja-kosarica.hr"

---

### Template 8: Data Visualization (Reddit OC)

**AI generates specification, founder creates visualization:**

```
Visualization Brief:

Type: Heatmap
Title: "Price variance across 11 Croatian grocery chains —
       30 staple items, February 2026"
Data: [matrix of prices by product × chain]
Color scale: Green (cheapest) → Red (most expensive)
Annotations: Circle the biggest outlier
Methodology note: "Data from official pricelists, updated daily"
Post to: r/dataisbeautiful as [OC]

Caption: "I've been tracking grocery prices across all major
Croatian retailers for the past month. This heatmap shows..."
```

---

### Template 9: Forum Response

**AI drafts helpful answers to common forum questions:**

| Question Pattern | Response Template |
|-----------------|-------------------|
| "Gdje je najjeftiniji X?" | Data for product X across chains + "pratim cijene dnevno" |
| "Je li X poskupio?" | 30-day trend for product + percentage change |
| "Koji dućan preporučate?" | Košarica index data + "ovisi što kupujete" (neutral) |
| "Isplati li se ići u 2 dućana?" | Calculation of split-shopping savings vs. time |

---

### Template 10: Facebook Content Pack

**Weekly package (generated Monday):**

```
FACEBOOK CONTENT PACK — Tjedan [N]/2026

═══ POST 1 (Wednesday 18:00) ═══
[Mid-week deal post — Template 1 adapted for FB]

═══ POST 2 (Friday 16:00) ═══
[Weekend roundup — Template variant]

═══ POST 3 (Sunday 20:00) ═══
[Košarica Index — Template 2 adapted for FB groups]

═══ COMMENT TEMPLATES ═══
[5 responses for common interactions]

═══ ENGAGEMENT TASKS ═══
[3 threads to comment on with drafted responses]
```

---

### Template 11: Media Pitch

**For Croatian journalists/outlets:**

```
Subject: Ekskluzivni podaci: Hrvatski Indeks Cijena Hrane — [Mjesec] 2026

Poštovani/a [ime],

Pratimo cijene u 11 hrvatskih maloprodajnih lanaca svaki dan i
pripremili smo mjesečni izvještaj o kretanju cijena hrane.

Ključni podaci za [mjesec]:
• [headline stat 1]
• [headline stat 2]
• [headline stat 3]

Kompletan izvještaj s grafikonima dostupan je na zahtjev.

Možemo ponuditi:
• Ekskluzivni pristup podacima za vaš članak
• Izjavu / komentar za kontekst
• Prilagođenu analizu za vašu publiku

S poštovanjem,
[Ime]
Tvoja Košarica — tvoja-kosarica.hr
```

**Target outlets:**
- Jutarnji List (poslovni / ekonomski odjel)
- Večernji List (potrošačke teme)
- Index.hr (viralni potencijal, data stories)
- 24sata (masovna publika, infografike)
- N1 Hrvatska (TV, analitički pristup)
- Lider (poslovni medij)
- Bug.hr (tech/startup kut)

---

### Template 12: Seasonal Campaign

**Examples (AI generates campaign kits):**

**Povratak u školu (Rujan):**
- Blog: "Školska oprema 2026: usporedba cijena bilježnica, pernica i torbi"
- Facebook: "Koliko košta opremiti školarce?" + comparison table
- Telegram: Daily deal alerts for school supplies

**Božić:**
- Blog: "Koliko košta tradicionalni hrvatski božićni ručak — lanac po lanac"
- Infographic: Price of sarma, bakalar, fritule ingredients across chains

**Ljeto:**
- "Cijena roštilja: meso, povrće, piće — usporedba za savršeni vikend"

---

### Template 13: User Savings Story (Social Proof)

**For sharing on social media once users exist:**

```
"Prešao sam s [Lanac A] na kombinaciju [Lanac B + C] za tjednu
kupnju i sad uštedim [X] € mjesečno.

Evo moje usporedbe za prosječni tjedan:
[Before/after tablica]

Koristim Tvoju Košaricu za provjeru cijena."
```

---

### Template 14: Technical Deep Dive (HN/Indie Hackers)

**AI drafts long-form technical posts:**

Topics:
- "How we match product names across 11 retailers using pg_trgm and semantic embeddings"
- "Building a real-time grocery price comparison pipeline with ClickHouse"
- "The challenge of normalizing product units across Croatian retailers"
- "From 0 to 130K products: lessons from building a price ingestion system"

---

### Template 15: Product Hunt Launch Kit

**AI generates complete launch materials:**

```
Tagline options:
1. "Compare grocery prices across 11 Croatian chains — save up to 322€/year"
2. "Your grocery basket, optimized. Real prices, real savings."
3. "The grocery price tracker Croatia was missing."

Description (short):
"Tvoja Košarica tracks daily prices from 11 Croatian grocery chains.
Search any product, build a shopping list, and find the cheapest
combination of stores. Data-driven savings for Croatian families."

Maker Comment:
"Hi PH! I'm [name], and I built Tvoja Košarica because I was tired
of not knowing which Croatian store had the best prices.

The data pipeline ingests official pricelists from all major chains
daily at 6 AM UTC. We use barcode matching and trigram similarity
to link the same product across different stores.

Would love your feedback — especially on the basket optimizer feature."

First Day Engagement Plan:
- Respond to every comment within 30 minutes
- Post a technical breakdown in the discussion
- Share interesting data findings
- Link to the Show HN post for cross-pollination
```

---

## 6. Guerrilla & Creative Tactics (Zero Budget)

### 6.1 Data Journalism — Your Biggest Free Marketing Channel

**The play:** You have unique data that Croatian journalists want. Price of food is a perennial media story. Position yourself as the authoritative source.

**Monthly: "Hrvatski Indeks Cijena Hrane" (Croatian Food Price Index)**

Publish a professional monthly report with:
- Basket price trends (30 staples, 11 chains)
- Category breakdowns (meat, dairy, produce, etc.)
- Chain competitiveness rankings
- Notable anomalies or outliers
- Month-over-month and year-over-year comparisons

**Distribution:**
1. Publish on blog (SEO value)
2. Send personalized pitch email to 5-7 journalists (Template 11)
3. Post summary on all social channels
4. Offer exclusive pre-release to one outlet per month (rotating)

**Why it works:** Journalists need data for stories about food prices. You give them verified, ready-to-publish numbers with charts. They credit you and link back. Free PR + free backlinks.

**Target: 1-2 media mentions by Month 2, 3-5 by Month 3.**

### 6.2 Open Data Advocacy

**The play:** Publish your price dataset as open data. This seems counterintuitive but creates massive second-order value.

**What to publish:**
- Aggregated weekly price averages (not real-time — that's your moat)
- Historical price trends (30-day delay)
- Category-level statistics

**Benefits:**
- Academic citations → credibility → media coverage
- Backlinks from universities, research papers
- Good will and PR ("we believe in price transparency")
- Positions you as the infrastructure for grocery price data in Croatia

**Platforms:** GitHub (dataset repo), Kaggle (dataset upload), Croatian open data portal

### 6.3 Consumer Rights Angle

**Partner with HUZP (Hrvatska udruga za zaštitu potrošača):**
- Offer them free access to your price data for their reports
- Co-publish a "Price Transparency Report" quarterly
- Position: "We're fighting for consumer rights through data"

**This gives you:**
- Credibility (associated with consumer protection)
- Media coverage (HUZP gets media attention)
- Distribution (their channels amplify your data)
- Regulatory goodwill

### 6.4 University Outreach

**Offer API/data access to economics departments:**
- EFZG (Ekonomski fakultet Zagreb) — price elasticity research
- PMF (Prirodoslovno-matematički fakultet) — data science projects
- Split, Rijeka, Osijek universities

**What you get:**
- Research papers citing your platform
- Student projects building on your data → word of mouth
- Potential thesis students who could contribute to the project
- Academic credibility

### 6.5 Food Blogger Partnerships

**The deal:** Give food bloggers exclusive price insights for their recipe posts. In return, they mention Tvoja Košarica.

AI prepares personalized pitch:
```
Hej [ime],

Vidio/la sam tvoj recept za [jelo] — super izgleda!

Imam pristup dnevnim cijenama svih hrvatskih lanaca i mogu
ti pripremiti "cijena recepta" breakdown za svaki post:
- Koliko koštaju sastojci u svakom lancu
- Gdje kupiti najjeftinije
- Ukupna cijena recepta

Tvoji čitatelji dobiju korisnu info, a ja malo vidljivosti.

Zainteresiran/a?
```

### 6.6 "Izazov Transparentnosti Cijena" (Price Transparency Challenge)

**Social media campaign:**
- Challenge people to guess which store is cheapest for common products
- Reveal the real answer with data
- Shareable format → organic reach
- Example: "Pogodite: Gdje je jeftiniji kilogram piletine — Konzum ili Lidl? 🤔"

### 6.7 Meme Marketing

**Pametnjaković-branded memes (for owned channels):**

AI generates meme concepts, founder picks the best ones:
- "Kad vidiš da je mlijeko poskupilo 25% ali samo u jednom dućanu" [surprised Pikachu]
- "Ja: 'Idem samo po kruh.' Također ja: *optimizira košaricu u 3 dućana*"
- Croatian-specific humor about shopping habits, store loyalty, price sensitivity

**Rules:** Only on owned channels (Telegram, own FB page, Twitter). Never in other people's groups.

### 6.8 Reciprocal Content

**Guest post on Croatian finance/lifestyle blogs:**
AI drafts articles like:
- "Kako sam naučio štedjeti 300€ godišnje na hrani" (for personal finance blogs)
- "5 digitalnih alata za pametnu kupovinu" (for tech blogs)
- "Cijena zdrave prehrane: mit ili stvarnost?" (for health/food blogs)

Each article naturally mentions Tvoja Košarica with a backlink.

### 6.9 Local Events

AI generates print materials for:
- University student fairs (one-pagers, QR codes)
- Consumer protection events
- Local meetups (tech meetups in Zagreb, Split)

### 6.10 Seasonal Hooks Calendar

| Month | Hook | Content |
|-------|------|---------|
| Jan | "Novogodišnje rezolucije: štednja na hrani" | Savings challenge |
| Feb | "Valentinovo: cijena romantične večere" | Recipe cost comparison |
| Mar | "Uskršnja košarica: koliko košta?" | Holiday meal cost breakdown |
| Apr | "Proljetno čišćenje budžeta" | Quarterly savings review |
| May | "Sezona roštiljanja počinje" | BBQ ingredient comparison |
| Jun | "Ljeto na budžetu" | Summer staples pricing |
| Jul | "Godišnji odmor ili tjedan dana hrane?" | Fun cost comparison |
| Aug | "Povratak u školu: priprema" | School supplies pricing |
| Sep | "Školska oprema — detaljna usporedba" | Full back-to-school guide |
| Oct | "Jesen = juhe i variva" | Seasonal ingredient pricing |
| Nov | "Black Friday za spižu?" | Do stores actually discount food? |
| Dec | "Božićna košarica 2026" | Christmas meal cost breakdown |

---

## 7. Multi-AI Workflow

### 7.1 Which AI for What

| AI Tool | Best For | Cost | When to Use |
|---------|---------|------|-------------|
| **Claude (Opus/Sonnet)** | Long-form content, strategy, blog posts, press releases, technical writeups | Higher | Weekly blog posts, monthly reports, media pitches, launch materials |
| **GPT (Codex / 4o)** | Quick social media drafts, comment variations, multiple caption versions, translation | Medium | Daily social media drafts, comment templates, engagement briefs |
| **Gemini** | Data analysis summaries, visualization suggestions, trend identification, competitive analysis | Medium | Monthly trend analysis, visualization specs, data insights |
| **Local LLM (Ollama)** | Quick edits, repetitive formatting, template filling | Free | Routine template filling, text formatting |

### 7.2 Prompt Library

Store versioned prompts in `src/lib/content/prompts/`. Example structure:

```
prompts/
├── deal-dana.md          # Daily deal post prompt
├── kosacrica-index.md    # Weekly index prompt
├── blog-post.md          # SEO blog article prompt
├── forum-response.md     # Forum reply prompt
├── media-pitch.md        # Journalist pitch prompt
├── engagement-brief.md   # Daily engagement tasks prompt
├── facebook-pack.md      # Weekly FB content pack prompt
└── README.md             # Prompt engineering guidelines
```

Each prompt includes:
- System prompt (persona, constraints, voice mode)
- Data template (where ClickHouse data gets injected)
- Output format specification
- Examples of good and bad output
- Version history

### 7.3 Cost Optimization

- **Routine drafts** (daily deals, comments): Use GPT-4o-mini or local LLM (~free)
- **Quality content** (blog posts, reports): Use Claude Sonnet (~$0.50-1.00 per piece)
- **Strategy and review** (monthly planning): Use Claude Opus ($2-5 per session)
- **Data analysis** (trends, insights): Use Gemini Flash (~free tier)

**Estimated monthly AI cost: €15-30** (well within zero-budget constraint)

---

## 8. Founder's Weekly Workflow

### 8.1 Daily Rhythm (~20 min/day)

```
MORNING (10 min):
  1. Open /admin/content-drafts
  2. Review today's AI-generated drafts
  3. Approve, edit, or reject
  4. Post approved content to target platforms

EVENING (10 min):
  1. Check notifications (forum replies, FB comments, Reddit)
  2. Use AI-drafted response templates to reply
  3. Note any trends or questions for next week's content
```

### 8.2 Weekly Rhythm

| Day | Activity | Time | AI Does | You Do |
|-----|----------|------|---------|--------|
| **Mon** | Content pack review | 30 min | Generate weekly FB pack, engagement brief, blog draft | Review, edit, approve |
| **Tue** | Forum engagement | 20 min | Draft 3-5 forum responses | Review, personalize, post |
| **Wed** | Facebook Groups | 15 min | Mid-week deals post (ready to paste) | Post in 3-5 groups, engage |
| **Thu** | Blog publish | 30 min | Blog post draft (800-1200 words) | Edit, add personal touch, publish |
| **Fri** | Weekend preview | 15 min | Weekend deals roundup + Telegram broadcast draft | Post to groups, broadcast |
| **Sat** | Light engagement | 10 min | Response templates for weekend comments | Reply to interactions |
| **Sun** | Weekly index + plan | 20 min | Košarica Index post, next week's themes | Post index, review plan |

**Total: ~2-3 hours/week**

### 8.3 Monthly Extras

| Task | Time | AI Does | You Do |
|------|------|---------|--------|
| Monthly inflation report | 1 hour | Full report draft + visualizations | Review, publish, pitch to media |
| Media outreach | 30 min | Personalized pitch emails (5-7) | Review, send |
| Strategy review | 30 min | Analytics summary, what worked/didn't | Adjust priorities |
| Content calendar | 20 min | Next month's seasonal hooks, themes | Approve or modify |

---

## 9. Pre-Launch Timeline (Day -90 to Day 0) — Cold Start

### Phase 1: Foundation (Day -90 to Day -60)

**Focus: Create accounts, start building reputation, zero promotion**

```
Day -90:
  ☐ Create master Gmail account
  ☐ Create ALL platform accounts (Section 2.1 checklist)
  ☐ Enable 2FA on every account
  ☐ Set up password manager
  ☐ Join 10+ Croatian Facebook deal/savings groups
  ☐ Join forum.hr, introduce yourself in off-topic

Day -90 to -60 (DAILY — 15 min/day):
  ☐ AI generates Daily Engagement Brief
  ☐ Post 2-3 helpful comments on Reddit (r/croatia, r/frugal)
  ☐ Answer 1-2 questions on forum.hr
  ☐ React/comment on 3-5 Facebook group posts
  ☐ Follow and engage with 5 accounts on Twitter/X
  ☐ NO LINKS. NO PROMOTION. JUST BE HELPFUL.
```

**Reputation milestones (Day -60 checkpoint):**
- Reddit: 100+ comment karma, 30+ comments
- forum.hr: 20+ posts, recognized username
- Facebook: Active member in 10+ groups, 30+ interactions
- Twitter/X: 50+ followers from genuine engagement

### Phase 2: Content Seeding (Day -60 to Day -30)

**Focus: Start publishing valuable content, begin building audience**

```
Day -75:
  ☐ Set up Google Search Console + Analytics
  ☐ Launch blog with first 3 SEO articles (AI-drafted):
    1. "Usporedba cijena hrane u Hrvatskoj — 2026"
    2. "Kako uštedjeti na tjednoj kupovini"
    3. "Koji je supermarket najjeftiniji u Hrvatskoj?"

Day -60:
  ☐ Create Telegram channel (@TvojaKosarica)
  ☐ Create Facebook page (Tvoja Košarica)
  ☐ Post first Telegram broadcast
  ☐ Start posting deal comparisons in Facebook groups
    (as person, with data, no app link yet)

Day -45:
  ☐ First data-driven forum.hr post
    ("Usporedio sam cijene u svim lancima — evo rezultata")
  ☐ Cross-link blog posts to forum threads
  ☐ Set up F5Bot monitoring for keywords
```

### Phase 3: Amplification (Day -30 to Day -7)

**Focus: Media outreach, launch preparation, content blitz**

```
Day -30:
  ☐ Publish first "Hrvatski Indeks Cijena Hrane" monthly report
  ☐ Pitch to 3 Croatian media outlets (AI-drafted emails)
  ☐ First Reddit OC post on r/dataisbeautiful
  ☐ Start "Building in Public" thread on Twitter/X

Day -14:
  ☐ Prepare Product Hunt launch materials (Template 15)
  ☐ Prepare Show HN post
  ☐ Line up 5 Product Hunt followers for launch day
  ☐ Create comprehensive launch day content calendar

Day -7:
  ☐ Teaser posts: "Dolazi nešto za pametne kupce..."
  ☐ Final blog post: "Zašto smo napravili Tvoju Košaricu"
  ☐ All content for launch day pre-approved and ready
  ☐ Test all UTM tracking links
```

### Phase 4: Launch (Day 0)

```
Day 0 — COORDINATED LAUNCH:
  06:00  Final data ingestion runs
  08:00  Blog: Launch announcement post
  09:00  Product Hunt: Go live
  09:30  Show HN: Post
  10:00  Telegram: Launch broadcast
  10:00  Facebook: Post in all groups (stagger 15 min apart)
  10:00  Twitter/X: Launch thread
  10:30  Reddit: r/croatia post
  11:00  forum.hr: Launch thread
  12:00  Indie Hackers: Launch post

  ALL DAY: Monitor and respond to every comment within 30 min
  EVENING: Summary post on Telegram with day's results
```

### Phase 5: Post-Launch Grind (Day 1 to Day 90)

Switch to the weekly workflow (Section 8). AI handles content generation, you handle distribution and engagement. Focus shifts from awareness to retention and conversion.

---

## 10. Metrics & Growth Targets

### 10.1 Community Growth

| Platform | Day 0 | Day 30 | Day 60 | Day 90 |
|----------|-------|--------|--------|--------|
| Facebook group reach | 0 | 1,000 | 5,000 | 15,000 |
| Telegram subscribers | 0 | 100 | 400 | 1,000 |
| Blog monthly visitors | 0 | 100 | 500 | 2,000 |
| Reddit karma | 100 | 500 | 2,000 | 5,000 |
| forum.hr reputation | 20 posts | 50 posts | 80 posts | 120 posts |
| Twitter/X followers | 50 | 150 | 400 | 800 |
| Media mentions | 0 | 0-1 | 1-2 | 3-5 |

### 10.2 Conversion Metrics

| Metric | Day 30 | Day 60 | Day 90 |
|--------|--------|--------|--------|
| App signups from content | 50 | 200 | 800 |
| Signups → Active (W1) | 50% | 50% | 50% |
| Active → Retained (M1) | 30% | 30% | 35% |
| Free → Paid (30d) | 3% | 5% | 6.5% |

### 10.3 Attribution

**Every link gets UTM parameters:**

```
tvoja-kosarica.hr?utm_source=[platform]&utm_medium=[type]&utm_campaign=[content]

Examples:
?utm_source=reddit&utm_medium=organic&utm_campaign=weekly-index
?utm_source=facebook&utm_medium=group&utm_campaign=deal-dana
?utm_source=telegram&utm_medium=broadcast&utm_campaign=vikend-ponude
?utm_source=blog&utm_medium=seo&utm_campaign=usporedba-cijena
?utm_source=forumhr&utm_medium=organic&utm_campaign=thread-response
```

**Track per platform:**
- Click-through rate (how many click the link)
- Signup conversion (how many create an account)
- Retention (how many come back after 7 days)
- Revenue attribution (which platform drives paid conversions)

### 10.4 Content Performance

| Metric | Target |
|--------|--------|
| Facebook post engagement rate | >5% |
| Blog avg. time on page | >2 min |
| Telegram open rate | >40% |
| Reddit OC post upvotes | >100 (r/dataisbeautiful) |
| Forum thread views | >500 per thread |
| Media pitch response rate | >20% |

---

## 11. Technical Implementation Reference

> **Note:** This section documents the technical architecture for the content pipeline. Implementation is a separate phase — this document is strategy-first.

### 11.1 Database Schema

**Table: `content_drafts`**

```sql
CREATE TABLE content_drafts (
  id            TEXT PRIMARY KEY,  -- CUID2, prefix: cdr_
  platform      TEXT NOT NULL,     -- reddit | facebook | twitter | telegram | blog | forum | hackernews | instagram | viber | whatsapp
  content_type  TEXT NOT NULL,     -- deal_dana | kosacrica_index | bitka_cijena | jeste_li_znali | mjesecni_pregled | savjet | blog_post | data_viz | forum_response | fb_pack | media_pitch | seasonal | savings_story | tech_deep_dive | ph_launch
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  visual_url    TEXT,              -- Generated image/card URL (nullable)
  data_snapshot JSONB NOT NULL,    -- Raw data that fed this draft (audit trail)
  suggested_at  TIMESTAMP,        -- Suggested posting time
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft | approved | published | rejected
  utm_params    JSONB,            -- { source, medium, campaign }
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 11.2 Cron Job

```
File: src/jobs/cron/handlers/content-generation.ts
Schedule: 0 12 * * *  (12:00 UTC daily, after ingestion + matching)
TaskType: "content" (add to union in src/lib/taskqueue/index.ts)
```

### 11.3 New Modules

```
src/lib/content/
├── queries.ts      -- ClickHouse queries for content data
├── templates.ts    -- Template definitions and rendering
├── generator.ts    -- Orchestrator: queries → templates → LLM → drafts
└── prompts/        -- Versioned LLM prompts per content type
```

### 11.4 Admin Panel

```
File: src/routes/_admin.admin.content-drafts.tsx
Pattern: Follow existing admin pages (cron.tsx, task-queue.tsx)

Features:
- List all drafts (filterable by status, platform, date)
- Preview draft with visual card
- Edit draft text inline
- Approve / Reject buttons
- Copy-to-clipboard for manual posting
- Mark as published (with platform link)
```

---

## Relationship to AI-BOT-STRATEGY.md

These two documents are **complementary, not competing:**

| Phase | Primary Strategy | Why |
|-------|-----------------|-----|
| **Pre-launch (Day -90 to 0)** | Copilot (this doc) | Need authentic human presence on new accounts |
| **Early growth (Day 0 to 90)** | Copilot (this doc) | Still building trust, mostly on other people's platforms |
| **Scale (Day 90+)** | Both | Bot handles owned channels (Telegram, Discord), Copilot handles external platforms |
| **Maturity (Day 180+)** | Bot primary, Copilot for strategy | Bot handles volume, founder focuses on partnerships and media |

The content pipeline (Section 3) is shared infrastructure — the same drafts can feed both the copilot workflow (founder reviews) and the bot workflow (auto-publish to owned channels).

---

*Document created: 2026-02-06*
*Status: Draft — pending review by Codex and Gemini*
