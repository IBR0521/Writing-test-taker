/* Writing Test Taker — student side.
 *
 * Flow:  landing (name) -> Task 1 (20m) -> Task 2 (40m) -> finished
 * Cheating (tab switch / leave fullscreen / click away) ends the test at once,
 * flags it as "cheated", and reports it to the teacher automatically.
 */

(function () {
  'use strict';

  var TASK1_SECONDS = 20 * 60;
  var TASK2_SECONDS = 40 * 60;

  var el = function (id) { return document.getElementById(id); };

  // Screens
  var screenLanding = el('screen-landing');
  var screenExam = el('screen-exam');
  var screenFinished = el('screen-finished');

  // Landing
  var firstNameIn = el('firstName');
  var lastNameIn = el('lastName');
  var startBtn = el('startBtn');
  var startHint = el('startHint');

  // Exam
  var taskBadge = el('taskBadge');
  var whoLabel = el('whoLabel');
  var timerEl = el('timer');
  var promptHeading = el('promptHeading');
  var promptText = el('promptText');
  var promptImg = el('promptImg');
  var answerEl = el('answer');
  var wordcountEl = el('wordcount');
  var nextBtn = el('nextBtn');
  var finishBtn = el('finishBtn');

  // State
  var tasks = null;
  var student = { firstName: '', lastName: '' };
  var phase = 'landing';            // 'task1' | 'task2' | 'finished'
  var answers = { task1: '', task2: '' };
  var remaining = 0;
  var tickHandle = null;
  var examActive = false;           // true while we are monitoring for cheating
  var monitoring = false;           // slight delay after start to avoid false triggers
  var ended = false;                // guard so the test can only end once
  var startedAt = 0;
  var minWords = { task1: 150, task2: 250 };

  // ---------- helpers ----------

  function countWords(s) {
    var t = (s || '').trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  }

  function fmt(sec) {
    if (sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function show(screen) {
    [screenLanding, screenExam, screenFinished].forEach(function (s) {
      s.classList.add('hidden');
    });
    screen.classList.remove('hidden');
  }

  // ---------- landing ----------

  function validateNames() {
    var ok = firstNameIn.value.trim() && lastNameIn.value.trim();
    startBtn.disabled = !ok;
    startHint.style.visibility = ok ? 'hidden' : 'visible';
  }
  firstNameIn.addEventListener('input', validateNames);
  lastNameIn.addEventListener('input', validateNames);

  function loadTasks() {
    return fetch('/api/tasks')
      .then(function (r) { return r.json(); })
      .then(function (data) { tasks = data; })
      .catch(function () {
        tasks = { task1: { text: 'Could not load the task. Tell your teacher.', image: null },
                  task2: { text: 'Could not load the task. Tell your teacher.', image: null } };
      });
  }

  startBtn.addEventListener('click', function () {
    if (startBtn.disabled) return;
    student.firstName = firstNameIn.value.trim();
    student.lastName = lastNameIn.value.trim();
    loadTasks().then(startExam);
  });

  // ---------- exam ----------

  function startExam() {
    startedAt = Date.now();
    dismissTip();
    show(screenExam);
    whoLabel.textContent = student.firstName + ' ' + student.lastName;

    // Attempt fullscreen (needs the user gesture we're inside of).
    var root = document.documentElement;
    var req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
    if (req) {
      try {
        var p = req.call(root);
        if (p && p.catch) p.catch(function () {});
      } catch (e) { /* ignore — monitoring below still catches tab switches */ }
    }

    examActive = true;
    ended = false;
    attachGuards();
    // Give the browser a moment to settle into fullscreen before we start
    // treating focus changes as cheating.
    setTimeout(function () { monitoring = true; }, 700);

    beginPhase('task1');
  }

  function beginPhase(which) {
    phase = which;
    var t = tasks[which] || { text: '', image: null };
    taskBadge.textContent = which === 'task1' ? 'Task 1' : 'Task 2';
    promptHeading.textContent = which === 'task1' ? 'Task 1' : 'Task 2';
    promptText.textContent = t.text || '(No task provided by the teacher yet.)';
    if (t.image) {
      promptImg.src = t.image;
      promptImg.classList.remove('hidden');
    } else {
      promptImg.classList.add('hidden');
      promptImg.removeAttribute('src');
    }

    answerEl.value = answers[which] || '';
    answerEl.focus();
    updateWordcount();

    remaining = which === 'task1' ? TASK1_SECONDS : TASK2_SECONDS;
    renderTimer();

    nextBtn.classList.toggle('hidden', which !== 'task1');
    finishBtn.classList.toggle('hidden', which !== 'task2');

    startTicking();
  }

  function startTicking() {
    stopTicking();
    tickHandle = setInterval(function () {
      remaining -= 1;
      renderTimer();
      if (remaining <= 0) {
        stopTicking();
        // Time's up for this phase.
        saveCurrentAnswer();
        if (phase === 'task1') beginPhase('task2');
        else endTest(null); // completed
      }
    }, 1000);
  }
  function stopTicking() {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  }

  function renderTimer() {
    timerEl.textContent = fmt(remaining);
    var low = remaining <= 60;
    timerEl.classList.toggle('low', low);
    var total = phase === 'task1' ? TASK1_SECONDS : TASK2_SECONDS;
    var fill = document.getElementById('timebarFill');
    if (fill) {
      fill.style.width = Math.max(0, Math.min(100, (remaining / total) * 100)) + '%';
      fill.classList.toggle('low', low);
    }
  }

  function saveCurrentAnswer() {
    if (phase === 'task1') answers.task1 = answerEl.value;
    else if (phase === 'task2') answers.task2 = answerEl.value;
  }

  function updateWordcount() {
    var n = countWords(answerEl.value);
    var min = minWords[phase] || 0;
    var cls = n >= min ? 'ok' : 'short';
    wordcountEl.innerHTML =
      '<b>' + n + '</b> words &middot; <span class="' + cls + '">min ' + min + '</span>';
  }

  answerEl.addEventListener('input', function () {
    saveCurrentAnswer();
    updateWordcount();
  });

  nextBtn.addEventListener('click', function () {
    saveCurrentAnswer();
    stopTicking();
    beginPhase('task2');
  });

  finishBtn.addEventListener('click', function () {
    saveCurrentAnswer();
    endTest(null); // completed normally
  });

  // ---------- anti-cheat guards ----------

  var guards = [];
  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    guards.push(function () { target.removeEventListener(type, handler, opts); });
  }

  function attachGuards() {
    // Leaving the tab / minimising / switching apps.
    on(document, 'visibilitychange', function () {
      if (monitoring && document.hidden) cheat('Left the test window (switched tab or app)');
    });
    on(window, 'blur', function () {
      if (monitoring) cheat('Clicked away from the test');
    });
    // Leaving fullscreen.
    on(document, 'fullscreenchange', onFsChange);
    on(document, 'webkitfullscreenchange', onFsChange);

    // Block right-click, copy/cut/paste, drag, and common shortcuts.
    on(document, 'contextmenu', prevent, true);
    on(document, 'copy', prevent, true);
    on(document, 'cut', prevent, true);
    on(document, 'paste', prevent, true);
    on(document, 'dragstart', prevent, true);
    on(document, 'keydown', onKeydown, true);

    // Warn on refresh / close attempts.
    on(window, 'beforeunload', function (e) {
      if (examActive) { e.preventDefault(); e.returnValue = ''; return ''; }
    });
  }

  function detachGuards() {
    guards.forEach(function (off) { off(); });
    guards = [];
  }

  function onFsChange() {
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (monitoring && examActive && !fsEl) {
      cheat('Left fullscreen mode');
    }
  }

  function prevent(e) { e.preventDefault(); e.stopPropagation(); return false; }

  function onKeydown(e) {
    var k = (e.key || '').toLowerCase();
    var meta = e.ctrlKey || e.metaKey;
    // Block copy/paste/cut/print/save/find and dev tools.
    if (meta && ['c', 'v', 'x', 'p', 's', 'u', 'f', 'a'].indexOf(k) !== -1) {
      // allow select-all inside the textarea only
      if (!(k === 'a' && e.target === answerEl)) return prevent(e);
    }
    if (k === 'f12') return prevent(e);
    if (meta && e.shiftKey && ['i', 'j', 'c'].indexOf(k) !== -1) return prevent(e); // devtools
  }

  // ---------- ending the test ----------

  function cheat(reason) {
    endTest(reason);
  }

  function endTest(reason) {
    if (ended) return;
    ended = true;
    examActive = false;
    monitoring = false;
    stopTicking();
    saveCurrentAnswer();
    detachGuards();

    // Leave fullscreen (our own change — guards already detached).
    if (document.fullscreenElement && document.exitFullscreen) {
      try { document.exitFullscreen(); } catch (e) {}
    } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
      try { document.webkitExitFullscreen(); } catch (e) {}
    }

    showFinished(reason);
  }

  // ---------- finished screen ----------

  var lastPayload = null;

  function showFinished(reason) {
    var cheated = !!reason;
    var banner = el('resultBanner');
    var text = el('resultText');
    if (cheated) {
      banner.className = 'result-banner bad';
      banner.querySelector('.emoji').textContent = '⚠️';
      text.innerHTML = '<strong>Exam ended — you left the page.</strong><br>' +
        'Reason: ' + reason + '. Your teacher has been told.';
    } else {
      banner.className = 'result-banner ok';
      banner.querySelector('.emoji').textContent = '✅';
      text.innerHTML = '<strong>Exam complete.</strong> Well done!';
    }

    var w1 = countWords(answers.task1);
    var w2 = countWords(answers.task2);
    el('final1').value = answers.task1 || '';
    el('final2').value = answers.task2 || '';
    el('wc1').textContent = w1 + ' words';
    el('wc2').textContent = w2 + ' words';

    show(screenFinished);

    lastPayload = {
      firstName: student.firstName,
      lastName: student.lastName,
      status: cheated ? 'cheated' : 'completed',
      reason: reason || null,
      phaseWhenEnded: phase,
      task1Text: answers.task1 || '',
      task2Text: answers.task2 || '',
      task1Words: w1,
      task2Words: w2,
      startedAt: startedAt,
    };
    submitToTeacher();
  }

  function submitToTeacher() {
    var status = el('submitStatus');
    var resend = el('resendBtn');
    status.textContent = 'Sending your result to the teacher…';
    status.className = 'submit-status';
    fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lastPayload),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('bad status');
        status.textContent = '✅ Your result was sent to the teacher.';
        status.className = 'submit-status ok';
        resend.classList.add('hidden');
      })
      .catch(function () {
        status.textContent = '⚠️ Could not reach the teacher. Copy your answers and send them on Telegram, then press Resend.';
        status.className = 'submit-status bad';
        resend.classList.remove('hidden');
      });
  }

  el('resendBtn').addEventListener('click', submitToTeacher);

  // ---------- copy buttons ----------

  function copyText(text, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(function () { btn.textContent = old; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); done();
  }

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      copyText(el(btn.getAttribute('data-copy')).value, btn);
    });
  });

  el('copyAllBtn').addEventListener('click', function () {
    var p = lastPayload || {};
    var block =
      'Writing Exam — Submission\n' +
      'Name: ' + student.firstName + ' ' + student.lastName + '\n' +
      'Status: ' + (p.status === 'cheated' ? 'ENDED EARLY (left the page)' : 'Completed') + '\n' +
      '\n--- TASK 1 (' + countWords(answers.task1) + ' words) ---\n' +
      (answers.task1 || '(empty)') +
      '\n\n--- TASK 2 (' + countWords(answers.task2) + ' words) ---\n' +
      (answers.task2 || '(empty)');
    copyText(block, el('copyAllBtn'));
  });

  // ---------- analyze my writing ----------
  //
  // After the exam, the student can press "Analyze my writing" to see the same
  // spelling/grammar/punctuation marks the teacher gets. Uses /api/check
  // (LanguageTool). No teacher key — the endpoint is open for this.

  var TYPE_LABEL = {
    spelling: 'spelling', grammar: 'grammar',
    punctuation: 'punctuation', style: 'style',
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
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

  // A compact correction list (works on touch, where hover tooltips don't).
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
    if (!all.length) return '<b>No mistakes found. Well done!</b>';
    var c = {};
    all.forEach(function (m) { c[m.type] = (c[m.type] || 0) + 1; });
    var chips = ['spelling', 'grammar', 'punctuation', 'style']
      .filter(function (t) { return c[t]; })
      .map(function (t) {
        return '<span class="chip chip-' + t + '">' + c[t] + ' ' + TYPE_LABEL[t] + '</span>';
      }).join(' ');
    return '<b>' + all.length + ' issue' + (all.length === 1 ? '' : 's') + '</b> ' + chips;
  }

  function checkOne(text, language) {
    if (!text || !text.trim()) return Promise.resolve({ matches: [] });
    return fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, language: language }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { return d.error ? { error: d.error, matches: [] } : d; })
      .catch(function () { return { error: 'no connection', matches: [] }; });
  }

  function runAnalyze() {
    var results = el('analyzeResults');
    var summary = el('checkSummary');
    var lang = el('langSel') ? el('langSel').value : 'en-US';
    var t1 = answers.task1 || '';
    var t2 = answers.task2 || '';

    results.classList.remove('hidden');
    el('anWc1').textContent = '(' + countWords(t1) + ' words)';
    el('anWc2').textContent = '(' + countWords(t2) + ' words)';
    // Show the essays right away; marks appear when the check returns.
    el('anEssay1').innerHTML = plain(t1);
    el('anEssay2').innerHTML = plain(t2);
    el('anIssues1').innerHTML = '';
    el('anIssues2').innerHTML = '';
    summary.textContent = 'Checking your writing…';
    summary.className = 'check-summary';

    Promise.all([checkOne(t1, lang), checkOne(t2, lang)]).then(function (res) {
      var err = (res[0] && res[0].error) || (res[1] && res[1].error);
      if (err) {
        summary.innerHTML = 'Couldn’t check the writing (' + esc(err) +
          '). Your essay is shown unmarked — press Re-check to try again.';
        summary.className = 'check-summary bad';
        el('anEssay1').innerHTML = plain(t1);
        el('anEssay2').innerHTML = plain(t2);
        return;
      }
      el('anEssay1').innerHTML = renderMarked(t1, res[0].matches);
      el('anEssay2').innerHTML = renderMarked(t2, res[1].matches);
      el('anIssues1').innerHTML = renderIssues(t1, res[0].matches);
      el('anIssues2').innerHTML = renderIssues(t2, res[1].matches);
      summary.innerHTML = summaryHTML((res[0].matches || []).concat(res[1].matches || []));
      summary.className = 'check-summary';
    });
  }

  el('analyzeBtn').addEventListener('click', runAnalyze);
  el('recheckBtn').addEventListener('click', runAnalyze);
  el('langSel').addEventListener('change', runAnalyze);

  // ---------- one-time "analyze at the end" tip ----------
  //
  // Shown once, the first time a student opens the exam on this device, so they
  // know the feedback exists before they start writing. Remembered in
  // localStorage so it never nags them again.

  var TIP_KEY = 'wtt-analyze-tip-seen';
  var tipTimer = null;

  function tipSeen() {
    try { return localStorage.getItem(TIP_KEY) === '1'; } catch (e) { return false; }
  }

  function showTipOnce() {
    if (tipSeen()) return;
    var tip = el('analyzeTip');
    if (!tip) return;
    tip.classList.remove('hidden');
    try { localStorage.setItem(TIP_KEY, '1'); } catch (e) {} // truly one-time
    tipTimer = setTimeout(dismissTip, 9000);                 // auto-hide
  }

  function dismissTip() {
    var tip = el('analyzeTip');
    if (!tip || tip.classList.contains('hidden')) return;
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    tip.classList.add('leaving');
    setTimeout(function () {
      tip.classList.add('hidden');
      tip.classList.remove('leaving');
    }, 280);
  }

  var tipBtn = el('tipDismiss');
  if (tipBtn) tipBtn.addEventListener('click', dismissTip);

  // init
  validateNames();
  showTipOnce();
})();
