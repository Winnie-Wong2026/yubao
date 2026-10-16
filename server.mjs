import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.YUBAO_DATA_DIR ? path.resolve(process.env.YUBAO_DATA_DIR) : path.join(root, "product", "data");
const uploadDir = process.env.YUBAO_UPLOAD_DIR ? path.resolve(process.env.YUBAO_UPLOAD_DIR) : path.join(root, "product", "uploads");
const stateFile = path.join(dataDir, "state.json");
const desiredPort = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const parentTokens = new Set();
const completionSubmissionWindows = new Map();
let stateMutation = Promise.resolve();
const DATA_SCHEMA_VERSION = 7;
const PRODUCT_VERSION = "1.2.6";
const RELEASE_CHANNEL = "family-preview";

const initialFamily = {
  name: process.env.YUBAO_FAMILY_NAME || "聿宝家庭",
  code: process.env.YUBAO_FAMILY_CODE || "381624",
  pin: process.env.YUBAO_PARENT_PIN || "2580",
  childName: process.env.YUBAO_CHILD_NAME || "聿宝",
  childGrade: process.env.YUBAO_CHILD_GRADE || "小学二年级"
};

const ASSET = {
  characterDefault: "/assets/02_人物完整套装/character_yubao_default_learning_v01.png",
  characterReading: "/assets/02_人物完整套装/character_yubao_reading_v01.png",
  characterSpace: "/assets/02_人物完整套装/character_yubao_space_v01.png",
  characterSweetMagic: "/assets/02_人物完整套装/character_yubao_sweet_magic_v01.png",
  characterMagicAcademy: "/assets/02_人物完整套装/character_yubao_magic_academy_v03.png",
  backgroundDefault: "/assets/03_背景完整主题/background_starlight_attic_v01.png",
  backgroundForest: "/assets/03_背景完整主题/background_forest_reading_station_v01.png",
  backgroundSpace: "/assets/03_背景完整主题/background_space_observatory_v01.png",
  backgroundSweetMagic: "/assets/03_背景完整主题/background_sweet_magic_house_v01.png",
  backgroundMagicAcademy: "/assets/03_背景完整主题/background_magic_academy_night_v01.png",
  petCat: "/assets/04_宠物完整形象/pet_starcat_default_v01.png",
  petRabbit: "/assets/04_宠物完整形象/pet_moonrabbit_v01.png",
  petFox: "/assets/04_宠物完整形象/pet_leaffox_v01.png",
  rewardOutdoor: "/assets/06_现实奖励类别图标/reward_category_outdoor_activity_v01.png",
  rewardStory: "/assets/06_现实奖励类别图标/reward_category_story_reading_v01.png",
  rewardScreen: "/assets/06_现实奖励类别图标/reward_category_screen_entertainment_v01.png"
};

function now() {
  return new Date().toISOString();
}

function chinaDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function taskDaySnapshot(task, existing = {}) {
  return {
    id: existing.id || `${task.id}:${task.activeDate}`,
    taskId: task.id,
    date: task.activeDate,
    title: task.title,
    subject: task.subject,
    scheduleType: task.scheduleType,
    description: task.description,
    photoPolicy: task.photoPolicy,
    reward: task.reward,
    due: task.due,
    status: task.status,
    submittedAt: task.submittedAt,
    confirmedAt: task.confirmedAt,
    redoReason: task.redoReason,
    guideImage: structuredClone(task.guideImage || null),
    submissionAttempts: structuredClone(task.submissionAttempts || []),
    earnedCoins: task.status === "done" && task.coinIssued ? task.reward : 0,
    createdAt: existing.createdAt || task.createdAt,
    updatedAt: task.updatedAt || task.confirmedAt || task.submittedAt || task.createdAt
  };
}

function syncTaskDayRecord(state, task) {
  const existing = state.taskDayRecords.find((record) => record.taskId === task.id && record.date === task.activeDate);
  const next = taskDaySnapshot(task, existing);
  if (!existing) {
    state.taskDayRecords.push(next);
    return true;
  }
  const changed = Object.keys(next).some((key) => JSON.stringify(existing[key]) !== JSON.stringify(next[key]));
  if (changed) Object.assign(existing, next);
  return changed;
}

