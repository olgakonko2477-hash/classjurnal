const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  book: '<path d="M4 3h15v18H4zM8 3v18M11 8h5M11 12h5"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12M15 9v12M3 15h18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M7 15h2M15 15h2"/>',
  users: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  logout: '<path d="M10 3H4v18h6M10 12h11m-4-4 4 4-4 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.book}</svg>`;
const months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const weekdays = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const statuses = { '': 'Не отмечено', present: 'Присутствовал', absent: 'Отсутствовал', ill: 'Болел', excused: 'Уважительная причина' };
const symbols = { present: 'П', absent: 'Н', ill: 'Б', excused: 'У' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: S?.timezone || 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (d,n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0,10);
const fmt = d => d ? d.split('-').reverse().join('.') : '';
const dateLabel = d => new Date(d + 'T12:00:00').toLocaleDateString('ru', { day: 'numeric', month: 'long' });
let S = null, session = null, page = 'journal', busy = false, search = '', currentLesson = null;
let filter = { year: '', class: '', journal: '', mode: 'month', month: '', quarter: '0', view: 'table', calendar: 'week', calendarDate: '' };
try { Object.assign(filter, JSON.parse(sessionStorage.getItem('journal-filters') || '{}')); } catch {}
const item = (key,id) => S?.[key]?.find(x=>x.id === id);
const cls = () => item('classes', filter.class);
const year = () => item('years', filter.year);
const journal = () => item('journals', filter.journal);
const subjectName = j => item('subjects', j?.subjectId)?.name || 'Предмет';
const journalName = id => { const j=item('journals', id); return `${item('classes',j?.classId)?.name || ''} · ${subjectName(j)}`; };
const btn = (label, action, ic, variant = '', extra = '') => `<button type="button" class="btn ${variant}" data-act="${action}" ${extra}>${ic ? icon(ic) : ''}<span>${label}</span></button>`;
const options = (list, selected, name = 'name') => list.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x[name])}</option>`).join('');
function normalize() {
  if (!year()) filter.year = S.years.at(-1)?.id || '';
  if (!cls() || cls().yearId !== filter.year) filter.class = S.classes.find(c=>c.yearId===filter.year)?.id || '';
  if (!journal() || journal().classId !== filter.class) filter.journal = S.journals.find(j=>j.classId===filter.class)?.id || '';
  if (!filter.month || (year() && (filter.month < year().start.slice(0,7) || filter.month > year().end.slice(0,7)))) filter.month = year() ? (today() >= year().start && today() <= year().end ? today().slice(0,7) : year().start.slice(0,7)) : today().slice(0,7);
  if (!filter.calendarDate) filter.calendarDate = today();
  sessionStorage.setItem('journal-filters', JSON.stringify(filter));
}
function range() {
  if (filter.mode === 'quarter' && year()) return year().quarters[Number(filter.quarter)];
  const start = `${filter.month}-01`; const end = new Date(Number(filter.month.slice(0,4)), Number(filter.month.slice(5)), 0, 12).toLocaleDateString('en-CA');
  return { start, end };
}
function selection() {
  const r = range();
  return { students: S.students.filter(x=>x.classId===filter.class && x.start<=r.end && (!x.end || x.end>r.start)).sort((a,b)=>a.name.localeCompare(b.name,'ru')), lessons: S.lessons.filter(l=>l.journalId===filter.journal && l.date>=r.start && l.date<=r.end).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start)) };
}
function eligible(st,l) { const p=S.participations.find(p=>p.templateId===l.seriesId && p.studentId===st.id); return st.start<=l.date && (!st.end || l.date<st.end) && (!p?.start || p.start<=l.date) && (!p?.end || l.date<p.end); }
function record(st,l) { return { grades:S.grades.filter(g=>g.studentId===st.id && g.lessonId===l.id).sort((a,b)=>a.order-b.order).map(g=>g.value), status:S.attendance.find(a=>a.studentId===st.id && a.lessonId===l.id)?.status || '' }; }
function cell(st,l,plain=false) { const r=record(st,l), active=eligible(st,l); if(plain) return [...r.grades,symbols[r.status]].filter(Boolean).join(' ') || (active?'':'Не участвует'); return `<span class="marks">${r.grades.map(g=>`<span class="grade grade-${g}">${g}</span>`).join('')}${r.status?`<span class="attendance ${r.status}" title="${statuses[r.status]}">${symbols[r.status]}</span>`:''}${!r.grades.length&&!r.status?`<span class="cell-placeholder">${active?'·':'—'}</span>`:''}</span>`; }
async function api(url, payload) {
  let res;
  try { res = await fetch(url, payload === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json','X-Journal-Request':'1'}, body:JSON.stringify(payload) }); }
  catch { throw new Error('Нет связи с сервером. Проверьте подключение и повторите попытку. Введённые данные остаются в форме.'); }
  let result;
  try { result = await res.json(); } catch { throw new Error('Сервер временно недоступен. Повторите попытку.'); }
  if(!res.ok) { const error=new Error(result.error || 'Ошибка запроса.'); error.status=res.status; throw error; } return result;
}
function toast(text, error=false) { const el=$('#toast'); el.textContent=text; el.className=error?'visible error':'visible'; clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.className='',4500); }
function saveStatus(text, error=false) { const el=$('#save-status'); if(el){ el.innerHTML=`${icon(error?'close':'check')} ${esc(text)}`; el.classList.toggle('error',error); } }
async function action(type,payload) {
  saveStatus('Сохраняется…'); busy=true;
  try { S=await api('/api/action',{type,payload,revision:S.revision}); normalize(); saveStatus('Сохранено'); return S; }
  catch(e) { saveStatus('Не сохранено',true); if(e.status===409){ S=await api('/api/state'); e.message += ' Данные обновлены; проверьте изменения перед повторной попыткой.'; } throw e; }
  finally { busy=false; }
}
function modal(title,html,onSubmit,wide=false) {
  const el=$('#modal'); if(el.open) el.close();
  el.className=wide?'wide':'';
  el.innerHTML=`<div class="modal-head"><h2 id="modal-title">${title}</h2><button type="button" class="icon-btn" data-act="close" aria-label="Закрыть">${icon('close')}</button></div><form id="dialog-form">${html}<p class="form-error" role="alert"></p></form>`;
  el.showModal();
  $('#dialog-form').onsubmit=async e=>{ e.preventDefault(); if(busy) return; const submit=e.submitter; const error=$('.form-error',el); error.textContent=''; if(submit) submit.disabled=true;
    try { await onSubmit(new FormData(e.target),e.target); if(el.open) el.close(); render(); }
    catch(err){ error.textContent=err.message; }
    finally{ if(submit) submit.disabled=false; }
  };
}
const field=(label,name,type='text',value='',extra='')=>`<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const area=(label,name,value='',extra='')=>`<label class="field"><span>${label}</span><textarea name="${name}" ${extra}>${esc(value)}</textarea></label>`;
const foot=(label='Сохранить')=>`<div class="modal-foot">${btn('Отмена','close',null,'ghost')}<button class="btn primary" type="submit">${label}</button></div>`;

