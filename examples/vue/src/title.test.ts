import { expect, test } from "vitest";
import { normalizeTitle } from "./title";

test("normalizes leading, trailing, and internal space", () => {
  expect(normalizeTitle("  Draft   note  ")).toBe("Draft note");
});
