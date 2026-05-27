import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';

const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT || 10);
const PRO_DAILY_LIMIT = 999999;

const STRIPE = {
  monthly:  process.env.STRIPE_MONTHLY_LINK  || '',
  yearly:   process.env.STRIPE_YEARLY_LINK   || '',
  business: process.env.STRIPE_BUSINESS_LINK || ''
};

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));
// Serve promptcraft.html from project root at /
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'promptcraft.html');
  res.sendFile(htmlPath, err => {
    if (err) res.status(404).send('promptcraft.html not found — place it in the project folder or public/');
  });
});

// ─── HELPERS ───────────────────────────────────────────────────────────────
const clean = v => String(v || '').trim().slice(0, 300);

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, message: 'Not logged in' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ ok: false, message: 'Session expired — please log in again' });
  }
}

function resetDailyIfNeeded(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const today = new Date().toISOString().slice(0, 10);
  if (user.last_reset !== today) {
    db.prepare('UPDATE users SET prompts_today = 0, last_reset = ? WHERE id = ?').run(today, userId);
    return { ...user, prompts_today: 0, last_reset: today };
  }
  return user;
}

// ─── HEALTH ────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'PromptCraft v2', time: new Date().toISOString() });
});

// ─── AUTH: REGISTER ────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const username = clean(req.body.username);
  const email    = clean(req.body.email).toLowerCase();
  const password = clean(req.body.password);

  if (!username || !email || !password) {
    return res.status(400).json({ ok: false, message: 'Username, email and password are required' });
  }
  if (username.length < 3) {
    return res.status(400).json({ ok: false, message: 'Username must be at least 3 characters' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, message: 'Invalid email address' });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, message: 'Password must be at least 6 characters' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)');
    const result = stmt.run(username, email, hash);

    const token = jwt.sign(
      { id: result.lastInsertRowid, username, plan: 'free' },
      JWT_SECRET, { expiresIn: '30d' }
    );

    res.status(201).json({
      ok: true,
      message: 'Account created!',
      token,
      user: { id: result.lastInsertRowid, username, email, plan: 'free' }
    });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ ok: false, message: 'Username or email already taken' });
    }
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// ─── AUTH: LOGIN ───────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const identifier = clean(req.body.username).toLowerCase(); // accepts username or email
  const password   = clean(req.body.password);

  if (!identifier || !password) {
    return res.status(400).json({ ok: false, message: 'Username and password required' });
  }

  const user = db.prepare(
    'SELECT * FROM users WHERE username = ? OR email = ?'
  ).get(identifier, identifier);

  if (!user) {
    return res.status(401).json({ ok: false, message: 'Invalid username or password' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ ok: false, message: 'Invalid username or password' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, plan: user.plan },
    JWT_SECRET, { expiresIn: '30d' }
  );

  res.json({
    ok: true,
    token,
    user: { id: user.id, username: user.username, email: user.email, plan: user.plan }
  });
});

// ─── AUTH: ME (get current user info) ─────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
  const user = resetDailyIfNeeded(req.user.id);
  if (!user) return res.status(404).json({ ok: false, message: 'User not found' });

  const limit = user.plan === 'pro' || user.plan === 'business' ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
  const history = db.prepare(
    'SELECT id, tags, complexity, mood, description, result, created_at FROM prompts WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(user.id);

  res.json({
    ok: true,
    user: { id: user.id, username: user.username, email: user.email, plan: user.plan },
    usage: { used: user.prompts_today, limit, remaining: Math.max(limit - user.prompts_today, 0) },
    history
  });
});

