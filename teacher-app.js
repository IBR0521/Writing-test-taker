/* Writing Test Taker — teacher side.
 * Publishes the two tasks and shows a live list of student results.
 */

(function () {
  'use strict';

  var KEY = new URLSearchParams(location.search).get('key') || '';
  var el = function (id) { return document.getElementById(id); };

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
      publish('✅ Image removed. Students no longer see it.');
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
        status.textContent = okMsg || '✅ Published. Students will see these tasks.';
        status.className = 'status ok';
      })
      .catch(function () {
        status.textContent = '⚠️ Could not save. Check your teacher link/key.';
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
        ? '<span class="badge bad">⚠️ Cheated</span>'
        : '<span class="badge ok">✅ Completed</span>';
      var reason = s.status === 'cheated'
        ? esc(s.reason || 'Left the test') + ' <span class="muted">(during ' + esc(prettyPhase(s.phaseWhenEnded)) + ')</span>'
        : '<span class="muted">—</span>';
      return '<tr>' +
        '<td data-label="Student"><b>' + esc(s.lastName) + ', ' + esc(s.firstName) + '</b></td>' +
        '<td data-label="Status">' + badge + '</td>' +
        '<td data-label="Note">' + reason + '</td>' +
        '<td data-label="Words T1/T2">' + s.task1Words + ' / ' + s.task2Words + '</td>' +
        '<td data-label="Finished" class="muted">' + esc(when(s.endedAt)) + '</td>' +
        '<td data-label="" class="cell-action"><button class="link-btn" data-view="' + i + '">View essays</button></td>' +
        '</tr>';
    }).join('');

    area.innerHTML =
      '<table class="results"><thead><tr>' +
      '<th>Student</th><th>Status</th><th>Note</th><th>Words T1/T2</th><th>Finished</th><th></th>' +
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

  function openEssay(s) {
    if (!s) return;
    var root = el('modalRoot');
    root.innerHTML =
      '<div class="modal-back" id="modalBack"><div class="modal">' +
      '<h2>' + esc(s.firstName) + ' ' + esc(s.lastName) + '</h2>' +
      '<p class="muted">' + (s.status === 'cheated'
        ? '⚠️ Ended early — ' + esc(s.reason || 'left the test')
        : '✅ Completed') + ' &middot; ' + esc(when(s.endedAt)) + '</p>' +
      '<h3>Task 1 <span class="muted">(' + s.task1Words + ' words)</span></h3>' +
      '<pre>' + esc(s.task1Text || '(empty)') + '</pre>' +
      '<h3>Task 2 <span class="muted">(' + s.task2Words + ' words)</span></h3>' +
      '<pre>' + esc(s.task2Text || '(empty)') + '</pre>' +
      '<div style="display:flex;gap:0.6rem;justify-content:flex-end">' +
      '<button class="btn-ghost" id="copyEssay">Copy both</button>' +
      '<button class="btn-primary" id="closeModal">Close</button></div>' +
      '</div></div>';

    el('closeModal').addEventListener('click', closeModal);
    el('modalBack').addEventListener('click', function (e) {
      if (e.target.id === 'modalBack') closeModal();
    });
    el('copyEssay').addEventListener('click', function () {
      var text = 'Name: ' + s.firstName + ' ' + s.lastName + '\n\n' +
        '--- TASK 1 (' + s.task1Words + ' words) ---\n' + (s.task1Text || '(empty)') +
        '\n\n--- TASK 2 (' + s.task2Words + ' words) ---\n' + (s.task2Text || '(empty)');
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      el('copyEssay').textContent = 'Copied ✓';
    });
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
  setInterval(loadResults, 5000); // live dashboard
})();
