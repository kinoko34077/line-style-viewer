
const fileInput = document.getElementById('fileInput');
const sourceStatus = document.getElementById('sourceStatus');
const selfSelector = document.getElementById('selfSelector');
const chatModeSelector = document.getElementById('chatModeSelector');
const conversationTitle = document.getElementById('conversationTitle');
const menuToggle = document.getElementById('menuToggle');
const settingsBackdrop = document.getElementById('settingsBackdrop');
const settingsClose = document.getElementById('settingsClose');
const scaleControl = document.getElementById('scaleControl');
const scaleOutput = document.getElementById('scaleOutput');
const themeSelector = document.getElementById('themeSelector');
let currentSourceName = null;
let currentChat = null;
let selectedSelfName = '';
let selectedChatMode = 'auto';

function applyUiScale(value) {
  const scale = Math.min(160, Math.max(80, Math.round(Number(value) / 10) * 10 || 120));
  document.documentElement.style.setProperty('--ui-scale', String(scale / 100));
  if (scaleControl) scaleControl.value = String(scale);
  if (scaleOutput) scaleOutput.textContent = scale + '%';
  return scale;
}

function applyTheme(value) {
  const theme = ['normal','black','white'].includes(value) ? value : 'normal';
  document.documentElement.dataset.theme = theme;
  if (themeSelector) themeSelector.value = theme;
  return theme;
}

function toggleSettings(open) {
  if (!settingsBackdrop || !menuToggle) return;
  settingsBackdrop.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? '設定を閉じる' : '設定を開く');
  if (open && settingsClose) settingsClose.focus();
  if (!open) menuToggle.focus();
}

if (menuToggle) menuToggle.addEventListener('click', () =>
  toggleSettings(settingsBackdrop.hidden));
if (settingsClose) settingsClose.addEventListener('click', () => toggleSettings(false));
if (settingsBackdrop) settingsBackdrop.addEventListener('click', (event) => {
  if (event.target === settingsBackdrop) toggleSettings(false);
});
if (document.addEventListener) document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && settingsBackdrop && !settingsBackdrop.hidden) toggleSettings(false);
});
if (scaleControl) scaleControl.addEventListener('input', () => applyUiScale(scaleControl.value));
if (themeSelector) themeSelector.addEventListener('change', () => applyTheme(themeSelector.value));

function rerenderSelectedChat() {
  if (typeof window !== 'undefined' && window.talkEditor) {
    window.talkEditor.setIdentityAndMode(selectedSelfName, selectedChatMode);
  } else if (currentChat) {
    renderChat({
      meta: {...currentChat.meta, user: selectedSelfName, chatMode: selectedChatMode},
      items: currentChat.items
    });
  }
}

if (selfSelector) {
  selfSelector.addEventListener('change', () => {
    selectedSelfName = selfSelector.value;
    rerenderSelectedChat();
  });
}
if (chatModeSelector) {
  chatModeSelector.addEventListener('change', () => {
    selectedChatMode = ['auto', 'direct', 'group'].includes(chatModeSelector.value)
      ? chatModeSelector.value : 'auto';
    rerenderSelectedChat();
  });
}

fileInput.addEventListener('change', async (event) => {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;

  // Capture the File object, then clear the native picker so the same path can
  // be selected again after this load finishes.
  input.value = '';
  input.disabled = true;
  setSourceStatus('loading', `読み込み中: ${file.name}`);

  try {
    const text = await file.text();
    const merged = parseMultiline(text);
    const parsed = parseText(merged);
    if (conversationTitle) conversationTitle.textContent = parsed.meta.title || 'トーク履歴';
    const selected = populateSelfSelector(parsed);
    if (typeof window !== 'undefined' && window.talkEditor) {
      window.talkEditor.loadParsed(parsed, selected, selectedChatMode);
    } else {
      renderChat({meta: {...parsed.meta, user: selected, chatMode: selectedChatMode}, items: parsed.items});
    }
    currentChat = parsed;
    currentSourceName = file.name;
    setSourceStatus('ready', `表示中: ${file.name}`);
  } catch (error) {
    const retained = currentSourceName
      ? `（表示中: ${currentSourceName}）`
      : '（表示中のファイルはありません）';
    setSourceStatus('error', `読み込み失敗: ${file.name} ${retained}`);
    console.error('Failed to load chat file:', error);
  } finally {
    input.disabled = false;
  }
});

