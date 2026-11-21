const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreVideoThumbnailFrame } = require("../public/video-thumbnail-quality");

function frame(width, height, luminanceAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = luminanceAt(x, y);
      const index = (y * width + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return data;
}

test("ranks a visible, detailed frame above flat or badly exposed frames", () => {
  const detailed = frame(96, 72, (x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 220 : 36));
  const flat = frame(96, 72, () => 128);
  const dark = frame(96, 72, () => 0);

  assert.ok(scoreVideoThumbnailFrame(detailed, 96, 72) > scoreVideoThumbnailFrame(flat, 96, 72));
  assert.ok(scoreVideoThumbnailFrame(detailed, 96, 72) > scoreVideoThumbnailFrame(dark, 96, 72));
  assert.equal(scoreVideoThumbnailFrame(new Uint8ClampedArray(4), 1, 1), 0);
});
