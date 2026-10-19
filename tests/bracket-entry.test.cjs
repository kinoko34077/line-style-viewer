const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const {createLineTxt} = require('../txt-export.js');
function load() {
  const chat = {innerHTML: ''};
  const ctx = {document: {getElementById(id) {
    if (id==='fileInput') return {addEventListener() {}};
    if (id==='chatContainer') return chat;
    return null;
  }}, console};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'script.js'),'utf8'),ctx);
  return {ctx,chat};
}
const parse = (ctx, rows) => ctx.parseText(ctx.parseMultiline(rows.join('\n'))).items;
const normalize = x=>JSON.parse(JSON.stringify(x));

test('square-bracketed missed calls and durations are exact call records',()=>{
 const {ctx,chat}=load();
 const rows=[
  '12:00\tA\t[不在着信]',
  '12:01\tB\t[不在着信(ビデオ通話)]',
  '12:02\tA\t[通話時間 00:15]',
  '12:03\tA\t[音声通話時間: 01:02:03]',
  '12:04\tA\t[ビデオ通話時間 00:42]'
 ];
 const items=parse(ctx,rows);
 assert.deepEqual(normalize(items.map(x=>x.type)),['call','call','call','call','call']);
 assert.deepEqual(normalize(items.map(x=>x.callKind)),['missed','missed','duration','duration','duration']);
 assert.ok(items.every(x=>x.entryKind==='call'));
 items.forEach((x,i)=>assert.equal(x.content,rows[i].split('\t')[2]));
 ctx.renderChat({items,meta:{user:'A',icons:{},title:'テスト'}});
 assert.equal((chat.innerHTML.match(/class="call-card"/g)||[]).length,5);
 assert.match(chat.innerHTML,/call-duration/);
});

test('known media and unknown brackets are distinct from ordinary text',()=>{
 const {ctx,chat}=load();
 const items=parse(ctx,[
 '12:00\tA\t[写真]','12:01\tA\t[動画]','12:02\tA\t[ファイル]',
 '12:03\tA\t[スタンプ]','12:04\tA\t[photo.jpg]',
 '12:05\tA\t[audio.wav]','12:06\tA\t[任意のイベント]',
 '12:07\tA\t<IMG onerror=alert(1)>','12:08\tA\t話題は[任意]だ',
 '12:09\tA\t[閉じ忘れ'
 ]);
 assert.deepEqual(normalize(items.map(x=>x.entryKind??'text')),[
 'media','media','media','media','media','media','annotation','text','text','text']);
 assert.equal(items[6].type,'text');
 ctx.renderChat({items,meta:{user:'A',icons:{},title:'確認'}});
 assert.match(chat.innerHTML,/bracket-notice/);
 assert.match(chat.innerHTML,/\[任意のイベント\]/);
 assert.match(chat.innerHTML,/&lt;IMG onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(chat.innerHTML,/<IMG onerror/);
});
test('bracket path resembling external URL cannot create remote src',()=>{
 const {ctx,chat}=load();
 const items=parse(ctx,['12:00\tA\t[https://example.org/track.png]']);
 ctx.renderChat({items,meta:{user:'A',icons:{},title:'テスト'}});
 assert.doesNotMatch(chat.innerHTML,/src="https:\/\/example\.org/);
 assert.equal(items[0].entryKind,'media');
});
test('special center-side entry survives TXT export and parser roundtrip',()=>{
 const {ctx}=load();
 const contents=['[不在着信]','[通話時間 00:15]','[任意のイベント]','[ファイル]'];
 const kinds=['call','call','text','attachment'];
 const attrs=['call','call','annotation','media'];
 const doc={version:1,self:'自分',title:'テスト',participants:[{name:'自分'},{name:'相手'}],
   items:contents.map((content,i)=>({id:'id-'+i,type:kinds[i],side:'system',time:'12:0'+i,
     content,entryKind:attrs[i],callKind:i===0?'missed':i===1?'duration':'',speaker:''}))};
 const serialized=createLineTxt(doc,new Date(2026,9,20,12,30));
 const items=normalize(parse(ctx,serialized.split('\n')));
 assert.equal(items.length,4);
 assert.deepEqual(items.map(x=>x.side),['system','system','system','system']);
 assert.deepEqual(normalize(items.map(x=>x.type)),kinds);
 assert.deepEqual(items.map(x=>x.content),contents);
 assert.deepEqual(items.map(x=>x.entryKind),attrs);
});
