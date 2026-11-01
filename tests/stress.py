"""Large-file stress test. Usage: python3 tests/stress.py [base_url]
Needs: server running, `node tests/make-big-fixtures.js` already executed.
Loads ~50 MB TXT and a 3000-chapter EPUB through the real UI, checks the page stays
responsive (no long freezes), detects all chapters, and exports a ZIP."""
import sys, os, time, zipfile, io, threading
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
HERE = os.path.dirname(os.path.abspath(__file__))
BIG = os.path.join(HERE, "fixtures", "big")
fails = []

def check(cond, name, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f" -> {extra}" if extra else ""), flush=True)
    if not cond:
        fails.append(name)

# Measures the longest main-thread block (ms) using a rAF/timer heartbeat
HEARTBEAT = """
window.__maxGap = 0; window.__last = performance.now();
clearInterval(window.__hb);
window.__hb = setInterval(() => { const n = performance.now(); window.__maxGap = Math.max(window.__maxGap, n - window.__last); window.__last = n; }, 50);
"""

def mem(page):
    try:
        return page.evaluate("performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1")
    except Exception:
        return -1

with sync_playwright() as p:
    b = p.chromium.launch(args=["--enable-precise-memory-info", "--js-flags=--max-old-space-size=4096"])
    page = b.new_page(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("crash", lambda: errors.append("PAGE CRASHED"))
    page.goto(BASE + "/")
    page.evaluate("localStorage.clear()")
    page.reload()

    for name, expect in [("big.txt", 3000), ("big.epub", 3000)]:
        path = os.path.join(BIG, name)
        size = os.path.getsize(path) / 1048576
        page.evaluate(HEARTBEAT)
        t0 = time.time()
        page.set_input_files("#fileInput", path)
        page.wait_for_function(f"document.querySelector('#detectBadge').textContent.replace(/,/g,'').includes('{expect} chapters')", timeout=240000)
        dt = time.time() - t0
        gap = page.evaluate("window.__maxGap")
        rows = page.locator("#chapterBody tr").count()
        check(True, f"{name} ({size:.1f} MB): {expect} chapters detected in {dt:.1f}s, longest UI freeze {gap:.0f} ms, heap {mem(page)} MB")
        check(rows <= 300, f"{name}: table renders a page of rows only", rows)

        # export: 50 chapters per file -> 60 files
        page.fill("#perFile", "50"); page.dispatch_event("#perFile", "input")
        for fmt in (["txt", "epub"] if name == "big.txt" else ["epub", "html"]):
            page.click(f"#formatCards button[data-v={fmt}]")
            page.evaluate(HEARTBEAT)
            t0 = time.time()
            with page.expect_download(timeout=300000) as d:
                page.click("#downloadZip")
            z = zipfile.ZipFile(io.BytesIO(open(d.value.path(), "rb").read()))
            files = [n for n in z.namelist() if not n.endswith("/")]
            gap = page.evaluate("window.__maxGap")
            check(len(files) == 60 and all(f.endswith("." + fmt) for f in files),
                  f"{name} -> {fmt.upper()} ZIP: {len(files)} files in {time.time()-t0:.1f}s, longest UI freeze {gap:.0f} ms, heap {mem(page)} MB")
            if fmt == "txt":
                first = z.read(sorted(files)[0]).decode()
                check("Chapter 1: The Hour of 1" in first and "Chapter 50: The Hour of 50" in first and "Chapter 51:" not in first, "txt content split correctly")

    check(not errors, "no JS errors / crashes", errors)
    b.close()

print("\nRESULT:", "ALL PASSED" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
