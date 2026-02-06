# Review: AI Bot & Community Strategy (Tvoja Košarica)

**Reviewer:** Senior Product Strategist & Community Manager
**Date:** 2026-02-06
**Target Document:** `AI-BOT-STRATEGY.md` (v1.0-draft)

---

## 1. Section Scoring (0-10)

| Section | Score | Rationale |
|---------|-------|-----------|
| **1. Overview** | **7/10** | Strong "Pametnjaković" persona concept, but platform choice (OpenClaw) introduces unnecessary technical risk. |
| **2. Channels** | **5/10** | **Critical Misalignment.** Heavily skewed towards tech-native platforms (Discord/Telegram) while ignoring where Croatian grocery shoppers actually live (WhatsApp, Viber, Facebook). |
| **3. Marketing Bot** | **8/10** | Content types are excellent. "Witty vs. Clear" modes are smart. Segmentation is good, but delivery channels for those segments are wrong. |
| **4. Product Bot** | **9/10** | Price anomaly detection is the "killer feature" that builds trust. Excellent utility value. |
| **5. Helpdesk** | **7/10** | Good tiered structure, but likely over-engineered for early stage. A simple FAQ + human handoff is often better than a Tier 2 bot for trust. |
| **6. Data Quality** | **9/10** | Internal monitoring is well-defined. Essential for preventing reputation damage. |
| **7. Pre-Launch** | **8/10** | "Seed Community" and "Countdown" phases are solid standard playbooks. Good focus on value-first content. |
| **8. MVP Integration** | **4/10** | **Major Strategic Error.** Prioritizing Discord (P0) over WhatsApp (+12mo) and ignoring Facebook entirely is a fatal flaw for mass market adoption in Croatia. |
| **9. Architecture** | **6/10** | Logical data flow, but reliance on `miniclawd` (OpenClaw) for a production business critical system is risky compared to established frameworks. |
| **10. Ethics** | **9/10** | Strong GDPR and disclosure policies. "Staleness warning" is a key trust builder. |
| **11. Metrics** | **6/10** | Growth targets (10k community) are unrealistic given the channel selection friction for the target demographic. |

---

## 2. Critical Issues

### 🚨 The "Grandma Gap" (Channel-Market Mismatch)
The strategy explicitly targets **Pensioners** (Section 3.4) as a key segment, yet the primary channels are **Discord** and **Telegram**.
*   **Reality Check:** Croatian pensioners do not use Discord. They struggle with basic apps. They use **Viber** and **WhatsApp** exclusively to communicate with family.
*   **Impact:** You will completely miss the "Umirovljenici" and "Obitelji" (Moms) demographics, who are the primary decision-makers for grocery shopping.
*   **Fix:** **WhatsApp must be moved from V3.0 (+12mo) to V1.0 or V1.5.** Even a low-tech solution (WhatsApp Business API broadcast list) is infinitely better than a high-tech Discord server for this audience.

### 🚨 The "Pametnjaković" Hallucination Risk
Section 3.2 suggests the LLM "Generates content... from ClickHouse".
*   **Risk:** If the LLM is given raw data and asked to "write a post," it **will** eventually hallucinate a price drop or mix up decimals (e.g., swapping 1.09€ for 0.19€). In a "witty" mode, it might joke about a price that doesn't exist.
*   **Fix:** Strict pipeline requirement: **Data -> Deterministic Template -> LLM Polish (Tone only).** The LLM should *never* touch the numbers. The numbers must be inserted into the final text string *after* or *via strict slot-filling* that prevents modification.

### 🚨 Missing the Facebook Elephant
The strategy completely ignores **Facebook**.
*   **Reality Check:** The largest Croatian community engagement happens in Facebook Groups (e.g., "Mame na fejsu", "Recepti i savjeti", generic savings groups).
*   **Impact:** By isolating the community in a "walled garden" (Discord), you lose the viral coefficient of Facebook shares which drive the massive casual traffic in Croatia.

---

## 3. Missing Considerations

### 1. Viber Penetration
*   **Context:** Viber has historically had higher penetration in Croatia than Telegram, especially among the 40+ demographic.
*   **Action:** Investigate Viber Community/Channels API. It might be a lower hanging fruit than a custom App for the older demographic.

### 2. OpenClaw / miniclawd Maturity
*   **Context:** Relying on `miniclawd` (a niche/hobbyist framework) for the core orchestration layer is a stability risk.
*   **Risk:** If the maintainer abandons it, or if it lacks robust error handling for edge cases (websocket disconnects, rate limits), the bot dies.
*   **Action:** Evaluate established alternatives (e.g., LangChain, Eliza, or simple native TypeScript orchestration) unless `miniclawd` offers specific, irreplaceable features for this specific use case.

### 3. Competitive Landscape (Catalogs)
*   **Context:** `Katalozi.net` and similar aggregators are the "incumbents". They use simple visual PDFs.
*   **Gap:** The strategy doesn't address how to convert users who are used to visually flipping through PDFs. Text-based deals on Discord might feel "dry" to them.
*   **Action:** The bot needs to generate **images** (visual price cards), not just text. A visual of "Milk: 0.89€" shares 10x better on WhatsApp than a text line.

---

## 4. Strengths

1.  **"Pametnjaković" Persona:** This is brilliant. The "Robin Hood of inflation" angle resonates deeply with the current Croatian economic sentiment. The "Witty vs. Clear" mode distinction shows maturity in UX writing.
2.  **Anomaly Detection (Section 4.1):** This is the true value prop. Moving from "here is a catalog" to "here is what CHANGED today" is a massive differentiator that justifies a push notification.
3.  **Data Quality First:** Section 6 demonstrates a clear understanding that one wrong price ruins trust forever. The "Trust Tier" system for user reports is smart.
4.  **Pre-Launch Hype:** The plan to build community *before* the app (Section 7) is the correct go-to-market strategy to ensure day-one retention.

---

## 5. Actionable Recommendations

1.  **Re-prioritize Roadmap:** Swap **Discord** (deprioritize to "Gaming/Student Niche") with **WhatsApp/Viber** (promote to P0/P1) for the main broadcast channel.
2.  **Facebook Strategy:** Create a "Tvoja Košarica" Facebook Page and configure the bot to auto-post the "Deal of the Day" image there. This is low effort, high reward.
3.  **Safety Hardening:** Explicitly define the `content-generation` cron: "Template injection first, LLM style transfer second."
4.  **Visuals:** Add `sharp` or `canvas` to the tech stack to generate **images** of price comparisons. Text-only posts will die in social feeds.
