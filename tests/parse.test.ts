import { describe, expect, it } from "vitest";
import {
  headingSlug,
  parseAtxHeading,
  parseDelimiter,
  parseMarkdown,
  slug,
  splitLines,
  splitTableRow,
  unescapeCell,
  openingFence,
  isClosingFence,
} from "../src/parse.js";

const md = (s: string) => parseMarkdown(Buffer.from(s, "utf8"), "t.md");

describe("splitLines", () => {
  it("splits LF, CRLF, CR, and BOM", () => {
    expect(splitLines(Buffer.from("a\nb")).map((l) => l.text)).toEqual(["a", "b"]);
    expect(splitLines(Buffer.from("a\r\nb")).map((l) => l.text)).toEqual(["a", "b"]);
    expect(splitLines(Buffer.from("a\rb")).map((l) => l.text)).toEqual(["a", "b"]);
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hi\n")]);
    expect(splitLines(bom)[0]?.text).toBe("hi");
  });
  it("keeps a final line without newline", () => {
    const lines = splitLines(Buffer.from("only"));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.newline.length).toBe(0);
  });
  it("empty file has no lines", () => {
    expect(splitLines(Buffer.from(""))).toEqual([]);
  });
});

describe("splitTableRow", () => {
  it("parses outer pipes, empty cells, and optional outer pipes", () => {
    expect(splitTableRow("| a | b |")?.cells.map((c) => c.trim())).toEqual(["a", "b"]);
    expect(splitTableRow("a | b")?.cells.map((c) => c.trim())).toEqual(["a", "b"]);
    expect(splitTableRow("| a | | c |")?.cells.map((c) => c.trim())).toEqual(["a", "", "c"]);
    expect(splitTableRow("not a row")).toBeNull();
  });
  it("does not split on escaped pipes", () => {
    expect(splitTableRow("| a\\|b | c |")?.cells.map((c) => unescapeCell(c))).toEqual(["a|b", "c"]);
  });
  it("does not split on pipes inside inline code", () => {
    const cells = splitTableRow("| `a|b` | c |")?.cells.map((c) => unescapeCell(c));
    expect(cells).toEqual(["`a|b`", "c"]);
    const nested = splitTableRow("| `` a`b|c `` | x |")?.cells.map((c) => unescapeCell(c));
    expect(nested?.[0]).toContain("|");
    expect(nested).toHaveLength(2);
  });
  it("keeps markdown links in cells", () => {
    const cells = splitTableRow("| [n](http://x.test) | y |")?.cells.map((c) => unescapeCell(c));
    expect(cells).toEqual(["[n](http://x.test)", "y"]);
  });
});

describe("parseDelimiter", () => {
  it("reads alignments", () => {
    expect(parseDelimiter("| --- | :--- | ---: | :---: |")).toEqual(["none", "left", "right", "center"]);
    expect(parseDelimiter("| -- |")).toBeNull();
    expect(parseDelimiter("not")).toBeNull();
  });
  it("rejects header/delimiter count mismatch", () => {
    const doc = md("| a | b |\n| --- |\n| 1 | 2 |\n");
    expect(doc.tables).toHaveLength(0);
  });
});

describe("fences and comments", () => {
  it("ignores tables inside backtick and tilde fences with info strings", () => {
    const doc = md("```md\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```\n\n~~~js\n| c | d |\n| --- | --- |\n~~~\n");
    expect(doc.tables).toHaveLength(0);
  });
  it("parses a table next to a fence", () => {
    const doc = md("```\nnope\n```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0]?.columns).toEqual(["a", "b"]);
  });
  it("ignores tables inside HTML comments", () => {
    const doc = md("<!--\n| a | b |\n| --- | --- |\n| 1 | 2 |\n-->\n\n| x | y |\n| --- | --- |\n");
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0]?.columns).toEqual(["x", "y"]);
  });
  it("matching closing fence length", () => {
    expect(openingFence("```js")?.len).toBe(3);
    expect(isClosingFence("````", { char: "`", len: 3 })).toBe(true);
    expect(isClosingFence("``", { char: "`", len: 3 })).toBe(false);
    expect(isClosingFence("~~~", { char: "`", len: 3 })).toBe(false);
  });
});

describe("headings and ids", () => {
  it("builds stable ids from heading path + occurrence", () => {
    const doc = md(`# Compatibility

prose

| Name | Status |
| ---- | ------ |
| foo  | ok     |

more prose

| Name | Status |
| ---- | ------ |
| bar  | no     |

## Nested

| A | B |
| --- | --- |
| 1 | 2 |
`);
    expect(doc.tables.map((t) => t.id)).toEqual([
      "compatibility-1",
      "compatibility-2",
      "compatibility-nested-1",
    ]);
    expect(doc.tables[0]?.headingIndex).toBe(1);
    expect(doc.tables[1]?.headingIndex).toBe(2);
    expect(doc.tables[0]?.documentIndex).toBe(1);
    expect(doc.tables[2]?.headingPath).toEqual(["Compatibility", "Nested"]);
  });
  it("uses root for tables before any heading", () => {
    const doc = md("| a | b |\n| --- | --- |\n");
    expect(doc.tables[0]?.id).toBe("root-1");
  });
  it("keeps ids when surrounding prose changes", () => {
    const a = md("# Foo\n\nhello\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    const b = md("# Foo\n\nchanged prose and **more**\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntrailer\n");
    expect(a.tables[0]?.id).toBe(b.tables[0]?.id);
    expect(a.tables[0]?.id).toBe("foo-1");
  });
  it("parses ATX headings", () => {
    expect(parseAtxHeading("##  Hello  ##")?.text).toBe("Hello");
    expect(parseAtxHeading("#not")).toBeNull();
    expect(slug("Error Codes")).toBe("error-codes");
    expect(headingSlug(["API", "Error Codes"])).toBe("api-error-codes");
    expect(headingSlug([])).toBe("root");
  });
});

describe("gfm body rules", () => {
  it("pads short rows and truncates extra cells", () => {
    const doc = md("| a | b |\n| --- | --- |\n| only |\n| 1 | 2 | 3 |\n");
    expect(doc.tables[0]?.rows[0]?.values).toEqual(["only", ""]);
    expect(doc.tables[0]?.rows[1]?.values).toEqual(["1", "2"]);
  });
  it("stops at a blockquote", () => {
    const doc = md("| a | b |\n| --- | --- |\n| 1 | 2 |\n> quote\n");
    expect(doc.tables[0]?.rows).toHaveLength(1);
  });
  it("allows a pipe-less continuation row", () => {
    const doc = md("| a | b |\n| --- | --- |\n| 1 | 2 |\nbar\n");
    expect(doc.tables[0]?.rows).toHaveLength(2);
    expect(doc.tables[0]?.rows[1]?.values).toEqual(["bar", ""]);
  });
  it("unicode cells", () => {
    const doc = md("| 名前 | 値 |\n| --- | --- |\n| 日本語 | ✓ |\n");
    expect(doc.tables[0]?.columns).toEqual(["名前", "値"]);
    expect(doc.tables[0]?.rows[0]?.values).toEqual(["日本語", "✓"]);
  });
  it("hashes exact source bytes including newlines", () => {
    const lf = md("| a | b |\n| --- | --- |\n");
    const crlf = parseMarkdown(Buffer.from("| a | b |\r\n| --- | --- |\r\n", "utf8"));
    expect(lf.tables[0]?.sha256).not.toBe(crlf.tables[0]?.sha256);
    expect(lf.tables[0]?.source.toString("utf8")).toContain("\n");
    expect(crlf.tables[0]?.source.toString("utf8")).toContain("\r\n");
  });
});
