import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("settings navigation only exposes model selection and connection checks", () => {
  const source = readFileSync(new URL("../src/features/settings/SettingsNavigation.tsx", import.meta.url), "utf8");
  assert.match(source, /"models"/);
  assert.match(source, /"connections"/);
  assert.match(source, /모델 선택/);
  assert.match(source, /연결 확인/);
  assert.doesNotMatch(source, /기본/);
});

test("settings workspace hides numeric and project management panels", () => {
  const source = readFileSync(new URL("../src/app/AppView.tsx", import.meta.url), "utf8");
  assert.match(source, /ModelSelectionPanel/);
  assert.match(source, /LlmManagementPanel/);
  assert.doesNotMatch(source, /<SettingsPanel/);
  assert.doesNotMatch(source, /<ProjectPanel/);
});
