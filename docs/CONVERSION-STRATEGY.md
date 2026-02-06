# Conversion & Growth Strategy

> Companion document to [UX-BRANDING-GUIDELINES.md](./UX-BRANDING-GUIDELINES.md)

---

## Funnel Architecture

```
                    AWARENESS
                   ┌─────────┐
                   │  Social  │ ← PR, media, influencers
                   │  Search  │ ← SEO ("cijene hrana hrvatska")
                   │   Ads    │ ← Meta, Google
                   └────┬────┘
                        ▼
                   ACQUISITION
              ┌──────────────────┐
              │  Landing Page    │ Target: 60% → Search
              │  "See one price" │ (instant value, no signup)
              └───────┬──────────┘
                      ▼
                  ACTIVATION
           ┌─────────────────────┐
           │  First search       │ Target: 40% → Account
           │  See price spread   │ (value → "save this")
           │  Build first list   │
           └──────────┬──────────┘
                      ▼
                  RETENTION
          ┌──────────────────────┐
          │  Weekly deal alerts  │ Target: 50% W1, 30% M1
          │  Savings dashboard   │ (hooks, notifications)
          │  Basket optimization │
          └──────────┬───────────┘
                     ▼
                  REVENUE
         ┌───────────────────────┐
         │  Free → Ad Boost      │ Target: 20% daily boosters
         │  Free → Plus          │ Target: 5% (30d)
         │  Free → Premium       │ Target: 1.5% (30d)
         │  Ad Boost → Plus      │ Target: 10% of daily boosters
         └──────────┬────────────┘
                    ▼
                  REFERRAL
        ┌────────────────────────┐
        │  Share deals           │ Target: 10% share
        │  Invite friends        │ (points + free month)
        │  Social content        │
        └────────────────────────┘
```

---

## Landing Page Conversion Playbook

### Above the Fold (5-Second Test)

A visitor must understand three things in 5 seconds:
1. **What this is:** Grocery price comparison
2. **Why they should care:** Save money
3. **What to do next:** Search a product

```
┌─────────────────────────────────────────────────┐
│                                                 │
│  Svaki dućan.                                   │
│  Svaka cijena.                                  │
│  Tvoja ušteda.                                  │
│                                                 │
│  Usporedi cijene namirnica u 11 trgovačkih      │
│  lanaca — u sekundi. Besplatno.                 │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │ 🔍  Upiši proizvod (npr. "mlijeko")    │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  14.230 korisnika uštedjelo ukupno €892.400     │
│  ● Konzum ● Lidl ● Plodine ● Spar ● Kaufland  │
│  ● Studenac ● Eurospin ● Tommy ● KTC ● DM      │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Key decisions:**
- Search bar IS the CTA (zero friction — type and see results)
- No signup required to search (remove all barriers)
- Social proof (user count + total savings) builds trust
- Store logos show coverage breadth
- Headline rhythm: short, punchy, Croatian

### Section 2: Problem Agitation (Interactive)

```
"Koliko preplaćujete?"

Enter a product you buy weekly: [mlijeko 2.8% 1L          ]

           Lidl     Konzum    Spar    Plodine
           €1,09    €1,49     €1,55    €1,39

Razlika: €0,46 po litri
Kupujete 2L tjedno? To je €47,84 godišnje — samo na mlijeku.
A imate 30+ artikala na listi...

[Izračunaj svoju pravu uštedu →]
```

### Section 3: How It Works

```
Tri koraka do pametne kupovine:

1️⃣ PRETRAŽI         2️⃣ SLOŽI KOŠARICU      3️⃣ UŠTEDI
   Upiši bilo koji      Dodaj artikle           Mi izračunamo
   proizvod i           u svoju listu           najjeftiniju
   usporedi cijene      i optimiziraj           kombinaciju
```

### Section 4: Social Proof

```
"Tvoja Košarica mi uštedi 30 minuta
 i €15 svaki tjedan. Ne znam kako
 sam prije kupovala bez ovoga."
 — Marija K., Zagreb, mama dvoje djece

"Skenirao sam barcode na Konzumovoj
 'akciji' — ista cijena kao inače.
 Sad uvijek provjerim."
 — Ivan T., Split, student
