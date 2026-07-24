/*
 * Rough IELTS-band estimator for a single writing task.
 *
 * IMPORTANT: this has NO understanding of meaning. It cannot tell whether the
 * essay actually answered the question or whether the ideas are any good — the
 * things a real examiner judges most. It only estimates a band from signals we
 * can measure in code:
 *
 *   - length vs. the task minimum          -> Task Response
 *   - linking words + paragraphing         -> Coherence & Cohesion
 *   - vocabulary range + spelling errors   -> Lexical Resource
 *   - grammar-error density + sentence mix -> Grammatical Range & Accuracy
 *
 * The grammar/spelling errors come from the LanguageTool matches we already
 * fetch for the mistake-marking, so scoring is free and adds no extra request.
 * Always shown to users as an *estimate*, never as an official score.
 */

'use strict';

// Common cohesive devices; presence and density hint at Coherence & Cohesion.
const LINKERS = [
  'however', 'therefore', 'moreover', 'furthermore', 'nevertheless', 'nonetheless',
  'although', 'though', 'whereas', 'while', 'because', 'since', 'thus', 'hence',
  'consequently', 'additionally', 'besides', 'meanwhile', 'otherwise',
  'firstly', 'secondly', 'thirdly', 'finally', 'overall', 'in addition',
  'for example', 'for instance', 'on the other hand', 'in conclusion',
  'to conclude', 'as a result', 'in contrast', 'despite', 'in spite of',
  'such as', 'in fact', 'indeed', 'to sum up', 'first of all',
];

function roundHalf(x) { return Math.round(x * 2) / 2; }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function countSentences(text) {
  const parts = text.split(/[.!?]+/).filter(function (s) { return s.trim().length; });
  return Math.max(1, parts.length);
}

function countLinkers(lowerText) {
  let total = 0;
  LINKERS.forEach(function (w) {
    const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    const m = lowerText.match(re);
    if (m) total += m.length;
  });
  return total;
}

// text: the essay, matches: LanguageTool matches (typed), minWords: task target.
// Returns { words, overall, criteria:{ taskResponse, coherence, lexical, grammar } }.
function scoreEssay(text, matches, minWords) {
  text = String(text || '');
  const min = minWords > 0 ? minWords : 250;
  const words = text.trim().match(/\S+/g) || [];
  const n = words.length;

  // A blank (or near-blank) answer can't be graded up — mirror IELTS, where a
  // missing task scores very low. A truly empty task is all-zero (so it doesn't
  // prop up the per-criterion averages); a token attempt floors at band 3.
  if (n < 20) {
    const base = n === 0 ? 0 : 3;
    return {
      words: n, overall: base,
      criteria: { taskResponse: base, coherence: base, lexical: base, grammar: base },
      empty: n === 0,
    };
  }

  matches = matches || [];
  let spelling = 0, grammar = 0;
  matches.forEach(function (m) {
    if (m.type === 'spelling') spelling++;
    else if (m.type === 'grammar') grammar++;
  });
  const per100 = function (c) { return (c / n) * 100; };

  // Vocabulary range: unique word types / total words (type-token ratio).
  const seen = Object.create(null);
  let uniq = 0;
  words.forEach(function (w) {
    const k = w.toLowerCase().replace(/[^a-z']/g, '');
    if (k && !seen[k]) { seen[k] = 1; uniq++; }
  });
  const ttr = uniq / n;

  const sentences = countSentences(text);
  const avgLen = n / sentences;
  const linkers = countLinkers(' ' + text.toLowerCase() + ' ');
  const paras = text.split(/\n\s*\n/).filter(function (p) { return p.trim(); }).length;

  // ---- Task Response: mostly length adequacy (can't judge real relevance). ---
  const ratio = n / min;
  let tr;
  if (ratio >= 1.1) tr = 7;
  else if (ratio >= 1.0) tr = 6.5;
  else if (ratio >= 0.9) tr = 6;
  else if (ratio >= 0.8) tr = 5.5;
  else if (ratio >= 0.65) tr = 5;
  else if (ratio >= 0.5) tr = 4;
  else tr = 3.5;

  // ---- Grammatical Range & Accuracy: grammar-error density + sentence mix. ---
  const ge = per100(grammar);
  let gra;
  if (ge <= 0.5) gra = 7.5;
  else if (ge <= 1.5) gra = 7;
  else if (ge <= 3) gra = 6;
  else if (ge <= 5) gra = 5;
  else if (ge <= 8) gra = 4;
  else gra = 3.5;
  if (avgLen >= 12 && avgLen <= 22) gra += 0.5;         // varied, complex-ish
  else if (avgLen < 7 || avgLen > 32) gra -= 0.5;       // choppy or run-on
  gra = clamp(gra, 3, 8);

  // ---- Lexical Resource: spelling accuracy + vocabulary range. ---------------
  const se = per100(spelling);
  let lr;
  if (se <= 0.5) lr = 7;
  else if (se <= 1.5) lr = 6.5;
  else if (se <= 3) lr = 6;
  else if (se <= 5) lr = 5;
  else if (se <= 8) lr = 4;
  else lr = 3.5;
  if (ttr >= 0.55) lr += 0.5;
  else if (ttr < 0.4) lr -= 0.5;
  lr = clamp(lr, 3, 8);

  // ---- Coherence & Cohesion: linking-word density + paragraphing. -----------
  const lk = per100(linkers);
  let cc;
  if (lk >= 4) cc = 7;
  else if (lk >= 2.5) cc = 6.5;
  else if (lk >= 1.5) cc = 6;
  else if (lk >= 0.8) cc = 5.5;
  else cc = 5;
  if (paras >= 2) cc += 0.5;
  cc = clamp(cc, 3, 8);

  const criteria = {
    taskResponse: roundHalf(tr),
    coherence: roundHalf(cc),
    lexical: roundHalf(lr),
    grammar: roundHalf(gra),
  };
  return {
    words: n,
    overall: roundHalf((tr + cc + lr + gra) / 4),
    criteria: criteria,
  };
}

// Combine two task bands into an overall Writing band. In IELTS, Task 2 counts
// double. Works for a single number (per-criterion) or the overall.
function combineWriting(v1, v2) {
  return roundHalf((Number(v1) + 2 * Number(v2)) / 3);
}

module.exports = { scoreEssay, combineWriting, roundHalf };
