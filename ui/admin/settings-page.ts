import { SETTINGS_KEYS, type SettingsKey } from "../../contracts/domain.js";
import { shell } from "./chrome.js";
import { escapeHtml } from "./format.js";

const SETTING_LABEL: Record<SettingsKey, string> = {
  display_name: "Display name",
  support_email: "Support email",
};

export type SettingsView = {
  readonly values: Readonly<Record<SettingsKey, string>>;
};

export function renderSettings(view: SettingsView): string {
  const rows = SETTINGS_KEYS.map((key) => {
    const label = SETTING_LABEL[key];
    return `<tr><th scope="row">${escapeHtml(label)} <code>${escapeHtml(key)}</code></th><td><span class="field">${escapeHtml(view.values[key])}</span></td></tr>`;
  }).join("");
  const body = `<h1>Settings</h1><p class="meta">Owner only. Every change is logged with old and new values.</p><table><thead><tr><th scope="col">Setting</th><th scope="col">Value</th></tr></thead><tbody>${rows}</tbody></table><p class="actions"><button type="button" class="btn btn--primary">Save settings</button></p>`;
  return shell("settings", "owner", body);
}
