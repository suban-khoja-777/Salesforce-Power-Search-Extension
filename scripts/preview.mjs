import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const port = Number(process.env.PORT || 4175);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf':'font/ttf' };
http.createServer(async (request, response) => {
    const requested = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (requested === '/' ? '/preview.html' : decodeURIComponent(requested)));
    if (!file.startsWith(root + path.sep) || !mime[path.extname(file)]) { response.writeHead(403).end(); return; }
    try { response.writeHead(200, { 'Content-Type': `${mime[path.extname(file)]}; charset=utf-8` }); response.end(await readFile(file)); }
    catch { response.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Extension UI preview: http://127.0.0.1:${port} (sample metadata)`));
