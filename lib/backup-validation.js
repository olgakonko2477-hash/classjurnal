import { check, collections } from './domain.js';

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