function renderLogin() {
  $('#app').innerHTML=`<div class="login"><div class="login-brand">${icon('book')} Классный журнал</div><section class="login-card"><span class="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО УЧИТЕЛЯ</span><h1>${session.needsSetup?'Ваш журнал начинается здесь':'Рада вас видеть'}</h1><p>${session.needsSetup?'Задайте пароль для доступа к урокам и отметкам.':'Войдите, чтобы продолжить работу с журналом.'}</p><form id="login-form">${field(session.needsSetup?'Придумайте пароль':'Пароль','password','password','','required minlength="12" maxlength="256" autocomplete="'+(session.needsSetup?'new-password':'current-password')+'"')}${session.needsSetup?field('Повторите пароль','confirm','password','','required minlength="12" autocomplete="new-password"')+'<small>Не менее 12 символов. Пароль понадобится на обоих устройствах.</small>':''}<p class="form-error" role="alert"></p><button type="submit" class="btn primary">${session.needsSetup?'Создать журнал':'Открыть журнал'} ${icon('arrow')}</button></form></section><p class="login-note">Всё о ваших уроках. В одном месте.</p></div>`;
  $('#login-form').onsubmit=async e=>{ e.preventDefault(); const f=new FormData(e.target); const b=$('button',e.target); b.disabled=true;
    try { if(session.needsSetup&&f.get('password')!==f.get('confirm')) throw new Error('Пароли не совпадают.'); await api(session.needsSetup?'/api/setup':'/api/login',{password:f.get('password')}); await load(); }
    catch(err){ $('.form-error',e.target).textContent=err.message; } finally{b.disabled=false;}
  };
}
function render() {
  if(!S) return renderLogin(); normalize();
  const oldTable=$('.table-scroll'), scroll=oldTable?{top:oldTable.scrollTop,left:oldTable.scrollLeft}:null;
  const names={journal:'Журнал',calendar:'Календарь',classes:'Классы и ученики',templates:'Расписание',settings:'Настройки'};
  const descriptions={journal:'Уроки, отметки и маленькие шаги к большим знаниям.',calendar:'Вся учебная неделя — перед глазами.',classes:'Ученики и предметы ваших классов.',templates:'Регулярные уроки без повторного ввода.',settings:'Учебные периоды, доступ и сохранность данных.'};
  $('#app').innerHTML=`<aside class="sidebar"><a class="brand" href="/">${icon('book')}<span>Классный<br><strong>журнал</strong></span></a><span class="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</span><nav aria-label="Основное меню">${Object.entries(names).map(([key,name])=>`<button class="nav-item ${page===key?'active':''}" data-act="nav" data-page="${key}" ${page===key?'aria-current="page"':''}>${icon({journal:'grid',calendar:'calendar',classes:'users',templates:'repeat',settings:'settings'}[key])}<span>${name}</span>${page===key?'<i></i>':''}</button>`).join('')}</nav><div class="sidebar-note"><span class="note-star">✳</span><p>Каждый урок<br>имеет значение.</p><small>Пусть важное будет под рукой.</small></div><div class="profile"><span class="avatar">У</span><div><strong>Учитель</strong><small>Личный журнал</small></div><button class="icon-btn" data-act="logout" aria-label="Выйти">${icon('logout')}</button></div></aside><main><header class="topbar"><span class="breadcrumb">Мой кабинет <span>/</span> ${names[page]}</span><div class="topbar-right"><span id="save-status" class="save-status">${icon('check')} Сохранено</span><label class="year-select">${icon('calendar')}<select aria-label="Учебный год" data-filter="year">${S.years.length?options(S.years,filter.year):'<option>Учебный год</option>'}</select></label></div></header><div class="page"><div class="page-heading"><div><span class="eyebrow">${new Date(today()+'T12:00:00').toLocaleDateString('ru',{weekday:'long',day:'numeric',month:'long'})}</span><h1>${names[page]}<span class="heading-dot">.</span></h1><p>${descriptions[page]}</p></div><div class="heading-actions">${page==='journal'?btn('Выгрузить','export','download','secondary',!journal()?'disabled':'')+btn('Добавить урок','lesson','plus','primary',!journal()?'disabled':''):page==='calendar'?btn('Повторять уроки','template','repeat','secondary',!journal()?'disabled':'')+btn('Добавить урок','lesson','plus','primary',!journal()?'disabled':''):page==='classes'?btn('Добавить класс','class','plus','primary',!year()?'disabled':''):page==='templates'?btn('Новое расписание','template','plus','primary',!journal()?'disabled':''):''}</div></div>${!S.years.length?onboarding():page==='journal'?renderJournal():page==='calendar'?renderCalendar():page==='classes'?renderClasses():page==='templates'?renderTemplates():renderSettings()}<footer class="page-footer"><span>Классный журнал <span class="footer-dot">•</span> Пространство для ваших уроков</span><span>${S.timezone} ${btn('Обновить','refresh',null,'text-btn')}</span></footer></div></main>`;
  if(scroll&&$('.table-scroll')){ $('.table-scroll').scrollTop=scroll.top; $('.table-scroll').scrollLeft=scroll.left; }
  if(!session.passwordRequired){
    $('.profile [data-act="logout"]')?.remove();
    if(page==='settings') $('.settings-card:last-child').innerHTML='<h2>Доступ к журналу</h2><p>Журнал открывается сразу, без пароля, на компьютере и телефоне.</p><p>Любой, кто может открыть адрес сайта, может просматривать и изменять записи.</p><hr><span class="quiet">Часовой пояс: '+esc(S.timezone)+'<br>Данные хранятся на сервере журнала.</span>';
  } else if(page==='settings') $('.settings-card:last-child')?.insertAdjacentHTML('beforeend',btn('Выйти из журнала','logout','logout','text-btn'));
}
function onboarding() {
  return `<section class="welcome card"><div class="welcome-art">${icon('book')}<span>Аа</span><i>5</i></div><span class="eyebrow">НАЧНЁМ С ЧИСТОГО ЛИСТА</span><h2>Место для вашего класса</h2><p>Настройте учебный год, добавьте учеников<br>и запланируйте первый урок.</p><div class="steps"><span><b>1</b> Учебный год</span><span><b>2</b> Класс и ученики</span><span><b>3</b> Предмет и уроки</span></div>${btn('Настроить учебный год','year','plus','primary')}<p class="quiet">Ваши данные сохраняются в общей базе журнала.</p></section>`;
}
function classFilters(includeSubject=true) {
  return `<div class="context-filters"><label class="field"><span>Класс</span><select data-filter="class" aria-label="Класс">${options(S.classes.filter(c=>c.yearId===filter.year),filter.class)||'<option>Нет классов</option>'}</select></label>${includeSubject?`<label class="field subject-select"><span>Предмет</span><select data-filter="journal" aria-label="Предмет">${S.journals.filter(j=>j.classId===filter.class).map(j=>`<option value="${j.id}" ${j.id===filter.journal?'selected':''}>${esc(subjectName(j))}</option>`).join('')||'<option>Нет предметов</option>'}</select></label>`:''}</div>`;
}
function periodFilters() {
  const y=year(), monthOptions=[];
  if(y){ let d=y.start.slice(0,7)+'-01'; while(d<=y.end){ const m=d.slice(0,7); monthOptions.push(`<option value="${m}" ${m===filter.month?'selected':''}>${months[Number(m.slice(5))-1]} ${m.slice(0,4)}</option>`); d=Number(m.slice(5))===12?`${Number(m.slice(0,4))+1}-01-01`:`${m.slice(0,4)}-${String(Number(m.slice(5))+1).padStart(2,'0')}-01`; } }
  return `<div class="period-filters"><div class="segmented"><button data-act="mode" data-mode="month" class="${filter.mode==='month'?'selected':''}">Месяц</button><button data-act="mode" data-mode="quarter" class="${filter.mode==='quarter'?'selected':''}">Четверть</button></div><div class="period-nav"><button class="icon-btn" data-act="previous" aria-label="Предыдущий период">‹</button>${filter.mode==='month'?`<select aria-label="Месяц" data-filter="month">${monthOptions.join('')}</select>`:`<select aria-label="Четверть" data-filter="quarter">${y.quarters.map((q,i)=>`<option value="${i}" ${String(i)===filter.quarter?'selected':''}>${i+1} четверть</option>`).join('')}</select>`}<button class="icon-btn" data-act="next" aria-label="Следующий период">›</button></div></div>`;
}
function empty(title,description,button,act) { return `<div class="empty"><div class="empty-icon">${icon('book')}</div><h3>${title}</h3><p>${description}</p>${button?btn(button,act,'plus','primary'):''}</div>`; }
function prerequisites() { if(!cls()) return empty('Добавьте первый класс','Список учеников станет основой вашего журнала.','Добавить класс','class'); if(!journal()) return empty('Какой предмет вы ведёте?','Добавьте предмет, чтобы планировать уроки и выставлять отметки.','Добавить предмет','subject'); return ''; }
function renderJournal() {
  const {students,lessons}=selection();
  let body=prerequisites();
  if(!body&&!students.length) body=empty('В классе пока нет учеников','Добавьте список учеников — по одному имени в строке.','Добавить учеников','students');
  if(!body&&!lessons.length) body=empty('Здесь появятся ваши уроки','Добавьте разовый урок или настройте повторяющееся расписание.','Добавить урок','lesson')+`<div class="empty-secondary">${btn('Настроить повторение','template','repeat','text-btn')}</div>`;
  if(!body) body=filter.view==='lesson'?singleLesson(students,lessons):journalTable(students,lessons);
  return `<section class="card journal-card"><div class="filter-bar">${classFilters()}${periodFilters()}</div><div class="journal-toolbar"><div><span class="class-badge">${esc(cls()?.name||'Класс')}</span><strong>${esc(subjectName(journal()))}</strong><span class="quiet">${students.length} учеников <span class="footer-dot">·</span> ${lessons.length} уроков</span></div><div class="segmented view-toggle"><button data-act="view" data-view="table" class="${filter.view==='table'?'selected':''}">${icon('grid')} Таблица</button><button data-act="view" data-view="lesson" class="${filter.view==='lesson'?'selected':''}">${icon('book')} Один урок</button></div></div>${body}${lessons.length&&students.length?`<div class="legend"><span><b class="attendance present">П</b> Присутствовал</span><span><b class="attendance absent">Н</b> Отсутствовал</span><span><b class="attendance ill">Б</b> Болел</span><span><b class="attendance excused">У</b> Уважительная причина</span><span>· Нет записи</span></div>`:''}</section>${lessons.length?`<section class="content-section"><div class="section-heading"><h2>Содержание уроков <span class="count">${lessons.length}</span></h2><span class="quiet">Тема и домашнее задание</span></div><div class="lesson-content card">${lessons.map(l=>`<button class="content-row" data-act="lesson" data-id="${esc(l.id)}"><span class="lesson-date"><strong>${new Date(l.date+'T12:00:00').getDate()}</strong><span>${new Date(l.date+'T12:00:00').toLocaleDateString('ru',{month:'short'})}</span></span><span class="content-topic"><small>${esc(l.start)}–${esc(l.end)}</small><strong>${esc(l.topic)||'<span class="placeholder">Добавить тему урока</span>'}</strong></span><span class="content-homework"><small>Домашнее задание</small><span>${esc(l.homework)||'<span class="placeholder">Пока не задано</span>'}</span></span>${icon('arrow')}</button>`).join('')}</div></section>`:''}`;
}
function journalTable(students,lessons) { return `<div class="table-scroll" tabindex="0" aria-label="Таблица журнала, прокручивается по горизонтали"><table class="journal-table"><thead><tr><th class="number sticky">№</th><th class="student-name sticky">Ученики <span>по алфавиту ↓</span></th>${lessons.map(l=>`<th class="${l.date===today()?'today':''}"><button data-act="lesson" data-id="${esc(l.id)}" title="${esc(l.topic||'Добавить тему урока')}"><span class="weekday">${weekdays[new Date(l.date+'T12:00:00').getDay()]}</span><strong>${l.date.slice(8)}.${l.date.slice(5,7)}</strong><small>${l.start}</small></button></th>`).join('')}</tr></thead><tbody>${students.map((st,i)=>`<tr><td class="number sticky">${i+1}</td><th scope="row" class="student-name sticky" title="${esc(st.name)}">${esc(st.name)}</th>${lessons.map(l=>`<td class="${l.date===today()?'today':''}"><button class="mark-cell" data-act="record" data-student="${st.id}" data-lesson="${esc(l.id)}" aria-label="${esc(st.name)}, ${fmt(l.date)} ${l.start}, ${esc(cell(st,l,true)||'нет записи')}" ${!eligible(st,l)?'disabled title="Не участвует в уроке"':''}>${cell(st,l)}</button></td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
function singleLesson(students,lessons) {
  if(!lessons.some(l=>l.id===currentLesson)) currentLesson=lessons.find(l=>l.date===today())?.id || lessons[0].id;
  const l=item('lessons',currentLesson);
  return `<div class="single-lesson"><div class="single-head"><label class="field"><span>Урок</span><select id="single-select">${lessons.map(x=>`<option value="${esc(x.id)}" ${x.id===l.id?'selected':''}>${fmt(x.date)} · ${x.start}</option>`).join('')}</select></label>${btn('Тема и ДЗ','lesson',null,'secondary',`data-id="${esc(l.id)}"`)}${btn('Остальные присутствуют','present','check','text-btn',`data-id="${esc(l.id)}"`)}</div><div class="single-description"><p><b>Тема:</b> ${esc(l.topic)||'Не заполнена'}</p><p><b>ДЗ:</b> ${esc(l.homework)||'Не задано'}</p></div><div class="student-cards">${students.map((st,i)=>`<button class="student-mark-row" data-act="record" data-student="${st.id}" data-lesson="${esc(l.id)}" ${eligible(st,l)?'':'disabled'}><span class="quiet">${i+1}</span><strong>${esc(st.name)}</strong>${cell(st,l)}</button>`).join('')}</div></div>`;
}
function renderCalendar() {
  const d=filter.calendarDate; const weekday=new Date(d+'T12:00:00').getDay();
  const first=filter.calendar==='week'?addDays(d,-((weekday+6)%7)):d.slice(0,7)+'-01';
  const start=filter.calendar==='week'?first:addDays(first,-((new Date(first+'T12:00:00').getDay()+6)%7));
  const count=filter.calendar==='week'?7:42;
  const lessons=S.lessons.filter(l=>item('classes',item('journals',l.journalId)?.classId)?.yearId===filter.year);
  return `<section class="card calendar-card"><div class="calendar-toolbar"><div class="period-nav"><button class="icon-btn" data-act="cal-prev" aria-label="Назад">‹</button><h2>${filter.calendar==='week'?`${dateLabel(start)} — ${dateLabel(addDays(start,6))}`:`${months[Number(d.slice(5,7))-1]} ${d.slice(0,4)}`}</h2><button class="icon-btn" data-act="cal-next" aria-label="Вперёд">›</button>${btn('Сегодня','cal-today',null,'text-btn')}</div><div class="segmented"><button data-act="cal-mode" data-mode="week" class="${filter.calendar==='week'?'selected':''}">Неделя</button><button data-act="cal-mode" data-mode="month" class="${filter.calendar==='month'?'selected':''}">Месяц</button></div></div><div class="calendar-grid ${filter.calendar}">${Array.from({length:count},(_,i)=>{ const day=addDays(start,i),list=lessons.filter(l=>l.date===day).sort((a,b)=>a.start.localeCompare(b.start)); return `<div class="calendar-day ${day===today()?'current':''} ${day.slice(0,7)!==d.slice(0,7)&&filter.calendar==='month'?'outside':''}"><button class="day-head" data-act="cal-day" data-date="${day}" aria-label="Уроки ${fmt(day)}"><span>${weekdays[new Date(day+'T12:00:00').getDay()]}</span><strong>${day.slice(8)}</strong></button>${list.map(l=>`<button class="event" data-act="lesson" data-id="${esc(l.id)}"><small>${l.start}–${l.end}</small><strong>${esc(journalName(l.journalId))}</strong><span>${esc(l.topic)||'Тема не заполнена'}</span></button>`).join('')}${filter.calendar==='week'&&!list.length?'<span class="free-day">Нет уроков</span>':''}</div>`; }).join('')}</div><div class="calendar-mobile-hint">Нажмите на дату, чтобы открыть список уроков дня.</div></section><p class="quiet calendar-note">Показаны все классы выбранного учебного года. Нажмите на урок, чтобы заполнить тему и домашнее задание.</p>`;
}
function renderClasses() {
  const all=S.students.filter(st=>st.classId===filter.class).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  const list=all.filter(st=>st.name.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')));
  return `<section class="card"><div class="filter-bar">${classFilters(false)}<div class="heading-actions">${btn('Изменить класс','class',null,'text-btn',cls()?`data-id="${cls().id}"`:'disabled')}${btn('Добавить учеников','students','plus','primary',!cls()?'disabled':'')}</div></div>${!cls()?prerequisites():`<div class="subjects-row"><span class="quiet">Предметы класса</span>${S.journals.filter(j=>j.classId===filter.class).map(j=>`<span class="subject-chip">${esc(subjectName(j))}</span>`).join('')}${btn('Добавить предмет','subject','plus','text-btn')}</div><div class="list-heading"><h2>Ученики <span class="count">${all.length}</span></h2><label class="search-box">${icon('search')}<input id="student-search" value="${esc(search)}" placeholder="Найти ученика" aria-label="Найти ученика"></label></div><div id="student-list">${list.map((st,i)=>`<div class="roster-row"><span class="quiet">${i+1}</span><span class="initials">${esc(st.name.split(' ').slice(0,2).map(x=>x[0]).join(''))}</span><div class="roster-name"><strong>${esc(st.name)}</strong><small>${st.end?`В архиве с ${fmt(st.end)}`:`В классе с ${fmt(st.start)}`}</small></div>${btn('Изменить','student',null,'text-btn',`data-id="${st.id}"`)}${!st.end?btn('В архив','archive',null,'text-btn muted',`data-id="${st.id}"`):''}</div>`).join('')||empty(all.length?'Никого не найдено':'Пока нет учеников',all.length?'Попробуйте другое имя.':'Добавьте учеников списком.','', '')}</div>`}</section>`;
}
function renderTemplates() {
  const list=S.templates.filter(t=>t.active&&item('classes',item('journals',t.journalId)?.classId)?.yearId===filter.year);
  return `${prerequisites()?`<section class="card">${prerequisites()}</section>`:''}<div class="template-grid">${list.map(t=>`<article class="card template-card"><div class="template-icon">${icon('repeat')}</div><span class="badge">Каждую неделю</span><h2>${esc(t.name)}</h2><p>${esc(journalName(t.journalId))}</p><div class="slots">${t.slots.map(x=>`<div><strong>${weekdays[x.day]}</strong><span>${x.start}–${x.end}</span></div>`).join('')}</div><p class="quiet">${fmt(t.start)} — ${fmt(t.end)}</p><div class="template-actions">${btn('Уроки','template-lessons',null,'secondary',`data-id="${t.id}"`)}${btn('Убрать ученика','exclude',null,'text-btn',`data-id="${t.id}"`)}${btn('Удалить шаблон','delete-template',null,'text-btn danger',`data-id="${t.id}"`)}</div></article>`).join('')}</div>${!list.length?`<section class="card">${empty('Уроки по вашему расписанию','Выберите дни недели и время. Уроки появятся в календаре и журнале.',journal()?'Создать расписание':'', 'template')}</section>`:''}`;
}
function renderSettings() {
  return `<div class="settings-grid"><section class="card settings-card"><div class="section-heading"><h2>Учебный год</h2>${btn('Добавить','year','plus','text-btn')}</div><h3>${esc(year().name)}</h3><p class="quiet">${fmt(year().start)} — ${fmt(year().end)}</p><div class="quarter-list">${year().quarters.map((q,i)=>`<div><strong>${i+1} четверть</strong><span>${fmt(q.start)} — ${fmt(q.end)}</span></div>`).join('')}</div>${btn('Изменить даты','year',null,'secondary',`data-id="${year().id}"`)}<p class="quiet">Укажите даты четвертей по календарю вашей школы.</p></section><section class="card settings-card"><h2>Резервная копия</h2><p>Сохраните все классы, уроки, оценки и настройки в одном файле.</p><a class="btn primary" href="/api/backup" download>${icon('download')} Скачать копию</a><hr><h3>Восстановить журнал</h3><p>Данные из файла заменят текущий журнал. Перед заменой на сервере автоматически сохранится копия.</p>${btn('Выбрать файл копии','restore',null,'secondary')}</section><section class="card settings-card"><h2>Доступ к журналу</h2><p>Один пароль для входа с компьютера и телефона. После смены пароля потребуется войти заново.</p>${btn('Изменить пароль','password',null,'secondary')}<hr><span class="quiet">Часовой пояс: ${esc(S.timezone)}<br>Данные хранятся на сервере журнала.</span></section></div>`;
}

function yearForm(id) {
  const y=item('years',id); const n=Number(today().slice(0,4))-(Number(today().slice(5,7))<8?1:0);
  const q=y?.quarters||[{start:`${n}-09-01`,end:`${n}-10-25`},{start:`${n}-11-05`,end:`${n}-12-28`},{start:`${n+1}-01-09`,end:`${n+1}-03-22`},{start:`${n+1}-04-01`,end:`${n+1}-05-31`}];
  modal(y?'Учебный год и четверти':'Новый учебный год',`${field('Название','name','text',y?.name||`${n}–${n+1}`,'required maxlength="80"')}<div class="form-grid">${field('Начало учебного года','start','date',y?.start||`${n}-09-01`,'required')}${field('Конец учебного года','end','date',y?.end||`${n+1}-08-31`,'required')}</div><h3>Четверти</h3><p class="quiet">Даты ниже — пример. Уточните их по календарю вашей школы.</p>${q.map((x,i)=>`<div class="quarter-form"><strong>${i+1}</strong>${field('Начало','q'+i+'start','date',x.start,'required')}${field('Окончание','q'+i+'end','date',x.end,'required')}</div>`).join('')}${foot(y?'Сохранить':'Создать учебный год')}`,async f=>{await action('year',{id:y?.id,name:f.get('name'),start:f.get('start'),end:f.get('end'),quarters:q.map((_,i)=>({start:f.get('q'+i+'start'),end:f.get('q'+i+'end')}))}); if(!y) filter.year=S.years.at(-1).id;},true);
}
function classForm(id) { const c=item('classes',id); modal(c?'Изменить класс':'Новый класс',`${field('Название класса','name','text',c?.name||'','required placeholder="Например, 5А" maxlength="40"')}<p class="quiet">Учебный год: ${esc(year().name)}</p>${foot(c?'Сохранить':'Добавить класс')}`,async f=>{await action('class',{id:c?.id,name:f.get('name'),yearId:filter.year}); if(!c){filter.class=S.classes.at(-1).id;page='classes';}}); }
function subjectForm() { modal('Добавить предмет',`${field('Название предмета','name','text','','required placeholder="Например, Математика" maxlength="80"')}<p class="quiet">Класс: ${esc(cls().name)}</p>${foot('Добавить предмет')}`,async f=>{await action('subject',{name:f.get('name'),classId:filter.class}); filter.journal=S.journals.at(-1).id;}); }
function studentsForm() {
  modal('Добавить учеников',`${area('Фамилия, имя, отчество — по одному ученику в строке','names','','required rows="9" placeholder="Иванова Анна Сергеевна\nПетров Иван Алексеевич"')}<p id="duplicate-note" class="quiet"></p>${field('В классе с','start','date',year().start,'required')}<p class="quiet">Для ученика, пришедшего в середине года, укажите дату зачисления.</p>${foot('Добавить учеников')}`,async f=>action('students',{classId:filter.class,names:f.get('names').split('\n').map(x=>x.trim()).filter(Boolean),start:f.get('start')}));
  $('[name="names"]',$('#modal')).oninput=e=>{const names=e.target.value.split('\n').map(x=>x.trim()).filter(Boolean); const seen=new Set(S.students.filter(s=>s.classId===filter.class).map(s=>s.name.toLowerCase()));let dup=false; names.forEach(n=>{if(seen.has(n.toLowerCase()))dup=true;seen.add(n.toLowerCase());}); $('#duplicate-note').textContent=dup?'Есть совпадающие имена. Они будут добавлены как разные ученики.':`${names.length} учеников в списке`;};
}
function lessonForm(id,chosenDate) {
  const l=item('lessons',id); const j=l?.journalId||filter.journal;
  const defaultDate=chosenDate||(today()>=range().start&&today()<=range().end?today():range().start);
  modal(l?'Урок · '+fmt(l.date):'Добавить урок',`<div class="lesson-context">${icon('book')} ${esc(journalName(j))}</div><div class="form-grid three">${field('Дата','date','date',l?.date||defaultDate,'required '+(l?'readonly':''))}${field('Начало','start','time',l?.start||'09:00','required '+(l?'readonly':''))}${field('Окончание','end','time',l?.end||'09:45','required '+(l?'readonly':''))}</div>${area('Тема урока','topic',l?.topic||'','rows="3" maxlength="2000" placeholder="О чём этот урок?"')}${area('Домашнее задание','homework',l?.homework||'','rows="3" maxlength="4000" placeholder="Что подготовить к следующему уроку?"')}${l?`<div class="lesson-shortcuts">${btn('Открыть отметки','open-marks','grid','text-btn',`data-id="${esc(l.id)}"`)}${btn('Остальные присутствуют','present','check','text-btn',`data-id="${esc(l.id)}"`)}</div>`:''}${foot(l?'Сохранить урок':'Добавить урок')}`,async f=>action('lesson',{id:l?.id,journalId:j,date:f.get('date'),start:f.get('start'),end:f.get('end'),topic:f.get('topic'),homework:f.get('homework')}),true);
}
function recordForm(studentId,lessonId) {
  const st=item('students',studentId),l=item('lessons',lessonId),r=record(st,l);
  modal('Отметка ученика',`<div class="record-heading"><strong>${esc(st.name)}</strong><span>${dateLabel(l.date)} · ${l.start} · ${esc(subjectName(item('journals',l.journalId)))}</span></div><fieldset class="attendance-options"><legend>Посещаемость</legend>${Object.entries(statuses).map(([value,label])=>`<label><input type="radio" name="status" value="${value}" ${value===r.status?'checked':''}><span>${symbols[value]?`<b class="attendance ${value}">${symbols[value]}</b>`:''}${label}</span></label>`).join('')}</fieldset><label class="field"><span>Оценки</span><input name="grades" value="${r.grades.join(' ')}" inputmode="numeric" placeholder="Например, 5 4" autocomplete="off"></label><div class="grade-buttons">${[2,3,4,5].map(g=>`<button type="button" class="grade-pick grade-${g}" data-act="add-grade" data-grade="${g}">${g}</button>`).join('')}${btn('Очистить','clear-grades',null,'text-btn')}</div><p class="quiet">Несколько оценок разделяйте пробелом. Посещаемость сохраняется отдельно.</p>${foot()}`,async f=>{const raw=f.get('grades').trim(); const grades=raw?raw.split(/[\s,;]+/).map(Number):[]; await action('record',{lessonId,studentId,status:f.get('status'),grades}); toast('Отметка сохранена');});
}
function templateForm() {
  const start=today()>=year().start&&today()<=year().end?today():year().start;
  modal('Повторяющееся расписание',`${field('Название','name','text',journalName(filter.journal),'required maxlength="200"')}<label class="field"><span>Класс и предмет</span><select name="journalId">${S.journals.filter(j=>item('classes',j.classId)?.yearId===filter.year).map(j=>`<option value="${j.id}" ${j.id===filter.journal?'selected':''}>${esc(journalName(j.id))}</option>`).join('')}</select></label><div class="form-grid">${field('Первый день','start','date',start,'required')}${field('Последний день','end','date',year().quarters.at(-1).end,'required')}</div><h3>Каждую неделю</h3><div class="week-slots">${[1,2,3,4,5,6,0].map(d=>`<div class="week-slot"><label><input type="checkbox" name="day${d}" ${d===1?'checked':''}><span>${weekdays[d]}</span></label><input type="time" name="start${d}" value="09:00" aria-label="${weekdays[d]} начало"><span>—</span><input type="time" name="end${d}" value="09:45" aria-label="${weekdays[d]} окончание"></div>`).join('')}</div><div id="template-preview" class="preview-box"></div>${foot('Создать расписание')}`,async f=>action('template',{name:f.get('name'),journalId:f.get('journalId'),start:f.get('start'),end:f.get('end'),slots:[0,1,2,3,4,5,6].filter(d=>f.has('day'+d)).map(day=>({day,start:f.get('start'+day),end:f.get('end'+day)}))}),true);
  const preview=()=>{const f=new FormData($('#dialog-form')), dates=[];let count=0;const start=f.get('start'),end=f.get('end'); if(start&&end&&start<=end&&Number.isFinite(Date.parse(start))&&Date.parse(end)-Date.parse(start)<=400*86400000){for(let d=start;d<=end;d=addDays(d,1)){const w=new Date(d+'T12:00:00').getDay();if(f.has('day'+w)){count++;if(dates.length<4)dates.push(`${fmt(d)} в ${f.get('start'+w)}`);}}}$('#template-preview').innerHTML=`<strong>${count} уроков в расписании</strong><span>${dates.map(esc).join(' · ')||'Выберите дни и период'}</span>`;}; $('#dialog-form').addEventListener('input',preview); preview();
}
function exportForm() {
  const r=range(); const query=new URLSearchParams({journalId:filter.journal,start:r.start,end:r.end});
  modal('Выгрузить журнал',`<p><strong>${esc(journalName(filter.journal))}</strong><br>${fmt(r.start)} — ${fmt(r.end)}</p><p class="quiet">Все ученики и уроки выбранного периода, включая данные за пределами прокрутки.</p><div class="export-choices"><a class="export-choice" href="/api/export?${query}" download><span class="file-icon">XLSX</span><strong>Таблица Excel</strong><small>Журнал и содержание уроков</small>${icon('download')}</a><button class="export-choice" type="button" data-act="print"><span class="file-icon pdf">PDF</span><strong>Печать / сохранить PDF</strong><small>Таблица с разбиением на страницы</small>${icon('download')}</button></div>`,async()=>{});
}
function printJournal() {
  const {students,lessons}=selection(),r=range(); let html=''; const chunks=[]; for(let i=0;i<lessons.length;i+=10)chunks.push(lessons.slice(i,i+10)); if(!chunks.length)chunks.push([]);
  chunks.forEach((chunk,index)=>{html+=`<section class="print-section"><h1>Классный журнал · ${esc(journalName(filter.journal))}</h1><p>${fmt(r.start)} — ${fmt(r.end)} · Часть ${index+1} из ${chunks.length}</p><table><thead><tr><th>№</th><th>Ф. И. О.</th>${chunk.map(l=>`<th>${fmt(l.date)}<br>${l.start}</th>`).join('')}</tr></thead><tbody>${students.map((st,i)=>`<tr><td>${i+1}</td><th>${esc(st.name)}</th>${chunk.map(l=>`<td>${esc(cell(st,l,true))}</td>`).join('')}</tr>`).join('')}</tbody></table><p>П — присутствовал; Н — отсутствовал; Б — болел; У — уважительная причина. Пусто — нет записи.</p></section>`;});
  html+=`<section class="print-section"><h1>Содержание уроков · ${esc(journalName(filter.journal))}</h1><table><thead><tr><th>Дата и время</th><th>Тема урока</th><th>Домашнее задание</th></tr></thead><tbody>${lessons.map(l=>`<tr><td>${fmt(l.date)}<br>${l.start}–${l.end}</td><td>${esc(l.topic)}</td><td>${esc(l.homework)}</td></tr>`).join('')}</tbody></table></section>`;
  $('#print-area').innerHTML=html; $('#modal').close(); window.print();
}
async function deleteTemplate(id) {
  const t=item('templates',id); const preview=await api('/api/delete-preview?id='+encodeURIComponent(id));
  modal('Удалить шаблон?',`<p><strong>${esc(t.name)}</strong></p><p>Будет удалено будущих пустых уроков: <b>${preview.removed}</b>.</p><p>Сохраним прошедшие и заполненные уроки: <b>${preview.kept}</b>. Они останутся в журнале без повторения.</p><p class="quiet">Ученики, их отметки и другие шаблоны останутся на месте.</p>${foot('Удалить шаблон')}`,async()=>{await action('deleteTemplate',{id});toast('Шаблон удалён. История сохранена.');});
}
function excludeForm(id) {const t=item('templates',id),j=item('journals',t.journalId);modal('Убрать ученика из расписания',`<p>${esc(t.name)}</p><label class="field"><span>Ученик</span><select name="studentId" required>${options(S.students.filter(st=>st.classId===j.classId&&!st.end),'')}</select></label>${field('Не участвует начиная с','end','date',today(),'required min="'+today()+'"')}<p class="quiet">Шаблон и уроки класса сохранятся. Прежние отметки ученика останутся в журнале.</p>${foot('Убрать из расписания')}`,async f=>action('exclude',{templateId:id,studentId:f.get('studentId'),end:f.get('end')}));}
function restoreForm() {
  modal('Восстановить резервную копию',`<p>Текущий журнал будет заменён данными из копии. Перед заменой сервер сохранит текущий журнал в отдельный файл.</p><label class="field"><span>Файл резервной копии</span><input type="file" name="backup" accept=".json,application/json" required></label>${field('Введите ВОССТАНОВИТЬ для подтверждения','confirm','text','','required autocomplete="off"')}${foot('Восстановить')}`,async f=>{if(f.get('confirm')!=='ВОССТАНОВИТЬ')throw new Error('Введите ВОССТАНОВИТЬ.');const file=f.get('backup');if(file.size>12*1024*1024)throw new Error('Максимум 12 МБ.');let backup;try{backup=JSON.parse(await file.text());}catch{throw new Error('Не удалось прочитать JSON-файл.');}S=await api('/api/restore',{backup,revision:S.revision});toast('Журнал восстановлен.');});
}

document.addEventListener('click',async e=>{
  const target=e.target.closest('[data-act]'); if(!target || target.disabled)return;
  const act=target.dataset.act,id=target.dataset.id;
  try{
    switch(act){
      case 'close':$('#modal').close();break;
      case 'nav':page=target.dataset.page;render();break;
      case 'year':yearForm(id);break;
      case 'class':classForm(id);break;
      case 'subject':subjectForm();break;
      case 'students':studentsForm();break;
      case 'lesson':lessonForm(id);break;
      case 'record':recordForm(target.dataset.student,target.dataset.lesson);break;
      case 'template':templateForm();break;
      case 'export':exportForm();break;
      case 'print':printJournal();break;
      case 'mode':filter.mode=target.dataset.mode;render();break;
      case 'view':filter.view=target.dataset.view;render();break;
      case 'previous':case 'next':{const delta=act==='next'?1:-1;if(filter.mode==='quarter')filter.quarter=String(Math.max(0,Math.min(3,Number(filter.quarter)+delta)));else {const d=new Date(filter.month+'-15T12:00:00');d.setMonth(d.getMonth()+delta);const next=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;if(next>=year().start.slice(0,7)&&next<=year().end.slice(0,7))filter.month=next;}render();break;}
      case 'cal-mode':filter.calendar=target.dataset.mode;render();break;
      case 'cal-today':filter.calendarDate=today();render();break;
      case 'cal-next':case 'cal-prev':{const delta=act==='cal-next'?1:-1;if(filter.calendar==='week')filter.calendarDate=addDays(filter.calendarDate,delta*7);else{const d=new Date(filter.calendarDate.slice(0,7)+'-01T12:00:00');d.setMonth(d.getMonth()+delta);filter.calendarDate=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;}render();break;}
      case 'cal-day':{const d=target.dataset.date,list=S.lessons.filter(l=>l.date===d&&item('classes',item('journals',l.journalId)?.classId)?.yearId===filter.year).sort((a,b)=>a.start.localeCompare(b.start));modal(dateLabel(d),`<div class="day-list">${list.map(l=>`<button type="button" class="day-list-lesson" data-act="lesson" data-id="${esc(l.id)}"><b>${l.start}</b><span>${esc(journalName(l.journalId))}<small>${esc(l.topic)||'Тема не заполнена'}</small></span>${icon('arrow')}</button>`).join('')||'<p class="quiet">В этот день уроков нет.</p>'}</div>${journal()?btn('Добавить урок','lesson-date','plus','primary',`data-date="${d}"`):''}`,async()=>{});break;}
      case 'lesson-date':lessonForm(null,target.dataset.date);break;
      case 'add-grade':{const input=$('[name="grades"]',$('#modal'));input.value=(input.value+' '+target.dataset.grade).trim();break;}
      case 'clear-grades':$('[name="grades"]',$('#modal')).value='';break;
      case 'present':await action('present',{id});toast('Неотмеченные ученики отмечены присутствующими.');if(!$('#modal').open)render();break;
      case 'open-marks':{const l=item('lessons',id),j=item('journals',l.journalId);filter.class=j.classId;filter.year=item('classes',j.classId).yearId;filter.journal=j.id;filter.month=l.date.slice(0,7);filter.mode='month';filter.view='lesson';currentLesson=id;page='journal';$('#modal').close();render();break;}
      case 'student':{const st=item('students',id);modal('Изменить имя ученика',`${field('Фамилия, имя, отчество','name','text',st.name,'required maxlength="150"')}${foot()}`,async f=>action('student',{id,name:f.get('name')}));break;}
      case 'archive':{const st=item('students',id);modal('Архивировать ученика',`<p>${esc(st.name)}</p>${field('Не участвует в уроках с','end','date',today(),'required min="'+today()+'"')}<p class="quiet">Ученик останется в истории класса. Прошедшие оценки и посещаемость сохранятся.</p>${foot('В архив')}`,async f=>action('archive',{id,end:f.get('end')}));break;}
      case 'delete-template':await deleteTemplate(id);break;
      case 'exclude':excludeForm(id);break;
      case 'template-lessons':{const t=item('templates',id);modal(esc(t.name),`<div class="day-list">${S.lessons.filter(l=>l.seriesId===id).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start)).map(l=>`<button class="day-list-lesson" type="button" data-act="lesson" data-id="${esc(l.id)}"><b>${fmt(l.date)}</b><span>${l.start}–${l.end}<small>${esc(l.topic)||'Тема не заполнена'}</small></span>${icon('arrow')}</button>`).join('')}</div>`,async()=>{},true);break;}
      case 'restore':restoreForm();break;
      case 'password':modal('Изменить пароль',`${field('Текущий пароль','current','password','','required autocomplete="current-password"')}${field('Новый пароль','password','password','','required minlength="12" maxlength="256" autocomplete="new-password"')}${field('Повторите новый пароль','confirm','password','','required autocomplete="new-password"')}${foot('Изменить пароль')}`,async f=>{if(f.get('password')!==f.get('confirm'))throw new Error('Пароли не совпадают.');await api('/api/password',{current:f.get('current'),password:f.get('password')});S=null;session={needsSetup:false};toast('Пароль изменён. Войдите снова.');});break;
      case 'refresh':S=await api('/api/state');render();toast('Данные обновлены.');break;
      case 'logout':await api('/api/logout',{});S=null;session={needsSetup:false};renderLogin();break;
    }
  }catch(err){toast(err.message,true);}
});
document.addEventListener('change',e=>{if(e.target.dataset.filter){filter[e.target.dataset.filter]=e.target.value;render();}if(e.target.id==='single-select'){currentLesson=e.target.value;render();}});
document.addEventListener('input',e=>{if(e.target.id==='student-search'){search=e.target.value;const pos=e.target.selectionStart;render();const input=$('#student-search');input.focus();input.setSelectionRange(pos,pos);}});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
async function load() {session=await api('/api/session');if(!session.authenticated){S=null;renderLogin();return;}S=await api('/api/state');render();}
load().catch(e=>{$('#app').innerHTML=`<div class="loading"><h1>Не удалось открыть журнал</h1><p>${esc(e.message)}</p><a href="/">Попробовать снова</a></div>`;});
setInterval(async()=>{if(!S||busy||$('#modal').open||document.hidden||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;try{const next=await api('/api/state');if(next.revision!==S.revision){S=next;render();toast('Получены изменения с другого устройства.');}}catch(e){saveStatus(e.status===401?'Войдите заново':'Нет связи с сервером',true);}},30000);
