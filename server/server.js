'use strict';

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const sanitize = require('sanitize-filename');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'config.json');
const USERS_PATH = path.join(ROOT, 'config', 'users.json');
const JOBS_PATH = path.join(ROOT, 'config', 'jobs.json');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const SESSION_DIR = path.join(ROOT, 'sessions');
const LOG_DIR = path.join(ROOT, 'logs');

[UPLOAD_DIR, SESSION_DIR, LOG_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: path.join(LOG_DIR, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(LOG_DIR, 'combined.log') }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

function readUsers() {
  if (!fs.existsSync(USERS_PATH)) return {};
  return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
}
function writeUsers(u) { fs.writeFileSync(USERS_PATH, JSON.stringify(u, null, 2)); }
function readJobs() {
  if (!fs.existsSync(JOBS_PATH)) return [];
  return JSON.parse(fs.readFileSync(JOBS_PATH, 'utf-8'));
}
function writeJobs(j) { fs.writeFileSync(JOBS_PATH, JSON.stringify(j, null, 2)); }

const app = express();

app.use(cors());
// ── Disable helmet CSP entirely to avoid inline script blocking ──
app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new FileStore({ path: SESSION_DIR, ttl: config.sessionTTL || 3600 }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  name: 'ppid',
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: (config.sessionTTL || 3600) * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Try again later.' }
});

const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png', 'image/jpeg', 'image/jpg', 'text/plain'
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: (config.maxFileSizeMB || 50) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(new Error('File type not allowed'));
  }
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });
  next();
}

app.use(express.static(path.join(ROOT, 'public')));

// ── Auth ──
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

    const users = readUsers();
    const user = users[username.toLowerCase().trim()];
    if (!user || !user.active) {
      logger.warn(`Failed login: ${username} from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      logger.warn(`Bad password: ${username} from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Session error' });
      req.session.user = { username: username.toLowerCase().trim(), role: user.role, name: user.name };
      req.session.save(err2 => {
        if (err2) return res.status(500).json({ error: 'Session save error' });
        logger.info(`Login: ${username} from ${req.ip}`);
        res.json({ success: true, user: req.session.user });
      });
    });
  } catch (e) {
    logger.error('Login error: ' + e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ppid');
    res.json({ success: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user: req.session.user });
});


function executePrintJob(jobId, operatorUsername) {
  let jobs = readJobs();
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;
  if (job.status !== 'pending' && job.status !== 'printing') return;

  job.status = 'printing';
  writeJobs(jobs);

  const filePath = path.join(UPLOAD_DIR, job.storedName);
  const printer = config.printerName || '';

  // Detect OS and use appropriate print command
  let cmd;
  if (process.platform === 'darwin') {
    // macOS: use lp command
    cmd = printer ? `lp -d "${printer}" "${filePath}"` : `lp "${filePath}"`;
  } else {
    // Windows: use powershell
    cmd = `powershell -Command "Start-Process -FilePath '${filePath}' -Verb Print -Wait"`;
  }

  logger.info(`Printing job ${job.id} by operator ${operatorUsername} using cmd: ${cmd}`);
  exec(cmd, { timeout: 120000 }, (err) => {
    let currentJobs = readJobs();
    const j2 = currentJobs.find(j => j.id === jobId);
    if (!j2) return;
    if (err) {
      logger.error(`Print error job ${job.id}: ${err.message}`);
      j2.status = 'failed';
    } else {
      j2.status = 'done';
      j2.printedAt = new Date().toISOString();
      j2.printedBy = operatorUsername;
    }
    writeJobs(currentJobs);
  });
}

// ── Jobs ──
app.post('/api/jobs', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { copies = 1, colorMode = 'mono', orientation = 'portrait', paperSize = 'A4', notes = '' } = req.body;
    const user = req.session.user;
    const isAdmin = user.role === 'admin';

    const job = {
      id: uuidv4(),
      username: user.username,
      name: user.name,
      originalName: sanitize(req.file.originalname),
      storedName: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
      copies: Math.min(Math.max(parseInt(copies) || 1, 1), 50),
      colorMode, orientation, paperSize,
      notes: notes.substring(0, 200),
      status: isAdmin ? 'printing' : 'pending',
      createdAt: new Date().toISOString(),
      printedAt: null
    };
    const jobs = readJobs();
    jobs.push(job);
    writeJobs(jobs);

    logger.info(`Job created: ${job.id} by ${job.username} file=${job.originalName}`);

    if (isAdmin) {
      executePrintJob(job.id, user.username);
    }

    const { storedName, ...safe } = job;
    res.json({ success: true, job: safe });
  } catch (e) {
    logger.error('Job create error: ' + e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/jobs', requireAuth, (req, res) => {
  const jobs = readJobs();
  res.json({ jobs: jobs.map(j => { const { storedName, ...s } = j; return s; }).reverse() });
});

app.delete('/api/jobs/:id', requireAuth, (req, res) => {
  let jobs = readJobs();
  const idx = jobs.findIndex(j => j.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const job = jobs[idx];
  const user = req.session.user;
  if (job.username !== user.username && user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const filePath = path.join(UPLOAD_DIR, job.storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  jobs.splice(idx, 1);
  writeJobs(jobs);
  res.json({ success: true });
});

app.post('/api/jobs/:id/print', requireAdmin, (req, res) => {
  const jobs = readJobs();
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  if (job.status !== 'pending') return res.status(400).json({ error: `Job is ${job.status}` });

  executePrintJob(job.id, req.session.user.username);
  res.json({ success: true, message: 'Print job dispatched' });
});

// ── Users ──
app.get('/api/users', requireAdmin, (req, res) => {
  const users = readUsers();
  const safe = Object.entries(users).map(([un, u]) => ({
    username: un, name: u.name, role: u.role, active: u.active, createdAt: u.createdAt
  }));
  res.json({ users: safe });
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, name, password, role = 'user' } = req.body;
  if (!username || !name || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 8) return res.status(400).json({ error: 'Password too short (min 8)' });
  const users = readUsers();
  const key = username.toLowerCase().trim();
  if (users[key]) return res.status(409).json({ error: 'User already exists' });
  users[key] = { name, role, active: true, passwordHash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() };
  writeUsers(users);
  res.json({ success: true });
});

app.put('/api/users/:username', requireAdmin, async (req, res) => {
  const users = readUsers();
  const key = req.params.username.toLowerCase();
  if (!users[key]) return res.status(404).json({ error: 'Not found' });
  const { name, password, role, active } = req.body;
  if (name) users[key].name = name;
  if (role && ['user', 'admin'].includes(role)) users[key].role = role;
  if (typeof active === 'boolean') users[key].active = active;
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password too short' });
    users[key].passwordHash = await bcrypt.hash(password, 12);
  }
  writeUsers(users);
  res.json({ success: true });
});

app.delete('/api/users/:username', requireAdmin, (req, res) => {
  const users = readUsers();
  const key = req.params.username.toLowerCase();
  if (key === req.session.user.username) return res.status(400).json({ error: 'Cannot delete yourself' });
  if (!users[key]) return res.status(404).json({ error: 'Not found' });
  delete users[key];
  writeUsers(users);
  res.json({ success: true });
});

app.get('/api/logs', requireAdmin, (req, res) => {
  const logFile = path.join(LOG_DIR, 'combined.log');
  if (!fs.existsSync(logFile)) return res.json({ logs: [] });
  const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').slice(-200).reverse();
  res.json({ logs: lines.map(l => { try { return JSON.parse(l); } catch { return { message: l }; } }) });
});

const PORT = config.port || 5000;
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`PrintPortal running on http://0.0.0.0:${PORT}`);
});
