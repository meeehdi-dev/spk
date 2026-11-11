import prettier from 'eslint-config-prettier/flat'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import { getDefaultSelectors } from 'eslint-plugin-better-tailwindcss/api/defaults'
import { MatcherType, SelectorKind } from 'eslint-plugin-better-tailwindcss/api/types'
import oxlint from 'eslint-plugin-oxlint'

import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
      'vue/one-component-per-file': 'off',
      'nuxt/prefer-import-meta': 'off',
      'nuxt/no-page-meta-runtime-values': 'off',
      'nuxt/no-nuxt-config-test-key': 'off',
      'nuxt/nuxt-config-keys-order': 'off',
    },
  },
  ...(await oxlint.buildFromConfigFile('./oxlint.config.ts', { typeAware: true, withNursery: true })),
  {
    // Oxlint cannot inspect Vue template attributes, including Nuxt UI slot classes.
    files: ['**/*.vue'],
    plugins: { 'better-tailwindcss': betterTailwindcss },
    settings: {
      'better-tailwindcss': {
        entryPoint: 'app/assets/css/main.css',
        selectors: [
          ...getDefaultSelectors().filter(selector => selector.kind === SelectorKind.Attribute),
          { kind: SelectorKind.Attribute, name: '^v-bind:ui$', match: [{ type: MatcherType.ObjectValue }] },
        ],
      },
    },
    rules: {
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
    },
  },
  {
    // Oxlint skips unused-variable analysis in Vue and declaration files.
    files: ['**/*.vue', '**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Oxlint cannot determine whether imports are used by a Vue template.
    files: ['**/*.vue'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false, prefer: 'type-imports' }],
    },
  },
  {
    // Oxlint cannot run type-aware rules in SFCs.
    files: ['app/**/*.vue'],
    languageOptions: { parserOptions: { projectService: true } },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  prettier,
)
