/*!
 * Chapter Splitter - core parsing engine
 * Pure logic (no DOM) so it works in the browser and in Node (for tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.CS = root.CS || {}).Parser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Number parsing (arabic, devanagari, full-width, roman, words, CJK)
   * ------------------------------------------------------------------ */
  const ONES = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19
  };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const SCALES = { hundred: 100, thousand: 1000 };
  const ORDINALS = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16,
    seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20
  };
  const WORD_LIST = Object.keys(ONES).concat(Object.keys(TENS), Object.keys(SCALES));
  const WORD_RE_SRC = '(?:' + WORD_LIST.sort((a, b) => b.length - a.length).join('|') + ')';

  function normalizeDigits(s) {
    return String(s)
      .replace(/[०-९]/g, d => String(d.charCodeAt(0) - 0x0966))
      .replace(/[０-９]/g, d => String(d.charCodeAt(0) - 0xFF10))
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
  }

  function romanToInt(s) {
    s = s.toUpperCase();
    if (!/^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(s) || !s) return null;
    const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    for (let i = 0; i < s.length; i++) {
      const v = map[s[i]], n = map[s[i + 1]] || 0;
      total += v < n ? -v : v;
    }
    return total;
  }

  function wordsToInt(s) {
    const parts = s.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(w => w && w !== 'and');
    if (!parts.length) return null;
    if (parts.length === 1 && ORDINALS[parts[0]] != null) return ORDINALS[parts[0]];
    let total = 0, current = 0;
    for (const w of parts) {
      if (ONES[w] != null) current += ONES[w];
      else if (TENS[w] != null) current += TENS[w];
      else if (w === 'hundred') current = (current || 1) * 100;
      else if (w === 'thousand') { total += (current || 1) * 1000; current = 0; }
      else return null;
    }
    return total + current;
  }

  const CJK_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const CJK_UNITS = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };
  function cjkToInt(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    let total = 0, section = 0, num = 0, seen = false;
    for (const ch of s) {
      if (CJK_DIGITS[ch] != null) { num = CJK_DIGITS[ch]; seen = true; }
      else if (CJK_UNITS[ch]) { section += (num || 1) * CJK_UNITS[ch]; num = 0; seen = true; }
      else if (ch === '万' || ch === '萬') { total += (section + num) * 10000; section = 0; num = 0; seen = true; }
      else return null;
    }
    return seen ? total + section + num : null;
  }

  function parseNumber(raw) {
    if (raw == null) return null;
    const s = normalizeDigits(String(raw).trim());
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (/^[ivxlcdm]+$/i.test(s)) return romanToInt(s);
    if (/^[零〇一二两兩三四五六七八九十拾百佰千仟万萬]+$/.test(s)) return cjkToInt(s);
    return wordsToInt(s);
  }

  /* ------------------------------------------------------------------ *
   * Heading patterns
   * ------------------------------------------------------------------ */
  const NUM = '(\\d+|[०-९]+|[０-９]+|[ivxlcdm]+|' + WORD_RE_SRC + '(?:[\\s-]+(?:' + WORD_RE_SRC + '|and))*|' +
    Object.keys(ORDINALS).join('|') + ')';
  const END = '(?=$|[\\s:.\\-–—)\\]|,，：、])';
  const SEP = '\\s*[:：.\\-–—|)\\]]*\\s*';

  const PATTERNS = {
    chapter: {
      label: 'Chapter / Ch. / Episode N',
      example: 'Chapter 12: The Return · CHAPTER XII · Ch. 5',
      re: new RegExp('^\\[?(?:chapter|chapitre|capitulo|capítulo|kapitel|chap\\.?|ch\\.?|episode|ep\\.?)\\s*[#№:.]?\\s*' + NUM + END + SEP + '(.*)$', 'i'),
      num: 1, title: 2
    },
    hindi: {
      label: 'अध्याय / भाग / पाठ (Hindi)',
      example: 'अध्याय 5 · अध्याय ५: नई शुरुआत',
      re: new RegExp('^(?:अध्याय|अध्यय|प्रकरण|पाठ|भाग|चैप्टर|परिच्छेद|खंड|खण्ड)\\s*[:\\-]?\\s*' + NUM + END + SEP + '(.*)$', 'i'),
      num: 1, title: 2
    },
    cjk: {
      label: '第N章 (Chinese / Japanese)',
      example: '第12章 归来 · 第一百回',
      re: /^第\s*([0-9０-９零〇一二两兩三四五六七八九十拾百佰千仟万萬]+)\s*[章回节節话話卷集幕篇](?:\s*[:：\-—]?\s*(.*))?$/,
      num: 1, title: 2
    },
    special: {
      label: 'Prologue / Epilogue / Interlude …',
      example: 'Prologue · Epilogue · Side Story 2 · प्रस्तावना',
      re: /^(prologue|epilogue|interlude|preface|foreword|introduction|afterword|side[\s-]?story|extra(?:\s+chapter)?|bonus(?:\s+chapter)?|special(?:\s+chapter)?|author'?s\s+note|प्रस्तावना|उपसंहार|भूमिका|序章|楔子|尾声|番外|後記|后记)(?=$|[\s:.\-–—\d])\s*[:.\-–—]?\s*(.{0,80})$/i,
      num: null, title: 0, special: true
    },
    part: {
      label: 'Part / Book / Volume N',
      example: 'Part One · Volume 2 · Book III',
      re: new RegExp('^(?:part|book|volume|vol\\.?|arc)\\s+' + NUM + END + SEP + '(.*)$', 'i'),
      num: 1, title: 2
    },
    numbered: {
      label: 'Bare numbers (1. / 001 / 12)',
      example: '1 · 12. · 003 · 7) The Storm',
      re: /^(\d{1,4})(?:\s*[.):\-–—]\s*(.{0,80}))?$/,
      num: 1, title: 2
    },
    markdown: {
      label: 'Markdown headings (# / ##)',
      example: '# Chapter title',
      re: /^#{1,2}\s+(.+?)\s*#*$/,
      num: null, title: 1, md: true
    }
  };

  const DEFAULT_PATTERNS = ['chapter', 'hindi', 'cjk', 'special'];

  function compileCustom(src) {
    if (!src || !src.trim()) return null;
    try { return new RegExp(src.trim(), 'iu'); } catch (e) { return { error: e.message }; }
  }

  /**
   * Test a single line. Returns {title, num, kind} or null.
   */
  function matchHeading(line, opts) {
    const t = line.replace(/\u00A0/g, ' ').trim();
    if (!t || t.length > (opts.maxHeadingLength || 120)) return null;
    // strip decorative wrappers like "=== Chapter 1 ===", "**Chapter 1**", "【Chapter 1】"
    const s = t.replace(/^[\s*=_~#【\[《<«-]+(?=\S)/, m => (/^#{1,2}\s/.test(t) && opts.patterns.includes('markdown')) ? m : '')
      .replace(/[\s*=_~】\]》>»-]+$/, '').trim();
    if (!s) return null;

    if (opts.customRe && !opts.customRe.error) {
      const m = s.match(opts.customRe);
      if (m) {
        const num = m[1] != null ? parseNumber(m[1]) : null;
        return { title: s, num, kind: 'custom' };
      }
    }
    for (const key of opts.patterns) {
      const p = PATTERNS[key];
      if (!p) continue;
      const m = (p.md ? t : s).match(p.re);
      if (!m) continue;
      const num = p.num ? parseNumber(m[p.num]) : null;
      if (p.num && num == null) continue;
      if (p.special) return { title: s, num: null, kind: key };
      if (p.md) return { title: m[1].trim(), num: extractNumber(m[1]), kind: key };
      const rest = (m[p.title] || '').trim();
      // guard against sentences that merely start with "Chapter 3 ..." in body text
      if (rest.length > 90) continue;
      if (key === 'numbered' && rest && /[,;]$/.test(rest)) continue;
      return { title: s, num, subtitle: rest, kind: key };
    }
    return null;
  }

  function extractNumber(title) {
    const m = String(title).match(new RegExp(NUM + END, 'i'));
    if (m) { const n = parseNumber(m[1]); if (n != null) return n; }
    const c = String(title).match(/第\s*([0-9０-９零〇一二两兩三四五六七八九十拾百佰千仟万萬]+)/);
    return c ? parseNumber(c[1]) : null;
  }

  /* ------------------------------------------------------------------ *
   * Plain-text chapter detection
   * ------------------------------------------------------------------ */
  function defaultTextOptions() {
    return {
      patterns: DEFAULT_PATTERNS.slice(),
      custom: '',
      minChars: 200,          // chapters shorter than this are merged
      mergeSubtitle: true,    // "Chapter 1" + next line "The Beginning"
      maxHeadingLength: 120,
      requireBlankBefore: false
    };
  }

  /**
   * Split plain text into chapters.
   * @returns {{front: {title,text}|null, chapters: Array<{title,num,text,kind}>}}
   */
  function detectTextChapters(text, options) {
    const opts = Object.assign(defaultTextOptions(), options || {});
    opts.customRe = compileCustom(opts.custom);
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const heads = [];
    for (let i = 0; i < lines.length; i++) {
      if (opts.requireBlankBefore && i > 0 && lines[i - 1].trim() !== '') continue;
      const h = matchHeading(lines[i], opts);
      if (!h) continue;
      let end = i; // last line consumed by heading
      if (opts.mergeSubtitle && !h.subtitle && h.kind !== 'special' && h.kind !== 'markdown') {
        // look ahead (skipping up to 1 blank line) for a short subtitle line
        let j = i + 1;
        if (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length) {
          const sub = lines[j].trim();
          if (sub && sub.length <= 70 && !/[.,;!?"”'’…:]$/.test(sub) && !matchHeading(sub, opts) &&
              (j + 1 >= lines.length || !lines[j + 1].trim() || sub.length <= 50)) {
            h.title = h.title + ' – ' + sub;
            end = j;
          }
        }
      }
      heads.push({ line: i, end, title: h.title, num: h.num, kind: h.kind });
      i = end;
    }

    const body = (a, b) => trimBlankLines(lines.slice(a, b).join('\n'));
    let chapters = heads.map((h, k) => ({
      title: h.title,
      num: h.num,
      kind: h.kind,
      text: body(h.end + 1, k + 1 < heads.length ? heads[k + 1].line : lines.length)
    }));
    const frontText = body(0, heads.length ? heads[0].line : lines.length);
    let front = frontText ? { title: 'Front matter', text: frontText } : null;

    const res = mergeShortChapters(chapters, front, opts.minChars);
    return res;
  }

  /**
   * Short chunks (e.g. table-of-contents entries, part headings) are merged:
   *  - before the first "real" chapter -> appended to front matter
   *  - afterwards -> merged forward into the next chapter (or backward if last)
   */
  function mergeShortChapters(chapters, front, minChars) {
    minChars = Math.max(0, minChars | 0);
    if (!minChars || chapters.length < 2) return { front, chapters };
    const isShort = c => c.text.replace(/\s+/g, '').length < minChars;
    const firstReal = chapters.findIndex(c => !isShort(c));
    if (firstReal === -1) return { front, chapters }; // everything is short – leave as is
    const out = [];
    if (firstReal > 0) {
      const parts = chapters.slice(0, firstReal).map(c => [c.title, c.text].filter(Boolean).join('\n'));
      const extra = parts.join('\n\n');
      front = { title: 'Front matter', text: [front && front.text, extra].filter(Boolean).join('\n\n') };
      if (front.html != null) delete front.html;
    }
    let carry = null;
    for (let i = firstReal; i < chapters.length; i++) {
      const c = Object.assign({}, chapters[i]);
      if (carry) {
        c.text = [carry.text, c.text].filter(Boolean).join('\n\n');
        if (c.html != null || carry.html != null) c.html = (carry.html || '') + (c.html || '');
        carry = null;
      }
      if (isShort(c) && i < chapters.length - 1 && i !== firstReal) {
        const headHtml = c.html != null ? '<h3>' + escapeHtml(c.title) + '</h3>' + c.html : null;
        carry = { text: [c.title, c.text].filter(Boolean).join('\n\n'), html: headHtml };
        continue;
      }
      out.push(c);
    }
    if (carry && out.length) {
      const last = out[out.length - 1];
      last.text = [last.text, carry.text].filter(Boolean).join('\n\n');
      if (last.html != null) last.html += carry.html || '';
    }
    return { front, chapters: out };
  }

  function trimBlankLines(s) {
    return s.replace(/^\s*\n/, '').replace(/\n\s*$/, '').replace(/^\n+|\n+$/g, '');
  }

  /* ------------------------------------------------------------------ *
   * Grouping chapters into output files
   * ------------------------------------------------------------------ */
  /**
   * @param {number} total number of chapters
   * @param {{mode:'per'|'files'|'ranges', per?:number, files?:number, ranges?:string}} cfg
   * @returns {{groups:Array<[number,number]>, error?:string}} 0-based inclusive index ranges
   */
  function makeGroups(total, cfg) {
    const groups = [];
    if (!total) return { groups };
    if (cfg.mode === 'ranges') {
      const res = parseRanges(cfg.ranges || '', total);
      if (res.error) return { groups: [], error: res.error };
      return { groups: res.ranges };
    }
    let per;
    if (cfg.mode === 'files') {
      const files = Math.max(1, Math.min(total, parseInt(cfg.files, 10) || 1));
      // distribute evenly: sizes differ by at most 1
      const base = Math.floor(total / files), extra = total % files;
      let start = 0;
      for (let i = 0; i < files; i++) {
        const size = base + (i < extra ? 1 : 0);
        groups.push([start, start + size - 1]);
        start += size;
      }
      return { groups };
    }
    per = Math.max(1, parseInt(cfg.per, 10) || 1);
    for (let s = 0; s < total; s += per) groups.push([s, Math.min(total, s + per) - 1]);
    return { groups };
  }

  /** "1-10, 11-25, 26-" -> [[0,9],[10,24],[25,total-1]] (1-based input) */
  function parseRanges(src, total) {
    const ranges = [];
    const items = String(src).split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    if (!items.length) return { ranges: [], error: 'Enter ranges like 1-10, 11-25, 26-' };
    for (const it of items) {
      const m = it.match(/^(\d+)?\s*(?:(-|–|to)\s*(\d+)?)?$/i);
      if (!m || (!m[1] && !m[3])) return { ranges: [], error: 'Invalid range: "' + it + '"' };
      let a = m[1] ? parseInt(m[1], 10) : 1;
      let b = m[2] ? (m[3] ? parseInt(m[3], 10) : total) : a;
      if (a < 1 || b < 1) return { ranges: [], error: 'Ranges start at 1: "' + it + '"' };
      if (a > b) [a, b] = [b, a];
      if (a > total) return { ranges: [], error: 'Range "' + it + '" is beyond the last chapter (' + total + ')' };
      b = Math.min(b, total);
      ranges.push([a - 1, b - 1]);
    }
    return { ranges };
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function countWords(s) {
    if (!s) return 0;
    const cjk = (s.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const words = (s.replace(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/\S+/g) || []).length;
    return words + cjk;
  }

  /** Paragraphs from plain text: blank-line separated, or one per line if no blank lines. */
  function textToParagraphs(text) {
    const t = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!t) return [];
    if (/\n\s*\n/.test(t)) {
      return t.split(/\n\s*\n+/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    }
    return t.split('\n').map(p => p.trim()).filter(Boolean);
  }

  function sanitizeFilename(name) {
    return String(name)
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 150) || 'file';
  }

  /** Words that usually denote non-story entries in EPUB TOCs */
  const NON_CHAPTER_RE = /^(cover|title\s*page|title|half[\s-]?title|copyright|copyright\s*page|contents|table\s+of\s+contents|toc|dedication|acknowledg(e)?ments?|also\s+by.*|about\s+the\s+(author|publisher|book)|praise\s+for.*|imprint|colophon|newsletter|sign\s*up.*|landmarks|index|glossary|credits|front\s*matter|back\s*matter|विषय[\s-]?सूची|अनुक्रम|目录|目次|封面|版权)$/i;
  function looksLikeNonChapter(title) {
    return NON_CHAPTER_RE.test(String(title || '').trim().replace(/[.:]+$/, ''));
  }

  return {
    PATTERNS, DEFAULT_PATTERNS,
    parseNumber, romanToInt, wordsToInt, cjkToInt, normalizeDigits, extractNumber,
    matchHeading, detectTextChapters, mergeShortChapters, defaultTextOptions, compileCustom,
    makeGroups, parseRanges,
    escapeHtml, countWords, textToParagraphs, sanitizeFilename, looksLikeNonChapter
  };
});
