import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readText = (relativePath) => readFile(new URL(relativePath, root), "utf8");

function pngSize(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG", "icon must be a PNG file");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

for (const entry of [
  {
    side: "child",
    title: "聿宝星球",
    htmlPath: "product/child/index.html",
    manifestPath: "product/child/manifest.webmanifest",
    startUrl: "/product/child/",
    touchIcon: "/assets/01_品牌与入口/brand_child_apple_touch_icon_180_v02.png",
    iconPrefix: "brand_child_pwa_icon_",
  },
  {
    side: "parent",
    title: "聿宝家长",
    htmlPath: "product/parent/index.html",
    manifestPath: "product/parent/manifest.webmanifest",
    startUrl: "/product/parent/",
    touchIcon: "/assets/01_品牌与入口/brand_parent_apple_touch_icon_180_v02.png",
    iconPrefix: "brand_parent_pwa_icon_",
  },
]) {
  const html = await readText(entry.htmlPath);
  const manifest = JSON.parse(await readText(entry.manifestPath));
  assert.match(html, new RegExp(`<meta name="apple-mobile-web-app-title" content="${entry.title}">`));
  assert.ok(html.includes(`<link rel="apple-touch-icon" sizes="180x180" href="${entry.touchIcon}">`));
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest\?v=1\.2\.4-pwa2">/);
  assert.equal(manifest.id, entry.startUrl);
  assert.equal(manifest.start_url, entry.startUrl);
  assert.equal(manifest.scope, entry.startUrl);
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
  for (const icon of manifest.icons) {
    assert.ok(icon.src.includes(entry.iconPrefix), `${entry.side} manifest must use its own icon family`);
    const expected = Number(icon.sizes.split("x")[0]);
    const dimensions = pngSize(await readFile(new URL(icon.src.slice(1), root)));
    assert.deepEqual(dimensions, { width: expected, height: expected });
  }
  assert.deepEqual(pngSize(await readFile(new URL(entry.touchIcon.slice(1), root))), { width: 180, height: 180 });
}

const childSw = await readText("product/child/sw.js");
assert.match(childSw, /yubao-child-v15/);
assert.match(childSw, /brand_child_apple_touch_icon_180_v02\.png/);

console.log("PASS child and parent PWA icon declarations and exact PNG sizes");
