import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Store } from './lib/store.js';
import { workbook } from './lib/export.js';
import { check, deletionPreview } from './lib/domain.js';

const derive = promisify(scrypt);
const root = dirname(fileURLToPath(import.meta.url));
export async function hashPassword(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${(await derive(password, salt, 64)).toString('hex')}`; }
async function verify(password, stored) { if (!stored || typeof password !== 'string' || password.length > 256) return false; const [salt, key] = stored.split(':'); const actual = await derive(password, salt, 64); return timingSafeEqual(actual, Buffer.from(key, 'hex')); }
const loopback = host => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(host);

export async function createApp(options = {}) {
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || join(root, 'data'));
  const store = new Store(dataDir);
  const passwordRequired = options.passwordRequired ?? (process.env.REQUIRE_PASSWORD === 'true');
  const publicOrigin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN;
  const secure = options.secure ?? (process.env.COOKIE_SECURE === 'true' || !!publicOrigin?.startsWith('https:'));
  if (publicOrigin && !publicOrigin.startsWith('https://')) throw new Error('PUBLIC_ORIGIN должен использовать HTTPS.');
  const password = options.password ?? process.env.JOURNAL_PASSWORD;
  if (passwordRequired && !store.meta('password') && password) { check(password.length >= 12 && password.length <= 256, 'Пароль должен содержать от 12 до 256 символов.'); store.setMeta('password', await hashPassword(password)); }
  if (passwordRequired && publicOrigin && !store.meta('password')) throw new Error('Для размещения задайте JOURNAL_PASSWORD перед первым запуском.');
  const sessions = new Map(), attempts = new Map();
  const cookie = (token, age = 604800) => `journal_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const body = async req => { let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > 12 * 1024 * 1024) throw Object.assign(new Error('Файл слишком большой: максимум 12 МБ.'), { status: 413 }); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { check(false, 'Не удалось прочитать данные запроса.'); } };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const method = req.method;
      const expectedOrigin = publicOrigin || `http://${req.headers.host}`;
      if (!publicOrigin) check(/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || ''), 'Для внешнего доступа настройте адрес сайта PUBLIC_ORIGIN.');
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        check(req.headers.origin === expectedOrigin && req.headers['x-journal-request'] === '1' && req.headers['content-type']?.startsWith('application/json'), 'Запрос отклонён. Откройте журнал по основному адресу сайта.');
      }
      const token = /(?:^|;\s*)journal_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
      const expires = sessions.get(token);
      const authenticated = !passwordRequired || (expires && expires > Date.now());
      const localSetup = !publicOrigin && loopback(req.socket.remoteAddress);
      if (url.pathname === '/health' && method === 'GET') return json(200, { ok: true });
      if (url.pathname === '/api/session' && method === 'GET') return json(200, { authenticated: !!authenticated, passwordRequired, needsSetup: passwordRequired && !store.meta('password'), canSetup: passwordRequired && localSetup });
      if (!passwordRequired && ['/api/login', '/api/setup', '/api/password', '/api/logout'].includes(url.pathname)) return json(404, { error: 'Журнал работает без пароля.' });
      if (['/api/login', '/api/setup'].includes(url.pathname) && method === 'POST') {
        const key = req.socket.remoteAddress;
        let attempt = attempts.get(key); if (!attempt || attempt.until < Date.now()) { attempt = { count: 0, until: Date.now() + 600000 }; attempts.set(key, attempt); }
        if (attempt.count >= 10) return json(429, { error: 'Слишком много попыток. Попробуйте через 10 минут.' });
        const p = await body(req); attempt.count++;
        if (url.pathname === '/api/setup') {
          check(localSetup && !store.meta('password'), 'Первичная настройка доступна только локально.');
          check(typeof p.password === 'string' && p.password.length >= 12 && p.password.length <= 256, 'Пароль должен содержать от 12 до 256 символов.');
          const hash = await hashPassword(p.password);
          check(!store.meta('password'), 'Пароль уже настроен. Войдите в журнал.'); store.setMeta('password', hash);
        } else if (!await verify(p.password, store.meta('password'))) return json(401, { error: 'Неверный пароль.' });
        attempts.delete(key); for (const [t, exp] of sessions) if (exp < Date.now()) sessions.delete(t);
        const session = randomBytes(32).toString('hex'); sessions.set(session, Date.now() + 604800000); res.setHeader('Set-Cookie', cookie(session)); return json(200, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!authenticated) return json(401, { error: 'Войдите в журнал.' });
        if (url.pathname === '/api/logout' && method === 'POST') { sessions.delete(token); res.setHeader('Set-Cookie', cookie('', 0)); return json(200, { ok: true }); }
        if (url.pathname === '/api/state' && method === 'GET') return json(200, store.state());
        if (url.pathname === '/api/action' && method === 'POST') { const p = await body(req); return json(200, store.mutate(p.type, p.payload, p.revision)); }
        if (url.pathname === '/api/delete-preview' && method === 'GET') return json(200, deletionPreview(store.state(), url.searchParams.get('id')));
        if (url.pathname === '/api/backup' && method === 'GET') { res.setHeader('Content-Disposition', 'attachment; filename="journal-backup.json"'); return json(200, store.backup()); }
        if (url.pathname === '/api/restore' && method === 'POST') { const p = await body(req); return json(200, store.restore(p.backup, p.revision)); }
        if (url.pathname === '/api/password' && method === 'POST') { const p = await body(req); check(await verify(p.current, store.meta('password')), 'Текущий пароль неверен.'); check(typeof p.password === 'string' && p.password.length >= 12 && p.password.length <= 256, 'Новый пароль: от 12 до 256 символов.'); store.setMeta('password', await hashPassword(p.password)); sessions.clear(); res.setHeader('Set-Cookie', cookie('', 0)); return json(200, { ok: true }); }
        if (url.pathname === '/api/export' && method === 'GET') {
          const buffer = await workbook(store.state(), Object.fromEntries(url.searchParams));
          res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="journal.xlsx"' }); return res.end(buffer);
        }
        return json(404, { error: 'Страница не найдена.' });
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      const asset = assets[url.pathname];
      if (!asset || !['GET', 'HEAD'].includes(method)) return json(404, { error: 'Страница не найдена.' });
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); res.end(method === 'HEAD' ? undefined : readFileSync(join(root, 'public', asset[0])));
    } catch (e) { if (!res.headersSent) json(e.status || 400, { error: e.status || e.message && !e.code ? e.message : 'Не удалось сохранить данные. Повторите попытку.' }); else res.end(); }
  });
  return { server, store, passwordRequired };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, store, passwordRequired } = await createApp();
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Журнал учителя: ${process.env.PUBLIC_ORIGIN || `http://localhost:${port}`}\nДанные: ${resolve(process.env.DATA_DIR || './data')}\n${!passwordRequired ? 'Прямой вход без пароля.' : store.meta('password') ? 'Вход защищён паролем.' : 'Откройте сайт на этом компьютере и задайте пароль.'}`));
  const stop = () => server.close(() => { store.close(); process.exit(0); }); process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