function createSeedState() {
  return {
    version: DATA_SCHEMA_VERSION,
    productVersion: PRODUCT_VERSION,
    releaseChannel: RELEASE_CHANNEL,
    updatedAt: now(),
    family: {
      name: initialFamily.name,
      code: initialFamily.code,
      pin: initialFamily.pin,
      child: { id: "child_yubao", name: initialFamily.childName, grade: initialFamily.childGrade }
    },
    wallet: { balance: 0, frozen: 0 },
    equipped: {
      character: "digital_character_default",
      background: "digital_background_default",
      pet: "digital_pet_cat"
    },
    tasks: [],
    taskDayRecords: [],
    digitalRewards: [
      { id: "digital_character_default", type: "character", name: "默认学习套装", description: "聿宝的默认完整人物套装。", price: 0, staticUrl: ASSET.characterDefault, motionUrl: "", mediaMode: "static", active: true, owned: true, createdAt: now() },
      { id: "digital_character_reading", type: "character", name: "阅读小达人", description: "适合阅读和探索故事的完整人物套装。", price: 100, staticUrl: ASSET.characterReading, motionUrl: "", mediaMode: "static", active: true, owned: false, createdAt: now() },
      { id: "digital_character_space", type: "character", name: "星际探索", description: "完整星际探索人物套装。", price: 100, staticUrl: ASSET.characterSpace, motionUrl: "", mediaMode: "static", active: true, owned: false, createdAt: now() },
      { id: "digital_character_sweet_magic", type: "character", name: "奇妙萌可·甜心魔法套装", description: "穿上彩虹甜心礼服，开启闪闪发亮的学习冒险。", price: 90, staticUrl: ASSET.characterSweetMagic, motionUrl: "", mediaMode: "static", active: true, owned: false, createdAt: now() },
      { id: "digital_character_magic_academy", type: "character", name: "哈利波特·魔法学院套装", description: "戴上魔法帽，围好学院围巾，带着勇气和好奇探索新知识。", price: 110, staticUrl: ASSET.characterMagicAcademy, motionUrl: "", mediaMode: "static", active: true, owned: false, createdAt: now() },
      { id: "digital_background_default", type: "background", name: "星光阁楼", description: "温暖的默认星球背景。", price: 0, staticUrl: ASSET.backgroundDefault, motionUrl: "", mediaMode: "static", active: true, owned: true, createdAt: now() },
      { id: "digital_background_forest", type: "background", name: "森林阅读站", description: "整张替换的森林阅读主题。", price: 60, staticUrl: ASSET.backgroundForest, motionUrl: "", mediaMode: "static", active: true, owned: false, createdAt: now() },
      { id: "digital_background_space", type: "background", name: "星际观察站", description: "整张替换的星际观察主题。", price: 90, staticUrl: ASSET.backgroundSpace, motionUrl: "", mediaMode: "static", active: true, owned: false, createdAt: now() },
      { id: "digital_background_sweet_magic", type: "background", name: "奇妙萌可·彩虹魔法屋", description: "住进明亮的彩虹魔法屋，让学习时间甜甜亮亮。", price: 70, staticUrl: ASSET.backgroundSweetMagic, motionUrl: "", mediaMode: "static", active: true, owned: false, createdAt: now() },
      { id: "digital_background_magic_academy", type: "background", name: "哈利波特·星夜魔法学院", description: "走进月光、星盘和古老书架陪伴的魔法课堂。", price: 100, staticUrl: ASSET.backgroundMagicAcademy, motionUrl: "", mediaMode: "static", active: true, owned: false, createdAt: now() },
      { id: "digital_pet_cat", type: "pet", name: "星星猫", description: "默认陪伴伙伴。", price: 0, staticUrl: ASSET.petCat, motionUrl: "", mediaMode: "static", active: true, owned: true, createdAt: now() },
      { id: "digital_pet_rabbit", type: "pet", name: "月光兔", description: "安静温柔的月光兔伙伴。", price: 50, staticUrl: ASSET.petRabbit, motionUrl: "", mediaMode: "static", active: true, owned: false, createdAt: now() },
      { id: "digital_pet_fox", type: "pet", name: "叶芽狐", description: "喜欢探索的叶芽狐伙伴。", price: 50, staticUrl: ASSET.petFox, motionUrl: "", mediaMode: "static", active: true, owned: false, createdAt: now() }
    ],
    realRewards: [
      { id: "real_outdoor", name: "周末去公园", category: "户外活动", description: "周末和家人一起去公园散步、玩耍。", price: 60, remaining: 2, validUntil: "2026-12-31", cooldownDays: 0, note: "下雨时可和孩子商量改期。", imageSource: "built_in", imageAssetId: "reward_category_outdoor_activity_v01", imageUrl: ASSET.rewardOutdoor, active: true, createdAt: now() },
      { id: "real_story", name: "选择今晚的故事", category: "故事阅读", description: "今晚由你选择睡前故事。", price: 30, remaining: 3, validUntil: "2026-12-31", cooldownDays: 0, note: "", imageSource: "built_in", imageAssetId: "reward_category_story_reading_v01", imageUrl: ASSET.rewardStory, active: true, createdAt: now() },
      { id: "real_screen", name: "周六看一场电影", category: "屏幕娱乐", description: "周六一起选择一部家庭电影。", price: 100, remaining: 1, validUntil: "2026-12-31", cooldownDays: 7, note: "", imageSource: "built_in", imageAssetId: "reward_category_screen_entertainment_v01", imageUrl: ASSET.rewardScreen, active: true, createdAt: now() }
    ],
    redemptions: [],
    ledger: []
  };
}

function clearUsageData(state) {
  const equipped = {
    character: "digital_character_default",
    background: "digital_background_default",
    pet: "digital_pet_cat"
  };
  const defaultRewardIds = new Set(Object.values(equipped));
  return {
    ...structuredClone(state),
    version: DATA_SCHEMA_VERSION,
    productVersion: PRODUCT_VERSION,
    releaseChannel: RELEASE_CHANNEL,
    updatedAt: now(),
    wallet: { balance: 0, frozen: 0 },
    equipped,
    tasks: [],
    taskDayRecords: [],
    digitalRewards: state.digitalRewards.map((reward) => ({ ...reward, owned: defaultRewardIds.has(reward.id) })),
    redemptions: [],
    ledger: []
  };
}

async function ensureData() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(uploadDir, { recursive: true });
  try {
    await fs.access(stateFile);
  } catch {
    await writeState(createSeedState());
  }
}

