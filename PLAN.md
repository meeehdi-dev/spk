# spk: project plan

A private, self-hosted chat and voice app (an IRC/TeamSpeak/Mumble/Discord replacement) for **5 people at most**. Hobby project: keep it simple.

- **App:** `spk.meeehdi.dev`
- **LiveKit:** `rtc.spk.meeehdi.dev`

---

## 1. Stack

| Need | Choice |
|---|---|
| Framework | **Nuxt 4** + **Nuxt UI v4** |
| Icons | **Lucide** (`@iconify-json/lucide`, bundled locally) |
| Realtime (chat, presence, notifications, voice state) | **Nitro WebSockets** (built in) |
| Database | **SQLite** (WAL mode) + **Drizzle ORM** (`better-sqlite3`) |
| Search | **SQLite FTS5** (built in) |
| Auth | **better-auth**: `emailAndPassword` + `admin` plugin |
| Voice, video, screen share | **LiveKit** (self-hosted SFU) + `livekit-client` + `livekit-server-sdk` (tokens) |
| Noise suppression | Browser built-in + **`@sapphi-red/web-noise-suppressor`** (RNNoise) |
| File storage | **Cloudflare R2**, presigned URLs signed with **`aws4fetch`** |
| Image processing | **`sharp`** (avatars, link preview thumbnails) |
| Markdown rendering | **`@nuxtjs/mdc`** + **Shiki** |
| Code language detection | **`highlight.js`** (`highlightAuto`, common languages only) |
| Message input | Nuxt UI **`UEditor`** (TipTap) with `content-type="markdown"` + `UEditorMentionMenu`, plus 2 small custom extensions (see §6) |
| Emoji picker | **`emoji-picker-element`** |
| GIFs | **Klipy** API, proxied through Nitro |
| Link previews | **`unfurl.js`** (or `open-graph-scraper`) |
| Soundboard trimming | **`wavesurfer.js`** (Regions plugin) for the editor, Web Audio for cutting and playback |
| Text and voice channel ordering | **`@vueuse/integrations`** `useSortable` (SortableJS) |
| Push notifications | **`web-push`** + a service worker (PWA) |
| Package manager | **pnpm** |
| Tests | **Vitest**, unit tests only, for risky logic. No E2E tests |
| Hosting | OVH VPS (4 vCPU, 8 GB), deployed with **Coolify** |
| Backups | Handled by you in Coolify (see §13) |

---

## 2. Architecture

```
Browser (Nuxt app, PWA)
 ├─ HTTP   → Nitro: auth, channels, history, search, uploads (presign), GIF proxy, LiveKit token, health
 ├─ WS     → Nitro: messages (new/edit/delete), reactions, previews, typing, presence,
 │            unread, voice state, admin move/disconnect
 ├─ HTTPS  → R2: direct upload/download through presigned URLs
 └─ WebRTC → LiveKit: audio, webcam, screen share

VPS (Coolify)
 ├─ app      Nuxt/Nitro + SQLite file (persistent volume /app/data)
 └─ livekit  network_mode: host, embedded TURN (UDP 3478)
```

- **One replica only.** SQLite and the in-memory voice presence don't work across several containers. A deploy causes a few seconds of reconnecting.

---

## 3. Data model

| Table | Columns |
|---|---|
| `users` (better-auth) | id, email, display_name (unique, case-insensitive), avatar_key, role (`admin` / `user`, from the admin plugin) |
| `invites` | id, token_hash, note, created_by, created_at, expires_at, used_at, used_by, revoked_at |
| `channels` | id, type (`text` / `voice` / `dm`), name, last_activity_at (DMs), position (text and voice), created_at |
| `sounds` | id, name, icon (Lucide name), r2_key, duration_ms, size, created_by, created_at |
| `channel_members` | channel_id, user_id (DMs only, 2 members) |
| `messages` | id, channel_id, user_id, body (Markdown), reply_to_id, created_at, edited_at, deleted_at, suppress_previews |
| `messages_fts` | FTS5 virtual table on `body`, kept in sync by 3 triggers (raw SQL migration) |
| `message_mentions` | message_id, user_id (mentions and replies to you) |
| `attachments` | id, message_id (null until sent), uploader_id, r2_key, filename, mime, size, spoiler, created_at |
| `reactions` | message_id, user_id, emoji |
| `link_previews` | url, title, description, site_name, image_key, fetched_at |
| `channel_reads` | user_id, channel_id, last_read_at |
| `push_subscriptions` | user_id, endpoint, keys |

