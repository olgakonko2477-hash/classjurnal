import { validateBackup } from './backup-validation.js';
export { validateBackup } from './backup-validation.js';
import { DatabaseSync } from 'node:sqlite';
import { collections, emptyState, apply, check } from './domain.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'journal.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    for (const name of collections) this.db.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)))`);
    this.db.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('revision', '0');
    this.db.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('timezone', 'Europe/Moscow');
  }
  meta(key) { return this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value; }
  setMeta(key, value) { this.db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run(key, String(value)); }
  state() {
    const state = emptyState();
    for (const name of collections) state[name] = this.db.prepare(`SELECT payload FROM ${name}`).all().map(r => JSON.parse(r.payload));
    return { ...state, revision: Number(this.meta('revision')), timezone: this.meta('timezone') };
  }
  save(state) {
    for (const name of collections) {
      this.db.exec(`DELETE FROM ${name}`);
      const insert = this.db.prepare(`INSERT INTO ${name} VALUES (?, ?)`);
      for (const item of state[name]) insert.run(item.id, JSON.stringify(item));
    }
    this.setMeta('revision', Number(this.meta('revision')) + 1);
  }
  mutate(type, payload, revision) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (revision !== Number(this.meta('revision'))) throw Object.assign(new Error('Журнал изменён на другом устройстве. Обновите данные и повторите сохранение — введённые значения оставлены в форме.'), { status: 409 });
      const state = apply(this.state(), type, payload);
      this.save(state); this.db.exec('COMMIT'); return this.state();
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  backup() { return { format: 'teacher-journal', version: 1, createdAt: new Date().toISOString(), state: this.state() }; }
  restore(backup, revision) {
    validateBackup(backup);
    check(revision === Number(this.meta('revision')), 'Журнал изменился. Обновите страницу перед восстановлением.');
    writeFileSync(join(this.directory, `before-restore-${Date.now()}.json`), JSON.stringify(this.backup(), null, 2), { mode: 0o600 });
    this.db.exec('BEGIN IMMEDIATE');
    try { this.save(backup.state); this.setMeta('timezone', backup.state.timezone || 'Europe/Moscow'); this.db.exec('COMMIT'); return this.state(); }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close() { this.db.close(); }
}
