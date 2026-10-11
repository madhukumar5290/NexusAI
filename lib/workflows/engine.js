"use strict";

const crypto = require("crypto");
const defaultApprovalService = require("../../src/agent/approvalService");

const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function cloneSafe(value, seen = new WeakMap()) {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof Error) return { name: value.name, message: value.message };
    if (Array.isArray(value)) {
        const result = [];
        seen.set(value, result);
        value.forEach(item => result.push(cloneSafe(item, seen)));
        return result;
    }
    const result = {};
    seen.set(value, result);
    Object.keys(value).forEach(key => {
        if (!RESERVED_KEYS.has(key)) result[key] = cloneSafe(value[key], seen);
    });
    return result;
}

function assert(condition, message) {
    if (!condition) throw new TypeError(message);
}

function validateWorkflow(definition, limits = {}) {
    assert(definition && typeof definition === "object", "Workflow must be an object.");
    assert(typeof definition.name === "string" && definition.name.trim(), "Workflow name is required.");
    assert(Array.isArray(definition.steps) && definition.steps.length > 0, "Workflow steps are required.");
    const maxSteps = limits.maxSteps || 50;
    assert(definition.steps.length <= maxSteps, `Workflow cannot contain more than ${maxSteps} steps.`);
    definition.steps.forEach((step, index) => {
        assert(step && typeof step === "object", `Step ${index} must be an object.`);
        assert(typeof step.id === "string" && step.id.trim(), `Step ${index} id is required.`);
        assert(typeof step.run === "function", `Step "${step.id}" must provide a run function.`);
        const retries = step.retries == null ? 0 : Number(step.retries);
        assert(Number.isInteger(retries) && retries >= 0, `Step "${step.id}" retries must be a non-negative integer.`);
        if (step.timeoutMs != null) assert(Number.isFinite(step.timeoutMs) && step.timeoutMs > 0, `Step "${step.id}" timeoutMs must be positive.`);
    });
    const ids = new Set();
    definition.steps.forEach(step => {
        assert(!ids.has(step.id), `Duplicate workflow step id "${step.id}".`);
        ids.add(step.id);
    });
    return true;
}

function withTimeout(promise, timeoutMs, signal) {
    if (!timeoutMs && !signal) return promise;
    return new Promise((resolve, reject) => {
        let timer;
        const abort = () => {
            if (timer) clearTimeout(timer);
            reject(Object.assign(new Error("Operation cancelled."), { code: "CANCELLED" }));
        };
        if (signal) {
            if (signal.aborted) return abort();
            signal.addEventListener("abort", abort, { once: true });
        }
        if (timeoutMs) timer = setTimeout(() => reject(Object.assign(new Error("Step timed out."), { code: "TIMEOUT" })), timeoutMs);
        Promise.resolve(promise).then(value => {
            if (timer) clearTimeout(timer);
            if (signal) signal.removeEventListener("abort", abort);
            resolve(value);
        }, error => {
            if (timer) clearTimeout(timer);
            if (signal) signal.removeEventListener("abort", abort);
            reject(error);
        });
    });
}

class WorkflowRegistry {
    constructor({ maxSteps = 50 } = {}) {
        this.maxSteps = maxSteps;
        this.workflows = new Map();
    }

    register(definition) {
        validateWorkflow(definition, this);
        const workflow = cloneSafe(definition);
        workflow.steps = definition.steps.map(step => ({ ...cloneSafe(step), run: step.run }));
        this.workflows.set(workflow.name, workflow);
        return cloneSafe(workflow);
    }

    unregister(name) { return this.workflows.delete(name); }
    get(name) { const workflow = this.workflows.get(name); return workflow ? cloneSafe(workflow) : null; }
    list() { return [...this.workflows.values()].map(item => cloneSafe(item)); }
}

class WorkflowEngine {
    constructor({ registry = new WorkflowRegistry(), approvalService = defaultApprovalService, maxSteps = 50, maxRetries = 3, maxTimeoutMs = 10 * 60 * 1000, maxHistory = 100 } = {}) {
        this.registry = registry;
        this.approvalService = approvalService;
        this.maxSteps = maxSteps;
        this.maxRetries = maxRetries;
        this.maxTimeoutMs = maxTimeoutMs;
        this.maxHistory = maxHistory;
        this.history = [];
        this.active = new Map();
    }

