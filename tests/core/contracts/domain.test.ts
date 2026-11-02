import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DATABASE_ENUMS,
  portalAllowed,
  ROLES,
  SETTINGS_KEYS,
  transitionUser,
  USER_STATES,
  type UserState,
} from "../../../contracts/domain.js";
import { renderEnumsSql } from "../../../scripts/gen-enums.js";

const contractsDir = fileURLToPath(new URL("../../../contracts/", import.meta.url));

const DRAWN = [
  ["invited", "activate", "active"],
  ["active", "suspend", "suspended"],
  ["suspended", "activate", "active"],
] as const;

function event(type: "activate" | "suspend") {
  return type === "activate" ? { type } : { type, reason: "synthetic" };
}

test("roles separate end users from staff", () => {
  assert.deepEqual([...ROLES], ["user", "staff", "owner", "system"]);
});

test("user vocabulary matches the diagram", () => {
  assert.deepEqual([...USER_STATES], ["invited", "active", "suspended"]);
});

test("every drawn user edge moves", () => {
  for (const [from, type, to] of DRAWN) {
    assert.deepEqual(transitionUser(from, event(type)), { ok: true, state: to, noop: false }, `${from} ${type}`);
  }
});

test("a same-state user move is a no-op", () => {
  assert.deepEqual(transitionUser("active", { type: "activate" }), { ok: true, state: "active", noop: true });
  assert.deepEqual(transitionUser("suspended", { type: "suspend", reason: "again" }), {
    ok: true,
    state: "suspended",
    noop: true,
  });
});

test("a user move that is not drawn is refused", () => {
  assert.deepEqual(transitionUser("invited", { type: "suspend", reason: "synthetic" }), {
    ok: false,
    refusal: { code: "not_drawn" },
  });
});

test("suspending without a reason is refused", () => {
  assert.deepEqual(transitionUser("active", { type: "suspend", reason: "  " }), {
    ok: false,
    refusal: { code: "reason_empty" },
  });
});

test("only an active user reaches the portal", () => {
  const allowed = USER_STATES.filter((state: UserState) => portalAllowed(state));
  assert.deepEqual(allowed, ["active"]);
});

test("settings keys are listed once", () => {
  assert.equal(new Set(SETTINGS_KEYS).size, SETTINGS_KEYS.length);
});

test("generated enums match a fresh render of the domain", () => {
  const sql = renderEnumsSql();
  const committed = readFileSync(path.join(contractsDir, "generated/enums.sql"), "utf8");
  assert.equal(committed, sql);
  for (const [name, values] of Object.entries(DATABASE_ENUMS)) {
    assert.equal(sql.includes(`CREATE TYPE ${name} AS ENUM (${values.map((value) => `'${value}'`).join(", ")});`), true, name);
  }
});
