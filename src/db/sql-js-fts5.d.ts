/**
 * Type declarations for sql.js-fts5
 *
 * sql.js-fts5 is sql.js compiled with FTS5 support.
 * The API is identical to sql.js.
 */
declare module 'sql.js-fts5' {
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
  }

  export interface SqlJsDatabase {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): SqlJsStatement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  export interface SqlJsStatement {
    bind(params?: unknown[] | undefined): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    reset(): void;
    free(): void;
  }

  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export interface InitSqlJsOptions {
    wasmBinary?: ArrayBuffer;
    locateFile?: (filename: string) => string;
  }

  function initSqlJs(options?: InitSqlJsOptions): Promise<SqlJsStatic>;

  export default initSqlJs;
  export type { SqlJsStatement };
}
