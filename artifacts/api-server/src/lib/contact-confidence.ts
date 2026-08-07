/**
 * Contact confidence score — pure deterministic function.
 *
 * Returns 0–100:
 *   email present        → +35
 *   phone present        → +25
 *   linkedinUrl          → +15
 *   telegramHandle       → +12  (primary for CIS/Russian HNWIs)
 *   twitterHandle        → +8
 *   instagramHandle      → +5
 *   any known address    → +5   (IRS/charity filing address adds directness)
 *
 * Max possible = 105, capped at 100.
 * Previously missed Twitter, Instagram, Telegram signals entirely.
 */

import {
  isGenericEmailPrefix,
  isValidPublicEmail,
  normalizePhone,
  sanitizePublicSocialUrl,
  isValidPublicSocialHandle,
} from "./contact-validation";

export function computeContactConfidence(entity: {
  type?: string | null;
  organizationContact?: boolean;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  telegramHandle?: string | null;
  twitterHandle?: string | null;
  instagramHandle?: string | null;
  knownResidences?: string | null;
}): number {
  // This score is the personal access score. Company/Trust records may have
  // useful organisation evidence, but it must not be presented as a personal
  // reachability signal.
  if (entity.organizationContact || entity.type === "Corporation" || entity.type === "Corp" || entity.type === "Trust") {
    return 0;
  }
  let score = 0;
  const emailLocal = entity.email?.split("@")[0] ?? "";
  if (isValidPublicEmail(entity.email) && !isGenericEmailPrefix(emailLocal)) score += 35;
  if (normalizePhone(entity.phone) !== null)                                  score += 25;
  if (sanitizePublicSocialUrl(entity.linkedinUrl, "linkedin", "person"))      score += 15;
  if (entity.telegramHandle?.trim() && /^[a-zA-Z0-9_]{2,64}$/.test(entity.telegramHandle.replace(/^@/, ""))) score += 12;
  if (isValidPublicSocialHandle(entity.twitterHandle, "twitter"))             score += 8;
  if (isValidPublicSocialHandle(entity.instagramHandle, "instagram"))         score += 5;
  const res = entity.knownResidences;
  if (res && res !== "[]" && res !== "null" && res.trim().length > 2) score += 5;
  return Math.min(score, 100);
}

/**
 * A hot lead requires a meaningful person-level direct vector. Wealth, assets,
 * registry status, generic inboxes, and corporate switchboards do not qualify.
 */
export function hasMeaningfulDirectContact(entity: {
  type?: string | null;
  organizationContact?: boolean;
  email?: string | null;
  phone?: string | null;
  phoneSource?: string | null;
  contactOutcome?: string | null;
}): boolean {
  if (
    entity.organizationContact ||
    entity.type === "Corporation" ||
    entity.type === "Corp" ||
    entity.type === "Trust"
  ) return false;

  const emailLocal = entity.email?.split("@")[0] ?? "";
  const hasPersonalEmail =
    Boolean(entity.email?.trim()) &&
    isValidPublicEmail(entity.email) &&
    !isGenericEmailPrefix(emailLocal);
  const hasPersonalPhone =
    Boolean(entity.phone?.trim()) &&
    normalizePhone(entity.phone) !== null &&
    entity.phoneSource !== "EDGAR-Phone" &&
    entity.phoneSource !== "CompaniesHouse-Phone";

  return hasPersonalEmail || hasPersonalPhone;
}

// ── J0 Measurement Contract ───────────────────────────────────────────────────

/**
 * Outcome labels for each enriched entity (J0).
 *
 * Only direct_contact_candidate and direct_contact_verified are terminal
 * enrichment states (J1). All other outcomes keep the entity eligible for
 * follow-up passes.
 */
export type ContactOutcome =
  | "none"                      // not enriched / no evidence found
  | "evidence_only"             // website, address, filing, or org record only
  | "social_only"               // LinkedIn/Twitter/Instagram/Telegram, no email/phone
  | "organization_contact"      // company phone/inbox/contact-page (not personal)
  | "direct_contact_candidate"  // person-level email or phone (public evidence)
  | "direct_contact_verified";  // validated person-level contact with attribution

/** True only for outcomes that represent a person-level direct route. */
export function isPersonalContactOutcome(outcome: ContactOutcome): boolean {
  return outcome === "direct_contact_candidate" || outcome === "direct_contact_verified";
}

/**
 * Determine the contact outcome for an entity based on its current fields.
 *
 * Used by every enricher to set the contactOutcome column after a pass,
 * and by the backfill endpoint to classify existing records (J0).
 *
 * J1 rule: social_only and evidence_only are NOT terminal — they must remain
 * eligible for direct-contact follow-up passes.
 *
 * L1 additions:
 *   - phoneSource: "EDGAR-Phone" or "CompaniesHouse-Phone" → organisation_contact
 *     (these are fund switchboards and company main lines, not personal numbers)
 *   - isGenericPrefix / email local-part check → organisation_contact
 *     (info@, sales@, contact@ etc. are shared inboxes)
 *   - smtpVerified / validatedDirectContact → direct_contact_verified
 */
export function computeContactOutcome(entity: {
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  twitterHandle?: string | null;
  instagramHandle?: string | null;
  telegramHandle?: string | null;
  website?: string | null;        // from metadata["website"]
  bizLocation?: string | null;    // from metadata["bizLocation"]
  validatedDirectContact?: boolean;
  // L1: source metadata for organisational contact detection
  emailSource?: string | null;
  phoneSource?: string | null;
  isGenericPrefix?: boolean;      // explicit flag from enricher (K2)
}): ContactOutcome {
  const emailStr = entity.email?.trim() ?? "";
  const phoneStr = entity.phone?.trim() ?? "";

  // Verified personal contact — highest priority
  if (entity.validatedDirectContact && (emailStr || phoneStr)) {
    return "direct_contact_verified";
  }

  if (emailStr || phoneStr) {
    // L1: organisational email detection
    // Check explicit flag first (set by K2 enricher), then fall back to pattern check
    // on the stored email value (handles existing DB records in the backfill path).
    const emailLocal = emailStr ? (emailStr.split("@")[0] ?? "") : "";
    const isGenericEmail =
      entity.isGenericPrefix === true ||
      (emailStr ? isGenericEmailPrefix(emailLocal) : false);

    // L1: organisational phone detection
    // EDGAR phones are SEC-filer switchboards; CH phones are company main lines.
    const isOrgPhone =
      entity.phoneSource === "EDGAR-Phone" ||
      entity.phoneSource === "CompaniesHouse-Phone";

    // If the only contact vector is an org phone (no email at all) → org_contact
    if (isOrgPhone && !emailStr) return "organization_contact";

    // Generic email → org_contact regardless of whether a phone also exists
    if (isGenericEmail) return "organization_contact";

    // Personal email/phone (or unknown source without generic prefix)
    return "direct_contact_candidate";
  }

  // Social presence — valuable but not terminal (J1)
  if (
    entity.linkedinUrl?.trim() ||
    entity.twitterHandle?.trim() ||
    entity.instagramHandle?.trim() ||
    entity.telegramHandle?.trim()
  ) return "social_only";

  // Evidence (website, registered address) — useful for follow-up but not contactable
  if (entity.website?.trim() || entity.bizLocation?.trim()) return "evidence_only";

  return "none";
}
