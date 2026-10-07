// ESLint flat configuration for the whole monorepo.
//
// What this file owns: lint rules, the documentation-comment policy (CLAUDE.md §6) and the
// package dependency direction (CLAUDE.md §4) as mechanical checks. Formatting is Prettier's
// job and is deliberately not linted here.

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import eslintReact from '@eslint-react/eslint-plugin';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Import patterns that a package must never use, keyed by package directory. */
const forbiddenImports = {
  'packages/shared': [
    '@live-class/core',
    '@live-class/react',
    '@live-class/server',
    'react',
    'react-dom',
    'yjs',
    'fastify',
    'drizzle-orm',
    'node:*',
  ],
  'packages/core': [
    '@live-class/react',
    '@live-class/server',
    'react',
    'react-dom',
    'fastify',
    'drizzle-orm',
    'node:*',
  ],
  'packages/react': ['@live-class/server', 'fastify', 'drizzle-orm', 'node:*'],
  'packages/server': ['@live-class/core', '@live-class/react', 'react', 'react-dom'],
};

/**
 * Builds the dependency-direction override for one package.
 *
 * @param {string} dir - {string} Package directory relative to the repo root.
 * @param {string[]} patterns - {string[]} Module name patterns the package may not import.
 * @returns {import('eslint').Linter.Config} ESLint config object scoped to that package.
 */
function boundary(dir, patterns) {
  return {
    files: [`${dir}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: patterns.map((group) => ({
            group: [group],
            message: `${dir} must not depend on "${group}" (CLAUDE.md §4 dependency direction).`,
          })),
        },
      ],
    },
  };
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.next/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.data/**',
      'packages/server/src/db/migrations/**',
      '**/next-env.d.ts',
      '**/public/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Type-aware linting for every TypeScript file, using each package's tsconfig.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-param-reassign': 'error',
      'prefer-const': 'error',
    },
  },

  // Documentation-comment policy (CLAUDE.md §6): every export carries a doc block with
  // typed @param and @returns tags. Types are repeated in the comment on purpose so the
  // comment stands alone in a diff, a search result or a tooltip.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { jsdoc },
    settings: {
      jsdoc: {
        mode: 'typescript',
        tagNamePreference: { returns: 'returns', param: 'param' },
      },
    },
    rules: {
      ...jsdoc.configs['flat/recommended-typescript-flavor-error'].rules,
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            MethodDefinition: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
          contexts: [
            'TSInterfaceDeclaration',
            'TSTypeAliasDeclaration',
            'TSEnumDeclaration',
            'TSMethodSignature',
          ],
          checkConstructors: false,
        },
      ],
      'jsdoc/require-param': ['error', { checkDestructuredRoots: true, checkDestructured: false }],
      'jsdoc/require-param-type': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-returns': ['error', { forceRequireReturn: false, checkGetters: false }],
      'jsdoc/require-returns-type': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/require-throws': 'error',
      'jsdoc/require-description': ['error', { descriptionStyle: 'body' }],
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      'jsdoc/check-tag-names': [
        'error',
        {
          definedTags: ['remarks', 'packageDocumentation', 'internal', 'invariant', 'module'],
        },
      ],
      'jsdoc/no-types': 'off',
      'jsdoc/no-undefined-types': 'off',
      'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }],
      'jsdoc/require-hyphen-before-param-description': ['error', 'always'],
      'jsdoc/match-description': 'off',
      'jsdoc/informative-docs': 'error',
    },
  },

  // React packages: hooks rules and accessibility.
  {
    files: ['packages/react/**/*.{ts,tsx}', 'apps/demo/**/*.{ts,tsx}'],
    plugins: {
      ...eslintReact.configs['recommended-typescript'].plugins,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    settings: eslintReact.configs['recommended-typescript'].settings,
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...eslintReact.configs['recommended-typescript'].rules,
      ...reactHooks.configs['recommended-latest'].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },

  // Browser-only packages get browser globals; the server gets Node globals.
  {
    files: ['packages/core/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['packages/server/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Dependency direction between packages (CLAUDE.md §4).
  ...Object.entries(forbiddenImports).map(([dir, patterns]) => boundary(dir, patterns)),

  // Tests may use non-null assertions and leave promises dangling in fixtures less strictly.
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-throws': 'off',
      'jsdoc/informative-docs': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-description': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // `response.json() as T` reads better in tests than a generic argument.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },

  // Plain JS config files are not type-checked.
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'jsdoc/require-jsdoc': 'off' },
  },

  prettier,
);
