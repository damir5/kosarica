# Review v2: AI Bot & Community Strategy (Pametnjaković) — Marketing & Community Growth Lens

**Source doc reviewed:** `docs/AI-BOT-STRATEGY.md` (v1.1, 2026-02-06)  
**This review updates:** `docs/reviews/codex-bot-review.md` (v1)  
**Reviewer stance:** Senior product strategist + community growth (Croatia-first distribution)

---

## Executive verdict (v2)

Big step-change since v1: the strategy is now much closer to a *trust-first, shippable* marketing + community engine.

Most important fixes that materially improve growth outcomes:

- **Deterministic content pipeline + quality gates** (LLM commentary only; validated numbers; kill switch) reduces “AI sludge” risk and protects brand trust.
- **De-scoped MVP phasing + channel sequencing** makes sustained quality realistic for a small team.
- **Metrics reset to deduped reachable community** makes targets more honest and operationally useful.

However, the plan still leans heavily on **owned channels** (Telegram/Facebook Page/Blog). In Croatia, the biggest acquisition lever for grocery deals is **earned distribution inside existing Facebook groups + Viber communities + WhatsApp family groups** — and the doc still lacks a concrete, repeatable playbook for that.

---

## 1) Updated section scores (after v1.1 fixes)

Scoring rubric: “Will this drive *user acquisition + retention* via content/community, without breaking trust or ops capacity?”

| Section | v1 score | v2 score | What changed (impact on growth) |
|---|---:|---:|---|
| Community channels setup | 6.0 | **7.5** | Better sequencing + explicit FB groups role; still under-specifies Viber/WhatsApp reality and group ops. |
| Marketing bot (content automation) | 5.0 | **7.5** | Deterministic templates + validation + max-frequency caps; now viable for sustained brand trust. |
| Product bot (price intelligence) | 7.0 | **7.5** | Cleaner admin→public flow; anomaly logic supports “headline-worthy” content when curated. |
| Helpdesk bot | 6.0 | **6.5** | Solid tiering; still missing community-facing “close the loop” moments that build belonging. |
| Data quality bot | 7.5 | **7.5** | Still strong; biggest marketing contribution is invisible trust—needs a public-facing trust narrative. |
| Launch / pre-launch marketing | 4.0 | **5.5** | “No pre-launch posting” reduces burn + spam risk, but leaves acquisition underpowered unless replaced with a waitlist/value capture loop. |
| MVP phasing / integration | 3.5 | **6.5** | Much more credible; still tight for 4–6 weeks, but the focus is now correct (content + distribution). |
| Technical architecture | 6.0 | **6.0** | Clean separation, but OpenClaw + multi-channel automation is still ops-heavy; OK if you keep V1 narrow. |
| Ethics & safety | 5.0 | **5.5** | Better disclosure and misinformation controls; “joining channels = consent” is still a risk framing. |
| Metrics & KPIs | 4.5 | **6.5** | Better targets + attribution; still missing retention metrics tied to habit (7/30-day active, digest opt-in). |

**Overall (weighted) v2 score:** **6.9 / 10**  
Reason it’s not 8+: distribution mechanics (earned channels) and retention loops are still under-designed.

---

## 2) How the bot can BEST drive marketing + community growth (what to prioritize)

### A. The bot’s #1 job: “Make savings shareable”

Grocery deal sharing is *social proof + reciprocity* (“Evo, našao/la sam dobru akciju — da i ti uštediš.”). Your bot should output content that is:

- **Screenshot-native** (image cards win in FB groups/Viber)
- **Forward-native** (short, clear, “send to spouse” friendly for WhatsApp/Viber)
- **Argument-proof** (“source + timestamp + which chain + how much cheaper”)
- **Copy-pasteable** (prewritten group post text, not just a link)

If you do one thing: treat each post as a **distribution asset**, not content.

### B. Define 3 “hero formats” that repeat forever (and become habits)

Your current format list is good, but growth needs *few iconic formats* with consistent naming and cadence:

1. **Deal dana (1 card)** — only when meaningful; always includes “why it matters” (annualized savings on a typical basket).
2. **Košarica Index (weekly)** — “tko je najjeftiniji lanac ovaj tjedan” + 3 biggest movers + 1 surprise.
3. **Inflacija hrane (monthly)** — press-ready charts, but also a 5-line “explain like I’m busy” summary.

Everything else is secondary.

### C. Use “Clear Mode” for acquisition channels; keep “Witty Mode” for owned community

In Croatia, Facebook group culture around prices is pragmatic. Sarcasm can backfire (especially 35+ and 45+).

Practical rule:

- **FB Groups / Viber / WhatsApp:** Clear Mode, minimal persona, no jokes about users.
- **Telegram Channel / your FB Page comments:** light Witty Mode to build brand memory.

This reduces rejection risk in the exact channels you need for distribution.

---

## 3) Croatia-specific distribution: what will actually acquire users

### A. Facebook Groups (P0 acquisition channel)

Treat FB groups as your “app store.” You need an explicit ops playbook:

**1) Target group types (search + outreach)**
- “akcije”, “popusti”, “kuponi”, “štednja”
- city/regional groups: “Zagreb”, “Split”, “Rijeka”, “Osijek” + “mame” groups
- chain-specific groups (Lidl/Kaufland/Konzum “akcije” communities)

