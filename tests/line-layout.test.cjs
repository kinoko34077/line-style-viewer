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
  assert.match(css, /\.balloon\s*\{[^}]*overflow-wrap:\s*break-word;/);
  assert.match(css, /\.balloon:has\(img\)::after/);
});

test('own message switches to peer style after a different local identity is selected', () => {
  const msg = [{type:'text',name:'A',time:'14:21',content:'hello'}];
  assert.match(render(msg,'A').markup, /class="talk me"/);
  const peer = render(msg,'B').markup;
  assert.match(peer, /class="talk you"/);
  assert.doesNotMatch(peer, /既読/);
});


test('long message cap is shared across directions without double subtraction', () => {
  const group = css.match(/\.message-block-with-meta\s*\{([^}]+)\}/);
  const bubble = css.match(/\.balloon\s*\{([^}]+)\}/);
  const outgoing = css.match(/\.talk\.me \.message-block-with-meta\s*\{([^}]+)\}/);
  assert.ok(group);
  assert.ok(bubble);
  assert.ok(outgoing);
  assert.match(group[1], /max-width:\s*min\(83%,\s*460px\)/);
  assert.match(bubble[1], /max-width:\s*100%/);
  assert.doesNotMatch(outgoing[1], /max-width:/);
  assert.doesNotMatch(css, /max-width:\s*calc\(100%\s*-\s*42px\)/);
  assert.doesNotMatch(css, /max-width:\s*calc\(100%\s*-\s*50px\)/);
});

test('message whitespace is normal; only escaped source newlines become explicit breaks', () => {
  const bubble = css.match(/\.balloon\s*\{([^}]+)\}/);
  assert.match(bubble[1], /white-space:\s*normal/);
  assert.match(bubble[1], /word-break:\s*normal/);
  assert.match(bubble[1], /overflow-wrap:\s*break-word/);
  assert.doesNotMatch(bubble[1], /white-space:\s*pre-wrap/);

  const ctx = {
    document: {
      getElementById(id) {
        if (id === 'fileInput') return {addEventListener() {}};
        if (id === 'chatContainer') return ctx.container;
        return null;
      }
    },
    console,
    container: {innerHTML: ''}
  };
  vm.createContext(ctx);
  vm.runInContext(js, ctx);
  const parsed = ctx.parseText(ctx.parseMultiline('11:10\tA\t"first\n\nthird"'));
  ctx.renderChat(parsed);
  assert.match(ctx.container.innerHTML, /class="balloon">first<br><br>third<\/div>/);
  assert.equal((ctx.container.innerHTML.match(/<br>/g) || []).length, 2);
  const plain = render([{type:'text',name:'A',time:'11:11',content:'hello'}]).markup;
  assert.equal((plain.match(/<br>/g) || []).length, 0);
});

test('fallback media shows no fabricated caption; file card is visually distinct', () => {
  const markup = render([
    {type:'attachment',name:'A',time:'11:11',content:'[写真]'},
    {type:'attachment',name:'B',time:'11:12',content:'[動画]'},
    {type:'attachment',name:'A',time:'11:13',content:'[ファイル]'}
  ]).markup;
  assert.equal((markup.match(/class="media-placeholder"/g) || []).length, 2);
  assert.match(markup, /class="file-card"/);
  assert.doesNotMatch(markup, /保存期間が終了しています/);
  assert.match(css, /\.balloon:has\(\.file-card\)/);
});


test('unavailable stamp pictogram is small with bounded margin and photo fallback is compact', () => {
  const out=render([
    {type:'attachment',name:'A',time:'11:11',content:'[スタンプ]'},
    {type:'attachment',name:'B',time:'11:12',content:'[写真]'},
    {type:'attachment',name:'A',time:'11:13',content:'[ファイル]'}
  ]).markup;
  assert.match(out, /class="stamp-fallback" src="\.\/default\/default-stamp\.png"/);
  assert.match(css, /\.balloon \.stamp-fallback\s*\{[^}]*width:\s*52px;[^}]*height:\s*52px;[^}]*margin:\s*8px;/);
  assert.match(css, /\.media-placeholder\s*\{[^}]*place-items:\s*center;[^}]*width:\s*148px;[^}]*height:\s*148px;[^}]*padding:\s*12px;/);
  assert.match(css, /\.media-placeholder img\s*\{[^}]*width:\s*124px;[^}]*height:\s*124px;/);
  assert.match(out, /class="file-card"/);
  assert.doesNotMatch(out, /class="system">(?:\[ファイル\]|\[スタンプ\]|\[写真\])/);
});

test('avatar anchors to top of a long peer balloon, metadata still stays below', () => {
  assert.match(css, /\.talk \.icon\s*\{[^}]*align-self:\s*flex-start;[^}]*margin-top:\s*2px;/);
  assert.match(css, /\.message-block-with-meta\s*\{[^}]*align-items:\s*flex-end;/);
  const long='長文'.repeat(250);
  const view=render([{type:'text',name:'B',time:'09:32',content:long}]);
  assert.match(view.markup, /class="talk you"/);
  assert.match(view.markup, /class="icon"/);
  assert.match(view.markup, /class="balloon">長文/);
  assert.match(view.markup, /class="time">09:32/);
});

test('call cards have compact handset styling and are part of sender-side bubbles', () => {
  const out=render([
    {type:'call',name:'B',time:'11:30',content:'不在着信',callKind:'missed'},
    {type:'call',name:'A',time:'11:31',content:'通話をキャンセルしました',callKind:'cancelled'}
  ]).markup;
  assert.equal((out.match(/class="call-card"/g)||[]).length,2);
  assert.equal((out.match(/class="call-icon"/g)||[]).length,2);
  assert.match(out,/class="talk you"[\s\S]*?不在着信/);
  assert.match(out,/class="talk me"[\s\S]*?通話をキャンセルしました/);
  assert.match(css,/\.call-icon\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;/);
  assert.match(css,/\.call-icon svg\s*\{[^}]*width:\s*19px;[^}]*height:\s*19px;/);
  assert.match(css,/\.call-card\s*\{[^}]*max-width:\s*224px;/);
});
