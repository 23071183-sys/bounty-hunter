import type { Bounty, JudgeResult, QualityTier } from "./types.js";

// Automated bounty judge: decides whether a bounty is worth building, by
// "comparing to others of the same type" — repo reputation, payout credibility,
// activity, scope clarity, reward-vs-typical, and contention. Produces a tier
// (strong/fair/weak/avoid) + human-readable reasons so the decision is auditable.

export interface JudgeContext {
  /** Median known reward across the current feed, for reward-vs-typical. */
  medianRewardUsd: number;
}

const clarityRe =
  /acceptance criteria|- \[ \]|## *requirements|steps to (solve|reproduce)|expected behavior/i;

export function judgeBounty(b: Bounty & { riskFlags?: string[] }, ctx: JudgeContext): JudgeResult {
  const reasons: string[] = [];

  // Hard avoid: safety flags trump everything.
  if (b.riskFlags && b.riskFlags.length) {
    return { tier: "avoid", score: 0, reasons: [`safety flags: ${b.riskFlags.join(", ")}`] };
  }

  let score = 0.5;

  // Fork/mirror repos surface stale or upstream-owned bounties.
  if (b.repoFork) {
    score -= 0.4;
    reasons.push("fork/mirror repo — bounty likely stale or owned upstream");
  }

  // Contention is the strongest negative predictor. attempts < 0 = UNKNOWN
  // (couldn't read comments) — must NOT be treated as uncontested.
  const attempts = b.attempts ?? 0;
  if (b.claimed) {
    score -= 0.4;
    reasons.push("already claimed / PR open — near-unwinnable");
  } else if (attempts < 0) {
    score -= 0.1;
    reasons.push("contention unverified (couldn't read comments) — recheck before building");
  } else if (attempts === 0) {
    score += 0.12;
    reasons.push("uncontested");
  } else if (attempts > 2) {
    score -= 0.12;
    reasons.push(`${attempts} prior attempts`);
  } else {
    reasons.push(`${attempts} prior attempt${attempts > 1 ? "s" : ""}`);
  }

  // Payer reputation via repo stars. Near-zero stars on a paid bounty is a
  // strong fake/unfunded signal — penalize hard so it can't reach auto-submit.
  const stars = b.repoStars ?? 0;
  if (stars >= 1000) {
    score += 0.25;
    reasons.push(`reputable repo (${stars.toLocaleString()}★)`);
  } else if (stars >= 100) {
    score += 0.12;
    reasons.push(`established repo (${stars}★)`);
  } else if (stars < 5) {
    score -= 0.3;
    reasons.push(`near-zero stars (${stars}★) — payer unproven / likely unfunded`);
  } else if (stars < 25) {
    score -= 0.15;
    reasons.push(`obscure repo (${stars}★) — payer unproven`);
  }

  // Activity.
  if (b.repoPushedAt) {
    const days = (Date.now() - new Date(b.repoPushedAt).getTime()) / 864e5;
    if (!Number.isNaN(days)) {
      if (days < 30) {
        score += 0.08;
        reasons.push("actively maintained");
      } else if (days > 365) {
        score -= 0.15;
        reasons.push("repo inactive >1y");
      }
    }
  }

  // Reward known + comparison to the feed's typical reward.
  if (b.rewardUsd != null) {
    score += 0.08;
    if (ctx.medianRewardUsd > 0) {
      if (b.rewardUsd >= ctx.medianRewardUsd * 1.5) {
        score += 0.08;
        reasons.push("reward above typical for similar bounties");
      } else if (b.rewardUsd < ctx.medianRewardUsd * 0.5) {
        score -= 0.05;
        reasons.push("reward below typical for similar bounties");
      }
    }
  } else {
    score -= 0.08;
    reasons.push("reward amount unknown");
  }

  // Scope clarity.
  if (clarityRe.test(b.description)) {
    score += 0.1;
    reasons.push("clear acceptance criteria / repro");
  } else {
    score -= 0.05;
    reasons.push("vague scope");
  }

  score = Math.max(0, Math.min(1, score));
  const tier: QualityTier =
    score >= 0.7 ? "strong" : score >= 0.5 ? "fair" : score >= 0.3 ? "weak" : "avoid";
  return { tier, score: Math.round(score * 100) / 100, reasons };
}

/** Median of known USD rewards in a batch (0 if none known). */
export function medianReward(bounties: Bounty[]): number {
  const vals = bounties
    .map((b) => b.rewardUsd)
    .filter((v): v is number => v != null && v > 0)
    .sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}
