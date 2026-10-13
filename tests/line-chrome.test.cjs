const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'script.js'),'utf8');
const css=fs.readFileSync(path.join(root,'style.css'),'utf8');

function viewer() {
  const controls={};
  const listeners={};
  const document={
    documentElement:{dataset:{theme:'normal'},style:{values:{},setProperty(n,v){this.values[n]=v}}},
    addEventListener(name,fn){listeners['document:'+name]=fn},
    createElement(){return {value:'',textContent:''}},
    getElementById(id){return controls[id]||null}
  };
  const element=id=>{
    const e={id,value:'',textContent:'',hidden:false,disabled:false,files:[],attributes:{},
      options:[],setAttribute(k,v){this.attributes[k]=v},
      addEventListener(k,fn){listeners[id+':'+k]=fn},
      replaceChildren(...x){this.options=[...x]},
      appendChild(v){this.options.push(v)},
      focus(){this.focused=true}
    };
    controls[id]=e;return e;
  };
  for(const id of ['fileInput','sourceStatus','selfSelector','chatModeSelector','conversationTitle',
    'menuToggle','settingsBackdrop','settingsClose','scaleControl','scaleOutput','themeSelector'])element(id);
  controls.settingsBackdrop.hidden=true;
  controls.selfSelector.options=[];
  controls.sourceStatus.dataset={};
  controls.fileInput.files=[];
  controls.scaleControl.value='120';
  controls.themeSelector.value='normal';
  controls.selfSelector.value='';
  controls.chatModeSelector.value='auto';
  controls.chatContainer={innerHTML:''};
  const ctx={document,console,Date};
  vm.createContext(ctx);
  vm.runInContext(script,ctx);
  return {controls,listeners,document,ctx,async load(source){
    controls.fileInput.files=[{name:'example.txt',text:async()=>source}];
    await listeners['fileInput:change']({target:controls.fileInput});
  },act(id,event='change'){return listeners[id+':'+event]({target:controls[id]})}};
}

test('native-like shell contains a title and nonfunctional media controls, but functional settings',()=>{
  assert.match(html,/id="conversationTitle">トーク履歴<\/h1>/);
  assert.match(html,/id="menuToggle"[^>]*aria-expanded="false"/);
  assert.match(html,/<main id="chatContainer" role="log"/);
  assert.match(html,/<footer class="conversation-footer"/);
  assert.match(html,/class="compose-mock"/);
  assert.doesNotMatch(html,/<form[^>]*id="compose"/);
  assert.match(html,/id="settingsBackdrop" hidden/);
  assert.match(html,/id="scaleControl" type="range" min="80" max="160" step="10" value="120"/);
  assert.match(html,/<option value="normal">通常<\/option>/);
  assert.match(html,/<option value="black">ブラック<\/option>/);
  assert.match(html,/<option value="white">ホワイト<\/option>/);
  assert.match(css,/\.app-shell\s*\{[^}]*zoom:\s*var\(--ui-scale\);/);
  assert.match(css,/#chatContainer\s*\{[^}]*overflow-y:\s*auto;/);
});

test('chat title comes from LINE TXT heading, with no image or HTML injection',async()=>{
  const v=viewer();
  assert.equal(v.controls.conversationTitle.textContent,'');
  await v.load('[LINE] Bとのトーク履歴\n保存日時：2026/10/13 22:30\n22:30\tA\tHello');
  assert.equal(v.controls.conversationTitle.textContent,'B');
  await v.load('[LINE] グループのみんなのトーク履歴\n22:31\tB\tHi');
  assert.equal(v.controls.conversationTitle.textContent,'グループのみんな');
  const evil='<img src=x onerror=alert(1)>';
  await v.load('[LINE] '+evil+'とのトーク履歴\n22:32\tB\t<test>');
  assert.equal(v.controls.conversationTitle.textContent,evil);
  assert.doesNotMatch(v.controls.chatContainer.innerHTML,/<test>/);
  await v.load('22:31\tB\tno header');
  assert.equal(v.controls.conversationTitle.textContent,'トーク履歴');
});

test('menu open, theme selection, full-scale zoom and Esc close work without writing source',async()=>{
  const v=viewer();
  await v.load('[LINE] Bとのトーク履歴\n11:20\tA\thello');
  v.act('menuToggle','click');
  assert.equal(v.controls.settingsBackdrop.hidden,false);
  assert.equal(v.controls.menuToggle.attributes['aria-expanded'],'true');
  assert.equal(v.controls.settingsClose.focused,true);
  v.controls.scaleControl.value='160';v.act('scaleControl','input');
  assert.equal(v.document.documentElement.style.values['--ui-scale'],'1.6');
  assert.equal(v.controls.scaleOutput.textContent,'160%');
  v.controls.scaleControl.value='70';v.act('scaleControl','input');
  assert.equal(v.controls.scaleControl.value,'80');
  v.controls.themeSelector.value='black';v.act('themeSelector');
  assert.equal(v.document.documentElement.dataset.theme,'black');
  v.controls.themeSelector.value='white';v.act('themeSelector');
  assert.equal(v.document.documentElement.dataset.theme,'white');
  v.controls.themeSelector.value='normal';v.act('themeSelector');
  assert.equal(v.document.documentElement.dataset.theme,'normal');
  v.listeners['document:keydown']({key:'Escape'});
  assert.equal(v.controls.settingsBackdrop.hidden,true);
  assert.equal(v.controls.menuToggle.attributes['aria-expanded'],'false');
  assert.equal(v.controls.conversationTitle.textContent,'B');
});