async function readState() {
  const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
  const today = chinaDayKey();
  let changed = false;

  if (state.version !== DATA_SCHEMA_VERSION) { state.version = DATA_SCHEMA_VERSION; changed = true; }
  if (state.productVersion !== PRODUCT_VERSION) { state.productVersion = PRODUCT_VERSION; changed = true; }
  if (state.releaseChannel !== RELEASE_CHANNEL) { state.releaseChannel = RELEASE_CHANNEL; changed = true; }
  if (!Array.isArray(state.taskDayRecords)) { state.taskDayRecords = []; changed = true; }

  for (const record of state.taskDayRecords) {
    if (!Object.prototype.hasOwnProperty.call(record, "description")) { record.description = ""; changed = true; }
    if (!["none", "optional", "required"].includes(record.photoPolicy)) { record.photoPolicy = "none"; changed = true; }
    if (!Array.isArray(record.submissionAttempts)) {
      record.submissionAttempts = legacySubmissionAttempts(record);
      changed = true;
    } else if (repairSubmissionAttempts(record)) changed = true;
  }

  for (const task of state.tasks) {
    if (!task.subject) { task.subject = task.title.includes("阅读") ? "阅读" : "其他"; changed = true; }
    if (!task.scheduleType) { task.scheduleType = "once"; changed = true; }
    if (!task.activeDate) { task.activeDate = today; changed = true; }
    if (!Object.prototype.hasOwnProperty.call(task, "guideImage")) { task.guideImage = null; changed = true; }
    if (!["none", "optional", "required"].includes(task.photoPolicy)) { task.photoPolicy = "optional"; changed = true; }
    if (!Array.isArray(task.submissionAttempts)) {
      task.submissionAttempts = legacySubmissionAttempts(task);
      changed = true;
    } else if (repairSubmissionAttempts(task)) changed = true;
    if (task.nextDailyConfig && !Object.prototype.hasOwnProperty.call(task.nextDailyConfig, "guideImage")) {
      task.nextDailyConfig.guideImage = structuredClone(task.guideImage || null);
      changed = true;
    }
    if (task.scheduleType === "daily" && !task.dailyConfig) {
      task.dailyConfig = taskConfigFromTask(task);
      changed = true;
    }
    if (task.dailyConfig && !Object.prototype.hasOwnProperty.call(task.dailyConfig, "guideImage")) {
      task.dailyConfig.guideImage = structuredClone(task.guideImage || null);
      changed = true;
    }
    if (task.dailyConfig && !["none", "optional", "required"].includes(task.dailyConfig.photoPolicy)) {
      task.dailyConfig.photoPolicy = task.photoPolicy;
      changed = true;
    }
    if (task.nextDailyConfig && !["none", "optional", "required"].includes(task.nextDailyConfig.photoPolicy)) {
      task.nextDailyConfig.photoPolicy = task.photoPolicy;
      changed = true;
    }

    changed = syncTaskDayRecord(state, task) || changed;

    if (task.scheduleType === "daily" && task.activeDate !== today && task.status !== "pending") {
      const nextConfig = task.nextDailyConfig || task.dailyConfig || taskConfigFromTask(task);
      const nextUpdatedAt = task.nextDailyConfig?.updatedAt || now();
      applyTaskConfig(task, nextConfig);
      if (nextConfig.scheduleType === "daily") task.dailyConfig = taskConfigFromTask(task);
      else delete task.dailyConfig;
      delete task.nextDailyConfig;
      task.activeDate = today;
      task.status = "todo";
      task.submittedAt = null;
      task.confirmedAt = null;
      task.redoReason = "";
      task.coinIssued = false;
      task.submissionAttempts = [];
      task.updatedAt = nextUpdatedAt;
      changed = true;
      changed = syncTaskDayRecord(state, task) || changed;
    }
  }

  for (const reward of state.digitalRewards || []) {
    if (!Object.prototype.hasOwnProperty.call(reward, "motionUrl")) {
      reward.motionUrl = "";
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(reward, "motionSafariUrl")) {
      reward.motionSafariUrl = "";
      changed = true;
    }
    if (!["static", "motion"].includes(reward.mediaMode)) {
      reward.mediaMode = reward.motionUrl || reward.motionSafariUrl ? "motion" : "static";
      changed = true;
    }
    if (reward.mediaMode === "motion" && !reward.motionUrl && !reward.motionSafariUrl) {
      reward.mediaMode = "static";
      changed = true;
    }
  }

  if (changed) await writeState(state);
  return state;
}

async function writeState(state) {
  state.updatedAt = now();
  const temporary = `${stateFile}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await fs.rename(temporary, stateFile);
}

function mutateState(mutator) {
  const operation = stateMutation.then(mutator, mutator);
  stateMutation = operation.catch(() => {});
  return operation;
}

function publicState(state) {
  const copy = structuredClone(state);
  delete copy.family.pin;
  copy.wallet.available = copy.wallet.balance - copy.wallet.frozen;
  copy.today = chinaDayKey();
  return copy;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function readJson(request, maxBytes = 12 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isParent(request) {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") && parentTokens.has(header.slice(7));
}

function requireText(value, name, max = 120) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name}不能为空`);
  if (text.length > max) throw new Error(`${name}过长`);
  return text;
}

function requirePrice(value, name = "星币价格") {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 9999) throw new Error(`${name}必须是 0-9999 的整数`);
  return number;
}

function normalizeMediaMode(value, motionUrl = "", motionSafariUrl = "") {
  const mode = value === "motion" ? "motion" : "static";
  return mode === "motion" && (motionUrl || motionSafariUrl) ? "motion" : "static";
}

function detectUploadMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return buffer.toString("ascii", 8, 12) === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return "video/webm";
  return "";
}

function imageDimensions(buffer, mimeType) {
  if (mimeType === "image/png" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  if (mimeType === "image/webp" && buffer.length >= 30) {
    const kind = buffer.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
    if (kind === "VP8 " && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (kind === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
      const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
      return { width: 1 + (b1 | ((b2 & 0x3f) << 8)), height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)) };
    }
  }
  return { width: 0, height: 0 };
}

function completionSubmissionAllowed(request) {
  const key = request.socket.remoteAddress || "local";
  const cutoff = Date.now() - 60_000;
  const recent = (completionSubmissionWindows.get(key) || []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= 12) return false;
  recent.push(Date.now());
  completionSubmissionWindows.set(key, recent);
  return true;
}

