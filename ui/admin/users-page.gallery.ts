import { renderUsers, type UsersView } from "./users-page.js";

const sample: UsersView = {
  role: "staff",
  users: [
    { id: "00000000-0000-4000-8000-000000000001", displayName: "Ada Hollow", email: "ada@example.test", state: "active", updatedAt: "2026-07-15T18:30:00.000Z" },
    { id: "00000000-0000-4000-8000-000000000002", displayName: "Nico Vale", email: "nico@example.test", state: "invited", updatedAt: "2026-07-14T15:05:00.000Z" },
    { id: "00000000-0000-4000-8000-000000000003", displayName: "June Peck", email: "june@example.test", state: "suspended", updatedAt: "2026-07-10T09:45:00.000Z" },
  ],
};

export default {
  name: "Users",
  sample,
  render: renderUsers,
};
