import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const childJs = await readFile(new URL("product/child/child.js", root), "utf8");
const childCss = await readFile(new URL("product/child/child.css", root), "utf8");
const childSw = await readFile(new URL("product/child/sw.js", root), "utf8");
const parentJs = await readFile(new URL("product/parent/parent.js", root), "utf8");
const serverJs = await readFile(new URL("server.mjs", root), "utf8");

assert.match(childJs, /function navigateTo\(/, "child navigation must have one navigation entry point");
assert.match(childJs, /history\.pushState\(\{ view \}, "", `#\$\{view\}`\)/, "child navigation must update history without triggering a duplicate hash render");
assert.doesNotMatch(childJs, /location\.hash\s*=\s*view/, "navigation must not trigger hashchange through location.hash assignment");
assert.match(childJs, /data-child-view/, "child views must stay mounted after their first visit");
assert.match(childJs, /node\.hidden = !active/, "navigation must switch mounted view visibility");
assert.match(childJs, /function pausePlanetVideos\(/, "leaving the planet must pause its videos");
assert.match(childJs, /function resumePlanetVideos\(/, "returning to the planet must resume its videos");
assert.match(childJs, /if \(refreshPromise\) return refreshPromise/, "state polling must deduplicate concurrent refreshes");
assert.match(childJs, /beforeUpdatedAt === nextState\.updatedAt/, "unchanged polling responses must not rebuild a view");
assert.match(childJs, /function playableMotionSources\(/, "child runtime must select playable sources automatically");
assert.match(childJs, /motionSupportProbe\.canPlayType\(type\)/, "child runtime must use browser capability detection instead of a platform switch");
assert.match(childJs, /return "video\/quicktime"/, "legacy MOV media must retain its QuickTime MIME type");
assert.match(childCss, /\[data-child-view\]\[hidden\]/, "hidden mounted views must not affect layout");

assert.match(parentJs, /name="motionFile"/, "parent digital reward form must expose one platform-neutral motion upload");
assert.match(parentJs, /video\/quicktime/, "the unified motion upload must accept MOV files");
assert.doesNotMatch(parentJs, /motionSafariFile/, "parent UI must not expose a separate Safari upload");
assert.doesNotMatch(parentJs, /purpose: "safari_motion"/, "parent uploads must not encode a device-specific purpose");
assert.doesNotMatch(parentJs, /iPad \/ Safari 动画|通用动画/, "parent UI must not ask families to distinguish device formats");
assert.match(serverJs, /motionSafariUrl/, "digital reward state must keep the legacy Safari field readable for existing data");
assert.doesNotMatch(serverJs, /isSafariMotion|transcodeQuickTimeIfPossible/, "upload API must treat all supported videos through one path");
assert.match(serverJs, /public, max-age=31536000, immutable/, "fingerprinted uploaded media must use durable browser caching");
assert.match(childSw, /url\.pathname\.startsWith\("\/product\/uploads\/"\)/, "service worker must leave uploaded media to the HTTP cache and range requests");
assert.match(childSw, /event\.request\.destination === "video"/, "service worker must not store video responses in the app shell cache");

console.log("PASS child navigation, unified media, and cache static checks");
