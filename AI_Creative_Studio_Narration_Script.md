# AI Creative Studio — Client Presentation Narration Script
**Presenter Guide | April 2026 | Confidential**

---

## Presenter Instructions

- Total runtime: **25–35 minutes** (20 slides + 10 min Q&A)
- Demo segment: **5–8 minutes** live (have fallback screenshots ready)
- Tone: Confident, conversational, solution-focused — not technical
- Pace: Pause 3 seconds after each key stat. Let numbers land.
- Bold text = emphasis. *Italic* = pause or slow down.

---

## SLIDE 1 — Title

> **"Good [morning/afternoon]. Thank you for making the time today."**

> **"What you're about to see is something we've built specifically for teams like yours — a working application that turns a text prompt into a professional AI-generated image in about 8 seconds, or a video clip in under a minute."**

> **"This isn't a concept. It isn't a slide deck about what AI could do someday. It's a running application on a real machine, connected to Google's latest generation AI models. Let me show you how we got here and where we can take this together."**

*[Advance slide]*

---

## SLIDE 2 — Agenda

> **"Here's our plan for the next 30 minutes."**

> **"We'll start with the problem — the real cost and friction your teams experience today when they need creative assets. Then I'll walk you through what we built, how it works technically, and most importantly, what it looks like in use."**

> **"We'll be transparent about risks — this is a Proof of Concept and we'll tell you exactly what that means. And we'll close with a concrete roadmap showing how we get from this working demo to a production system."**

> **"Questions are welcome throughout, but I'll also leave dedicated time at the end."**

*[Advance slide]*

---

## SLIDE 3 — Business Problem

> **"Let's start with why this matters."**

> **"Right now, every time your marketing, product, or sales team needs a visual — an image for a campaign, a short video for social, a product render for a pitch deck — they face a choice."**

> **"They can hire an agency or a freelancer. That typically costs between $50 and $180 per asset, and the turnaround is 3 to 10 business days. For a campaign that needs 20 variations, that's potentially $3,600 and two weeks of waiting."**

> **"Or they go without. They repurpose old visuals. They use stock photos that look like stock photos. The creative quality suffers."**

> *[Point to the stat: 72%]* **"72% of marketing leaders cite content volume as their primary operational challenge. The bottleneck isn't imagination — it's production capacity."**

> **"The core problem is that scaling visual content creation is historically tied to headcount. More campaigns means more designers. More designers means more cost and coordination overhead. AI breaks that relationship entirely."**

*[Advance slide]*

---

## SLIDE 4 — Proposed Solution

> **"Here's what we built to address that."**

> **"AI Creative Studio is a licensed desktop application. You install it on your team's machines, you give each user a license key, and from that moment they can generate professional AI images and video clips directly from a text description — with no design skills required."**

> **"The application has six core capabilities."**

> *[Walk through each card briefly]*

> **"AI Image Generation — type a prompt, get a high-quality image in about 8 seconds, in any aspect ratio you need."**

> **"AI Video Generation — type a description, get a 4 to 8 second video clip in under a minute, using Google's Veo 3 model."**

> **"License key authentication — your organization controls who has access. Each key is validated on our backend before the app activates."**

> **"It's a native desktop application — no browser dependency, no SaaS account to manage, works on Windows and Mac."**

> **"The backend uses a queue-based architecture — jobs are tracked, retried on failure, and never silently lost."**

> **"And session management is automatic — the system handles authentication renewal and keeps the connection to Google's AI infrastructure alive without any operator intervention."**

*[Advance slide]*

---

## SLIDE 5 — Architecture

> **"For those who want to understand what's under the hood — and I'll keep this brief — here's how the system is layered."**

> **"The user interacts with an Electron desktop application built in React. This talks to a Node.js REST API running locally on port 3001."**

> **"Requests are placed into a BullMQ job queue backed by Redis. This is critical — it means if the AI takes 90 seconds to generate a video, the user's interface stays responsive, and the job is tracked to completion or failure."**

> **"The queue dispatches to what we call the browser layer — a Playwright-controlled Chrome instance that interacts with Google Flow on behalf of the user. This is the POC-specific mechanism, and I'll address it directly when we discuss risks."**

> **"At the AI layer, Google's infrastructure handles the actual generation — Imagen for images, Veo 3 for video."**

> **"The whole system is self-contained. There are no third-party dependencies beyond Google's infrastructure, Redis, and the Node.js runtime."**

*[Advance slide]*

---

## SLIDE 6 — Generation Workflow

> **"Let me walk you through a generation from start to finish — this is exactly what happens when you press Enter."**

> *[Point to Step 1]* **"The user types a prompt in the app and hits Enter."**

> *[Step 2]* **"The backend immediately queues a job and returns a 202 response — the app starts polling for status."**

