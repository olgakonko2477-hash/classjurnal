import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('.');
const assets = {};
for (const [path, file, type] of [['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/styles.css', 'styles.css', 'text/css'], ['/favicon.svg', 'favicon.svg', 'image/svg+xml']]) assets[path] = { content: await readFile(resolve(root, 'public', file), 'utf8'), type: `${type}; charset=utf-8` };
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await build({
  entryPoints: ['worker/index.js'], outfile: 'dist/server/index.js', bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:crypto'],
  alias: { exceljs: resolve('node_modules/exceljs/dist/exceljs.min.js') },
  plugins: [{ name: 'journal-assets', setup(builder) { builder.onResolve({ filter: /^journal:assets$/ }, () => ({ path: 'assets', namespace: 'journal' })); builder.onLoad({ filter: /.*/, namespace: 'journal' }, () => ({ contents: `export default ${JSON.stringify(assets)}`, loader: 'js' })); } }]
});
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
await writeFile('dist/server/wrangler.json', JSON.stringify({ name: 'classjurnal', main: 'index.js', compatibility_date: '2026-09-01', compatibility_flags: ['nodejs_compat'], d1_databases: [{ binding: 'DB', database_name: 'journal', database_id: '00000000-0000-4000-8000-000000000000' }] }, null, 2));
console.log('Sites build ready: dist/server/index.js + D1 metadata.');
