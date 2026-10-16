import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function normalizeBindValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value) && !Buffer.isBuffer(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

function numeric(value) {
  if (typeof value === 'bigint') return Number(value);
  return Number(value || 0);
}

function resultMeta(changes = 0, lastInsertRowid = 0, duration = 0) {
  return {
    changes: numeric(changes),
    last_row_id: numeric(lastInsertRowid),
    duration: Math.max(0, Number(duration) || 0)
  };
}

export class D1PreparedStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = String(sql);
    this.values = values;
  }

  bind(...values) {
    const flattened = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
    return new D1PreparedStatement(
      this.database,
      this.sql,
      flattened.map(normalizeBindValue)
    );
  }

  _prepare() {
    return this.database.handle.prepare(this.sql);
  }

  async first(columnName) {
    const row = this._prepare().get(...this.values) || null;
    if (row && typeof columnName === 'string') return row[columnName] ?? null;
    return row;
  }

  async all() {
    const startedAt = performance.now();
    const statement = this._prepare();
    const results = statement.all(...this.values);
    return {
      success: true,
      results,
      meta: resultMeta(0, 0, performance.now() - startedAt)
    };
  }

  async run() {
    const startedAt = performance.now();
    const result = this._prepare().run(...this.values);
    return {
      success: true,
      results: [],
      meta: resultMeta(result.changes, result.lastInsertRowid, performance.now() - startedAt)
    };
  }

  _batchResult() {
    const startedAt = performance.now();
    const statement = this._prepare();
    if (statement.columns().length > 0) {
      return {
        success: true,
        results: statement.all(...this.values),
        meta: resultMeta(0, 0, performance.now() - startedAt)
      };
    }
    const result = statement.run(...this.values);
    return {
      success: true,
      results: [],
      meta: resultMeta(result.changes, result.lastInsertRowid, performance.now() - startedAt)
    };
  }
}

/**
 * Small D1 surface used by backend/worker.js. It intentionally stays within
 * SQLite semantics and does not attempt to emulate Cloudflare operational APIs.
 */
export class D1Database {
  constructor(databasePath) {
    if (!databasePath) throw new Error('GOMOKU_DB_PATH is required');
    this.path = databasePath === ':memory:' ? databasePath : path.resolve(databasePath);
    if (this.path !== ':memory:') fs.mkdirSync(path.dirname(this.path), { recursive: true });
    this.handle = new DatabaseSync(this.path);
    this.handle.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (this.path !== ':memory:') this.handle.exec('PRAGMA journal_mode = WAL;');
  }

  prepare(sql) {
    return new D1PreparedStatement(this, sql);
  }

  async batch(statements) {
    if (!Array.isArray(statements)) throw new TypeError('D1Database.batch expects an array');
    const savepoint = `gomoku_d1_batch_${++this.batchSequence}`;
    this.handle.exec(`SAVEPOINT ${savepoint}`);
    try {
      const results = statements.map(statement => {
        if (!(statement instanceof D1PreparedStatement) || statement.database !== this) {
          throw new TypeError('D1Database.batch received a statement from another database');
        }
        return statement._batchResult();
      });
      this.handle.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return results;
    } catch (error) {
      try {
        this.handle.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.handle.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (_) {}
      throw error;
    }
  }

  async exec(sql) {
    const before = this.handle.prepare('SELECT total_changes() AS changes').get().changes;
    const startedAt = performance.now();
    this.handle.exec(String(sql));
    const after = this.handle.prepare('SELECT total_changes() AS changes').get().changes;
    return {
      count: numeric(after) - numeric(before),
      duration: Math.max(0, performance.now() - startedAt)
    };
  }

  close() {
    this.handle.close();
  }

  batchSequence = 0;
}
