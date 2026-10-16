import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const parentHtml = await readFile(new URL("../product/parent/index.html", import.meta.url), "utf8");

assert.doesNotMatch(parentHtml, /本地家庭\s*PIN/i, "parent login must not expose a local PIN hint");
assert.doesNotMatch(parentHtml, />\s*2580\s*</, "parent login must not render the default PIN");
assert.match(parentHtml, /autocomplete="current-password"/, "parent PIN input should retain password-manager semantics");

console.log("PASS parent login static security checks");
