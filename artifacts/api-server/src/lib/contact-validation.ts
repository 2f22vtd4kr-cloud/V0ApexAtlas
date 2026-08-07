/**
 * Validation for public contact evidence extracted from web pages and search
 * results. Search-engine diagnostics, placeholder addresses, and privacy
 * relay addresses are not person or organization contact vectors.
 *
 * K1: REGISTRAR_DOMAINS — email domains belonging to registrars / CDN infra.
 * K2: GENERIC_PREFIXES  — local-parts indicating shared organisational inboxes.
 * K5: normalizePhone    — E.164 normalisation + range validation (8–15 digits).
 * K6: script-extension / IP-like domain rejection.
 */

// ── K1: Registrar / hosting-infrastructure domain blocklist ──────────────────
// An RDAP/WHOIS result whose email domain is in this set belongs to the
// registrar or infrastructure provider, not the entity being researched.
export const REGISTRAR_DOMAINS = new Set([
  // Domain registrars
  "web.com", "namebright.com", "godaddy.com", "networksolutions.com",
  "enom.com", "hugedomains.com", "domainsbyproxy.com", "namesilo.com",
  "register.com", "name.com", "porkbun.com", "dynadot.com",
  "1and1.com", "ionos.com", "hover.com", "gandi.net", "namecheap.com",
  "directnic.com", "domain.com", "dotster.com", "123-reg.co.uk",
  "name.com", "launchpad.com", "safenames.net", "marcaria.com",
  // Hosting / CDN infrastructure
  "amazonaws.com", "awsdns.com", "amazon.com", "cloudflare.com",
  "squarespace.com", "wix.com", "bluehost.com", "hostgator.com",
  "siteground.com", "dreamhost.com", "wpengine.com", "kinsta.com",
  "pantheon.io", "netlify.com", "vercel.com",
  // Privacy / WHOIS proxy services
  "whoisguard.com", "privacyprotect.org", "whoisprivacycorp.com",
  "contactprivacy.com", "withheldforprivacy.com", "identity.digital",
  "registrant.com", "anonymize.com", "anonymization.net",
]);

// ── K2: Generic corporate email local-parts (shared inboxes, not personal) ──
const GENERIC_PREFIXES = new Set([
  "info", "contact", "sales", "support", "press", "admin", "hello", "office",
  "noreply", "no-reply", "donotreply", "billing", "ops", "team", "media",
  "pr", "legal", "hr", "webmaster", "enquiries", "enquiry", "general",
  "reception", "invest", "ir", "investor", "investor.relations",
  "customerservice", "customer.service", "help", "jobs", "careers",
  "recruitment", "marketing", "accounts", "mail", "postmaster", "abuse",
  "security", "privacy", "newsletter", "notifications", "alerts",
  "service", "services", "business", "commercial", "connect", "info-",
  "partnership", "partnerships", "sponsors", "sponsorship",
  "membership", "memberships", "frontdesk", "front.desk", "main",
]);

export function isGenericEmailPrefix(local: string): boolean {
  return GENERIC_PREFIXES.has(local.toLowerCase().trim());
}

// ── K6: Script-extension and IP-like domain rejection ────────────────────────
// Prevents JavaScript filenames (e.g. 10.5.13.module.js) parsed as email domains.
const SCRIPT_EXTENSION_RE = /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|php|sh|css|html|json|wasm|map|lock)$/i;
const IP_LIKE_DOMAIN_RE   = /^\d+\.\d+/; // matches 10.x, 192.x, etc.

// ── Core blocklists (unchanged) ───────────────────────────────────────────────
const BLOCKED_EMAIL_DOMAINS = new Set([
  "example.com", "domain.com", "email.com", "test.com", "foo.com",
  "bar.com", "sample.com", "invalid.com", "localhost", "placeholder.com",
  "yourname.com", "company.com", "yourdomain.com", "noreply.com",
  "no-reply.com", "privacy.com", "domains.com", "domainsbyproxy.com",
  "whoisguard.com", "privacyprotect.org", "whoisprivacycorp.com",
  "registrant.com", "duckduckgo.com", "bing.com", "google.com",
  "search.yahoo.com",
]);

const BLOCKED_EMAIL_LOCAL_PARTS = new Set([
  "error", "error-lite", "noreply", "no-reply", "donotreply", "do-not-reply",
  "webmaster",
]);

const EMAIL_RE = /^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$/i;

export function isValidPublicEmail(value: string | null | undefined): boolean {
  const email = value?.trim().toLowerCase() ?? "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return false;
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (BLOCKED_EMAIL_DOMAINS.has(domain)) return false;
  if ([...REGISTRAR_DOMAINS].some(blocked => domain === blocked || domain.endsWith(`.${blocked}`))) return false;
  if (BLOCKED_EMAIL_LOCAL_PARTS.has(local)) return false;
  if (domain.includes("privacy") || domain.includes("proxy")) return false;
  // K6: reject script filenames parsed as email domains
  if (SCRIPT_EXTENSION_RE.test(domain)) return false;
  if (IP_LIKE_DOMAIN_RE.test(domain)) return false;
  return true;
}

