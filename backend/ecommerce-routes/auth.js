const { Router } = require('express');
const crypto = require('crypto');
const { promisePool } = require('../db');
const { authenticateToken } = require('../ecommerce-middleware/auth');
const { hashPassword, verifyPassword, needsRehash } = require('../lib/passwords');
const { signToken, AUDIENCES } = require('../lib/tokens');
const { loginLimiter, otpVerifyLimiter, registerLimiter } = require('../middleware/rateLimiters');

const router = Router();

function generateSecureOtp() {
  // Full six-digit range: 100000-999999 inclusive. randomInt's upper bound is
  // exclusive, so the bound is 1000000, not 999999.
  return String(crypto.randomInt(100000, 1000000));
}

let transporterPromise = null;
let nodemailer = null;

try {
  nodemailer = require('nodemailer');

  if (process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_HOST) {
    console.log(`Using SMTP: ${process.env.SMTP_HOST}`);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    transporter.verify((err, ok) => {
      if (err) {
        console.error(`❌ SMTP connection failed (${process.env.SMTP_HOST}):`, err.message);
        console.error('   Check SMTP_USER / SMTP_PASS. The OTP will be shown in the console instead.');
      } else {
        console.log('✅ SMTP connection verified — emails will be sent.');
      }
    });
    transporterPromise = Promise.resolve(transporter);
  } else {
    console.log('No SMTP configured — using Ethereal test account');
    transporterPromise = nodemailer.createTestAccount().then((testAccount) => {
      console.log('Ethereal account ready:', testAccount.user);
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
    });
  }
} catch {
  console.log('nodemailer not installed — OTP will be logged to console only');
}

