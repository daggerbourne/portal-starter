import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const MISSING_ISSUE =
  "Suppression comment needs a portal-starter issue URL in the same comment.";

const ISSUE = "https://github.com/daggerbourne/portal-starter/issues/1";

type ExpectedMessage = {
  readonly ruleId: string;
  readonly line: number;
  readonly message?: string;
};

type LintCase = {
  readonly name: string;
  readonly filename: string;
  readonly code: string;
  readonly messages: readonly ExpectedMessage[];
};

const MISSING: ExpectedMessage = {
  ruleId: "app/disable-needs-issue",
  line: 1,
  message: MISSING_ISSUE,
};

const LINT_CASES: readonly LintCase[] = [
  {
    name: "clean",
    filename: "snippet.ts",
    code: "export const ready = 1\n",
    messages: [],
  },
  {
    name: "console outside scripts",
    filename: "snippet.ts",
    code: 'console.log("x")\n',
    messages: [{ ruleId: "no-console", line: 1 }],
  },
  {
    name: "console under scripts",
    filename: "scripts/soon.ts",
    code: 'console.log("x")\n',
    messages: [],
  },
  {
    name: "ts-ignore",
    filename: "snippet.ts",
    code: "// @ts-ignore\nexport const value = 1\n",
    messages: [{ ruleId: "@typescript-eslint/ban-ts-comment", line: 1 }],
  },
  {
    name: "ts-expect-error with a description",
    filename: "snippet.ts",
    code: "// @ts-expect-error banned even with a description\nexport const value = 1\n",
    messages: [{ ruleId: "@typescript-eslint/ban-ts-comment", line: 1 }],
  },
  {
    name: "ts-nocheck",
    filename: "snippet.ts",
    code: "// @ts-nocheck\nexport const value = 1\n",
    messages: [{ ruleId: "@typescript-eslint/ban-ts-comment", line: 1 }],
  },
  {
    name: "next-line without a URL",
    filename: "snippet.ts",
    code: '// eslint-disable-next-line no-console\nconsole.log("x")\n',
    messages: [MISSING],
  },
  {
    name: "next-line with the issue URL",
    filename: "snippet.ts",
    code: `// eslint-disable-next-line no-console -- ${ISSUE}\nconsole.log("x")\n`,
    messages: [],
  },
  {
    name: "URL in another repository",
    filename: "snippet.ts",
    code: '// eslint-disable-next-line no-console -- https://github.com/eslint/eslint/issues/1\nconsole.log("x")\n',
    messages: [MISSING],
  },
  {
    name: "issues/01",
    filename: "snippet.ts",
    code: '// eslint-disable-next-line no-console -- https://github.com/daggerbourne/portal-starter/issues/01\nconsole.log("x")\n',
    messages: [MISSING],
  },
  {
    name: "http URL",
    filename: "snippet.ts",
    code: '// eslint-disable-next-line no-console -- http://github.com/daggerbourne/portal-starter/issues/1\nconsole.log("x")\n',
    messages: [MISSING],
  },
  {
    name: "URL on the previous line",
    filename: "snippet.ts",
    code: `// see ${ISSUE}\n// eslint-disable-next-line no-console\nconsole.log("x")\n`,
    messages: [
      {
        ruleId: "app/disable-needs-issue",
        line: 2,
        message: MISSING_ISSUE,
      },
    ],
  },
  {
    name: "block disable without a URL",
    filename: "snippet.ts",
    code: '/* eslint-disable no-console */\nconsole.log("x")\n',
    messages: [MISSING],
  },
  {
    name: "disable the checker, then a bare disable",
    filename: "snippet.ts",
    code: `/* eslint-disable app/disable-needs-issue -- ${ISSUE} */\n// eslint-disable-next-line no-console\nconsole.log("x")\n`,
    messages: [
      {
        ruleId: "app/disable-needs-issue",
        line: 2,
        message: MISSING_ISSUE,
      },
    ],
  },
];

function ordered(messages: readonly ExpectedMessage[]): ExpectedMessage[] {
  return [...messages].sort((left, right) => {
    if (left.line !== right.line) {
      return left.line - right.line;
    }
    if (left.ruleId !== right.ruleId) {
      return left.ruleId < right.ruleId ? -1 : 1;
    }
    const leftMessage = left.message ?? "";
    const rightMessage = right.message ?? "";
    if (leftMessage === rightMessage) {
      return 0;
    }
    return leftMessage < rightMessage ? -1 : 1;
  });
}

async function lintSnippet(
  filename: string,
  code: string,
): Promise<ExpectedMessage[]> {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: path.join(repoRoot, "eslint.config.js"),
  });
  const filePath = path.join(repoRoot, filename);
  const results = await eslint.lintText(code, { filePath });
  const result = results[0];
  if (result === undefined) {
    throw new Error("ESLint returned no result");
  }
  return result.messages.map((message) => {
    if (message.ruleId === null) {
      throw new Error(message.message);
    }
    if (message.ruleId === "app/disable-needs-issue") {
      return {
        ruleId: message.ruleId,
        line: message.line,
        message: message.message,
      };
    }
    return { ruleId: message.ruleId, line: message.line };
  });
}

for (const lintCase of LINT_CASES) {
  test(lintCase.name, async () => {
    const actual = await lintSnippet(lintCase.filename, lintCase.code);
    assert.deepEqual(ordered(actual), ordered(lintCase.messages));
  });
}
