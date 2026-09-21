import * as runtime from 'miniflare';
export const Miniflare = runtime.Miniflare;
export function cloudOptions(directory) {
  const options = { modules:true, scriptPath:'dist/server/index.js', compatibilityDate:'2026-09-01', compatibilityFlags:['nodejs_compat'], d1Databases:['DB'] };
  return runtime.convertV4MiniflareOptions ? runtime.convertV4MiniflareOptions({ ...options, resourcePersistencePath: directory }) : { ...options, d1Persist: directory };
}
