const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateAssetRegistration,
  validateAssetMetadataChanges
} = require("../src/newsroom-assets");

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const videoId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const uploadedPath = `${ownerId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`;

function registration(overrides = {}) {
  return {
    path: uploadedPath,
    mime_type: "image/jpeg",
    asset_type: "image",
    title: "News photo.jpg",
    file_size: 2048,
    ...overrides
  };
}

test("validates and normalizes uploaded image registrations", () => {
  const result = validateAssetRegistration(registration({ tags: ["  news  ", "local"] }), ownerId);

  assert.equal(result.error, undefined);
  assert.equal(result.record.storage_path, uploadedPath);
  assert.equal(result.record.title, "News photo.jpg");
  assert.deepEqual(result.record.tags, ["news", "local"]);
  assert.equal(result.record.status, "active");
});

test("accepts generated thumbnails linked to a source video", () => {
  const result = validateAssetRegistration(registration({
    asset_type: "video_thumbnail",
    source_video_asset_id: videoId,
    alt_text: "A crowd gathers outside city hall",
    credit_line: "Chowk News",
    license_name: "Editorial use",
    image_width: 1280,
    image_height: 720
  }), ownerId);

  assert.equal(result.error, undefined);
  assert.equal(result.record.asset_type, "video_thumbnail");
  assert.equal(result.record.source_video_asset_id, videoId);
  assert.equal(result.record.image_width, 1280);
  assert.equal(result.record.alt_text, "A crowd gathers outside city hall");
  assert.equal(result.record.credit_line, "Chowk News");
  assert.equal(result.record.license_name, "Editorial use");
});

test("rejects foreign paths, MIME mismatches, and oversize assets", () => {
  assert.ok(validateAssetRegistration(registration({
    path: `dddddddd-dddd-4ddd-8ddd-dddddddddddd/${uploadedPath.split("/")[1]}`
  }), ownerId).error);
  assert.ok(validateAssetRegistration(registration({ mime_type: "image/png" }), ownerId).error);
  assert.ok(validateAssetRegistration(registration({ file_size: 25 * 1024 * 1024 + 1 }), ownerId).error);
});

test("rejects invalid thumbnail source types and metadata", () => {
  assert.ok(validateAssetRegistration(registration({
    source_video_asset_id: videoId
  }), ownerId).error);
  assert.ok(validateAssetRegistration(registration({
    alt_text: "x".repeat(501)
  }), ownerId).error);
  assert.ok(validateAssetRegistration(registration({ tags: [""] }), ownerId).error);
  assert.ok(validateAssetRegistration(registration({ image_width: 9000 }), ownerId).error);
});

test("normalizes metadata updates and records archive state", () => {
  const result = validateAssetMetadataChanges({
    title: "  Front page photo  ",
    tags: ["  politics ", "city"],
    status: "archived"
  }, "2026-01-02T03:04:05.000Z");

  assert.equal(result.error, undefined);
  assert.equal(result.changes.title, "Front page photo");
  assert.deepEqual(result.changes.tags, ["politics", "city"]);
  assert.equal(result.changes.status, "archived");
  assert.equal(result.changes.archived_at, "2026-01-02T03:04:05.000Z");
  assert.ok(validateAssetMetadataChanges({ status: "deleted" }).error);
});
