/* Writing Test Taker — teacher side.
 * Publishes the two tasks and shows a live list of student results.
 */

(function () {
  'use strict';

  var KEY = new URLSearchParams(location.search).get('key') || '';
  var el = function (id) { return document.getElementById(id); };

  // Small inline icon set (replaces emoji as status indicators).
  var ICO_CHECK = '<svg class="ico" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 10.2l2.2 2.2 4.3-4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICO_WARN = '<svg class="ico" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 3.2l7.6 13.2a1 1 0 01-.87 1.5H3.27a1 1 0 01-.87-1.5L10 3.2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8.2v3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="14.3" r="0.9" fill="currentColor"/></svg>';

  // Holds the currently loaded images as data URLs (base64).
  var images = { task1: null, task2: null };

  // ---------- tasks ----------

  function loadTasks() {
    fetch('/api/tasks')
      .then(function (r) { return r.json(); })
      .then(function (t) {
        el('task1Text').value = (t.task1 && t.task1.text) || '';
        el('task2Text').value = (t.task2 && t.task2.text) || '';
        images.task1 = (t.task1 && t.task1.image) || null;
        images.task2 = (t.task2 && t.task2.image) || null;
        renderPreview('task1');
        renderPreview('task2');
      });
  }

  function renderPreview(which) {
    var n = which === 'task1' ? '1' : '2';
    var box = el('preview' + n);
    if (images[which]) {
      box.innerHTML =
        '<img src="' + images[which] + '" alt="Task figure" />' +
        '<div><button class="btn-danger remove" data-remove="' + which + '">Remove image</button></div>';
    } else {
      box.innerHTML = '';
    }
  }

  document.addEventListener('click', function (e) {
    var rm = e.target.getAttribute && e.target.getAttribute('data-remove');
    if (rm) {
      images[rm] = null;
      renderPreview(rm);
      // Apply immediately so the image is really gone for students, not just
      // hidden in the editor until the next Save.
      publish(ICO_CHECK + ' Image removed. Students no longer see it.');
    }
  });

  function handleFile(which, file) {
    if (!file) return;
    if (file.type && file.type.indexOf('image/') === 0) {
      var reader = new FileReader();
      reader.onload = function () {
        images[which] = reader.result; // data URL
        renderPreview(which);
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'text/plain' || /\.txt$/i.test(file.name)) {
      var tr = new FileReader();
      tr.onload = function () {
        el(which + 'Text').value = tr.result;
      };
      tr.readAsText(file);
    } else {
      alert('Please drop an image (chart/diagram) or a .txt file.');
    }
  }

  function wireDropzone(which) {
    var n = which === 'task1' ? '1' : '2';
    var zone = el('drop' + n);
    var input = el('file' + n);
    zone.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      if (input.files[0]) handleFile(which, input.files[0]);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('drag'); });
    });
    zone.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(which, f);
    });
  }
  wireDropzone('task1');
  wireDropzone('task2');

  function publish(okMsg) {
    var status = el('saveStatus');
    status.textContent = 'Saving…';
    status.className = 'status';
    var payload = {
      task1: { text: el('task1Text').value, image: images.task1 },
      task2: { text: el('task2Text').value, image: images.task2 },
    };
    return fetch('/api/tasks?key=' + encodeURIComponent(KEY), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('save failed');
        status.innerHTML = okMsg || (ICO_CHECK + ' Published. Students will see these tasks.');
        status.className = 'status ok';
      })
      .catch(function () {
        status.innerHTML = ICO_WARN + ' Could not save. Check your teacher link/key.';
        status.className = 'status bad';
      });
  }

  el('saveBtn').addEventListener('click', function () { publish(); });

  // ---------- results ----------

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function when(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.toLocaleString();
  }

  // Each result is auto-deleted 24h after it ended (see lib/store.js — kept in
  // sync with SUBMISSION_TTL_MS there). This just renders the countdown; the
  // server does the actual pruning next time the list is loaded.
  var SUBMISSION_TTL_MS = 24 * 60 * 60 * 1000;

  function fmtCountdown(endedAt) {
    if (!endedAt) return '<span class="muted">—</span>';
    var remaining = new Date(endedAt).getTime() + SUBMISSION_TTL_MS - Date.now();
    if (remaining <= 0) return '<span class="muted">Clearing…</span>';
    var h = Math.floor(remaining / 3600000);
    var m = Math.floor((remaining % 3600000) / 60000);
    var text = h > 0 ? (h + 'h ' + m + 'm') : (m + 'm');
    var soon = remaining < 60 * 60 * 1000; // under 1 hour left
    return '<span class="' + (soon ? 'cell-expiring' : 'muted') + '">' + text + '</span>';
  }

  var currentSubs = [];

  function loadResults() {
    fetch('/api/submissions?key=' + encodeURIComponent(KEY))
      .then(function (r) {
        if (!r.ok) throw new Error('forbidden');
        return r.json();
      })
      .then(function (subs) { currentSubs = subs; renderResults(subs); })
      .catch(function () {
        el('resultsArea').innerHTML =
          '<p class="empty">Could not load results — is your teacher key correct?</p>';
      });
  }

  function renderResults(subs) {
    var area = el('resultsArea');
    if (!subs.length) {
      area.innerHTML = '<p class="empty">No submissions yet.</p>';
      return;
    }
    var rows = subs.map(function (s, i) {
      var badge = s.status === 'cheated'
        ? '<span class="badge bad">' + ICO_WARN + ' Cheated</span>'
        : '<span class="badge ok">' + ICO_CHECK + ' Completed</span>';
      var reason = s.status === 'cheated'
        ? esc(s.reason || 'Left the test') + ' <span class="muted">(during ' + esc(prettyPhase(s.phaseWhenEnded)) + ')</span>'
        : '<span class="muted">—</span>';
      return '<tr>' +
        '<td data-label="Student"><b>' + esc(s.lastName) + ', ' + esc(s.firstName) + '</b></td>' +
        '<td data-label="Status">' + badge + '</td>' +
        '<td data-label="Note">' + reason + '</td>' +
        '<td data-label="Words T1/T2">' + s.task1Words + ' / ' + s.task2Words + '</td>' +
        '<td data-label="Finished" class="muted">' + esc(when(s.endedAt)) + '</td>' +
        '<td data-label="Clears in">' + fmtCountdown(s.endedAt) + '</td>' +
        '<td data-label="" class="cell-action"><button class="link-btn" data-view="' + i + '">View essays</button></td>' +
        '</tr>';
    }).join('');

    area.innerHTML =
      '<table class="results"><thead><tr>' +
      '<th>Student</th><th>Status</th><th>Note</th><th>Words T1/T2</th><th>Finished</th><th>Clears in</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function prettyPhase(p) {
    if (p === 'task1') return 'Task 1';
    if (p === 'task2') return 'Task 2';
    return p || 'the test';
  }

  document.addEventListener('click', function (e) {
    var idx = e.target.getAttribute && e.target.getAttribute('data-view');
    if (idx != null) openEssay(currentSubs[Number(idx)]);
  });

  // ---------- suggestions & problems ----------

  function loadFeedback() {
    fetch('/api/feedback?key=' + encodeURIComponent(KEY))
      .then(function (r) {
        if (!r.ok) throw new Error('forbidden');
        return r.json();
      })
      .then(renderFeedback)
      .catch(function () {
        el('fbArea').innerHTML =
          '<p class="empty">Could not load — is your teacher key correct?</p>';
      });
  }

  function renderFeedback(items) {
    var area = el('fbArea');
    if (!items.length) {
      area.innerHTML = '<p class="empty">No suggestions yet.</p>';
      return;
    }
    area.innerHTML = '<ul class="fb-list">' + items.map(function (f) {
      var isTeacher = f.role === 'teacher';
      var who = isTeacher ? 'Teacher' : 'Student';
      var name = f.name ? esc(f.name) : 'Anonymous';
      return '<li class="fb-item">' +
        '<div class="fb-meta"><span class="badge ' + (isTeacher ? 'fb-teacher' : 'fb-student') + '">' + who + '</span>' +
        '<b>' + name + '</b><span class="muted">' + esc(when(f.createdAt)) + '</span></div>' +
        '<p class="fb-msg">' + esc(f.message) + '</p></li>';
    }).join('') + '</ul>';
  }

  el('fbForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = el('fbMessage').value.trim();
    if (!msg) return;
    var status = el('fbStatus');
    status.textContent = 'Sending…';
    status.className = 'status';
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'teacher', name: el('fbName').value.trim(), message: msg }),
    })
      .then(function (r) { if (!r.ok) throw new Error('failed'); })
      .then(function () {
        el('fbMessage').value = '';
        status.innerHTML = ICO_CHECK + ' Sent.';
        status.className = 'status ok';
        loadFeedback();
      })
      .catch(function () {
        status.innerHTML = ICO_WARN + ' Could not send.';
        status.className = 'status bad';
      });
  });

  el('fbRefreshBtn').addEventListener('click', loadFeedback);
  el('fbClearBtn').addEventListener('click', function () {
    if (!confirm('Delete ALL suggestions? This cannot be undone.')) return;
    fetch('/api/feedback?key=' + encodeURIComponent(KEY), { method: 'DELETE' })
      .then(function () { loadFeedback(); });
  });

  // ---- writing checker (teacher-only) --------------------------------------

  var TYPE_LABEL = {
    spelling: 'spelling', grammar: 'grammar',
    punctuation: 'punctuation', style: 'style',
  };

  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

  function plain(text) {
    return text && text.trim() ? esc(text) : '<span class="muted">(empty)</span>';
  }

  // Rebuild the essay with each mistake wrapped in a <mark>.
  function renderMarked(text, matches) {
    if (!text || !text.trim()) return '<span class="muted">(empty)</span>';
    var ms = (matches || []).slice().sort(function (a, b) { return a.offset - b.offset; });
    var out = '', pos = 0;
    ms.forEach(function (m) {
      if (m.offset < pos || m.offset > text.length) return; // skip overlaps
      out += esc(text.slice(pos, m.offset));
      var seg = text.slice(m.offset, m.offset + m.length);
      var tip = m.message || m.short || '';
      if (m.suggestions && m.suggestions.length) tip += '  →  ' + m.suggestions.join(', ');
      out += '<mark class="mk mk-' + m.type + '" title="' + escAttr(tip) + '">' + esc(seg) + '</mark>';
      pos = m.offset + m.length;
    });
    return out + esc(text.slice(pos));
  }

  // A compact correction list under each task (works on touch, where the
  // hover tooltips don't).
  function renderIssues(text, matches) {
    if (!matches || !matches.length) return '';
    var rows = matches.slice().sort(function (a, b) { return a.offset - b.offset; })
      .map(function (m) {
        var seg = text.slice(m.offset, m.offset + m.length).trim();
        var sug = m.suggestions && m.suggestions.length
          ? ' <span class="arrow">→</span> <b>' + esc(m.suggestions.join(', ')) + '</b>' : '';
        return '<li><i class="sw sw-' + m.type + '"></i>' +
          '<span class="q">“' + esc(seg || '…') + '”</span>' + sug +
          '<span class="msg">' + esc(m.short || m.message) + '</span></li>';
      }).join('');
    return '<ul class="issue-list">' + rows + '</ul>';
  }

  function summaryHTML(all) {
    if (!all.length) return '<b>No mistakes found.</b>';
    var c = {};
    all.forEach(function (m) { c[m.type] = (c[m.type] || 0) + 1; });
    var chips = ['spelling', 'grammar', 'punctuation', 'style']
      .filter(function (t) { return c[t]; })
      .map(function (t) {
        return '<span class="chip chip-' + t + '">' + c[t] + ' ' + TYPE_LABEL[t] + '</span>';
      }).join(' ');
    return '<b>' + all.length + ' issue' + (all.length === 1 ? '' : 's') + '</b> ' + chips;
  }

  function checkOne(text, language, min) {
    if (!text || !text.trim()) return Promise.resolve({ matches: [], band: emptyBand() });
    return fetch('/api/check?key=' + encodeURIComponent(KEY), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, language: language, minWords: min }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { return d.error ? { error: d.error, matches: [] } : d; })
      .catch(function () { return { error: 'no connection', matches: [] }; });
  }

  // ---- estimated IELTS band -------------------------------------------------

  function emptyBand() {
    return { words: 0, overall: 0, empty: true,
      criteria: { taskResponse: 0, coherence: 0, lexical: 0, grammar: 0 } };
  }
  function fmtBand(v) { return v ? (Math.round(v * 2) / 2).toFixed(1) : '—'; }
  function combineWriting(a, b) {
    // Overall Writing band: Task 2 counts double, rounded to the nearest 0.5.
    return Math.round(((Number(a) + 2 * Number(b)) / 3) * 2) / 2;
  }
  function bandClass(v) {
    if (v >= 7) return 'good';
    if (v >= 5.5) return 'mid';
    return 'low';
  }

  function scoreCardHTML(b1, b2) {
    b1 = b1 || emptyBand();
    b2 = b2 || emptyBand();
    if (!b1.words && !b2.words) {
      return '<div class="score-card empty">No writing to grade.</div>';
    }
    var c1 = b1.criteria || {}, c2 = b2.criteria || {};
    var overall = combineWriting(b1.overall, b2.overall);
    var crit = [
      ['Task response', combineWriting(c1.taskResponse, c2.taskResponse)],
      ['Coherence & cohesion', combineWriting(c1.coherence, c2.coherence)],
      ['Lexical resource', combineWriting(c1.lexical, c2.lexical)],
      ['Grammar', combineWriting(c1.grammar, c2.grammar)],
    ];
    var rows = crit.map(function (r) {
      var pct = Math.max(0, Math.min(100, (r[1] / 9) * 100));
      return '<div class="score-row"><span class="score-k">' + r[0] + '</span>' +
        '<span class="score-track"><i class="score-bar ' + bandClass(r[1]) +
        '" style="width:' + pct + '%"></i></span>' +
        '<b class="score-v">' + fmtBand(r[1]) + '</b></div>';
    }).join('');
    return '<div class="score-card">' +
      '<div class="score-overall ' + bandClass(overall) + '">' +
      '<span class="score-band">' + fmtBand(overall) + '</span>' +
      '<span class="score-cap">Estimated<br>IELTS band</span></div>' +
      '<div class="score-detail"><div class="score-rows">' + rows + '</div>' +
      '<p class="score-tasks">Task 1 <b>' + fmtBand(b1.overall) + '</b> &middot; Task 2 <b>' +
      fmtBand(b2.overall) + '</b> <span class="muted">(Task 2 counts double)</span></p>' +
      '<p class="score-note">An estimate from length, vocabulary range, linking words and ' +
      'error rate — not an official examiner score.</p></div></div>';
  }

  function runCheck(s) {
    var langSel = el('langSel');
    var lang = langSel ? langSel.value : 'en-US';
    var summary = el('checkSummary');
    if (!summary) return;
    summary.innerHTML = 'Checking writing…';
    summary.className = 'check-summary';
    if (el('scoreRoot')) el('scoreRoot').innerHTML = '<div class="score-card loading">Estimating band…</div>';

    Promise.all([checkOne(s.task1Text, lang, 150), checkOne(s.task2Text, lang, 250)])
      .then(function (res) {
        if (!el('essay1')) return; // modal was closed meanwhile
        var err = (res[0] && res[0].error) || (res[1] && res[1].error);
        if (err) {
          summary.innerHTML = 'Couldn’t check the writing (' + esc(err) + '). The essay is shown unmarked.';
          summary.className = 'check-summary bad';
          el('essay1').innerHTML = plain(s.task1Text);
          el('essay2').innerHTML = plain(s.task2Text);
          el('issues1').innerHTML = '';
          el('issues2').innerHTML = '';
          if (el('scoreRoot')) el('scoreRoot').innerHTML = '';
          return;
        }
        if (el('scoreRoot')) el('scoreRoot').innerHTML = scoreCardHTML(res[0].band, res[1].band);
        el('essay1').innerHTML = renderMarked(s.task1Text, res[0].matches);
        el('essay2').innerHTML = renderMarked(s.task2Text, res[1].matches);
        el('issues1').innerHTML = renderIssues(s.task1Text, res[0].matches);
        el('issues2').innerHTML = renderIssues(s.task2Text, res[1].matches);
        summary.innerHTML = summaryHTML((res[0].matches || []).concat(res[1].matches || []));
        summary.className = 'check-summary';
      });
  }

  function openEssay(s) {
    if (!s) return;
    var root = el('modalRoot');
    root.innerHTML =
      '<div class="modal-back" id="modalBack"><div class="modal">' +
      '<h2>' + esc(s.firstName) + ' ' + esc(s.lastName) + '</h2>' +
      '<p class="muted">' + (s.status === 'cheated'
        ? ICO_WARN + ' Ended early — ' + esc(s.reason || 'left the test')
        : ICO_CHECK + ' Completed') + ' &middot; ' + esc(when(s.endedAt)) + '</p>' +

      '<div id="scoreRoot"></div>' +

      '<div class="check-bar">' +
        '<span id="checkSummary" class="check-summary">Checking writing…</span>' +
        '<span class="spacer"></span>' +
        '<select id="langSel" class="mini-select">' +
          '<option value="en-US">American spelling</option>' +
          '<option value="en-GB">British spelling</option>' +
        '</select>' +
        '<button class="btn-ghost" id="recheckBtn">Re-check</button>' +
      '</div>' +
      '<div class="mark-legend">' +
        '<span><i class="sw sw-spelling"></i>Spelling</span>' +
        '<span><i class="sw sw-grammar"></i>Grammar</span>' +
        '<span><i class="sw sw-punctuation"></i>Punctuation</span>' +
        '<span><i class="sw sw-style"></i>Style</span>' +
      '</div>' +

      '<h3>Task 1 <span class="muted">(' + s.task1Words + ' words)</span></h3>' +
      '<div class="essay-marked" id="essay1"></div>' +
      '<div id="issues1"></div>' +
      '<h3>Task 2 <span class="muted">(' + s.task2Words + ' words)</span></h3>' +
      '<div class="essay-marked" id="essay2"></div>' +
      '<div id="issues2"></div>' +

      '<div class="modal-actions">' +
      '<button class="btn-ghost" id="copyEssay">Copy both</button>' +
      '<button class="btn-primary" id="closeModal">Close</button></div>' +
      '</div></div>';

    // Show the essay immediately; the marks appear when the check returns.
    el('essay1').innerHTML = plain(s.task1Text);
    el('essay2').innerHTML = plain(s.task2Text);

    el('closeModal').addEventListener('click', closeModal);
    el('modalBack').addEventListener('click', function (e) {
      if (e.target.id === 'modalBack') closeModal();
    });
    el('recheckBtn').addEventListener('click', function () { runCheck(s); });
    el('langSel').addEventListener('change', function () { runCheck(s); });
    el('copyEssay').addEventListener('click', function () {
      var text = 'Name: ' + s.firstName + ' ' + s.lastName + '\n\n' +
        '--- TASK 1 (' + s.task1Words + ' words) ---\n' + (s.task1Text || '(empty)') +
        '\n\n--- TASK 2 (' + s.task2Words + ' words) ---\n' + (s.task2Text || '(empty)');
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      el('copyEssay').textContent = 'Copied ✓';
    });

    runCheck(s);
  }
  function closeModal() { el('modalRoot').innerHTML = ''; }

  el('refreshBtn').addEventListener('click', loadResults);
  el('clearBtn').addEventListener('click', function () {
    if (!confirm('Delete ALL student results? This cannot be undone.')) return;
    fetch('/api/submissions?key=' + encodeURIComponent(KEY), { method: 'DELETE' })
      .then(function () { loadResults(); });
  });

  // init
  loadTasks();
  loadResults();
  loadFeedback();
  setInterval(function () { loadResults(); loadFeedback(); }, 5000); // live dashboard
})();