```

### Section 5: Pricing Table

```
┌──────────────┬──────────────┬──────────────┐
│   BESPLATNO  │     PLUS     │   PREMIUM    │
│              │  €2,99/mj    │  €5,99/mj    │
│              │              │              │
│ ✅ Pretraži  │ ✅ Sve Free  │ ✅ Sve Plus  │
│ ✅ 1 lista   │ ✅ ∞ lista   │ ✅ Split     │
│ ✅ 1 alarm   │ ✅ 5 alarma  │ ✅ ∞ alarmi  │
│ ✅ 3 skena   │ ✅ Bez reklam │ ✅ Povijest  │
│ 🎬 Ad Boost │ ✅ ∞ skenova │ ✅ Obitelj   │
│              │              │              │
│ [Započni     │ [Isprobaj    │ [Isprobaj    │
│  besplatno]  │  7 dana FREE]│  7 dana FREE]│
└──────────────┴──────────────┴──────────────┘

  ✅ Free uključuje 1 alarm — jer znamo da ćeš htjeti više
  🎬 Pogledaj oglas → otključaj više na 24h, besplatno

      Prosječna ušteda: €22/mj
      Plus se isplati za 4 dana korištenja
```

---

## Onboarding Funnel (Post-Signup)

### Flow: Zero-to-Value in 60 Seconds

```
Step 1: SEARCH (10 sec)
├── "Napiši proizvod koji kupuješ svaki tjedan"
├── Pre-fill suggestion: "mlijeko" (most common search)
├── Show live results immediately
└── "Wow" moment: see price differences

Step 2: ADD TO LIST (15 sec)
├── "Dodaj još 2-3 artikla"
├── Quick suggestion chips based on popular items
├── Show running total
└── Micro-celebration: "3 artikla dodana!"

Step 3: OPTIMIZATION REVEAL (15 sec)
├── Show basket at nearest store: €X
├── Animate optimization: → "€X (-15%!)"
├── "Ti upravo ušteđuješ €Y — i to je tek početak"
└── Savings counter animation

Step 4: SAVE & NOTIFY (20 sec)
├── "Spremi svoju listu i saznaj kad cijene padnu"
├── Google/Apple sign-in (one tap)
├── Or email (one field)
├── Skip option visible
└── First trigger loaded: "Your list is saved"
```

### Onboarding Metrics

| Step | Target Completion | Drop-off Action |
|------|-------------------|-----------------|
| Step 1 (Search) | 90% | Improve suggestions, show instant results |
| Step 2 (Add items) | 70% | Better quick-add UX, reduce friction |
| Step 3 (See savings) | 65% | Make savings amount larger (show annually) |
| Step 4 (Create account) | 40% | Test social login vs email vs skip |

---

## Paywall & Upgrade UX

### Principles

1. **Show value before asking** — Always show what the premium feature WOULD give them
2. **Contextual, not interruptive** — Upgrade prompts appear when the user hits a natural limit
3. **Honest about value** — Frame in terms of savings, not features
4. **Easy to dismiss** — Never block navigation, never spam
5. **Points alternative** — Always offer "pay with Smart Points" option

### Upgrade Trigger Points

```
TRIGGER: Creating 2nd shopping list

┌─────────────────────────────────────────┐
│  Trebaš više lista? 📋                  │
│                                         │
│  S Plus pretplatom imaš neograničeno    │
│  lista — za tjednu kupovinu, rođendan,  │
│  ljetovanje, što god trebaš.            │
│                                         │
│  [Plus — €2,99/mj]  [100 bodova]       │
│                             [Ne sad →]   │
└─────────────────────────────────────────┘
```

```
TRIGGER: 4th barcode scan in a day

┌─────────────────────────────────────────┐
│  Potrošio si 3 besplatna skeniranja 📷  │
│                                         │
│  Pametnjakovići skeniraju neograničeno. │
│  Nadogradi na Plus.                     │
│                                         │
│  [Plus — €2,99/mj]  [Sutra imam još 3] │
└─────────────────────────────────────────┘
```

```
TRIGGER: After single-store optimization, showing split potential

