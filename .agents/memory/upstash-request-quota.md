---
name: Upstash request quota
description: Persistent Redis slots can exhaust the provider request quota and make cleanup or dedup operations fail without taking down the app.
---

The application can remain healthy with local Redis while persistent Upstash cleanup, deduplication, and cache restoration operations are quota-limited.

**Why:** A fresh import verified API health and local Redis while the configured Upstash account returned `max requests limit exceeded` at its 500,000-request cap.

**How to apply:** When ingestion or persistent cache behavior appears stalled, check the Upstash account quota before changing application code; wait for reset or change the Redis plan/endpoint.