#!/usr/bin/env python3
"""Bounded European public-register extractor for ARES (CZ) and BODACC (FR).

Exports companies and commercial-announcement evidence separately. It does not
turn announcement signatories into HNWI candidates or infer beneficial owners.
Only source IDs, business names, legal identifiers, coarse business locations,
status, dates, activity and official source URLs are retained.
"""
from __future__ import annotations

import csv
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "exports" / "european-registry"
OUT.mkdir(parents=True, exist_ok=True)
UA = "PublicRegistryExtractor/0.2 (public source research; repository contact)"
ARES = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat"
BODACC = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records"

ARES_TERMS = [
    "nemovitosti", "realit", "developers", "development", "hotel",
    "ubytování", "architekt", "inženýr", "stavby", "správa nemovitostí",
    "invest", "facility management", "stavební",
]
BODACC_TERMS = [
    "immobilier", "hôtellerie", "promotion immobilière", "gestion immobilière",
    "architecture", "construction", "patrimoine", "restauration", "conciergerie",
    "gestion de fortune", "marchand de biens", "société de gestion",
]
MAX_PER_TERM = 100
PAGE_SIZE = 100


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept": "application/json"})
    return s


def get_json(s: requests.Session, url: str, **kwargs: Any) -> Any:
    for attempt in range(5):
        r = s.get(url, timeout=(15, 60), **kwargs)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(min(2 ** attempt, 20))
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def post_json(s: requests.Session, url: str, payload: dict[str, Any]) -> Any:
    for attempt in range(5):
        r = s.post(url, json=payload, timeout=(15, 60))
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(min(2 ** attempt, 20))
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def write_csv(name: str, rows: list[dict[str, Any]]) -> int:
    path = OUT / name
    columns = list(rows[0].keys()) if rows else []
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def ares_extract(s: requests.Session) -> dict[str, Any]:
    found: dict[str, dict[str, Any]] = {}
    failures: list[dict[str, str]] = []
    for term in ARES_TERMS:
        try:
            data = post_json(s, ARES, {
                "obchodniJmeno": term,
                "strankovani": {"pocet": MAX_PER_TERM, "start": 0},
            })
            for item in data.get("ekonomickeSubjekty", []):
                ico = str(item.get("ico") or "").strip()
                name = str(item.get("obchodniJmeno") or "").strip()
                if not ico or not name:
                    continue
                seat = item.get("sidlo") or {}
                found[ico] = {
                    "company": name,
                    "ico": ico,
                    "jurisdiction": "CZ",
                    "legal_form_code": item.get("pravniFormaKod") or "",
                    "registered_status": item.get("stavZdroje") or "",
                    "incorporation_date": item.get("datumVzniku") or "",
                    "last_updated": item.get("datumAktualizace") or "",
                    "business_city": seat.get("nazevObce") or seat.get("nazevCastiObce") or "",
                    "business_postcode": seat.get("psc") or "",
                    "business_address": " ".join(str(x) for x in [
                        seat.get("nazevUlice"), seat.get("cisloDomovni"),
                        seat.get("cisloOrientacni"), seat.get("nazevObce")
                    ] if x),
                    "source_url": f"https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}",
                    "source_terms": term,
                    "source": "ARES Czech Ministry of Finance",
                    "admission_note": "Company identity evidence only; no ownership or personal access inferred",
                }
        except Exception as e:
            failures.append({"term": term, "error": str(e)[:400]})
        time.sleep(0.15)
    rows = sorted(found.values(), key=lambda x: x["company"].casefold())
    count = write_csv("czech_ares_companies.csv", rows)
    (OUT / "ares_failures.json").write_text(json.dumps(failures, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"companies": count, "terms_queried": len(ARES_TERMS), "unique_ico": len(found), "failures": len(failures)}


def bodacc_extract(s: requests.Session) -> dict[str, Any]:
    found: dict[str, dict[str, Any]] = {}
    failures: list[dict[str, str]] = []
    for term in BODACC_TERMS:
        try:
            data = get_json(s, BODACC, params={
                "where": f'search("{term.replace(chr(34), "")}")',
                "limit": MAX_PER_TERM,
                "offset": 0,
                "order_by": "dateparution DESC",
            })
            for record in data.get("results", []):
                announcement_id = str(record.get("id") or "").strip()
                if not announcement_id:
                    continue
                try:
                    people_obj = json.loads(record.get("listepersonnes") or "{}")
                except Exception:
                    people_obj = {}
                person = people_obj.get("personne") or people_obj
                name = str(person.get("denomination") or record.get("commercant") or person.get("nomCommercial") or "").split(",")[0].strip()
                if not name:
                    continue
                address = person.get("adresseSiegeSocial") or {}
                regs = record.get("registre") or []
                if not isinstance(regs, list):
                    regs = [regs] if regs else []
                found[announcement_id] = {
                    "company_or_trader_name": name,
                    "announcement_id": announcement_id,
                    "announcement_family": record.get("familleavis") or "",
                    "announcement_family_label": record.get("familleavis_lib") or "",
                    "publication_date": record.get("dateparution") or "",
                    "rcs_numbers": " | ".join(str(x) for x in regs if x),
                    "court": record.get("tribunal") or "",
                    "business_city": address.get("ville") or record.get("ville") or "",
                    "business_postcode": address.get("codePostal") or "",
                    "business_address": " ".join(str(x) for x in [
                        address.get("numeroVoie"), address.get("typeVoie"),
                        address.get("nomVoie"), address.get("codePostal"),
                        address.get("ville")
                    ] if x),
                    "announcement_url": record.get("url_complete") or "",
                    "query_term": term,
                    "source": "BODACC — DILA OpenDataSoft",
                    "evidence_kind": "commercial_announcement",
                    "admission_note": "Announcement evidence only; named officers are not automatically people/prospect cards",
                }
        except Exception as e:
            failures.append({"term": term, "error": str(e)[:400]})
        time.sleep(0.15)
    rows = sorted(found.values(), key=lambda x: (str(x["publication_date"]), x["company_or_trader_name"]), reverse=True)
    count = write_csv("france_bodacc_commercial_announcements.csv", rows)
    (OUT / "bodacc_failures.json").write_text(json.dumps(failures, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"announcements": count, "terms_queried": len(BODACC_TERMS), "unique_announcement_ids": len(found), "failures": len(failures)}


def main() -> int:
    s = session()
    summary = {
        "run_at_utc": datetime.now(timezone.utc).isoformat(),
        "sources": {},
        "controls": [
            "ARES entries are legal-entity records; no person or beneficial owner is inferred.",
            "BODACC records are commercial-announcement evidence, not a master company register.",
            "People named in announcements are not exported as standalone HNWI candidates.",
            "No personal addresses, personal contact details, birth dates, or private identifiers are exported.",
            "All records remain source-backed, shallow and unqualified until Apex Bureau review.",
        ],
    }
    errors = []
    for name, fn in [("ARES Czechia", ares_extract), ("BODACC France", bodacc_extract)]:
        try:
            summary["sources"][name] = fn(s)
        except Exception as e:
            errors.append(f"{name}: {type(e).__name__}: {e}")
    summary["errors"] = errors
    summary["export_files"] = sorted(p.name for p in OUT.glob("*") if p.is_file())
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 1 if errors and not summary["sources"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
