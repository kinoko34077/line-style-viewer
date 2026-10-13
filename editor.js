(function () {
"use strict";
const E=id=>document.getElementById(id);
const transcript=E('chatContainer');
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const identifier=()=>crypto.randomUUID?crypto.randomUUID():'id-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const clock=()=>new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',hour12:false});
const today=()=>{const d=new Date();return d.getFullYear()+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0')+'('+'日月火水木金土'[d.getDay()]+')';};
const blank=()=>({version:1,title:'トーク',self:'自分',mode:'direct',scale:120,theme:'normal',participants:[{name:'自分',avatar:''},{name:'相手',avatar:''}],items:[]});
let doc=blank(),history=[],future=[],timer,dbCounter=0,loaded=false,touched=false,mediaTarget=null,drag=null;
// Keep repeated edits to large inline photos from multiplying memory without bound.
function trimStack(stack){while(stack.length>1 && (stack.length>40 || stack.reduce((n,s)=>n+s.length,0)>32*1024*1024))stack.shift();}
const snapshot=()=>JSON.stringify(doc);
const allowedMedia=/^data:(?:image\/(?:png|jpeg|gif|webp)|video\/(?:mp4|webm)|application\/pdf|text\/plain|application\/zip|audio\/(?:mpeg|ogg|wav));base64,/;
function sanitize(input){
 if(!input || input.version!==1 || !Array.isArray(input.items)||!Array.isArray(input.participants))throw Error('プロジェクト形式が不正です');
 if(input.items.length>25000)throw Error('メッセージ数が上限を超えています');
 const d=blank();
 d.title=String(input.title||'トーク').slice(0,180);
 d.self=String(input.self||'自分').slice(0,100);
 d.mode=['auto','direct','group'].includes(input.mode)?input.mode:'auto';
 d.theme=['normal','white','black'].includes(input.theme)?input.theme:'normal';
 d.scale=Math.min(160,Math.max(80,Number(input.scale)||120));
 d.participants=input.participants.slice(0,150).map(p=>({name:String(p.name||'').slice(0,100),
   avatar:typeof p.avatar==='string'&&allowedMedia.test(p.avatar)&&p.avatar.startsWith('data:image/')?p.avatar:''})).filter(p=>p.name);
 if(!d.participants.some(p=>p.name===d.self))d.participants.unshift({name:d.self,avatar:''});
 d.items=input.items.map(it=>{
   const type=['text','attachment','date','system','call'].includes(it.type)?it.type:'text';
   const media=it.media&&allowedMedia.test(it.media.data||'')?{data:it.media.data,mime:String(it.media.mime||''),name:String(it.media.name||'ファイル').slice(0,180)}:null;
   return {id:typeof it.id==='string'&&/^[\w-]{3,100}$/.test(it.id)?it.id:identifier(),
    type,side:['me','you','system'].includes(it.side)?it.side:'you',
    speaker:String(it.speaker??it.name??'').slice(0,100),time:String(it.time||'').slice(0,50),
    content:String(it.content||'').slice(0,200000),media,callKind:String(it.callKind||''),previousType:String(it.previousType||'text')};
 });
 return d;
}
function status(s,error=false){const e=E('sourceStatus');if(e){e.textContent=s;e.dataset.state=error?'error':'ready';}}
function buttons(){if(E('undoButton'))E('undoButton').disabled=!history.length;if(E('redoButton'))E('redoButton').disabled=!future.length;}
function mutate(fn,option={}){
 touched=true;
 const before=snapshot();
 fn(doc);
 if(snapshot()===before)return false;
 history.push(before);trimStack(history);future=[];
 schedule();if(!option.noRender)render(option);
 return true;
}
function undo(){if(!history.length)return;future.push(snapshot());trimStack(future);doc=sanitize(JSON.parse(history.pop()));schedule();render();}
function redo(){if(!future.length)return;history.push(snapshot());trimStack(history);doc=sanitize(JSON.parse(future.pop()));schedule();render();}
function database(){return new Promise((resolve,reject)=>{if(!indexedDB){reject(Error('IndexedDB不可'));return;}
 const req=indexedDB.open('line-style-editor-cache',1);
 req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('document'))req.result.createObjectStore('document');};
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function saveCache(serialized){
 const database=await database();
 return new Promise((resolve,reject)=>{
  const tx=database.transaction('document','readwrite');
  tx.objectStore('document').put(serialized,'active');
  tx.oncomplete=()=>{database.close();resolve();};
  tx.onerror=()=>{database.close();reject(tx.error);};
 });}
async function readCache(){
 const database=await database();
 return new Promise((resolve,reject)=>{
  const tx=database.transaction('document','readonly'),r=tx.objectStore('document').get('active');
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  tx.oncomplete=()=>database.close();
 });}
function schedule(){
 const n=++dbCounter;
 clearTimeout(timer);
 timer=setTimeout(async()=>{
  if(n!==dbCounter)return;
  const data=snapshot();
  try{await saveCache(data);status('ブラウザ内に自動保存しました');}
  catch{
   try{if(data.length>1600000)throw Error('容量超過');localStorage.setItem('line-style-editor-cache-backup',data);status('簡易キャッシュに自動保存しました');}
   catch{status('自動保存ができません。右上の保存でJSONを書き出してください',true);}
  }
 },450);
}
async function restore(){
 const version=dbCounter;
 try{
  let s;
  try{s=await readCache();}catch{s=localStorage.getItem('line-style-editor-cache-backup');}
  if(s&&!touched&&version===dbCounter){doc=sanitize(JSON.parse(s));status('前回のトークを復元しました');}
 }catch{status('保存データを復元できませんでした',true);}
 loaded=true;render();
}
const itemById=id=>doc.items.find(i=>i.id===id);
const peer=()=>doc.participants.find(p=>p.name!==doc.self)?.name||'相手';
const group=()=>doc.mode==='group'||doc.mode==='auto'&&new Set(doc.items.filter(i=>i.side!=='system').map(i=>i.speaker).filter(Boolean)).size>=3;
const avatar=speaker=>doc.participants.find(p=>p.name===speaker)?.avatar||'./default/default-icon.png';
function mediaKind(it){
 if(it.media?.data){if(it.media.mime.startsWith('image/'))return 'image';if(it.media.mime.startsWith('video/'))return 'video';return 'file';}
 if(it.type==='attachment'||/^\[(写真|動画|ファイル|スタンプ|.*\.(?:png|jpg|jpeg|webp|gif|mp4|pdf))\]$/i.test(it.content)){
   if(/動画|\.mp4/i.test(it.content))return 'video';
   if(/ファイル|\.pdf/i.test(it.content))return 'file';
   return 'image';
 }
 return null;
}
function fields(){
 const p=E('participantList'),s=E('composeSpeaker'),gallery=E('unassignedGallery');
 if(p)p.innerHTML=doc.participants.map((x,i)=>`<div class="participant-row"><button type="button" data-avatar-index="${i}" class="avatar-picker" aria-label="アイコンを変更"><img src="${esc(x.avatar||'./default/default-icon.png')}" alt=""></button><input data-person-index="${i}" class="participant-name" aria-label="話者の名前" value="${esc(x.name)}">${x.name===doc.self?'<small>自分</small>':''}</div>`).join('');
 if(s){const old=s.value||s.dataset.preferred||doc.self;s.innerHTML=doc.participants.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');s.value=doc.participants.some(p=>p.name===old)?old:doc.self;}
 if(gallery){const missing=doc.items.filter(x=>mediaKind(x)&&!x.media?.data);
  gallery.innerHTML=missing.length?missing.map(x=>`<button type="button" class="gallery-tile" data-pick-media="${esc(x.id)}"><img src="./default/default-photo.png" alt=""><span>${esc(x.content)} — 指定</span></button>`).join(''):'<p>未指定の写真・動画・ファイルはありません。</p>';
 }
}
function render(options={}){
 if(!transcript)return;
 const oldScroll=transcript.scrollTop,atEnd=transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight<125;
 if(E('conversationTitle'))E('conversationTitle').textContent=doc.title;
 if(E('settingsTitle'))E('settingsTitle').textContent=doc.title+' の設定';
 if(E('titleInput')&&document.activeElement!==E('titleInput'))E('titleInput').value=doc.title;
 if(E('chatModeSelector'))E('chatModeSelector').value=doc.mode;
 if(E('selfSelector')){E('selfSelector').innerHTML=doc.participants.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');E('selfSelector').disabled=false;E('selfSelector').value=doc.self;}
 if(typeof applyUiScale==='function')applyUiScale(doc.scale);
 if(typeof applyTheme==='function')applyTheme(doc.theme);
 fields();
 let prev=null;const html=[];
 for(const it of doc.items){
  const id=esc(it.id),center=it.side==='system'||it.type==='system'||it.type==='date';
  const grip=`<button type="button" class="drag-grip" data-drag-handle aria-label="ドラッグして移動">⠿</button>`;
  const remove=`<button type="button" class="delete-entry" data-delete-id="${id}" aria-label="削除">×</button>`;
  const content=esc(it.content).replace(/\n/g,'<br>');
  const inline=`<span class="inline-body" contenteditable="true" role="textbox" aria-multiline="true" data-edit-body="${id}">${it.type==='date'?esc(displayDateLabel(it.content)):content}</span>`;
  if(center){
   prev=null;
   html.push(`<div class="editable-entry centered-entry" data-entry-id="${id}" data-side="system">${grip}<div class="${it.type==='date'?'date-label':'system'} edit-system">${inline}</div>${it.type==='date'?'':`<input aria-label="時刻" class="inline-time" data-edit-time="${id}" value="${esc(it.time)}">`}${remove}</div>`);
   continue;
  }
  const mine=it.side==='me',m=/^\d{1,2}:\d{2}$/.test(it.time)?it.time:null;
  const grouped=!!(prev&&prev.speaker===it.speaker&&prev.side===it.side&&m&&m===prev.minute);
  const icon=mine?'':grouped?'<span class="icon-spacer" aria-hidden="true"></span>':`<img class="icon" src="${esc(avatar(it.speaker))}" alt="">`;
  const label=group()&&!mine&&!grouped&&it.speaker?`<span class="sender-name">${esc(it.speaker)}</span>`:'';
  let balloon=inline,kind=mediaKind(it);
  if(kind){
   if(it.media?.data){
    const url=esc(it.media.data);
    if(kind==='image')balloon=`<button class="bound-image" type="button" data-pick-media="${id}" aria-label="画像を置換"><img src="${url}" alt="${esc(it.media.name)}"></button>`;
    else if(kind==='video')balloon=`<div class="bound-video"><video src="${url}" controls playsinline></video><button type="button" data-pick-media="${id}">変更</button></div>`;
    else balloon=`<div class="bound-file"><a href="${url}" download="${esc(it.media.name)}">▤ ${esc(it.media.name)}</a><button type="button" data-pick-media="${id}">変更</button></div>`;
   }else balloon=`<button type="button" class="unassigned-media" data-pick-media="${id}"><img src="./default/default-photo.png" alt=""><span>${kind==='image'?'画像':kind==='video'?'動画':'ファイル'}を指定</span></button>`;
  }
  html.push(`<div class="editable-entry talk ${mine?'me':'you'}" data-entry-id="${id}" data-side="${it.side}"${grouped?' data-continuation="true"':''}>${grip}${icon}<div class="message-block-with-meta">${label}<div class="balloon${kind?' media-edit':''}">${balloon}</div><div class="meta-inline">${mine?'<span class="read">既読</span>':''}<input class="inline-time" aria-label="時刻" data-edit-time="${id}" value="${esc(it.time)}"></div></div>${remove}</div>`);
  prev={speaker:it.speaker,side:it.side,minute:m};
 }
 transcript.innerHTML=html.length?html.join(''):'<div class="editor-empty">下の入力欄からメッセージを作成できます。<br>＋から相手・日付・システムメッセージも追加できます。</div>';
 buttons();
 transcript.scrollTop=options.bottom||atEnd?transcript.scrollHeight:oldScroll;
}
function addItem(type,side,content,media){
 const it={id:identifier(),type,side,content,time:type==='date'?'':clock(),speaker:side==='me'?doc.self:side==='you'?peer():'',media:media||null,previousType:'text',callKind:''};
 mutate(d=>d.items.push(it),{bottom:true});
 return it;
}
function changeItem(id,field,value){
 const it=itemById(id);
 if(!it||it[field]===value)return;
 mutate(d=>{const x=d.items.find(i=>i.id===id);if(x)x[field]=value;});
}
function send(){
 const input=E('composeInput');if(!input||!input.value.trim())return;
 const speaker=E('composeSpeaker')?.value||doc.self;
 const it={id:identifier(),type:'text',side:speaker===doc.self?'me':'you',speaker,time:clock(),content:input.value.replace(/\r\n/g,'\n'),media:null,previousType:'text',callKind:''};
 mutate(d=>d.items.push(it),{bottom:true});input.value='';input.focus();
}
function focusBody(id){transcript.querySelector(`[data-edit-body="${id}"]`)?.focus();}
function exportJson(){
 const blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
 const link=document.createElement('a');link.href=url;link.download=doc.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,64)+'.linechat.json';
 document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);status('JSONを書き出しました');
}
async function importJson(file){
 if(!file)return;
 try{const text=await file.text();if(text.length>24*1024*1024)throw Error('ファイルサイズ超過');
  const parsed=sanitize(JSON.parse(text));
  mutate(()=>{doc=parsed;});status('保存したトークを読み込みました');
 }catch(e){status('読み込み失敗: '+e.message,true);}
}
function importParsed(parsed,selfChoice,mode){
 const self=selfChoice||parsed.meta.user||'自分';
 const participants=[...new Set(parsed.items.map(i=>i.name).filter(Boolean))].map(name=>({name,avatar:''}));
 if(!participants.some(p=>p.name===self))participants.unshift({name:self,avatar:''});
 if(participants.length===1)participants.push({name:'相手',avatar:''});
 const items=parsed.items.map(i=>({id:identifier(),type:i.type,content:i.content,
  speaker:i.name||'',time:i.time||'',side:['system','date'].includes(i.type)?'system':i.name===self?'me':'you',
  media:null,previousType:'text',callKind:i.callKind||''}));
 mutate(d=>{doc=sanitize({version:1,title:parsed.meta.title||'トーク',self,mode,
  scale:d.scale,theme:d.theme,participants,items});history.length=0;future.length=0;});
 status('TXT履歴を編集用に読み込みました。原本は変更しません');
}
function setIdentityAndMode(self,mode){
 mutate(d=>{d.self=self||d.self;d.mode=mode||d.mode;
  if(!d.participants.some(p=>p.name===d.self))d.participants.push({name:d.self,avatar:''});
  d.items.forEach(i=>{if(i.side!=='system')i.side=i.speaker===d.self?'me':'you';});
 });
}
window.talkEditor={loadParsed:importParsed,setIdentityAndMode,getProject:()=>JSON.parse(snapshot()),
 addItem,undo,redo,exportProject:exportJson,importProject:importJson,replaceProject:p=>mutate(()=>{doc=sanitize(p);}),render};
const on=(id,event,fn)=>E(id)?.addEventListener(event,fn);
on('undoButton','click',undo);on('redoButton','click',redo);
on('saveButton','click',exportJson);on('exportProjectButton','click',exportJson);
on('projectFileInput','change',e=>{importJson(e.target.files[0]);e.target.value='';});
on('newProjectButton','click',()=>{
 if(doc.items.length&&!confirm('現在のトークを消して新規作成しますか？（Undoで戻せます）'))return;
 mutate(()=>{doc=blank();});status('新規トーク');
 if(typeof toggleSettings==='function')toggleSettings(false);
});
on('titleInput','change',e=>mutate(d=>{d.title=e.target.value||'トーク';}));
on('scaleControl','change',e=>mutate(d=>{d.scale=Number(e.target.value);},{noRender:true}));
on('themeSelector','change',e=>mutate(d=>{d.theme=e.target.value;},{noRender:true}));
on('chatModeSelector','change',e=>mutate(d=>{d.mode=e.target.value;}));
on('composeSpeaker','change',e=>{e.target.dataset.preferred=e.target.value;});
on('sendButton','click',send);
on('composeInput','keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}});
function menu(show){const m=E('addMessageMenu');if(m)m.hidden=show===undefined?!m.hidden:!show;}
on('addMenuToggle','click',()=>menu());
on('addIncomingButton','click',()=>{menu(false);focusBody(addItem('text','you','').id);});
on('addSystemButton','click',()=>{menu(false);focusBody(addItem('system','system','システムメッセージ').id);});
on('addDateButton','click',()=>{menu(false);addItem('date','system',today());});
on('addMediaPlaceholderButton','click',()=>{menu(false);addItem('attachment','you','[写真]');});
on('addFilePlaceholderButton','click',()=>{menu(false);addItem('attachment','you','[ファイル]');});
on('addMediaButton','click',()=>{const it=addItem('attachment','me','[写真]');pick(it.id,null);});
on('addFileButton','click',()=>{const it=addItem('attachment','me','[ファイル]');pick(it.id,null);});
on('addParticipantButton','click',()=>{let k=1;while(doc.participants.some(p=>p.name==='話者'+k))k++;mutate(d=>d.participants.push({name:'話者'+k,avatar:''}));});
on('participantList','change',e=>{
 const el=e.target;if(!el.matches('[data-person-index]'))return;
 const i=Number(el.dataset.personIndex),name=el.value.trim().slice(0,100);
 if(!name||doc.participants.some((p,j)=>j!==i&&p.name===name)){status('名前が重複・空欄です',true);render();return;}
 mutate(d=>{const old=d.participants[i].name;d.participants[i].name=name;
  if(d.self===old)d.self=name;
  d.items.forEach(it=>{if(it.speaker===old)it.speaker=name;});
 });
});
on('participantList','click',e=>{const btn=e.target.closest('[data-avatar-index]');if(btn)pick(null,Number(btn.dataset.avatarIndex));});
on('settingsBackdrop','click',e=>{
 const row=e.target.closest('[data-toggle-section]');
 if(row)E(row.dataset.toggleSection)?.classList.toggle('expanded');
 const tile=e.target.closest('[data-pick-media]');if(tile)pick(tile.dataset.pickMedia,null);
});
const mimeAllowed=/^(image\/(?:png|jpeg|gif|webp)|video\/(?:mp4|webm)|application\/pdf|text\/plain|application\/zip|audio\/(?:mpeg|ogg|wav))$/;
function pick(itemId,personIndex){mediaTarget={itemId,personIndex};const picker=E('inlineMediaInput');picker.value='';picker.click();}
on('inlineMediaInput','change',async e=>{
 const file=e.target.files[0],target=mediaTarget;mediaTarget=null;
 if(!file||!target)return;
 if(file.size>15*1024*1024){status('15MB以下のファイルを指定してください',true);return;}
 const mime=file.type||'application/zip';
 if(!mimeAllowed.test(mime) || target.personIndex!==null&&!mime.startsWith('image/')){status('対応していないファイル形式です',true);return;}
 try{
  const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=()=>rej(r.error);r.readAsDataURL(file);});
  mutate(d=>{
   if(target.personIndex!==null){if(d.participants[target.personIndex])d.participants[target.personIndex].avatar=data;}
   else{const it=d.items.find(x=>x.id===target.itemId);if(it){
    it.media={data,mime,name:file.name};it.type='attachment';
    it.content=mime.startsWith('image/')?'[写真]':mime.startsWith('video/')?'[動画]':'[ファイル]';
   }}
  });status('ローカル素材を割り当てました');
 }catch(err){status('素材読込に失敗: '+err.message,true);}
 e.target.value='';
});
let focusStart=new WeakMap(),typingTimer;
const editorNode=el=>el?.matches('[data-edit-body],[data-edit-time]');
function readEdit(el){return el.hasAttribute('data-edit-body')?el.innerText.replace(/\r/g,'').replace(/\n$/,''):el.value;}
function flush(el,withoutRender=false){
 if(!editorNode(el))return;
 const id=el.dataset.editBody||el.dataset.editTime,field=el.hasAttribute('data-edit-body')?'content':'time';
 const it=itemById(id),v=readEdit(el);
 if(it&&it[field]!==v)mutate(d=>{const x=d.items.find(i=>i.id===id);if(x)x[field]=v;},{noRender:withoutRender});
}
transcript.addEventListener('focusin',e=>{if(editorNode(e.target))focusStart.set(e.target,readEdit(e.target));});
transcript.addEventListener('focusout',e=>{clearTimeout(typingTimer);flush(e.target);});
transcript.addEventListener('input',e=>{
 if(!editorNode(e.target))return;
 clearTimeout(typingTimer);
 const el=e.target;
 typingTimer=setTimeout(()=>{if(el.isConnected)flush(el,true);},750);
});
transcript.addEventListener('paste',e=>{
 if(!e.target.matches('[contenteditable]'))return;
 e.preventDefault();
 const t=e.clipboardData?.getData('text/plain')||'';
 if(document.queryCommandSupported?.('insertText'))document.execCommand('insertText',false,t);
 else{const sel=window.getSelection();if(sel?.rangeCount){const r=sel.getRangeAt(0);r.deleteContents();
 const n=document.createTextNode(t);r.insertNode(n);r.setStartAfter(n);r.collapse(true);sel.removeAllRanges();sel.addRange(r);}}
});
transcript.addEventListener('click',e=>{
 const del=e.target.closest('[data-delete-id]');
 if(del){mutate(d=>{d.items=d.items.filter(i=>i.id!==del.dataset.deleteId);});return;}
 const media=e.target.closest('[data-pick-media]');if(media)pick(media.dataset.pickMedia,null);
});
document.addEventListener('keydown',e=>{
 if(e.defaultPrevented||e.isComposing||!(e.ctrlKey||e.metaKey))return;
 if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}
 if(e.key.toLowerCase()==='y'){e.preventDefault();redo();}
 if(e.key.toLowerCase()==='s'){e.preventDefault();exportJson();}
});
let guide;
function clearDrag(){
 if(drag?.row){drag.row.style.transform='';drag.row.classList.remove('is-moving');}
 if(guide)guide.remove();guide=null;drag=null;
 document.body.classList.remove('editor-dragging');
}
transcript.addEventListener('pointerdown',e=>{
 const handle=e.target.closest('[data-drag-handle]'),row=handle?.closest('[data-entry-id]');
 if(!row||e.button>0)return;
 e.preventDefault();
 drag={id:row.dataset.entryId,row,x:e.clientX,y:e.clientY,zone:row.dataset.side,moved:false};
 handle.setPointerCapture?.(e.pointerId);
 row.classList.add('is-moving');document.body.classList.add('editor-dragging');
 guide=document.createElement('div');guide.className='editor-drop-guide';
 guide.innerHTML='<span>相手</span><span>システム</span><span>自分</span>';
 document.body.appendChild(guide);
 const r=transcript.getBoundingClientRect();
 Object.assign(guide.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
});
transcript.addEventListener('pointermove',e=>{
 if(!drag)return;
 const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
 drag.row.style.transform=`translate(${dx}px,${dy}px)`;
 if(Math.hypot(dx,dy)>6)drag.moved=true;
 const r=transcript.getBoundingClientRect(),x=(e.clientX-r.left)/r.width;
 drag.zone=x<.36?'you':x>.64?'me':'system';
 [...guide.children].forEach((el,i)=>el.classList.toggle('active',['you','system','me'][i]===drag.zone));
 if(e.clientY<r.top+28)transcript.scrollTop-=15;
 if(e.clientY>r.bottom-28)transcript.scrollTop+=15;
});
transcript.addEventListener('pointerup',e=>{
 if(!drag)return;
 const moved=drag.moved,id=drag.id,zone=drag.zone,row=drag.row;
 const others=[...transcript.querySelectorAll('[data-entry-id]')].filter(el=>el!==row);
 let pos=others.findIndex(el=>e.clientY<el.getBoundingClientRect().top+el.getBoundingClientRect().height/2);
 if(pos<0)pos=others.length;
 clearDrag();
 if(!moved)return;
 mutate(d=>{
  const old=d.items.findIndex(x=>x.id===id);if(old<0)return;
  const [it]=d.items.splice(old,1);
  if(zone==='system'){
   if(it.type!=='date'&&it.type!=='system'){it.previousType=it.type;it.type='system';}
   it.side='system';it.speaker='';
  }else{
   if(it.type==='system')it.type=['text','attachment','call'].includes(it.previousType)?it.previousType:'text';
   it.side=zone;it.speaker=zone==='me'?d.self:(d.participants.find(p=>p.name!==d.self)?.name||'相手');
  }
  d.items.splice(Math.max(0,Math.min(pos,d.items.length)),0,it);
 });
});
transcript.addEventListener('pointercancel',clearDrag);
render();restore();
})();
