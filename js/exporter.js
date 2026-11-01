/*!
 * Chapter Splitter - exporters (TXT / Markdown / HTML / EPUB) + ZIP packaging
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./parser.js'));
  else (root.CS = root.CS || {}).Exporter = factory(root.CS.Parser);
})(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';
  const esc = P.escapeHtml;

  /* ------------------------------------------------------------------ *
   * File naming
   * ------------------------------------------------------------------ */
  /**
   * Template tokens:
   *  {book} {start} {end} {range} {part} {total} {title} {first} {last} {count}
   * Numbers are zero padded to the width of the largest number.
   */
  function buildName(template, ctx) {
    const pad = (n, w) => String(n).padStart(w, '0');
    const chW = String(ctx.totalChapters).length, pW = String(ctx.totalParts).length;
    const range = ctx.start === ctx.end ? pad(ctx.start, chW) : pad(ctx.start, chW) + '-' + pad(ctx.end, chW);
    const name = String(template || '{book} - Chapters {range}')
      .replace(/\{book\}/g, ctx.book)
      .replace(/\{start\}/g, pad(ctx.start, chW))
      .replace(/\{end\}/g, pad(ctx.end, chW))
      .replace(/\{range\}/g, range)
      .replace(/\{part\}/g, pad(ctx.part, pW))
      .replace(/\{total\}/g, String(ctx.totalParts))
      .replace(/\{count\}/g, String(ctx.count))
      .replace(/\{title\}/g, ctx.firstTitle)
      .replace(/\{first\}/g, ctx.firstTitle)
      .replace(/\{last\}/g, ctx.lastTitle);
    return P.sanitizeFilename(name);
  }

  /* ------------------------------------------------------------------ *
   * Per-format renderers
   * ------------------------------------------------------------------ */
  function chapterHtml(ch) {
    if (ch.html && ch.html.replace(/<[^>]+>/g, '').trim()) return ch.html;
    return P.textToParagraphs(ch.text).map(p => p === '* * *' ? '<hr/>' : '<p>' + esc(p) + '</p>').join('\n');
  }

  function renderTxt(chapters, o) {
    const sep = o.separator != null ? o.separator : '\n\n\n';
    const head = o.includeBookHeader ? o.book + (o.author ? '\nby ' + o.author : '') + '\n' + '='.repeat(Math.min(60, o.book.length || 10)) + '\n\n' : '';
    return head + chapters.map(c => (o.includeTitles ? c.title + '\n\n' : '') + c.text.trim()).join(sep) + '\n';
  }

  function renderMd(chapters, o) {
    const head = o.includeBookHeader ? '# ' + o.book + (o.author ? '\n\n*by ' + o.author + '*' : '') + '\n\n' : '';
    return head + chapters.map(c => (o.includeTitles ? '## ' + c.title + '\n\n' : '') +
      P.textToParagraphs(c.text).map(p => p === '* * *' ? '---' : p).join('\n\n')).join('\n\n') + '\n';
  }

  const READ_CSS = 'body{max-width:42em;margin:2em auto;padding:0 1.2em;font-family:Georgia,"Noto Serif","Noto Serif Devanagari",serif;line-height:1.7;color:#222;background:#fdfbf7}' +
    'h1{text-align:center;margin:1.5em 0 .3em}h2{margin-top:3em;border-bottom:1px solid #ddd;padding-bottom:.3em}' +
    '.author{text-align:center;font-style:italic;color:#666}p{text-indent:1.5em;margin:.4em 0}hr{border:0;text-align:center;margin:2em 0}hr:after{content:"* * *";color:#999}' +
    'nav ol{line-height:1.9}nav a{color:#8a4b08;text-decoration:none}' +
    '@media (prefers-color-scheme:dark){body{background:#1c1b19;color:#ddd}h2{border-color:#444}nav a{color:#e0a458}}';

  function renderHtml(chapters, o, title) {
    const toc = o.includeToc && chapters.length > 1
      ? '<nav><h3>Contents</h3><ol>' + chapters.map((c, i) => '<li><a href="#ch' + (i + 1) + '">' + esc(c.title) + '</a></li>').join('') + '</ol></nav>'
      : '';
    const body = chapters.map((c, i) => '<section id="ch' + (i + 1) + '">' + (o.includeTitles ? '<h2>' + esc(c.title) + '</h2>\n' : '') + chapterHtml(c) + '</section>').join('\n');
    return '<!DOCTYPE html>\n<html lang="' + esc(o.language || 'en') + '">\n<head>\n<meta charset="utf-8"/>\n<meta name="viewport" content="width=device-width,initial-scale=1"/>\n<title>' + esc(title) + '</title>\n<style>' + READ_CSS + '</style>\n</head>\n<body>\n' +
      (o.includeBookHeader ? '<h1>' + esc(o.book) + '</h1>' + (o.author ? '<p class="author">' + esc(o.author) + '</p>' : '') : '') +
      toc + '\n' + body + '\n</body>\n</html>\n';
  }

  /* ---- EPUB 3 (with EPUB 2 NCX for old readers) ---- */
  const EPUB_CSS = 'body{font-family:serif;line-height:1.6;margin:0 5%}h1,h2{text-align:center;margin:2em 0 1em;page-break-before:always}' +
    'p{text-indent:1.4em;margin:0 0 .3em}hr{border:0;text-align:center;margin:1.5em 0}.titlepage{text-align:center;margin-top:30%}.titlepage .author{font-style:italic}' +
    'img.cover{max-width:100%;max-height:100%}';

  function xhtmlDoc(title, lang, body) {
    return '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="' + esc(lang) + '" xml:lang="' + esc(lang) + '">\n<head>\n<meta charset="utf-8"/>\n<title>' + esc(title) + '</title>\n<link rel="stylesheet" type="text/css" href="style.css"/>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';
  }

  /** Make sure the HTML is well-formed XHTML (void tags closed, entities valid). */
  function toXhtml(html) {
    return String(html)
      .replace(/<(br|hr)\s*>/gi, '<$1/>')
      .replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, '&amp;')
      .replace(/&nbsp;/g, '&#160;');
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  async function renderEpub(JSZip, chapters, o, title) {
    const zip = new JSZip();
    const lang = o.language || 'en';
    const id = 'urn:uuid:' + uuid();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n');
    const oe = zip.folder('OEBPS');
    oe.file('style.css', EPUB_CSS);

    const manifest = ['<item id="css" href="style.css" media-type="text/css"/>', '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'];
    const spine = [];
    let coverMeta = '';
    if (o.cover && o.includeCover) {
      const ext = (o.cover.name.split('.').pop() || 'jpg').toLowerCase();
      oe.file('cover.' + ext, o.cover.data);
      manifest.push('<item id="cover-img" href="cover.' + ext + '" media-type="' + o.cover.type + '" properties="cover-image"/>');
      manifest.push('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>');
      oe.file('cover.xhtml', xhtmlDoc('Cover', lang, '<div style="text-align:center"><img class="cover" src="cover.' + ext + '" alt="Cover"/></div>'));
      spine.push('<itemref idref="cover" linear="no"/>');
      coverMeta = '<meta name="cover" content="cover-img"/>';
    }
    // title page
    oe.file('title.xhtml', xhtmlDoc(title, lang, '<div class="titlepage"><h1>' + esc(o.book) + '</h1>' + (o.author ? '<p class="author">' + esc(o.author) + '</p>' : '') + '<p>' + esc(o.rangeLabel || '') + '</p></div>'));
    manifest.push('<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="titlepage"/>');

    const w = String(chapters.length).length;
    const navItems = [], ncxItems = [];
    chapters.forEach((c, i) => {
      const fid = 'c' + String(i + 1).padStart(w, '0');
      const body = '<section epub:type="chapter" id="' + fid + '">' + '<h2>' + esc(c.title) + '</h2>\n' + toXhtml(chapterHtml(c)) + '</section>';
      oe.file(fid + '.xhtml', xhtmlDoc(c.title, lang, body));
      manifest.push('<item id="' + fid + '" href="' + fid + '.xhtml" media-type="application/xhtml+xml"/>');
      spine.push('<itemref idref="' + fid + '"/>');
      navItems.push('<li><a href="' + fid + '.xhtml">' + esc(c.title) + '</a></li>');
      ncxItems.push('<navPoint id="np' + (i + 1) + '" playOrder="' + (i + 1) + '"><navLabel><text>' + esc(c.title) + '</text></navLabel><content src="' + fid + '.xhtml"/></navPoint>');
    });

    oe.file('nav.xhtml', xhtmlDoc('Contents', lang, '<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>' + navItems.join('\n') + '</ol></nav>'));
    oe.file('toc.ncx', '<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="' + id + '"/></head><docTitle><text>' + esc(title) + '</text></docTitle><navMap>' + ncxItems.join('') + '</navMap></ncx>\n');
    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    oe.file('content.opf', '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="' + esc(lang) + '">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n<dc:identifier id="bookid">' + id + '</dc:identifier>\n<dc:title>' + esc(title) + '</dc:title>\n' +
      (o.author ? '<dc:creator>' + esc(o.author) + '</dc:creator>\n' : '') + '<dc:language>' + esc(lang) + '</dc:language>\n<meta property="dcterms:modified">' + modified + '</meta>\n' + coverMeta + '\n</metadata>\n<manifest>\n' + manifest.join('\n') + '\n</manifest>\n<spine toc="ncx">\n' + spine.join('\n') + '\n</spine>\n</package>\n');
    return zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  /* ------------------------------------------------------------------ *
   * Main: build all output files
   * ------------------------------------------------------------------ */
  const EXT = { txt: 'txt', md: 'md', html: 'html', epub: 'epub' };
  const MIME = { txt: 'text/plain;charset=utf-8', md: 'text/markdown;charset=utf-8', html: 'text/html;charset=utf-8', epub: 'application/epub+zip' };

  /**
   * @param {Array} chapters selected chapters (in order)
   * @param {Array<[number,number]>} groups 0-based index ranges into `chapters`
   * @param {object} o options {format, template, book, author, language, includeTitles, includeToc, includeBookHeader, cover, includeCover, numbering:'original'|'sequential', front, includeFront}
   * @returns {Promise<Array<{name, data, mime, start, end, count}>>}
   */
  async function buildFiles(JSZip, chapters, groups, o, onProgress) {
    const files = [];
    const fmt = EXT[o.format] ? o.format : 'txt';
    const totalChapters = chapters.length ? Math.max(...chapters.map(c => c.index + 1)) : 0;
    const used = new Set();
    for (let g = 0; g < groups.length; g++) {
      if (o.onlyGroup != null && g !== o.onlyGroup) continue; // single-file download keeps real part numbers
      const [a, b] = groups[g];
      let list = chapters.slice(a, b + 1);
      if (!list.length) continue;
      if (g === 0 && o.includeFront && o.front && o.front.text) list = [Object.assign({ index: -1 }, o.front)].concat(list);
      const realList = list.filter(c => c.index >= 0);
      const start = o.numbering === 'sequential' ? a + 1 : realList[0].index + 1;
      const end = o.numbering === 'sequential' ? b + 1 : realList[realList.length - 1].index + 1;
      const ctx = {
        book: P.sanitizeFilename(o.book || 'Book'), start, end, part: g + 1, totalParts: groups.length,
        totalChapters: o.numbering === 'sequential' ? chapters.length : totalChapters, count: realList.length,
        firstTitle: P.sanitizeFilename(realList[0].title).slice(0, 60), lastTitle: P.sanitizeFilename(realList[realList.length - 1].title).slice(0, 60)
      };
      let base = buildName(o.template, ctx);
      let name = base + '.' + EXT[fmt], k = 2;
      while (used.has(name.toLowerCase())) name = base + ' (' + (k++) + ').' + EXT[fmt];
      used.add(name.toLowerCase());
      const rangeLabel = start === end ? 'Chapter ' + start : 'Chapters ' + start + '–' + end;
      const title = (o.book || 'Book') + ' – ' + rangeLabel;
      const opts = Object.assign({}, o, { rangeLabel });
      let data;
      if (fmt === 'txt') data = renderTxt(list, opts);
      else if (fmt === 'md') data = renderMd(list, opts);
      else if (fmt === 'html') data = renderHtml(list, opts, title);
      else data = await renderEpub(JSZip, list, opts, title);
      files.push({ name, data, mime: MIME[fmt], start, end, count: realList.length, title: rangeLabel });
      if (onProgress) onProgress((g + 1) / groups.length);
      if (g % 20 === 19) await new Promise(r => setTimeout(r, 0)); // keep UI responsive
    }
    return files;
  }

  async function zipFiles(JSZip, files, folder, onProgress) {
    const zip = new JSZip();
    const dir = folder ? zip.folder(P.sanitizeFilename(folder)) : zip;
    for (const f of files) dir.file(f.name, f.data, f.name.endsWith('.epub') ? { compression: 'STORE' } : undefined);
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      m => onProgress && onProgress(m.percent / 100));
  }

  return { buildName, buildFiles, zipFiles, renderTxt, renderMd, renderHtml, renderEpub, toXhtml, chapterHtml, MIME };
});
