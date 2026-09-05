// eslint.config.js
// Replaces: checkstyle.xml + pmd-ruleset.xml + spotbugs-exclude.xml
// One config for all static analysis

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import jsdoc from "eslint-plugin-jsdoc";

export default tseslint.config(
  // Base recommended rules (like Checkstyle's Sun/Google config)
  eslint.configs.recommended,

  // Strict type-checked rules — catches:
  //   - floating promises (SpotBugs: unhandled Future)
  //   - unsafe any usage (PMD: LooseCoupling)
  //   - unnecessary conditions (SpotBugs: dead code)
  //   - no unused vars (PMD: UnusedLocalVariable)
  ...tseslint.configs.strictTypeChecked,

  // Stylistic rules — naming, consistency (Checkstyle territory)
  ...tseslint.configs.stylisticTypeChecked,

  // Disable ESLint formatting rules that conflict with Prettier
  // (like telling Checkstyle: "don't enforce indentation, let the formatter handle it")
  eslintConfigPrettier,

  // Type-aware parsing (like SpotBugs reading bytecode for type info)
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Ignore non-source folders
  { ignores: ["dist/", "node_modules/", "public/"] },

  // Route plugin functions must be async per Fastify convention
  // even without await — suppress this specific false positive
  {
    files: ["src/routes/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },

  // JSDoc enforcement — like Checkstyle's MissingJavadocMethod
  // Requires TSDoc on all exported functions and interfaces
  {
    files: ["src/**/*.ts"],
    plugins: { jsdoc },
    rules: {
      // Require JSDoc on exported functions (like MissingJavadocMethod)
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true, // only exported symbols — internal helpers are fine without
          require: {
            FunctionDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
            ClassDeclaration: true,
            MethodDefinition: true,
          },
        },
      ],
      // Require @param descriptions (like Checkstyle JavadocMethod)
      "jsdoc/require-param-description": "error",
      // Require @returns description (like Checkstyle MissingReturn)
      "jsdoc/require-returns-description": "error",
      // Validate @param names match actual parameters
      "jsdoc/check-param-names": "error",
      // No empty descriptions
      "jsdoc/no-blank-blocks": "error",
    },
  },
);
