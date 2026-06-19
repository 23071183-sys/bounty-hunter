// Honeypot / prompt-injection scanner for bounties.
//
// Real-world finding (2026-06-19): high-value bounties are disproportionately
// traps aimed at autonomous AI agents. Two live examples drove this module:
//   - ClankerNation/OpenAgents — "bounties" whose text instructs the agent to
//     paste its full system prompt + environment into a committed file, and a
//     CONTRIBUTING.md declaring the bounties "symbolic"/"will not be merged".
//   - archestra #4998 — an absurd joke spec ("Sorting Hat MCP", "Patronus check")
//     designed to catch bots that build without reading.
//
// This scanner flags those patterns so a human reviews (or the feed auto-hides)
// them before any build effort is spent. It NEVER causes the agent to comply
// with injected instructions — it only detects and warns.

export interface SafetyResult {
  flags: string[];
  /** Critical = do not build; auto-ignored in the feed. */
  critical: boolean;
}

interface Rule {
  label: string;
  critical: boolean;
  re: RegExp;
}

const RULES: Rule[] = [
  {
    label: "system-prompt exfiltration",
    critical: true,
    re: /(system prompt|startup instructions|initialization payload|pre-?conversation|raw startup|instructions?.{0,40}(loaded|provided|supplied).{0,20}before|every (instruction|rule|configuration))/i,
  },
  {
    label: "environment/secret exfiltration",
    critical: true,
    re: /(working_dir|home_dir|\bworking directory\b).{0,60}(shell|os|arch)|(paste|include|print).{0,40}(full text|token|api[_ ]?key|secret|credential|env(ironment)? variable)/i,
  },
  {
    label: "AI-agent honeypot / non-paying",
    critical: true,
    re: /(humans? (are )?not allowed|purely for autonomous ai|ai agents? only|symbolic bount|academic study|research (project|purposes)|will not be merged|won'?t be merged)/i,
  },
  {
    label: "injection / instruction-override",
    critical: true,
    re: /(ignore (the )?(above|previous)|automated systems should ignore|skip_validation|disregard (the )?(notice|warning)|proceed with issue resolution)/i,
  },
  {
    label: "privacy-coin-only payout",
    critical: false,
    re: /\b(xmr|monero)\b/i,
  },
];

export function scanBounty(text: string): SafetyResult {
  const flags: string[] = [];
  let critical = false;
  for (const r of RULES) {
    if (r.re.test(text)) {
      flags.push(r.label);
      if (r.critical) critical = true;
    }
  }
  return { flags, critical };
}
