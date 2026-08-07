---
name: Research review guardrails
description: Durable safeguards for bounded single-entity research and outreach state
---

Research reruns must recompute scores from the stable prior; feeding a prior posterior back into the scorer makes repeated runs inflate confidence without new evidence.

**Why:** A bounded isolated-target verification run previously raised the same record's Bayesian score on rerun even though no assets, relationships, or verified direct contact had been added.

**How to apply:** Keep manual seed provenance distinct from public-registry evidence, reject malformed contact values before scoring, and save isolated targets without a corroborated gatekeeper as review-only. Do not generate outreach copy or imply personal reachability until a supported path exists.

Target research must run a deterministic reachability-realism preflight before expensive retrieval, multi-agent criticism, MCTS, or outreach generation. Classify validated direct contact as direct access, an explicitly corroborated assistant/family-office/gatekeeper relationship as intermediary access, and prominent or social-only isolated targets as research-only. Wealth, fame, press visibility, social accounts, assets, registry records, and hypothetical staff routes cannot create access.

**Why:** Public prominence predicts search noise and protected access more often than it predicts a viable route. Spending the full research budget first and only discovering “no route” in the final score made the system look more confident than it was.

**How to apply:** Pass the preflight directive into every live research provider and response contract. Persist research-only decisions as `Research Review` with reasons/blockers and no outreach copy. Treat asset operators, FBOs, marina staff, club staff, property managers, WhatsApp, and commission offers as non-actionable unless a cited source explicitly corroborates the relationship and route.

Final target review is a publication boundary, not an annotation: newly discovered contacts and assets stay pending until a target-scoped reviewer selects exact supplied evidence. Review/unavailable/reject outcomes must persist review state without a normal path, contact promotion, asset publication, or outreach copy.

**Why:** A post-enrichment reviewer that only decorated the response could still leave an interrupted run with unreviewed contacts or publish a research path before the evidence gate completed.

**How to apply:** Keep provider evidence durable for adjudication, but stage entity contact fields and new assets in memory. Enforce person-vs-organization scope and exact candidate matching in deterministic code around any model decision.