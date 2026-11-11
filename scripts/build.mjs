import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist);
for (const name of ['index.html', '.nojekyll', 'assets', 'data', 'edit', 'photos', 'CNAME']) {
  const source = path.join(root, name);
  try { await stat(source); } catch { if (['photos', 'CNAME'].includes(name)) continue; throw new Error(`Missing ${name}`); }
  await cp(source, path.join(dist, name), { recursive: true });
}
console.log('Static website assembled in dist/');
