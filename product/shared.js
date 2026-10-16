export const ASSETS = {
  coin: "/assets/05_星币与反馈元素/currency_starcoin_v01.png",
  gift: "/assets/05_星币与反馈元素/feedback_exchange_gift_v01.png",
  confirmed: "/assets/05_星币与反馈元素/feedback_parent_confirmation_v01.png",
  childIcon: "/assets/01_品牌与入口/brand_child_app_icon_v01.png",
  parentIcon: "/assets/01_品牌与入口/brand_parent_app_icon_v01.png",
  rewardOutdoor: "/assets/06_现实奖励类别图标/reward_category_outdoor_activity_v01.png",
  rewardFamily: "/assets/06_现实奖励类别图标/reward_category_family_time_v01.png",
  rewardStory: "/assets/06_现实奖励类别图标/reward_category_story_reading_v01.png",
  rewardScreen: "/assets/06_现实奖励类别图标/reward_category_screen_entertainment_v01.png",
  rewardFood: "/assets/06_现实奖励类别图标/reward_category_food_choice_v01.png",
  rewardFree: "/assets/06_现实奖励类别图标/reward_category_free_choice_v01.png"
};

export const BUILT_IN_REWARD_IMAGES = [
  ["户外活动", ASSETS.rewardOutdoor, "reward_category_outdoor_activity_v01"],
  ["家庭时光", ASSETS.rewardFamily, "reward_category_family_time_v01"],
  ["故事阅读", ASSETS.rewardStory, "reward_category_story_reading_v01"],
  ["屏幕娱乐", ASSETS.rewardScreen, "reward_category_screen_entertainment_v01"],
  ["食物选择", ASSETS.rewardFood, "reward_category_food_choice_v01"],
  ["自由选择", ASSETS.rewardFree, "reward_category_free_choice_v01"]
];

export const DIGITAL_TYPE = {
  character: { label: "人物套装", icon: "shirt", layer: "人物层" },
  background: { label: "背景主题", icon: "image", layer: "背景层" },
  pet: { label: "宠物伙伴", icon: "paw-print", layer: "宠物层" }
};

export function h(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function icon(name) {
  return `<i data-lucide="${name}" aria-hidden="true"></i>`;
}

export function hydrateIcons() {
  window.lucide?.createIcons({ attrs: { "stroke-width": 2 } });
}

export function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function coin(value) {
  return `<span class="coin-value"><img src="${ASSETS.coin}" alt="">${h(value)}</span>`;
}

export function availableCoins(state) {
  return state.wallet.balance - state.wallet.frozen;
}

export async function getState() {
  const response = await fetch("/api/state", { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取家庭数据");
  return response.json();
}

export async function login(pin) {
  const response = await fetch("/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "登录失败");
  sessionStorage.setItem("yubao-parent-token", result.token);
  return result;
}

export async function action(type, payload = {}, parent = false) {
  const headers = { "Content-Type": "application/json" };
  if (parent) headers.Authorization = `Bearer ${sessionStorage.getItem("yubao-parent-token") || ""}`;
  const response = await fetch("/api/action", { method: "POST", headers, body: JSON.stringify({ type, payload }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "操作失败");
  return result;
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("文件没有读完整，请重新选择"));
    reader.readAsDataURL(file);
  });
}

function uploadMimeFromName(name) {
  const extension = String(name || "").split(".").pop()?.toLowerCase();
  return {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    qt: "video/quicktime"
  }[extension] || "";
}

function normalizeUploadDataUrl(dataUrl, name) {
  const text = String(dataUrl || "");
  const match = text.match(/^data:([^;]*);base64,/i);
  if (!match) return text;
  const headerMime = match[1].toLowerCase();
  const inferredMime = uploadMimeFromName(name);
  const normalizedMime = headerMime === "video/x-quicktime"
    ? "video/quicktime"
    : headerMime === "video/x-m4v"
      ? "video/mp4"
    : inferredMime && (!headerMime || headerMime === "application/octet-stream" || (inferredMime === "video/quicktime" && headerMime === "video/mp4"))
      ? inferredMime
      : "";
  return normalizedMime ? text.replace(/^data:[^;]*;base64,/i, `data:${normalizedMime};base64,`) : text;
}

export async function submitTaskCompletion(taskId, file = null) {
  const dataUrl = file ? await fileToDataUrl(file) : "";
  const response = await fetch("/api/task-submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, name: file?.name || "", dataUrl })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "这次没有提交成功，请再试一次");
  return result;
}

export async function uploadAsset(file, metadata = {}) {
  const dataUrl = normalizeUploadDataUrl(await fileToDataUrl(file), file.name);
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("yubao-parent-token") || ""}` },
    body: JSON.stringify({ name: file.name, dataUrl, ...metadata })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "素材上传失败");
  return result;
}

export async function discardUploadedAsset(url) {
  if (!url) return;
  const response = await fetch("/api/upload/discard", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("yubao-parent-token") || ""}` },
    body: JSON.stringify({ url })
  });
  if (!response.ok && response.status !== 404) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "临时图片清理失败");
  }
}

