// Tests for the reading view's markdown renderer: structure, escaping (content
// can never inject markup), and wiki-links resolving to in-app planet routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mdToHtml, renderInline } from "./markdown.js";

test("headings, blockquote, lists, hr, paragraphs", () => {
  const html = mdToHtml([
    "# Title", "", "> An epigraph", "> over two lines.", "",
    "## Section", "Some **bold** and *italic* prose", "on two source lines.", "",
    "- first", "- second", "", "1. one", "2. two", "", "---", "*footer*",
  ].join("\n"));
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<blockquote>An epigraph over two lines\.<\/blockquote>/);
  assert.match(html, /<h2>Section<\/h2>/);
  assert.match(html, /<p>Some <strong>bold<\/strong> and <em>italic<\/em> prose on two source lines\.<\/p>/);
  assert.match(html, /<ul>\n<li>first<\/li>\n<li>second<\/li>\n<\/ul>/);
  assert.match(html, /<ol>\n<li>one<\/li>\n<li>two<\/li>\n<\/ol>/);
  assert.match(html, /<hr>/);
});

test("fenced and inline code are verbatim; markdown inside code is NOT styled", () => {
  const html = mdToHtml("```\n**not bold** <tag>\n```\n\nuse `**raw**` inline");
  assert.match(html, /<pre><code>\*\*not bold\*\* &lt;tag&gt;<\/code><\/pre>/);
  assert.match(html, /<code>\*\*raw\*\*<\/code>/);
});

test("content is escaped — a note cannot inject markup or javascript: links", () => {
  const html = mdToHtml('<script>alert(1)</script>\n\n[x](javascript:alert(1))');
  assert.ok(!html.includes("<script>"), "tags escaped");
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes("javascript:"), "javascript: scheme dropped");
});

test("wiki-links resolve to in-app read routes; unresolved ones degrade to text", () => {
  const resolve = (t: string) => (t === "The Holdout Rule" || t === "the-holdout-rule" ? "planet_h" : null);
  const html = renderInline("See [[The Holdout Rule]] and [[Nope]] and [rule](./the-holdout-rule.md).", resolve);
  assert.match(html, /<a class="wiki" href="#\/read\/planet_h">The Holdout Rule<\/a>/);
  assert.match(html, /<span class="wiki-dead">Nope<\/span>/);
  assert.match(html, /<a class="wiki" href="#\/read\/planet_h">rule<\/a>/);
});

test("external http(s) links open out with rel=noopener", () => {
  const html = renderInline("[docs](https://example.com/x)");
  assert.match(html, /<a href="https:\/\/example\.com\/x" target="_blank" rel="noopener">docs<\/a>/);
});

test("real-corpus shape: an actual framework body renders without leaking raw markdown", () => {
  const body = [
    "# Agent Memory Is a Kalman Filter", "",
    "> Both maintain a belief about a hidden state from a stream of noisy inputs.", "",
    "## The connection",
    "The Kalman filter projects its prior estimate forward — trust",
    "the model when it's certain.", "",
    "## So what",
    "- Add an explicit trust weight to memory writes: new context vs. prior, not blind append. Decay",
    "  stale facts; let contradictions trigger a weighted update.", "",
    "---",
    "*Genericized from Dom's second brain.*",
  ].join("\n");
  const html = mdToHtml(body);
  assert.match(html, /<h1>/);
  assert.match(html, /<h2>The connection<\/h2>/);
  assert.match(html, /<li>Add an explicit trust weight to memory writes: new context vs\. prior, not blind append\. Decay stale facts; let contradictions trigger a weighted update\.<\/li>/,
    "hanging indent joins the same bullet");
  assert.ok(!/^[#>-]/m.test(html.replace(/<[^>]+>/g, "").trim()), "no raw markdown markers leak");
});