async function sendOtpEmail(email, otp, purpose) {
  const subject = purpose === 'login'
    ? 'LCCB Bookstore — Your Login Verification Code'
    : 'LCCB Bookstore — Your Registration Verification Code';
  const heading = purpose === 'login' ? 'complete your login' : 'verify your new account';

  if (!transporterPromise) {
    console.log('\n==============================');
    console.log(`${purpose.toUpperCase()} OTP for ${email}: ${otp}`);
    console.log('==============================\n');
    return false;
  }
  try {
    const transporter = await transporterPromise;
    const info = await transporter.sendMail({
      from: `LCCB Bookstore <${process.env.SMTP_USER || 'noreply@ethereal.email'}>`,
      to: email,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #4f46e5; margin-bottom: 8px;">LCCB Bookstore</h2>
          <p style="color: #374151; font-size: 15px;">Use the code below to ${heading}:</p>
          <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0;">
            <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #111827;">${otp}</span>
          </div>
          <p style="color: #6b7280; font-size: 13px;">This code expires in 5 minutes.</p>
          <p style="color: #ef4444; font-size: 13px; font-weight: bold;">Do not share this code with anyone. LCCB Bookstore will never ask for it.</p>
        </div>
      `,
    });
    console.log('OTP email sent:', info.messageId, '→', email);
    return true;
  } catch (err) {
    console.log('\n==============================');
    console.log(`⚠️ EMAIL SEND FAILED — use this ${purpose.toUpperCase()} OTP for ${email}: ${otp}`);
    console.log('Check the SMTP error above.');
    console.log('==============================\n');
    console.error('Email send error:', err.message);
    return false;
  }
}

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { fullName, email, contactNumber, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'Full name, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const [existing] = await promisePool.query('SELECT id FROM customers WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const hashedPassword = hashPassword(password);
    await promisePool.query(
      'INSERT INTO customers (full_name, name, email, contact_number, password, role) VALUES (?, ?, ?, ?, ?, ?)',
      [fullName, fullName, email, contactNumber || null, hashedPassword, 'customer']
    );

    await promisePool.query(
      "UPDATE otp_codes SET used = 1 WHERE email = ? AND purpose = 'register' AND used = 0",
      [email]
    );

    const otp = generateSecureOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await promisePool.query(
      'INSERT INTO otp_codes (email, otp_code, purpose, expires_at, attempts) VALUES (?, ?, ?, ?, ?)',
      [email, otp, 'register', expiresAt, 0]
    );

    const sent = await sendOtpEmail(email, otp, 'register');

    res.status(201).json({
      requiresOtp: true,
      email: email,
      message: sent ? 'OTP sent to your email' : 'Email delivery failed — OTP provided below',
      otp: sent ? undefined : otp,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Registration failed' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const [rows] = await promisePool.query(
      'SELECT id, full_name, email, contact_number, password, role FROM customers WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'No account found with this email' });
    }

    const user = rows[0];

    if (user.role === 'admin' || user.role === 'staff') {
      return res.status(403).json({ message: 'Admin/Staff accounts cannot login here. Use the admin panel.' });
    }

    const validPassword = verifyPassword(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    // Upgrade accounts still stored with the legacy scrypt parameters.
    if (needsRehash(user.password)) {
      await promisePool
        .query('UPDATE customers SET password = ? WHERE id = ?', [hashPassword(password), user.id])
        .catch((err) => console.warn('Customer password rehash failed:', err.message));
    }

    await promisePool.query(
      "UPDATE otp_codes SET used = 1 WHERE email = ? AND purpose = 'login' AND used = 0",
      [email]
    );

    const otp = generateSecureOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await promisePool.query(
      'INSERT INTO otp_codes (email, otp_code, purpose, expires_at, attempts) VALUES (?, ?, ?, ?, ?)',
      [email, otp, 'login', expiresAt, 0]
    );

    const sent = await sendOtpEmail(email, otp, 'login');

    res.json({
      requiresOtp: true,
      email: email,
      message: sent ? 'OTP sent to your email' : 'Email delivery failed — OTP provided below',
      otp: sent ? undefined : otp,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Login failed' });
  }
});

router.post('/verify-otp', otpVerifyLimiter, async (req, res) => {
  try {
    const { email, otp, purpose = 'login' } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    const [rows] = await promisePool.query(
      'SELECT id, otp_code, expires_at, attempts FROM otp_codes WHERE email = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1',
      [email, purpose]
    );

    if (rows.length === 0) {
      return res.status(400).json({ message: 'No pending OTP. Please request a new code.' });
    }

    const record = rows[0];

    if (record.attempts >= 5) {
      await promisePool.query('UPDATE otp_codes SET used = 1 WHERE id = ?', [record.id]);
      return res.status(429).json({ message: 'Too many failed attempts. Please request a new code.' });
    }

    if (new Date() > new Date(record.expires_at)) {
      await promisePool.query('UPDATE otp_codes SET used = 1 WHERE id = ?', [record.id]);
      return res.status(400).json({ message: 'OTP has expired. Please request a new code.' });
    }

    if (record.otp_code !== otp) {
      await promisePool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [record.id]);
      const remaining = 5 - (record.attempts + 1);
      return res.status(400).json({
        message: remaining > 0 ? `Invalid OTP. ${remaining} attempt(s) remaining.` : 'Invalid OTP. No attempts remaining.',
      });
    }

    await promisePool.query('UPDATE otp_codes SET used = 1 WHERE id = ?', [record.id]);

    const [userRows] = await promisePool.query(
      'SELECT id, full_name, email, contact_number, role FROM customers WHERE email = ?',
      [email]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userRows[0];
    const token = signToken({ sub: String(user.id), role: user.role }, AUDIENCES.ECOM);

    res.json({
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        contactNumber: user.contact_number,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ message: 'Failed to verify OTP' });
  }
});

router.post('/resend-otp', otpVerifyLimiter, async (req, res) => {
  try {
    const { email, purpose = 'login' } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const [userRows] = await promisePool.query(
      'SELECT id FROM customers WHERE email = ?',
      [email]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: 'No account found with this email' });
    }

    const [recent] = await promisePool.query(
      'SELECT id, created_at FROM otp_codes WHERE email = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1',
      [email, purpose]
    );

    if (recent.length > 0) {
      const lastSent = new Date(recent[0].created_at);
      const now = new Date();
      const diffSeconds = Math.floor((now - lastSent) / 1000);
      if (diffSeconds < 60) {
        return res.status(429).json({
          message: `Please wait ${60 - diffSeconds} seconds before requesting a new code.`,
          retryAfter: 60 - diffSeconds,
        });
      }
    }

    await promisePool.query(
      'UPDATE otp_codes SET used = 1 WHERE email = ? AND purpose = ? AND used = 0',
      [email, purpose]
    );

    const otp = generateSecureOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await promisePool.query(
      'INSERT INTO otp_codes (email, otp_code, purpose, expires_at, attempts) VALUES (?, ?, ?, ?, ?)',
      [email, otp, purpose, expiresAt, 0]
    );

    const sent = await sendOtpEmail(email, otp, purpose);

    res.json({
      message: sent ? 'New OTP sent to your email' : 'Email delivery failed — OTP provided below',
      otp: sent ? undefined : otp,
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ message: 'Failed to resend OTP' });
  }
});

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user.id,
        fullName: req.user.fullName,
        email: req.user.email,
        contactNumber: req.user.contactNumber,
        role: req.user.role,
      },
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ message: 'Failed to get profile' });
  }
});

router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { fullName, email, contactNumber } = req.body;

    if (!fullName || !email) {
      return res.status(400).json({ message: 'Full name and email are required' });
    }

    const [existing] = await promisePool.query(
      'SELECT id FROM customers WHERE email = ? AND id != ?',
      [email, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    await promisePool.query(
      'UPDATE customers SET full_name = ?, name = ?, email = ?, contact_number = ? WHERE id = ?',
      [fullName, fullName, email, contactNumber || null, req.user.id]
    );

    res.json({
      user: {
        id: req.user.id,
        fullName,
        email,
        contactNumber: contactNumber || null,
        role: req.user.role,
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const [rows] = await promisePool.query('SELECT password FROM customers WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const validPassword = verifyPassword(currentPassword, rows[0].password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const hashedPassword = hashPassword(newPassword);
    await promisePool.query('UPDATE customers SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Failed to change password' });
  }
});

module.exports = router;
