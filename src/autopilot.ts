import type { AutopilotConfig, QualityTier, ScoredBounty } from "./types.js";

// Hands-off auto-submit gate. A bounty is only auto-submitted when EVERY enabled
// precondition holds. This is the single safety boundary between "agent built a
// PR" and "PR goes live on a stranger's repo under your identity" — designed so
// honeypots, contested races, unproven payers, and broken builds can never slip
// through automatically. Every check is auditable via `precheck`.

export const DEFAULT_AUTOPILOT: AutopilotConfig = {
  allowAutoSubmit: false,
  minRewardUsd: 100,
  requireEscrowed: true,
  requireUncontested: true,
  requireTestsGreen: true,
  blockIfRiskFlags: true,
  minQualityTier: "fair",
};

const TIER_RANK: Record<QualityTier, number> = { avoid: 0, weak: 1, fair: 2, strong: 3 };

export interface GateCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface GateResult {
  pass: boolean;
  checks: GateCheck[];
}

export interface GateInput {
  /** Did the build's test suite pass? Unknown/false blocks when required. */
  testsGreen?: boolean;
}

export function evaluateGate(
  b: ScoredBounty,
  input: GateInput,
  cfg: AutopilotConfig,
): GateResult {
  const checks: GateCheck[] = [];
  const add = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });

  add(
    "auto-submit enabled",
    cfg.allowAutoSubmit,
    cfg.allowAutoSubmit ? "allowAutoSubmit=true" : "allowAutoSubmit=false — draft + manual only",
  );

  if (cfg.blockIfRiskFlags) {
    add(
      "no safety flags",
      b.riskFlags.length === 0,
      b.riskFlags.length ? `flagged: ${b.riskFlags.join(", ")}` : "clean",
    );
  }

  add(
    `quality ≥ ${cfg.minQualityTier}`,
    TIER_RANK[b.quality.tier] >= TIER_RANK[cfg.minQualityTier],
    `verdict: ${b.quality.tier}`,
  );

  if (cfg.requireEscrowed) {
    add("reward escrowed/known", b.rewardUsd != null, b.rewardUsd != null ? `~$${b.rewardUsd}` : "unknown amount");
  }

  add(
    `reward ≥ $${cfg.minRewardUsd}`,
    b.rewardUsd != null && b.rewardUsd >= cfg.minRewardUsd,
    b.rewardUsd != null ? `~$${b.rewardUsd}` : "unknown amount",
  );

  if (cfg.requireUncontested) {
    const attempts = b.attempts ?? 0;
    const ok = !b.claimed && attempts === 0;
    const detail = b.claimed
      ? "already claimed/PR up"
      : attempts < 0
        ? "contention UNKNOWN (fetch failed)"
        : attempts === 0
          ? "uncontested"
          : `${attempts} prior attempts`;
    add("uncontested", ok, detail);
  }

  if (cfg.requireTestsGreen) {
    add("tests green", input.testsGreen === true, input.testsGreen === true ? "passing" : "not verified passing");
  }

  return { pass: checks.every((c) => c.ok), checks };
}

export function resolveAutopilot(cfg: AutopilotConfig | undefined): AutopilotConfig {
  return { ...DEFAULT_AUTOPILOT, ...(cfg ?? {}) };
}
