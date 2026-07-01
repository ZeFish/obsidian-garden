/**
 * Sync token list from the canonical source in @stnd/utils/theme-tokens.
 *
 * Usage: node apps/stnd-obsidian/sync-tokens.js
 *
 * Prints the KNOWN_TOKENS Set contents that should replace the block in
 * src/constants.js. Manual paste — build.js (esbuild) bundles from there.
 */

import { ALL_TOKEN_NAMES } from "../../packages/utils/theme-tokens.js";

console.log("// Canonical tokens from packages/utils/theme-tokens.js");
console.log("const KNOWN_TOKENS = new Set([");
for (const name of ALL_TOKEN_NAMES) {
  console.log(`  "${name}",`);
}
console.log("]);");
console.log(`\n// Total: ${ALL_TOKEN_NAMES.length} tokens`);
