#!/usr/bin/env python3
"""Bounded Hugging Face Open Deep Research adapter for Apex Atlas.

This is intentionally smaller than the upstream GAIA example:
  * ToolCallingAgent prevents arbitrary local code execution.
  * Serper is the Google-backed search provider and page fetching is bounded.
  * The process emits one JSON object, suitable for the TypeScript subprocess
    runner; credentials are read only from the environment.
  * The result is review-only. Callers must validate exact pages before using
    any claim as evidence.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from markdownify import markdownify
from smolagents import InferenceClientModel, Tool, ToolCallingAgent


USER_AGENT = (
    "ApexFinder-Pro-Research/1.0 "
    "(public OSINT review; contact apexfinder@example.invalid)"
)
SERPER_ENDPOINT = "https://google.serper.dev/search"
MAX_SEARCH_RESULTS = 8
MAX_PAGE_CHARS = 12_000
MAX_REPORT_CHARS = 16_000
MAX_CITATIONS = 40


def clean_url(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    value = raw.strip()
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return value[:2_000]


def compact_text(value: str, limit: int = MAX_PAGE_CHARS) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    return value[:limit]


class SerperSearchTool(Tool):
    name = "search_public_web"
    description = (
        "Search the live public web using Google results from Serper. Return titles, URLs, "
        "and snippets. Search exact names with jurisdiction and registry anchors "
        "for disambiguation. Do not treat snippets as verified evidence."
    )
    inputs = {
        "query": {
            "type": "string",
            "description": "A precise natural-language public web search query.",
        }
    }
    output_type = "string"

    def __init__(self, api_key: str, citations: list[str], search_count: list[int]):
        super().__init__()
        self.api_key = api_key
        self.citations = citations
        self.search_count = search_count

    def forward(self, query: str) -> str:
        if self.search_count[0] >= 4:
            return "Search budget exhausted. Use visit_public_page on the best cited URLs."
        self.search_count[0] += 1
        response = requests.post(
            SERPER_ENDPOINT,
            headers={"X-API-KEY": self.api_key, "Content-Type": "application/json"},
            json={"q": query[:500], "num": MAX_SEARCH_RESULTS},
            timeout=12,
        )
        response.raise_for_status()
        data = response.json()
        rows = []
        for item in data.get("organic", [])[:MAX_SEARCH_RESULTS]:
            url = clean_url(item.get("link"))
            if not url:
                continue
            if url not in self.citations:
                self.citations.append(url)
            rows.append(
                {
                    "title": str(item.get("title", ""))[:240],
                    "url": url,
                    "snippet": compact_text(str(item.get("snippet", "")), 700),
                }
            )
        if not rows:
            return "No public search results returned."
        return json.dumps(rows, ensure_ascii=False)


class PublicPageTool(Tool):
    name = "visit_public_page"
    description = (
        "Fetch one public HTTP(S) page and return bounded readable text. "
        "Use only URLs returned by search_public_web or a direct official source. "
        "The page text is research context, not automatically verified evidence."
    )
    inputs = {
        "url": {
            "type": "string",
            "description": "A public HTTP(S) URL to inspect.",
        }
    }
    output_type = "string"

    def __init__(self, citations: list[str], page_count: list[int]):
        super().__init__()
        self.citations = citations
        self.page_count = page_count

    def forward(self, url: str) -> str:
        cleaned = clean_url(url)
        if not cleaned:
            return "Rejected URL: only public HTTP(S) pages are allowed."
        if self.page_count[0] >= 6:
            return "Page budget exhausted."
        self.page_count[0] += 1
        try:
            response = requests.get(
                cleaned,
                headers={"User-Agent": USER_AGENT},
                timeout=12,
                allow_redirects=True,
            )
            response.raise_for_status()
            final_url = clean_url(response.url) or cleaned
            if final_url not in self.citations:
                self.citations.append(final_url)
            content_type = response.headers.get("content-type", "").lower()
            if "html" not in content_type and "text" not in content_type:
                return f"Fetched {final_url}, but it is not a readable HTML/text page."
            soup = BeautifulSoup(response.text[:250_000], "html.parser")
            for tag in soup(["script", "style", "noscript", "svg"]):
                tag.decompose()
            text = markdownify(str(soup), strip=["img", "form"])
            return f"URL: {final_url}\nTITLE: {soup.title.get_text(' ', strip=True) if soup.title else ''}\nTEXT:\n{compact_text(text)}"
        except requests.RequestException as exc:
            return f"Page fetch failed for {cleaned}: {type(exc).__name__}"


def build_prompt(question: str) -> str:
    return f"""You are the Apex Atlas public-records research agent.

Research this exact target using the live public web:
{question}

Use search_public_web for several focused searches, then visit_public_page for
the strongest exact pages. Keep identity uncertainty, conflicting names, and
negative findings explicit. Do not infer a person from name similarity, wealth,
social usernames, organization contacts, or search snippets.

Return a concise Markdown review with these headings:
## Target
## Findings
## Ownership and operating relationships
## Public intermediary routes
## Uncertainty and search gaps
## Sources

This output is review-only. Never claim a personal email, phone, social account,
or access route is verified unless the exact fetched page supports that claim.
Include the exact URLs you relied on under Sources.
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("question")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    hf_token = os.getenv("HF_TOKEN", "").strip()
    serper_key = os.getenv("SERPER_API_KEY", "").strip()
    model_id = os.getenv(
        "HF_DEEP_RESEARCH_MODEL", "Qwen/Qwen2.5-7B-Instruct"
    ).strip()
    if not hf_token or not serper_key:
        print(
            json.dumps(
                {
                    "status": "unavailable",
                    "report": None,
                    "citations": [],
                    "searches": 0,
                    "pages": 0,
                    "error": "HF_TOKEN and SERPER_API_KEY are required.",
                }
            )
        )
        return 0

    citations: list[str] = []
    search_count = [0]
    page_count = [0]
    try:
        model = InferenceClientModel(
            model_id=model_id,
            token=hf_token,
            timeout=30,
            max_tokens=1_536,
        )
        agent = ToolCallingAgent(
            model=model,
            tools=[
                SerperSearchTool(serper_key, citations, search_count),
                PublicPageTool(citations, page_count),
            ],
            max_steps=6,
            max_tool_threads=1,
            stream_outputs=False,
            verbosity_level=0,
        )
        report = agent.run(build_prompt(args.question))
        if not isinstance(report, str):
            report = str(report)
        report = report.strip()[:MAX_REPORT_CHARS]
        if not report:
            raise RuntimeError("Agent returned an empty report.")
        print(
            json.dumps(
                {
                    "status": "completed",
                    "report": report,
                    "citations": citations[:MAX_CITATIONS],
                    "searches": search_count[0],
                    "pages": page_count[0],
                    "model": model_id,
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "report": None,
                    "citations": citations[:MAX_CITATIONS],
                    "searches": search_count[0],
                    "pages": page_count[0],
                    "model": model_id,
                    "error": f"{type(exc).__name__}: {str(exc)[:300]}",
                },
                ensure_ascii=False,
            )
        )
        return 0


if __name__ == "__main__":
    raise SystemExit(main())