/**
 * Broad HNWI Discovery Engine
 *
 * Discovers NEW HNWIs from the open web WITHOUT requiring existing entity IDs.
 * Fires broad search queries against DuckDuckGo and generates entities from results.
 *
 * 150+ query templates across 15 categories (10+ each):
 *   1  — Family Office & Private Wealth
 *   2  — Luxury Assets & Aviation
 *   3  — SEC Filings & Corporate
 *   4  — Philanthropy & Foundations
 *   5  — Public Mentions & Networks
 *   6  — European Venue Owners
 *   7  — Nordic & Scandinavian
 *   8  — Asian Wealth Centres
 *   9  — Latin American & Eastern European
 *   10 — Tier-1 Fund Principals
 *   11 — Real-World Italian & Mediterranean Venues
 *   12 — French Riviera & Alpine Luxury
 *   13 — Middle East Business & Investment
 *   14 — Private Club, Marina & Resort Ownership
 *   15 — UK Country Houses, Estates & Private Members
 *
 * Template rotation is tracked in Redis key "broad-discovery:last-template-set".
 */

import { logger } from "../logger";
import { db, entitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getPermanentClient } from "../redis";

// ── Tavily search (primary — better quality than DDG) ─────────────────────────

const TAVILY_KEYS = [
  "TAVILY_API_KEY","TAVILY_API_KEY_1","TAVILY_API_KEY_2","TAVILY_API_KEY_3",
  "TAVILY_API_KEY_4","TAVILY_API_KEY_5","TAVILY_API_KEY_6",
].map(k => process.env[k]).filter(Boolean) as string[];

async function tavilySearch(query: string): Promise<Array<{ snippet: string; url: string }>> {
  if (!TAVILY_KEYS.length) return [];
  const key = TAVILY_KEYS[Math.floor(Math.random() * TAVILY_KEYS.length)];
  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 8, search_depth: "basic", include_answer: false }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { results?: Array<{ content?: string; url?: string }> };
    return (data.results ?? []).map(r => ({ snippet: r.content ?? "", url: r.url ?? "" })).filter(r => r.snippet.length > 20);
  } catch (err: any) {
    logger.debug({ err: err?.message, query }, "broad-discovery Tavily error (non-fatal)");
    return [];
  }
}

// ── Groq AI name extraction from aggregated text ───────────────────────────────

const _groqKeyNames = ["GROQ_API_KEY"];
for (let i = 1; i <= 10; i++) _groqKeyNames.push(`GROQ_API_KEY_${i}`);
const GROQ_KEYS = _groqKeyNames.map(k => process.env[k]).filter(Boolean) as string[];

async function aiExtractPersonNames(text: string, context: string): Promise<string[]> {
  if (!GROQ_KEYS.length || text.length < 50) return [];
  const key = GROQ_KEYS[Math.floor(Math.random() * GROQ_KEYS.length)];
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0,
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content: `You are an OSINT analyst extracting names of living, contemporary high-net-worth individuals from search results. Context: searches about "${context}".

INCLUDE only: living private individuals who are wealthy — business owners, investors, property owners, yacht/aircraft owners, fund managers, family office principals, developers, collectors.

EXCLUDE all of the following:
- Companies, organizations, venues, hotels, brands, cities, countries, legal entities (Ltd/LLC/SA/GmbH/Corp/Foundation/Trust/Holdings/Group/Capital/Partners)
- Deceased or historical figures (anyone who died before 2000, or historical names like "Gar Wood", "George Mason", "Queen Victoria", "Louis Tiffany", "Steve Jobs", "Princess Diana")
- Famous public figures: A-list celebrities, musicians, actors, athletes, politicians, royalty, billionaires known to every newspaper (e.g. "Elon Musk", "Jeff Bezos", "Taylor Swift", "King Charles")
- Truncated or incomplete names — at least ONE word in the name must have ≥5 letters (reject "Amr El", "Li Bo", "Al Wu" — these are fragments, not full names)
- Names where every part is ≤3 characters (e.g. "Lu Yu", "Bo Li") — too short to be a reliable full name
- Titles or roles used as names ("The CEO", "The Director", "Board Member", "Past Commodore", "Senior Partner")
- Venue/place names mistaken for people ("Camille Rayon" = a marina, "Connoisseur Circle" = an event, "Port Hercule" = a port)
- Generic roles/abstractions ("Beneficial Owners", "Ministerial Decree", "Joint Venture", "The Register", "Alexander Rich View")
- Names with French/Spanish/Italian articles ("La Compagnie", "Les Ballets", "El Grupo", "Gli Amici")

Return ONLY a JSON array of full name strings. If no valid living HNWIs are found, return [].
Example output: ["Carlo Bianchi", "Ingrid Magnusson", "Walid Dabess"]`,
          },
          { role: "user", content: text.slice(0, 3000) },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "[]";
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[])
      .filter((n): n is string => typeof n === "string" && n.length >= 5 && n.length <= 60)
      .filter(n => n.split(/\s+/).length >= 2)         // at least first + last name
      .filter(n => !isVenueOrOrganization(n))
      .filter(n => !EXCLUDED_NAMES.has(n));
  } catch (err: any) {
    logger.debug({ err: err?.message }, "broad-discovery Groq extraction error (non-fatal)");
    return [];
  }
}

