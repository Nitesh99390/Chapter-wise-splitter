"""End-to-end UI test. Usage: python3 tests/e2e.py [base_url]  (server must be running)"""
import sys, zipfile, io, os
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
HERE = os.path.dirname(os.path.abspath(__file__))
fails = []

def check(cond, name, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f" -> {extra}" if extra else ""))
    if not cond:
        fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))

    # 1. self-test page
    page.goto(f"{BASE}/tests/selftest.html")
    page.wait_for_function("document.getElementById('sum').textContent.includes('passed')", timeout=20000)
    summary = page.inner_text("#sum")
    check("0 failed" in summary, "browser selftest", summary)

    # 2. main app with sample
    page.goto(BASE + "/")
    page.evaluate("localStorage.clear()")
    page.reload()
    page.click("#sampleBtn")
    page.wait_for_selector("#chapterBody tr")
    rows = page.locator("#chapterBody tr").count()
    check(rows == 14, "sample: 14 chapter rows", rows)
    check("14 chapters" in page.inner_text("#detectBadge"), "badge shows count", page.inner_text("#detectBadge"))

    # Easy mode (default): technical options hidden, friendly hint card shown
    check(not page.is_visible("#customRe") and not page.is_visible("#template") and not page.is_visible("#encoding"), "easy mode hides technical options")
    check(page.is_visible("#detectHints .hint-card.ok") and "mil gaye" in page.inner_text("#detectHints"), "friendly success hint shown", page.inner_text("#detectHints")[:80])
    check(page.is_visible("#howto"), "how-it-works strip visible")
    page.screenshot(path="/tmp/cs-easy.png", full_page=True)

    # no-chapter hint with one-click fix (bare numbered headings)
    page.evaluate("CS.App.loadFile(new File([Array.from({length:8},(_,i)=>(i+1)+'.\\n'+'lorem ipsum dolor sit amet. '.repeat(40)).join('\\n\\n')],'nums.txt',{type:'text/plain'}))")
    page.wait_for_selector("#detectHints .hint-card.warn")
    check(page.is_visible("#detectHints button[data-fix=numbered]"), "no-chapter hint suggests 'numbers' fix")
    page.click("#detectHints button[data-fix=numbered]")
    page.wait_for_function("document.querySelector('#detectBadge').textContent.includes('8 chapters')")
    check(True, "one-click fix detects 8 numbered chapters")
    page.evaluate("localStorage.clear()")
    page.reload()
    page.click("#sampleBtn")
    page.wait_for_selector("#chapterBody tr")

    # per file = 5 -> 3 files
    page.fill("#perFile", "5")
    page.dispatch_event("#perFile", "input")
    check(page.locator("#planList li").count() == 3, "plan: 3 files for 5/file")
    check("14 chapters → 3 files" in page.inner_text("#planSummary"), "plan summary", page.inner_text("#planSummary"))
    page.screenshot(path="/tmp/cs-main.png", full_page=True)

    # download ZIP (TXT)
    with page.expect_download() as d:
        page.click("#downloadZip")
    z = zipfile.ZipFile(io.BytesIO(open(d.value.path(), "rb").read()))
    names = sorted(n for n in z.namelist() if not n.endswith("/"))
    check(len(names) == 3 and names[0].endswith("Chapters 01-05.txt") and names[0].startswith("The Clockmakers City (sample) (TXT)/"), "zip: 3 txt files inside folder", names)
    first = z.read(names[0]).decode()
    check(first.startswith("Prologue") and "Chapter 1: The Frozen Clock" in first, "zip: txt content ok")

    # total files mode + EPUB format
    page.click("#splitMode button[data-v=files]")
    page.fill("#fileCount", "2"); page.dispatch_event("#fileCount", "input")
    page.click("#formatCards button[data-v=epub]")
    check(page.locator("#planList li").count() == 2, "files mode: 2 files")
    with page.expect_download() as d:
        page.click("#downloadZip")
    z = zipfile.ZipFile(io.BytesIO(open(d.value.path(), "rb").read()))
    epubs = [n for n in z.namelist() if not n.endswith("/")]
    check(len(epubs) == 2 and all(n.endswith(".epub") for n in epubs), "zip: 2 epub files", epubs)

    # custom ranges (advanced-only)
    check(not page.is_visible("#splitMode button[data-v=ranges]"), "ranges hidden in easy mode")
    page.click("#uiMode button[data-v=advanced]")
    check(page.is_visible("#template") and page.is_visible("#encoding") and page.is_visible("#detectDetails summary"), "advanced mode shows all options")
    page.click("#splitMode button[data-v=ranges]")
    page.fill("#ranges", "1-3, 4-10, 11-"); page.dispatch_event("#ranges", "input")
    check(page.locator("#planList li").count() == 3, "ranges: 3 files")
    page.fill("#ranges", "50-60"); page.dispatch_event("#ranges", "input")
    check(page.is_visible("#planErr") and page.is_disabled("#downloadZip"), "ranges: error shown + download disabled")

    # deselect chapters + merge
    page.click("#splitMode button[data-v=per]")
    page.locator("#chapterBody tr").first.locator(".rowchk").uncheck()
    check("13 chapters" in page.inner_text("#planSummary"), "deselect updates plan", page.inner_text("#planSummary"))
    page.locator("#chapterBody tr").nth(2).locator("button[data-act=merge]").click()
    check(page.locator("#chapterBody tr").count() == 13, "merge reduces rows")

    # preview modal
    page.locator("#chapterBody tr").nth(1).locator("button[data-act=preview]").click()
    check(page.is_visible("#modal") and "Frozen Clock" in page.inner_text("#modalTitle"), "preview modal opens", page.inner_text("#modalTitle"))
    page.keyboard.press("Escape")

    # 3. EPUB upload through file input
    page.set_input_files("#fileInput", os.path.join(HERE, "fixtures", "tricky.epub"))
    page.wait_for_function("document.querySelector('#detectBadge').textContent.includes('via')", timeout=15000)
    check(page.locator("#chapterBody tr").count() == 4, "epub upload: 4 chapters", page.inner_text("#detectBadge"))
    check(page.input_value("#bookTitle") == "Tricky Book", "epub: title filled")
    page.set_input_files("#fileInput", os.path.join(HERE, "fixtures", "badtoc.epub"))
    page.wait_for_function("document.querySelector('#detectBadge').textContent.includes('30 chapters')", timeout=15000)
    check(True, "bad-toc epub: 30 chapters via heading text")
    page.screenshot(path="/tmp/cs-epub.png", full_page=False)

    # dark mode screenshot
    page.click("#themeBtn")
    page.screenshot(path="/tmp/cs-dark.png")
    check(not errors, "no JS errors", errors)
    b.close()

print("\nRESULT:", "ALL PASSED" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
