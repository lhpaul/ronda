// ESLint flat config for Ronda's TypeScript source and tests.
//
// Scope is deliberately narrow: `src/` and `tests/` only. The pre-existing
// template-owned TypeScript under `hooks/` and `e2e/` is not linted by this
// config — it has its own tooling and is out of scope for this project.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "hooks/**",
      "e2e/**",
      "template/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
