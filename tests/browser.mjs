import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server.js';

const dir=mkdtempSync(join(tmpdir(),'journal-browser-'));
let server,store,mf,origin;
if(process.env.JOURNAL_TEST_CLOUD==='true') {
  const {Miniflare,cloudOptions}=await import('./miniflare-options.js');
  mf=new Miniflare(cloudOptions(dir));
  origin=(await mf.ready).origin;
} else {
  ({server,store}=await createApp({dataDir:dir}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  origin=`http://127.0.0.1:${server.address().port}`;
}
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined),headless:true});
const output=resolve('test-results');mkdirSync(output,{recursive:true});
const errors=[];
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await expect(page.getByRole('button',{name:'Настроить учебный год'})).toBeVisible();await expect(page.locator('#login-form')).toHaveCount(0);
  await page.getByRole('button',{name:'Настроить учебный год'}).click();
  const f=page.locator('#dialog-form');
  await f.locator('[name=name]').fill('2026–2027');await f.locator('[name=start]').fill('2026-09-01');await f.locator('[name=end]').fill('2027-08-31');
  const qs=[['2026-09-01','2026-10-25'],['2026-11-05','2026-12-28'],['2027-01-09','2027-03-22'],['2027-04-01','2027-05-31']];
  for(let i=0;i<4;i++){await f.locator(`[name=q${i}start]`).fill(qs[i][0]);await f.locator(`[name=q${i}end]`).fill(qs[i][1]);}
  await f.getByRole('button',{name:'Создать учебный год'}).click();
  await page.getByRole('button',{name:'Добавить класс',exact:true}).click();await f.getByLabel('Название класса').fill('5А');await f.getByRole('button',{name:'Добавить класс'}).click();
  await page.getByRole('button',{name:'Добавить предмет',exact:true}).click();await f.getByLabel('Название предмета').fill('Математика');await f.getByRole('button',{name:'Добавить предмет'}).click();
  await page.getByRole('button',{name:'Добавить учеников',exact:true}).click();
  const names=['Александрова Анна','Андреев Михаил','Белов Артём','Васильева София','Волков Максим','Воробьёва Полина','Григорьев Никита','Данилова Алиса','Дмитриев Иван','Егорова Мария','Жуков Александр','Зайцева Варвара','Иванова Елизавета','Козлов Дмитрий','Кузнецова Анастасия','Лебедев Матвей','Макарова Ксения','Морозов Даниил','Никитина Виктория','Новиков Роман','Орлова Ева','Павлов Тимофей','Петрова Ульяна','Романова Дарья','Семёнов Андрей','Смирнова Вероника','Соколов Илья','Степанова Арина','Фёдоров Кирилл','Яковлева Екатерина'];
  await f.locator('[name=names]').fill(names.join('\n'));await f.locator('[name=start]').fill('2026-09-01');await f.getByRole('button',{name:'Добавить учеников'}).click();
  await page.getByRole('button',{name:'Журнал',exact:true}).click();
  await page.getByRole('button',{name:'Настроить повторение'}).click();
  await f.locator('[name=start]').fill('2026-09-01');await f.locator('[name=end]').fill('2026-10-25');
  await f.locator('[name=day3]').check();await f.locator('[name=day5]').check();
  await f.getByRole('button',{name:'Создать расписание'}).click();
  await page.locator('[data-filter=month]').selectOption('2026-09');
  await page.locator('.mark-cell').first().click();await f.locator('[name=grades]').fill('5 4');await f.locator('[name=status][value=present]').check();await f.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(page.locator('.mark-cell').first()).toHaveText(/5/);
  await page.locator('thead button').first().click();await f.locator('[name=topic]').fill('Натуральные числа и шкалы');await f.locator('[name=homework]').fill('§ 1, упражнения 12, 15. Подготовить примеры из жизни.');await f.getByRole('button',{name:'Сохранить урок'}).click();
  await expect(page.locator('#modal')).not.toBeVisible();await page.reload();await expect(page.locator('.mark-cell').first()).toHaveText(/5/);
  // Failed save keeps the edit available for a retry.
  await page.locator('.mark-cell').first().click();await f.locator('[name=grades]').fill('5 4');
  await page.route('**/api/action',route=>route.abort());await f.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(f.locator('.form-error')).toContainText('Нет связи');await expect(f.locator('[name=grades]')).toHaveValue('5 4');
  await page.unroute('**/api/action');await f.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.locator('#modal')).not.toBeVisible();
  const state=await page.evaluate(async()=>await (await fetch('/api/state')).json());
  let rev=state.revision;
  const seed=async(type,payload)=>{const response=await page.evaluate(async({type,payload,revision})=>{const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Journal-Request':'1'},body:JSON.stringify({type,payload,revision})});return {ok:r.ok,body:await r.json()};},{type,payload,revision:rev});assert.ok(response.ok,JSON.stringify(response.body));rev=response.body.revision;return response.body;};
  const lessons=state.lessons.filter(l=>l.date.startsWith('2026-09'));for(let i=0;i<30;i++){for(let j=0;j<Math.min(5,lessons.length);j++){if(i===0&&j===0)continue;await seed('record',{lessonId:lessons[j].id,studentId:state.students[i].id,status:(i+j)%17===0?'ill':(i+j)%23===0?'absent':'present',grades:(i+j)%3===0?[3+(i+j)%3]:[]});}}
  await seed('subject',{classId:state.classes[0].id,name:'Русский язык'});
  await page.getByRole('button',{name:'Обновить',exact:true}).click();await expect(page.locator('.mark-cell').nth(1)).toHaveText('П');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,'journal-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Четверть',exact:true}).click();assert.ok(await page.locator('thead button').count()>lessons.length);await page.getByRole('button',{name:'Месяц',exact:true}).click();
  await page.getByRole('button',{name:'Выгрузить',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('link',{name:/Таблица Excel/}).click();await (await download).saveAs(join(output,'journal.xlsx'));
  await page.getByRole('button',{name:/Печать \/ сохранить PDF/}).click();await page.emulateMedia({media:'print'});await page.pdf({path:join(output,'journal.pdf'),preferCSSPageSize:true,printBackground:true});assert.ok(await page.locator('#print-area .print-section').count()>=3);await page.emulateMedia({media:'screen'});
  // Separate authenticated browser session sees the same server data.
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'ru-RU'});const phone=await mobile.newPage();phone.on('pageerror',e=>errors.push(e.message));await phone.goto(origin);await phone.locator('[data-filter=month]').selectOption('2026-09');await phone.getByRole('button',{name:'Один урок',exact:true}).click();await phone.locator('#single-select').selectOption(lessons[0].id);await phone.locator('.student-mark-row').first().click();await phone.locator('#dialog-form [name=grades]').fill('5 5');await phone.locator('#dialog-form').getByRole('button',{name:'Сохранить',exact:true}).click();await expect(phone.locator('#modal')).not.toBeVisible();
  assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile page overflows');await phone.screenshot({path:join(output,'journal-mobile.png'),fullPage:true});
  await phone.setViewportSize({width:360,height:800});assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'360px page overflows');
  await page.getByRole('button',{name:'Обновить',exact:true}).click();await expect(page.locator('.mark-cell').first()).toHaveText(/5\s*5/);
  await phone.getByRole('button',{name:'Календарь',exact:true}).click();await phone.screenshot({path:join(output,'calendar-mobile.png'),fullPage:true});assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await phone.getByRole('button',{name:'Месяц',exact:true}).click();assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.getByRole('button',{name:'Расписание',exact:true}).click();await page.getByRole('button',{name:'Удалить шаблон',exact:true}).click();await page.locator('#dialog-form').getByRole('button',{name:'Удалить шаблон',exact:true}).click();await page.getByRole('button',{name:'Журнал',exact:true}).click();assert.ok(await page.locator('.mark-cell').count()>0,'History should be kept');
  assert.deepEqual(errors,[]);console.log('PASS: onboarding, class, 30 pupils, recurring lessons, grades, topics, persistence, quarter, XLSX/PDF, 2 devices, mobile 360/390px, template deletion.');
  await context.close();await mobile.close();
}finally{await browser.close();if(mf)await mf.dispose();else{await new Promise(r=>server.close(r));store.close();}assert.ok(dir.startsWith(join(tmpdir(),'journal-browser-')));rmSync(dir,{recursive:true,force:true});}
