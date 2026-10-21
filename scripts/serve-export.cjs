const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../out');
const base = process.env.NEXT_PUBLIC_BASE_PATH || '/macrotracker';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (base && pathname !== base && !pathname.startsWith(`${base}/`)) { res.writeHead(404); return res.end(); }
  let filename = path.resolve(root, `.${decodeURIComponent(pathname.slice(base.length) || '/')}`);
  if (!filename.startsWith(`${root}/`) && filename !== root) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(filename) && fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
  fs.createReadStream(filename).pipe(res);
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`BlueJay Fuel: http://localhost:${process.env.PORT || 4173}${base}/`));
