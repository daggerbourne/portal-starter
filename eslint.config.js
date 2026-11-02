import path from "node:path";
import js from "@eslint/js";
import parser from "@typescript-eslint/parser";
import globals from "globals";
import tseslint from "typescript-eslint";

const RULE_ID = "app/disable-needs-issue";

const SUPPRESSION_MESSAGE = {
  missingIssue:
    "Suppression comment needs a portal-starter issue URL in the same comment.",
  unreadable: "Suppression check could not read this file.",
};

const SUPPRESSION_PATTERN = /\beslint-disable(?:-next-line|-line)?(?![\w-])/;

const ISSUE_URL_PATTERN =
  /https:\/\/github\.com\/daggerbourne\/portal-starter\/issues\/[1-9]\d*(?![0-9A-Za-z])/;

function findIllegalSuppressions(source, filename) {
  let ast;
  try {
    ast = parser.parse(source, {
      comment: true,
      loc: true,
      range: true,
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: {
        jsx: filename.endsWith(".jsx") || filename.endsWith(".tsx"),
      },
    });
  } catch {
    return [{ line: 1, column: 1, messageId: "unreadable" }];
  }

  const violations = [];
  for (const comment of ast.comments ?? []) {
    if (!SUPPRESSION_PATTERN.test(comment.value)) {
      continue;
    }
    if (ISSUE_URL_PATTERN.test(comment.value)) {
      continue;
    }
    violations.push({
      line: comment.loc.start.line,
      column: comment.loc.start.column + 1,
      messageId: "missingIssue",
    });
  }
  return violations;
}

function reportTestsImport(context, node, specifier) {
  if (typeof specifier !== "string") return;
  const cwd = context.cwd ?? process.cwd();
  const relative = (filePath) => path.relative(cwd, filePath).split(path.sep).join("/");
  const inside = (filePath) => relative(filePath) === "tests" || relative(filePath).startsWith("tests/");
  if (inside(context.filename ?? "")) return;
  const fromRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const hit = fromRelative
    ? inside(path.resolve(path.dirname(context.filename ?? ""), specifier))
    : specifier === "tests" || specifier.startsWith("tests/");
  if (hit) context.report({ node, messageId: "testsImport" });
}

function literalSource(node) {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
}

const appRules = {
  rules: {
    "no-tests-import": {
      meta: {
        type: "problem",
        schema: [],
        messages: { testsImport: "Import from tests/ is outside tests/." },
      },
      create(context) {
        const report = (node, specifier) => reportTestsImport(context, node, specifier);
        return {
          ImportDeclaration(node) { report(node, node.source.value); },
          ImportExpression(node) { report(node, literalSource(node.source)); },
          ExportAllDeclaration(node) { report(node, node.source.value); },
          ExportNamedDeclaration(node) { if (node.source) report(node, node.source.value); },
          CallExpression(node) {
            if (node.callee.type === "Identifier" && node.callee.name === "require") {
              report(node, literalSource(node.arguments[0]));
            }
          },
        };
      },
    },
    "disable-needs-issue": {
      meta: {
        type: "problem",
        schema: [],
        messages: SUPPRESSION_MESSAGE,
      },
      create(context) {
        return {
          Program() {
            const filename = context.filename ?? "";
            const source = context.sourceCode.getText();
            for (const violation of findIllegalSuppressions(source, filename)) {
              const column = Math.max(0, violation.column - 1);
              context.report({
                loc: {
                  start: { line: violation.line, column },
                  end: { line: violation.line, column: column + 1 },
                },
                messageId: violation.messageId,
              });
            }
          },
        };
      },
    },
  },
};

function hiddenViolations(incoming, violations) {
  return violations.filter((violation) => {
    const message = SUPPRESSION_MESSAGE[violation.messageId];
    return !incoming.some(
      (entry) =>
        entry.ruleId === RULE_ID &&
        entry.line === violation.line &&
        entry.message === message &&
        !entry.suppressions,
    );
  });
}

function createSuppressionProcessor() {
  const sourceByFilename = new Map();
  return {
    preprocess(text, filename) {
      sourceByFilename.set(filename, text);
      return [text];
    },
    postprocess(messages, filename) {
      const source = sourceByFilename.get(filename);
      sourceByFilename.delete(filename);
      const incoming = messages.flat();
      const violations =
        source === undefined
          ? [{ line: 1, column: 1, messageId: "unreadable" }]
          : findIllegalSuppressions(source, filename);
      const reported = hiddenViolations(incoming, violations).map(
        (violation) => ({
          ruleId: RULE_ID,
          severity: 2,
          message: SUPPRESSION_MESSAGE[violation.messageId],
          line: violation.line,
          column: violation.column,
        }),
      );
      return [...incoming, ...reported];
    },
    supportsAutofix: false,
  };
}

const suppressionProcessor = createSuppressionProcessor();

export default [
  {
    ignores: ["dist/**", "dist.build/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      globals: globals.node,
      sourceType: "module",
    },
    plugins: {
      app: appRules,
    },
    processor: suppressionProcessor,
    rules: {
      "no-console": "error",
      "app/no-tests-import": "error",
      "app/disable-needs-issue": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-expect-error": true,
          "ts-nocheck": true,
        },
      ],
    },
  },
  {
    files: ["scripts/**"],
    rules: {
      "no-console": "off",
    },
  },
];
