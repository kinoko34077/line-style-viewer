
document.getElementById('fileInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  const merged = parseMultiline(text);
  renderChat(parseText(merged));
});

function parseMultiline(text) {
  // 改行コードをLFに統一
  text = text.replace(/\r\n|\r/g, '\n');

  const lines = text.split('\n');
  const result = [];
  let buffer = null;

  for (let line of lines) {
    const trimmed = line.trim();

    // 多行メッセージの開始検出
    if (buffer !== null) {
      buffer += '\n' + line;
      if (/[^\\]"$/.test(trimmed) || /^"$/.test(trimmed)) {
        result.push(buffer);
        buffer = null;
      }
    } else if (/^"([^"]*)?$/.test(trimmed)) {
      buffer = line;
    } else {
      result.push(line);
    }
  }

  if (buffer !== null) result.push(buffer); // 残りがあれば追加

  return result.join('\n');
}

function parseText(text) {
  const lines = text.split(/\r?\n/);
  const meta = { user: null, icons: {} };
  const items = [];

  for (const line of lines) {
    if (line.startsWith('# user:')) {
      meta.user = line.split(':')[1].trim();
    } else if (line.startsWith('# icon:')) {
      const [name, url] = line.slice(7).split('=');
      if (url) meta.icons[name.trim()] = url.trim();
      else meta.icons['default'] = name.trim();
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
  container.innerHTML = '';
  for (const item of items) {
    if (item.type === 'date') {
      container.innerHTML += `<div class="date-label">${item.content}</div>`;
    } else if (item.type === 'system') {
      container.innerHTML += `<div class="system">${item.content}</div>`;
    } else {
      const isSelf = item.name === meta.user;
      const icon = meta.icons[item.name] || meta.icons['default'] || './default/default-icon.png';
      let contentHTML = '';

      if (/^\[.*\.(jpg|png|svg|mp4|webm)\]$/.test(item.content)) {
        const filename = item.content.replace(/[\[\]]/g, '');
        if (/\.(jpg|png|svg)$/.test(filename)) {
          contentHTML = `<img src="${filename}" onerror="this.src='./default/default-photo.png'">`;
        } else if (/\.(mp4|webm)$/.test(filename)) {
          contentHTML = `<video src="${filename}" controls></video>`;
        }
      } else if (item.content === '[写真]') {
        contentHTML = `<img src="./default/default-photo.png">`;
      } else if (item.content === '[スタンプ]') {
        contentHTML = `<img src="./default/default-stamp.png">`;
      } else {
        contentHTML = item.content.replace(/^"|"$/g, '').replace(/\n/g, '<br>');
      }

      container.innerHTML += `
        <div class="talk ${isSelf ? 'me' : 'you'}">
          <img class="icon" src="${icon}" />
          <div class="message-block-with-meta">
            <div class="balloon">${contentHTML}</div>
            <div class="meta-inline">${item.time}${isSelf ? '　既読' : ''}</div>
          </div>
        </div>
      `;

    }
  }
}
