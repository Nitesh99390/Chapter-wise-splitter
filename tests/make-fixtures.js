// Generates tests/fixtures/*.epub used by tests/selftest.html
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const para = n => Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i + 1} of section ${n}. The wind moved through the old trees and the lamps flickered.</p>`).join('\n');
const x = (title, body) => `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${body}</body></html>`;

async function tricky() {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const files = {
    'text/cover.xhtml': x('Cover', '<div><p>COVER</p></div>'),
    'text/copyright.xhtml': x('Copyright', '<p>Copyright 2026. All rights reserved.</p>'),
    // Part 1 file holds the part heading + chapters 1 and 2 with anchors
    'text/part1.xhtml': x('Part One', '<h1 id="p1">Part One</h1>' +
      '<h2 id="c1">Chapter 1: Arrival</h2>' + para(1) +
      '<h2 id="c2">Chapter 2: The Bridge</h2>' + para(2)),
    'text/ch3.xhtml': x('Chapter 3', '<h2>Chapter 3: Smoke &amp; Ash</h2>' + para(3)),
    'text/ch4.xhtml': x('Chapter 4', '<div class="x"><h2 id="c4">Chapter 4: Night</h2><div>' + para(4) + '</div></div>'),
    'text/about.xhtml': x('About the Author', '<p>The author lives somewhere.</p>')
  };
  for (const [p, c] of Object.entries(files)) z.file('OPS/' + p, c);
  z.file('OPS/nav.xhtml', x('Nav', '<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol>' +
    '<li><a href="text/cover.xhtml">Cover</a></li>' +
    '<li><a href="text/copyright.xhtml">Copyright</a></li>' +
    '<li><a href="text/part1.xhtml#p1">Part One</a><ol>' +
      '<li><a href="text/part1.xhtml#c1">Chapter 1: Arrival</a></li>' +
      '<li><a href="text/part1.xhtml#c2">Chapter 2: The Bridge</a></li>' +
      '<li><a href="text/ch3.xhtml">Chapter 3: Smoke &amp; Ash</a></li></ol></li>' +
    '<li><a href="text/ch4.xhtml#c4">Chapter 4: Night</a></li>' +
    '<li><a href="text/about.xhtml">About the Author</a></li></ol></nav>'));
  const items = Object.keys(files).map((p, i) => `<item id="i${i}" href="${p}" media-type="application/xhtml+xml"/>`).join('');
  const spine = Object.keys(files).map((p, i) => `<itemref idref="i${i}"/>`).join('');
  z.file('OPS/package.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>Tricky Book</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest>${items}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine>${spine}</spine></package>`);
  return z.generateAsync({ type: 'nodebuffer' });
}

// EPUB with a useless TOC (one entry) but many "Chapter N" headings inside one big file, NCX only (EPUB 2)
async function badToc() {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  let body = '';
  for (let i = 1; i <= 30; i++) body += `<p><b>Chapter ${i}</b></p>` + para(i);
  z.file('all.html', x('Everything', body));
  z.file('toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="a"><navLabel><text>Start</text></navLabel><content src="all.html"/></navPoint></navMap></ncx>');
  z.file('content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Bad TOC Book</dc:title></metadata><manifest><item id="a" href="all.html" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="a"/></spine></package>');
  return z.generateAsync({ type: 'nodebuffer' });
}

(async () => {
  const dir = path.join(__dirname, 'fixtures');
  fs.writeFileSync(path.join(dir, 'tricky.epub'), await tricky());
  fs.writeFileSync(path.join(dir, 'badtoc.epub'), await badToc());
  console.log('fixtures written');
})();
