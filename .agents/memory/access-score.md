---
name: Access score separation
description: Product rule for distinguishing contactability from wealth or registry confidence.
---

Access Score must remain separate from the Bayesian wealth/registry signal. It is based on public contact evidence, contact confidence, and directness; a high wealth signal alone cannot make someone highly reachable.

**Why:** Users correctly identified that profiles labeled “100” could simultaneously say “not contactable,” which made the prioritization model untrustworthy.

**How to apply:** Use Access for action queues, lead ranking, and contactability badges. Keep the Bayesian score as supporting research context and label it Signal, not Reach.

Hot-lead status follows the same boundary: only a validated person-level direct email or phone can make a record hot; aircraft, property, filing, social-only, generic inbox, and switchboard evidence cannot.

**Why:** A hot flag is used as an outreach-priority shortcut, so deriving it from wealth or registry activity creates the same false reachability claim as an inflated Access score.

**How to apply:** Recompute hot status from sanitized direct-contact fields and organization type/source metadata whenever enrichment or maintenance runs.