function decodeImage(file, unreadableMessage = "这张图片暂时无法读取，请换成 JPG、PNG 或 WebP") {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(unreadableMessage));
    };
    image.src = url;
  });
}

async function prepareJpegImage(file, options) {
  const { label, maxInputBytes, maxEdge, quality, baseNameFallback, maxOutputBytes = Infinity, unreadableMessage, processingMessage } = options;
  if (!file?.size) throw new Error(`请先选择一张${label}`);
  if (file.size > maxInputBytes) throw new Error(`${label}太大了，请重新拍一张或换一张`);
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const imageLike = file.type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(extension);
  if (!imageLike) throw new Error(unreadableMessage || `这张${label}无法识别，请换成 JPG、PNG 或 WebP`);

  const decoded = await decodeImage(file, unreadableMessage);
  try {
    if (!decoded.width || !decoded.height) throw new Error(unreadableMessage || "图片尺寸无法识别");
    const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error(processingMessage || "当前浏览器无法处理图片");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(decoded.image, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error(processingMessage || "图片处理失败，请重新选择");
    if (blob.size > maxOutputBytes) throw new Error(`${label}还是太大，请换一张更简单的照片`);
    const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^\w\u4e00-\u9fff-]+/g, "-").slice(0, 60) || baseNameFallback;
    return {
      file: new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() }),
      width,
      height,
      mimeType: "image/jpeg"
    };
  } finally {
    URL.revokeObjectURL(decoded.url);
  }
}

export function prepareTaskGuideImage(file) {
  return prepareJpegImage(file, {
    label: "任务提示图",
    maxInputBytes: 10 * 1024 * 1024,
    maxEdge: 2048,
    quality: 0.9,
    baseNameFallback: "task-guide"
  });
}

export function prepareCompletionPhoto(file) {
  return prepareJpegImage(file, {
    label: "完成照片",
    maxInputBytes: 20 * 1024 * 1024,
    maxEdge: 1600,
    quality: 0.86,
    baseNameFallback: "task-completion",
    maxOutputBytes: 6 * 1024 * 1024,
    unreadableMessage: "这张照片暂时打不开，请重新拍一张或从相册换一张",
    processingMessage: "现在没法准备这张照片，请重新拍一张或从相册换一张"
  });
}

export function showImageViewer(src, alt = "图片预览") {
  document.querySelector("#global-image-viewer")?.remove();
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const viewer = document.createElement("div");
  viewer.id = "global-image-viewer";
  viewer.className = "image-viewer";
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  viewer.setAttribute("aria-label", alt);
  viewer.innerHTML = `<button class="icon-button image-viewer-close" type="button" aria-label="关闭图片">${icon("x")}</button><img alt=""><p hidden>图片暂时无法显示，请关闭后重试</p>`;
  const image = viewer.querySelector("img");
  image.src = src;
  image.alt = alt;
  const close = () => {
    viewer.remove();
    document.removeEventListener("keydown", onKeydown);
    returnFocus?.focus();
  };
  const onKeydown = (event) => { if (event.key === "Escape") close(); };
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer || event.target.closest(".image-viewer-close")) close();
  });
  image.addEventListener("error", () => {
    image.hidden = true;
    viewer.querySelector("p").hidden = false;
  });
  document.addEventListener("keydown", onKeydown);
  document.body.append(viewer);
  hydrateIcons();
  viewer.querySelector(".image-viewer-close").focus();
}

export function toast(message, tone = "success") {
  let node = document.querySelector("#app-toast");
  if (!node) {
    node = document.createElement("div");
    node.id = "app-toast";
    node.className = "app-toast";
    document.body.append(node);
  }
  node.className = `app-toast show ${tone}`;
  node.textContent = message;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2600);
}

export function statusLabel(status) {
  return {
    todo: "待完成", pending: "等待确认", redo: "需要再完成", done: "已确认",
    approved: "待兑现", rejected: "未同意，已解冻", fulfilled: "已兑现", completed: "已完成"
  }[status] || status;
}

export function equippedRewards(state) {
  return {
    character: state.digitalRewards.find((item) => item.id === state.equipped.character),
    background: state.digitalRewards.find((item) => item.id === state.equipped.background),
    pet: state.digitalRewards.find((item) => item.id === state.equipped.pet)
  };
}