function decodeCompletionPhoto(body) {
  if (!body.dataUrl) return null;
  const match = String(body.dataUrl).match(/^data:([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("照片没有读完整，请重新选择");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 6 * 1024 * 1024) throw new Error("照片太大了，请重新拍一张或换一张");
  const mimeType = detectUploadMime(buffer);
  if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType) || mimeType !== match[1].toLowerCase()) {
    throw new Error("这张照片暂时打不开，请重新拍一张或从相册换一张");
  }
  const extension = path.extname(String(body.name || "")).slice(1).toLowerCase();
  const allowedExtensions = {
    "image/png": ["png"],
    "image/jpeg": ["jpg", "jpeg"],
    "image/webp": ["webp"]
  }[mimeType];
  if (extension && !allowedExtensions.includes(extension)) throw new Error("这张照片暂时打不开，请重新拍一张或从相册换一张");
  const dimensions = imageDimensions(buffer, mimeType);
  if (!dimensions.width || !dimensions.height || dimensions.width > 10000 || dimensions.height > 10000) {
    throw new Error("这张照片暂时打不开，请重新拍一张或从相册换一张");
  }
  return { buffer, mimeType, ...dimensions };
}

function uploadUrlFileName(url) {
  const match = String(url || "").match(/^\/product\/uploads\/([A-Za-z0-9.-]+)$/);
  return match?.[1] || "";
}

function hasUploadReference(value, url) {
  if (value === url) return true;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((entry) => hasUploadReference(entry, url));
}

function legacySubmissionAttempts(source) {
  if (!source?.submittedAt) return [];
  const decision = source.status === "pending" ? "pending" : source.status === "done" ? "confirmed" : "redo";
  return [{
    id: crypto.randomUUID(),
    submittedAt: source.submittedAt,
    completionPhoto: null,
    decision,
    decidedAt: decision === "pending" ? null : (source.confirmedAt || source.updatedAt || source.submittedAt),
    redoReason: decision === "redo" ? String(source.redoReason || "") : ""
  }];
}

function repairSubmissionAttempts(source) {
  let changed = false;
  const fallbackDecision = source.status === "done" ? "confirmed" : source.status === "redo" ? "redo" : "pending";
  for (let index = 0; index < source.submissionAttempts.length; index += 1) {
    let attempt = source.submissionAttempts[index];
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) {
      attempt = {};
      source.submissionAttempts[index] = attempt;
      changed = true;
    }
    if (!attempt.id) { attempt.id = crypto.randomUUID(); changed = true; }
    if (!attempt.submittedAt) { attempt.submittedAt = source.submittedAt || source.createdAt || now(); changed = true; }
    if (!Object.prototype.hasOwnProperty.call(attempt, "completionPhoto")) { attempt.completionPhoto = null; changed = true; }
    if (!["pending", "confirmed", "redo"].includes(attempt.decision)) { attempt.decision = fallbackDecision; changed = true; }
    if (!Object.prototype.hasOwnProperty.call(attempt, "decidedAt")) {
      attempt.decidedAt = attempt.decision === "pending" ? null : (source.confirmedAt || source.updatedAt || attempt.submittedAt);
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(attempt, "redoReason")) {
      attempt.redoReason = attempt.decision === "redo" ? String(source.redoReason || "") : "";
      changed = true;
    }
    if (attempt.completionPhoto && typeof attempt.completionPhoto === "object") {
      if (!attempt.completionPhoto.thumbnailUrl && attempt.completionPhoto.url) { attempt.completionPhoto.thumbnailUrl = attempt.completionPhoto.url; changed = true; }
      if (!attempt.completionPhoto.updatedAt) { attempt.completionPhoto.updatedAt = attempt.submittedAt; changed = true; }
    }
  }
  return changed;
}

function latestPendingAttempt(task) {
  return [...(task.submissionAttempts || [])].reverse().find((attempt) => attempt.decision === "pending");
}

function collectCompletionPhotoUrls(value, urls = new Set()) {
  if (!value || typeof value !== "object") return urls;
  if (value.completionPhoto?.url) urls.add(value.completionPhoto.url);
  for (const entry of Object.values(value)) collectCompletionPhotoUrls(entry, urls);
  return urls;
}

async function removeUnusedCompletionPhotos(state, candidates) {
  await Promise.all([...candidates].map(async (url) => {
    if (hasUploadReference(state, url)) return;
    const fileName = uploadUrlFileName(url);
    if (!fileName?.startsWith("task-completion-")) return;
    await fs.unlink(path.join(uploadDir, fileName)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }));
}

function normalizeTaskGuideImage(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("任务提示图信息无效");
  const url = requireText(value.url, "任务提示图", 500);
  if (!/^\/product\/uploads\/[A-Za-z0-9.-]+\.(?:png|jpe?g|webp)$/i.test(url)) throw new Error("任务提示图地址无效");
  const mimeType = requireText(value.mimeType, "任务提示图格式", 40).toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) throw new Error("任务提示图格式无效");
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isInteger(width) || width < 1 || width > 10000 || !Number.isInteger(height) || height < 1 || height > 10000) {
    throw new Error("任务提示图尺寸无效");
  }
  return {
    url,
    thumbnailUrl: url,
    mimeType,
    width,
    height,
    updatedAt: String(value.updatedAt || now()).slice(0, 40)
  };
}

function taskConfigFromTask(task) {
  return {
    title: task.title,
    subject: task.subject,
    scheduleType: task.scheduleType,
    description: task.description,
    photoPolicy: task.photoPolicy,
    reward: task.reward,
    due: task.due,
    guideImage: structuredClone(task.guideImage || null)
  };
}