// Build the sender list from parsed messages. Only the UI selection changes;
// the original imported file and parsed message data remain untouched.
function populateSelfSelector(parsed) {
  if (!selfSelector) return parsed.meta.user;
  const senderNames = [...new Set(
    parsed.items
      .filter(item => (item.type === 'text' || item.type === 'attachment') && item.name)
      .map(item => item.name)
  )];
  const preferred = senderNames.includes(selectedSelfName)
    ? selectedSelfName
    : senderNames.includes(parsed.meta.user) ? parsed.meta.user : '';
  const prompt = document.createElement('option');
  prompt.value = '';
  prompt.textContent = senderNames.length ? '自分を選択' : '送信者なし';
  selfSelector.replaceChildren(prompt);
  for (const name of senderNames) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name; // Never treat imported names as HTML.
    selfSelector.appendChild(option);
  }
  selfSelector.disabled = senderNames.length === 0;
  selfSelector.value = preferred;
  selectedSelfName = preferred;
  return preferred;
}

function setSourceStatus(state, message) {
  if (!sourceStatus) return;
  sourceStatus.dataset.state = state;
  sourceStatus.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseMultiline(text) {
  const lines = String(text).replace(/\r\n|\r/g, '\n').split('\n');
  const result = [];
  let buffer = null;
  let pendingBlanks = [];
  const isRecordStart = line => /^"?\d{1,2}:\d{2}\t/.test(line);
  const isDate = line => /^\d{4}\/\d{2}\/\d{2}(?:\([^)]+\))?$/.test(line);
  const isMetadata = line =>
    /^\[LINE\]\s*.+(?:との|の)トーク履歴\s*$/.test(line) ||
    /^保存日時\s*[:：]\s*.+$/.test(line) ||
    /^# (?:user|icon|system-json|entry-json):/.test(line);
  const lastIsMessage = () =>
    result.length > 0 && /^"?\d{1,2}:\d{2}\t[^\t]*\t/.test(result[result.length - 1]);

  for (const line of lines) {
    const trimmed = line.trim();
    const recordStart = isRecordStart(line);
    const dateStart = isDate(trimmed);

    if (buffer !== null) {
      // A new timestamp/day after an unclosed quote begins a new message.
      // Embedded export headers in *valid quoted bodies* stay as text.
      if (!recordStart && !dateStart) {
        buffer += '\n' + line;
        if (/(^|[^\\])"$/.test(trimmed)) {
          result.push(buffer);
          buffer = null;
        }
        continue;
      }
      result.push(buffer);
      buffer = null;
    }

    if (recordStart) {
      pendingBlanks = [];
      const quotedRecord = /^"\d{1,2}:\d{2}\t/.test(line);
      const quotedBody = /^\d{1,2}:\d{2}\t[^\t]*\t"/.test(line);
      if ((quotedRecord || quotedBody) && !/(^|[^\\])"$/.test(trimmed)) {
        buffer = line;
      } else {
        result.push(line);
      }
      continue;
    }
    if (dateStart || isMetadata(trimmed)) {
      pendingBlanks = [];
      result.push(line);
      continue;
    }
    if (trimmed === '') {
      pendingBlanks.push(line);
      continue;
    }
    // LINE exports can contain UNQUOTED multiline bodies. An unprefixed
    // continuation belongs to the last record, not to a new system message
    // or a nameless chat bubble. Keep explicit paragraph breaks intact.
    if (lastIsMessage() && !/^\d{1,2}:\d{2}[ \u3000]/.test(line)) {
      result[result.length - 1] += '\n'.repeat(pendingBlanks.length + 1) + line;
    } else {
      // An orphan such as a malformed timestamp stays separate and is
      // handled as ordinary text (never blindly as a system notice).
      result.push(line);
    }
    pendingBlanks = [];
  }
  if (buffer !== null) result.push(buffer);
  return result;
}

