/**
 * Bayesian Investor Score Engine
 *
 * Implements a Bayesian inference update rule to dynamically score
 * the probability that a target entity is a viable HNWI investor:
 *
 *   P(Investor | Evidence) ∝ P(Evidence | Investor) × P(Investor)
 *
 * We model this incrementally: each signal contributes a likelihood
 * ratio that updates the running log-odds.
 */

export interface ScoringSignal {
  name: string;
  value: number; // raw signal value
  weight: number; // evidence weight [0..1]
  likelihood: number; // P(signal | HNWI investor) / P(signal | non-investor)
}

export interface EntityScoringInput {
  entityType: string;
  assetCount: number;
  assetCategories: string[];
  totalAssetValue: number;
  hasRecentActivity: boolean; // activity in last 6 months
  recentActivityDays: number; // days since last activity
  networkDegree: number; // how many connections this entity has
  hasGatekeeperConnection: boolean;
  hasKnownInvestorConnection: boolean;
  hasShellCompany: boolean;
  hasAviationAsset: boolean;
  hasMarineAsset: boolean;
  hasClubMembership: boolean;
  hasLuxuryRealEstate: boolean;
  jurisdictionCount: number; // number of different jurisdictions
  contactConfidence?: number; // 0–100: how reachable is the target via direct contact vectors
}

