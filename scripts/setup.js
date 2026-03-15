/**
 * PrintPortal Setup Script
 * Run: node scripts/setup.js
 * Creates initial admin account and initializes data files.
 */

const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'config.json');
const USERS_PATH = path.join(ROOT, 'config', 'users.json');
const JOBS_PATH = path.join(ROOT, 'config', 'jobs.json');

['config', 'uploads', 'sessions', 'logs'].forEach(d =>
  fs.mkdirSync(path.join(ROOT, d), { recursive: true })
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  console.log('\n========================================');
  console.log('  PrintPortal — Initial Setup Wizard');
  console.log('========================================\n');

  // Config
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  }

  // Generate secure session secret
  config.sessionSecret = crypto.randomBytes(64).toString('hex');
  console.log('✔ Generated secure session secret\n');

  // Printer name
  const printerName = await ask('Enter printer name (leave blank to auto-detect, or set later in config.json): ');
  if (printerName.trim()) config.printerName = printerName.trim();

  const portInput = await ask('Port to run server on [3000]: ');
  config.port = parseInt(portInput) || 3000;

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('\n✔ Config saved\n');

  // Users
  let users = {};
  if (fs.existsSync(USERS_PATH)) users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));

  console.log('--- Create Admin Account ---');
  let adminUsername = (await ask('Admin username [admin]: ')).trim() || 'admin';
  adminUsername = adminUsername.toLowerCase();
  const adminName = (await ask('Admin full name: ')).trim() || 'Administrator';

  let adminPassword;
  while (true) {
    adminPassword = (await ask('Admin password (min 8 chars): ')).trim();
    if (adminPassword.length >= 8) break;
    console.log('Password too short! Must be at least 8 characters.');
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  users[adminUsername] = {
    name: adminName,
    role: 'admin',
    active: true,
    passwordHash,
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
  if (!fs.existsSync(JOBS_PATH)) fs.writeFileSync(JOBS_PATH, '[]');

  console.log('\n✔ Admin account created');
  console.log('\n========================================');
  console.log(`  Setup complete!`);
  console.log(`  Start server: npm start`);
  console.log(`  Open browser: http://localhost:${config.port}`);
  console.log(`  Local network: http://<your-ip>:${config.port}`);
  console.log('========================================\n');

  rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });
