export type ChangedFile = { readonly path: string; readonly additions: number; readonly deletions: number };
export type GeneratedProof = { readonly path: string; readonly clean: boolean };
export type LaneMap = {
  readonly lanes: readonly { readonly name: string; readonly paths: readonly string[] }[];
  readonly appLinesMax: number; readonly testLinesMax: number; readonly docsLinesMax: number;
  readonly testPaths: readonly string[]; readonly fixturePaths: readonly string[];
  readonly docsPaths: readonly string[]; readonly generatedPaths: readonly string[];
};
export type ScopeVerdict = {
  readonly ok: boolean; readonly reasons: readonly string[]; readonly lanes: readonly string[];
  readonly lines: { readonly app: number; readonly test: number; readonly docs: number };
};
export function parseLaneMap(text: string): LaneMap;
export function judgeScope(map: LaneMap, input: { readonly files: readonly ChangedFile[]; readonly labels: readonly string[]; readonly body: string; readonly generated: readonly GeneratedProof[] }): ScopeVerdict;
export function judgeRedFirst(input: { readonly touchedTestPaths: boolean; readonly failedCount: number }): { readonly ok: boolean; readonly reasons: readonly string[] };
export function parseNumstat(text: string): ChangedFile[];
export function testFilesToRun(nameStatus: string, testPaths: readonly string[]): readonly string[];
export function proofsWithoutRegeneration(map: LaneMap, files: readonly ChangedFile[]): readonly GeneratedProof[];
export function requireCommitSha(value: string): string;
export function pullRequestLabels(json: string): readonly string[];