// Only discard quotes that enclose the WHOLE record; message-content quotes
// are processed separately. Do not strip legitimate quote characters from
// an otherwise normal message.
function normalizeQuotedRecord(line) {
  if (!/^"\d{1,2}:\d{2}\t/.test(line)) return line;
  const unwrapped = line.slice(1);
  return unwrapped.endsWith('"') ? unwrapped.slice(0, -1) : unwrapped;
}

function normalizeQuotedBody(content) {
  // After physical lines have been joined, quoted multiline bodies are
  // transport delimiters, not visible text. Keep unmatched quote marks.
  return content.length >= 2 && content.startsWith('"') && content.endsWith('"')
    ? content.slice(1, -1).replace(/""/g, '"')
    : content;
}

function getCallKind(value) {
  // iOS text exports often prefix call records with the symbol "☎".
  const text = value.trim().replace(/^☎\s*/, '');
  if (/^\[?不在着信(?:[（(](?:音声|ビデオ)通話[）)])?\]?$/.test(text)) return 'missed';
  if (/^(?:応答なし|応答がありません|着信なし|通話に応答がありませんでした)[。]?$/.test(text)) return 'unanswered';
  if (/^(?:キャンセル|通話をキャンセルしました)[。]?$/.test(text)) return 'cancelled';
  if (/^(?:(?:音声|ビデオ)?通話時間)[\s:：]*\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) return 'duration';
  if (/^(?:音声|ビデオ)通話$/.test(text)) return 'duration';
  if (/^(?:(?:音声|ビデオ)?通話)(?:を開始しました|を終了しました|が終了しました)[。]?$/.test(text)) return 'duration';
  return null;
}

function isSystemNotice(value, senderName) {
  const text = value.trim();
  // LINE unsend notices have no message sender in the text export.
  if (!senderName.trim() &&
      /^(?:[^\n\t]{1,80}が)?メッセージ(?:の送信)?を取り消しました[。]?$/.test(text)) return true;
  // Group calls produce a room event, rather than a sender-sided call card.
  return /^グループ(?:音声|ビデオ)?通話が(?:開始|終了)されました[。]?$/.test(text);
}

function parseText(text) {
  const lines = Array.isArray(text) ? text : String(text).split(/\r?\n/);
  const meta = { user: null, icons: {}, title: '' };
  const sections = [[]];
  let currentSection = sections[0];
  // A blank sender in consecutive ordinary records denotes the same author.
  // Keep this presentation inference local to the current uninterrupted run.
  let previousSpeaker = null;

  for (const sourceLine of lines) {
    const line = normalizeQuotedRecord(sourceLine);
    const trimmed = line.trim();

    // Exports may be pasted one after another, each with its own header.
    // A quoted multiline message has already been joined into one logical line.
    if (/^\[LINE\]\s*.+(?:との|の)トーク履歴\s*$/.test(trimmed)) {
      const header = /^\[LINE\]\s*(.+?)(?:との|の)トーク履歴\s*$/.exec(trimmed);
      if (header && !meta.title) meta.title = header[1].trim();
      previousSpeaker = null; // Never inherit across separately saved exports.
      if (currentSection.length) {
        currentSection = [];
        sections.push(currentSection);
      }
      continue;
    }
    if (/^保存日時\s*[:：]\s*.+$/.test(trimmed)) continue;

    if (line.startsWith('# system-json:') || line.startsWith('# entry-json:')) {
      const isSystem = line.startsWith('# system-json:');
      try {
        const data = JSON.parse(line.slice(isSystem ? 14 : 13).trim());
        if (data && typeof data === 'object' && typeof data.content === 'string') {
          const speaker = typeof data.speaker === 'string' ? data.speaker : '';
          currentSection.push({
            type: isSystem ? 'system' : ['text','attachment','call'].includes(data.kind) ? data.kind : 'text',
            name: isSystem ? '' : speaker,
            time: typeof data.time === 'string' ? data.time : '',
            content: data.content
          });
          previousSpeaker = null;
        }
      } catch {
        currentSection.push({type:'text',name:'',time:'',content:line});
        previousSpeaker = null;
      }
    } else if (line.startsWith('# user:')) {
      meta.user = line.slice(7).trim();
    } else if (line.startsWith('# icon:')) {
      const declaration = line.slice(7);
      const separator = declaration.indexOf('=');
      if (separator >= 0) {
        const name = declaration.slice(0, separator).trim();
        const url = declaration.slice(separator + 1).trim();
        if (name && url) meta.icons[name] = url;
      } else if (declaration.trim()) {
        meta.icons['default'] = declaration.trim();
      }
    } else if (/^\d{4}\/\d{2}\/\d{2}(?:\([^)]+\))?$/.test(trimmed)) {
      previousSpeaker = null; // A new day is not necessarily the same person.
      currentSection.push({ type: 'date', content: trimmed });
    } else if (/^\d{1,2}:\d{2}\t/.test(line)) {
      const fields = line.split('\t');
      const time = fields[0];
      // System notifications in native LINE TXT often have only two fields:
      // "12:00<TAB>メッセージの送信を取り消しました"
      // Three-field messages have a sender (possibly empty) and body.
      const name = fields.length >= 3 ? fields[1] : '';
      const rawContent = fields.length >= 3 ? fields.slice(2).join('\t') : fields[1];
      const content = normalizeQuotedBody(rawContent);
      const callKind = getCallKind(content);
      // Content semantics take precedence over absent sender metadata.
      // A nameless text/file row must not become a centered system pill.
      const type = isSystemNotice(content, name)
        ? 'system'
        : callKind ? 'call'
          : /^\[.*\]$/.test(content) ? 'attachment' : 'text';
      const isOrdinary = type === 'text' || type === 'attachment';
      const effectiveName = isOrdinary && !name.trim() && previousSpeaker
        ? previousSpeaker : name;
      currentSection.push({
        type, name: effectiveName, time, content, ...(callKind ? {callKind} : {})
      });
      // Notifications and call records break a consecutive message run.
      // A leading unknown sender stays unknown instead of being guessed.
      previousSpeaker = isOrdinary && effectiveName.trim() ? effectiveName : null;
    } else if (trimmed !== '') {
      // Unknown/unquoted fragments are not evidence of a LINE system notice.
      // Preserve them as ordinary text rather than centering timestamp/name
      // fragments as fake system messages. The raw file remains untouched.
      currentSection.push({
        type: 'text',
        name: previousSpeaker || '',
        time: '',
        content: line
      });
    }
  }

  const history = [];
  for (const section of sections) {
    let date = null;
    let dateLabel = null;
    const records = [];
    for (const item of section) {
      if (item.type === 'date') {
        dateLabel = item.content;
        date = dateLabel.slice(0, 10); // Ignore weekday spelling for matching.
      } else {
        records.push({ date, dateLabel, item });
      }
    }
    // Deduplicate only at boundaries between independently exported backups,
    // by a contiguous record sequence, never globally by unique message text.
    const overlap = history.length ? repeatedHistoryPrefix(history, records) : 0;
    for (let i = overlap; i < records.length; i++) history.push(records[i]);
  }

  const items = [];
  let previousDate = null;
  for (const record of history) {
    if (record.date && record.date !== previousDate) {
      items.push({ type: 'date', content: record.dateLabel });
    }
    items.push(record.item);
    previousDate = record.date;
  }
  // Preserve a standalone date-only input (even though it has no chat rows).
  if (!history.length) {
    for (const section of sections) {
      for (const item of section) if (item.type === 'date') items.push(item);
    }
  }
  return { meta, items };
}

