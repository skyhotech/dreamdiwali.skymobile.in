import { expect, test } from "vitest";
import { findImei } from "./ImeiScanner";
test("finds an IMEI in labels, spaced digits and double barcodes", () => {
  expect(findImei("IMEI1:490154203237518")).toBe("490154203237518");
  expect(findImei("49 0154 203237518")).toBe("490154203237518");
  expect(findImei("111111111111111490154203237518")).toBe("490154203237518");
  expect(findImei("8901234567890")).toBe("");
});
