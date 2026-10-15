#!/usr/bin/env python3
"""#60: real-origin Chromium persistence, legacy cache migration and failure boundaries."""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
KEY = "line-style-editor-cache-backup"
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args): pass

def item(value):
    return {"id":"legacy-1","type":"text","side":"me","speaker":"自分",
            "time":"12:00","content":value,"media":None}

def project(items):
    return {"version":1,"title":"トーク","self":"自分","mode":"direct",
            "scale":120,"theme":"normal",
            "participants":[{"name":"自分","avatar":""},{"name":"相手","avatar":""}],
            "items":items}

READ_DB = """async () => {
  const db=await new Promise((resolve,reject)=>{
    const req=indexedDB.open('line-style-editor-cache',1);
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('document','readonly');
      const req=tx.objectStore('document').get('active');
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
  } finally { db.close(); }
}"""

def open_page(browser, url):
    context=browser.new_context(viewport={"width":390,"height":844})
    page=context.new_page()
    page.goto(url, wait_until="load")
    page.wait_for_function("!!window.talkEditor?.getProject")
    return context, page

def saved(page, kind):
    page.wait_for_function("(state) => document.querySelector('#sourceStatus')?.textContent===state",
                           arg=kind, timeout=20000)

def texts(page):
    return page.evaluate("window.talkEditor.getProject().items.map(i=>i.content)")

def main():
    server=ThreadingHTTPServer(("127.0.0.1",0),partial(QuietHandler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(args=["--no-sandbox","--disable-dev-shm-usage"])
            url=f"http://127.0.0.1:{server.server_port}/"
            # Fresh IndexedDB primary path, page restart and orderly writes.
            c,page=open_page(browser,url)
            page.evaluate("window.talkEditor.addItem('text','me','IDB-FIRST')")
            saved(page,"ブラウザ内に自動保存しました")
            assert "IDB-FIRST" in page.evaluate(READ_DB)
            page.evaluate("window.talkEditor.addItem('text','me','IDB-SECOND')")
            saved(page,"ブラウザ内に自動保存しました")
            assert "IDB-SECOND" in page.evaluate(READ_DB)
            page.reload(wait_until="load")
            page.wait_for_function("window.talkEditor?.getProject().items.length===2")
            assert texts(page)==["IDB-FIRST","IDB-SECOND"]
            c.close()
            # Previously issued releases saved only to localStorage.
            c,page=open_page(browser,url)
            page.evaluate("([key,raw])=>localStorage.setItem(key,raw)",[KEY,json.dumps(project([item("LEGACY")]),ensure_ascii=False)])
            page.reload(wait_until="load")
            page.wait_for_function("window.talkEditor?.getProject().items.length===1")
            assert texts(page)==["LEGACY"]
            page.evaluate("window.talkEditor.addItem('text','me','MIGRATED')")
            saved(page,"ブラウザ内に自動保存しました")
            assert "LEGACY" in page.evaluate(READ_DB)
            page.reload(wait_until="load")
            page.wait_for_function("window.talkEditor?.getProject().items.length===2")
            assert texts(page)==["LEGACY","MIGRATED"]
            c.close()
            # Large document must use IndexedDB instead of the <=1.6m backup cap.
            c,page=open_page(browser,url)
            page.evaluate("""() => {
              const doc=window.talkEditor.getProject();
              doc.items=Array.from({length:9},(_,n)=>({
                id:'large-'+n,type:'text',side:'me',speaker:'自分',
                time:'12:00',content:'a'.repeat(195000),media:null
              }));
              window.talkEditor.replaceProject(doc);
            }""")
            saved(page,"ブラウザ内に自動保存しました")
            large=page.evaluate(READ_DB)
            assert len(large)>1600000,len(large)
            assert len(json.loads(large)["items"])==9
            c.close()
            # IndexedDB inaccessible: legacy backup remains a truthful fallback.
            c,page=open_page(browser,url)
            page.evaluate("""() => Object.defineProperty(window,'indexedDB',
                {configurable:true,value:null})""")
            page.evaluate("window.talkEditor.addItem('text','me','FALLBACK')")
            saved(page,"簡易キャッシュに自動保存しました")
            assert "FALLBACK" in page.evaluate("localStorage.getItem('line-style-editor-cache-backup')")
            c.close()
            # Both paths denied: do not claim saved and show an actionable warning.
            c,page=open_page(browser,url)
            page.evaluate("""() => {
              Object.defineProperty(window,'indexedDB',{configurable:true,value:null});
              Storage.prototype.setItem=function(){throw new Error('quota')};
            }""")
            page.evaluate("window.talkEditor.addItem('text','me','NO-STORAGE')")
            saved(page,"自動保存ができません。右上の保存でJSONを書き出してください")
            assert page.locator("#editorErrorToast").is_visible()
            c.close()
            browser.close()
            print("EDITOR_CACHE_CHROME_PASS primary/reload/sequential/legacy/large/fallback/dual-failure",
                  flush=True)
    finally:
        server.shutdown()
        server.server_close()

if __name__=="__main__": main()