**2) Posting package (make it easy for group admins to say yes)**
- 1 image (deal card) + 5 lines text (Clear Mode) + source/time + “bez spama: max 2–3 objave/tjedno”
- “If you want, we can tailor posts to your group (city/lanac)”

**3) Cadence that matches shopping behavior**
- **Wed/Thu:** “vikend se planira” (pre-shopping planning)
- **Fri 16:00–20:00:** “vikend ponude” spike
- **Sun evening:** “planiraj tjedan” weekly basket/Index

**4) Comment strategy (where trust is won)**
- Bot should *not* argue. It should: restate numbers + timestamp + link + offer a correction flow (“pošalji sliku police / link cjenika”).

**Growth KPI to track:** “FB group posts → link clicks → Telegram/WhatsApp opt-ins → app usage”.

### B. Viber (P0/P1 for 35+ / 45+ reach)

Viber is often the “family logistics” layer in Croatia (especially older demographics). For deal sharing, it behaves like WhatsApp but with stronger community/channel patterns.

**What to do (concrete):**
- Create **Viber Community**: “Tvoja Košarica | Akcije u Hrvatskoj”
- Post **1–3 cards/week** (Index + weekend + one standout deal), not daily.
- Add a pinned message: “Kako provjeravamo cijene (timestamp + izvor)”.
- Build a “share prompt” CTA: “Pošalji ovo u obiteljsku grupu ako netko ide u dućan.”

**Decision gate:** if Viber automation/API is hard, start with **manual posting** for the first 30 days. Don’t block growth on tooling.

### C. WhatsApp (P1 retention + household sharing)

WhatsApp is less “public discovery” and more “private forwarding.” Use it for *retention*:

- **WhatsApp Channel** (public): weekly digest + weekend deals
- **Opt-in broadcast list** (segmented): “Obiteljska košarica”, “Student budžet”, “Umirovljenici”
- Keep messages **short**, with **one image** and **one link**.

**Key compliance habit:** explicit opt-in + clear unsubscribe command; don’t rely on “they joined a channel = consent” logic for proactive notifications.

---

## 4) Viral mechanics / growth loops (make them explicit)

Right now, KPIs mention loops, but the *mechanics* are not specified. You need 2–3 concrete loops:

### Loop 1: “Deal card → share → new follower → next card”
- Every card includes: “Podijeli u grupu / pošalji doma.”
- Each card uses a **trackable short link** (per post; ideally per user for DM flows).
- Landing page offers: “Dobivaj vikend ponude” (Telegram/Viber/WhatsApp choice).

### Loop 2: “Košarica Index → local pride argument → comments → forwards”
People love ranking fights: “Lidl je opet najjeftiniji” / “Konzum je pljačka” (emotion drives sharing).

Design Index posts to invite a *non-toxic* debate:
- “Koji lanac je vama najbliži i zašto?”
- “Koju namirnicu ste primijetili da je poskupila?”

### Loop 3: “Community scout → recognition → more scouts”
UGC creates belonging (retention) and increases distribution surface (acquisition).

Minimal version (no complex reliability scoring yet):
- “Deal scout tjedna” shoutout on Telegram + FB Page
- Simple submission: “pošalji link cjenika / screenshot” (not raw prices typed)
- Bot replies with thanks + public credit when verified

---

## 5) The MOST impactful missing thing for acquisition + retention

**Missing:** a concrete **earned-distribution system** (FB groups/Viber communities/WhatsApp forwards) with a repeatable “share kit”, plus an incentive to do it consistently.

The strategy is strong on *content creation*, but weak on *content propagation*.

### What I’d add as the single highest-leverage deliverable (V1.0)

**“Share Kit Generator” (bot output mode)**

For every hero post, the bot produces:

1) **Image card** (already planned)  
2) **FB group post text** (5–7 lines, Clear Mode, includes timestamp + 1 link)  
3) **Viber/WhatsApp forward text** (2–3 lines, ultra-short)  
4) **Moderator note** (“objavljujemo max 2–3x tjedno; prijave netočnosti ovdje…”)  

This is how you turn one piece of truth into many organic reposts without feeling spammy.

**Retention add-on (still small):** let users choose “my chains” + “my categories” once, then the weekly digest references those preferences (habit formation without an in-app chatbot).

---

## 6) Quick recommendations to align the doc to this growth reality

- Promote **Facebook Groups + Viber** from “investigate later” to an explicit **distribution track** with owners and cadence.
- Add a **channel decision rule**: what gets auto-posted where, and what must be human-posted (FB groups almost always human).
- Add retention metrics: **7-day active**, **weekly digest opt-in rate**, **forward/share rate per post**, **repeat clickers**.
- Add a “trust narrative” format: monthly “How accurate were we?” post (error rate + corrections) to turn data-quality into marketing.

---

## Bottom line (v2)

You fixed the biggest trust + scope blockers. Next step is to make the bot not just a publisher, but a **distribution engine** designed for Croatia’s real sharing graph: **Facebook groups → Viber/WhatsApp forwards → repeat weekly habits**.

