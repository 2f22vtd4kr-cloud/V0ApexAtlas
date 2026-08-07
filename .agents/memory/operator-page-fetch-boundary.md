---
name: Operator page fetch boundary
description: Large public operator pages can hide team records in embedded JSON beyond the visible HTML.
---

Official operator pages may contain the authoritative team/contact records hundreds of kilobytes into the HTML, even when the visible navigation looks complete.

**Why:** A bounded 80 KB response window preserved navigation text but discarded Amaron’s embedded executive records, causing a false “no names found” result.

**How to apply:** Keep the raw HTML window bounded but large enough for structured payloads, cap normalized text separately, and attribute contacts within the segment from one known person to the next. Shared mailbox prefixes remain organization evidence.