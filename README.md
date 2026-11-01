# 📚 Chapter Splitter

Split any **EPUB / TXT / HTML / Markdown** novel into **chapter-wise** files.
You choose **how many chapters go into each file**. Everything runs **in your browser** — no file is ever uploaded.

## 🟢 Easy mode (default)

Three steps, no technical settings:
1. **Choose a file** → 2. **Check chapters** → 3. **Download**

- After detection, a friendly card tells you whether everything looks right.
- If no chapters (or wrong chapters) are found, **one-click suggestion buttons** fix it — no regex or settings needed.
- Encoding, regex, file-name template, TOC depth and similar options only appear in **Advanced** mode (top-right toggle).

## 🐘 Large files (50 MB+) without crashing

- Chapter detection runs in **small time slices**, so the page never hangs, even on a 50 MB file. Progress is shown and loading can be **cancelled**.
- Chapter text is a direct slice of the original text (no line-by-line copies), so memory use stays low (50 MB TXT ≈ 55 MB heap).
- Word counts, short-chapter merging and trimming use plain character loops instead of regex, so no huge arrays are created.
- EPUB text is extracted once and cached; the UI gets a chance to breathe after every HTML file.
- Previews of huge chapters only show the beginning, the table renders 300 rows at a time, and export is time-sliced too.
- Choosing a new file cancels the previous job and frees the old book from memory.
- Running out of memory shows a clear message instead of crashing. Files over 300 MB are rejected up front.

**Tested (headless Chromium):** 3000 chapters found in a 50.8 MB TXT in ~1.2 s, with the UI never blocked longer than ~0.17 s. A 60-file TXT ZIP was built in ~8 s and an EPUB ZIP in ~12 s. A 3000-chapter EPUB was detected in ~9 s. No crashes.

## ✨ Features

**Input:** `.epub` (EPUB 2 + 3), `.txt`, `.html`, `.md`
- Encoding is auto-detected (UTF-8, UTF-16, GBK and more), or pick one manually. Changing the encoding re-reads the file automatically.
- Unsupported formats (PDF, MOBI, DOCX…) get a clear message suggesting conversion to EPUB.

**Smart chapter detection**
- EPUB: uses the book's table of contents (nav / NCX) with precise cuts down to `#anchor` level. Falls back to heading text automatically if the TOC is broken. A "one HTML file = one chapter" mode is also available.
- Cover, copyright, contents, "About the author" and similar pages are skipped automatically.
- Recognised headings: `Chapter 12`, `CHAPTER XII`, `Chapter Twelve`, `Ch. 5`, `Episode 3`, `अध्याय ५`, `भाग 2`, `第十二章`, `Prologue / Epilogue / Side Story`, `Part / Volume`, bare numbers (`1.`, `003`), Markdown `#`, and **custom regex**.
- Each pattern shows how many headings it matches.
- Subtitle merge: "Chapter 1" + the next line "The Beginning" become one title.
- Minimum length slider: tiny fake chapters (e.g. a contents list) are merged automatically.

**Chapter editor**
- Search, select / deselect, or select a range. While searching, the bulk select buttons only affect matching chapters.
- Click a title to rename it.
- ⤒ merges a chapter into the previous one.
- ✂ splits a chapter in two at any paragraph.
- 👁 opens a preview (◀ ▶ keys for previous / next chapter).

**Split options**
- **Chapters per file** (1, 5, 10, 20, 50, 100… or any number)
- **Total files**: chapters are distributed evenly
- **Custom ranges**: e.g. `1-10, 11-25, 26-`

**Output:** TXT, EPUB 3 (with NCX, keeps the original cover), HTML (reader styling + TOC), Markdown
- File name template: `{book} {range} {start} {end} {part} {total} {first} {count}`
- The output preview shows exactly the file names that will be downloaded. Download files one by one or as a single ZIP.
- Dark mode, and settings are remembered. Shortcut: <kbd>Ctrl</kbd>+<kbd>Enter</kbd> downloads the ZIP.

## 🚀 Running it

It's a static site with no build step:

```bash
npm start            # = python3 -m http.server 8080
# open http://localhost:8080
```

Deploy it to any static host, such as GitHub Pages, Netlify or Cloudflare Pages.

## 🧪 Tests

```bash
npm install          # jszip (only needed for fixture generation)
npm run fixtures     # builds tests/fixtures/*.epub
npm start &          # server
pip install playwright && python3 -m playwright install --with-deps chromium
npm test             # browser self-test + end-to-end UI test
npm run fixtures:big # ~50 MB big.txt + 3000-chapter big.epub (tests/fixtures/big, git-ignored)
npm run test:stress  # loads + exports the big files through the UI, checks freeze time & memory
```

You can also open `tests/selftest.html` in a browser to run the unit tests.

## 📁 Structure

```
index.html          UI
css/style.css       Styling (light + dark)
js/parser.js        Heading detection, number parsing, grouping (DOM-free, also runs in Node)
js/reader.js        EPUB / TXT / HTML readers, TOC slicing
js/exporter.js      TXT / MD / HTML / EPUB writers, file naming + ZIP
js/app.js           UI controller
js/sample.js        Built-in demo novel
vendor/jszip.min.js JSZip 3.10.1 (MIT)
tests/              Fixtures, browser self-test, Playwright e2e
```
