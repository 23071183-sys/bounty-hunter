import type { Bounty, Profile, ScoreBreakdown } from "./types.js";

/** Diminishing-returns reward curve: 0 at $0, ~0.5 at $300, ~0.8 at $1k, ->1. */
function rewardScore(usd: number | null): number {
  if (!usd || usd <= 0) return 0;
  return 1 - Math.exp(-usd / 600);
}

/** Fraction of bounty skills covered by the profile, with a small breadth bonus. */
function skillFitScore(
  bountySkills: string[],
  profileSkills: Set<string>,
): { score: number; matched: string[] } {
  if (bountySkills.length === 0) return { score: 0.3, matched: [] };
  const matched = bountySkills.filter((s) => profileSkills.has(s));
  const coverage = matched.length / bountySkills.length;
  // Reward having at least a couple of solid matches even on broad bounties.
  const breadth = Math.min(matched.length, 3) / 3;
  return { score: 0.6 * coverage + 0.4 * breadth, matched };
}

/** Heuristic: short, concrete, single-deliverable tasks are more feasible. */
function feasibilityScore(b: Bounty, avoidHits: string[]): number {
  let score = 0.6;
  const len = b.description.length;
  if (len > 0 && len < 1200) score += 0.2; // tightly scoped
  if (len > 4000) score -= 0.2; // sprawling / vague
  if (/\b(docs|documentation|component|widget|landing|bug ?fix|integrat)/i.test(
    `${b.title} ${b.description}`,
  )) {
    score += 0.15;
  }
  if (avoidHits.length > 0) score -= 0.4 * Math.min(avoidHits.length, 2);
  return Math.max(0, Math.min(1, score));
}

/** Sooner-but-not-impossible deadlines score highest; none = neutral. */
function deadlineScore(deadline: string | null): number {
  if (!deadline) return 0.5;
  const days = (new Date(deadline).getTime() - Date.now()) / 864e5;
  if (Number.isNaN(days)) return 0.5;
  if (days < 0) return 0; // expired
  if (days < 2) return 0.25; // too tight to build well
  if (days <= 21) return 1; // sweet spot
  if (days <= 60) return 0.7;
  return 0.5; // far off
}

export interface Scored {
  score: number;
  breakdown: ScoreBreakdown;
}

export function scoreBounty(b: Bounty, profile: Profile): Scored {
  const profileSkills = new Set(profile.skills.map((s) => s.toLowerCase()));
  const avoidSet = new Set(profile.avoid.map((s) => s.toLowerCase()));

  const avoidHits = b.skills.filter((s) => avoidSet.has(s));
  const reward = rewardScore(b.rewardUsd);
  const { score: skillFit, matched } = skillFitScore(b.skills, profileSkills);
  const feasibility = feasibilityScore(b, avoidHits);
  const deadline = deadlineScore(b.deadline);

  const w = profile.weights;
  let score =
    w.reward * reward +
    w.skillFit * skillFit +
    w.feasibility * feasibility +
    w.deadline * deadline;

  // Hard penalty: below minimum reward (but not unknown reward).
  if (b.rewardUsd != null && b.rewardUsd < profile.minRewardUsd) score *= 0.3;

  // Contention penalty: an already-claimed bounty is near-unwinnable; each prior
  // attempt sharply lowers the odds. This is the strongest real-world predictor.
  if (b.claimed) score *= 0.1;
  else if (b.attempts && b.attempts > 0) score *= 1 / (1 + 0.5 * b.attempts);

  const breakdown: ScoreBreakdown = {
    reward: round(reward),
    skillFit: round(skillFit),
    feasibility: round(feasibility),
    deadline: round(deadline),
    matchedSkills: matched,
    avoidHits,
  };
  return { score: round(score * 100), breakdown };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
