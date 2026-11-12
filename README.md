# spk

A small, self-hosted chat and voice app for a handful of friends: an IRC/TeamSpeak/Discord alternative you run yourself.

**Features:** text channels, DMs, voice, webcam, screen share, soundboard, search, push notifications, GIFs. Sign-up is invite-only.

**Stack:** Nuxt 4 + Nuxt UI, SQLite + Drizzle, better-auth, Cloudflare R2 (files), LiveKit (voice and video).

The design document is [PLAN.md](PLAN.md).

## Requirements

- Node 26.13.0 and pnpm 12.18.0 (pinned in `package.json`)
- `livekit-server` (voice; for local dev, see [livekit.io](https://docs.livekit.io/home/self-hosting/local/))
- A Cloudflare R2 bucket and API token (file uploads)
- Optional: a [Klipy](https://klipy.com) API key (GIFs)

Nuxt UI's built-in Nuxt Fonts integration detects Geist and Geist Mono from the CSS theme and downloads them during development and production builds. Fresh environments need network access to fetch them; production serves the generated font assets locally without browser requests to font providers.

## Local development

With mise, run `mise install` for the pinned Node and Corepack versions, then use `mise exec -- corepack pnpm …` for pnpm commands. With mise activated in your shell, `corepack enable pnpm` also makes the plain `pnpm` command available.

```sh
cp .env.example .env     # fill in the values (each one is commented)
pnpm install --frozen-lockfile
pnpm exec nuxt prepare
pnpm dev                 # http://localhost:3000
livekit-server --dev     # voice; dev key/secret are devkey / secret
```

On first start with an empty database, the server logs an admin invite link. Open it to create the first admin. `localhost` allows mic and camera without HTTPS; elsewhere you need HTTPS.

Run `pnpm exec nuxt prepare` first in a fresh checkout; both linters use Nuxt's generated configuration and types.

- `pnpm lint` runs Oxlint with type-aware checks, then ESLint for unsupported checks. `pnpm lint:fix` applies their autofixes.
- `pnpm fmt` formats files, sorts imports and Tailwind classes (including Nuxt UI `:ui`/`v-bind:ui` slots), and sorts `package.json`, including scripts. `pnpm fmt:check` checks without writing. Formatting targets 160 columns; Markdown prose wrapping is preserved.
- For individual files, use `pnpm exec oxlint --type-aware <file> --fix`, `pnpm exec eslint <file> --fix`, and `pnpm exec oxfmt --write <file>`.

Oxlint owns the migrated core, TypeScript, and supported Vue script rules. Its JavaScript plugins enforce Nuxt conventions and Tailwind ordering in variables, function calls, and tagged templates; Oxfmt sorts classes in attributes using the app stylesheet. ESLint retains Vue template rules and Vue rules without an equivalent implementation. It also retains unused-variable checks in Vue and declaration files, and type-import and floating-promise checks in Vue, where Oxlint lacks the required template or type analysis. The remaining core `no-octal` rule has no Oxlint equivalent. Existing rule options and underscore exceptions are preserved.

CI checks lint and formatting in separate steps alongside the other checks. Oxfmt ignores generated database migrations and the dependency lockfile.

Duplicate and conflicting Tailwind utilities fail lint and CI. Oxlint checks script variables/calls; ESLint checks Vue attributes and Nuxt UI slot values. Oxfmt preserves duplicates so lint can report them; `pnpm lint:fix` removes exact duplicates. Conflicting utilities require choosing the intended style; classes in separate slots, alternative branches, and distinct responsive variants are checked independently.

### Icons and PWA

`public/logo.svg` is the source for favicons and install icons. After editing it or `public/badge.svg`, run `pnpm icons` and commit the generated files in `public/`. The generator uses the recommended `minimal-2023` preset with default filenames and dark backgrounds; Nuxt serves the committed assets without regenerating them during builds.

The production app supports browser installation and push notifications without offline caching. The service worker is disabled in development; test push with a local production build. Open apps check for new deployments every five minutes and offer a dismissible Refresh notice. Refreshing disconnects voice and loses unsent GIFs, attachments and replies; draft text is saved.

## Configuration

Environment variables (Nuxt maps `NUXT_*` onto `runtimeConfig`). [.env.example](.env.example) says how to generate each one.

| Variable                       | Required | Purpose                                                                      |
| ------------------------------ | -------- | ---------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`           | yes      | Session signing secret                                                       |
| `BETTER_AUTH_URL`              | yes      | Public app URL, e.g. `https://chat.example.com`                              |
| `NUXT_DATABASE_PATH`           | yes      | SQLite file (`./data/spk.db` in dev, `/app/data/spk.db` in the image)        |
| `NUXT_R2_ACCOUNT_ID`           | yes      | Cloudflare R2 account id                                                     |
| `NUXT_R2_ACCESS_KEY_ID`        | yes      | R2 API token key id (Object Read & Write)                                    |
| `NUXT_R2_SECRET_ACCESS_KEY`    | yes      | R2 API token secret                                                          |
| `NUXT_R2_BUCKET`               | yes      | R2 bucket name                                                               |
| `NUXT_PUBLIC_LIVEKIT_URL`      | yes      | LiveKit WebSocket URL used by the browser, e.g. `wss://rtc.chat.example.com` |
| `NUXT_LIVEKIT_API_KEY`         | yes      | LiveKit API key (must match the LiveKit server)                              |
| `NUXT_LIVEKIT_API_SECRET`      | yes      | LiveKit API secret (must match the LiveKit server)                           |
| `NUXT_PUBLIC_VAPID_PUBLIC_KEY` | for push | Web Push public key                                                          |
| `NUXT_VAPID_PRIVATE_KEY`       | for push | Web Push private key                                                         |
| `NUXT_VAPID_SUBJECT`           | for push | Web Push contact, e.g. `mailto:you@example.com`                              |
| `NUXT_KLIPY_API_KEY`           | for GIFs | Klipy API key for the GIF proxy                                              |

## Deploy

Replace `chat.example.com` and `rtc.chat.example.com` with your own domains and point both at the host.

### Docker

```sh
docker build -t spk .
docker run -d --name spk -p 3000:3000 --env-file .env -v spk-data:/app/data spk
```

- **A persistent volume at `/app/data` is required.** The image has no `VOLUME` on purpose, and the container exits with an error before starting if nothing is mounted there. Without a mount the database would be lost on every redeploy.
- With a bind mount (`-v /srv/spk:/app/data`), the host folder must be writable by UID 1000 (the `node` user in the image).
- Run **one replica only**: SQLite and the in-memory voice presence don't work across containers.
- Put a reverse proxy in front that handles **HTTPS and WebSockets** and forwards `chat.example.com` to port 3000.
- Set `NUXT_DATABASE_PATH=/app/data/spk.db` (the image already does) and the other variables from the table above.

**LiveKit:** run it from [deploy/livekit/](deploy/livekit/) (`docker-compose.yml` + `livekit.yaml`; host network, embedded TURN). Set `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to the same values as the app's `NUXT_LIVEKIT_API_KEY` / `NUXT_LIVEKIT_API_SECRET`, and have the proxy send `rtc.chat.example.com` to port 7880.

**Firewall:** TCP 443, TCP 7881, UDP 50000–60000, UDP 3478.

```sh
ufw allow 443/tcp && ufw allow 7881/tcp && ufw allow 50000:60000/udp && ufw allow 3478/udp
```

**R2:** create a private bucket and an API token with Object Read & Write on it. Set the bucket CORS to allow `PUT` and `GET` (and the `Content-Type` / `Content-Length` request headers) from your app origin:

```json
[{ "AllowedOrigins": ["https://chat.example.com"], "AllowedMethods": ["GET", "PUT"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
```

**First admin:** read the app logs (`docker logs spk`) for the admin invite link.

**Backup (SQLite only):** files live in R2 and everything else is rebuilt from the repo. Don't copy the `.db` file while the app runs (WAL can give a broken copy). Take a consistent snapshot, then back up that file:

```sh
docker exec spk sqlite3 /app/data/spk.db "VACUUM INTO '/app/data/backup.db'"
```

`VACUUM INTO` fails if `backup.db` already exists: delete the old one first.

### Coolify

- Create an application built from this repo's `Dockerfile`, port 3000, domain `https://chat.example.com`. Coolify's proxy handles HTTPS and WebSockets.
- Under **Persistent Storage**, add a **named volume** with destination `/app/data`. Without it the deploy fails on purpose.
- Add the environment variables as secrets.
- Run LiveKit as a separate **Docker Compose** service from `deploy/livekit/docker-compose.yml`, and route the domain `rtc.chat.example.com` to port 7880.

## Contributing

1. Follow [Local development](#local-development) to set up.
2. Before opening a PR, run:
   ```sh
   pnpm exec nuxt prepare
   pnpm knip
   pnpm jscpd
   pnpm typecheck
   pnpm test
   pnpm build
   ```
3. Keep PRs small and focused, with the checks passing. Add a unit test for risky logic. There are no E2E tests.

GitHub Actions runs Knip, jscpd, typecheck, and tests on PRs to `main`, pushes to `main`, and manual dispatches. After they pass, it builds the app once inside the Docker image, without publishing or deploying it. CI uses the exact Node and Corepack versions from `mise.toml`, the pnpm version from `package.json`, and needs no production secrets.

Tool installs are cached separately from Corepack's pnpm download and the pnpm package store. The frozen install still runs on cache hits to recreate `node_modules` and validate the lockfile. Docker builds directly from the exact tested Git commit and caches intermediate layers; `.dockerignore` excludes docs, CI, tests, and deployment files from its build context.

Knip checks for unused files, exports, and dependencies after Nuxt generates its imports. `knip.jsonc` declares components loaded by name and the service worker as entry points. jscpd scans `app`, `server`, and `shared` with a 5% duplication ceiling; generated SQL migrations and test fixtures are outside the scan. Both checks block CI.

Project layout:

- `app/`: Nuxt frontend (pages, components, composables)
- `server/api/`: HTTP endpoints
- `server/db/`: Drizzle schema, queries and SQL migrations (`server/db/migrations`)
- `server/plugins/`: startup plugins (bootstrap, error log)
- `server/tasks/`: scheduled tasks
- `shared/`: code used by both app and server
- `tests/`: Vitest unit tests
- `deploy/`: LiveKit deployment files

To add a migration, edit `server/db/schema.ts`, then run `pnpm exec drizzle-kit generate` (configured in `drizzle.config.ts`). Commit the generated SQL and `meta/` files; migrations run at startup.

Latest Chrome, Firefox and Safari are supported.

## Notes

- **Klipy:** the GIF proxy (`/api/gifs`) keeps the API key on the server, but Klipy's terms say proxying needs prior written approval from developers@klipy.com. Get it before relying on GIFs. Media loads directly from Klipy.
- **Shortcuts:** where browsers keep a combination (e.g. `Ctrl Shift M/D/E/S`), the app uses `Ctrl/⌘ Alt Shift …`. See `?` in the app for the real list.
- **Screen share audio** is captured unprocessed (no noise suppression, echo cancellation or gain), whatever the mic setting.

## License

[MIT](LICENSE)
