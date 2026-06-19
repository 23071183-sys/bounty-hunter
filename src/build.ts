import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadEnv } from "./config.js";
import type { ScoredBounty } from "./types.js";

const PROJECTS_DIR = join(ROOT, "projects");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function sh(cmd: string, args: string[], cwd: string): void {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

export interface BuildOptions {
  push: boolean;
}

/**
 * Scaffold a working folder for a bounty: a build brief (BRIEF.md), a
 * pre-filled submission draft (SUBMISSION.md with payout wallet), and a git
 * repo. Optionally create + push a GitHub repo with `--push`.
 *
 * This is the hand-off point: Claude then implements the actual deliverable in
 * this folder, and the human reviews + submits. We never auto-submit.
 */
export async function buildProject(b: ScoredBounty, opts: BuildOptions): Promise<boolean> {
  if (b.riskFlags.length) {
    console.error(`\n🚨 REFUSING to build ${b.id}`);
    console.error(`   Safety flags: ${b.riskFlags.join(", ")}`);
    console.error("   This bounty looks like a honeypot / prompt-injection trap. Building it would waste");
    console.error("   effort or attempt to exfiltrate secrets. Override only if you've manually verified it's");
    console.error("   legitimate: `state " + b.id + " new` won't clear flags — edit src/safety.ts if it's a false positive.");
    return false;
  }

  const env = loadEnv();
  const slug = `${b.platform}-${slugify(b.title)}`;
  const dir = join(PROJECTS_DIR, slug);

  if (existsSync(dir)) {
    console.log(`Project folder already exists: ${dir}`);
    return false;
  }
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "BRIEF.md"), brief(b));
  writeFileSync(join(dir, "SUBMISSION.md"), submission(b, env.payoutWallet, env.payoutWalletChain, env.githubUser));
  writeFileSync(
    join(dir, "README.md"),
    `# ${b.title}\n\nProject built to fulfill a ${b.platform} bounty.\nSee [BRIEF.md](./BRIEF.md) for scope and [SUBMISSION.md](./SUBMISSION.md) for the submission draft.\n`,
  );
  writeFileSync(join(dir, ".gitignore"), "node_modules/\ndist/\n.env\n");

  try {
    sh("git", ["init", "-q"], dir);
    sh("git", ["add", "."], dir);
    sh("git", ["commit", "-q", "-m", `chore: scaffold bounty project for ${b.platform}:${b.nativeId}`], dir);
  } catch (err) {
    console.error(`git init skipped: ${(err as Error).message}`);
  }

  console.log(`\n✓ Scaffolded ${dir}`);
  console.log("  BRIEF.md       — scope & acceptance criteria");
  console.log("  SUBMISSION.md  — submission draft (payout wallet pre-filled)");

  if (opts.push) {
    try {
      const repoName = slug;
      sh("gh", ["repo", "create", repoName, "--private", "--source", ".", "--remote", "origin", "--push"], dir);
      console.log(`\n✓ Pushed to GitHub: ${env.githubUser}/${repoName} (private)`);
    } catch (err) {
      console.error(`\ngh repo create failed: ${(err as Error).message}`);
      console.error("Create the repo manually or check `gh auth status`.");
    }
  } else {
    console.log("\nAdd --push to create a private GitHub repo for it.");
  }

  console.log("\nNext: implement the deliverable in this folder, then I draft the PR/submission for your review.");
  return true;
}

function brief(b: ScoredBounty): string {
  return `# Build brief — ${b.title}

- **Platform:** ${b.platform}
- **Bounty URL:** ${b.url}
- **Reward:** ${b.rewardAmount ?? "?"} ${b.rewardCurrency ?? ""} (~${b.rewardUsd != null ? `$${b.rewardUsd}` : "unknown"})
- **Deadline:** ${b.deadline ?? "—"}
- **Score:** ${b.score} (reward ${b.scoreBreakdown.reward}, skillFit ${b.scoreBreakdown.skillFit}, feasibility ${b.scoreBreakdown.feasibility}, deadline ${b.scoreBreakdown.deadline})
- **Matched skills:** ${b.scoreBreakdown.matchedSkills.join(", ") || "none"}
${b.scoreBreakdown.avoidHits.length ? `- **⚠ Avoid hits:** ${b.scoreBreakdown.avoidHits.join(", ")}\n` : ""}
## Original description

${b.description}

## Acceptance criteria (fill in from the bounty thread)

- [ ] …

## Plan

1. …

## Open questions for the maintainer

- …
`;
}

function submission(
  b: ScoredBounty,
  wallet: string,
  chain: string,
  githubUser: string,
): string {
  return `# Submission draft — ${b.title}

> Review and edit before submitting. Nothing is sent automatically.

**Bounty:** ${b.url}
**Payout wallet:** \`${wallet || "(set PAYOUT_WALLET in .env)"}\` (${chain})
**GitHub:** ${githubUser ? `https://github.com/${githubUser}` : "(set GITHUB_USER in .env)"}

## What I built

<!-- 2-3 sentences: what it does, how it meets the acceptance criteria. -->

## Links

- Repo / PR: <!-- link -->
- Demo / screenshots: <!-- link -->

## How to verify

1. …

## Notes

- …
`;
}
