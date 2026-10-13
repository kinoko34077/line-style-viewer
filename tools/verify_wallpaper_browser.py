#!/usr/bin/env python3
"""Browser regression: sky wallpaper persists through a long local LINE export.

Runs the repository's REAL HTML/JS/CSS; uses generated non-private text.
Never uploads the original user screenshot or their transcript.
"""
import json
import statistics
from pathlib import Path
from io import BytesIO
from PIL import Image
from playwright.sync_api import sync_playwright

OUT=Path("visual-wallpaper-result")
OUT.mkdir(exist_ok=True)
ROOT=Path.cwd()

def sky_edge(img):
    # x=2 is outside the chat body. A stable viewport background should not
    # change when page content extends many screens or the user scrolls.
    return [img.getpixel((2,y))[:3] for y in range(5,min(770,img.height),5)]

def diff(a,b):
    return sum(abs(i-j) for p,q in zip(a,b) for i,j in zip(p,q))/(len(a)*3)

def run():
    raw=["[LINE] Bとのトーク履歴","保存日時：2026/10/13 20:00","2026/10/13(火)"]
    for n in range(3000):
        hr=12+(n//60)%12
        name="A" if n%3 else "B"
        txt="同じ時間の短い発言" if n%4 else "複数行になるサンプル文章です。これは画面と配置の検証用です。"
        raw.append(f"{hr:02d}:{n%60:02d}\t{name}\t{txt}")
    encoded="\n".join(raw).encode("utf-8")
    all_metrics=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(args=["--no-sandbox","--disable-dev-shm-usage"])
        for width in [320,375,390,430,768]:
            page=browser.new_page(viewport={"width":width,"height":844},device_scale_factor=1)
            page.goto((ROOT/"index.html").as_uri(),wait_until="domcontentloaded")
            page.wait_for_selector("#fileInput")
            image_before=Image.open(BytesIO(page.screenshot()))
            styles=page.evaluate("""() => {
                const p=getComputedStyle(document.body,'::before');
                return {position:p.position, image:p.backgroundImage, size:p.backgroundSize,
                        bodyBackground:getComputedStyle(document.body).backgroundImage}
            }""")
            if styles["position"]!="fixed" or "bg-sky.jpg" not in styles["image"]:
                raise AssertionError(f"Wallpaper not viewport-fixed: {styles}")
            page.set_input_files("#fileInput",{"name":"sample.txt","mimeType":"text/plain","buffer":encoded})
            page.wait_for_function("document.querySelector('#sourceStatus').dataset.state==='ready'")
            page.evaluate("""() => {const e=document.getElementById('selfSelector'); if(e.options.length>1){e.value='A';e.dispatchEvent(new Event('change',{bubbles:true}))}}""")
            date_text=page.locator(".date-label").first.inner_text()
            from datetime import date
            expected_date="10/13(火)" if date.today().year==2026 else "2026年10月13日(火)"
            if date_text!=expected_date:raise AssertionError("date display: "+date_text)
            if page.locator(".talk.you .sender-name").count():
                raise AssertionError("Two-person direct chat shows sender names")
            # When an actual group has only two active speakers, the user can
            # override automatic detection; the same source stays in memory.
            page.select_option("#chatModeSelector","group")
            first_named=page.locator(".talk.you .sender-name").first
            if first_named.count()!=1:raise AssertionError("Group override did not show speaker")
            avatar=page.locator(".talk.you .icon").first
            balloon=page.locator(".talk.you .balloon").first
            sr=first_named.bounding_box();br=balloon.bounding_box();ar=avatar.bounding_box()
            if sr["y"]>=br["y"] or abs(sr["x"]-br["x"])>1:raise AssertionError("group name misaligned")
            page.select_option("#chatModeSelector","direct")
            if page.locator(".talk.you .sender-name").count():
                raise AssertionError("Direct override still shows group speaker")
            page.select_option("#chatModeSelector","auto")
            if page.locator(".talk.you .sender-name").count():
                raise AssertionError("Auto wrongly classifies a two-speaker direct chat")
            if width<=600 and (ar["width"]!=28 or ar["height"]!=28):
                raise AssertionError(f"avatar size not screenshot-calibrated: {ar}")
            row_count=page.locator(".talk").count()
            if row_count!=3000:raise AssertionError(f"lost rows: {row_count}")
            if page.evaluate("document.documentElement.scrollWidth > window.innerWidth"):
                raise AssertionError(f"horizontal scroll before scroll at {width}")
            image_after=Image.open(BytesIO(page.screenshot()))
            page.evaluate("window.scrollTo(0,document.documentElement.scrollHeight/2)")
            page.wait_for_timeout(120)
            image_mid=Image.open(BytesIO(page.screenshot()))
            page.evaluate("window.scrollTo(0,document.documentElement.scrollHeight)")
            page.wait_for_timeout(120)
            image_bottom=Image.open(BytesIO(page.screenshot()))
            before,after,mid,bottom=map(sky_edge,[image_before,image_after,image_mid,image_bottom])
            d=[round(diff(before,arr),4) for arr in [after,mid,bottom]]
            if max(d)>0.5:
                raise AssertionError(f"Viewport wallpaper changed while loading or scrolling: {width}, {d}")
            if page.evaluate("document.documentElement.scrollWidth > window.innerWidth"):
                raise AssertionError(f"horizontal scroll after import at {width}")
            if width==390:
                image_before.save(OUT/"wallpaper_before_390.png")
                image_bottom.save(OUT/"wallpaper_after_3000_bottom_390.png")
                page.evaluate("window.scrollTo(0,0)")
                page.screenshot(path=str(OUT/"wallpaper_after_3000_top_390.png"))
            data={"width":width,"messageCount":row_count,
                "skyRgbEdgeMeanAbsDiff":[*d],
                "senderNameAbove":round(br["y"]-sr["y"],2),
                "incomingBubbleLeft":round(br["x"],2),
                "incomingAvatarPx":ar["width"],"skyCss":styles["image"],
                "scrollHeight":page.evaluate("document.documentElement.scrollHeight")}
            all_metrics.append(data)
            print("BROWSER_CHECK",json.dumps(data,ensure_ascii=False),flush=True)
            page.close()
        browser.close()
    (OUT/"metrics.json").write_text(json.dumps(all_metrics,ensure_ascii=False,indent=2))
    print("PASS: original sky remains visible through real long TXT import and scroll")

if __name__=="__main__":
    run()
