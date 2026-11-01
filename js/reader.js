/*!
 * Chapter Splitter - input readers (EPUB / TXT / HTML / MD)
 * Browser only (uses DOMParser, TextDecoder, JSZip).
 */
(function (CS) {
  'use strict';
  const P = CS.Parser;

  /* ------------------------------------------------------------------ *
   * Text decoding
   * ------------------------------------------------------------------ */
  function decodeText(buffer, encoding) {
    const bytes = new Uint8Array(buffer);
    if (encoding && encoding !== 'auto') {
      return { text: new TextDecoder(encoding).decode(bytes), encoding };
    }
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' };
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' };
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''), encoding: 'utf-8' };
    } catch (e) { /* not utf-8 */ }
    // Heuristic: lots of high bytes in pairs -> likely GBK (Chinese web novels)
    let high = 0;
    for (let i = 0; i < Math.min(bytes.length, 20000); i++) if (bytes[i] > 0x80) high++;
    const guess = high > Math.min(bytes.length, 20000) * 0.2 ? 'gbk' : 'windows-1252';
    try { return { text: new TextDecoder(guess).decode(bytes), encoding: guess }; } catch (e) {
      return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
    }
  }

  /* ------------------------------------------------------------------ *
   * HTML -> clean HTML + plain text
   * ------------------------------------------------------------------ */
  const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main', 'blockquote', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'table', 'tr', 'figure', 'figcaption', 'hr', 'dl', 'dt', 'dd', 'center', 'body', 'nav']);
  const KEEP = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'i', 'strong', 'b', 'u', 's', 'sub', 'sup',
    'blockquote', 'br', 'hr', 'ul', 'ol', 'li', 'pre', 'code', 'small', 'span', 'table', 'tr', 'td', 'th', 'tbody', 'thead']);
  const SKIP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'svg', 'math', 'noscript', 'iframe', 'object', 'img', 'image', 'video', 'audio']);

  /** Plain text with blank lines between blocks */
  function nodeToText(node) {
    let out = '';
    (function walk(n) {
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, ' '); return; }
      if (n.nodeType !== 1 && n.nodeType !== 11 && n.nodeType !== 9) return;
      const tag = n.nodeType === 1 ? n.localName.toLowerCase() : '';
      if (SKIP.has(tag)) return;
      if (tag === 'br') { out += '\n'; return; }
      if (tag === 'hr') { out += '\n\n* * *\n\n'; return; }
      const block = BLOCK.has(tag);
      if (block) out += '\n\n';
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (block) out += '\n\n';
    })(node);
    return out.split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /** Sanitised HTML keeping only basic formatting tags */
  function nodeToCleanHtml(node) {
    let out = '';
    (function walk(n, inBlock) {
      if (n.nodeType === 3) { out += P.escapeHtml(n.nodeValue.replace(/\s+/g, ' ')); return; }
      if (n.nodeType !== 1 && n.nodeType !== 11 && n.nodeType !== 9) return;
      const tag = n.nodeType === 1 ? n.localName.toLowerCase() : '';
      if (SKIP.has(tag)) return;
      if (tag === 'br') { out += '<br/>'; return; }
      if (tag === 'hr') { out += '<hr/>'; return; }
      if (KEEP.has(tag) && tag !== 'span') {
        out += '<' + tag + '>';
        for (let c = n.firstChild; c; c = c.nextSibling) walk(c, true);
        out += '</' + tag + '>';
        return;
      }
      // a generic block (div/section) that directly contains text -> paragraph
      if (BLOCK.has(tag) && hasDirectText(n)) {
        out += '<p>';
        for (let c = n.firstChild; c; c = c.nextSibling) walk(c, true);
        out += '</p>';
        return;
      }
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c, inBlock);
    })(node, false);
    return out.replace(/<p>\s*<\/p>/g, '').replace(/\s+(<\/(p|h\d|li)>)/g, '$1').replace(/(<(p|h\d|li)>)\s+/g, '$1');
  }
  function hasDirectText(n) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3 && c.nodeValue.trim()) return true;
      if (c.nodeType === 1 && /^(em|i|strong|b|span|a|u|small|sup|sub|br|font)$/i.test(c.localName)) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * EPUB
   * ------------------------------------------------------------------ */
  function resolvePath(base, rel) {
    rel = decodeURIComponent(String(rel).split('#')[0]);
    if (/^[a-z]+:/i.test(rel)) return rel;
    const parts = (rel.startsWith('/') ? [] : base.split('/').slice(0, -1));
    for (const seg of rel.replace(/^\//, '').split('/')) {
      if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }

  function parseXml(str, type) {
    const doc = new DOMParser().parseFromString(str, type || 'application/xml');
    if (doc.getElementsByTagName('parsererror').length && type !== 'text/html') {
      // many EPUB XHTML files are not well formed – fall back to HTML parser
      return new DOMParser().parseFromString(str, 'text/html');
    }
    return doc;
  }
  const byTag = (root, name) => Array.from(root.getElementsByTagNameNS('*', name));
  const firstTag = (root, name) => byTag(root, name)[0] || null;

  async function readEpub(buffer, onProgress, signal) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip failed to load');
    let zip;
    try { zip = await JSZip.loadAsync(buffer); } catch (e) { throw new Error('EPUB khul nahi payi (file kharab ya adhuri hai): ' + (e.message || e)); }
    const fileMap = {};
    zip.forEach((path, f) => { fileMap[path.toLowerCase()] = f; });
    const getFile = p => zip.file(p) || fileMap[String(p).toLowerCase()] || null;
    const readStr = async p => { const f = getFile(p); return f ? f.async('string') : null; };

    const container = await readStr('META-INF/container.xml');
    let opfPath;
    if (container) {
      const rf = firstTag(parseXml(container), 'rootfile');
      opfPath = rf && rf.getAttribute('full-path');
    }
    if (!opfPath) opfPath = Object.keys(fileMap).find(p => p.endsWith('.opf'));
    if (!opfPath) throw new Error('Not a valid EPUB (no OPF package file found)');
    const opf = parseXml(await readStr(opfPath));

    // metadata
    const meta = {
      title: textOf(firstTag(opf, 'title')) || '',
      author: textOf(firstTag(opf, 'creator')) || '',
      language: textOf(firstTag(opf, 'language')) || 'en'
    };

    // manifest
    const manifest = {};
    let navHref = null, coverId = null;
    byTag(opf, 'meta').forEach(m => { if (m.getAttribute('name') === 'cover') coverId = m.getAttribute('content'); });
    byTag(opf, 'item').forEach(it => {
      const id = it.getAttribute('id'), href = resolvePath(opfPath, it.getAttribute('href') || '');
      const props = it.getAttribute('properties') || '';
      manifest[id] = { id, href, type: it.getAttribute('media-type') || '', props };
      if (/\bnav\b/.test(props)) navHref = href;
      if (/cover-image/.test(props)) coverId = id;
    });

    // cover image (kept for EPUB output)
    let cover = null;
    if (coverId && manifest[coverId] && /^image\//.test(manifest[coverId].type)) {
      const f = getFile(manifest[coverId].href);
      if (f) cover = { data: await f.async('uint8array'), type: manifest[coverId].type, name: manifest[coverId].href.split('/').pop() };
    }

    // spine
    const spineEl = firstTag(opf, 'spine');
    const spine = byTag(opf, 'itemref')
      .map(r => manifest[r.getAttribute('idref')])
      .filter(it => it && /x?html|xml/.test(it.type) && !/\bnav\b/.test(it.props));

    // load all spine documents (yielding to the UI between files)
    const docs = [];
    let last = P.now();
    for (let i = 0; i < spine.length; i++) {
      let raw;
      try { raw = await readStr(spine[i].href); } catch (e) { console.warn('skip unreadable', spine[i].href, e); continue; }
      if (raw == null) continue;
      let doc;
      try { doc = parseXml(raw, /<!DOCTYPE html>\s*<html(?![^>]*xmlns)/i.test(raw.slice(0, 2000)) ? 'text/html' : 'application/xhtml+xml'); }
      catch (e) { console.warn('skip unparsable', spine[i].href, e); continue; }
      raw = null;
      docs.push({ href: spine[i].href, doc, body: doc.body || firstTag(doc, 'body') || doc.documentElement, text: null });
      if (P.now() - last > 30) {
        if (onProgress) onProgress((i + 1) / spine.length);
        await P.yieldToEventLoop();
        if (signal && signal.aborted) { const e = new Error('Cancelled'); e.aborted = true; throw e; }
        last = P.now();
      }
    }

    // TOC
    let toc = [];
    if (navHref) {
      const s = await readStr(navHref);
      if (s) toc = parseNavToc(parseXml(s, 'application/xhtml+xml'), navHref);
    }
    if (!toc.length) {
      const ncxId = spineEl && spineEl.getAttribute('toc');
      const ncx = (ncxId && manifest[ncxId]) || Object.values(manifest).find(m => /ncx/.test(m.type));
      if (ncx) {
        const s = await readStr(ncx.href);
        if (s) toc = parseNcxToc(parseXml(s), ncx.href);
      }
    }

    return { kind: 'epub', meta, docs, toc, cover };
  }

  function textOf(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }

  function parseNavToc(doc, base) {
    const navs = byTag(doc, 'nav');
    let nav = navs.find(n => /toc/.test(n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || ''))
      || navs.find(n => (n.getAttribute('id') || '').toLowerCase() === 'toc') || navs[0];
    if (!nav) return [];
    const out = [];
    (function walk(list, depth) {
      for (const li of Array.from(list.children).filter(c => c.localName === 'li')) {
        const a = Array.from(li.children).find(c => c.localName === 'a' || c.localName === 'span');
        if (a && a.getAttribute('href')) {
          const href = a.getAttribute('href');
          out.push({ title: textOf(a), file: resolvePath(base, href), frag: href.includes('#') ? decodeURIComponent(href.split('#')[1]) : null, depth });
        }
        const sub = Array.from(li.children).find(c => c.localName === 'ol' || c.localName === 'ul');
        if (sub) walk(sub, depth + 1);
      }
    })(Array.from(nav.children).find(c => c.localName === 'ol' || c.localName === 'ul') || nav, 1);
    return out;
  }

  function parseNcxToc(doc, base) {
    const out = [];
    const navMap = firstTag(doc, 'navMap');
    if (!navMap) return out;
    (function walk(parent, depth) {
      for (const np of Array.from(parent.children).filter(c => c.localName === 'navPoint')) {
        const label = firstTag(np, 'text');
        const content = Array.from(np.children).find(c => c.localName === 'content');
        const src = content && content.getAttribute('src');
        if (src) out.push({ title: textOf(label), file: resolvePath(base, src), frag: src.includes('#') ? decodeURIComponent(src.split('#')[1]) : null, depth });
        walk(np, depth + 1);
      }
    })(navMap, 1);
    return out;
  }

  /* ---- build chapter list from an EPUB ---- */

  /** Plain text of one spine document (computed once, then cached). */
  function docText(d) {
    if (d.text == null) d.text = nodeToText(d.body);
    return d.text;
  }
  /** Full plain text of an EPUB (cached). Generator so it can run in time slices. */
  function* bookTextIter(book) {
    if (book.fullText != null) return book.fullText;
    const parts = [];
    for (let i = 0; i < book.docs.length; i++) { parts.push(docText(book.docs[i])); yield i / book.docs.length; }
    book.fullText = parts.join('\n\n');
    return book.fullText;
  }
  function bookText(book) { return P.runSync(bookTextIter(book)); }

  /**
   * @param {object} book result of readEpub
   * @param {{mode:'auto'|'toc'|'spine'|'text', tocDepth:number, skipExtras:boolean, text:object}} opts
   */
  function epubChapters(book, opts) {
    return P.runSync(epubChaptersIter(book, opts));
  }

  function* epubChaptersIter(book, opts) {
    opts = Object.assign({ mode: 'auto', tocDepth: 9, skipExtras: true }, opts || {});
    let mode = opts.mode, result;
    if (mode === 'auto') {
      const textRes = yield* P.sub(epubByText(book, opts), 0, 0.4);
      const tocRes = book.toc.length >= 2 ? yield* P.sub(epubByToc(book, opts), 0.4, 1) : null;
      // Prefer the TOC unless text detection finds clearly more chapters (bad TOCs that list one entry per file
      // while each file holds many chapters, or a TOC with only a few entries)
      if (tocRes && tocRes.chapters.length >= 2 && textRes.chapters.length <= tocRes.chapters.length * 1.5) { result = tocRes; mode = 'toc'; }
      else if (textRes.chapters.length >= 2) { result = textRes; mode = 'text'; }
      else if (tocRes && tocRes.chapters.length) { result = tocRes; mode = 'toc'; }
      else { result = yield* epubBySpine(book, opts); mode = 'spine'; }
    } else if (mode === 'toc') result = yield* epubByToc(book, opts);
    else if (mode === 'spine') result = yield* epubBySpine(book, opts);
    else result = yield* epubByText(book, opts);
    result.mode = mode;
    return result;
  }

  function* epubBySpine(book, opts) {
    const chapters = [];
    const front = null;
    for (let i = 0; i < book.docs.length; i++) {
      const d = book.docs[i];
      const text = docText(d);
      yield i / book.docs.length;
      if (!P.countNonWs(text, 1)) continue;
      const h = d.body.querySelector && d.body.querySelector('h1,h2,h3');
      const docTitle = textOf(firstTag(d.doc, 'title'));
      const title = (h && textOf(h)) || (docTitle && docTitle !== book.meta.title ? docTitle : '') || ('Section ' + (i + 1));
      chapters.push(stripLeadingTitle({ title, num: P.extractNumber(title), text, html: nodeToCleanHtml(d.body) }));
    }
    let list = chapters;
    if (opts.skipExtras) list = chapters.filter(c => !P.looksLikeNonChapter(c.title));
    return P.mergeShortChapters(list, front, opts.text ? opts.text.minChars : 200);
  }

  function* epubByText(book, opts) {
    const full = yield* P.sub(bookTextIter(book), 0, 0.3);
    return yield* P.sub(P.detectTextChaptersIter(full, opts.text || {}), 0.3, 1);
  }

  function* epubByToc(book, opts) {
    const docIndex = {};
    book.docs.forEach((d, i) => { docIndex[d.href] = i; docIndex[d.href.toLowerCase()] = i; });
    // resolve TOC entries to positions
    let cuts = [];
    for (const e of book.toc) {
      if (e.depth > opts.tocDepth) continue;
      const di = docIndex[e.file] != null ? docIndex[e.file] : docIndex[e.file.toLowerCase()];
      if (di == null) continue;
      let el = null;
      if (e.frag) {
        const doc = book.docs[di].doc;
        el = doc.getElementById(e.frag) || doc.querySelector('[name="' + CSS.escape(e.frag) + '"]');
      }
      cuts.push({ title: e.title || 'Untitled', di, el, depth: e.depth, extra: P.looksLikeNonChapter(e.title) });
      if ((cuts.length & 255) === 0) yield 0.05 * cuts.length / book.toc.length;
    }
    // order by document position
    cuts.forEach((c, i) => { c.order = i; });
    cuts.sort((a, b) => a.di - b.di || comparePos(a.el, b.el) || a.order - b.order);
    // de-duplicate identical positions (Part + first Chapter pointing at the same place): keep the deeper/last entry
    const dedup = [];
    for (const c of cuts) {
      const prev = dedup[dedup.length - 1];
      if (prev && prev.di === c.di && prev.el === c.el) {
        dedup[dedup.length - 1] = c; // keep the later (usually deeper, e.g. Chapter inside Part) entry
      } else dedup.push(c);
    }
    cuts = dedup;
    if (!cuts.length) return { front: null, chapters: [] };
    yield 0.1;

    const pieces = new Array(cuts.length);
    for (let k = 0; k < cuts.length; k++) {
      const c = cuts[k];
      const frag = extractBetween(book.docs, c, cuts[k + 1]);
      pieces[k] = { title: c.title, num: P.extractNumber(c.title), extra: c.extra, text: nodeToText(frag), html: nodeToCleanHtml(frag) };
      yield 0.1 + 0.85 * (k + 1) / cuts.length;
    }
    // front matter = everything before the first cut
    const before = extractBetween(book.docs, { di: 0, el: null, start: true }, cuts[0]);
    const frontText = nodeToText(before);
    let front = frontText ? { title: 'Front matter', text: frontText, html: nodeToCleanHtml(before) } : null;

    let chapters = pieces.map(stripLeadingTitle);
    if (opts.skipExtras) {
      // extras before the first real chapter become front matter; others are dropped
      const firstReal = chapters.findIndex(c => !c.extra);
      const lead = firstReal > 0 ? chapters.slice(0, firstReal) : [];
      if (lead.length) {
        front = {
          title: 'Front matter',
          text: [front && front.text].concat(lead.map(c => c.text)).filter(Boolean).join('\n\n'),
          html: [front && front.html].concat(lead.map(c => c.html)).filter(Boolean).join('')
        };
      }
      chapters = chapters.filter(c => !c.extra);
    }
    chapters = chapters.filter(c => P.countNonWs(c.text, 1) || c.title);
    return P.mergeShortChapters(chapters, front, opts.text ? Math.min(opts.text.minChars, 50) : 50);
  }

  function comparePos(a, b) {
    if (a === b) return 0;
    if (!a) return -1; if (!b) return 1;
    const r = a.compareDocumentPosition(b);
    return r & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : r & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
  }

  /** Returns a DocumentFragment-like container with the content between cut a (inclusive) and cut b (exclusive). */
  function extractBetween(docs, a, b) {
    const holder = document.createElement('div');
    const endDi = b ? b.di : docs.length - 1;
    for (let di = a.di; di <= endDi; di++) {
      const d = docs[di];
      if (!d || !d.body) continue;
      // the next cut starts at the very top of this document -> nothing from it belongs to us
      if (b && di === b.di && !b.el) break;
      const body = d.body;
      const range = d.doc.createRange();
      if (di === a.di && a.el && body.contains(a.el)) range.setStartBefore(a.el); else range.setStart(body, 0);
      if (b && di === b.di && b.el && body.contains(b.el)) range.setEndBefore(b.el);
      else range.setEnd(body, body.childNodes.length);
      try {
        holder.appendChild(document.importNode(range.cloneContents(), true));
      } catch (e) { /* ignore broken ranges */ }
    }
    return holder;
  }

  /** Remove the heading text from the start of the body if it repeats the title. */
  function stripLeadingTitle(ch) {
    const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const t = norm(ch.title);
    if (!t) return ch;
    const lines = ch.text.split('\n');
    let consumed = 0, acc = '';
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      if (!lines[i].trim()) continue;
      acc += norm(lines[i]);
      if (acc === t || (acc.length >= t.length && acc.startsWith(t) && i < 3 && acc.length - t.length < 2)) { consumed = i + 1; break; }
      if (!t.startsWith(acc)) break;
    }
    if (consumed) {
      ch.text = lines.slice(consumed).join('\n').replace(/^\s+/, '');
      if (ch.html) {
        // drop leading heading elements that are part of the title
        let html = ch.html, guard = 0;
        while (guard++ < 3) {
          const m = html.match(/^\s*<(h[1-6]|p)>([\s\S]*?)<\/\1>/);
          if (!m) break;
          const inner = norm(m[2].replace(/<[^>]+>/g, ''));
          if (inner && t.includes(inner)) html = html.slice(m[0].length); else break;
        }
        ch.html = html;
      }
    }
    return ch;
  }

  /* ------------------------------------------------------------------ *
   * Generic entry point
   * ------------------------------------------------------------------ */
  async function readFile(file, encoding, onProgress, signal) {
    const name = file.name;
    const ext = (name.split('.').pop() || '').toLowerCase();
    let buffer;
    try { buffer = await file.arrayBuffer(); } catch (e) { throw new Error('File read nahi ho payi (shayad bahut badi hai ya hata di gayi): ' + (e.message || e)); }
    const baseTitle = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
    if (ext === 'epub' || isZip(buffer)) {
      const book = await readEpub(buffer, onProgress, signal);
      buffer = null;
      if (!book.meta.title) book.meta.title = baseTitle;
      book.fileName = name;
      return book;
    }
    if (onProgress) onProgress(0.3);
    await P.yieldToEventLoop();
    let { text, encoding: enc } = decodeText(buffer, encoding);
    buffer = null;
    if (onProgress) onProgress(0.7);
    await P.yieldToEventLoop();
    if (ext === 'html' || ext === 'htm' || ext === 'xhtml' || /^\s*<(!doctype|html)/i.test(text.slice(0, 200))) {
      let doc = new DOMParser().parseFromString(text, 'text/html');
      text = null;
      await P.yieldToEventLoop();
      const meta = { title: textOf(doc.querySelector('title')) || baseTitle, author: '', language: doc.documentElement.lang || 'en' };
      const plain = nodeToText(doc.body);
      doc = null;
      return { kind: 'text', fileName: name, encoding: enc, meta, text: plain };
    }
    return { kind: 'text', fileName: name, encoding: enc, isMarkdown: ext === 'md' || ext === 'markdown', meta: { title: baseTitle, author: '', language: guessLang(text) }, text };
  }

  function isZip(buf) { if (buf.byteLength < 4) return false; const b = new Uint8Array(buf, 0, 4); return b[0] === 0x50 && b[1] === 0x4B && b[2] === 3 && b[3] === 4; }

  function guessLang(text) {
    const s = text.slice(0, 5000);
    if (/[\u0900-\u097F]/.test(s) && (s.match(/[\u0900-\u097F]/g) || []).length > 50) return 'hi';
    if ((s.match(/[\u4e00-\u9fff]/g) || []).length > 100) return 'zh';
    if ((s.match(/[\u3040-\u30ff]/g) || []).length > 50) return 'ja';
    return 'en';
  }

  CS.Reader = { readFile, readEpub, epubChapters, epubChaptersIter, bookText, bookTextIter, decodeText, nodeToText, nodeToCleanHtml, resolvePath };
})(self.CS = self.CS || {});
