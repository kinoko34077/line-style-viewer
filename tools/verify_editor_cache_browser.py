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
            # Save status already contains the first success. Poll the *actual*
            # second IndexedDB transaction, not the stale preceding toast.
            page.wait_for_function("""async () => {
              const db=await new Promise((ok,fail)=>{
                const r=indexedDB.open('line-style-editor-cache',1);
                r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);
              });
              try {
                const raw=await new Promise((ok,fail)=>{
                  const tx=db.transaction('document','readonly');
                  const r=tx.objectStore('document').get('active');
                  r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);
                });
                return raw?.includes('IDB-SECOND') ?? false;
              } finally { db.close(); }
            }""", timeout=20000)
            print("PRIMARY_PRE_RELOAD",json.dumps({
                "items":texts(page),
                "dbItems":[i["content"] for i in json.loads(page.evaluate(READ_DB))["items"]],
                "status":page.locator("#sourceStatus").inner_text()
            }),flush=True)
            page.wait_for_timeout(1000)
            print("PRIMARY_PRE_RELOAD_LATE",json.dumps({
                "dbItems":[i["content"] for i in json.loads(page.evaluate(READ_DB))["items"]],
                "status":page.locator("#sourceStatus").inner_text()
            }),flush=True)
            page.reload(wait_until="load")
            page.wait_for_timeout(1000)
            actual=texts(page)
            print("PRIMARY_REOPEN_DIAGNOSTIC",json.dumps({
                "items":actual,"status":page.locator("#sourceStatus").inner_text(),
                "dbItems":len(json.loads(page.evaluate(READ_DB))["items"])
            },ensure_ascii=False),flush=True)
            assert actual==["IDB-FIRST","IDB-SECOND"]
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
            # #47: both tabs capture the same original empty revision. The
            # first tab commits atomically; stale tab must not overwrite it.
            c,first=open_page(browser,url)
            stale=c.new_page()
            stale.goto(url,wait_until="load")
            stale.wait_for_function("!!window.talkEditor?.getProject")
            first.evaluate("window.talkEditor.addItem('text','me','PRIMARY-TAB-WINS')")
            saved(first,"ブラウザ内に自動保存しました")
            assert "PRIMARY-TAB-WINS" in first.evaluate(READ_DB)
            stale.evaluate("window.talkEditor.addItem('text','me','STALE-TAB-UNSAVED')")
            stale.wait_for_function("""() =>
              document.querySelector('#sourceStatus')?.textContent?.includes('別タブでトークが更新されました')""",
              timeout=20000)
            assert stale.locator('#editorErrorToast').is_visible()
            assert texts(stale)==["STALE-TAB-UNSAVED"], "stale work stays in memory for export"
            assert texts(first)==["PRIMARY-TAB-WINS"]
            current=json.loads(first.evaluate(READ_DB))
            assert [row["content"] for row in current["items"]]==["PRIMARY-TAB-WINS"]
            assert stale.evaluate("localStorage.getItem('line-style-editor-cache-backup')") is None, (
                "stale-tab conflict must not silently overwrite legacy backup"
            )
            print("CROSS_TAB_REVISION_CONFLICT_PASS",flush=True)
            c.close()
            # A delayed initial read must not grant a fresh blank editor
            # authority to overwrite a previously saved nonempty document.
            c,seed=open_page(browser,url)
            seed.evaluate("window.talkEditor.addItem('text','me','RESTORE-MUST-PRESERVE')")
            saved(seed,"ブラウザ内に自動保存しました")
            seed.close()
            late=c.new_page()
            late.add_init_script("""(() => {
              const nativeDB=window.indexedDB;
              let first=true;
              Object.defineProperty(window,'indexedDB',{
                configurable:true,
                value:{open(...args) {
                  const request=nativeDB.open(...args);
                  if(!first)return request;
                  first=false;
                  return new Proxy(request,{
                    get(target,key) {return Reflect.get(target,key,target);},
                    set(target,key,value) {
                      if(key==='onsuccess'){
                        target.onsuccess=event=>setTimeout(()=>value(event),900);
                        return true;
                      }
                      return Reflect.set(target,key,value,target);
                    }
                  });
                }}
              });
            })();""")
            late.goto(url,wait_until="load")
            late.wait_for_function("!!window.talkEditor?.getProject")
            late.evaluate("window.talkEditor.addItem('text','me','EARLY-UNRESTORED-EDIT')")
            late.wait_for_function("""() =>
                document.querySelector('#sourceStatus')?.textContent?.includes('別タブでトークが更新されました')""",
                timeout=20000)
            assert "EARLY-UNRESTORED-EDIT" in texts(late)
            actual=json.loads(late.evaluate(READ_DB))
            assert [i["content"] for i in actual["items"]]==["RESTORE-MUST-PRESERVE"], (
                "fast edit before async restore must not overwrite the saved project"
            )
            print("EARLY_RESTORE_RACE_DENIED_PASS",flush=True)
            c.close()
            # Mixed-version regression: a pre-CAS tab writes the original raw
            # key without revision metadata. New-version copy must survive.
            c,newer=open_page(browser,url)
            newer.evaluate("window.talkEditor.addItem('text','me','PROTECTED-V2')")
            saved(newer,"ブラウザ内に自動保存しました")
            direct_write="""async raw => {
              const db=await new Promise((resolve,reject)=>{
                const q=indexedDB.open('line-style-editor-cache',1);
                q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
              });
              await new Promise((resolve,reject)=>{
                const t=db.transaction('document','readwrite');
                t.objectStore('document').put(raw,'active');
                t.oncomplete=resolve;t.onabort=()=>reject(t.error);
              }); db.close();
            }"""
            legacy=json.dumps(project([item("PRE-CAS-OLD-TAB")]),ensure_ascii=False)
            newer.evaluate(direct_write,legacy)
            assert "PRE-CAS-OLD-TAB" in newer.evaluate(READ_DB)
            newer.reload(wait_until="load")
            newer.wait_for_function("""() =>
              document.querySelector('#sourceStatus')?.textContent?.includes('旧タブで保存内容が変更されました')""")
            assert texts(newer)==["PROTECTED-V2"], "new protected copy must win on reload"
            newer.evaluate("window.talkEditor.addItem('text','me','NEVER-OVERWRITE-OLD-TAB')")
            newer.wait_for_function("""() =>
              document.querySelector('#sourceStatus')?.textContent?.includes('別タブでトークが更新されました')""",
              timeout=20000)
            assert "PRE-CAS-OLD-TAB" in newer.evaluate(READ_DB)
            protected= newer.evaluate("""async () => {
                const db=await new Promise((ok,fail)=>{
                  const req=indexedDB.open('line-style-editor-cache',1);
                  req.onsuccess=()=>ok(req.result);req.onerror=()=>fail(req.error);
                });
                try{return await new Promise((ok,fail)=>{
                  const tx=db.transaction('document','readonly');
                  const req=tx.objectStore('document').get('active-protected');
                  req.onsuccess=()=>ok(req.result);req.onerror=()=>fail(req.error);
                });}finally{db.close();}
            }""")
            assert [v["content"] for v in json.loads(protected)["items"]]==["PROTECTED-V2"]
            print("LEGACY_TAB_PROTECTED_SNAPSHOT_PASS",flush=True)
            c.close()
            # Before the first post-upgrade save, a legacy direct write must
            # also abort a new-tab transaction by comparing raw active bytes.
            c,firstNew=open_page(browser,url)
            firstNew.wait_for_timeout(250)
            firstNew.evaluate(direct_write,json.dumps(project([item("LEGACY-FIRST")]),ensure_ascii=False))
            firstNew.evaluate("window.talkEditor.addItem('text','me','NOT-CLOBBER-LEGACY')")
            firstNew.wait_for_function("""() =>
              document.querySelector('#sourceStatus')?.textContent?.includes('別タブでトークが更新されました')""",
              timeout=20000)
            assert "LEGACY-FIRST" in firstNew.evaluate(READ_DB)
            print("LEGACY_TAB_FIRST_WRITE_GUARD_PASS",flush=True)
            c.close()
            # Existing nonempty IDB snapshot must not mask a later localStorage
            # fallback and produce a false green "saved" banner on reload.
            c,dirty=open_page(browser,url)
            dirty.evaluate("window.talkEditor.addItem('text','me','DURABLE-ORIGINAL')")
            saved(dirty,"ブラウザ内に自動保存しました")
            dirty.evaluate("""() => {
              const original=IDBDatabase.prototype.transaction;
              IDBDatabase.prototype.transaction=function(name,mode,...args){
                if(mode==='readwrite')throw Error('QuotaExceededError: simulated');
                return original.call(this,name,mode,...args);
              };
            }""")
            dirty.evaluate("window.talkEditor.addItem('text','me','MEMORY-ONLY-NEW')")
            dirty.wait_for_function("""() =>
              document.querySelector('#sourceStatus')?.textContent?.includes('保存先の更新に失敗しました')""",
              timeout=20000)
            assert dirty.locator('#editorErrorToast').is_visible()
            assert texts(dirty)==["DURABLE-ORIGINAL","MEMORY-ONLY-NEW"]
            assert "MEMORY-ONLY-NEW" not in dirty.evaluate(READ_DB)
            assert dirty.evaluate("localStorage.getItem('line-style-editor-cache-backup')") is None
            print("IDB_WRITE_FAIL_NO_FALSE_FALLBACK_PASS",flush=True)
            c.close()
            browser.close()
            print("EDITOR_CACHE_CHROME_PASS primary/reload/sequential/legacy/large/fallback/dual-failure/cross-tab-CAS",
                  flush=True)
    finally:
        server.shutdown()
        server.server_close()

if __name__=="__main__": main()
