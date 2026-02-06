# Consensus Review: AI Bot & Community Strategy

**Date:** 2026-02-06
**Reviewers:** GPT-5.3 Codex + Gemini 3 Pro (GitHub Copilot)
**Document:** `AI-BOT-STRATEGY.md` v1.0-draft

---

## Consensus Scores

| Section | Codex | Gemini | Consensus | Key Issue |
|---------|-------|--------|-----------|-----------|
| Community Setup | 6 | 5 | **5.5** | Too many channels too early; wrong platforms for target demo |
| Marketing Bot | 5 | 8 | **6.5** | Great voice concept; hallucination risk + content sludge risk |
| Product Bot | 7 | 9 | **8** | Strongest section — anomaly detection is the killer feature |
| Helpdesk | 6 | 7 | **6.5** | Over-engineered for early stage |
| Data Quality | 7.5 | 9 | **8** | High operational ROI but needs action loops, not just reports |
| Pre-Launch | 4 | 8 | **6** | Codex says too long (shrink to 45-60d); Gemini approves structure |
| MVP Phasing | 3.5 | 4 | **3.75** | Both agree: over-scoped, wrong priorities, timeline not credible |
| Architecture | 6 | 6 | **6** | Clean separation but OpenClaw maturity risk |
| Ethics | 5 | 9 | **7** | Good intent; GDPR needs legal-grade rigor |
| Metrics | 4.5 | 6 | **5.25** | Targets optimistic for Croatian market; missing dedup |

**Overall: 6.3/10** — Strong strategic vision, weak execution realism. Needs aggressive de-scoping.

---

## CRITICAL ISSUES (Both Agree)

### 1. Channel-Market Mismatch ("The Grandma Gap")
- **Gemini:** "Croatian pensioners don't use Discord. They use Viber and WhatsApp."
- **Codex:** "Too many channels too early for one dev + tiny admin team."
- **Action:** Start with Telegram channel only (V1.0). Add Facebook page for viral reach (V1.0). Move WhatsApp from V3.0 to V1.5. Discord stays but deprioritized to "tech/student niche." Investigate Viber.

### 2. LLM Hallucination Risk in Price Content
- **Gemini:** "LLM will eventually hallucinate a price or mix up decimals."
- **Codex:** "LLM-generated deal posts will drift in quality without strict editorial controls."
- **Action:** Enforce deterministic pipeline: Data → Template (numbers slot-filled, untouchable by LLM) → LLM polish (tone/commentary only) → Validation against source data → Publish. LLM never touches price numbers.

### 3. Over-Scoped for Pre-Launch MVP
- **Codex:** "6-8 weeks for this scope is not credible. More like 12-16 weeks."
- **Gemini:** "Prioritizing Discord over WhatsApp is a fatal flaw for mass market."
- **Action:** V1.0 bot scope = Telegram channel (broadcast only) + Facebook page + data freshness alerts + weekly report. Everything else is V1.5+.

### 4. Spam Perception Risk
- **Codex:** "Daily auto-posting before organic demand exists looks botty and low-trust."
- **Gemini:** (Implicit — notes text-only posts "die in social feeds")
- **Action:** Max 1 post/day/channel with significance threshold. Generate visual price cards (images), not just text. No identical cross-posts.

### 5. Data Quality Bot Needs Action Loops
- **Codex:** "You measure problems but don't define who fixes what by when."
- **Gemini:** "Essential for preventing reputation damage" but needs closure.
- **Action:** Add ownership per alert type, auto-triage severity, resolution SLA, recurring-issue suppression.

---

## IMPORTANT IMPROVEMENTS (Unique Insights)

### From Gemini (not in Codex):
1. **Facebook is missing entirely** — largest Croatian engagement platform, especially for families/moms
2. **Viber penetration** — higher than Telegram in Croatia for 40+ demographic
3. **Visual price cards** — text-only posts don't share well; need image generation (sharp/canvas)
4. **Competitive landscape** — Katalozi.net is the incumbent; users are used to visual PDF flyers

