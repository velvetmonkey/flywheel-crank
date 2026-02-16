/**
 * sql.js-fts5 adapter — drop-in replacement for better-sqlite3
 *
 * esbuild aliases 'better-sqlite3' → this file so existing vault-core
 * code that does `import Database from 'better-sqlite3'` gets this instead.
 *
 * sql.js is synchronous once initialized (all SQLite ops are WASM calls),
 * but loading the WASM binary is async. Call `Database.initialize()` once
 * at plugin startup before constructing any Database instances.
 */

import initSqlJs from 'sql.js-fts5';
import type {
  SqlJsStatic,
  SqlJsDatabase,
  SqlJsStatement as RawStatement,
} from 'sql.js-fts5';

// The sql.js module singleton, set by initialize()
let SQL: SqlJsStatic | null = null;

// ---------------------------------------------------------------------------
// Statement wrapper
// ---------------------------------------------------------------------------

class Statement {
  private db: SqlJsDatabase;
  private sql: string;
  private _stmt: RawStatement | null = null;

  constructor(db: SqlJsDatabase, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  /** Lazily prepare the underlying sql.js statement */
  private stmt(): RawStatement {
    if (!this._stmt) {
      this._stmt = this.db.prepare(this.sql);
    }
    return this._stmt;
  }

  /**
   * Execute and return the first row, or undefined if none.
   * better-sqlite3 signature: `.get(...params)`
   */
  get(...params: unknown[]): Record<string, unknown> | undefined {
    const flat = flattenParams(params);
    const s = this.stmt();
    s.bind(flat.length ? flat : undefined);
    if (!s.step()) {
      s.reset();
      return undefined;
    }
    const row = s.getAsObject() as Record<string, unknown>;
    s.reset();
    return row;
  }

  /**
   * Execute and return all rows.
   * better-sqlite3 signature: `.all(...params)`
   */
  all(...params: unknown[]): Record<string, unknown>[] {
    const flat = flattenParams(params);
    const s = this.stmt();
    s.bind(flat.length ? flat : undefined);
    const rows: Record<string, unknown>[] = [];
    while (s.step()) {
      rows.push(s.getAsObject() as Record<string, unknown>);
    }
    s.reset();
    return rows;
  }

  /**
   * Execute for side-effects (INSERT/UPDATE/DELETE).
   * Returns `{ changes, lastInsertRowid }`.
   * better-sqlite3 signature: `.run(...params)`
   */
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const flat = flattenParams(params);
    const s = this.stmt();
    s.bind(flat.length ? flat : undefined);
    s.step();
    s.reset();
    return {
      changes: this.db.getRowsModified(),
      lastInsertRowid: getLastInsertRowid(this.db),
    };
  }

  /** Free the underlying compiled statement */
  free(): void {
    if (this._stmt) {
      this._stmt.free();
      this._stmt = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Database wrapper
// ---------------------------------------------------------------------------

class Database {
  private _db: SqlJsDatabase;
  private _name: string;
  private _statements: Statement[] = [];

  /**
   * Construct a new in-memory database, or open from a buffer.
   *
   * @param filenameOrBuffer - ignored string path (for compat) or
   *   Uint8Array / Buffer with an existing database image
   */
  constructor(filenameOrBuffer?: string | Buffer | Uint8Array) {
    if (!SQL) {
      throw new Error(
        'sql.js not initialized. Call Database.initialize() before constructing a Database.',
      );
    }
    if (filenameOrBuffer && typeof filenameOrBuffer !== 'string') {
      this._db = new SQL.Database(new Uint8Array(filenameOrBuffer));
      this._name = ':buffer:';
    } else {
      this._db = new SQL.Database();
      this._name = typeof filenameOrBuffer === 'string' ? filenameOrBuffer : ':memory:';
    }
  }

  /** Database name / path (for error messages) */
  get name(): string {
    return this._name;
  }

  /** Access the raw sql.js database (for export, etc.) */
  get raw(): SqlJsDatabase {
    return this._db;
  }

  /**
   * Prepare a reusable statement.
   * Returns a Statement that exposes `.get()`, `.all()`, `.run()`.
   */
  prepare(sql: string): Statement {
    const s = new Statement(this._db, sql);
    this._statements.push(s);
    return s;
  }

  /**
   * Execute raw SQL (multiple statements OK, no result needed).
   */
  exec(sql: string): void {
    this._db.exec(sql);
  }

  /**
   * Handle `db.pragma(...)` calls.
   * sql.js doesn't support WAL or many pragmas — most are no-ops.
   */
  pragma(pragmaStr: string): unknown {
    const lower = pragmaStr.toLowerCase().replace(/\s+/g, ' ').trim();

    // WAL mode is meaningless for in-memory WASM db
    if (lower.startsWith('journal_mode')) return 'memory';
    // foreign_keys — execute it, sql.js supports this
    if (lower.startsWith('foreign_keys')) {
      this._db.run(`PRAGMA ${pragmaStr}`);
      return;
    }

    // Generic read pragma (e.g., pragma('user_version'))
    try {
      const results = this._db.exec(`PRAGMA ${pragmaStr}`);
      if (results.length && results[0].values.length) {
        return results[0].values[0][0];
      }
    } catch {
      // Silently ignore unsupported pragmas
    }
    return undefined;
  }

  /**
   * Wrap a function in BEGIN/COMMIT (ROLLBACK on error).
   * Returns a callable that mirrors better-sqlite3's `db.transaction(fn)`.
   */
  transaction<F extends (...args: unknown[]) => unknown>(fn: F): F {
    const db = this._db;
    const wrapper = (...args: unknown[]) => {
      db.run('BEGIN');
      try {
        const result = fn(...args);
        db.run('COMMIT');
        return result;
      } catch (err) {
        db.run('ROLLBACK');
        throw err;
      }
    };
    return wrapper as unknown as F;
  }

  /** Export the database as a Uint8Array (for persistence). */
  export(): Uint8Array {
    return this._db.export();
  }

  /** Close the database and free all prepared statements. */
  close(): void {
    for (const s of this._statements) {
      s.free();
    }
    this._statements = [];
    this._db.close();
  }

  // -----------------------------------------------------------------------
  // Static initialization
  // -----------------------------------------------------------------------

  /**
   * Initialize the WASM engine. Must be called once before any Database
   * construction.
   *
   * @param wasmBinary - The raw bytes of sql-wasm.wasm (read via
   *   Obsidian's `app.vault.adapter.readBinary` or bundled inline).
   */
  static async initialize(wasmBinary?: ArrayBuffer): Promise<void> {
    if (SQL) return; // already initialized
    SQL = await initSqlJs(wasmBinary ? { wasmBinary } : undefined);
  }

  /** Returns true once the WASM engine has been loaded. */
  static get isInitialized(): boolean {
    return SQL !== null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * better-sqlite3 passes params as variadic args: `stmt.run(a, b, c)`.
 * sql.js wants a flat array: `stmt.bind([a, b, c])`.
 * Also handle the case where a single array is passed.
 */
function flattenParams(params: unknown[]): unknown[] {
  if (params.length === 0) return [];
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

/**
 * sql.js doesn't expose last_insert_rowid directly on the Database object.
 * We fetch it via a quick exec.
 */
function getLastInsertRowid(db: SqlJsDatabase): number {
  const result = db.exec('SELECT last_insert_rowid() as id');
  if (result.length && result[0].values.length) {
    return result[0].values[0][0] as number;
  }
  return 0;
}

// Default export matches `import Database from 'better-sqlite3'`
export default Database;
export { Database, Statement };
