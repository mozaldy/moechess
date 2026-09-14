import { describe, expect, test } from "vitest";
import { applyTheme, themeBootScript, themeCssVariables } from "@/lib/theme/apply";
import { contrastRatio } from "@/lib/theme/contrast";
import { PIECE_CODES, PIECE_SETS, getBoardSkin, getPieceSet, pieceUrl } from "@/lib/theme/skins";
import { BUILT_IN_THEMES, NIGHT_SHIFT, SUMMER_SKY, getTheme } from "@/lib/theme/themes";
import { TOKEN_NAMES } from "@/lib/theme/tokens";
import { validateTheme } from "@/lib/theme/validate";

describe("contrast", () => {
  test("matches known WCAG ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });
});

describe("built-in themes", () => {
  test.each(BUILT_IN_THEMES.map((t) => [t.id, t] as const))("%s passes validation, including contrast", (_, theme) => {
    expect(validateTheme(theme)).toEqual({ ok: true, theme });
  });

  test("every built-in theme defines exactly the token set", () => {
    for (const theme of BUILT_IN_THEMES) expect(Object.keys(theme.tokens).sort()).toEqual([...TOKEN_NAMES].sort());
  });

  test("unknown theme ids fall back to Summer Sky", () => {
    expect(getTheme("night-shift")).toBe(NIGHT_SHIFT);
    expect(getTheme("nope")).toBe(SUMMER_SKY);
    expect(getTheme(null)).toBe(SUMMER_SKY);
  });
});

describe("validateTheme", () => {
  const withTokens = (tokens: Partial<typeof SUMMER_SKY.tokens> & Record<string, string>) =>
    ({ ...SUMMER_SKY, tokens: { ...SUMMER_SKY.tokens, ...tokens } });

  test("reports missing and unknown tokens", () => {
    const tokens: Record<string, string> = { ...SUMMER_SKY.tokens, sparkle: "#FFFFFF" };
    delete tokens.bg;
    const result = validateTheme({ ...SUMMER_SKY, tokens });
    expect(result).toEqual({ ok: false, problems: ['unknown token "sparkle"', 'token "bg" is missing'] });
  });

  test("colour tokens must be hex and pass contrast", () => {
    expect(validateTheme(withTokens({ ink: "purple" }))).toMatchObject({ ok: false, problems: ['token "ink" must be a #RRGGBB colour'] });
    const low = validateTheme(withTokens({ "ink-muted": "#C8D4EE" }));
    expect(low.ok).toBe(false);
    expect(!low.ok && low.problems[0]).toMatch(/^"ink-muted" on "bg" has contrast \d\.\d\d, needs 4\.5$/);
  });

  test("values that could escape CSS are rejected", () => {
    const result = validateTheme(withTokens({ "font-body": "x; background: url(https://evil.example/)" }));
    expect(result).toEqual({ ok: false, problems: ['token "font-body" contains characters that aren\'t allowed'] });
  });

  test("ids, names and skin references are checked", () => {
    const result = validateTheme({ ...SUMMER_SKY, id: "Bad Id", name: " ", pieceSetId: "nope", boardSkinId: "nope" });
    expect(result).toEqual({
      ok: false,
      problems: [
        "id must be lowercase words joined by hyphens",
        "name is required",
        'unknown piece set "nope"',
        'unknown board skin "nope"',
      ],
    });
  });
});

describe("skins", () => {
  test("the default piece set has all twelve pieces", () => {
    expect(PIECE_CODES.map((code) => pieceUrl(PIECE_SETS.cburnett, code))).toHaveLength(12);
    expect(pieceUrl(PIECE_SETS.cburnett, "wN")).toBe("/pieces/cburnett/wN.svg");
  });

  test("missing pieces and unknown ids fall back to defaults", () => {
    const partial = { id: "half", name: "Half", credit: { label: "x", license: "CC0" }, pieces: { wK: "/k.png" } };
    expect(pieceUrl(partial, "wK")).toBe("/k.png");
    expect(pieceUrl(partial, "bQ")).toBe("/pieces/cburnett/bQ.svg");
    expect(getPieceSet("nope").id).toBe("cburnett");
    expect(getBoardSkin(undefined).kind).toBe("tokens");
  });
});

describe("applying themes", () => {
  test("css variables use the --mc- prefix", () => {
    expect(themeCssVariables(SUMMER_SKY)["--mc-bg"]).toBe("#DDEBFF");
  });

  test("applyTheme sets variables and data-theme on the root", () => {
    const root = document.documentElement;
    applyTheme(root, NIGHT_SHIFT);
    expect(root.style.getPropertyValue("--mc-surface")).toBe("#2A2150");
    expect(root.getAttribute("data-theme")).toBe("night-shift");
  });

  test("the boot script applies a saved theme and ignores bad data", () => {
    const script = themeBootScript(BUILT_IN_THEMES, "moechess:settings");
    const root = document.documentElement;

    root.removeAttribute("data-theme");
    root.removeAttribute("style");
    localStorage.setItem("moechess:settings", JSON.stringify({ themeId: "night-shift" }));
    new Function(script)();
    expect(root.getAttribute("data-theme")).toBe("night-shift");
    expect(root.style.getPropertyValue("--mc-bg")).toBe("#1A1433");

    root.removeAttribute("data-theme");
    for (const bad of ["{oops", JSON.stringify({ themeId: "toString" }), JSON.stringify({ themeId: 4 })]) {
      localStorage.setItem("moechess:settings", bad);
      expect(() => new Function(script)()).not.toThrow();
      expect(root.getAttribute("data-theme")).toBeNull();
    }
  });

  test("the boot script cannot close its script tag", () => {
    const evil = { ...SUMMER_SKY, id: "evil", name: "</script><script>alert(1)</script>" };
    expect(themeBootScript([evil], "</script>")).not.toContain("</script>");
  });
});
