const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

function createViewer() {
  const listeners = {};
  const options = [];
  const selfSelector = {
    disabled: true,
    value: '',
    options,
    replaceChildren(...children) {
      options.splice(0, options.length, ...children);
    },
    appendChild(option) {
      options.push(option);
    },
    addEventListener(type, fn) {
      listeners[type] = fn;
    }
  };
  const chatModeSelector = {
    value: 'auto',
    addEventListener(type, fn) {
      listeners['chat-mode:' + type] = fn;
    }
  };
  const fileInput = {
    files: [],
    value: 'file',
    disabled: false,
    addEventListener(type, fn) {
      listeners['file:' + type] = fn;
    }
  };
  const container = {innerHTML: ''};
  const sourceStatus = {dataset: {}, textContent: ''};
  const dom = {
    getElementById(id) {
      return {fileInput, selfSelector, chatModeSelector, chatContainer:container, sourceStatus}[id] || null;
    },
    createElement(tag) {
      assert.equal(tag, 'option');
      return {textContent: '', value: ''};
    }
  };
  const context = {document: dom, console};
  vm.createContext(context);
  vm.runInContext(source, context, {filename:'script.js'});
  return {
    fileInput, selfSelector, chatModeSelector, options, container, sourceStatus, context,
    async load(name, fileContent) {
      fileInput.files = [{name, text: async () => fileContent}];
      await listeners['file:change']({target: fileInput});
    },
    select(value) {
      selfSelector.value = value;
      listeners.change();
    },
    setMode(value) {
      chatModeSelector.value = value;
      listeners['chat-mode:change']();
    }
  };
}

test('sender selector lives inside menu settings, and is disabled until import', () => {
  assert.match(html, /<header class="conversation-header viewer-header">[\s\S]*id="conversationTitle"/);
  assert.match(html, /id="menuToggle"[^>]*aria-expanded="false"/);
  assert.match(html, /id="settingsBackdrop" hidden[\s\S]*id="selfSelector" disabled/);
});

test('imports sender names without touching source text and switches chat sides immediately', async () => {
  const viewer = createViewer();
  const sourceText = [
    '[LINE] Bとのトーク履歴',
    '保存日時：2017/05/07 23:42',
    '2017/04/24(月)',
    '08:00\tA\thello',
    '08:01\tB\treply'
  ].join('\n');
  await viewer.load('local.txt',sourceText);
  assert.equal(viewer.sourceStatus.dataset.state, 'ready');
  assert.equal(viewer.selfSelector.disabled, false);
  assert.deepEqual(viewer.options.map(o => o.value), ['', 'A', 'B']);
  assert.equal(viewer.selfSelector.value, '');
  assert.equal((viewer.container.innerHTML.match(/class="talk you"/g) || []).length, 2);

  viewer.select('B');
  assert.equal(viewer.sourceStatus.dataset.state, 'ready');
  assert.equal(viewer.selfSelector.value, 'B');
  assert.match(viewer.container.innerHTML, /class="talk me"/);
  assert.equal((viewer.container.innerHTML.match(/class="talk me"/g) || []).length, 1);
  assert.match(viewer.container.innerHTML, /既読/);
  // The change control must not write to the selected file or reread it.
  assert.equal(sourceText.includes('# user:'), false);
});

test('legacy # user: controls initial selection while manual choice stays UI only', async () => {
  const viewer = createViewer();
  await viewer.load('legacy.txt','# user: A\n12:00\tA\tone\n12:01\tB\ttwo');
  assert.equal(viewer.selfSelector.value,'A');
  assert.match(viewer.container.innerHTML, /class="talk me"/);
  viewer.select('B');
  assert.equal(viewer.selfSelector.value,'B');
  assert.match(viewer.container.innerHTML, /one/);
  await viewer.load('next.txt','12:10\tB\tagain\n12:11\tC\tnext');
  assert.equal(viewer.selfSelector.value,'B', 'retains manual choice when the next imported file contains that sender');
  await viewer.load('different.txt','12:12\tX\thello');
  assert.equal(viewer.selfSelector.value,'', 'does not silently choose a wrong sender');
});

