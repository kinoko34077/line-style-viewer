const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

function render(items, self = 'A', chatMode = 'auto') {
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
  ctx.renderChat({meta: {user: self, icons: {}, chatMode}, items});
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
  assert.match(out.markup, /class="date-label">10/13\(火\)/);
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
  assert.match(css, /\.talk\.me\s+\.balloon\s*\{[^}]*background:\s*#6de67b;/);
  assert.match(css, /\.talk\s+\.icon\s*\{[^}]*border-radius:\s*50%;/);
  assert.match(css, /\.talk\.you\s+\.balloon::after\s*\{[^}]*left:\s*-8px;/);
  assert.match(css, /\.talk\.me\s+\.balloon::after\s*\{[^}]*right:\s*-8px;/);
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
  assert.match(css, /\.talk \.icon\s*\{[^}]*align-self:\s*flex-start;[^}]*margin-top:\s*1px;/);
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
  assert.match(css,/\.call-icon\s*\{[^}]*width:\s*38px;[^}]*height:\s*38px;/);
  assert.match(css,/\.call-icon svg\s*\{[^}]*width:\s*21px;[^}]*height:\s*21px;/);
  assert.match(css,/\.call-card\s*\{[^}]*max-width:\s*236px;/);
});


test('long loaded filename and long title stay within viewport and wrap', () => {
  assert.match(css, /\.viewer-header h1\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*line-height:\s*1\.3;/);
  assert.match(css, /\.file-controls\s*\{[^}]*min-width:\s*0;/);
  assert.match(css, /\.file-controls input\[type='file'\]\s*\{[^}]*max-width:\s*100%;/);
  assert.match(css, /\.source-status\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/);
  assert.match(css, /\.viewer-header\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/);
  assert.match(css, /\.self-picker\s*\{[^}]*justify-self:\s*end;/);
});

test('LINE first-bubble shoulders and the curved horns have a smooth shared contour', () => {
  assert.match(css, /\.balloon\s*\{[^}]*border-radius:\s*18px;/);
  assert.match(css, /\.talk\.me \.balloon\s*\{[^}]*border-radius:\s*18px;/);
  assert.match(css, /\.talk\.you \.balloon::after,\s*\.talk\.me \.balloon::after\s*\{[^}]*top:\s*0;[^}]*width:\s*20px;[^}]*height:\s*22px;/);
  assert.match(css, /\.talk\.you \.balloon::after\s*\{[^}]*left:\s*-8px;[^}]*clip-path:\s*path\("M0 0 C4 6 9 7 14 5/);
  assert.match(css, /\.talk\.me \.balloon::after\s*\{[^}]*right:\s*-8px;[^}]*clip-path:\s*path\("M20 0 C16 6 11 7 6 5/);
  assert.doesNotMatch(css, /clip-path:\s*polygon\(/);
  assert.doesNotMatch(css, /border-radius:\s*6px 18px 18px 18px/);
});

test('message scale and read/time location remain consistent with native LINE references', () => {
  assert.match(css, /\.message-block-with-meta\s*\{[^}]*align-items:\s*flex-end;/);
  assert.match(css, /\.talk\.me \.message-block-with-meta\s*\{[^}]*flex-direction:\s*row-reverse;/);
  assert.match(css, /\.balloon\s*\{[^}]*line-height:\s*1\.42;[^}]*font-size:\s*15px;/);
  assert.match(css, /\.meta-inline\s*\{[^}]*font-size:\s*10px;/);
  assert.match(css, /\.date-label,[\s\S]*?\.system\s*\{[^}]*border-radius:\s*999px;/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)[\s\S]*?\.balloon\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.4;[^}]*padding:\s*8px 12px;/);
  assert.match(css, /\.call-copy\s*\{[^}]*flex-direction:\s*column;/);
  assert.match(css, /\.call-duration\s*\{[^}]*font-size:\s*12px;/);
});

test('native-inspired call duration has two-line title and duration without losing raw label', () => {
  const msg = render([
    {type:'call',name:'B',time:'11:20',content:'音声通話時間 01:42',callKind:'duration'},
    {type:'call',name:'A',time:'11:22',content:'ビデオ通話時間 12:06',callKind:'duration'}
  ]).markup;
  assert.match(msg, /aria-label="音声通話時間 01:42"/);
  assert.match(msg, /<strong class="call-label">音声通話<\/strong><span class="call-duration">01:42<\/span>/);
  assert.match(msg, /<strong class="call-label">ビデオ通話<\/strong><span class="call-duration">12:06<\/span>/);
  assert.equal((msg.match(/class="call-card"/g)||[]).length,2);
});


