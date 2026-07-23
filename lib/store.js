/*
 * Storage layer.
 *
 * In production (on Vercel) it talks to Supabase using the SERVICE ROLE key,
 * which is a server-only secret and never reaches the browser.
 *
 * For local development (when the Supabase env vars are not set) it falls back
 * to a small JSON-file store so you can run and test everything with just
 * `node dev-server.js` — no Supabase needed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = !!(SUPABASE_URL && SERVICE_KEY);

// ---------------------------------------------------------------------------
// Shared mapping helpers (DB snake_case  <->  app camelCase)
// ---------------------------------------------------------------------------

function mapTaskRow(r) {
  r = r || {};
  return {
    task1: { text: r.task1_text || '', image: r.task1_image || null },
    task2: { text: r.task2_text || '', image: r.task2_image || null },
    updatedAt: r.updated_at || null,
  };
}

function mapSubRow(r) {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    status: r.status,
    reason: r.reason,
    phaseWhenEnded: r.phase,
    task1Text: r.task1_text,
    task2Text: r.task2_text,
    task1Words: r.task1_words,
    task2Words: r.task2_words,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

// Sanitise an incoming student submission (never trust the client).
function cleanSubmission(body) {
  return {
    first_name: String(body.firstName || '').slice(0, 80),
    last_name: String(body.lastName || '').slice(0, 80),
    status: body.status === 'cheated' ? 'cheated' : 'completed',
    reason: body.reason ? String(body.reason).slice(0, 200) : null,
    phase: String(body.phaseWhenEnded || '').slice(0, 20),
    task1_text: String(body.task1Text || '').slice(0, 40000),
    task2_text: String(body.task2Text || '').slice(0, 40000),
    task1_words: Number(body.task1Words) || 0,
    task2_words: Number(body.task2Words) || 0,
    started_at: body.startedAt ? new Date(Number(body.startedAt)).toISOString() : null,
    ended_at: new Date().toISOString(),
  };
}

function cleanTasks(body) {
  return {
    task1_text: String((body.task1 && body.task1.text) || ''),
    task1_image: (body.task1 && body.task1.image) || null,
    task2_text: String((body.task2 && body.task2.text) || ''),
    task2_image: (body.task2 && body.task2.image) || null,
    updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Supabase (PostgREST) backend
// ---------------------------------------------------------------------------

async function sb(pathAndQuery, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: options.method || 'GET',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const supabaseStore = {
  async getTasks() {
    const rows = await sb('tasks?id=eq.1&select=*');
    return mapTaskRow(rows && rows[0]);
  },
  async saveTasks(body) {
    const row = Object.assign({ id: 1 }, cleanTasks(body));
    await sb('tasks', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    return this.getTasks();
  },
  async listSubmissions() {
    const rows = await sb('submissions?select=*&order=id.desc');
    return (rows || []).map(mapSubRow);
  },
  async addSubmission(body) {
    const rows = await sb('submissions', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(cleanSubmission(body)),
    });
    return rows && rows[0] ? mapSubRow(rows[0]) : { ok: true };
  },
  async clearSubmissions() {
    await sb('submissions?id=gt.0', { method: 'DELETE' });
    return { ok: true };
  },
};

// ---------------------------------------------------------------------------
// Local JSON-file backend (used only when Supabase env vars are absent)
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const SUBS_FILE = path.join(DATA_DIR, 'submissions.json');

function ensureLocal() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TASKS_FILE)) {
    fs.writeFileSync(
      TASKS_FILE,
      JSON.stringify({
        task1_text:
          'TASK 1 (recommended 20 minutes)\n\nThe teacher can replace this prompt on the teacher page.',
        task1_image: null,
        task2_text:
          'TASK 2 (recommended 40 minutes)\n\nThe teacher can replace this prompt on the teacher page.',
        task2_image: null,
        updated_at: new Date().toISOString(),
      })
    );
  }
  if (!fs.existsSync(SUBS_FILE)) fs.writeFileSync(SUBS_FILE, '[]');
}

function readLocal(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}
function writeLocal(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

let localSeq = Date.now();

const localStore = {
  async getTasks() { ensureLocal(); return mapTaskRow(readLocal(TASKS_FILE)); },
  async saveTasks(body) {
    ensureLocal();
    writeLocal(TASKS_FILE, Object.assign({ id: 1 }, cleanTasks(body)));
    return this.getTasks();
  },
  async listSubmissions() {
    ensureLocal();
    return (readLocal(SUBS_FILE) || []).map(mapSubRow);
  },
  async addSubmission(body) {
    ensureLocal();
    const rows = readLocal(SUBS_FILE) || [];
    const row = Object.assign({ id: ++localSeq }, cleanSubmission(body));
    rows.unshift(row);
    writeLocal(SUBS_FILE, rows);
    return mapSubRow(row);
  },
  async clearSubmissions() { ensureLocal(); writeLocal(SUBS_FILE, []); return { ok: true }; },
};

module.exports = useSupabase ? supabaseStore : localStore;
module.exports.backend = useSupabase ? 'supabase' : 'local-file';
