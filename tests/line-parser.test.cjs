const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.resolve(__dirname, '..', 'script.js');
const source = fs.readFileSync(scriptPath, 'utf8');

function loadParser() {
  const fileInput = { addEventListener() {} };
  const chatContainer = { innerHTML: '' };
  const context = {
    document: {
      getElementById(id) {
        if (id === 'fileInput') return fileInput;
        if (id === 'chatContainer') return chatContainer;
        return null;
      }
    },
    console
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'script.js' });
  return context;
}

test('quoted multiline message remains one chat item', () => {
  const parser = loadParser();
  const input = [
    '22:10\tkino\t"first line',
    'second line"',
    '22:11\ttaro\tnext'
  ].join('\n');

  const parsed = parser.parseText(parser.parseMultiline(input));
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].type, 'text');
  assert.equal(parsed.items[0].name, 'kino');
  assert.equal(parsed.items[0].content, 'first line\nsecond line');
  assert.equal(parsed.items[1].content, 'next');
});

test('single-line chat messages remain unchanged', () => {
  const parser = loadParser();
  const parsed = parser.parseText(parser.parseMultiline('22:10\tkino\thello'));
  assert.deepEqual(
    JSON.parse(JSON.stringify(parsed.items)),
    [{ type: 'text', name: 'kino', time: '22:10', content: 'hello' }]
  );
});

test('icon declaration preserves equals signs in URL value', () => {
  const parser = loadParser();
  const parsed = parser.parseText('# icon: taro=https://example.test/icon.png?token=a=b');
  assert.equal(parsed.meta.icons.taro, 'https://example.test/icon.png?token=a=b');
});


test('repeated LINE backup headers are metadata; a newer full snapshot adds only new messages', () => {
  const parser = loadParser();
  const input = [
    '[LINE] Bとのトーク履歴',
    '保存日時：2017/05/07 23:42',
    '2017/04/24(月)',
    '23:00\tA\t最初',
    '23:01\tB\t[ファイル]',
    '',
    '[LINE] Bとのトーク履歴',
    '保存日時：2017/05/12 10:00',
    '2017/04/24(月)',
    '23:00\tA\t最初',
    '23:01\tB\t[ファイル]',
    '2017/04/25(火)',
    '09:00\tA\t追加'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(input));
  const messages = parsed.items.filter((item) => item.type !== 'date');
  const dates = parsed.items.filter((item) => item.type === 'date');
  assert.equal(messages.length, 3);
  assert.deepEqual(Array.from(messages, (item) => item.content), ['最初', '[ファイル]', '追加']);
  assert.deepEqual(Array.from(dates, (item) => item.content), ['2017/04/24(月)', '2017/04/25(火)']);
  assert.equal(parsed.items.some((item) => /トーク履歴|保存日時/.test(item.content)), false);
});

test('partially overlapping appended snapshots stitch at the matching tail', () => {
  const parser = loadParser();
  const input = [
    '[LINE] Bとのトーク履歴',
    '保存日時：2017/05/07 23:42',
    '2017/04/24(月)',
    '08:00\tA\tone',
    '08:01\tB\ttwo',
    '08:02\tA\tthree',
    '[LINE] Bとのトーク履歴',
    '保存日時：2017/05/08 10:00',
    '2017/04/24(月)',
    '08:02\tA\tthree',
    '08:03\tB\tfour',
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(input));
  assert.deepEqual(
    Array.from(parsed.items.filter((item) => item.type !== 'date'), (item) => item.content),
    ['one', 'two', 'three', 'four']
  );
  assert.equal(parsed.items.filter((item) => item.type === 'date').length, 1);
});

test('distinct messages sharing the same text and timestamp remain distinct across days', () => {
  const parser = loadParser();
  const input = [
    '[LINE] Bとのトーク履歴',
    '2017/04/24(月)',
    '08:00\tA\tOK',
    '08:01\tA\tOK',
    '[LINE] Bとのトーク履歴',
    '2017/04/25(火)',
    '08:00\tA\tOK'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(input));
  assert.equal(parsed.items.filter((item) => item.content === 'OK').length, 3);
});

