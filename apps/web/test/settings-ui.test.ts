import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("settings navigation exposes connection settings under model selection", () => {
  const source = readFileSync(new URL("../src/features/settings/SettingsNavigation.tsx", import.meta.url), "utf8");
  assert.match(source, /"models"/);
  assert.match(source, /모델 선택/);
  assert.doesNotMatch(source, /"connections"/);
  assert.doesNotMatch(source, /기본/);
});

test("settings workspace hides numeric and project management panels", () => {
  const source = readFileSync(new URL("../src/app/AppView.tsx", import.meta.url), "utf8");
  assert.match(source, /ModelSelectionPanel/);
  assert.doesNotMatch(source, /LlmManagementPanel/);
  assert.doesNotMatch(source, /<SettingsPanel/);
  assert.doesNotMatch(source, /<ProjectPanel/);
});

test("model selection exposes one global default and synchronizes the current project", () => {
  const source = readFileSync(new URL("../src/features/settings/ModelSelectionPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /전역 기본 모델/);
  assert.doesNotMatch(source, /현재 프로젝트 모델/);
  assert.doesNotMatch(source, /projectModel/);
  assert.match(source, /defaultModelBackend: globalModel/);
  assert.match(source, /selectedProvider/);
  assert.match(source, /MCP/);
  assert.match(source, /disabled={!props.settings \|\| !verified\?\.ok}/);
  assert.match(source, /open={oauthOpen}/);
});
