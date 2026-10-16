import {
  ASSETS, BUILT_IN_REWARD_IMAGES, DIGITAL_TYPE, action, availableCoins, coin, formatTime,
  discardUploadedAsset, getState, h, hydrateIcons, icon, login, prepareTaskGuideImage,
  showImageViewer, statusLabel, toast, uploadAsset
} from "../shared.js";
import {
  activeTasks, activeTasksForToday, confirmedTaskRecords, overdueTasks, taskDate
} from "../task-scope.js";

const loginView = document.querySelector("#parent-login");
const parentApp = document.querySelector("#parent-app");
const main = document.querySelector("#parent-main");
const modalRoot = document.querySelector("#parent-modal");
const taskDetailRoot = document.querySelector("#task-detail-root");
let state;
let view = "dashboard";
let rewardMode = "digital";
let taskFilter = "active";
let recordMode = "tasks";
let recordPeriod = "month";
let recordStatus = "done";
let recordSubject = "all";
let resetVerificationCode = "";
let digitalStaticPreviewUrl = "";
let digitalMotionPreviewUrl = "";
let taskGuidePreviewUrl = "";
let taskGuideSelection = { guideImage: null, originalGuideImage: null, file: null, metadata: null, removed: false };
let realImageSelection = {
  source: "built_in",
  assetId: BUILT_IN_REWARD_IMAGES[0][2],
  url: BUILT_IN_REWARD_IMAGES[0][1],
  customFile: null
};
let modalReturnFocus = null;
let detailReturnFocus = null;

const DIGITAL_MOTION_ACCEPT = "video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov,.qt";
const DIGITAL_MOTION_HELPER = "支持 MP4 / WebM / MOV，能播放就播放，不能播放时自动显示静态图，最大64MB";

function configuredMotionUrl(reward) {
  return reward?.motionUrl || reward?.motionSafariUrl || "";
}

function effectiveMediaMode(reward) {
  return reward?.mediaMode === "motion" && (reward?.motionUrl || reward?.motionSafariUrl) ? "motion" : "static";
}

function mediaModeLabel(reward) {
  if (!reward?.motionUrl && !reward?.motionSafariUrl) return "当前使用静态图";
  return effectiveMediaMode(reward) === "motion" ? "当前使用短视频" : "当前使用静态图";
}

function motionAvailabilityLabel(reward) {
  return configuredMotionUrl(reward) ? "已配置短视频" : "未配置短视频";
}

const TASK_PRESETS = {
  "语文": { testId: "chinese", title: "完成语文练习", description: "完成今天老师布置的语文练习，做完后自己检查一遍。" },
  "数学": { testId: "math", title: "完成数学练习", description: "完成今天的数学练习，做完后检查计算和单位。" },
  "英语": { testId: "english", title: "完成英语练习", description: "完成今天的英语练习，再大声读一遍单词或课文。" },
  "阅读": { testId: "reading", title: "阅读 15 分钟", description: "选择一本喜欢的书，安静阅读 15 分钟。" },
  "体育": { testId: "sports", title: "完成今日运动", description: "完成今天约定的运动，结束后记得喝水和整理。" },
  "其他": { testId: "other", title: "完成学习任务", description: "完成今天约定的学习任务，做完后自己检查一遍。" }
};

const TASK_DUE_PRESETS = ["今天 18:00 前", "今天 20:00 前", "今天 21:00 前", "今天睡前", "明天上学前"];

const PHOTO_POLICY = {
  optional: { label: "可以拍一张", short: "拍照可选", helper: "孩子可以拍一张完成照片，也可以直接提交", icon: "camera" },
  required: { label: "必须拍一张", short: "需要拍照", helper: "孩子拍好一张完成照片后才能提交", icon: "camera-off" },
  none: { label: "不用拍照", short: "不用拍照", helper: "孩子完成后直接交给家长确认", icon: "send" }
};

const viewMeta = {
  dashboard: ["首页", "聿宝家庭今日概览"], tasks: ["任务管理", "创建和查看学习任务"],
  confirmations: ["待处理", "确认任务和处理现实奖励"], rewards: ["奖励管理", "数字奖励与现实奖励"],
  records: ["记录", "任务、奖励兑换与星币账本"], settings: ["家庭设置", "设备、PIN 与本地使用记录"]
};

function latestAttempt(item) {
  return item.submissionAttempts?.at(-1) || null;
}

function latestCompletionPhoto(item) {
  return latestAttempt(item)?.completionPhoto || null;
}

function attemptCount(item) {
  return item.submissionAttempts?.length || 0;
}