function recordFingerprint(record) {
  const item = record.item;
  return JSON.stringify([record.date, item.type, item.time || '', item.name || '', item.content]);
}

// KMP prefix matching: longest prefix of new backup that is a suffix of history.
// Also skip a backup already wholly contained in the accumulated history.
function repeatedHistoryPrefix(history, incoming) {
  if (!history.length || !incoming.length) return 0;
  const keys = incoming.map(recordFingerprint);
  const prefix = Array(keys.length).fill(0);
  for (let i = 1, matched = 0; i < keys.length; i++) {
    while (matched > 0 && keys[i] !== keys[matched]) matched = prefix[matched - 1];
    if (keys[i] === keys[matched]) matched++;
    prefix[i] = matched;
  }

  let matched = 0;
  let fullyContained = false;
  for (const record of history) {
    const key = recordFingerprint(record);
    while (matched > 0 && key !== keys[matched]) matched = prefix[matched - 1];
    if (key === keys[matched]) matched++;
    if (matched === keys.length) {
      fullyContained = true;
      matched = prefix[matched - 1];
    }
  }
  return fullyContained ? keys.length : matched;
}

// Render the same Japanese date-chip notation as the native screenshot,
// without mutating source dates or deduplication keys.
function displayDateLabel(value, currentYear = new Date().getFullYear()) {
  return String(value).replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(\([^)]*\))?$/, (_all, year, month, day, weekday = '') =>
    Number(year) === currentYear
      ? `${Number(month)}/${Number(day)}${weekday}`
      : `${year}年${Number(month)}月${Number(day)}日${weekday}`);
}

