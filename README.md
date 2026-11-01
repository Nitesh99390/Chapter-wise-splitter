# 📚 Chapter Splitter

Kisi bhi **EPUB / TXT / HTML / Markdown** novel ko **chapter-wise** files me split karein.
Aap choose karte hain ki **ek file me kitne chapters** hon. Sab kuch **aapke browser me** hota hai, koi file upload nahi hoti.

## 🟢 Easy mode (default)

Bina kisi technical setting ke 3 step me kaam:
1. **File chunein** → 2. **Chapters check karein** → 3. **Download**

- Chapter detect hone ke baad ek friendly card batata hai ki sab theek hai ya nahi.
- Agar chapters na milein / galat milein to **one-click "Try karein" buttons** milte hain (regex ya settings chhedne ki zaroorat nahi).
- Encoding, regex, file-name template, TOC depth jaise options sirf **Advanced** mode (top-right toggle) me dikhte hain.

## 🐘 Badi files (50 MB+) bina crash ke

- Chapter detection **chhote time-slices** me chalti hai, isliye 50 MB ki file pe bhi page hang nahi hota. Progress % dikhta hai aur file load hote waqt **Cancel** ka button bhi milta hai.
- Chapter text original text ka seedha slice hota hai, line-by-line copy nahi banti. Isliye memory kam lagti hai (50 MB TXT ≈ 55 MB heap).
- Word count, short-chapter merge aur trim regex ke bina sirf char loop se hote hain, to bade arrays nahi bante.
- EPUB ka text ek baar nikal kar cache hota hai. Har HTML file ke baad UI ko saans lene ka mauka milta hai.
- Badi chapters ka preview sirf shuru ka hissa dikhata hai, table me ek baar me 300 rows aati hain, aur export bhi time-sliced hai.
- Nayi file chunte hi purana kaam cancel ho jata hai aur purani book memory se hat jaati hai.
- Memory khatam hone par crash ki jagah samajh me aane wala message aata hai. 300 MB se badi file pehle hi mana kar di jaati hai.

**Test kiya hua (headless Chromium):** 50.8 MB TXT me 3000 chapters ~1.2 s me mile, UI sabse lamba sirf ~0.17 s ruka. 60 files ka TXT ZIP ~8 s me aur EPUB ZIP ~12 s me bana. 3000 chapters wala EPUB ~9 s me detect hua. Koi crash nahi hua.

## ✨ Features

**Input:** `.epub` (EPUB 2 + 3), `.txt`, `.html`, `.md`
- Encoding auto-detect hoti hai (UTF-8, UTF-16, GBK, aur bhi), ya aap khud chun sakte hain.

**Smart chapter detection**
- EPUB: book ke Table of Contents (nav / NCX) se, `#anchor` level tak precise cut. Agar TOC kharab ho to apne aap heading text pe switch ho jata hai. "Per HTML file" mode bhi hai.
- Cover, copyright, contents, "About the author" jaise pages apne aap skip hote hain.
- Ye headings pehchani jaati hain: `Chapter 12`, `CHAPTER XII`, `Chapter Twelve`, `Ch. 5`, `Episode 3`, `अध्याय ५`, `भाग 2`, `第十二章`, `Prologue / Epilogue / Side Story`, `Part / Volume`, sirf numbers (`1.`, `003`), Markdown `#`, aur **custom regex**.
- Har pattern ke saath dikhta hai ki wo kitni headings match kar raha hai.
- Subtitle merge: "Chapter 1" + agli line "The Beginning" ek title ban jaati hai.
- Minimum length slider: chhote fake chapters (jaise contents list) apne aap merge ho jaate hain.

**Chapter editor**
- Search karein, select / deselect karein, ya ek range select karein.
- Title pe click karke rename karein.
- ⤒ se kisi chapter ko pichhle chapter me merge karein.
- ✂ se kisi chapter ko kisi bhi paragraph se do hisso me todein.
- 👁 se preview dekhein (◀ ▶ keys se agla / pichhla chapter).

**Split options**
- **Chapters per file** (1, 5, 10, 20, 50, 100… ya koi bhi number)
- **Total files**: chapters barabar baante jaate hain
- **Custom ranges**: jaise `1-10, 11-25, 26-`

**Output:** TXT, EPUB 3 (NCX ke saath, original cover rakhta hai), HTML (reader style + TOC), Markdown
- File name template: `{book} {range} {start} {end} {part} {total} {first} {count}`
- Output preview dikhta hai, aur aap ek-ek file ya poora ZIP download kar sakte hain.
- Dark mode hai, aur settings yaad rakhi jaati hain. Shortcut: <kbd>Ctrl</kbd>+<kbd>Enter</kbd> se ZIP download.

## 🚀 Kaise chalayein

Ye ek static site hai, isme build step nahi hai:

```bash
npm start            # = python3 -m http.server 8080
# open http://localhost:8080
```

Ise GitHub Pages, Netlify, Cloudflare Pages jaisi kisi bhi static hosting par daal sakte hain.

## 🧪 Tests

```bash
npm install          # jszip (sirf fixture generation ke liye)
npm run fixtures     # tests/fixtures/*.epub banata hai
npm start &          # server
pip install playwright && python3 -m playwright install chromium
npm test             # browser self-test + end-to-end UI test
npm run fixtures:big # ~50 MB big.txt + 3000-chapter big.epub (tests/fixtures/big, git-ignored)
npm run test:stress  # bade files UI se load + export, freeze time & memory check
```

`tests/selftest.html` ko browser me khol kar bhi unit tests chala sakte hain.

## 📁 Structure

```
index.html          UI
css/style.css       Styling (light + dark)
js/parser.js        Heading detection, number parsing, grouping (DOM-free, Node me bhi chalta hai)
js/reader.js        EPUB / TXT / HTML readers, TOC slicing
js/exporter.js      TXT / MD / HTML / EPUB writers + ZIP
js/app.js           UI controller
js/sample.js        Built-in demo novel
vendor/jszip.min.js JSZip 3.10.1 (MIT)
tests/              Fixtures, browser self-test, Playwright e2e
```
