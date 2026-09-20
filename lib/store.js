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

export function validateBackup(b) {
  check(b?.format === 'teacher-journal' && b.version === 1 && b.state && typeof b.state === 'object', 'Неверный формат резервной копии.');
  const s = b.state;
  for (const key of collections) {
    check(Array.isArray(s[key]) && s[key].length <= 100000, `Повреждён раздел ${key}.`);
    const ids = new Set();
    for (const x of s[key]) { check(x && typeof x === 'object' && typeof x.id === 'string' && x.id.length <= 200 && !ids.has(x.id), `Некорректные записи ${key}.`); ids.add(x.id); }
  }
  const exists = (key, id) => s[key].some(x => x.id === id);
  const iso = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  for (const y of s.years) check(typeof y.name === 'string' && iso(y.start) && iso(y.end) && y.start < y.end && Array.isArray(y.quarters) && y.quarters.length === 4 && y.quarters.every((q,i,a) => iso(q.start) && iso(q.end) && q.start <= q.end && q.start >= y.start && q.end <= y.end && (!i || q.start > a[i-1].end)), 'Некорректный учебный год.');
  for (const c of s.classes) check(typeof c.name === 'string' && exists('years', c.yearId), 'Некорректный класс.');
  for (const st of s.students) check(typeof st.name === 'string' && iso(st.start) && (!st.end || iso(st.end)) && exists('classes', st.classId), 'Некорректный ученик.');
  for (const sub of s.subjects) check(typeof sub.name === 'string', 'Некорректный предмет.');
  for (const j of s.journals) check(exists('classes', j.classId) && exists('subjects', j.subjectId), 'Некорректный журнал.');
  for (const t of s.templates) check(exists('journals', t.journalId) && typeof t.name === 'string' && iso(t.start) && iso(t.end) && t.start <= t.end && typeof t.active === 'boolean' && Array.isArray(t.slots) && t.slots.every(x=>Number.isInteger(x.day) && x.day>=0 && x.day<=6 && /^([01]\d|2[0-3]):[0-5]\d$/.test(x.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(x.end) && x.start<x.end), 'Некорректный шаблон.');
  for (const l of s.lessons) check(exists('journals', l.journalId) && iso(l.date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(l.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(l.end) && l.start < l.end && typeof l.topic === 'string' && typeof l.homework === 'string' && (!l.templateId || exists('templates', l.templateId)) && (!l.seriesId || exists('templates', l.seriesId)), 'Некорректный урок.');
  for (const p of s.participations) check(exists('students', p.studentId) && exists('templates', p.templateId) && (!p.start || iso(p.start)) && (!p.end || iso(p.end)), 'Некорректное участие в расписании.');
  const attendanceKeys = new Set();
  for (const a of s.attendance) { const key = `${a.lessonId}:${a.studentId}`; check(exists('lessons', a.lessonId) && exists('students', a.studentId) && ['present','absent','ill','excused'].includes(a.status) && !attendanceKeys.has(key), 'Некорректная посещаемость.'); attendanceKeys.add(key); }
  for (const g of s.grades) check(exists('lessons', g.lessonId) && exists('students', g.studentId) && [2,3,4,5].includes(g.value) && Number.isInteger(g.order), 'Некорректная оценка.');
  try { new Intl.DateTimeFormat('ru', { timeZone: s.timezone || 'Europe/Moscow' }); } catch { check(false, 'Неизвестный часовой пояс.'); }
}
