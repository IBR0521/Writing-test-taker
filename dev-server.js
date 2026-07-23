/*
 * LOCAL DEVELOPMENT server only. Not used on Vercel.
 *
 * It serves the static pages and mounts the same handlers the Vercel functions
 * use, so you can run the whole app locally with:
 *
 *     node dev-server.js
 *
 * With no Supabase env vars set it uses a local data/ folder for storage, so
 * you can test everything offline. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * (and TEACHER_KEY) to test against your real Supabase project locally.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  handleTasks,
  handleSubmissions,
  handleTeacher,
  handleCheck,
  respond,
  TEACHER_KEY,
} = require('./lib/handlers');
const store = require('./lib/store');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const STATIC_FILES = new Set([
  '/index.html',
  '/student.js',
  '/teacher-app.js',
  '/styles.css',
]);

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
    });
  });
}

function serveStatic(res, rel) {
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const query = Object.fromEntries(url.searchParams);
  const method = req.method;

  if (p === '/api/tasks') {
    return respond(res, await handleTasks(method, query, await readBody(req)));
  }
  if (p === '/api/submissions') {
    return respond(res, await handleSubmissions(method, query, await readBody(req)));
  }
  if (p === '/api/check') {
    return respond(res, await handleCheck(method, query, await readBody(req)));
  }
  if (p === '/teacher' || p === '/api/teacher') {
    return respond(res, handleTeacher(query));
  }

  // static
  if (method === 'GET') {
    if (p === '/') return serveStatic(res, '/index.html');
    if (STATIC_FILES.has(p)) return serveStatic(res, p);
  }
  res.statusCode = 404;
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('\n  Writing Test Taker (local dev) — storage backend: ' + store.backend);
  console.log('  ------------------------------------------------');
  console.log(`  Student link :  http://localhost:${PORT}/`);
  console.log(`  Teacher link :  http://localhost:${PORT}/teacher?key=${TEACHER_KEY}`);
  console.log('  ------------------------------------------------\n');
});
