import { describe, it, expect } from "vitest";
import { instagramCaption } from "./sharing";
describe("SKY Instagram caption", () => {
  it("generates brand mention and festive hashtags without inventing product details", () => {
    const caption = instagramCaption(1);
    expect(caption).toContain("SKY Mobile & Electronics");
    expect(caption).toContain("@skymobileandelectronics");
    expect(caption).toContain("#DiwaliWithSKY");
    expect(caption).toContain("my new purchase,");
    expect(caption).not.toMatch(/price|discount|iPhone/);
  });
  it("uses plural copy and only supplied optional labels", () => {
    const caption = instagramCaption(2, [" My headphones ", ""]);
    expect(caption).toContain("my new purchases,");
    expect(caption).toContain("My SKY picks: My headphones.");
    expect(caption).not.toContain(", .");
  });
});
