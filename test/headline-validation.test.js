const test = require("node:test");
const assert = require("node:assert/strict");
const validateHeadline = require("../public/headline-validation");

test("accepts headlines without emoji or repeated symbols", () => {
  assert.equal(validateHeadline("Local council approves new plan"), "");
  assert.equal(validateHeadline("શું બન્યું???"), "");
});

test("rejects emoji, including joined emoji, flags, and keycaps", () => {
  assert.match(validateHeadline("News update 😀"), /cannot contain emoji/);
  assert.match(validateHeadline("Family 👨‍👩‍👧‍👦 update"), /cannot contain emoji/);
  assert.match(validateHeadline("Update 🇮🇳"), /cannot contain emoji/);
  assert.match(validateHeadline("Update 1️⃣"), /cannot contain emoji/);
});

test("rejects more than three consecutive copies of a punctuation or symbol", () => {
  assert.match(validateHeadline("News!!!!"), /more than three times/);
  assert.match(validateHeadline("Price ₹₹₹₹"), /more than three times/);
  assert.equal(validateHeadline("Really???"), "");
});

test("rejects missing headlines", () => {
  assert.match(validateHeadline("   "), /Enter a headline/);
});