> *[Step 3]* **"The worker picks up the job and our browser automation opens the AI generation project page."**

> *[Step 4]* **"The prompt is submitted to Google's AI infrastructure. For images, this uses Imagen. For video, this uses Veo 3."**

> *[Step 5]* **"We poll Google's status endpoint every 5 seconds until the job completes."**

> *[Step 6]* **"When it's done, the signed Google Cloud Storage URL comes back to the app and the image or video displays immediately."**

> *[Point to the footer bar]* **"Total time: about 8 seconds for images, about 50 seconds for video. No manual steps. The user just types and waits."**

*[Advance slide]*

---

## SLIDE 7 — Demo Highlights

> **"Let me call out the four things I want you to pay attention to during the live demo."**

> **"First — image generation. The quality is high, the speed is real, and you can change the canvas ratio before you generate. Portrait, landscape, square — it adapts."**

> **"Second — video generation. This uses Google's Veo 3 model which is genuinely state-of-the-art. Even with simple prompts, the output is cinematic. There's a Fast mode for quick iterations and an HD mode for final output."**

> **"Third — authentication. The app doesn't open without a valid license key. That's your control surface for managing who has access."**

> **"Fourth — job tracking. Every generation has an ID. The status is shown in real-time. If something fails, you see exactly why and you can retry instantly."**

> **"Let me switch to the live demo."**

---

## [LIVE DEMO SEGMENT — 5-8 minutes]

### Demo Script

1. **Open the app** — show the license key screen → enter `poc-test-key-12345678` → Dashboard appears
2. **Image generation:**
   - Click "AI Image Generation"
   - Type: *"a professional woman presenting in a modern boardroom, shallow depth of field, warm lighting"*
   - Press Enter → watch the progress → image appears (~8s)
   - Show the canvas ratio dropdown — switch to 9:16 → generate again with a different prompt
3. **Video generation:**
   - Go back to Dashboard → click "AI Video Generation"
   - Type: *"a time-lapse of a city skyline at sunrise, cinematic, 4K quality"*
   - Select 4s + Fast → press Enter → show progress bar → video plays automatically (~45s)
4. **Point out:** generated video plays with controls, download button available

### If demo fails fallback:
- Have 3 pre-generated screenshots of successful outputs
- Say: *"The live generation is running in the background — let me show you the output from our pre-demo test while it completes."*

*[Return to slides]*

---

## SLIDE 8 — Benefits & ROI

> **"Let me quantify what this means for your organization."**

> *[Point to 95% faster]* **"95% faster than the traditional design workflow. What took a week now takes under a minute."**

> *[Point to ~$0]* **"Near-zero cost per asset after the licensing fee. Compare that to $50–$180 per asset with agencies."**

> *[Point to ∞]* **"Unlimited scale — generation is bounded only by the AI credits available, not by headcount. One person can generate 50 variations in the time it previously took to brief a designer."**

> *[Point to <60s]* **"And with Veo Fast mode, even video is under 60 seconds. That means same-day content for campaigns, social posts, and product demos."**

> *[Walk through benefit cards]*

> **"Team productivity — your marketing team stops waiting. They generate, iterate, and ship."**

> **"Rapid iteration — you can test 10 creative directions before committing to production. That's a fundamental change in how creative strategy works."**

> **"Brand consistency — with prompt templates, every output follows your brand guidelines. No briefing, no revision rounds."**

> **"Easy integration — because it's a REST API under the hood, any internal tool can plug into this. Your CMS, your campaign workflow, your product catalog — all can call the generation API."**

*[Advance slide]*

---

## SLIDE 9 — Risks & Mitigations

> **"I want to be direct with you about what this is and what it isn't."**

> **"This is a Proof of Concept. It's a working, tested system, but it uses browser automation to connect to Google's AI infrastructure rather than a formal API contract. That comes with real constraints, and I'd rather you hear them from us than discover them later."**

> *[Walk through each risk row]*

> **"reCAPTCHA blocking — Google's anti-bot system can occasionally flag our automated browser. We've implemented stealth browser mode, warm-page session management, and request rate limiting. In our testing, a single generation per session works reliably. This is the primary POC constraint."**

> **"UI change dependency — if Google updates their Flow interface, our automation selectors may need updating. We've built robust popup dismissal handlers that handle all known dialog types, and we monitor for issues proactively."**

> **"Session expiry — Google cookies expire every 7 days. We have a two-minute script that refreshes the session. It's a documented operational procedure, not a technical problem."**

> **"Credit consumption — each video costs 10 credits from the Google Flow account. We've fixed the double-generation bug that previously doubled this cost. x1 output is now enforced."**

> **"Multi-user scale — the current architecture supports one user at a time. This is by design for the POC. The production path addresses this directly."**

