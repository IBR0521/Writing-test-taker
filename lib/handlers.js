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

// ---- /api/check (writing checker) ------------------------------------------
//
// Proxies the essay to LanguageTool's public API and returns the mistakes it
// finds, so both the teacher's "View essays" view and the student's own
// "Analyze my writing" button (on the finished screen) can underline them.
// Not key-gated: students need to reach it to review their own work after they
// submit. There is no way to call it usefully during the exam — the exam page
// has no checker UI and paste is blocked. Note this sends the essay text to
// languagetool.org — see the README.

const LT_ENDPOINT = 'https://api.languagetool.org/v2/check';
const LT_MAX_CHARS = 19000; // the free API caps request text at 20 KB

function classifyMatch(m) {
  const rule = m.rule || {};
  const issue = rule.issueType || '';
  const cat = (rule.category && rule.category.id) || '';
  if (issue === 'misspelling' || cat === 'TYPOS') return 'spelling';
  if (cat === 'GRAMMAR' || issue === 'grammar') return 'grammar';
  if (cat === 'PUNCTUATION' || cat === 'TYPOGRAPHY' || issue === 'typographical') return 'punctuation';
  return 'style';
}

async function handleCheck(method, query, body) {
  if (method !== 'POST') return { status: 405, json: { error: 'method not allowed' } };

  let text = String((body && body.text) || '');
  const language = (body && body.language) === 'en-GB' ? 'en-GB' : 'en-US';
  if (!text.trim()) return { status: 200, json: { matches: [], counts: {} } };
  if (text.length > LT_MAX_CHARS) text = text.slice(0, LT_MAX_CHARS);

  try {
    const params = new URLSearchParams({ text, language, level: 'default' });
    const res = await fetch(LT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) {
      return { status: 502, json: { error: 'checker unavailable (' + res.status + ')' } };
    }
    const data = await res.json();
    const matches = (data.matches || []).map(function (m) {
      return {
        offset: m.offset,
        length: m.length,
        message: m.message || '',
        short: m.shortMessage || '',
        type: classifyMatch(m),
        suggestions: (m.replacements || []).slice(0, 3).map(function (r) { return r.value; }),
      };
    });
    const counts = matches.reduce(function (acc, m) {
      acc[m.type] = (acc[m.type] || 0) + 1;
      return acc;
    }, {});
    return { status: 200, json: { matches, counts, total: matches.length } };
  } catch (e) {
    return { status: 502, json: { error: 'checker unavailable: ' + (e.message || e) } };
  }
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
  <title>Invigilator — Writing Exam</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="teacher-wrap">
    <header class="teacher-head">
      <p class="eyebrow">Invigilator's desk</p>
      <h1 class="display">Teacher panel</h1>
      <p class="sub">Set the exam paper students sit, and watch the register fill in live.</p>
    </header>

    <div class="panel">
      <p class="eyebrow gold">Set the paper</p>
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
      <p class="eyebrow gold">Live register</p>
      <div class="results-toolbar">
        <h2>Student results</h2>
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

module.exports = { handleTasks, handleSubmissions, handleTeacher, handleCheck, respond, TEACHER_KEY };
