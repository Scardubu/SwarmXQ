# TikTok Content API Setup

**Scope:** SwarmXQ VIDEO-ALPHA r1 · TikTok publisher adapter

---

## Overview

SwarmXQ's TikTok publisher adapter (`apps/swarmx-api/src/services/publishers/tiktok.ts`) defaults to
a **studio-export handoff** mode that requires no API credentials. It generates a TikTok Studio upload
URL and records the publish attempt with `status: "pending_review"`.

To enable fully automated video uploads via the TikTok Content API, you need:

1. A TikTok developer account with an approved application
2. A Business or Creator account with Content API access
3. A valid access token with the `video.upload` scope

Without these, all TikTok publish requests safely fall back to generic local export.

---

## Prerequisites

| Requirement | Where to obtain |
|-------------|----------------|
| TikTok developer account | https://developers.tiktok.com/  |
| Application with `video.upload` scope approved | TikTok for Developers Portal → App Management |
| Content Publishing API enabled | TikTok Business Center → API Keys |
| OAuth 2.0 access token (PKCE or server-side) | Complete the authorization flow below |

> **Note:** The Content Publishing API requires partner approval. Standard developer accounts cannot
> programmatically post videos — they can only initiate a creator-side upload workflow.

---

## OAuth 2.0 Authorization Flow (Server-Side)

### 1. Register your application

Go to [https://developers.tiktok.com/](https://developers.tiktok.com/) and create an application.
Under **Scopes**, request:
- `video.upload`
- `video.publish` (optional — required for one-step posting)

### 2. Authorization URL

Redirect your user to:

```
https://www.tiktok.com/v2/auth/authorize/
  ?client_key=YOUR_CLIENT_KEY
  &response_type=code
  &scope=video.upload
  &redirect_uri=YOUR_REDIRECT_URI
  &state=RANDOM_STATE
```

### 3. Exchange code for access token

```bash
curl -X POST https://open.tiktokapis.com/v2/oauth/token/ \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_key=YOUR_CLIENT_KEY" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=AUTHORIZATION_CODE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=YOUR_REDIRECT_URI"
```

The response includes:
```json
{
  "access_token": "act.example...",
  "expires_in": 86400,
  "open_id": "user_open_id",
  "scope": "video.upload",
  "token_type": "Bearer"
}
```

### 4. Refresh tokens

TikTok access tokens expire in 24 hours. Use the refresh flow:

```bash
curl -X POST https://open.tiktokapis.com/v2/oauth/token/ \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_key=YOUR_CLIENT_KEY" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=YOUR_REFRESH_TOKEN"
```

---

## Environment Variables

Add these to your `.env` or `apps/swarmx-api/.env.local`:

```bash
# ── TikTok Content API ───────────────────────────────────────────────────────
# Both variables must be set AND SWARMX_TIKTOK_API_APPROVED=1 for real uploads.
# Without these, all TikTok publishes use studio-export handoff (safe default).
SWARMX_TIKTOK_ACCESS_TOKEN=act.your_access_token_here
SWARMX_TIKTOK_CLIENT_KEY=your_client_key
SWARMX_TIKTOK_CLIENT_SECRET=your_client_secret
SWARMX_TIKTOK_API_APPROVED=1
```

> **Security:** Never commit `SWARMX_TIKTOK_ACCESS_TOKEN` to version control.
> Use a secrets manager or `.env.local` (which is in `.gitignore`).

---

## Upload Flow (when enabled)

When `SWARMX_TIKTOK_ACCESS_TOKEN` is set and `SWARMX_TIKTOK_API_APPROVED=1`,
the adapter calls the Content API:

```
1. POST /v2/video/upload/
   → Returns { video_id }

2. POST /v2/post/publish/video/init/
   Body: { post_info: { title, privacy_level }, source_info: { video_id } }
   → Returns { publish_id }

3. Poll GET /v2/post/publish/status/fetch/
   → { status: "processing" | "publish_complete" | "failed" }
```

For scheduled posts, the adapter sets `post_info.scheduled_time` (Unix epoch) in step 2.

---

## Compliance Notes

1. **Content Policy:** All uploaded videos must comply with TikTok's Community Guidelines.
   SwarmXQ's Auditor operator (`critique-deepseekr1-pro-q5km-prod`) performs a brand-safety
   review before publishing but this is not a substitute for TikTok's own moderation.

2. **Rate limits:** TikTok imposes per-user and per-app upload quotas. Check your app's
   quota in the TikTok for Developers portal under **Quota Management**.

3. **Sound suggestion field:** SwarmXQ's `CaptionDraft.soundSuggestion` describes audio
   *character* only (tempo, energy, instruments). It never contains a song title, artist name,
   or URL to avoid copyright compliance issues. Manually match the description to a sound in
   TikTok's Sound Browser.

---

## Instagram Reels

The Instagram publisher (`apps/swarmx-api/src/services/publishers/instagram.ts`) follows
the Instagram Graph API Reels publishing flow:

```bash
# Required environment variables
SWARMX_INSTAGRAM_ACCESS_TOKEN=your_page_access_token
SWARMX_INSTAGRAM_USER_ID=your_ig_user_id
```

Get these from the [Meta for Developers](https://developers.facebook.com/) portal.
Your access token must have `instagram_content_publish` permission.

---

## Troubleshooting

### Publish returns `pending_review` even after configuring tokens

Verify both `SWARMX_TIKTOK_ACCESS_TOKEN` **and** `SWARMX_TIKTOK_API_APPROVED=1` are set.
Both are required. The guard requires explicit opt-in.

### Upload fails with `401 Unauthorized`

The access token has expired. Refresh it using the refresh flow above and update
`SWARMX_TIKTOK_ACCESS_TOKEN` in your environment.

### `video.upload` scope not approved

New TikTok applications require manual approval for content publishing scopes.
Submit an approval request in the TikTok for Developers portal under your application's
**Scope Management** page. Approval typically takes 3–10 business days.
