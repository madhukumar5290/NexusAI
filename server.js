/*
Entry point shim — the real server lives in src/server.js.
Run: node server.js
*/
const { startServer } =
    require("./src/server.js");

startServer();
