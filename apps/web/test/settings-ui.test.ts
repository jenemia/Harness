import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("settings navigation exposes project, defaults, and connection tabs", () => {
  const source = readFileSync(new URL("../src/features/settings/SettingsNavigation.tsx", import.meta.url), "utf8");
  assert.match(source, /"project"/);
  assert.match(source, /"defaults"/);
  assert.match(source, /"connections"/);
  assert.match(source, /프로젝트/);
  assert.match(source, /연결관리/);
});

test("numeric settings provide titles, descriptions, units, and accessible ranges", () => {
  const source = readFileSync(new URL("../src/features/settings/NumberSettingField.tsx", import.meta.url), "utf8");
  assert.match(source, /props\.label/);
  assert.match(source, /props\.description/);
  assert.match(source, /props\.unit/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /props\.min/);
  assert.match(source, /props\.max/);
});
