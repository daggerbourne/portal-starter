import { renderPortalHome, type PortalHomeView } from "./home.js";

const sample: PortalHomeView = {
  displayName: "Ada Hollow",
  email: "ada@example.test",
};

export default {
  name: "Portal home",
  sample,
  render: renderPortalHome,
};
