require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { initDatabase, queries, hashPassword } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static client assets
app.use(express.static(path.join(__dirname, '..', 'public')));

// Auth Middleware
async function authRequired(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace('Bearer ', '').trim() : req.query.token;

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const session = await queries.getSession(token);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
    }

    req.user = session;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
}

// ================= AUTH ROUTES =================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, studio_name, role } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email address is required' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await queries.getUserByEmail(cleanEmail);
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists. Please log in.' });
    }

    const newUserId = await queries.createUser(
      cleanEmail,
      password,
      name ? name.trim() : 'Er. Shivansh',
      studio_name ? studio_name.trim() : 'SHASWAT DESIGNS',
      role ? role.trim() : 'Principal Architect'
    );

    const user = await queries.getUserById(newUserId);
    const session = await queries.createSession(user.id);

    res.json({
      success: true,
      message: 'Account registered successfully',
      token: session.token,
      expiresAt: session.expiresAt,
      user
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await queries.getUserByEmail(cleanEmail);
    if (!user) {
      return res.status(401).json({ error: 'No account found with this email. Click "Register New Account" to sign up!' });
    }

    if (user.password_hash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    const session = await queries.createSession(user.id);
    res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        studio_name: user.studio_name,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Google Authentication Route
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential, google_id, email, name, avatar_url, studio_name, role } = req.body;

    let finalGoogleId = google_id;
    let finalEmail = email;
    let finalName = name;
    let finalAvatar = avatar_url;

    // If Google Identity Services JWT credential is provided, decode/verify it
    if (credential) {
      try {
        const gRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
          signal: AbortSignal.timeout(4000)
        });
        if (gRes.ok) {
          const payload = await gRes.json();
          finalGoogleId = payload.sub;
          finalEmail = payload.email;
          finalName = payload.name || payload.given_name;
          finalAvatar = payload.picture;
        } else {
          const parts = credential.split('.');
          if (parts.length === 3) {
            const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            finalGoogleId = claims.sub || finalGoogleId;
            finalEmail = claims.email || finalEmail;
            finalName = claims.name || claims.given_name || finalName;
            finalAvatar = claims.picture || finalAvatar;
          }
        }
      } catch (tokenErr) {
        try {
          const parts = credential.split('.');
          if (parts.length === 3) {
            const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            finalGoogleId = claims.sub || finalGoogleId;
            finalEmail = claims.email || finalEmail;
            finalName = claims.name || claims.given_name || finalName;
            finalAvatar = claims.picture || finalAvatar;
          }
        } catch (e) {}
      }
    }

    if (!finalEmail || !finalEmail.trim()) {
      return res.status(400).json({ error: 'Valid Google account email is required' });
    }

    const cleanEmail = finalEmail.trim().toLowerCase();
    const cleanGoogleId = finalGoogleId ? String(finalGoogleId).trim() : `g_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;

    const user = await queries.createOrUpdateGoogleUser({
      googleId: cleanGoogleId,
      email: cleanEmail,
      name: finalName ? finalName.trim() : 'Google Architect',
      avatarUrl: finalAvatar || null,
      studioName: studio_name ? studio_name.trim() : undefined,
      role: role ? role.trim() : 'Principal Architect'
    });

    const session = await queries.createSession(user.id);

    res.json({
      success: true,
      message: 'Signed in with Google successfully',
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
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
    console.error('Google Sign-In error:', err);
    res.status(500).json({ error: err.message || 'Error authenticating with Google' });
  }
});

app.put('/api/auth/profile', authRequired, async (req, res) => {
  try {
    const { name, studio_name, email, role } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Principal architect/engineer name is required' });
    }

    await queries.updateUserProfile(
      req.user.user_id,
      name.trim(),
      studio_name && studio_name.trim() ? studio_name.trim() : 'SHASWAT DESIGNS',
      email && email.trim() ? email.trim() : req.user.email,
      role && role.trim() ? role.trim() : req.user.role
    );

    const updated = await queries.getUserById(req.user.user_id);
    res.json({ success: true, message: 'Principal profile updated successfully', user: updated });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace('Bearer ', '').trim() : req.body.token;
    if (token) {
      await queries.deleteSession(token);
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({
    user: {
      id: req.user.user_id,
      email: req.user.email,
      name: req.user.name,
      studio_name: req.user.studio_name,
      role: req.user.role,
      google_id: req.user.google_id,
      avatar_url: req.user.avatar_url,
      auth_provider: req.user.auth_provider
    }
  });
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
