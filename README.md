# goose_snake

Goose-themed snake game, served at **https://goosebase.org/games/gooooose** via the [congress_trader](https://github.com/gmcanales/congress_trader) app.

## How it's served

This repo is a **sibling** to `congress_trader/` on the NUC:

```
~/
├── congress_trader/
└── goose_snake/          ← this repo
```

`congress_trader/docker-compose.yml` bind-mounts this directory read-only into the nginx container:

```yaml
volumes:
  - ../goose_snake:/usr/share/nginx/html/games/gooooose:ro
```

`frontend/nginx.conf` routes the subpath:

```nginx
location = /games/gooooose {
    return 301 /games/gooooose/;
}
location = /games/gooooose/ {
    add_header Cache-Control "no-cache";
    try_files /games/gooooose/index.html =404;
}
```

nginx's existing `/games/` catch-all serves all nested assets (JS, CSS, sprites, etc.).

## Deploying changes

Updates to this repo go live with just a `git pull` on the NUC — **no docker rebuild needed**. nginx reads files directly from the bind-mount on each request.

```bash
# On the NUC, inside ~/goose_snake/
git pull
```

## First-time NUC setup (one-time)

```bash
cd ~
git clone git@github.com:gmcanales/goose_snake.git
# then rebuild congress_trader to pick up the new volume mount:
cd ~/congress_trader && ./scripts/deploy.sh
```

## Asset paths

Assets inside `index.html` work two ways:

- **Relative** — `<script src="./game.js">` — works because of the trailing-slash redirect.
- **Absolute subpath** — `<script src="/games/gooooose/game.js">` — safer if anything uses `fetch()` or `window.location`.

## Configuration & tuning

All gameplay knobs are tunable without touching JS. The flow:

1. Open the game and hit **`` ` ``** (backtick) or the **DEV** button for the dev console.
2. Edit values live in the **Live Config (JSON)** editor (changes apply immediately — speed/weights next tick, level-up params on the next level), or use the quick actions.
3. When happy, click **Download JSON** — it saves as `config.json`.
4. Drop that file into the repo root, replacing the existing `config.json`, and commit.

### How config loads

`config.js` builds the effective config from three layers, lowest priority first:

```
DEFAULT_CONFIG  (baked into config.js — complete fallback, guarantees every key exists)
   ⊕ config.json (committed tuning — the source of truth; what Download JSON emits)
   ⊕ localStorage (your live dev-console experiments, via Save — highest priority)
```

Because the layers deep-merge, a partial or older `config.json` still inherits any newer keys from `DEFAULT_CONFIG` (so adding a new knob never breaks an old saved config). "Reset Defaults" in the console resets to the committed `config.json` tuning, not the raw fallbacks.

> **Note:** `config.json` is loaded with `fetch('./config.json')`, so it only applies when the game is **served over HTTP** (nginx in prod, or any local dev server — e.g. `py -m http.server`). Opening `index.html` directly via `file://` falls back to the baked `DEFAULT_CONFIG`. The relative path resolves to `/games/gooooose/config.json` thanks to the trailing-slash redirect; live tuning via the dev console + Save works regardless.

## Cloudflare Access

`/games/*` is currently gated by the Cloudflare Access email-OTP policy on `goosebase.org`.
To make this game publicly playable (like `/spacex/*`), add a **Bypass** policy on `/games/gooooose/*`
in the Zero Trust dashboard → Access → Applications.
