#!/usr/bin/env python3
"""Compare public LINE screenshot bubble silhouettes with the real viewer.
Numbers describe isolated shapes after normalization, never full UI equivalence.
"""
import json
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw

OUT=Path("visual-reference-result")
OUT.mkdir(exist_ok=True)

def mask(image,seed,rgb,tol):
    a=np.asarray(image.convert("RGB"))
    lab=cv2.cvtColor(a,cv2.COLOR_RGB2LAB).astype(np.float32)
    expected=cv2.cvtColor(np.array([[rgb]],dtype=np.uint8),cv2.COLOR_RGB2LAB)[0,0].astype(np.float32)
    colored=(np.linalg.norm(lab-expected,axis=2)<tol).astype(np.uint8)
    colored=cv2.morphologyEx(colored,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
    n,labels,stats,_=cv2.connectedComponentsWithStats(colored,8)
    x,y=map(int,seed)
    if not (0<=x<a.shape[1] and 0<=y<a.shape[0]):
        raise ValueError("seed outside image")
    comp=int(labels[y,x])
    if comp==0:
        x0=max(0,x-18);x1=min(a.shape[1],x+19)
        y0=max(0,y-18);y1=min(a.shape[0],y+19)
        yy,xx=np.where(colored[y0:y1,x0:x1]>0)
        if not len(xx):raise ValueError("no matching bubble color near seed")
        ix=np.argmin((xx+x0-x)**2+(yy+y0-y)**2)
        comp=int(labels[y0+yy[ix],x0+xx[ix]])
    if comp==0 or stats[comp,cv2.CC_STAT_AREA]<80:
        raise ValueError("color component too small")
    m=(labels==comp).astype(np.uint8)*255
    filled=m.copy()
    cv2.floodFill(filled,np.zeros((m.shape[0]+2,m.shape[1]+2),np.uint8),(0,0),255)
    m=cv2.bitwise_or(m,cv2.bitwise_not(filled))
    ys,xs=np.nonzero(m)
    bounds=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
    return m[bounds[1]:bounds[3],bounds[0]:bounds[2]],bounds

def compare(a,b,ref_frame,app_frame):
    norm=lambda im:cv2.resize(im,(256,256),interpolation=cv2.INTER_NEAREST)>0
    ref=norm(a[0]); app=norm(b[0])
    both=np.count_nonzero(ref&app)
    either=np.count_nonzero(ref|app)
    edges_ref=cv2.Canny(ref.astype(np.uint8)*255,60,120)>0
    edges_app=cv2.Canny(app.astype(np.uint8)*255,60,120)>0
    dist_ref=cv2.distanceTransform((~edges_ref).astype(np.uint8),cv2.DIST_L2,3)
    dist_app=cv2.distanceTransform((~edges_app).astype(np.uint8),cv2.DIST_L2,3)
    chamfer=(float(dist_ref[edges_app].mean())+float(dist_app[edges_ref].mean()))/2
    dim=lambda box:(box[2]-box[0],box[3]-box[1])
    aw,ah=dim(a[1]);bw,bh=dim(b[1])
    # Pixel colors below mean reference-only and viewer-only SHAPE, not text.
    overlay=np.full((256,256,3),255,dtype=np.uint8)
    overlay[ref&app]=[68,82,88]
    overlay[ref&~app]=[227,60,71]
    overlay[~ref&app]=[31,161,211]
    return {"silhouette_iou_normalized":round(both/either,5),
            "mean_contour_gap_px_at_256":round(chamfer,3),
            "ref_bbox":a[1],"viewer_bbox":b[1],
            "ref_width_share":round(aw/ref_frame,4),
            "viewer_width_share":round(bw/app_frame,4),
            "ref_aspect":round(aw/ah,4),
            "viewer_aspect":round(bw/bh,4),
            "normalized_mask_overlay":overlay}

def render_current_viewer():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
        page=browser.new_page(viewport={"width":440,"height":512},device_scale_factor=1)
        page.goto((Path.cwd()/"index.html").as_uri(),wait_until="domcontentloaded")
        page.add_style_tag(content="""
          body{padding:8px!important}
          .viewer-header,.file-controls{display:none!important}
          #chatContainer{max-width:none!important;margin:0!important;padding:64px 0 0!important}
        """)
        page.evaluate("""() => renderChat({
          meta:{user:"A",icons:{}},
          items:[{type:"date",content:"今日"},
                 {type:"text",name:"A",time:"14:10",content:"自分のメッセージ"},
                 {type:"text",name:"B",time:"14:11",content:"相手のメッセージ"}]
        })""")
        bbox={key:page.locator(sel).bounding_box() for key,sel in [
            ("outgoing",".talk.me .balloon"),("incoming",".talk.you .balloon")]}
        page.screenshot(path=str(OUT/"viewer.png"))
        size=page.evaluate("document.documentElement.scrollWidth")
        browser.close()
    if size>440:raise ValueError("viewer overflow at 440px")
    return bbox

def download(url,path):
    import requests
    r=requests.get(url,headers={"User-Agent":"Mozilla/5.0","Referer":"https://www.google.com/"},timeout=24)
    r.raise_for_status()
    if not 1000<len(r.content)<12_000_000:raise ValueError("invalid image size")
    path.write_bytes(r.content)
    im=Image.open(path);im.load()
    return im

def run():
    bbox=render_current_viewer()
    viewer=Image.open(OUT/"viewer.png")
    source=OUT/"native_temporary"
    candidates=[
       ("smartphone_hunter_2021","https://smartphone-hunter.com/wp-content/uploads/2021/08/smartphone-hunter.com_-79.png",
         {"incoming":(.448,.351),"outgoing":(.850,.257)},(.07,.93)),
       ("menz_style","https://shop.menz-style.com/cdn/shop/files/fc-3276_5.jpg?width=600",
         {"incoming":(.36,.565),"outgoing":(.49,.390)},(0,1))
    ]
    reports=[];errors=[]
    for key,url,seeds,frame in candidates:
        try:
            original=download(url,source)
            w,h=original.size
            for side in ("incoming","outgoing"):
                seed=(round(seeds[side][0]*w),round(seeds[side][1]*h))
                refcol=(255,255,255) if side=="incoming" else (143,233,95)
                appcol=(255,255,255) if side=="incoming" else (161,233,108)
                native=mask(original,seed,refcol,35 if side=="incoming" else 48)
                box=bbox[side]
                appseed=(round(box["x"]+box["width"]/2),round(box["y"]+box["height"]-7))
                output=mask(viewer,appseed,appcol,28)
                data=compare(native,output,(frame[1]-frame[0])*w,440)
                overlay=data.pop("normalized_mask_overlay")
                Image.fromarray(overlay).save(OUT/(key+"_"+side+"_overlay.png"))
                Image.fromarray(native[0]).save(OUT/(key+"_"+side+"_reference_mask.png"))
                Image.fromarray(output[0]).save(OUT/(key+"_"+side+"_viewer_mask.png"))
                # The masks exclude text glyphs; get representative fill
                # colors directly from the temporary source and the viewer.
                def fill_color(image,bounds,expected):
                    rgb=np.asarray(image.convert("RGB"))[bounds[1]:bounds[3],bounds[0]:bounds[2]]
                    pix=rgb.reshape(-1,3).astype(np.float32)
                    delta=np.linalg.norm(pix-np.array(expected,dtype=np.float32),axis=1)
                    subset=pix[delta<(80 if expected[0]<200 else 30)]
                    if not len(subset):return None
                    return [int(v) for v in np.median(subset,axis=0)]
                data["reference_fill_median_rgb"]=fill_color(original,native[1],refcol)
                data["viewer_fill_median_rgb"]=fill_color(viewer,output[1],appcol)
                data.update({
                    "source":key,"url":url,"message_side":side,
                    "native_size":[w,h],
                    "comparison_kind":"identical_text" if key=="smartphone_hunter_2021" else "different_text_geometry_only",
                    "reference_css_equivalent_width":round((native[1][2]-native[1][0]) / ((frame[1]-frame[0])*w/440),2) if key=="smartphone_hunter_2021" else None,
                    "reference_css_equivalent_height":round((native[1][3]-native[1][1]) / ((frame[1]-frame[0])*w/440),2) if key=="smartphone_hunter_2021" else None
                })
                reports.append(data)
                print("MEASURED",json.dumps(data,ensure_ascii=False),flush=True)
        except Exception as exc:
            errors.append({"source":key,"error":str(exc)})
            print("SOURCE_FAILED",key,type(exc).__name__,str(exc),flush=True)
    source.unlink(missing_ok=True)
    (OUT/"metrics.json").write_text(json.dumps({"scores":reports,"source_errors":errors,
       "app_css_bubble_boxes":bbox,
       "scope":"same-text bubble masks rescaled to 256x256; never full-screen pixel equality"},
       indent=2,ensure_ascii=False),encoding="utf-8")
    if not reports:raise RuntimeError("No original LINE image could be downloaded and segmented")
    matching=[row for row in reports if row["comparison_kind"]=="identical_text"]
    if not matching:
        raise RuntimeError("Downloaded screenshots but no identical-text bubble comparison completed")
    print("SAME_TEXT_NORMALIZED_SILHOUETTE_IOU_MEAN",
       round(sum(row["silhouette_iou_normalized"] for row in matching)/len(matching),5))

def selftest():
    im=Image.new("RGB",(350,230),"#8da9cd")
    ImageDraw.Draw(im).rounded_rectangle((70,35,225,90),radius=18,fill="white")
    a=mask(im,(110,75),(255,255,255),20)
    score=compare(a,a,350,350)
    assert score["silhouette_iou_normalized"]==1,score
    print("self-test passed",score["silhouette_iou_normalized"])

if __name__=="__main__":
    selftest() if "--self-test" in sys.argv else run()
