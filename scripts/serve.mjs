import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/plant-diary(?=\/|$)/, '') || '/';
    if (pathname === '/edit' || pathname === '/edit/') { res.writeHead(302, { Location: '/plant-diary/?edit=1' }); res.end(); return; }
    let target = path.resolve(root, `.${pathname}`);
    if ((target !== root && !target.startsWith(root + path.sep)) || pathname.split('/').some(p => p.startsWith('.')) || ['node_modules', 'tests', 'scripts'].some(p => pathname.split('/').includes(p))) { res.writeHead(403); res.end('Forbidden'); return; }
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(target));
  } catch { res.writeHead(404); res.end('Not found'); }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '0.0.0.0', () => console.log(`Plant Diary development server listening on port ${port}`));
