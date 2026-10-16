import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const childJs = await readFile(new URL("product/child/child.js", root), "utf8");
const childCss = await readFile(new URL("product/child/child.css", root), "utf8");
const childHtml = await readFile(new URL("product/child/index.html", root), "utf8");
const childSw = await readFile(new URL("product/child/sw.js", root), "utf8");

assert.match(childJs, /function openDigitalPreview\(/, "child shop must expose a digital preview modal");
assert.match(childJs, /data-action="preview-digital"/, "digital shop cards must include a preview action");
assert.match(childJs, /sceneMarkup\("scene", previewLayers, \{ forceMotionLayer \}\)/, "preview must render temporary layer overrides");
assert.match(childJs, /function canPreviewMotion\(/, "preview must distinguish static and video rewards");
assert.match(childJs, /function playableMotionSources\(/, "child runtime must select a playable source without asking the parent to choose a platform");
assert.match(childJs, /motionSupportProbe\.canPlayType\(type\)/, "child runtime must check browser support before showing video");
assert.match(childJs, /runtime-motion-standalone/, "character and pet videos must avoid visible static underlays");
assert.match(childJs, /video\.addEventListener\("playing", revealMotion\)/, "character and pet static fallbacks must remain visible until video playback starts");
assert.match(childJs, /fallback\.hidden = true/, "a playing character or pet video must hide its static fallback");
assert.match(childJs, /function finishDigitalPurchase\(/, "purchase flow must offer a post-purchase choice");
assert.match(childJs, /data-testid="purchase-equip-now"/, "purchase success must include an explicit immediate-use action");

assert.match(childCss, /\.digital-preview-stage/, "preview stage styles must be present");
assert.match(childCss, /\.shop-card-actions/, "shop card preview and action controls must be styled");
assert.match(childCss, /\.runtime-motion-standalone \{ opacity: 0;/, "standalone motion layers must stay hidden until playback succeeds");

assert.match(childHtml, /child\.js\?v=1\.2\.6-taskscope1/, "child page must load the task-scope JS cache key");
assert.match(childHtml, /child\.css\?v=1\.2\.6-taskscope1/, "child page must load the task-scope CSS cache key");
assert.match(childSw, /yubao-child-v15/, "service worker cache must include the task-scope changes");
assert.match(childSw, /child\.js\?v=1\.2\.6-taskscope1/, "service worker must cache the current child JS asset");
assert.match(childSw, /\/product\/task-scope\.js/, "service worker must cache the shared task-scope module");

console.log("PASS child shop preview static frontend checks");
