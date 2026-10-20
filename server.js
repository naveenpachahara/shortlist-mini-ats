require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const { MONGODB_URI, JWT_SECRET, PORT = 3000 } = process.env;
if (!MONGODB_URI || !JWT_SECRET) throw new Error('Set MONGODB_URI and JWT_SECRET in .env');

const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];

const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
}));

const Candidate = mongoose.model('Candidate', new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, trim: true },
  role: { type: String, required: true, trim: true },
  skills: [String],
  experience: { type: Number, default: 0, min: 0 },
  notes: String,
  stage: { type: String, enum: STAGES, default: 'Applied' },
}, { timestamps: true }));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sign = u => jwt.sign({ id: u._id, name: u.name }, JWT_SECRET, { expiresIn: '7d' });
const pick = b => ({
  name: b.name, email: b.email, phone: b.phone, role: b.role, notes: b.notes,
  experience: Number(b.experience) || 0,
  skills: (Array.isArray(b.skills) ? b.skills : String(b.skills || '').split(',')).map(s => s.trim()).filter(Boolean),
});

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Please sign in again.' }); }
}

// ---- Auth ----
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ error: 'Name, email and a password of 6+ characters are required.' });
  if (await User.findOne({ email })) return res.status(409).json({ error: 'That email is already registered.' });
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 10) });
  res.status(201).json({ token: sign(user), name: user.name });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const user = await User.findOne({ email: String(req.body.email || '').toLowerCase() });
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password)))
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ token: sign(user), name: user.name });
}));

// ---- Candidates (all scoped to the signed-in user) ----
app.get('/api/candidates', auth, wrap(async (req, res) => {
  const { search = '', stage = '', page = 1, limit = 8 } = req.query;
  const filter = { owner: req.user.id };
  if (STAGES.includes(stage)) filter.stage = stage;
  if (search.trim()) {
    const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { role: rx }, { skills: rx }];
  }
  const p = Math.max(1, +page), l = Math.min(50, Math.max(1, +limit));
  const [items, total] = await Promise.all([
    Candidate.find(filter).sort('-updatedAt').skip((p - 1) * l).limit(l),
    Candidate.countDocuments(filter),
  ]);
  res.json({ items, total, page: p, pages: Math.max(1, Math.ceil(total / l)) });
}));

app.post('/api/candidates', auth, wrap(async (req, res) => {
  const stage = STAGES.includes(req.body.stage) ? req.body.stage : 'Applied';
  res.status(201).json(await Candidate.create({ ...pick(req.body), stage, owner: req.user.id }));
}));

app.put('/api/candidates/:id', auth, wrap(async (req, res) => {
  const update = pick(req.body);
  if (STAGES.includes(req.body.stage)) update.stage = req.body.stage;
  const c = await Candidate.findOneAndUpdate({ _id: req.params.id, owner: req.user.id }, update, { new: true, runValidators: true });
  c ? res.json(c) : res.status(404).json({ error: 'Candidate not found.' });
}));

app.patch('/api/candidates/:id/stage', auth, wrap(async (req, res) => {
  if (!STAGES.includes(req.body.stage)) return res.status(400).json({ error: 'Unknown stage.' });
  const c = await Candidate.findOneAndUpdate({ _id: req.params.id, owner: req.user.id }, { stage: req.body.stage }, { new: true });
  c ? res.json(c) : res.status(404).json({ error: 'Candidate not found.' });
}));

app.delete('/api/candidates/:id', auth, wrap(async (req, res) => {
  const c = await Candidate.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
  c ? res.json({ ok: true }) : res.status(404).json({ error: 'Candidate not found.' });
}));

// ---- Dashboard ----
app.get('/api/dashboard', auth, wrap(async (req, res) => {
  const owner = new mongoose.Types.ObjectId(req.user.id);
  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const [byStage, topRoles, newThisWeek] = await Promise.all([
    Candidate.aggregate([{ $match: { owner } }, { $group: { _id: '$stage', n: { $sum: 1 } } }]),
    Candidate.aggregate([{ $match: { owner } }, { $group: { _id: '$role', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 3 }]),
    Candidate.countDocuments({ owner, createdAt: { $gte: weekAgo } }),
  ]);
  const stages = Object.fromEntries(STAGES.map(s => [s, 0]));
  byStage.forEach(r => { stages[r._id] = r.n; });
  const total = Object.values(stages).reduce((a, b) => a + b, 0);
  res.json({
    total, stages, newThisWeek,
    active: total - stages.Hired - stages.Rejected,
    hireRate: total ? Math.round((stages.Hired / total) * 100) : 0,
    topRoles: topRoles.map(r => ({ role: r._id, count: r.n })),
  });
}));

app.use((err, req, res, next) => {
  console.error(err);
  if (err.name === 'ValidationError') return res.status(400).json({ error: Object.values(err.errors)[0].message });
  if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid id.' });
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

mongoose.connect(MONGODB_URI)
  .then(() => app.listen(PORT, () => console.log(`Shortlist running on :${PORT}`)))
  .catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
