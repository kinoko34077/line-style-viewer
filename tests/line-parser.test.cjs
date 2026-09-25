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
