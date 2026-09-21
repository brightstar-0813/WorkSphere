/**
 * Copies the ONNX Runtime WASM files out of @huggingface/transformers into
 * src/vendor/ort so Vite emits them as ordinary hashed assets served from our
 * own origin.
 *
 * Without this, transformers.js points ONNX Runtime at a jsdelivr CDN, and the
 * whole tool dies with "no available backend found" on any machine that cannot
 * reach that CDN. Runs from `predev` and `prebuild`.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const target = join(webRoot, "src", "vendor", "ort");

const FILES = ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"];

/** npm workspaces hoist to the repo root, but a local install is also valid. */
function findDist() {
  let dir = webRoot;
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, "node_modules", "@huggingface", "transformers", "dist");
    if (existsSync(join(candidate, FILES[1]))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const dist = findDist();
if (!dist) {
  console.error(
    "[copy-ort] @huggingface/transformers not found — run npm install before dev/build.",
  );
  process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of FILES) {
  const from = join(dist, file);
  const to = join(target, file);
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
  console.log(`[copy-ort] ${file} → src/vendor/ort/`);
}
