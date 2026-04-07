const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const REPORTS_DIR = '/data/workspace/reports';

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function safePath(base, target) {
  const resolved = path.resolve(base, target);
  return resolved.startsWith(path.resolve(base)) ? resolved : null;
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url || '/');

  if (url === '/' || url === '/reports') {
    fs.readdir(REPORTS_DIR, (err, files) => {
      if (err) return send(res, 500, `Failed to read reports: ${err.message}`);
      const items = files
        .map(f => `<li><a href="/reports/${encodeURIComponent(f)}">${f}</a></li>`)
        .join('');
      send(
        res,
        200,
        `<!doctype html><html><body><h1>Reports</h1><ul>${items}</ul></body></html>`,
        'text/html; charset=utf-8'
      );
    });
    return;
  }

  if (url.startsWith('/reports/')) {
    const filename = url.slice('/reports/'.length);
    const full = safePath(REPORTS_DIR, filename);
    if (!full) return send(res, 400, 'Invalid path');

    fs.stat(full, (err, stat) => {
      if (err || !stat.isFile()) return send(res, 404, 'Not found');
      fs.createReadStream(full).pipe(res);
    });
    return;
  }

  send(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Reports server listening on ${PORT}`);
});
