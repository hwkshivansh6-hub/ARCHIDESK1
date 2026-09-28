require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDatabase, queries, hashPassword } = require('./db');
const { sendOtpEmail } = require('./mailer');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// Production HTTP Protection: Apply Helmet before any routes
app.use(helmet());

// Cloudinary configuration using cloud environment credentials
const hasCloudinary = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (hasCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

// Multer memory storage allows direct streaming to Cloudinary or resilient Data URI fallback
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

// Process uploaded file: Stream to Cloudinary if configured; otherwise generate persistent Data URI
async function processUploadedFile(file) {
  if (!file) return null;

  // 1. If Cloudinary credentials are provided, stream directly to Cloudinary
  if (hasCloudinary) {
    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'archimanager',
            resource_type: 'auto'
          },
          (error, res) => {
            if (error) reject(error);
            else resolve(res);
          }
        );
        stream.end(file.buffer);
      });

      file.path = result.secure_url || result.url;
      return file.path;
    } catch (cloudErr) {
      console.warn('⚠️ Cloudinary stream upload failed, falling back to persistent data URI:', cloudErr.message);
    }
  }

  // 2. Resilient Fallback: Base64 Data URI persisted in cloud DB without disk dependency
  const mimeType = file.mimetype || 'image/jpeg';
  file.path = `data:${mimeType};base64,${file.buffer.toString('base64')}`;
  return file.path;
}

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'HWK121212',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Initialize Passport and Session
app.use(passport.initialize());
app.use(passport.session());

// Passport User Serialization
passport.serializeUser((user, done) => {
  done(null, user.id || user.user_id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await queries.getUserById(id);
    if (user) {
      user.user_id = user.id;
    }
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// Configure Google OAuth 2.0 Strategy
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback';

if (googleClientId && googleClientSecret) {
  passport.use(new GoogleStrategy({
    clientID: googleClientId,
    clientSecret: googleClientSecret,
    callbackURL: googleCallbackUrl
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const google_id = profile.id;
      const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
      const name = profile.displayName || (profile.name ? `${profile.name.givenName || ''} ${profile.name.familyName || ''}`.trim() : 'Google Architect');
      const avatar_url = profile.photos && profile.photos[0] ? profile.photos[0].value : null;

      const user = await queries.createOrUpdateGoogleUser({
        googleId: google_id,
        email,
        name,
        avatarUrl: avatar_url
      });
      user.user_id = user.id;
      return done(null, user);
    } catch (err) {
      console.error('Google OAuth verification error:', err);
      return done(err, null);
    }
  }));
} else {
  console.warn('⚠️ Google OAuth: GOOGLE_CLIENT_ID and/or GOOGLE_CLIENT_SECRET not configured.');
}

// Serve static client assets
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helper to extract session token from Authorization header, query, or cookie
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '').trim();
  }
  if (req.query && req.query.token) {
    return req.query.token;
  }
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/archidesk_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

// Helper to reliably extract the authenticated user ID strictly from session (Never from req.body/params)
function getSessionUserId(req) {
  const userId = req.session?.userId || req.session?.user?.id || req.session?.user?.user_id || req.user?.id || req.user?.user_id;
  if (req.session && userId && !req.session.userId) {
    req.session.userId = userId;
  }
  return userId || null;
}

const getAuthUserId = getSessionUserId;

// ================= PRODUCTION SECURITY HARDENING: RATE LIMITING =================
// General API rate limiter on /api/ (max 100 requests per 15 minutes per IP)
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP, please try again after 15 minutes.'
  }
});

// Strict rate limiter on /api/auth/verify-otp and /api/auth/resend-otp (max 5 attempts per 15 minutes per IP)
const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many OTP verification attempts. Please wait 15 minutes before trying again.',
    error: 'Too many OTP attempts from this IP, please try again after 15 minutes.'
  }
});

