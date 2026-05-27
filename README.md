# ✦ PromptCraft v2

> **AI-powered UI/UX design prompt generator** — Generate professional design prompts with hex codes, fonts, spacing systems and micro-animation details. Built with Node.js + Express + SQLite + Groq (free LLM API).

![PromptCraft Screenshot](https://placehold.co/1200x600/07080f/c4b5fd?text=PromptCraft+v2&font=syne)

---

## Features

- 🔐 **Auth** — Register / login with JWT (30-day sessions)
- ✦ **AI Prompt Generation** — Powered by LLaMA 3.3 70B via Groq (free tier)
- 🎨 **6 Style Aesthetics** — Luxury, Playful, Dark, Minimal, Retro, Nature
- 📐 **3 Complexity Levels** — Simple, Detailed, Expert (with full design token systems)
- 📜 **Prompt History** — Save, load back into editor, delete
- 📋 **One-click Copy** — Copy any prompt to clipboard
- 💾 **TXT Export** — Pro feature, exports prompt as `.txt` file
- 📊 **Usage Tracking** — Daily limit counter with auto-reset
- 💳 **Stripe Checkout** — Optional paid plan upgrade flow
- 🌐 **Lead Capture** — Email capture endpoint for marketing

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js 20+, Express 4 |
| Database | SQLite via `better-sqlite3` |
| Auth | `bcryptjs` + `jsonwebtoken` |
| AI | [Groq API](https://console.groq.com) — free, no credit card |
| Frontend | Vanilla HTML/CSS/JS (single file) |

---

## Quick Start

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/promptcraft.git
cd promptcraft
```

### 2. Install dependencies
```bash
npm install
```

### 3. Create your `.env` file
```bash
cp .env.example .env
```
Then open `.env` and fill in your values:

```env
PORT=3000
JWT_SECRET=some_long_random_string_here
GROQ_API_KEY=gsk_...          # Get free at https://console.groq.com
FREE_DAILY_LIMIT=10
```

> **Get a free Groq API key** → https://console.groq.com  
> No credit card needed. The free tier is generous enough for personal/hobby use.

### 4. Run the server
```bash
# Development (auto-restarts on file change)
npm run dev

# Production
npm start
```

### 5. Open the app
```
http://localhost:3000
```

---

## Project Structure

```
promptcraft/
├── server.js          # Express API — all routes
├── db.js              # SQLite setup & schema
├── promptcraft.html   # Full frontend (single-file SPA)
├── package.json
├── .env.example       # Copy to .env and fill in your values
├── .gitignore
└── README.md
```

The SQLite database (`promptcraft.db`) is created automatically on first run.

---

## API Reference

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/health` | — | Health check |
| `POST` | `/api/register` | — | Create account |
| `POST` | `/api/login` | — | Login, returns JWT |
| `GET` | `/api/me` | ✓ | Current user + usage stats + recent history |
| `POST` | `/api/generate` | ✓ | Generate a prompt (uses daily limit) |
| `GET` | `/api/history` | ✓ | Last 50 prompts |
| `DELETE` | `/api/history/:id` | ✓ | Delete a history item |
| `POST` | `/api/checkout` | ✓ | Get Stripe checkout URL |
| `POST` | `/api/leads` | — | Email lead capture |

All authenticated routes require `Authorization: Bearer <token>` header.

---

## Deployment

### Railway (recommended — free tier available)
1. Push your repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add your environment variables in the Railway dashboard
4. Deploy ✓

### Render
1. New Web Service → connect your GitHub repo
2. Build command: `npm install`
3. Start command: `npm start`
4. Add env vars in the dashboard

### VPS / DigitalOcean
```bash
git clone your-repo && cd promptcraft
npm install
cp .env.example .env && nano .env   # fill in your values
npm start
# Or use pm2: pm2 start server.js --name promptcraft
```

> **Note on the database:** SQLite stores data in `promptcraft.db` on disk. For ephemeral deployments (Render free tier, Railway ephemeral volumes) the DB resets on redeploy. Use a persistent volume or swap to a hosted Postgres/MySQL if you need durability.

---

## Optional: Stripe Payments

1. Create payment links in your [Stripe dashboard](https://dashboard.stripe.com/payment-links)
2. Add the URLs to `.env`:
   ```env
   STRIPE_MONTHLY_LINK=https://buy.stripe.com/...
   STRIPE_YEARLY_LINK=https://buy.stripe.com/...
   STRIPE_BUSINESS_LINK=https://buy.stripe.com/...
   ```
3. Use a Stripe webhook to update `users.plan` in the DB after payment (not included — left as an exercise)

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: `3000`) |
| `JWT_SECRET` | **Yes** | Long random string for signing tokens |
| `GROQ_API_KEY` | **Yes** | Your Groq API key |
| `FREE_DAILY_LIMIT` | No | Prompts per day for free users (default: `10`) |
| `STRIPE_MONTHLY_LINK` | No | Stripe payment link for monthly plan |
| `STRIPE_YEARLY_LINK` | No | Stripe payment link for yearly plan |
| `STRIPE_BUSINESS_LINK` | No | Stripe payment link for business plan |

---

## Security Notes

- **Never commit `.env`** — it's in `.gitignore`, keep it there
- **Never commit `promptcraft.db`** — it contains user passwords (hashed) and email addresses
- Change `JWT_SECRET` to a long random string before deploying publicly
- Passwords are hashed with `bcryptjs` (cost factor 10)

---

## License

MIT — do whatever you want with it.

---

## Contributing

PRs welcome! Open an issue first for major changes.
