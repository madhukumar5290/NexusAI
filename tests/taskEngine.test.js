const test = require("node:test");
const assert = require("node:assert");

/*
Task engine tests use a fresh DB in temp storage
via the shared config; these run against the real
shared db but only touch tasks/task_activity.
*/

const taskEngine = require("../src/agent/taskEngine");

test("createTask persists goal, plan, status", () => {
    const task = taskEngine.createTask({
        chatId: 1,
        goal: "build a website",
        plan: ["understand", "plan", "execute"]
    });

    assert.ok(task.id > 0);
    assert.strictEqual(task.goal, "build a website");
    assert.strictEqual(task.status, "queued");
    assert.strictEqual(task.plan.length, 3);
    assert.strictEqual(task.stepsTotal, 3);
});

test("setStatus and updateTask update fields", () => {
    const task = taskEngine.createTask({
        goal: "test update",
        plan: ["a", "b"]
    });

    const running = taskEngine.setStatus(task.id, "running");
    assert.strictEqual(running.status, "running");

    const updated = taskEngine.updateTask(task.id, {
        status: "completed",
        stepsDone: 2,
        stepsTotal: 2,
        result: "all files verified"
    });

    assert.strictEqual(updated.status, "completed");
    assert.strictEqual(updated.stepsDone, 2);
    assert.strictEqual(updated.result, "all files verified");
});

test("activity log records and orders events", () => {
    const task = taskEngine.createTask({
        goal: "activity test",
        plan: []
    });

    taskEngine.addActivity(task.id, "first");
    taskEngine.addActivity(task.id, "second");
    taskEngine.addActivity(task.id, "boom", "error");

    const activity = taskEngine.getActivity(task.id);

    assert.strictEqual(activity.length, 3);
    assert.strictEqual(activity[0].message, "first");
    assert.strictEqual(activity[2].message, "boom");
    assert.strictEqual(activity[2].status, "error");
});

test("listTasks returns newest first", () => {
    const list = taskEngine.listTasks(5);
    assert.ok(Array.isArray(list));
    if (list.length > 1) {
        assert.ok(list[0].id >= list[1].id);
    }
});

test("deleteTask removes the record", () => {
    const task = taskEngine.createTask({ goal: "delete me" });
    taskEngine.deleteTask(task.id);
    assert.strictEqual(taskEngine.getTask(task.id), null);
});

test("task status is validated and only pending tasks can be cancelled", () => {
    const task = taskEngine.createTask({ goal: "cancel me" });

    assert.throws(
        () => taskEngine.setStatus(task.id, "anything"),
        /Invalid task status/
    );

    const cancelled = taskEngine.cancelTask(task.id);
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.task.status, "cancelled");
    assert.equal(taskEngine.getActivity(task.id).at(-1).status, "cancelled");

    const completed = taskEngine.createTask({ goal: "already done" });
    taskEngine.setStatus(completed.id, "completed");
    assert.equal(taskEngine.cancelTask(completed.id).code, "NOT_CANCELLABLE");
});