test('consecutive incoming text in the same minute keeps indentation but omits repeated avatar and horn', () => {
  const view=render([
    {type:'text',name:'B',time:'18:34',content:'そう！'},
    {type:'text',name:'B',time:'18:34',content:'そっか'},
    {type:'text',name:'B',time:'18:34',content:'今度は別のパターンも試そう。'},
    {type:'text',name:'B',time:'18:35',content:'次の分'}
  ]);
  assert.equal((view.markup.match(/<img class="icon"/g)||[]).length,2);
  assert.equal((view.markup.match(/class="icon-spacer"/g)||[]).length,2);
  assert.equal((view.markup.match(/data-continuation="true"/g)||[]).length,2);
  assert.match(view.markup,/class="talk you" data-continuation="true"[\s\S]*?class="icon-spacer"[\s\S]*?そっか/);
  assert.match(view.markup,/class="talk you">[\s\S]*?class="icon"[\s\S]*?次の分/);
  assert.equal((view.markup.match(/class="time">18:34/g)||[]).length,3);
});

test('outgoing grouped messages retain independent read/time and reset after sender changes', () => {
  const view=render([
    {type:'text',name:'A',time:'9:03',content:'最初'},
    {type:'text',name:'A',time:'09:03',content:'2通目'},
    {type:'attachment',name:'A',time:'09:03',content:'[ファイル]'},
    {type:'text',name:'B',time:'09:03',content:'相手の返信'},
    {type:'text',name:'A',time:'09:03',content:'自分が再開'}
  ]);
  assert.equal((view.markup.match(/data-continuation="true"/g)||[]).length,2);
  assert.equal((view.markup.match(/class="talk me"/g)||[]).length,4);
  assert.equal((view.markup.match(/class="read"/g)||[]).length,4);
  assert.equal((view.markup.match(/class="file-card"/g)||[]).length,1);
  assert.match(view.markup,/class="talk me" data-continuation="true"[\s\S]*?2通目/);
  assert.match(view.markup,/class="talk me">[\s\S]*?自分が再開/);
});

test('date, service notice and call records break any same-minute visual group', () => {
  const view=render([
    {type:'text',name:'B',time:'10:12',content:'先の発言'},
    {type:'date',content:'2026/10/13(火)'},
    {type:'text',name:'B',time:'10:12',content:'日付をまたぐ'},
    {type:'system',content:'メッセージの送信を取り消しました'},
    {type:'text',name:'B',time:'10:12',content:'通知の後'},
    {type:'call',name:'B',time:'10:12',content:'不在着信',callKind:'missed'},
    {type:'text',name:'B',time:'10:12',content:'通話の後'}
  ]);
  assert.doesNotMatch(view.markup,/data-continuation=/);
  assert.equal((view.markup.match(/<img class="icon"/g)||[]).length,5);
});

test('independent native LINE grouping geometry preserves avatar lane and rounded continuation', () => {
  assert.match(css,/\.talk \.icon-spacer\s*\{[^}]*flex:\s*0 0 36px;[^}]*width:\s*36px;/);
  assert.match(css,/\.talk\[data-continuation="true"\]\s*\{[^}]*margin-top:\s*-5px;/);
  assert.match(css,/\.talk\[data-continuation="true"\] \.balloon\s*\{[^}]*border-radius:\s*18px;/);
  assert.match(css,/\.talk\.me\[data-continuation="true"\] \.balloon\s*\{[^}]*border-radius:\s*18px;/);
  assert.match(css,/\.talk\[data-continuation="true"\] \.balloon::after\s*\{[^}]*display:\s*none;/);
  assert.match(css,/@media\s*\(max-width:\s*600px\)[\s\S]*\.talk \.icon,\s*\.talk \.icon-spacer\s*\{[^}]*flex-basis:\s*28px;/);
  assert.match(css,/font-family:\s*-apple-system,\s*BlinkMacSystemFont,\s*'Hiragino Kaku Gothic ProN'/);
});


