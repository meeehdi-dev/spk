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
- `pnpm typecheck`: check TypeScript and Vue types.
- `pnpm knip`: check unused code and dependencies after `pnpm exec nuxt prepare`.
- `pnpm jscpd`: check source duplication against the 5% ceiling.
- `pnpm test`: run all Vitest tests.
- `pnpm build`: build the production app.
- `pnpm exec drizzle-kit generate`: generate migrations after editing `server/db/schema.ts`; commit SQL and `meta/` files. Migrations run at startup.

## Coding Style & Naming Conventions

Follow existing two-space indentation, single-quoted TypeScript strings, and omitted statement-ending semicolons. Use Vue single-file components with `<script setup lang="ts">`, PascalCase component filenames, and `useX` composable names. Follow Nuxt file-based routing conventions. Reuse existing Nuxt UI components and shared helpers. No formatter or lint script is configured; match surrounding code.

## Testing Guidelines

Name tests `tests/<feature>.test.ts`; use Vitest `describe`, `it`, and `expect`. Database tests use in-memory SQLite; browser-dependent tests can use `happy-dom`. Run `pnpm exec nuxt prepare` before testing a fresh checkout. Add focused tests for risky logic, authorization, validation, and regressions. No coverage threshold or E2E suite is configured. Run Knip, jscpd, typecheck, tests, and build before opening a PR.

## Commit & Pull Request Guidelines

Always use Conventional Commits for commit subjects and PR titles: `<type>(<optional scope>): <description>`, such as `fix(notifications): correct push toggle state` or `docs: update setup instructions`. Keep PRs small and focused. Describe the problem, resulting behavior, and validation; link related issues and include screenshots for visible UI changes when useful.

## Security & Configuration

Keep secrets in `.env`; never commit credentials or database files. Preserve authentication and access checks. Production requires one app replica and persistent storage mounted at `/app/data`.
