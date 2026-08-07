/**
 * LLM-Backed Name Validator
 *
 * Provides Groq LLaMA admission gates for broad discovery and name-only
 * ingestion. Discovery uses the source context as well as the candidate name.
 *
 * Usage pattern:
 *   1. Regex pre-filter (fast, removes obvious corporate/fund names)
 *   2. LLM batch-filter (catches ambiguous cases like "Economic Affairs",
 *      "Reducing Marginal", "Please Appoint A", abstract concept pairs)
 *
 * The LLM call is fail-closed for broad discovery: if Groq is unavailable or
 * returns malformed output, no candidates are retained. A provider outage
 * must never turn search noise into HNWI records.
 */

import { logger } from "./logger";

const _groqKeyNames = ["GROQ_API_KEY"];
for (let i = 1; i <= 10; i++) _groqKeyNames.push(`GROQ_API_KEY_${i}`);
const GROQ_KEYS = _groqKeyNames.map(k => process.env[k]).filter(Boolean) as string[];

/**
 * Filter a batch of candidate name strings down to those that are genuine
 * human person full names. Returns the subset that passes LLM validation.
 *
 * Uses llama-3.1-8b-instant (fast + cheap) — we only need binary yes/no.
 * Batches up to 60 names per call to minimise API round trips.
 * Fail-closed: returns no candidates when the provider cannot validate them.
 */
export async function filterHumanNamesWithLLM(candidates: string[]): Promise<string[]> {
  if (candidates.length === 0) return [];
  const safeCandidates = candidates.filter(isDeterministicallySafeHumanName);
  if (GROQ_KEYS.length === 0) {
    logger.warn("llm-name-validator: no GROQ keys — rejecting candidates fail-closed");
    return [];
  }

  const results: string[] = [];
  const BATCH = 60;

  for (let i = 0; i < safeCandidates.length; i += BATCH) {
    const batch = safeCandidates.slice(i, i + BATCH);
    const valid = await _validateBatch(batch);
    results.push(...valid);
  }

  return results;
}

export interface DiscoveryCandidateForLLM {
  name: string;
  snippet: string;
  query: string;
}

/**
 * Validate a discovery candidate against the evidence that produced it.
 *
 * This is intentionally separate from filterHumanNamesWithLLM: a plausible
 * full name is not enough for HNWI admission. The model must see the source
 * context and confirm that the exact person is attributed to a qualifying
 * ownership, wealth, principal, founder, investor, or equivalent claim.
 */
export async function validateDiscoveryCandidatesWithLLM(
  candidates: DiscoveryCandidateForLLM[],
): Promise<string[]> {
  const safe = candidates.filter(candidate =>
    isDeterministicallySafeHumanName(candidate.name),
  );
  if (safe.length === 0) return [];
  if (GROQ_KEYS.length === 0) {
    logger.warn("llm-discovery-validator: no GROQ keys — rejecting candidates fail-closed");
    return [];
  }

  const accepted: string[] = [];
  const BATCH = 20;
  for (let i = 0; i < safe.length; i += BATCH) {
    const batch = safe.slice(i, i + BATCH);
    const prompt = `You are the final admission gate for a private-wealth OSINT database.

Return only the 1-based indices of candidates that pass ALL requirements:
1. The exact candidate name is a real, currently living human individual.
2. The source context explicitly attributes the qualifying claim to that exact person,
   not merely to a nearby company, venue, family, article author, employee, or other person.
3. The claim is a genuine ownership, beneficial ownership, founder, principal, investor,
   major shareholder, property/yacht/aircraft ownership, family-office, wealth, or
   equivalent principal claim.
4. The source context is not a recipe, editorial page, navigation/UI fragment, job listing,
   staff directory, service page, fictional/cultural reference, or generic organization text.
5. The query geography and source context are consistent enough to identify a real target;
   do not infer geography or wealth from the query alone.

Reject obvious false names such as role fragments ("Rocco Forte Deputy"), recipe/editorial
phrases ("Creamy Cucumber", "Tomato Salad"), venues, companies, titles, and names whose
only evidence is that someone else owns a business. When uncertain, reject. This is an
admission gate, not a lead generator.

Candidates:
${batch.map((candidate, index) => [
  `${index + 1}. NAME: "${candidate.name}"`,
  `QUERY: "${candidate.query}"`,
  `SOURCE CONTEXT: "${candidate.snippet.slice(0, 1800)}"`,
].join("\n")).join("\n\n")}

Respond ONLY with a compact JSON array of passing 1-based indices.`;

    const validIndices = await requestIndexGate(prompt, batch.length, "discovery");
    accepted.push(...validIndices.map(index => batch[index - 1].name));
  }
  return accepted;
}

const NON_PERSON_WORDS = new Set([
  "hotel", "resort", "marina", "club", "foundation", "group", "capital",
  "partners", "holdings", "fund", "trust", "company", "corporation",
  "association", "council", "authority", "department", "institute",
  "university", "college", "school", "portfolio", "income", "select",
  "tax", "free", "organization", "organisation", "owners", "ownership",
  "director", "directors", "officer", "officers", "manager", "managers",
  "investor", "investors", "beneficial", "joint", "venture", "decree",
  "board", "committee", "city", "county", "lake", "river", "valley",
  "park", "place", "house", "estate", "view", "profile", "contact",
  "recipe", "recipes", "salad", "cucumber", "tomato", "kitchen",
  "month", "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
  "advisor", "associate", "chairman", "chief", "deputy", "director",
  "executive", "founder", "general", "manager", "officer", "operator",
  "owner", "partner", "president", "principal", "trustee", "vice",
]);

