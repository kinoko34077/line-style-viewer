'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','editor.js'),'utf8');

function creator(){
 const handlers=new Map(),controls={};
 function el(id){
  const e={innerHTML:'',value:'',dataset:{},disabled:false,scrollTop:0,scrollHeight:100,clientHeight:100,
   textContent:'',hidden:false,addEventListener(type,fn){handlers.set(id+':'+type,fn)}};
  controls[id]=e;return e;
 }
 for(const id of ['chatContainer','participantList','composeSpeaker','selfSelector','chatModeSelector','sourceStatus','editorErrorToast'])
  el(id);
 const doc={activeElement:null,body:{classList:{add(){},remove(){}}},getElementById(id){return controls[id]||null},
  addEventListener(){}};
 const context={document:doc,window:{},console,crypto:{randomUUID:()=>String(++creator.counter).padStart(4,'0')},
  localStorage:{getItem:()=>null},indexedDB:null,
  setTimeout:()=>1,clearTimeout(){},confirm:()=>true};
 vm.createContext(context);
 vm.runInContext(source,context,{filename:'editor.js'});
 function project(){return context.window.talkEditor.getProject();}
 function replace(data){context.window.talkEditor.replaceProject(data);}
 return {context,controls,handlers,project,replace,editor:context.window.talkEditor,
  remove(index){const target={closest(sel){return sel==='[data-delete-person-index]'?{dataset:{deletePersonIndex:String(index)}}:null;}};
   return handlers.get('participantList:click')({target});}};
}
creator.counter=0;
const speaker=(id,side,name)=>({id,type:'text',side,speaker:name,time:'12:00',content:id,previousType:'text'});
function base(){
 return {version:1,title:'設定名',self:'Alice',mode:'direct',theme:'normal',scale:120,
  participants:[{name:'Alice',avatar:''},{name:'Bob',avatar:''},{name:'Guest',avatar:''}],
  items:[speaker('aaa','me','Alice'),speaker('bbb','you','Bob')]};
}
test('new extra participant can be removed without changing existing messages; undo/redo work',()=>{
 const v=creator();v.replace(base());
 assert.match(v.controls.participantList.innerHTML,/data-delete-person-index="2"/);
 assert.doesNotMatch(v.controls.participantList.innerHTML,/data-delete-person-index="0"/);
 v.remove(2);
 assert.deepEqual(Array.from(v.project().participants,p=>p.name),['Alice','Bob']);
 assert.deepEqual(Array.from(v.project().items,i=>i.speaker),['Alice','Bob']);
 v.editor.undo();assert.equal(v.project().participants.length,3);
 v.editor.redo();assert.equal(v.project().participants.length,2);
});
test('deleting a referenced speaker requires consent and remaps, never deletes chat content',()=>{
 const v=creator(),d=base();
 d.items.push(speaker('ccc','you','Guest'));
 d.items[2].previousSpeaker='Guest';
 v.replace(d);
 let asked='';
 v.context.confirm=(message)=>{asked=message;return false;};
 v.remove(2);
 assert.equal(v.project().participants.length,3);
 assert.match(asked,/1件.*Bob/);
 v.context.confirm=()=>true;
 v.remove(2);
 assert.equal(v.project().items.length,3);
 assert.equal(v.project().items[2].speaker,'Bob');
 assert.equal(v.project().items[2].previousSpeaker,'Bob');
 assert.equal(v.project().participants.length,2);
 v.replace(v.project());
 assert.equal(v.project().items[2].speaker,'Bob','JSON round trip');
});
test('no peer left after deletion: new incoming message creates explicit valid peer',()=>{
 const v=creator(),d=base();
 d.participants=[{name:'Alice',avatar:''},{name:'Guest',avatar:''}];
 d.items=[speaker('aaa','me','Alice')];
 v.replace(d);v.remove(1);
 assert.deepEqual(Array.from(v.project().participants,p=>p.name),['Alice']);
 v.editor.addItem('text','you','hello');
 assert.equal(v.project().items[1].speaker,'相手');
 assert.deepEqual(Array.from(v.project().participants,p=>p.name),['Alice','相手']);
});
test('side and speaker stay coherent for restored and edited projects',()=>{
 const v=creator(),d=base();
 d.items.push({...speaker('ddd','you','Alice'),previousSpeaker:'Guest'});
 d.items.push({...speaker('eee','me','Bob')});
 d.items.push({...speaker('fff','system','Bob'),type:'system'});
 v.replace(d);
 const p=v.project();
 assert.equal(p.items[2].speaker,'Guest');
 assert.equal(p.items[3].speaker,'Alice');
 assert.equal(p.items[3].previousSpeaker,'Bob');
 assert.equal(p.items[4].speaker,'');
 v.editor.setIdentityAndMode('Bob','group');
 const updated=v.project();
 assert.equal(updated.self,'Bob');
 assert.equal(updated.items[1].side,'me');
 assert.equal(updated.items[1].speaker,'Bob');
 assert.equal(updated.items[0].side,'you');
 assert.equal(updated.items[0].speaker,'Alice');
 assert.match(v.controls.selfSelector.innerHTML,/<option value="Bob">Bob<\/option>/);
});
test('duplicate participant names in saved JSON collapse to one identity',()=>{
 const v=creator(),d=base();d.participants.push({name:'Bob',avatar:''});
 v.replace(d);
 assert.deepEqual(Array.from(v.project().participants,p=>p.name),['Alice','Bob','Guest']);
});
