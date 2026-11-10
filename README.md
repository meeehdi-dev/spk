# spk

Small private chat for friends: text channels, DMs, voice, webcam, screen share, soundboard. Nuxt 4 + Nuxt UI, SQLite, Cloudflare R2, LiveKit. Full spec: `PLAN.md`.

## Local development

Needs Node 22+, pnpm 10, and (for voice) the `livekit-server` binary.

```sh
cp .env.example .env     # fill in the values (each one is commented)
pnpm install
pnpm dev                 # http://localhost:3000
livekit-server --dev     # voice; dev key/secret are devkey / secret
```

On first start with an empty database, the server logs an admin invite link. Open it to create the first admin. `localhost` allows mic and camera without HTTPS.

Checks: `pnpm typecheck`, `pnpm test`, `pnpm build`. Latest Chrome, Firefox and Safari are supported.

## Deploy checklist (Coolify on OVH)

1. **DNS:** `spk.meeehdi.dev` and `rtc.spk.meeehdi.dev` → the VPS.
2. **R2:** create a private bucket. Create an API token with Object Read & Write on it. Set the bucket CORS to allow `PUT` and `GET` (and the `Content-Type` / `Content-Length` request headers) from `https://spk.meeehdi.dev`:
   ```json
   [{ "AllowedOrigins": ["https://spk.meeehdi.dev"], "AllowedMethods": ["GET", "PUT"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
   ```
3. **App:** a Coolify application built from this repo's `Dockerfile` (no CD pipeline, Coolify builds it). Domain `https://spk.meeehdi.dev`, port 3000. Coolify's proxy (Traefik) handles HTTPS and WebSockets.
4. **Volume:** persistent storage mounted at `/app/data` (the SQLite file, `NUXT_DATABASE_PATH=/app/data/spk.db`).
5. **Env vars** (Coolify secrets), as in `.env.example`: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://spk.meeehdi.dev`, `NUXT_DATABASE_PATH`, `NUXT_R2_*` (account id, access key id, secret, bucket), `NUXT_PUBLIC_LIVEKIT_URL=wss://rtc.spk.meeehdi.dev`, `NUXT_LIVEKIT_API_KEY`, `NUXT_LIVEKIT_API_SECRET`, `NUXT_PUBLIC_VAPID_PUBLIC_KEY`, `NUXT_VAPID_PRIVATE_KEY`, `NUXT_VAPID_SUBJECT`, `NUXT_KLIPY_API_KEY`.
6. **LiveKit:** a separate Coolify service from `deploy/livekit/docker-compose.yml` (host network, embedded TURN on UDP 3478). Set `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to the same values as the app's `NUXT_LIVEKIT_API_KEY` / `NUXT_LIVEKIT_API_SECRET`. Route the domain `rtc.spk.meeehdi.dev` to port 7880 in Coolify.
7. **Firewall** (OVH firewall and `ufw`): TCP 443, TCP 7881, UDP 50000–60000, UDP 3478.
   ```sh
   ufw allow 443/tcp && ufw allow 7881/tcp && ufw allow 50000:60000/udp && ufw allow 3478/udp
   ```
8. **First start:** read the app logs (`docker logs`, the only monitoring) for the admin invite link.
9. **Backup (SQLite only):** files live in R2 and everything else is rebuilt from the repo. Don't copy the `.db` file while the app runs (WAL can give a broken copy). Take a consistent snapshot, then back up that file:
   ```sh
   docker exec <app-container> sqlite3 /app/data/spk.db "VACUUM INTO '/app/data/backup.db'"
   ```
   `VACUUM INTO` fails if `backup.db` already exists: delete the old one first.

## Notes

- **Klipy:** the GIF proxy (`/api/gifs`) keeps the API key on the server, but Klipy's terms say proxying needs prior written approval from developers@klipy.com. Get it before relying on GIFs. Media loads directly from Klipy.
- **Shortcuts:** where browsers keep a combination (e.g. `Ctrl Shift M/D/E/S`), the app uses `Ctrl/⌘ Alt Shift …`. See `?` in the app for the real list.
- **Screen share audio** is captured unprocessed (no noise suppression, echo cancellation or gain), whatever the mic setting.
