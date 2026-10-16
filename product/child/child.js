import {
  ASSETS, DIGITAL_TYPE, action, availableCoins, coin, equippedRewards, formatTime,
  getState, h, hydrateIcons, icon, prepareCompletionPhoto, showImageViewer, statusLabel,
  submitTaskCompletion, toast
} from "../shared.js";
import { childTasksForDate, overdueTasks, taskDate } from "../task-scope.js";

const app = document.querySelector("#child-app");
const main = document.querySelector("#child-main");
const modalRoot = document.querySelector("#child-modal");
const VALID_VIEWS = ["planet", "tasks", "calendar", "dress", "shop"];
let state;
let view = VALID_VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "planet";
let taskScope = "today";
let dressType = "character";
let shopMode = "digital";
let shopDigitalType = "character";
let calendarMonth = "";
let refreshPromise = null;
const viewScrollPositions = new Map();
const CLICK_SOUND_STORAGE_KEY = "yubao-click-sound-enabled";
let clickSoundEnabled = readClickSoundPreference();
let clickSoundContext;
let modalReturnFocus = null;
let completionPhotoPreviewUrl = "";
let completionSelection = { taskId: "", file: null, width: 0, height: 0 };

const SHOP_DIGITAL_TYPE = {
  all: { label: "全部", icon: "layout-grid" },
  character: { label: "人物", icon: DIGITAL_TYPE.character.icon },
  background: { label: "背景", icon: DIGITAL_TYPE.background.icon },
  pet: { label: "宠物", icon: DIGITAL_TYPE.pet.icon }
};

const CHILD_TYPE_COPY = {
  character: { action: "这次只换人物套装", keep: "背景和伙伴会保持原样", item: "人物套装" },
  background: { action: "这次只换星球主题", keep: "人物和伙伴会保持原样", item: "星球主题" },
  pet: { action: "这次只换陪伴伙伴", keep: "人物和背景会保持原样", item: "陪伴伙伴" }
};

const CALENDAR_STATUS = {
  complete: { label: "全部完成", icon: "star" },
  pending: { label: "等家长确认", icon: "clock-3" },
  partial: { label: "完成了一部分", icon: "circle-dashed" },
  incomplete: { label: "还有任务没完成", icon: "circle" },
  none: { label: "没有任务", icon: "" }
};

