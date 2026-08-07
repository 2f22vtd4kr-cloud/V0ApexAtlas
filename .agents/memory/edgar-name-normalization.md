---
name: EDGAR name normalization
description: EDGAR EFTS returns ALL_CAPS LAST FIRST names; normalizeEdgarName() fixes this at ingestion time
---

# EDGAR Name Normalization

## The rule
EDGAR EFTS `display_names` values come back as ALL_CAPS "LAST FIRST [MIDDLE]" (e.g. "THIEL PETER", "KIM JAMES J"). They must be converted to "First [Middle] Last" title-case before DB insert.

**Why:** Without this, names display as "THIEL PETER" throughout the app and are useless for research/display.

**How to apply:** `normalizeEdgarName(rawName)` is defined in `artifacts/api-server/src/lib/western-hnwi-ingestion.ts` and called at every `yield { name: ... }` site in that file (SC 13D/G harvester and DEF 14A harvester). Companies House names do NOT need reversal — they're already correctly formatted.

## One-time DB fix
If ALL_CAPS names slip through (e.g. after a re-import before the fix), run this SQL to patch them:
```sql
UPDATE entities
SET name = (
  SELECT string_agg(
    CASE WHEN length(word) <= 2 THEN upper(word)
    ELSE upper(left(word,1)) || lower(substring(word,2)) END, ' ')
  FROM (
    SELECT unnest(
      CASE WHEN array_length(string_to_array(trim(name),' '),1) >= 2
        THEN array_cat((string_to_array(trim(name),' '))[2:],
                       ARRAY[(string_to_array(trim(name),' '))[1]])
        ELSE string_to_array(trim(name),' ') END
    ) AS word
  ) words
)
WHERE name = upper(name) AND name ~ '[A-Z]{2}'
  AND name NOT LIKE '%LLC%' AND name NOT LIKE '%INC%'
  AND name NOT LIKE '%CORP%' AND name NOT LIKE '%TRUST%'
  AND name NOT LIKE '%FUND%' AND name NOT LIKE '%CAPITAL%'
  AND name NOT LIKE '%HOLDINGS%' AND name NOT LIKE '%PARTNERS%'
  AND type = 'HNWI';
```
