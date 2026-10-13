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
let selectedEntryId=null;
let lastTap={id:null,at:0};
// Keep repeated edits to large inline photos from multiplying memory without bound.
function trimStack(stack){while(stack.length>1 && (stack.length>40 || stack.reduce((n,s)=>n+s.length,0)>32*1024*1024))stack.shift();}
const snapshot=()=>JSON.stringify(doc);
const allowedMedia=/^data:(?:image\/(?:png|jpeg|gif|webp)|video\/(?:mp4|webm)|application\/pdf|text\/plain|application\/zip|application\/octet-stream|audio\/(?:mpeg|ogg|wav));base64,/;
function sanitize(input){
 if(!input || input.version!==1 || !Array.isArray(input.items)||!Array.isArray(input.participants))throw Error('プロジェクト形式が不正です');
 if(input.items.length>25000)throw Error('メッセージ数が上限を超えています');
 const d=blank();
 d.title=String(input.title||'トーク').slice(0,180);
 d.self=String(input.self||'自分').slice(0,100);
 d.mode=['auto','direct','group'].includes(input.mode)?input.mode:'auto';
 d.theme=['normal','white','black'].includes(input.theme)?input.theme:'normal';
 d.scale=Math.min(160,Math.max(80,Number(input.scale)||120));
 d.participants=input.participants.slice(0,150).map(p=>{if(!p||typeof p!=='object')throw Error('話者の形式が不正です');return {name:String(p.name||'').slice(0,100),
   avatar:typeof p.avatar==='string'&&allowedMedia.test(p.avatar)&&p.avatar.startsWith('data:image/')?p.avatar:''};}).filter(p=>p.name);
 if(!d.participants.some(p=>p.name===d.self))d.participants.unshift({name:d.self,avatar:''});
 const seenIds=new Set();
 d.items=input.items.map(it=>{
   if(!it||typeof it!=='object'||Array.isArray(it))throw Error('メッセージの形式が不正です');
   let id=typeof it.id==='string'&&/^[\w-]{3,100}$/.test(it.id)?it.id:identifier();
   while(seenIds.has(id))id=identifier();
   seenIds.add(id);
   const type=['text','attachment','date','system','call'].includes(it.type)?it.type:'text';
   const media=it.media&&allowedMedia.test(it.media.data||'')?{data:it.media.data,mime:String(it.media.mime||''),name:String(it.media.name||'ファイル').slice(0,180)}:null;
   return {id,
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
// Serialize cache writes, so a delayed earlier IndexedDB transaction
// cannot finish after and replace a newer edited document.
let saveQueue=Promise.resolve();
function schedule(){
 const n=++dbCounter;
 clearTimeout(timer);
 timer=setTimeout(async()=>{
  if(n!==dbCounter)return;
  const data=snapshot();
  saveQueue=saveQueue.catch(()=>{}).then(()=>{
   if(n!==dbCounter)return;
   return saveCache(data);
  });
  try{
   await saveQueue;
   if(n===dbCounter)status('ブラウザ内に自動保存しました');
  }catch{
   if(n!==dbCounter)return;
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
 // An absent sticker is NOT a missing photograph. Preserve the original
 // exclamation-mark stamp asset even if a sticker was later bound to media.
 if(/^\[スタンプ\]$/.test(it.content))return 'stamp';
 if(it.media?.data){
   if(it.media.mime.startsWith('image/'))return 'image';
   if(it.media.mime.startsWith('video/'))return 'video';
   return 'file';
 }
 if(it.type==='attachment'||/^\[(写真|動画|ファイル|.*\.(?:png|jpg|jpeg|webp|gif|mp4|pdf))\]$/i.test(it.content)){
   if(/動画|\.mp4/i.test(it.content))return 'video';
   if(/ファイル|\.pdf/i.test(it.content))return 'file';
   return 'image';
 }
 return null;
}
const missingAsset=kind=>kind==='stamp'?'./default/default-stamp.png':'./default/default-photo.png';
function fields(){
 const p=E('participantList'),s=E('composeSpeaker'),gallery=E('unassignedGallery');
 if(p)p.innerHTML=doc.participants.map((x,i)=>`<div class="participant-row"><button type="button" data-avatar-index="${i}" class="avatar-picker" aria-label="アイコンを変更"><img src="${esc(x.avatar||'./default/default-icon.png')}" alt=""></button><input data-person-index="${i}" class="participant-name" aria-label="話者の名前" value="${esc(x.name)}">${x.name===doc.self?'<small>自分</small>':''}</div>`).join('');
 if(s){const old=s.value||s.dataset.preferred||doc.self;s.innerHTML=doc.participants.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');s.value=doc.participants.some(p=>p.name===old)?old:doc.self;}
 if(gallery && gallery.closest('.menu-expand')?.classList.contains('expanded')){const missing=doc.items.filter(x=>mediaKind(x)&&!x.media?.data);
  gallery.innerHTML=missing.length?missing.map(x=>`<button type="button" class="gallery-tile" data-pick-media="${esc(x.id)}" aria-label="${esc(x.content)}の素材を選択"><img src="${missingAsset(mediaKind(x))}" alt=""><span>${esc(x.content)}</span></button>`).join(''):'<p>未指定の写真・動画・ファイルはありません。</p>';
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
 const isGroupChat=group();
 const avatars=new Map(doc.participants.map(p=>[p.name,p.avatar||'./default/default-icon.png']));
 let prev=null;const html=[];
 for(const it of doc.items){
  const id=esc(it.id),center=it.side==='system'||it.type==='system'||it.type==='date';
  const grip='';
  const remove=`<button type="button" class="delete-entry" data-delete-id="${id}" aria-label="削除">×</button>`;
  const content=esc(it.content).replace(/\n/g,'<br>');
  const inline=`<span class="inline-body" contenteditable="false" role="textbox" aria-multiline="true" data-edit-body="${id}" aria-label="ダブルタップで編集">${it.type==='date'?esc(displayDateLabel(it.content)):content}</span>`;
  if(center){
   prev=null;
   html.push(`<div class="editable-entry centered-entry${selectedEntryId===it.id?' is-selected':''}" data-entry-id="${id}" data-side="system"><div class="${it.type==='date'?'date-label':'system'} edit-system">${inline}${remove}</div>${it.type==='date'?'':`<input aria-label="時刻" class="inline-time" data-edit-time="${id}" value="${esc(it.time)}" readonly tabindex="-1">`}</div>`);
   continue;
  }
  const mine=it.side==='me',m=/^\d{1,2}:\d{2}$/.test(it.time)?it.time:null;
  const grouped=!!(prev&&prev.speaker===it.speaker&&prev.side===it.side&&m&&m===prev.minute);
  const icon=mine?'':grouped?'<span class="icon-spacer" aria-hidden="true"></span>':`<img class="icon" src="${esc(avatars.get(it.speaker)||'./default/default-icon.png')}" alt="">`;
  const label=isGroupChat&&!mine&&!grouped&&it.speaker?`<span class="sender-name">${esc(it.speaker)}</span>`:'';
  let balloon=inline,kind=mediaKind(it);
  if(kind){
   if(it.media?.data){
    const url=esc(it.media.data);
    if(kind==='image'||kind==='stamp')balloon=`<button class="${kind==='stamp'?'bound-stamp':'bound-image'}" type="button" data-pick-media="${id}" aria-label="${kind==='stamp'?'スタンプ':'画像'}を変更"><img src="${url}" alt="${esc(it.media.name)}"></button>`;
    else if(kind==='video')balloon=`<div class="bound-video"><video src="${url}" controls playsinline></video><button type="button" data-pick-media="${id}">変更</button></div>`;
    else balloon=`<div class="bound-file"><a href="${url}" download="${esc(it.media.name)}">▤ ${esc(it.media.name)}</a><button type="button" data-pick-media="${id}">変更</button></div>`;
   }else balloon=`<button type="button" class="unassigned-media unassigned-${kind}" data-pick-media="${id}" aria-label="${kind==='stamp'?'スタンプ':kind==='image'?'画像':kind==='video'?'動画':'ファイル'}を選択"><img src="${missingAsset(kind)}" alt="${kind==='stamp'?'未指定のスタンプ':'未指定の'+(kind==='image'?'画像':kind==='video'?'動画':'ファイル')}">${kind==='video'?'<span class="unassigned-video-play" aria-hidden="true">▶</span>':''}</button>`;
  }
  html.push(`<div class="editable-entry talk ${mine?'me':'you'}${selectedEntryId===it.id?' is-selected':''}" data-entry-id="${id}" data-side="${it.side}"${grouped?' data-continuation="true"':''}>${icon}<div class="message-block-with-meta">${label}<div class="balloon${kind?' media-edit':''}">${balloon}${remove}</div><div class="meta-inline">${mine?'<span class="read">既読</span>':''}<input class="inline-time" aria-label="時刻" data-edit-time="${id}" value="${esc(it.time)}" readonly tabindex="-1"></div></div></div>`);
  prev={speaker:it.speaker,side:it.side,minute:m};
 }
 transcript.innerHTML=html.length?html.join(''):'<div class="editor-empty">下の入力欄からトークを作成できます。<br>メッセージはダブルタップで編集、長押しで移動できます。<br><button type="button" id="emptyImportButton">LINE履歴（TXT/MD）を読み込む</button></div>';
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
function focusBody(id){
 const target=transcript.querySelector(`[data-edit-body="${id}"]`);
 if(target){target.contentEditable='true';target.setAttribute('tabindex','0');target.focus();}
}
function exportJson(){
 const blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
 const link=document.createElement('a');link.href=url;link.download=doc.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,64)+'.linechat.json';
 document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);status('JSONを書き出しました');
}
function exportTxt(){
 if(!window.LineTxtExport) {status('TXT書出し機能を読み込めませんでした',true);return;}
 const text=window.LineTxtExport.createLineTxt(doc);
 const name=doc.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,64)||'トーク';
 const blob=new Blob(['\\uFEFF'.replace('\\uFEFF','\uFEFF')+text],{type:'text/plain;charset=utf-8'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=name+'.txt';
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),3000);
 if(E('saveFormatMenu'))E('saveFormatMenu').hidden=true;
 status('LINE形式のTXTを書き出しました（画像本体・編集履歴はJSONのみ保持）');
}
async function importJson(file){
 if(!file)return;
 try{if(file.size>120*1024*1024)throw Error('ファイルサイズ超過');const text=await file.text();if(text.length>120*1024*1024)throw Error('ファイルサイズ超過');
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
 addItem,undo,redo,exportProject:exportJson,exportTxt,importProject:importJson,replaceProject:p=>mutate(()=>{doc=sanitize(p);}),render};
const on=(id,event,fn)=>E(id)?.addEventListener(event,fn);
on('undoButton','click',undo);on('redoButton','click',redo);
on('saveButton','click',()=>{
 const menu=E('saveFormatMenu');if(menu)menu.hidden=!menu.hidden;
});
on('saveTxtButton','click',exportTxt);
on('saveJsonButton','click',()=>{E('saveFormatMenu').hidden=true;exportJson();});
on('exportTxtButton','click',exportTxt);
on('exportProjectButton','click',exportJson);
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
on('selfSelector','change',e=>{const s=E('composeSpeaker');if(s){s.dataset.preferred=e.target.value;s.value=e.target.value;}});
on('composeSpeaker','change',e=>{e.target.dataset.preferred=e.target.value;});
on('sendButton','click',send);
on('composeInput','keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}});
function menu(show){const m=E('addMessageMenu');if(m)m.hidden=show===undefined?!m.hidden:!show;}
on('addMenuToggle','click',()=>menu());
on('addIncomingButton','click',()=>{menu(false);focusBody(addItem('text','you','').id);});
on('addSystemButton','click',()=>{menu(false);focusBody(addItem('system','system','システムメッセージ').id);});
on('addDateButton','click',()=>{menu(false);addItem('date','system',today());});
on('addMediaPlaceholderButton','click',()=>{menu(false);addItem('attachment','you','[写真]');});
on('addStampPlaceholderButton','click',()=>{menu(false);addItem('attachment','you','[スタンプ]');});
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
 if(row){
  const section=E(row.dataset.toggleSection);
  section?.classList.toggle('expanded');
  if(section?.id==='mediaGallery' && section.classList.contains('expanded'))fields();
 }
 const tile=e.target.closest('[data-pick-media]');if(tile)pick(tile.dataset.pickMedia,null);
});
const mimeAllowed=/^(image\/(?:png|jpeg|gif|webp)|video\/(?:mp4|webm)|application\/pdf|text\/plain|application\/zip|audio\/(?:mpeg|ogg|wav))$/;
function pick(itemId,personIndex){mediaTarget={itemId,personIndex};const picker=E('inlineMediaInput');picker.accept=personIndex===null?'':'image/png,image/jpeg,image/gif,image/webp';picker.value='';picker.click();}
on('inlineMediaInput','change',async e=>{
 const file=e.target.files[0],target=mediaTarget;mediaTarget=null;
 if(!file||!target)return;
 if(file.size>15*1024*1024){status('15MB以下のファイルを指定してください',true);return;}
 const mime=file.type||'application/octet-stream';
 if(target.personIndex!==null&&!/^image\/(?:png|jpeg|gif|webp)$/.test(mime)){status('アイコンはPNG/JPEG/GIF/WebPの画像のみ指定できます',true);return;}
 try{
  let data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=()=>rej(r.error);r.readAsDataURL(file);});
  // Unknown document types remain local generic downloads, never executable
  // image or HTML document previews through a data URL.
  const safeMime=mimeAllowed.test(mime)?mime:'application/octet-stream';
  if(safeMime==='application/octet-stream')data=data.replace(/^data:[^,]*/, 'data:application/octet-stream;base64');
  mutate(d=>{
   if(target.personIndex!==null){if(d.participants[target.personIndex])d.participants[target.personIndex].avatar=data;}
   else{const it=d.items.find(x=>x.id===target.itemId);if(it){
    it.media={data,mime:safeMime,name:file.name};it.type='attachment';
    it.content=it.content==='[スタンプ]'?'[スタンプ]':safeMime.startsWith('image/')?'[写真]':safeMime.startsWith('video/')?'[動画]':'[ファイル]';
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
 const it=itemById(id);
 let v=readEdit(el);
 if(it?.type==='date'&&field==='content'){
   const short=/^(\d{1,2})\/(\d{1,2})(\([^)]*\))?$/.exec(v.trim());
   if(short){
     const oldYear=/^(\d{4})\//.exec(it.content)?.[1]||new Date().getFullYear();
     v=`${oldYear}/${String(Number(short[1])).padStart(2,'0')}/${String(Number(short[2])).padStart(2,'0')}${short[3]||''}`;
   }
 }
 if(it&&it[field]!==v)mutate(d=>{const x=d.items.find(i=>i.id===id);if(x)x[field]=v;},{noRender:withoutRender});
}
transcript.addEventListener('focusin',e=>{if(editorNode(e.target))focusStart.set(e.target,readEdit(e.target));});
transcript.addEventListener('focusout',e=>{
 clearTimeout(typingTimer);
 const el=e.target;
 if(editorNode(el)){
   flush(el);
   if(el.isConnected && el.hasAttribute('data-edit-body')){
     const item=itemById(el.dataset.editBody);
     if(item?.type==='date')el.textContent=displayDateLabel(item.content);
     el.contentEditable='false';el.removeAttribute('tabindex');
   }else if(el.isConnected && el.hasAttribute('data-edit-time')){
     el.readOnly=true;el.tabIndex=-1;
   }
 }
});
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
function selectEntry(id) {
 if(selectedEntryId===id)return;
 const previous=transcript.querySelector('.editable-entry.is-selected');
 if(previous)previous.classList.remove('is-selected');
 selectedEntryId=id;
 if(id){
  const next=transcript.querySelector(`[data-entry-id="${CSS.escape(id)}"]`);
  if(next)next.classList.add('is-selected');
 }
}
function enableInline(target,row){
 if(!row)return;
 const node=target?.closest?.('[data-edit-body],[data-edit-time]') ||
  row.querySelector('[data-edit-body]') || row.querySelector('[data-edit-time]');
 if(!node)return;
 selectEntry(row.dataset.entryId);
 if(node.hasAttribute('data-edit-body')){
   const item=itemById(row.dataset.entryId);
   // Show the canonical full year only while editing. Double-tapping and
   // blurring an unchanged current-year date must never strip its year.
   if(item?.type==='date')node.textContent=item.content;
   node.contentEditable='true';
   node.tabIndex=0;
 }else{
   node.readOnly=false;
   node.tabIndex=0;
 }
 node.focus();
 if(node.hasAttribute('data-edit-time'))node.select();
}
transcript.addEventListener('dblclick',e=>{
 if(e.target.closest('[data-pick-media],.delete-entry,video,a'))return;
 const row=e.target.closest('[data-entry-id]');
 if(row)enableInline(e.target,row);
});
transcript.addEventListener('click',e=>{
 const empty=e.target.closest('#emptyImportButton');
 if(empty){E('fileInput')?.click();return;}
 const del=e.target.closest('[data-delete-id]');
 if(del){
  const id=del.dataset.deleteId;
  selectedEntryId=null;
  mutate(d=>{d.items=d.items.filter(i=>i.id!==id);});return;
 }
 const media=e.target.closest('[data-pick-media]');
 if(media){pick(media.dataset.pickMedia,null);return;}
 const row=e.target.closest('[data-entry-id]');
 if(row)selectEntry(row.dataset.entryId);
 else selectEntry(null);
});
document.addEventListener('keydown',e=>{
 if(e.defaultPrevented||e.isComposing||!(e.ctrlKey||e.metaKey))return;
 if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}
 if(e.key.toLowerCase()==='y'){e.preventDefault();redo();}
 if(e.key.toLowerCase()==='s'){e.preventDefault();exportJson();}
});
// Native-like gestures: single tap selects, double tap edits, and
// dragging the bubble itself moves it. Touch drag starts after a brief hold
// so ordinary vertical scrolling retains its normal mobile behavior.
let guide, pendingPointer=null, holdTimer=null;
function selectFromPointer(e,row){
 const now=Date.now(),id=row.dataset.entryId;
 const twice=lastTap.id===id && now-lastTap.at<360;
 lastTap={id,at:now};
 if(twice)enableInline(e.target,row);else selectEntry(id);
}
function clearDrag(){
 clearTimeout(holdTimer);holdTimer=null;
 if(drag?.frame!=null)cancelAnimationFrame(drag.frame);
 if(drag?.row){drag.row.style.transform='';drag.row.classList.remove('is-moving');}
 if(guide)guide.remove();guide=null;drag=null;pendingPointer=null;
 document.body.classList.remove('editor-dragging');
}
function beginDrag(info){
 if(!info || drag)return;
 const row=info.row;
 // Measure once per drag rather than forcing layout on every pointer event.
 const bounds=transcript.getBoundingClientRect();
 drag={id:row.dataset.entryId,row,x:info.x,y:info.y,zone:row.dataset.side,
   drawnZone:null,lastX:info.x,lastY:info.y,moved:false,
   bounds,frame:null,guides:null};
 try{row.setPointerCapture?.(info.pointerId);}catch{}
 row.classList.add('is-moving');document.body.classList.add('editor-dragging');
 guide=document.createElement('div');guide.className='editor-drop-guide';
 guide.innerHTML='<span>相手</span><span>システム</span><span>自分</span>';
 drag.guides=Array.from(guide.children);
 document.body.appendChild(guide);
 Object.assign(guide.style,{left:bounds.left+'px',top:bounds.top+'px',
   width:bounds.width+'px',height:bounds.height+'px'});
}
transcript.addEventListener('pointerdown',e=>{
 const row=e.target.closest('[data-entry-id]');
 if(!row||e.button>0||e.target.closest('button,a,video,[contenteditable="true"],input:not([readonly])'))return;
 const info={row,x:e.clientX,y:e.clientY,pointerId:e.pointerId,
   type:e.pointerType,target:e.target,at:Date.now()};
 pendingPointer=info;
 if(e.pointerType==='touch'){
   holdTimer=setTimeout(()=>{if(pendingPointer===info)beginDrag(info);},320);
 }
 // For mouse, start only AFTER moving 6px: keeping pointer capture off
 // normal taps is essential to target the time field on double-click.
});
function paintDragFrame(){
 if(!drag)return;
 drag.frame=null;
 const {row,bounds,lastX,lastY,x,y,zone}=drag;
 row.style.transform=`translate3d(${lastX-x}px,${lastY-y}px,0)`;
 if(zone!==drag.drawnZone){
   drag.drawnZone=zone;
   drag.guides.forEach((element,i)=>
     element.classList.toggle('active',['you','system','me'][i]===zone));
 }
 if(lastY<bounds.top+28)transcript.scrollTop-=15;
 else if(lastY>bounds.bottom-28)transcript.scrollTop+=15;
}
transcript.addEventListener('pointermove',e=>{
 if(pendingPointer && !drag){
   const delta=Math.hypot(e.clientX-pendingPointer.x,e.clientY-pendingPointer.y);
   if(pendingPointer.type==='touch'){
     if(delta>9){clearTimeout(holdTimer);holdTimer=null;pendingPointer=null;}
     return;
   }
   if(delta>6)beginDrag(pendingPointer);
   else return;
 }
 if(!drag)return;
 if(e.cancelable)e.preventDefault();
 const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
 if(Math.hypot(dx,dy)>6)drag.moved=true;
 drag.lastX=e.clientX;drag.lastY=e.clientY;
 const fraction=(e.clientX-drag.bounds.left)/drag.bounds.width;
 drag.zone=fraction<.36?'you':fraction>.64?'me':'system';
 // Coalesce high-frequency input into one visual update per animation frame.
 if(drag.frame==null)drag.frame=requestAnimationFrame(paintDragFrame);
});
transcript.addEventListener('pointerup',e=>{
 if(pendingPointer && !drag){
   const row=pendingPointer.row;
   clearDrag();
   if(e.pointerType==='touch')selectFromPointer(e,row);
   return;
 }
 if(!drag)return;
 const moved=drag.moved,id=drag.id,zone=drag.zone,row=drag.row;
 const others=[...transcript.querySelectorAll('[data-entry-id]')].filter(el=>el!==row);
 let pos=others.findIndex(el=>e.clientY<el.getBoundingClientRect().top+el.getBoundingClientRect().height/2);
 if(pos<0)pos=others.length;
 clearDrag();
 if(!moved){selectEntry(id);return;}
 selectedEntryId=null;
 mutate(d=>{
  const old=d.items.findIndex(x=>x.id===id);if(old<0)return;
  const [it]=d.items.splice(old,1);
  if(zone==='system'){
   if(it.type!=='date'&&it.type!=='system'){it.previousType=it.type;it.type='system';}
   it.side='system';it.speaker='';
  }else{
   if(it.type==='system')it.type=['text','attachment','call'].includes(it.previousType)?it.previousType:'text';
   if(it.type==='date')it.type='text';
   const oldSide=it.side;
   it.side=zone;
   // Keep each original group participant when moving only within the peer side.
   if(zone==='me')it.speaker=d.self;
   else if(oldSide!=='you'||!it.speaker||it.speaker===d.self)
     it.speaker=d.participants.find(p=>p.name!==d.self)?.name||'相手';
  }
  d.items.splice(Math.max(0,Math.min(pos,d.items.length)),0,it);
 });
});
transcript.addEventListener('pointercancel',clearDrag);
render();restore();
})();
