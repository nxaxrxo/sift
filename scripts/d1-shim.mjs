/**
 * d1-shim.mjs — a D1-shaped database backed by node:sqlite.
 *
 * The production code only ever calls `prepare().bind().first()/all()/run()` and
 * `batch()`, so this file implements exactly that surface. It exists so the real
 * ingest and the real query builders can be exercised on this machine, against
 * real feeds, without deploying anything.
 *
 * Test-only. Never imported by `functions/`.
 */

import { DatabaseSync } from "node:sqlite";

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }

  async first() {
    const row = this.db.prepare(this.sql).get(...this.params);
    return row === undefined ? null : row;
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.params);
    return { results, success: true, meta: { changes: 0 } };
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(info.changes ?? 0) } };
  }

  runSync() {
    return this.db.prepare(this.sql).run(...this.params);
  }
}

export class D1Shim {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }

  /** D1's batch() is sequential and returns one result per statement. */
  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }

  async exec(sql) {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }

  close() {
    this.db.close();
  }
}
