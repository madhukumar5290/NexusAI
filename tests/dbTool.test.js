/*
Tests for dbTool — SQLite query/exec against a temp database.
*/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dbTool = require("../src/agent/dbTool");
const permissions = require("../src/agent/permissions");

const DB_PATH = path.join(
    os.tmpdir(),
    "nexus-db-test-" + Date.now() + ".db"
);

test.after(() => {
    try { fs.unlinkSync(DB_PATH); } catch (e) { }
    try { fs.unlinkSync(DB_PATH + "-journal"); } catch (e) { }
});

test("dbTool: rejects path outside the workspace / temp db root", async () => {
    await assert.rejects(
        () => dbTool.query({ db: "C:/Windows/system32/evil.db", sql: "SELECT 1" })
    );
});

test("dbTool: rejects missing sql", async () => {
    await assert.rejects(
        () => dbTool.exec({ db: DB_PATH })
    );
});

test("dbTool: exec creates tables and inserts rows", async () => {
    const result = await dbTool.exec({
        db: DB_PATH,
        sql: `CREATE TABLE IF NOT EXISTS people (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            age INTEGER
        );
        INSERT INTO people (name, age) VALUES ('Ada', 36), ('Grace', 45);`
    });

    assert.equal(result.ok, true);
    assert.equal(result.changes >= 2, true);
});

test("dbTool: query returns rows as json", async () => {
    const result = await dbTool.query({
        db: DB_PATH,
        sql: "SELECT name, age FROM people ORDER BY age DESC"
    });

    assert.equal(result.ok, true);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].name, "Grace");
    assert.equal(result.rows[0].age, 45);
});

test("dbTool: parameterized queries bind values", async () => {
    const result = await dbTool.query({
        db: DB_PATH,
        sql: "SELECT name FROM people WHERE age = ?",
        params: [36]
    });

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].name, "Ada");
});

test("dbTool: bad sql returns ok:false with message, not throw", async () => {
    const result = await dbTool.query({
        db: DB_PATH,
        sql: "SELECT * FROM nope_missing_table"
    });

    assert.equal(result.ok, false);
    assert.equal(typeof result.error, "string");
    assert.equal(result.error.length > 0, true);
});

test("dbTool: write via query() is rejected — reads only", async () => {
    await assert.rejects(
        () => dbTool.query({
            db: DB_PATH,
            sql: "DELETE FROM people"
        })
    );
});

test("dbTool: exec verifies by re-reading after write", async () => {
    await dbTool.exec({
        db: DB_PATH,
        sql: "INSERT INTO people (name, age) VALUES ('Katherine', 41)"
    });

    const result = await dbTool.query({
        db: DB_PATH,
        sql: "SELECT COUNT(*) AS n FROM people"
    });

    assert.equal(result.rows[0].n, 3);
});
