# Deploying the Pascal Press Marketing Planner

Follow these steps in order. Takes about 10–15 minutes end to end.

---

## Prerequisites

- Node.js 18+ installed → https://nodejs.org
- Git installed → https://git-scm.com
- A GitHub account → https://github.com
- A Vercel account (free) → https://vercel.com — sign in with GitHub

---

## Step 1 — Install dependencies locally (optional sanity check)

Open a terminal in the `pascal-press-planner` folder and run:

```bash
npm install
npm run build
```

If you see "✓ Compiled successfully" the code is ready.

---

## Step 2 — Push to GitHub

1. Go to https://github.com/new and create a new **private** repository called `pascal-press-planner`. Leave it empty (no README).

2. In your terminal, inside the `pascal-press-planner` folder:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/pascal-press-planner.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

---

## Step 3 — Create a Vercel project

1. Go to https://vercel.com/dashboard and click **Add New → Project**.
2. Select **Import Git Repository** and choose `pascal-press-planner`.
3. Leave the framework preset as **Next.js** (auto-detected).
4. **Do not deploy yet** — click **Environment Variables** first.

---

## Step 4 — Add environment variables in Vercel

In the **Environment Variables** section, add these three variables:

| Name | Value |
|---|---|
| `MONDAY_API_TOKEN` | Your Monday.com API token (see note below) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `MONDAY_BOARD_ID` | Leave blank for now — you'll fill this in after Step 6 |

**Where to find your Monday.com API token:**
Profile picture (top right in Monday.com) → **Developers** → **API** → copy the Personal API Token.

**Where to find your Anthropic API key:**
https://console.anthropic.com → **API Keys** → **Create Key**.

---

## Step 5 — Deploy

Click **Deploy**. Vercel will build and deploy the app (takes ~2 minutes).

When finished, Vercel gives you a live URL like:
`https://pascal-press-planner-xxxx.vercel.app`

---

## Step 6 — Create the Monday.com board

Once deployed, open a new browser tab and visit:

```
POST https://your-vercel-url.vercel.app/api/setup-board
```

The easiest way is to use this curl command (or any API tool like Postman / Insomnia / Hoppscotch):

```bash
curl -X POST https://your-vercel-url.vercel.app/api/setup-board
```

Or use the browser — open this URL in your browser, but since GET is also handled it will tell you the board status. To trigger the creation, run the POST via curl or Postman.

The response will look like:

```json
{
  "success": true,
  "boardId": "1234567890",
  "message": "Board is ready. Add MONDAY_BOARD_ID=1234567890 to your Vercel env vars..."
}
```

---

## Step 7 — Add the board ID to Vercel

1. Copy the `boardId` number from the response above.
2. In Vercel: **Project Settings → Environment Variables**.
3. Add / update `MONDAY_BOARD_ID` = the board ID you just copied.
4. Click **Save**.

---

## Step 8 — Redeploy

In Vercel, go to **Deployments** and click **Redeploy** on the latest deployment (or push any small change to GitHub to trigger a new build). This picks up the new `MONDAY_BOARD_ID`.

---

## Step 9 — Seed the campaign data

Once you receive the campaign data, send it as a POST request to:

```
POST https://your-vercel-url.vercel.app/api/seed
```

with body:

```json
{
  "campaigns": [ ... campaign data here ... ]
}
```

Your Claude assistant will give you the exact JSON to post once you share the campaign data.

---

## Step 10 — Verify the live app

Visit your Vercel URL. You should see:
- The Pascal Press marketing planner loading campaigns from Monday.com
- Calendar view showing months Jul–Jun
- FY25 / FY26 / FY27 / All switcher
- Claude AI chat panel (click the ✦ Claude AI button top right)

The board also appears in your Monday.com account as **"Pascal Press Marketing Planner"**.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "MONDAY_API_TOKEN is not set" | Check the env var is saved in Vercel and redeployed |
| "Board not found" | Run `POST /api/setup-board` again |
| "Cannot read column X" | Run `POST /api/setup-board` again — it adds any missing columns |
| Claude chat says API key not set | Check `ANTHROPIC_API_KEY` in Vercel env vars |
| Campaigns not loading | Check Monday.com board name is exactly "Pascal Press Marketing Planner" |

---

## Updating the app later

Push changes to GitHub → Vercel auto-redeploys. No manual steps needed.

---

*Built with Next.js 14 · Monday.com API · Anthropic Claude*
