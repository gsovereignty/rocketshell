const escapeHtml = (value: string) => value.replace(/[&<>\"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"
})[character]!);

const inlinePatterns = [
  { marker: "`", tag: "code" },
  { marker: "**", tag: "strong" },
  { marker: "__", tag: "strong" },
  { marker: "~~", tag: "del" },
  { marker: "*", tag: "em" },
  { marker: "_", tag: "em" }
] as const;

export function renderMarkdownInline(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    if (source[index] === "\\" && index + 1 < source.length && /[\\`*_[\]()>#+.!~-]/.test(source[index + 1])) {
      output += escapeHtml(source[index + 1]);
      index += 2;
      continue;
    }
    const image = source.slice(index).match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/);
    if (image) {
      output += `<span class="markdown-image">${renderMarkdownInline(image[1])}</span>`;
      index += image[0].length;
      continue;
    }
    const link = source.slice(index).match(/^\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/);
    if (link) {
      output += `<span class="markdown-link">${renderMarkdownInline(link[1])}<code>${escapeHtml(link[2])}</code></span>`;
      index += link[0].length;
      continue;
    }
    const pattern = inlinePatterns.find(({ marker }) => source.startsWith(marker, index) && source.indexOf(marker, index + marker.length) > index + marker.length);
    if (pattern) {
      const close = source.indexOf(pattern.marker, index + pattern.marker.length);
      const content = source.slice(index + pattern.marker.length, close);
      output += pattern.tag === "code"
        ? `<code>${escapeHtml(content)}</code>`
        : `<${pattern.tag}>${renderMarkdownInline(content)}</${pattern.tag}>`;
      index = close + pattern.marker.length;
      continue;
    }
    output += escapeHtml(source[index]);
    index += 1;
  }
  return output;
}

const isBlockStart = (line: string) => /^(?: {0,3}(?:#{1,6}\s|```|~~~|>|[-+*]\s|\d+[.)]\s)| {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(line);

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^ {0,3}(```|~~~)(.*)$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^ {0,3}${fence[1]}\\s*$`).test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      const language = fence[2].trim().split(/\s+/)[0];
      blocks.push(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index])) quoted.push(lines[index++].replace(/^ {0,3}> ?/, ""));
      blocks.push(`<blockquote>${renderMarkdown(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    const list = line.match(/^ {0,3}([-+*]|\d+[.)])\s+(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const items: string[] = [];
      const itemPattern = ordered ? /^ {0,3}\d+[.)]\s+(.+)$/ : /^ {0,3}[-+*]\s+(.+)$/;
      while (index < lines.length) {
        const item = lines[index].match(itemPattern);
        if (!item) break;
        items.push(`<li>${renderMarkdownInline(item[1])}</li>`);
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && (paragraph.length === 0 || !isBlockStart(lines[index]))) paragraph.push(lines[index++]);
    const content = paragraph.map((part) => renderMarkdownInline(part.replace(/\s+$/, ""))).join(" ");
    blocks.push(`<p>${content}</p>`);
  }
  return blocks.join("");
}