// ================= AUTHENTICATION GUARD MIDDLEWARE =================
// Protects all /api/* data routes, rejecting unauthenticated requests with a 401 status
async function ensureAuthenticated(req, res, next) {
  try {
    const rawPath = req.originalUrl ? req.originalUrl.split('?')[0] : (req.baseUrl || '') + req.path;
    const currentPath = rawPath.replace(/\/+$/, '') || '/';

    // Allow unauthenticated access to public auth endpoints, OTP verification, and login assets
    const publicAuthPaths = [
      '/api/auth/login',
      '/api/auth/google',
      '/api/auth/google/callback',
      '/api/auth/verify-otp',
      '/api/auth/resend-otp',
      '/api/auth/otp-status',
      '/api/auth/logout',
      '/api/auth/me',
      '/verify-otp',
      '/login'
    ];

    if (publicAuthPaths.some(p => currentPath === p || currentPath.startsWith('/api/auth/google'))) {
      return next();
    }

    // 1. Block access if user has pending 2FA that is not yet verified
    if (req.session && req.session.pendingEmail && !req.session.is2FAVerified) {
      if (req.accepts('html') && !req.is('json') && !currentPath.startsWith('/api')) {
        return res.redirect('/verify-otp');
      }
      return res.status(401).json({ error: 'Unauthorized: 2FA verification required', redirect: '/verify-otp' });
    }

    // 2. Direct session user check: Accept if session has user and is 2FA verified
    if (req.session && req.session.user && req.session.is2FAVerified === true) {
      const u = req.session.user;
      const uid = u.id || u.user_id;
      req.user = { ...u, id: uid, user_id: uid };
      req.session.userId = uid;
      return next();
    }

    // 3. Passport session check (Google OAuth)
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      if (req.session && req.session.is2FAVerified === false) {
        return res.status(401).json({ error: 'Unauthorized: 2FA verification required', redirect: '/verify-otp' });
      }
      const uid = req.user.id || req.user.user_id;
      req.user.id = uid;
      req.user.user_id = uid;
      if (req.session) req.session.userId = uid;
      return next();
    }

    // 4. Token-based authentication (Bearer header, cookie archidesk_token, query)
    const token = extractToken(req);
    if (token) {
      const sessionData = await queries.getSession(token);
      if (!sessionData) {
        return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
      }
      const uid = sessionData.user_id || sessionData.id;
      req.user = { ...sessionData, id: uid, user_id: uid };
      if (req.session) {
        req.session.userId = uid;
        req.session.is2FAVerified = true;
      }
      return next();
    }

    // Reject all other unauthenticated requests with 401
    return res.status(401).json({ error: 'Unauthorized: Authentication required to access this resource' });
  } catch (err) {
    console.error('ensureAuthenticated middleware error:', err);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
}

// Backward compatibility aliases
const authRequired = ensureAuthenticated;
const ensureAuth = ensureAuthenticated;

// Apply general API rate limiter to all /api/ routes
app.use('/api/', generalApiLimiter);

// Apply authentication guard to all /api routes
app.use('/api', ensureAuthenticated);

// ================= AUTH ROUTES =================

// GET /api/auth/google - Initiates Google OAuth authentication
app.get('/api/auth/google', (req, res, next) => {
  if (!googleClientId || !googleClientSecret) {
    return res.status(503).send(
      '<div style="font-family:sans-serif;padding:32px;max-width:520px;margin:50px auto;border:1px solid #e2e8f0;border-radius:12px;text-align:center;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.06);">' +
      '<h2 style="color:#0f172a;margin-bottom:8px;">Google OAuth 2.0 Credentials Pending</h2>' +
      '<p style="color:#64748b;font-size:14px;line-height:1.5;">Please configure <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in your <code>.env</code> file or hosting environment to activate Google Sign-In.</p>' +
      '<a href="/" style="display:inline-block;padding:10px 22px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;margin-top:16px;">Return to Workspace Login</a>' +
      '</div>'
    );
  }
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })(req, res, next);
});

// GET /api/auth/google/callback - Google OAuth callback handler with 2FA OTP issuance
app.get(
  '/api/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=oauth_failed' }),
  async (req, res) => {
    try {
      const user = req.user;
      if (!user || !user.email) {
        return res.redirect('/login');
      }

      const email = user.email;

      // Generate a random 6-digit numeric OTP code
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

      // Store in Turso otps table with expires_at = datetime('now', '+5 minutes')
      await queries.saveOTP(email, otpCode);

      // Trigger email via Resend asynchronously in background without blocking the HTTP redirect
      sendOtpEmail(email, otpCode).catch((err) => {
        console.error('[RESEND ERROR]', err);
      });

      // Set session state:
      req.session.pendingEmail = email;
      req.session.is2FAVerified = false;
      req.session.lastOtpSentAt = Date.now();

      // Clear any prior auth cookies
      res.clearCookie('archidesk_token');

      // Immediate Session Save & Redirect
      req.session.save((err) => {
        if (err) console.error("Session save error:", err);
        return res.redirect('/verify-otp');
      });
    } catch (err) {
      console.error('Google callback error:', err);
      res.redirect('/login');
    }
  }
);

