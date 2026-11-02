import assert from "node:assert/strict";
import { test } from "node:test";
import { postgresStaffDirectory } from "../../../server/auth/staff-directory.js";

const DATABASE = "postgres://example.test/portal-starter";
const HOSTILE = "'); DROP TABLE staff;--";

type Seen = { text: string; values: readonly unknown[] };

function directoryFor(rows: readonly unknown[], url: string | undefined) {
  const seen: Seen[] = [];
  let connects = 0;
  const directory = postgresStaffDirectory({
    databaseUrl: () => url,
    connect() {
      connects += 1;
      return Promise.resolve({
        query(text, values) {
          seen.push({ text, values: [...values] });
          return Promise.resolve({ rows });
        },
        end() {
          return Promise.resolve();
        },
      });
    },
  });
  return { directory, seen, connects: () => connects };
}

test("an unset database url is not staff and does not connect", async () => {
  for (const url of [undefined, "", "   "]) {
    const probe = directoryFor([{ role: "owner" }], url);
    assert.equal(await probe.directory.findByObjectId("oid-staff"), undefined);
    assert.equal(probe.connects(), 0);
    assert.deepEqual(probe.seen, []);
  }
});

test("the staff lookup passes the object id as a parameter", async () => {
  const probe = directoryFor([{ role: "staff" }], DATABASE);
  assert.deepEqual(await probe.directory.findByObjectId(HOSTILE), { objectId: HOSTILE, role: "staff" });
  assert.equal(probe.seen.length, 1);
  assert.equal(probe.seen[0]?.text.includes("$1"), true);
  assert.equal(probe.seen[0]?.text.includes(HOSTILE), false);
  assert.deepEqual(probe.seen[0]?.values, [HOSTILE]);
  assert.equal(probe.connects(), 1);
});

test("a non-staff role and a missing row are not staff", async () => {
  const customer = directoryFor([{ role: "customer" }], DATABASE);
  assert.equal(await customer.directory.findByObjectId("oid-customer"), undefined);
  const system = directoryFor([{ role: "system" }], DATABASE);
  assert.equal(await system.directory.findByObjectId("oid-system"), undefined);
  const missing = directoryFor([], DATABASE);
  assert.equal(await missing.directory.findByObjectId("oid-missing"), undefined);
  const owner = directoryFor([{ role: "owner" }], DATABASE);
  assert.deepEqual(await owner.directory.findByObjectId("oid-owner"), { objectId: "oid-owner", role: "owner" });
});
