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
const { initDatabase, queries, hashPassword } = require('./db');
const { sendOTPEmail } = require('./email');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust reverse proxy (for Render or cloud environments)
app.set('trust proxy', 1);

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
  secret: process.env.SESSION_SECRET || 'archidesk-studio-session-secret-2026',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
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

// Auth Middleware (supports Passport session with 2FA check and Bearer/Cookie token)
async function authRequired(req, res, next) {
  try {
    // 1. Block access if user has pending 2FA that is not yet verified
    if (req.session && req.session.pendingEmail && !req.session.is2FAVerified) {
      if (req.accepts('html') && !req.is('json') && !req.path.startsWith('/api')) {
        return res.redirect('/verify-otp');
      }
      return res.status(403).json({ error: '2FA verification required', redirect: '/verify-otp' });
    }

    // 2. Session-based authentication (Passport / Google OAuth)
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      if (req.session && req.session.is2FAVerified === false) {
        return res.status(403).json({ error: '2FA verification required', redirect: '/verify-otp' });
      }
      if (!req.user.user_id && req.user.id) {
        req.user.user_id = req.user.id;
      }
      return next();
    }

    // 3. Token-based authentication
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: No token or session provided' });
    }

    const sessionData = await queries.getSession(token);
    if (!sessionData) {
      return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
    }

    req.user = sessionData;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
}

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
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// GET /api/auth/google/callback - Handles Google OAuth callback & triggers Email OTP
app.get(
  '/api/auth/google/callback',
  (req, res, next) => {
    if (!googleClientId || !googleClientSecret) {
      return res.redirect('/login');
    }
    passport.authenticate('google', { failureRedirect: '/login' })(req, res, next);
  },
  async (req, res) => {
    try {
      const user = req.user;
      if (!user || !user.email) {
        return res.redirect('/login');
      }

      // Generate a random 6-digit numeric OTP code
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Store in Turso otps table with expires_at = datetime('now', '+5 minutes') (clears old OTPs first)
      await queries.saveOTP(user.email, otp);

      // Send email via Nodemailer
      await sendOTPEmail(user.email, otp).catch(err => {
        console.error('Failed to send OTP email:', err.message);
      });

      // Do NOT grant full workspace access yet. Set session state:
      req.session.pendingEmail = user.email;
      req.session.is2FAVerified = false;
      req.session.lastOtpSentAt = Date.now();

      // Clear any prior auth cookies
      res.clearCookie('archidesk_token');

      // Redirect user to /verify-otp
      res.redirect('/verify-otp');
    } catch (err) {
      console.error('Google callback error:', err);
      res.redirect('/login');
    }
  }
);

// GET /api/auth/otp-status - Returns pending email for 2FA or 401 if unauthenticated
app.get('/api/auth/otp-status', (req, res) => {
  if (!req.session || !req.session.pendingEmail) {
    return res.status(401).json({ error: 'No pending OTP verification session found.' });
  }
  res.json({ email: req.session.pendingEmail });
});

// POST /api/auth/verify-otp - Validates OTP code, clears OTP, sets is2FAVerified = true
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { otp } = req.body;
    const email = req.session ? req.session.pendingEmail : null;

    if (!email) {
      return res.status(401).json({ message: 'Session expired or invalid. Please sign in again.' });
    }

    if (!otp || String(otp).trim().length !== 6) {
      return res.status(400).json({ message: 'Please enter a valid 6-digit verification code.' });
    }

    // Validates against Turso otps table for req.session.pendingEmail where expires_at > CURRENT_TIMESTAMP
    const validOtp = await queries.verifyOTP(email, String(otp).trim());
    if (!validOtp) {
      return res.status(400).json({ message: 'Invalid or expired OTP code.' });
    }

    // Delete the code from otps
    await queries.deleteOTP(email);

    // Look up user
    const user = await queries.getUserByEmail(email);
    if (!user) {
      return res.status(400).json({ message: 'User account not found.' });
    }

    // Set 2FA Verified in session
    req.session.is2FAVerified = true;
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

    return res.json({
      success: true,
      redirect: '/',
      token: sessionData.token,
      user: req.session.user
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ message: 'Internal server error verifying OTP.' });
  }
});