function isDeterministicallySafeHumanName(value: string): boolean {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 5 || name.length > 80 || /[\d\n\r\t]/.test(name)) return false;
  const words = name.split(" ");
  if (words.length < 2 || words.length > 4) return false;
  if (!words.every(w => /^[A-ZÀ-ÖØ-Ü][A-Za-zÀ-ÖØ-öø-ÿ'’-]*$/.test(w))) return false;
  if (words.every(w => w.length <= 3)) return false;
  if (words.some(w => NON_PERSON_WORDS.has(w.toLowerCase()))) return false;
  if (/^(the|a|an|la|le|les|el|los|las|il|gli|de|del|della)\b/i.test(name)) return false;
  if (/[&/]/.test(name)) return false;
  return true;
}

async function _validateBatch(names: string[]): Promise<string[]> {
  const key = GROQ_KEYS[Math.floor(Math.random() * GROQ_KEYS.length)];

  const prompt = `You are a quality gate for a private-wealth OSINT database. Your job: decide whether each name is a REAL, CURRENTLY LIVING private individual who could plausibly be a high-net-worth research target.

Answer YES only when ALL three are true:
1. Real human being — not fictional, not a brand, not a venue name
2. Currently alive today — not deceased, not a historical figure
3. Private individual — not a world-famous celebrity, actor, musician, athlete, politician, head of state, or member of a royal family

Answer NO (exclude) if ANY of the following apply:
- FICTIONAL CHARACTER — e.g. "James Bond", "Jay Gatsby", "Gordon Gekko", "Jack Sparrow"
- DECEASED — anyone publicly known to have died: "George Mason" (1792), "Gar Wood" (1971), "Louis Comfort Tiffany" (1933), "Benjamin Franklin", "Napoleon Bonaparte", "Steve Jobs", "Princess Diana"
- ULTRA-FAMOUS public figure with no private-wealth angle — A-list celebrities, world leaders, royalty (e.g. "Elon Musk", "Taylor Swift", "King Charles")
- Company, venue, or organisation — contains LLC, Ltd, Corp, Marina, Hotel, Resort, Foundation, Group, Capital, Partners, Holdings, Trust, Club, Association, Council, Authority, Department, Circle, Society, Institute
- Government / public sector body — pension funds, public employees, retirement systems, municipal authorities, government agencies, school districts, police departments (e.g. "Colorado Public Employees", "Texas Teachers Retirement", "NYC Fire Department")
- Geographic place, ski resort, venue, or establishment — a named place that is not a person (e.g. "Serre Chevalier", "Port City Chop", "Queen Victoria" when used as a hotel/pub, "Connoisseur Circle")
- Deceased historical figure — monarchs, historical rulers, anyone who died before 1950 (e.g. "Queen Victoria", "Napoleon Bonaparte")
- Two people joined by "&" — e.g. "Edward & Carol Kaplan"
- Abstract concept or legal phrase — "Beneficial Owners", "Joint Venture", "Safe Harbor", "Ministerial Decree", "Due Diligence"
- Clearly truncated or a title — "The Chairman", "Mr Smith", single-word entries, all-initial strings
- Plural collective noun — "Past Commodores", "Private Bankers", "Senior Directors"

Real living businesspeople, family office principals, property developers, fund managers, and investors are YES even if modestly known.
Non-Western names (Chinese, Arabic, Korean, etc.) are YES when they look like a real individual's full name.

IMPORTANT: When unsure whether someone is alive or fictional — err on the side of NO. It is far better to miss one person than to insert a fictional character or deceased historical figure.

Names:
${names.map((n, idx) => `${idx + 1}. "${n}"`).join("\n")}

Respond ONLY with a compact JSON array of the 1-based indices of names that pass (YES). Example: [1,3,7]
If ALL pass, respond with all indices. If ALL fail, respond with [].
Output nothing else.`;

  const validIndices = await requestIndexGate(prompt, names.length, "name");
  const accepted = validIndices
    .map(i => names[i - 1])
    .filter(Boolean);

  const rejected = names.filter(n => !accepted.includes(n));
  if (rejected.length > 0) {
    logger.info({ rejected }, "llm-name-validator: rejected non-human names");
  }

  return accepted;
}

async function requestIndexGate(
  prompt: string,
  candidateCount: number,
  gateName: string,
): Promise<number[]> {
  const start = Math.floor(Math.random() * GROQ_KEYS.length);
  for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
    const key = GROQ_KEYS[(start + attempt) % GROQ_KEYS.length]!;
    try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      if (resp.status === 429 || resp.status === 401 || resp.status === 403) {
        logger.warn({ status: resp.status, gateName, attempt: attempt + 1 }, "llm validator: Groq key unavailable — trying next key");
        continue;
      }
      logger.warn({ status: resp.status, gateName }, "llm validator: Groq non-OK — rejecting candidates fail-closed");
      return [];
    }
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    const match = text.match(/\[[\d,\s]*\]/);
    if (!match) {
      logger.warn({ gateName }, "llm validator: no JSON array — rejecting candidates fail-closed");
      return [];
    }
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || !parsed.every(index => Number.isInteger(index))) {
      logger.warn({ gateName }, "llm validator: malformed index array — rejecting candidates fail-closed");
      return [];
    }
    return (parsed as number[]).filter(index => index >= 1 && index <= candidateCount);
    } catch (err: any) {
      logger.warn({ err: err?.message, gateName, attempt: attempt + 1 }, "llm validator: request failed — trying next key");
      if (attempt === GROQ_KEYS.length - 1) {
        return [];
      }
    }
  }
  logger.warn({ gateName }, "llm validator: all Groq keys unavailable — rejecting candidates fail-closed");
  return [];
}
