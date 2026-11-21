const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("opinion governance migration defines assignments, submissions, and reviewer metadata", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "../supabase/migrations/0091_opinion_governance_workflows.sql"),
    "utf8"
  );

  assert.match(migration, /newsroom_contributors/);
  assert.match(migration, /newsroom_content_assignments/);
  assert.match(migration, /opinion_submissions/);
  assert.match(migration, /newsroom\.opinion\.submit/);
  assert.match(migration, /newsroom\.opinion\.review/);
  assert.match(migration, /newsroom\.opinion\.publish/);
  assert.match(migration, /chowk_submit_reader_opinion/);
  assert.match(migration, /chowk_workspace_create_opinion_story/);
  assert.match(migration, /chowk_workspace_update_opinion_story/);
});

test("opinion hardening migration defines review, conversion, publication guards, and profiles", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "../supabase/migrations/0092_opinion_review_conversion_and_profiles.sql"),
    "utf8"
  );

  assert.match(migration, /chowk_submit_reader_opinion_v2/);
  assert.match(migration, /chowk_review_opinion_story/);
  assert.match(migration, /chowk_convert_reader_opinion_submission/);
  assert.match(migration, /chowk_guard_opinion_publication/);
  assert.match(migration, /submission_reference/);
  assert.match(migration, /consent_at/);
  assert.match(migration, /ip_hash/);
  assert.match(migration, /lower\(trim\(submitted_email\)\)/);
  assert.match(migration, /photo_url/);
});
