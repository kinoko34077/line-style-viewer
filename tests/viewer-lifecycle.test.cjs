const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function loadViewer() {
  let changeHandler = null;
  let htmlValue = '';
  let htmlWrites = 0;

  const fileInput = {
    files: [],
    value: 'selected',
    disabled: false,
    addEventListener(type, handler) {
      if (type === 'change') changeHandler = handler;
    }
  };
  const chatContainer = {};
  Object.defineProperty(chatContainer, 'innerHTML', {
    get() {
      return htmlValue;
    },
    set(value) {
      htmlWrites += 1;
      htmlValue = String(value);
    }
  });
  const sourceStatus = {
    textContent: '',
    dataset: {},
    setAttribute() {}
  };

  const context = {
    document: {
      getElementById(id) {
        if (id === 'fileInput') return fileInput;
        if (id === 'chatContainer') return chatContainer;
        if (id === 'sourceStatus') return sourceStatus;
        return null;
      }
    },
    console
  };
  vm.createContext(context);
  vm.runInContext(source, context, {filename: 'script.js'});

  return {
    context,
    fileInput,
    chatContainer,
    sourceStatus,
    getChangeHandler: () => changeHandler,
    getHtmlWrites: () => htmlWrites,
    resetHtmlWrites: () => {
      htmlWrites = 0;
    }
  };
}

test('renderChat commits a long synthetic chat to the container once', () => {
  const viewer = loadViewer();
  const items = Array.from({length: 200}, (_, index) => ({
    type: 'text',
    name: 'kino',
    time: '22:10',
    content: `message ${index}`
  }));

  viewer.resetHtmlWrites();
  viewer.context.renderChat({meta: {user: 'kino', icons: {}}, items});

  assert.equal(viewer.getHtmlWrites(), 1, 'renderer should make one final container HTML commit');
  assert.match(viewer.chatContainer.innerHTML, /message 199/);
});

test('file load exposes busy/current-source status and clears picker value for same-file reload', async () => {
  const viewer = loadViewer();
  const handler = viewer.getChangeHandler();
  assert.equal(typeof handler, 'function');
  assert.match(indexSource, /id="sourceStatus"/);

  let resolveText;
  const file = {
    name: 'history.txt',
    text() {
      return new Promise((resolve) => {
        resolveText = resolve;
      });
    }
  };
  viewer.fileInput.files = [file];
  viewer.fileInput.value = 'C:/fake/history.txt';

  const pending = handler({target: viewer.fileInput});
  assert.equal(viewer.fileInput.disabled, true);
  assert.equal(viewer.fileInput.value, '', 'captured file must clear the native picker value');
  assert.equal(viewer.sourceStatus.dataset.state, 'loading');
  assert.match(viewer.sourceStatus.textContent, /history\.txt/);

  resolveText('22:10\tkino\thello');
  await pending;

  assert.equal(viewer.fileInput.disabled, false);
  assert.equal(viewer.sourceStatus.dataset.state, 'ready');
  assert.match(viewer.sourceStatus.textContent, /history\.txt/);
  assert.match(viewer.chatContainer.innerHTML, /hello/);
});

test('failed replacement load preserves last-good chat and identifies failed/current sources', async () => {
  const viewer = loadViewer();
  const handler = viewer.getChangeHandler();

  const goodFile = {
    name: 'good.txt',
    async text() {
      return '22:10\tkino\tlast good';
    }
  };
  viewer.fileInput.files = [goodFile];
  await handler({target: viewer.fileInput});
  const lastGood = viewer.chatContainer.innerHTML;

  const badFile = {
    name: 'broken.txt',
    async text() {
      throw new Error('read failed');
    }
  };
  viewer.fileInput.files = [badFile];
  viewer.fileInput.value = 'C:/fake/broken.txt';
  await handler({target: viewer.fileInput});

  assert.equal(viewer.chatContainer.innerHTML, lastGood);
  assert.equal(viewer.fileInput.disabled, false);
  assert.equal(viewer.fileInput.value, '');
  assert.equal(viewer.sourceStatus.dataset.state, 'error');
  assert.match(viewer.sourceStatus.textContent, /broken\.txt/);
  assert.match(viewer.sourceStatus.textContent, /good\.txt/);
});

test('same file object can be intentionally loaded again after picker reset', async () => {
  const viewer = loadViewer();
  const handler = viewer.getChangeHandler();
  let reads = 0;
  const sameFile = {
    name: 'same.txt',
    async text() {
      reads += 1;
      return `22:10\tkino\tversion ${reads}`;
    }
  };

  viewer.fileInput.files = [sameFile];
  viewer.fileInput.value = 'C:/fake/same.txt';
  await handler({target: viewer.fileInput});
  assert.equal(viewer.fileInput.value, '');

  viewer.fileInput.files = [sameFile];
  viewer.fileInput.value = 'C:/fake/same.txt';
  await handler({target: viewer.fileInput});

  assert.equal(reads, 2);
  assert.match(viewer.chatContainer.innerHTML, /version 2/);
  assert.equal(viewer.fileInput.value, '');
});
