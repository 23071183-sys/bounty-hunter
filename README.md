# Bounty Hunter 🎯

A **human-in-the-loop** Web3 bounty cockpit. It automates the parts that *can* be
automated — discovering and scoring bounties, scaffolding the project, drafting
the submission — and keeps you in control of the two steps that legally and
practically require a human: **submitting** the work and **getting paid**.

> ⚠️ This is deliberately **not** an auto-submit bot. Mass AI submissions get
> accounts banned on every platform and rejected by maintainers. Payouts require
> you to claim the bounty under your own account. Claude never touches private
> keys or moves funds — your wallet address is stored only to pre-fill
> submission drafts.

## Flow

```
discover ──▶ score ──▶ list/show ──▶ you shortlist ──▶ build ──▶ you submit ──▶ you get paid
 (auto)     (auto)      (auto)         (human)        (Claude)    (human)        (human)
```

## Setup

```bash
cd ~/bounty-hunter
npm install
cp .env.example .env     # then edit: PAYOUT_WALLET, GITHUB_USER
```

Edit `config/profile.json` to tune your skills, preferred chains, min reward, and
scoring weights — this drives the ranking.

## Usage

```bash
# Try the whole pipeline offline with fixtures:
npm run bounty -- discover --demo
npm run bounty -- list
npm run bounty -- show dework:demo-1

# Live discovery (best-effort across platforms):
npm run bounty -- discover
npm run bounty -- discover --only dework,gitcoin

# Triage:
npm run bounty -- shortlist <id>
npm run bounty -- ignore <id>
npm run bounty -- state <id> submitted

# Scaffold a project for a bounty (add --push to create a private GitHub repo):
npm run bounty -- build dework:demo-1
npm run bounty -- build dework:demo-1 --push

npm run bounty -- status
```

## Freshness monitor (the only real edge)

Every legit bounty is picked-over within minutes of posting — by the time it's
searchable, others have already `/attempt`ed it or opened a PR. The cockpit
detects this contention (from the same comments it reads for the reward) and
**scores contested bounties down**. The one winnable strategy is to be *first*:

```bash
# One-shot: discover + show only brand-new, uncontested, in-stack, non-trap bounties
npm run monitor

# The actionable shortlist any time:
npm run bounty -- fresh          # safe + uncontested + in your stack
npm run bounty -- fresh --new    # only ones first seen in the latest run
```

Schedule it so you catch fresh bounties early. Example cron (every 20 min):

```cron
*/20 * * * * cd ~/bounty-hunter && /usr/bin/env npm run monitor >> ~/bounty-hunter/data/monitor.log 2>&1
```

Then skim `data/monitor.log` (or run `fresh`) and act fast on anything that
appears. Realistic expectation: occasional $50–$300 wins, not steady income.

## Platforms

| Platform   | Source                                   | Reliability |
|------------|------------------------------------------|-------------|
| Dework     | public GraphQL API                       | best-effort |
| Gitcoin    | Grants Stack indexer (rounds, not classic bounties) | best-effort |
| DoraHacks  | public hackathon REST API                | best-effort |
| Layer3     | quests endpoint (bot-protected)          | stub        |

Each adapter fails soft: if one platform's API is down or changed shape, it logs
a warning and returns nothing rather than breaking the run. Web APIs here change
often — when an adapter goes quiet, its mapping in `src/platforms/<name>.ts`
needs a refresh.

**Highest-ROI adapter to add next:** GitHub issues labeled `bounty` (most
Dework/Gitcoin tasks ultimately resolve to a GitHub issue, and the GitHub search
API is stable + already authenticated via `gh`).

## Architecture

- `src/platforms/*` — one adapter per platform → normalized `Bounty`
- `src/scoring.ts` — reward × skill-fit × feasibility × deadline → 0–100 score
- `src/db.ts` — SQLite store with local lifecycle state per bounty
- `src/build.ts` — scaffolds `projects/<slug>/` with BRIEF + SUBMISSION draft
- `src/cli.ts` — command surface

## Honest limitations

- Live adapters depend on undocumented/changing APIs; expect to maintain them.
- Scoring is heuristic, not ML — tune weights in `profile.json`.
- Winning bounties still needs real, quality work and sometimes maintainer
  back-and-forth. This tool removes the busywork, not the craft.
