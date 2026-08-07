/**
 * Access Score is deliberately separate from the wealth / HNWI signal score.
 *
 * It answers: "How realistically can a researcher reach this person through
 * public information?" A strong wealth signal without a contact vector must
 * never produce a strong Access Score.
 */
export type AccessScoreEntity = {
  type?: string | null;
  contactConfidence?: number | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  twitterHandle?: string | null;
  instagramHandle?: string | null;
  telegramHandle?: string | null;
  personalWebsite?: string | null;
  contactMethod?: string | null;
};

const DIRECT_METHODS = ["email", "phone", "whatsapp", "signal", "telegram"];
const INTERMEDIARY_METHODS = ["family office", "gatekeeper", "assistant", "intermediary", "office"];

export function computeAccessScore(entity: AccessScoreEntity): number {
  // Access is a personal reachability metric. Company/trust switchboards,
  // registered phones, and structure websites must not appear as personal
  // routes in the ledger or dashboard.
  if (entity.type === "Corporation" || entity.type === "Corp" || entity.type === "Trust") {
    return 0;
  }

  const channels =
    (entity.email ? 0.32 : 0) +
    (entity.phone ? 0.28 : 0) +
    (entity.linkedinUrl ? 0.12 : 0) +
    (entity.telegramHandle ? 0.06 : 0) +
    (entity.twitterHandle ? 0.05 : 0) +
    (entity.instagramHandle ? 0.04 : 0) +
    (entity.personalWebsite ? 0.03 : 0);

  const method = entity.contactMethod?.trim().toLowerCase() ?? "";
  const hasDirectMethod = DIRECT_METHODS.some((value) => method.includes(value));
  const hasIntermediaryMethod = INTERMEDIARY_METHODS.some((value) => method.includes(value));
  const methodEvidence = hasDirectMethod ? 0.08 : hasIntermediaryMethod ? 0.03 : 0;
  const evidence = Math.min(1, channels + methodEvidence);

  // contactConfidence amplifies existing contact evidence — it must NOT manufacture
  // a score when there is no actual contact data at all.
  const hasAnyContact = channels > 0 || hasDirectMethod || hasIntermediaryMethod;
  const confidence = hasAnyContact
    ? Math.max(0, Math.min(100, entity.contactConfidence ?? 0)) / 100
    : 0;

  const directness = hasDirectMethod || entity.email || entity.phone
    ? 1
    : hasIntermediaryMethod
      ? 0.35
      : entity.linkedinUrl || entity.telegramHandle
        ? 0.65
        : 0;

  return Math.round(Math.min(1, evidence * 0.55 + confidence * 0.25 + directness * 0.2) * 100) / 100;
}