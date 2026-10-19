#!/usr/bin/env python3
"""Proof of offline LINE chat creation, editing, media, drag and browser cache."""
import base64,json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path("visual-editor-result");OUT.mkdir(exist_ok=True)
PNG=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==")
def project(page):
    return page.evaluate("window.talkEditor.getProject()")
def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(args=["--no-sandbox","--disable-dev-shm-usage"])
        for width in [320,390,768]:
            context=browser.new_context(viewport={"width":width,"height":844},accept_downloads=True)
            page=context.new_page()
            errors=[]
            page.on("pageerror",lambda e:errors.append(str(e)))
            page.goto((ROOT/"index.html").as_uri(),wait_until="load")
            page.wait_for_function("!!window.talkEditor")
            assert project(page)["items"]==[],("not initially blank",project(page))
            assert page.locator("#conversationTitle").inner_text()=="トーク"
            assert page.locator("#emptyImportButton").count()==1
            assert page.locator("[data-drag-handle]").count()==0
            page.locator("#composeInput").fill("新規テスト")
            page.click("#sendButton")
            assert len(project(page)["items"])==1
            assert project(page)["items"][0]["side"]=="me"
            page.click("#undoButton")
            assert len(project(page)["items"])==0
            page.click("#redoButton")
            assert len(project(page)["items"])==1
            assert page.locator(".delete-entry:visible").count()==0
            page.locator(".editable-entry .balloon").first.click()
            assert page.locator(".delete-entry:visible").count()==1
            delete_box=page.locator(".delete-entry:visible").bounding_box()
            bubble_box=page.locator(".editable-entry .balloon").first.bounding_box()
            assert bubble_box["x"]<=delete_box["x"]<=bubble_box["x"]+bubble_box["width"]+12
            assert delete_box["y"]<bubble_box["y"]+8
            edit=page.locator('[data-edit-body]').first
            assert edit.get_attribute("contenteditable")=="false"
            edit.dblclick()
            assert edit.get_attribute("contenteditable")=="true"
            edit.fill("編集済み <img src=x onerror=alert(1)>")
            edit.press("Tab")
            assert project(page)["items"][0]["content"]=="編集済み <img src=x onerror=alert(1)>"
            # Two touch taps should enter editing without any six-point handle.
            page.evaluate("""() => {
              const row=document.querySelector('.editable-entry');
              const target=row.querySelector('.inline-body');
              const r=target.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
              for(let n=0;n<2;n++){
                const send=type=>target.dispatchEvent(new PointerEvent(type,{
                  bubbles:true,pointerType:'touch',pointerId:77,button:0,
                  clientX:x,clientY:y
                }));
                send('pointerdown');send('pointerup');
              }
            }""")
            assert page.locator('[data-edit-body]').first.get_attribute("contenteditable")=="true"
            page.locator('[data-edit-body]').first.press("Tab")
            assert page.locator("#chatContainer img[src=x]").count()==0
            t=page.locator('[data-edit-time]').first
            assert t.get_attribute("readonly") is not None
            t.dblclick()
            t.fill("01:23");t.press("Tab")
            assert project(page)["items"][0]["time"]=="01:23"
            page.click("#addMenuToggle")
            page.click("#addIncomingButton")
            assert len(project(page)["items"])==2 and project(page)["items"][1]["side"]=="you"
            peer=page.locator('[data-edit-body]').last
            peer.dblclick()
            peer.fill("相手の発言");peer.press("Tab")
            page.click("#addMenuToggle")
            page.click("#addSystemButton")
            assert project(page)["items"][-1]["type"]=="system"
            page.click("#addMenuToggle")
            page.click("#addDateButton")
            assert project(page)["items"][-1]["type"]=="date"
            page.click("#addMenuToggle")
            page.click("#addMediaPlaceholderButton")
            placeholder=page.locator('[data-pick-media]').first
            assert placeholder.count()
            assert page.locator(".unassigned-image img").first.get_attribute("src")=="./default/default-photo.png"
            assert page.locator(".unassigned-image").first.inner_text().strip()==""
            assert page.locator(".unassigned-image").first.get_attribute("aria-label")=="画像を選択"
            # The LINE-style Photos/Videos menu lists missing media bindings.
            page.click("#menuToggle")
            page.click('[data-toggle-section="mediaGallery"]')
            assert page.locator("#unassignedGallery .gallery-tile").count()==1
            page.locator("#unassignedGallery .gallery-tile").first.click()
            page.set_input_files("#inlineMediaInput",{"name":"sample.png","mimeType":"image/png","buffer":PNG})
            page.click("#settingsClose")
            page.wait_for_function("window.talkEditor.getProject().items.some(i=>i.media && i.media.data)")
            assert page.locator(".bound-image img").count()==1
            # Missing stamps must show their ORIGINAL exclamation asset, not
            # the generic photo icon; no useless select-label occupies space.
            page.click("#addMenuToggle")
            page.click("#addStampPlaceholderButton")
            stamp=page.locator(".unassigned-stamp").last
            assert stamp.count()==1
            assert stamp.locator("img").get_attribute("src")=="./default/default-stamp.png"
            assert stamp.inner_text().strip()==""
            assert stamp.get_attribute("aria-label")=="スタンプを選択"
            stamp.click()
            page.set_input_files("#inlineMediaInput",{"name":"sticker.png","mimeType":"image/png","buffer":PNG})
            page.wait_for_function("""() => window.talkEditor.getProject().items.some(
                i => i.content==='[スタンプ]' && !!i.media?.data)""")
            assert page.locator(".bound-stamp img").count()==1
            assert next(i for i in project(page)["items"] if i["content"]=="[スタンプ]")["type"]=="attachment"
            # Unknown local file MIME must become a safe generic binary
            # download without executing HTML, script or embedded content.
            page.click("#addMenuToggle")
            page.click("#addFilePlaceholderButton")
            page.locator(".unassigned-media").last.click()
            page.set_input_files("#inlineMediaInput",{"name":"unknown.sh","mimeType":"application/x-sh","buffer":b"echo local"})
            page.wait_for_function("window.talkEditor.getProject().items.some(i=>i.media && i.media.name==='unknown.sh')")
            generic=[i for i in project(page)["items"] if i.get("media") and i["media"]["name"]=="unknown.sh"][0]
            assert generic["media"]["mime"]=="application/octet-stream"
            assert generic["media"]["data"].startswith("data:application/octet-stream;base64,")
            assert page.locator(".bound-file a[download='unknown.sh']").count()==1
            page.click("#menuToggle")
            page.click('[data-toggle-section="profileEditor"]')
            assert page.locator("#participantList .participant-row").count()==2
            page.locator('.participant-name').last.fill("登場人物")
            page.locator('.participant-name').last.press("Tab")
            assert project(page)["participants"][-1]["name"]=="登場人物"
            # User-added speakers are removable without deleting any chat history.
            page.click("#addParticipantButton")
            assert project(page)["participants"][-1]["name"]=="話者1"
            assert page.locator('[data-delete-person-index="2"]').count()==1
            page.locator('[data-delete-person-index="2"]').click()
            assert [p["name"] for p in project(page)["participants"]]==["自分","登場人物"]
            # A configured self name must win over legacy imported selection state.
            page.locator('.participant-name').first.fill("制作主")
            page.locator('.participant-name').first.press("Tab")
            assert project(page)["self"]=="制作主"
            assert all(i["speaker"]=="制作主" for i in project(page)["items"] if i["side"]=="me")
            page.evaluate("""() => {
                const mode=document.getElementById('chatModeSelector');
                mode.value='group';mode.dispatchEvent(new Event('change',{bubbles:true}));
                mode.value='direct';mode.dispatchEvent(new Event('change',{bubbles:true}));
            }""")
            assert project(page)["self"]=="制作主" and project(page)["mode"]=="direct"
            # Assign another local image to peer avatar.
            page.locator('[data-avatar-index="1"]').click()
            page.set_input_files("#inlineMediaInput",{"name":"avatar.png","mimeType":"image/png","buffer":PNG})
            page.wait_for_function("window.talkEditor.getProject().participants[1].avatar.startsWith('data:image/png')")
            page.locator("#titleInput").fill("制作中のトーク")
            page.locator("#titleInput").press("Tab")
            assert page.locator("#conversationTitle").inner_text()=="制作中のトーク"
            page.click('[data-toggle-section="editorSettings"]')
            # Settings need not appear on screen simultaneously to support export.
            with page.expect_download() as download:
                page.click("#exportProjectButton")
            exported=json.loads(Path(download.value.path()).read_text())
            assert exported["version"]==1 and exported["title"]=="制作中のトーク"
            assert any(i.get("media") and i["media"]["name"]=="sample.png" for i in exported["items"])
            assert any(i.get("media") and i["media"]["name"]=="unknown.sh" for i in exported["items"])
            # Native-looking TXT export keeps sender, date and content; JSON keeps binary bytes.
            with page.expect_download() as txt_download:
                page.click("#exportTxtButton")
            exported_txt=Path(txt_download.value.path()).read_text(encoding="utf-8-sig")
            assert "# user:" in exported_txt
            assert "登場人物" in exported_txt
            assert "[写真]" in exported_txt and "data:image" not in exported_txt
            parsed_again=page.evaluate("""text=>{
                const decoded=parseText(parseMultiline(text));
                return {self:decoded.meta.user,title:decoded.meta.title,rows:decoded.items.length};
            }""",exported_txt)
            assert parsed_again["self"]==project(page)["self"]
            assert parsed_again["title"]=="制作中のトーク"
            assert parsed_again["rows"]>=3
            page.click("#settingsClose")
            # Pointer drag directly on the bubble converts peer into system.
            peerId=project(page)["items"][1]["id"]
            grip=page.locator('[data-entry-id="'+peerId+'"] .balloon')
            box=grip.bounding_box()
            chat=page.locator("#chatContainer").bounding_box()
            x=box["x"]+box["width"]/2;y=box["y"]+box["height"]/2
            page.mouse.move(x,y);page.mouse.down()
            page.mouse.move(chat["x"]+chat["width"]/2,y+35,steps=8);page.mouse.up()
            changed=next(i for i in project(page)["items"] if i["id"]==peerId)
            assert changed["side"]=="system" and changed["type"]=="system",changed
            page.click("#undoButton")
            undone=next(i for i in project(page)["items"] if i["id"]==peerId)
            assert undone["side"]=="you"
            page.click("#redoButton")
            assert next(i for i in project(page)["items"] if i["id"]==peerId)["side"]=="system"
            # Touch-flavoured PointerEvents exercise left/right drop handling.
            # The iPhone-specific physical event/OS rendering remains a
            # separate true WebKit/Safari delivery check.
            def touch_move(side):
                page.evaluate("""({id, side}) => {
                    const row=[...document.querySelectorAll('[data-entry-id]')].find(el=>el.dataset.entryId===id);
                    const grip=row.querySelector('.balloon, .edit-system'),r=grip.getBoundingClientRect();
                    const container=document.getElementById('chatContainer').getBoundingClientRect();
                    const x=r.x+r.width/2,y=r.y+r.height/2;
                    const target=side==='you'?container.left+container.width*.10:
                                 container.left+container.width*.90;
                    const dispatch=(type,px,py)=>grip.dispatchEvent(new PointerEvent(type,{
                        bubbles:true,button:0,buttons:type==='pointerup'?0:1,
                        pointerId:55,pointerType:'touch',clientX:px,clientY:py
                    }));
                    return new Promise(resolve=>{
                        dispatch('pointerdown',x,y);
                        setTimeout(()=>{
                            dispatch('pointermove',target,y+30);
                            dispatch('pointerup',target,y+30);
                            resolve();
                        },400);
                    });
                }""",{"id":peerId,"side":side})
            touch_move("you")
            assert next(i for i in project(page)["items"] if i["id"]==peerId)["side"]=="you"
            touch_move("me")
            assert next(i for i in project(page)["items"] if i["id"]==peerId)["side"]=="me",{
                "after_second_touch":next(i for i in project(page)["items"] if i["id"]==peerId),
                "entry_markup":page.locator('[data-entry-id="'+peerId+'"]').get_attribute("class")
            }
            assert next(i for i in project(page)["items"] if i["id"]==peerId)["speaker"]=="制作主"
            touch_move("you")
            returned=next(i for i in project(page)["items"] if i["id"]==peerId)
            assert returned["side"]=="you" and returned["speaker"]=="登場人物",returned
            touch_move("me")
            assert next(i for i in project(page)["items"] if i["id"]==peerId)["speaker"]=="制作主"
            # A status string can describe an older save. Wait for the actual
            # latest peer side in IndexedDB before reloading the tab.
            page.wait_for_function("""async id => {
              const db=await new Promise((ok,fail)=>{
                const q=indexedDB.open('line-style-editor-cache',1);
                q.onsuccess=()=>ok(q.result);q.onerror=()=>fail(q.error);
              });
              try{
                const raw=await new Promise((ok,fail)=>{
                  const tx=db.transaction('document','readonly');
                  const r=tx.objectStore('document').get('active');
                  r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);
                });
                return JSON.parse(raw??'{}').items?.find(i=>i.id===id)?.side==='me';
              }finally{db.close();}
            }""",arg=peerId,timeout=20000)
            count=len(project(page)["items"])
            page.reload()
            # A matching title is not evidence that asynchronous IDB restore
            # completed; wait for the exact persisted row/side after reload.
            page.wait_for_function("""({id, title}) => {
                const editor=window.talkEditor;
                if(!editor)return false;
                const doc=editor.getProject();
                return doc.title===title && doc.items.some(i=>i.id===id && i.side==='me');
            }""",arg={"id":peerId,"title":"制作中のトーク"},timeout=20000)
            assert len(project(page)["items"])==count
            assert next(i for i in project(page)["items"] if i["id"]==peerId)["side"]=="me"
            page.click("#menuToggle");page.click('[data-toggle-section="editorSettings"]')
            page.set_input_files("#projectFileInput",{"name":"reimport.json","mimeType":"application/json","buffer":json.dumps(exported,ensure_ascii=False).encode("utf-8")})
            page.wait_for_function("window.talkEditor.getProject().items.length>0")
            assert project(page)["title"]=="制作中のトーク"
            page.set_input_files("#projectFileInput",{"name":"bad.json","mimeType":"application/json","buffer":b"{not-json"})
            page.wait_for_function("document.querySelector('#sourceStatus').dataset.state==='error'")
            assert project(page)["title"]=="制作中のトーク"
            assert page.locator("#editorErrorToast").is_visible()
            # Oversized projects must be rejected BEFORE File.text is called,
            # to avoid an unnecessary 120MB+ allocation on mobile Safari.
            rejected=page.evaluate("""async () => {
                let read=false;
                const before=JSON.stringify(window.talkEditor.getProject());
                await window.talkEditor.importProject({
                    size:130*1024*1024, text:async()=>{read=true;return '{}';}
                });
                return {read,unchanged:before===JSON.stringify(window.talkEditor.getProject())};
            }""")
            assert not rejected["read"] and rejected["unchanged"],rejected
            assert page.locator("#editorErrorToast").is_visible()
            page.click("#settingsClose")
            # Audit: a date chip is visually shortened in the current year,
            # but opening and closing inline editing must NOT erase the year.
            original=project(page)
            canonical=page.evaluate("() => new Date().getFullYear()+'/10/13(火)'")
            auditDoc={**original,"items":[
                {"id":"same-date-id","type":"date","side":"system","speaker":"",
                 "content":canonical,"time":"","media":None,"previousType":"text","callKind":""}
            ]}
            page.evaluate("p=>window.talkEditor.replaceProject(p)",auditDoc)
            pill=page.locator(".centered-entry [data-edit-body]").first
            assert pill.inner_text()=="10/13(火)"
            pill.dblclick()
            assert pill.inner_text()==canonical
            pill.press("Tab")
            assert project(page)["items"][0]["content"]==canonical, "doubletap/blur erased date year"
            assert page.locator(".centered-entry [data-edit-body]").first.inner_text()=="10/13(火)"
            # A changed short date retains the original year in stored data.
            pill=page.locator(".centered-entry [data-edit-body]").first
            pill.dblclick();pill.fill("9/20(日)");pill.press("Tab")
            new_date=project(page)["items"][0]["content"]
            assert new_date.endswith("/09/20(日)") and new_date[:4]==canonical[:4],new_date
            # Center date dropped into own side becomes an ordinary text
            # message, not an invisible side update while still centered.
            page.evaluate("""() => {
                const row=document.querySelector('.centered-entry'),target=row.querySelector('.edit-system');
                const r=target.getBoundingClientRect(),c=document.querySelector('#chatContainer').getBoundingClientRect();
                const x=r.x+r.width/2,y=r.y+r.height/2,dest=c.right-c.width*.10;
                const fire=(type,px,py)=>target.dispatchEvent(new PointerEvent(type,{
                    bubbles:true,pointerType:'mouse',pointerId:480,button:0,
                    buttons:type==='pointerup'?0:1,clientX:px,clientY:py
                }));
                fire('pointerdown',x,y);fire('pointermove',dest,y+12);fire('pointerup',dest,y+12);
            }""")
            moved=project(page)["items"][0]
            assert moved["side"]=="me" and moved["type"]=="text",moved
            # Duplicate imported IDs must not make the second item edit/delete
            # target the first. A malformed null item must reject atomically.
            dupe={"version":1,"title":"重複ID検証","self":"自分","mode":"direct",
                "scale":120,"theme":"normal",
                "participants":[{"name":"自分","avatar":""},{"name":"相手","avatar":""}],
                "items":[
                    {"id":"dupe-id","type":"text","side":"me","speaker":"自分",
                     "content":"一行目","time":"10:01"},
                    {"id":"dupe-id","type":"text","side":"me","speaker":"自分",
                     "content":"二行目","time":"10:02"}
                ]}
            page.evaluate("p=>window.talkEditor.replaceProject(p)",dupe)
            rows=project(page)["items"]
            assert len(rows)==2 and rows[0]["id"]!=rows[1]["id"],rows
            second=page.locator('[data-edit-body]').nth(1)
            second.dblclick();second.fill("二行目だけ編集");second.press("Tab")
            assert [i["content"] for i in project(page)["items"]]==["一行目","二行目だけ編集"]
            assert page.evaluate("""() => {
                const before=JSON.stringify(window.talkEditor.getProject());
                try{
                    const p=window.talkEditor.getProject();p.items=[null];
                    window.talkEditor.replaceProject(p);
                    return false;
                }catch{return JSON.stringify(window.talkEditor.getProject())===before;}
            }""")
            # Legacy sample [stk_2345.svg] must be visually treated as a
            # sticker, not a photograph. A non-image file must be rejected.
            legacy={**original,"items":[
                {"id":"legacy-sticker-1","type":"attachment","side":"you",
                 "speaker":"相手","content":"[stk_2345.svg]",
                 "time":"22:36","media":None,"previousType":"text","callKind":""}
            ]}
            page.evaluate("p=>window.talkEditor.replaceProject(p)",legacy)
            mark=page.locator(".unassigned-stamp").first
            assert mark.count()==1
            assert mark.locator("img").get_attribute("src")=="./default/default-stamp.png"
            mark.click()
            page.set_input_files("#inlineMediaInput",{"name":"not-image.pdf",
                "mimeType":"application/pdf","buffer":b"not an image"})
            assert not project(page)["items"][0]["media"]
            assert page.locator("#editorErrorToast").is_visible()
            page.locator(".unassigned-stamp").first.click()
            page.set_input_files("#inlineMediaInput",{"name":"valid.png",
                "mimeType":"image/png","buffer":PNG})
            page.wait_for_function("""() => !!window.talkEditor.getProject().items[0].media""")
            assert project(page)["items"][0]["content"]=="[stk_2345.svg]"
            assert page.locator(".bound-stamp img").count()==1
            page.evaluate("p=>window.talkEditor.replaceProject(p)",original)
            assert not errors,errors
            assert page.evaluate("document.documentElement.scrollWidth<=window.innerWidth")
            if width==390:page.screenshot(path=str(OUT/"editor_390.png"))
            print("EDITOR_OK",json.dumps({"width":width,"rows":count,"savedAfterReload":True,
                   "media":True,"dragUndoRedo":True,"title":project(page)["title"]},ensure_ascii=False),flush=True)
            context.close()
        browser.close()
if __name__=="__main__":main()