function dateText(date) {
  if (!date) return "—";
  const [year, month, day] = date.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function shortDateText(date) {
  if (!date) return "往日";
  const [, month, day] = date.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function isTaskOverdue(task) {
  if (task.status !== "pending") return false;
  const match = String(task.due || "").match(/^今天\s*(\d{1,2}):(\d{2})\s*前$/);
  if (!match) return false;
  const deadline = new Date();
  deadline.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return Date.now() > deadline.getTime();
}

function completionThumb(item, className = "completion-thumb") {
  const photo = latestCompletionPhoto(item);
  if (!photo?.url) return `<div class="${className} empty">${icon("image-off")}<span>未附照片</span></div>`;
  return `<button class="${className}" type="button" data-action="view-completion-image" data-url="${h(photo.url)}" data-alt="${h(item.title)}的完成照片"><img src="${h(photo.thumbnailUrl || photo.url)}" alt="" data-completion-image><span>完成照片</span></button>`;
}

function dashboardCompletionThumb(task) {
  const photo = latestCompletionPhoto(task);
  const label = `查看${task.title}详情`;
  if (!photo?.url) return `<button class="activity-completion-thumb empty" type="button" data-action="task-detail" data-id="${h(task.id)}" aria-label="${h(label)}">${icon("image-off")}<span>未附照片</span></button>`;
  return `<button class="activity-completion-thumb" type="button" data-action="task-detail" data-id="${h(task.id)}" aria-label="${h(label)}"><img src="${h(photo.thumbnailUrl || photo.url)}" alt="" data-completion-image><span>完成照片</span></button>`;
}

function renderChrome() {
  document.querySelector("#topbar-title").textContent = viewMeta[view][0];
  document.querySelector("#topbar-subtitle").textContent = viewMeta[view][1];
  document.querySelector("#topbar-wallet").innerHTML = `<div class="wallet-part"><span>总余额</span><strong>${state.wallet.balance}</strong></div><div class="wallet-part"><span>可用 / 冻结</span><strong>${availableCoins(state)} / ${state.wallet.frozen}</strong></div>`;
  const pending = state.tasks.filter((task) => task.status === "pending").length + state.redemptions.filter((item) => item.kind === "real" && ["pending", "approved"].includes(item.status)).length;
  document.querySelector("#pending-badge").textContent = pending || "";
  document.querySelectorAll(".parent-sidebar [data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
}

function renderDashboard() {
  const pendingTasks = state.tasks.filter((task) => task.status === "pending");
  const pendingRewards = state.redemptions.filter((item) => item.kind === "real" && ["pending", "approved"].includes(item.status));
  const todayConfirmed = confirmedTaskRecords(state, state.today);
  const lateTasks = overdueTasks(state).filter((task) => ["todo", "redo"].includes(task.status));
  return `<section class="parent-page" data-testid="parent-dashboard">
    <div class="page-header"><div><h1>早上好，聿宝家长</h1><p>今天和往日任务分开查看，历史完成记录不再进入首页统计。</p></div><div class="page-actions"><button class="secondary-button" data-action="open-child">${icon("external-link")}孩子端</button><button class="primary-button" data-action="new-task">${icon("plus")}新建任务</button></div></div>
    <div class="metric-row">
      <button type="button" class="metric" data-view="confirmations" data-focus-target="confirmation-tasks" aria-label="查看 ${pendingTasks.length} 个待确认任务"><span class="metric-icon coral">${icon("inbox")}</span><span class="metric-copy"><span>待确认任务</span><strong>${pendingTasks.length}</strong></span><span class="metric-link-icon" aria-hidden="true">${icon("chevron-right")}</span></button>
      <button type="button" class="metric" data-view="confirmations" data-focus-target="confirmation-rewards" aria-label="处理 ${pendingRewards.length} 个奖励申请"><span class="metric-icon gold">${icon("gift")}</span><span class="metric-copy"><span>奖励待处理</span><strong>${pendingRewards.length}</strong></span><span class="metric-link-icon" aria-hidden="true">${icon("chevron-right")}</span></button>
      <button type="button" class="metric" data-view="records" data-record-mode="tasks" data-record-period="date" data-record-status="done" aria-label="查看今天 ${todayConfirmed.length} 个已确认任务"><span class="metric-icon green">${icon("circle-check")}</span><span class="metric-copy"><span>今日已确认</span><strong>${todayConfirmed.length}</strong></span><span class="metric-link-icon" aria-hidden="true">${icon("chevron-right")}</span></button>
      <button type="button" class="metric" data-view="records" data-record-mode="ledger" aria-label="查看星币账本，可用 ${availableCoins(state)} 星币"><span class="metric-icon">${icon("coins")}</span><span class="metric-copy"><span>可用星币</span><strong>${availableCoins(state)}</strong></span><span class="metric-link-icon" aria-hidden="true">${icon("chevron-right")}</span></button>
    </div>
    <div class="dashboard-columns">
      <section class="section-block"><div class="section-heading"><div><h2>需要关注</h2><p>只提示仍需处理的任务和申请</p></div><button class="text-button" data-view="tasks" data-task-filter="active">查看任务</button></div><div class="activity-list">
        ${lateTasks.length ? `<div class="activity-row overdue-alert"><div class="activity-icon">${icon("history")}</div><div><strong>有 ${lateTasks.length} 个往日任务尚未完成</strong><span>不计入今天进度，可以继续补完成</span></div><button class="secondary-button" data-view="tasks" data-task-filter="overdue">查看</button></div>` : ""}
        ${pendingTasks.slice(0,3).map((task) => `<div class="activity-row pending-activity">${dashboardCompletionThumb(task)}<button class="activity-task-copy" type="button" data-action="task-detail" data-id="${h(task.id)}"><strong>${h(task.title)}</strong><span>${h(task.subject)} · ${formatTime(task.submittedAt)} · 第 ${attemptCount(task)} 次提交 · ${task.reward} 星币</span></button><button class="secondary-button" data-action="task-detail" data-id="${h(task.id)}">查看详情</button></div>`).join("")}
        ${pendingRewards.slice(0,3).map((item) => `<div class="activity-row"><div class="activity-icon">${icon("gift")}</div><div><strong>${h(item.rewardName)}</strong><span>${statusLabel(item.status)} · 冻结 ${item.amount}</span></div><button class="secondary-button" data-view="confirmations">处理</button></div>`).join("")}
        ${!lateTasks.length && !pendingTasks.length && !pendingRewards.length ? `<div class="empty-state">${icon("circle-check")}<p>当前没有待处理事项</p></div>` : ""}
      </div></section>
      <section class="section-block"><div class="section-heading"><div><h2>最近星币变化</h2><p>流水只追加，不覆盖历史</p></div><button class="text-button" data-view="records" data-record-mode="ledger">查看账本</button></div><div class="activity-list">${state.ledger.slice(0,5).map((entry) => `<div class="activity-row"><div class="activity-icon">${icon(entry.delta < 0 ? "shopping-bag" : "coins")}</div><div><strong>${h(entry.title)}</strong><span>${formatTime(entry.createdAt)}</span></div><b class="${entry.delta < 0 ? "amount-minus" : "amount-plus"}">${entry.delta > 0 ? "+" : ""}${entry.delta}</b></div>`).join("") || `<div class="empty-state">${icon("coins")}<p>还没有星币变化</p></div>`}</div></section>
    </div>
  </section>`;
}

function renderTasks() {
  const allActiveTasks = activeTasks(state);
  const todayTasks = activeTasksForToday(state);
  const lateTasks = overdueTasks(state);
  const filters = {
    active: () => true,
    today: (task) => taskDate(task, state.today) === state.today,
    overdue: (task) => taskDate(task, state.today) < state.today
  };
  const filteredTasks = allActiveTasks.filter(filters[taskFilter] || filters.active);
  const filterButtons = [
    ["active", "进行中", allActiveTasks.length],
    ["today", "今天", todayTasks.length],
    ["overdue", "往日待处理", lateTasks.length]
  ];
  return `<section class="parent-page" data-testid="parent-tasks"><div class="page-header"><div><h1>任务管理</h1><p>今天和往日未结束任务分开管理，已确认任务到“记录”查看。</p></div><div class="page-actions"><button class="secondary-button" data-view="records" data-record-mode="tasks" data-record-period="all" data-record-status="done">${icon("archive")}查看已完成</button><button class="primary-button" data-action="new-task" data-testid="new-task">${icon("plus")}新建任务</button></div></div>
    <div class="toolbar"><div class="segmented">${filterButtons.map(([key, label, count]) => `<button class="${taskFilter === key ? "active" : ""}" data-action="task-filter" data-filter="${key}">${label} ${count}</button>`).join("")}</div></div>
    <div class="task-admin-list">${filteredTasks.map((task) => {
      const editable = ["todo", "redo"].includes(task.status);
      const editHint = "孩子已经提交，请先处理后再修改";
      const overdue = taskDate(task, state.today) < state.today;
      const leading = task.guideImage?.url
        ? `<button class="task-admin-thumb" data-action="view-task-image" data-url="${h(task.guideImage.url)}" data-alt="${h(task.title)}的任务提示图" aria-label="查看${h(task.title)}的任务提示图"><img src="${h(task.guideImage.thumbnailUrl || task.guideImage.url)}" alt="" data-task-guide-image></button>`
        : `<div class="row-icon">${icon("book-open-check")}</div>`;
      return `<article class="task-admin-row ${overdue ? "overdue" : ""}" data-task-id="${h(task.id)}">${leading}<div class="row-copy"><div class="task-tags">${overdue ? `<span class="overdue">${h(shortDateText(task.activeDate))}未完成</span>` : `<span class="today">今天</span>`}<span>${h(task.subject || "其他")}</span>${task.scheduleType === "daily" ? `<span class="daily">每天重复</span>` : `<span>一次任务</span>`}<span>${h(PHOTO_POLICY[task.photoPolicy]?.short || "直接提交")}</span>${task.nextDailyConfig ? `<span class="future">明天起已调整</span>` : ""}</div><h2>${h(task.title)}</h2><p>${h(task.description)}</p></div><div class="row-stat"><span>完成时间</span><strong>${h(task.due)}</strong></div><div class="row-stat"><span>确认后奖励</span><strong>${task.reward} 星币</strong></div><div class="row-actions"><span class="status-chip ${h(task.status)}">${h(statusLabel(task.status))}</span><button class="secondary-button" data-action="task-detail" data-id="${h(task.id)}">${icon("panel-right-open")}详情</button><button class="secondary-button" data-action="edit-task" data-id="${h(task.id)}" data-testid="edit-task-${h(task.id)}" ${editable ? "" : `disabled title="${h(editHint)}"`}>${icon("pencil")}编辑</button></div></article>`;
    }).join("") || `<div class="empty-state">${icon("list-filter")}<p>这个分类里暂时没有任务</p></div>`}</div>
  </section>`;
}

function renderTaskRequests(pending) {
  if (!pending.length) return `<div class="empty-state">${icon("clipboard-check")}<p>没有待确认任务</p></div>`;
  return `<div class="request-list">${pending.map((task) => `<article class="request-card task-request-card" data-task-id="${h(task.id)}">${completionThumb(task, "request-completion-thumb")}<div><div class="task-tags"><span>${h(task.subject)}</span>${task.scheduleType === "daily" ? `<span class="daily">每天重复</span>` : ""}${isTaskOverdue(task) ? `<span class="overdue">已超过完成时间</span>` : ""}</div><h2>${h(task.title)}</h2><p>提交于 ${formatTime(task.submittedAt)} · 第 ${attemptCount(task)} 次提交 · ${h(task.due)} · 确认后 ${task.reward} 星币</p></div><div class="row-actions"><button class="secondary-button" data-action="task-detail" data-id="${h(task.id)}">查看详情</button><button class="secondary-button" data-action="redo-task" data-id="${h(task.id)}">${icon("rotate-ccw")}需要再完成</button><button class="primary-button" data-action="confirm-task" data-id="${h(task.id)}" data-testid="confirm-task">${icon("circle-check")}确认完成</button></div></article>`).join("")}</div>`;
}

function renderRewardRequests(items) {
  if (!items.length) return `<div class="empty-state">${icon("gift")}<p>没有待处理现实奖励</p></div>`;
  return `<div class="request-list">${items.map((item) => `<article class="request-card" data-redemption-id="${h(item.id)}"><img src="${h(item.imageUrl)}" alt="${h(item.rewardName)}"><div><span class="status-chip ${h(item.status)}">${h(statusLabel(item.status))}</span><h2>${h(item.rewardName)}</h2><p>${formatTime(item.createdAt)} · 冻结 ${item.amount} 星币</p></div><div class="row-actions">${item.status === "pending" ? `<button class="danger-button" data-action="reject-real" data-id="${h(item.id)}">不同意并解冻</button><button class="primary-button" data-action="approve-real" data-id="${h(item.id)}" data-testid="approve-real">同意兑换</button>` : `<button class="primary-button" data-action="fulfill-real" data-id="${h(item.id)}" data-testid="fulfill-real">${icon("gift")}确认已兑现</button>`}</div></article>`).join("")}</div>`;
}

function renderConfirmations() {
  const pendingTasks = state.tasks.filter((task) => task.status === "pending");
  const rewardRequests = state.redemptions.filter((item) => item.kind === "real" && ["pending", "approved"].includes(item.status));
  return `<section class="parent-page" data-testid="parent-confirmations"><div class="page-header"><div><h1>待处理</h1><p>确认任务后才发放星币；同意现实奖励后还要确认兑现。</p></div></div><div class="confirm-sections"><section id="confirmation-tasks" class="confirmation-section" tabindex="-1"><div class="subheading"><h2>任务确认</h2><span class="status-chip pending">${pendingTasks.length} 项</span></div>${renderTaskRequests(pendingTasks)}</section><section id="confirmation-rewards" class="confirmation-section" tabindex="-1"><div class="subheading"><h2>现实奖励申请</h2><span class="status-chip pending">${rewardRequests.length} 项</span></div>${renderRewardRequests(rewardRequests)}</section></div></section>`;
}

function renderDigitalAdmin() {
  return `<div class="admin-product-grid">${state.digitalRewards.map((item) => {
    const motionUrl = configuredMotionUrl(item);
    const previews = motionUrl ? `<button type="button" class="text-button admin-motion-preview" data-action="view-digital-motion" data-url="${h(motionUrl)}">${icon("play-circle")}预览短视频</button>` : "";
    return `<article class="admin-product ${h(item.type)}" data-digital-id="${h(item.id)}"><img src="${h(item.staticUrl)}" alt="${h(item.name)}"><div class="admin-product-body"><span class="status-chip ${item.active ? "done" : ""}">${item.active ? "已上架" : "已下架"}</span><h2>${h(item.name)}</h2><p>${DIGITAL_TYPE[item.type].label} · ${mediaModeLabel(item)} · ${motionAvailabilityLabel(item)}</p><span class="admin-product-description">${h(item.description)}</span>${previews ? `<div class="admin-motion-actions">${previews}</div>` : ""}<div class="admin-product-meta">${coin(item.price)}<div class="admin-product-actions"><button class="secondary-button" data-action="edit-digital" data-id="${h(item.id)}" data-testid="edit-digital-${h(item.id)}">${icon("pencil")}编辑</button><button class="secondary-button" data-action="toggle-digital" data-id="${h(item.id)}" data-active="${item.active}">${item.active ? "下架" : "上架"}</button></div></div></div></article>`;
  }).join("")}</div>`;
}

function renderRealAdmin() {
  return `<div class="admin-product-grid">${state.realRewards.map((item) => `<article class="admin-product real-admin" data-real-id="${h(item.id)}"><img src="${h(item.imageUrl)}" alt="${h(item.name)}"><div class="admin-product-body"><span class="status-chip ${item.active ? "done" : ""}">${item.active ? "已上架" : "已下架"}</span><h2>${h(item.name)}</h2><p>${h(item.description)}</p><span class="image-source">配图来源：${item.imageSource === "custom_upload" ? "自定义上传" : `内置 · ${h(item.category)}`}</span><div class="admin-product-meta">${coin(item.price)}<div class="admin-product-actions"><button class="secondary-button" data-action="edit-real" data-id="${h(item.id)}" data-testid="edit-real-${h(item.id)}">${icon("pencil")}编辑</button><button class="secondary-button" data-action="toggle-real" data-id="${h(item.id)}" data-active="${item.active}">${item.active ? "下架" : "上架"}</button></div></div></div></article>`).join("")}</div>`;
}

function renderRewards() {
  return `<section class="parent-page" data-testid="parent-rewards"><div class="page-header"><div><h1>奖励管理</h1><p>数字奖励按整套人物、整张背景或完整宠物新增；现实奖励必须确定配图来源。</p></div><div class="page-actions"><button class="primary-button" data-action="${rewardMode === "digital" ? "new-digital" : "new-real"}" data-testid="${rewardMode === "digital" ? "new-digital" : "new-real"}">${icon("plus")}${rewardMode === "digital" ? "新增数字奖励" : "新建现实奖励"}</button></div></div><div class="reward-tabs segmented"><button class="${rewardMode === "digital" ? "active" : ""}" data-action="reward-mode" data-mode="digital">数字奖励</button><button class="${rewardMode === "real" ? "active" : ""}" data-action="reward-mode" data-mode="real">现实奖励</button></div>${rewardMode === "digital" ? renderDigitalAdmin() : renderRealAdmin()}</section>`;
}

function recordInPeriod(record) {
  if (recordPeriod === "all") return true;
  if (recordPeriod === "date") return record.date === state.today;
  if (recordPeriod === "month") return record.date.startsWith(state.today.slice(0, 7));
  const current = new Date(`${state.today}T12:00:00+08:00`);
  const value = new Date(`${record.date}T12:00:00+08:00`);
  const days = Math.floor((current - value) / 86_400_000);
  return days >= 0 && days < 7;
}

function renderTaskRecords() {
  const subjects = [...new Set(state.taskDayRecords.map((record) => record.subject).filter(Boolean))];
  const records = [...state.taskDayRecords]
    .filter(recordInPeriod)
    .filter((record) => recordStatus === "all" || record.status === recordStatus)
    .filter((record) => recordSubject === "all" || record.subject === recordSubject)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  return `<div class="record-filters"><div class="segmented" aria-label="记录时间范围">${[["date","今天"],["week","近7天"],["month","本月"],["all","全部"]].map(([key,label]) => `<button class="${recordPeriod === key ? "active" : ""}" data-action="record-period" data-value="${key}">${label}</button>`).join("")}</div><label><span>状态</span><select data-action="record-status"><option value="all">全部状态</option>${[["todo","待完成"],["pending","等待确认"],["redo","需要再完成"],["done","已确认"]].map(([key,label]) => `<option value="${key}" ${recordStatus === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label><span>学科</span><select data-action="record-subject"><option value="all">全部学科</option>${subjects.map((subject) => `<option ${recordSubject === subject ? "selected" : ""}>${h(subject)}</option>`).join("")}</select></label></div>
    <div class="task-record-list">${records.map((record) => {
      const finalTime = record.confirmedAt || latestAttempt(record)?.decidedAt || record.submittedAt || record.updatedAt;
      return `<article class="task-record-row">${completionThumb(record, "record-completion-thumb")}<div class="record-main"><span>${dateText(record.date)} · ${formatTime(finalTime)}</span><strong>${h(record.title)}</strong><small>${h(record.subject || "其他")}${record.scheduleType === "daily" ? " · 每天任务" : " · 一次任务"} · ${h(record.due)}</small></div><div class="record-metric"><span>提交次数</span><strong>${attemptCount(record)}</strong></div><div class="record-metric"><span>获得星币</span><strong>${record.earnedCoins || 0}</strong></div><span class="status-chip ${h(record.status)}">${h(statusLabel(record.status))}</span><button class="secondary-button" data-action="task-detail-record" data-id="${h(record.id)}">查看详情</button></article>`;
    }).join("") || `<div class="empty-state">${icon("calendar-search")}<p>这个范围里还没有任务记录</p></div>`}</div>`;
}

function renderRewardRecords() {
  return `<div class="reward-record-list">${state.redemptions.map((entry) => {
    const reward = entry.kind === "digital" ? state.digitalRewards.find((item) => item.id === entry.rewardId) : state.realRewards.find((item) => item.id === entry.rewardId);
    const imageUrl = entry.imageUrl || reward?.staticUrl || reward?.imageUrl || "";
    return `<article class="reward-record-row">${imageUrl ? `<img src="${h(imageUrl)}" alt="">` : `<div class="row-icon">${icon("gift")}</div>`}<div><span>${entry.kind === "digital" ? "数字装扮" : "生活奖励"}</span><strong>${h(entry.rewardName)}</strong><small>${formatTime(entry.createdAt)} · ${entry.amount} 星币</small></div><span class="status-chip ${h(entry.status)}">${h(statusLabel(entry.status))}</span></article>`;
  }).join("") || `<div class="empty-state">${icon("gift")}<p>还没有奖励兑换记录</p></div>`}</div>`;
}

function renderLedgerRecords() {
  return `<div class="ledger-summary"><div><span>当前余额</span><strong>${state.wallet.balance}</strong></div><div><span>可用星币</span><strong>${availableCoins(state)}</strong></div><div><span>冻结星币</span><strong>${state.wallet.frozen}</strong></div></div><div class="ledger-table">${state.ledger.length ? `<div class="ledger-row head"><span>时间</span><span>事项</span><span>余额变化</span><span>冻结变化</span><span>变动后余额</span></div>${state.ledger.map((entry) => `<div class="ledger-row"><span>${formatTime(entry.createdAt)}</span><strong>${h(entry.title)}</strong><span class="${entry.delta < 0 ? "amount-minus" : "amount-plus"}">${entry.delta > 0 ? "+" : ""}${entry.delta}</span><span>${entry.frozenDelta > 0 ? "+" : ""}${entry.frozenDelta}</span><span>${entry.balanceAfter}</span></div>`).join("")}` : `<div class="empty-state">${icon("notebook-tabs")}<p>还没有星币记录</p></div>`}</div>`;
}

function renderRecords() {
  const completed = confirmedTaskRecords(state);
  const completedThisMonth = completed.filter((record) => record.date?.startsWith(state.today.slice(0, 7)));
  const earned = completed.reduce((sum, record) => sum + Number(record.earnedCoins || 0), 0);
  const content = recordMode === "tasks" ? renderTaskRecords() : recordMode === "rewards" ? renderRewardRecords() : renderLedgerRecords();
  return `<section class="parent-page" data-testid="parent-records"><div class="page-header"><div><h1>历史记录</h1><p>任务经家长确认后归档到这里，不再进入今日任务统计。</p></div></div>
    <div class="record-overview"><div><span class="metric-icon green">${icon("circle-check")}</span><span>已确认任务<strong>${completed.length}</strong></span></div><div><span class="metric-icon gold">${icon("coins")}</span><span>累计任务星币<strong>${earned}</strong></span></div><div><span class="metric-icon">${icon("calendar-days")}</span><span>本月完成<strong>${completedThisMonth.length}</strong></span></div></div>
    <div class="record-tabs segmented" role="tablist"><button class="${recordMode === "tasks" ? "active" : ""}" data-action="record-mode" data-mode="tasks">任务完成 ${completed.length}</button><button class="${recordMode === "ledger" ? "active" : ""}" data-action="record-mode" data-mode="ledger">星币流水</button><button class="${recordMode === "rewards" ? "active" : ""}" data-action="record-mode" data-mode="rewards">奖励兑换</button></div>${content}</section>`;
}

function renderSettings() {
  return `<section class="parent-page" data-testid="parent-settings"><div class="page-header"><div><h1>家庭与系统设置</h1><p>当前是单孩子、单家庭的本地家庭版本。</p></div></div><div class="settings-grid"><section class="settings-block"><h2>家庭连接</h2><div class="setting-line"><span>家庭名称</span><strong>${h(state.family.name)}</strong></div><div class="setting-line"><span>孩子</span><strong>${h(state.family.child.name)} · ${h(state.family.child.grade)}</strong></div><div class="setting-line"><span>孩子端家庭码</span><strong class="family-code">${h(state.family.code)}</strong></div><div class="setting-line"><span>家长 PIN</span><strong>已设置</strong></div></section><section class="settings-block"><h2>运行环境</h2><div class="setting-line"><span>产品版本</span><strong>V${h(state.productVersion)}</strong></div><div class="setting-line"><span>版本类型</span><strong>家庭试用版</strong></div><div class="setting-line"><span>数据存储</span><strong>本地服务 JSON</strong></div><div class="setting-line"><span>孩子端 PWA</span><strong>已启用</strong></div><div class="setting-line"><span>云端同步</span><strong>未启用</strong></div><div class="danger-zone"><h3>清空使用记录</h3><p>清空任务、日历、完成照片、星币流水和兑换记录；保留奖励配置、任务提示图与奖励素材。</p><button class="danger-button" data-action="reset-data">${icon("trash-2")}清空</button></div></section></div></section>`;
}

function render() {
  renderChrome();
  main.innerHTML = { dashboard: renderDashboard, tasks: renderTasks, confirmations: renderConfirmations, rewards: renderRewards, records: renderRecords, settings: renderSettings }[view]();
  hydrateIcons();
}

function attemptDecisionLabel(attempt) {
  return { pending: "等待确认", confirmed: "家长已确认", redo: "家长请孩子再完成" }[attempt.decision] || "已提交";
}

function openTaskDetail(item, historical = false) {
  if (!item) return toast("没有找到这条任务记录", "error");
  detailReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const attempts = item.submissionAttempts || [];
  const latest = attempts.at(-1) || null;
  const linkedTask = historical ? state.tasks.find((task) => task.id === item.taskId) : item;
  const canAct = !historical && item.status === "pending";
  const canEdit = historical
    ? item.scheduleType === "daily" && linkedTask && ["todo", "redo", "done"].includes(linkedTask.status)
    : ["todo", "redo"].includes(item.status) || (item.status === "done" && item.scheduleType === "daily");
  taskDetailRoot.innerHTML = `<div class="task-detail-backdrop" data-action="close-task-detail"><aside class="task-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="task-detail-title" data-detail-panel>
    <header><div><span>${historical ? dateText(item.date) : "当前任务"}</span><h2 id="task-detail-title">${h(item.title)}</h2></div><button class="icon-button" data-action="close-task-detail" aria-label="关闭任务详情">${icon("x")}</button></header>
    <div class="task-detail-scroll">
      <section class="detail-section detail-task-info"><div class="detail-section-title"><span>任务信息</span><strong>要做什么</strong></div><dl class="detail-facts"><div><dt>学科</dt><dd>${h(item.subject || "其他")}</dd></div><div><dt>安排</dt><dd>${item.scheduleType === "daily" ? "每天重复" : "一次任务"}</dd></div><div><dt>完成时间</dt><dd>${h(item.due)}</dd></div><div><dt>完成照片</dt><dd>${h(PHOTO_POLICY[item.photoPolicy]?.label || "不用拍照")}</dd></div><div><dt>确认后奖励</dt><dd>${item.reward} 星币</dd></div><div><dt>当前状态</dt><dd><span class="status-chip ${h(item.status)}">${h(statusLabel(item.status))}</span></dd></div></dl><p class="detail-description">${h(item.description || "没有补充说明")}</p>${item.guideImage?.url ? `<div class="detail-image-block"><span>家长给孩子看的任务图片</span><button type="button" data-action="view-task-image" data-url="${h(item.guideImage.url)}" data-alt="${h(item.title)}要做什么"><img src="${h(item.guideImage.thumbnailUrl || item.guideImage.url)}" alt="" data-task-guide-image><b>${icon("maximize-2")}查看大图</b></button></div>` : `<div class="detail-empty-media">${icon("image-off")}没有任务图片</div>`}</section>
      <section class="detail-section detail-completion"><div class="detail-section-title"><span>孩子提交</span><strong>完成情况</strong></div>${latest?.completionPhoto?.url ? `<div class="detail-image-block completion"><span>第 ${attempts.length} 次提交的完成照片</span><button type="button" data-action="view-completion-image" data-url="${h(latest.completionPhoto.url)}" data-alt="${h(item.title)}的完成照片"><img src="${h(latest.completionPhoto.thumbnailUrl || latest.completionPhoto.url)}" alt="" data-completion-image><b>${icon("maximize-2")}查看大图</b></button></div>` : `<div class="detail-empty-media completion">${icon("image-off")}这次没有添加照片</div>`}${latest ? `<p class="detail-submission-meta">第 ${attempts.length} 次提交 · ${formatTime(latest.submittedAt)} · ${attemptDecisionLabel(latest)}</p>` : `<p class="detail-submission-meta">孩子还没有提交</p>`}${item.redoReason ? `<div class="detail-redo-note"><strong>给孩子的说明</strong><p>${h(item.redoReason)}</p></div>` : ""}</section>
      <section class="detail-section detail-timeline"><div class="detail-section-title"><span>过程记录</span><strong>时间线</strong></div><ol class="attempt-timeline"><li><i>${icon("plus")}</i><div><strong>任务已创建</strong><span>${formatTime(item.createdAt)}</span></div></li>${attempts.map((attempt, index) => `<li><i>${icon(attempt.decision === "confirmed" ? "circle-check" : attempt.decision === "redo" ? "rotate-ccw" : "send")}</i><div><strong>第 ${index + 1} 次提交 · ${attemptDecisionLabel(attempt)}</strong><span>${formatTime(attempt.submittedAt)}${attempt.decidedAt ? ` · 处理于 ${formatTime(attempt.decidedAt)}` : ""}${attempt.completionPhoto?.url ? " · 有照片" : " · 未附照片"}</span>${attempt.redoReason ? `<p>${h(attempt.redoReason)}</p>` : ""}${attempt.completionPhoto?.url ? `<button class="attempt-photo-link" type="button" data-action="view-completion-image" data-url="${h(attempt.completionPhoto.url)}" data-alt="第 ${index + 1} 次提交的完成照片">${icon("image")}查看这次照片</button>` : ""}</div></li>`).join("")}</ol></section>
    </div>
    ${canAct ? `<footer><button class="secondary-button" data-action="redo-task" data-id="${h(item.id)}">${icon("rotate-ccw")}需要再完成</button><button class="primary-button" data-action="confirm-task" data-id="${h(item.id)}">${icon("circle-check")}确认完成并发放 ${item.reward} 星币</button></footer>` : canEdit ? `<footer><button class="primary-button" data-action="edit-task-from-detail" data-id="${h(linkedTask.id)}">${icon("pencil")}${historical ? "编辑当前重复安排" : item.status === "done" ? "编辑明天起安排" : "编辑任务"}</button></footer>` : ""}
  </aside></div>`;
  syncOverlayState();
  hydrateIcons();
  taskDetailRoot.querySelector("button")?.focus();
}

function closeTaskDetail() {
  taskDetailRoot.innerHTML = "";
  syncOverlayState();
  detailReturnFocus?.focus();
  detailReturnFocus = null;
}

function showApp() {
  loginView.hidden = true;
  parentApp.hidden = false;
  render();
}

function showLogin() {
  sessionStorage.removeItem("yubao-parent-token");
  parentApp.hidden = true;
  loginView.hidden = false;
  hydrateIcons();
}

function openModal(content, wide = false) {
  modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" data-modal-panel>${content}</section></div>`;
  syncOverlayState();
  hydrateIcons();
  modalRoot.querySelector("button, input, select, textarea")?.focus();
}

function clearDigitalStaticPreviewUrl() {
  if (!digitalStaticPreviewUrl) return;
  URL.revokeObjectURL(digitalStaticPreviewUrl);
  digitalStaticPreviewUrl = "";
}

function clearDigitalMotionPreviewUrl() {
  if (!digitalMotionPreviewUrl) return;
  URL.revokeObjectURL(digitalMotionPreviewUrl);
  digitalMotionPreviewUrl = "";
}

function digitalMotionUploadMarkup(currentUrl = "") {
  const testId = `${currentUrl ? "edit-" : ""}digital-motion`;
  return `<div class="motion-upload-group"><label class="upload-box compact"><strong>${icon("video")}${currentUrl ? "替换" : "选择"}短视频（可选）</strong><small data-digital-motion-label>${currentUrl ? "已配置短视频；不选择则继续保留" : DIGITAL_MOTION_HELPER}</small><input name="motionFile" type="file" accept="${DIGITAL_MOTION_ACCEPT}" data-current-motion-url="${h(currentUrl)}" data-testid="${testId}"></label><div class="motion-actions"><button type="button" class="text-button motion-preview-button" data-action="view-digital-motion" data-url="${h(currentUrl)}" data-digital-motion-preview-button ${currentUrl ? "" : "hidden"}>${icon("play-circle")}${currentUrl ? "预览当前短视频" : "预览已选择短视频"}</button><button type="button" class="text-button motion-clear-button" data-action="clear-digital-motion" ${currentUrl ? "" : "hidden"}>${icon("trash-2")}保存后删除短视频</button></div></div>`;
}

function digitalMediaModeMarkup(mediaMode = "static", hasMotion = false) {
  const mode = mediaMode === "motion" && hasMotion ? "motion" : "static";
  return `<div class="field span-2 digital-media-mode" data-digital-media-mode>
    <span>孩子端展示方式</span>
    <div class="choice-options media-mode-options">
      <button type="button" class="choice-option ${mode === "static" ? "active" : ""}" data-action="digital-media-mode" data-mode="static">${icon("image")}使用静态图<small>更稳定，也更省电</small></button>
      <button type="button" class="choice-option ${mode === "motion" ? "active" : ""}" data-action="digital-media-mode" data-mode="motion" ${hasMotion ? "" : "disabled"}>${icon("video")}使用短视频<small>${hasMotion ? "孩子端会播放动画" : "先选择短视频后可用"}</small></button>
    </div>
    <input type="hidden" name="mediaMode" value="${mode}">
    <input type="hidden" name="clearMotion" value="0">
    <input type="hidden" name="clearSafariMotion" value="0">
    <small data-media-mode-helper>${hasMotion ? "静态图会一直保留，切换展示方式不会删除视频。" : "未选择短视频时，孩子端只会显示静态图。"}</small>
  </div>`;
}

function setDigitalMediaMode(form, mode) {
  if (!form) return;
  const mediaInput = form.querySelector("[name='motionFile']");
  const hasMotion = Boolean(mediaInput?.files?.[0]?.size || mediaInput?.dataset.currentMotionUrl);
  const nextMode = mode === "motion" && hasMotion ? "motion" : "static";
  form.querySelector("[name='mediaMode']").value = nextMode;
  form.querySelectorAll("[data-action='digital-media-mode']").forEach((button) => {
    const disabled = button.dataset.mode === "motion" && !hasMotion;
    button.disabled = disabled;
    button.classList.toggle("active", button.dataset.mode === nextMode);
    const helper = button.querySelector("small");
    if (helper && button.dataset.mode === "motion") helper.textContent = hasMotion ? "孩子端会播放动画" : "先选择短视频后可用";
  });
  const helper = form.querySelector("[data-media-mode-helper]");
  if (helper) helper.textContent = hasMotion ? "静态图会一直保留，切换展示方式不会删除视频。" : "未选择短视频时，孩子端只会显示静态图。";
}

function clearDigitalMotionSelection(form) {
  const input = form?.querySelector("[name='motionFile']");
  if (!input) return;
  input.value = "";
  input.dataset.currentMotionUrl = "";
  form.querySelector("[name='clearMotion']").value = "1";
  form.querySelector("[name='clearSafariMotion']").value = "1";
  clearDigitalMotionPreviewUrl();
  const label = input.closest(".upload-box")?.querySelector("[data-digital-motion-label]");
  if (label) label.textContent = "保存后删除短视频；也可以重新选择";
  const group = input.closest(".motion-upload-group");
  const previewButton = group?.querySelector("[data-digital-motion-preview-button]");
  if (previewButton) {
    previewButton.dataset.url = "";
    previewButton.hidden = true;
  }
  group?.querySelector("[data-action='clear-digital-motion']")?.setAttribute("hidden", "");
  setDigitalMediaMode(form, form.querySelector("[name='mediaMode']")?.value || "static");
}

function updateDigitalMotionSelection(input) {
  const file = input.files?.[0];
  const label = input.closest(".upload-box")?.querySelector("[data-digital-motion-label]");
  const group = input.closest(".motion-upload-group");
  const previewButton = group?.querySelector("[data-digital-motion-preview-button]");
  const form = input.closest("#digital-form, #edit-digital-form");
  const currentUrl = input.dataset.currentMotionUrl || "";
  clearDigitalMotionPreviewUrl();
  if (!file?.size) {
    if (label) label.textContent = currentUrl ? "已配置短视频；不选择则继续保留" : DIGITAL_MOTION_HELPER;
    if (previewButton) {
      previewButton.dataset.url = currentUrl;
      previewButton.hidden = !currentUrl;
      previewButton.innerHTML = `${icon("play-circle")}${currentUrl ? "预览当前短视频" : "预览已选择短视频"}`;
      hydrateIcons();
    }
    setDigitalMediaMode(form, form?.querySelector("[name='mediaMode']")?.value || "static");
    return;
  }
  input.dataset.currentMotionUrl = "";
  form.querySelector("[name='clearMotion']").value = "0";
  form.querySelector("[name='clearSafariMotion']").value = "1";
  const previewUrl = URL.createObjectURL(file);
  digitalMotionPreviewUrl = previewUrl;
  if (label) label.textContent = `已选择：${file.name}；保存时上传`;
  if (previewButton) {
    previewButton.dataset.url = previewUrl;
    previewButton.hidden = false;
    previewButton.innerHTML = `${icon("play-circle")}预览已选择短视频`;
    hydrateIcons();
  }
  group?.querySelector("[data-action='clear-digital-motion']")?.removeAttribute("hidden");
  setDigitalMediaMode(form, "motion");
}

function openDigitalMotionPreview(url) {
  if (!url) return toast("没有可预览的短视频", "error");
  const activeDigitalForm = document.querySelector("#digital-form, #edit-digital-form");
  if (activeDigitalForm) {
    document.querySelector("[data-motion-preview]")?.remove();
    document.querySelector("[data-modal-panel]")?.insertAdjacentHTML("beforeend", `<div class="motion-preview-backdrop" data-action="close-motion-preview" data-motion-preview><section class="motion-preview-card"><button class="icon-button" data-action="close-motion-preview" aria-label="关闭短视频预览">${icon("x")}</button><video class="digital-motion-viewer" src="${h(url)}" controls autoplay muted loop playsinline></video></section></div>`);
    hydrateIcons();
    return;
  }
  openModal(`<div class="modal-header"><div><h2>短视频预览</h2><p>这是家长端保存的展示视频；是否在孩子端播放，由数字奖励的展示方式决定。</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><video class="digital-motion-viewer" src="${h(url)}" controls autoplay muted loop playsinline></video>`, true);
}

function clearTaskGuidePreviewUrl() {
  if (!taskGuidePreviewUrl) return;
  URL.revokeObjectURL(taskGuidePreviewUrl);
  taskGuidePreviewUrl = "";
}

function resetTaskGuideSelection(task = {}) {
  clearTaskGuidePreviewUrl();
  taskGuideSelection = {
    guideImage: task.guideImage ? structuredClone(task.guideImage) : null,
    originalGuideImage: task.guideImage ? structuredClone(task.guideImage) : null,
    file: null,
    metadata: null,
    removed: false
  };
}

function taskGuideMarkup(task = {}) {
  const image = task.guideImage || null;
  const imageUrl = image?.url || "";
  return `<div class="field span-2 task-guide-field">
    <span>任务提示图（可选）</span>
    <small>可以放作业页、练习示例或需要准备的物品。这只是帮助孩子看懂任务，不是完成凭证。</small>
    <div class="task-guide-layout ${imageUrl ? "has-image" : ""}" data-task-guide-layout>
      <button type="button" class="task-guide-preview" data-action="view-task-image" data-url="${h(imageUrl)}" data-alt="任务提示图" data-task-guide-preview ${imageUrl ? "" : "hidden"}>
        <img src="${h(imageUrl)}" alt="任务提示图预览" data-task-guide-preview-image data-task-guide-image>
        <span>${icon("maximize-2")}查看大图</span>
      </button>
      <div class="task-guide-controls">
        <label class="secondary-button task-guide-file-button">${icon("camera")}<span data-camera-label>${imageUrl ? "重新拍摄" : "拍一张"}</span><input name="guideCamera" type="file" accept="image/*" capture="environment" data-task-guide-input data-testid="task-guide-camera"></label>
        <label class="secondary-button task-guide-file-button">${icon("images")}<span data-library-label>${imageUrl ? "换一张" : "从相册选择"}</span><input name="guideLibrary" type="file" accept="image/*" data-task-guide-input data-testid="task-guide-library"></label>
        <button type="button" class="text-button task-guide-remove" data-action="remove-task-guide" data-testid="remove-task-guide" ${imageUrl ? "" : "hidden"}>${icon("trash-2")}删除图片</button>
      </div>
    </div>
    <small class="task-guide-status" data-task-guide-status aria-live="polite">${imageUrl ? `当前图片 · ${image.width || "—"} × ${image.height || "—"}` : "还没有添加图片"}</small>
  </div>`;
}

function updateTaskGuidePreview() {
  const layout = document.querySelector("[data-task-guide-layout]");
  const preview = document.querySelector("[data-task-guide-preview]");
  const image = document.querySelector("[data-task-guide-preview-image]");
  const remove = document.querySelector("[data-action='remove-task-guide']");
  const status = document.querySelector("[data-task-guide-status]");
  const cameraLabel = document.querySelector("[data-camera-label]");
  const libraryLabel = document.querySelector("[data-library-label]");
  if (!layout || !preview || !image || !remove || !status) return;
  const url = taskGuidePreviewUrl || taskGuideSelection.guideImage?.url || "";
  layout.classList.toggle("has-image", Boolean(url));
  preview.hidden = !url;
  preview.dataset.url = url;
  image.src = url;
  remove.hidden = !url;
  cameraLabel.textContent = url ? "重新拍摄" : "拍一张";
  libraryLabel.textContent = url ? "换一张" : "从相册选择";
  if (!url) status.textContent = "还没有添加图片";
  else if (taskGuideSelection.file) status.textContent = `待保存 · ${taskGuideSelection.metadata.width} × ${taskGuideSelection.metadata.height}`;
  else status.textContent = `当前图片 · ${taskGuideSelection.guideImage?.width || "—"} × ${taskGuideSelection.guideImage?.height || "—"}`;
}

async function selectTaskGuideFile(file, input) {
  const status = document.querySelector("[data-task-guide-status]");
  if (!file?.size) return;
  if (status) status.textContent = "正在准备图片…";
  try {
    const prepared = await prepareTaskGuideImage(file);
    clearTaskGuidePreviewUrl();
    taskGuidePreviewUrl = URL.createObjectURL(prepared.file);
    taskGuideSelection = {
      guideImage: null,
      originalGuideImage: taskGuideSelection.originalGuideImage,
      file: prepared.file,
      metadata: { width: prepared.width, height: prepared.height, mimeType: prepared.mimeType },
      removed: false
    };
    document.querySelectorAll("[data-task-guide-input]").forEach((field) => { if (field !== input) field.value = ""; });
    updateTaskGuidePreview();
  } catch (error) {
    input.value = "";
    updateTaskGuidePreview();
    toast(error.message, "error");
  }
}

function closeModal() {
  clearDigitalStaticPreviewUrl();
  clearDigitalMotionPreviewUrl();
  clearTaskGuidePreviewUrl();
  modalRoot.innerHTML = "";
  syncOverlayState();
  modalReturnFocus?.focus();
  modalReturnFocus = null;
}

function syncOverlayState() {
  document.body.classList.toggle("overlay-open", Boolean(modalRoot.children.length || taskDetailRoot.children.length));
}

function taskFormFields(task = {}) {
  const subject = task.subject || "语文";
  const scheduleType = task.scheduleType || "once";
  const photoPolicy = task.photoPolicy || "optional";
  const due = task.due || "今天 21:00 前";
  const customDue = !TASK_DUE_PRESETS.includes(due);
  return `<div class="field span-2"><span>选择学科</span><div class="quick-options">${Object.entries(TASK_PRESETS).map(([label, preset]) => `<button type="button" class="quick-option ${label === subject ? "active" : ""}" data-action="subject-option" data-subject="${h(label)}" data-testid="subject-option-${preset.testId}">${h(label)}</button>`).join("")}</div><input type="hidden" name="subject" value="${h(subject)}"></div>
    <label class="field span-2"><span>任务名称</span><input name="title" required maxlength="40" value="${h(task.title || TASK_PRESETS[subject]?.title || TASK_PRESETS["其他"].title)}" data-testid="task-title"></label>
    <label class="field span-2"><span>孩子可见说明</span><textarea name="description" required maxlength="200" data-testid="task-description">${h(task.description || TASK_PRESETS[subject]?.description || TASK_PRESETS["其他"].description)}</textarea></label>
    ${taskGuideMarkup(task)}
    <div class="field span-2"><span>任务类型</span><div class="choice-options"><button type="button" class="choice-option ${scheduleType === "once" ? "active" : ""}" data-action="schedule-option" data-schedule="once">${icon("calendar")}一次任务<small>只在这次完成</small></button><button type="button" class="choice-option ${scheduleType === "daily" ? "active" : ""}" data-action="schedule-option" data-schedule="daily" data-testid="schedule-daily">${icon("repeat-2")}每天重复<small>每天自动出现</small></button></div><input type="hidden" name="scheduleType" value="${h(scheduleType)}"></div>
    <div class="field span-2"><span>完成时要拍照吗？</span><div class="choice-options photo-policy-options">${Object.entries(PHOTO_POLICY).map(([key, item]) => `<button type="button" class="choice-option ${photoPolicy === key ? "active" : ""}" data-action="photo-policy-option" data-policy="${key}" data-testid="photo-policy-${key}">${icon(item.icon)}${h(item.label)}<small>${h(item.helper)}</small></button>`).join("")}</div><input type="hidden" name="photoPolicy" value="${h(photoPolicy)}"></div>
    <label class="field"><span>完成时间</span><select name="duePreset" data-testid="task-due-preset">${TASK_DUE_PRESETS.map((option) => `<option ${option === due ? "selected" : ""}>${h(option)}</option>`).join("")}<option value="custom" ${customDue ? "selected" : ""}>自定义</option></select></label>
    <label class="field custom-due-field" ${customDue ? "" : "hidden"}><span>自定义完成时间</span><input name="dueCustom" maxlength="40" value="${customDue ? h(due) : ""}" placeholder="例如：周六上午 10:00 前" ${customDue ? "required" : ""} data-testid="task-due-custom"></label>
    <label class="field"><span>确认后奖励</span><input name="reward" type="number" min="0" max="100" required value="${task.reward ?? 5}" data-testid="task-reward"></label>`;
}

function openTaskForm() {
  resetTaskGuideSelection();
  openModal(`<div class="modal-header"><div><h2>新建学习任务</h2><p>孩子自行点击完成，家长确认后发放星币。</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><form id="task-form" class="form-grid" data-task-form data-mode="create">
    ${taskFormFields()}
    <div class="field span-2"><small>孩子始终自己点击完成；如果选择拍照，照片只用来帮助家长了解完成情况。每日任务在新的一天自动恢复为待完成。</small></div><div class="modal-actions field span-2"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit" data-testid="save-task">${icon("save")}保存任务</button></div></form>`, true);
}

function openEditTaskForm(id, requestedScope = "today_and_future") {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return toast("任务不存在", "error");
  const editNextDay = task.status === "done" && task.scheduleType === "daily";
  if (!["todo", "redo"].includes(task.status) && !editNextDay) return toast(task.status === "pending" ? "孩子已经提交，请先处理后再修改" : "已确认的一次任务保留原记录，不能修改", "error");
  const selectedScope = editNextDay ? "future" : ["today", "today_and_future", "future"].includes(requestedScope) ? requestedScope : "today_and_future";
  const futureTask = task.nextDailyConfig ? { ...task, ...task.nextDailyConfig } : task.dailyConfig ? { ...task, ...task.dailyConfig } : task;
  const formTask = selectedScope === "future" ? futureTask : task;
  const description = selectedScope === "future" ? "修改内容从明天开始使用，今天的任务保持不变。" : selectedScope === "today" ? "只修改孩子端今天这项任务。" : "修改今天任务，并作为之后每天的新安排。";
  const helper = editNextDay ? "今天的完成记录和已发星币不会改变；改为一次任务后，明天起不再自动出现。" : "待完成或需要再完成的任务可立即修改；孩子提交后会暂时锁定。";
  resetTaskGuideSelection(formTask);
  const scopeField = task.scheduleType === "daily" ? (editNextDay
    ? `<input type="hidden" name="editScope" value="future"><div class="field span-2 task-edit-scope-note">${icon("calendar-clock")}今天的记录已经保留，本次修改从明天起使用。</div>`
    : `<div class="field span-2"><span>修改范围</span><div class="choice-options task-scope-options"><button type="button" class="choice-option ${selectedScope === "today" ? "active" : ""}" data-action="task-scope-option" data-id="${h(task.id)}" data-scope="today">${icon("calendar-check")}仅今天<small>之后每天保持原安排</small></button><button type="button" class="choice-option ${selectedScope === "today_and_future" ? "active" : ""}" data-action="task-scope-option" data-id="${h(task.id)}" data-scope="today_and_future">${icon("calendar-range")}今天和以后<small>从今天起都使用新安排</small></button><button type="button" class="choice-option ${selectedScope === "future" ? "active" : ""}" data-action="task-scope-option" data-id="${h(task.id)}" data-scope="future">${icon("calendar-clock")}明天起<small>今天保持不变</small></button></div><input type="hidden" name="editScope" value="${selectedScope}"><small>${selectedScope === "future" ? "下面显示的是明天起使用的安排。" : selectedScope === "today" ? "下面只修改今天这项任务。" : "下面会同时修改今天和之后每天的安排。"}</small></div>`)
    : "";
  openModal(`<div class="modal-header"><div><h2>编辑学习任务</h2><p>${description}</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><form id="edit-task-form" class="form-grid" data-task-form data-mode="edit" data-original-schedule="${h(task.scheduleType)}"><input type="hidden" name="id" value="${h(task.id)}">
    ${scopeField}${taskFormFields(formTask)}
    <div class="field span-2"><small>${helper}</small></div><div class="modal-actions field span-2"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit" data-testid="save-edit-task">${icon("save")}保存修改</button></div></form>`, true);
}

function openRedoForm(id) {
  const task = state.tasks.find((item) => item.id === id);
  openModal(`<div class="modal-header"><div><h2>需要再完成一下</h2><p>${h(task.title)}</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><form id="redo-form"><input type="hidden" name="id" value="${h(id)}"><label class="field"><span>给孩子的温和说明</span><textarea name="reason" required maxlength="120">还有一小部分需要检查，完成后再提交吧。</textarea></label><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">确认退回</button></div></form>`);
}

function digitalRequirement(type) {
  return {
    character: "透明 PNG/WebP，建议 1024×1536 或更高；完整人物居中、脚底锚点一致，不含背景和宠物。",
    background: "不透明 PNG/WebP，2048×1536、4:3；整张场景，不含人物、宠物、文字和按钮。",
    pet: "透明 PNG/WebP，建议 1024×1024 或更高；完整宠物居中、脚底锚点一致，不含人物和背景。"
  }[type];
}

function openDigitalForm() {
  clearDigitalStaticPreviewUrl();
  openModal(`<div class="modal-header"><div><h2>新增数字奖励</h2><p>静态图必填；短视频只需上传一次，由孩子的设备自动播放或回退静态图。</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><form id="digital-form"><div class="digital-form-scroll"><div class="form-grid"><label class="field"><span>奖励类型</span><select name="rewardType" data-testid="digital-type">${Object.entries(DIGITAL_TYPE).map(([key, item]) => `<option value="${key}">${item.label}</option>`).join("")}</select></label><label class="field"><span>星币价格</span><input name="price" type="number" min="0" max="9999" value="20" required data-testid="digital-price"></label><label class="field span-2"><span>奖励名称</span><input name="name" maxlength="40" required value="新的完整套装" data-testid="digital-name"></label><label class="field span-2"><span>孩子可见说明</span><textarea name="description" maxlength="160" required data-testid="digital-description">兑换后会一直归你，只会更换这一项装扮。</textarea></label><div class="field span-2"><div id="digital-requirement" class="requirement-note">${digitalRequirement("character")}</div></div><div class="field span-2 edit-asset-layout"><div id="digital-static-preview-box" class="edit-asset-preview character"><div id="digital-static-preview-empty" class="edit-asset-empty">${icon("image-up")}<strong>静态图预览</strong><small>选择图片后会在这里显示</small></div><img id="digital-static-preview" src="" alt="待上传静态图预览" hidden><span id="digital-static-preview-label" aria-live="polite">尚未选择静态图</span></div><div class="edit-upload-stack"><label class="upload-box compact required"><strong>${icon("image-up")}选择静态图（必填）</strong><small>PNG / WebP，选择后会立即在左侧预览</small><input name="staticFile" type="file" accept="image/png,image/webp" required data-testid="digital-static"></label>${digitalMotionUploadMarkup()}</div></div>${digitalMediaModeMarkup("static", false)}<label class="switch-field field span-2"><span><strong>保存后立即上架</strong><small>关闭后会先保存，孩子暂时看不到</small></span><span class="switch-control"><input name="active" type="checkbox" checked aria-label="保存后立即上架"><i></i></span></label></div></div><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit" data-testid="save-digital">${icon("save")}保存奖励</button></div></form>`, true);
}

function openEditDigitalForm(id) {
  const reward = state.digitalRewards.find((item) => item.id === id);
  if (!reward) return toast("数字奖励不存在", "error");
  const type = DIGITAL_TYPE[reward.type];
  clearDigitalStaticPreviewUrl();
  openModal(`<div class="modal-header"><div><h2>编辑数字奖励</h2><p>修改后会同步到孩子端商店和装扮页面。</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><form id="edit-digital-form"><input type="hidden" name="id" value="${h(reward.id)}"><div class="edit-digital-scroll"><div class="form-grid">
    <div class="field"><span>奖励类型</span><div class="locked-field">${icon(type.icon)}<strong>${h(type.label)}</strong><small>为保护装扮关系，类型不可修改</small></div></div>
    <label class="field"><span>星币价格</span><input name="price" type="number" min="0" max="9999" value="${reward.price}" required data-testid="edit-digital-price"></label>
    <label class="field span-2"><span>奖励名称</span><input name="name" maxlength="40" required value="${h(reward.name)}" data-testid="edit-digital-name"></label>
    <label class="field span-2"><span>孩子可见说明</span><textarea name="description" maxlength="160" required data-testid="edit-digital-description">${h(reward.description)}</textarea></label>
    <div class="field span-2"><div class="requirement-note">${digitalRequirement(reward.type)}</div></div>
    <div class="field span-2 edit-asset-layout"><div class="edit-asset-preview ${h(reward.type)}"><img id="edit-digital-static-preview" src="${h(reward.staticUrl)}" data-original-src="${h(reward.staticUrl)}" alt="当前静态图预览"><span id="edit-digital-static-preview-label" aria-live="polite">当前静态图</span></div><div class="edit-upload-stack"><label class="upload-box compact"><strong>${icon("image-up")}替换静态图（可选）</strong><small>选择后会在左侧预览，保存前不会生效</small><input name="staticFile" type="file" accept="image/png,image/webp" data-testid="edit-digital-static"></label>${digitalMotionUploadMarkup(configuredMotionUrl(reward))}</div></div>
    ${digitalMediaModeMarkup(effectiveMediaMode(reward), Boolean(reward.motionUrl || reward.motionSafariUrl))}
    <label class="switch-field field span-2"><span><strong>在孩子端上架</strong><small>关闭后，孩子暂时不能在商店兑换</small></span><span class="switch-control"><input name="active" type="checkbox" ${reward.active ? "checked" : ""} aria-label="在孩子端上架"><i></i></span></label>
    <div class="field span-2"><small>${reward.owned ? "这个奖励已经被孩子拥有。改价不会补扣或退还星币，只影响之后尚未兑换的奖励。" : "新价格只影响之后的兑换，已经发生的星币流水不会改变。"}</small></div>
  </div></div><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="button" data-action="save-edit-digital" data-testid="save-edit-digital">${icon("save")}保存修改</button></div></form>`, true);
}

function realCategoryOptions(selected) {
  return BUILT_IN_REWARD_IMAGES.map(([label]) => `<option ${label === selected ? "selected" : ""}>${h(label)}</option>`).join("");
}

function realImageChoices(selectedAssetId) {
  return BUILT_IN_REWARD_IMAGES.map(([label, url, id]) => `<button type="button" class="image-choice ${id === selectedAssetId ? "selected" : ""}" data-action="select-real-image" data-url="${h(url)}" data-asset-id="${h(id)}" data-label="${h(label)}"><img src="${h(url)}" alt=""><span>${h(label)}</span></button>`).join("");
}

function resetRealImageSelection(reward = null) {
  realImageSelection = reward ? {
    source: reward.imageSource === "custom_upload" ? "custom_upload" : "built_in",
    assetId: reward.imageAssetId || "",
    url: reward.imageUrl,
    customFile: null
  } : { source: "built_in", assetId: BUILT_IN_REWARD_IMAGES[0][2], url: BUILT_IN_REWARD_IMAGES[0][1], customFile: null };
}

function openRealForm() {
  resetRealImageSelection();
  openModal(`<div class="modal-header"><div><h2>新建现实奖励</h2><p>保存后的同一张图片会用于家长管理、孩子列表和详情。</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><form id="real-form" data-real-form><div class="form-grid"><label class="field"><span>奖励名称</span><input name="name" required maxlength="40" value="周末家庭活动" data-testid="real-name"></label><label class="field"><span>奖励类别</span><select name="category">${realCategoryOptions("户外活动")}</select></label><label class="field span-2"><span>孩子可见说明</span><textarea name="description" required maxlength="180" data-testid="real-description">周末和家人一起安排一项喜欢的活动。</textarea></label><label class="field"><span>星币价格</span><input name="price" type="number" min="0" value="40" required data-testid="real-price"></label><label class="field"><span>可兑换次数</span><input name="remaining" type="number" min="1" value="2" required></label><label class="field"><span>有效期</span><input name="validUntil" type="date" value="2026-12-31" required></label><label class="field"><span>再次兑换间隔（天）</span><input name="cooldownDays" type="number" min="0" value="0" required></label><label class="field span-2"><span>家长备注</span><textarea name="note">可根据家庭安排和孩子商量具体时间。</textarea></label><div class="field span-2"><span>奖励配图</span><div class="image-picker" id="real-image-picker">${realImageChoices(BUILT_IN_REWARD_IMAGES[0][2])}</div></div><label class="upload-box field span-2"><strong>${icon("upload")}上传家庭自定义图片</strong><small>PNG、JPG 或 WebP，选择后替换内置配图来源</small><input name="customImage" type="file" accept="image/png,image/jpeg,image/webp" data-testid="real-custom-image"></label><div class="field span-2"><div class="asset-preview"><img id="real-image-preview" src="${ASSETS.rewardOutdoor}" alt="当前奖励配图"></div><small id="real-image-source">配图来源：内置 · 户外活动</small></div><label class="switch-field field span-2"><span><strong>保存后立即上架</strong><small>关闭后会先保存，孩子暂时看不到</small></span><span class="switch-control"><input name="active" type="checkbox" checked aria-label="保存后立即上架"><i></i></span></label></div><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit" data-testid="save-real">${icon("save")}保存奖励</button></div></form>`, true);
}

function openEditRealForm(id) {
  const reward = state.realRewards.find((item) => item.id === id);
  if (!reward) return toast("现实奖励不存在", "error");
  resetRealImageSelection(reward);
  const sourceLabel = reward.imageSource === "custom_upload" ? "自定义上传" : `内置 · ${reward.category}`;
  openModal(`<div class="modal-header"><div><h2>编辑现实奖励</h2><p>保存后会同步到孩子端生活奖励页面。</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><form id="edit-real-form" data-real-form><input type="hidden" name="id" value="${h(reward.id)}"><div class="form-grid"><label class="field"><span>奖励名称</span><input name="name" required maxlength="40" value="${h(reward.name)}" data-testid="edit-real-name"></label><label class="field"><span>奖励类别</span><select name="category">${realCategoryOptions(reward.category)}</select></label><label class="field span-2"><span>孩子可见说明</span><textarea name="description" required maxlength="180" data-testid="edit-real-description">${h(reward.description)}</textarea></label><label class="field"><span>星币价格</span><input name="price" type="number" min="0" max="9999" value="${reward.price}" required data-testid="edit-real-price"></label><label class="field"><span>剩余可兑换次数</span><input name="remaining" type="number" min="0" max="9999" value="${reward.remaining}" required data-testid="edit-real-remaining"></label><label class="field"><span>有效期</span><input name="validUntil" type="date" value="${h(reward.validUntil)}" required></label><label class="field"><span>再次兑换间隔（天）</span><input name="cooldownDays" type="number" min="0" max="9999" value="${reward.cooldownDays}" required></label><label class="field span-2"><span>家长备注</span><textarea name="note" maxlength="200">${h(reward.note || "")}</textarea></label><div class="field span-2"><span>奖励配图</span><div class="image-picker" id="real-image-picker">${realImageChoices(reward.imageSource === "built_in" ? reward.imageAssetId : "")}</div></div><label class="upload-box field span-2"><strong>${icon("upload")}替换为家庭自定义图片（可选）</strong><small>不选择则保留当前配图；也可以重新选择上方内置图片</small><input name="customImage" type="file" accept="image/png,image/jpeg,image/webp" data-testid="edit-real-custom-image"></label><div class="field span-2"><div class="asset-preview"><img id="real-image-preview" src="${h(reward.imageUrl)}" alt="当前奖励配图"></div><small id="real-image-source">配图来源：${h(sourceLabel)}</small></div><label class="switch-field field span-2"><span><strong>在孩子端上架</strong><small>关闭后孩子暂时不能看到和申请这份奖励</small></span><span class="switch-control"><input name="active" type="checkbox" ${reward.active ? "checked" : ""} aria-label="在孩子端上架"><i></i></span></label><div class="field span-2"><small>新名称、图片和价格只影响之后的新申请；已经提交的兑换申请继续按申请当时的内容和星币价格处理。</small></div></div><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit" data-testid="save-edit-real">${icon("save")}保存修改</button></div></form>`, true);
}

function openResetForm() {
  resetVerificationCode = String(Math.floor(1000 + Math.random() * 9000));
  openModal(`<div class="modal-header"><div><h2>清空全部使用记录？</h2><p>任务、日历、完成照片、星币、兑换和已购装扮会清空；奖励配置、任务提示图与奖励素材会保留。</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><div class="captcha-box"><span>请输入下面的 4 位验证码</span><strong aria-label="清空验证码">${resetVerificationCode}</strong><input type="text" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="输入验证码" data-testid="reset-captcha-input"></div><div class="modal-actions"><button class="secondary-button" data-action="close-modal">取消</button><button class="danger-button" data-action="confirm-reset" data-testid="confirm-reset" disabled>确认清空</button></div>`);
}

function openRejectForm(id) {
  const item = state.redemptions.find((entry) => entry.id === id);
  openModal(`<div class="modal-header"><div><h2>不同意并解冻星币</h2><p>${h(item.rewardName)} · ${item.amount} 星币</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("x")}</button></div><div id="reject-form"><label class="field"><span>给孩子的说明</span><textarea name="reason" required maxlength="120">这次时间不合适，我们可以一起选择其他奖励。</textarea></label><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="danger-button" type="button" data-action="confirm-reject-real" data-id="${h(id)}" data-testid="confirm-reject-real">确认不同意并解冻</button></div></div>`);
}

async function parentAction(type, payload, successMessage) {
  try {
    state = await action(type, payload, true);
    closeModal();
    closeTaskDetail();
    render();
    if (successMessage) toast(successMessage);
  } catch (error) {
    if (error.message.includes("家长验证")) showLogin();
    toast(error.message, "error");
  }
}

async function saveTaskForm(form, type) {
  if (!form.reportValidity()) return;
  const button = form.querySelector("[type='submit']");
  const originalLabel = button.innerHTML;
  const previousGuideUrl = taskGuideSelection.originalGuideImage?.url || "";
  let uploadedUrl = "";
  button.disabled = true;
  button.textContent = taskGuideSelection.file ? "正在上传图片并保存…" : "正在保存…";
  try {
    const values = Object.fromEntries(new FormData(form));
    values.due = values.duePreset === "custom" ? values.dueCustom : values.duePreset;
    delete values.duePreset;
    delete values.dueCustom;
    delete values.guideCamera;
    delete values.guideLibrary;

    if (taskGuideSelection.file) {
      const uploaded = await uploadAsset(taskGuideSelection.file, {
        purpose: "task_guide",
        width: taskGuideSelection.metadata.width,
        height: taskGuideSelection.metadata.height
      });
      uploadedUrl = uploaded.url;
      values.guideImage = {
        url: uploaded.url,
        thumbnailUrl: uploaded.url,
        mimeType: uploaded.mimeType,
        width: uploaded.width,
        height: uploaded.height,
        updatedAt: uploaded.updatedAt
      };
    } else {
      values.guideImage = taskGuideSelection.removed ? null : taskGuideSelection.guideImage;
    }

    state = await action(type, values, true);
    const nextGuideUrl = values.guideImage?.url || "";
    if (previousGuideUrl && previousGuideUrl !== nextGuideUrl) await discardUploadedAsset(previousGuideUrl).catch(() => {});
    closeModal();
    render();
    toast(type === "createTask" ? "学习任务已创建，孩子端可以看到" : values.editScope === "future" ? "新的安排已保存，将从明天开始" : "任务已更新，孩子端会同步显示");
  } catch (error) {
    if (uploadedUrl) await discardUploadedAsset(uploadedUrl).catch(() => {});
    if (error.message.includes("家长验证")) showLogin();
    else toast(error.message, "error");
    if (document.body.contains(button)) {
      button.disabled = false;
      button.innerHTML = originalLabel;
      hydrateIcons();
    }
  }
}

async function saveEditDigital(form) {
  if (!form.reportValidity()) return;
  const button = form.querySelector("[data-testid='save-edit-digital']");
  button.disabled = true;
  button.textContent = "正在保存…";
  try {
    const data = new FormData(form);
    const reward = state.digitalRewards.find((item) => item.id === data.get("id"));
    if (!reward) throw new Error("数字奖励不存在");
    const staticFile = data.get("staticFile");
    const motionFile = data.get("motionFile");
    const clearMotion = data.get("clearMotion") === "1";
    const clearSafariMotion = data.get("clearSafariMotion") === "1";
    const oldMotionUrl = reward.motionUrl || "";
    const oldMotionSafariUrl = reward.motionSafariUrl || "";
    const staticUrl = staticFile?.size ? (await uploadAsset(staticFile)).url : reward.staticUrl;
    const uploadedMotionUrl = motionFile?.size ? (await uploadAsset(motionFile, { purpose: "motion" })).url : "";
    const motionUrl = clearMotion ? "" : uploadedMotionUrl || reward.motionUrl;
    const motionSafariUrl = clearSafariMotion ? "" : reward.motionSafariUrl || "";
    state = await action("updateDigitalReward", {
      id: reward.id, name: data.get("name"), description: data.get("description"), price: data.get("price"),
      staticUrl, motionUrl, motionSafariUrl, mediaMode: data.get("mediaMode"), clearMotion, clearSafariMotion, active: data.get("active") === "on"
    }, true);
    if (oldMotionUrl && oldMotionUrl !== motionUrl) await discardUploadedAsset(oldMotionUrl).catch(() => {});
    if (oldMotionSafariUrl && oldMotionSafariUrl !== motionSafariUrl) await discardUploadedAsset(oldMotionSafariUrl).catch(() => {});
    closeModal();
    render();
    toast("数字奖励已更新，孩子端会同步显示");
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
    button.innerHTML = `${icon("save")}保存修改`;
    hydrateIcons();
  }
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorNode = document.querySelector("#login-error");
  errorNode.textContent = "";
  try {
    await login(new FormData(event.currentTarget).get("pin"));
    state = await getState();
    showApp();
  } catch (error) {
    errorNode.textContent = error.message;
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-view], [data-action]");
  if (!target) return;
  if (target.matches("button:not(:disabled)")) target.focus({ preventScroll: true });
  if (target.dataset.view) {
    view = target.dataset.view;
    if (target.dataset.taskFilter) taskFilter = target.dataset.taskFilter;
    if (target.dataset.recordMode) recordMode = target.dataset.recordMode;
    if (target.dataset.recordPeriod) recordPeriod = target.dataset.recordPeriod;
    if (target.dataset.recordStatus) recordStatus = target.dataset.recordStatus;
    const focusTarget = target.dataset.focusTarget;
    parentApp.classList.remove("menu-open");
    closeTaskDetail();
    try {
      state = await getState();
      render();
      if (focusTarget) {
        requestAnimationFrame(() => {
          const destination = document.getElementById(focusTarget);
          destination?.scrollIntoView({ behavior: "smooth", block: "start" });
          destination?.focus({ preventScroll: true });
        });
      }
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }
  const command = target.dataset.action;
  const id = target.dataset.id;
  if (command === "close-modal") {
    if (target.classList.contains("modal-backdrop") && event.target !== target) return;
    closeModal();
  }
  if (command === "close-motion-preview") {
    if (target.matches("[data-motion-preview]") && event.target !== target) return;
    target.closest("[data-motion-preview]")?.remove();
  }
  if (command === "close-task-detail") {
    if (target.classList.contains("task-detail-backdrop") && event.target !== target) return;
    closeTaskDetail();
  }
  if (command === "toggle-menu") parentApp.classList.toggle("menu-open");
  if (command === "open-child") window.open("/product/child/", "_blank", "noopener");
  if (command === "new-task") openTaskForm();
  if (command === "edit-task") openEditTaskForm(id);
  if (command === "edit-task-from-detail") { closeTaskDetail(); openEditTaskForm(id); }
  if (command === "view-task-image" && target.dataset.url) showImageViewer(target.dataset.url, target.dataset.alt || "任务提示图");
  if (command === "view-completion-image" && target.dataset.url) showImageViewer(target.dataset.url, target.dataset.alt || "完成照片");
  if (command === "view-digital-motion") openDigitalMotionPreview(target.dataset.url);
  if (command === "digital-media-mode") setDigitalMediaMode(target.closest("#digital-form, #edit-digital-form"), target.dataset.mode);
  if (command === "clear-digital-motion") clearDigitalMotionSelection(target.closest("#digital-form, #edit-digital-form"));
  if (command === "task-detail") openTaskDetail(state.tasks.find((item) => item.id === id));
  if (command === "task-detail-record") openTaskDetail(state.taskDayRecords.find((item) => item.id === id), true);
  if (command === "remove-task-guide") {
    clearTaskGuidePreviewUrl();
    taskGuideSelection = { guideImage: null, originalGuideImage: taskGuideSelection.originalGuideImage, file: null, metadata: null, removed: true };
    document.querySelectorAll("[data-task-guide-input]").forEach((input) => { input.value = ""; });
    updateTaskGuidePreview();
  }
  if (command === "task-filter") { taskFilter = target.dataset.filter; render(); }
  if (command === "subject-option") {
    const form = target.closest("[data-task-form]");
    if (!form) return;
    const preset = TASK_PRESETS[target.dataset.subject];
    form.querySelectorAll("[data-action='subject-option']").forEach((button) => button.classList.toggle("active", button === target));
    form.querySelector("[name='subject']").value = target.dataset.subject;
    if (form.dataset.mode === "create") {
      form.querySelector("[name='title']").value = preset.title;
      form.querySelector("[name='description']").value = preset.description;
    }
  }
  if (command === "schedule-option") {
    const form = target.closest("[data-task-form]");
    if (!form) return;
    if (form.dataset.originalSchedule === "daily" && target.dataset.schedule !== "daily" && form.querySelector("[name='editScope']")?.value === "today") {
      toast("任务类型属于重复安排，请先选择“明天起”再修改", "error");
      return;
    }
    form.querySelectorAll("[data-action='schedule-option']").forEach((button) => button.classList.toggle("active", button === target));
    form.querySelector("[name='scheduleType']").value = target.dataset.schedule;
  }
  if (command === "photo-policy-option") {
    const form = target.closest("[data-task-form]");
    if (!form) return;
    form.querySelectorAll("[data-action='photo-policy-option']").forEach((button) => button.classList.toggle("active", button === target));
    form.querySelector("[name='photoPolicy']").value = target.dataset.policy;
  }
  if (command === "task-scope-option") {
    const form = target.closest("[data-task-form]");
    if (!form) return;
    if (form.querySelector("[name='editScope']").value !== target.dataset.scope) openEditTaskForm(target.dataset.id, target.dataset.scope);
  }
  if (command === "confirm-task") await parentAction("confirmTask", { id }, "任务已确认，星币已经到账");
  if (command === "redo-task") openRedoForm(id);
  if (command === "reward-mode") { rewardMode = target.dataset.mode; render(); }
  if (command === "record-mode") { recordMode = target.dataset.mode; render(); }
  if (command === "record-period") { recordPeriod = target.dataset.value; render(); }
  if (command === "new-digital") openDigitalForm();
  if (command === "edit-digital") openEditDigitalForm(id);
  if (command === "save-edit-digital") await saveEditDigital(target.form);
  if (command === "new-real") openRealForm();
  if (command === "edit-real") openEditRealForm(id);
  if (command === "toggle-digital") parentAction("toggleDigitalReward", { id, active: target.dataset.active !== "true" }, "数字奖励状态已更新");
  if (command === "toggle-real") parentAction("toggleRealReward", { id, active: target.dataset.active !== "true" }, "现实奖励状态已更新");
  if (command === "approve-real") parentAction("decideRealReward", { id, decision: "approve" }, "已同意，等待现实兑现");
  if (command === "reject-real") openRejectForm(id);
  if (command === "confirm-reject-real") {
    const reason = document.querySelector("#reject-form [name='reason']")?.value;
    await parentAction("decideRealReward", { id, decision: "reject", reason }, "已不同意，冻结星币已经解冻");
  }
  if (command === "fulfill-real") parentAction("fulfillRealReward", { id }, "已确认兑现，冻结星币已正式支付");
  if (command === "reset-data") openResetForm();
  if (command === "confirm-reset") {
    const value = document.querySelector("[data-testid='reset-captcha-input']")?.value.trim();
    if (value !== resetVerificationCode) toast("验证码不正确，请重新输入", "error");
    else parentAction("reset", {}, "使用记录已清空");
  }
  if (command === "select-real-image") {
    const form = target.closest("[data-real-form]");
    if (!form) return;
    document.querySelectorAll(".image-choice").forEach((button) => button.classList.remove("selected"));
    target.classList.add("selected");
    realImageSelection = { source: "built_in", assetId: target.dataset.assetId, url: target.dataset.url, customFile: null };
    form.querySelector("[name='category']").value = target.dataset.label;
    document.querySelector("#real-image-preview").src = target.dataset.url;
    document.querySelector("#real-image-source").textContent = `配图来源：内置 · ${target.dataset.label}`;
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.matches("[data-action='record-status']")) { recordStatus = event.target.value; render(); }
  if (event.target.matches("[data-action='record-subject']")) { recordSubject = event.target.value; render(); }
  if (event.target.matches("[data-task-guide-input]")) await selectTaskGuideFile(event.target.files?.[0], event.target);
  if (event.target.matches("#digital-form [name='rewardType']")) {
    document.querySelector("#digital-requirement").textContent = digitalRequirement(event.target.value);
    const previewBox = document.querySelector("#digital-static-preview-box");
    previewBox?.classList.remove("character", "background", "pet");
    previewBox?.classList.add(event.target.value);
  }
  if (event.target.matches("#digital-form [name='staticFile']")) {
    const file = event.target.files?.[0];
    const preview = document.querySelector("#digital-static-preview");
    const empty = document.querySelector("#digital-static-preview-empty");
    const label = document.querySelector("#digital-static-preview-label");
    if (!preview || !empty || !label) return;
    clearDigitalStaticPreviewUrl();
    if (!file) {
      preview.hidden = true;
      preview.removeAttribute("src");
      empty.hidden = false;
      label.textContent = "尚未选择静态图";
      return;
    }
    digitalStaticPreviewUrl = URL.createObjectURL(file);
    preview.src = digitalStaticPreviewUrl;
    preview.alt = `${file.name} 预览`;
    preview.hidden = false;
    empty.hidden = true;
    label.textContent = `待上传预览 · ${file.name}`;
  }
  if (event.target.matches("#edit-digital-form [name='staticFile']")) {
    const file = event.target.files?.[0];
    const preview = document.querySelector("#edit-digital-static-preview");
    const label = document.querySelector("#edit-digital-static-preview-label");
    if (!preview || !label) return;
    clearDigitalStaticPreviewUrl();
    if (!file) {
      preview.src = preview.dataset.originalSrc;
      preview.alt = "当前静态图预览";
      label.textContent = "当前静态图";
      return;
    }
    digitalStaticPreviewUrl = URL.createObjectURL(file);
    preview.src = digitalStaticPreviewUrl;
    preview.alt = `${file.name} 预览`;
    label.textContent = `待保存预览 · ${file.name}`;
  }
  if (event.target.matches("#digital-form [name='motionFile'], #edit-digital-form [name='motionFile']")) {
    updateDigitalMotionSelection(event.target);
  }
  if (event.target.matches("[data-task-form] [name='duePreset']")) {
    const form = event.target.closest("[data-task-form]");
    const customField = form.querySelector(".custom-due-field");
    const customInput = customField.querySelector("input");
    customField.hidden = event.target.value !== "custom";
    customInput.required = event.target.value === "custom";
    if (customInput.required) customInput.focus();
  }
  if (event.target.matches("[data-real-form] [name='customImage']") && event.target.files[0]) {
    const file = event.target.files[0];
    realImageSelection = { source: "custom_upload", assetId: "", url: URL.createObjectURL(file), customFile: file };
    document.querySelectorAll(".image-choice").forEach((button) => button.classList.remove("selected"));
    document.querySelector("#real-image-preview").src = realImageSelection.url;
    document.querySelector("#real-image-source").textContent = `配图来源：自定义上传 · ${file.name}`;
  }
  if (event.target.matches("[data-real-form] [name='category']") && realImageSelection.source === "built_in") {
    const match = BUILT_IN_REWARD_IMAGES.find(([label]) => label === event.target.value);
    if (!match) return;
    const [label, url, assetId] = match;
    realImageSelection = { source: "built_in", assetId, url, customFile: null };
    document.querySelectorAll(".image-choice").forEach((button) => button.classList.toggle("selected", button.dataset.assetId === assetId));
    document.querySelector("#real-image-preview").src = url;
    document.querySelector("#real-image-source").textContent = `配图来源：内置 · ${label}`;
  }
});

document.addEventListener("input", (event) => {
  if (!event.target.matches("[data-testid='reset-captcha-input']")) return;
  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 4);
  const button = document.querySelector("[data-testid='confirm-reset']");
  if (button) button.disabled = event.target.value !== resetVerificationCode;
});

document.addEventListener("submit", async (event) => {
  const formId = event.target.getAttribute("id");
  if (formId === "task-form") {
    event.preventDefault();
    await saveTaskForm(event.target, "createTask");
  }
  if (formId === "edit-task-form") {
    event.preventDefault();
    await saveTaskForm(event.target, "updateTask");
  }
  if (formId === "redo-form") {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    await parentAction("redoTask", values, "已经退回，孩子可重新完成并提交");
  }
  if (formId === "digital-form") {
    event.preventDefault();
    const button = event.target.querySelector("[type='submit']");
    button.disabled = true;
    button.textContent = "正在上传并保存…";
    try {
      const data = new FormData(event.target);
      const staticFile = data.get("staticFile");
      const motionFile = data.get("motionFile");
      const staticAsset = await uploadAsset(staticFile);
      const motionAsset = motionFile?.size ? await uploadAsset(motionFile, { purpose: "motion" }) : { url: "" };
      await parentAction("createDigitalReward", {
        rewardType: data.get("rewardType"), name: data.get("name"), description: data.get("description"),
        price: data.get("price"), staticUrl: staticAsset.url, motionUrl: motionAsset.url, mediaMode: data.get("mediaMode"), active: data.get("active") === "on"
      }, "数字奖励已保存并进入奖励池");
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
      button.innerHTML = `${icon("save")}保存奖励`;
      hydrateIcons();
    }
  }
  if (formId === "real-form") {
    event.preventDefault();
    const button = event.target.querySelector("[type='submit']");
    button.disabled = true;
    button.textContent = "正在保存…";
    try {
      const data = new FormData(event.target);
      let imageUrl = realImageSelection.url;
      if (realImageSelection.customFile) imageUrl = (await uploadAsset(realImageSelection.customFile)).url;
      await parentAction("createRealReward", {
        name: data.get("name"), category: data.get("category"), description: data.get("description"), price: data.get("price"),
        remaining: data.get("remaining"), validUntil: data.get("validUntil"), cooldownDays: data.get("cooldownDays"), note: data.get("note"),
        imageSource: realImageSelection.source, imageAssetId: realImageSelection.assetId, imageUrl, active: data.get("active") === "on"
      }, "现实奖励已保存，孩子端会使用同一张配图");
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
      button.innerHTML = `${icon("save")}保存奖励`;
      hydrateIcons();
    }
  }
  if (formId === "edit-real-form") {
    event.preventDefault();
    const button = event.target.querySelector("[type='submit']");
    button.disabled = true;
    button.textContent = "正在保存…";
    try {
      const data = new FormData(event.target);
      const reward = state.realRewards.find((item) => item.id === data.get("id"));
      if (!reward) throw new Error("现实奖励不存在");
      let imageUrl = realImageSelection.url || reward.imageUrl;
      if (realImageSelection.customFile) imageUrl = (await uploadAsset(realImageSelection.customFile)).url;
      await parentAction("updateRealReward", {
        id: reward.id, name: data.get("name"), category: data.get("category"), description: data.get("description"), price: data.get("price"),
        remaining: data.get("remaining"), validUntil: data.get("validUntil"), cooldownDays: data.get("cooldownDays"), note: data.get("note"),
        imageSource: realImageSelection.source, imageAssetId: realImageSelection.assetId, imageUrl, active: data.get("active") === "on"
      }, "现实奖励已更新，孩子端会同步显示");
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
      button.innerHTML = `${icon("save")}保存修改`;
      hydrateIcons();
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || document.querySelector("#global-image-viewer")) return;
  if (modalRoot.children.length) closeModal();
  else if (taskDetailRoot.children.length) closeTaskDetail();
});
document.addEventListener("error", (event) => {
  if (!event.target.matches?.("[data-task-guide-image], [data-completion-image]")) return;
  const container = event.target.closest("button");
  if (container && !container.hidden) {
    container.innerHTML = `${icon("image-off")}<span>图片暂时无法显示，请稍后重试</span>`;
    container.classList.add("broken-image");
    hydrateIcons();
  }
}, true);

async function restoreSession() {
  const token = sessionStorage.getItem("yubao-parent-token");
  if (!token) return showLogin();
  try {
    const response = await fetch("/api/session", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("expired");
    state = await getState();
    showApp();
  } catch {
    showLogin();
  }
}

await restoreSession();
setInterval(async () => {
  if (document.hidden || parentApp.hidden || modalRoot.children.length || taskDetailRoot.children.length) return;
  try {
    state = await getState();
    render();
  } catch {
    // A later authenticated action will surface connection or session errors.
  }
}, 5000);
