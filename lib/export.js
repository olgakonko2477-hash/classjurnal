import ExcelJS from 'exceljs';
import { selection, cellText, get } from './domain.js';

export async function workbook(s, query) {
  const { journal, students, lessons } = selection(s, query);
  const title = `${get(s, 'classes', journal.classId).name} · ${get(s, 'subjects', journal.subjectId).name}`;
  const book = new ExcelJS.Workbook(); book.creator = 'Журнал учителя';
  const sheet = book.addWorksheet('Журнал', { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });
  sheet.addRow([title]); sheet.addRow([`${query.start} — ${query.end}`]);
  sheet.addRow(['П — присутствовал; Н — отсутствовал; Б — болел; У — уважительная причина. Пусто — нет записи.']);
  sheet.addRow(['№', 'Ф. И. О.', ...lessons.map(l => `${l.date}\n${l.start}–${l.end}`)]);
  students.forEach((st, i) => sheet.addRow([i + 1, st.name, ...lessons.map(l => cellText(s, st, l))]));
  sheet.getColumn(1).width = 6; sheet.getColumn(2).width = 34;
  lessons.forEach((_, i) => sheet.getColumn(i + 3).width = 17);
  for (let row = 1; row <= 3; row++) sheet.mergeCells(row, 1, row, Math.max(3, lessons.length + 2));
  const content = book.addWorksheet('Уроки', { views: [{ state: 'frozen', ySplit: 1 }] });
  content.columns = [{ header: 'Дата', key: 'date', width: 16 }, { header: 'Время', key: 'time', width: 18 }, { header: 'Тема', key: 'topic', width: 55 }, { header: 'Домашнее задание', key: 'homework', width: 65 }];
  lessons.forEach(l => content.addRow({ date: l.date, time: `${l.start}–${l.end}`, topic: l.topic, homework: l.homework }));
  for (const page of [sheet, content]) {
    page.eachRow(row => row.eachCell(cell => { cell.font = { name: 'Calibri', size: 11 }; cell.alignment = { vertical: 'top', wrapText: true }; cell.border = { bottom: { style: 'hair', color: { argb: 'FFDADDD7' } } }; }));
    const header = page.getRow(page === sheet ? 4 : 1); header.font = { bold: true, color: { argb: 'FFFFFFFF' } }; header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF35654F' } }; header.height = 34;
    page.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: page === sheet ? '1:4' : '1:1' };
  }
  return book.xlsx.writeBuffer();
}
