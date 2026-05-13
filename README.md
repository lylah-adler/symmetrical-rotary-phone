# heygen-railway

A small Node.js service that proxies the [HeyGen](https://www.heygen.com) API behind a single shared-secret token. Deploy it to Railway, give the URL + token to your chat agent (or any HTTP client), and it can drive HeyGen on your behalf.

It's intentionally thin: structured endpoints for the common operations (`/video`, `/avatars`, `/voices`, `/photo-avatar`) plus a raw passthrough (`/heygen/*`) for anything not wrapped.

## What you need

- A [HeyGen](https://app.heygen.com/api) account with API access and credits.
- A [Railway](https://railway.app) account.
- A GitHub account (Railway deploys from a GitHub repo).

## 1. Push this repo to GitHub

From the unzipped folder:

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create heygen-railway --public --source=. --push
# or, without the GitHub CLI:
# git remote add origin git@github.com:<you>/heygen-railway.git
# git branch -M main
# git push -u origin main
```

## 2. Deploy on Railway

1. Go to <https://railway.app/new> → **Deploy from GitHub repo** → pick your `heygen-railway` repo.
2. Railway detects it as a Node.js project and runs `npm install` + `npm start`.
3. Open **Variables** and add:
   - `HEYGEN_API_KEY` — your key from <https://app.heygen.com/api>. Starts with `sk_V2_...`.
   - `CONTROL_TOKEN` — any long random string. This is the bearer token callers must send. Pick something like `openssl rand -hex 32`.
4. Open **Settings → Networking → Generate Domain** to get a public URL like `https://heygen-railway-production.up.railway.app`.
5. Hit `/healthz` to confirm it's up:
   ```bash
   curl https://<your-domain>.up.railway.app/healthz
   # → {"ok":true,"service":"heygen-railway",...}
   ```

That's it. Cost on Railway's free hobby plan is roughly $0 if it sits idle.

## 3. Call it

Every authenticated endpoint requires `Authorization: Bearer <CONTROL_TOKEN>`.

### List avatars

```bash
curl -H "Authorization: Bearer $CONTROL_TOKEN" \
  https://<your-domain>.up.railway.app/avatars
```

### List voices

```bash
curl -H "Authorization: Bearer $CONTROL_TOKEN" \
  https://<your-domain>.up.railway.app/voices
```

### Generate a video

```bash
curl -X POST \
  -H "Authorization: Bearer $CONTROL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "avatar_id": "Daisy-inskirt-20220818",
    "voice_id":  "2d5b0e6cf36f460aa7fc47e3eee4ba54",
    "text":      "HeyGen install working, ready to ship.",
    "aspect_ratio": "16:9"
  }' \
  https://<your-domain>.up.railway.app/video
```

Response includes a `video_id`. Poll status:

```bash
curl -H "Authorization: Bearer $CONTROL_TOKEN" \
  https://<your-domain>.up.railway.app/video/<video_id>
```

When `status` is `completed`, the response contains a `video_url` you can download.

### Generate a photo avatar (Avatar IV, text-to-avatar)

```bash
curl -X POST \
  -H "Authorization: Bearer $CONTROL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Eve",
    "prompt": "A friendly woman with shoulder-length brown hair, soft smile, navy blue blazer, professional studio lighting, neutral background",
    "age": "Adult",
    "gender": "Woman",
    "orientation": "horizontal",
    "pose": "half_body",
    "style": "Realistic"
  }' \
  https://<your-domain>.up.railway.app/photo-avatar
```

Poll with `GET /photo-avatar/<generation_id>`.

### Raw passthrough

Anything not wrapped above — hit `/heygen/<path>` and it forwards to `https://api.heygen.com/<path>` with your API key:

```bash
curl -H "Authorization: Bearer $CONTROL_TOKEN" \
  https://<your-domain>.up.railway.app/heygen/v2/templates
```

## 4. Wire it to this chat

Once Railway gives you a domain, paste it into chat along with the `CONTROL_TOKEN` you set. I can then call your service directly via web requests and trigger HeyGen on your behalf — generating videos, listing avatars, polling status.

You stay in control: revoke the `CONTROL_TOKEN` (rotate the Railway env var) and any leaked access dies instantly.

## Local development

```bash
cp .env.example .env
# edit .env, fill in HEYGEN_API_KEY and CONTROL_TOKEN
npm install
npm start
curl -H "Authorization: Bearer $CONTROL_TOKEN" http://localhost:3000/healthz
```

## Security notes

- `HEYGEN_API_KEY` and `CONTROL_TOKEN` are read from environment variables only. Nothing is committed in this repo.
- Anyone with your `CONTROL_TOKEN` can spend your HeyGen credits. Treat it like a password.
- If you ever leak the token (e.g., paste it in a public place), rotate it in Railway → Variables. Old clients will start 401-ing immediately.
- The `/heygen/*` passthrough lets a caller hit any HeyGen endpoint. If you don't want that, delete the `app.all("/heygen/*", ...)` block in `index.js`.

## License

MIT
