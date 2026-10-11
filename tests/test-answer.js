const fs = require("fs");
let s = fs.readFileSync("./src/server.js", "utf8");
s += "\nmodule.exports = { generateAnswer };";

const Module = require("module");
const path = require("path");

const m = new Module("./src/server.js");
m.filename = path.resolve("./src/server.js");
m.paths = module.paths;
m._compile(s, m.filename);

const context = `SOURCE 1
Document: instructional-design-101-commlab.pdf
Chunk: 1

This is sample document content for testing.`;

const memory = "The user is building a project called Nexus AI.";
const conversation = "User: Hello";

console.time("FINAL");

m.exports.generateAnswer(
    "Hello",
    context,
    memory,
    conversation,
    ""
).then(answer => {
    console.timeEnd("FINAL");
    console.log(answer);
}).catch(error => {
    console.error(error);
});