function readClickSoundPreference() {
  try {
    return localStorage.getItem(CLICK_SOUND_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

const REDUCE_MOTION_STORAGE_KEY = "yubao-reduce-motion-enabled";
let reduceMotionEnabled = readReduceMotionPreference();

function readReduceMotionPreference() {
  try {
    const stored = localStorage.getItem(REDUCE_MOTION_STORAGE_KEY);
    if (stored != null) return stored === "true";
  } catch {
    // Fall through to the system preference.
  }
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
}

function saveReduceMotionPreference(enabled) {
  try {
    localStorage.setItem(REDUCE_MOTION_STORAGE_KEY, String(enabled));
  } catch {
    // The preference still applies for this visit when storage is unavailable.
  }
}

function saveClickSoundPreference(enabled) {
  try {
    localStorage.setItem(CLICK_SOUND_STORAGE_KEY, String(enabled));
  } catch {
    // The sound still works for this visit when storage is unavailable.
  }
}

function playClickSound() {
  if (!clickSoundEnabled) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  clickSoundContext ||= new AudioContext();
  const play = () => {
    const now = clickSoundContext.currentTime;
    const oscillator = clickSoundContext.createOscillator();
    const gain = clickSoundContext.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(560, now);
    oscillator.frequency.exponentialRampToValueAtTime(420, now + 0.055);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    oscillator.connect(gain);
    gain.connect(clickSoundContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.065);
  };

  if (clickSoundContext.state === "suspended") {
    clickSoundContext.resume().then(play).catch(() => {});
  } else {
    play();
  }
}

const motionSupportProbe = document.createElement("video");

function motionMimeType(url) {
  const pathname = String(url || "").split(/[?#]/, 1)[0].toLowerCase();
  if (pathname.endsWith(".mov") || pathname.endsWith(".qt")) return "video/quicktime";
  if (pathname.endsWith(".webm")) return "video/webm";
  if (pathname.endsWith(".mp4") || pathname.endsWith(".m4v")) return "video/mp4";
  return "";
}

function playableMotionSources(reward) {
  const urls = [reward?.motionSafariUrl, reward?.motionUrl].filter((url, index, items) => url && items.indexOf(url) === index);
  return urls.map((url) => ({ url, type: motionMimeType(url) })).filter(({ type }) => !type || motionSupportProbe.canPlayType(type));
}

function runtimeLayerMarkup(reward, type, classPrefix = "planet", options = {}) {
  const className = `${classPrefix}-${type}`;
  const label = reward?.name || { background: "当前背景", character: "当前人物", pet: "当前宠物" }[type];
  const staticUrl = reward?.staticUrl || "";
  const motionSources = playableMotionSources(reward);
  const hasMotion = motionSources.length > 0;
  const mediaMode = reward?.mediaMode === "motion" && hasMotion ? "motion" : "static";
  if (!staticUrl) return "";
  if ((reduceMotionEnabled && !options.forceMotion) || mediaMode !== "motion") return `<img class="${className}" data-runtime-layer="${type}" src="${h(staticUrl)}" alt="${h(label)}">`;
  const fallbackId = `${classPrefix}-${type}`;
  const keepStaticBase = type === "background";
  const motionClass = keepStaticBase ? "runtime-motion" : "runtime-motion runtime-motion-standalone";
  const sources = motionSources.map(({ url, type: mimeType }) => `<source src="${h(url)}"${mimeType ? ` type="${mimeType}"` : ""}>`).join("");
  const poster = keepStaticBase ? ` poster="${h(staticUrl)}"` : "";
  return `<img class="${className} runtime-static-base" data-runtime-layer="${type}" data-runtime-fallback="${h(fallbackId)}" src="${h(staticUrl)}" alt="${h(label)}"><video class="${className} ${motionClass}" data-runtime-layer="${type}" data-runtime-motion data-fallback-id="${h(fallbackId)}"${poster} autoplay muted loop playsinline preload="metadata" aria-hidden="true">${sources}</video>`;
}

function sceneMarkup(classPrefix = "planet", overrides = {}, options = {}) {
  const equipped = equippedRewards(state);
  const layers = {
    background: overrides.background || equipped.background,
    character: overrides.character || equipped.character,
    pet: overrides.pet || equipped.pet
  };
  return `
    ${runtimeLayerMarkup(layers.background, "background", classPrefix, { forceMotion: options.forceMotionLayer === "background" })}
    ${runtimeLayerMarkup(layers.character, "character", classPrefix, { forceMotion: options.forceMotionLayer === "character" })}
    ${runtimeLayerMarkup(layers.pet, "pet", classPrefix, { forceMotion: options.forceMotionLayer === "pet" })}
  `;
}

function activateRuntimeVideos(root = document) {
  root.querySelectorAll("[data-runtime-motion]").forEach((video) => {
    video.muted = true;
    const fallback = root.querySelector(`[data-runtime-fallback="${video.dataset.fallbackId}"]`) || document.querySelector(`[data-runtime-fallback="${video.dataset.fallbackId}"]`);
    const revealMotion = () => {
      if (video.dataset.runtimeLayer !== "background" && fallback) fallback.hidden = true;
      video.hidden = false;
      video.classList.add("motion-ready");
    };
    const showFallback = () => {
      video.classList.remove("motion-ready");
      video.hidden = true;
      if (fallback) fallback.hidden = false;
    };
    if (!video.dataset.runtimeInitialized) {
      video.dataset.runtimeInitialized = "1";
      video.addEventListener("playing", revealMotion);
      video.addEventListener("error", showFallback);
    }
    if (video.readyState >= 3 && !video.paused) revealMotion();
    video.play?.().catch(showFallback);
  });
}

function planetViewNode() {
  return main.querySelector('[data-child-view="planet"]');
}

function pausePlanetVideos() {
  planetViewNode()?.querySelectorAll("[data-runtime-motion]").forEach((video) => video.pause?.());
}

function resumePlanetVideos() {
  const planet = planetViewNode();
  if (!planet || reduceMotionEnabled) return;
  activateRuntimeVideos(planet);
}

function sceneKey(source = state) {
  const equipped = equippedRewards(source);
  return ["background", "character", "pet"].map((type) => {
    const reward = equipped[type];
    const hasMotion = playableMotionSources(reward).length > 0;
    const mode = !reduceMotionEnabled && reward?.mediaMode === "motion" && hasMotion ? "motion" : "static";
    return [reward?.id || "", reward?.staticUrl || "", mode, mode === "motion" ? reward?.motionUrl || "" : "", mode === "motion" ? reward?.motionSafariUrl || "" : ""].join("|");
  }).join("::");
}

function planetPanelState(source = state) {
  const todayTasks = childTasksForDate(source);
  const completed = todayTasks.filter((task) => task.status === "done").length;
  const pending = todayTasks.filter((task) => task.status === "pending").length;
  const open = todayTasks.filter((task) => ["todo", "redo"].includes(task.status)).length;
  const total = todayTasks.length;
  const overdueCount = overdueTasks(source).length;
  const percent = total ? Math.round(completed / total * 100) : 0;
  const latest = source.ledger[0];
  const allDone = total > 0 && completed === total;
  const noTasks = total === 0;
  const progressNote = open && pending
    ? `还有 ${open} 个要完成，${pending} 个等家长确认`
    : open
      ? `还有 ${open} 个今天的任务等你完成`
      : `${pending} 个任务正在等家长确认`;
  const panel = allDone ? {
    eyebrow: "今天全部完成",
    title: "太棒啦！",
    note: `${completed} 个任务都完成了`,
    action: "go-calendar",
    icon: "sparkles",
    button: "看看学习足迹"
  } : noTasks ? {
    eyebrow: "今天的安排",
    title: "轻松一下",
    note: "今天暂时没有新任务",
    action: "go-dress",
    icon: "shirt",
    button: "去看看装扮"
  } : {
    eyebrow: "今日学习进度",
    title: `${completed} / ${total}`,
    note: progressNote,
    action: "go-tasks",
    icon: "play",
    button: open ? "继续做任务" : "看看任务状态"
  };
  const message = allDone ? "今天的任务都完成啦，星币也收好啦" : noTasks ? "今天没有新任务，去看看喜欢的装扮吧" : latest ? `${h(latest.title)}，星币已经记好啦` : "今天也按自己的节奏完成";
  return { percent, allDone, noTasks, overdueCount, panel, message };
}

function progressPanelMarkup(panelState) {
  const { percent, overdueCount, panel } = panelState;
  return `<div class="eyebrow">${panel.eyebrow}</div>
      <h1>${panel.title}</h1>
      <p class="progress-note">${panel.note}</p>
      <div class="progress-track"><span style="width:${percent}%"></span></div>
      <button class="primary-button" data-action="${panel.action}">${icon(panel.icon)}${panel.button}</button>
      ${overdueCount ? `<button class="overdue-task-link" data-action="go-overdue-tasks">${icon("history")}<span>以前还有 ${overdueCount} 个任务待补完成</span>${icon("chevron-right")}</button>` : ""}`;
}

function renderHeader() {
  document.querySelector("[data-testid='child-balance']").innerHTML = coin(availableCoins(state));
  document.querySelectorAll(".child-nav [data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
}

function renderPlanet() {
  const panelState = planetPanelState();
  const { allDone, noTasks, message } = panelState;
  return `<section class="planet-view" data-testid="child-planet">
    <div class="planet-scene" data-planet-scene-key="${h(sceneKey())}">${sceneMarkup("planet")}<div class="planet-wash"></div></div>
    <div class="progress-panel ${allDone ? "complete" : ""}" data-testid="planet-progress-state">
      ${progressPanelMarkup(panelState)}
    </div>
    <div class="planet-message">${icon(noTasks ? "sparkles" : "circle-check")}<span>${message}</span></div>
  </section>`;
}

function updatePlanetDynamic() {
  const panelState = planetPanelState();
  const { allDone, noTasks, message } = panelState;
  const progress = main.querySelector("[data-testid='planet-progress-state']");
  const messageNode = main.querySelector(".planet-message");
  if (!progress || !messageNode) return false;
  progress.classList.toggle("complete", allDone);
  progress.innerHTML = progressPanelMarkup(panelState);
  messageNode.innerHTML = `${icon(noTasks ? "sparkles" : "circle-check")}<span>${message}</span>`;
  hydrateIcons();
  return true;
}

function taskIcon(status) {
  return { todo: "circle", pending: "clock-3", redo: "rotate-ccw", done: "circle-check" }[status] || "circle";
}

function taskGuideButton(task, className = "task-guide-thumb") {
  if (!task.guideImage?.url) return "";
  return `<button class="${className}" type="button" data-action="view-task-image" data-url="${h(task.guideImage.url)}" data-alt="${h(task.title)}的任务提示图" data-task-guide-media aria-label="看看${h(task.title)}要做什么"><img src="${h(task.guideImage.thumbnailUrl || task.guideImage.url)}" alt="" data-task-guide-image></button>`;
}

function photoPolicyCopy(policy) {
  return {
    required: "完成后要拍一张照片",
    optional: "可以拍一张完成照片",
    none: "完成后直接提交"
  }[policy] || "完成后直接提交";
}

function shortTaskDate(date) {
  const [, month, day] = String(date || "").split("-").map(Number);
  return month && day ? `${month}月${day}日` : "往日";
}

function renderTasks() {
  const todayTasks = childTasksForDate(state);
  const lateTasks = overdueTasks(state);
  const showingOverdue = taskScope === "overdue";
  const visibleTasks = showingOverdue ? lateTasks : todayTasks;
  const done = todayTasks.filter((task) => task.status === "done").length;
  const pending = todayTasks.filter((task) => task.status === "pending").length;
  const open = todayTasks.filter((task) => ["todo", "redo"].includes(task.status));
  const overduePending = lateTasks.filter((task) => task.status === "pending").length;
  const overdueOpen = lateTasks.filter((task) => ["todo", "redo"].includes(task.status)).length;
  const heading = showingOverdue
    ? `<div class="eyebrow">待补完成</div><h1>以前还没完成的任务</h1><p>可以按自己的节奏补完，不扣星币，也不影响今天的进度。</p>`
    : `<div class="eyebrow">今日学习任务</div><h1>按自己的节奏完成</h1><p>做完后自己提交，家长确认后星币到账。</p>`;
  return `<section class="child-content-view" data-testid="child-tasks">
    <div class="view-heading"><div>${heading}</div>${coin(`可用 ${availableCoins(state)}`)}</div>
    <div class="task-board">
      <div class="child-task-tabs segmented" aria-label="任务时间范围"><button class="${showingOverdue ? "" : "active"}" data-action="task-scope" data-scope="today">今天 ${todayTasks.length}</button><button class="${showingOverdue ? "active overdue" : ""}" data-action="task-scope" data-scope="overdue">待补完成 ${lateTasks.length}</button></div>
      ${showingOverdue && lateTasks.length ? `<div class="overdue-scope-note">${icon("history")}这些是今天以前留下的任务，完成后仍然可以交给家长确认。</div>` : ""}
      <div class="task-columns">
      <div class="task-list">
        ${visibleTasks.map((task) => {
          const actionId = task.taskId || task.id;
          const itemDate = taskDate(task, state.today);
          return `<article class="task-card ${h(task.status)} ${showingOverdue ? "overdue" : ""} ${task.guideImage?.url ? "has-guide" : ""}" data-task-id="${h(actionId)}">
          ${taskGuideButton(task) || `<div class="task-symbol">${icon(taskIcon(task.status))}</div>`}
          <div class="task-copy"><h2>${h(task.title)}</h2><p>${h(task.description)}</p><div class="task-meta">${showingOverdue ? `<span class="overdue-date">${h(shortTaskDate(itemDate))}未完成</span>` : ""}<span>${h(task.subject || "学习")}</span>${task.scheduleType === "daily" ? `<span>每天都要完成</span>` : ""}<span>${h(task.due)}</span><span>${h(photoPolicyCopy(task.photoPolicy))}</span><span class="status-chip ${h(task.status)}">${h(statusLabel(task.status))}</span>${task.guideImage?.url ? `<button class="task-guide-link" type="button" data-action="view-task-image" data-url="${h(task.guideImage.url)}" data-alt="${h(task.title)}的任务提示图">${icon("image")}看看任务</button>` : ""}${task.redoReason ? `<span>家长说：${h(task.redoReason)}</span>` : ""}</div></div>
          <div class="task-card-actions">${coin(`+${task.reward}`)}
            ${["todo", "redo"].includes(task.status) ? `<button class="primary-button" data-action="submit-task" data-id="${h(actionId)}" data-testid="submit-task">${showingOverdue ? "继续完成" : "我完成了"}</button>` : ""}
            ${task.status === "pending" ? `<button class="secondary-button" disabled>等待家长确认</button>` : ""}
            ${task.status === "done" ? `<span class="status-chip done">已到账</span>` : ""}
          </div>
        </article>`;
        }).join("") || `<div class="empty-state">${icon("clipboard-check")}<p>${showingOverdue ? "没有需要补完成的任务" : "今天暂时没有任务"}</p></div>`}
      </div>
      ${showingOverdue
        ? `<aside class="today-summary overdue-summary"><h2>待补任务</h2><div class="summary-number">${lateTasks.length}</div><p>不计入今日进度</p><div class="summary-list"><div><span>还要完成</span><strong>${overdueOpen}</strong></div><div><span>等待确认</span><strong>${overduePending}</strong></div></div></aside>`
        : `<aside class="today-summary"><h2>今天的进度</h2><div class="summary-number">${done}/${todayTasks.length}</div><div class="progress-track"><span style="width:${todayTasks.length ? done / todayTasks.length * 100 : 0}%"></span></div><div class="summary-list"><div><span>还要完成</span><strong>${open.length}</strong></div><div><span>等待确认</span><strong>${pending}</strong></div><div><span>已经确认</span><strong>${done}</strong></div></div></aside>`}
      </div>
    </div>
  </section>`;
}

function recordsForDate(date) {
  return (state.taskDayRecords || []).filter((record) => record.date === date);
}

function calendarDayStatus(records) {
  if (!records.length) return "none";
  if (records.every((record) => record.status === "done")) return "complete";
  if (records.every((record) => ["done", "pending"].includes(record.status)) && records.some((record) => record.status === "pending")) return "pending";
  if (records.some((record) => ["done", "pending"].includes(record.status))) return "partial";
  return "incomplete";
}

function shiftCalendarMonth(monthKey, offset) {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(year, month - 1 + offset, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function calendarDateLabel(date) {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][new Date(year, month - 1, day).getDay()];
  return `${month} 月 ${day} 日 · ${weekday}`;
}

function renderCalendar() {
  if (!calendarMonth) calendarMonth = state.today.slice(0, 7);
  const [year, month] = calendarMonth.split("-").map(Number);
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthRecords = (state.taskDayRecords || []).filter((record) => record.date.startsWith(`${calendarMonth}-`));
  const datesWithRecords = [...new Set(monthRecords.map((record) => record.date))];
  const completeDays = datesWithRecords.filter((date) => calendarDayStatus(recordsForDate(date)) === "complete").length;
  const earnedCoins = monthRecords.reduce((sum, record) => sum + Number(record.earnedCoins || 0), 0);
  const cells = [];

  for (let index = 0; index < 42; index += 1) {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) {
      cells.push(`<div class="calendar-day calendar-empty" aria-hidden="true"></div>`);
      continue;
    }
    const date = `${calendarMonth}-${String(day).padStart(2, "0")}`;
    const records = recordsForDate(date);
    const status = calendarDayStatus(records);
    const meta = CALENDAR_STATUS[status];
    const future = date > state.today;
    cells.push(`<button type="button" class="calendar-day ${status} ${date === state.today ? "today" : ""} ${future ? "future" : ""}" data-action="open-calendar-day" data-date="${date}" data-testid="calendar-day-${date}" ${future ? "disabled" : ""} aria-label="${day} 日，${future ? "未来日期" : meta.label}">
      <span class="calendar-day-number">${day}</span>
      ${!future && meta.icon ? `<span class="calendar-day-state">${icon(meta.icon)}<span>${meta.label}</span></span>` : ""}
    </button>`);
  }

  return `<section class="child-content-view calendar-view" data-testid="child-calendar">
    <div class="view-heading"><div><div class="eyebrow">我的星球日历</div><h1>看看每天的学习足迹</h1><p>只记录自己的完成情况，不排名，也不用连续打卡。</p></div>${coin(`可用 ${availableCoins(state)}`)}</div>
    <div class="calendar-board">
      <div class="calendar-toolbar">
        <div class="calendar-month-control"><button class="icon-button" data-action="calendar-prev" aria-label="上个月" title="上个月">${icon("chevron-left")}</button><strong data-testid="calendar-month-label">${year} 年 ${month} 月</strong><button class="icon-button" data-action="calendar-next" aria-label="下个月" title="下个月">${icon("chevron-right")}</button></div>
        <button class="secondary-button" data-action="calendar-today">${icon("calendar-days")}回到今天</button>
      </div>
      <div class="calendar-summary"><div>${icon("star")}<span>本月全部完成</span><strong>${completeDays} 天</strong></div><div>${icon("coins")}<span>本月获得</span><strong>${earnedCoins} 星币</strong></div></div>
      <div class="calendar-weekdays" aria-hidden="true">${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<span>周${day}</span>`).join("")}</div>
      <div class="calendar-grid">${cells.join("")}</div>
      <div class="calendar-legend">${Object.entries(CALENDAR_STATUS).map(([key, item]) => `<span class="${key}">${item.icon ? icon(item.icon) : `<i></i>`}${item.label}</span>`).join("")}</div>
    </div>
  </section>`;
}

function calendarRecordLabel(status) {
  return { done: "已完成", pending: "等家长确认", redo: "再检查一下", todo: "还没完成" }[status] || statusLabel(status);
}

function openCalendarDay(date) {
  const records = recordsForDate(date);
  const status = calendarDayStatus(records);
  const earned = records.reduce((sum, record) => sum + Number(record.earnedCoins || 0), 0);
  const summary = {
    complete: "这天的任务都完成啦",
    pending: "任务已经交给家长确认啦",
    partial: "这天完成了一部分任务",
    incomplete: "这天还有任务没有完成",
    none: "这天没有安排任务"
  }[status];
  openModal(`<div class="modal-header"><div><h2>${calendarDateLabel(date)}</h2><p>${summary}</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div>
    ${records.length ? `<div class="calendar-detail-summary"><span>${icon("list-checks")}共 ${records.length} 个任务</span><span>${icon("coins")}获得 ${earned} 星币</span></div><div class="calendar-detail-list" data-testid="calendar-day-detail">${records.map((record) => `<div class="calendar-task-row">${taskGuideButton(record, "calendar-task-guide") || `<div class="calendar-task-icon ${h(record.status)}">${icon(taskIcon(record.status))}</div>`}<div><strong>${h(record.title)}</strong><span>${h(record.subject || "学习")}${record.scheduleType === "daily" ? " · 每天任务" : ""} · ${h(record.due)}</span></div><span class="status-chip ${h(record.status)}">${h(calendarRecordLabel(record.status))}</span></div>`).join("")}</div>` : `<div class="empty-state" data-testid="calendar-day-detail">${icon("calendar-days")}<p>这天没有安排任务</p></div>`}`);
}

function renderDress() {
  const equipped = equippedRewards(state);
  const owned = state.digitalRewards.filter((item) => item.type === dressType && item.owned);
  const rule = DIGITAL_TYPE[dressType];
  const childRule = CHILD_TYPE_COPY[dressType];
  return `<section class="child-content-view" data-testid="child-dress">
    <div class="view-heading"><div><div class="eyebrow">我的装扮</div><h1>选择现在的星球形象</h1><p>人物、背景和伙伴可以分开更换，已经选好的不会跟着改变。</p></div></div>
    <div class="dress-board">
      <div class="dress-toolbar"><div class="segmented">${Object.entries(DIGITAL_TYPE).map(([type, item]) => `<button class="${type === dressType ? "active" : ""}" data-action="dress-type" data-type="${type}">${icon(item.icon)}${item.label}</button>`).join("")}</div><div class="layer-rule">${childRule.action}，${childRule.keep}</div></div>
      <div class="dress-layout">
        <div class="scene-preview" data-testid="layer-preview">${sceneMarkup("scene")}</div>
        <div class="reward-grid">${owned.map((item) => {
          const selected = state.equipped[item.type] === item.id;
          return `<article class="reward-card ${h(item.type)}"><img src="${h(item.staticUrl)}" alt="${h(item.name)}"><div class="reward-card-body"><h2>${h(item.name)}</h2><p>${h(item.description)}</p><div class="reward-card-footer">${selected ? `<span class="equipped-tag">${icon("circle-check")}正在使用</span>` : `<span>${childRule.item}</span>`}<button class="${selected ? "secondary-button" : "primary-button"}" data-action="equip-digital" data-id="${h(item.id)}" ${selected ? "disabled" : ""} data-testid="equip-digital">${selected ? "使用中" : "使用"}</button></div></div></article>`;
        }).join("") || `<div class="empty-state">${icon(rule.icon)}<p>还没有已拥有的${rule.label}</p></div>`}</div>
      </div>
    </div>
  </section>`;
}

function canPreviewMotion(reward) {
  return Boolean(playableMotionSources(reward).length && reward.mediaMode === "motion");
}

function digitalRewardActionButton(item, source = "shop") {
  const selected = state.equipped[item.type] === item.id;
  const shortfall = Math.max(0, item.price - availableCoins(state));
  if (item.owned) {
    return `<button class="${selected ? "secondary-button" : "primary-button"}" data-action="equip-digital" data-id="${h(item.id)}" ${selected ? "disabled" : ""} data-testid="${source}-equip-digital">${selected ? "使用中" : "使用"}</button>`;
  }
  return `<button class="primary-button" data-action="buy-digital" data-id="${h(item.id)}" ${shortfall ? "disabled" : ""} data-testid="${source}-buy-digital">${shortfall ? `还差 ${shortfall} 星币` : `兑换 ${item.price} 星币`}</button>`;
}

function openDigitalPurchaseSuccess(reward) {
  const rule = CHILD_TYPE_COPY[reward.type];
  openModal(`<div class="modal-header"><div><h2>兑换成功</h2><p>${h(reward.name)} 已经放入我的装扮。</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div>
    <div class="purchase-success">
      <div class="purchase-success-icon">${icon(DIGITAL_TYPE[reward.type].icon)}</div>
      <div><strong>${h(rule.item)}</strong><span>${h(rule.action)}，${h(rule.keep)}。</span></div>
    </div>
    <div class="modal-actions"><button class="secondary-button" data-action="close-modal">先放着</button><button class="primary-button" data-action="equip-digital" data-id="${h(reward.id)}" data-testid="purchase-equip-now">${icon("sparkles")}立即使用</button></div>`);
}

async function finishDigitalPurchase(id) {
  try {
    state = await action("purchaseDigital", { id });
    const reward = state.digitalRewards.find((item) => item.id === id);
    render();
    openDigitalPurchaseSuccess(reward);
    toast("兑换成功，已经放入我的装扮");
  } catch (error) {
    toast(error.message, "error");
  }
}

function openDigitalPreview(id, forceMotion = false) {
  const reward = state.digitalRewards.find((item) => item.id === id);
  if (!reward) return toast("这个装扮暂时找不到了", "error");
  const type = DIGITAL_TYPE[reward.type];
  const childRule = CHILD_TYPE_COPY[reward.type];
  const selected = state.equipped[reward.type] === reward.id;
  const available = availableCoins(state);
  const shortfall = Math.max(0, reward.price - available);
  const motionAvailable = canPreviewMotion(reward);
  const previewLayers = { [reward.type]: reward };
  const forceMotionLayer = motionAvailable && forceMotion ? reward.type : "";
  const motionControl = motionAvailable ? reduceMotionEnabled ? `<button class="secondary-button preview-motion-button" data-action="preview-digital" data-id="${h(reward.id)}" data-motion="${forceMotion ? "0" : "1"}">${icon(forceMotion ? "image" : "play")} ${forceMotion ? "看静态图" : "看动画"}</button>` : `<span class="status-chip done">${icon("play")}短视频预览</span>` : `<span class="status-chip">${icon("image")}静态预览</span>`;
  const ownedCopy = reward.owned ? selected ? "正在使用" : "已拥有" : shortfall ? `还差 ${shortfall} 星币` : "可以兑换";

  openModal(`<div class="digital-preview" data-testid="digital-preview-modal">
    <div class="modal-header"><div><h2>${h(reward.name)}</h2><p>${h(type.label)} · ${h(ownedCopy)}</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div>
    <div class="digital-preview-layout">
      <div class="scene-preview digital-preview-stage" data-testid="digital-preview-stage">${sceneMarkup("scene", previewLayers, { forceMotionLayer })}</div>
      <aside class="digital-preview-panel">
        <div class="preview-chip-row"><span class="status-chip">${icon(type.icon)}${h(type.label)}</span>${motionControl}</div>
        <p>${h(reward.description)}</p>
        <div class="preview-economy"><div><span>需要</span>${coin(reward.price)}</div><div><span>现在有</span>${coin(available)}</div></div>
        ${shortfall && !reward.owned ? `<div class="preview-shortfall">${icon("coins")}还差 ${shortfall} 星币，可以先预览，做完任务再兑换。</div>` : ""}
        <div class="preview-layer-note">${h(childRule.action)}，${h(childRule.keep)}。</div>
        <div class="preview-main-action">${digitalRewardActionButton(reward, "preview")}</div>
      </aside>
    </div>
  </div>`, true);
  activateRuntimeVideos();
}

function renderDigitalShop() {
  const rewards = state.digitalRewards.filter((item) => item.active && (shopDigitalType === "all" || item.type === shopDigitalType));
  const filter = `<div class="segmented shop-type-filter" role="tablist" aria-label="星球装扮分类">${Object.entries(SHOP_DIGITAL_TYPE).map(([type, item]) => `<button type="button" role="tab" class="${type === shopDigitalType ? "active" : ""}" aria-selected="${type === shopDigitalType}" data-action="shop-digital-type" data-type="${type}" data-testid="shop-type-${type}">${icon(item.icon)}<span>${item.label}</span></button>`).join("")}</div>`;
  return `${filter}<div class="shop-grid">${rewards.map((item) => {
    const previewBadge = canPreviewMotion(item) ? `<span class="status-chip done">${icon("play")}视频</span>` : `<span class="status-chip">${icon("image")}静态</span>`;
    return `<article class="shop-card ${h(item.type)}" data-reward-id="${h(item.id)}"><img src="${h(item.staticUrl)}" alt="${h(item.name)}"><div class="shop-card-info"><div class="shop-card-tags"><span class="status-chip">${DIGITAL_TYPE[item.type].label}</span>${previewBadge}</div><h2>${h(item.name)}</h2><p>${h(item.description)}</p><div class="shop-card-bottom">${coin(item.price)}<div class="shop-card-actions"><button class="secondary-button" data-action="preview-digital" data-id="${h(item.id)}" data-testid="preview-digital">${icon("eye")}预览</button>${digitalRewardActionButton(item)}</div></div></div></article>`;
  }).join("") || `<div class="empty-state">${icon(SHOP_DIGITAL_TYPE[shopDigitalType].icon)}<p>这里还没有上架的${SHOP_DIGITAL_TYPE[shopDigitalType].label}装扮</p></div>`}</div>`;
}

function renderRealShop() {
  const rewards = state.realRewards.filter((item) => item.active);
  return `<div class="shop-grid">${rewards.map((item) => {
    const processing = state.redemptions.some((entry) => entry.kind === "real" && entry.rewardId === item.id && ["pending", "approved"].includes(entry.status));
    const affordable = availableCoins(state) >= item.price;
    const soldOut = item.remaining < 1;
    const buttonLabel = soldOut ? "已兑完" : processing ? "处理中" : affordable ? "申请兑换" : "星币不足";
    return `<article class="shop-card real-card" data-real-id="${h(item.id)}"><img src="${h(item.imageUrl)}" alt="${h(item.name)}"><div class="shop-card-info"><span class="status-chip">${h(item.category)}</span><h2>${h(item.name)}</h2><p>${h(item.description)}</p><span class="source-note">还可兑换 ${item.remaining} 次</span><div class="shop-card-bottom">${coin(item.price)}<button class="primary-button" data-action="request-real" data-id="${h(item.id)}" ${(processing || !affordable || soldOut) ? "disabled" : ""} data-testid="request-real">${buttonLabel}</button></div></div></article>`;
  }).join("") || `<div class="empty-state">${icon("gift")}<p>家长还没有上架现实奖励</p></div>`}</div>`;
}

function renderShop() {
  return `<section class="child-content-view" data-testid="child-shop">
    <div class="view-heading"><div><div class="eyebrow">星币商店</div><h1>用努力换来喜欢的奖励</h1><p>星球装扮兑换后会一直归你；生活奖励需要家长同意。</p></div>${coin(`可用 ${availableCoins(state)}`)}</div>
    <div class="shop-board"><div class="shop-toolbar"><div class="segmented"><button class="${shopMode === "digital" ? "active" : ""}" data-action="shop-mode" data-mode="digital">${icon("sparkles")}星球装扮</button><button class="${shopMode === "real" ? "active" : ""}" data-action="shop-mode" data-mode="real">${icon("gift")}生活奖励</button></div>${state.wallet.frozen ? `<span class="status-chip pending">已为奖励留好 ${state.wallet.frozen} 星币</span>` : ""}</div>${shopMode === "digital" ? renderDigitalShop() : renderRealShop()}</div>
  </section>`;
}

function createViewNode(name) {
  const renderer = { planet: renderPlanet, tasks: renderTasks, calendar: renderCalendar, dress: renderDress, shop: renderShop }[name];
  const template = document.createElement("template");
  template.innerHTML = renderer().trim();
  const node = template.content.firstElementChild;
  node.dataset.childView = name;
  return node;
}

function mountedViewNode(name) {
  return main.querySelector(`[data-child-view="${name}"]`);
}

function updatePlanetScene() {
  const scene = mountedViewNode("planet")?.querySelector(".planet-scene");
  if (!scene) return false;
  const nextKey = sceneKey();
  if (scene.dataset.planetSceneKey === nextKey) return false;
  scene.dataset.planetSceneKey = nextKey;
  scene.innerHTML = `${sceneMarkup("planet")}<div class="planet-wash"></div>`;
  return true;
}

function showActiveView() {
  main.querySelectorAll("[data-child-view]").forEach((node) => {
    const active = node.dataset.childView === view;
    node.hidden = !active;
    node.inert = !active;
  });
  if (view === "planet") resumePlanetVideos();
  else pausePlanetVideos();
  requestAnimationFrame(() => { main.scrollTop = viewScrollPositions.get(view) || 0; });
}

function render() {
  renderHeader();
  let current = mountedViewNode(view);
  if (!current) {
    current = createViewNode(view);
    main.append(current);
  } else if (view === "planet") {
    updatePlanetScene();
    updatePlanetDynamic();
  } else {
    const next = createViewNode(view);
    current.replaceWith(next);
    current = next;
  }
  showActiveView();
  app.setAttribute("aria-busy", "false");
  hydrateIcons();
}

function navigateTo(nextView, { historyMode = "push" } = {}) {
  if (!VALID_VIEWS.includes(nextView) || nextView === view) return;
  viewScrollPositions.set(view, main.scrollTop);
  view = nextView;
  if (historyMode === "push") history.pushState({ view }, "", `#${view}`);
  if (historyMode === "replace") history.replaceState({ view }, "", `#${view}`);
  render();
}

function openModal(content, wide = false) {
  modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" data-modal-panel>${content}</section></div>`;
  document.body.classList.add("overlay-open");
  hydrateIcons();
  modalRoot.querySelector("button, input, select, textarea")?.focus();
}

function closeModal() {
  if (completionPhotoPreviewUrl) URL.revokeObjectURL(completionPhotoPreviewUrl);
  completionPhotoPreviewUrl = "";
  completionSelection = { taskId: "", file: null, width: 0, height: 0 };
  modalRoot.innerHTML = "";
  document.body.classList.remove("overlay-open");
  modalReturnFocus?.focus();
  modalReturnFocus = null;
}

function completionPhotoControls(task) {
  if (task.photoPolicy === "none") return `<div class="completion-direct-note">${icon("circle-check")}这个任务做完后可以直接提交。</div>`;
  const required = task.photoPolicy === "required";
  return `<section class="completion-photo-box ${required ? "required" : "optional"}" data-completion-box>
    <div class="completion-photo-heading"><div><strong>给家长看看吧</strong><span>${required ? "拍好照片后就能提交啦" : "可以拍一张，也可以暂时不拍"}</span></div><span class="status-chip">${required ? "需要照片" : "可以不拍"}</span></div>
    <button type="button" class="completion-photo-preview" data-action="view-completion-preview" hidden><img alt="完成照片预览"><span>${icon("maximize-2")}点一下看大图</span></button>
    <div class="completion-photo-actions">
      <label class="secondary-button completion-file-button">${icon("camera")}<span data-completion-camera-label>拍一张</span><input type="file" accept="image/*" capture="environment" data-completion-input data-testid="completion-camera"></label>
      <label class="secondary-button completion-file-button">${icon("images")}<span data-completion-library-label>从相册选</span><input type="file" accept="image/*" data-completion-input data-testid="completion-library"></label>
      <button type="button" class="text-button" data-action="remove-completion-photo" data-completion-remove hidden>${icon("trash-2")}删除照片</button>
    </div>
    <p class="completion-photo-status" data-completion-status aria-live="polite">还没有选择照片</p>
  </section>`;
}

function completionSubmitLabel(task, hasPhoto = false) {
  return task.photoPolicy === "optional" && !hasPhoto ? "暂时不拍，直接提交" : "交给家长";
}

function openTaskSubmission(task) {
  if (completionPhotoPreviewUrl) URL.revokeObjectURL(completionPhotoPreviewUrl);
  completionPhotoPreviewUrl = "";
  completionSelection = { taskId: task.id, file: null, width: 0, height: 0 };
  openModal(`<div class="modal-header"><div><h2>我完成啦</h2><p>${h(task.title)}</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div>
    ${task.guideImage?.url ? `<section class="submission-section"><strong>要做什么</strong><button class="task-detail-guide" type="button" data-action="view-task-image" data-url="${h(task.guideImage.url)}" data-alt="${h(task.title)}要做什么" data-task-guide-media><img src="${h(task.guideImage.url)}" alt="${h(task.title)}的提示图" data-task-guide-image><span>${icon("maximize-2")}看看任务图片</span></button><p>${h(task.description)}</p></section>` : `<section class="submission-section"><strong>要做什么</strong><p>${h(task.description)}</p></section>`}
    ${completionPhotoControls(task)}
    <p class="submission-reward-note">交给家长确认后，可以获得 ${task.reward} 星币。</p>
    <div class="modal-actions"><button class="secondary-button" data-action="close-modal">再检查一下</button><button class="primary-button" data-action="confirm-submit-task" data-id="${h(task.id)}" data-testid="confirm-submit-task" ${task.photoPolicy === "required" ? "disabled" : ""}>${icon("send")}${completionSubmitLabel(task)}</button></div>`);
}

function updateCompletionPhotoPreview() {
  const preview = modalRoot.querySelector(".completion-photo-preview");
  if (!preview) return;
  const hasPhoto = Boolean(completionSelection.file && completionPhotoPreviewUrl);
  preview.hidden = !hasPhoto;
  preview.dataset.url = completionPhotoPreviewUrl;
  preview.querySelector("img").src = completionPhotoPreviewUrl;
  modalRoot.querySelector("[data-completion-remove]").hidden = !hasPhoto;
  modalRoot.querySelector("[data-completion-camera-label]").textContent = hasPhoto ? "重新拍" : "拍一张";
  modalRoot.querySelector("[data-completion-library-label]").textContent = hasPhoto ? "换一张" : "从相册选";
  const status = modalRoot.querySelector("[data-completion-status]");
  status.textContent = hasPhoto ? `照片准备好了 · ${completionSelection.width} × ${completionSelection.height}` : "还没有选择照片";
  const task = state.tasks.find((item) => item.id === completionSelection.taskId);
  const submit = modalRoot.querySelector("[data-action='confirm-submit-task']");
  if (submit && task) {
    if (task.photoPolicy === "required") submit.disabled = !hasPhoto;
    submit.innerHTML = `${icon("send")}${completionSubmitLabel(task, hasPhoto)}`;
    hydrateIcons();
  }
}

async function selectCompletionPhoto(file, input) {
  if (!file?.size) return;
  const status = modalRoot.querySelector("[data-completion-status]");
  if (status) status.textContent = "正在准备照片…";
  try {
    const prepared = await prepareCompletionPhoto(file);
    if (completionPhotoPreviewUrl) URL.revokeObjectURL(completionPhotoPreviewUrl);
    completionPhotoPreviewUrl = URL.createObjectURL(prepared.file);
    completionSelection = { taskId: completionSelection.taskId, file: prepared.file, width: prepared.width, height: prepared.height };
    modalRoot.querySelectorAll("[data-completion-input]").forEach((field) => { if (field !== input) field.value = ""; });
    updateCompletionPhotoPreview();
  } catch (error) {
    input.value = "";
    if (status) status.textContent = "照片没有准备好，请重新选择";
    toast(error.message, "error");
  }
}

async function finishTaskSubmission(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return toast("这个任务已经不在今天的列表里了", "error");
  if (task.photoPolicy === "required" && !completionSelection.file) return toast("请先拍一张完成照片", "error");
  const button = modalRoot.querySelector("[data-action='confirm-submit-task']");
  const status = modalRoot.querySelector("[data-completion-status]");
  if (button) {
    button.disabled = true;
    button.textContent = "正在提交，请稍等";
  }
  if (status) status.textContent = "正在提交，请稍等";
  try {
    state = await submitTaskCompletion(taskId, completionSelection.file);
    closeModal();
    render();
    toast("已经告诉家长啦，等待确认吧");
  } catch (error) {
    toast(error.message, "error");
    if (button && document.body.contains(button)) {
      button.disabled = task.photoPolicy === "required" && !completionSelection.file;
      button.innerHTML = `${icon("send")}${completionSubmitLabel(task, Boolean(completionSelection.file))}`;
      hydrateIcons();
    }
    if (status && completionSelection.file) status.textContent = "照片还在，可以再试一次";
  }
}

function openRecords() {
  const redemptions = state.redemptions.filter((entry) => entry.kind === "real");
  openModal(`<div class="modal-header"><div><h2>星币与奖励记录</h2><p>这里只记录发生过的事情，不做排名。</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div>
    <div class="segmented"><button class="active">星币记录</button><button>现实奖励 ${redemptions.length}</button></div>
    <div class="record-list" style="margin-top:16px">${state.ledger.map((entry) => `<div class="record-row"><div class="record-icon">${icon(entry.delta >= 0 ? "coins" : "shopping-bag")}</div><div><strong>${h(entry.title)}</strong><span>${h(formatTime(entry.createdAt))}${entry.frozenDelta ? ` · 奖励预留 ${entry.frozenDelta > 0 ? "+" : ""}${entry.frozenDelta}` : ""}</span></div><div class="record-amount ${entry.delta >= 0 ? "plus" : "minus"}">${entry.delta > 0 ? "+" : ""}${entry.delta}<span>现在有 ${entry.balanceAfter}</span></div></div>`).join("") || `<div class="empty-state">${icon("coins")}<p>还没有星币记录，完成任务后会出现在这里</p></div>`}</div>`, true);
}

function openSettings() {
  openModal(`<div class="modal-header"><div><h2>设置与帮助</h2><p>孩子端不能进入家长管理。</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><div class="settings-list"><label class="setting-row"><div><strong>点击声音</strong><span>点按钮时会有轻轻的回应</span></div><span class="settings-switch"><input type="checkbox" data-action="toggle-click-sound" data-testid="click-sound-toggle" aria-label="点击声音" ${clickSoundEnabled ? "checked" : ""}><i aria-hidden="true"></i></span></label><label class="setting-row"><div><strong>减少动画</strong><span>打开后人物、宠物和背景都优先显示静态图</span></div><span class="settings-switch"><input type="checkbox" data-action="toggle-reduce-motion" data-testid="reduce-motion-toggle" aria-label="减少动画" ${reduceMotionEnabled ? "checked" : ""}><i aria-hidden="true"></i></span></label><div class="setting-row"><div><strong>当前家庭</strong><span>${h(state.family.name)}</span></div><span class="status-chip done">已连接</span></div><div class="setting-row"><div><strong>产品版本</strong><span>家庭试用版</span></div><strong>V${h(state.productVersion)}</strong></div><div class="setting-row"><div><strong>使用帮助</strong><span>任务完成后自己提交，等待家长确认</span></div>${icon("circle-help")}</div></div>`);
}

async function runAction(type, payload, successMessage) {
  try {
    state = await action(type, payload);
    closeModal();
    render();
    if (successMessage) toast(successMessage);
  } catch (error) {
    toast(error.message, "error");
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-view], [data-action]");
  if (!target) return;
  if (target.disabled || target.getAttribute("aria-disabled") === "true") return;
  if (target.matches("button:not(:disabled)")) target.focus({ preventScroll: true });
  const isSoundToggle = target.dataset.action === "toggle-click-sound";
  if (!isSoundToggle) playClickSound();
  const nextView = target.dataset.view;
  if (nextView) {
    navigateTo(nextView);
    return;
  }
  const { action: command, id } = target.dataset;
  if (command === "toggle-click-sound") {
    clickSoundEnabled = target.checked;
    saveClickSoundPreference(clickSoundEnabled);
    if (clickSoundEnabled) playClickSound();
    toast(clickSoundEnabled ? "点击声音已打开" : "点击声音已关闭");
    return;
  }
  if (command === "toggle-reduce-motion") {
    reduceMotionEnabled = target.checked;
    saveReduceMotionPreference(reduceMotionEnabled);
    render();
    openSettings();
    toast(reduceMotionEnabled ? "已切换为静态展示" : "已允许播放短视频");
    return;
  }
  if (command === "close-modal") {
    if (target.classList.contains("modal-backdrop") && event.target !== target) return;
    closeModal();
  }
  if (command === "go-tasks") { taskScope = "today"; navigateTo("tasks"); }
  if (command === "go-overdue-tasks") { taskScope = "overdue"; navigateTo("tasks"); }
  if (command === "go-calendar") navigateTo("calendar");
  if (command === "go-dress") navigateTo("dress");
  if (command === "task-scope") { taskScope = target.dataset.scope === "overdue" ? "overdue" : "today"; render(); }
  if (command === "calendar-prev") { calendarMonth = shiftCalendarMonth(calendarMonth, -1); render(); }
  if (command === "calendar-next") { calendarMonth = shiftCalendarMonth(calendarMonth, 1); render(); }
  if (command === "calendar-today") { calendarMonth = state.today.slice(0, 7); render(); }
  if (command === "open-calendar-day") openCalendarDay(target.dataset.date);
  if (command === "open-records") openRecords();
  if (command === "open-settings") openSettings();
  if (command === "view-task-image" && target.dataset.url) showImageViewer(target.dataset.url, target.dataset.alt || "任务提示图");
  if (command === "view-completion-preview" && target.dataset.url) showImageViewer(target.dataset.url, "完成照片预览");
  if (command === "remove-completion-photo") {
    if (completionPhotoPreviewUrl) URL.revokeObjectURL(completionPhotoPreviewUrl);
    completionPhotoPreviewUrl = "";
    completionSelection = { taskId: completionSelection.taskId, file: null, width: 0, height: 0 };
    modalRoot.querySelectorAll("[data-completion-input]").forEach((input) => { input.value = ""; });
    updateCompletionPhotoPreview();
  }
  if (command === "dress-type") { dressType = target.dataset.type; render(); }
  if (command === "shop-mode") { shopMode = target.dataset.mode; render(); }
  if (command === "shop-digital-type") { shopDigitalType = target.dataset.type; render(); }
  if (command === "preview-digital") {
    openDigitalPreview(id, target.dataset.motion === "1");
    return;
  }
  if (command === "submit-task") {
    const task = state.tasks.find((item) => item.id === id);
    if (task) openTaskSubmission(task);
  }
  if (command === "confirm-submit-task") await finishTaskSubmission(id);
  if (command === "buy-digital") {
    const reward = state.digitalRewards.find((item) => item.id === id);
    const childRule = CHILD_TYPE_COPY[reward.type];
    openModal(`<div class="modal-header"><div><h2>确认兑换</h2><p>${h(reward.name)}</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><p>兑换后会一直归你，需要 ${reward.price} 星币。${childRule.action}，${childRule.keep}。兑换成功后可以自己决定要不要马上使用。</p><div class="modal-actions"><button class="secondary-button" data-action="close-modal">再想想</button><button class="primary-button" data-action="confirm-buy-digital" data-id="${h(id)}" data-testid="confirm-buy-digital">确认兑换</button></div>`);
  }
  if (command === "confirm-buy-digital") await finishDigitalPurchase(id);
  if (command === "equip-digital") runAction("equipDigital", { id }, "已经换上新形象，其他装扮保持原样");
  if (command === "request-real") {
    const reward = state.realRewards.find((item) => item.id === id);
    openModal(`<div class="modal-header"><div><h2>提交兑换申请</h2><p>${h(reward.name)}</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><img src="${h(reward.imageUrl)}" alt="${h(reward.name)}" style="width:140px;height:140px;object-fit:contain;margin:0 auto 14px"><p>提交后会先为这份奖励留出 ${reward.price} 星币。家长不同意时会自动放回，不会丢失。</p><div class="modal-actions"><button class="secondary-button" data-action="close-modal">再想想</button><button class="primary-button" data-action="confirm-request-real" data-id="${h(id)}" data-testid="confirm-request-real">确认申请</button></div>`);
  }
  if (command === "confirm-request-real") runAction("requestRealReward", { id }, "申请已提交，星币已经为这份奖励留好");
});

document.addEventListener("change", async (event) => {
  if (event.target.matches("[data-completion-input]")) await selectCompletionPhoto(event.target.files?.[0], event.target);
});

document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !document.querySelector("#global-image-viewer")) closeModal(); });
document.addEventListener("error", (event) => {
  if (event.target.matches?.("[data-runtime-motion]")) {
    const fallback = document.querySelector(`[data-runtime-fallback="${event.target.dataset.fallbackId}"]`);
    event.target.hidden = true;
    if (fallback) fallback.hidden = false;
    return;
  }
  if (!event.target.matches?.("[data-task-guide-image]")) return;
  event.target.closest("[data-task-guide-media]")?.setAttribute("hidden", "");
}, true);
window.addEventListener("popstate", () => {
  const next = location.hash.slice(1);
  if (VALID_VIEWS.includes(next) && next !== view) navigateTo(next, { historyMode: "none" });
});
window.addEventListener("hashchange", () => {
  const next = location.hash.slice(1);
  if (VALID_VIEWS.includes(next) && next !== view) navigateTo(next, { historyMode: "none" });
});

async function refresh(silent = false) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const beforeUpdatedAt = state?.updatedAt || "";
      const beforeScene = state ? sceneKey(state) : "";
      const nextState = await getState();
      const afterScene = sceneKey(nextState);
      state = nextState;
      if (beforeUpdatedAt && beforeUpdatedAt === nextState.updatedAt) {
        renderHeader();
        return;
      }
      if (view === "planet" && beforeScene && beforeScene === afterScene && updatePlanetDynamic()) {
        renderHeader();
        return;
      }
      render();
    } catch (error) {
      if (!silent) toast(error.message, "error");
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/product/child/sw.js").catch(() => {});
await refresh();
history.replaceState({ view }, "", `#${view}`);
setInterval(() => { if (!document.hidden && !modalRoot.children.length) refresh(true); }, 5000);
