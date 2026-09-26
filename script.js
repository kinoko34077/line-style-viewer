
const fileInput = document.getElementById('fileInput');
const sourceStatus = document.getElementById('sourceStatus');
let currentSourceName = null;

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
    renderChat(parseText(merged));
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
      buffer += '\n' + line;
      if (/(^|[^\\])"$/.test(trimmed)) {
        result.push(buffer);
        buffer = null;
      }
      continue;
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

function parseText(text) {
  const lines = Array.isArray(text) ? text : String(text).split(/\r?\n/);
  const meta = { user: null, icons: {} };
  const items = [];

  for (const line of lines) {
    if (line.startsWith('# user:')) {
      meta.user = line.split(':')[1].trim();
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
    } else if (/^\d{4}\/\d{2}\/\d{2}/.test(line)) {
      items.push({ type: 'date', content: line });
    } else if (/\d{2}:\d{2}\t/.test(line)) {
      const [time, name, ...msgParts] = line.split('\t');
      const content = msgParts.join('\t');
      if (/メッセージを取り消しました|通話/.test(content)) {
        items.push({ type: 'system', content });
      } else {
        let type = 'text';
        if (/^\[.*\]$/.test(content)) type = 'attachment';
        items.push({ type, name, time, content });
      }
    } else if (line.trim() !== '') {
      items.push({ type: 'system', content: line.trim() });
    }
  }

  return { meta, items };
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
      const isSelf = item.name === meta.user;
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
      } else if (item.content === '[写真]') {
        contentHTML = `<img src="./default/default-photo.png">`;
      } else if (item.content === '[スタンプ]') {
        contentHTML = `<img src="./default/default-stamp.png">`;
      } else {
        contentHTML = escapeHtml(item.content.replace(/^"|"$/g, '')).replace(/\n/g, '<br>');
      }

      html.push(`
        <div class="talk ${isSelf ? 'me' : 'you'}">
          <img class="icon" src="${safeIcon}" />
          <div class="message-block-with-meta">
            <div class="balloon">${contentHTML}</div>
            <div class="meta-inline">${safeTime}${isSelf ? '　既読' : ''}</div>
          </div>
        </div>
      `);
    }
  }

  container.innerHTML = html.join('');
}
