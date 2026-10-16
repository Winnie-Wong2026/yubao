import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = await mkdtemp(path.join(tmpdir(), "dailyplan-task-records-"));
const dataDir = path.join(runtime, "data");
const uploadDir = path.join(runtime, "uploads");
const stateFile = path.join(dataDir, "state.json");
const port = 19820 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;
let server;
let output = "";

function startServer() {
  output = "";
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), YUBAO_DATA_DIR: dataDir, YUBAO_UPLOAD_DIR: uploadDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`测试服务启动失败\n${output}`);
}

async function json(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json() };
}

try {
  startServer();
  await waitForServer();
  const initial = await json("/api/state");
  const today = initial.body.today;
  await stopServer();

  const raw = JSON.parse(await readFile(stateFile, "utf8"));
  raw.version = 4;
  raw.productVersion = "1.2.0";
  raw.tasks = [{
    id: "legacy_daily", title: "旧版每日阅读", subject: "阅读", scheduleType: "daily",
    description: "阅读二十分钟。", reward: 5, due: "今天 21:00 前", guideImage: null,
    activeDate: today, status: "redo", createdAt: "2026-08-18T10:00:00.000Z",
    submittedAt: "2026-08-18T11:00:00.000Z", confirmedAt: null,
    redoReason: "再读一小段。", coinIssued: false,
    dailyConfig: { title: "旧版每日阅读", subject: "阅读", scheduleType: "daily", description: "阅读二十分钟。", reward: 5, due: "今天 21:00 前", guideImage: null }
  }];
  raw.taskDayRecords = [{
    id: "historical", taskId: "removed_task", date: "2026-08-17", title: "历史数学练习",
    subject: "数学", scheduleType: "once", reward: 4, due: "当天睡前", status: "done",
    submittedAt: "2026-08-17T11:00:00.000Z", confirmedAt: "2026-08-17T12:00:00.000Z",
    redoReason: "", guideImage: null, earnedCoins: 4, createdAt: "2026-08-17T10:00:00.000Z",
    submissionAttempts: [{ submittedAt: "2026-08-17T11:00:00.000Z", completionPhoto: null }]
  }];
  await writeFile(stateFile, `${JSON.stringify(raw, null, 2)}\n`);

  startServer();
  await waitForServer();
  let migrated = await json("/api/state");
  assert.equal(migrated.response.status, 200);
  assert.equal(migrated.body.version, 7);
  assert.equal(migrated.body.productVersion, "1.2.6");
  const legacy = migrated.body.tasks.find((task) => task.id === "legacy_daily");
  assert.equal(legacy.photoPolicy, "optional");
  assert.equal(legacy.dailyConfig.photoPolicy, "optional");
  assert.equal(legacy.submissionAttempts.length, 1);
  assert.equal(legacy.submissionAttempts[0].decision, "redo");
  const historical = migrated.body.taskDayRecords.find((record) => record.id === "historical");
  assert.equal(historical.photoPolicy, "none");
  assert.equal(historical.description, "");
  assert.equal(historical.submissionAttempts.length, 1);
  assert.equal(historical.submissionAttempts[0].decision, "confirmed");
  assert.ok(historical.submissionAttempts[0].id);
  assert.equal(historical.submissionAttempts[0].decidedAt, "2026-08-17T12:00:00.000Z");
  const migratedAttemptIds = migrated.body.taskDayRecords.flatMap((record) => record.submissionAttempts.map((attempt) => attempt.id));

  await stopServer();
  startServer();
  await waitForServer();
  migrated = await json("/api/state");
  assert.deepEqual(migrated.body.taskDayRecords.flatMap((record) => record.submissionAttempts.map((attempt) => attempt.id)), migratedAttemptIds);

  const login = await json("/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "2580" })
  });
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${login.body.token}` };
  const update = await json("/api/action", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ type: "updateTask", payload: {
      id: "legacy_daily", title: "新版每日阅读", subject: "阅读", scheduleType: "daily",
      description: "阅读二十分钟，再说说故事内容。", photoPolicy: "required", reward: 6,
      due: "今天 21:00 前", guideImage: null, editScope: "future"
    } })
  });
  assert.equal(update.response.status, 200, update.body.error);
  const updatedTask = update.body.tasks.find((task) => task.id === "legacy_daily");
  assert.equal(updatedTask.photoPolicy, "optional");
  assert.equal(updatedTask.nextDailyConfig.photoPolicy, "required");
  assert.equal(update.body.taskDayRecords.find((record) => record.taskId === "legacy_daily").photoPolicy, "optional");
  assert.equal(update.body.taskDayRecords.find((record) => record.id === "historical").title, "历史数学练习");

  const updateTodayAndFuture = await json("/api/action", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ type: "updateTask", payload: {
      id: "legacy_daily", title: "新版每日阅读", subject: "阅读", scheduleType: "daily",
      description: "阅读二十分钟，再说说故事内容。", photoPolicy: "optional", reward: 7,
      due: "今天 21:00 前", guideImage: null, editScope: "today_and_future"
    } })
  });
  assert.equal(updateTodayAndFuture.response.status, 200, updateTodayAndFuture.body.error);
  const updatedTodayAndFutureTask = updateTodayAndFuture.body.tasks.find((task) => task.id === "legacy_daily");
  assert.equal(updatedTodayAndFutureTask.photoPolicy, "optional");
  assert.equal(updatedTodayAndFutureTask.dailyConfig.photoPolicy, "optional");
  assert.equal(updatedTodayAndFutureTask.reward, 7);
  assert.equal("nextDailyConfig" in updatedTodayAndFutureTask, false);
  assert.equal(updateTodayAndFuture.body.taskDayRecords.find((record) => record.taskId === "legacy_daily").photoPolicy, "optional");

  const createWithoutPolicy = await json("/api/action", {
    method: "POST", headers: authHeaders, body: JSON.stringify({ type: "createTask", payload: {
      title: "新版默认任务", subject: "语文", scheduleType: "once", description: "完成练习。", reward: 5, due: "今天 21:00 前", guideImage: null
    } })
  });
  assert.equal(createWithoutPolicy.response.status, 200, createWithoutPolicy.body.error);
  assert.equal(createWithoutPolicy.body.tasks.find((task) => task.title === "新版默认任务").photoPolicy, "optional");

  console.log("PASS task record snapshots, schema migration idempotence and daily scope policy checks");
} finally {
  await stopServer();
  await rm(runtime, { recursive: true, force: true });
}
