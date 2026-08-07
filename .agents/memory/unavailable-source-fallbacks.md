---
name: Unavailable source fallback policy
description: Durable rules for replacing unavailable OSINT providers without creating false evidence or hiding source outages
---

Prefer a free public fallback when a provider is persistently unavailable, but keep the original source family and provenance explicit. Official OFAC SDN XML is a sanctions-evidence fallback for OCCRP; adsb.lol is the live ADS-B primary with OpenSky compatibility fallback; Airplanes.Live is the targeted historical ADS-B fallback. Registry search outages return an explicit unavailable/partial response rather than an HTTP 500.

ICIJ reconciliation suggestions are not findings: only response rows with `match === true` may be retained or persisted. Fuzzy `match:false` rows remain discarded so the repaired endpoint cannot turn same-name suggestions into offshore evidence.

**Why:** Provider limits and changed APIs were repeatedly observed in live Atlas runs. Silent empty results and fuzzy suggestions can be mistaken for “no evidence” or false matches, while interrupting an active Atlas process to deploy a fix can kill the job.

**How to apply:** Preserve source labels in job summaries, metadata, UI, and reliability profiles; distinguish fallback success from all-source-unavailable; restart the API only after an active Atlas job reaches a terminal state.