test('headers inside quoted multiline messages stay in the message body', () => {
  const parser = loadParser();
  const input = [
    '2017/04/24(月)',
    '08:00\tA\t"begin',
    '[LINE] Bとのトーク履歴',
    '保存日時：2017/05/07 23:42',
    'end"',
    '08:01\tB\tafter'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(input));
  const messages = parsed.items.filter((item) => item.type !== 'date');
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /\[LINE\] Bとのトーク履歴/);
  assert.match(messages[0].content, /保存日時：2017/);
});

test('media tokens keep type without invented expiry text; named files and escaping remain safe', () => {
  const parser = loadParser();
  const imported = [
    '12:00\tA\t[ファイル]',
    '12:01\tA\t[動画]',
    '12:02\tA\t[写真]',
    '12:03\tA\t[スタンプ]',
    '12:04\tA\t[photo.jpg]',
    '12:05\tA\t<img src=x onerror=alert(1)>'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(imported));
  parser.renderChat(parsed);
  const html = parser.document.getElementById('chatContainer').innerHTML;
  assert.match(html, /class="file-card"/);
  assert.match(html, /class="file-card-label">ファイル<\/span>/);
  assert.equal((html.match(/class="media-placeholder"/g) || []).length, 2);
  assert.match(html, /aria-label="写真の内容はテキスト履歴に含まれません"/);
  assert.match(html, /aria-label="動画の内容はテキスト履歴に含まれません"/);
  assert.doesNotMatch(html, /保存期間が終了しています/);
  assert.doesNotMatch(html, /expired-media-caption/);
  assert.match(html, /default-stamp\.png/);
  assert.match(html, /src="photo\.jpg"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
});

test('an entirely repeated older backup is skipped, not rendered twice', () => {
  const parser = loadParser();
  const input = [
    '[LINE] Bとのトーク履歴',
    '2017/04/24(月)',
    '08:00\tA\tone',
    '08:01\tB\ttwo',
    '08:02\tA\tthree',
    '[LINE] Bとのトーク履歴',
    '2017/04/24(月)',
    '08:00\tA\tone',
    '08:01\tB\ttwo'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(input));
  assert.deepEqual(
    Array.from(parsed.items.filter((item) => item.type !== 'date'), (item) => item.content),
    ['one', 'two', 'three']
  );
});


test('unterminated leading quote does not absorb later exported messages or dates', () => {
  const parser = loadParser();
  const input = [
    '2017/04/24(月)',
    '08:00\tA\t"not closed',
    '08:01\tB\tmust survive',
    '2017/04/25(火)',
    '09:00\tA\tlater day'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(input));
  const messages = parsed.items.filter((item) => item.type !== 'date');
  assert.deepEqual(
    Array.from(messages, (item) => item.content),
    ['"not closed', 'must survive', 'later day']
  );
  assert.deepEqual(
    Array.from(parsed.items.filter((item) => item.type === 'date'), (item) => item.content),
    ['2017/04/24(月)', '2017/04/25(火)']
  );
});

test('normal authored messages mentioning calls remain ordinary chat records', () => {
  const parser = loadParser();
  const input = [
    '12:00\tA\t今夜通話したい',
    '12:01\tB\t通話の音質が悪い',
    '12:02\tA\t音声通話時間 00:12'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(input));
  assert.deepEqual(
    Array.from(parsed.items, (item) => item.type),
    ['text', 'text', 'call']
  );
  assert.equal(parsed.items[0].name, 'A');
  assert.equal(parsed.items[1].name, 'B');
});

test('different-time call notices are not collapsed by snapshot overlap', () => {
  const parser = loadParser();
  const input = [
    '[LINE] Bとのトーク履歴',
    '2017/04/24(月)',
    '12:00\t\t通話時間 00:15',
    '[LINE] Bとのトーク履歴',
    '2017/04/24(月)',
    '13:00\t\t通話時間 00:15'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(input));
  const calls = parsed.items.filter((item) => item.type === 'call');
  assert.equal(calls.length, 2);
  assert.deepEqual(Array.from(calls, (item) => item.time), ['12:00', '13:00']);
});

test('an exact repeated call notice still deduplicates', () => {
  const parser = loadParser();
  const input = [
    '[LINE] Bとのトーク履歴',
    '2017/04/24(月)',
    '12:00\t\t通話時間 00:15',
    '[LINE] Bとのトーク履歴',
    '2017/04/24(月)',
    '12:00\t\t通話時間 00:15'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(input));
  assert.equal(parsed.items.filter((item) => item.type === 'call').length, 1);
});


test('a blank sender does not convert ordinary messages and files into center system pills', () => {
  const parser = loadParser();
  const input = [
    '2026/10/13(火)',
    '09:00\t\t発言者不明の通常文',
    '09:01\t\t[ファイル]',
    '09:02\tA\t通話したい',
    '09:03\tA\tさっきメッセージを取り消しました',
    '09:04\tA\tメッセージを取り消しました',
    '09:05\t\tAがメッセージを取り消しました',
  ].join('\n');
  const items = parser.parseText(parser.parseMultiline(input)).items.filter(i => i.type !== 'date');
  assert.deepEqual(Array.from(items,i=>i.type), ['text','attachment','text','text','text','system']);
  assert.equal(items[0].name, '');
  assert.equal(items[1].content, '[ファイル]');
});

test('iOS and Android missed and declined calls are typed as speaker-sided call cards', () => {
  const parser = loadParser();
  const inputs = [
    '09:00\tB\t不在着信',
    '09:01\tB\t☎ 不在着信',
    '09:02\tA\t☎ 通話に応答がありませんでした',
    '09:03\tA\t応答なし',
    '09:04\tA\t☎ 通話をキャンセルしました',
    '09:05\tA\t通話をキャンセルしました。',
    '09:06\tA\t☎ 通話時間 0:38',
    '09:07\tB\t音声通話時間 00:12',
    '09:08\tA\t通話については明日',
    '09:09\t\tファイルの話'
  ].join('\n');
  const items = parser.parseText(parser.parseMultiline(inputs)).items;
  assert.deepEqual(Array.from(items, i => i.type), [
    'call','call','call','call','call','call','call','call','text','text'
  ]);
  assert.deepEqual(Array.from(items.filter(i => i.type==='call'), i=>i.callKind),
    ['missed','missed','unanswered','unanswered','cancelled','cancelled','duration','duration']);
});

test('real service events remain centered, but ordinary sender-authored descriptions do not', () => {
  const parser = loadParser();
  const input = [
    '12:00\t\t私がメッセージを取り消しました',
    '12:01\t\tメッセージの送信を取り消しました。',
    '12:02\t\tグループ音声通話が開始されました。',
    '12:03\tA\t今日はグループ通話が開始されましたね',
    '12:04\tA\tAがメッセージを取り消しました'
  ].join('\n');
  const items = parser.parseText(parser.parseMultiline(input)).items;
  assert.deepEqual(Array.from(items, i => i.type), ['system','system','system','text','text']);
});

test('all recognized call kinds have bubbles and time, with missed calls on received side', () => {
  const parser = loadParser();
  const imported = [
    '10:00\tA\t不在着信',
    '10:01\tA\t☎ 通話に応答がありませんでした',
    '10:02\tB\t通話時間 00:01'
  ].join('\n');
  const parsed=parser.parseText(parser.parseMultiline(imported));
  parsed.meta.user='A';
  parser.renderChat(parsed);
  const html=parser.document.getElementById('chatContainer').innerHTML;
  assert.equal((html.match(/class="call-card"/g)||[]).length,3);
  assert.equal((html.match(/class="call-icon"/g)||[]).length,3);
  assert.doesNotMatch(html,/☎ 通話に応答がありませんでした/);
  assert.match(html,/class="talk you"[\s\S]*?不在着信/);
  assert.match(html,/class="talk me"[\s\S]*?通話に応答がありませんでした/);
  assert.match(html,/class="time">10:02/);
  assert.doesNotMatch(html,/class="system">不在着信/);
});


test('consecutive nameless text and attachments inherit the last explicit sender', () => {
  const parser = loadParser();
  const input = [
    '2026/10/13(火)',
    '09:00\tA\tfirst',
    '09:01\t\tsecond',
    '09:02\t\t[ファイル]',
    '09:03\tB\treply',
    '09:04\t\tfollow-up',
    '09:05\t\t[写真]'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(input));
  const messages = parsed.items.filter(item => item.type !== 'date');
  assert.deepEqual(Array.from(messages, item => item.name), ['A', 'A', 'A', 'B', 'B', 'B']);
  assert.deepEqual(Array.from(messages, item => item.type),
    ['text', 'text', 'attachment', 'text', 'text', 'attachment']);
  assert.deepEqual(Array.from(messages, item => item.time),
    ['09:00', '09:01', '09:02', '09:03', '09:04', '09:05']);
  assert.ok(input.includes('09:01\t\tsecond'), 'source must remain unchanged');
});

test('speaker inference cannot cross a dated day, pasted backup, system or call boundary', () => {
  const parser = loadParser();
  const input = [
    '[LINE] Bとのトーク履歴',
    '2026/10/12(月)',
    '08:00\tA\tfirst',
    '08:01\t\tsecond',
    '2026/10/13(火)',
    '09:00\t\tnew day unknown',
    '09:01\tB\tnew explicit speaker',
    '09:02\t\tB continued',
    '09:03\t\tBがメッセージを取り消しました',
    '09:04\t\tunknown after unsend',
    '09:05\tA\tnamed again',
    '09:06\t\t不在着信',
    '09:07\t\tunknown after call',
    '[LINE] Bとのトーク履歴',
    '保存日時：2026/10/14 10:00',
    '2026/10/14(水)',
    '10:00\t\tunknown first row in next export'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(input));
  const messages = parsed.items.filter(item => item.type !== 'date');
  assert.deepEqual(Array.from(messages, item => [item.content, item.name, item.type]), [
    ['first', 'A', 'text'],
    ['second', 'A', 'text'],
    ['new day unknown', '', 'text'],
    ['new explicit speaker', 'B', 'text'],
    ['B continued', 'B', 'text'],
    ['Bがメッセージを取り消しました', '', 'system'],
    ['unknown after unsend', '', 'text'],
    ['named again', 'A', 'text'],
    ['不在着信', '', 'call'],
    ['unknown after call', '', 'text'],
    ['unknown first row in next export', '', 'text']
  ]);
});

test('a standalone unknown sender remains unknown, while a multiline continuation gets speaker', () => {
  const parser = loadParser();
  const lines = [
    '12:00\t\tunknown without previous speaker',
    '12:01\tA\tfirst',
    '12:02\t\t"next line',
    'still next line"'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(lines));
  assert.equal(parsed.items[0].name, '');
  assert.equal(parsed.items[1].name, 'A');
  assert.equal(parsed.items[2].name, 'A');
  assert.equal(parsed.items[2].content, 'next line\nstill next line');
});

test('inferred sender identity is used for outgoing rendering without editing source history', () => {
  const parser = loadParser();
  const input = '10:00\tA\tfirst\n10:01\t\tsecond\n10:02\t\t[ファイル]';
  const parsed = parser.parseText(parser.parseMultiline(input));
  parsed.meta.user = 'A';
  parser.renderChat(parsed);
  const output = parser.document.getElementById('chatContainer').innerHTML;
  assert.equal((output.match(/class="talk me"/g) || []).length, 3);
  assert.equal((output.match(/class="file-card"/g) || []).length, 1);
  assert.equal((output.match(/class="system"/g) || []).length, 0);
  assert.equal(input.includes('10:01\t\tsecond'), true);
});


test('quoted whole LINE row with multiline text keeps time and sender as a message', () => {
  const parser = loadParser();
  const raw = [
    '2026/10/13(火)',
    '"12:34\t花子\t一行目',
    '二行目',
    '三行目"',
    '"12:35\t太郎\t一行だけ"',
    '12:36\t\t続きの発言'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(raw));
  assert.deepEqual(Array.from(parsed.items.filter(x => x.type !== 'date'), x => [x.type, x.name, x.time, x.content]), [
    ['text', '花子', '12:34', '一行目\n二行目\n三行目'],
    ['text', '太郎', '12:35', '一行だけ'],
    ['text', '太郎', '12:36', '続きの発言']
  ]);
  parsed.meta.user='花子';
  parser.renderChat(parsed);
  const html=parser.document.getElementById('chatContainer').innerHTML;
  assert.match(html,/class="talk me"[\s\S]*?一行目<br>二行目<br>三行目/);
  assert.doesNotMatch(html,/class="system">.*12:34/);
  assert.equal((html.match(/class="system"/g)||[]).length,0);
  assert.equal((html.match(/<br>/g)||[]).length,2);
});

test('ordinary LINE-export body-quoted multiline and embedded header remain one message', () => {
  const parser=loadParser();
  const raw=[
    '[LINE] 相手とのトーク履歴',
    '保存日時：2026/10/13 19:00',
    '2026/10/13(火)',
    '19:01\tA\t"最初',
    '[LINE] 内部で引用された文字列とのトーク履歴',
    '保存日時：2099/01/01 00:00',
    '結び"',
    '19:02\tB\t後続'
  ].join('\n');
  const parsed=parser.parseText(parser.parseMultiline(raw));
  const messages=parsed.items.filter(x=>x.type!=='date');
  assert.equal(messages.length,2);
  assert.equal(messages[0].name,'A');
  assert.match(messages[0].content,/\[LINE\] 内部で引用された文字列/);
  assert.match(messages[0].content,/保存日時：2099/);
  assert.equal(messages[1].name,'B');
  assert.equal(messages[1].content,'後続');
});

test('native two-column LINE unsend notice is system; unknown two-column content is not', () => {
  const parser=loadParser();
  const raw=[
    '2026/10/13(火)',
    '10:00\tA\t通常の発言',
    '10:01\tメッセージの送信を取り消しました',
    '10:02\tA\t次の発言',
    '10:03\t正体不明の文字列',
    '10:04\tA\tその次'
  ].join('\n');
  const parsed=parser.parseText(parser.parseMultiline(raw));
  assert.deepEqual(Array.from(parsed.items.filter(x=>x.type!=='date'),x=>[x.type,x.name,x.time,x.content]),[
    ['text','A','10:00','通常の発言'],
    ['system','','10:01','メッセージの送信を取り消しました'],
    ['text','A','10:02','次の発言'],
    ['text','A','10:03','正体不明の文字列'],
    ['text','A','10:04','その次']
  ]);
  parser.renderChat(parsed);
  const html=parser.document.getElementById('chatContainer').innerHTML;
  assert.equal((html.match(/class="system"/g)||[]).length,1);
  assert.match(html,/class="system">メッセージの送信を取り消しました/);
});

test('unknown orphan with timestamp-looking source is never silently a system notice', () => {
  const parser=loadParser();
  const raw=[
    '11:00\tA\t最初',
    '11:01 A 誤ってタブが消えた',
    '11:02\tB\t後続'
  ].join('\n');
  const parsed=parser.parseText(parser.parseMultiline(raw));
  assert.deepEqual(Array.from(parsed.items,x=>x.type),['text','text','text']);
  assert.equal(parsed.items[1].content,'11:01 A 誤ってタブが消えた');
  assert.equal(parsed.items[1].name,'A');
});

test('quoted whole-row HTML remains escaped and does not become a system entry', () => {
  const parser=loadParser();
  const raw=[
    '"09:30\t<script>alert(1)</script>\t<svg onload=alert(1)>',
    '普通の2行目"'
  ].join('\n');
  const parsed=parser.parseText(parser.parseMultiline(raw));
  assert.equal(parsed.items.length,1);
  assert.equal(parsed.items[0].type,'text');
  assert.equal(parsed.items[0].time,'09:30');
  parser.renderChat(parsed);
  const html=parser.document.getElementById('chatContainer').innerHTML;
  assert.doesNotMatch(html,/<svg onload=alert/);
  assert.match(html,/&lt;svg onload=alert\(1\)&gt;<br>/);
});

test('malformed whole-row quote recovers at the next valid record and day', () => {
  const parser=loadParser();
  const raw=[
    '"08:00\tA\t未閉じの引用',
    '08:01\tB\t次の発言',
    '2026/10/14(水)',
    '09:00\tA\t次の日'
  ].join('\n');
  const parsed=parser.parseText(parser.parseMultiline(raw));
  const msgs=parsed.items.filter(x=>x.type!=='date');
  assert.deepEqual(Array.from(msgs,x=>[x.type,x.name,x.content]),[
    ['text','A','未閉じの引用'],
    ['text','B','次の発言'],
    ['text','A','次の日']
  ]);
  assert.equal(parsed.items.filter(x=>x.type==='date').length,1);
});

test('quoted whole-row snapshots deduplicate by logical sender/time/content', () => {
  const parser=loadParser();
  const raw=[
    '[LINE] Bとのトーク履歴',
    '2026/10/13(火)',
    '"11:00\tA\t一行目',
    '二行目"',
    '[LINE] Bとのトーク履歴',
    '2026/10/13(火)',
    '11:00\tA\t"一行目',
    '二行目"',
    '11:01\tB\t次'
  ].join('\n');
  const parsed=parser.parseText(parser.parseMultiline(raw));
  const msgs=parsed.items.filter(x=>x.type!=='date');
  // The normalized messages should share the same logical body even if the
  // exports quoted a full row versus only its content.
  assert.equal(msgs.length,2);
  assert.equal(msgs[0].content,'一行目\n二行目');
  assert.equal(msgs[1].content,'次');
});


test('uploaded test export: unquoted continuation stays in original 18:32 A bubble', () => {
  // Verbatim first export records of the provided anonymized 3,800-line file.
  const parser = loadParser();
  const input = [
    '[LINE] Bとのトーク履歴',
    '保存日時：2017/05/07 23:42',
    '',
    '2017/04/24(月)',
    '18:32\tA\tほんと',
    '試してみる',
    '18:33\tB\tどの順番で進めるか決めよう。',
    '18:33\tA\t[スタンプ]'
  ].join('\n');
  const parsed = parser.parseText(parser.parseMultiline(input));
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.items)), [
    {type:'date',content:'2017/04/24(月)'},
    {type:'text',name:'A',time:'18:32',content:'ほんと\n試してみる'},
    {type:'text',name:'B',time:'18:33',content:'どの順番で進めるか決めよう。'},
    {type:'attachment',name:'A',time:'18:33',content:'[スタンプ]'}
  ]);
  parsed.meta.user='A';
  parser.renderChat(parsed);
  const html=parser.document.getElementById('chatContainer').innerHTML;
  assert.equal((html.match(/class="talk me"/g) || []).length,2);
  assert.equal((html.match(/class="talk you"/g) || []).length,1);
  assert.equal((html.match(/class="system"/g) || []).length,0);
  assert.match(html,/class="balloon">ほんと<br>試してみる<\/div>/);
  assert.match(html,/class="time">18:32/);
  assert.doesNotMatch(html,/class="balloon">試してみる<\/div>/);
});

