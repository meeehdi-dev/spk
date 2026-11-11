import betterTailwindcss from 'eslint-plugin-better-tailwindcss'

import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    rules: {
      'import/order': ['error', {
        'groups': ['type', 'builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'unknown'],
        'pathGroups': [{ pattern: '{~~/**,~/**,#shared/**,#imports}', group: 'internal', position: 'after' }],
        'pathGroupsExcludedImportTypes': ['type'],
        'sortTypesGroup': true,
        'newlines-between': 'always',
        'newlines-between-types': 'always',
        'alphabetize': { order: 'asc', caseInsensitive: true },
      }],
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['app/**/*.ts', 'app/**/*.vue', 'server/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true } },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  {
    plugins: { 'better-tailwindcss': betterTailwindcss },
    settings: { 'better-tailwindcss': { entryPoint: 'app/assets/css/main.css' } },
    rules: { 'better-tailwindcss/enforce-consistent-class-order': 'error' },
  },
)