// ── Query templates ───────────────────────────────────────────────────────────

const TEMPLATE_CATEGORIES: Record<number, string[]> = {
  1: [
    '"family office" "director" London',
    '"family office" "principal" Switzerland',
    '"private wealth" "manager" Singapore',
    '"single family office" "founder" "New York"',
    '"multi family office" CEO Dubai',
    '"private office" investment "Hong Kong"',
    '"wealth management" partner Geneva',
    '"private banking" director Luxembourg',
    '"family investment" office Monaco',
    '"private trust" beneficiary Jersey',
    '"family office" "chief investment officer"',
    '"private wealth" "portfolio" "ultra high net worth"',
  ],
  2: [
    '"yacht registration" owner Mediterranean',
    '"private jet" "registered owner" "N-number"',
    '"superyacht" "beneficial owner" Cayman',
    '"aircraft registration" owner Bermuda',
    '"luxury real estate" buyer Monaco',
    '"penthouse" sale "New York" LLC',
    '"estate" acquisition Belgravia',
    '"villa" purchase "Cote d\'Azur"',
    '"private island" sale Caribbean',
    '"art collection" collector auction',
    '"superyacht" owner "beneficial ownership"',
    '"private aircraft" owner "turbine"',
  ],
  3: [
    '"Schedule 13D" "beneficial owner" filing',
    '"Schedule 13G" "5% owner" "public company"',
    '"DEF 14A" "executive compensation" director',
    '"Form 4" insider transaction',
    '"10-K" CEO "total compensation"',
    '"beneficial ownership" "5 percent" Schedule',
    '"control person" "public company" SEC',
    '"major shareholder" "10 percent" filing',
    '"acquisition" "beneficial owner" "Schedule D"',
    '"private equity" partner "fund manager"',
    '"hedge fund" manager "Form ADV"',
    '"activist investor" "Schedule 13D"',
  ],
  4: [
    '"private foundation" trustee 990',
    '"charitable trust" donor philanthropy',
    '"family foundation" board grant',
    '"donor advised fund" advisor',
    '"philanthropic" donor foundation',
    '"charity commission" trustee registration',
    '"nonprofit" officer compensation',
    '"endowment" chair board',
    '"gift agreement" donor university',
    '"naming gift" donor pledge',
    '"foundation" "990" "highest compensated"',
    '"private foundation" "assets" "990-PF"',
  ],
  5: [
    '"billionaire" interview portfolio',
    '"HNWI" profile investment',
    '"angel investor" portfolio companies',
    '"board member" "Fortune 500" director',
    '"venture capitalist" partner fund',
    '"hedge fund" manager portfolio',
    '"private equity" "managing partner"',
    '"real estate developer" portfolio million',
    '"art dealer" collection private',
    '"luxury brand" founder CEO',
    '"family office" "net worth" billion',
    '"ultra high net worth" investor',
  ],
  6: [  // European venue-owner discovery
    '"casino" owner director "Monte Carlo" OR Marbella OR Cannes',
    '"luxury hotel" "beneficial owner" Italy OR France OR Spain',
    '"yacht club" commodore owner Mediterranean',
    '"private members club" director London OR Zurich OR Geneva',
    '"grand hotel" proprietor Austria OR Switzerland',
    '"ski resort" owner investor Alps',
    '"marina" operator owner Cannes OR Monaco OR Antibes',
    '"vineyard" owner estate "Bordeaux" OR "Tuscany"',
    '"luxury villa" owner "Côte d\'Azur" OR Sardinia OR Mallorca',
    '"superyacht charter" owner Mediterranean fleet',
    '"private golf club" owner director membership',
    '"boutique hotel" group owner lifestyle portfolio',
  ],
  7: [  // Nordic & Scandinavian
    '"Bergen" shipping owner director Norway',
    '"Norwegian" billionaire investor portfolio',
    '"Finnish" tech founder billion investment',
    '"Swedish" family office principal',
    '"Stockholm" private equity managing partner',
    '"Danish" shipping company owner director',
    '"Stavanger" oil gas executive director',
    '"Helsinki" investment office founder',
    '"Oslo" real estate developer portfolio',
    '"Copenhagen" private wealth director',
    '"BRREG" director aksjeselskap major shareholder',
    '"Scandinavian" family office investment billion',
  ],
  8: [  // Asian wealth centres
    '"Singapore" family office principal HNWI',
    '"Hong Kong" tycoon director "private limited"',
    '"Tokyo" billionaire investment portfolio',
    '"Dubai" family office "ultra high net worth"',
    '"Abu Dhabi" investment director wealth fund',
    '"Seoul" family business chairman owner conglomerate',
    '"Singapore" MAS licensed fund manager',
    '"Hong Kong" SFC director fund management',
    '"Indonesia" billionaire group owner director',
    '"Malaysia" tycoon conglomerate director chairman',
    '"Philippines" billionaire family office',
    '"Thailand" billionaire investment group',
  ],
  9: [  // Latin American & Eastern European
    '"São Paulo" billionaire investor portfolio',
    '"Mexico City" family office director wealth',
    '"Buenos Aires" investment fund director',
    '"Warsaw" private equity founder billion',
    '"Prague" real estate developer investment',
    '"Cyprus" beneficial owner offshore fund',
    '"Luxembourg" family office principal fund',
    '"Geneva" private wealth family office Swiss',
    '"Zurich" private banking director wealth management',
    '"Vienna" private equity foundation director',
    '"Amsterdam" family office investment',
    '"Brussels" private equity fund director',
  ],
  10: [ // Tier-1 fund & institutional principals
    '"general partner" fund billion AUM raise',
    '"managing director" private equity European',
    '"venture capital" "founding partner" Europe',
    '"hedge fund" "founding partner" London',
    '"family office" "chief investment officer" Europe',
    '"sovereign wealth" officer director fund',
    '"endowment" "chief investment officer" foundation',
    '"private credit" fund manager director',
    '"real assets" fund manager director European',
    '"UHNW" client director private bank',
    '"impact fund" "managing partner" billion',
    '"co-investment" director "family office" network',
  ],

  11: [ // Real-world Italian & Mediterranean venue owners
    '"hotel" owner founder Sicily Italy millionaire director',
    '"albergo" proprietario Sicilia Sardegna Costiera',
    '"luxury hotel" owner Italy "boutique" founder director',
    '"resort" owner director Sicily Sardinia Amalfi',
    '"restaurant Michelin" owner founder Italy chef patron',
    '"vineyard" owner estate Tuscany Piedmont Barolo director',
    '"agriturismo" owner founder Tuscany Umbria',
    '"villa" rental owner Positano Capri Portofino',
    '"private beach club" owner director Mediterranean',
    '"restaurant" "Michelin star" owner Sicily Palermo Agrigento',
    '"yacht charter" owner fleet Mediterranean Italy',
    '"palazzo" owner restoration Italy heritage director',
  ],

  12: [ // French Riviera, Alpine luxury & Bordeaux
    '"hotel" owner director "Côte d\'Azur" Nice Cannes',
    '"château" owner Bordeaux wine estate proprietor',
    '"golf club" owner director France "Côte d\'Azur"',
    '"ski resort" owner director Courchevel Méribel Chamonix',
    '"restaurant" owner founder Monaco Saint-Tropez Antibes',
    '"villa" owner director Cap Ferrat Menton Èze France',
    '"private members club" owner director Paris Lyon',
    '"luxury boutique hotel" owner France Provence Alps',
    '"spa resort" owner director Alps France Switzerland',
    '"polo club" owner patron France Argentina',
    '"domaine" wine owner director Burgundy Champagne',
    '"nightclub" owner director Saint-Tropez Monaco Ibiza',
  ],

  13: [ // Middle East business, investment & real estate
    '"investment fund" Dubai founder principal director',
    '"family office" Abu Dhabi Riyadh Doha principal',
    '"real estate" developer owner Dubai founder billion',
    '"hospitality group" owner CEO Dubai UAE founder',
    '"business group" chairman owner Saudi Arabia Kuwait',
    '"hotel" developer owner Dubai Abu Dhabi founder',
    '"mall" developer owner UAE Gulf director chairman',
    '"private equity" Dubai founding partner billion',
    '"investment" chairman CEO Qatar Bahrain Oman',
    '"sovereign wealth" officer director Dubai Abu Dhabi',
    '"construction" chairman owner Riyadh Jeddah billion',
    '"shipping" owner director UAE Gulf billionaire',
  ],

  14: [ // Private club, marina & resort ownership globally
    '"golf club" owner director member "private" Scotland Ireland',
    '"yacht club" owner commodore director Mediterranean Atlantic',
    '"marina" operator owner developer Monaco Antibes Port Vieux',
    '"private members club" director owner London Edinburgh',
    '"polo club" owner patron Windsor Deauville',
    '"tennis club" owner director exclusive member',
    '"ski club" owner director exclusive Alps Verbier Gstaad',
    '"shooting estate" owner director Scotland Highlands',
    '"fishing lodge" owner director Scotland Norway Iceland',
    '"private island resort" owner developer Caribbean Maldives',
    '"beach club" owner founder Mykonos Ibiza Sardinia',
    '"country club" owner developer director exclusive',
  ],

  15: [ // UK country houses, estates & private members clubs
    '"country house hotel" owner director UK England',
    '"estate" owner director English countryside heritage',
    '"stately home" owner restoration director UK',
    '"private members club" founder director London Mayfair',
    '"shooting estate" owner director Scottish Highlands',
    '"country estate" owner developer director England',
    '"manor house" owner founder restoration UK',
    '"luxury lodge" owner director Scottish Highlands',
    '"racecourse" owner director British horse racing',
    '"vineyard" owner director English wine Sussex Kent',
    '"private school" trustee major donor UK',
    '"arts foundation" patron benefactor director UK',
  ],
};

