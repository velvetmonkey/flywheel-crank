/**
 * Database persistence — load/save the SQLite binary to the vault.
 *
 * The in-memory sql.js database is exported as a Uint8Array and written
 * to `.flywheel/state.db` inside the Obsidian vault using the vault
 * adapter (no Node fs required).
 */

import { App, normalizePath } from 'obsidian';

const DB_DIR = '.flywheel';
const DB_PATH = normalizePath(`${DB_DIR}/state.db`);
const SAVE_DEBOUNCE_MS = 5_000;

export class DatabasePersistence {
  private app: App;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Load existing database binary from `.flywheel/state.db`.
   * Returns null if the file doesn't exist yet (first run).
   */
  async load(): Promise<ArrayBuffer | null> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(DB_PATH))) {
      return null;
    }
    return adapter.readBinary(DB_PATH);
  }

  /**
   * Save the database binary to `.flywheel/state.db`.
   * Creates the `.flywheel/` directory if needed.
   */
  async save(data: Uint8Array): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(DB_DIR))) {
      await adapter.mkdir(DB_DIR);
    }
    await adapter.writeBinary(DB_PATH, data.buffer as ArrayBuffer);
    this.dirty = false;
  }

  /**
   * Mark as dirty and schedule a debounced save.
   * The getter is called at save-time so it captures the latest state.
   */
  scheduleSave(getDbData: () => Uint8Array): void {
    this.dirty = true;
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save(getDbData()).catch((err) => {
        console.error('[flywheel-crank] Failed to persist database:', err);
      });
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Force an immediate save (call during plugin unload).
   */
  async forceSave(getDbData: () => Uint8Array): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      await this.save(getDbData());
    }
  }

  /** Clean up the debounce timer. */
  destroy(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }
}
