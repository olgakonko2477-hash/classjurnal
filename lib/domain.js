import { randomUUID } from 'node:crypto';

export const collections = ['years', 'classes', 'students', 'subjects', 'journals', 'templates', 'participations', 'lessons', 'attendance', 'grades'];
export const emptyState = () => Object.fromEntries(collections.map(k => [k, []]));
export const uid = () => randomUUID();
export function check(value, message) { if (!value) throw Object.assign(new Error(message), { status: 400 }); }
export function str(value, label, max = 200, optional = false) {
  check(typeof value === 'string' && value.length <= max && (optional || value.trim()), `Проверьте поле «${label}» (до ${max} символов).`);
  return value.trim();
}
export function date(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'Некорректная дата.');
  return value;
}
export function time(value) { check(typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value), 'Некорректное время.'); return value; }
export const plusDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export function today(zone = 'Europe/Moscow') { return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function localStamp(zone = 'Europe/Moscow') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export const get = (s, key, id) => { const item = s[key].find(x => x.id === id); check(item, 'Запись не найдена. Обновите страницу.'); return item; };
export function eligible(s, student, lesson) {
  const journal = get(s, 'journals', lesson.journalId);
  if (student.classId !== journal.classId || lesson.date < student.start || (student.end && lesson.date >= student.end)) return false;
  const member = lesson.seriesId && s.participations.find(x => x.templateId === lesson.seriesId && x.studentId === student.id);
  return !member || ((!member.start || lesson.date >= member.start) && (!member.end || lesson.date < member.end));
}
export const hasRecords = (s, lesson) => !!(lesson.topic || lesson.homework || s.grades.some(g => g.lessonId === lesson.id) || s.attendance.some(a => a.lessonId === lesson.id));
export const isFuture = (l, now) => `${l.date}T${l.start}` > now;
export function deletionPreview(s, templateId, now = localStamp()) {
  const related = s.lessons.filter(l => l.templateId === templateId);
  return { removed: related.filter(l => isFuture(l, now) && !hasRecords(s, l)).length, kept: related.filter(l => !isFuture(l, now) || hasRecords(s, l)).length };
}
export function generate(template) {
  const result = [];
  for (let d = template.start; d <= template.end; d = plusDays(d, 1)) {
    const day = new Date(d + 'T12:00:00Z').getUTCDay();
    for (const slot of template.slots.filter(x => x.day === day)) result.push({ id: `${template.id}:${d}:${slot.start}`, journalId: template.journalId, templateId: template.id, seriesId: template.id, date: d, start: slot.start, end: slot.end, topic: '', homework: '' });
  }
  return result;
}
function lessonRange(s, journalId, start, end) {
  const j = get(s, 'journals', journalId); const c = get(s, 'classes', j.classId); const y = get(s, 'years', c.yearId);
  date(start); date(end); check(start <= end && start >= y.start && end <= y.end, 'Даты должны находиться в пределах учебного года.');
  return y;
}
function conflicts(s, lessons, except) {
  for (const l of lessons) check(!s.lessons.some(x => x.id !== except && x.date === l.date && x.start < l.end && l.start < x.end), `На ${l.date} в ${l.start} уже есть урок. Выберите другое время.`);
}
export function apply(s, type, p, now = localStamp()) {
  const currentDate = now.slice(0, 10);
  switch (type) {
    case 'year': {
      const name = str(p.name, 'Учебный год'); const start = date(p.start), end = date(p.end);
      check(start < end && Date.parse(end) - Date.parse(start) <= 400 * 86400000, 'Учебный год должен длиться не более 400 дней.');
      check(Array.isArray(p.quarters) && p.quarters.length === 4, 'Укажите четыре четверти.');
      let previous = '';
      const quarters = p.quarters.map((q, i) => { date(q.start); date(q.end); check(q.start <= q.end && q.start >= start && q.end <= end && q.start > previous, 'Четверти должны идти по порядку, не пересекаться и находиться в учебном году.'); previous = q.end; return { number: i + 1, start: q.start, end: q.end }; });
      if (p.id) { const y = get(s, 'years', p.id); check(!s.lessons.some(l => { const j = get(s, 'journals', l.journalId); return get(s, 'classes', j.classId).yearId === y.id && (l.date < start || l.date > end); }), 'Новые границы исключают существующие уроки.'); Object.assign(y, { name, start, end, quarters }); }
      else s.years.push({ id: uid(), name, start, end, quarters });
      break;
    }
    case 'class': {
      get(s, 'years', p.yearId); const name = str(p.name, 'Класс', 40);
      check(!s.classes.some(c => c.yearId === p.yearId && c.name === name && c.id !== p.id), 'Такой класс уже есть.');
      if (p.id) { const c = get(s, 'classes', p.id); check(c.yearId === p.yearId, 'Нельзя менять учебный год класса.'); c.name = name; }
      else s.classes.push({ id: uid(), name, yearId: p.yearId });
      break;
    }
    case 'subject': {
      get(s, 'classes', p.classId); const name = str(p.name, 'Предмет', 80);
      let subject = s.subjects.find(x => x.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'));
      if (!subject) { subject = { id: uid(), name }; s.subjects.push(subject); }
      check(!s.journals.some(j => j.classId === p.classId && j.subjectId === subject.id), 'Предмет уже добавлен в этот класс.');
      s.journals.push({ id: uid(), classId: p.classId, subjectId: subject.id }); break;
    }
    case 'students': {
      const c = get(s, 'classes', p.classId); const y = get(s, 'years', c.yearId);
      const start = date(p.start); check(start >= y.start && start <= y.end, 'Дата зачисления должна быть в учебном году.');
      check(Array.isArray(p.names) && p.names.length > 0 && p.names.length <= 100, 'Введите от 1 до 100 учеников.');
      for (const n of p.names) s.students.push({ id: uid(), classId: c.id, name: str(n, 'Ф. И. О.', 150), start, end: null });
      break;
    }
    case 'student': { get(s, 'students', p.id).name = str(p.name, 'Ф. И. О.', 150); break; }
    case 'archive': {
      const student = get(s, 'students', p.id); const end = date(p.end); check(end >= currentDate && end >= student.start, 'Архивирование возможно с сегодняшней или будущей даты.'); student.end = end; break;
    }
    case 'lesson': {
      lessonRange(s, p.journalId, p.date, p.date); time(p.start); time(p.end); check(p.start < p.end, 'Окончание должно быть позже начала.');
      const values = { journalId: p.journalId, date: p.date, start: p.start, end: p.end, topic: str(p.topic ?? '', 'Тема', 2000, true), homework: str(p.homework ?? '', 'Домашнее задание', 4000, true) };
      const old = p.id ? get(s, 'lessons', p.id) : null;
      if (old) check(old.journalId === p.journalId && old.date === p.date && old.start === p.start && old.end === p.end, 'В существующем уроке можно изменить тему и домашнее задание.');
      else conflicts(s, [values]);
      if (old) Object.assign(old, values); else s.lessons.push({ id: uid(), ...values, templateId: null, seriesId: null }); break;
    }
    case 'template': {
      lessonRange(s, p.journalId, p.start, p.end); check(Array.isArray(p.slots) && p.slots.length > 0 && p.slots.length <= 7, 'Выберите дни недели.');
      const days = new Set();
      const slots = p.slots.map(x => { check(Number.isInteger(x.day) && x.day >= 0 && x.day <= 6 && !days.has(x.day), 'Укажите разные дни недели.'); days.add(x.day); time(x.start); time(x.end); check(x.start < x.end, 'Окончание должно быть позже начала.'); return { day: x.day, start: x.start, end: x.end }; });
      const t = { id: uid(), name: str(p.name, 'Название'), journalId: p.journalId, start: p.start, end: p.end, slots, active: true };
      const lessons = generate(t); check(lessons.length, 'В выбранном периоде нет уроков для этих дней.'); conflicts(s, lessons);
      s.templates.push(t); s.lessons.push(...lessons); break;
    }
    case 'exclude': {
      const t = get(s, 'templates', p.templateId); check(t.active, 'Шаблон уже удалён.'); const student = get(s, 'students', p.studentId);
      check(student.classId === get(s, 'journals', t.journalId).classId, 'Ученик из другого класса.');
      const end = date(p.end); check(end >= currentDate, 'Можно исключить ученика с сегодняшней или будущей даты.');
      let member = s.participations.find(x => x.templateId === t.id && x.studentId === student.id);
      if (!member) { member = { id: uid(), templateId: t.id, studentId: student.id, start: student.start }; s.participations.push(member); }
      member.end = end; break;
    }
    case 'deleteTemplate': {
      const t = get(s, 'templates', p.id); t.active = false;
      s.lessons = s.lessons.filter(l => l.templateId !== t.id || !isFuture(l, now) || hasRecords(s, l));
      for (const l of s.lessons.filter(l => l.templateId === t.id)) l.templateId = null;
      break;
    }
    case 'record': {
      const lesson = get(s, 'lessons', p.lessonId), student = get(s, 'students', p.studentId);
      check(eligible(s, student, lesson), 'Ученик не участвует в этом уроке.');
      check(['', 'present', 'absent', 'ill', 'excused'].includes(p.status), 'Неизвестный статус посещаемости.');
      check(Array.isArray(p.grades) && p.grades.length <= 8 && p.grades.every(g => [2, 3, 4, 5].includes(g)), 'Оценки: от 2 до 5, не более восьми за урок.');
      s.attendance = s.attendance.filter(x => !(x.lessonId === lesson.id && x.studentId === student.id));
      if (p.status) s.attendance.push({ id: `${lesson.id}:${student.id}`, lessonId: lesson.id, studentId: student.id, status: p.status });
      s.grades = s.grades.filter(x => !(x.lessonId === lesson.id && x.studentId === student.id));
      p.grades.forEach((value, order) => s.grades.push({ id: uid(), lessonId: lesson.id, studentId: student.id, value, order })); break;
    }
    case 'present': {
      const l = get(s, 'lessons', p.id);
      for (const st of s.students.filter(st => eligible(s, st, l))) if (!s.attendance.some(a => a.lessonId === l.id && a.studentId === st.id)) s.attendance.push({ id: `${l.id}:${st.id}`, lessonId: l.id, studentId: st.id, status: 'present' });
      break;
    }
    default: check(false, 'Неизвестное действие.');
  }
  return s;
}

export function selection(s, { journalId, start, end }) {
  const journal = get(s, 'journals', journalId); date(start); date(end); check(start <= end, 'Некорректный период.');
  const students = s.students.filter(x => x.classId === journal.classId && x.start <= end && (!x.end || x.end > start)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const lessons = s.lessons.filter(x => x.journalId === journalId && x.date >= start && x.date <= end).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { journal, students, lessons };
}
export const symbols = { present: 'П', absent: 'Н', ill: 'Б', excused: 'У' };
export function cellText(s, student, lesson) {
  const grades = s.grades.filter(g => g.lessonId === lesson.id && g.studentId === student.id).sort((a, b) => a.order - b.order).map(g => g.value);
  const status = s.attendance.find(a => a.lessonId === lesson.id && a.studentId === student.id)?.status;
  const text = [...grades, symbols[status]].filter(Boolean).join(' ');
  return text || (eligible(s, student, lesson) ? '' : 'Не участвует');
}
