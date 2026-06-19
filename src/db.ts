import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config.js";
import type { Bounty, JudgeResult, LocalState, ScoredBounty, ScoreBreakdown } from "./types.js";

const DEFAULT_QUALITY: JudgeResult = { tier: "fair", score: 0.5, reasons: [] };

function parseQuality(raw: string | null): JudgeResult {
  try {
    const q = JSON.parse(raw ?? "{}") as Partial<JudgeResult>;
    return q && q.tier ? (q as JudgeResult) : DEFAULT_QUALITY;
  } catch {
    return DEFAULT_QUALITY;
  }
}

const DATA_DIR = join(ROOT, "data");
mkdirSync(DATA_DIR, { recursive: true });

// Uses Node's built-in SQLite (node:sqlite) — no native build step required.
const db = new DatabaseSync(join(DATA_DIR, "bounties.db"));
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS bounties (
    id            TEXT PRIMARY KEY,
    platform      TEXT NOT NULL,
    native_id     TEXT NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    url           TEXT NOT NULL,
    reward_amount REAL,
    reward_currency TEXT,
    reward_usd    REAL,
    tags          TEXT NOT NULL,
    skills        TEXT NOT NULL,
    deadline      TEXT,
    status        TEXT NOT NULL,
    created_at    TEXT,
    raw           TEXT NOT NULL,
    score         REAL NOT NULL DEFAULT 0,
    score_breakdown TEXT NOT NULL DEFAULT '{}',
    state         TEXT NOT NULL DEFAULT 'new',
    first_seen    TEXT NOT NULL,
    last_seen     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bounties_state ON bounties(state);
  CREATE INDEX IF NOT EXISTS idx_bounties_score ON bounties(score DESC);
`);

// Migrations: add newer columns to pre-existing DBs.
const existingCols = db.prepare("PRAGMA table_info(bounties)").all() as Array<{ name: string }>;
const hasCol = (n: string) => existingCols.some((c) => c.name === n);
if (!hasCol("risk_flags")) db.exec("ALTER TABLE bounties ADD COLUMN risk_flags TEXT NOT NULL DEFAULT '[]'");
if (!hasCol("attempts")) db.exec("ALTER TABLE bounties ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
if (!hasCol("claimed")) db.exec("ALTER TABLE bounties ADD COLUMN claimed INTEGER NOT NULL DEFAULT 0");
if (!hasCol("quality")) db.exec("ALTER TABLE bounties ADD COLUMN quality TEXT NOT NULL DEFAULT '{}'");

interface Row {
  id: string;
  platform: string;
  native_id: string;
  title: string;
  description: string;
  url: string;
  reward_amount: number | null;
  reward_currency: string | null;
  reward_usd: number | null;
  tags: string;
  skills: string;
  deadline: string | null;
  status: string;
  created_at: string | null;
  raw: string;
  score: number;
  score_breakdown: string;
  state: string;
  first_seen: string;
  last_seen: string;
  risk_flags: string;
  attempts: number;
  claimed: number;
  quality: string;
}

function rowToScored(r: Row): ScoredBounty {
  return {
    id: r.id,
    platform: r.platform as ScoredBounty["platform"],
    nativeId: r.native_id,
    title: r.title,
    description: r.description,
    url: r.url,
    rewardAmount: r.reward_amount,
    rewardCurrency: r.reward_currency,
    rewardUsd: r.reward_usd,
    tags: JSON.parse(r.tags),
    skills: JSON.parse(r.skills),
    deadline: r.deadline,
    status: r.status as ScoredBounty["status"],
    createdAt: r.created_at,
    raw: JSON.parse(r.raw),
    score: r.score,
    scoreBreakdown: JSON.parse(r.score_breakdown) as ScoreBreakdown,
    state: r.state as LocalState,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    riskFlags: JSON.parse(r.risk_flags ?? "[]"),
    attempts: r.attempts ?? 0,
    claimed: Boolean(r.claimed),
    quality: parseQuality(r.quality),
  };
}

const upsertStmt = db.prepare(`
  INSERT INTO bounties (
    id, platform, native_id, title, description, url,
    reward_amount, reward_currency, reward_usd, tags, skills,
    deadline, status, created_at, raw, score, score_breakdown,
    state, first_seen, last_seen, risk_flags, attempts, claimed, quality
  ) VALUES (
    @id, @platform, @native_id, @title, @description, @url,
    @reward_amount, @reward_currency, @reward_usd, @tags, @skills,
    @deadline, @status, @created_at, @raw, @score, @score_breakdown,
    'new', @now, @now, @risk_flags, @attempts, @claimed, @quality
  )
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title,
    description=excluded.description,
    url=excluded.url,
    reward_amount=excluded.reward_amount,
    reward_currency=excluded.reward_currency,
    reward_usd=excluded.reward_usd,
    tags=excluded.tags,
    skills=excluded.skills,
    deadline=excluded.deadline,
    status=excluded.status,
    created_at=excluded.created_at,
    raw=excluded.raw,
    score=excluded.score,
    score_breakdown=excluded.score_breakdown,
    last_seen=excluded.last_seen,
    risk_flags=excluded.risk_flags,
    attempts=excluded.attempts,
    claimed=excluded.claimed,
    quality=excluded.quality
`);

export interface UpsertResult {
  inserted: number;
  updated: number;
}

/** Insert new bounties / refresh existing ones. Returns counts. */
export function upsertBounties(
  scored: Array<
    Bounty & { score: number; scoreBreakdown: ScoreBreakdown; riskFlags: string[]; quality: JudgeResult }
  >,
): UpsertResult {
  const boolToInt = (v: boolean | undefined) => (v ? 1 : 0);
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  const existsStmt = db.prepare("SELECT 1 FROM bounties WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const b of scored) {
      const existed = existsStmt.get(b.id);
      upsertStmt.run({
        id: b.id,
        platform: b.platform,
        native_id: b.nativeId,
        title: b.title,
        description: b.description,
        url: b.url,
        reward_amount: b.rewardAmount,
        reward_currency: b.rewardCurrency,
        reward_usd: b.rewardUsd,
        tags: JSON.stringify(b.tags),
        skills: JSON.stringify(b.skills),
        deadline: b.deadline,
        status: b.status,
        created_at: b.createdAt,
        raw: JSON.stringify(b.raw),
        score: b.score,
        score_breakdown: JSON.stringify(b.scoreBreakdown),
        now,
        risk_flags: JSON.stringify(b.riskFlags),
        attempts: b.attempts ?? 0,
        claimed: boolToInt(b.claimed),
        quality: JSON.stringify(b.quality),
      });
      if (existed) updated++;
      else inserted++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { inserted, updated };
}

export interface ListOptions {
  state?: LocalState;
  platform?: string;
  minScore?: number;
  limit?: number;
  /** Only uncontested: no claim/PR and no prior attempts. */
  uncontestedOnly?: boolean;
  /** Only bounties with no safety risk flags. */
  safeOnly?: boolean;
}

export function listBounties(opts: ListOptions = {}): ScoredBounty[] {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  if (opts.state) {
    clauses.push("state = @state");
    params.state = opts.state;
  }
  if (opts.platform) {
    clauses.push("platform = @platform");
    params.platform = opts.platform;
  }
  if (typeof opts.minScore === "number") {
    clauses.push("score >= @minScore");
    params.minScore = opts.minScore;
  }
  if (opts.uncontestedOnly) clauses.push("claimed = 0 AND attempts = 0");
  if (opts.safeOnly) clauses.push("risk_flags = '[]'");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = opts.limit ?? 50;
  const rows = db
    .prepare(`SELECT * FROM bounties ${where} ORDER BY score DESC LIMIT ${limit}`)
    .all(params) as unknown as Row[];
  return rows.map(rowToScored);
}

export function getBounty(id: string): ScoredBounty | null {
  const row = db.prepare("SELECT * FROM bounties WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToScored(row) : null;
}

export function setState(id: string, state: LocalState): boolean {
  const res = db.prepare("UPDATE bounties SET state = ? WHERE id = ?").run(state, id);
  return Number(res.changes) > 0;
}

export function counts(): Record<string, number> {
  const rows = db
    .prepare("SELECT state, COUNT(*) as n FROM bounties GROUP BY state")
    .all() as Array<{ state: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.state] = r.n;
  return out;
}

export default db;
