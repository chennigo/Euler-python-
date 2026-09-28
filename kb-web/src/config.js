import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** 配置目录刻意放在知识库之外：既不入版本库，也不会被 agent 检索到。 */
export function settingsPath() {
  return process.env.DPH_KB_CONFIG
    || path.join(os.homedir(), '.dph-kb', 'settings.json');
}

export function loadSettings() {
  const p = settingsPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

export function saveSettings({ apiKey, baseUrl }) {
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const next = { ...loadSettings(), ai: { apiKey, baseUrl } };
  fs.writeFileSync(p, JSON.stringify(next, null, 2), { mode: 0o600 });
}
