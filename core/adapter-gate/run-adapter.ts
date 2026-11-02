const MODES = ["mock", "sandbox", "live"] as const;

export type Mode = (typeof MODES)[number];

export type RecordedMode = Mode | "invalid";

export type RefusalOutcome =
  | "killed"
  | "missing_context"
  | "invalid_mode"
  | "live_refused";

export type AuditOutcome = RefusalOutcome | "allowed" | "adapter_error";

export type AuditRow = {
  readonly adapter: string;
  readonly mode: RecordedMode;
  readonly context: string;
  readonly outcome: AuditOutcome;
  readonly time: string;
};

export type AuditSink = {
  write(row: AuditRow): void | Promise<void>;
};

export type EnvName = "MODE" | "APP_KILL" | "APP_DEPLOY_CONTEXT";

export type EnvReader = (name: EnvName) => unknown;

export type Clock = () => Date;

export type AdapterDeps = {
  readonly env: EnvReader;
  readonly clock: Clock;
  readonly audit: AuditSink;
};

const REFUSAL_MESSAGE: Record<RefusalOutcome, string> = {
  killed: "APP_KILL is 1.",
  missing_context: "APP_DEPLOY_CONTEXT is missing.",
  invalid_mode: "MODE is invalid.",
  live_refused: "Live mode is outside production.",
};

export class AdapterRefusal extends Error {
  readonly adapter: string;
  readonly outcome: RefusalOutcome;

  constructor(adapter: string, outcome: RefusalOutcome) {
    super(REFUSAL_MESSAGE[outcome]);
    this.name = "AdapterRefusal";
    this.adapter = adapter;
    this.outcome = outcome;
  }
}

type GateFacts = {
  readonly killed: boolean;
  readonly context: string;
  readonly mode: RecordedMode;
};

type Decision =
  | {
      readonly kind: "refuse";
      readonly outcome: RefusalOutcome;
      readonly mode: RecordedMode;
    }
  | {
      readonly kind: "call";
      readonly mode: Mode;
    };

function readEnv(env: EnvReader, name: EnvName): string | undefined {
  const value: unknown = env(name);
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

function parseMode(value: string | undefined): RecordedMode {
  if (value === undefined) {
    return "invalid";
  }
  const trimmed = value.trim();
  const mode = MODES.find((candidate) => candidate === trimmed);
  return mode ?? "invalid";
}

function isKilled(value: string | undefined): boolean {
  return value?.trim() === "1";
}

function readContext(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }
  return value.trim();
}

function decide(facts: GateFacts): Decision {
  if (facts.killed) {
    return { kind: "refuse", outcome: "killed", mode: facts.mode };
  }
  if (facts.context === "") {
    return { kind: "refuse", outcome: "missing_context", mode: facts.mode };
  }
  switch (facts.mode) {
    case "invalid":
      return { kind: "refuse", outcome: "invalid_mode", mode: "invalid" };
    case "live":
      if (facts.context === "production") {
        return { kind: "call", mode: "live" };
      }
      return { kind: "refuse", outcome: "live_refused", mode: "live" };
    case "mock":
    case "sandbox":
      return { kind: "call", mode: facts.mode };
    default: {
      const unreachable: never = facts.mode;
      throw new Error(unreachable);
    }
  }
}

function rowOf(
  adapter: string,
  mode: RecordedMode,
  context: string,
  outcome: AuditOutcome,
  time: string,
): AuditRow {
  return { adapter, mode, context, outcome, time };
}

export async function runAdapter<T>(
  adapter: string,
  fn: (mode: Mode) => T | Promise<T>,
  deps: AdapterDeps,
): Promise<T> {
  const mode = parseMode(readEnv(deps.env, "MODE"));
  const killed = isKilled(readEnv(deps.env, "APP_KILL"));
  const context = readContext(readEnv(deps.env, "APP_DEPLOY_CONTEXT"));
  const decision = decide({ killed, context, mode });
  const time = deps.clock().toISOString();

  switch (decision.kind) {
    case "refuse":
      await deps.audit.write(
        rowOf(adapter, decision.mode, context, decision.outcome, time),
      );
      throw new AdapterRefusal(adapter, decision.outcome);
    case "call": {
      let value: T;
      try {
        value = await fn(decision.mode);
      } catch (error) {
        try {
          await deps.audit.write(
            rowOf(adapter, decision.mode, context, "adapter_error", time),
          );
        } catch {
          throw error;
        }
        throw error;
      }
      await deps.audit.write(
        rowOf(adapter, decision.mode, context, "allowed", time),
      );
      return value;
    }
    default: {
      const unreachable: never = decision;
      throw new Error(unreachable);
    }
  }
}
