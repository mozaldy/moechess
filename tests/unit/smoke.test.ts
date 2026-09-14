import { expect, test } from "vitest";
import { Chess } from "chess.js";

test("tooling resolves dependencies", () => {
  expect(new Chess().turn()).toBe("w");
  expect(document.body).toBeInTheDocument();
});