┌─────────────────────────────────────────┐
│  ⚡ PREMIUM UVID                        │
│                                         │
│  Tvoja košarica u jednom dućanu: €54,20 │
│                                         │
│  S Premium Split optimizacijom:         │
│  €43,20 — uštedjela bi €11,00! 📈      │
│  (Lidl: 8 artikala + Plodine: 4)       │
│                                         │
│  Premium = €5,99/mj                     │
│  Ova jedna ušteda = 2× pretplata       │
│                                         │
│  [Isprobaj 7 dana FREE]     [Ne sad →]  │
└─────────────────────────────────────────┘
```

### Free Trial Strategy

- **7-day free trial** for both Plus and Premium
- No credit card required upfront (reduce anxiety)
- At day 5: "Trial ends in 2 days. Here's what you'll miss: [specific savings amount]"
- At day 7: "Trial ended. Your alerts are paused. Re-activate?"
- After trial: Features gracefully degrade (data preserved, just locked)

---

## A/B Testing Priority Matrix

| Test | Impact | Confidence | Ease | ICE Score | Priority |
|------|--------|-----------|------|-----------|----------|
| Landing page headline variations | 9 | 7 | 9 | 25 | **P0** |
| Onboarding: inline search vs signup-first | 9 | 8 | 7 | 24 | **P0** |
| Pricing page: with/without annual option | 8 | 7 | 9 | 24 | **P0** |
| Trial: 7-day vs 14-day | 7 | 6 | 10 | 23 | **P1** |
| Paywall: savings-framed vs feature-framed | 8 | 7 | 8 | 23 | **P1** |
| Ad Boost: prominent vs subtle placement | 8 | 7 | 8 | 23 | **P1** |
| Ad Boost: 24h vs 48h duration | 7 | 6 | 10 | 23 | **P1** |
| Free alert: 1 alert vs 0 alerts | 8 | 8 | 9 | 25 | **P0** |
| Search results: card vs dense list | 7 | 6 | 7 | 20 | **P1** |
| Weekly report: email vs push vs both | 6 | 5 | 8 | 19 | **P2** |
| Gamification: with/without points | 6 | 5 | 5 | 16 | **P2** |

---

## SEO & Content Strategy

### Key Pages for SEO

| Page | Target Query | Search Volume (est.) |
|------|-------------|---------------------|
| /cijene/mlijeko | "cijena mlijeka" | High |
| /cijene/[product] | "cijena [product] hrvatska" | Varies |
| /ducan/[store] | "[store] cijene" | Medium |
| /usporedba/[category] | "usporedba cijena [category]" | Medium |
| /akcije | "akcije danas" | Very high |
| /blog/koliko-preplacujete | "kako uštediti na namirnicama" | Medium |

### Content Calendar

| Day | Content | Channel |
|-----|---------|---------|
| Monday | "Weekly savings recap" | Email, App |
| Wednesday | "Price drop of the week" | Social, App |
| Friday | "Weekend deal roundup" | Social, Email |
| Monthly | "Inflation report: food prices" | Blog, PR |

---

## Growth Loops

### Loop 1: Share a Deal
```
User finds deal → shares to WhatsApp/Viber → friend opens link →
friend sees price comparison (no signup) → friend searches more →
friend creates account → Loop repeats
```

### Loop 2: Savings Counter
```
User saves money → counter grows → user screenshots "€500 saved!" →
posts to social → friends ask "what app is that?" → Download → Loop repeats
```

### Loop 3: Paparazzo Content
```
User uploads product photo → photo improves app for everyone →
user earns points → points unlock premium → premium shows more savings →
user contributes more → Loop repeats
```

### Loop 4: Media/PR
```
App generates "inflation report" from data → media covers it →
article links to app → new users → more data → better reports →
more media coverage → Loop repeats
```

---

## Key Performance Indicators

### North Star Metrics

| Metric | Definition | Target (6mo) |
|--------|-----------|---------------|
| **Weekly Active Searchers** | Users who search ≥1 product/week | 50,000 |
| **Monthly Savings Delivered** | Sum of verified savings vs worst option | €500,000 |

### Funnel Metrics

| Metric | Target |
|--------|--------|
| Landing page → First search | 60% |
| First search → Account creation | 20% |
| Account → Week 1 retention | 50% |
| Account → Month 1 retention | 30% |
| Free → Paid (30d) | 6.5% total (5% Plus + 1.5% Premium) |
| Monthly churn (paid) | <5% |
| NPS | >50 |

### Revenue Projections (Scenario)

```
Month 6 target: 50,000 WAU → ~80,000 registered users

Revenue (3 streams):

  Subscriptions:
    Plus (5%):      4,000 × €2.99 = €11,960/mo
    Premium (1.5%): 1,200 × €5.99 = €7,188/mo

  Rewarded Ads (Ad Boost):
    Daily boosters (~20% of free = ~14,800 users):
    ~14,800 × 20 sessions/mo × €0.01 eCPM = ~€2,960/mo
    (conservative — rewarded video eCPM typically €5-15)

  Display Ads (free non-boosters):
    ~€1,500/mo (banner CPM on remaining free users)

  Total: ~€23,608/mo
  Annual run rate: ~€283,296

  Ad Boost → Plus conversion pipeline:
    If 10% of daily boosters convert to Plus over 6mo:
    +1,480 × €2.99 = +€4,425/mo additional recurring

  Break-even estimate:
  Hosting + API costs: ~€3,000/mo
  Ad network fees: ~€500/mo
  Marketing: ~€5,000/mo
  Team: depends on structure
```

**Why Ad Boost improves overall economics:**
- Captures revenue from users who'd never subscribe (~70% of users)
- Acts as a "trial" that converts some to paid (tired of daily ads)
- Keeps free users engaged daily (re-boost loop)
- Higher eCPM than banners (rewarded video = €5-15 vs banner = €0.50-2)
- Users feel the exchange is fair — they chose to watch

---

*Document generated: 2026-02-06*
*Version: 1.0-draft*
*Status: Ready for cross-model review and human approval*