Stored in the browser (`localStorage`), not in the database: device choices, noise and audio options, screen share preset, message drafts per channel, sidebar section open/closed state, hidden DMs, muted channels, Do Not Disturb, sounds settings.

---

## 4. Accounts and access

- **Email + password** with better-auth. `requireEmailVerification: false`. The app never sends email.
- **Sign-up only with an invite link:**
  - An admin creates an invite in Settings → Invites, with an optional note and an expiry (**1h / 24h / 7 days**).
  - The link `https://spk.meeehdi.dev/signup?invite=<token>` is shown **once** with a copy button. Only a hash of the token is stored.
  - One link creates **one account**. The invite is marked used in the same step as sign-up, and released if sign-up fails.
  - A `before` hook on `/sign-up/email` rejects requests without a valid invite, so the API can't be called directly.
  - `/signup` without an invite shows "You need an invite link". `GET /api/invites/check` reports invalid or expired links before the form.
- **First admin:** when there are no users, the server prints an admin invite link in its logs at startup (visible in Coolify's logs). No CLI.
- **First sign-in:** a modal that can't be dismissed asks for:
  - a **nickname** (required, 2–32 characters, unique ignoring upper/lower case),
  - an **avatar** (optional). It's center-cropped automatically and resized to 256px WebP with `sharp`. Animated GIFs stay animated (animated WebP). Without an avatar, `i-lucide-user` is shown.
- **Sessions:** about 30 days, refreshed when used. Login and sign-up are rate limited (built into better-auth).
- **Passwords:** at least 8 characters. Change your own password in Profile settings. A forgotten password is reset by an admin in **Settings → Users → Reset password**, which creates a one-time reset link that the admin sends manually.
- **Roles:**
  - **Admin:** create, rename and delete channels, delete any message, move and disconnect people in voice, manage invites and users (role, ban, reset password link).
  - **User:** everything else.
  - The last admin can't demote themselves.
  - The server checks the role on every admin API call.
- **Banned users:** their messages are kept. Only admins delete accounts.

---

## 5. Layout

- **Left sidebar**, with 3 collapsible sections (open/closed state remembered):
  - **DMs**, **Text channels**, **Voice channels**.
  - **DMs** are sorted by `last_activity_at` (last message), newest first.
  - **Text and voice channels** use a **manual order**, the same for everyone. Admins drag and drop them within their section in the sidebar (`useSortable` from `@vueuse/integrations`), saved in `channels.position`. New channels go at the end, so the default order is by `created_at`.
  - Text channels and DMs show an **unread count** and a separate **mention badge**.
  - Voice channels list who is in them, with a **speaking ring** and status icons (muted, deafened, camera on, sharing).
  - DMs can be **hidden** until a new message arrives.
- **Main panel:** the chat for text channels and DMs, the tile grid for voice channels.
- **Voice bar** at the bottom while in voice (see §8).
- **Mobile:** fully responsive, with the sidebar in a drawer. Installable as a **PWA**.
- **Theme:** follows the system, with a dark/light toggle.
- **English only.**

---

## 6. Text chat (channels and DMs)

### Messages
- Consecutive messages from the same author (within 5 minutes) are grouped under one header. Grouped messages show their time in the left margin on hover.
- **Date dividers** ("Today", "Nov 8"). Times are relative ("2 min ago"), exact on hover.
- A **"New messages" divider**. Opening a channel jumps to your first unread message.
- **Typing indicator** ("Alex is typing…").
- **Drafts** are kept per channel when you switch away.
- History loads more as you scroll up. `?around=<messageId>` loads the messages around a given message, for jumps from search, replies and notifications.
- **Edit** your own messages, forever. An **"(edited)"** label is shown, with no edit history.
- **Delete** your own messages. Admins can delete any message. A deleted message disappears completely, and its files are deleted from R2.
- **Mark as unread** from the message context menu.
- **Light rate limit** on sending messages.
- **Hover toolbar:** 3 fixed quick reactions (one click), a `i-lucide-smile-plus` button that opens the emoji picker for any other emoji, then reply, edit, copy, more.

### Formatting (Markdown)
- Bold, italic, strikethrough, inline code, quotes, lists, links, spoilers (`||hidden||`, blurred until clicked).
- Raw HTML is turned off. Only `http`, `https` and `mailto` links are allowed.
- **Custom syntax, in both the editor and the renderer** (confirmed against the docs: `UEditor` uses TipTap's Markdown extension, where each node defines its own Markdown parse and render):
  - **Mention:** extend TipTap's `Mention` node so it reads and writes `<@userId>` instead of its default Markdown form. `UEditorMentionMenu` items carry the user `id`.
  - **Spoiler:** a small custom mark that reads and writes `||text||`.
  - On the display side, one small remark plugin for `@nuxtjs/mdc` turns `<@id>` into the mention chip and `||…||` into the spoiler.
- **Code blocks:**
  - Shiki highlighting, **line numbers** (left out when copying).
  - When no language is written, `highlight.js` guesses one ("auto: ts"). Blocks under about 5 lines stay plain text.
  - The header shows the language. Clicking it opens a **searchable `USelectMenu`** of languages:
    - on your own message, the choice is saved in the message for everyone,
    - on someone else's message, it only changes the block on your screen.
  - Blocks over about 1,000 lines show as plain monospace with a "Highlight" button.
- **Copy buttons** (`i-lucide-copy` → `i-lucide-check`) on code blocks (raw code), quotes (text without `>`), and the whole message (raw Markdown).
- **Shortcuts in the input:** `Enter` sends, `Shift Enter` adds a new line (`Enter` adds a line inside a code block), `Ctrl/⌘ B / I / E` bold / italic / inline code, `Ctrl/⌘ Shift C` code block, `Ctrl/⌘ Shift .` quote.

### Long messages
- Limit: **200 KB per message** (about 5,000 lines of code).
- Messages over **25 lines** are collapsed, faded at the bottom, with:
  - `i-lucide-chevrons-down` **Show 50 more**
  - `i-lucide-unfold-vertical` **Show all**
  - **Collapse** once expanded (not remembered after a reload).
- A long paste stays a message (no conversion to a `.txt` file).

### Mentions and replies
- Typing `@` opens an autocomplete list of users. A mention is stored as `<@userId>` and shown with the user's **current** nickname, so nickname changes never break mentions.
- The server checks every `<@id>` is a real user and fills `message_mentions`.
- **Reply:** `reply_to_id`. Shows a preview of the original (author and first line), click to jump to it. "Original message deleted" if it's gone. A reply to you counts as a ping.
- **Quote:** inserts `> text` into the input, from the context menu or from selected text.

### Reactions and emoji
- Reactions with `emoji-picker-element`. Default yellow skin tone only, no recently used list.
- **`:shortcode:` autocomplete** in the input. No custom emoji.

### Attachments
- Uploaded **directly to R2** with presigned PUT URLs. The server signs `Content-Length` and `Content-Type`, so the size limit can't be bypassed.
- Files are downloaded through short-lived presigned GET URLs. The bucket stays private.
- **Up to 10 files per message, 25 MB each.** Paste from the clipboard and drag and drop.
- **Upload queue:** file type icon, name, human-readable size (`20 MB`, using `Intl.NumberFormat`), progress bar, cancel button (`XMLHttpRequest` for progress).
- **File type icons:** `file-image`, `file-video`, `file-audio`, `file-archive`, `file-code`, `file-text` (PDF and text), `file-spreadsheet`, `file` (anything else).
- **Display:** images inline, limited to about **350 px high**, click for full size in the **lightbox**. Native players for video and audio, a file card with icon, name and size for everything else.
- **Text and code file preview** (`.txt`, `.md`, `.log`, `.json`, `.ts`, `.py`, … under 1 MB): the client fetches the first 64 KB from R2 (HTTP `Range` request) and shows it like a code block: Shiki highlighting based on the file extension, line numbers, copy button. It uses the same collapse as long messages (25 lines, Show 50 more, Show all). "Show all" downloads the full file. Bigger files only get the file card.
- **Spoiler images:** a `i-lucide-eye-off` toggle per file in the upload queue. The image is blurred until clicked.
- **No orphan files:** the presign request inserts the `attachments` row with `message_id = null`. Sending the message sets `message_id` in the **same database transaction** as the message insert. Orphans still happen when someone uploads then removes the file, closes the tab, or the send fails (R2 can't be part of a database transaction), so a Nitro scheduled task deletes rows still `null` after 24 h, and their R2 objects.

### Links and previews
- URLs are clickable (GFM autolink) and **open in a new tab** (`rel="noopener noreferrer"`). Links to messages or channels inside spk open in the app.
- **Internal links:** "Copy link" in the context menu of every message and channel copies `https://spk.meeehdi.dev/c/:channelId` or `/c/:channelId/m/:messageId`. Pasted in a message, it shows as a chip (`#general › message from Alex`) instead of a raw URL, and gets no preview card. Clicking it opens the channel and jumps to the message. A DM link only works for its 2 members, everyone else sees "No access".
- **Preview card** (site name, title, description, thumbnail) when the site has preview data, otherwise **just the link**. No embeds, no "leaving the app" warning.
- Previews are fetched in the background after sending, then added by the `message:previews` WebSocket event. Up to 3 per message. Cached in `link_previews`. Thumbnails are resized with `sharp` and stored in R2.
- `<url>` skips the preview. The author or an admin can remove a preview.
- **SSRF protection (required):** only `http`/`https` on ports 80/443, block private, loopback and link-local IPs (checked after DNS resolution and after every redirect), at most 3 redirects, 5 s timeout, 1 MB limit, `text/html` and images only, rate limit per user.

### GIFs
- A `i-lucide-image-play` button in the input opens a **GIF menu** with trending GIFs and a search box.
- Requests go through a Nitro proxy, so the API key stays on the server and friends' IPs aren't sent to the provider.
- Picking a GIF sends its URL. GIFs from the provider show **inline and animated** (the one exception to "card or link"). No favorites.
- Provider: **Klipy** (account created). Its API key goes in a Coolify env var. Follow Klipy's attribution guidelines in the GIF menu.

---

## 7. Search

- **SQLite FTS5**, ranked with `bm25()`, highlighted snippets with `snippet()`. Each word is quoted and given a `*` (prefix match). Deleted messages are excluded.
- **Scopes:** this channel / all channels / DMs / everything. The server only searches channels the user can access.
- **Results panel** on the right: channel, author, snippet, date. Click to jump to the message.
- **Filters** (typed in the search box, with autocomplete for names and channels):

| Filter | Matches |
|---|---|
| `from:Alex` | messages written by Alex |
| `mentions:Alex` | messages that mention Alex |
| `in:general` | messages in that channel |
| `has:file` / `has:image` / `has:link` | messages with an attachment, an image, a link |
| `before:2026-11-01` / `after:2026-10-01` | by date |

- **Names are resolved at search time** against users' **current** nicknames (case-insensitive), then turned into user ids. So `from:` and `mentions:` keep working after a rename, and old messages are found under the new name.
- A plain word that matches a nickname also finds messages that **mention** that user, so searching `Alex` finds `<@alexId>`.
- Filters become extra SQL conditions on top of FTS5. A search can be filters only (e.g. `from:Alex has:file`).
- `GET /api/search?q=&scope=&channelId=&cursor=`, 20 results per page.
- Shortcuts: `Ctrl/⌘ F` search this channel, `Ctrl/⌘ Shift F` search everything, `↑/↓` + `Enter` to pick, `Esc` to close.

---

## 8. Voice and video (LiveKit)

### Joining
- One LiveKit room per voice channel. Nitro creates the token.
- Same account in 2 tabs or devices: joining from one disconnects the other, with a toast.
- No limit on users per voice channel. No auto-disconnect.
- LiveKit handles late joiners, reconnection and network changes. The server removes ghost users when their WebSocket closes, and pings sockets every ~20 s.
- Admins can **move** someone to another voice channel (a WebSocket event that tells their client to switch) or **disconnect** them.
- Deleting a voice channel while people are in it disconnects them with a toast.
- **Leaving while in voice:** closing or reloading the tab while connected to a voice channel shows the browser's "Leave site?" warning (`beforeunload`). No warning when not in voice.

### Voice bar
- **Mic** (mute/unmute) with an **arrow dropdown**: input device, noise suppression (Off / Standard / Enhanced), echo cancellation, auto gain, sensitivity slider. Each option shows its shortcut (`UKbd`).
- **Headphones** (deafen) with an **arrow dropdown**: output device, output volume.
- **Camera** with an **arrow dropdown**: camera device.
- **Screen share**, **Leave**.
- **Mute and deafen:**
  - Deafening also mutes you.
  - Undeafening restores your mute state from before.
  - Unmuting while deafened also undeafens you.
- Voice activation only, with a sensitivity slider. No push-to-talk.

### Devices
- Mic, speakers and camera can be chosen in the dropdowns or in Settings → Voice & Video.
- Remembered as `{ deviceId, label }` in `localStorage`. On join: use the saved id, otherwise a matching label, otherwise the system default.
- `devicechange` keeps the lists current. If the active device is unplugged, the app switches to the default and shows a toast.
- Choosing speakers isn't possible on Safari/iOS, so the option is hidden there.

### Audio processing
- **Standard:** the browser's own noise suppression.
- **Enhanced:** RNNoise as a LiveKit track processor (the browser's suppression is turned off).
- Echo cancellation and auto gain: toggles, on by default.
- Mute with `track.enabled = false` (nothing to renegotiate).

### Tiles (main panel)
| State | Tile shows |
|---|---|
| Nothing on | Avatar |
| Webcam on (watched) | Webcam **replaces** the avatar |
| Screen share on (watched) | Screen **replaces** the avatar |
| Both | Screen, with the webcam in a small corner |

- Several people can share their screen at once, each as their own tile.
- **Speaking ring** on tiles (LiveKit's `isSpeaking`). Also in the sidebar, for every voice channel, through the `voice:state` WebSocket event (sent on change, at most every ~200 ms). The server clears it when the socket closes.
- **Your own tile:** webcam mirrored. Screen shows "You're sharing your screen" with a Stop button ("Show preview" in its menu).
- **Other people's webcam and screen share are opt-in.** Video tracks aren't subscribed automatically (LiveKit `autoSubscribe: false`, then audio is subscribed manually, video only on demand). When someone turns on their webcam or screen share, their tile keeps the avatar and shows a `LIVE` badge (`i-lucide-video` or `i-lucide-screen-share`) and an `i-lucide-eye` **Watch** button. Screen share audio is only received while watching it.
- Hover actions:
  - **Watch** / **Stop watching** (unsubscribes, saves bandwidth; mic audio keeps playing)
  - **Theater mode** (tile fills the panel, others in a strip at the bottom)
  - **Fullscreen** (`Esc` exits)
- Shortcuts on a hovered or focused tile: `T` theater, `F` or double-click fullscreen, `W` watch/stop watching, `Esc` exit. Ignored while typing.
- `adaptiveStream`: bigger tiles get a higher resolution automatically.
- Deafening stops audio only, not video.

### Volume
- Per user: **mic volume** and **screen share audio volume**, as 2 separate sliders. Plus **mute for me**.
- The sliders are in the right-click menu on the **video tile** and on the **user** (sidebar, mentions, profile).
- **On a watched screen share with audio:** a `i-lucide-volume-2` button at the **bottom right** of the tile, shown on hover, with a volume slider. It's the same setting as the one in the menus.

### Screen share
- A **pre-share dialog** in the app: preset and audio on/off. Then the browser's own picker opens (it can't be replaced in a web app).
- Picker hints: `displaySurface`, `selfBrowserSurface: 'exclude'`, `systemAudio`, `surfaceSwitching: 'include'` (Chromium; other browsers ignore most of them).

| | **Clarity** (code, docs, text) | **Smoothness** (games, video) |
|---|---|---|
| Resolution | native, up to 1440p | 720p to 1080p |
| Frame rate | 5–15 fps | 30–60 fps |
| `contentHint` | `detail` / `text` | `motion` |
| `degradationPreference` | `maintain-resolution` | `maintain-framerate` |
| Bitrate (approx.) | 2–4 Mbps | 4–8 Mbps |

- **VP9**, with VP8 as `backupCodec`. The last preset is remembered.

### Sounds
- **Join / leave:** played when **you** join or leave a voice channel, and when **someone else** joins or leaves the channel you're in.
- **Mute / deafen:** only for **your own** mute and deafen. Nothing plays when others mute.
- **Message:** for new messages (see §9).
- Free sound files. One volume slider and one on/off switch per sound.

### Soundboard
**Feasibility:** easy to medium, about 1–2 days of work. The trimming editor is the biggest part. No change to LiveKit is needed.

- **How sounds play:** pressing a sound sends `voice:sound { soundId }` over the WebSocket. The server checks the user is in that voice channel and relays it to everyone in it. Each client plays the sound **locally** with Web Audio (from a cached R2 file), so it respects each person's own volume and deafen. It isn't mixed into anyone's mic, which avoids echo and encoding.
- **Voice bar:** a `i-lucide-audio-lines` button opens a popover with a grid of sounds (icon and name), with a search box once there are many. Right-click a sound to preview it just for you.
- **Limits:** a cooldown of about 3 s per user, and a sound plays at most 10 s. A setting turns soundboard sounds off for you, with its own volume slider.
- **Admin tab "Soundboard"** (`i-lucide-audio-lines`), unlimited sounds:
  1. Choose an audio file (mp3, ogg, wav, m4a, anything the browser can decode; max 20 MB). It never leaves the browser.
  2. **Crop it:** a waveform with draggable start/end handles and a play button, using **`wavesurfer.js`** with its Regions plugin. The selection can't be longer than 10 s.
  3. Pick a **name** and an **icon** from a searchable list of Lucide icons (`USelectMenu` over the icon names in `@iconify-json/lucide`).
  4. Save. **Only the cropped part is uploaded.** The browser cuts the decoded audio (`AudioBuffer`) to the selection, mixes it to mono, and encodes it as **WAV** with about 20 lines of code (no library). 10 s of mono 48 kHz audio is about **1 MB**. The server's presigned upload only accepts `audio/wav` up to 1.5 MB.
  - To change the crop later, delete the sound and upload it again from the original file. The original isn't kept.
  - `shortcut: WAV is ~10× bigger than Opus/MP3, switch to WebCodecs AudioEncoder (Opus) if storage ever matters`. For 100 sounds that's about 100 MB in R2, far within the free 10 GB.

#### Library: `@vueuse/sound` vs `wavesurfer.js`
They do different jobs, so this isn't really a choice between them.

| | `@vueuse/sound` | `wavesurfer.js` |
|---|---|---|
| What it is | A `useSound()` composable around **Howler.js**, for playing short sounds | A waveform display with a player, plus plugins (Regions = draggable selection) |
| Shows a waveform / lets you select a part | No | **Yes** |
| Cuts or encodes audio | No | No (we do it with Web Audio) |
| Plays sounds | **Yes**, simple API with volume and sprites | Yes, but meant for one file in an editor |
| Extra size | Howler (~10 KB gzip) | ~30 KB gzip, only loaded on the admin tab |

- **Crop editor:** `wavesurfer.js`. `@vueuse/sound` has no way to show or select part of a sound.
- **Playing in voice:** neither is needed. Sounds are already cropped, so a few lines of Web Audio (`decodeAudioData` once, then a `AudioBufferSourceNode` per play, through a `GainNode` for volume) are enough. That's the same Web Audio setup as the speaking ring and the other sounds. `@vueuse/sound` would work too, but it adds Howler for something this small.
  - Edit (name, icon, trim) and delete, with a context menu on each sound.

---

## 9. Notifications

- **Toasts** (`useToast`) for everything inside the app: device changes, reconnecting, failed uploads, new DM while elsewhere, etc. One `useNotify()` composable decides between toast, system notification, or both.
- **System notifications for DMs, pings and replies to you:**
  - **Tab open but hidden, or another channel open:** the browser `Notification` API. Clicking it focuses the tab and jumps to the message.
  - **Tab closed:** **Web Push** (service worker, VAPID keys, `push_subscriptions`). On iOS this needs the PWA installed to the home screen.
- System notifications show the author, the channel and the **message text** (Markdown stripped, mentions shown as names, spoilers hidden).
- Permission is asked from a button, never on page load.
- No push when the app is open and focused on that channel. With several tabs open, only one notifies (`BroadcastChannel`).
- A channel counts as **read only when the window is focused**.
- **Mute per channel** and a **Do Not Disturb** mode. In-app notification sound, can be turned off.

---

## 10. Interaction

### Icons
- Lucide everywhere, on **every button and every menu item** (`icon="i-lucide-…"`).
- Icon-only buttons get a `UTooltip` with their shortcut (`UKbd`) and an `aria-label`.

| Action | Icon |
|---|---|
| Text channel / voice channel / DM | `hash` / `volume-2` / `message-circle` |
| Mic / muted | `mic` / `mic-off` |
| Deafen | `headphone-off` |
| Camera on / off | `video` / `video-off` |
| Screen share / stop | `screen-share` / `screen-share-off` |
| Leave voice | `phone-off` |
| Theater / fullscreen | `rectangle-horizontal` / `maximize` |
| Watch / stop watching | `eye` / `eye-off` |
| Reply / quote / edit / delete | `reply` / `quote` / `pencil` / `trash-2` |
| React / attach / GIF / search | `smile-plus` / `paperclip` / `image-play` / `search` |
| Copy / open link | `copy` / `external-link` |
| Settings / sign out | `settings` / `log-out` |

### Keyboard shortcuts
`defineShortcuts`, `UKbd`, `UCommandPalette`.

| Keys | Action |
|---|---|
| `Ctrl/⌘ K` | Quick switcher (channels, DMs, users) |
| `Alt ↑/↓` | Previous / next channel |
| `Alt Shift ↑/↓` | Previous / next unread channel |
| `↑` in an empty input | Edit your last message |
| `Esc` | Mark channel as read, cancel an edit, close search |
| `R` on a focused message | Reply |
| `Ctrl/⌘ F` / `Ctrl/⌘ Shift F` | Search this channel / everything |
| `Ctrl/⌘ Shift M` / `D` | Mute / deafen |
| `Ctrl/⌘ Shift E` / `S` | Camera / screen share |
| `T` / `F` / `W` on a tile | Theater / fullscreen / watch |
| `?` | Show all shortcuts |

Plus the shortcuts for the mic options (shown in the mic dropdown) and for formatting in the input (§6). Test every combination in Chrome and Firefox.

### Context menus
`UContextMenu` on everything clickable. Opens with right-click, long press on touch, the menu key or `Shift+F10`. The innermost element wins, with the parent's items in a submenu (e.g. link → "Message" submenu). **Text inputs and selected text keep the browser's own menu.**

| Target | Menu items |
|---|---|
| Channel | Mark read, mute notifications, copy link · admin: rename, delete, move up/down |
| DM | Mark read, mute, hide |
| User / avatar / mention chip | Profile, send DM, mention, copy name, mic volume, screen audio volume, mute for me · admin: change role, ban, move, disconnect from voice |
| Message | Reply, react, quote, edit / delete (yours, or any as admin), copy text, copy Markdown, copy link, mark as unread |
| Link | Open in new tab, copy link, copy link text |
| Preview card | Open link, copy link, copy title, remove preview (author or admin) |
| Image / GIF | Open, copy image, copy image link, save |
| Attachment | Open, download, copy link |
| Code block | Copy code, copy as Markdown, wrap/unwrap lines, change language |
| Inline code | Copy |
| Quote | Copy quote, reply quoting this |
| Spoiler | Reveal / hide |
| Reply preview | Jump to original, copy link to original |
| Reaction | See who reacted |
| Voice tile | Watch / stop watching, theater, fullscreen, mic volume, screen audio volume, mute for me, profile, send DM · admin: move, disconnect |
| Search result | Jump to message, copy link, copy text |
| Invite row | Revoke, copy note, view the user who signed up |

### Profile popover
Click an avatar or a name: avatar, nickname, role badge, online status, "Send DM". The email is shown to admins only.

### Presence
**Online / idle / offline** dots on avatars. No custom status, no read receipts.

---

## 11. GIF provider

**Klipy** (decided, account created). For reference: Tenor stopped accepting new API clients in Jan 2026, and Giphy's free key is limited to 100 calls per hour.

---

## 12. Settings page (`/settings`)

| Tab | Who | Contents |
|---|---|---|
| Profile (`i-lucide-user`) | Everyone | Nickname, avatar, change password |
| Voice & Video (`i-lucide-mic`) | Everyone | Mic, speakers, camera (with level meter, test sound, preview), noise suppression, echo cancellation, auto gain, sensitivity, screen share preset |
| Notifications (`i-lucide-bell`) | Everyone | Enable system notifications, DMs and pings on/off, Do Not Disturb, sounds |
| Shortcuts (`i-lucide-keyboard`) | Everyone | All shortcuts (same as `?`) |
| Soundboard (`i-lucide-audio-lines`) | Admin | Add sounds (upload, trim, name, icon), edit, delete |
| Invites (`i-lucide-mail-plus`) | Admin | Create invite (note, expiry), list with status (Active / Used / Expired / Revoked), revoke |
| Users (`i-lucide-users`) | Admin | Users, roles, **reset password** (creates a one-time link), ban, total R2 storage used |

Admins also manage channels (create, rename, delete, reorder text and voice channels) from the sidebar. Channels have only a name. Default channels on first start: `#general` (text) and `General` (voice).

---

## 13. Deployment (Coolify on OVH)

- **Dockerfile**, 2 stages on `node:22-slim`:
  1. **Build:** `pnpm install` (with build tools for `better-sqlite3`), `nuxt build`.
  2. **Runtime:** copies `.output`, installs `curl`, runs as a non-root user, `HEALTHCHECK CMD curl -fsS http://localhost:3000/api/health`.
- **`GET /api/health`:** runs `select 1` on SQLite. Returns `200 { ok: true }`, or 503.
- **Coolify's proxy (Traefik)** handles HTTPS and WebSockets. No Caddy.
- **Persistent volume** `/app/data` for the SQLite file.
- **LiveKit:** a separate Coolify service (Docker Compose, `network_mode: host`). The proxy sends `rtc.spk.meeehdi.dev` to port 7880. Embedded TURN on UDP 3478 only.
- **Ports** to open in the OVH firewall and `ufw`: TCP 443, TCP 7881, UDP 50000–60000, UDP 3478.
- **DNS:** `spk.meeehdi.dev` and `rtc.spk.meeehdi.dev` → VPS.
- **R2:** private bucket, CORS allowing PUT and GET from `spk.meeehdi.dev`.
- **Secrets** (Coolify env vars): `BETTER_AUTH_SECRET`, R2 keys, LiveKit key and secret, VAPID keys, `KLIPY_API_KEY`.
- **Backups (you, in Coolify):** yes, only the **SQLite database** needs backing up. Files are already in R2, and everything else is rebuilt from the repo. Don't copy the `.db` file while the app runs (WAL mode can give a broken copy): make a consistent snapshot with `sqlite3 /app/data/spk.db "VACUUM INTO '/app/data/backup.db'"` (the runtime image includes the `sqlite3` CLI for this), then back up that file.
- **Monitoring:** `docker logs` only.
- No CD pipeline: Coolify builds from the repo.

### Local development
- `pnpm dev` + `livekit-server --dev`.
- `localhost` allows mic and camera without HTTPS.

### Supported browsers
Latest Chrome, Firefox and Safari.

---

## 14. Build order

1. Nuxt + Nuxt UI layout (sidebar, main panel) with fake data. Lucide, theme, responsive drawer.
2. SQLite + Drizzle, better-auth (email + password, admin plugin), invites, bootstrap admin link, first sign-in modal, Settings (Profile, Invites), Dockerfile and `/api/health`.
3. Text channels: history, WebSocket messages, Markdown + Shiki, code blocks (line numbers, detection, language picker, copy), long message collapse, links, mentions, typing indicator, drafts, context menus.
4. DMs (sorted by `last_activity_at`), unread counts, mention badges, "new messages" divider, mark as unread, hide DMs.
5. Edit and delete, replies and quotes, reactions and shortcodes, attachments (R2, upload queue, lightbox, players).
6. Link previews (with SSRF protection), GIF menu (Klipy).
7. Search (FTS5) with filters.
8. Notifications: toasts, browser notifications, Web Push, PWA, mute per channel, DND, sounds.
9. Shortcuts layer, command palette, `?` overlay.
10. Voice with LiveKit: token, audio, voice bar with dropdowns, devices, noise suppression, speaking ring, `voice:state`, presence cleanup.
11. Webcam and screen share: tiles, opt-in watching, presets, theater, fullscreen, volume sliders.
12. Soundboard: admin tab with trimming, playback in voice.
13. Admin: Users tab, move and disconnect, channel management and channel ordering, storage total.
14. Deploy on Coolify: LiveKit service, firewall, R2 CORS, database backup.

Context menu items and shortcuts are added with each feature as it's built.

**Tests (Vitest, unit only):** invites, SSRF checks, mention parsing (editor ↔ `<@id>`), search filter parsing, permissions.

---

## 15. Left out

Group DMs, pinned messages, edit history, custom emoji, emoji recents and skin tones, GIF favorites, channel topics, custom status, read receipts, push-to-talk, text chat inside voice channels, auto-disconnect from voice, audit log, uptime monitoring, CD pipeline, embeds (YouTube etc.), warning for external links, CLI tools, threads, translations, a desktop app.

---

## 16. Risks

- **UDP blocked** on a friend's network: the call goes through TURN over TCP, with more lag, noticeable during screen shares.
- **SSRF checks** on link previews must not be skipped.
- **Password reset needs an admin, and there's no CLI.** If the only admin forgets their password, nobody can reset it. Make a second account admin.
- The **collapse thresholds** (25 lines, 1,000 lines) are guesses, to adjust with real code.
- TipTap's Markdown extension is marked "early release" in its docs. The 2 custom extensions are small, but expect some edge cases around `<@id>` and `||spoiler||` next to other formatting.
