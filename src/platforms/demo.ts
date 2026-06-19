import type { Bounty } from "../types.js";
import { inferSkills, makeId } from "./types.js";

// Static fixtures so the full discover -> score -> list -> build pipeline can be
// exercised offline, without depending on live (and sometimes flaky) APIs.
// Enabled via `discover --demo`.
const RAW: Array<Omit<Bounty, "id" | "skills"> & { tags: string[] }> = [
  {
    platform: "dework",
    nativeId: "demo-1",
    title: "Build a React dashboard widget for DAO treasury balances",
    description:
      "Create a reusable React + TypeScript component that fetches and displays a DAO's multi-chain treasury balances using viem. Must include loading/error states, Tailwind styling, and a Storybook story.",
    url: "https://app.dework.xyz/demo/treasury-widget",
    rewardAmount: 400,
    rewardCurrency: "USDC",
    rewardUsd: 400,
    tags: ["react", "typescript", "tailwind", "web3", "frontend"],
    deadline: new Date(Date.now() + 12 * 864e5).toISOString(),
    status: "open",
    createdAt: new Date(Date.now() - 2 * 864e5).toISOString(),
    raw: { demo: true },
  },
  {
    platform: "gitcoin",
    nativeId: "demo-2",
    title: "Write developer docs + quickstart for an open-source TS SDK",
    description:
      "Our TypeScript SDK lacks a getting-started guide. Produce a docs site quickstart, API reference examples, and a runnable example repo. Markdown + code samples.",
    url: "https://explorer.gitcoin.co/#/demo/docs",
    rewardAmount: 250,
    rewardCurrency: "USD",
    rewardUsd: 250,
    tags: ["documentation", "typescript", "sdk", "docs"],
    deadline: new Date(Date.now() + 20 * 864e5).toISOString(),
    status: "open",
    createdAt: new Date(Date.now() - 5 * 864e5).toISOString(),
    raw: { demo: true },
  },
  {
    platform: "dorahacks",
    nativeId: "demo-3",
    title: "Hackathon: ship a Next.js mini-app on Base",
    description:
      "Build any consumer mini-app on Base using Next.js. Judged on UX and originality. Frontend-heavy, smart contracts optional.",
    url: "https://dorahacks.io/hackathon/demo-base",
    rewardAmount: 5000,
    rewardCurrency: "USD",
    rewardUsd: 5000,
    tags: ["nextjs", "react", "base", "frontend", "hackathon"],
    deadline: new Date(Date.now() + 25 * 864e5).toISOString(),
    status: "open",
    createdAt: new Date(Date.now() - 1 * 864e5).toISOString(),
    raw: { demo: true },
  },
  {
    platform: "dework",
    nativeId: "demo-4",
    title: "Implement a Rust zk-circuit for Merkle inclusion proofs",
    description:
      "Advanced cryptography task. Implement and benchmark a zk-circuit in Rust (Halo2). Requires deep ZK experience.",
    url: "https://app.dework.xyz/demo/zk-circuit",
    rewardAmount: 3000,
    rewardCurrency: "USDC",
    rewardUsd: 3000,
    tags: ["rust", "zk", "cryptography", "halo2"],
    deadline: new Date(Date.now() + 6 * 864e5).toISOString(),
    status: "open",
    createdAt: new Date(Date.now() - 3 * 864e5).toISOString(),
    raw: { demo: true },
  },
  {
    platform: "layer3",
    nativeId: "demo-5",
    title: "Complete quest: bridge funds and swap on a testnet",
    description: "User-acquisition quest. Bridge to the testnet, perform a swap, share on X.",
    url: "https://layer3.xyz/quests/demo",
    rewardAmount: 10,
    rewardCurrency: "USD",
    rewardUsd: 10,
    tags: ["quest", "defi"],
    deadline: new Date(Date.now() + 3 * 864e5).toISOString(),
    status: "open",
    createdAt: new Date(Date.now() - 1 * 864e5).toISOString(),
    raw: { demo: true },
  },
];

export function demoBounties(): Bounty[] {
  return RAW.map((b) => ({
    ...b,
    id: makeId(b.platform, b.nativeId),
    skills: inferSkills(`${b.title} ${b.description}`, b.tags),
  }));
}
