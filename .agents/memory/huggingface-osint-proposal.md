---
name: Hugging Face OSINT proposal decision
description: Decision boundary for adding HF research tools beyond the existing smolagents and Serper lane
---

Do not integrate Hugging Face AI Sheets, OpenResearcher, WebThinker/Search-R1, or the HF Datasets library into the core OSINT pipeline by default. The current bounded smolagents + Serper adapter already supplies the useful open research lane, while structured TypeScript evidence validation, exact-page fetching, Redis, and durable evidence records cover the proposed transformation and caching needs.

**Why:** An LLM-as-judge or unconstrained agentic crawler could turn weak or repeated claims into trusted evidence, introduce prompt-injection and provenance risks, and add Python/Arrow operational complexity without a measured quality improvement.

**How to apply:** Consider only benchmarked, review-only enhancements: an analyst-facing structured export, or tightly bounded same-domain link expansion with URL/source limits. Never let these tools directly promote identity, ownership, contacts, access, or outreach state.