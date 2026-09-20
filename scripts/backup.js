import { Store } from '../lib/store.js';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const output=process.argv[2];
if(!output) throw new Error('Укажите путь: node --env-file-if-exists=.env scripts/backup.js /path/backup.json');
const store=new Store(resolve(process.env.DATA_DIR||'./data'));
try {
  store.db.exec('BEGIN');
  const backup=store.backup();
  store.db.exec('COMMIT');
  writeFileSync(resolve(output),JSON.stringify(backup,null,2),{mode:0o600,flag:'wx'});
  console.log(`Резервная копия сохранена: ${resolve(output)}`);
} finally {store.close();}
