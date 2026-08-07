/**
 * LLM-Backed Name Validator
 *
 * Replaces brittle hand-written regex rules with a Groq LLaMA call that
 * answers a single question: "Is this a human person's full name?"
 *
 * Usage pattern:
 *   1. Regex pre-filter (fast, removes obvious corporate/fund names)
 *   2. LLM batch-filter (catches ambiguous cases like "Economic Affairs",
 *      "Reducing Marginal", "Please Appoint A", abstract concept pairs)
 *
 * The LLM call is fail-closed for broad discovery: if Groq is unavailable or
 * returns malformed output, only candidates that pass the deterministic safety
 * gate are retained. A provider outage must never turn search noise into HNWI
 * records.
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
 * Fail-open: returns all candidates on any error.
 */
export async function filterHumanNamesWithLLM(candidates: string[]): Promise<string[]> {
  if (candidates.length === 0) return [];
  const safeCandidates = candidates.filter(isDeterministicallySafeHumanName);
  if (GROQ_KEYS.length === 0) {
    logger.debug("llm-name-validator: no GROQ keys — deterministic safety gate only");
    return safeCandidates;
  }

  const results: string[] = [];
  const BATCH = 60;

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = safeCandidates.slice(i, i + BATCH);
    const valid = await _validateBatch(batch);
    results.push(...valid);
  }

  return results;
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
        max_tokens: 256,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      logger.debug({ status: resp.status }, "llm-name-validator: Groq non-OK — deterministic gate only");
      return names.filter(isDeterministicallySafeHumanName);
    }

    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = (data.choices?.[0]?.message?.content ?? "").trim();

    const match = text.match(/\[[\d,\s]*\]/);
    if (!match) {
      logger.debug({ text }, "llm-name-validator: no JSON array in response — deterministic gate only");
      return names.filter(isDeterministicallySafeHumanName);
    }

    const validIndices: number[] = JSON.parse(match[0]);
    const accepted = validIndices
      .filter(i => i >= 1 && i <= names.length)
      .map(i => names[i - 1])
      .filter(Boolean);

    const rejected = names.filter(n => !accepted.includes(n));
    if (rejected.length > 0) {
      logger.info({ rejected }, "llm-name-validator: rejected non-human names");
    }

    return accepted;
  } catch (err: any) {
    logger.debug({ err: err?.message }, "llm-name-validator: error — deterministic gate only");
    return names.filter(isDeterministicallySafeHumanName);
  }
}
