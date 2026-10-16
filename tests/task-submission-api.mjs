import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = await mkdtemp(path.join(tmpdir(), "dailyplan-task-submission-"));
const dataDir = path.join(runtime, "data");
const uploadDir = path.join(runtime, "uploads");
const stateFile = path.join(dataDir, "state.json");
const port = 19400 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
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
  const body = await response.json();
  return { response, body };
}

try {
  startServer();
  await waitForServer();
  const login = await json("/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "2580" })
  });
  const initialState = await json("/api/state");
  const preservedConfiguration = {
    digitalRewards: initialState.body.digitalRewards,
    realRewards: initialState.body.realRewards,
    equipped: initialState.body.equipped
  };
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${login.body.token}` };
  const parentAction = async (type, payload) => {
    const result = await json("/api/action", { method: "POST", headers: authHeaders, body: JSON.stringify({ type, payload }) });
    assert.equal(result.response.status, 200, result.body.error);
    return result.body;
  };
  const createTask = async (photoPolicy, title, scheduleType = "once") => {
    const state = await parentAction("createTask", {
      title, subject: "数学", scheduleType, description: "完成练习后认真检查。",
      photoPolicy, reward: 5, due: "今天 21:00 前", guideImage: null
    });
    return state.tasks.find((task) => task.title === title);
  };
  const submit = (taskId, withPhoto = true, declaredType = "image/png") => json("/api/task-submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, name: withPhoto ? "done.png" : "", dataUrl: withPhoto ? `data:${declaredType};base64,${pngBase64}` : "" })
  });

  const optionalTask = await createTask("optional", "可选照片任务");
  const optionalNoPhotoTask = await createTask("optional", "可选照片直接提交任务");
  const optionalNoPhotoSubmit = await submit(optionalNoPhotoTask.id, false);
  assert.equal(optionalNoPhotoSubmit.response.status, 200, optionalNoPhotoSubmit.body.error);
  assert.equal(optionalNoPhotoSubmit.body.tasks.find((item) => item.id === optionalNoPhotoTask.id).submissionAttempts[0].completionPhoto, null);
  const optionalSubmit = await submit(optionalTask.id, true);
  assert.equal(optionalSubmit.response.status, 200, optionalSubmit.body.error);
  let task = optionalSubmit.body.tasks.find((item) => item.id === optionalTask.id);
  assert.equal(task.status, "pending");
  assert.equal(task.submissionAttempts.length, 1);
  assert.equal(task.submissionAttempts[0].decision, "pending");
  assert.match(task.submissionAttempts[0].completionPhoto.url, /task-completion-/);
  const completionUrl = task.submissionAttempts[0].completionPhoto.url;
  await access(path.join(uploadDir, path.basename(completionUrl)));
  const record = optionalSubmit.body.taskDayRecords.find((item) => item.taskId === optionalTask.id);
  assert.equal(record.photoPolicy, "optional");
  assert.equal(record.submissionAttempts[0].completionPhoto.url, completionUrl);

  const duplicate = await submit(optionalTask.id, true);
  assert.equal(duplicate.response.status, 400);
  assert.match(duplicate.body.error, /已经提交/);

  let state = await parentAction("confirmTask", { id: optionalTask.id });
  task = state.tasks.find((item) => item.id === optionalTask.id);
  assert.equal(task.submissionAttempts[0].decision, "confirmed");
  assert.equal(state.wallet.balance, 5);
  const repeatConfirm = await json("/api/action", {
    method: "POST", headers: authHeaders, body: JSON.stringify({ type: "confirmTask", payload: { id: optionalTask.id } })
  });
  assert.equal(repeatConfirm.response.status, 400);

  const requiredTask = await createTask("required", "必拍照片任务");
  const missingPhoto = await submit(requiredTask.id, false);
  assert.equal(missingPhoto.response.status, 400);
  assert.match(missingPhoto.body.error, /先拍一张/);
  const disguisedPhoto = await submit(requiredTask.id, true, "image/jpeg");
  assert.equal(disguisedPhoto.response.status, 400);
  assert.match(disguisedPhoto.body.error, /暂时打不开/);

  const firstRequired = await submit(requiredTask.id, true);
  assert.equal(firstRequired.response.status, 200);
  state = await parentAction("redoTask", { id: requiredTask.id, reason: "请把最后一题也拍清楚。" });
  task = state.tasks.find((item) => item.id === requiredTask.id);
  assert.equal(task.status, "redo");
  assert.equal(task.submissionAttempts[0].decision, "redo");
  assert.equal(task.submissionAttempts[0].redoReason, "请把最后一题也拍清楚。");
  const secondRequired = await submit(requiredTask.id, true);
  task = secondRequired.body.tasks.find((item) => item.id === requiredTask.id);
  assert.equal(task.submissionAttempts.length, 2);
  assert.equal(task.submissionAttempts[0].decision, "redo");
  assert.equal(task.submissionAttempts[1].decision, "pending");
  assert.notEqual(task.submissionAttempts[0].completionPhoto.url, task.submissionAttempts[1].completionPhoto.url);

  const noPhotoTask = await createTask("none", "直接提交任务");
  const unexpectedPhoto = await submit(noPhotoTask.id, true);
  assert.equal(unexpectedPhoto.response.status, 400);
  assert.match(unexpectedPhoto.body.error, /不用添加照片/);
  const directSubmit = await submit(noPhotoTask.id, false);
  assert.equal(directSubmit.response.status, 200);
  assert.equal(directSubmit.body.tasks.find((item) => item.id === noPhotoTask.id).submissionAttempts[0].completionPhoto, null);

  const dailyTask = await createTask("optional", "每日拍照任务", "daily");
  const dailySubmit = await submit(dailyTask.id, true);
  assert.equal(dailySubmit.response.status, 200, dailySubmit.body.error);
  const dailyPhotoUrl = dailySubmit.body.tasks.find((item) => item.id === dailyTask.id).submissionAttempts[0].completionPhoto.url;
  await parentAction("confirmTask", { id: dailyTask.id });

  await stopServer();
  const beforeRollover = JSON.parse(await readFile(stateFile, "utf8"));
  const oldDate = "2000-01-01";
  const storedDailyTask = beforeRollover.tasks.find((item) => item.id === dailyTask.id);
  const storedDailyRecord = beforeRollover.taskDayRecords.find((item) => item.taskId === dailyTask.id);
  storedDailyTask.activeDate = oldDate;
  storedDailyRecord.date = oldDate;
  storedDailyRecord.id = `${dailyTask.id}:${oldDate}`;
  await writeFile(stateFile, `${JSON.stringify(beforeRollover, null, 2)}\n`);
  startServer();
  await waitForServer();
  const restored = await json("/api/state");
  task = restored.body.tasks.find((item) => item.id === requiredTask.id);
  assert.equal(restored.body.version, 7);
  assert.equal(restored.body.productVersion, "1.2.6");
  assert.equal(task.submissionAttempts.length, 2);
  const rolledDailyTask = restored.body.tasks.find((item) => item.id === dailyTask.id);
  const oldDailyRecord = restored.body.taskDayRecords.find((item) => item.taskId === dailyTask.id && item.date === oldDate);
  assert.equal(rolledDailyTask.status, "todo");
  assert.equal(rolledDailyTask.submissionAttempts.length, 0);
  assert.equal(oldDailyRecord.submissionAttempts.length, 1);
  assert.equal(oldDailyRecord.submissionAttempts[0].completionPhoto.url, dailyPhotoUrl);
  assert.equal(restored.body.taskDayRecords.find((item) => item.taskId === dailyTask.id && item.date === restored.body.today).submissionAttempts.length, 0);

  const loginAgain = await json("/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "2580" })
  });
  const preservedAssetPath = path.join(uploadDir, "configured-parent-asset.png");
  await writeFile(preservedAssetPath, Buffer.from(pngBase64, "base64"));
  const reset = await json("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginAgain.body.token}` },
    body: JSON.stringify({ type: "reset", payload: {} })
  });
  assert.equal(reset.response.status, 200, reset.body.error);
  assert.equal(reset.body.tasks.length, 0);
  assert.equal(reset.body.taskDayRecords.length, 0);
  assert.deepEqual(reset.body.digitalRewards, preservedConfiguration.digitalRewards);
  assert.deepEqual(reset.body.realRewards, preservedConfiguration.realRewards);
  assert.deepEqual(reset.body.equipped, preservedConfiguration.equipped);
  const remainingFiles = await readdir(uploadDir);
  assert.equal(remainingFiles.some((name) => name.startsWith("task-completion-")), false);
  await access(preservedAssetPath);

  console.log("PASS task completion policy, photo safety, attempts, restart and reset cleanup checks");
} finally {
  await stopServer();
  await rm(runtime, { recursive: true, force: true });
}