const TOTAL_CATEGORIES = Object.keys(TEMPLATE_CATEGORIES).length; // 15

// ── Name extraction ───────────────────────────────────────────────────────────

const NAME_PATTERNS = [
  // "Mr/Mrs/Dr/Sir First Last" — captures formal titles
  /\b(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Sir|Lord|Lady|Prof\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g,
  // "First Last, [title/role]" — e.g. "John Smith, CEO"
  /\b([A-Z][a-z]+\s+(?:[A-Z][a-z]+\s+)?[A-Z][a-z]+),\s+(?:CEO|CIO|CFO|COO|Founder|Director|Partner|Chairman|President|Managing|Principal|Trustee|Officer)/g,
  // Possessive — "John Smith's family office"
  /\b([A-Z][a-z]+\s+(?:[A-Z][a-z]+\s+)?[A-Z][a-z]+)'s\s+(?:family office|foundation|trust|fund|capital|estate|group|office)/gi,
  // "said [Name]" / "by [Name]" — journalistic patterns
  /\b(?:said|by|from|of|for)\s+([A-Z][a-z]+\s+(?:[A-Z][a-z]+\s+)?[A-Z][a-z]+)\b/g,
];

// Common false positives to exclude
const EXCLUDED_NAMES = new Set([
  // US geography
  "New York", "Los Angeles", "San Francisco", "Las Vegas", "Palm Beach",
  "Fort Worth", "Fort Lauderdale", "North America", "South America",
  "New Jersey", "New Mexico", "Wall Street", "Silicon Valley",
  // International geography
  "Hong Kong", "United States", "United Kingdom", "Middle East", "South East",
  "Monte Carlo", "Cote d'Azur", "Côte d'Azur", "Massa Carrara", "Costa Rica",
  "Saudi Arabia", "Abu Dhabi", "South Korea", "East Asia", "North Africa",
  "New Zealand", "Costa Blanca", "Tel Aviv", "Cape Town",
  // Historical periods / eras (never HNWIs)
  "Middle Ages", "Dark Ages", "Bronze Age", "Iron Age", "Stone Age",
  "Ancient Rome", "Ancient Greece", "Roman Empire", "Ottoman Empire",
  // Historical titles / deceased figures commonly mentioned in estate contexts
  "Duke Wellington", "Duke Marlborough", "Duke Devonshire",
  "Earl Spencer", "Lord Byron", "Lord Nelson",
  // SEC / regulatory
  "Schedule 13D", "Schedule 13G", "Form 4", "Form ADV", "DEF 14A",
  "Annual Report", "Proxy Statement", "Board Meeting", "General Meeting",
  // UK government bodies (commonly extracted from CH queries)
  "Companies House", "Land Registry", "Companies Act", "Company Act",
  "Royal Mail", "National Trust", "English Heritage", "Natural England",
  // Common venue/estate fragments (not person names)
  "Country House", "Country Estate", "Country Club", "Grand Hotel",
  "Manor House", "Stately Home", "Estate Agency", "Heritage Site",
  "Family Office", "Investment Fund", "Private Equity", "Hedge Fund",
  "Ski Resort", "Golf Club", "Beach Club", "Yacht Club", "Polo Club",
  "Members Club", "Private Club", "Health Club", "Country House Hotel",
]);

// Words that indicate a venue/brand name rather than a person
const VENUE_INDICATORS = [
  "hotel", "hotels", "resort", "resorts", "estate", "estates", "grange",
  "house", "lodge", "manor", "hall", "castle", "palace", "villa", "villas",
  "place", "court", "court house", "spa", "retreat", "sanctuary",
  "group", "holding", "holdings", "trust", "fund", "capital", "ventures",
  "partners", "associates", "consultants", "services", "solutions",
  "club", "society", "foundation", "charity", "organisation", "organization",
  "golfers", "marina", "yacht", "golf", "polo", "tennis", "equestrian",
  "studio", "studios", "gallery", "galleries", "atelier",
  "travel", "travels", "tours", "tourism", "visit", "visitor",
  "trading", "trade", "traders", "enterprise", "enterprises",
  "heritage", "cultural", "culture", "arts", "museum",
  // Abstract/institutional nouns that look like 2-word TitleCase pairs
  "affairs", "promotion", "bureau", "authority", "ministry", "department",
  "agency", "council", "commission", "committee", "board", "institute",
  "association", "federation", "union", "alliance", "network", "initiative",
  "programme", "program", "project", "sector", "industry", "market",
  "investment", "development", "management", "administration",
  // Geographic/topographic terms that produce place-name pairs
  "bay", "cape", "cove", "gulf", "lake", "lakes", "mountain", "mountains",
  "midtown", "downtown", "uptown", "borough", "district", "peninsula",
  "strait", "island", "islands", "valley", "canyon", "creek", "river",
  "shire", "county", "yorkshire", "lancashire", "hampshire",
  "scotland", "england", "ireland", "wales",
  // Job-function / role phrases that look like names
  "managers", "manager", "directors", "officers", "executives",
  "commissioners", "coordinators", "volunteers", "ambassadors",
  // Media / publications
  "magazines", "magazine", "newspaper", "newspapers", "journal", "journals",
  "broadcast", "publisher", "publishers", "productions",
  // Historical period / event words — never a person's name
  "wars", "war", "battle", "napoleonic", "baroque", "renaissance",
  "medieval", "victorian", "georgian", "edwardian", "colonial", "classical",
  "romantic", "ancient", "modern", "contemporary", "imperial", "byzantine",
  // Generic commodity / abstract concept pairs
  "energy", "renewable", "technology", "technologies", "media", "digital",
  "global", "international", "national", "regional", "local", "analytics",
  "logistics", "infrastructure", "telecommunications", "pharmaceutical",
  // Financial / advisory firms (not people)
  "wealth", "financial", "advisory", "advisors", "advisor", "bankers",
  "bank", "banking", "corporate", "securities", "investments",
  // Educational institutions
  "university", "universities", "school", "schools", "college", "colleges",
  "academy", "academies", "institute", "institutes",
  // Privacy / tech jargon leaking from ad/cookie banners
  "privacy", "profiles", "cookies", "consent", "settings",
];

function isVenueOrOrganization(name: string): boolean {
  const lower = name.toLowerCase();
  return VENUE_INDICATORS.some(v => lower.includes(v));
}

// Country/region words that sometimes prefix person names in scraped text
// e.g. "Mexico Asanka Pathiraja" → strip "Mexico" → "Asanka Pathiraja"
const LEADING_GEO_WORDS = new Set([
  "America", "Mexico", "Europe", "Asia", "Africa", "Nordic", "Latin",
  "Eastern", "Western", "Southern", "Northern", "Central", "Middle",
  "Brazil", "Chile", "India", "China", "Japan", "Korea", "Russia",
  "France", "Germany", "Italy", "Spain", "Poland", "Greece", "Turkey",
  "Australia", "Canada", "Israel", "Singapore", "Dubai", "Qatar",
]);

function extractNames(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of NAME_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      let name = (m[1] || m[0]).trim();
      // Strip leading country/region word that bled into the match
      const firstWord = name.split(/\s+/)[0];
      if (LEADING_GEO_WORDS.has(firstWord)) {
        name = name.slice(firstWord.length).trim();
      }
      // Validate: 2-4 words, each capitalised, not in exclusion list, not a venue
      const words = name.split(/\s+/);
      if (words.length >= 2 && words.length <= 4 &&
          words.every(w => /^[A-Z][a-zA-Z'-]+$/.test(w)) &&
          !EXCLUDED_NAMES.has(name) &&
          !isVenueOrOrganization(name) &&
          name.length >= 5 && name.length <= 60) {
        found.add(name);
      }
    }
  }
  return [...found];
}

// ── DuckDuckGo HTML search ────────────────────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/126.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
];

function randomUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }

async function ddgSearch(query: string): Promise<Array<{ snippet: string; url: string }>> {
  try {
    const params = new URLSearchParams({ q: query, kl: "us-en" });
    const resp = await fetch("https://html.duckduckgo.com/html?" + params.toString(), {
      headers: { "User-Agent": randomUA(), "Accept": "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const results: Array<{ snippet: string; url: string }> = [];
    // Parse snippets from DDG HTML response
    const snippetRe = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const urlRe = /<a class="result__url"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetMatches = [...html.matchAll(snippetRe)].slice(0, 10);
    const urlMatches = [...html.matchAll(urlRe)].slice(0, 10);
    for (let i = 0; i < snippetMatches.length; i++) {
      const snippet = snippetMatches[i][1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const url = urlMatches[i]?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
      if (snippet.length > 20) results.push({ snippet, url });
    }
    return results;
  } catch (err: any) {
    logger.debug({ err: err?.message, query }, "broad-discovery DDG search error (non-fatal)");
    return [];
  }
}

// ── Dedup against existing names ──────────────────────────────────────────────

async function existingNameSet(): Promise<Set<string>> {
  const rows = await db.select({ name: entitiesTable.name }).from(entitiesTable).limit(100_000);
  return new Set(rows.map(r => r.name.toLowerCase().replace(/[^a-z]/g, "")));
}

function isDuplicateName(candidate: string, existing: Set<string>): boolean {
  const normalized = candidate.toLowerCase().replace(/[^a-z]/g, "");
  if (existing.has(normalized)) return true;
  // Fuzzy: check if any existing name contains all tokens of candidate
  const tokens = candidate.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  for (const ex of existing) {
    const matchCount = tokens.filter(t => ex.includes(t)).length;
    if (matchCount >= 2 && matchCount === tokens.length) return true;
  }
  return false;
}

// ── Template rotation via Redis ───────────────────────────────────────────────

const ROTATION_KEY = "broad-discovery:last-template-set";

async function getNextTemplateSet(rotate: boolean): Promise<number> {
  if (!rotate) return 1;
  const catKeys = Object.keys(TEMPLATE_CATEGORIES).map(Number);
  try {
    const client = await getPermanentClient();
    let lastUsed = 0;
    if (client) {
      const last = await client.get(ROTATION_KEY);
      lastUsed = last ? parseInt(last, 10) : 0;
    }
    // Pick randomly, avoiding the same category twice in a row for true diversity
    const available = catKeys.filter(k => k !== lastUsed);
    const picked = available[Math.floor(Math.random() * available.length)];
    if (client) await client.set(ROTATION_KEY, String(picked));
    return picked;
  } catch {
    return catKeys[Math.floor(Math.random() * catKeys.length)];
  }
}

// ── Entity insertion ──────────────────────────────────────────────────────────

function classifyType(name: string): string {
  // Very simple heuristic — most broad-discovery hits are individuals
  const lower = name.toLowerCase();
  if (/(llc|ltd|inc|corp|group|capital|fund|office|trust|foundation|partners)/i.test(lower)) return "Corporation";
  return "HNWI";
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface BroadDiscoveryResult {
  queriesFired: number;
  resultsScraped: number;
  entitiesDiscovered: number;
  entitiesSkipped: number;   // duplicates
  newEntities: Array<{ name: string; snippet: string; query: string }>;
}

export async function runBroadDiscovery(options: {
  templateSet?: number;       // 1-5, selects which category; overrides rotation
  rotateTemplates?: boolean;  // cycle to next category each run (default true)
  maxQueries?: number;        // default 10
} = {}): Promise<BroadDiscoveryResult> {
  const { rotateTemplates = true, maxQueries = 10 } = options;

  const templateSet = options.templateSet ?? await getNextTemplateSet(rotateTemplates);
  const templates = TEMPLATE_CATEGORIES[templateSet] ?? TEMPLATE_CATEGORIES[1];
  const queries = templates.slice(0, Math.min(maxQueries, templates.length));

  logger.info({ templateSet, queryCount: queries.length }, "Broad discovery: starting");

  let queriesFired = 0;
  let resultsScraped = 0;
  const candidateMap = new Map<string, { snippet: string; query: string }>(); // name → best snippet

  const useTavily = TAVILY_KEYS.length > 0;
  const useGroq   = GROQ_KEYS.length > 0;

  for (const query of queries) {
    // ── Primary: Tavily (higher-quality results) ──────────────────────────────
    let results = useTavily ? await tavilySearch(query) : [];
    if (!results.length) {
      // Fallback: DuckDuckGo HTML scrape
      results = await ddgSearch(query);
    }

    queriesFired++;
    resultsScraped += results.length;

    if (!results.length) {
      await new Promise(r => setTimeout(r, 1_000));
      continue;
    }

    // ── Primary extraction: Groq AI person name extraction ────────────────────
    // AI extraction runs first. Regex fallback only runs when Groq is unavailable,
    // because regex has no knowledge of fiction/history and adds names the AI
    // would correctly reject (e.g. "James Bond", "George Mason").
    let aiExtracted = false;
    if (useGroq) {
      const aggregated = results.map(r => r.snippet).join("\n\n");
      const aiNames = await aiExtractPersonNames(aggregated, query);
      if (aiNames.length > 0) {
        aiExtracted = true;
        for (const name of aiNames) {
          if (!candidateMap.has(name)) {
            const bestSnippet = results.find(r => r.snippet.toLowerCase().includes(name.split(" ")[0].toLowerCase()))?.snippet ?? results[0].snippet;
            candidateMap.set(name, { snippet: bestSnippet, query });
          }
        }
      }
    }

    // ── Fallback extraction: deterministic regex only when AI is unavailable ──
    // Regex is blind to history/fiction, so it is never allowed to bypass the
    // final deterministic + LLM safety gate below.
    if (!aiExtracted) {
      for (const { snippet } of results) {
        const names = extractNames(snippet);
        for (const name of names) {
          if (!candidateMap.has(name)) {
            candidateMap.set(name, { snippet, query });
          }
        }
      }
    }

    // Polite delay between queries (shorter since Tavily is a paid API)
    await new Promise(r => setTimeout(r, useTavily ? 500 : 2_000 + Math.random() * 1_000));
  }

  logger.info({ queriesFired, resultsScraped, candidates: candidateMap.size }, "Broad discovery: queries done, deduping against DB");

  // Dedup against existing entities
  const existingNames = await existingNameSet();
  const rawEntities: Array<{ name: string; snippet: string; query: string }> = [];
  let skipped = 0;

  for (const [name, { snippet, query }] of candidateMap) {
    if (isDuplicateName(name, existingNames)) { skipped++; continue; }
    rawEntities.push({ name, snippet, query });
  }

  // LLM name filter — removes noise like "Les Ballets", "Beneficial Owners", "Amr El" (truncated)
  let newEntities: typeof rawEntities = [];
  try {
    const { filterHumanNamesWithLLM } = await import("../llm-name-validator");
    const rawNames = rawEntities.map(e => e.name);
    const validNames = new Set(await filterHumanNamesWithLLM(rawNames));
    const beforeCount = rawEntities.length;
    newEntities = rawEntities.filter(e => validNames.has(e.name));
    const filteredCount = beforeCount - newEntities.length;
    if (filteredCount > 0) {
      logger.info({ filteredCount, beforeCount, afterCount: newEntities.length }, "Broad discovery: LLM name filter removed noise entities");
    }
  } catch (e: any) {
    logger.warn({ err: e.message }, "Broad discovery: LLM name filter failed (deterministic candidates only)");
  }

  // Insert new entities
  let inserted = 0;
  for (const { name, snippet, query } of newEntities) {
    try {
      // Sanitise: strip newlines, leading/trailing whitespace, control chars
      const cleanName = name.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
      if (cleanName.length < 5 || cleanName.split(/\s+/).length < 2) continue;
      // Reject names where no single word is ≥4 chars — these are almost always truncated
      // (e.g. "Amr El", "Li Bo", "Al Wu") not full human names
      const nameParts = cleanName.split(/\s+/);
      if (nameParts.every(p => p.replace(/[^a-zA-Z]/g, "").length < 4)) continue;
      // Hard-reject obvious non-human patterns before the LLM validator
      if (/\b(decree|holders?|ownership|beneficial\s+owner|joint\s+venture|harbour|harbor|marina|marine|resort|holdings?|safe\s+harbor|ministerial|legislative|regulation|directive|ordinance|register|committee|council|association|authority|department|government|institute|portfolio|investors?|ventures?|partners?|capital\s+group|asset\s+management|employees|pension|retirement|municipal|bureau|ministry|sheriff|police|fire\s+department|school\s+district|county|borough|township|parish|university|college|nonprofit|non-profit|society|circle|casino|restaurant|bistro|caf[eé]|brasserie|winery|vineyard|gallery|museum|theatre|theater|chophouse|chop\s+house)\b/i.test(cleanName)) continue;
      // Reject names that are clearly places/venues — Title Case words ending in a geographic or amenity noun
      if (/\b(chevalier|sur\s+mer|les\s+bains|château|chateau|domaine|maison|palais|palace|lodge|manor|chalet|club|spa|cove|island|islands|valley|hills|heights|ridge|summit|falls|lake|lakes|creek|gardens|park|square|plaza|promenade)\s*$/i.test(cleanName)) continue;
      // Reject names that contain legal-entity suffixes — these are companies, not people
      if (/\b(ltd|llc|llp|inc|corp|gmbh|s\.a\.|s\.r\.l\.|b\.v\.|n\.v\.|plc|ag|oy|ab|as|bv|nv)\b\.?$/i.test(cleanName)) continue;
      // Reject names starting with military/professional/honorary titles — not a real name
      if (/^(colonel|general|admiral|captain|major|sergeant|lieutenant|commodore|past|former|late|sir|lord|lady|dame|baron|baroness|prince|princess|duke|duchess|count|countess|viscount|earl|marquess|archbishop|bishop|reverend|dr\.|prof\.|judge|justice|senator|governor|president|secretary|minister|inspector|chief|commissioner|superintendent)\b/i.test(cleanName)) continue;
      // Strip trailing web UI artifacts before further checks (e.g. "Alexander Rich View" from LinkedIn "View profile")
      const uiSuffixStripped = cleanName.replace(/\s+(View|Read|More|Less|Next|Back|Page|Profile|Login|Sign|Click|Enter|Submit|Apply|Follow|Connect|Contact|See|Show|Hide|Open|Close|Share|Print|Download|Export|Copy|Edit|Delete|Save|Cancel|Close)\s*$/i, "").trim();
      const finalName = uiSuffixStripped.length >= 5 && uiSuffixStripped.includes(" ") ? uiSuffixStripped : cleanName;
      if (finalName !== cleanName && finalName.length < 5) continue;
      // Reject French article + collective noun combos — "Les Ballets", "Les Vignerons", "La Compagnie"
      if (/^(la|le|les|l'|l')\s+/i.test(finalName)) continue;
      // Reject Spanish/Italian company article prefixes with a venue/org indicator
      if (/^(el\s+|los\s+|las\s+|il\s+|gli\s+|di\s+|de\s+|del\s+|della\s+)/i.test(finalName) && /\b(compan|hotel|resort|club|group|capital|invest|fund|partner|maison|chateau|château|villa|domaine|estate|gallery|atelier)\b/i.test(finalName)) continue;
      // Reject plural nouns — groups/collectives, not a person (e.g. "Past Commodores", "Private Bankers")
      if (/\b(commodores?|bankers?|investors?|directors?|officers?|executives?|managers?|shareholders?|trustees?|partners?|founders?|principals?)\s*$/i.test(finalName) && !/^[A-Z][a-z]+\s+[A-Z][a-z]/.test(finalName)) continue;
      const type = classifyType(finalName);
      await db.insert(entitiesTable).values({
        name: finalName,
        type,
        sourceRegistries: JSON.stringify(["web-discovery"]),
        bayesianScore: 0.3,
        notes: `Discovered via broad web search.\nQuery: ${query}\nSnippet: ${snippet.slice(0, 200)}`,
        liveSource: "broad-web-discovery",
        isHot: false,
        nationality: null,
        estimatedNetWorth: null,
        knownResidences: null,
        contactConfidence: 0,
      } as any).onConflictDoNothing();
       existingNames.add(finalName.toLowerCase().replace(/[^a-z]/g, "")); // prevent same-run dups
      inserted++;
    } catch (err: any) {
      logger.debug({ err: err?.message, name }, "broad-discovery insert error (non-fatal)");
    }
  }

  logger.info({ inserted, skipped, queriesFired, resultsScraped, templateSet }, "Broad discovery complete");

  return {
    queriesFired,
    resultsScraped,
    entitiesDiscovered: inserted,
    entitiesSkipped: skipped,
    newEntities: newEntities.slice(0, 100), // cap result payload
  };
}

/**
 * Discover from a single specific category (1–15).
 * Used by the per-entity full-circle orchestrator to interleave
 * one category at a time with registry batches.
 */
export async function discoverSingleTemplate(category: number, maxQueries = 10): Promise<BroadDiscoveryResult> {
  const cat = Math.max(1, Math.min(15, category));
  return runBroadDiscovery({ templateSet: cat, rotateTemplates: false, maxQueries });
}
