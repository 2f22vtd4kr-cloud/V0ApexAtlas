/**
 * Social Discovery Module (H3-A)
 *
 * Finds HNWIs' social media presence: LinkedIn, Twitter/X, Instagram, personal websites.
 * Uses public search engines (DuckDuckGo HTML) + Nitter for Twitter bios — no API keys required.
 * Social media domains are no longer blocked in web-enricher.ts SKIP_DOMAINS.
 */

import { logger } from "../logger";

export interface SocialDiscoveryResult {
  linkedinUrl:      string | null;
  linkedinHeadline: string | null;
  twitterHandle:    string | null;
  twitterBio:       string | null;
  instagramHandle:  string | null;
  personalWebsite:  string | null;
  confidence:       number;
  sources:          string[];
}

const DDG_URL   = "https://html.duckduckgo.com/html";
const NITTER_INSTANCES = [
  "https://nitter.net",
  "https://nitter.privacydev.net",
  "https://nitter.poast.org",
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/126.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function ddgHtmlSearch(query: string): Promise<Array<{ url: string; snippet: string }>> {
  try {
    const params = new URLSearchParams({ q: query, kl: "us-en" });
    const resp = await fetch(`${DDG_URL}?${params}`, {
      method:  "GET",
      headers: { "User-Agent": randomUA(), Accept: "text/html" },
      signal:  AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const results: Array<{ url: string; snippet: string }> = [];
    // Extract result links: <a class="result__url" href="...">
    const linkRe = /href="([^"]+)"[^>]*class="result__url"|class="result__url"[^>]*href="([^"]+)"/gi;
    const snippetRe = /<a class="result__snippet"[^>]*>([^<]+)<\/a>/gi;
    let m: RegExpExecArray | null;
    const urls: string[] = [];
    while ((m = linkRe.exec(html)) !== null) {
      const u = m[1] || m[2];
      if (u && u.startsWith("http")) urls.push(u);
    }
    const snippets: string[] = [];
    while ((m = snippetRe.exec(html)) !== null) snippets.push(m[1].trim());
    for (let i = 0; i < Math.min(urls.length, 5); i++) {
      results.push({ url: urls[i], snippet: snippets[i] ?? "" });
    }
    return results;
  } catch {
    return [];
  }
}

function extractLinkedInUrl(results: Array<{ url: string }>): string | null {
  for (const r of results) {
    const m = r.url.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/i);
    if (m) return `https://www.linkedin.com/in/${m[1]}`;
  }
  return null;
}

function extractTwitterHandle(results: Array<{ url: string }>): string | null {
  for (const r of results) {
    const m = r.url.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})(?:\/|$|\?)/i);
    if (m && !["search", "hashtag", "home", "explore", "i"].includes(m[1].toLowerCase())) {
      return m[1];
    }
  }
  return null;
}

function extractInstagramHandle(results: Array<{ url: string }>): string | null {
  for (const r of results) {
    const m = r.url.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{1,30})(?:\/|$|\?)/i);
    if (m && !["p", "reel", "explore", "accounts"].includes(m[1].toLowerCase())) {
      return m[1];
    }
  }
  return null;
}

async function scrapeNitterBio(handle: string): Promise<string | null> {
  for (const instance of NITTER_INSTANCES) {
    try {
      const resp = await fetch(`${instance}/${handle}`, {
        headers: { "User-Agent": randomUA() },
        signal:  AbortSignal.timeout(6_000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      const bioM = html.match(/<div class="profile-bio"[^>]*>([\s\S]*?)<\/div>/i);
      if (bioM) return bioM[1].replace(/<[^>]+>/g, "").trim().slice(0, 300);
    } catch { /* try next instance */ }
  }
  return null;
}

async function scrapeLinkedInHeadline(profileUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(profileUrl, {
      headers: { "User-Agent": randomUA(), Accept: "text/html" },
      signal:  AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    // LinkedIn public pages include og:description or headline meta
    const m = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)
           || html.match(/<title>([^|<]+)/i);
    if (m) return m[1].trim().slice(0, 200);
    return null;
  } catch {
    return null;
  }
}

/** Main entry — discovers social presence for a single entity. */
export async function discoverSocialPresence(entity: {
  name: string;
  knownResidences?: string | null;
  type?: string | null;
}): Promise<SocialDiscoveryResult> {
  const result: SocialDiscoveryResult = {
    linkedinUrl:      null,
    linkedinHeadline: null,
    twitterHandle:    null,
    twitterBio:       null,
    instagramHandle:  null,
    personalWebsite:  null,
    confidence:       0,
    sources:          [],
  };

  const name = entity.name.trim();

  // ── Step 1: LinkedIn via DuckDuckGo ──────────────────────────────────────
  const liResults = await ddgHtmlSearch(`"${name}" site:linkedin.com/in`);
  const liUrl = extractLinkedInUrl(liResults);
  if (liUrl) {
    result.linkedinUrl = liUrl;
    result.confidence += 30;
    result.sources.push("ddg-linkedin");

    // Step 1b: Scrape headline from LinkedIn public page
    const headline = await scrapeLinkedInHeadline(liUrl);
    if (headline) {
      result.linkedinHeadline = headline;
      result.confidence += 5;
      result.sources.push("linkedin-headline");
    }
  }

  // Small delay between searches to be polite
  await new Promise(r => setTimeout(r, 1_200));

  // ── Step 2: Twitter/X via DuckDuckGo ─────────────────────────────────────
  const twResults = await ddgHtmlSearch(`"${name}" site:twitter.com OR site:x.com`);
  const twHandle = extractTwitterHandle(twResults);
  if (twHandle) {
    result.twitterHandle = twHandle;
    result.confidence += 20;
    result.sources.push("ddg-twitter");

    // Step 2b: Scrape bio from Nitter (Twitter without API)
    const bio = await scrapeNitterBio(twHandle);
    if (bio) {
      result.twitterBio = bio;
      // Extract personal website from bio
      const siteM = bio.match(/https?:\/\/[^\s]{4,60}/);
      if (siteM && !siteM[0].includes("twitter") && !siteM[0].includes("x.com")) {
        result.personalWebsite = siteM[0];
        result.confidence += 15;
        result.sources.push("twitter-bio-website");
      }
      result.confidence += 10;
      result.sources.push("nitter-bio");
    }
  }

  await new Promise(r => setTimeout(r, 1_200));

  // ── Step 3: Instagram via DuckDuckGo ─────────────────────────────────────
  // Only for lifestyle/luxury/art HNWIs — skip Corporations
  if (entity.type !== "Corporation" && entity.type !== "Trust") {
    const igResults = await ddgHtmlSearch(`"${name}" site:instagram.com`);
    const igHandle = extractInstagramHandle(igResults);
    if (igHandle) {
      result.instagramHandle = igHandle;
      result.confidence += 15;
      result.sources.push("ddg-instagram");
    }
  }

  return result;
}
