import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = await mkdtemp(path.join(tmpdir(), "dailyplan-task-submission-security-"));
const dataDir = path.join(runtime, "data");
const uploadDir = path.join(runtime, "uploads");
const port = 20200 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const invalidPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString("base64");
const oversizedPngBuffer = Buffer.alloc(6 * 1024 * 1024 + 1);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversizedPngBuffer);
const oversizedPng = oversizedPngBuffer.toString("base64");
let server;
let output = "";

function startServer() {
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

function completionFiles(files) {
  return files.filter((name) => name.startsWith("task-completion-")).sort();
}

try {
  startServer();
  await waitForServer();
  const login = await json("/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "2580" })
  });
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${login.body.token}` };
  const createTask = async (title) => {
    const result = await json("/api/action", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ type: "createTask", payload: {
        title, subject: "数学", scheduleType: "once", description: "完成练习后认真检查。",
        photoPolicy: "required", reward: 5, due: "今天 21:00 前", guideImage: null
      } })
    });
    assert.equal(result.response.status, 200, result.body.error);
    return result.body.tasks.find((task) => task.title === title);
  };
  const submitRaw = (taskId, { name = "done.png", mimeType = "image/png", base64 = pngBase64, dataUrl } = {}) => json("/api/task-submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, name, dataUrl: dataUrl === undefined ? `data:${mimeType};base64,${base64}` : dataUrl })
  });

  const invalidTask = await submitRaw("missing-task", { dataUrl: "" });
  assert.equal(invalidTask.response.status, 400);
  assert.match(invalidTask.body.error, /任务不存在/);

  const validationTask = await createTask("上传安全校验任务");
  const nonImage = await submitRaw(validationTask.id, { base64: Buffer.from("not-an-image").toString("base64") });
  assert.equal(nonImage.response.status, 400);
  assert.match(nonImage.body.error, /暂时打不开/);

  const unknownDimensions = await submitRaw(validationTask.id, { base64: invalidPng });
  assert.equal(unknownDimensions.response.status, 400);
  assert.match(unknownDimensions.body.error, /暂时打不开/);

  const oversized = await submitRaw(validationTask.id, { base64: oversizedPng });
  assert.equal(oversized.response.status, 400);
  assert.match(oversized.body.error, /照片太大/);

  const wrongExtension = await submitRaw(validationTask.id, { name: "done.jpg" });
  assert.equal(wrongExtension.response.status, 400);
  assert.match(wrongExtension.body.error, /暂时打不开/);

  const accepted = await submitRaw(validationTask.id);
  assert.equal(accepted.response.status, 200, accepted.body.error);
  const duplicate = await submitRaw(validationTask.id);
  assert.equal(duplicate.response.status, 400);
  assert.match(duplicate.body.error, /已经提交/);

  const rollbackTask = await createTask("写入失败回滚任务");
  const filesBeforeRollback = completionFiles(await readdir(uploadDir));
  await chmod(dataDir, 0o500);
  const rollback = await submitRaw(rollbackTask.id);
  await chmod(dataDir, 0o700);
  assert.equal(rollback.response.status, 400, rollback.body.error);
  assert.match(rollback.body.error, /没有提交成功/);
  assert.deepEqual(completionFiles(await readdir(uploadDir)), filesBeforeRollback);
  const stateAfterRollback = await json("/api/state");
  assert.equal(stateAfterRollback.body.tasks.find((task) => task.id === rollbackTask.id).status, "todo");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const limitedCandidate = await submitRaw(`missing-${attempt}`, { dataUrl: "" });
    assert.equal(limitedCandidate.response.status, 400);
  }
  const rateLimited = await submitRaw("rate-limited", { dataUrl: "" });
  assert.equal(rateLimited.response.status, 429);

  const completionFile = completionFiles(await readdir(uploadDir))[0];
  await access(path.join(uploadDir, completionFile));
  console.log("PASS task submission upload safety, rollback and rate limit checks");
} finally {
  await chmod(dataDir, 0o700).catch(() => {});
  await stopServer();
  await rm(runtime, { recursive: true, force: true });
}