export function sanitizePublicEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return isValidPublicEmail(email) ? email : null;
}

// ── Public social URL validation ──────────────────────────────────────────────
// Social URLs are evidence only when they point to a real profile path.  Search
// snippets frequently contain the network homepage, tracking URLs, or a company
// page where a personal handle was expected.
const SOCIAL_HANDLE_RE = /^[a-zA-Z0-9._-]{2,80}$/;

export function isValidPublicSocialHandle(
  value: string | null | undefined,
  network: "instagram" | "twitter",
): boolean {
  const handle = value?.trim().replace(/^@/, "") ?? "";
  if (!SOCIAL_HANDLE_RE.test(handle)) return false;
  const blocked = new Set([
    "about", "login", "signup", "privacy", "terms", "explore", "home",
    "search", "hashtag", "intent", "share", "status", "i", "company",
    "instagram", "twitter", "x", "linkedin", "accounts", "p", "reel",
  ]);
  if (blocked.has(handle.toLowerCase())) return false;
  // Twitter handles are limited to 15 characters. Instagram allows longer
  // handles, but both must remain simple profile identifiers.
  return network === "twitter" ? handle.length <= 15 : handle.length <= 30;
}

export function sanitizePublicSocialHandle(
  value: string | null | undefined,
  network: "instagram" | "twitter",
): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  if (raw.includes("://")) {
    const url = sanitizePublicSocialUrl(raw, network, "person");
    if (!url) return null;
    try {
      const pathPart = new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
      return isValidPublicSocialHandle(pathPart, network) ? pathPart : null;
    } catch {
      return null;
    }
  }
  const handle = raw.replace(/^@/, "");
  return isValidPublicSocialHandle(handle, network) ? handle : null;
}

export function sanitizePublicTelegramHandle(value: string | null | undefined): string | null {
  const handle = value?.trim().replace(/^@/, "") ?? "";
  return /^[a-zA-Z0-9_]{2,64}$/.test(handle) ? handle : null;
}

export function sanitizePublicSocialUrl(
  value: string | null | undefined,
  network: "linkedin" | "instagram" | "twitter",
  scope: "person" | "organization" = "person",
): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.startsWith("@") ? `https://${network === "twitter" ? "x.com" : `${network}.com`}/${raw.slice(1)}` : raw);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const allowedHosts = network === "linkedin"
    ? new Set(["linkedin.com"])
    : network === "instagram"
      ? new Set(["instagram.com"])
      : new Set(["twitter.com", "x.com"]);
  if (!allowedHosts.has(host)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const expectedPath = network === "linkedin"
    ? (scope === "organization" ? "company" : "in")
    : null;
  if (network === "linkedin") {
    if (parts.length < 2 || parts[0] !== expectedPath || !SOCIAL_HANDLE_RE.test(parts[1]!)) return null;
  } else if (parts.length < 1 || !SOCIAL_HANDLE_RE.test(parts[0]!)) {
    return null;
  }

  const slug = parts[parts.length - 1]!;
  const blocked = new Set([
    "about", "login", "signup", "privacy", "terms", "explore", "home",
    "search", "hashtag", "intent", "share", "status", "i", "company",
    "instagram", "twitter", "x", "linkedin",
  ]);
  if (blocked.has(slug.toLowerCase())) return null;

  const canonicalHost = network === "twitter" ? "x.com" : network === "linkedin" ? "www.linkedin.com" : "instagram.com";
  return `https://${canonicalHost}/${parts.join("/")}`;
}

export function sanitizePublicPhone(value: string | null | undefined): string | null {
  return normalizePhone(value);
}

// ── K5: E.164-oriented phone normalisation ───────────────────────────────────
// Returns null when the input is clearly invalid (blocklist, too short, too long).
// ITU-T E.164 max is 15 digits. We require ≥ 8 to filter 7-digit and shorter noise.
const PHONE_NOISE_RE   = /[^\d+]/g;
const PHONE_BLOCKLIST_RE = /redacted|privacy|not\s+public|unavailable|unknown|n\/a|none/i;

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || PHONE_BLOCKLIST_RE.test(s)) return null;

  const hasPlus = s.startsWith("+");
  const digits  = s.replace(/[^\d]/g, "");
  const len     = digits.length;
  const plusCount = (s.match(/\+/g) ?? []).length;

  // A phone number may have one leading plus only. Repeated plus signs are
  // extraction noise, not a valid international number.
  if (plusCount > 1 || (plusCount === 1 && !hasPlus)) return null;

  // Reject out-of-range lengths (ITU-T E.164: 1–15 digits; require ≥ 8)
  if (len < 8 || len > 15) return null;

  // 10-digit without leading +  →  assume NANP (+1)
  if (len === 10 && !hasPlus) return `+1${digits}`;
  // 11-digit starting with 1    →  NANP with country code
  if (len === 11 && digits.startsWith("1")) return `+${digits}`;
  // Already had a leading +     →  keep normalised
  if (hasPlus) return `+${digits}`;
  // International without +     →  store digits only (country code unclear)
  return digits;
}
