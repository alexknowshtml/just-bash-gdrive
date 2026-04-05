#!/usr/bin/env bun
/**
 * Live test for just-bash-gdrive using Andy Core Google OAuth credentials.
 * Usage: bun test-live.ts [folderId]
 */

import { Bash } from "just-bash";
import { GDriveFs } from "./src/index.js";
import { execSync } from "child_process";

// ── Get access token from Andy Core credentials ────────────────────────────

async function getAccessToken(): Promise<string> {
  const creds = JSON.parse(
    execSync("bun run ../get-credential.ts google-unified-oauth --user-id=1", {
      cwd: import.meta.dir,
      encoding: "utf8",
    })
  );

  const res = await fetch(creds.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

// ── Main ───────────────────────────────────────────────────────────────────

const rootFolderId = process.argv[2]; // optional folder ID to scope to

console.log("Fetching access token from Andy Core...");
const accessToken = await getAccessToken();
console.log("Token OK\n");

const fs = new GDriveFs({
  accessToken,
  ...(rootFolderId ? { rootFolderId } : {}),
});

const bash = new Bash({ fs });

// Test 1: ls root
console.log("=== ls / ===");
const ls = await bash.exec("ls /");
console.log(ls.stdout);

// Test 2: stat root
console.log("=== stat / ===");
const stat = await bash.exec("stat /");
console.log(stat.stdout);

// Test 3: find with prefetch (only if folder scoped, full root can be huge)
if (rootFolderId) {
  console.log("=== Prefetching paths ===");
  await fs.prefetchAllPaths();
  console.log(`Cached ${fs.getAllPaths().length} paths\n`);

  console.log("=== find / -type f | head -20 ===");
  const find = await bash.exec("find / -type f | head -20");
  console.log(find.stdout);
}