test('uploaded test export: single-digit hours, multiline and explicit sender', () => {
  const parser=loadParser();
  const input=[
    '[LINE] Bとのトーク履歴',
    '保存日時：2018/07/02 07:27',
    '',
    '2017/08/27(日)',
    '3:06\tA\tちょっと待って',
    '3:07\tA\tイベントで使う道具はだいたい揃ったよ。',
    '3:09\tA\t終わったら一緒にお茶でも飲もう。',
    '句読点や「かぎ括弧」、数字の123、英字のABCも混ぜてみた。',
    '3:11\tA\tあとで共有するから少し確認してね。',
    'そのファイル、もう開けるはずだよ。',
    '7:12\tB\t今日は思ったより風が強いね。'
  ].join('\n');
  const parsed=parser.parseText(parser.parseMultiline(input));
  const messages=parsed.items.filter(x=>x.type!=='date');
  assert.deepEqual(Array.from(messages,x=>x.time),['3:06','3:07','3:09','3:11','7:12']);
  assert.deepEqual(Array.from(messages,x=>x.name),['A','A','A','A','B']);
  assert.equal(messages[2].content,'終わったら一緒にお茶でも飲もう。\n句読点や「かぎ括弧」、数字の123、英字のABCも混ぜてみた。');
  assert.equal(messages[3].content,'あとで共有するから少し確認してね。\nそのファイル、もう開けるはずだよ。');
  assert.equal(messages.some(x=>x.type==='system'),false);
});