function taskConfigFromPayload(payload, fallbackTask = null) {
  const photoPolicy = Object.prototype.hasOwnProperty.call(payload, "photoPolicy")
    ? payload.photoPolicy
    : (fallbackTask?.photoPolicy || "optional");
  if (!["optional", "required", "none"].includes(photoPolicy)) throw new Error("完成照片规则无效");
  return {
    title: requireText(payload.title, "任务名称", 40),
    subject: requireText(payload.subject || "其他", "学科", 12),
    scheduleType: ["once", "daily"].includes(payload.scheduleType) ? payload.scheduleType : "once",
    description: requireText(payload.description, "任务说明", 200),
    photoPolicy,
    reward: requirePrice(payload.reward, "任务奖励"),
    due: requireText(payload.due || "今天完成", "完成时间", 40),
    guideImage: Object.prototype.hasOwnProperty.call(payload, "guideImage")
      ? normalizeTaskGuideImage(payload.guideImage)
      : structuredClone(fallbackTask?.guideImage || null)
  };
}

function applyTaskConfig(task, config) {
  task.title = config.title;
  task.subject = config.subject;
  task.scheduleType = config.scheduleType;
  task.description = config.description;
  task.photoPolicy = config.photoPolicy;
  task.reward = config.reward;
  task.due = config.due;
  task.guideImage = structuredClone(config.guideImage || null);
}

function submitTaskState(state, task, completionPhoto = null) {
  if (!["todo", "redo"].includes(task.status)) throw new Error("这个任务已经提交，请不要重复操作");
  if (task.photoPolicy === "required" && !completionPhoto) throw new Error("这个任务需要先拍一张完成照片");
  if (task.photoPolicy === "none" && completionPhoto) throw new Error("这个任务不用添加照片");
  const submittedAt = now();
  const attempt = {
    id: crypto.randomUUID(),
    submittedAt,
    completionPhoto: structuredClone(completionPhoto || null),
    decision: "pending",
    decidedAt: null,
    redoReason: ""
  };
  if (!Array.isArray(task.submissionAttempts)) task.submissionAttempts = [];
  task.submissionAttempts.push(attempt);
  task.status = "pending";
  task.submittedAt = submittedAt;
  task.confirmedAt = null;
  task.redoReason = "";
  task.updatedAt = submittedAt;
  syncTaskDayRecord(state, task);
  return attempt;
}

function findById(list, id, label) {
  const item = list.find((entry) => entry.id === id);
  if (!item) throw new Error(`${label}不存在`);
  return item;
}

function addLedger(state, { type, title, delta = 0, frozenDelta = 0, referenceId = "" }) {
  state.ledger.unshift({
    id: crypto.randomUUID(), type, title, delta, frozenDelta, referenceId,
    balanceAfter: state.wallet.balance,
    frozenAfter: state.wallet.frozen,
    createdAt: now()
  });
}

const parentActions = new Set([
  "createTask", "updateTask", "confirmTask", "redoTask", "createDigitalReward", "updateDigitalReward", "toggleDigitalReward",
  "createRealReward", "updateRealReward", "toggleRealReward", "decideRealReward", "fulfillRealReward", "reset"
]);