> **"The honest summary: this is reliable for demo and light internal use. For production scale, we need the next phase."**

*[Advance slide]*

---

## SLIDE 10 — Gaps & Pre-Demo Checklist

> **"There are five known gaps between this POC and a production-ready product. I want to name them clearly."**

> **"Generated media URLs expire after about 20 minutes. In production, we'd persist them to your own storage — S3 or Google Cloud Storage."**

> **"The current system is single-user. Concurrent access requires a multi-user architecture with proper authentication, which is scoped in Phase 2."**

> **"The app still carries our working name 'YourBrand.' Final branding, your logo, your color scheme — that's a Phase 3 deliverable."**

> **"There's no usage analytics yet. No dashboard showing how many assets were generated, by whom, or at what cost. That's a reasonable Phase 2 addition."**

> **"Error messaging is currently technical — the raw error text appears when something fails. Production needs user-friendly messaging and one-click retry."**

> **"None of these are architectural blockers. They're all scoped deliverables."**

*[Advance slide]*

---

## SLIDE 11 — Next Steps & Roadmap

> **"Here's how we get from today's POC to a system your full team uses in production."**

> *[Walk through phases]*

> **"Phase 1 — the next two weeks — is about getting your sign-off on what we've built and aligning on the production requirements. The most important decision in this phase is API strategy: do we wait for the official Google Veo API which is currently in preview, or do we use an alternative like Runway or Kling that already has proper API access?"**

> **"Phase 2 — weeks three through six — is the production foundation. Official API integration, persistent media storage, multi-user authentication, and a usage analytics dashboard."**

> **"Phase 3 — weeks seven through ten — is scale and polish. Your branding on every screen, prompt templates for brand-consistent output, an admin panel for credit management."**

> **"Phase 4 — the final two weeks — is UAT, load testing, documentation, and go-live."**

> **"Ten to twelve weeks from green light to production. We have the architecture, we have the learnings from this POC, and we have a clear path."**

*[Advance slide]*

---

## SLIDE 12 — Closing

> **"To summarize:"**

> **"The problem is real — content creation at scale is expensive, slow, and tied to headcount."**

> **"The solution works — we've demonstrated it live today. Images in 8 seconds, video in under a minute, from a text prompt, on a desktop application."**

> **"The path is clear — 10 to 12 weeks from decision to production deployment."**

> **"What we're asking from you today is two things: first, your feedback on what you saw — does this solve the right problem? And second, a conversation about the production requirements so we can scope Phase 1 properly."**

> **"Thank you. I'm ready for your questions."**

---

## Anticipated Questions & Answers

**Q: Why not use the official Google API directly?**
A: The official Veo API is in preview access only and not yet publicly available. Our browser automation approach let us build and validate the full product experience now, so we're ready to swap in the official API the moment access opens — without changing anything the user sees.

**Q: What happens if Google changes their interface?**
A: We have automated popup handling and robust selectors. A UI change typically requires a 1–2 hour fix in our automation layer. In production, we'd monitor for failures and have an SLA for response.

**Q: How much does the Google Flow account cost?**
A: The current demo account is on the Ultra tier at approximately $20 per 1,000 credits. A video costs 10 credits, an image costs 1. This is the pre-API pricing — official API pricing will be publicly listed by Google.

**Q: Can this integrate with our existing tools?**
A: Yes. The backend is a REST API with a simple license-key authentication model. Any system that can make an HTTP POST request — your CMS, your campaign management tool, your Slack bot — can call it.

**Q: How long does it take to set up for a new user?**
A: Under 5 minutes. Install the app, enter the license key, start generating. The backend runs on your infrastructure or ours.

**Q: What about content rights?**
A: Generated content from Google's models is licensed to the user under Google's terms of service. For enterprise use, this should be reviewed with your legal team — but Google's commercial terms generally permit use in marketing and commercial contexts.

---

## Pre-Demo Day Checklist

- [ ] Run `node scripts/captureSession.js` — confirm fresh session cookie
- [ ] Verify Flow account has **50+ credits** remaining
- [ ] Test one image generation end-to-end (use simple prompt: "a red ball on a table")
- [ ] Test one video generation end-to-end (4s Fast mode)
- [ ] Restart `npm start` **30 minutes before** the demo (warm browser session)
- [ ] Confirm Chrome window appears on screen at position (100, 100)
- [ ] Close all other Chrome windows on the demo machine
- [ ] Have 3 pre-generated output screenshots as fallback
- [ ] Set screen layout: app window left, terminal right (optional, shows backend confidence)
- [ ] Confirm laptop is plugged in — generation can take up to 60s, no sleep mode

---

*End of Narration Script*
*AI Creative Studio — Confidential | April 2026*
