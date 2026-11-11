# Repository Guidelines

## Project Structure & Module Organization

spk is a self-hosted chat and voice app built with Nuxt 4, Vue, Nuxt UI, SQLite/Drizzle, and LiveKit.

- `app/`: pages, Vue components, composables, utilities, and CSS in `app/assets/css/`.
- `server/api/`: HTTP handlers; filenames encode methods, such as `search.get.ts`.
- `server/db/`: schema, queries, and SQL migrations; `server/utils/` contains server helpers.
- `server/routes/`, `server/plugins/`, `server/tasks/`: WebSocket handling, startup hooks, and scheduled work.
- `shared/`: utilities shared by frontend and server.
- `tests/`: Vitest tests; `public/`: static icons and service worker.
- `deploy/livekit/`: voice server deployment configuration. See `README.md` for setup and `PLAN.md` for design context.

## Build, Test, and Development Commands

Use Node 26.13.0 and pnpm 12.18.0, pinned in `package.json`. `mise.toml` pins the same Node version and Corepack 0.36.0 for local development and CI. With mise, run `mise install`, then use `mise exec -- corepack pnpm …`. Configure `.env` from `.env.example` before starting.

- `pnpm install --frozen-lockfile`: install locked dependencies; build permissions live in `pnpm-workspace.yaml`.
- `pnpm dev`: start Nuxt at `http://localhost:3000`.
- `livekit-server --dev`: start local voice services.
- `pnpm lint`: run Oxlint with type-aware checks, then ESLint for unsupported checks after `pnpm exec nuxt prepare`.
- `pnpm lint:fix`: apply Oxlint and ESLint autofixes. For a focused edit, run `pnpm exec oxlint --type-aware <file> --fix` and `pnpm exec eslint <file> --fix`.
- `pnpm fmt`: format files and sort imports and Tailwind classes with Oxfmt; use `pnpm exec oxfmt --write <file>` for a focused edit.
- `pnpm fmt:check`: check formatting without writing; CI runs this separately from lint.
- `pnpm typecheck`: check TypeScript and Vue types.
- `pnpm knip`: check unused code and dependencies after `pnpm exec nuxt prepare`.
- `pnpm jscpd`: check source duplication against the 5% ceiling.
- `pnpm test`: run all Vitest tests.
- `pnpm build`: build the production app.
- `pnpm exec drizzle-kit generate`: generate migrations after editing `server/db/schema.ts`; commit SQL and `meta/` files. Migrations run at startup.

## Coding Style & Naming Conventions

Oxfmt owns formatting: two-space indentation, single quotes, no semicolons, trailing commas on multiline structures, and a 160-column target. Markdown prose wrapping is preserved. Use Vue single-file components with `<script setup lang="ts">`, PascalCase component filenames, and `useX` composable names. Follow Nuxt file-based routing conventions. Reuse existing Nuxt UI components and shared helpers. Oxfmt sorts imports by type, Node builtins, external packages, internal aliases, then relative paths, with blank lines between groups and case-insensitive alphabetizing. It sorts Tailwind classes in attributes using the app CSS entry point; Oxlint's Tailwind plugin covers variables, calls, and tagged templates. Oxlint owns supported lint rules, including TypeScript promise checks and Nuxt conventions through its JavaScript plugin. ESLint retains unsupported Vue/template checks, Vue type-import and promise analysis, unused-variable analysis in Vue and declaration files, and `no-octal`. App, server, and test promises must be awaited, handled, or intentionally marked with `void`; unused variables must be removed or prefixed with `_`. Database migrations and the lockfile are excluded from formatting.

Oxfmt also sorts `package.json` and alphabetizes scripts. It sorts Nuxt UI `:ui`/`v-bind:ui` slot classes. Duplicate and conflicting Tailwind utilities are lint errors: Oxlint checks script expressions, and ESLint checks Vue attributes and UI slots. Keep Oxfmt's `preserveDuplicates: true` so lint can diagnose duplicates; `pnpm lint:fix` removes them. Resolve conflicting utilities explicitly.

## Testing Guidelines

Name tests `tests/<feature>.test.ts`; use Vitest `describe`, `it`, and `expect`. Database tests use in-memory SQLite; browser-dependent tests can use `happy-dom`. Run `pnpm exec nuxt prepare` before testing a fresh checkout. Add focused tests for risky logic, authorization, validation, and regressions. No coverage threshold or E2E suite is configured. Run lint, fmt:check, Knip, jscpd, typecheck, tests, and build before opening a PR.

## Commit & Pull Request Guidelines

Always use Conventional Commits for commit subjects and PR titles: `<type>(<optional scope>): <description>`, such as `fix(notifications): correct push toggle state` or `docs: update setup instructions`. Keep PRs small and focused. Describe the problem, resulting behavior, and validation; link related issues and include screenshots for visible UI changes when useful.

## Security & Configuration

Keep secrets in `.env`; never commit credentials or database files. Preserve authentication and access checks. Production requires one app replica and persistent storage mounted at `/app/data`.