function logit(p: number): number {
  const clamped = Math.max(0.001, Math.min(0.999, p));
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute the Bayesian posterior probability for a given entity
 * being a viable HNWI investor.
 *
 * @param prior - Prior probability (default: 0.05 per spec)
 * @param input - Evidence signals from entity data
 * @returns Updated posterior probability in [0, 1]
 */
export function computeBayesianScore(
  prior: number,
  input: EntityScoringInput,
): number {
  // Start in log-odds space
  let logOdds = logit(prior);

  const signals = buildSignals(input);

  for (const signal of signals) {
    // Bayesian update: add log-likelihood ratio weighted by evidence strength
    const llr = signal.weight * Math.log(signal.likelihood);
    logOdds += llr;
  }

  // Clamp log-odds to prevent extreme values
  logOdds = Math.max(-10, Math.min(10, logOdds));

  return parseFloat(sigmoid(logOdds).toFixed(4));
}

function buildSignals(input: EntityScoringInput): ScoringSignal[] {
  const signals: ScoringSignal[] = [];

  // ── Entity type prior adjustment ──────────────────────────────────
  if (input.entityType === "HNWI") {
    signals.push({ name: "entity_type_hnwi", value: 1, weight: 0.9, likelihood: 5.0 });
  } else if (input.entityType === "Corporation") {
    signals.push({ name: "entity_type_corp", value: 1, weight: 0.6, likelihood: 2.5 });
  } else if (input.entityType === "Trust") {
    signals.push({ name: "entity_type_trust", value: 1, weight: 0.7, likelihood: 3.5 });
  } else if (input.entityType === "Gatekeeper") {
    signals.push({ name: "entity_type_gatekeeper", value: 1, weight: 0.3, likelihood: 1.2 });
  }

  // ── Asset signals ─────────────────────────────────────────────────
  // Asset count: each additional asset is evidence
  if (input.assetCount > 0) {
    const assetLR = Math.min(1 + input.assetCount * 0.6, 4.0);
    signals.push({ name: "asset_count", value: input.assetCount, weight: 0.8, likelihood: assetLR });
  }

  // Total asset value
  if (input.totalAssetValue > 0) {
    let valueLR = 1.0;
    if (input.totalAssetValue > 50_000_000) valueLR = 4.5;
    else if (input.totalAssetValue > 10_000_000) valueLR = 3.0;
    else if (input.totalAssetValue > 1_000_000) valueLR = 2.0;
    else if (input.totalAssetValue > 250_000) valueLR = 1.5;
    signals.push({ name: "total_asset_value", value: input.totalAssetValue, weight: 0.85, likelihood: valueLR });
  }

  // Asset diversity (multiple categories → shell structure → wealth signal)
  if (input.assetCategories.length >= 3) {
    signals.push({ name: "asset_diversity", value: input.assetCategories.length, weight: 0.7, likelihood: 3.2 });
  } else if (input.assetCategories.length === 2) {
    signals.push({ name: "asset_diversity", value: input.assetCategories.length, weight: 0.5, likelihood: 2.0 });
  }

  // ── Luxury asset class signals ─────────────────────────────────────
  if (input.hasAviationAsset) {
    // Private jet ownership is extremely strong HNWI signal
    signals.push({ name: "aviation_asset", value: 1, weight: 0.95, likelihood: 6.5 });
  }

  if (input.hasMarineAsset) {
    // Yacht ownership
    signals.push({ name: "marine_asset", value: 1, weight: 0.85, likelihood: 5.0 });
  }

  if (input.hasLuxuryRealEstate) {
    signals.push({ name: "luxury_real_estate", value: 1, weight: 0.75, likelihood: 3.8 });
  }

  if (input.hasClubMembership) {
    // Private club (Riva del Garda Ferrari club, gentleman clubs, hunting clubs)
    signals.push({ name: "club_membership", value: 1, weight: 0.65, likelihood: 3.0 });
  }

  // ── Corporate structure signals ────────────────────────────────────
  if (input.hasShellCompany) {
    // Shell company structure → deliberate asset concealment → wealth signal
    signals.push({ name: "shell_company", value: 1, weight: 0.7, likelihood: 4.0 });
  }

  if (input.jurisdictionCount >= 3) {
    // Multi-jurisdiction footprint → sophisticated wealth management
    signals.push({ name: "multi_jurisdiction", value: input.jurisdictionCount, weight: 0.75, likelihood: 3.5 });
  } else if (input.jurisdictionCount === 2) {
    signals.push({ name: "multi_jurisdiction", value: input.jurisdictionCount, weight: 0.5, likelihood: 2.0 });
  }

  // ── Network signals ────────────────────────────────────────────────
  if (input.networkDegree >= 5) {
    signals.push({ name: "network_degree", value: input.networkDegree, weight: 0.6, likelihood: 2.5 });
  } else if (input.networkDegree >= 2) {
    signals.push({ name: "network_degree", value: input.networkDegree, weight: 0.4, likelihood: 1.8 });
  }

  if (input.hasGatekeeperConnection) {
    // Having an identified gatekeeper in network makes them reachable
    signals.push({ name: "gatekeeper_connection", value: 1, weight: 0.5, likelihood: 2.0 });
  }

  if (input.hasKnownInvestorConnection) {
    // "Birds of a feather" — knowing confirmed investors raises probability
    signals.push({ name: "known_investor_connection", value: 1, weight: 0.8, likelihood: 4.5 });
  }

  // ── Activity signals ──────────────────────────────────────────────
  if (input.hasRecentActivity) {
    const activityLR = input.recentActivityDays < 30 ? 2.5 : input.recentActivityDays < 90 ? 1.8 : 1.3;
    signals.push({ name: "recent_activity", value: input.recentActivityDays, weight: 0.6, likelihood: activityLR });
  }

  // ── Contact reachability signal ────────────────────────────────────
  // A confirmed direct contact vector (email/phone/LinkedIn) is strong
  // evidence of a real HNWI, not a ghost company or stale record.
  // Weights tuned so that an HNWI with a single phone/email (confidence ~25-38)
  // clears the 0.5 priority-leads threshold after HNWI type + recent-activity signals.
  if (input.contactConfidence != null && input.contactConfidence > 0) {
    if (input.contactConfidence >= 70) {
      // High-confidence: multiple verified vectors (email + phone, or LinkedIn + phone)
      signals.push({ name: "contact_high", value: input.contactConfidence, weight: 0.9, likelihood: 6.0 });
    } else if (input.contactConfidence >= 30) {
      // Partial: single confirmed vector (phone OR email found)
      signals.push({ name: "contact_partial", value: input.contactConfidence, weight: 0.8, likelihood: 3.5 });
    } else if (input.contactConfidence >= 10) {
      // Weak: social-only signal (LinkedIn/Twitter discovered, no direct contact)
      signals.push({ name: "contact_weak", value: input.contactConfidence, weight: 0.4, likelihood: 1.8 });
    }
  }

  return signals;
}

/**
 * Convert a probability score to a 0-100 integer rank.
 */
export function scoreToRank(score: number): number {
  return Math.round(score * 100);
}

/**
 * Classify the investor score into a tier label.
 */
export function scoreTier(score: number): "APEX" | "HIGH" | "MEDIUM" | "LOW" | "COLD" {
  if (score >= 0.85) return "APEX";
  if (score >= 0.65) return "HIGH";
  if (score >= 0.45) return "MEDIUM";
  if (score >= 0.25) return "LOW";
  return "COLD";
}
