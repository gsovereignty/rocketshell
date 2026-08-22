import { describe, expect, it } from "vitest";
import { renderMarkdown, renderMarkdownInline } from "./markdown";

describe("renderMarkdown", () => {
  it("renders common problem-description blocks", () => {
    expect(renderMarkdown("## Context\n\n- First\n- **Second**\n\n> quoted\n\n```ts\nconst ok = true;\n```"))
      .toBe('<h2>Context</h2><ul><li>First</li><li><strong>Second</strong></li></ul><blockquote><p>quoted</p></blockquote><pre><code class="language-ts">const ok = true;</code></pre>');
  });

  it("escapes raw HTML instead of interpreting it", () => {
    expect(renderMarkdown('<img src="https://example.com/a.png" onerror="bad()">'))
      .toBe('<p>&lt;img src=&quot;https://example.com/a.png&quot; onerror=&quot;bad()&quot;&gt;</p>');
  });

  it("does not load Markdown images or navigate links directly", () => {
    expect(renderMarkdown("![diagram](https://example.com/a.png) [spec](https://example.com/spec)"))
      .toBe('<p><span class="markdown-media" data-media-url="https://example.com/a.png" data-media-alt="diagram"><span>diagram</span><code>https://example.com/a.png</code></span> <span class="markdown-link">spec<code>https://example.com/spec</code></span></p>');
  });
});

describe("renderMarkdownInline", () => {
  it("renders emphasis and escaped markers", () => {
    expect(renderMarkdownInline("**bold** *soft* `code` \\*literal*"))
      .toBe("<strong>bold</strong> <em>soft</em> <code>code</code> *literal*");
  });
});