test('untrusted sender names are written as text and escaped in chat rendering', async () => {
  const viewer = createViewer();
  const badName='<img src=x onerror=alert(1)>';
  await viewer.load('unsafe.txt','09:05\t'+badName+'\tHello');
  assert.equal(viewer.options[1].textContent,badName);
  assert.equal(viewer.options[1].value,badName);
  viewer.select(badName);
  assert.equal(viewer.container.innerHTML.includes('<img src=x onerror=alert(1)>'),false);
  assert.match(viewer.container.innerHTML,/Hello/);
});

test('a file with no actual senders keeps the identity control disabled', async () => {
  const viewer=createViewer();
  await viewer.load('empty.txt','[LINE] Bとのトーク履歴\n保存日時：2017/05/07 23:42');
  assert.equal(viewer.selfSelector.disabled,true);
  assert.equal(viewer.selfSelector.value,'');
});


test('sender picker keeps its identity and is accessible from compact settings', () => {
  assert.match(html, /id="selfSelector" disabled>[\s\S]*<option value="">未読み込み<\/option>/);
  assert.match(html, /id="settingsBackdrop" hidden/);
  assert.match(css, /\.settings-panel\s*\{[^}]*max-height:\s*min\(90dvh,\s*780px\)/);
  assert.match(css, /\.settings-field select,[\s\S]*?\.settings-field input\[type=file\]\s*\{[^}]*width:\s*100%;/);
});

test('inferred consecutive sender appears in the same side and does not add empty selector options', async () => {
  const viewer=createViewer();
  await viewer.load('continue.txt', [
    '2026/10/13(火)',
    '09:00\tA\tfirst',
    '09:01\t\tsecond',
    '09:02\t\t[ファイル]',
    '09:03\tB\treply',
    '09:04\t\tfollow up'
  ].join('\n'));
  assert.deepEqual(viewer.options.map(o=>o.value), ['', 'A','B']);
  viewer.select('A');
  assert.equal((viewer.container.innerHTML.match(/class="talk me"/g)||[]).length,3);
  assert.equal((viewer.container.innerHTML.match(/class="talk you"/g)||[]).length,2);
  viewer.select('B');
  assert.equal((viewer.container.innerHTML.match(/class="talk me"/g)||[]).length,2);
  assert.equal((viewer.container.innerHTML.match(/class="talk you"/g)||[]).length,3);
});


test('room-type override changes visible names instantly without rereading the file', async () => {
  const viewer=createViewer();
  const input='2026/06/27(土)\n18:00\tA\t自分\n18:01\tB\t相手';
  await viewer.load('direct.txt',input);
  viewer.select('A');
  assert.doesNotMatch(viewer.container.innerHTML,/class="sender-name"/);
  assert.match(viewer.container.innerHTML,/class="date-label">6\/27\(土\)/);
  const previousStatus=viewer.sourceStatus.textContent;
  viewer.setMode('group');
  assert.match(viewer.container.innerHTML,/class="sender-name">B<\/span>/);
  viewer.setMode('direct');
  assert.doesNotMatch(viewer.container.innerHTML,/class="sender-name"/);
  viewer.setMode('auto');
  assert.doesNotMatch(viewer.container.innerHTML,/class="sender-name"/);
  assert.equal(viewer.sourceStatus.textContent,previousStatus);
  assert.equal(viewer.fileInput.disabled,false);
});

test('auto group detection uses the imported participants, not just the selected self', async () => {
  const viewer=createViewer();
  await viewer.load('group.txt','10:00\tA\tA\n10:01\tB\tB\n10:02\tC\tC');
  viewer.select('A');
  assert.equal((viewer.container.innerHTML.match(/class="sender-name"/g)||[]).length,2);
  viewer.select('C');
  assert.equal((viewer.container.innerHTML.match(/class="sender-name"/g)||[]).length,2);
  viewer.setMode('direct');
  assert.doesNotMatch(viewer.container.innerHTML,/class="sender-name"/);
  viewer.setMode('group');
  assert.equal((viewer.container.innerHTML.match(/class="sender-name"/g)||[]).length,2);
});
