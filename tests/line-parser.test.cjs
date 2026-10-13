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
  assert.equal(parsed.items[0].content, '"first line\nsecond line"');
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