test('first received/sent text bubble retains tail while grouped followups stay smooth and hornless', () => {
  const out=render([
    {type:'text',name:'B',time:'10:05',content:'初回の受信。'},
    {type:'text',name:'B',time:'10:05',content:'連投の受信。'},
    {type:'text',name:'A',time:'10:06',content:'初回の送信。'},
    {type:'text',name:'A',time:'10:06',content:'連投の送信。'}
  ]).markup;
  assert.equal((out.match(/class="talk you"/g)||[]).length,2);
  assert.equal((out.match(/class="talk me"/g)||[]).length,2);
  assert.equal((out.match(/data-continuation="true"/g)||[]).length,2);
  assert.match(css,/\.talk\[data-continuation="true"\] \.balloon::after\s*\{[^}]*display:\s*none;/);
  assert.match(css,/\.talk\.me\[data-continuation="true"\] \.balloon\s*\{[^}]*border-radius:\s*18px;/);
  assert.doesNotMatch(out,/class="system"/);
});

test('all bubble horn geometry respects the minimum mobile horizontal inset', () => {
  const body=(css.match(/@media\s*\(max-width:\s*600px\)\s*\{\s*body\s*\{([^}]+)\}/)||[])[1];
  assert.ok(body);
  assert.match(body,/padding:\s*12px 8px;/);
  assert.match(css,/\.talk\.you \.balloon::after\s*\{[^}]*left:\s*-8px;/);
  assert.match(css,/\.talk\.me \.balloon::after\s*\{[^}]*right:\s*-8px;/);
  assert.match(css,/\.talk\.you \.balloon::after,\s*\.talk\.me \.balloon::after\s*\{[^}]*width:\s*20px;/);
});


test('mobile text dimensions are explicitly calibrated from a matching native LINE screenshot', () => {
  // The reference image is a source screenshot, not an app-wide style oracle.
  // Both its messages have 8 Japanese characters; native bubble is ~170x40
  // CSS-equivalent pixels after normalizing the image's actual 2.5x scale.
  const mobile=css.match(/@media\s*\(max-width:\s*600px\)\s*\{([\s\S]*)\}\s*$/);
  assert.ok(mobile);
  assert.match(mobile[1],/\.balloon\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.4;[^}]*padding:\s*8px 12px;/);
});


test('viewport cloud wallpaper remains a fixed layer, not body-attachment dependent', () => {
  assert.match(css,/html\s*\{[^}]*background-color:\s*#8cabd8;/);
  assert.match(css,/body\s*\{[^}]*background:\s*transparent;[^}]*isolation:\s*isolate;/);
  assert.match(css,/body::before\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*background-image:\s*url\('\.\/default\/bg-sky\.jpg'\);[^}]*background-size:\s*cover;/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g,''),/background-attachment:\s*fixed/);
});

test('incoming first bubble has a safe name above it; continuation suppresses repeated labels', () => {
  const markup=render([
    {type:'text',name:'B',time:'12:00',content:'初回'},
    {type:'text',name:'B',time:'12:00',content:'連投'},
    {type:'text',name:'B',time:'12:01',content:'次の分'},
    {type:'text',name:'A',time:'12:02',content:'自分'}
  ], 'A', 'group').markup;
  assert.equal((markup.match(/class="sender-name"/g)||[]).length,2);
  assert.match(markup, /class="sender-name">B<\/span>/);
  assert.match(markup,/class="talk you" data-continuation="true"/);
  assert.doesNotMatch(markup,/class="talk me">[\s\S]{0,100}sender-name/);
  assert.match(css,/\.sender-name\s*\{[^}]*position:\s*absolute;[^}]*top:\s*-17px;/);
});

