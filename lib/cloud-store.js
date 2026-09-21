import { collections, emptyState, apply, check, localStamp } from './domain.js';
import { validateBackup } from './backup-validation.js';

const conflict = () => Object.assign(new Error('Журнал изменён на другом устройстве. Обновите данные и повторите сохранение — введённые значения оставлены в форме.'), { status: 409 });
// D1 batches are atomic. A write token guards every statement in a mutation,
// so a stale request cannot change any rows after losing the revision check.
export class CloudStore {
  constructor(db) { this.db = db; }
  async init() {
    await this.db.batch([
      this.db.prepare('CREATE TABLE IF NOT EXISTS journal_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, timezone TEXT NOT NULL, write_token TEXT)'),
      this.db.prepare("INSERT OR IGNORE INTO journal_meta (id,revision,timezone) VALUES (1,0,'Europe/Moscow')"),
      ...collections.map(name => this.db.prepare(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)))`)),
      this.db.prepare('CREATE TABLE IF NOT EXISTS restore_snapshots (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)))')
    ]);
  }
  async state() {
    const rows = await this.db.batch([
      this.db.prepare('SELECT revision,timezone FROM journal_meta WHERE id=1'),
      ...collections.map(name => this.db.prepare(`SELECT payload FROM ${name} ORDER BY rowid`))
    ]);
    const state = emptyState();
    collections.forEach((name, i) => { state[name] = rows[i + 1].results.map(r => JSON.parse(r.payload)); });
    return { ...state, ...rows[0].results[0] };
  }
  async save(state, revision, previousBackup) {
    check(Number.isInteger(revision) && revision >= 0, 'Некорректная версия журнала.');
    const token = crypto.randomUUID();
    const guard = 'EXISTS (SELECT 1 FROM journal_meta WHERE id=1 AND write_token=?)';
    const statements = [this.db.prepare('UPDATE journal_meta SET revision=revision+1, timezone=?, write_token=? WHERE id=1 AND revision=?').bind(state.timezone || 'Europe/Moscow', token, revision)];
    if (previousBackup) {
      const backup = JSON.stringify(previousBackup);
      check(new TextEncoder().encode(backup).length < 1900000, 'Копия слишком велика для восстановления через сайт.');
      statements.push(this.db.prepare(`INSERT INTO restore_snapshots SELECT ?,?,? WHERE ${guard}`).bind(crypto.randomUUID(), new Date().toISOString(), backup, token));
      statements.push(this.db.prepare(`DELETE FROM restore_snapshots WHERE id NOT IN (SELECT id FROM restore_snapshots ORDER BY created_at DESC LIMIT 10) AND ${guard}`).bind(token));
    }
    for (const name of collections) {
      const serialized = JSON.stringify(state[name]);
      check(new TextEncoder().encode(serialized).length < 1900000, 'Раздел журнала слишком большой. Сохраните резервную копию и обратитесь к администратору.');
      statements.push(this.db.prepare(`DELETE FROM ${name} WHERE ${guard}`).bind(token));
      statements.push(this.db.prepare(`INSERT INTO ${name} (id,payload) SELECT json_extract(value,'$.id'),value FROM json_each(?) WHERE ${guard}`).bind(serialized, token));
    }
    const results = await this.db.batch(statements);
    if (results[0].meta.changes !== 1) throw conflict();
    // Return exactly the state committed by this request, even if another writer
    // commits immediately afterward. The next read will obtain that newer state.
    return { ...state, revision: revision + 1 };
  }
  async mutate(type, payload, revision) {
    const state = await this.state();
    if (state.revision !== revision) throw conflict();
    apply(state, type, payload, localStamp(state.timezone));
    return this.save(state, revision);
  }
  async backup() { return { format: 'teacher-journal', version: 1, createdAt: new Date().toISOString(), state: await this.state() }; }
  async restore(backup, revision) {
    validateBackup(backup);
    const previous = await this.backup();
    if (previous.state.revision !== revision) throw conflict();
    return this.save(backup.state, revision, previous);
  }
  async snapshots() { return (await this.db.prepare('SELECT id,created_at FROM restore_snapshots ORDER BY created_at DESC').all()).results; }
  async snapshot(id) {
    const row = await this.db.prepare('SELECT payload FROM restore_snapshots WHERE id=?').bind(id).first();
    check(row, 'Копия не найдена.'); return JSON.parse(row.payload);
  }
}
