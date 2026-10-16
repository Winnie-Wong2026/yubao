import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = await mkdtemp(path.join(tmpdir(), "dailyplan-task-guide-"));
const dataDir = path.join(runtime, "data");
const uploadDir = path.join(runtime, "uploads");
const port = 18870 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
let serverOutput = "";
let server;

function startServer() {
  serverOutput = "";
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), YUBAO_DATA_DIR: dataDir, YUBAO_UPLOAD_DIR: uploadDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`测试服务启动失败\n${serverOutput}`);
}

async function json(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const quicktimeBase64 = Buffer.from("00000014667479707174202000000000", "hex").toString("base64");

try {
  startServer();
  await waitForServer();
  const login = await json("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "2580" })
  });
  assert.equal(login.response.status, 200);
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${login.body.token}` };

  const unauthorized = await json("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl: `data:image/png;base64,${pngBase64}`, purpose: "task_guide" })
  });
  assert.equal(unauthorized.response.status, 401);

  const disguised = await json("/api/upload", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "fake.jpg", dataUrl: `data:image/jpeg;base64,${pngBase64}`, purpose: "task_guide" })
  });
  assert.equal(disguised.response.status, 400);
  assert.match(disguised.body.error, /实际格式/);

  const wrongExtension = await json("/api/upload", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "fake.jpg", dataUrl: `data:image/png;base64,${pngBase64}`, purpose: "task_guide" })
  });
  assert.equal(wrongExtension.response.status, 400);
  assert.match(wrongExtension.body.error, /扩展名/);

  const quicktimeUpload = await json("/api/upload", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "learning-preview.mov", dataUrl: `data:video/quicktime;base64,${quicktimeBase64}` })
  });
  assert.equal(quicktimeUpload.response.status, 200);
  assert.equal(quicktimeUpload.body.mimeType, "video/quicktime");
  assert.match(quicktimeUpload.body.url, /\.mov$/);
  const quicktimeRange = await fetch(`${baseUrl}${quicktimeUpload.body.url}`, { headers: { Range: "bytes=0-7" } });
  assert.equal(quicktimeRange.status, 206);
  assert.equal(quicktimeRange.headers.get("content-type"), "video/quicktime");
  assert.match(quicktimeRange.headers.get("content-range"), /^bytes 0-7\//);

  const quicktimeResponse = await fetch(`${baseUrl}${quicktimeUpload.body.url}`);
  assert.equal(quicktimeResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(Number(quicktimeResponse.headers.get("content-length")), 16);

  const videoGuide = await json("/api/upload", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "guide.mov", dataUrl: `data:video/quicktime;base64,${quicktimeBase64}`, purpose: "task_guide" })
  });
  assert.equal(videoGuide.response.status, 400);
  assert.match(videoGuide.body.error, /任务提示图只支持静态图片/);

  async function uploadGuide(name) {
    const result = await json("/api/upload", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name, dataUrl: `data:image/png;base64,${pngBase64}`, purpose: "task_guide" })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.mimeType, "image/png");
    assert.equal(result.body.width, 1);
    assert.equal(result.body.height, 1);
    return result.body;
  }

  async function parentAction(type, payload) {
    const result = await json("/api/action", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ type, payload })
    });
    assert.equal(result.response.status, 200, result.body.error);
    return result.body;
  }

  let state = await parentAction("createDigitalReward", {
    rewardType: "character",
    name: "统一动画套装",
    description: "用于验证家长只需保存一个动画地址。",
    price: 20,
    staticUrl: "/assets/02_人物完整套装/character_yubao_default_learning_v01.png",
    motionUrl: quicktimeUpload.body.url,
    mediaMode: "motion",
    active: true
  });
  const unifiedMotionReward = state.digitalRewards.find((reward) => reward.name === "统一动画套装");
  assert.equal(unifiedMotionReward.motionUrl, quicktimeUpload.body.url);
  assert.equal(unifiedMotionReward.motionSafariUrl, "");
  assert.equal(unifiedMotionReward.mediaMode, "motion");

  state = await parentAction("updateDigitalReward", {
    id: unifiedMotionReward.id,
    name: unifiedMotionReward.name,
    description: unifiedMotionReward.description,
    price: unifiedMotionReward.price,
    staticUrl: unifiedMotionReward.staticUrl,
    clearMotion: true,
    mediaMode: "motion",
    active: true
  });
  const staticReward = state.digitalRewards.find((reward) => reward.id === unifiedMotionReward.id);
  assert.equal(staticReward.motionUrl, "");
  assert.equal(staticReward.motionSafariUrl, "");
  assert.equal(staticReward.mediaMode, "static");

  const firstImage = await uploadGuide("today.png");
  const guideImage = {
    url: firstImage.url,
    thumbnailUrl: firstImage.url,
    mimeType: firstImage.mimeType,
    width: firstImage.width,
    height: firstImage.height,
    updatedAt: firstImage.updatedAt
  };

  state = await parentAction("createTask", {
    title: "无图任务",
    subject: "语文",
    scheduleType: "once",
    description: "旧流程仍然可以不添加图片。",
    reward: 5,
    due: "今天 21:00 前",
    guideImage: null
  });
  assert.equal(state.tasks[0].guideImage, null);

  state = await parentAction("createTask", {
    title: "看图完成练习",
    subject: "数学",
    scheduleType: "daily",
    description: "按照提示图完成练习。",
    reward: 5,
    due: "今天 21:00 前",
    guideImage
  });
  const dailyTask = state.tasks[0];
  assert.equal(dailyTask.guideImage.url, firstImage.url);
  assert.equal(dailyTask.dailyConfig.guideImage.url, firstImage.url);
  assert.equal(state.taskDayRecords.find((record) => record.taskId === dailyTask.id).guideImage.url, firstImage.url);

  state = await parentAction("updateTask", {
    id: dailyTask.id,
    title: "今天不需要看图",
    subject: "数学",
    scheduleType: "daily",
    description: "今天只完成口算。",
    reward: 5,
    due: "今天 21:00 前",
    guideImage: null,
    editScope: "today"
  });
  assert.equal(state.tasks[0].guideImage, null);
  assert.equal(state.tasks[0].dailyConfig.guideImage.url, firstImage.url);
  assert.equal(state.taskDayRecords.find((record) => record.taskId === dailyTask.id).guideImage, null);

  const secondImage = await uploadGuide("future.png");
  state = await parentAction("updateTask", {
    id: dailyTask.id,
    title: "明天看图完成练习",
    subject: "数学",
    scheduleType: "daily",
    description: "明天开始按照新提示图完成。",
    reward: 6,
    due: "今天 21:00 前",
    guideImage: { ...guideImage, url: secondImage.url, thumbnailUrl: secondImage.url, updatedAt: secondImage.updatedAt },
    editScope: "future"
  });
  assert.equal(state.tasks[0].guideImage, null);
  assert.equal(state.tasks[0].nextDailyConfig.guideImage.url, secondImage.url);
  assert.equal(state.taskDayRecords.find((record) => record.taskId === dailyTask.id).guideImage, null);

  const referencedDiscard = await json("/api/upload/discard", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ url: firstImage.url })
  });
  assert.equal(referencedDiscard.response.status, 409);

  const temporaryImage = await uploadGuide("temporary.png");
  const discarded = await json("/api/upload/discard", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ url: temporaryImage.url })
  });
  assert.equal(discarded.response.status, 200);
  assert.equal(discarded.body.discarded, true);

  await stopServer();
  startServer();
  await waitForServer();
  const restored = await json("/api/state");
  const restoredTask = restored.body.tasks.find((task) => task.id === dailyTask.id);
  assert.equal(restored.response.status, 200);
  assert.equal(restoredTask.nextDailyConfig.guideImage.url, secondImage.url);
  assert.equal(restored.body.taskDayRecords.find((record) => record.taskId === dailyTask.id).guideImage, null);
  const restoredImage = await fetch(`${baseUrl}${secondImage.url}`);
  assert.equal(restoredImage.status, 200);
  assert.equal(restoredImage.headers.get("content-type"), "image/png");

  console.log("PASS task guide API, snapshot, scope, upload safety and restart persistence checks");
} finally {
  await stopServer();
  await rm(runtime, { recursive: true, force: true });
}
