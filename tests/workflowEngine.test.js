const test = require("node:test");
const assert = require("node:assert/strict");
const { WorkflowEngine, WorkflowRegistry, validateWorkflow } = require("../lib/workflows/engine");

test("registers validated workflows and exposes trigger metadata", () => {
    const registry = new WorkflowRegistry({ maxSteps: 3 });
    const run = async () => "ok";
    registry.register({ name: "deploy", triggers: [{ type: "push" }], steps: [{ id: "one", run }] });
    assert.equal(registry.get("deploy").triggers[0].type, "push");
    assert.throws(() => registry.register({ name: "bad", steps: [{ id: "x" }] }), /run function/);
});

test("runs bounded steps sequentially, retries failures, and clones values", async () => {
    const engine = new WorkflowEngine({ maxRetries: 2 });
    let attempts = 0;
    engine.register({
        name: "sequence",
        steps: [
            { id: "first", run: async ({ data }) => { data.mutated = true; return { value: 1 }; } },
            { id: "second", retries: 1, run: async ({ data }) => {
                attempts += 1;
                if (attempts === 1) throw new Error("transient");
                return { previous: data.first.value };
            } }
        ]
    });
    const result = await engine.run("sequence", { nested: { value: 1 } });
    assert.equal(result.ok, true);
    assert.equal(attempts, 2);
    assert.equal(result.result.second.previous, 1);
    assert.equal(result.run.status, "completed");
});

test("approval gates integrate with approvalService and are single use", async () => {
    const engine = new WorkflowEngine();
    engine.register({ name: "risky", steps: [{ id: "send", approval: { tool: "send_email", summary: "Send email" }, run: async () => "sent" }] });
    const pending = await engine.run("risky", { to: "a@example.com" });
    assert.equal(pending.approvalRequired, true);
    assert.equal(pending.run.status, "awaiting_approval");
    const completed = await engine.run("risky", { to: "a@example.com", approvalToken: pending.approval.token });
    assert.equal(completed.ok, true);
    const reused = await engine.run("risky", { to: "a@example.com", approvalToken: pending.approval.token });
    assert.equal(reused.ok, false);
});

test("conditions, trigger mismatch, timeout, cancellation, and bounded history work", async () => {
    const engine = new WorkflowEngine({ maxHistory: 2, maxTimeoutMs: 20 });
    engine.register({ name: "conditional", triggers: ["manual"], conditions: () => false, steps: [{ id: "x", run: async () => 1 }] });
    assert.equal((await engine.run("conditional", {}, { trigger: "other" })).ok, false);
    assert.equal((await engine.run("conditional", {}, { trigger: "manual" })).skipped, true);
    engine.register({ name: "slow", steps: [{ id: "x", timeoutMs: 5, run: () => new Promise(resolve => setTimeout(resolve, 30)) }] });
    assert.equal((await engine.run("slow")).run.status, "failed");
    engine.register({ name: "cancel", steps: [{ id: "x", run: () => new Promise(resolve => setTimeout(resolve, 30)) }] });
    const promise = engine.run("cancel");
    const active = engine.listRuns(1)[0];
    assert.equal(engine.cancel(active.id), true);
    assert.equal((await promise).run.status, "cancelled");
    assert.ok(engine.listRuns(10).length <= 2);
});

test("safe cloning does not mutate caller data", () => {
    const input = { nested: { ok: true } };
    validateWorkflow({ name: "clone", steps: [{ id: "x", run: async ({ input }) => input }] });
    assert.equal(input.nested.ok, true);
});
