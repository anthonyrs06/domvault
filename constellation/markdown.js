// markdown.js — a tiny, dependency-free markdown → HTML renderer for the
// planet reading view (#/read). Covers what the frameworks corpus actually
// uses: headings, blockquotes, lists, fenced/inline code, bold/italic, links,
// hr. Everything is HTML-escaped FIRST, so note content can never inject
// markup. [[wiki-links]] (and markdown links to sibling notes) that resolve to
// another planet render as in-app fly-to links via the resolve callback.
// Pure functions — imported by app.js AND markdown.test.ts.

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Inline spans: code, bold, italic, links, wiki-links. Input arrives UNescaped. */
export function renderInline(text, resolve = () => null) {
  let out = '';
  // tokenize on inline code first so nothing inside backticks is styled
  const parts = String(text).split(/(`[^`]*`)/);
  for (const part of parts) {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      out += '<code>' + esc(part.slice(1, -1)) + '</code>';
      continue;
    }
    let s = esc(part);
    // [[wiki-link]] / [[target|label]] → in-app planet link when resolvable
    s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, target, label) => {
      const id = resolve(target.trim());
      const txt = label || target;
      return id
        ? `<a class="wiki" href="#/read/${encodeURIComponent(id)}">${txt}</a>`
        : `<span class="wiki-dead">${txt}</span>`;
    });
    // [label](url) — sibling .md targets resolve in-app, absolute URLs open out
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const mdTarget = url.match(/^(?:\.\/)?([a-z0-9-]+)\.md$/);
      if (mdTarget) {
        const id = resolve(mdTarget[1]);
        if (id) return `<a class="wiki" href="#/read/${encodeURIComponent(id)}">${label}</a>`;
        return label;
      }
      if (/^https?:\/\//.test(url)) return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
      return label; // unknown scheme → text only (never a javascript: link)
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out += s;
  }
  return out;
}

/**
 * Render a markdown document to HTML.
 * @param {string} md
 * @param {(nameOrSlug:string)=>string|null} resolve wiki-target → planet id
 */
export function mdToHtml(md, resolve = () => null) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0, list = null, quote = [];
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeQuote = () => {
    if (quote.length) { out.push('<blockquote>' + renderInline(quote.join(' '), resolve) + '</blockquote>'); quote = []; }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) { // fenced code — verbatim until the closing fence
      closeList(); closeQuote();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // skip closing fence
      out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      closeList(); closeQuote();
      const lvl = h[1].length;
      out.push(`<h${lvl}>` + renderInline(h[2], resolve) + `</h${lvl}>`);
      i++; continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { closeList(); closeQuote(); out.push('<hr>'); i++; continue; }
    const q = line.match(/^>\s?(.*)$/);
    if (q) { closeList(); quote.push(q[1]); i++; continue; }
    closeQuote();
    const li = line.match(/^\s*[-*]\s+(.+)$/);
    const oli = line.match(/^\s*\d+\.\s+(.+)$/);
    if (li || oli) {
      const want = li ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      // hanging indents continue the same bullet
      let item = (li || oli)[1];
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) &&
        !/^\s*[-*]\s|^\s*\d+\.\s/.test(lines[i + 1])) item += ' ' + lines[++i].trim();
      out.push('<li>' + renderInline(item, resolve) + '</li>');
      i++; continue;
    }
    closeList();
    if (!line.trim()) { i++; continue; }
    // paragraph: hungrily absorb following plain lines
    let para = line.trim();
    while (i + 1 < lines.length && lines[i + 1].trim() &&
      !/^(#{1,4}\s|>|```|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i + 1]) &&
      !/^\s*([-*_])\s*\1\s*\1/.test(lines[i + 1])) para += ' ' + lines[++i].trim();
    out.push('<p>' + renderInline(para, resolve) + '</p>');
    i++;
  }
  closeList(); closeQuote();
  return out.join('\n');
}
