#!/usr/bin/env python3
"""#69: real Chromium bracket/call card/side-preservation/inline-edit regression."""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args): pass

def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            for width in (390, 768):
                context = browser.new_context(viewport={"width":width,"height":844}, accept_downloads=True)
                page = context.new_page()
                errors=[]
                page.on("pageerror", lambda e:errors.append(str(e)))
                page.goto(f"http://127.0.0.1:{server.server_port}/index.html",wait_until="load")
                page.wait_for_function("!!window.talkEditor")
                rows=[
                    "12:00\t相手\t[不在着信]",
                    "12:01\t自分\t[通話時間 00:15]",
                    "12:02\t相手\t[写真]",
                    "12:03\t相手\t[ファイル]",
                    "12:04\t相手\t[任意の記録]",
                    "12:05\t相手\t括弧[不在着信]は通常文",
                ]
                page.evaluate("""s => {
                    const parsed=parseText(parseMultiline(s));
                    window.talkEditor.loadParsed(parsed,'自分','direct');
                }""","\n".join(rows))
                doc=page.evaluate("window.talkEditor.getProject()")
                assert [x["entryKind"] for x in doc["items"]]==[
                    "call","call","media","media","annotation","text"],doc["items"]
                ids=[x["id"] for x in doc["items"]]
                for i in (0,1):
                    row=page.locator(f'[data-entry-id="{ids[i]}"]')
                    assert row.get_attribute("data-entry-kind")=="call"
                    assert row.locator(".editor-call-card").count()==1
                assert "00:15" in page.locator(f'[data-entry-id="{ids[1]}"] .editor-call-label').inner_text()
                assert page.locator(f'[data-entry-id="{ids[4]}"] .editor-annotation-chip').count()==1
                assert page.locator(f'[data-entry-id="{ids[5]}"] .editor-call-card').count()==0
                # Double-tap card, edit the literal transport brackets, reclassify.
                callrow=page.locator(f'[data-entry-id="{ids[0]}"]')
                callrow.locator(".editor-call-card").dblclick()
                editor=callrow.locator("[data-edit-body]")
                assert editor.get_attribute("contenteditable")=="true"
                assert editor.inner_text()=="[不在着信]"
                editor.fill("[通話時間 00:42]")
                editor.press("Tab")
                updated=next(x for x in page.evaluate("window.talkEditor.getProject().items") if x["id"]==ids[0])
                assert (updated["type"],updated["entryKind"],updated["callKind"],updated["content"])==(
                    "call","call","duration","[通話時間 00:42]"),updated
                # Bracket media has its own inline raw-text edit affordance, not a plain bubble.
                photo=page.locator(f'[data-entry-id="{ids[2]}"]')
                photo.locator(".entry-token-caption").dblclick()
                assert photo.locator("[data-edit-body]").inner_text()=="[写真]"
                photo.locator("[data-edit-body]").press("Tab")
                # Native-like long-press touch move of one semantic record across zones.
                def move(item_id, zone, kind="call"):
                    page.evaluate("""async ({id,side}) => {
                      const row=document.querySelector('[data-entry-id="'+id+'"]');
                      const grip=row.querySelector('.balloon,.edit-system');
                      const r=grip.getBoundingClientRect(),bound=document.getElementById('chatContainer').getBoundingClientRect();
                      const x=r.left+r.width/2,y=r.top+r.height/2;
                      const target=bound.left+bound.width*(side==='you'?.1:side==='me'?.9:.5);
                      const event=(type,px,py)=>grip.dispatchEvent(new PointerEvent(type,{
                        bubbles:true,button:0,buttons:type==='pointerup'?0:1,
                        pointerId:97,pointerType:'touch',clientX:px,clientY:py
                      }));
                      event('pointerdown',x,y);
                      await new Promise(resolve=>setTimeout(resolve,425));
                      event('pointermove',target,y+32);event('pointerup',target,y+32);
                    }""",{"id":item_id,"side":zone})
                    entry=next(x for x in page.evaluate("window.talkEditor.getProject().items") if x["id"]==item_id)
                    assert entry["side"]==zone,entry
                    assert entry["entryKind"]==kind,entry
                    if kind=="call":
                        assert entry["type"]=="call" and entry["content"]=="[通話時間 00:42]",entry
                        assert page.locator(f'[data-entry-id="{item_id}"] .editor-call-card').count()==1
                    if kind=="media":
                        assert entry["type"]=="attachment" and entry["content"]=="[写真]",entry
                for zone in ("system","me","you"):
                    move(ids[0],zone)
                # Media remains media (including the picker) in all three zones.
                move(ids[2],"system","media")
                assert page.locator(f'[data-entry-id="{ids[2]}"] .editor-token-card').count()==1
                assert page.locator(f'[data-entry-id="{ids[2]}"] .editor-token-picker').count()==1
                page.locator(f'[data-entry-id="{ids[2]}"] .entry-token-caption').dblclick()
                assert page.locator(f'[data-entry-id="{ids[2]}"] [data-edit-body]').inner_text()=="[写真]"
                page.locator(f'[data-entry-id="{ids[2]}"] [data-edit-body]').press("Tab")
                move(ids[2],"me","media")
                move(ids[2],"you","media")
                # A centered special entry survives JSON and TXT exports/imports.
                move(ids[0],"system")
                final=page.evaluate("window.talkEditor.getProject()")
                txt=page.evaluate("window.LineTxtExport.createLineTxt(window.talkEditor.getProject())")
                assert "# entry-json:" in txt and '"side":"system"' in txt,txt
                parsed=page.evaluate("s=>parseText(parseMultiline(s)).items",txt)
                entry=next(x for x in parsed if x["content"]=="[通話時間 00:42]")
                assert entry["entryKind"]=="call" and entry["side"]=="system",entry
                page.evaluate("p=>window.talkEditor.replaceProject(p)",final)
                assert next(x for x in page.evaluate("window.talkEditor.getProject().items") if x["id"]==ids[0])["entryKind"]=="call"
                # Older saved JSON lacks the new semantic attribute: migrate by raw
                # bracket content, not by a guessed speaker or type.
                old=json.loads(json.dumps(final))
                for it in old["items"]:
                    it.pop("entryKind",None)
                    it.pop("callKind",None)
                    if it["content"].startswith("["):
                        it["type"]="text"
                page.evaluate("p=>window.talkEditor.replaceProject(p)",old)
                restored=page.evaluate("window.talkEditor.getProject().items")
                assert [x["entryKind"] for x in restored]==[
                    "call","call","media","media","annotation","text"],restored
                assert next(x for x in restored if x["id"]==ids[0])["side"]=="system"
                # Existing exported call records can contain custom, formerly
                # unrecognized call wording. Keep them as calls until edited.
                legacy=json.loads(json.dumps(old))
                legacy["items"].append({
                    "id":"legacy-call-kind-test","type":"call","side":"you",
                    "speaker":"相手","time":"12:30",
                    "content":"旧版独自の通話履歴","callKind":""
                })
                page.evaluate("p=>window.talkEditor.replaceProject(p)",legacy)
                custom=next(x for x in page.evaluate("window.talkEditor.getProject().items") if x["id"]=="legacy-call-kind-test")
                assert custom["entryKind"]=="call" and custom["type"]=="call",custom
                row=page.locator('[data-entry-id="legacy-call-kind-test"]')
                assert row.locator('.editor-call-card').count()==1
                row.locator('.editor-call-card').dblclick()
                edit=row.locator('[data-edit-body]')
                assert edit.inner_text()=="旧版独自の通話履歴"
                edit.fill("通常の連絡")
                edit.press("Tab")
                edited=next(x for x in page.evaluate("window.talkEditor.getProject().items") if x["id"]=="legacy-call-kind-test")
                assert edited["entryKind"]=="text" and edited["type"]=="text",edited
                assert row.locator('.editor-call-card').count()==0
                assert not errors,errors
                print("BRACKET_CARD_EDITOR_CHROMIUM_PASS",json.dumps({"width":width,"entries":len(final["items"])},ensure_ascii=False),flush=True)
                context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

if __name__=="__main__":main()
