import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITIES,
  ROLE_PRESETS,
  can,
  describePermissions,
  permissionsFor,
} from "../lib/permissions.ts";

test("owner holds everything regardless of what is stored", () => {
  assert.deepEqual(permissionsFor("owner"), [...CAPABILITIES]);
  assert.deepEqual(permissionsFor("owner", []), [...CAPABILITIES]);
});

test("a null permissions column falls back to the role preset", () => {
  // Existing invites predate the column; they must behave exactly as before.
  assert.deepEqual(permissionsFor("moderator", null), ROLE_PRESETS.moderator);
  assert.deepEqual(permissionsFor("viewer", null), ["console"]);
});

test("an explicit grant overrides the preset in both directions", () => {
  // A viewer given more than the preset.
  assert.deepEqual(permissionsFor("viewer", ["console", "power"]), ["console", "power"]);
  // An admin cut back below it.
  assert.deepEqual(permissionsFor("admin", ["console"]), ["console"]);
});

test("unknown capabilities are dropped rather than trusted", () => {
  assert.deepEqual(
    permissionsFor("moderator", ["console", "delete-everything", "files"]),
    ["console", "files"],
  );
});

test("moderator preset excludes settings and worlds", () => {
  assert.equal(can(ROLE_PRESETS.moderator, "files"), true);
  assert.equal(can(ROLE_PRESETS.moderator, "settings"), false);
  assert.equal(can(ROLE_PRESETS.moderator, "worlds"), false);
});

test("viewer cannot run commands", () => {
  assert.equal(can(ROLE_PRESETS.viewer, "console"), true);
  assert.equal(can(ROLE_PRESETS.viewer, "command"), false);
});

test("an empty grant permits nothing", () => {
  for (const cap of CAPABILITIES) assert.equal(can([], cap), false);
  assert.equal(can(null, "console"), false);
});

test("presets are named, custom sets are counted", () => {
  assert.equal(describePermissions([...ROLE_PRESETS.admin]), "Admin");
  assert.equal(describePermissions([...ROLE_PRESETS.viewer]), "Viewer");
  assert.equal(describePermissions([]), "No access");
  assert.match(describePermissions(["console", "files"]), /^Custom · 2 of 9$/);
});