// GET /verify-otp - Renders or serves the OTP page as long as pendingEmail or temporary session exists
app.get('/verify-otp', (req, res) => {
  if (req.session && req.session.user && req.session.is2FAVerified === true) {
    return res.redirect('/');
  }
  if (req.session && (req.session.pendingEmail || req.session.user)) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  res.redirect('/login');
});

// GET /api/auth/otp-status - Returns whether 2FA OTP is required for current session
app.get('/api/auth/otp-status', (req, res) => {
  if (!req.session || !req.session.pendingEmail) {
    return res.status(400).json({ error: 'No pending 2FA session found' });
  }
  res.json({ email: req.session.pendingEmail });
});

// POST /api/auth/verify-otp - Validates 6-digit OTP code against Turso otps table (Rate-limited: 5 attempts / 15m)
app.post('/api/auth/verify-otp', otpRateLimiter, async (req, res) => {
  try {
    const { otp } = req.body;
    const email = req.session ? req.session.pendingEmail : null;

    if (!email) {
      return res.status(400).json({ message: 'No pending verification session. Please log in again.' });
    }
    if (!otp || String(otp).trim().length !== 6) {
      return res.status(400).json({ message: 'Please enter a valid 6-digit verification code.' });
    }

    // Validates against Turso otps table where expires_at > CURRENT_TIMESTAMP
    const validOtp = await queries.verifyOTP(email, String(otp).trim());
    if (!validOtp) {
      return res.status(400).json({ message: 'Invalid or expired verification code. Please request a new one.' });
    }

    // Immediately delete the matched OTP record from otps so it cannot be reused
    if (validOtp && validOtp.id) {
      await queries.deleteOTPById(validOtp.id);
    }
    await queries.deleteOTP(email);

    // Retrieve user from Turso
    const user = await queries.getUserByEmail(email);
    if (!user) {
      return res.status(400).json({ message: 'User account not found.' });
    }

    // Set 2FA Verified in session
    req.session.is2FAVerified = true;
    req.session.userId = user.id;
    req.session.user = {
      id: user.id,
      user_id: user.id,
      email: user.email,
      name: user.name,
      studio_name: user.studio_name,
      role: user.role,
      google_id: user.google_id,
      avatar_url: user.avatar_url,
      auth_provider: user.auth_provider
    };
    delete req.session.pendingEmail;

    // Generate persistent token for client
    const sessionData = await queries.createSession(user.id);
    res.cookie('archidesk_token', sessionData.token, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: false
    });

    req.session.save((err) => {
      if (err) {
        console.error('Session save error on verify-otp:', err);
        return res.status(500).json({ message: 'Failed to finalize authenticated session.' });
      }
      return res.json({
        success: true,
        message: 'Identity verified successfully. Welcome to SHASWAT DESIGNS Workspace.',
        token: sessionData.token,
        user: req.session.user
      });
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ message: 'Failed to verify OTP. Please try again.' });
  }
});

// POST /api/auth/resend-otp - Issues new 6-digit OTP code with 60-second cooldown (Rate-limited: 5 attempts / 15m)
app.post('/api/auth/resend-otp', otpRateLimiter, async (req, res) => {
  try {
    const email = req.session ? req.session.pendingEmail : null;
    if (!email) {
      return res.status(400).json({ message: 'No active verification session. Please log in first.' });
    }

    // 60-second cooldown enforcement
    const lastSent = req.session.lastOtpSentAt || 0;
    const elapsedSeconds = Math.floor((Date.now() - lastSent) / 1000);
    if (elapsedSeconds < 60) {
      const waitSeconds = 60 - elapsedSeconds;
      return res.status(429).json({
        message: `Please wait ${waitSeconds} seconds before requesting a new code.`,
        cooldownRemaining: waitSeconds
      });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    await queries.saveOTP(email, otpCode);
    // Trigger email via Resend asynchronously without blocking the HTTP response
    sendOtpEmail(email, otpCode).catch((err) => {
      console.error('[RESEND ERROR]', err);
    });

    req.session.lastOtpSentAt = Date.now();

    res.json({
      success: true,
      message: `A new 6-digit verification code has been sent to ${email}.`,
      cooldownSeconds: 60
    });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ message: 'Failed to resend verification code.' });
  }
});

