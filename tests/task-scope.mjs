import assert from "node:assert/strict";
import {
  activeTasks, activeTasksForToday, childTasksForDate, confirmedTaskRecords, overdueTasks
} from "../product/task-scope.js";

const today = "2026-09-15";
const oldCompleted = Array.from({ length: 24 }, (_, index) => ({
  id: `old-${index}`, taskId: `old-${index}`, date: "2026-09-11", status: "done", earnedCoins: 5
}));
const source = {
  today,
  tasks: [
    ...oldCompleted.map((record) => ({ id: record.taskId, activeDate: record.date, status: "done", scheduleType: "once" })),
    { id: "today-reading", activeDate: today, status: "todo", scheduleType: "daily" },
    { id: "today-math", activeDate: today, status: "pending", scheduleType: "daily" },
    { id: "late-chinese", activeDate: "2026-09-14", status: "todo", scheduleType: "once" },
    { id: "late-math", activeDate: "2026-09-14", status: "redo", scheduleType: "once" },
    { id: "late-english", activeDate: "2026-09-14", status: "pending", scheduleType: "once" }
  ],
  taskDayRecords: [
    ...oldCompleted,
    { id: "today-reading:2026-09-15", taskId: "today-reading", date: today, status: "todo" },
    { id: "today-math:2026-09-15", taskId: "today-math", date: today, status: "pending" }
  ]
};

assert.equal(childTasksForDate(source).length, 2, "child today scope must not include historical completed tasks");
assert.equal(activeTasks(source).length, 5, "parent active scope must include today and unresolved overdue tasks only");
assert.equal(activeTasksForToday(source).length, 2, "parent today scope must include only unresolved tasks dated today");
assert.equal(overdueTasks(source).length, 3, "overdue scope must include unresolved tasks before today");
assert.equal(confirmedTaskRecords(source).length, 24, "completed history must remain available from task-day records");
assert.equal(confirmedTaskRecords(source, today).length, 0, "today confirmed count must use today's record date");

const archivedToday = structuredClone(source);
archivedToday.tasks = archivedToday.tasks.filter((task) => task.id !== "today-reading");
archivedToday.taskDayRecords.find((record) => record.taskId === "today-reading").status = "done";
assert.equal(childTasksForDate(archivedToday).length, 2, "today history must stay visible after a completed task leaves the active collection");
assert.equal(childTasksForDate(archivedToday).filter((task) => task.status === "done").length, 1);

console.log("PASS task scope counts keep today, overdue and completed history separate");