test('unquoted multiline paragraph and initial empty body retain original newlines', () => {
  const parser=loadParser();
  const input=[
    '2018/02/28(水)',
    '18:25\tA\t',
    '了解',
    '18:26\tB\t一段落目',
    '二段落目',
    '',
    '三段落目',
    '18:27\tA\t終了'
  ].join('\n');
  const msgs=parser.parseText(parser.parseMultiline(input)).items.filter(x=>x.type!=='date');
  assert.equal(msgs.length,3);
  assert.equal(msgs[0].content,'\n了解');
  assert.equal(msgs[1].content,'一段落目\n二段落目\n\n三段落目');
  assert.equal(msgs[2].content,'終了');
});

test('preserve 24:xx raw export time and regular source date boundaries', () => {
  const parser=loadParser();
  const input=[
    '2017/09/20(水)',
    '24:26\tA\t[スタンプ]',
    '21:57\tA\t通話に応答がありませんでした。',
    '2017/09/21(木)',
    '24:06\tB\t通話時間 1:36:30',
    '12:43\tB\t今日の昼ごはんは何にする？'
  ].join('\n');
  const out=parser.parseText(parser.parseMultiline(input)).items;
  assert.deepEqual(Array.from(out.filter(x=>x.type!=='date'),x=>x.time),
    ['24:26','21:57','24:06','12:43']);
  assert.deepEqual(Array.from(out.filter(x=>x.type!=='date'),x=>x.type),
    ['attachment','call','call','text']);
  assert.equal(out.filter(x=>x.type==='date').length,2);
});