// ─── AI GENERATE (protected, via Groq — FREE) ─────────────────────────────
app.post('/api/generate', requireAuth, async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(501).json({ ok: false, message: 'GROQ_API_KEY not set in .env — get a free key at console.groq.com' });
  }

  // Reset daily counter if needed
  const user = resetDailyIfNeeded(req.user.id);
  const limit = user.plan === 'pro' || user.plan === 'business' ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;

  if (user.prompts_today >= limit) {
    return res.status(402).json({
      ok: false,
      message: user.plan === 'free'
        ? `Daily free limit of ${FREE_DAILY_LIMIT} reached. Upgrade to Pro for unlimited prompts!`
        : 'Daily limit reached.'
    });
  }

  const tags        = (req.body.tags || []).map(clean).slice(0, 6);
  const complexity  = clean(req.body.complexity) || 'detailed';
  const mood        = clean(req.body.mood) || 'light';
  const description = clean(req.body.description);

  if (tags.length === 0) {
    return res.status(400).json({ ok: false, message: 'Select at least one style tag' });
  }

  const complexityDesc = {
    simple:  'concise and easy to use (2-3 sentences)',
    detailed:'detailed and professional (1 solid paragraph)',
    expert:  'expert-level with design tokens, typography scales, hex codes, spacing systems, and technical CSS specifics (2 rich paragraphs)'
  }[complexity] || 'detailed';

  const moodDesc = {
    light:   'light and bright',
    dark:    'dark mode',
    vibrant: 'maximally vibrant and saturated'
  }[mood] || 'light';

  const systemPrompt = `You are an elite UI/UX design prompt writer with 15 years of experience. 
You write vivid, specific, immediately usable design briefs that designers love. 
Your prompts include exact hex codes, font names, spacing values, animation curves, and micro-interaction details.
NEVER add preamble, explanation, or quotes — output ONLY the design prompt text.`;

  const userPrompt = `Generate a single ${complexityDesc} AI design prompt for a UI/UX designer.
Style aesthetic: ${tags.join(' + ')}
Color mode: ${moodDesc}
${description ? `Project context: ${description}` : ''}

Requirements:
- Specific hex color codes (e.g. #1A0A3E), named fonts, pixel spacing, easing curves
- Hover states, focus rings, micro-animations with timing (e.g. 180ms ease-out)
- Typography scale, border radius system, shadow layers
- Works as a Midjourney prompt, DALL-E prompt, Figma brief, or dev handoff note
${complexity === 'expert' ? `- Full design token system: spacing scale (4/8/12/16/24/32/48/64px), modular type scale at 1.333 ratio, semantic color tokens (brand/surface/text/border), CSS custom properties, WCAG 2.1 AA compliance notes` : ''}

Output ONLY the prompt. No intro. No explanation.`;

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 800,
        temperature: 0.88,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   }
        ]
      })
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({ ok: false, message: 'AI service error: ' + errText });
    }

    const data = await upstream.json();
    const promptText = data.choices?.[0]?.message?.content?.trim() || '';

    if (!promptText) {
      return res.status(500).json({ ok: false, message: 'AI returned empty response' });
    }

    // Save to history + increment usage counter
    db.prepare(
      'INSERT INTO prompts (user_id, tags, complexity, mood, description, result) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.id, tags.join(','), complexity, mood, description, promptText);

    db.prepare('UPDATE users SET prompts_today = prompts_today + 1 WHERE id = ?').run(user.id);

    const newCount = user.prompts_today + 1;
    res.json({
      ok: true,
      prompt: promptText,
      usage: { used: newCount, limit, remaining: Math.max(limit - newCount, 0) }
    });

  } catch (err) {
    res.status(500).json({ ok: false, message: 'Server error: ' + err.message });
  }
});

// ─── PROMPT HISTORY ────────────────────────────────────────────────────────
app.get('/api/history', requireAuth, (req, res) => {
  const history = db.prepare(
    'SELECT id, tags, complexity, mood, description, result, created_at FROM prompts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.user.id);
  res.json({ ok: true, history });
});

// ─── DELETE HISTORY ITEM ───────────────────────────────────────────────────
app.delete('/api/history/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM prompts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ─── CHECKOUT ──────────────────────────────────────────────────────────────
app.post('/api/checkout', requireAuth, (req, res) => {
  const plan = clean(req.body.plan || 'monthly').toLowerCase();
  const url  = STRIPE[plan];
  if (!url) {
    return res.status(501).json({ ok: false, message: `Stripe link for "${plan}" not set in .env` });
  }
  res.json({ ok: true, checkoutUrl: url });
});

// ─── LEAD CAPTURE (no auth needed) ────────────────────────────────────────
app.post('/api/leads', (req, res) => {
  const email  = clean(req.body.email).toLowerCase();
  const plan   = clean(req.body.plan   || 'free_pack');
  const source = clean(req.body.source || 'website');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, message: 'Invalid email address' });
  }

  db.prepare('INSERT INTO leads (email, plan, source) VALUES (?, ?, ?)').run(email, plan, source);
  res.status(201).json({ ok: true, message: 'Thanks! Check your inbox.' });
});

// ─── 404 ───────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ ok: false, message: 'Not found' });
});

// ─── START ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✦ PromptCraft v2 running → http://localhost:${PORT}\n`);
});
