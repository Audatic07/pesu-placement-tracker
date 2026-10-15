import { describe, expect, it } from "vitest";
import { formatComponentAmount } from "./format";

describe("compensation component units", () => {
  it("formats absolute INR bonuses and grants in rupees", () => {
    expect(formatComponentAmount({ amount: 350000, currency: "INR", isLpa: false })).toBe("₹3.5L");
    expect(formatComponentAmount({ amount: 400000, currency: "INR", isLpa: false })).toBe("₹4L");
  });
  it("retains annual lakh units only when explicitly recorded", () => {
    expect(formatComponentAmount({ amount: 14, currency: "INR", isLpa: true })).toBe("14.0 LPA");
    expect(formatComponentAmount({ amount: 25000, currency: "USD", isLpa: false })).toBe("USD 25,000");
  });
});