// POST /api/auth/resend-otp - Resends OTP with 60-second cooldown protection
app.post('/api/auth/resend-otp', async (req, res) => {
  try {
    const email = req.session ? req.session.pendingEmail : null;
    if (!email) {
      return res.status(401).json({ message: 'No pending OTP verification session found.' });
    }

    const now = Date.now();
    const lastSent = req.session.lastOtpSentAt || 0;
    const elapsedSeconds = Math.floor((now - lastSent) / 1000);

    if (elapsedSeconds < 60) {
      const waitSeconds = 60 - elapsedSeconds;
      return res.status(429).json({
        message: `Please wait ${waitSeconds} seconds before requesting a new code.`,
        cooldownRemaining: waitSeconds
      });
    }

    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    await queries.saveOTP(email, newOtp);
    await sendOTPEmail(email, newOtp).catch(err => {
      console.error('Failed to resend OTP email:', err.message);
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

// GET /api/auth/me - Returns current authenticated user or { user: null }
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

    // 2. Session-based authentication via Passport (Google OAuth)
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

    // 3. Token-based authentication
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

    // 4. Unauthenticated
    return res.json({ user: null });
  } catch (err) {
    console.error('Auth /me error:', err);
    return res.json({ user: null });
  }
});

// POST /api/auth/logout - Destroys session, clears cookies, returns { success: true }
app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = extractToken(req) || req.body?.token;
    if (token) {
      await queries.deleteSession(token);
    }

    res.clearCookie('archidesk_token');
    res.clearCookie('connect.sid');

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
app.put('/api/auth/profile', authRequired, async (req, res) => {
  try {
    const { name, studio_name, email, role } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Principal architect/engineer name is required' });
    }

    const currentUserId = req.user.user_id || req.user.id;
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

// ================= DASHBOARD SUMMARY =================
app.get('/api/dashboard/stats', authRequired, async (req, res) => {
  try {
    const stats = await queries.getDashboardStats(req.user.user_id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= PROJECT TYPES =================
app.get('/api/project-types', authRequired, async (req, res) => {
  try {
    const types = await queries.getProjectTypes();
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/project-types', authRequired, async (req, res) => {
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

app.put('/api/project-types/:id', authRequired, async (req, res) => {
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

app.delete('/api/project-types/:id', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await queries.deleteProjectType(id);
    res.json({ success: true, message: 'Project type deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ================= CLIENTS =================
app.get('/api/clients', authRequired, async (req, res) => {
  try {
    const clients = await queries.getClients(req.user.user_id);
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/:id', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const client = await queries.getClientById(id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients', authRequired, async (req, res) => {
  try {
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

    const result = await queries.createClient(name.trim(), cleanPhone, email, address, company_name, notes, req.user.user_id);
    res.json({ success: true, id: result.lastInsertRowid, message: 'Client created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clients/:id', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
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

    await queries.updateClient(id, name.trim(), cleanPhone, email, address, company_name, notes);
    res.json({ success: true, message: 'Client updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await queries.deleteClient(id);
    res.json({ success: true, message: 'Client deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ================= PROJECTS =================
app.get('/api/projects', authRequired, async (req, res) => {
  try {
    const filters = {
      user_id: req.user.user_id,
      status: req.query.status,
      project_type_id: req.query.project_type_id ? parseInt(req.query.project_type_id, 10) : undefined,
      client_id: req.query.client_id ? parseInt(req.query.client_id, 10) : undefined,
      location: req.query.location,
      search: req.query.search
    };
    const projects = await queries.getProjects(filters);
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const project = await queries.getProjectById(id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', authRequired, async (req, res) => {
  try {
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
      req.user.user_id
    );
    res.json({ success: true, id: result.lastInsertRowid, message: 'Project created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { client_id, project_type_id, name, location, status, start_date, expected_completion_date, total_fee, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    const feeNum = parseFloat(total_fee) || 0;
    await queries.updateProject(
      id,
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
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/projects/:id/status', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!['Active', 'Completed', 'Pre-Planning'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be Active, Completed, or Pre-Planning' });
    }
    await queries.updateProjectStatus(id, status);
    res.json({ success: true, status, message: `Project status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await queries.deleteProject(id);
    res.json({ success: true, message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= ACCOUNTS & PAYMENTS =================
app.get('/api/accounts/summary', authRequired, async (req, res) => {
  try {
    const summary = await queries.getAccountsSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/payments', authRequired, async (req, res) => {
  try {
    const projectId = req.query.project_id ? parseInt(req.query.project_id, 10) : null;
    const payments = await queries.getPayments(projectId);
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payments', authRequired, async (req, res) => {
  try {
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

    const proj = await queries.getProjectById(parseInt(project_id, 10));
    if (!proj) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const remainingBalance = Math.max(0, proj.total_fee - proj.received_amount);
    if (remainingBalance <= 0) {
      return res.status(400).json({
        error: `Project "${proj.name}" is already fully settled (₹0 balance). You cannot receive additional payments.`
      });
    }
    if (amtNum > remainingBalance) {
      return res.status(400).json({
        error: `Payment amount (₹${amtNum.toLocaleString('en-IN')}) cannot exceed remaining balance of ₹${remainingBalance.toLocaleString('en-IN')}`
      });
    }

    const result = await queries.addPayment(
      parseInt(project_id, 10),
      amtNum,
      payment_date,
      payment_method || 'UPI',
      reference_note
    );

    // Get recalculated project financial data
    const updatedProj = await queries.getProjectById(parseInt(project_id, 10));

    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: 'Payment recorded successfully',
      project: {
        id: updatedProj.id,
        total_fee: updatedProj.total_fee,
        received_amount: updatedProj.received_amount,
        balance_amount: updatedProj.balance_amount
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/payments/:id', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await queries.deletePayment(id);
    res.json({ success: true, message: 'Payment deleted and balance recalculated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= DRAWINGS & REVISIONS =================
app.get('/api/projects/:id/drawings', authRequired, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const drawings = await queries.getDrawings(projectId);
    res.json(drawings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drawings/:id/revisions', authRequired, async (req, res) => {
  try {
    const drawingId = parseInt(req.params.id, 10);
    const drawingWithRevs = await queries.getDrawingWithRevisions(drawingId);
    if (!drawingWithRevs) {
      return res.status(404).json({ error: 'Drawing not found' });
    }
    res.json(drawingWithRevs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/drawings', authRequired, upload.single('file'), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
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

app.post('/api/drawings/:id/revisions', authRequired, upload.single('file'), async (req, res) => {
  try {
    const drawingId = parseInt(req.params.id, 10);
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

app.put('/api/drawings/:id', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, drawing_number, category, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Drawing name is required' });
    }
    await queries.updateDrawing(id, name.trim(), drawing_number, category, description);
    res.json({ success: true, message: 'Drawing details updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/drawings/:id', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await queries.deleteDrawing(id);
    res.json({ success: true, message: 'Drawing and all historical revisions deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= IMAGES & SITE TIMELINE =================
app.get('/api/projects/:id/images', authRequired, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const category = req.query.category;
    const images = await queries.getProjectImages(projectId, category);
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/timeline', authRequired, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const sort = req.query.sort || 'ASC';
    const timeline = await queries.getProjectTimeline(projectId, sort);
    res.json(timeline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/images', authRequired, upload.single('file'), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
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

app.delete('/api/images/:id', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await queries.deleteProjectImage(id);
    res.json({ success: true, message: 'Image deleted' });
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
