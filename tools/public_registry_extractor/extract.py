#!/usr/bin/env python3
"""
Source-backed, resumable public-registry extractor.

Outputs intentionally separate organizations and people. FAA individual
registrants are excluded: the FAA table is used only for clearly identifiable
legal-entity registrants and corporate aircraft records. BRREG person records
contain only published business roles; date of birth, personal identifiers,
postal/residential addresses and other personal fields are never exported.
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb
import requests

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "exports" / "public-registry"
OUT.mkdir(parents=True, exist_ok=True)

UA = "PublicRegistryExtractor/0.1 (source-backed business directory; contact: repository-maintainer)"
OPENAIR_BASE = "https://openairdocs.org/data/latest/"
BRREG_BASE = "https://data.brreg.no/enhetsregisteret/api"
BRREG_CODES = [
    "41.109", "41.100", "68.100", "68.200", "68.310", "68.320",
    "55.100", "55.201", "56.101",
    "69.100", "69.202", "70.100", "70.220",
    "71.111", "71.112", "71.121", "71.129",
]
PAGE_SIZE = 500
MAX_PER_CODE = 10_000
ROLE_LOOKUP_LIMIT = 500

# Legal-form / business-name indicators. This is a conservative positive
# filter; private individuals without an explicit organization indicator are
# not copied to any FAA output.
ORG_RE = re.compile(
    r"(?i)(\bLLC\b|\bL\.L\.C\.?\b|\bLLP\b|\bL\.L\.P\.?\b|\bINC\.?\b|"
    r"\bCORP(?:ORATION)?\b|\bLTD\.?\b|\bLIMITED\b|\bPLC\b|\bGMBH\b|"
    r"\bS\.?A\.?S?\.?\b|\bS\.?R\.?L\.?\b|\bB\.?V\.?\b|\bN\.?V\.?\b|"
    r"\bA\.?G\.?\b|\bA/S\b|\bAPS\b|\bOY\b|\bAB\b|\bAS\b|"
    r"\bTRUST(?:EE)?\b|\bBANK\b|\bHOLDINGS?\b|\bPARTNERSHIP\b|\bL\.?P\.?\b|"
    r"\bCAPITAL\b|\bAVIATION\b|\bAIRCRAFT\b|\bCHARTER\b|\bLEASING\b|"
    r"\bMANAGEMENT\b|\bCOMPANY\b|\bCO\.\b)"
)
GENERIC_MAILBOXES = {
    "info", "contact", "office", "sales", "service", "support", "admin",
    "booking", "reservations", "maintenance", "dispatch", "operations",
    "post", "firmapost", "kundeservice", "kundesenter", "mail", "hello",
}


def write_csv(path: Path, rows: list[dict[str, Any]], columns: list[str] | None = None) -> int:
    if columns is None:
        columns = list(rows[0].keys()) if rows else []
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: clean(v) for k, v in row.items()})
    return len(rows)


def clean(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return value


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept": "application/json"})
    return s


def get_json(s: requests.Session, url: str, params: dict[str, Any] | None = None,
             attempts: int = 5) -> Any:
    for attempt in range(attempts):
        response = s.get(url, params=params, timeout=(15, 90))
        if response.status_code == 429 or response.status_code >= 500:
            time.sleep(min(2 ** attempt, 20))
            continue
        response.raise_for_status()
        return response.json()
    response.raise_for_status()
    raise RuntimeError(f"Request failed after retries: {url}")


def export_faa() -> dict[str, int]:
    con = duckdb.connect(":memory:")
    try:
        con.execute("INSTALL httpfs")
        con.execute("LOAD httpfs")
        reg_url = OPENAIR_BASE + "faa_aircraft_registration.parquet"
        model_url = OPENAIR_BASE + "faa_aircraft_model.parquet"

        reg_cols = {r[0].lower() for r in con.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{reg_url}')"
        ).fetchall()}
        model_cols = {r[0].lower() for r in con.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{model_url}')"
        ).fetchall()}

        required = {"n_number", "registrant_name", "aircraft_model_code"}
        missing = required - reg_cols
        if missing:
            raise RuntimeError(f"FAA registry schema missing expected fields: {sorted(missing)}")

        def col(alias: str, name: str, available: set[str], default: str = "NULL") -> str:
            return f"{alias}.{name}" if name in available else default

        selected_reg = {
            "n_number": "r.n_number",
            "registrant_name": "r.registrant_name",
            "registrant_city": col("r", "registrant_city", reg_cols),
            "registrant_state": col("r", "registrant_state", reg_cols),
            "serial_number": col("r", "serial_number", reg_cols),
            "year_manufactured": col("r", "year_manufactured", reg_cols),
            "status": col("r", "status", reg_cols),
            "aircraft_model_code": "r.aircraft_model_code",
            "engine_model_code": col("r", "engine_model_code", reg_cols),
        }
        model_fields = {
            "manufacturer": col("m", "manufacturer", model_cols),
            "model": col("m", "model", model_cols),
            "type_aircraft": col("m", "type_aircraft", model_cols),
            "type_engine": col("m", "type_engine", model_cols),
            "num_engines": col("m", "num_engines", model_cols),
        }
        projection = ",\n".join(
            [f"{expr} AS {name}" for name, expr in selected_reg.items()] +
            [f"{expr} AS {name}" for name, expr in model_fields.items()]
        )
        # The model metadata lets the export retain the aircraft context.
        # Entity admission is performed on legal-entity indicators only.
        query = f"""
            SELECT {projection}
            FROM read_parquet('{reg_url}') r
            LEFT JOIN read_parquet('{model_url}') m
              ON m.code = r.aircraft_model_code
            WHERE r.registrant_name IS NOT NULL
              AND regexp_matches(upper(r.registrant_name),
                  '(^|[^A-Z0-9])(LLC|L[.]L[.]C[.]?|LLP|L[.]L[.]P[.]?|INC[.]?|CORP(ORATION)?|LTD[.]?|LIMITED|PLC|GMBH|SAS|SARL|S[.]R[.]L[.]?|B[.]V[.]?|N[.]V[.]?|A[.]G[.]?|A/S|APS|OY|AB|AS|TRUST(EE)?|BANK|HOLDINGS?|PARTNERSHIP|L[.]P[.]?)([^A-Z0-9]|$)')
        """
        aircraft = con.execute(query).fetchdf()
        if aircraft.empty:
            # Fail visibly rather than silently treating an empty extraction
            # as a successful source run.
            raise RuntimeError("FAA query returned zero corporate registrant rows; inspect schema/filter.")
        aircraft["registrant_name"] = aircraft["registrant_name"].astype(str).str.strip()
        aircraft = aircraft[aircraft["registrant_name"].str.len() >= 3].copy()
        aircraft["source_record_url"] = aircraft["n_number"].apply(
            lambda n: f"https://openairdocs.org/aircraft/{n}"
        )
        aircraft["ownership_interpretation"] = (
            "FAA registered-entity name only; beneficial ownership is not established"
        )
        aircraft["contactability_interpretation"] = (
            "Registry evidence is not a contact route; verify a separate official business channel"
        )

        # Keep asset rows separate from company rows.
        aircraft_cols = [
            "registrant_name", "n_number", "serial_number", "year_manufactured",
            "status", "manufacturer", "model", "type_aircraft", "type_engine",
            "num_engines", "registrant_city", "registrant_state",
            "source_record_url", "ownership_interpretation",
        ]
        aircraft_cols = [c for c in aircraft_cols if c in aircraft.columns]
        asset_rows = aircraft[aircraft_cols].to_dict("records")

        grouped = aircraft.groupby(
            ["registrant_name", "registrant_city", "registrant_state"], dropna=False
        )
        companies: list[dict[str, Any]] = []
        for (name, city, state), group in grouped:
            models = sorted({
                " ".join(str(x) for x in [row.get("manufacturer"), row.get("model")] if x and str(x) != "nan").strip()
                for row in group.to_dict("records")
            })
            tails = sorted({str(x) for x in group["n_number"].dropna().tolist()})
            companies.append({
                "organization": name,
                "country": "United States",
                "registrant_city": city,
                "registrant_state": state,
                "registered_aircraft_count": len(tails),
                "aircraft_models": " | ".join(models[:20]),
                "sample_n_numbers": " | ".join(tails[:25]),
                "FAA_source": "OpenAirDocs current FAA aircraft registry table (MASTER)",
                "source_url": "https://openairdocs.org/aircraft",
                "admission_note": "Organization-only discovery record; aircraft registration does not establish beneficial ownership, personal wealth or access",
                "contactability_status": "Not established by FAA registry",
            })
        companies.sort(key=lambda x: (-x["registered_aircraft_count"], x["organization"].casefold()))

        # Current Part 145 repair-station directory: public business-service
        # organizations with certificate identifiers and commercial contact routes.
        repair_url = OPENAIR_BASE + "faa_repair_station.parquet"
        station_cols = {r[0].lower() for r in con.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{repair_url}')"
        ).fetchall()}
        station_df = con.execute(f"SELECT * FROM read_parquet('{repair_url}')").fetchdf()
        station_rows: list[dict[str, Any]] = []
        safe_patterns = [
            "certificate", "station", "business", "name", "city", "state",
            "zip", "postal", "phone", "email", "website", "rating", "class",
            "country", "bilateral", "address", "country",
        ]
        unsafe_patterns = ["contact_name", "contact_person", "first_name", "last_name", "birth", "owner_person", "individual", "personal", "manager_phone", "manager_email", "liaison_phone", "liaison_email", "accountable_manager", "liaison"]
        keep = [
            c for c in station_df.columns
            if any(p in c.lower() for p in safe_patterns)
            and not any(p in c.lower() for p in unsafe_patterns)
        ]
        for record in station_df[keep].to_dict("records"):
            row = dict(record)
            # Only retain shared/departmental mailboxes in this bulk extract.
            for key in list(row):
                if "email" in key.lower() and row[key]:
                    local = str(row[key]).split("@", 1)[0].lower()
                    if local not in GENERIC_MAILBOXES and not any(
                        local.startswith(prefix + ".") or local.startswith(prefix + "-")
                        for prefix in GENERIC_MAILBOXES
                    ):
                        row[key] = ""
            row["source_name"] = "FAA Part 145 repair station directory"
            row["source_url"] = "https://openairdocs.org/use"
            row["contactability_interpretation"] = "Business service contact only; client relationships are not inferred"
            station_rows.append(row)

        counts = {
            "faa_corporate_registrants": write_csv(
                OUT / "faa_corporate_registrants.csv", companies
            ),
            "faa_corporate_aircraft": write_csv(
                OUT / "faa_corporate_aircraft.csv", asset_rows
            ),
            "faa_part145_repair_stations": write_csv(
                OUT / "faa_part145_repair_stations.csv", station_rows
            ),
            "faa_unique_corporate_registrants": len(companies),
            "faa_aircraft_rows_for_corporate_registrants": len(asset_rows),
            "faa_part145_station_rows": len(station_rows),
        }
        return counts
    finally:
        con.close()


def brreg_entity_name(entity: dict[str, Any]) -> str:
    return str(entity.get("navn") or "").strip()


def brreg_roles(s: requests.Session, orgnr: str) -> list[dict[str, Any]]:
    data = get_json(s, f"{BRREG_BASE}/enheter/{orgnr}/roller")
    people: list[dict[str, Any]] = []
    for group in data.get("rollegrupper", []) or []:
        for role in group.get("roller", []) or []:
            person = role.get("person") or {}
            name_obj = person.get("navn") or {}
            full_name = " ".join(
                str(name_obj.get(k) or "").strip()
                for k in ("fornavn", "mellomnavn", "etternavn")
                if str(name_obj.get(k) or "").strip()
            )
            role_type = role.get("type") or {}
            description = str(role_type.get("beskrivelse") or role_type.get("kode") or "").strip()
            if not full_name or role.get("avregistrert") is True:
                continue
            if not re.search(
                r"daglig leder|styreleder|styremedlem|varamedlem|innehaver|"
                r"komplementar|deltaker|signatur|prokura|general manager|chair|director|board",
                description, re.I
            ):
                continue
            people.append({
                "person": full_name,
                "business_role": description,
                "organization": "",
                "organization_number": orgnr,
                "source_url": f"{BRREG_BASE}/enheter/{orgnr}/roller",
                "evidence_level": "Official business-role record only; ownership percentage and contact route not established",
                "contactability_status": "No person-level business contact assessed in registry",
            })
    return people


def export_brreg() -> dict[str, int]:
    s = session()
    entities: dict[str, dict[str, Any]] = {}
    failures: list[dict[str, str]] = []

    for code in BRREG_CODES:
        page = 0
        fetched_for_code = 0
        while fetched_for_code < MAX_PER_CODE:
            params = {
                "naeringskode": code,
                "organisasjonsform": "AS,ASA",
                "konkurs": "false",
                "underAvvikling": "false",
                "underTvangsavviklingEllerTvangsopplosning": "false",
                "size": PAGE_SIZE,
                "page": page,
                "sort": "antallAnsatte,DESC",
            }
            try:
                data = get_json(s, f"{BRREG_BASE}/enheter", params=params)
            except Exception as exc:
                failures.append({"code": code, "error": str(exc)[:500]})
                break
            embedded = (data.get("_embedded") or {}).get("enheter") or []
            if not embedded:
                break
            for entity in embedded:
                orgnr = str(entity.get("organisasjonsnummer") or "").strip()
                if orgnr:
                    entities[orgnr] = entity
            fetched_for_code += len(embedded)
            page_meta = data.get("page") or {}
            total_pages = int(page_meta.get("totalPages") or 0)
            if not total_pages or page + 1 >= total_pages:
                break
            page += 1
            time.sleep(0.08)

    companies: list[dict[str, Any]] = []
    for orgnr, e in entities.items():
        form = (e.get("organisasjonsform") or {}).get("kode", "")
        if form not in {"AS", "ASA"}:
            continue
        business = e.get("forretningsadresse") or {}
        codes: list[str] = []
        descriptions: list[str] = []
        for key in ("naeringskode1", "naeringskode2", "naeringskode3"):
            item = e.get(key) or {}
            if item.get("kode"):
                codes.append(str(item["kode"]))
                descriptions.append(str(item.get("beskrivelse") or ""))
        capital = e.get("kapital") or {}
        companies.append({
            "organization": brreg_entity_name(e),
            "organization_number": orgnr,
            "legal_form": form,
            "country": "Norway",
            "business_city": business.get("poststed") or business.get("kommune") or "",
            "business_postcode": business.get("postnummer") or "",
            "business_address": ", ".join(business.get("adresse") or []),
            "business_address_country": business.get("landkode") or "NO",
            "business_email": e.get("epostadresse") or "",
            "business_phone": e.get("telefon") or "",
            "official_website": e.get("hjemmeside") or "",
            "employees": e.get("antallAnsatte") or "",
            "industry_codes": " | ".join(dict.fromkeys(codes)),
            "industry_descriptions": " | ".join(dict.fromkeys(descriptions)),
            "registered_share_capital_amount": capital.get("belop") or "",
            "registered_share_capital_currency": capital.get("valuta") or "",
            "incorporation_date": e.get("stiftelsesdato") or "",
            "registered_in_business_register": e.get("registrertIForetaksregisteret") or False,
            "bankruptcy": e.get("konkurs") or False,
            "under_liquidation": e.get("underAvvikling") or False,
            "official_registry_url": f"{BRREG_BASE}/enheter/{orgnr}",
            "source_name": "Brønnøysundregistrene — Central Coordinating Register",
            "admission_note": "Business-sector and registered-company evidence; share capital is not enterprise value or personal wealth",
            "contactability_status": "Official organization contact only; not personal access",
        })

    companies.sort(key=lambda x: (
        -int(x["employees"] or 0) if str(x["employees"]).isdigit() else 0,
        x["organization"].casefold()
    ))
    write_csv(OUT / "norway_real_estate_and_professional_companies.csv", companies)

    # Public business-role names only; omit dates of birth, addresses, IDs and
    # all non-business roles. Sample the largest 500 source-backed companies to
    # avoid turning this into an indiscriminate personal-data dump.
    people: list[dict[str, Any]] = []
    role_company_count = 0
    for company in companies[:ROLE_LOOKUP_LIMIT]:
        orgnr = company["organization_number"]
        try:
            rows = brreg_roles(s, orgnr)
            for row in rows:
                row["organization"] = company["organization"]
                people.append(row)
            role_company_count += 1
        except Exception as exc:
            failures.append({"orgnr": orgnr, "error": str(exc)[:500]})
        time.sleep(0.12)
    # Deduplicate person + organization + role.
    seen: set[tuple[str, str, str]] = set()
    unique_people = []
    for row in people:
        key = (row["person"].casefold(), row["organization_number"], row["business_role"].casefold())
        if key not in seen:
            seen.add(key)
            unique_people.append(row)
    write_csv(OUT / "norway_business_people_roles.csv", unique_people)

    with (OUT / "brreg_api_failures.json").open("w", encoding="utf-8") as f:
        json.dump(failures, f, ensure_ascii=False, indent=2)
    return {
        "brreg_companies": len(companies),
        "brreg_people_roles": len(unique_people),
        "brreg_role_companies_queried": role_company_count,
        "brreg_api_failures": len(failures),
    }


def main() -> int:
    summary: dict[str, Any] = {
        "run_at_utc": datetime.now(timezone.utc).isoformat(),
        "sources": {},
        "privacy_and_realism_controls": [
            "FAA private individual registrants are not exported.",
            "FAA output includes only legal-entity-name matches and aircraft metadata; registrant status is not beneficial ownership.",
            "FAA street addresses, home-location points, and personal phone numbers are not exported.",
            "BRREG company rows include registered business contacts and business premises only.",
            "BRREG people rows include published business-role names and company role only; no birth dates, personal identifiers, or addresses.",
            "Company switchboards and general inboxes remain organization contacts, not personal access.",
            "No wealth estimate is generated from aircraft, share capital, headcount, or institutional portfolio values.",
            "Every exported row preserves source provenance and is not auto-promoted to contact-qualified status.",
        ],
    }
    errors: list[str] = []
    try:
        summary["sources"]["FAA/OpenAirDocs"] = export_faa()
    except Exception as exc:
        errors.append(f"FAA/OpenAirDocs: {type(exc).__name__}: {exc}")
    try:
        summary["sources"]["Norway/BRREG"] = export_brreg()
    except Exception as exc:
        errors.append(f"Norway/BRREG: {type(exc).__name__}: {exc}")
    summary["errors"] = errors
    summary["export_files"] = sorted(p.name for p in OUT.glob("*") if p.is_file())
    with (OUT / "summary.json").open("w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not errors or summary["sources"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
