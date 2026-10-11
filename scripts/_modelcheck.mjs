// Check /api/models configured status per provider.
const url = process.env.NEXUS_URL || "http://127.0.0.1:3000/";
const res = await fetch(new URL("/api/models", url));
const data = await res.json();
const models = data.models || data;
console.log("total models:", models.length);
const un = models.filter(m => !m.configured);
console.log("unconfigured:", un.length);
const by = {};
un.forEach(m => { by[m.provider] = (by[m.provider] || 0) + 1; });
console.log(by);
const cfg = {};
models.filter(m => m.configured).forEach(m => { cfg[m.provider] = (cfg[m.provider] || 0) + 1; });
console.log("configured:", cfg);