function renderChat({ meta, items }) {
  const container = document.getElementById('chatContainer');
  const html = [];
  // If three distinct people have spoken, this is a group. A small group
  // with only two observed speakers requires manual room-type selection.
  const speakers = new Set(items.filter(item =>
    (item.type === 'text' || item.type === 'attachment') && item.name && item.name.trim()
  ).map(item => item.name));
  const showGroupNames = meta.chatMode === 'group' ||
    (meta.chatMode !== 'direct' && speakers.size >= 3);
  // LINE groups successive messages by the same sender in the same minute:
  // the later bubble usually has no repeated profile picture or horn.
  // This is a purely visual decision. Keep every original message/time.
  let previousVisual = null;
  const minuteKey = value => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    return m ? Number(m[1]) + ':' + m[2] : null;
  };

  for (const item of items) {
    if (item.type === 'date') {
      previousVisual = null;
      html.push(`<div class="date-label">${escapeHtml(displayDateLabel(item.content))}</div>`);
    } else if (item.type === 'system') {
      previousVisual = null;
      html.push(`<div class="system">${escapeHtml(item.content)}</div>`);
    } else {
      const isSelf = item.type === 'call' && item.callKind === 'missed' ? false
        : item.type === 'call' && ['unanswered', 'cancelled'].includes(item.callKind) ? true
          : Boolean(meta.user && item.name === meta.user);
      const icon = meta.icons[item.name] || meta.icons['default'] || './default/default-icon.png';
      const safeIcon = escapeHtml(icon);
      const safeTime = escapeHtml(item.time);
      const ordinary = item.type === 'text' || item.type === 'attachment';
      const minute = minuteKey(item.time);
      const grouped = Boolean(ordinary && item.name && minute && previousVisual &&
        previousVisual.name === item.name && previousVisual.minute === minute);
      let contentHTML = '';

      if (/^\[.*\.(jpg|png|svg|mp4|webm)\]$/.test(item.content)) {
        const filename = item.content.replace(/[\[\]]/g, '');
        const safeFilename = escapeHtml(filename);
        if (/\.(jpg|png|svg)$/.test(filename)) {
          contentHTML = `<img src="${safeFilename}" onerror="this.src='./default/default-photo.png'">`;
        } else if (/\.(mp4|webm)$/.test(filename)) {
          contentHTML = `<video src="${safeFilename}" controls></video>`;
        }
      } else if (item.content === '[写真]' || item.content === '[動画]') {
        // Plain-text exports identify the media type, but contain no image/video.
        // Do not assert an expiry state: LINE does not always show an expiry caption.
        const kind = item.content.slice(1, -1);
        contentHTML = `<div class="media-placeholder" role="img" aria-label="${kind}の内容はテキスト履歴に含まれません"><img src="./default/default-photo.png" alt=""></div>`;
      } else if (item.content === '[ファイル]') {
        // Original filename and file bytes are absent from LINE text exports.
        contentHTML = '<div class="file-card" role="group" aria-label="ファイル（詳細不明）"><span class="file-card-icon" aria-hidden="true">▤</span><span class="file-card-label">ファイル</span></div>';
      } else if (item.content === '[スタンプ]') {
        contentHTML = '<img class="stamp-fallback" src="./default/default-stamp.png" alt="スタンプ（画像データなし）">';
      } else if (item.type === 'call') {
        const callText = item.content.replace(/^☎\s*/, '').replace(/^\[|\]$/g, '');
        const durationMatch = /^(?:(音声|ビデオ))?通話時間\s*([0-9:]+)$/.exec(callText.trim());
        // LINE phone-history tiles stack call type above elapsed duration.
        // Preserve the actual exported text as an accessible description.
        const callCopy = durationMatch
          ? `<span class="call-copy"><strong class="call-label">${durationMatch[1] === 'ビデオ' ? 'ビデオ通話' : '音声通話'}</strong><span class="call-duration">${escapeHtml(durationMatch[2])}</span></span>`
          : `<span class="call-copy"><span class="call-label">${escapeHtml(callText)}</span></span>`;
        contentHTML = `<div class="call-card" role="group" aria-label="${escapeHtml(callText)}"><span class="call-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.56 3.57.56a1 1 0 011 1V20a1 1 0 01-1 1C10.61 21 3 13.39 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.24.19 2.45.56 3.57a1 1 0 01-.25 1.02z"/></svg></span>${callCopy}</div>`;
      } else {
        contentHTML = escapeHtml(item.content).replace(/\n/g, '<br>');
      }

      // Incoming: avatar | white balloon | time.
      // Outgoing: read/time stacked to the left of a right-aligned balloon.
      const readHTML = isSelf
        ? '<span class="read" title="LINEのテキスト履歴には実際の既読状態が含まれません">既読</span>'
        : '';
      // LINE shows the peer's name above the first incoming balloon of a run.
      // Never invent the speaker of an unknown-sender export row.
      const senderLabelHTML = showGroupNames && !isSelf && !grouped && item.name && item.name.trim()
        ? `<span class="sender-name">${escapeHtml(item.name)}</span>` : '';
      html.push(`
        <div class="talk ${isSelf ? 'me' : 'you'}"${grouped ? ' data-continuation="true"' : ''}>
          ${isSelf ? '' : grouped
            ? '<span class="icon-spacer" aria-hidden="true"></span>'
            : `<img class="icon" src="${safeIcon}" alt="">`}
          <div class="message-block-with-meta">
            ${senderLabelHTML}
            <div class="balloon">${contentHTML}</div>
            <div class="meta-inline">${readHTML}<time class="time">${safeTime}</time></div>
          </div>
        </div>
      `);
      previousVisual = ordinary && item.name && minute
        ? { name: item.name, minute }
        : null;
    }
  }

  container.innerHTML = html.join('');
}
