/*
 * Request handlers, shared by the Vercel serverless functions (/api/*) and the
 * local dev server (dev-server.js). Each returns { status, json } or
 * { status, html }.  The teacher key is checked here, server-side.
 */

'use strict';

const store = require('./store');

const TEACHER_KEY = process.env.TEACHER_KEY || 'wtt-teacher-4821';

function isTeacher(query) {
  return query && query.key === TEACHER_KEY;
}

// ---- /api/tasks -----------------------------------------------------------

async function handleTasks(method, query, body) {
  if (method === 'GET') {
    return { status: 200, json: await store.getTasks() };
  }
  if (method === 'POST') {
    if (!isTeacher(query)) return { status: 403, json: { error: 'invalid key' } };
    const tasks = await store.saveTasks(body || {});
    return { status: 200, json: { ok: true, tasks } };
  }
  return { status: 405, json: { error: 'method not allowed' } };
}

// ---- /api/submissions -----------------------------------------------------

async function handleSubmissions(method, query, body) {
  if (method === 'GET') {
    if (!isTeacher(query)) return { status: 403, json: { error: 'invalid key' } };
    return { status: 200, json: await store.listSubmissions() };
  }
  if (method === 'POST') {
    // Students post here — no key required on purpose.
    const rec = await store.addSubmission(body || {});
    return { status: 200, json: { ok: true, id: rec.id } };
  }
  if (method === 'DELETE') {
    if (!isTeacher(query)) return { status: 403, json: { error: 'invalid key' } };
    await store.clearSubmissions();
    return { status: 200, json: { ok: true } };
  }
  return { status: 405, json: { error: 'method not allowed' } };
}

// ---- /teacher (key-gated page) --------------------------------------------

function handleTeacher(query) {
  if (!isTeacher(query)) return { status: 403, html: DENIED_HTML };
  return { status: 200, html: TEACHER_HTML };
}

// ---- response helper (works for Vercel res and Node http res) -------------

function respond(res, out) {
  res.statusCode = out.status;
  if (out.html != null) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(out.html);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(out.json));
}

// ---------------------------------------------------------------------------
// HTML for the gated teacher page (served only with a valid key)
// ---------------------------------------------------------------------------

const DENIED_HTML =
  '<!doctype html><meta charset="utf-8"><title>Access denied</title>' +
  '<div style="font-family:system-ui;max-width:34rem;margin:18vh auto;padding:0 1rem;text-align:center">' +
  '<h1 style="font-size:2rem">🔒 Teacher access only</h1>' +
  '<p style="color:#555;font-size:1.05rem">This page is protected. You need the private teacher link ' +
  '(it includes a secret key). If you are a student, go back to the test page.</p></div>';

const TEACHER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Teacher — Writing Test</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="teacher-wrap">
    <h1>👩‍🏫 Teacher panel</h1>
    <p class="sub">Set the writing tasks students will see, and watch who takes the test.</p>

    <div class="panel">
      <h2>Writing tasks</h2>
      <div class="task-grid">
        <div class="task-editor">
          <h3>Task 1 <span class="muted">(20 minutes)</span></h3>
          <textarea id="task1Text" placeholder="Type the Task 1 prompt here…"></textarea>
          <div class="dropzone" id="drop1">
            <div>📎 Drag &amp; drop a chart/image here, or click to choose</div>
            <div class="hint">You can also drop a .txt file to fill the prompt above</div>
            <input type="file" id="file1" accept="image/*,.txt" hidden />
          </div>
          <div class="img-preview" id="preview1"></div>
        </div>

        <div class="task-editor">
          <h3>Task 2 <span class="muted">(40 minutes)</span></h3>
          <textarea id="task2Text" placeholder="Type the Task 2 prompt here…"></textarea>
          <div class="dropzone" id="drop2">
            <div>📎 Drag &amp; drop a chart/image here, or click to choose</div>
            <div class="hint">You can also drop a .txt file to fill the prompt above</div>
            <input type="file" id="file2" accept="image/*,.txt" hidden />
          </div>
          <div class="img-preview" id="preview2"></div>
        </div>
      </div>

      <div class="save-row">
        <button id="saveBtn" class="btn-primary">Save &amp; Publish to students</button>
        <span id="saveStatus" class="status"></span>
      </div>
    </div>

    <div class="panel">
      <div class="results-toolbar">
        <h2 style="margin:0">Student results</h2>
        <span class="spacer"></span>
        <span id="autoNote" class="muted" style="font-size:0.85rem">auto-refreshing…</span>
        <button id="refreshBtn" class="btn-ghost">Refresh</button>
        <button id="clearBtn" class="btn-danger">Clear all</button>
      </div>
      <div id="resultsArea">
        <p class="empty">No submissions yet.</p>
      </div>
    </div>
  </div>

  <div id="modalRoot"></div>
  <script src="/teacher-app.js"></script>
</body>
</html>`;

module.exports = { handleTasks, handleSubmissions, handleTeacher, respond, TEACHER_KEY };
