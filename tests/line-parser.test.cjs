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
  assert.deepEqual(messages.map((item) => item.content), ['最初', '[ファイル]', '追加']);
  assert.deepEqual(dates.map((item) => item.content), ['2017/04/24(月)', '2017/04/25(火)']);
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
    parsed.items.filter((item) => item.type !== 'date').map((item) => item.content),
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

test('expired attachment tokens display placeholders, named media stay resources, imported markup remains escaped', () => {
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
  assert.match(html, /ファイル・保存期間が終了しています/);
  assert.match(html, /動画・保存期間が終了しています/);
  assert.match(html, /写真・保存期間が終了しています/);
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
    parsed.items.filter((item) => item.type !== 'date').map((item) => item.content),
    ['one', 'two', 'three']
  );
});
