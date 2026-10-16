const UNRESOLVED_STATUSES = new Set(["todo", "redo", "pending"]);

export function taskDate(item, fallback = "") {
  return String(item?.activeDate || item?.date || fallback || "");
}

export function isUnresolvedTask(task) {
  return UNRESOLVED_STATUSES.has(task?.status);
}

export function taskRecordsForDate(source, date = source?.today || "") {
  return (source?.taskDayRecords || []).filter((record) => record.date === date);
}

export function childTasksForDate(source, date = source?.today || "") {
  const tasks = source?.tasks || [];
  const liveByKey = new Map(tasks.map((task) => [`${task.id}:${taskDate(task, source?.today)}`, task]));
  const records = taskRecordsForDate(source, date);
  const seen = new Set();
  const items = records.map((record) => {
    const key = `${record.taskId}:${record.date}`;
    seen.add(key);
    return liveByKey.get(key) || { ...record, id: record.taskId || record.id, historical: true };
  });

  for (const task of tasks) {
    const key = `${task.id}:${taskDate(task, source?.today)}`;
    if (taskDate(task, source?.today) === date && !seen.has(key)) items.push(task);
  }
  return items;
}

export function overdueTasks(source) {
  const today = source?.today || "";
  return (source?.tasks || []).filter((task) => {
    const date = taskDate(task, today);
    return isUnresolvedTask(task) && Boolean(date) && date < today;
  });
}

export function activeTasks(source) {
  const today = source?.today || "";
  return (source?.tasks || []).filter((task) => {
    const date = taskDate(task, today);
    return isUnresolvedTask(task) && (!date || date <= today);
  });
}

export function activeTasksForToday(source) {
  const today = source?.today || "";
  return activeTasks(source).filter((task) => taskDate(task, today) === today);
}

export function confirmedTaskRecords(source, date = "") {
  return (source?.taskDayRecords || []).filter((record) => record.status === "done" && (!date || record.date === date));
}
