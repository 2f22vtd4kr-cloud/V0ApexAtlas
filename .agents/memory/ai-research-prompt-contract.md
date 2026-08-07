---
name: AI research prompt contract
description: Durable rules for identity-first AI web research and preserving negative or ambiguous findings.
---

AI web-research prompts must establish a target fingerprint before extracting people or contacts: exact name plus at least two agreeing anchors such as location, domain, registry identifier, or business category. They must preserve claim-level URLs, distinguish organization routes from personal or authorized intermediary routes, and return explicit identity assessment, negative findings, and search gaps. Usernames, email-platform presence, fame, wealth, assets, registry appearance, and social visibility are leads or context—not proof of identity or personal reachability.

**Why:** Provider output and search snippets can look corroborated while actually repeating one source, following a same-name entity, or confusing an organization route with a person. Explicit uncertainty and claim provenance keep the downstream fail-closed adjudicator honest.

**How to apply:** Keep these fields and rules in every AI extraction/research prompt. Treat the model assessment as triage metadata only; server-side evidence adjudication remains authoritative.