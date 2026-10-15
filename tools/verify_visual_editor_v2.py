#!/usr/bin/env python3
"""M3 opt-in cross-site Visual Editor compatibility check; no production deployment."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

def main():
    server=ThreadingHTTPServer(("127.0.0.1",0),partial(QuietHandler,directory=str(ROOT)))
    worker=Thread(target=server.serve_forever,daemon=True)
    worker.start()
    origin="http://127.0.0.1:"+str(server.server_address[1])+"/index.html"
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(args=["--no-sandbox","--disable-dev-shm-usage"])
            try:
                for width in (390,1280):
                    context=browser.new_context(viewport={"width":width,"height":844})
                    page=context.new_page()
                    errors=[]
                    page.on("pageerror",lambda e:errors.append(str(e)))
                    page.goto(origin,wait_until="domcontentloaded")
                    assert page.locator("#visual-editor-v2").count()==0
                    page.goto(origin+"?visual_editor_v2=1",wait_until="domcontentloaded")
                    page.wait_for_function("!!document.querySelector('#visual-editor-v2')?.shadowRoot?.querySelector('#apply')")
                    page.wait_for_function("!!window.talkEditor")
                    app_before=page.evaluate("window.talkEditor.getProject()")
                    panel=page.locator("#visual-editor-v2")
                    panel.locator("#node").select_option("line.conversation.title")
                    panel.locator("#prop").select_option("font-size")
                    panel.locator("#value").fill("27px")
                    panel.locator("#apply").click()
                    page.wait_for_function("getComputedStyle(document.querySelector('#conversationTitle')).fontSize==='27px'")
                    with page.expect_download() as css_download:
                        panel.locator("#exportcss").click()
                    assert css_download.value.suggested_filename=="visual-editor-overrides.css"
                    with page.expect_download() as proposal_download:
                        panel.locator("#exportpatch").click()
                    assert proposal_download.value.suggested_filename=="visual-editor-proposal.json"
                    assert page.evaluate("window.talkEditor.getProject()")==app_before
                    assert "27px" in page.evaluate("localStorage.getItem('line-style-viewer:visual-editor-v2:v1')")
                    page.evaluate("""() => {
                      const title=document.querySelector('#conversationTitle');
                      title.replaceWith(title.cloneNode(true));
                    }""")
                    assert page.locator("#conversationTitle").evaluate("e=>getComputedStyle(e).fontSize")=="27px"
                    panel.locator("#undo").click()
                    page.wait_for_function("getComputedStyle(document.querySelector('#conversationTitle')).fontSize!=='27px'")
                    panel.locator("#redo").click()
                    page.wait_for_function("getComputedStyle(document.querySelector('#conversationTitle')).fontSize==='27px'")
                    panel.locator("#preview").click()
                    page.locator("#composeInput").fill("pilot-message")
                    page.locator("#sendButton").click()
                    assert len(page.evaluate("window.talkEditor.getProject().items"))==1
                    page.locator("#undoButton").click()
                    assert len(page.evaluate("window.talkEditor.getProject().items"))==0
                    assert page.locator("#conversationTitle").evaluate("e=>getComputedStyle(e).fontSize")=="27px"
                    page.reload(wait_until="domcontentloaded")
                    page.wait_for_function("!!document.querySelector('#visual-editor-v2')?.shadowRoot")
                    assert page.locator("#conversationTitle").evaluate("e=>getComputedStyle(e).fontSize")=="27px"
                    assert not errors,errors
                    context.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print("M3 STATIC PILOT: opt-in, stable re-render, private state, undo separation, 390/1280 PASS")

if __name__=="__main__":
    main()