// POST /api/auth/login - Standard email/username login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Studio Email / Username and password are required' });
    }

    const cleanIdentifier = email.trim().toLowerCase();
    const user = await (queries.getUserByEmailOrUsername ? queries.getUserByEmailOrUsername(cleanIdentifier) : queries.getUserByEmail(cleanIdentifier));
    if (!user) {
      return res.status(401).json({ error: 'Invalid studio email/username or password.' });
    }

    if (user.password_hash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    const sessionData = await queries.createSession(user.id);

    // Direct password logins are authenticated and verified
    req.session.is2FAVerified = true;
    req.session.userId = user.id;
    req.session.user = {
      id: user.id,
      user_id: user.id,
      email: user.email,
      name: user.name,
      studio_name: user.studio_name,
      role: user.role,
      google_id: user.google_id,
      avatar_url: user.avatar_url,
      auth_provider: user.auth_provider
    };
    delete req.session.pendingEmail;

    if (typeof req.logIn === 'function') {
      req.logIn(user, () => {});
    }

    res.cookie('archidesk_token', sessionData.token, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: false
    });

    res.json({
      token: sessionData.token,
      expiresAt: sessionData.expiresAt,
      user: {
        id: user.id,
        user_id: user.id,
        email: user.email,
        name: user.name,
        studio_name: user.studio_name,
        role: user.role,
        google_id: user.google_id,
        avatar_url: user.avatar_url,
        auth_provider: user.auth_provider
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// GET /api/auth/me - Retrieves authenticated user session profile
app.get('/api/auth/me', async (req, res) => {
  try {
    // 1. Check if 2FA verification is currently pending
    if (req.session && req.session.pendingEmail && !req.session.is2FAVerified) {
      return res.json({
        user: null,
        pending2FA: true,
        email: req.session.pendingEmail
      });
    }

    // 2. Direct session user check: Accept if session has user and is 2FA verified
    if (req.session && req.session.user && req.session.is2FAVerified === true) {
      const u = req.session.user;
      return res.json({
        user: {
          id: u.id || u.user_id,
          user_id: u.id || u.user_id,
          email: u.email,
          name: u.name,
          studio_name: u.studio_name,
          role: u.role,
          google_id: u.google_id,
          avatar_url: u.avatar_url,
          auth_provider: u.auth_provider
        }
      });
    }

    // 3. Session-based authentication via Passport (Google OAuth)
    if (req.isAuthenticated && req.isAuthenticated() && req.user && req.session?.is2FAVerified) {
      const u = req.session.user || req.user;
      return res.json({
        user: {
          id: u.id || u.user_id,
          user_id: u.id || u.user_id,
          email: u.email,
          name: u.name,
          studio_name: u.studio_name,
          role: u.role,
          google_id: u.google_id,
          avatar_url: u.avatar_url,
          auth_provider: u.auth_provider
        }
      });
    }

    // 4. Token-based authentication
    const token = extractToken(req);
    if (token) {
      const sessionData = await queries.getSession(token);
      if (sessionData) {
        return res.json({
          user: {
            id: sessionData.user_id,
            user_id: sessionData.user_id,
            email: sessionData.email,
            name: sessionData.name,
            studio_name: sessionData.studio_name,
            role: sessionData.role,
            google_id: sessionData.google_id,
            avatar_url: sessionData.avatar_url,
            auth_provider: sessionData.auth_provider
          },
          token: sessionData.token
        });
      }
    }

    // 5. Unauthenticated
    return res.json({ user: null });
  } catch (err) {
    console.error('Auth /me error:', err);
    return res.json({ user: null });
  }
});

// POST /api/auth/logout - Destroys session, clears cookies, returns { success: true }
app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = extractToken(req);
    if (token) {
      await queries.deleteSession(token);
    }

    res.clearCookie('archidesk_token');

    const finishLogout = () => {
      if (req.session) {
        req.session.destroy(() => {
          res.json({ success: true, message: 'Logged out successfully' });
        });
      } else {
        res.json({ success: true, message: 'Logged out successfully' });
      }
    };

    if (typeof req.logout === 'function') {
      req.logout((err) => {
        finishLogout();
      });
    } else {
      finishLogout();
    }
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/profile - Updates architect profile
app.put('/api/auth/profile', ensureAuthenticated, async (req, res) => {
  try {
    const { name, studio_name, email, role } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Principal architect/engineer name is required' });
    }

    const currentUserId = getAuthUserId(req);
    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized: User session required' });
    }

    await queries.updateUserProfile(
      currentUserId,
      name.trim(),
      studio_name && studio_name.trim() ? studio_name.trim() : 'SHASWAT DESIGNS',
      email && email.trim() ? email.trim() : req.user.email,
      role && role.trim() ? role.trim() : req.user.role
    );

    const updated = await queries.getUserById(currentUserId);
    res.json({ success: true, message: 'Principal profile updated successfully', user: updated });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================= DASHBOARD SUMMARY (Strict Multi-Tenant Scoped) =================
app.get('/api/dashboard/stats', ensureAuthenticated, async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const stats = await queries.getDashboardStats(userId);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= PROJECT TYPES =================
app.get('/api/project-types', ensureAuthenticated, async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const types = await queries.getProjectTypes(userId);
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/project-types', ensureAuthenticated, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project type name is required' });
    }
    const result = await queries.createProjectType(name.trim(), color || '#2563eb');
    res.json({ success: true, id: result.lastInsertRowid, message: 'Project type created' });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'A project type with this name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/project-types/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, color } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project type name is required' });
    }
    await queries.updateProjectType(id, name.trim(), color || '#2563eb');
    res.json({ success: true, message: 'Project type updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/project-types/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await queries.deleteProjectType(id);
    res.json({ success: true, message: 'Project type deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ================= CLIENTS (Multi-Tenant User Scoped) =================
app.get('/api/clients', ensureAuthenticated, async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const clients = await queries.getClients(userId);
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const client = await queries.getClientById(id, userId);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients', ensureAuthenticated, async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { name, phone, email, address, company_name, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    let cleanPhone = null;
    if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
      const trimmed = String(phone).trim();
      if (!/^\d{10}$/.test(trimmed)) {
        return res.status(400).json({ error: 'Phone number must be exactly 10 digits without letters or symbols' });
      }
      cleanPhone = trimmed;
    }

    const result = await queries.createClient(name.trim(), cleanPhone, email, address, company_name, notes, userId);
    res.json({ success: true, id: result.lastInsertRowid, message: 'Client created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clients/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const { name, phone, email, address, company_name, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    let cleanPhone = null;
    if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
      const trimmed = String(phone).trim();
      if (!/^\d{10}$/.test(trimmed)) {
        return res.status(400).json({ error: 'Phone number must be exactly 10 digits without letters or symbols' });
      }
      cleanPhone = trimmed;
    }

    await queries.updateClient(id, userId, name.trim(), cleanPhone, email, address, company_name, notes);
    res.json({ success: true, message: 'Client updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    await queries.deleteClient(id, userId);
    res.json({ success: true, message: 'Client deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ================= PROJECTS (Multi-Tenant User Scoped) =================
app.get('/api/projects', ensureAuthenticated, async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const filters = {
      status: req.query.status,
      project_type_id: req.query.project_type_id ? parseInt(req.query.project_type_id, 10) : undefined,
      client_id: req.query.client_id ? parseInt(req.query.client_id, 10) : undefined,
      location: req.query.location,
      search: req.query.search
    };
    const projects = await queries.getProjects(filters, userId);
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const project = await queries.getProjectById(id, userId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', ensureAuthenticated, async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { client_id, project_type_id, name, location, status, start_date, expected_completion_date, total_fee, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    if (!client_id) {
      return res.status(400).json({ error: 'Client is required' });
    }
    if (!project_type_id) {
      return res.status(400).json({ error: 'Project type is required' });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ error: 'Location is required' });
    }

    const feeNum = parseFloat(total_fee) || 0;
    const result = await queries.createProject(
      parseInt(client_id, 10),
      parseInt(project_type_id, 10),
      name.trim(),
      location.trim(),
      status || 'Active',
      start_date,
      expected_completion_date,
      feeNum,
      notes,
      userId
    );
    res.json({ success: true, id: result.lastInsertRowid, message: 'Project created successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/projects/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const { client_id, project_type_id, name, location, status, start_date, expected_completion_date, total_fee, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    const feeNum = parseFloat(total_fee) || 0;
    await queries.updateProject(
      id,
      userId,
      parseInt(client_id, 10),
      parseInt(project_type_id, 10),
      name.trim(),
      location.trim(),
      status || 'Active',
      start_date,
      expected_completion_date,
      feeNum,
      notes
    );
    res.json({ success: true, message: 'Project updated successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/projects/:id/status', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const { status } = req.body;
    if (!['Active', 'Completed', 'Pre-Planning'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be Active, Completed, or Pre-Planning' });
    }
    await queries.updateProjectStatus(id, userId, status);
    res.json({ success: true, status, message: `Project status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    await queries.deleteProject(id, userId);
    res.json({ success: true, message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= ACCOUNTS & PAYMENTS (Multi-Tenant User Scoped) =================
app.get('/api/accounts/summary', ensureAuthenticated, async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const summary = await queries.getAccountsSummary(userId);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/payments', ensureAuthenticated, async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const projectId = req.query.project_id ? parseInt(req.query.project_id, 10) : null;
    const payments = await queries.getPayments(projectId, userId);
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payments', ensureAuthenticated, async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { project_id, amount, payment_date, payment_method, reference_note } = req.body;
    if (!project_id) {
      return res.status(400).json({ error: 'Project is required' });
    }
    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      return res.status(400).json({ error: 'Valid positive payment amount is required' });
    }
    if (!payment_date) {
      return res.status(400).json({ error: 'Payment date is required' });
    }

    const result = await queries.addPayment(
      parseInt(project_id, 10),
      userId,
      amtNum,
      payment_date,
      payment_method || 'UPI',
      reference_note
    );

    // Get recalculated project financial data
    const updatedProj = await queries.getProjectById(parseInt(project_id, 10), userId);

    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: 'Payment recorded successfully',
      project: updatedProj ? {
        id: updatedProj.id,
        total_fee: updatedProj.total_fee,
        received_amount: updatedProj.received_amount,
        balance_amount: updatedProj.balance_amount
      } : null
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/payments/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    await queries.deletePayment(id, userId);
    res.json({ success: true, message: 'Payment deleted and balance recalculated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= DRAWINGS & REVISIONS (Multi-Tenant User Scoped) =================
app.get('/api/projects/:id/drawings', ensureAuthenticated, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const drawings = await queries.getDrawings(projectId, userId);
    res.json(drawings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drawings/:id/revisions', ensureAuthenticated, async (req, res) => {
  try {
    const drawingId = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const drawingWithRevs = await queries.getDrawingWithRevisions(drawingId, userId);
    if (!drawingWithRevs) {
      return res.status(404).json({ error: 'Drawing not found' });
    }
    res.json(drawingWithRevs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/drawings', ensureAuthenticated, upload.single('file'), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const { name, drawing_number, category, description, revision_code, revision_note } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Drawing name is required' });
    }
    if (!category) {
      return res.status(400).json({ error: 'Drawing category is required' });
    }

    let fileUrl = '/assets/sample-floorplan.svg';
    let fileName = 'drawing.pdf';
    let fileSize = 150000;
    let fileType = 'PDF';

    if (req.file) {
      await processUploadedFile(req.file);
      fileUrl = req.file.path;
      fileName = req.file.originalname;
      fileSize = req.file.size;
      const ext = path.extname(req.file.originalname).toUpperCase().replace('.', '');
      fileType = ['PDF', 'JPG', 'JPEG', 'PNG', 'DWG', 'DXF'].includes(ext) ? ext : 'PDF';
    } else if (req.body.preset_asset) {
      fileUrl = req.body.preset_asset;
      fileName = req.body.preset_asset.split('/').pop();
    }

    const drawingId = await queries.createDrawing(
      projectId,
      userId,
      name.trim(),
      drawing_number,
      category,
      description,
      req.user.name,
      revision_code || 'R00',
      revision_note || 'Initial architectural concept release',
      fileUrl,
      fileName,
      fileSize,
      fileType
    );

    res.json({ success: true, id: drawingId, message: 'Drawing uploaded and registered successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/drawings/:id/revisions', ensureAuthenticated, upload.single('file'), async (req, res) => {
  try {
    const drawingId = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const { revision_code, revision_note, revision_date } = req.body;
    if (!revision_code || !revision_code.trim()) {
      return res.status(400).json({ error: 'Revision code (e.g. R01, R02) is required' });
    }

    let fileUrl = '/assets/sample-floorplan.svg';
    let fileName = 'revised_drawing.pdf';
    let fileSize = 160000;
    let fileType = 'PDF';

    if (req.file) {
      await processUploadedFile(req.file);
      fileUrl = req.file.path;
      fileName = req.file.originalname;
      fileSize = req.file.size;
      const ext = path.extname(req.file.originalname).toUpperCase().replace('.', '');
      fileType = ['PDF', 'JPG', 'JPEG', 'PNG', 'DWG', 'DXF'].includes(ext) ? ext : 'PDF';
    }

    const result = await queries.addDrawingRevision(
      drawingId,
      userId,
      revision_code.trim().toUpperCase(),
      revision_note || 'Drawing revision updated',
      revision_date || new Date().toISOString().split('T')[0],
      fileName,
      fileUrl,
      fileSize,
      fileType
    );

    res.json({ success: true, id: result.lastInsertRowid, message: `Revision ${revision_code} added successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/drawings/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const { name, drawing_number, category, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Drawing name is required' });
    }
    await queries.updateDrawing(id, userId, name.trim(), drawing_number, category, description);
    res.json({ success: true, message: 'Drawing details updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/drawings/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    await queries.deleteDrawing(id, userId);
    res.json({ success: true, message: 'Drawing and all historical revisions deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= IMAGES & SITE TIMELINE (Multi-Tenant User Scoped) =================
app.get('/api/projects/:id/images', ensureAuthenticated, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const category = req.query.category;
    const images = await queries.getProjectImages(projectId, userId, category);
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/timeline', ensureAuthenticated, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const sort = req.query.sort || 'ASC';
    const timeline = await queries.getProjectTimeline(projectId, userId, sort);
    res.json(timeline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/images', ensureAuthenticated, upload.single('file'), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const { title, date, category, description, location_area } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Image title is required' });
    }
    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    let fileUrl = '/assets/concept_render.svg';
    let fileName = 'site_photo.jpg';
    let fileSize = 350000;

    if (req.file) {
      await processUploadedFile(req.file);
      fileUrl = req.file.path;
      fileName = req.file.originalname;
      fileSize = req.file.size;
    } else if (req.body.preset_asset) {
      fileUrl = req.body.preset_asset;
      fileName = req.body.preset_asset.split('/').pop();
    }

    const result = await queries.createProjectImage(
      projectId,
      userId,
      title.trim(),
      date,
      category || 'Site',
      description,
      location_area,
      req.user.name,
      fileName,
      fileUrl,
      fileSize
    );

    res.json({ success: true, id: result.lastInsertRowid, message: 'Image logged into project timeline' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/images/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    await queries.deleteProjectImage(id, userId);
    res.json({ success: true, message: 'Image deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= TASKS (Multi-Tenant User Scoped) =================
app.get('/api/tasks', ensureAuthenticated, async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const projectId = req.query.project_id ? parseInt(req.query.project_id, 10) : null;
    const tasks = await queries.getTasks(userId, projectId);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', ensureAuthenticated, async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { title, project_id, due_date } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Task title is required' });
    }
    const result = await queries.createTask(userId, project_id ? parseInt(project_id, 10) : null, title.trim(), due_date);
    res.json({ success: true, id: result.lastInsertRowid, message: 'Task created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/tasks/:id/status', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    const { status } = req.body;
    await queries.updateTaskStatus(id, userId, status || 'Completed');
    res.json({ success: true, message: 'Task status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', ensureAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = getAuthUserId(req);
    await queries.deleteTask(id, userId);
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Error handling middleware for Multer or API errors
app.use((err, req, res, next) => {
  console.error('API / Upload Error:', err.message || err);
  res.status(err.status || 500).json({ error: err.message || 'An unexpected server error occurred during upload' });
});

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Initialize database schema and start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🏛️  ArchiDesk Studio server running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Fatal: Failed to initialize database:', err);
  process.exit(1);
});
