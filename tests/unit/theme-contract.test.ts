import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { TOKEN_NAMES, cssVar } from "@/lib/theme/tokens";

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(tsx?|css)$/.test(entry.name) ? [relative] : [];
  });
}

const doc = readFileSync(path.join(ROOT, "docs/theming-hooks.md"), "utf8");
const documentedHooks = new Set([...doc.matchAll(/`\.(mc-[a-z0-9-]+)/g)].map((m) => m[1]));
const documentedTokens = new Set([...doc.matchAll(/`(--mc-[a-z0-9-]+)`/g)].map((m) => m[1]));

const source = ["app", "components"].flatMap(sourceFiles).map((file) => readFileSync(path.join(ROOT, file), "utf8")).join("\n");
// `mc-` preceded by a letter, digit or hyphen is part of something else (for example `--mc-bg`).
const usedHooks = new Set([...source.matchAll(/(?<![\w-])(mc-[a-z][a-z0-9-]*)/g)].map((m) => m[1]));

describe("theming hook contract", () => {
  test("every mc- class used in app/ and components/ is documented", () => {
    expect([...usedHooks].filter((hook) => !documentedHooks.has(hook)).sort()).toEqual([]);
  });

  test("every documented hook still exists", () => {
    expect([...documentedHooks].filter((hook) => !usedHooks.has(hook)).sort()).toEqual([]);
  });

  test("every theme token is documented, and nothing else", () => {
    const tokens = TOKEN_NAMES.map((name) => cssVar(name));
    expect(tokens.filter((token) => !documentedTokens.has(token))).toEqual([]);
    expect([...documentedTokens].filter((token) => !tokens.includes(token as (typeof tokens)[number]))).toEqual([]);
  });

  test("components and pages reference only defined tokens", () => {
    const allowed = new Set([...TOKEN_NAMES.map((name) => cssVar(name)), "--mc-face-display", "--mc-face-body"]);
    const referenced = new Set([...source.matchAll(/var\((--mc-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    // Board and dialogue build brush and board token names from data, e.g. `--mc-brush-${brush}`.
    const unknown = [...referenced].filter((token) => !allowed.has(token));
    expect(unknown).toEqual([]);
  });
});
