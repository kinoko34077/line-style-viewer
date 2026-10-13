const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

function render(items, self = 'A') {
  let writes = 0;
  const chat = {};
  let markup = '';
  Object.defineProperty(chat, 'innerHTML', {
    get() { return markup; },
    set(value) {
      writes += 1;
      markup = String(value);
    }
  });
  const fileInput = {addEventListener() {}};
  const ctx = {
    document: {
      getElementById(id) {
        if (id === 'fileInput') return fileInput;
        if (id === 'chatContainer') return chat;
        return null;
      }
    },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(js, ctx, {filename: 'script.js'});
  ctx.renderChat({meta: {user: self, icons: {}}, items});
  return {markup, writes};
}

test('outgoing markup has no avatar, emits read above time, with the balloon as sibling', () => {
  const view = render([{type:'text', name:'A', time:'14:21', content:'自分のメッセージ'}]);
  assert.equal(view.writes, 1);
  assert.match(view.markup, /class="talk me"/);
  assert.doesNotMatch(view.markup, /class="icon"/);
  assert.match(view.markup,
    /class="balloon">自分のメッセージ<\/div>\s*<div class="meta-inline"><span class="read"[^>]*>既読<\/span><time class="time">14:21<\/time><\/div>/);
  assert.doesNotMatch(view.markup, /14:21　既読/);
});

test('incoming markup has avatar and time but never a read receipt', () => {
  const view = render([{type:'text', name:'B', time:'14:22', content:'相手のメッセージ'}]);
  assert.match(view.markup, /class="talk you"/);
  assert.match(view.markup, /class="icon"[^>]+alt=""/);
  assert.match(view.markup, /class="balloon">相手のメッセージ<\/div>\s*<div class="meta-inline"><time class="time">14:22<\/time><\/div>/);
  assert.doesNotMatch(view.markup, /既読/);
});

test('sent, received, date, system and multiline contents coexist; user text stays escaped', () => {
  const items = [
    {type:'date',content:'2026/10/13(火)'},
    {type:'text',name:'A',time:'14:21',content:'first\nsecond'},
    {type:'text',name:'B',time:'14:22',content:'<script>alert(1)</script>'},
    {type:'system', content:'通話時間 00:02'}
  ];
  const out = render(items);
  assert.equal(out.writes, 1);
  assert.match(out.markup, /class="date-label">2026\/10\/13\(火\)/);
  assert.match(out.markup, /first<br>second/);
  assert.match(out.markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(out.markup, /<script>alert\(1\)<\/script>/);
  assert.match(out.markup, /class="system">通話時間 00:02/);
});

test('outgoing outer row is flush right and inner order is flipped; incoming is left', () => {
  assert.match(css, /\.talk\.me\s*\{\s*justify-content:\s*flex-end;/);
  assert.match(css, /\.talk\.you\s*\{\s*justify-content:\s*flex-start;/);
  assert.match(css, /\.talk\.me\s+\.message-block-with-meta\s*\{[^}]*flex-direction:\s*row-reverse;/);
  assert.match(css, /\.meta-inline\s*\{[^}]*flex-direction:\s*column;/);
  assert.match(css, /\.talk\.me\s+\.meta-inline\s*\{[^}]*align-items:\s*flex-end;/);
  assert.doesNotMatch(css, /\.talk\.me\s*\{[^}]*flex-direction:\s*row-reverse/);
});

test('standard bubbles, tails, avatar sizes and mobile fit are styled on their own sides', () => {
  assert.match(css, /\.balloon\s*\{[^}]*background:\s*#fff;/);
  assert.match(css, /\.talk\.me\s+\.balloon\s*\{[^}]*background:\s*#a7ed74;/);
  assert.match(css, /\.talk\s+\.icon\s*\{[^}]*border-radius:\s*50%;/);
  assert.match(css, /\.talk\.you\s+\.balloon::after\s*\{[^}]*left:\s*-7px;/);
  assert.match(css, /\.talk\.me\s+\.balloon::after\s*\{[^}]*right:\s*-7px;/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
  assert.match(css, /\.balloon\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(css, /\.balloon:has\(img\)::after/);
});

test('own message switches to peer style after a different local identity is selected', () => {
  const msg = [{type:'text',name:'A',time:'14:21',content:'hello'}];
  assert.match(render(msg,'A').markup, /class="talk me"/);
  const peer = render(msg,'B').markup;
  assert.match(peer, /class="talk you"/);
  assert.doesNotMatch(peer, /既読/);
});
