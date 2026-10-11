// Every agent's allowedTools must name a real registered tool.
// This is the check that stops an agent from being selectable but broken.
const registry = require("../lib/agents");
const toolRegistry = require("../src/agent/toolRegistry");
/* Tool registration is explicit, not a side effect of require(). */
require("../src/agent/tools").ensureRegistered();

const realTools = new Set(toolRegistry.list().map(t => t.name || t.id));
const agents = registry.list();

console.log(`Real tools registered: ${realTools.size}`);
console.log(`Agents: ${agents.length}\n`);

let problems = 0;

for (const agent of agents) {
    const missing = (agent.allowedTools || []).filter(t => !realTools.has(t));
    if (missing.length) {
        problems += 1;
        console.log(`MISSING TOOLS  ${agent.id}`);
        missing.forEach(t => console.log(`    - ${t}`));
    }
    if (!agent.name || !agent.description) {
        problems += 1;
        console.log(`INCOMPLETE     ${agent.id} (missing name or description)`);
    }
}

console.log(problems === 0
    ? "\nOK: every agent references only real tools."
    : `\n${problems} agent(s) have problems.`);

process.exit(problems === 0 ? 0 : 1);