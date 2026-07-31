/*
 * Request handlers, shared by the Vercel serverless functions (/api/*) and the
 * local dev server (dev-server.js). Each returns { status, json } or
 * { status, html }.  The teacher key is checked here, server-side.
 */

'use strict';

const store = require('./store');
const { scoreEssay } = require('./score');

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

// ---- /api/feedback (suggestions & problem reports) -------------------------
//
// Both students (on their finished screen) and the teacher (on the teacher
// panel) can post here — no key required on POST, on purpose, same reasoning
// as /api/submissions: a student needs to be able to report a problem without
// a key. Only reading/clearing the list is teacher-key gated.

async function handleFeedback(method, query, body) {
  if (method === 'GET') {
    if (!isTeacher(query)) return { status: 403, json: { error: 'invalid key' } };
    return { status: 200, json: await store.listFeedback() };
  }
  if (method === 'POST') {
    if (!body || !String(body.message || '').trim()) {
      return { status: 400, json: { error: 'message is required' } };
    }
    const rec = await store.addFeedback(body);
    return { status: 200, json: { ok: true, id: rec.id } };
  }
  if (method === 'DELETE') {
    if (!isTeacher(query)) return { status: 403, json: { error: 'invalid key' } };
    await store.clearFeedback();
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
  const minWords = Number(body && body.minWords) || 250;
  if (!text.trim()) {
    return { status: 200, json: { matches: [], counts: {}, band: scoreEssay('', [], minWords) } };
  }
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
    const band = scoreEssay(text, matches, minWords);
    return { status: 200, json: { matches, counts, total: matches.length, band } };
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
  '<svg width="34" height="34" viewBox="0 0 20 20" fill="none" style="color:#a9b0c4" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="4.5" y="9" width="11" height="8" rx="2" stroke="currentColor" stroke-width="1.5"/>' +
  '<path d="M6.8 9V6.5a3.2 3.2 0 016.4 0V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
  '<h1 style="font-size:1.7rem;margin:0.6rem 0 0">Teacher access only</h1>' +
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
            <div><svg class="ico" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 12.5V3.5M10 3.5L6.5 7M10 3.5l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 13v2a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Drag &amp; drop a chart/image here, or click to choose</div>
            <div class="hint">You can also drop a .txt file to fill the prompt above</div>
            <input type="file" id="file1" accept="image/*,.txt" hidden />
          </div>
          <div class="img-preview" id="preview1"></div>
        </div>

        <div class="task-editor">
          <h3>Task 2 <span class="muted">(40 minutes)</span></h3>
          <textarea id="task2Text" placeholder="Type the Task 2 prompt here…"></textarea>
          <div class="dropzone" id="drop2">
            <div><svg class="ico" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 12.5V3.5M10 3.5L6.5 7M10 3.5l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 13v2a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Drag &amp; drop a chart/image here, or click to choose</div>
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

    <div class="panel">
      <p class="eyebrow gold">Have your say</p>
      <div class="results-toolbar">
        <h2>Suggestions &amp; problems <span class="new-badge">New</span></h2>
        <span class="spacer"></span>
        <button id="fbRefreshBtn" class="btn-ghost">Refresh</button>
        <button id="fbClearBtn" class="btn-danger">Clear all</button>
      </div>
      <p class="sub" style="margin:0 0 1rem">Students can send these too, from their finished screen — anything they report shows up here.</p>
      <form id="fbForm" class="fb-form">
        <textarea id="fbMessage" placeholder="Report a problem or suggest an improvement…" required></textarea>
        <div class="fb-form-row">
          <input id="fbName" type="text" placeholder="Your name (optional)" />
          <button type="submit" class="btn-primary">Send</button>
          <span id="fbStatus" class="status"></span>
        </div>
      </form>
      <div id="fbArea">
        <p class="empty">No suggestions yet.</p>
      </div>
    </div>
  </div>

  <div id="modalRoot"></div>
  <script src="/teacher-app.js"></script>
</body>
</html>`;

module.exports = {
  handleTasks, handleSubmissions, handleFeedback, handleTeacher, handleCheck, respond, TEACHER_KEY,
};
