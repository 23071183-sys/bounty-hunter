// Shared types for the bounty cockpit.

export type PlatformName = "github" | "dework" | "gitcoin" | "dorahacks" | "layer3";

export type BountyStatus = "open" | "claimed" | "closed" | "unknown";

/** Normalized bounty shape every platform adapter must produce. */
export interface Bounty {
  /** Stable id: `${platform}:${nativeId}`. */
  id: string;
  platform: PlatformName;
  nativeId: string;
  title: string;
  description: string;
  url: string;

  rewardAmount: number | null;
  rewardCurrency: string | null;
  /** Best-effort USD value of the reward (may be estimated). */
  rewardUsd: number | null;

  tags: string[];
  /** Lowercased skill/tech keywords inferred from tags + text. */
  skills: string[];

  /** ISO date string or null. */
  deadline: string | null;
  status: BountyStatus;
  /** ISO date string when the bounty was created/seen upstream. */
  createdAt: string | null;

  /** Raw upstream payload for debugging / future fields. */
  raw: unknown;

  /** Risk flags detected by the adapter itself (e.g. honeypot CONTRIBUTING.md). */
  sourceFlags?: string[];

  /** Contention: how many others have already attempted this. -1 = unknown (fetch failed). */
  attempts?: number;
  /** Whether someone has already claimed it / opened a PR. */
  claimed?: boolean;

  /** Repo credibility signals (transient, set by adapter; used by the judge). */
  repoStars?: number;
  repoFork?: boolean;
  repoPushedAt?: string | null;
}

export type QualityTier = "strong" | "fair" | "weak" | "avoid";

/** Output of the automated bounty judge. */
export interface JudgeResult {
  tier: QualityTier;
  /** 0..1 credibility/quality score. */
  score: number;
  reasons: string[];
}

/** A bounty plus its computed score. */
export interface ScoredBounty extends Bounty {
  score: number;
  scoreBreakdown: ScoreBreakdown;
  /** Honeypot/prompt-injection flags from the safety scanner. */
  riskFlags: string[];
  /** Automated quality/credibility verdict. */
  quality: JudgeResult;
  /** Local lifecycle state the user drives. */
  state: LocalState;
  firstSeen: string;
  lastSeen: string;
}

export type LocalState =
  | "new"
  | "shortlisted"
  | "building"
  | "submitted"
  | "won"
  | "rejected"
  | "ignored";

export interface ScoreBreakdown {
  reward: number;
  skillFit: number;
  feasibility: number;
  deadline: number;
  /** skills from the bounty that match the profile. */
  matchedSkills: string[];
  /** skills/keywords that the profile says to avoid. */
  avoidHits: string[];
}

export interface Profile {
  skills: string[];
  preferredChains: string[];
  minRewardUsd: number;
  maxConcurrentBuilds: number;
  avoid: string[];
  weights: {
    reward: number;
    skillFit: number;
    feasibility: number;
    deadline: number;
  };
}
