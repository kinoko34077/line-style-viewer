'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const {createLineTxt,lineDate,bodyText}=require('../txt-export.js');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
function parse(text){
 const doc={
  getElementById(id){return id==='fileInput'?{addEventListener(){}}:null},
  addEventListener(){}
 };
 const ctx={document:doc,console};
 vm.createContext(ctx);
 vm.runInContext(source,ctx);
 return ctx.parseText(ctx.parseMultiline(text));
}
const item=(type,side,speaker,time,content,media=null)=>({type,side,speaker,time,content,media});
test('native TXT export is a reusable LINE backup with self identity, dates, speakers, and exact edited text',()=>{
 const doc={title:'B',self:'A',participants:[{name:'A'},{name:'B'}],items:[
  item('date','system','', '', '2025/10/10(金)'),
  item('text','me','A','20:42','改行がある\nメッセージ'),
  item('text','you','B','20:43','引用 "hello" と\tタブ'),
  item('attachment','you','B','20:44','[写真]'),
  item('system','system','','20:45','自由なシステム表示'),
  item('call','you','B','20:46','不在着信')
 ]};
 const txt=createLineTxt(doc,new Date(2026,9,14,16,25));
 assert.match(txt,/^\[LINE\] Bとのトーク履歴/m);
 assert.match(txt,/# user: A/);
 assert.match(txt,/2025\/10\/10\(金\)/);
 assert.match(txt,/20:42\tA\t"改行がある\nメッセージ"/);
 assert.match(txt,/20:43\tB\t"引用 ""hello"" と\tタブ"/);
 const parsed=parse(txt);
 assert.equal(parsed.meta.user,'A');
 assert.equal(parsed.meta.title,'B');
 assert.deepEqual(Array.from(parsed.items.map(i=>i.type)),['date','text','text','attachment','system','call']);
 assert.deepEqual(Array.from(parsed.items.map(i=>i.name)),[undefined,'A','B','B','','B']);
 assert.equal(parsed.items[1].content,doc.items[1].content);
 assert.equal(parsed.items[2].content,doc.items[2].content);
 assert.equal(parsed.items[4].content,'自由なシステム表示');
 assert.equal(parsed.items[4].time,'20:45');
 assert.equal(parsed.items[5].callKind,'missed');
 assert.equal(doc.items[1].speaker,'A');
});

test('non-standard edited timestamps remain reversible through explicit non-native entry markers',()=>{
 const txt=createLineTxt({title:'制作',self:'私',participants:[{name:'私'},{name:'相手'}],items:[
  item('text','me','私','適当','予定未定'),
  item('system','system','','','中央でお知らせ')
 ]},new Date(2026,9,14));
 const parsed=parse(txt);
 assert.equal(parsed.items[0].name,'私');
 assert.equal(parsed.items[0].time,'適当');
 assert.equal(parsed.items[0].content,'予定未定');
 assert.equal(parsed.items[1].type,'system');
 assert.equal(parsed.items[1].content,'中央でお知らせ');
});

test('binary image bytes never enter TXT, but their LINE placeholders do',()=>{
 const doc={title:'画像',self:'A',participants:[{name:'A'},{name:'B'}],items:[
  item('attachment','you','B','10:11','[写真]',{mime:'image/png',name:'private.png',data:'data:image/png;base64,AAAA'}),
  item('attachment','me','A','10:12','[ファイル]',{mime:'application/octet-stream',name:'private.zip',data:'data:application/octet-stream;base64,AAA'})
 ]};
 const txt=createLineTxt(doc);
 assert.match(txt,/10:11\tB\t\[写真\]/);
 assert.match(txt,/10:12\tA\t\[ファイル\]/);
 assert.doesNotMatch(txt,/base64|private\.png|private\.zip/);
 assert.deepEqual(Array.from(parse(txt).items.map(i=>i.type)),['attachment','attachment']);
});
test('year-specific display dates normalize to source dates and reject impossible dates',()=>{
 assert.equal(lineDate('2026年6月27日(土)',2026),'2026/06/27(土)');
 assert.equal(lineDate('6/27(土)',2026),'2026/06/27(土)');
 assert.equal(lineDate('2024/02/29(木)',2026),'2024/02/29(木)');
 assert.equal(lineDate('2025/02/29(土)',2026),null);
 assert.equal(bodyText('A\n"B"'),'"A\n""B"""');
});
