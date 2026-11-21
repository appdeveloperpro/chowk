const test = require("node:test");
const assert = require("node:assert/strict");
const createVideoPreviewController = require("../public/video-preview-controller");

function createHarness() {
  const activated = [];
  const deactivated = [];
  const controller = createVideoPreviewController({
    activate: (video) => activated.push(video),
    deactivate: (video, unload) => deactivated.push({ video, unload })
  });
  return { controller, activated, deactivated };
}

function visibility(video, intersectionRatio) {
  return { target: video, isIntersecting: intersectionRatio > 0, intersectionRatio };
}

test("plays only the most visible preview and unloads one that leaves the viewport", () => {
  const { controller, activated, deactivated } = createHarness();
  const first = {};
  const second = {};
  controller.register(first);
  controller.register(second);

  controller.update([visibility(first, 0.72), visibility(second, 0.91)]);
  assert.deepEqual(activated, [second]);

  controller.update([visibility(first, 0.95), visibility(second, 0.4)]);
  assert.deepEqual(activated, [second, first]);
  assert.deepEqual(deactivated, [{ video: second, unload: false }]);

  controller.update([visibility(first, 0)]);
  assert.deepEqual(deactivated[1], { video: first, unload: true });
});

test("unloads an old preview after it scrolls offscreen", () => {
  const { controller, activated, deactivated } = createHarness();
  const first = {};
  const second = {};
  controller.register(first);
  controller.register(second);

  controller.update([visibility(first, 0.9), visibility(second, 0.8)]);
  controller.update([visibility(first, 0.5), visibility(second, 0.9)]);
  controller.update([visibility(first, 0), visibility(second, 0.9)]);

  assert.deepEqual(activated, [first, second]);
  assert.ok(deactivated.some(({ video, unload }) => video === first && unload));
});

test("unloads a preview when only a narrow strip remains visible", () => {
  const { controller, activated, deactivated } = createHarness();
  const video = {};
  controller.register(video);
  controller.update([visibility(video, 0.8)]);
  controller.update([visibility(video, 0.05)]);

  assert.deepEqual(activated, [video]);
  assert.deepEqual(deactivated, [{ video, unload: true }]);
});

test("pauses and resumes the active preview when blocked", () => {
  const { controller, activated, deactivated } = createHarness();
  const video = {};
  controller.register(video);
  controller.update([visibility(video, 0.8)]);

  controller.setBlocked(true);
  assert.deepEqual(deactivated, [{ video, unload: false }]);
  controller.setBlocked(false);
  assert.deepEqual(activated, [video, video]);
});

test("the autoplay toggle pauses and resumes previews", () => {
  const { controller, activated, deactivated } = createHarness();
  const video = {};
  controller.register(video);
  controller.update([visibility(video, 0.8)]);

  controller.setAutoplayEnabled(false);
  controller.setAutoplayEnabled(true);
  assert.deepEqual(deactivated, [{ video, unload: false }]);
  assert.deepEqual(activated, [video, video]);
});

test("clear pauses and unloads the selected preview", () => {
  const { controller, activated, deactivated } = createHarness();
  const video = {};
  controller.register(video);
  controller.update([visibility(video, 0.8)]);
  controller.clear();
  controller.update([visibility(video, 0.9)]);

  assert.deepEqual(activated, [video]);
  assert.deepEqual(deactivated, [{ video, unload: true }]);
});