test('sender name text is escaped and a genuinely unknown sender is not invented', () => {
  const markup=render([
    {type:'text',name:'<img src=x onerror=alert(1)>',time:'13:00',content:'大丈夫'},
    {type:'text',name:'',time:'13:01',content:'不明'}
  ], 'A', 'group').markup;
  assert.match(markup,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(markup,/<img src=x onerror/);
  assert.equal((markup.match(/class="sender-name"/g)||[]).length,1);
});

test('Japanese date display changes only the rendered chip, not the source item', () => {
  const raw={type:'date',content:'2025/10/04(土)'};
  const out=render([raw]).markup;
  assert.match(out,/2025年10月4日\(土\)/);
  assert.equal(raw.content,'2025/10/04(土)');
});

test('mobile iPhone reference uses 24px avatars, compact 13px chat text and 2025 green', () => {
  const mobile=(css.match(/@media\s*\(max-width:\s*600px\)\s*\{([\s\S]*)\}\s*$/)||[])[1];
  assert.ok(mobile);
  assert.match(mobile,/\.talk \.icon,\s*\.talk \.icon-spacer\s*\{[^}]*width:\s*28px;/);
  assert.match(mobile,/\.balloon\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.4;[^}]*padding:\s*8px 12px;/);
  assert.match(mobile,/min-width:\s*56px;/);
  assert.match(css,/\.talk\.me \.balloon\s*\{[^}]*background:\s*#6de67b;/);
});


test('individual chat has no sender labels, including after a date and a call', () => {
  const items=[
    {type:'date',content:'2026/06/27(土)'},
    {type:'text',name:'B',time:'18:05',content:'ごめん'},
    {type:'text',name:'A',time:'18:05',content:'了解'},
    {type:'text',name:'B',time:'18:06',content:'ありがとう'},
    {type:'call',name:'B',time:'18:07',content:'不在着信',callKind:'missed'},
    {type:'text',name:'B',time:'18:08',content:'あとで'}
  ];
  for (const mode of ['auto','direct']) {
    const result=render(items,'A',mode).markup;
    assert.doesNotMatch(result,/class="sender-name"/);
    assert.match(result,/class="date-label">6\/27\(土\)/);
    assert.equal((result.match(/class="talk you"/g)||[]).length,4);
  }
});

test('three distinct speakers automatically enable group labels; own messages remain label-free', () => {
  const messages=[
    {type:'text',name:'A',time:'10:00',content:'自分'},
    {type:'text',name:'B',time:'10:01',content:'はじめまして'},
    {type:'text',name:'B',time:'10:01',content:'もうひとつ'},
    {type:'text',name:'C',time:'10:02',content:'Cです'},
    {type:'text',name:'B',time:'10:03',content:'戻った'}
  ];
  const auto=render(messages,'A').markup;
  assert.equal((auto.match(/class="sender-name"/g)||[]).length,3);
  assert.match(auto,/class="sender-name">B<\/span>/);
  assert.match(auto,/class="sender-name">C<\/span>/);
  assert.equal((auto.match(/data-continuation="true"/g)||[]).length,1);
  const forcedDirect=render(messages,'A','direct').markup;
  assert.doesNotMatch(forcedDirect,/class="sender-name"/);
  assert.equal((forcedDirect.match(/data-continuation="true"/g)||[]).length,1);
});

test('a group with only two visible speakers can be explicitly selected', () => {
  const items=[
    {type:'text',name:'A',time:'11:00',content:'私'},
    {type:'text',name:'B',time:'11:01',content:'友人'}
  ];
  assert.doesNotMatch(render(items,'A').markup,/class="sender-name"/);
  assert.match(render(items,'A','group').markup,/class="sender-name">B<\/span>/);
  assert.doesNotMatch(render(items,'B','group').markup,/class="sender-name">B<\/span>/);
});

test('current-year dates omit year while older dates retain year with original data intact', () => {
  const ctx={document:{getElementById(id){return id==='fileInput'?{addEventListener(){}}:{innerHTML:''}}},console};
  vm.createContext(ctx);
  vm.runInContext(js,ctx);
  assert.equal(ctx.displayDateLabel('2026/06/27(土)',2026),'6/27(土)');
  assert.equal(ctx.displayDateLabel('2026/12/31(木)',2026),'12/31(木)');
  assert.equal(ctx.displayDateLabel('2025/10/10(金)',2026),'2025年10月10日(金)');
  assert.equal(ctx.displayDateLabel('2024/02/29(木)',2026),'2024年2月29日(木)');
  assert.equal(ctx.displayDateLabel('不明な日時',2026),'不明な日時');
  const original={type:'date',content:'2025/10/10(金)'};
  const markup=render([original]).markup;
  assert.match(markup,/2025年10月10日\(金\)/);
  assert.equal(original.content,'2025/10/10(金)');
});

test('room-type override is an accessible compact selector, separate from identity', () => {
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/<select id="chatModeSelector" aria-label="会話形式">/);
  assert.match(html,/<option value="auto">自動<\/option>/);
  assert.match(html,/<option value="direct">個チャ<\/option>/);
  assert.match(html,/<option value="group">グループ<\/option>/);
  assert.match(css,/\.chat-mode-picker\s*\{[^}]*flex:\s*0 0 auto;/);
});
