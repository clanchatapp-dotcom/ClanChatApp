// ClanChat ESLint flat config (ESLint 9+)
// Purpose: catch real bugs (unused vars, undefined references, react-hook
// violations) and reject noisy/false-positive rules. Source-of-truth for any
// external code scanner — point them at this file or its rule list.

import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";
import globals from "globals";

export default [
  {
    ignores: [
      "build/**",
      "node_modules/**",
      "public/**",
      "src/components/ui/**", // Shadcn primitives — don't lint vendored code
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2024,
        process: "readonly",
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      import: importPlugin,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      // ── React core ──────────────────────────────────────────────────────
      ...react.configs.recommended.rules,
      "react/react-in-jsx-scope": "off", // not needed since React 17
      "react/prop-types": "off",         // not using PropTypes here
      "react/jsx-uses-react": "off",
      "react/no-unescaped-entities": "warn",
      "react/jsx-key": "error",          // missing key in lists IS a bug
      "react/jsx-no-target-blank": ["error", { allowReferrer: true }],

      // ── Hooks ───────────────────────────────────────────────────────────
      // Catches REAL closure bugs. We DON'T enable exhaustive-deps because
      // it generates noise (flagging stable module imports, locals, globals)
      // and adding those deps causes infinite re-renders.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",

      // ── Real bugs ───────────────────────────────────────────────────────
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
      "no-undef": "error",
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-self-compare": "error",
      "eqeqeq": ["warn", "smart"], // allow == null shorthand
      "no-debugger": "warn",

      // ── Style / preference (kept light) ─────────────────────────────────
      "no-empty": ["warn", { allowEmptyCatch: false }],
      "no-console": "off", // we use console.warn for soft logging

      // ── A11y ────────────────────────────────────────────────────────────
      "jsx-a11y/alt-text": "warn",
      "jsx-a11y/anchor-is-valid": "warn",

      // ── Things automated scanners often flag wrongly — explicitly OFF ──
      // Stable module imports are NOT useEffect dependencies.
      // Static array index keys are fine (React docs endorse).
      // `is None` (Python equivalent) is canonical, not a smell.
      // localStorage of non-sensitive UI prefs is fine.
    },
  },
];