async function applyAction(state, type, payload) {
  if (type === "reset") {
    return clearUsageData(state);
  }

  if (type === "createTask") {
    const config = taskConfigFromPayload(payload);
    const task = {
      id: crypto.randomUUID(),
      ...config,
      activeDate: chinaDayKey(),
      status: "todo", createdAt: now(), submittedAt: null, confirmedAt: null, redoReason: "", coinIssued: false,
      submissionAttempts: []
    };
    if (task.scheduleType === "daily") task.dailyConfig = taskConfigFromTask(task);
    state.tasks.unshift(task);
    syncTaskDayRecord(state, task);
    return state;
  }

  if (type === "updateTask") {
    const task = findById(state.tasks, payload.id, "任务");
    const editNextDay = task.status === "done" && task.scheduleType === "daily";
    if (!["todo", "redo"].includes(task.status) && !editNextDay) throw new Error(task.status === "pending" ? "孩子已经提交，请先处理后再修改" : "已确认的一次任务保留原记录，不能修改");
    const config = taskConfigFromPayload(payload, task);
    const requestedScope = ["today", "future"].includes(payload.editScope) ? payload.editScope : "today_and_future";
    if (requestedScope === "future" && task.scheduleType !== "daily") throw new Error("只有每天重复任务可以从明天起修改");

    if (editNextDay || requestedScope === "future") {
      task.nextDailyConfig = { ...config, updatedAt: now() };
      task.updatedAt = now();
      return state;
    }

    if (task.scheduleType === "daily" && requestedScope === "today") config.scheduleType = "daily";
    applyTaskConfig(task, config);
    if (requestedScope === "today_and_future") {
      if (task.scheduleType === "daily") task.dailyConfig = taskConfigFromTask(task);
      else delete task.dailyConfig;
      delete task.nextDailyConfig;
    }
    task.updatedAt = now();
    syncTaskDayRecord(state, task);
    return state;
  }

  if (type === "submitTask") {
    const task = findById(state.tasks, payload.id, "任务");
    submitTaskState(state, task, null);
    return state;
  }

  if (type === "confirmTask") {
    const task = findById(state.tasks, payload.id, "任务");
    if (task.status !== "pending") throw new Error("当前任务不在待确认状态");
    const attempt = latestPendingAttempt(task);
    if (!attempt) throw new Error("没有找到孩子本次提交记录");
    task.status = "done";
    task.confirmedAt = now();
    task.updatedAt = task.confirmedAt;
    attempt.decision = "confirmed";
    attempt.decidedAt = task.confirmedAt;
    if (!task.coinIssued) {
      task.coinIssued = true;
      state.wallet.balance += task.reward;
      addLedger(state, { type: "task_reward", title: task.title, delta: task.reward, referenceId: task.id });
    }
    syncTaskDayRecord(state, task);
    return state;
  }

  if (type === "redoTask") {
    const task = findById(state.tasks, payload.id, "任务");
    if (task.status !== "pending") throw new Error("当前任务不在待确认状态");
    const attempt = latestPendingAttempt(task);
    if (!attempt) throw new Error("没有找到孩子本次提交记录");
    task.status = "redo";
    task.redoReason = requireText(payload.reason, "需要再完成的说明", 120);
    task.updatedAt = now();
    attempt.decision = "redo";
    attempt.decidedAt = task.updatedAt;
    attempt.redoReason = task.redoReason;
    syncTaskDayRecord(state, task);
    return state;
  }

  if (type === "createDigitalReward") {
    if (!["character", "background", "pet"].includes(payload.rewardType)) throw new Error("数字奖励类型无效");
    const staticUrl = requireText(payload.staticUrl, "核心静态图", 500);
    const motionUrl = String(payload.motionUrl || "").slice(0, 500);
    const motionSafariUrl = String(payload.motionSafariUrl || "").slice(0, 500);
    state.digitalRewards.push({
      id: crypto.randomUUID(), type: payload.rewardType,
      name: requireText(payload.name, "奖励名称", 40),
      description: requireText(payload.description, "孩子可见说明", 160),
      price: requirePrice(payload.price), staticUrl,
      motionUrl, motionSafariUrl, mediaMode: normalizeMediaMode(payload.mediaMode, motionUrl, motionSafariUrl), active: payload.active !== false,
      owned: false, createdAt: now()
    });
    return state;
  }

  if (type === "updateDigitalReward") {
    const reward = findById(state.digitalRewards, payload.id, "数字奖励");
    reward.name = requireText(payload.name, "奖励名称", 40);
    reward.description = requireText(payload.description, "孩子可见说明", 160);
    reward.price = requirePrice(payload.price);
    reward.staticUrl = requireText(payload.staticUrl || reward.staticUrl, "核心静态图", 500);
    reward.motionUrl = payload.clearMotion ? "" : String(payload.motionUrl ?? reward.motionUrl).slice(0, 500);
    reward.motionSafariUrl = payload.clearSafariMotion ? "" : String(payload.motionSafariUrl ?? reward.motionSafariUrl ?? "").slice(0, 500);
    reward.mediaMode = normalizeMediaMode(payload.mediaMode ?? reward.mediaMode, reward.motionUrl, reward.motionSafariUrl);
    reward.active = payload.active !== false;
    reward.updatedAt = now();
    return state;
  }

  if (type === "toggleDigitalReward") {
    const reward = findById(state.digitalRewards, payload.id, "数字奖励");
    reward.active = Boolean(payload.active);
    return state;
  }

  if (type === "purchaseDigital") {
    const reward = findById(state.digitalRewards, payload.id, "数字奖励");
    if (!reward.active || reward.owned) throw new Error("当前奖励不能兑换");
    if (state.wallet.balance - state.wallet.frozen < reward.price) throw new Error("可用星币不足");
    state.wallet.balance -= reward.price;
    reward.owned = true;
    state.redemptions.unshift({ id: crypto.randomUUID(), kind: "digital", rewardId: reward.id, rewardName: reward.name, amount: reward.price, status: "completed", createdAt: now(), updatedAt: now() });
    addLedger(state, { type: "digital_purchase", title: reward.name, delta: -reward.price, referenceId: reward.id });
    return state;
  }

  if (type === "equipDigital") {
    const reward = findById(state.digitalRewards, payload.id, "数字奖励");
    if (!reward.owned) throw new Error("请先兑换该奖励");
    state.equipped[reward.type] = reward.id;
    return state;
  }

  if (type === "createRealReward") {
    state.realRewards.push({
      id: crypto.randomUUID(), name: requireText(payload.name, "奖励名称", 40),
      category: requireText(payload.category, "奖励类别", 30),
      description: requireText(payload.description, "孩子可见说明", 180),
      price: requirePrice(payload.price), remaining: requirePrice(payload.remaining, "可兑换次数"),
      validUntil: requireText(payload.validUntil, "有效期", 20), cooldownDays: requirePrice(payload.cooldownDays || 0, "兑换间隔"),
      note: String(payload.note || "").slice(0, 200), imageSource: payload.imageSource === "custom_upload" ? "custom_upload" : "built_in",
      imageAssetId: String(payload.imageAssetId || ""), imageUrl: requireText(payload.imageUrl, "奖励配图", 500),
      active: payload.active !== false, createdAt: now()
    });
    return state;
  }

  if (type === "updateRealReward") {
    const reward = findById(state.realRewards, payload.id, "现实奖励");
    reward.name = requireText(payload.name, "奖励名称", 40);
    reward.category = requireText(payload.category, "奖励类别", 30);
    reward.description = requireText(payload.description, "孩子可见说明", 180);
    reward.price = requirePrice(payload.price);
    reward.remaining = requirePrice(payload.remaining, "可兑换次数");
    reward.validUntil = requireText(payload.validUntil, "有效期", 20);
    reward.cooldownDays = requirePrice(payload.cooldownDays || 0, "兑换间隔");
    reward.note = String(payload.note || "").slice(0, 200);
    reward.imageSource = payload.imageSource === "custom_upload" ? "custom_upload" : "built_in";
    reward.imageAssetId = String(payload.imageAssetId || "").slice(0, 120);
    reward.imageUrl = requireText(payload.imageUrl || reward.imageUrl, "奖励配图", 500);
    reward.active = payload.active !== false;
    reward.updatedAt = now();
    return state;
  }

  if (type === "toggleRealReward") {
    const reward = findById(state.realRewards, payload.id, "现实奖励");
    reward.active = Boolean(payload.active);
    return state;
  }

  if (type === "requestRealReward") {
    const reward = findById(state.realRewards, payload.id, "现实奖励");
    if (!reward.active || reward.remaining < 1) throw new Error("当前奖励不能申请");
    if (state.redemptions.some((entry) => entry.kind === "real" && entry.rewardId === reward.id && ["pending", "approved"].includes(entry.status))) throw new Error("已有同一奖励正在处理中");
    if (state.wallet.balance - state.wallet.frozen < reward.price) throw new Error("可用星币不足");
    state.wallet.frozen += reward.price;
    const redemption = { id: crypto.randomUUID(), kind: "real", rewardId: reward.id, rewardName: reward.name, amount: reward.price, imageUrl: reward.imageUrl, status: "pending", createdAt: now(), updatedAt: now() };
    state.redemptions.unshift(redemption);
    addLedger(state, { type: "real_freeze", title: reward.name, frozenDelta: reward.price, referenceId: redemption.id });
    return state;
  }

  if (type === "decideRealReward") {
    const redemption = findById(state.redemptions, payload.id, "兑换申请");
    if (redemption.kind !== "real" || redemption.status !== "pending") throw new Error("当前申请不能处理");
    if (payload.decision === "approve") {
      redemption.status = "approved";
      redemption.parentNote = String(payload.reason || "").slice(0, 120);
    } else if (payload.decision === "reject") {
      redemption.status = "rejected";
      redemption.parentNote = requireText(payload.reason || "这次暂不兑换", "不同意原因", 120);
      state.wallet.frozen = Math.max(0, state.wallet.frozen - redemption.amount);
      addLedger(state, { type: "real_refund", title: redemption.rewardName, frozenDelta: -redemption.amount, referenceId: redemption.id });
    } else {
      throw new Error("处理决定无效");
    }
    redemption.updatedAt = now();
    return state;
  }

  if (type === "fulfillRealReward") {
    const redemption = findById(state.redemptions, payload.id, "兑换申请");
    if (redemption.kind !== "real" || redemption.status !== "approved") throw new Error("当前奖励不能确认兑现");
    const reward = findById(state.realRewards, redemption.rewardId, "现实奖励");
    state.wallet.frozen = Math.max(0, state.wallet.frozen - redemption.amount);
    state.wallet.balance = Math.max(0, state.wallet.balance - redemption.amount);
    reward.remaining = Math.max(0, reward.remaining - 1);
    redemption.status = "fulfilled";
    redemption.updatedAt = now();
    addLedger(state, { type: "real_fulfilled", title: redemption.rewardName, delta: -redemption.amount, frozenDelta: -redemption.amount, referenceId: redemption.id });
    return state;
  }

  throw new Error("未知操作");
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/healthz") return sendJson(response, 200, { ok: true });

  if (request.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(request);
    const state = await readState();
    if (String(body.pin || "") !== state.family.pin) return sendJson(response, 401, { error: "PIN 不正确" });
    const token = crypto.randomBytes(24).toString("hex");
    parentTokens.add(token);
    return sendJson(response, 200, { token, family: publicState(state).family });
  }

  if (request.method === "GET" && url.pathname === "/api/session") {
    if (!isParent(request)) return sendJson(response, 401, { error: "家长验证已失效" });
    return sendJson(response, 200, { authenticated: true });
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    return sendJson(response, 200, publicState(await readState()));
  }

  if (request.method === "POST" && url.pathname === "/api/task-submissions") {
    if (!completionSubmissionAllowed(request)) return sendJson(response, 429, { error: "操作有点快，请稍等一会再试" });
    const body = await readJson(request, 9 * 1024 * 1024);
    return mutateState(async () => {
      const state = await readState();
      const task = findById(state.tasks, body.taskId, "任务");
      if (!["todo", "redo"].includes(task.status)) throw new Error("这个任务已经提交，请刷新后看看");
      if (task.photoPolicy === "required" && !body.dataUrl) throw new Error("请先拍一张完成照片");
      if (task.photoPolicy === "none" && body.dataUrl) throw new Error("这个任务不用添加照片");
      let fileName = "";
      try {
        const decoded = decodeCompletionPhoto(body);
        let completionPhoto = null;
        if (decoded) {
          const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[decoded.mimeType];
          fileName = `task-completion-${Date.now()}-${crypto.randomBytes(5).toString("hex")}.${extension}`;
          await fs.writeFile(path.join(uploadDir, fileName), decoded.buffer);
          completionPhoto = {
            url: `/product/uploads/${fileName}`,
            thumbnailUrl: `/product/uploads/${fileName}`,
            mimeType: decoded.mimeType,
            width: decoded.width,
            height: decoded.height,
            updatedAt: now()
          };
        }
        submitTaskState(state, task, completionPhoto);
        await writeState(state);
        return sendJson(response, 200, publicState(state));
      } catch (error) {
        if (fileName) await fs.unlink(path.join(uploadDir, fileName)).catch(() => {});
        if (error?.code) throw new Error("这次没有提交成功，请再试一次");
        throw error;
      }
    });
  }

  if (request.method === "POST" && url.pathname === "/api/upload") {
    if (!isParent(request)) return sendJson(response, 401, { error: "请先通过家长验证" });
    const body = await readJson(request, 96 * 1024 * 1024);
    const match = String(body.dataUrl || "").match(/^data:([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return sendJson(response, 400, { error: "文件内容无法识别" });
    const buffer = Buffer.from(match[2], "base64");
    const mimeType = detectUploadMime(buffer);
    const allowedMimeTypes = ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm", "video/quicktime"];
    if (!mimeType || !allowedMimeTypes.includes(mimeType) || mimeType !== match[1].toLowerCase()) {
      return sendJson(response, 400, { error: "文件实际格式与扩展信息不一致" });
    }
    const originalExtension = path.extname(String(body.name || "")).slice(1).toLowerCase();
    const allowedExtensions = {
      "image/png": ["png"],
      "image/jpeg": ["jpg", "jpeg"],
      "image/webp": ["webp"],
      "video/mp4": ["mp4", "m4v"],
      "video/webm": ["webm"],
      "video/quicktime": ["mov", "qt"]
    }[mimeType];
    if (!allowedExtensions.includes(originalExtension)) {
      return sendJson(response, 400, { error: "文件扩展名与实际格式不一致" });
    }
    const isTaskGuide = body.purpose === "task_guide";
    if (isTaskGuide && !mimeType.startsWith("image/")) return sendJson(response, 400, { error: "任务提示图只支持静态图片" });
    const isVideo = mimeType.startsWith("video/");
    const maxBytes = isTaskGuide ? 10 * 1024 * 1024 : isVideo ? 64 * 1024 * 1024 : 16 * 1024 * 1024;
    const maxMegabytes = isTaskGuide ? 10 : isVideo ? 64 : 16;
    if (buffer.length > maxBytes) return sendJson(response, 400, { error: `单个${isTaskGuide ? "任务提示图" : isVideo ? "短视频" : "素材"}不能超过 ${maxMegabytes}MB` });
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": originalExtension === "m4v" ? "m4v" : "mp4", "video/webm": "webm", "video/quicktime": "mov" }[mimeType];
    const baseName = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
    const fileName = `${baseName}.${extension}`;
    const sourcePath = path.join(uploadDir, fileName);
    await fs.writeFile(sourcePath, buffer);
    const dimensions = mimeType.startsWith("image/") ? imageDimensions(buffer, mimeType) : { width: 0, height: 0 };
    if (isTaskGuide && (!dimensions.width || !dimensions.height || dimensions.width > 10000 || dimensions.height > 10000)) {
      await fs.unlink(path.join(uploadDir, fileName)).catch(() => {});
      return sendJson(response, 400, { error: "任务提示图尺寸无法识别" });
    }
    return sendJson(response, 200, {
      url: `/product/uploads/${fileName}`,
      name: String(body.name || fileName).slice(0, 180),
      mimeType,
      sourceMimeType: mimeType,
      converted: false,
      width: dimensions.width,
      height: dimensions.height,
      updatedAt: now()
    });
  }

  if (request.method === "POST" && url.pathname === "/api/upload/discard") {
    if (!isParent(request)) return sendJson(response, 401, { error: "请先通过家长验证" });
    const body = await readJson(request);
    const fileName = uploadUrlFileName(body.url);
    if (!fileName) return sendJson(response, 400, { error: "上传文件地址无效" });
    const state = await readState();
    if (hasUploadReference(state, body.url)) return sendJson(response, 409, { error: "图片已经在使用，不能删除" });
    await fs.unlink(path.join(uploadDir, fileName)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return sendJson(response, 200, { discarded: true });
  }

  if (request.method === "POST" && url.pathname === "/api/action") {
    const body = await readJson(request);
    if (parentActions.has(body.type) && !isParent(request)) return sendJson(response, 401, { error: "请先通过家长验证" });
    return mutateState(async () => {
      const state = await readState();
      const completionPhotoUrls = body.type === "reset" ? collectCompletionPhotoUrls(state) : new Set();
      const nextState = await applyAction(state, body.type, body.payload || {});
      await writeState(nextState);
      if (completionPhotoUrls.size) await removeUnusedCompletionPhotos(nextState, completionPhotoUrls);
      return sendJson(response, 200, publicState(nextState));
    });
  }

  return false;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".qt": "video/quicktime", ".woff2": "font/woff2"
};

async function serveStatic(request, response, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (pathname.endsWith("/")) pathname += "index.html";
  const uploadFileName = uploadUrlFileName(pathname);
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const filePath = uploadFileName ? path.join(uploadDir, uploadFileName) : path.join(root, normalized);
  const allowedRoot = uploadFileName ? uploadDir : root;
  if (!filePath.startsWith(allowedRoot)) return sendJson(response, 403, { error: "禁止访问" });
  try {
    const data = await fs.readFile(filePath);
    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const cacheControl = uploadFileName
      ? "public, max-age=31536000, immutable"
      : filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=86400" : "no-cache";
    const range = request.headers.range;
    if (range && contentType.startsWith("video/")) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match) return sendJson(response, 416, { error: "视频分段范围无效" });
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : data.length - 1;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= data.length) {
        response.writeHead(416, { "Content-Range": `bytes */${data.length}` });
        return response.end();
      }
      const chunk = data.subarray(start, Math.min(end, data.length - 1) + 1);
      response.writeHead(206, {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${start + chunk.length - 1}/${data.length}`,
        "Content-Length": chunk.length
      });
      return response.end(chunk);
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "Accept-Ranges": contentType.startsWith("video/") ? "bytes" : "none",
      "Content-Length": data.length
    });
    response.end(data);
  } catch (error) {
    if (error.code === "ENOENT") return sendJson(response, 404, { error: "页面不存在" });
    throw error;
  }
}

await ensureData();

function listen(port) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      const handled = url.pathname.startsWith("/api/") || url.pathname === "/healthz"
        ? await handleApi(request, response, url)
        : false;
      if (handled === false) await serveStatic(request, response, url);
    } catch (error) {
      sendJson(response, 400, { error: error.message || "请求失败" });
    }
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && port < desiredPort + 20) return listen(port + 1);
    throw error;
  });
  server.listen(port, host, () => {
    console.log(`Yubao Planet server: http://127.0.0.1:${port}`);
    console.log(`Child: http://127.0.0.1:${port}/product/child/`);
    console.log(`Parent: http://127.0.0.1:${port}/product/parent/`);
  });
}

listen(desiredPort);