test('real export boundary stops unquoted continuations; repeated backup overlap preserved', () => {
  const parser=loadParser();
  const input=[
    '[LINE] Bとのトーク履歴',
    '2017/08/27(日)',
    '3:06\tA\tちょっと待って',
    '続き',
    '[LINE] Bとのトーク履歴',
    '保存日時：2018/07/02 07:27',
    '2017/08/27(日)',
    '3:06\tA\tちょっと待って',
    '続き',
    '3:07\tB\t追加'
  ].join('\n');
  const items=parser.parseText(parser.parseMultiline(input)).items.filter(x=>x.type!=='date');
  assert.deepEqual(Array.from(items,x=>x.content),['ちょっと待って\n続き','追加']);
  assert.equal(items[0].name,'A');
  assert.equal(items[1].name,'B');
});

test('malformed timestamp with spaces stays a separate ordinary text record', () => {
  const parser=loadParser();
  const input=[
    '9:41\tA\t最初',
    '9:42 A タブ消失',
    '9:43\tB\t後続'
  ].join('\n');
  const msg=parser.parseText(parser.parseMultiline(input)).items;
  assert.equal(msg.length,3);
  assert.equal(msg[0].time,'9:41');
  assert.equal(msg[1].time,'');
  assert.equal(msg[1].content,'9:42 A タブ消失');
  assert.equal(msg[1].type,'text');
  assert.equal(msg[2].time,'9:43');
});

test('unquoted multiline markup is escaped, not treated as system or HTML', () => {
  const parser=loadParser();
  const raw=[
    '8:00\tB\t最初',
    '<img src=x onerror=alert(1)>',
    '次の行',
    '8:01\tA\t終了'
  ].join('\n');
  const parsed=parser.parseText(parser.parseMultiline(raw));
  parsed.meta.user='A';
  parser.renderChat(parsed);
  const html=parser.document.getElementById('chatContainer').innerHTML;
  assert.doesNotMatch(html,/<img src=x onerror/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;<br>次の行/);
  assert.equal((html.match(/class="system"/g)||[]).length,0);
});
