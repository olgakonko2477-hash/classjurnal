import { Store } from '../lib/store.js';
import { hashPassword } from '../server.js';
import { resolve } from 'node:path';

const password=process.env.JOURNAL_PASSWORD;
if(!password||password.length<12||password.length>256) throw new Error('Задайте JOURNAL_PASSWORD длиной от 12 до 256 символов в .env.');
const store=new Store(resolve(process.env.DATA_DIR||'./data'));
try {store.setMeta('password',await hashPassword(password));console.log('Пароль обновлён. Перезапустите сервер, чтобы завершить старые сеансы.');}
finally {store.close();}
