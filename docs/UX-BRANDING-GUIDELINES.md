# Tvoja Košarica — UX & Branding Guidelines v1.0

> **"Bloomberg Terminal meets grocery shopping, with the personality of a Croatian smartass."**

This document is the single source of truth for all design, branding, and UX decisions for the consumer-facing product. It synthesizes insights from StoryBrand messaging, Jobs to Be Done analysis, Hook Model engagement design, award-winning UI principles, typography systems, UX heuristics, conversion optimization, and practical UI patterns.

---

## Table of Contents

1. [Brand Identity](#1-brand-identity)
2. [Brand Messaging (StoryBrand)](#2-brand-messaging-storybrand)
3. [Jobs to Be Done](#3-jobs-to-be-done)
4. [Design System](#4-design-system)
5. [Typography](#5-typography)
6. [Color System](#6-color-system)
7. [Component Library](#7-component-library)
8. [Screen Designs](#8-screen-designs)
9. [Navigation & Information Architecture](#9-navigation--information-architecture)
10. [Engagement & Habit Loops (Hook Model)](#10-engagement--habit-loops-hook-model)
11. [Gamification System](#11-gamification-system)
12. [Conversion & Monetization](#12-conversion--monetization)
13. [UX Heuristics & Accessibility](#13-ux-heuristics--accessibility)
14. [Motion & Micro-interactions](#14-motion--micro-interactions)
15. [Dark Mode](#15-dark-mode)
16. [Voice & Tone Guide](#16-voice--tone-guide)
17. [Open Questions for Collaboration](#17-open-questions-for-collaboration)

---

## 1. Brand Identity

### Brand Names

| Context | Name | Usage |
|---------|------|-------|
| **Primary brand** | **Tvoja Košarica** | App name, store listing, formal contexts |
| **Brand personality** | **Pametnjaković** | Marketing voice, mascot concept, social media |
| **Internal codename** | **Kosarica** | Codebase, technical docs |

**"Tvoja Košarica"** (Your Basket) is the consumer-facing name — warm, possessive, personal. It says "this is YOURS."

**"Pametnjaković"** (The Smarty-Pants) is the brand character — the witty friend who always knows where the deals are. This personality infuses all copy, empty states, notifications, and marketing.

### Brand Essence

```
One word:     SHARP
Visual mood:  "A Bloomberg terminal redesigned by Apple for your Croatian baka"
Personality:  Smart, witty, slightly sarcastic, genuinely helpful
Metaphor:     Your prices, traded like stocks — your savings, managed like a portfolio
```

### Brand Positioning Statement

> Tvoja Košarica is the only grocery intelligence platform that treats your food budget like a financial portfolio — tracking every price movement across every Croatian store, so you always know exactly where your money goes furthest.

### Brand Values

1. **Transparency** — Every price, every store, no hidden agenda
2. **Intelligence** — Not just data, but actionable insights
3. **Irreverence** — We take saving seriously, not ourselves
4. **Empowerment** — You're the smart shopper, we're just the tool
5. **Fairness** — Free tier is genuinely useful, not crippled

### The "Why Not Images" Philosophy

We intentionally don't show product photos. Here's why, and how we make it a strength:

**The Intentional Absence:** We're not a webshop — we're a financial tool for groceries. Stock traders don't need photos of Apple Inc to know the price is right. Neither do smart shoppers.

**What replaces images:**
- **Category icons** — Clean, consistent vector icons (~50 categories)
- **Color coding** — Price heatmaps (green = deal, red = overpriced)
- **Typography** — Bold prices ARE the visual
- **Sparklines** — Mini price charts inline with every item
- **Store brand colors** — Each chain gets its signature color chip

**The "Paparazzo" twist:** Crowdsourced photos from users earn Smart Points. We turn our limitation into a community engagement feature with humor: *"We were too cheap for a photographer. You do it."*

---

## 2. Brand Messaging (StoryBrand)

### The BrandScript

#### 1. CHARACTER (The Hero = The User)

The Croatian consumer who wants to **stop overpaying for groceries** and **feel in control of their household budget** during a time of rising prices.

**Specific hero desires by segment:**

| Segment | Primary Desire |
|---------|---------------|
| **Family shopper** | "I want to feed my family well without going broke" |
| **Student** | "I want to stretch my budget so I can afford to live" |
| **Pensioner** | "I want to know I'm not being taken advantage of" |
| **Young professional** | "I want to be smart with money without wasting time" |

#### 2. PROBLEM

**Villain:** The retail pricing fog — *"Stores deliberately make it impossible to compare prices, betting on your confusion."*

| Level | The Problem |
|-------|-------------|
| **External** | Prices vary wildly across stores, but comparing them takes hours of checking flyers and websites |
| **Internal** | "I feel stupid for overpaying. I feel anxious every time I check my receipt. I feel overwhelmed by all the information." |
| **Philosophical** | In a country where every store MUST publish prices daily, it's wrong that consumers still can't easily compare them |

#### 3. GUIDE (Tvoja Košarica / Pametnjaković)

**Empathy:** "We know what it feels like to see your grocery bill and wonder if you got ripped off. We've all been there — staring at a receipt, doing math in your head, knowing you could've done better but not knowing how."

**Authority:**
- Tracks prices from 11 retail chains daily
- Processes millions of product prices
- Matches products across stores using AI (barcode + intelligent name matching)
- Powered by mandatory government price transparency data

#### 4. PLAN

**The 3-Step Process:**

| Step | Name | Description |
|------|------|-------------|
| **1** | **Pretraži** (Search) | Search any product — see its price at every store near you, right now |
| **2** | **Složi košaricu** (Build Your Basket) | Add items to your list — we calculate the cheapest combination |
| **3** | **Uštedi** (Save) | Shop with confidence knowing you got the best deal possible |

**Agreement Plan (Trust Builders):**
- "We never sell your data to retailers"
- "Free tier is genuinely useful — not a trick to force upgrades"
- "Prices update daily from official government-mandated data"
- "Cancel anytime, no questions asked"

#### 5. CALLS TO ACTION

| Type | CTA | Context |
|------|-----|---------|
| **Direct** | "Usporedi cijene" (Compare Prices) | Primary — search/compare |
| **Direct** | "Izgradi košaricu" (Build Your Basket) | Secondary — basket flow |
| **Transitional** | "Koliko možeš uštedjeti?" (How Much Can You Save?) | Landing page quiz/calculator |
| **Transitional** | "Pogledaj tjedne akcije" (See Weekly Deals) | Low-commitment entry point |

#### 6. SUCCESS

*What life looks like after using Tvoja Košarica:*

- **Status:** "I'm the one in the family who always knows where the deals are"
- **Completeness:** "I finally feel in control of my grocery spending"
- **Self-realization:** "I'm a smart, savvy shopper — not a sucker"

Concrete outcomes:
- "Save 15-30% on monthly groceries"
- "Spend 5 minutes planning instead of 2 hours checking flyers"
- "Never wonder 'was there a better deal?' again"

#### 7. FAILURE

*What happens without us:*

- Keep overpaying week after week, month after month
- That nagging feeling after every shop — "I could've done better"
- Wasted hours checking flyers that are designed to confuse, not inform
- Watching prices rise while your purchasing power shrinks

### One-Liners

**Primary (Croatian):**
> "Svaki dućan. Svaka cijena. Svaki dan. — Tvoja Košarica ti pomaže kupovati pametnije."
> (Every store. Every price. Every day. — Your Basket helps you shop smarter.)

**English equivalent:**
> "We help Croatian shoppers who are tired of overpaying compare prices across every store instantly, so they can save hundreds of euros a year without wasting time."

**Short taglines:**
- "Pametna kupovina. Bez kompromisa." (Smart shopping. No compromises.)
- "Tvoje cijene. Pod kontrolom." (Your prices. Under control.)
- "Usporedi. Uštedi. Ponovi." (Compare. Save. Repeat.)

---

## 3. Jobs to Be Done

### Primary Jobs

#### Job #1: "Help me spend less on groceries without spending time"

```
When I'm planning my weekly grocery shopping
and I know prices vary across stores but checking each one is impractical,
I want to instantly see where each item is cheapest
so I can make a smart decision without wasting my Saturday morning.
```

**Dimensions:**
- Functional: Find lowest prices, optimize route
- Emotional: Feel smart, feel in control, reduce anxiety
- Social: Be seen as the savvy one in the family

#### Job #2: "Tell me when my favorite items go on sale"

```
When a product I regularly buy goes on promotion
and I wouldn't know unless I happened to check that specific flyer,
I want to be automatically notified
so I can stock up at the right time and never miss a deal.
```

#### Job #3: "Prove that I'm getting a good deal (or getting ripped off)"

```
When I'm standing in a store looking at a "sale" tag
and I suspect it's not actually a good deal,
I want to instantly verify the real price history
so I can call BS on fake discounts and buy with confidence.
```

#### Job #4: "Optimize my entire shopping trip, not just individual items"

```
When I have a shopping list of 20+ items
and the cheapest option means splitting across 3 stores,
I want someone to calculate whether the savings justify the extra trips
so I can make the smartest decision including gas/time cost.
```

### Struggling Moments (Triggers)

| Moment | Frequency | Intensity | Feature Response |
|--------|-----------|-----------|-----------------|
| Staring at a high grocery receipt | Weekly | High | Basket optimization |
| Seeing a "sale" and doubting it | Weekly | Medium | Price history chart |
| Planning weekly shop | Weekly | Medium | Shopping list + optimization |
| Standing in store, wondering about other stores | Weekly | High | Barcode scan + instant compare |
| Flipping through 5 different store flyers | Weekly | High | Unified search |
| Paycheck just arrived, need to make it last | Monthly | Very high | Budget-conscious basket |
| Noticing a product price suddenly jumped | Occasional | High | Price alert + history |

### Current "Competitors" (What Users Hire Today)

| Current Solution | Job It Does Poorly | Our Advantage |
|-----------------|-------------------|---------------|
| **Checking flyers manually** | Time-consuming, incomplete | All stores, all prices, one search |
| **Store loyalty apps** | Only shows one store | Cross-store comparison |
| **Asking friends/family** | Unreliable, limited | Data-driven, comprehensive |
| **Just going to the nearest store** | Convenient but expensive | Show what convenience costs |
| **Buying store brands blindly** | Not always cheapest | Compare actual prices |
| **Non-consumption (doing nothing)** | No savings at all | Instant, effortless savings |

### Forces of Progress

```
PUSH (away from current behavior):
├── Rising inflation making budgets tighter
├── Frustration with misleading "sales"
├── Time wasted on manual comparison
└── Feeling of being taken advantage of

PULL (toward Tvoja Košarica):
├── Promise of instant comparison
├── "Split basket" is genuinely novel
├── Price history = truth detector
└── "Everyone else is saving, why not me?"

ANXIETY (barriers to adoption):
├── "Is this accurate? Can I trust the data?"
├── "I don't want another app tracking me"
├── "Will it be too complicated for me?"
├── "Is the free version actually useful?"
└── "Croatian apps are usually bad"

HABIT (attachment to current behavior):
├── "I always shop at Konzum, it's close"
├── "I know my store's layout"
├── "Loyalty card points lock me in"
└── "I don't have time to learn something new"
```

**Strategy:** Reduce anxiety (data source transparency, dead-simple UX, genuinely useful free tier) and reduce habit (show exactly how much convenience is costing them).

---

## 4. Design System

### Design Philosophy

```
BRAND ESSENCE:    SHARP
VISUAL TENSION:   Financial precision × Croatian warmth
SIGNATURE:        Price data as the primary visual element
CONSTRAINT:       No product images — typography and color ARE the design
```

**The "Supermarket Ticker" Aesthetic:** Prices are treated like stock prices. Green means opportunity. Red means warning. Every number tells a story.

### Grid System

**Mobile (primary):**
- 4-column grid
- 16px gutters
- 16px outer margins
- Breakpoint: 375px base (iPhone SE minimum)

**Tablet:**
- 8-column grid
- 24px gutters
- 32px margins
- Breakpoint: 768px

**Desktop:**
- 12-column grid
- 24px gutters
- Max content width: 1200px (centered)
- Breakpoint: 1024px

### Spacing Scale

Based on 4px base unit:

```
--space-1:   4px    → icon-to-label gap, tight coupling
--space-2:   8px    → related elements within a component
--space-3:  12px    → padding within compact components
--space-4:  16px    → standard component padding, list item gaps
--space-5:  20px    → between related components
--space-6:  24px    → section separation within a card
--space-8:  32px    → between major sections
--space-10: 40px    → page section separators
--space-12: 48px    → hero-level spacing
--space-16: 64px    → major page divisions
```

**Tailwind mapping:**
```
p-1(4px) p-2(8px) p-3(12px) p-4(16px) p-5(20px) p-6(24px) p-8(32px)
gap-1 gap-2 gap-3 gap-4 gap-5 gap-6 gap-8
```

### Border Radius

```
--radius-sm:   4px   → pills, small badges
--radius-md:   8px   → cards, buttons
--radius-lg:  12px   → modals, large cards
--radius-xl:  16px   → bottom sheets
--radius-full: 9999px → store chips, avatars
```

### Shadows

```css
/* Elevation system */
--shadow-sm:  0 1px 2px rgba(10, 12, 20, 0.06);           /* cards at rest */
--shadow-md:  0 4px 8px rgba(10, 12, 20, 0.08);           /* raised cards, hover */
--shadow-lg:  0 8px 24px rgba(10, 12, 20, 0.12);          /* modals, dropdowns */
--shadow-xl:  0 16px 48px rgba(10, 12, 20, 0.16);         /* overlays */
--shadow-price: 0 2px 8px rgba(22, 163, 74, 0.15);        /* deal highlight glow */
```

### Iconography

**Style:** Line icons, 1.5px stroke, rounded caps. Consistent 24px canvas.

**Category Icons (~50):** Replace product images entirely.

| Category | Icon Concept | Unicode/Reference |
|----------|-------------|-------------------|
| Mlijeko (Dairy) | Milk carton | 🥛 outline |
| Kruh (Bread) | Bread loaf | 🍞 outline |
| Voće (Fruit) | Apple | 🍎 outline |
| Povrće (Vegetables) | Carrot | 🥕 outline |
| Meso (Meat) | Steak cut | 🥩 outline |
| Piće (Drinks) | Bottle | 🍾 outline |
| Higijena (Hygiene) | Soap bar | 🧴 outline |
| Slatkiši (Sweets) | Candy | 🍬 outline |
| Ulje (Oil) | Oil drop | 💧 outline |
| Riba (Fish) | Fish | 🐟 outline |

**Source recommendation:** Lucide Icons (MIT license, consistent style, good coverage). Supplement with custom SVGs for grocery-specific categories.

**Store Icons:** Each retail chain gets:
- A small color chip (12x12px circle) in their brand color
- Abbreviated 2-3 letter code when space is tight
- Full logo only in store detail views

| Chain | Abbreviation | Brand Color |
|-------|-------------|-------------|
| Konzum | KO | #e31e24 (red) |
| Lidl | LI | #0050aa (blue) |
| Plodine | PL | #f7941d (orange) |
| Kaufland | KA | #e30613 (red) |
| Spar | SP | #00874a (green) |
| Studenac | ST | #0066b2 (blue) |
| Eurospin | EU | #ffd100 (yellow) |
| Tommy | TO | #c8102e (red) |
| KTC | KT | #1a5ca1 (blue) |
| DM | DM | #002f5f (navy) |
| Interspar | IS | #00874a (green) |

---

## 5. Typography

### Font Stack

**Primary (UI + Body): Space Grotesk**
- Why: Geometric sans-serif with personality, excellent Croatian character support (č, ć, ž, š, đ), slightly techy/financial feel without being cold
- Weights: 300 (Light), 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold)
- Google Fonts: Free, variable font available

**Numeric/Price: JetBrains Mono**
- Why: Monospace with excellent number alignment, tabular figures built-in, great readability at all sizes, perfect for the "financial terminal" vibe
- Weights: 400 (Regular), 700 (Bold)
- Google Fonts: Free

**Display/Marketing: Instrument Serif** (optional, headlines only)
- Why: Elegant contrast to Space Grotesk, creates the "Bloomberg editorial" feel for landing pages
- Weights: 400 (Regular), 400 Italic
- Usage: Landing page hero, marketing headlines, blog titles

### Font Loading Strategy

```html
<!-- Preload critical fonts -->
<link rel="preload" href="/fonts/SpaceGrotesk-Variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/JetBrainsMono-Variable.woff2" as="font" type="font/woff2" crossorigin>

<!-- Subset: Latin Extended (includes Croatian characters) -->
<!-- Total: ~60KB for both variable fonts -->
```

```css
@font-face {
  font-family: 'Space Grotesk';
  src: url('/fonts/SpaceGrotesk-Variable.woff2') format('woff2');
  font-weight: 300 700;
  font-display: swap;
  unicode-range: U+0000-024F; /* Latin + Extended */
}

@font-face {
  font-family: 'JetBrains Mono';
  src: url('/fonts/JetBrainsMono-Variable.woff2') format('woff2');
  font-weight: 400 700;
  font-display: swap;
  unicode-range: U+0030-0039, U+002C, U+002E, U+20AC, U+00A0; /* Numbers, comma, period, €, nbsp */
}
```

### Type Scale (Mobile-First)

```css
/* Mobile base: 16px */
--text-xs:    0.75rem;   /* 12px — fine print, timestamps */
--text-sm:    0.875rem;  /* 14px — secondary text, store names in lists */
--text-base:  1rem;      /* 16px — body text, product names */
--text-lg:    1.125rem;  /* 18px — emphasized body, section titles */
--text-xl:    1.25rem;   /* 20px — card titles */
--text-2xl:   1.5rem;    /* 24px — page titles */
--text-3xl:   1.875rem;  /* 30px — hero subtitle */
--text-4xl:   2.25rem;   /* 36px — hero headline */

/* Desktop scale-up */
@media (min-width: 1024px) {
  --text-3xl:  2.25rem;  /* 36px */
  --text-4xl:  3rem;     /* 48px */
  --text-5xl:  3.75rem;  /* 60px — landing page hero */
}
```

### Price Typography (The Most Important Element)

```css
.price {
  font-family: 'JetBrains Mono', monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.price--hero {        /* Main price in comparison */
  font-size: 1.5rem;  /* 24px */
  font-weight: 700;
  line-height: 1;
}

.price--compact {     /* Price in list rows */
  font-size: 1.125rem; /* 18px */
  font-weight: 600;
  line-height: 1;
}

.price--small {       /* Secondary prices, history */
  font-size: 0.875rem; /* 14px */
  font-weight: 400;
  line-height: 1;
}

/* Euro symbol slightly smaller */
.price .currency {
  font-size: 0.75em;
  opacity: 0.7;
}

/* Cents as superscript */
.price .cents {
  font-size: 0.65em;
  vertical-align: super;
}
```

**Price display format:** `€ 2,49` — currency left, comma decimal (Croatian standard), space between currency and number. Or alternatively the compact `2,49 €` format with currency right (EU standard).

### Line Heights

| Context | Line Height | Reason |
|---------|-------------|--------|
| Prices | 1.0 | Compact, no wrapping |
| Product names | 1.3 | Short, may wrap to 2 lines on mobile |
| Body text | 1.6 | Comfortable reading |
| Dense lists | 1.2 | Scannable rows |
| Marketing copy | 1.7 | Relaxed, premium feel |
| Display headlines | 0.95 | Dramatic, tight |

### Long Croatian Name Handling

Croatian product names can be very long: "Mlijeko trajno 2,8% m.m. Z'bregov" (35+ chars).

**Strategy:**
- Mobile: 2-line max with `line-clamp-2` and ellipsis
- Show brand on first line, product details on second
- Full name in expandable detail view
- Search uses fuzzy matching (already implemented in backend)

```css
.product-name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
```

---

## 6. Color System

### Philosophy

**Monochromatic tension with functional color.** The UI is primarily neutral (warm grays). Color is reserved for meaning — price quality, store identity, and system feedback.

### Primary Palette

```css
:root {
  /* Base — warm-tinted neutrals (not pure gray) */
  --color-bg:           #FAFAF8;   /* warm off-white, main background */
  --color-surface:      #FFFFFF;   /* cards, elevated surfaces */
  --color-surface-alt:  #F5F5F0;   /* zebra stripes, secondary surfaces */

  --color-text:         #0A0C14;   /* primary text — near-black, blue-tinted */
  --color-text-secondary: #5A5D6B; /* secondary text */
  --color-text-tertiary:  #9498A6; /* placeholder, timestamps, captions */

  --color-border:       #E5E5E0;   /* default borders */
  --color-border-strong: #D1D1CC;  /* emphasized borders */

  /* Accent — The Pametnjaković "Smart Green" */
  --color-accent:       #16A34A;   /* primary actions, best deals */
  --color-accent-hover: #15803D;   /* hover state */
  --color-accent-light: #DCFCE7;   /* accent backgrounds */
  --color-accent-subtle:#F0FDF4;   /* very light accent wash */

  /* Price Quality Spectrum */
  --color-deal-best:    #16A34A;   /* Top deal — rich green */
  --color-deal-good:    #65A30D;   /* Good deal — lime-green */
  --color-deal-neutral: #9498A6;   /* Average — gray */
  --color-deal-bad:     #EA580C;   /* Overpriced — orange */
  --color-deal-worst:   #DC2626;   /* Significantly overpriced — red */

  /* Price backgrounds (very subtle) */
  --color-deal-best-bg:    #F0FDF4;  /* green tint */
  --color-deal-good-bg:    #F7FEE7;  /* lime tint */
  --color-deal-neutral-bg: transparent;
  --color-deal-bad-bg:     #FFF7ED;  /* orange tint */
  --color-deal-worst-bg:   #FEF2F2;  /* red tint */

  /* System */
  --color-info:         #2563EB;   /* informational */
  --color-warning:      #D97706;   /* warnings */
  --color-error:        #DC2626;   /* errors */
  --color-success:      #16A34A;   /* confirmations (same as accent) */
}
```

### Price Heatmap Logic

The price spectrum communicates deal quality instantly:

```
Best price across all stores     → --color-deal-best    (green bg + green text)
Within 5% of best price          → --color-deal-good    (light green bg)
Within 5-15% of best             → --color-deal-neutral  (no highlight)
15-30% above best                → --color-deal-bad     (orange bg)
>30% above best                  → --color-deal-worst   (red bg)
```

### Store Color Chips

Each store gets a 12px circular chip in their brand color. This creates instant visual identification without logos.

```css
.store-chip {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.store-chip--konzum   { background: #e31e24; }
.store-chip--lidl     { background: #0050aa; }
.store-chip--plodine  { background: #f7941d; }
/* ... etc */
```

### Contrast Compliance (WCAG AA)

| Combination | Ratio | Pass? |
|------------|-------|-------|
| --color-text on --color-bg | 16.2:1 | AA, AAA |
| --color-text-secondary on --color-bg | 5.8:1 | AA |
| --color-text-tertiary on --color-bg | 3.2:1 | Large text only |
| --color-accent on --color-surface | 4.6:1 | AA |
| --color-deal-best on --color-deal-best-bg | 5.1:1 | AA |
| --color-deal-worst on --color-deal-worst-bg | 5.8:1 | AA |

---

## 7. Component Library

### Price Comparison Row

The most important component in the entire app. Shows one product's price across stores.

```
┌─────────────────────────────────────────┐
│  🥛  Mlijeko trajno 2,8% Z'bregov      │
│      1L · Mliječni proizvodi        ▼  │
│─────────────────────────────────────────│
│  ● Lidl         €1,29  ████████ BEST   │
│  ● Plodine      €1,39  ████████████    │
│  ● Konzum       €1,49  █████████████   │
│  ● Spar         €1,55  ██████████████  │
│  ● Kaufland     €1,59  ██████████████▎ │
└─────────────────────────────────────────┘
```

**Design rules:**
- Category icon (24px) + product name (bold, Space Grotesk 16px)
- Unit/quantity + category as secondary text (14px, gray)
- Store rows sorted cheapest-first
- Store color chip (12px) + store name (14px) + price (18px JetBrains Mono, bold)
- Horizontal bar chart showing relative price (the "ticker" feel)
- Best price row gets green background wash
- Prices >15% above best get orange/red treatment
- Tap any store row → store detail / navigation

**Tailwind structure:**
```html
<div class="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
  <!-- Header -->
  <div class="px-4 pt-4 pb-3 flex items-start gap-3">
    <div class="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
      <!-- Category Icon -->
    </div>
    <div class="min-w-0 flex-1">
      <h3 class="font-semibold text-base text-gray-900 line-clamp-2">Product Name</h3>
      <p class="text-sm text-gray-500 mt-0.5">1L · Mliječni proizvodi</p>
    </div>
  </div>
  <!-- Price Rows -->
  <div class="divide-y divide-gray-50">
    <!-- Best price row -->
    <div class="px-4 py-2.5 flex items-center gap-3 bg-green-50/50">
      <span class="w-3 h-3 rounded-full bg-blue-600 flex-shrink-0"></span>
      <span class="text-sm text-gray-700 w-20 truncate">Lidl</span>
      <span class="font-mono font-bold text-lg text-green-700 ml-auto tabular-nums">€1,29</span>
    </div>
    <!-- Other rows without highlight -->
  </div>
</div>
```

### Store Badge/Chip

```html
<!-- Full chip -->
<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-sm font-medium text-gray-700">
  <span class="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
  Lidl
</span>

<!-- Compact (in tables) -->
<span class="inline-flex items-center gap-1 text-xs text-gray-600">
  <span class="w-2 h-2 rounded-full bg-blue-600"></span>
  LI
</span>
```

### Deal Quality Indicator

```html
<!-- Best deal -->
<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 text-green-700 text-xs font-semibold uppercase tracking-wider">
  Najjeftinije  <!-- "Cheapest" -->
</span>

<!-- Good deal -->
<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-lime-50 text-lime-700 text-xs font-medium">
  -12%
</span>

<!-- Bad deal -->
<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 text-xs font-medium">
  +23%
</span>
```

### Shopping List Item

```
┌─────────────────────────────────────────┐
│  ☑  Mlijeko 2,8% Z'bregov    €1,29     │
│     Lidl · Najjeftinije    ─── sparkline│
│                                         │
│  ☐  Kruh bijeli 500g         €0,99     │
│     Konzum · +8%           ─── sparkline│
│                                         │
│  ☐  Jaja M 10kom             €2,19     │
│     Plodine · +3%          ─── sparkline│
└─────────────────────────────────────────┘
│  Košarica: €14,47  ·  Ušteda: €3,21    │
└─────────────────────────────────────────┘
```

### Basket Optimization Result Card

```
┌─────────────────────────────────────────┐
│  ⚡ OPTIMALNA RUTA                      │
│                                         │
│  Ušteda: €12,40 (18%)                  │
│  ██████████████████░░░░ vs jedan dućan  │
│                                         │
│  ┌─ Lidl (8 artikala) ─────── €24,30 ─┐│
│  │  Mlijeko, Kruh, Jaja, Ulje...      ││
│  └─────────────────────────────────────┘│
│  ┌─ Plodine (5 artikala) ──── €18,90 ─┐│
│  │  Meso, Povrće, Voće...             ││
│  └─────────────────────────────────────┘│
│                                         │
│  Ukupno: €43,20                         │
│  [  Navigiraj  ] [  Podijeli  ]         │
└─────────────────────────────────────────┘
```

### Search Bar

```html
<div class="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 py-3">
  <div class="relative">
    <input
      type="search"
      placeholder="Traži proizvod..."
      class="w-full h-12 pl-11 pr-4 rounded-xl bg-gray-50 border-0 text-base text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-green-500/30 focus:bg-white transition-colors"
    />
    <svg class="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400">
      <!-- Search icon -->
    </svg>
  </div>
  <!-- Filter chips row -->
  <div class="flex gap-2 mt-2 overflow-x-auto no-scrollbar">
    <button class="flex-shrink-0 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-sm font-medium">
      Akcije
    </button>
    <button class="flex-shrink-0 px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 text-sm">
      Mliječni
    </button>
    <!-- more filter chips -->
  </div>
</div>
```

### Category Navigation Grid

```
┌──────┬──────┬──────┬──────┐
│  🥛  │  🍞  │  🍎  │  🥩  │
│Mlijeko│ Kruh │ Voće │ Meso │
├──────┼──────┼──────┼──────┤
│  🥕  │  🍾  │  🧴  │  🍬  │
│Povrće│ Piće │Higij.│Slatko│
├──────┼──────┼──────┼──────┤
│  💧  │  🐟  │  🧊  │ ··· │
│ Ulje │ Riba │Smrzn.│ Sve  │
└──────┴──────┴──────┴──────┘
```

```html
<div class="grid grid-cols-4 gap-2 px-4">
  <button class="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-gray-50 hover:bg-green-50 transition-colors">
    <span class="w-10 h-10 rounded-lg bg-white shadow-sm flex items-center justify-center text-xl">🥛</span>
    <span class="text-xs font-medium text-gray-700 text-center">Mlijeko</span>
  </button>
  <!-- more categories -->
</div>
```

---

## 8. Screen Designs

### Home Screen (Logged In)

**Information hierarchy (top to bottom):**

1. **Header:** Greeting + savings counter + profile avatar
2. **Search bar** (sticky on scroll)
3. **"Your savings this month"** — hero metric with sparkline
4. **Quick actions:** Scan barcode | My list | Alerts
5. **"Danas na akciji"** (Today's deals) — horizontal scroll of deal cards
6. **Categories grid** — 4x3 icon grid
7. **"Najbolje u vašem kvartu"** (Best in your area) — location-based deals
8. **Recent searches** — quick re-access

```
┌─────────────────────────────────────────┐
│ Bok, Marija 👋           [€42,30 ušteđeno] │
│─────────────────────────────────────────│
│ 🔍 Traži proizvod...                   │
│─────────────────────────────────────────│
│                                         │
│ TVOJA UŠTEDA OVAJ MJESEC               │
│ €42,30  ▁▂▃▅▇▆▇█▅▆▇  (+€8,20 vs prošli)│
│                                         │
│ [📷 Skeniraj] [📋 Moja lista] [🔔 Alarmi]│
│                                         │
│ DANAS NA AKCIJI                    Sve →│
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │
│ │deal │ │deal │ │deal │ │deal │       │
│ │card │ │card │ │card │ │card │       │
│ └─────┘ └─────┘ └─────┘ └─────┘       │
│                                         │
│ KATEGORIJE                              │
│ [🥛][🍞][🍎][🥩]                       │
│ [🥕][🍾][🧴][🍬]                       │
│                                         │
├─────────────────────────────────────────┤
│ 🏠  🔍  📋  🔔  👤                     │
│ Home Traži Lista Alert Profil           │
└─────────────────────────────────────────┘
```

### Search Results Screen

```
┌─────────────────────────────────────────┐
│ ← Mlijeko                    🎚️ Filteri │
│─────────────────────────────────────────│
│ 47 rezultata · Sortirano po cijeni  ▼  │
│─────────────────────────────────────────│
│                                         │
│ ┌── Price comparison card ────────────┐ │
│ │ 🥛 Mlijeko trajno 2,8% Z'bregov    │ │
│ │    1L · Mliječni                    │ │
│ │ ● Lidl      €1,29  ████████ BEST   │ │
│ │ ● Plodine   €1,39  ██████████      │ │
│ │ ● Konzum    €1,49  ████████████    │ │
│ │ ● Spar      €1,55  █████████████   │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌── Price comparison card ────────────┐ │
│ │ 🥛 Mlijeko trajno 1,5% Dukat       │ │
│ │    1L · Mliječni                    │ │
│ │ ● Eurospin   €0,99  ████████ BEST  │ │
│ │ ● Kaufland   €1,15  ███████████    │ │
│ │ ...                                 │ │
│ └─────────────────────────────────────┘ │
│                                         │
├─────────────────────────────────────────┤
│ 🏠  🔍  📋  🔔  👤                     │
└─────────────────────────────────────────┘
```

### Product Detail Screen

```
┌─────────────────────────────────────────┐
│ ←                    [♡] [🔔] [+ Lista] │
│─────────────────────────────────────────│
│                                         │
│  🥛  MLIJEČNI PROIZVODI                │
│                                         │
│  Mlijeko trajno 2,8% m.m.              │
│  Z'bregov · 1L                          │
│  EAN: 3850104053018                     │
│                                         │
│  PRICE HISTORY (like a stock chart)     │
│  €1,60─┐                               │
│  €1,40─┤    ╱╲   ╱╲                    │
│  €1,20─┤╱╲╱   ╲╱   ╲___              │
│  €1,00─┴──────────────────             │
│        Sij  Velj  Ožu  Tra             │
│                                         │
│  DANAŠNJE CIJENE          Ažurirano: 8h│
│ ┌───────────────────────────────────────┐
│ │ 🟢 Lidl         €1,29  Najjeftinije │
│ │ ⚪ Plodine      €1,39  +8%          │
│ │ ⚪ Konzum       €1,49  +16%         │
│ │ 🟠 Spar         €1,55  +20%         │
│ │ 🔴 Kaufland     €1,59  +23%         │
│ └───────────────────────────────────────┘
│                                         │
│  PRICE ALERT                            │
│  Obavijesti me kad cijena padne ispod:  │
│  [  €1,20  ]  [Postavi alarm 🔔]       │
│                                         │
├─────────────────────────────────────────┤
│ 🏠  🔍  📋  🔔  👤                     │
└─────────────────────────────────────────┘
```

### Basket / Shopping List Screen

```
┌─────────────────────────────────────────┐
│ Moja košarica              [⚡Optimiraj] │
│ 12 artikala · ~€47,80                   │
│─────────────────────────────────────────│
│                                         │
│ ☑ Mlijeko 2,8% Z'bregov      €1,29    │
│   Lidl · Najjeftinije     ▁▂▃▅        │
│                                         │
│ ☑ Kruh bijeli 500g           €0,99    │
│   Konzum · +8%             ▃▅▂▁        │
│                                         │
│ ☐ Jaja M 10kom              €2,19    │
│   Plodine · +3%           ▂▃▅▇        │
│                                         │
│ ☐ Banana 1kg                €1,39    │
│   Lidl · Najjeftinije     ▅▃▂▁        │
│                                         │
│ [+ Dodaj artikl]                        │
│                                         │
│─────────────────────────────────────────│
│ OPTIMIZACIJA                            │
│ ┌─ Jedan dućan ──────────── €54,20 ────┐│
│ │ Lidl (9/12 dostupno)                 ││
│ └──────────────────────────────────────┘│
│ ┌─ Split (2 dućana) ─ PREPORUKA ───────┐│
│ │ Ušteda: €6,40 (12%)                  ││
│ │ Lidl: €31,40 (8 artikala)            ││
│ │ Plodine: €16,40 (4 artikala)         ││
│ └──────────────────────────────────────┘│
│                                         │
├─────────────────────────────────────────┤
│ 🏠  🔍  📋  🔔  👤                     │
└─────────────────────────────────────────┘
```

---

## 9. Navigation & Information Architecture

### Mobile Navigation (Bottom Tabs)

5 tabs — the maximum for thumb-friendly mobile navigation:

| Tab | Icon | Label | Primary Action |
|-----|------|-------|---------------|
| 1 | 🏠 | Početna | Home feed, savings dashboard |
| 2 | 🔍 | Traži | Product search + category browse |
| 3 | 📋 | Košarica | Shopping list + basket optimization |
| 4 | 🔔 | Alarmi | Price alerts + notifications |
| 5 | 👤 | Profil | Account, settings, stats, upgrade |

**Design rules:**
- Active tab: Filled icon + accent color label
- Inactive tabs: Line icon + gray label
- Height: 56px (safe for all devices + home indicator)
- The central "Košarica" tab can be slightly elevated (FAB-style) for emphasis
- Badge count on Alarmi tab for unread notifications

```html
<nav class="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 pb-safe z-50">
  <div class="flex items-center justify-around h-14">
    <a class="flex flex-col items-center gap-0.5 text-green-600">
      <svg class="w-6 h-6"><!-- filled home --></svg>
      <span class="text-[10px] font-medium">Početna</span>
    </a>
    <a class="flex flex-col items-center gap-0.5 text-gray-400">
      <svg class="w-6 h-6"><!-- outline search --></svg>
      <span class="text-[10px]">Traži</span>
    </a>
    <!-- ... -->
  </div>
</nav>
```

### Information Architecture

```
Home
├── Savings Dashboard (hero metric)
├── Quick Actions (scan, list, alerts)
├── Today's Deals (curated)
├── Categories
└── Location-based recommendations

Search
├── Search input (autocomplete)
├── Filter chips (category, store, deal-only)
├── Results (price comparison cards)
└── Product Detail
    ├── Price chart (history)
    ├── Store prices (sorted)
    ├── Set alert
    └── Add to list

Košarica (Basket)
├── Active lists
├── List items with inline optimization
├── Optimize button
└── Optimization result
    ├── Single-store option
    ├── Split-basket option (with savings calc)
    └── Route/navigation

Alarmi (Alerts)
├── Active alerts list
├── Alert history (triggered)
├── Create new alert
└── Alert settings (channels: push, email, etc.)

Profil (Profile)
├── Account info
├── Savings stats / achievements
├── Subscription tier + upgrade
├── Settings
│   ├── Preferred stores
│   ├── Location
│   ├── Notification preferences
│   └── Theme (light/dark)
├── Smart Points & badges
└── Help / feedback
```

### Gesture Support

| Gesture | Action | Context |
|---------|--------|---------|
| Pull down | Refresh prices | Any list view |
| Swipe left on list item | Delete / remove | Shopping list |
| Swipe right on list item | Mark as bought | Shopping list |
| Long press on product | Quick actions menu | Search results |
| Pinch on chart | Zoom time range | Price history |
| Tap + hold price | Copy price | Price displays |

---

## 10. Engagement & Habit Loops (Hook Model)

### Ethics Statement

Tvoja Košarica falls in the **Facilitator** quadrant of the Manipulation Matrix — we use the product ourselves AND it materially improves users' lives (saving real money). Our engagement tactics are designed to help users save more, not to exploit attention.

### Primary Hook Loop: "Pre-Shop Check"

```
TRIGGER:        "Idem u dućan" (I'm going to the store)
                → Internal: anxiety about overspending
                → External: weekly deal notification (Sunday evening)

ACTION:         Open app → see shopping list with current best prices
                (< 3 seconds to value)

VARIABLE REWARD:
  • Hunt: "Mlijeko palo na €0,99 kod Lidla!" (unexpected deal discovery)
  • Self: "Uštedjela si €8,40 ovaj tjedan" (savings accomplishment)
  • Tribe: "3.241 korisnika danas uštedjelo ukupno €12.450" (collective wins)

INVESTMENT:     Add items to list, set price alerts, mark items bought
                → Loads the next trigger (alert notifications)
```

### Secondary Hook Loop: "Barcode Check" (In-Store)

```
TRIGGER:        Standing in store, looking at a price tag
                → Internal: "Is this really a good deal?"

ACTION:         Scan barcode → instant comparison (< 2 seconds)

VARIABLE REWARD:
  • Hunt: See that the same item is €0.50 cheaper across the street
  • Self: Confirmed suspicion — the "sale" is fake (vindication)

INVESTMENT:     Report availability, scan more items, build store knowledge
```

### Notification Strategy (External Triggers)

| Notification | Timing | Frequency | Type |
|-------------|--------|-----------|------|
| "Your list just got cheaper" | When basket total drops | As it happens | Push |
| Price alert triggered | When watched item drops below threshold | As it happens | Push + Email |
| Weekly savings report | Monday 8:00 AM | Weekly | Push + Email |
| "Best deals near you" | Saturday 9:00 AM (pre-shop) | Weekly | Push |
| Monthly savings recap | 1st of month | Monthly | Email |
| Achievement unlocked | On earning | Variable | Push |

**Rules:**
- Max 3 push notifications per day
- Users control which types they receive
- Every notification includes specific value (amount saved, price drop amount)
- Never send notifications with no actionable information

### Onboarding Hook (First 5 Minutes)

```
1. WELCOME (5 seconds)
   "Tvoja Košarica — Usporedi. Uštedi. Ponovi."
   Skip button visible.

2. INSTANT VALUE (30 seconds)
   "Napiši jedan proizvod koji kupuješ svaki tjedan:"
   [ Mlijeko                    ]
   → Show live price comparison across all stores
   "Da je Konzum €0.30 skuplji od Lidla za ovo — to je €15/godišnje samo na mlijeku."

3. FIRST INVESTMENT (60 seconds)
   "Dodaj još 2-3 artikla u listu — pogledaj koliko možeš uštedjeti:"
   [+ Kruh] [+ Jaja] [+ Ulje] [+ Banana]  (smart suggestions)

4. SAVINGS REVEAL (10 seconds)
   "S 4 artikla, možeš uštedjeti €4,20 tjedno — to je €218/godišnje!"
   Animated counter: €0 → €218

5. OPTIONAL ACCOUNT (15 seconds)
   "Spremi listu i primaj obavijesti kad cijene padnu"
   [Nastavi s Google] [Nastavi s emailom] [Preskoči za sad]
```

---

## 11. Gamification System

### Smart Points (Pametni Bodovi)

| Action | Points | Frequency |
|--------|--------|-----------|
| Search a product | 1 | Per unique search/day |
| Add item to list | 2 | Per item |
| Complete a basket optimization | 5 | Per optimization |
| Scan barcode | 3 | Per unique scan |
| Upload product photo ("Paparazzo") | 10 | Per approved photo |
| Report availability | 5 | Per verified report |
| Share a deal | 3 | Per share |
| Refer a friend (who signs up) | 50 | Per referral |
| Write a store review | 10 | Per review |

### Badges

| Badge | Requirement | Tone |
|-------|------------|------|
| **Prvi Pametnjaković** | Complete onboarding | "Welcome to the smart side" |
| **Štediša** (Penny Pincher) | Save €10 total | "Every lipa counts" |
| **Profesionalni Štediša** | Save €100 total | "Your wallet sends its regards" |
| **Paparazzo** | Upload 10 product photos | "Better than TMZ" |
| **Detektiv Cijena** (Price Detective) | Use price history 10 times | "Fake sale? Not on your watch" |
| **Košarica Ninja** | Optimize 5 baskets | "Silent but savings" |
| **Barcode Manijak** | Scan 50 barcodes | "Beep beep beep" |
| **Lokalni Stručnjak** (Local Expert) | 20 availability reports | "You know things" |
| **Verificirani Škrtac** (Verified Cheapskate) | Save €500 total | "Legendary" |
| **Influencer Uštede** | 10 successful referrals | "Spreading the word" |

### Levels

```
Level 1:   Početnik (Beginner)           0 - 99 pts
Level 2:   Pametnjaković                 100 - 499 pts
Level 3:   Profesionalac (Pro)           500 - 1,999 pts
Level 4:   Stručnjak (Expert)            2,000 - 4,999 pts
Level 5:   Legenda Uštede (Savings Legend) 5,000+ pts
```

### Points → Premium Features Exchange

Users can "pay" with points instead of money:
- **1 extra price watch** = 100 points (Plus feature)
- **1 week basket optimization** = 200 points (Premium feature)
- **Price history for 1 product** = 50 points (Premium feature)

This creates a powerful loop: engagement → points → premium features → more engagement.

### "Paparazzo Mode" (Crowdsourced Product Photos)

```
┌─────────────────────────────────────────┐
│  📸 PAPARAZZO MODE                      │
│                                         │
│  "Bili smo prelijeni za fotografa.      │
│   Ti to napravi i osvoji bodove."       │
│                                         │
│  Fotografiraj ovaj proizvod u dućanu:   │
│                                         │
│  Mlijeko trajno 2,8% Z'bregov          │
│  Barcode: 3850104053018                 │
│                                         │
│  [  📷 Fotografiraj  ]                  │
│                                         │
│  Nagrada: +10 Pametnih Bodova           │
│  Tvoj status: Paparazzo Level 2 (7/10)  │
└─────────────────────────────────────────┘
```

---

## 12. Conversion & Monetization

### Tier Summary

| Feature | Free | Plus (€2,99/mj) | Premium (€5,99/mj) |
|---------|------|-----------------|-------------------|
| Search & compare | Unlimited | Unlimited | Unlimited |
| Shopping lists | 1 | Unlimited | Unlimited |
| Price alerts | 0 | 5 active | Unlimited |
| Basket optimization | Basic (1 store) | Basic (1 store) | Split-basket (multi-store) |
| Price history | 7 days | 30 days | Full history |
| Barcode scan | 3/day | Unlimited | Unlimited |
| Ads | Yes | No | No |
| Family sharing | No | No | Up to 5 |
| Dietary filters | No | No | Yes |
| Smart Points exchange | No | Yes | Yes |
| Priority support | No | No | Yes |

### Paywall Strategy: "Show Value, Then Ask"

**Principle:** Never block core functionality. Always show what the user WOULD get, then gate it.

**Example — Price History:**
```
Free users see:
┌─────────────────────────────────┐
│  POVIJEST CIJENA                │
│  Last 7 days visible            │
│  €1,49 ──── €1,29 ─── €1,39   │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░   │ ← blurred older data
│                                 │
│  "Prije 3 mjeseca ovo je bilo   │
│   €0,99. S Plus pretplatom,     │
│   vidjet ćeš kad se ponavlja."  │
│                                 │
│  [Otključaj s Plus — €2,99/mj]  │
│  [Otključaj s 50 bodova]        │
└─────────────────────────────────┘
```

**Example — Basket Split:**
```
Free users see:
┌─────────────────────────────────┐
│  ⚡ SPLIT KOŠARICA              │
│                                 │
│  Tvoja košarica u jednom dućanu: │
│  €54,20 (Lidl)                  │
│                                 │
│  S Premium optimizacijom:       │
│  €43,20 — ušteda €11,00! 🎉    │
│  (Lidl + Plodine)               │
│                                 │
│  "To je €572/godišnje uštede.   │
│   Premium se isplati za 3 dana."│
│                                 │
│  [Isprobaj Premium 7 dana FREE] │
└─────────────────────────────────┘
```

### Conversion Triggers

| Trigger | When | What User Sees |
|---------|------|---------------|
| List limit reached | Creating 2nd list | "Upgrade to Plus for unlimited lists" |
| Alert limit reached | Setting 6th alert | "Plus lets you watch more" |
| Scan limit | 4th daily scan | "Unlimited scans with Plus" |
| Split basket teaser | After any optimization | "Split across stores saves €X more" |
| Savings milestone | After €50 saved (free) | "Imagine how much more with Premium" |
| Friend referral | Any time | "Refer 3 friends → 1 month Plus free" |

### Objection / Counter-Objection Framework

| Objection | Counter-Objection |
|-----------|------------------|
| "€2,99 is too much" | "If you save €5/week (which most users do), Plus pays for itself in the first week" |
| "The free version is enough" | "You're right — it is useful. Plus just automates the savings you're already finding manually." |
| "I'll forget to cancel" | "Cancel anytime with one tap. No contracts, no tricks. You keep access until the period ends." |
| "I don't trust small apps with my card" | "Payment processed securely through Apple/Google. We never see your card details." |
| "Croatian apps are always buggy" | "We process millions of prices daily. Our data comes from the same mandatory government feeds the stores use." |
| "I don't shop enough to need this" | "Even shopping twice a month, most users save €20-40/month. That's 7-13x the subscription cost." |

### Landing Page Structure

```
SECTION 1: HERO (above the fold)
├── Headline: "Svaki dućan. Svaka cijena. Tvoja ušteda."
├── Subhead: "Usporedi cijene u 11 trgovačkih lanaca. Besplatno."
├── CTA: [Usporedi cijene →] (search box inline)
└── Social proof: "14.230 korisnika uštedjelo ukupno €892.400"

SECTION 2: PROBLEM AGITATION
├── "Znate li koliko prepalaćujete?"
├── Interactive element: Enter a common item, see price range
└── "Razlika od €0,50 po artiklu = €600/godišnje"

SECTION 3: HOW IT WORKS (3 steps)
├── 1. Pretraži
├── 2. Složi košaricu
└── 3. Uštedi

SECTION 4: SOCIAL PROOF
├── Testimonials
├── Media mentions
└── Stats (stores, products, users)

SECTION 5: TIER COMPARISON
├── Free / Plus / Premium table
└── CTA: [Započni besplatno]

SECTION 6: FAQ
└── Objection handling as questions

SECTION 7: FINAL CTA
├── "Koliko možeš uštedjeti? Saznaj u 30 sekundi."
└── [Izračunaj svoju uštedu →]
```

### Key Metrics to Track

| Metric | Target | Why |
|--------|--------|-----|
| Landing → Search | >60% | Shows immediate value delivery |
| Search → Account | >20% | Conversion to registered user |
| Free → Plus (30d) | 5% | Core monetization |
| Free → Premium (30d) | 1.5% | Power user conversion |
| Weekly active (free) | >40% | Engagement health |
| Daily active (paid) | >25% | Retention indicator |
| 7-day retention | >50% | Hook model effectiveness |
| 30-day retention | >30% | Habit formation |
| Avg. basket savings | >€5 | Core value metric |
| NPS | >50 | User satisfaction |

---

## 13. UX Heuristics & Accessibility

### Nielsen's 10 Heuristics — Applied

#### 1. Visibility of System Status

| Guideline | Implementation |
|-----------|---------------|
| Show when prices were last updated | "Ažurirano: danas 08:00" on every price display |
| Loading states for search | Skeleton screens with store chips animating |
| Optimization progress | "Računamo najbolju rutu..." with progress bar |
| Sync status | Green dot = fresh data, yellow = updating |

**Pitfall to avoid:** Don't show "loading" for more than 3 seconds without progress indication. Users will assume it's broken.

#### 2. Match Between System and Real World

| Guideline | Implementation |
|-----------|---------------|
| Use Croatian grocery terms | "Košarica" not "Cart", "Akcija" not "Promotion" |
| Price format | Croatian: €1,29 (comma decimal) |
| Store names as people know them | "Lidl" not "Lidl Hrvatska d.o.o." |
| Date format | Croatian: 6.2.2026. (dd.mm.yyyy.) |

#### 3. User Control and Freedom

| Guideline | Implementation |
|-----------|---------------|
| Undo on list actions | Snackbar: "Uklonjeno. [Vrati]" for 5 seconds |
| Easy exit from any flow | Back button + close (X) always visible |
| Clear all filters | Single "Obriši filtere" button |
| Change/cancel alerts easily | Swipe-to-delete on alert list |

#### 4. Consistency and Standards

| Element | Standard |
|---------|----------|
| Price display | Always: JetBrains Mono, right-aligned, €X,XX format |
| Store identification | Always: color chip + name (never just color or just name) |
| CTAs | Green for primary, gray outline for secondary |
| Destructive actions | Red text, never red filled button for routine actions |
| Back navigation | Always top-left arrow, same position |

#### 5. Error Prevention

| Scenario | Prevention |
|---------|-----------|
| Empty search | Show popular searches and categories |
| No results | Suggest fuzzy matches: "Jeste li mislili: mlijeko?" |
| Invalid alert threshold | Show current price range: "Cijena je trenutno €1,29-€1,59" |
| Accidental delete | Swipe requires confirmation for important items |
| Double-tap purchase | Debounce all action buttons (300ms) |

#### 6. Recognition Rather Than Recall

| Guideline | Implementation |
|-----------|---------------|
| Recent searches | Show last 10 searches on search screen |
| Favorite stores | Pre-filter by user's preferred stores |
| Shopping list context | Show current prices inline with list items |
| Store identification | Color chips provide instant visual recognition |

#### 7. Flexibility and Efficiency

| User Level | Feature |
|-----------|---------|
| Beginner | Bottom tab navigation, large touch targets |
| Intermediate | Search with filter chips, long-press shortcuts |
| Expert | Barcode scan, keyboard shortcuts (web), gesture navigation |

#### 8. Aesthetic and Minimalist Design

- Every screen has ONE primary action
- Dense data uses progressive disclosure (tap to expand)
- No decorative images — every visual element serves a function
- White space between sections prevents information overload

#### 9. Help Users Recognize, Diagnose, and Recover from Errors

```
❌ "Error 404"
✅ "Nismo pronašli taj proizvod. Pokušaj drugačiji naziv ili skeniraj barcode."

❌ "Network error"
✅ "Nema interneta. Zadnje cijene od jučer su još dostupne."

❌ "Invalid input"
✅ "Cijena mora biti između €0,01 i €999,99"
```

#### 10. Help and Documentation

- Onboarding tooltips for first-time features
- "?" icon on complex features (basket optimization, price history)
- FAQ accessible from profile
- In-context help: "Što je split košarica?" as expandable section

### Touch Targets

```
Minimum touch target:  48 × 48px (12 × 12 Tailwind units)
Recommended:           56 × 56px (14 × 14)
Between targets:       ≥8px gap minimum
Bottom nav items:      Equal width, full tab height clickable
```

### Accessibility Requirements

| Requirement | Standard | Implementation |
|-------------|----------|---------------|
| Color contrast | WCAG AA (4.5:1 normal, 3:1 large) | All text passes, verified above |
| Color not sole indicator | WCAG 1.4.1 | Deal quality shown with color + label + icon |
| Screen reader | WCAG 2.1 A | aria-labels on all icons, price changes announced |
| Reduced motion | prefers-reduced-motion | All animations respect user preference |
| Font scaling | Up to 200% | Layout must not break at 2× browser zoom |
| Focus indicators | WCAG 2.4.7 | Visible green outline on all interactive elements |

---

## 14. Motion & Micro-interactions

### Animation Principles

```css
:root {
  /* Custom easings — no linear or default ease */
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-in-out-expo: cubic-bezier(0.87, 0, 0.13, 1);

  /* Durations */
  --duration-fast: 150ms;     /* hover, small state changes */
  --duration-normal: 250ms;   /* transitions, reveals */
  --duration-slow: 400ms;     /* page transitions, large reveals */
  --duration-emphasis: 600ms; /* celebration animations */
}

/* Respect user preference */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Key Animations

| Element | Animation | Purpose |
|---------|-----------|---------|
| Price comparison load | Staggered row reveal (80ms delay each) | Creates the "ticker loading" feel |
| Price change | Number counter animation (old → new) | Makes price changes feel real |
| Deal found | Green pulse glow on best price | Draws eye to the win |
| Add to list | Item slides to bottom tab, count +1 | Confirms action visually |
| Basket optimization | Progress bar + animated savings counter | Builds anticipation |
| Achievement unlocked | Badge bounce-in + confetti (subtle) | Celebration without obnoxiousness |
| Pull to refresh | Custom animation (basket icon fills) | Brand-consistent loading |
| Savings counter | Count-up animation on home screen | Makes savings feel tangible |
| Sparkline | Draw-on animation from left to right | Implies progress/time |

### Page Transitions

- **Forward navigation:** Content slides in from right (iOS standard)
- **Back navigation:** Content slides in from left
- **Modal/sheet:** Slides up from bottom with spring physics
- **Tab switch:** Crossfade (150ms)

---

## 15. Dark Mode

### Color Mapping

```css
[data-theme="dark"] {
  --color-bg:             #0C0D11;   /* near-black, slightly blue */
  --color-surface:        #16171D;   /* elevated surface */
  --color-surface-alt:    #1C1D24;   /* secondary surface */

  --color-text:           #EDEDEF;   /* primary text */
  --color-text-secondary: #9498A6;   /* secondary */
  --color-text-tertiary:  #5A5D6B;   /* tertiary */

  --color-border:         #2A2B33;   /* subtle borders */
  --color-border-strong:  #3A3B44;   /* emphasized */

  /* Accent slightly brighter in dark mode */
  --color-accent:         #22C55E;   /* brighter green */

  /* Deal colors adjusted for dark backgrounds */
  --color-deal-best:      #22C55E;
  --color-deal-best-bg:   rgba(34, 197, 94, 0.1);
  --color-deal-bad:       #F97316;
  --color-deal-bad-bg:    rgba(249, 115, 22, 0.1);
  --color-deal-worst:     #EF4444;
  --color-deal-worst-bg:  rgba(239, 68, 68, 0.1);
}
```

### Dark Mode Principles

- Shadows are replaced by lighter borders (shadows invisible on dark)
- Elevation shown through surface color brightness (higher = lighter)
- Charts/sparklines use brighter colors for visibility
- Store brand colors may need brightened variants
- Default to system preference, with manual toggle in settings

---

## 16. Voice & Tone Guide

### Brand Voice: "Pametnjaković"

**Who we sound like:** Your smart friend who knows every deal in town — helpful but never boring, confident but never arrogant, funny but never trying too hard.

**Core voice traits:**

| Trait | What it means | Example |
|-------|--------------|---------|
| **Sharp** | Quick, precise, no filler | "€0,30 jeftinije. Lidl. Sad." |
| **Witty** | Clever wordplay, Croatian humor | "Kruh je skuplji od zlata? Gotovo." |
| **Direct** | Say it plainly, don't dance | "Ovdje su cijene. Vi odlučite." |
| **Empowering** | You're smart, we just help | "Ti si pametnjaković — mi smo samo kalkulator." |

### Tone by Context

| Context | Tone | Example |
|---------|------|---------|
| **Onboarding** | Warm, encouraging | "Super izbor! Pogledajmo koliko možeš uštedjeti." |
| **Deal found** | Excited, celebratory | "Ulov dana! €0,99 za mlijeko kod Lidla!" |
| **No results** | Helpful, light | "Nismo to pronašli. Probaj skratiti ime ili skeniraj barcode." |
| **Error** | Calm, helpful | "Ups, nešto ne radi. Pokušaj opet za minutu." |
| **Empty state** | Witty, motivating | "Tvoja košarica je prazna. Kao i tvoj fridge, pretpostavljamo." |
| **Upgrade prompt** | Value-focused, honest | "Plus se isplati za €2,99/mj. Prosječna ušteda: €22/mj." |
| **Achievement** | Fun, rewarding | "Čestitamo! Uštedjela si €100 — službeno si profesionalni štediša." |
| **Price alert** | Urgent, actionable | "⬇️ Mlijeko Z'bregov palo na €1,09 kod Lidla. Tvoj alarm: €1,15." |
| **Loading** | Playful | "Pretražujemo 11 dućana... brže od tete na blagajni." |

### Empty State Copy Examples

```
Shopping list empty:
"Tvoja košarica je prazna kao petak navečer nakon plaće. Dodaj nešto!"

No search results:
"Nismo pronašli '${query}'. Ili ne postoji, ili to ne prodaje nitko u HR. Oboje bi nas iznenadilo."

No price alerts:
"Nemaš nijedan alarm. Cijene se mijenjaju svaki dan — ne bi li htio znati kad padnu?"

No achievements yet:
"Još nemaš nijednu značku. Ali to je OK, svi smo nekad bili početnjakovići."

First basket optimization:
"Ovo je tvoja prva optimizacija! Pripremi se da ti padne vilica kad vidiš koliko si mogla uštedjeti."
```

### Croatian Language Guidelines

- Use informal "ti" form, not formal "Vi" (unless user is 60+, offer a setting)
- Croatian diacritics are mandatory: č, ć, ž, š, đ — never skip them
- Currency: € symbol, comma as decimal separator (€1,29)
- Numbers: Dot as thousands separator (€1.234,56)
- Dates: dd.mm.yyyy. format with trailing period
- Short form store names (Lidl, Konzum, Spar) — never "Lidl Hrvatska d.o.o. k.d."

---

## 17. Open Questions for Collaboration

These are decisions that benefit from cross-model collaboration (Gemini, Codex, human review):

### Brand & Identity

1. **Brand name final decision:** "Tvoja Košarica" vs "Pametnjaković" vs something else?
   - Recommendation: "Tvoja Košarica" as app name, "Pametnjaković" as brand character/mascot

2. **Logo direction:** Geometric basket icon? Stylized "TK" monogram? Abstract price chart?
   - Needs visual exploration (Figma/design tool)

3. **Mascot:** Should "Pametnjaković" have a visual character?
   - Options: Abstract (just the name), illustrated character, emoji-like icon

### UX Decisions

4. **"Ti" vs "Vi" form:** Default informal, with option for formal in settings?
   - Recommendation: Informal by default, no toggle needed (aligns with brand personality)

5. **PWA vs Native first?**
   - PWA recommended for V1 (lower cost, cross-platform, instant updates)
   - Native later for barcode scanning performance + push notifications

6. **Offline support scope:** What works without internet?
   - Recommendation: Last-fetched prices cached, shopping list always available, search requires connection

7. **Receipt OCR priority:** Is "slikaj košaricu" (photo your receipt) V1 or V2?
   - Recommendation: V2 — complex, high error rate, not core value prop

### Technical Decisions

8. **Frontend framework for consumer app:**
   - Current admin: React + TanStack Router
   - Consumer: Same stack? Or separate Next.js/Remix app? React Native for mobile?
   - Recommendation: Separate Next.js app for consumer (SSR, SEO, PWA support)

9. **Analytics:** What to use?
   - Options: PostHog (self-hosted), Plausible, Google Analytics
   - Need event tracking for funnel analysis

10. **Push notification service:**
    - Firebase Cloud Messaging (FCM) for web push?
    - Separate service for email alerts?

### Business Decisions

11. **Launch market:** Zagreb only first? Or all of Croatia?
    - Data is national, but marketing can be targeted

12. **Year pricing:** Monthly only first, or offer annual discount at launch?
    - Recommendation: Both from day one (annual = 2 months free incentive)

13. **Student/pensioner discounts:** Separate pricing or just rely on free tier?
    - Recommendation: Free tier is generous enough. Focus on points-for-premium as the "discount."

---

## Appendix A: Design Reference Board

### Visual Inspirations

| Reference | What to Take | What to Leave |
|-----------|-------------|---------------|
| Bloomberg Terminal | Data density, number formatting, price color coding | Complexity, learning curve |
| Apple Stocks app | Clean charts, minimalist cards, typography | Lack of personality |
| Revolut | Financial dashboard, savings gamification | Too much feature density |
| Duolingo | Gamification, streaks, achievements | Childish illustrations |
| Monzo | Bank feed clarity, smart categories | Banking-specific patterns |
| Too Good To Go | Deal urgency, simple UX, green accent | Image-heavy approach |

### Design Tools Needed

- **Figma:** Screen designs, component library, prototyping
- **Lucide Icons:** Base icon set (customize for grocery categories)
- **Recharts or Visx:** Price history charts (React-compatible)
- **Lenis:** Smooth scroll for landing page
- **Framer Motion:** React animations

---

## Appendix B: V1 MVP Scope

For launch, focus on these screens only:

| Priority | Screen | Tier |
|----------|--------|------|
| P0 | Landing page | Public |
| P0 | Search + results | Free |
| P0 | Product detail (prices + basic history) | Free |
| P0 | Shopping list (1 list) | Free |
| P1 | Basket optimization (single store) | Free |
| P1 | Account creation/login | Free |
| P1 | Profile + settings | Free |
| P1 | Upgrade/pricing page | All |
| P2 | Price alerts | Plus |
| P2 | Split basket | Premium |
| P2 | Barcode scanner | Plus |
| P2 | Achievements/points | All |

---

*Document generated: 2026-02-06*
*Version: 1.0-draft*
*Status: Ready for cross-model review (Gemini, Codex) and human approval*
*Next steps: Visual prototyping in Figma, component implementation, landing page copy finalization*