    register(workflow) { return this.registry.register(workflow); }
    listWorkflows() { return this.registry.list().map(item => ({ ...item, steps: item.steps.map(step => ({ ...step, run: undefined })) })); }
    getRun(id) { const run = this.history.find(item => item.id === id); return run ? cloneSafe(run) : null; }
    listRuns(limit = 50) { return this.history.slice(-Math.max(0, Number(limit) || 0)).reverse().map(item => cloneSafe(item)); }

    cancel(runId) {
        const active = this.active.get(runId);
        if (!active) return false;
        active.controller.abort();
        return true;
    }

    async run(name, input = {}, options = {}) {
        const workflow = this.registry.workflows.get(name);
        if (!workflow) return { ok: false, error: `Unknown workflow: ${name}` };
        if (workflow.steps.length > this.maxSteps) return { ok: false, error: "Workflow step limit exceeded." };
        const trigger = options.trigger || null;
        if (trigger && workflow.triggers && !this._matchesTrigger(workflow.triggers, trigger)) {
            return { ok: false, error: "Workflow trigger does not match." };
        }
        const context = { input: cloneSafe(input), trigger: cloneSafe(trigger), data: {}, steps: [] };
        const runId = options.runId || crypto.randomUUID();
        const record = { id: runId, workflow: name, status: "running", startedAt: Date.now(), completedAt: null, steps: [], result: null, error: null };
        this.history.push(record);
        while (this.history.length > this.maxHistory) this.history.shift();
        const controller = new AbortController();
        this.active.set(runId, { controller });
        try {
            if (!(await this._conditionsPass(workflow.conditions, context))) {
                record.status = "skipped";
                record.completedAt = Date.now();
                return { ok: true, run: cloneSafe(record), skipped: true };
            }
            for (const step of workflow.steps) {
                if (controller.signal.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "CANCELLED" });
                const approvalResult = this._approval(step, input);
                if (approvalResult) {
                    record.status = "awaiting_approval";
                    record.error = approvalResult.error;
                    record.approval = approvalResult.approval;
                    return { ok: false, approvalRequired: true, run: cloneSafe(record), ...approvalResult };
                }
                const stepRecord = { id: step.id, status: "running", attempts: 0 };
                record.steps.push(stepRecord);
                let value;
                for (let attempt = 1; attempt <= Math.min(step.retries || 0, this.maxRetries) + 1; attempt++) {
                    stepRecord.attempts = attempt;
                    try {
                        value = await withTimeout(step.run(cloneSafe({ ...context, signal: controller.signal })), Math.min(step.timeoutMs || 0, this.maxTimeoutMs) || 0, controller.signal);
                        stepRecord.status = "completed";
                        stepRecord.result = cloneSafe(value);
                        context.data[step.id] = cloneSafe(value);
                        context.steps.push({ id: step.id, result: cloneSafe(value) });
                        break;
                    } catch (error) {
                        stepRecord.error = error.message;
                        if (attempt > (step.retries || 0) || error.code === "CANCELLED") throw error;
                    }
                }
            }
            record.status = "completed";
            record.result = cloneSafe(context.data);
            return { ok: true, run: cloneSafe(record), result: cloneSafe(context.data) };
        } catch (error) {
            record.status = error.code === "CANCELLED" ? "cancelled" : "failed";
            record.error = error.message;
            return { ok: false, error: error.message, run: cloneSafe(record) };
        } finally {
            record.completedAt = Date.now();
            this.active.delete(runId);
        }
    }

    _approval(step, input) {
        if (!step.approval) return null;
        const config = typeof step.approval === "string" ? { tool: step.approval } : step.approval;
        const approvalInput = cloneSafe(config.input || input);
        const token = input.approvalToken || config.token;
        if (!token) {
            return { error: "Approval is required before this step.", approval: this.approvalService.requestApproval({ tool: config.tool || step.id, summary: config.summary || step.id, input: approvalInput }) };
        }
        const consumed = this.approvalService.consumeApproval(token, config.tool || step.id, approvalInput);
        return consumed.ok ? null : consumed;
    }

    async _conditionsPass(conditions, context) {
        if (!conditions) return true;
        const list = Array.isArray(conditions) ? conditions : [conditions];
        for (const condition of list) if (!(await (typeof condition === "function" ? condition(cloneSafe(context)) : condition))) return false;
        return true;
    }

    _matchesTrigger(triggers, trigger) {
        const list = Array.isArray(triggers) ? triggers : [triggers];
        return list.some(item => typeof item === "string" ? item === trigger : item && item.type === trigger.type);
    }
}

module.exports = { WorkflowRegistry, WorkflowEngine, validateWorkflow, cloneSafe };
