import type { AuditRow } from "./run-adapter.js";

function copyRow(row: AuditRow): AuditRow {
  return {
    adapter: row.adapter,
    mode: row.mode,
    context: row.context,
    outcome: row.outcome,
    time: row.time,
  };
}

export function createMemoryAuditSink(): {
  write(row: AuditRow): void;
  rows(): AuditRow[];
} {
  const stored: AuditRow[] = [];
  return {
    write(row: AuditRow): void {
      stored.push(copyRow(row));
    },
    rows(): AuditRow[] {
      return stored.map((row) => copyRow(row));
    },
  };
}
