import { renderDevBanner, type DevBannerView } from "./dev-banner.js";

const sample: DevBannerView = { databaseLabel: "dev" };

export default {
  name: "Dev banner",
  sample,
  render: renderDevBanner,
};
