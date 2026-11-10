import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Every query and mutation is named in src/queryKeys.ts, so a screen that
    // reads a list and one that changes it agree on what it is called.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/queryKeys.ts", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name=/^(queryKey|mutationKey)$/] > ArrayExpression",
          message: "Name the key in src/queryKeys.ts and use it from there.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(get|set)Quer(y|ies)(Data|Defaults)$/] > ArrayExpression",
          message: "Name the key in src/queryKeys.ts and use it from there.",
        },
      ],
    },
  },
);
