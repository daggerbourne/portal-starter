import { renderUserPage, type UserPageView } from "./user-page.js";

const sample: UserPageView = {
  role: "owner",
  displayName: "June Peck",
  email: "june@example.test",
  provider: "stub",
  state: "suspended",
  createdAt: "2026-06-01T14:00:00.000Z",
  suspendedReason: "Synthetic sample reason",
};

export default {
  name: "User page",
  sample,
  render: renderUserPage,
};
