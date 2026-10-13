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
            edit=page.locator('[data-edit-body]').first
            assert edit.get_attribute("contenteditable")=="false"
            edit.dblclick()
            assert edit.get_attribute("contenteditable")=="true"
            edit.fill("編集済み <img src=x onerror=alert(1)>")
            edit.press("Tab")
            assert project(page)["items"][0]["content"]=="編集済み <img src=x onerror=alert(1)>"
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
            # The LINE-style Photos/Videos menu lists missing media bindings.
            page.click("#menuToggle")
            page.click('[data-toggle-section="mediaGallery"]')
            assert page.locator("#unassignedGallery .gallery-tile").count()==1
            page.locator("#unassignedGallery .gallery-tile").first.click()
            page.set_input_files("#inlineMediaInput",{"name":"sample.png","mimeType":"image/png","buffer":PNG})
            page.click("#settingsClose")
            page.wait_for_function("window.talkEditor.getProject().items.some(i=>i.media && i.media.data)")
            assert page.locator(".bound-image img").count()==1
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
            page.wait_for_function("document.querySelector('#sourceStatus').textContent.includes('自動保存')",timeout=15000)
            count=len(project(page)["items"])
            page.reload();page.wait_for_function("!!window.talkEditor && window.talkEditor.getProject().title==='制作中のトーク'",timeout=15000)
            assert len(project(page)["items"])==count
            assert next(i for i in project(page)["items"] if i["id"]==peerId)["side"]=="me"
            page.click("#menuToggle");page.click('[data-toggle-section="editorSettings"]')
            page.set_input_files("#projectFileInput",{"name":"reimport.json","mimeType":"application/json","buffer":json.dumps(exported,ensure_ascii=False).encode("utf-8")})
            page.wait_for_function("window.talkEditor.getProject().items.length>0")
            assert project(page)["title"]=="制作中のトーク"
            page.set_input_files("#projectFileInput",{"name":"bad.json","mimeType":"application/json","buffer":b"{not-json"})
            page.wait_for_function("document.querySelector('#sourceStatus').dataset.state==='error'")
            assert project(page)["title"]=="制作中のトーク"
            page.click("#settingsClose")
            assert not errors,errors
            assert page.evaluate("document.documentElement.scrollWidth<=window.innerWidth")
            if width==390:page.screenshot(path=str(OUT/"editor_390.png"))
            print("EDITOR_OK",json.dumps({"width":width,"rows":count,"savedAfterReload":True,
                   "media":True,"dragUndoRedo":True,"title":project(page)["title"]},ensure_ascii=False),flush=True)
            context.close()
        browser.close()
if __name__=="__main__":main()
