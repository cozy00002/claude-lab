// 記事用の小さな Markdown 変換器（外部依存なし）。
// 対応：見出し、段落、箇条書き（番号付き含む、1 階層）、引用、コードブロック、表、水平線、
//       インラインのコード・太字・斜体・リンク・画像。HTML の直書きはエスケープする。

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeUrl(url) {
  return /^(https?:|mailto:|\/|\.|#)/i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : '#';
}

export function renderInline(text) {
  // コードスパンを先に退避して、中身を他の変換から守る
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  // URL 内の括弧は 1 段まで許す（例: https://ja.wikipedia.org/wiki/A_(B)）
  const url = String.raw`((?:[^()\s]|\([^()\s]*\))+)`;
  s = s.replace(new RegExp(String.raw`!\[([^\]]*)\]\(${url}\)`, 'g'), (_, alt, u) => `<img src="${safeUrl(u)}" alt="${alt}">`);
  s = s.replace(new RegExp(String.raw`\[([^\]]+)\]\(${url}\)`, 'g'), (_, label, u) => `<a href="${safeUrl(u)}">${label}</a>`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

const isTableDivider = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

export function renderMarkdown(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // 閉じの ```
      const cls = fence[1] ? ` class="language-${fence[1]}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const n = heading[1].length;
      out.push(`<h${n}>${renderInline(heading[2])}</h${n}>`);
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '');
      const attr = (k) => (align[k] ? ` style="text-align:${align[k]}"` : '');
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
      const th = head.map((c, k) => `<th${attr(k)}>${renderInline(c)}</th>`).join('');
      const tb = rows.map((r) => `<tr>${head.map((_, k) => `<td${attr(k)}>${renderInline(r[k] ?? '')}</td>`).join('')}</tr>`).join('\n');
      out.push(`<table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${tb}\n</tbody>\n</table>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>\n${renderMarkdown(body.join('\n'))}\n</blockquote>`);
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const itemRe = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(itemRe);
        if (m) { items.push(m[1]); i++; continue; }
        // 字下げされた行は直前の項目の続き
        if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>\n${items.map((t) => `<li>${renderInline(t)}</li>`).join('\n')}\n</${tag}>`);
      continue;
    }

    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) &&
      !/^(```|#{1,6}\s|>|\s*([-*]|\d+\.)\s+|\s*(-{3,}|\*{3,})\s*$)/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1]))) {
      para.push(lines[i++]);
    }
    out.push(`<p>${para.map(renderInline).join('<br>\n')}</p>`);
  }

  return out.join('\n');
}
