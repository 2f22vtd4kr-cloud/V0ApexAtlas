---
name: HMLR PPD CSV ingestor
description: Why SPARQL doesn't work for Land Registry and how to use the bulk CSV instead
---

## The Rule
The HMLR PPD SPARQL endpoint (`https://landregistry.data.gov.uk/landregistry/query`) is not suitable for bulk ingestion — it returns 0 results or times out (HTTP 000) for any query involving `?amount >= 1000000` or month-range date filters. Use the S3-hosted bulk CSV files instead.

**Why:** The SPARQL endpoint appears to have stale/incomplete data for recent years and cannot handle price+date combined filters within a 30s timeout. The dedicated bulk download CSV is the officially supported route for bulk data extraction.

**How to apply:**
- Download URL: `http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-YYYY.csv`
- This redirects (301) to `http://prod2.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-YYYY.csv`
- Use `curl -L` to follow redirects; ~160MB per year
- 2025 file also exists and works
- CSV format: no header row, 16 comma-delimited fields per transaction, fields are `"quoted"` — strip with `unquote()`
- Key fields: [0]=tx_id (GUID), [1]=price, [2]=date ("YYYY-MM-DD 00:00"), [3]=postcode, [4]=prop_type, [6]=duration, [7-13]=address components, [14]=PPD category (skip "B"), [15]=record status (skip "D")
- Filter: `price >= 1_000_000` — typical 2024 file yields ~50,000 £1M+ transactions
- Cache TTL: 30 days per year file

**Performance:** Stream with readline + flush batches of 50; use preloadDedupPrefix("lr:") + batchMarkSeen() to avoid per-record Upstash calls. Throughput: ~2,000 records/20s.