### From Codex (not in Gemini):
1. **Channel sequencing** — "one-channel dominance" phase before expanding
2. **Brand voice governance** — reference examples, anti-examples, tone classifier, forbidden phrases
3. **Cost model** — missing LLM cost/post, moderation cost/user, infra cost at 10x
4. **Retailer legal risk** — "anomaly" framing may trigger complaints from chains
5. **Content fatigue** — Croatian audience will detect repetitive AI style; needs novelty cadence
6. **Human-in-the-loop gates** — define what auto-publishes vs needs human approval

---

## CONSENSUS STRENGTHS

Both praised:
1. **Pametnjaković persona** — "brilliant" (Gemini), "strategically smart" (Codex)
2. **Anomaly detection as killer feature** — differentiated, data-driven, trust-building
3. **Data quality monitoring** — shows understanding that one wrong price ruins trust
4. **Pre-launch community building** — correct go-to-market timing
5. **Bot disclosure transparency** — non-negotiable, well-handled

---

## REVISED V1.0 BOT SCOPE (Consensus)

Based on both reviewers flagging scope and channel issues:

### V1.0 — "Prove Trust" (Ship with app)
- Telegram channel (@TvojaKosarica) — automated daily deal + weekly report
- Facebook page — cross-post deal images (visual price cards)
- Data freshness monitoring → admin alerts (Telegram admin group)
- Content pipeline: Data → Template → LLM commentary → Validation → Post
- 1 post/day max, significance threshold required
- Blog: weekly inflation report (SEO)

### V1.5 — "Expand Reach" (+2-3 months)
- Telegram discussion group (moderated)
- WhatsApp Business broadcast list
- Discord server (student/tech niche)
- Helpdesk FAQ bot (Telegram)
- Bug report pipeline
- Visual price card generation

### V2.0 — "Community" (+6 months)
- Reddit auto-posting
- Audience segmentation
- Feature request voting
- User reliability scoring
- Price check commands (/cijena)

---

---

## CODEX V2 REVIEW (GPT-5.2, Marketing Focus)

After v1.1 fixes, Codex re-scored: **6.9/10** (up from 5.5). Key new insights:

### Bot's #1 Job: "Make Savings Shareable"
Every post should be a **distribution asset**, not just content:
- Screenshot-native (image cards)
- Forward-native (short, "send to spouse" friendly)
- Argument-proof (source + timestamp + chain + savings)
- Copy-pasteable (prewritten group post text)

### "Share Kit Generator" — Highest-Impact Missing Feature
For every hero post, bot produces:
1. Image card (visual price comparison)
2. FB group post text (5-7 lines, Clear Mode)
3. Viber/WhatsApp forward text (2-3 lines, ultra-short)
4. Moderator note ("max 2-3x/tjedno; prijave netočnosti ovdje")

### 3 Hero Formats (Repeat Forever)
1. **Deal dana** — only when meaningful; includes annualized savings
2. **Košarica Index** (weekly) — cheapest chain + 3 biggest movers + 1 surprise
3. **Inflacija hrane** (monthly) — charts + 5-line summary

### Voice Mode Per Channel
- FB Groups / Viber / WhatsApp → **Clear Mode** (no sarcasm — 35+ demographic)
- Telegram / own FB Page → **Light Witty Mode**

### Facebook Groups = P0 Acquisition Channel
- Target: "akcije", "popusti", city groups, "mame" groups, chain-specific groups
- Cadence: Wed/Thu (pre-shop), Fri 16-20 (weekend deals), Sun evening (plan week)
- Human-posted (not bot) — FB groups need authentic presence

### 3 Viral Growth Loops
1. Deal card → share → new follower → next card (trackable short links)
2. Košarica Index → "local pride argument" → comments → forwards
3. Community scout → recognition → more scouts (UGC)

### Trust Narrative
Monthly "How accurate were we?" post — turn data quality into public marketing.

---

*Consensus generated from independent reviews by GPT-5.3 Codex (v1), GPT-5.2 Codex (v2), and Gemini 3 Pro (GitHub Copilot).*
