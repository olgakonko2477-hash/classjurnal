import { Miniflare, cloudOptions } from './miniflare-options.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

test('Hosted Worker: persistent D1, anonymous access, atomic conflicts, restore and XLSX', async () => {
  const directory=mkdtempSync(join(tmpdir(),'journal-cloud-'));
  const config=cloudOptions(directory);
  let mf=new Miniflare(config);
  const origin='https://journal.example.test';
  const req=(path,payload,requestOrigin=origin)=>mf.dispatchFetch(origin+path,payload?{method:'POST',headers:{'Content-Type':'application/json','X-Journal-Request':'1',Origin:requestOrigin},body:JSON.stringify(payload)}:undefined);
  let revision=0;
  const mutate=async(type,payload)=>{const res=await req('/api/action',{type,payload,revision});const result=await res.json();assert.equal(res.status,200,JSON.stringify(result));revision=result.revision;return result;};
  try {
    assert.equal((await req('/health')).status,200);
    assert.equal((await (await req('/api/session')).json()).passwordRequired,false);
    let state=await mutate('year',{name:'2026–2027',start:'2026-09-01',end:'2027-08-31',quarters:[{start:'2026-09-01',end:'2026-10-25'},{start:'2026-11-05',end:'2026-12-28'},{start:'2027-01-09',end:'2027-03-22'},{start:'2027-04-01',end:'2027-05-31'}]});
    const year=state.years[0].id;
    const races=await Promise.all([req('/api/action',{type:'class',payload:{name:'5А',yearId:year},revision}),req('/api/action',{type:'class',payload:{name:'5Б',yearId:year},revision})]);
    assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
    state=await (await req('/api/state')).json();revision=state.revision;assert.equal(state.classes.length,1);
    const classId=state.classes[0].id;
    state=await mutate('subject',{classId,name:'Математика'});
    const journalId=state.journals[0].id;
    state=await mutate('students',{classId,names:['Проверка Облачная'],start:'2026-09-01'});
    const studentId=state.students[0].id;
    state=await mutate('lesson',{journalId,date:'2026-09-21',start:'09:00',end:'09:45',topic:'Дроби',homework:'Задание 5'});
    const lessonId=state.lessons[0].id;
    state=await mutate('record',{lessonId,studentId,status:'present',grades:[5,4]});
    assert.equal((await req('/api/action',{type:'present',payload:{id:lessonId},revision},'https://evil.example')).status,400);
    const backup=await (await req('/api/backup')).json();
    await mf.dispose();mf=new Miniflare(config);
    const persisted=await (await req('/api/state')).json();assert.deepEqual(persisted,state);
    await mutate('student',{id:studentId,name:'Изменённое имя'});
    const restored=await req('/api/restore',{backup,revision});assert.equal(restored.status,200);state=await restored.json();revision=state.revision;assert.equal(state.students[0].name,'Проверка Облачная');
    const snapshots=await (await req('/api/snapshots')).json();assert.equal(snapshots.length,1);const saved=await (await req('/api/snapshot?id='+snapshots[0].id)).json();assert.equal(saved.state.students[0].name,'Изменённое имя');
    const exported=await req('/api/export?'+new URLSearchParams({journalId,start:'2026-09-01',end:'2026-09-30'}));assert.equal(exported.status,200,await exported.clone().text());
    const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await exported.arrayBuffer()));assert.equal(book.getWorksheet('Уроки').getCell('C2').value,'Дроби');assert.ok(book.getWorksheet('Журнал').getSheetValues().flat(2).includes('5 4 П'));
    const html=await (await req('/')).text();assert.ok(html.includes('Классный журнал'));assert.equal((await req('/app.js')).status,200);
  } finally {await mf.dispose();assert.ok(directory.startsWith(join(tmpdir(),'journal-cloud-')));rmSync(directory,{recursive:true,force:true});}
});
