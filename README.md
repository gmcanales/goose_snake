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

## Cloudflare Access

`/games/*` is currently gated by the Cloudflare Access email-OTP policy on `goosebase.org`.
To make this game publicly playable (like `/spacex/*`), add a **Bypass** policy on `/games/gooooose/*`
in the Zero Trust dashboard → Access → Applications.
