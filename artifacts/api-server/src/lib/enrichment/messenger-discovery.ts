/**
 * Messenger Discovery Module (H3-B)
 *
 * Finds HNWIs' Telegram presence via public t.me username lookup.
 * No API key required — uses the public Telegram web preview endpoint.
 * Particularly valuable for Russian/CIS HNWIs who use Telegram as primary messenger.
 */

import { logger } from "../logger";

export interface MessengerDiscoveryResult {
  telegramHandle:       string | null;
  telegramBio:          string | null;
  telegramPublicGroups: string[];
  confidence:           number;
  sources:              string[];
}

/** Generate Telegram username candidates from a full name. */
function generateTelegramCandidates(name: string): string[] {
  // Strip company suffixes (LLC, Inc, Corp, etc.) for cleaner candidate generation
  const cleaned = name
    .replace(/\b(LLC|Inc|Corp|Ltd|LP|LLP|GmbH|SA|NV|PLC|Co\.?)\b\.?/gi, "")
    .trim();

  const parts = cleaned.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length < 1) return [];

  const [first = "", last = ""] = parts;
  const candidates = new Set<string>();

  if (first && last) {
    candidates.add(`${first}${last}`);          // johnsmith
    candidates.add(`${first}_${last}`);         // john_smith
    candidates.add(`${first}.${last}`);         // john.smith
    candidates.add(`${first[0]}${last}`);       // jsmith
    candidates.add(`${first}_${last[0]}`);      // john_s
    candidates.add(`${first}${last[0]}`);       // johns
    candidates.add(`${last}${first[0]}`);       // smithj
    candidates.add(`${last}`);                  // smith (only if ≥5 chars to avoid common words)
  } else if (first) {
    candidates.add(first);
  }

  // Filter: Telegram usernames must be 5–32 chars, alphanumeric + underscore
  return Array.from(candidates)
    .filter(c => c.length >= 5 && c.length <= 32 && /^[a-z0-9_]+$/.test(c));
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** Check a single t.me username. Returns bio if the name matches, null otherwise. */
async function checkTelegramUsername(
  candidate: string,
  firstName: string,
): Promise<{ handle: string; bio: string | null } | null> {
  try {
    const resp = await fetch(`https://t.me/${candidate}`, {
      headers: { "User-Agent": randomUA(), Accept: "text/html" },
      redirect: "follow",
      signal:   AbortSignal.timeout(6_000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // t.me returns a page with the profile if the username exists.
    // The user's display name appears in <meta property="og:title"> and the page body.
    const titleM = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
    const pageTitle = titleM?.[1]?.toLowerCase() ?? "";

    // Check if first name is present in the title (handles Cyrillic → skip those)
    if (!pageTitle.includes(firstName.toLowerCase())) return null;

    // Also ensure it's a user/channel page, not an error page
    if (html.includes("tgme_page_icon_user") || html.includes("og:type") ) {
      const bioM = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
      const bio = bioM?.[1]?.trim() ?? null;
      return { handle: candidate, bio: bio?.slice(0, 300) ?? null };
    }

    return null;
  } catch {
    return null;
  }
}

/** Main entry — discovers Telegram presence for a single entity. */
export async function discoverMessengerPresence(entity: {
  name: string;
  type?: string | null;
}): Promise<MessengerDiscoveryResult> {
  const result: MessengerDiscoveryResult = {
    telegramHandle:       null,
    telegramBio:          null,
    telegramPublicGroups: [],
    confidence:           0,
    sources:              [],
  };

  // Corporations rarely have personal Telegram handles — skip to avoid noise
  if (entity.type === "Corporation" || entity.type === "Trust") return result;

  const name  = entity.name.trim();
  const parts = name.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "";
  if (!firstName || firstName.length < 2) return result;

  const candidates = generateTelegramCandidates(name);
  if (candidates.length === 0) return result;

  // Check candidates sequentially with polite delays
  for (const candidate of candidates) {
    const found = await checkTelegramUsername(candidate, firstName);
    if (found) {
      result.telegramHandle = found.handle;
      result.telegramBio    = found.bio;
      result.confidence     = 40;
      result.sources.push("t.me-lookup");
      break; // First confirmed match wins
    }
    // 800ms between requests to respect t.me rate limits
    await new Promise(r => setTimeout(r, 800));
  }

  return result;
}
