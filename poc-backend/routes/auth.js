// routes/auth.js
const express = require('express');
const crypto = require('crypto');
const { getUserByKey, getUserByEmail, createUser } = require('../db');

const router = express.Router();

// POST /api/validate-key
// Validates a license key and returns user + subscription info
router.post('/validate-key', (req, res) => {
  const { license_key } = req.body;

  if (!license_key || typeof license_key !== 'string') {
    return res.status(400).json({
      valid: false,
      error: 'MISSING_KEY',
      message: 'license_key is required',
    });
  }

  const user = getUserByKey(license_key.trim());

  if (!user) {
    return res.status(401).json({
      valid: false,
      error: 'INVALID_KEY',
      message: 'Invalid or expired license key',
    });
  }

  // Calculate expiry (POC: 30 days from creation for demo purposes)
  const createdAt = new Date(user.created_at);
  const expiresAt = new Date(createdAt);
  expiresAt.setDate(expiresAt.getDate() + 30);

  const now = new Date();
  const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));

  return res.json({
    valid: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name || 'User',
    },
    subscription: {
      status: daysRemaining > 0 ? 'active' : 'expired',
      expires_at: expiresAt.toISOString().split('T')[0],
      days_remaining: daysRemaining,
      badge: 'MONTHLY ACCESS',
    },
  });
});

// POST /api/register
// Creates a new user and returns their license key (used by website)
router.post('/register', (req, res) => {
  const { name, email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({
      error: 'INVALID_EMAIL',
      message: 'A valid email address is required',
    });
  }

  const existingUser = getUserByEmail(email.toLowerCase().trim());

  if (existingUser) {
    // Return existing key (idempotent registration)
    return res.json({
      license_key: existingUser.license_key,
      email: existingUser.email,
      already_existed: true,
      message: 'Account already exists — here is your existing key',
    });
  }

  // Generate a secure random license key
  const licenseKey = crypto.randomBytes(16).toString('hex'); // 32 char hex

  const userId = createUser(
    (name || '').trim().slice(0, 100),
    email.toLowerCase().trim(),
    licenseKey
  );

  console.log(`[Auth] New user registered: ${email} → key: ${licenseKey}`);

  return res.status(201).json({
    license_key: licenseKey,
    email: email.toLowerCase().trim(),
    user_id: userId,
    message: 'Registration successful',
  });
});

module.exports = router;
