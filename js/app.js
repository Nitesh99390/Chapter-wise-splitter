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
    loadJob: null        // {aborted} token of the running file load
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
  async function loadFile(file) {
    const info = $('#fileInfo');
    const mb = (file.size || 0) / 1048576;
    if (mb > MAX_FILE_MB) {
      info.classList.remove('hidden');
      info.innerHTML = '<div class="fi-main"><b>❌ ' + P.escapeHtml(file.name) + '</b><span class="meta err">File ' + fmtSize(file.size) + ' ki hai — browser me ' + MAX_FILE_MB + ' MB tak ki file hi safely chal sakti hai.</span></div>';
      return;
    }
    // cancel anything still running for the previous file
    if (state.loadJob) state.loadJob.aborted = true;
    if (state.job) state.job.aborted = true;
    const job = state.loadJob = { aborted: false };
    // free the previous book before reading the new one (keeps peak memory low)
    state.book = null; state.result = null; state.chapters = []; state.front = null;
    $('#chapterBody').innerHTML = '';
    $('#detectBadge').textContent = '⏳ File load ho rahi hai…';
    $('#detectHints').innerHTML = '';
    $('#planList').innerHTML = '';
    $('#planSummary').textContent = '';
    $('#downloadZip').disabled = true;
    $('#downloadEach').disabled = true;
    info.classList.remove('hidden');
    info.innerHTML = '<div class="fi-main"><b>⏳ ' + P.escapeHtml(file.name) + '</b><span class="meta">Reading… ' + fmtSize(file.size || 0) +
      (mb > WARN_FILE_MB ? ' · badi file hai, thoda time lagega' : '') + '</span></div><button class="btn ghost small" id="cancelLoad">Cancel</button>';
    $('#cancelLoad').onclick = () => { job.aborted = true; info.querySelector('.meta').textContent = 'Cancelled'; };
    const meta = t => { const m = info.querySelector('.meta'); if (m && !job.aborted) m.textContent = t; };
    try {
      const book = await R.readFile(file, $('#encoding').value, f => meta('Reading… ' + Math.round(f * 100) + '%'), job);
      if (job.aborted) return;
      meta('Headings scan ho rahi hain…');
      const fullText = book.kind === 'text' ? book.text
        : await P.runTask(R.bookTextIter(book), { signal: job, onProgress: f => meta('Text nikal rahe hain… ' + Math.round(f * 100) + '%') });
      await updatePatternCounts(fullText, job, f => meta('Headings scan ho rahi hain… ' + Math.round(f * 100) + '%'));
      if (job.aborted) return;
      state.book = book;
      showFileInfo(file, book);
      $('#bookTitle').value = book.meta.title || '';
      $('#bookAuthor').value = book.meta.author || '';
      $('#epubOpts').classList.toggle('hidden', book.kind !== 'epub');
      if (book.kind === 'text' && book.isMarkdown && !selectedPatterns().includes('markdown')) {
        const md = $('#patternList input[value="markdown"]'); if (md) md.checked = true;
      }
      ['#step-chapters', '#step-split'].forEach(s => $(s).classList.remove('hidden'));
      $('#step-chapters').scrollIntoView({ behavior: 'smooth', block: 'start' });
      await detect();
    } catch (e) {
      if (e && e.aborted) return;
      console.error(e);
      if (job.aborted) return;
      const msg = isOom(e) ? 'Browser ki memory kam pad gayi. Doosre tabs band karke dobara try karein.' : (e.message || String(e));
      info.innerHTML = '<div class="fi-main"><b>❌ ' + P.escapeHtml(file.name) + '</b><span class="meta err">' + P.escapeHtml(msg) + '</span></div>';
      toast('File read nahi ho payi: ' + msg, 5000);
    } finally {
      if (state.loadJob === job) state.loadJob = null;
    }
  }
  const isOom = e => e && (e instanceof RangeError || /memory|allocation|Invalid string length|Invalid array length/i.test(e.message || ''));

  function showFileInfo(file, book) {
    const info = $('#fileInfo');
    let cover = '';
    if (book.cover) {
      const url = URL.createObjectURL(new Blob([book.cover.data], { type: book.cover.type }));
      cover = '<img src="' + url + '" alt="cover"/>';
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
    const busy = f => { badge.textContent = '⏳ Chapters dhoondh rahe hain… ' + Math.round(f * 100) + '%'; };
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
        badge.textContent = '⚠ Error';
        toast(isOom(e) ? 'Memory kam pad gayi — doosre tabs band karke dobara try karein.' : 'Chapters detect karte waqt error: ' + (e.message || e), 5000);
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
    const modeLabel = { toc: 'book ki index (TOC)', text: 'heading text', spine: 'HTML files' }[res.mode] || res.mode;
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
    numbered: { label: '🔢 Numbers wale headings (1. / 002)', run: () => setPattern('numbered', true) },
    markdown: { label: '# Markdown headings', run: () => setPattern('markdown', true) },
    part: { label: 'Part / Volume headings', run: () => setPattern('part', true) },
    spine: { label: '📄 Har HTML file = 1 chapter', run: () => setEpubMode('spine') },
    toc: { label: '📑 Book ki index (TOC) se lein', run: () => setEpubMode('toc') },
    text: { label: '🔤 Heading text se dhoondhein', run: () => setEpubMode('text') },
    mergeShort: { label: '🧹 Chhote chapters auto-merge karein', run: () => { const r = $('#minChars'); r.value = Math.min(3000, (parseInt(r.value, 10) || 0) + 600); $('#minCharsOut').textContent = r.value; detect(); } },
    blank: { label: 'Sirf khali line ke baad wali headings', run: () => { $('#blankBefore').checked = true; detect(); } },
    advanced: { label: '⚙️ Saari settings dikhayein', run: () => { setUiMode('advanced'); const d = $('#detectDetails'); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
    goSplit: { label: '✅ Sab sahi hai → Download pe chalein', primary: true, run: () => $('#step-split').scrollIntoView({ behavior: 'smooth', block: 'start' }) }
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
      add('warn', '😕', 'Koi chapter nahi mila.', 'Ghabrayein nahi — neeche ek button dabakar dobara try karein. Kuch nahi hua to poori book ek hi file me download ho jayegi.', f);
    } else {
      const avg = ch.reduce((a, c) => a + c.words, 0) / ch.length;
      const shortN = ch.filter(c => c.words < avg * 0.15).length;
      const tiny = ch.length >= 3 && shortN / ch.length > 0.2;
      const few = ch.length <= 2 && textMode && ['numbered', 'markdown'].some(k => !sel.includes(k) && (patternCounts[k] || 0) >= 5);
      if (tiny) {
        add('warn', '🤔', fmtNum(ch.length) + ' chapters mile, par ' + shortN + ' bahut chhote hain.', 'Shayad contents list ya galat headings chapter ban gaye. Ye try karein:', [
          'mergeShort', isEpub && state.epubMode !== 'toc' && state.book.toc.length ? 'toc' : null, isEpub && state.epubMode !== 'text' ? 'text' : null, textMode && !$('#blankBefore').checked ? 'blank' : null, 'advanced']);
      } else if (few) {
        add('warn', '🤔', 'Sirf ' + ch.length + ' chapter' + (ch.length > 1 ? 's' : '') + ' mila.', 'Lagta hai is file me headings alag style ki hain. Ye try karein:', ['numbered', 'markdown', 'advanced']);
      } else {
        add('ok', '🎉', fmtNum(ch.length) + ' chapters mil gaye!', 'Neeche list ek baar dekh lein. Jo chapter nahi chahiye uska ✓ hata dein. Sab theek lage to seedha download pe chalein.', ['goSplit', 'advanced']);
      }
    }
    box.innerHTML = cards.map(c => '<div class="hint-card ' + c.cls + '"><span class="hi">' + c.icon + '</span><div class="ht"><b>' + P.escapeHtml(c.title) + '</b><small>' + P.escapeHtml(c.sub) + '</small></div>' +
      '<div class="fixes">' + c.fixes.map(k => '<button class="btn small ' + (FIXES[k].primary ? 'primary' : 'ghost') + '" data-fix="' + k + '">' + FIXES[k].label + '</button>').join('') + '</div></div>').join('');
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
        '<td class="c-words" title="' + (short ? 'Bahut chhota chapter – shayad galat detection' : '') + '">' + fmtNum(c.words) + '</td>' +
        '<td class="c-act"><button class="row-btn" data-act="preview" title="Preview">👁</button>' +
        (pos > 0 ? '<button class="row-btn" data-act="merge" title="Merge into previous chapter">⤒</button>' : '') +
        '<button class="row-btn" data-act="split" title="Isi chapter ko yahan se 2 me todein (preview me)">✂</button></td></tr>';
    });
    body.innerHTML = rows.join('');
    $('#emptyChapters').classList.toggle('hidden', state.chapters.length > 0);
    $('#moreRow').classList.toggle('hidden', list.length <= state.shown);
    $('#showMore').textContent = 'Show more (' + fmtNum(list.length - state.shown) + ' remaining)';
    $('#chkAll').checked = state.chapters.length > 0 && state.chapters.every(c => c.selected);
    const fr = $('#frontRow');
    if (state.front && state.front.text && state.front.text.trim()) {
      fr.classList.remove('hidden');
      fr.innerHTML = '<span>📄 Front matter (pehle chapter se pehle ka text): <b>' + fmtNum(P.countWords(state.front.text)) + '</b> words</span><button class="btn ghost small" id="previewFront">Preview</button>';
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
    toast('“' + cur.title + '” ko pichhle chapter me merge kar diya');
  }

  function splitChapterAt(i, paraIndex) {
    const c = state.chapters[i];
    const paras = P.textToParagraphs(c.text);
    if (paraIndex <= 0 || paraIndex >= paras.length) return;
    const newTitle = paras[paraIndex].length <= 80 ? paras[paraIndex] : c.title + ' (part 2)';
    const restStart = paras[paraIndex].length <= 80 ? paraIndex + 1 : paraIndex;
    const a = Object.assign({}, c, { text: paras.slice(0, paraIndex).join('\n\n'), html: null, edited: true });
    const b = { index: 0, title: newTitle, origTitle: newTitle, text: paras.slice(restStart).join('\n\n'), html: null, selected: c.selected, edited: true };
    a.words = P.countWords(a.text); b.words = P.countWords(b.text);
    state.chapters.splice(i, 1, a, b);
    reindex();
    closePreview();
    toast('Chapter 2 hisso me toot gaya: “' + newTitle + '”');
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
    $('#modalTitle').textContent = (i >= 0 ? (i + 1) + '. ' : '') + c.title + (splitMode ? ' — split karne ke liye paragraph pe click karein' : '');
    // only the start of very long chapters is rendered (keeps the modal fast for 50 MB books);
    // paragraph indices stay identical to splitChapterAt() because the paragraph mode is fixed from the full text
    const big = c.text.length > PREVIEW_CHARS;
    const blankMode = /\n[^\S\n]*\n/.test(big ? c.text.slice(0, PREVIEW_CHARS * 4) : c.text);
    const paras = P.textToParagraphs(big ? c.text.slice(0, PREVIEW_CHARS) : c.text, blankMode);
    if (big && paras.length > 1) paras.pop(); // last one may be cut in the middle
    const maxP = 400;
    $('#modalBody').innerHTML = (paras.length ? paras.slice(0, maxP).map((p, k) =>
      '<p data-k="' + k + '"' + (splitMode && k > 0 ? ' class="splittable" title="Yahan se naya chapter shuru karein" style="cursor:pointer"' : '') + '>' + P.escapeHtml(p) + '</p>').join('') : '<p><i>(empty)</i></p>') +
      (paras.length > maxP || big ? '<p><i>… aage aur text hai (preview me sirf shuru ka hissa dikhaya gaya hai)</i></p>' : '');
    $('#modalBody').onclick = splitMode ? (e => {
      const p = e.target.closest('p.splittable');
      if (p && confirm('Is paragraph se naya chapter shuru karein?\n\n“' + p.textContent.slice(0, 80) + '”')) splitChapterAt(i, +p.dataset.k);
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
      front: state.front
    };
  }

  function renderPlan() {
    const selected = state.chapters.filter(c => c.selected);
    const { groups, error } = currentGroups(selected);
    const err = $('#planErr');
    if (error) { err.textContent = error; err.classList.remove('hidden'); } else err.classList.add('hidden');
    const o = exportOptions();
    const ext = '.' + o.format;
    const totalChapters = state.chapters.length;
    const list = $('#planList');
    const items = groups.slice(0, PLAN_PREVIEW).map(([a, b], g) => {
      const first = selected[a], last = selected[b];
      if (!first) return '';
      const start = o.numbering === 'sequential' ? a + 1 : first.index + 1;
      const end = o.numbering === 'sequential' ? b + 1 : last.index + 1;
      const name = X.buildName(o.template, {
        book: P.sanitizeFilename(o.book), start, end, part: g + 1, totalParts: groups.length,
        totalChapters: o.numbering === 'sequential' ? selected.length : totalChapters, count: b - a + 1,
        firstTitle: P.sanitizeFilename(first.title).slice(0, 60), lastTitle: P.sanitizeFilename(last.title).slice(0, 60)
      }) + ext;
      const words = selected.slice(a, b + 1).reduce((s, c) => s + c.words, 0);
      return '<li><span class="pn" title="' + P.escapeHtml(name) + '">📄 ' + P.escapeHtml(name) + '</span><span class="pc">' + (b - a + 1) + ' ch · ' + fmtNum(words) + ' w <button data-g="' + g + '" title="Sirf ye file download karein">⬇</button></span></li>';
    });
    if (groups.length > PLAN_PREVIEW) items.push('<li><span class="pc">… aur ' + fmtNum(groups.length - PLAN_PREVIEW) + ' files</span></li>');
    list.innerHTML = items.join('');
    const per = groups.length ? Math.round(selected.length / groups.length) : 0;
    $('#planSummary').textContent = fmtNum(selected.length) + ' chapters → ' + fmtNum(groups.length) + ' file' + (groups.length === 1 ? '' : 's') +
      (groups.length > 1 && state.splitMode !== 'per' ? ' (har file me ~' + per + ')' : '');
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
    if (state.job) { toast('Chapters abhi detect ho rahe hain, ek second rukiye…'); return null; }
    const o = exportOptions();
    progress(0, 'Files ban rahi hain…');
    await tick();
    const files = await X.buildFiles(JSZip, selected, groups, o, f => progress(f * 0.7, 'Files ban rahi hain… ' + Math.round(f * 100) + '%'));
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
    const btn = $('#downloadZip');
    btn.disabled = true;
    try {
      const r = await build();
      if (!r) return;
      const folder = $('#optFolder').checked ? r.o.book + ' (' + r.o.format.toUpperCase() + ')' : '';
      const blob = await X.zipFiles(JSZip, r.files, folder, f => progress(0.7 + f * 0.3, 'ZIP pack ho raha hai… ' + Math.round(f * 100) + '%'));
      saveBlob(blob, P.sanitizeFilename(r.o.book + ' - split ' + r.o.format.toUpperCase()) + '.zip');
      progress(1, '✅ ' + r.files.length + ' files · ' + fmtSize(blob.size) + ' — download shuru ho gaya');
      toast('✅ ZIP ready: ' + r.files.length + ' files');
      saveSettings();
    } catch (e) {
      console.error(e); progress(null);
      toast(isOom(e) ? 'Memory kam pad gayi. Format TXT karein ya "Har file alag" se download karein.' : 'Error: ' + (e.message || e), 5000);
    } finally { btn.disabled = false; }
  }

  async function downloadEach() {
    let r;
    try { r = await build(); } catch (e) { console.error(e); progress(null); toast('Error: ' + (e.message || e), 5000); return; }
    if (!r) return;
    if (r.files.length > 15 && !confirm(r.files.length + ' files alag-alag download hongi. Browser permission maang sakta hai. Continue?')) { progress(null); return; }
    for (let i = 0; i < r.files.length; i++) {
      const f = r.files[i];
      saveBlob(new Blob([f.data], { type: f.mime }), f.name);
      progress((i + 1) / r.files.length, 'Downloading ' + (i + 1) + ' / ' + r.files.length);
      await new Promise(res => setTimeout(res, 350));
    }
    progress(1, '✅ ' + r.files.length + ' files downloaded');
  }

  async function downloadOne(g) {
    const selected = state.chapters.filter(c => c.selected);
    const { groups } = currentGroups(selected);
    if (!groups[g]) return;
    const o = Object.assign(exportOptions(), { onlyGroup: g });
    try {
      const files = await X.buildFiles(JSZip, selected, groups, o);
      const f = files[0];
      if (f) { saveBlob(new Blob([f.data], { type: f.mime }), f.name); toast('⬇ ' + f.name); }
    } catch (e) { console.error(e); toast('Error: ' + (e.message || e), 4000); }
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */
  function init() {
    // last line of defence: never leave the user with a silently broken page
    window.addEventListener('error', e => { if (e && e.message && !/ResizeObserver/.test(e.message)) toast('⚠ ' + e.message, 5000); });
    window.addEventListener('unhandledrejection', e => {
      const r = e && e.reason; if (r && r.aborted) { e.preventDefault(); return; }
      toast('⚠ ' + (isOom(r) ? 'Memory kam pad gayi — doosre tabs band karke dobara try karein.' : (r && r.message) || r), 5000);
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
    ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === dz) dz.classList.remove('drag'); }));
    document.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });
    $('#sampleBtn').onclick = () => loadFile(new File([CS.SAMPLE.text], CS.SAMPLE.name, { type: 'text/plain' }));
    $('#encoding').onchange = () => { saveSettings(); if (state.book && state.book.kind === 'text') toast('Encoding badalne ke liye file dobara choose karein'); };

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
    $('#chkAll').onchange = e => setAll(() => e.target.checked);
    $('#selAll').onclick = () => setAll(() => true);
    $('#selNone').onclick = () => setAll(() => false);
    $('#selInvert').onclick = () => setAll(c => !c.selected);
    $('#selRange').onclick = () => {
      const a = parseInt($('#rangeFrom').value, 10) || 1, b = parseInt($('#rangeTo').value, 10) || state.chapters.length;
      setAll((c, i) => i + 1 >= Math.min(a, b) && i + 1 <= Math.max(a, b));
      toast('Chapters ' + Math.min(a, b) + '–' + Math.max(a, b) + ' selected');
    };
    $('#resetEdits').onclick = () => { if (confirm('Saare renames / merges / splits hata dein?')) detect(); };

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
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && state.chapters.length) { e.preventDefault(); downloadZip(); }
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
      $('#togglePlan').textContent = l.classList.contains('hidden') ? 'List dikhayein' : 'List chhupayein';
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
