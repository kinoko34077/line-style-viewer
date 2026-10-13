
const fileInput = document.getElementById('fileInput');
const sourceStatus = document.getElementById('sourceStatus');
const selfSelector = document.getElementById('selfSelector');
let currentSourceName = null;
let currentChat = null;
let selectedSelfName = '';

if (selfSelector) {
  selfSelector.addEventListener('change', () => {
    selectedSelfName = selfSelector.value;
    if (currentChat) {
      renderChat({
        meta: {...currentChat.meta, user: selectedSelfName},
        items: currentChat.items
      });
    }
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
    const selected = populateSelfSelector(parsed);
    renderChat({meta: {...parsed.meta, user: selected}, items: parsed.items});
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
  text = text.replace(/\r\n|\r/g, '\n');

  const lines = text.split('\n');
  const result = [];
  let buffer = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (buffer !== null) {
      // A missing closing quote must not consume later LINE messages or days.
      // This intentionally uses real record/date boundaries rather than a
      // quoted "[LINE]" header, which can appear inside legitimate messages.
      const nextRecord = /^\d{2}:\d{2}\t/.test(line) ||
        /^\d{4}\/\d{2}\/\d{2}(?:\([^)]+\))?$/.test(trimmed);
      if (!nextRecord) {
        buffer += '\n' + line;
        if (/(^|[^\\])"$/.test(trimmed)) {
          result.push(buffer);
          buffer = null;
        }
        continue;
      }
      // Recover: keep the incomplete quote as its original message and
      // process the new date/message line normally below.
      result.push(buffer);
      buffer = null;
    }

    const fields = line.split('\t');
    const messageField = fields.length >= 3 ? fields.slice(2).join('\t').trim() : trimmed;
    const startsQuotedMessage = messageField.startsWith('"');
    const closesOnSameLine = /(^|[^\\])"$/.test(messageField);

    if (startsQuotedMessage && !closesOnSameLine) {
      buffer = line;
    } else {
      result.push(line);
    }
  }

  if (buffer !== null) result.push(buffer);

  return result;
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
  const meta = { user: null, icons: {} };
  const sections = [[]];
  let currentSection = sections[0];

  for (const line of lines) {
    const trimmed = line.trim();

    // Exports may be pasted one after another, each with its own header.
    // A quoted multiline message has already been joined into one logical line.
    if (/^\[LINE\]\s*.+(?:との|の)トーク履歴\s*$/.test(trimmed)) {
      if (currentSection.length) {
        currentSection = [];
        sections.push(currentSection);
      }
      continue;
    }
    if (/^保存日時\s*[:：]\s*.+$/.test(trimmed)) continue;

    if (line.startsWith('# user:')) {
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
      currentSection.push({ type: 'date', content: trimmed });
    } else if (/^\d{2}:\d{2}\t/.test(line)) {
      const [time, name, ...msgParts] = line.split('\t');
      const content = msgParts.join('\t');
      const callKind = getCallKind(content);
      // Content semantics take precedence over absent sender metadata.
      // A nameless text/file row must not become a centered system pill.
      const type = isSystemNotice(content, name)
        ? 'system'
        : callKind ? 'call'
          : /^\[.*\]$/.test(content) ? 'attachment' : 'text';
      currentSection.push({
        type, name, time, content, ...(callKind ? {callKind} : {})
      });
    } else if (trimmed !== '') {
      currentSection.push({ type: 'system', content: trimmed });
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

function renderChat({ meta, items }) {
  const container = document.getElementById('chatContainer');
  const html = [];

  for (const item of items) {
    if (item.type === 'date') {
      html.push(`<div class="date-label">${escapeHtml(item.content)}</div>`);
    } else if (item.type === 'system') {
      html.push(`<div class="system">${escapeHtml(item.content)}</div>`);
    } else {
      const isSelf = item.type === 'call' && item.callKind === 'missed' ? false
        : item.type === 'call' && ['unanswered', 'cancelled'].includes(item.callKind) ? true
          : Boolean(meta.user && item.name === meta.user);
      const icon = meta.icons[item.name] || meta.icons['default'] || './default/default-icon.png';
      const safeIcon = escapeHtml(icon);
      const safeTime = escapeHtml(item.time);
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
        const safeLabel = escapeHtml(item.content.replace(/^☎\s*/, '').replace(/^\[|\]$/g, ''));
        contentHTML = `<div class="call-card" role="group" aria-label="通話履歴"><span class="call-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.56 3.57.56a1 1 0 011 1V20a1 1 0 01-1 1C10.61 21 3 13.39 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.24.19 2.45.56 3.57a1 1 0 01-.25 1.02z"/></svg></span><span class="call-label">${safeLabel}</span></div>`;
      } else {
        contentHTML = escapeHtml(item.content.replace(/^"|"$/g, '')).replace(/\n/g, '<br>');
      }

      // Incoming: avatar | white balloon | time.
      // Outgoing: read/time stacked to the left of a right-aligned balloon.
      const readHTML = isSelf
        ? '<span class="read" title="LINEのテキスト履歴には実際の既読状態が含まれません">既読</span>'
        : '';
      html.push(`
        <div class="talk ${isSelf ? 'me' : 'you'}">
          ${isSelf ? '' : `<img class="icon" src="${safeIcon}" alt="">`}
          <div class="message-block-with-meta">
            <div class="balloon">${contentHTML}</div>
            <div class="meta-inline">${readHTML}<time class="time">${safeTime}</time></div>
          </div>
        </div>
      `);
    }
  }

  container.innerHTML = html.join('');
}
