/*!
 * Chapter Splitter - UI controller
 */
(function (CS) {
  'use strict';
  const P = CS.Parser, R = CS.Reader, X = CS.Exporter;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const PAGE = 300;          // rows rendered at once
  const PLAN_PREVIEW = 200;  // output files listed in preview
  const PREVIEW_CHARS = 150000; // preview modal shows at most this much text of a chapter
  const MAX_FILE_MB = 300;   // hard safety limit (browser memory)
  const WARN_FILE_MB = 60;

  const state = {
    book: null,          // reader result
    result: null,        // {front, chapters, mode}
    chapters: [],        // working list
    front: null,
    epubMode: 'auto',
    splitMode: 'per',
    format: 'txt',
    shown: PAGE,
    search: '',
    detectTimer: null,
    job: null,           // {aborted} token of the running detection
    loadJob: null,       // {aborted} token of the running file load
    file: null,          // last loaded File (re-read when the encoding changes)
    coverUrl: null,      // object URL of the shown cover (revoked on the next load)
    busyExport: false    // a ZIP / multi-file download is running
  };

  /* ------------------------------------------------------------------ *
   * Settings persistence
   * ------------------------------------------------------------------ */
  const SETTINGS_KEY = 'cs-settings-v1';
  const persistIds = ['perFile', 'fileCount', 'template', 'numbering', 'optTitles', 'optFront', 'optHeader', 'optToc', 'optCover', 'optFolder', 'minChars', 'mergeSubtitle', 'blankBefore', 'encoding'];
  function saveSettings() {
    try {
      const s = { splitMode: state.splitMode, format: state.format, patterns: selectedPatterns() };
      persistIds.forEach(id => { const el = $('#' + id); s[id] = el.type === 'checkbox' ? el.checked : el.value; });
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (e) { /* storage unavailable */ }
  }
  function loadSettings() {
    let s;
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { s = null; }
    if (!s) return null;
    persistIds.forEach(id => {
      if (s[id] == null) return;
      const el = $('#' + id);
      if (el.type === 'checkbox') el.checked = !!s[id]; else el.value = s[id];
    });
    if (s.splitMode) setSeg('#splitMode', s.splitMode, v => { state.splitMode = v; showModePanel(v); });
    if (s.format) setSeg('#formatCards', s.format, v => { state.format = v; });
    return s;
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms || 2600);
  }
  const fmtNum = n => n.toLocaleString();
  const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB';
  function setSeg(sel, v, cb) {
    $$(sel + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    if (cb) cb(v);
  }
  function bindSeg(sel, cb) {
    $(sel).addEventListener('click', e => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      setSeg(sel, b.dataset.v, cb);
    });
  }
  function showModePanel(v) { $$('.mode-panel').forEach(p => p.classList.toggle('hidden', p.dataset.mode !== v)); }
  function progress(frac, text) {
    const box = $('#progress');
    if (frac == null) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.querySelector('.bar span').style.width = Math.round(frac * 100) + '%';
    box.querySelector('.ptext').textContent = text || '';
  }
  const tick = () => new Promise(r => setTimeout(r, 0));

  /* Inline SVG icons (presentation only – stroke icons, inherit currentColor) */
  const svg = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICON = {
    eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    mergeUp: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
    scissors: svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>'),
    file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
    download: svg('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/>'),
    check: svg('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>'),
    alert: svg('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>'),
    arrowRight: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>')
  };

  /* ------------------------------------------------------------------ *
   * Patterns UI
   * ------------------------------------------------------------------ */
  function renderPatterns(saved) {
    const list = $('#patternList');
    const chosen = (saved && saved.patterns) || P.DEFAULT_PATTERNS;
    list.innerHTML = Object.entries(P.PATTERNS).map(([k, p]) =>
      '<label><input type="checkbox" value="' + k + '"' + (chosen.includes(k) ? ' checked' : '') + '/>' +
      '<span><b>' + P.escapeHtml(p.label) + '</b><small>' + P.escapeHtml(p.example) + '</small></span>' +
      '<span class="cnt" data-cnt="' + k + '"></span></label>').join('');
  }
  function selectedPatterns() { return $$('#patternList input:checked').map(i => i.value); }

  /** count how many lines each pattern would match (helps the user choose). Runs in time slices. */
  async function updatePatternCounts(text, signal, onProgress) {
    const counts = await P.runTask(P.countPatternsIter(text), { signal, onProgress });
    Object.keys(P.PATTERNS).forEach(k => {
      const n = counts[k] || 0;
      const el = document.querySelector('[data-cnt="' + k + '"]');
      if (el) el.textContent = n ? fmtNum(n) + ' found' : '';
      patternCounts[k] = n;
    });
  }
  const patternCounts = {};

  function textOptions() {
    const custom = $('#customRe').value;
    const err = $('#customReErr');
    const c = P.compileCustom(custom);
    if (c && c.error) { err.textContent = 'Regex error: ' + c.error; err.classList.remove('hidden'); }
    else err.classList.add('hidden');
    return {
      patterns: selectedPatterns(),
      custom: c && c.error ? '' : custom,
      minChars: parseInt($('#minChars').value, 10) || 0,
      mergeSubtitle: $('#mergeSubtitle').checked,
      requireBlankBefore: $('#blankBefore').checked
    };
  }

  /* ------------------------------------------------------------------ *
   * File loading
   * ------------------------------------------------------------------ */
  const UNSUPPORTED = /\.(pdf|docx?|odt|rtf|mobi|azw3?|kfx|fb2|cbz|cbr|rar|7z|png|jpe?g|gif|webp|mp3|mp4|exe)$/i;
  function setStepsVisible(on) { ['#step-chapters', '#step-split'].forEach(s => $(s).classList.toggle('hidden', !on)); }

  async function loadFile(file) {
    const info = $('#fileInfo');
    const mb = (file.size || 0) / 1048576;
    if (UNSUPPORTED.test(file.name || '')) {
      info.classList.remove('hidden');
      info.innerHTML = '<div class="fi-main"><b>' + P.escapeHtml(file.name) + '</b><span class="meta err">This file type is not supported. Please choose an .epub, .txt, .html or .md file (convert PDF / MOBI / DOCX to EPUB first, e.g. with Calibre).</span></div>';
      return;
    }
    if (!file.size) {
      info.classList.remove('hidden');
      info.innerHTML = '<div class="fi-main"><b>' + P.escapeHtml(file.name) + '</b><span class="meta err">This file is empty.</span></div>';
      return;
    }
    if (mb > MAX_FILE_MB) {
      info.classList.remove('hidden');
      info.innerHTML = '<div class="fi-main"><b>' + P.escapeHtml(file.name) + '</b><span class="meta err">File ' + fmtSize(file.size) + ' is too large — browsers can only safely handle files up to ' + MAX_FILE_MB + ' MB.</span></div>';
      return;
    }
    // cancel anything still running for the previous file
    if (state.loadJob) state.loadJob.aborted = true;
    if (state.job) state.job.aborted = true;
    const job = state.loadJob = { aborted: false };
    // free the previous book before reading the new one (keeps peak memory low)
    state.book = null; state.result = null; state.chapters = []; state.front = null;
    state.file = file;
    state.search = ''; $('#search').value = '';
    if (state.coverUrl) { URL.revokeObjectURL(state.coverUrl); state.coverUrl = null; }
    $('#chapterBody').innerHTML = '';
    $('#detectBadge').textContent = 'Loading file…';
    $('#detectHints').innerHTML = '';
    $('#planList').innerHTML = '';
    $('#planSummary').textContent = '';
    $('#downloadZip').disabled = true;
    $('#downloadEach').disabled = true;
    info.classList.remove('hidden');
    info.innerHTML = '<div class="fi-main"><b>' + P.escapeHtml(file.name) + '</b><span class="meta">Reading… ' + fmtSize(file.size || 0) +
      (mb > WARN_FILE_MB ? ' · large file, this may take a moment' : '') + '</span></div><button class="btn ghost small" id="cancelLoad">Cancel</button>';
    $('#cancelLoad').onclick = () => {
      job.aborted = true;
      info.innerHTML = '<div class="fi-main"><b>' + P.escapeHtml(file.name) + '</b><span class="meta">Loading cancelled. Choose a file to start again.</span></div>';
      $('#detectBadge').textContent = '';
      setStepsVisible(false);
    };
    const meta = t => { const m = info.querySelector('.meta'); if (m && !job.aborted) m.textContent = t; };
    try {
      const book = await R.readFile(file, $('#encoding').value, f => meta('Reading… ' + Math.round(f * 100) + '%'), job);
      if (job.aborted) return;
      meta('Scanning headings…');
      const fullText = book.kind === 'text' ? book.text
        : await P.runTask(R.bookTextIter(book), { signal: job, onProgress: f => meta('Extracting text… ' + Math.round(f * 100) + '%') });
      await updatePatternCounts(fullText, job, f => meta('Scanning headings… ' + Math.round(f * 100) + '%'));
      if (job.aborted) return;
      state.book = book;
      showFileInfo(file, book);
      $('#bookTitle').value = book.meta.title || '';
      $('#bookAuthor').value = book.meta.author || '';
      $('#epubOpts').classList.toggle('hidden', book.kind !== 'epub');
      if (book.kind === 'text' && book.isMarkdown && !selectedPatterns().includes('markdown')) {
        const md = $('#patternList input[value="markdown"]'); if (md) md.checked = true;
      }
      setStepsVisible(true);
      $('#step-chapters').scrollIntoView({ behavior: 'smooth', block: 'start' });
      await detect();
    } catch (e) {
      if (e && e.aborted) return;
      console.error(e);
      if (job.aborted) return;
      const msg = isOom(e) ? 'The browser ran out of memory. Close other tabs and try again.' : (e.message || String(e));
      info.innerHTML = '<div class="fi-main"><b>' + P.escapeHtml(file.name) + '</b><span class="meta err">' + P.escapeHtml(msg) + '</span></div>';
      $('#detectBadge').textContent = '';
      setStepsVisible(false);
      toast('Could not read the file: ' + msg, 5000);
    } finally {
      if (state.loadJob === job) state.loadJob = null;
    }
  }
  const isOom = e => e && (e instanceof RangeError || /memory|allocation|Invalid string length|Invalid array length/i.test(e.message || ''));

  function showFileInfo(file, book) {
    const info = $('#fileInfo');
    let cover = '';
    if (book.cover) {
      if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
      const url = state.coverUrl = URL.createObjectURL(new Blob([book.cover.data], { type: book.cover.type }));
      cover = '<img src="' + url + '" alt="Book cover"/>';
    }
    const kind = book.kind === 'epub' ? 'EPUB · ' + book.docs.length + ' sections · TOC: ' + book.toc.length + ' entries'
      : 'Text · ' + (book.encoding || 'utf-8').toUpperCase() + ' · ' + fmtNum(book.text.length) + ' characters';
    info.innerHTML = cover + '<div class="fi-main"><b>' + P.escapeHtml(book.meta.title || file.name) + '</b>' +
      '<span class="meta">' + (book.meta.author ? P.escapeHtml(book.meta.author) + ' · ' : '') + P.escapeHtml(file.name) + ' · ' + fmtSize(file.size || 0) + ' · ' + kind + '</span></div>' +
      '<button class="btn ghost small" id="changeFile">Change file</button>';
    $('#changeFile').onclick = () => $('#fileInput').click();
  }

  /* ------------------------------------------------------------------ *
   * Detection
   * ------------------------------------------------------------------ */
  function scheduleDetect() {
    clearTimeout(state.detectTimer);
    state.detectTimer = setTimeout(detect, 250);
  }

  /** Chapter detection. Runs in small time slices (UI stays responsive); a newer call cancels an older one. */
  async function detect() {
    if (!state.book) return;
    if (state.job) state.job.aborted = true;
    const job = state.job = { aborted: false };
    const book = state.book;
    const t0 = performance.now();
    const badge = $('#detectBadge');
    const busy = f => { badge.textContent = 'Detecting chapters… ' + Math.round(f * 100) + '%'; };
    busy(0);
    document.documentElement.classList.add('busy');
    const textOpts = textOptions();
    let res, chapters;
    try {
      if (book.kind === 'epub') {
        res = await P.runTask(R.epubChaptersIter(book, {
          mode: state.epubMode,
          tocDepth: parseInt($('#tocDepth').value, 10),
          skipExtras: $('#skipExtras').checked,
          text: textOpts
        }), { signal: job, onProgress: f => busy(f * 0.9) });
      } else {
        res = await P.runTask(P.detectTextChaptersIter(book.text, textOpts), { signal: job, onProgress: f => busy(f * 0.9) });
        res.mode = 'text';
      }
      // word counts (also sliced – counting 50 MB of text takes ~1 s)
      chapters = await P.runTask((function* () {
        const out = new Array(res.chapters.length);
        for (let i = 0; i < res.chapters.length; i++) {
          const c = res.chapters[i];
          out[i] = { index: i, title: c.title, origTitle: c.title, text: c.text, html: c.html, num: c.num, words: P.countWords(c.text), selected: true, edited: false };
          yield 0.9 + 0.1 * i / res.chapters.length;
        }
        return out;
      })(), { signal: job, onProgress: busy });
    } catch (e) {
      if (e && e.aborted) return;
      console.error(e);
      if (state.job === job) {
        badge.textContent = 'Error';
        toast(isOom(e) ? 'Out of memory — close other tabs and try again.' : 'Error while detecting chapters: ' + (e.message || e), 5000);
      }
      return;
    } finally {
      if (state.job === job) { state.job = null; document.documentElement.classList.remove('busy'); }
    }
    if (job.aborted || state.book !== book) return;
    state.result = res;
    state.front = res.front;
    state.chapters = chapters;
    // If nothing was detected, treat the whole book as one chapter so the user can still export
    if (!state.chapters.length) {
      const all = book.kind === 'epub' ? R.bookText(book) : book.text;
      if (P.countNonWs(all, 1)) state.chapters = [{ index: 0, title: book.meta.title || 'Full text', origTitle: 'Full text', text: all, words: P.countWords(all), selected: true, edited: false, whole: true }];
    }
    // pattern group is irrelevant for TOC / spine mode
    $('#patternGroup').style.opacity = (state.book.kind === 'epub' && res.mode !== 'text') ? .55 : 1;
    const modeLabel = { toc: 'table of contents', text: 'heading text', spine: 'HTML files' }[res.mode] || res.mode;
    const none = state.chapters.length === 1 && state.chapters[0].whole;
    $('#detectBadge').textContent = (none ? '0 chapters' : fmtNum(state.chapters.length) + ' chapters') +
      (state.book.kind === 'epub' ? ' · via ' + modeLabel : '');
    $('#detectBadge').title = Math.round(performance.now() - t0) + ' ms';
    state.shown = PAGE;
    renderStats();
    renderChapters();
    renderPlan();
    renderHints();
    saveSettings();
  }

  /* ------------------------------------------------------------------ *
   * Friendly result card + one-click fixes (so users never need regex)
   * ------------------------------------------------------------------ */
  const setEpubMode = v => setSeg('#epubMode', v, m => { state.epubMode = m; detect(); });
  const FIXES = {
    numbered: { label: 'Numbered headings (1. / 002)', run: () => setPattern('numbered', true) },
    markdown: { label: '# Markdown headings', run: () => setPattern('markdown', true) },
    part: { label: 'Part / Volume headings', run: () => setPattern('part', true) },
    spine: { label: 'Each HTML file = 1 chapter', run: () => setEpubMode('spine') },
    toc: { label: 'Use the table of contents', run: () => setEpubMode('toc') },
    text: { label: 'Detect from heading text', run: () => setEpubMode('text') },
    mergeShort: { label: 'Auto-merge short chapters', run: () => { const r = $('#minChars'); r.value = Math.min(3000, (parseInt(r.value, 10) || 0) + 600); $('#minCharsOut').textContent = r.value; detect(); } },
    blank: { label: 'Only headings after a blank line', run: () => { $('#blankBefore').checked = true; detect(); } },
    advanced: { label: 'All settings', run: () => { setUiMode('advanced'); const d = $('#detectDetails'); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
    goSplit: { label: 'Download', primary: true, run: () => $('#step-split').scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  };
  function setPattern(k, on) {
    const el = $('#patternList input[value="' + k + '"]');
    if (el) { el.checked = on; detect(); }
  }
  function renderHints() {
    const box = $('#detectHints');
    if (!state.book) { box.innerHTML = ''; return; }
    const ch = state.chapters;
    const none = !ch.length || (ch.length === 1 && ch[0].whole);
    const isEpub = state.book.kind === 'epub';
    const textMode = !isEpub || state.result.mode === 'text';
    const sel = selectedPatterns();
    const cards = [];
    const add = (cls, icon, title, sub, fixes) => cards.push({ cls, icon, title, sub, fixes: fixes.filter(Boolean) });

    if (none) {
      const f = [];
      if (textMode) ['numbered', 'markdown', 'part'].forEach(k => { if (!sel.includes(k) && (patternCounts[k] || 0) >= 2) f.push(k); });
      if (isEpub) { if (state.epubMode !== 'spine') f.push('spine'); if (state.epubMode !== 'text') f.push('text'); }
      f.push('advanced');
      add('warn', ICON.alert, 'No chapters found.', 'Try one of these. Otherwise the whole book becomes one file.', f);
    } else {
      const avg = ch.reduce((a, c) => a + c.words, 0) / ch.length;
      const shortN = ch.filter(c => c.words < avg * 0.15).length;
      const tiny = ch.length >= 3 && shortN / ch.length > 0.2;
      const few = ch.length <= 2 && textMode && ['numbered', 'markdown'].some(k => !sel.includes(k) && (patternCounts[k] || 0) >= 5);
      if (tiny) {
        add('warn', ICON.alert, fmtNum(ch.length) + ' chapters found, ' + shortN + ' look too short.', 'Probably a contents list was picked up. Try:', [
          'mergeShort', isEpub && state.epubMode !== 'toc' && state.book.toc.length ? 'toc' : null, isEpub && state.epubMode !== 'text' ? 'text' : null, textMode && !$('#blankBefore').checked ? 'blank' : null, 'advanced']);
      } else if (few) {
        add('warn', ICON.alert, 'Only ' + ch.length + ' chapter' + (ch.length > 1 ? 's' : '') + ' found.', 'This book may use a different heading style. Try:', ['numbered', 'markdown', 'advanced']);
      } else {
        add('ok', ICON.check, fmtNum(ch.length) + ' chapters found.', 'Untick any you don\'t need, then download.', ['goSplit', 'advanced']);
      }
    }
    box.innerHTML = cards.map(c => '<div class="hint-card ' + c.cls + '"><span class="hi">' + c.icon + '</span><div class="ht"><b>' + P.escapeHtml(c.title) + '</b><small>' + P.escapeHtml(c.sub) + '</small></div>' +
      '<div class="fixes">' + c.fixes.map(k => '<button class="btn small ' + (FIXES[k].primary ? 'primary' : 'ghost') + '" data-fix="' + k + '">' + (k === 'advanced' ? ICON.sliders : '') + FIXES[k].label + (FIXES[k].primary ? ICON.arrowRight : '') + '</button>').join('') + '</div></div>').join('');
  }

  /* Easy / Advanced UI mode */
  function setUiMode(v) {
    document.documentElement.classList.toggle('adv-on', v === 'advanced');
    $$('#uiMode button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    try { localStorage.setItem('cs-ui', v); } catch (e) { /* ignore */ }
    // "custom ranges" is advanced-only; fall back to a simple mode when hidden
    if (v !== 'advanced' && state.splitMode === 'ranges') setSeg('#splitMode', 'per', m => { state.splitMode = m; showModePanel(m); renderPlan(); });
  }

  function renderStats() {
    const ch = state.chapters;
    const words = ch.reduce((a, c) => a + c.words, 0);
    const avg = ch.length ? Math.round(words / ch.length) : 0;
    let shortest = ch.length ? Infinity : 0;
    for (const c of ch) if (c.words < shortest) shortest = c.words;
    $('#stats').innerHTML = [
      [fmtNum(ch.length), 'Chapters'], [fmtNum(words), 'Total words'],
      [fmtNum(avg), 'Avg words / chapter'], [fmtNum(shortest), 'Shortest chapter (words)']
    ].map(([b, s]) => '<div class="stat"><b>' + b + '</b><span>' + s + '</span></div>').join('');
  }

  /* ------------------------------------------------------------------ *
   * Chapter table
   * ------------------------------------------------------------------ */
  function visibleChapters() {
    const q = state.search.trim().toLowerCase();
    return q ? state.chapters.filter(c => c.title.toLowerCase().includes(q)) : state.chapters;
  }

  function renderChapters() {
    const body = $('#chapterBody');
    const list = visibleChapters();
    const avg = state.chapters.length ? state.chapters.reduce((a, c) => a + c.words, 0) / state.chapters.length : 0;
    const rows = list.slice(0, state.shown).map(c => {
      const pos = state.chapters.indexOf(c);
      const short = avg > 0 && c.words < avg * 0.15;
      return '<tr data-i="' + pos + '" class="' + (c.selected ? '' : 'off') + (short ? ' short' : '') + '">' +
        '<td class="c-chk"><input type="checkbox" class="rowchk"' + (c.selected ? ' checked' : '') + '/></td>' +
        '<td class="c-no">' + (pos + 1) + '</td>' +
        '<td><span class="c-title' + (c.edited ? ' edited' : '') + '" contenteditable="plaintext-only" spellcheck="false">' + P.escapeHtml(c.title) + '</span></td>' +
        '<td class="c-words" title="' + (short ? 'Very short chapter – possibly a false detection' : '') + '">' + fmtNum(c.words) + '</td>' +
        '<td class="c-act"><button class="row-btn" data-act="preview" title="Preview" aria-label="Preview">' + ICON.eye + '</button>' +
        (pos > 0 ? '<button class="row-btn" data-act="merge" title="Merge into previous chapter" aria-label="Merge into previous chapter">' + ICON.mergeUp + '</button>' : '') +
        '<button class="row-btn" data-act="split" title="Split this chapter in two (choose where in the preview)" aria-label="Split this chapter">' + ICON.scissors + '</button></td></tr>';
    });
    body.innerHTML = rows.join('');
    const empty = $('#emptyChapters');
    empty.textContent = state.chapters.length ? 'No chapters match “' + state.search.trim() + '”.' : 'No chapters found — try a suggestion above.';
    empty.classList.toggle('hidden', list.length > 0);
    $('#moreRow').classList.toggle('hidden', list.length <= state.shown);
    $('#showMore').textContent = 'Show more (' + fmtNum(list.length - state.shown) + ' remaining)';
    $('#chkAll').checked = state.chapters.length > 0 && state.chapters.every(c => c.selected);
    const fr = $('#frontRow');
    if (state.front && state.front.text && state.front.text.trim()) {
      fr.classList.remove('hidden');
      fr.innerHTML = '<span>' + ICON.file + 'Front matter (before chapter 1): <b>' + fmtNum(P.countWords(state.front.text)) + '</b> words</span><button class="btn ghost small" id="previewFront">Preview</button>';
      $('#previewFront').onclick = () => openPreview(-1);
    } else fr.classList.add('hidden');
  }

  function onTableClick(e) {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const i = +tr.dataset.i, c = state.chapters[i];
    if (e.target.classList.contains('rowchk')) {
      c.selected = e.target.checked;
      tr.classList.toggle('off', !c.selected);
      $('#chkAll').checked = state.chapters.every(x => x.selected);
      renderPlan();
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'preview') openPreview(i);
    if (btn.dataset.act === 'merge') mergeIntoPrevious(i);
    if (btn.dataset.act === 'split') openPreview(i, true);
  }

  function mergeIntoPrevious(i) {
    if (i <= 0) return;
    const prev = state.chapters[i - 1], cur = state.chapters[i];
    prev.text = [prev.text, cur.title, cur.text].filter(Boolean).join('\n\n');
    if (prev.html != null || cur.html != null) prev.html = (prev.html || X.chapterHtml({ text: prev.text })) + '<h3>' + P.escapeHtml(cur.title) + '</h3>' + (cur.html || X.chapterHtml(cur));
    prev.words = P.countWords(prev.text);
    prev.edited = true;
    state.chapters.splice(i, 1);
    reindex();
    toast('“' + cur.title + '” merged into the previous chapter');
  }

  /** blank-line paragraphs or one paragraph per line – decided from the FULL text, same for preview + split */
  const paraMode = text => /\n[^\S\n]*\n/.test(text);

  function splitChapterAt(i, paraIndex) {
    const c = state.chapters[i];
    const paras = P.textToParagraphs(c.text, paraMode(c.text));
    if (paraIndex <= 0 || paraIndex >= paras.length) return;
    const newTitle = paras[paraIndex].length <= 80 ? paras[paraIndex] : c.title + ' (part 2)';
    const restStart = paras[paraIndex].length <= 80 ? paraIndex + 1 : paraIndex;
    const a = Object.assign({}, c, { text: paras.slice(0, paraIndex).join('\n\n'), html: null, edited: true });
    const b = { index: 0, title: newTitle, origTitle: newTitle, text: paras.slice(restStart).join('\n\n'), html: null, selected: c.selected, edited: true };
    a.words = P.countWords(a.text); b.words = P.countWords(b.text);
    state.chapters.splice(i, 1, a, b);
    reindex();
    closePreview();
    toast('Chapter split in two: “' + newTitle + '”');
  }

  function reindex() {
    state.chapters.forEach((c, k) => { c.index = k; });
    renderStats(); renderChapters(); renderPlan();
    $('#detectBadge').textContent = fmtNum(state.chapters.length) + ' chapters (edited)';
  }

  /* ------------------------------------------------------------------ *
   * Preview modal
   * ------------------------------------------------------------------ */
  let previewIndex = 0;
  function openPreview(i, splitMode) {
    previewIndex = i;
    const c = i === -1 ? state.front : state.chapters[i];
    if (!c) return;
    $('#modalTitle').textContent = (i >= 0 ? (i + 1) + '. ' : '') + c.title + (splitMode ? ' — click a paragraph to start a new chapter there' : '');
    // only the start of very long chapters is rendered (keeps the modal fast for 50 MB books);
    // paragraph indices stay identical to splitChapterAt() because the paragraph mode is fixed from the full text
    const big = c.text.length > PREVIEW_CHARS;
    const blankMode = paraMode(c.text);
    const paras = P.textToParagraphs(big ? c.text.slice(0, PREVIEW_CHARS) : c.text, blankMode);
    if (big && paras.length > 1) paras.pop(); // last one may be cut in the middle
    const maxP = 400;
    $('#modalBody').innerHTML = (paras.length ? paras.slice(0, maxP).map((p, k) =>
      '<p data-k="' + k + '"' + (splitMode && k > 0 ? ' class="splittable" title="Start a new chapter here" style="cursor:pointer"' : '') + '>' + P.escapeHtml(p) + '</p>').join('') : '<p><i>(empty)</i></p>') +
      (paras.length > maxP || big ? '<p><i>… more text follows (the preview only shows the beginning)</i></p>' : '');
    $('#modalBody').onclick = splitMode ? (e => {
      const p = e.target.closest('p.splittable');
      if (p && confirm('Start a new chapter at this paragraph?\n\n“' + p.textContent.slice(0, 80) + '”')) splitChapterAt(i, +p.dataset.k);
    }) : null;
    $('#modalPrev').disabled = i <= 0;
    $('#modalNext').disabled = i < 0 || i >= state.chapters.length - 1;
    $('#modal').classList.remove('hidden');
    $('#modalBody').scrollTop = 0;
  }
  function closePreview() { $('#modal').classList.add('hidden'); }

  /* ------------------------------------------------------------------ *
   * Split plan
   * ------------------------------------------------------------------ */
  function currentGroups(selected) {
    const cfg = { mode: state.splitMode, per: $('#perFile').value, files: $('#fileCount').value, ranges: $('#ranges').value };
    return P.makeGroups(selected.length, cfg);
  }

  function exportOptions() {
    return {
      format: state.format,
      template: $('#template').value,
      book: $('#bookTitle').value.trim() || (state.book && state.book.meta.title) || 'Book',
      author: $('#bookAuthor').value.trim(),
      language: (state.book && state.book.meta.language) || 'en',
      includeTitles: $('#optTitles').checked,
      includeFront: $('#optFront').checked,
      includeBookHeader: $('#optHeader').checked,
      includeToc: $('#optToc').checked,
      includeCover: $('#optCover').checked,
      cover: state.book && state.book.cover,
      numbering: $('#numbering').value,
      totalChapters: state.chapters.length, // zero padding is based on the full list (preview == export)
      front: state.front
    };
  }

  function renderPlan() {
    const selected = state.chapters.filter(c => c.selected);
    const { groups, error } = currentGroups(selected);
    const err = $('#planErr');
    if (error) { err.textContent = error; err.classList.remove('hidden'); } else err.classList.add('hidden');
    const o = exportOptions();
    const list = $('#planList');
    // same naming code as the real export -> preview names always match the downloaded files
    const plan = X.planFiles(selected, groups, o);
    const items = plan.slice(0, PLAN_PREVIEW).map(f => {
      let words = 0;
      for (let k = f.a; k <= f.b; k++) words += selected[k].words;
      return '<li><span class="pn" title="' + P.escapeHtml(f.name) + '">' + ICON.file + '<span class="truncate">' + P.escapeHtml(f.name) + '</span></span><span class="pc">' + f.count + ' ch · ' + fmtNum(words) + ' w <button data-g="' + f.g + '" title="Download only this file" aria-label="Download ' + P.escapeHtml(f.name) + '">' + ICON.download + '</button></span></li>';
    });
    if (groups.length > PLAN_PREVIEW) items.push('<li><span class="pc">… and ' + fmtNum(groups.length - PLAN_PREVIEW) + ' more files</span></li>');
    list.innerHTML = items.join('');
    const per = groups.length ? Math.round(selected.length / groups.length) : 0;
    $('#planSummary').textContent = fmtNum(selected.length) + ' chapters → ' + fmtNum(groups.length) + ' file' + (groups.length === 1 ? '' : 's') +
      (groups.length > 1 && state.splitMode !== 'per' ? ' (~' + per + ' per file)' : '');
    const disabled = !groups.length || !!error;
    $('#downloadZip').disabled = disabled;
    $('#downloadEach').disabled = disabled;
    $$('.presets').forEach(pr => {
      const v = $('#' + pr.dataset.target).value;
      pr.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === v));
    });
  }

  /* ------------------------------------------------------------------ *
   * Export
   * ------------------------------------------------------------------ */
  async function build() {
    const selected = state.chapters.filter(c => c.selected);
    const { groups, error } = currentGroups(selected);
    if (error) { toast(error, 3500); return null; }
    if (!groups.length) { toast('Select at least one chapter first.', 3500); return null; }
    if (state.job) { toast('Chapters are still being detected, please wait a moment…'); return null; }
    const o = exportOptions();
    progress(0, 'Creating files…');
    await tick();
    const files = await X.buildFiles(JSZip, selected, groups, o, f => progress(f * 0.7, 'Creating files… ' + Math.round(f * 100) + '%'));
    return { files, o };
  }

  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  async function downloadZip() {
    if (state.busyExport) return;
    state.busyExport = true;
    $('#downloadZip').disabled = true; $('#downloadEach').disabled = true;
    try {
      const r = await build();
      if (!r) return;
      const folder = $('#optFolder').checked ? r.o.book + ' (' + r.o.format.toUpperCase() + ')' : '';
      const blob = await X.zipFiles(JSZip, r.files, folder, f => progress(0.7 + f * 0.3, 'Packing ZIP… ' + Math.round(f * 100) + '%'));
      saveBlob(blob, P.sanitizeFilename(r.o.book + ' - split ' + r.o.format.toUpperCase()) + '.zip');
      progress(1, r.files.length + ' files · ' + fmtSize(blob.size) + ' — download started');
      toast('ZIP ready: ' + r.files.length + ' files');
      saveSettings();
    } catch (e) {
      console.error(e); progress(null);
      toast(isOom(e) ? 'Out of memory. Switch to TXT or use "Download files separately".' : 'Error: ' + (e.message || e), 5000);
    } finally { state.busyExport = false; renderPlan(); }
  }

  async function downloadEach() {
    if (state.busyExport) return;
    state.busyExport = true;
    $('#downloadZip').disabled = true; $('#downloadEach').disabled = true;
    try {
      const r = await build();
      if (!r) { progress(null); return; }
      if (r.files.length > 15 && !confirm(r.files.length + ' files will be downloaded one by one. Your browser may ask for permission. Continue?')) { progress(null); return; }
      for (let i = 0; i < r.files.length; i++) {
        const f = r.files[i];
        saveBlob(new Blob([f.data], { type: f.mime }), f.name);
        progress((i + 1) / r.files.length, 'Downloading ' + (i + 1) + ' / ' + r.files.length);
        await new Promise(res => setTimeout(res, 350));
      }
      progress(1, r.files.length + ' file' + (r.files.length === 1 ? '' : 's') + ' downloaded');
    } catch (e) {
      console.error(e); progress(null);
      toast(isOom(e) ? 'Out of memory — close other tabs and try again.' : 'Error: ' + (e.message || e), 5000);
    } finally { state.busyExport = false; renderPlan(); }
  }

  async function downloadOne(g) {
    if (state.job) { toast('Chapters are still being detected, please wait a moment…'); return; }
    const selected = state.chapters.filter(c => c.selected);
    const { groups, error } = currentGroups(selected);
    if (error) { toast(error, 3500); return; }
    if (!groups[g]) return;
    const o = Object.assign(exportOptions(), { onlyGroup: g });
    try {
      const files = await X.buildFiles(JSZip, selected, groups, o);
      const f = files[0];
      if (f) { saveBlob(new Blob([f.data], { type: f.mime }), f.name); toast('Downloaded ' + f.name); }
    } catch (e) { console.error(e); toast('Error: ' + (e.message || e), 4000); }
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */
  function init() {
    // last line of defence: never leave the user with a silently broken page
    window.addEventListener('error', e => { if (e && e.message && !/ResizeObserver/.test(e.message)) toast(e.message, 5000); });
    window.addEventListener('unhandledrejection', e => {
      const r = e && e.reason; if (r && r.aborted) { e.preventDefault(); return; }
      toast((isOom(r) ? 'Out of memory — close other tabs and try again.' : (r && r.message) || r), 5000);
    });
    const saved = loadSettings();
    renderPatterns(saved);
    $('#minCharsOut').textContent = $('#minChars').value;

    // theme
    $('#themeBtn').onclick = () => {
      const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem('cs-theme', t); } catch (e) { /* ignore */ }
    };

    // upload
    const dz = $('#dropzone'), fi = $('#fileInput');
    fi.addEventListener('change', () => { if (fi.files[0]) loadFile(fi.files[0]); fi.value = ''; });
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
    let dragDepth = 0;
    const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    document.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dz.classList.add('drag'); });
    document.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    document.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dz.classList.remove('drag'); });
    document.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); dragDepth = 0; dz.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    $('#sampleBtn').onclick = () => loadFile(new File([CS.SAMPLE.text], CS.SAMPLE.name, { type: 'text/plain' }));
    $('#encoding').onchange = () => {
      saveSettings();
      if (state.file && state.book && state.book.kind === 'text') { toast('Re-reading the file with the new encoding…'); loadFile(state.file); }
    };

    // detection settings
    bindSeg('#epubMode', v => { state.epubMode = v; detect(); });
    $('#tocDepth').onchange = detect;
    $('#skipExtras').onchange = detect;
    $('#patternList').addEventListener('change', detect);
    $('#customRe').addEventListener('input', scheduleDetect);
    $('#minChars').addEventListener('input', () => { $('#minCharsOut').textContent = $('#minChars').value; scheduleDetect(); });
    $('#mergeSubtitle').onchange = detect;
    $('#blankBefore').onchange = detect;

    // chapter table
    $('#chapterBody').addEventListener('click', onTableClick);
    $('#chapterBody').addEventListener('keydown', e => {
      if (e.target.classList.contains('c-title') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
    $('#chapterBody').addEventListener('focusout', e => {
      if (!e.target.classList.contains('c-title')) return;
      const i = +e.target.closest('tr').dataset.i, c = state.chapters[i];
      const v = e.target.textContent.replace(/\s+/g, ' ').trim();
      if (v && v !== c.title) { c.title = v; c.edited = true; e.target.classList.add('edited'); renderPlan(); }
      else e.target.textContent = c.title;
    });
    $('#search').addEventListener('input', e => { state.search = e.target.value; state.shown = PAGE; renderChapters(); });
    $('#showMore').onclick = () => { state.shown += PAGE; renderChapters(); };
    const setAll = fn => { state.chapters.forEach((c, i) => { c.selected = fn(c, i); }); renderChapters(); renderPlan(); };
    // while searching, the bulk buttons only touch the chapters that match the search
    const setVisible = fn => { const vis = new Set(visibleChapters()); setAll((c, i) => vis.has(c) ? fn(c, i) : c.selected); };
    $('#chkAll').onchange = e => setVisible(() => e.target.checked);
    $('#selAll').onclick = () => setVisible(() => true);
    $('#selNone').onclick = () => setVisible(() => false);
    $('#selInvert').onclick = () => setVisible(c => !c.selected);
    $('#selRange').onclick = () => {
      const a = parseInt($('#rangeFrom').value, 10) || 1, b = parseInt($('#rangeTo').value, 10) || state.chapters.length;
      setAll((c, i) => i + 1 >= Math.min(a, b) && i + 1 <= Math.max(a, b));
      toast('Chapters ' + Math.min(a, b) + '–' + Math.max(a, b) + ' selected');
    };
    $('#resetEdits').onclick = () => { if (confirm('Revert all renames, merges and splits?')) detect(); };

    // modal
    $('#modalClose').onclick = closePreview;
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closePreview(); });
    $('#modalPrev').onclick = () => openPreview(previewIndex - 1);
    $('#modalNext').onclick = () => openPreview(previewIndex + 1);
    document.addEventListener('keydown', e => {
      if (!$('#modal').classList.contains('hidden')) {
        if (e.key === 'Escape') closePreview();
        if (e.key === 'ArrowLeft' && previewIndex > 0) openPreview(previewIndex - 1);
        if (e.key === 'ArrowRight' && previewIndex >= 0 && previewIndex < state.chapters.length - 1) openPreview(previewIndex + 1);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && state.chapters.length && !$('#downloadZip').disabled) { e.preventDefault(); downloadZip(); }
    });

    // split options
    bindSeg('#splitMode', v => { state.splitMode = v; showModePanel(v); renderPlan(); saveSettings(); });
    bindSeg('#formatCards', v => { state.format = v; renderPlan(); saveSettings(); });
    $$('.step-btn').forEach(b => b.onclick = () => {
      const inp = $('#' + b.dataset.target);
      inp.value = Math.max(1, (parseInt(inp.value, 10) || 1) + +b.dataset.step);
      renderPlan(); saveSettings();
    });
    $$('.presets').forEach(pr => pr.addEventListener('click', e => {
      if (e.target.tagName !== 'BUTTON') return;
      $('#' + pr.dataset.target).value = e.target.textContent;
      renderPlan(); saveSettings();
    }));
    ['perFile', 'fileCount', 'ranges', 'template', 'bookTitle', 'bookAuthor'].forEach(id => $('#' + id).addEventListener('input', () => { renderPlan(); saveSettings(); }));
    ['perFile', 'fileCount'].forEach(id => $('#' + id).addEventListener('change', e => {
      const v = parseInt(e.target.value, 10);
      e.target.value = v >= 1 ? v : 1;
      renderPlan(); saveSettings();
    }));
    ['numbering', 'optTitles', 'optFront', 'optHeader', 'optToc', 'optCover', 'optFolder'].forEach(id => $('#' + id).addEventListener('change', () => { renderPlan(); saveSettings(); }));
    $('#tokens').addEventListener('click', e => {
      const t = e.target.dataset.t; if (!t) return;
      const inp = $('#template'), s = inp.selectionStart ?? inp.value.length, en = inp.selectionEnd ?? s;
      inp.value = inp.value.slice(0, s) + t + inp.value.slice(en);
      inp.focus(); inp.setSelectionRange(s + t.length, s + t.length);
      renderPlan(); saveSettings();
    });
    $('#planList').addEventListener('click', e => { const b = e.target.closest('button[data-g]'); if (b) downloadOne(+b.dataset.g); });
    $('#togglePlan').onclick = () => {
      const l = $('#planList'); l.classList.toggle('hidden');
      $('#togglePlan').textContent = l.classList.contains('hidden') ? 'Show list' : 'Hide list';
    };
    $('#detectHints').addEventListener('click', e => { const b = e.target.closest('button[data-fix]'); if (b && FIXES[b.dataset.fix]) FIXES[b.dataset.fix].run(); });
    bindSeg('#uiMode', setUiMode);
    setUiMode(document.documentElement.classList.contains('adv-on') ? 'advanced' : 'simple');
    $('#downloadZip').onclick = downloadZip;
    $('#downloadEach').onclick = downloadEach;
    showModePanel(state.splitMode);
  }

  CS.App = { state, detect, loadFile };
  document.addEventListener('DOMContentLoaded', init);
})(self.CS = self.CS || {});
