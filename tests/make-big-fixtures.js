// Generates large stress-test inputs in tests/fixtures/big/ (git-ignored):
//   big.txt   ~50 MB plain text, 3000 chapters (Chapter N: Title)
//   big.epub  ~3000 chapters across 300 XHTML files with a nav TOC (anchors)
// Usage: node tests/make-big-fixtures.js [sizeMB]
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const MB = parseFloat(process.argv[2]) || 50;
const dir = path.join(__dirname, 'fixtures', 'big');
fs.mkdirSync(dir, { recursive: true });

const words = 'the old clockmaker walked slowly through the silent city while lamps flickered and wind moved over rooftops carrying whispers of a forgotten song'.split(' ');
let seed = 7;
const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
function paragraph() {
  const len = 40 + rnd(60);
  const out = [];
  for (let i = 0; i < len; i++) out.push(words[rnd(words.length)]);
  const s = out.join(' ');
  return s[0].toUpperCase() + s.slice(1) + '.';
}

/* ---------- big.txt ---------- */
const target = MB * 1024 * 1024;
const chapters = 3000;
const perChapter = Math.floor(target / chapters);
const fd = fs.openSync(path.join(dir, 'big.txt'), 'w');
fs.writeSync(fd, 'The Endless Clock\nby Stress Test\n\nContents\nChapter 1\nChapter 2\nChapter 3\n\n');
let written = 0;
for (let c = 1; c <= chapters; c++) {
  let body = 'Chapter ' + c + ': The Hour of ' + c + '\n\n';
  while (body.length < perChapter) body += paragraph() + '\n\n';
  fs.writeSync(fd, body);
  written += body.length;
}
fs.closeSync(fd);
console.log('big.txt', (fs.statSync(path.join(dir, 'big.txt')).size / 1048576).toFixed(1) + ' MB,', chapters, 'chapters');

/* ---------- big.epub ---------- */
(async () => {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const files = 300, perFile = 10, chLen = Math.floor((MB * 0.6 * 1024 * 1024) / (files * perFile));
  const manifest = [], spine = [], nav = [];
  let n = 0;
  for (let f = 1; f <= files; f++) {
    let body = '';
    for (let k = 0; k < perFile; k++) {
      n++;
      body += '<h2 id="c' + n + '">Chapter ' + n + ': Gear ' + n + '</h2>';
      let len = 0;
      while (len < chLen) { const p = '<p>' + paragraph() + '</p>\n'; body += p; len += p.length; }
      nav.push('<li><a href="t' + f + '.xhtml#c' + n + '">Chapter ' + n + ': Gear ' + n + '</a></li>');
    }
    z.file('OEBPS/t' + f + '.xhtml', '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Part ' + f + '</title></head><body>' + body + '</body></html>');
    manifest.push('<item id="t' + f + '" href="t' + f + '.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="t' + f + '"/>');
  }
  z.file('OEBPS/nav.xhtml', '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head><body><nav epub:type="toc"><ol>' + nav.join('') + '</ol></nav></body></html>');
  z.file('OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">big</dc:identifier><dc:title>Big Epub</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' + manifest.join('') + '</manifest><spine>' + spine.join('') + '</spine></package>');
  const buf = await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(path.join(dir, 'big.epub'), buf);
  console.log('big.epub', (buf.length / 1048576).toFixed(1) + ' MB zipped,', n, 'chapters,', files, 'files');
})();
