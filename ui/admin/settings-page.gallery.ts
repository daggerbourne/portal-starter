import type { SettingsKey } from "../../contracts/domain.js";
import { renderSettings, type SettingsView } from "./settings-page.js";

const values: Record<SettingsKey, string> = {
  display_name: "Portal Starter",
  support_email: "support@example.test",
};

const sample: SettingsView = { values };

export default {
  name: "Settings",
  sample,
  render: renderSettings,
};
