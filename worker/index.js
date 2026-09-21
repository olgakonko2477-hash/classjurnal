import { CloudStore } from '../lib/cloud-store.js';
import { check, deletionPreview, localStamp } from '../lib/domain.js';
import { workbook } from '../lib/export.js';
import assets from 'journal:assets';

const initialized = new WeakMap();
async function storeFor(db) {
  check(db, 'Облачная база ещё не подключена. Повторите попытку позже.');
  const store = new CloudStore(db);
  if (!initialized.has(db)) initialized.set(db, store.init().catch(e => { initialized.delete(db); throw e; }));
  await initialized.get(db); return store;
}
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Strict-Transport-Security': 'max-age=31536000'
};
const json = (value, status = 200, extra = {}) => Response.json(value, { status, headers: { ...headers, ...extra } });
async function body(request) {
  check(Number(request.headers.get('Content-Length') || 0) <= 12 * 1024 * 1024, 'Файл слишком большой: максимум 12 МБ.');
  const reader = request.body?.getReader(); check(reader, 'Пустой запрос.');
  const chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 12 * 1024 * 1024) { await reader.cancel(); check(false, 'Файл слишком большой: максимум 12 МБ.'); } chunks.push(value); }
  const buffer = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); } catch { check(false, 'Не удалось прочитать данные запроса.'); }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url), method = request.method;
    try {
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        check(request.headers.get('Origin') === url.origin && request.headers.get('X-Journal-Request') === '1' && request.headers.get('Content-Type')?.startsWith('application/json'), 'Запрос отклонён. Откройте журнал по основному адресу сайта.');
      }
      if (url.pathname === '/api/session' && method === 'GET') return json({ authenticated: true, passwordRequired: false, needsSetup: false, canSetup: false, cloud: true });
      if (url.pathname === '/health' && method === 'GET') { const store = await storeFor(env.DB); await store.db.prepare('SELECT revision FROM journal_meta WHERE id=1').first(); return json({ ok: true, storage: 'cloud' }); }
      if (url.pathname.startsWith('/api/')) {
        const store = await storeFor(env.DB);
        if (url.pathname === '/api/state' && method === 'GET') return json(await store.state());
        if (url.pathname === '/api/action' && method === 'POST') { const p = await body(request); return json(await store.mutate(p.type, p.payload, p.revision)); }
        if (url.pathname === '/api/delete-preview' && method === 'GET') { const s = await store.state(); return json(deletionPreview(s, url.searchParams.get('id'), localStamp(s.timezone))); }
        if (url.pathname === '/api/backup' && method === 'GET') return json(await store.backup(), 200, { 'Content-Disposition': 'attachment; filename="journal-backup.json"' });
        if (url.pathname === '/api/restore' && method === 'POST') { const p = await body(request); return json(await store.restore(p.backup, p.revision)); }
        if (url.pathname === '/api/snapshots' && method === 'GET') return json(await store.snapshots());
        if (url.pathname === '/api/snapshot' && method === 'GET') return json(await store.snapshot(url.searchParams.get('id')), 200, { 'Content-Disposition': 'attachment; filename="journal-before-restore.json"' });
        if (url.pathname === '/api/export' && method === 'GET') { const buffer = await workbook(await store.state(), Object.fromEntries(url.searchParams)); return new Response(buffer, { headers: { ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="journal.xlsx"' } }); }
        return json({ error: 'Страница не найдена.' }, 404);
      }
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { ...headers, 'Content-Type': 'text/plain' } });
      const asset = assets[url.pathname];
      if (!asset || !['GET', 'HEAD'].includes(method)) return json({ error: 'Страница не найдена.' }, 404);
      return new Response(method === 'HEAD' ? null : asset.content, { headers: { ...headers, 'Content-Type': asset.type } });
    } catch (e) { return json({ error: e.status ? e.message : 'Не удалось обработать запрос. Повторите попытку.' }, e.status || 500); }
  }
};
