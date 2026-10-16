import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const parentJs = await readFile(new URL("product/parent/parent.js", root), "utf8");
const parentCss = await readFile(new URL("product/parent/parent.css", root), "utf8");
const parentHtml = await readFile(new URL("product/parent/index.html", root), "utf8");

assert.match(parentJs, /data-view="confirmations" data-focus-target="confirmation-tasks"/, "pending task metric must open the task confirmation section");
assert.match(parentJs, /data-view="confirmations" data-focus-target="confirmation-rewards"/, "pending reward metric must open the reward confirmation section");
assert.match(parentJs, /data-view="records" data-record-mode="tasks" data-record-period="date" data-record-status="done"/, "today confirmed metric must open today's completed records");
assert.match(parentJs, /data-view="records" data-record-mode="ledger"/, "available coin metric must open the ledger");
assert.match(parentJs, /const pendingRewards = state\.redemptions\.filter\(\(item\) => item\.kind === "real"/, "pending reward count must match the real reward destination");
assert.match(parentJs, /if \(target\.dataset\.taskFilter\) taskFilter = target\.dataset\.taskFilter;/, "view navigation must apply the requested task filter");
assert.match(parentJs, /if \(target\.dataset\.recordMode\) recordMode = target\.dataset\.recordMode;/, "view navigation must apply the requested record mode");
assert.match(parentJs, /if \(target\.dataset\.recordPeriod\) recordPeriod = target\.dataset\.recordPeriod;/, "view navigation must apply the requested record period");
assert.match(parentJs, /if \(target\.dataset\.recordStatus\) recordStatus = target\.dataset\.recordStatus;/, "view navigation must apply the requested record status");
assert.match(parentJs, /往日待处理/, "task management must expose a separate overdue scope");
assert.match(parentJs, /data-record-period="all" data-record-status="done"/, "task management must link directly to all completed records");
assert.match(parentJs, /if \(recordPeriod === "all"\) return true;/, "completed records must offer an all-history period");
assert.match(parentJs, /id="confirmation-tasks" class="confirmation-section" tabindex="-1"/, "task confirmation destination must be focusable");
assert.match(parentJs, /id="confirmation-rewards" class="confirmation-section" tabindex="-1"/, "reward confirmation destination must be focusable");

assert.match(parentCss, /\.metric:hover/, "clickable metrics must expose a hover state");
assert.match(parentCss, /\.metric:focus-visible/, "clickable metrics must expose a keyboard focus state");
assert.match(parentHtml, /parent\.js\?v=1\.2\.6-taskscope1/, "parent page must load the task-scope JS cache key");
assert.match(parentHtml, /parent\.css\?v=1\.2\.6-taskscope1/, "parent page must load the task-scope CSS cache key");

console.log("PASS parent dashboard navigation static frontend checks");
