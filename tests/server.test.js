import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

test('Authenticated API, CSRF, stale-write protection, password rotation and session expiry',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'journal-api-'));
  const {server,store}=await createApp({dataDir:dir,password:'test-password-long-enough'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  let cookie='';
  const req=(path,payload,extra={})=>fetch(origin+path,{headers:{Cookie:cookie,...(payload?{'Content-Type':'application/json','X-Journal-Request':'1',Origin:origin}:{}),...extra},...(payload?{method:'POST',body:JSON.stringify(payload)}:{})});
  try{
    assert.equal((await req('/api/state')).status,401);
    assert.equal((await req('/api/backup')).status,401);
    assert.equal((await req('/api/login',{password:'wrong'})).status,401);
    let res=await req('/api/login',{password:'test-password-long-enough'});assert.equal(res.status,200);cookie=res.headers.get('set-cookie').split(';')[0];assert.match(res.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    res=await req('/api/state');assert.equal(res.status,200);const s=await res.json();
    res=await req('/api/action',{type:'class',payload:{name:'5A'},revision:0},{Origin:'https://other.example'});assert.equal(res.status,400);
    const y={name:'2026–2027',start:'2026-09-01',end:'2027-08-31',quarters:[{start:'2026-09-01',end:'2026-10-25'},{start:'2026-11-05',end:'2026-12-28'},{start:'2027-01-09',end:'2027-03-22'},{start:'2027-04-01',end:'2027-05-31'}]};
    res=await req('/api/action',{type:'year',payload:y,revision:s.revision});assert.equal(res.status,200);
    res=await req('/api/action',{type:'year',payload:y,revision:s.revision});assert.equal(res.status,409);
    const backup=await (await req('/api/backup')).json();assert.equal(backup.state.years.length,1);assert.equal(JSON.stringify(backup).includes('password'),false);
    assert.equal((await req('/api/password',{current:'bad',password:'replacement-long-password'})).status,400);
    assert.equal((await req('/api/password',{current:'test-password-long-enough',password:'replacement-long-password'})).status,200);
    assert.equal((await req('/api/state')).status,401);
    assert.equal((await req('/api/login',{password:'test-password-long-enough'})).status,401);
    assert.equal((await req('/api/login',{password:'replacement-long-password'})).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('First-time setup is local, one-time, and not an unauthenticated reset',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'journal-setup-'));const {server,store}=await createApp({dataDir:dir,password:''});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  try{assert.equal((await (await fetch(origin+'/api/session')).json()).needsSetup,true);const setup=()=>fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Journal-Request':'1',Origin:origin},body:JSON.stringify({password:'new-local-password'})});assert.equal((await setup()).status,200);assert.equal((await setup()).status,400);}finally{await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});}
});
