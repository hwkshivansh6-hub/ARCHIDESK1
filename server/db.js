const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'archimanager.db');
const db = new DatabaseSync(DB_PATH);

// Enable foreign keys and WAL mode
db.exec('PRAGMA foreign_keys = ON;');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + '_archisalt_2026').digest('hex');
}

function initDatabase() {
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      studio_name TEXT DEFAULT 'SHASWAT DESIGNS',
      role TEXT DEFAULT 'Principal Architect',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      is_default INTEGER DEFAULT 0,
      badge_color TEXT DEFAULT '#2563eb',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      company_name TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      project_type_id INTEGER NOT NULL REFERENCES project_types(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Active', 'Completed', 'Pre-Planning')) DEFAULT 'Active',
      start_date TEXT,
      expected_completion_date TEXT,
      total_fee REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      amount REAL NOT NULL CHECK(amount > 0),
      payment_date TEXT NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other')) DEFAULT 'UPI',
      reference_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drawings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      drawing_number TEXT,
      category TEXT NOT NULL,
      description TEXT,
      uploaded_by TEXT DEFAULT 'Architect',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drawing_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
      revision_code TEXT NOT NULL,
      revision_note TEXT,
      revision_date TEXT NOT NULL,
      file_name TEXT,
      file_url TEXT,
      file_size INTEGER DEFAULT 0,
      file_type TEXT DEFAULT 'PDF',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('Site', 'Progress', 'Design', 'Completed', 'Other')) DEFAULT 'Site',
      description TEXT,
      location_area TEXT,
      uploaded_by TEXT DEFAULT 'Architect',
      file_name TEXT,
      file_url TEXT,
      file_size INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
    CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(project_type_id);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_payments_project ON payments(project_id);
    CREATE INDEX IF NOT EXISTS idx_drawings_project ON drawings(project_id);
    CREATE INDEX IF NOT EXISTS idx_revisions_drawing ON drawing_revisions(drawing_id);
    CREATE INDEX IF NOT EXISTS idx_images_project ON project_images(project_id);
  `);

  // Schema upgrades for Google Authentication & Real-Time User Data Sync
  try {
    db.exec("ALTER TABLE users ADD COLUMN google_id TEXT;");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT;");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'local';");
  } catch (e) {}
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;");
  } catch (e) {}

  try {
    db.exec("ALTER TABLE clients ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE projects ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;");
  } catch (e) {}
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);");
  } catch (e) {}

  // Backfill existing demo data to default studio user (user_id = 1)
  try {
    db.exec("UPDATE clients SET user_id = 1 WHERE user_id IS NULL;");
    db.exec("UPDATE projects SET user_id = 1 WHERE user_id IS NULL;");
  } catch (e) {}

  seedDefaultData();
}

function seedDefaultData() {
  // Check if default user exists
  const existingUser = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!existingUser) {
    const insertUser = db.prepare(`
      INSERT INTO users (email, password_hash, name, studio_name, role)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertUser.run(
      'architect@archidesk.com',
      hashPassword('studio2026'),
      'Er. Shivansh',
      'SHASWAT DESIGNS',
      'Principal Architect'
    );
  } else {
    // Ensure studio name is updated to SHASWAT DESIGNS
    db.exec("UPDATE users SET studio_name = 'SHASWAT DESIGNS' WHERE studio_name = 'Atelier Architecture Studio' OR studio_name IS NULL;");
  }

  // Seed default project types
  const defaultTypes = [
    { name: 'Residential', color: '#b78a56' },
    { name: 'Commercial', color: '#1d4ed8' },
    { name: 'Interior', color: '#0d9488' },
    { name: 'Renovation', color: '#d97706' },
    { name: 'Office', color: '#4f46e5' },
    { name: 'Retail', color: '#e11d48' },
    { name: 'Hospitality', color: '#7c3aed' },
    { name: 'Institutional', color: '#0284c7' },
    { name: 'Landscape', color: '#16a34a' },
    { name: 'Other', color: '#64748b' }
  ];

  const checkType = db.prepare('SELECT id FROM project_types WHERE name = ?');
  const insertType = db.prepare('INSERT INTO project_types (name, is_default, badge_color) VALUES (?, 1, ?)');

  for (const t of defaultTypes) {
    if (!checkType.get(t.name)) {
      insertType.run(t.name, t.color);
    }
  }

  // Check if any client exists; if not, seed realistic data matching prompt
  const existingClient = db.prepare('SELECT id FROM clients LIMIT 1').get();
  if (!existingClient) {
    // 1. Clients
    const insertClient = db.prepare(`
      INSERT INTO clients (name, phone, email, address, company_name, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const rahulRes = insertClient.run(
      'Rahul Sharma',
      '+91 98765 43210',
      'rahul.sharma@example.com',
      'Sector 4, Gomti Nagar, Lucknow, UP',
      'Sharma & Sons Enterprises',
      'Prefers bioclimatic design, natural sandstone facade, and minimal open spaces.'
    );
    const rahulId = rahulRes.lastInsertRowid;

    const priyaRes = insertClient.run(
      'Priya Verma',
      '+91 98111 22334',
      'priya.verma@vermaestates.in',
      '14 Park Road, Hazratganj, Lucknow, UP',
      'Verma Estates & Living',
      'Luxury penthouse renovation with Italian marble and smart home integration.'
    );
    const priyaId = priyaRes.lastInsertRowid;

    const arindamRes = insertClient.run(
      'Arindam Sen',
      '+91 97222 33445',
      'sen@zenithtech.in',
      'Tower B, Cyber City, Gurgaon, HR',
      'Zenith Tech Labs',
      'Corporate open workspace with biophilic acoustics.'
    );
    const arindamId = arindamRes.lastInsertRowid;

    // Get type IDs
    const resTypeId = db.prepare('SELECT id FROM project_types WHERE name = ?').get('Residential').id;
    const intTypeId = db.prepare('SELECT id FROM project_types WHERE name = ?').get('Interior').id;
    const renTypeId = db.prepare('SELECT id FROM project_types WHERE name = ?').get('Renovation').id;
    const offTypeId = db.prepare('SELECT id FROM project_types WHERE name = ?').get('Office').id;

    // 2. Projects
    const insertProject = db.prepare(`
      INSERT INTO projects (client_id, project_type_id, name, location, status, start_date, expected_completion_date, total_fee, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Project: Sharma Residence (Active, Fee 50000, Received 10000 -> Balance 40000)
    const sharmaRes = insertProject.run(
      rahulId,
      resTypeId,
      'Sharma Residence',
      'Lucknow',
      'Active',
      '2026-08-01',
      '2027-04-30',
      50000,
      'G+2 contemporary sustainable villa with double-height central atrium, courtyard cooling, and rooftop solar terrace.'
    );
    const sharmaProjId = sharmaRes.lastInsertRowid;

    // Project: Sharma Office Interior (Pre-Planning)
    insertProject.run(
      rahulId,
      intTypeId,
      'Sharma Office Interior',
      'Vibhuti Khand, Lucknow',
      'Pre-Planning',
      '2026-10-15',
      '2027-01-20',
      35000,
      'Executive cabin redesign with acoustic timber battens and concealed warm lighting.'
    );

    // Project: Verma Penthouse (Completed, Fee 85000, Received 85000)
    const vermaRes = insertProject.run(
      priyaId,
      renTypeId,
      'Verma Penthouse',
      'Hazratganj, Lucknow',
      'Completed',
      '2026-01-10',
      '2026-07-28',
      85000,
      'Full interior transformation including bespoke kitchen, terrace deck garden, and walk-in wardrobe.'
    );
    const vermaProjId = vermaRes.lastInsertRowid;

    // Project: Zenith Tech Workspace (Active)
    const zenithRes = insertProject.run(
      arindamId,
      offTypeId,
      'Zenith Innovation Hub',
      'Cyber City, Gurgaon',
      'Active',
      '2026-06-15',
      '2026-12-31',
      120000,
      'Modular 120-seat tech studio with collaboration pods and exposed architectural ceiling.'
    );
    const zenithProjId = zenithRes.lastInsertRowid;

    // 3. Payments
    const insertPayment = db.prepare(`
      INSERT INTO payments (project_id, client_id, amount, payment_date, payment_method, reference_note)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    // Sharma Residence payment: ₹10,000 received (UPI)
    insertPayment.run(sharmaProjId, rahulId, 10000, '2026-08-15', 'UPI', 'Advance token on approval of concept drawings (UPI Ref: UPI-8492048)');

    // Verma Penthouse payments (total 85000)
    insertPayment.run(vermaProjId, priyaId, 30000, '2026-01-15', 'Bank Transfer', 'Initial Mobilization Deposit');
    insertPayment.run(vermaProjId, priyaId, 35000, '2026-04-10', 'Cheque', 'Mid-way Milestone Payment (Chq #440912)');
    insertPayment.run(vermaProjId, priyaId, 20000, '2026-07-30', 'Bank Transfer', 'Final Handover Settlement');

    // Zenith payment
    insertPayment.run(zenithProjId, arindamId, 50000, '2026-06-20', 'Bank Transfer', 'Phase 1 Structural Design Signoff');

    // 4. Drawings for Sharma Residence
    const insertDrawing = db.prepare(`
      INSERT INTO drawings (project_id, name, drawing_number, category, description, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertRevision = db.prepare(`
      INSERT INTO drawing_revisions (drawing_id, revision_code, revision_note, revision_date, file_name, file_url, file_size, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Drawing 1: Ground Floor Layout
    const d1 = insertDrawing.run(
      sharmaProjId,
      'Ground Floor Layout Plan',
      'ARC-SR-101',
      'Floor plans',
      'Detailed architectural space planning showing master bedroom, foyer, double-height living, and open kitchen.',
      'Ar. Ishan Sharma'
    ).lastInsertRowid;

    insertRevision.run(d1, 'R00', 'Initial architectural schematic concept layout', '2026-08-05', 'SR_GF_Plan_R00.pdf', '/assets/sample-floorplan.svg', 142000, 'PDF');
    insertRevision.run(d1, 'R01', 'Kitchen pantry extended & utility corridor modified', '2026-08-14', 'SR_GF_Plan_R01.pdf', '/assets/sample-floorplan.svg', 148500, 'PDF');
    insertRevision.run(d1, 'R02', 'Final approved layout with staircase structural column alignment', '2026-08-28', 'SR_GF_Plan_R02.pdf', '/assets/sample-floorplan.svg', 152000, 'PDF');

    // Drawing 2: Front Elevation Detail
    const d2 = insertDrawing.run(
      sharmaProjId,
      'North Front Elevation',
      'ARC-SR-201',
      'Elevations',
      'Exterior facade detailing terracotta vertical louvers, exposed concrete finish, and cantilever balcony.',
      'Ar. Ishan Sharma'
    ).lastInsertRowid;

    insertRevision.run(d2, 'R00', 'Initial facade massing & window proportion study', '2026-08-10', 'SR_Elevation_R00.dwg', '/assets/sample-elevation.svg', 210000, 'DWG');
    insertRevision.run(d2, 'R01', 'Balcony louvers orientation and cantilever beam depth adjusted', '2026-08-22', 'SR_Elevation_R01.dwg', '/assets/sample-elevation.svg', 218000, 'DWG');

    // Drawing 3: Structural Section A-A
    const d3 = insertDrawing.run(
      sharmaProjId,
      'Cross Section A-A & Slab Heights',
      'ARC-SR-301',
      'Sections',
      'Full transverse section cutting through central courtyard and double-height skylight zone.',
      'Er. K. Mehta (Structural)'
    ).lastInsertRowid;

    insertRevision.run(d3, 'R00', 'Issued for structural tender and footing coordinates', '2026-08-18', 'SR_Section_AA_R00.pdf', '/assets/sample-section.svg', 189000, 'PDF');

    // 5. Site Photo Timeline for Sharma Residence
    const insertImage = db.prepare(`
      INSERT INTO project_images (project_id, title, date, category, description, location_area, uploaded_by, file_name, file_url, file_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertImage.run(
      sharmaProjId,
      'Site Excavation & Boundary Marking',
      '2026-08-10',
      'Site',
      'Initial JCB trenching completed. Soil tested and boundary perimeter pinned with baseline markers.',
      'North & East Boundary',
      'Ar. Ishan Sharma',
      'site_excavation_01.jpg',
      '/assets/site_excavation.svg',
      320000
    );

    insertImage.run(
      sharmaProjId,
      'Raft Foundation & Rebar Binding',
      '2026-08-25',
      'Progress',
      'PCC layer cured. 16mm rebar mesh bound with dual-tier spacers prior to M25 concrete pour.',
      'Main Footprint Grid A-D',
      'Site Engineer Verma',
      'foundation_rebar.jpg',
      '/assets/foundation.svg',
      410000
    );

    insertImage.run(
      sharmaProjId,
      'Ground Floor Columns & Formwork',
      '2026-09-05',
      'Progress',
      '12 primary columns shuttered with marine ply and vibrator compaction during casting.',
      'Central Atrium & Porch',
      'Ar. Ishan Sharma',
      'columns_cast.jpg',
      '/assets/columns.svg',
      390000
    );

    insertImage.run(
      sharmaProjId,
      'External Brickwork & Lintel Beams',
      '2026-09-15',
      'Progress',
      'Autoclaved Aerated Concrete (AAC) blocks laid up to 7ft lintel level with damp-proof membrane.',
      'South Courtyard Facade',
      'Site Engineer Verma',
      'brickwork_progress.jpg',
      '/assets/brickwork.svg',
      450000
    );

    insertImage.run(
      sharmaProjId,
      '3D Architectural Concept Render',
      '2026-08-04',
      'Design',
      'Daylight simulation render illustrating natural solar penetration during winter solstice.',
      'Exterior Perspective',
      'Studio 3D Visualizer',
      'concept_render_v3.jpg',
      '/assets/concept_render.svg',
      620000
    );
  }
}

// Helper query functions
const queries = {
  // Auth
  getUserByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  },
  getUserById(id) {
    return db.prepare('SELECT id, email, name, studio_name, role, google_id, avatar_url, auth_provider, created_at FROM users WHERE id = ?').get(id);
  },
  getUserByGoogleId(googleId) {
    return db.prepare('SELECT id, email, name, studio_name, role, google_id, avatar_url, auth_provider, created_at FROM users WHERE google_id = ?').get(googleId);
  },
  createOrUpdateGoogleUser({ googleId, email, name, avatarUrl, studioName, role }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    
    // 1. Check by google_id
    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
    if (user) {
      db.prepare(`
        UPDATE users
        SET name = COALESCE(?, name),
            avatar_url = COALESCE(?, avatar_url),
            auth_provider = 'google'
        WHERE id = ?
      `).run(name ? name.trim() : user.name, avatarUrl || user.avatar_url, user.id);
      return db.prepare('SELECT id, email, name, studio_name, role, google_id, avatar_url, auth_provider, created_at FROM users WHERE id = ?').get(user.id);
    }

    // 2. Check by email
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (user) {
      db.prepare(`
        UPDATE users
        SET google_id = ?,
            name = COALESCE(?, name),
            avatar_url = COALESCE(?, avatar_url),
            auth_provider = 'google'
        WHERE id = ?
      `).run(googleId, name ? name.trim() : user.name, avatarUrl || user.avatar_url, user.id);
      return db.prepare('SELECT id, email, name, studio_name, role, google_id, avatar_url, auth_provider, created_at FROM users WHERE id = ?').get(user.id);
    }

    // 3. Insert new Google user
    const dummyHash = hashPassword(crypto.randomBytes(24).toString('hex'));
    const finalName = name ? name.trim() : 'Architect';
    const finalStudio = studioName ? studioName.trim() : `${finalName}'s Studio`;
    const finalRole = role ? role.trim() : 'Principal Architect';

    const res = db.prepare(`
      INSERT INTO users (email, password_hash, name, studio_name, role, google_id, avatar_url, auth_provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'google')
    `).run(cleanEmail, dummyHash, finalName, finalStudio, finalRole, googleId, avatarUrl || null);

    return db.prepare('SELECT id, email, name, studio_name, role, google_id, avatar_url, auth_provider, created_at FROM users WHERE id = ?').get(res.lastInsertRowid);
  },
  createUser(email, password, name = 'Er. Shivansh', studioName = 'SHASWAT DESIGNS', role = 'Principal Architect') {
    const hash = hashPassword(password);
    const stmt = db.prepare(`
      INSERT INTO users (email, password_hash, name, studio_name, role, auth_provider)
      VALUES (?, ?, ?, ?, ?, 'local')
    `);
    const res = stmt.run(email.trim().toLowerCase(), hash, name.trim(), studioName.trim(), role.trim());
    return res.lastInsertRowid;
  },
  updateUserProfile(userId, name, studioName, email, role) {
    const stmt = db.prepare(`
      UPDATE users
      SET name = ?, studio_name = ?, email = ?, role = ?
      WHERE id = ?
    `);
    return stmt.run(name.trim(), studioName.trim(), email.trim().toLowerCase(), role.trim(), userId);
  },
  createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    // Persistent session for 365 days (1 year)
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
    return { token, expiresAt };
  },
  getSession(token) {
    const session = db.prepare(`
      SELECT s.*, u.id as user_id, u.email, u.name, u.studio_name, u.role, u.google_id, u.avatar_url, u.auth_provider
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
    `).get(token);
    return session;
  },
  deleteSession(token) {
    return db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },

  // Project Types
  getProjectTypes() {
    return db.prepare(`
      SELECT pt.*, COUNT(p.id) as project_count
      FROM project_types pt
      LEFT JOIN projects p ON pt.id = p.project_type_id
      GROUP BY pt.id
      ORDER BY pt.is_default DESC, pt.name ASC
    `).all();
  },
  getProjectTypeById(id) {
    return db.prepare('SELECT * FROM project_types WHERE id = ?').get(id);
  },
  createProjectType(name, badgeColor = '#2563eb') {
    const stmt = db.prepare('INSERT INTO project_types (name, is_default, badge_color) VALUES (?, 0, ?)');
    return stmt.run(name, badgeColor);
  },
  updateProjectType(id, name, badgeColor) {
    const stmt = db.prepare('UPDATE project_types SET name = ?, badge_color = ? WHERE id = ?');
    return stmt.run(name, badgeColor, id);
  },
  deleteProjectType(id) {
    // Check if any project is using this type
    const count = db.prepare('SELECT COUNT(*) as c FROM projects WHERE project_type_id = ?').get(id).c;
    if (count > 0) {
      throw new Error(`Cannot delete: this project type is assigned to ${count} active project(s).`);
    }
    return db.prepare('DELETE FROM project_types WHERE id = ? AND is_default = 0').run(id);
  },

  // Clients
  getClients(userId = null) {
    let sql = `
      SELECT c.*,
        COUNT(DISTINCT p.id) as total_projects,
        COALESCE(SUM(p.total_fee), 0) as total_deal_amount,
        COALESCE(SUM(pmt.amount), 0) as total_received,
        (COALESCE(SUM(p.total_fee), 0) - COALESCE(SUM(pmt.amount), 0)) as total_balance
      FROM clients c
      LEFT JOIN projects p ON c.id = p.client_id
      LEFT JOIN payments pmt ON p.id = pmt.project_id
    `;
    const params = [];
    if (userId !== null && userId !== undefined) {
      sql += ' WHERE (c.user_id = ? OR c.user_id IS NULL)';
      params.push(userId);
    }
    sql += `
      GROUP BY c.id
      ORDER BY c.name ASC
    `;
    return db.prepare(sql).all(...params);
  },
  getClientById(id) {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!client) return null;
    const projects = db.prepare(`
      SELECT p.*, pt.name as project_type_name, pt.badge_color,
        COALESCE(SUM(pmt.amount), 0) as received_amount,
        (p.total_fee - COALESCE(SUM(pmt.amount), 0)) as balance_amount
      FROM projects p
      JOIN project_types pt ON p.project_type_id = pt.id
      LEFT JOIN payments pmt ON p.id = pmt.project_id
      WHERE p.client_id = ?
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `).all(id);
    return { ...client, projects };
  },
  createClient(name, phone, email, address, company_name, notes, userId = null) {
    const stmt = db.prepare(`
      INSERT INTO clients (name, phone, email, address, company_name, notes, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(name, phone || null, email || null, address || null, company_name || null, notes || null, userId || 1);
  },
  updateClient(id, name, phone, email, address, company_name, notes) {
    const stmt = db.prepare(`
      UPDATE clients
      SET name = ?, phone = ?, email = ?, address = ?, company_name = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(name, phone || null, email || null, address || null, company_name || null, notes || null, id);
  },
  deleteClient(id) {
    const count = db.prepare('SELECT COUNT(*) as c FROM projects WHERE client_id = ?').get(id).c;
    if (count > 0) {
      throw new Error(`Cannot delete client: has ${count} associated project(s).`);
    }
    return db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  },

  // Projects
  getProjects(filters = {}) {
    let sql = `
      SELECT p.*,
        c.name as client_name, c.phone as client_phone, c.email as client_email,
        pt.name as project_type_name, pt.badge_color,
        COALESCE(SUM(pmt.amount), 0) as received_amount,
        (p.total_fee - COALESCE(SUM(pmt.amount), 0)) as balance_amount,
        (SELECT COUNT(*) FROM drawings WHERE project_id = p.id) as drawings_count,
        (SELECT COUNT(*) FROM project_images WHERE project_id = p.id) as images_count
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      JOIN project_types pt ON p.project_type_id = pt.id
      LEFT JOIN payments pmt ON p.id = pmt.project_id
      WHERE 1=1
    `;
    const params = [];

    if (filters.user_id !== undefined && filters.user_id !== null) {
      sql += ' AND (p.user_id = ? OR p.user_id IS NULL)';
      params.push(filters.user_id);
    }
    if (filters.status) {
      sql += ' AND p.status = ?';
      params.push(filters.status);
    }
    if (filters.project_type_id) {
      sql += ' AND p.project_type_id = ?';
      params.push(filters.project_type_id);
    }
    if (filters.client_id) {
      sql += ' AND p.client_id = ?';
      params.push(filters.client_id);
    }
    if (filters.location) {
      sql += ' AND LOWER(p.location) LIKE ?';
      params.push(`%${filters.location.toLowerCase()}%`);
    }
    if (filters.search) {
      const q = `%${filters.search.toLowerCase()}%`;
      sql += ' AND (LOWER(p.name) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(pt.name) LIKE ? OR LOWER(p.location) LIKE ?)';
      params.push(q, q, q, q);
    }

    sql += ' GROUP BY p.id ORDER BY p.updated_at DESC';
    return db.prepare(sql).all(...params);
  },
  getProjectById(id) {
    const project = db.prepare(`
      SELECT p.*,
        c.name as client_name, c.phone as client_phone, c.email as client_email, c.address as client_address, c.company_name as client_company,
        pt.name as project_type_name, pt.badge_color,
        COALESCE(SUM(pmt.amount), 0) as received_amount,
        (p.total_fee - COALESCE(SUM(pmt.amount), 0)) as balance_amount
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      JOIN project_types pt ON p.project_type_id = pt.id
      LEFT JOIN payments pmt ON p.id = pmt.project_id
      WHERE p.id = ?
      GROUP BY p.id
    `).get(id);

    if (!project) return null;

    // Attach payments
    project.payments = db.prepare(`
      SELECT * FROM payments WHERE project_id = ? ORDER BY payment_date DESC, id DESC
    `).all(id);

    // Attach drawings count and images count
    project.drawings_count = db.prepare('SELECT COUNT(*) as c FROM drawings WHERE project_id = ?').get(id).c;
    project.images_count = db.prepare('SELECT COUNT(*) as c FROM project_images WHERE project_id = ?').get(id).c;

    return project;
  },
  createProject(clientId, projectTypeId, name, location, status, startDate, completionDate, totalFee, notes, userId = null) {
    const stmt = db.prepare(`
      INSERT INTO projects (client_id, project_type_id, name, location, status, start_date, expected_completion_date, total_fee, notes, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(clientId, projectTypeId, name, location, status || 'Active', startDate || null, completionDate || null, totalFee || 0, notes || null, userId || 1);
  },
  updateProject(id, clientId, projectTypeId, name, location, status, startDate, completionDate, totalFee, notes) {
    const stmt = db.prepare(`
      UPDATE projects
      SET client_id = ?, project_type_id = ?, name = ?, location = ?, status = ?,
          start_date = ?, expected_completion_date = ?, total_fee = ?, notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(clientId, projectTypeId, name, location, status, startDate || null, completionDate || null, totalFee || 0, notes || null, id);
  },
  updateProjectStatus(id, status) {
    return db.prepare('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
  },
  deleteProject(id) {
    return db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  },

  // Payments / Accounts
  getPayments(projectId = null) {
    if (projectId) {
      return db.prepare(`
        SELECT pmt.*, p.name as project_name, c.name as client_name
        FROM payments pmt
        JOIN projects p ON pmt.project_id = p.id
        JOIN clients c ON pmt.client_id = c.id
        WHERE pmt.project_id = ?
        ORDER BY pmt.payment_date DESC, pmt.id DESC
      `).all(projectId);
    }
    return db.prepare(`
      SELECT pmt.*, p.name as project_name, c.name as client_name, pt.name as project_type_name
      FROM payments pmt
      JOIN projects p ON pmt.project_id = p.id
      JOIN clients c ON pmt.client_id = c.id
      JOIN project_types pt ON p.project_type_id = pt.id
      ORDER BY pmt.payment_date DESC, pmt.id DESC
    `).all();
  },
  addPayment(projectId, amount, paymentDate, paymentMethod, referenceNote) {
    // Get client id from project
    const proj = db.prepare('SELECT client_id FROM projects WHERE id = ?').get(projectId);
    if (!proj) throw new Error('Project not found');

    const stmt = db.prepare(`
      INSERT INTO payments (project_id, client_id, amount, payment_date, payment_method, reference_note)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(projectId, proj.client_id, amount, paymentDate, paymentMethod, referenceNote || null);

    // Update project timestamp
    db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(projectId);

    return res;
  },
  deletePayment(id) {
    const payment = db.prepare('SELECT project_id FROM payments WHERE id = ?').get(id);
    const res = db.prepare('DELETE FROM payments WHERE id = ?').run(id);
    if (payment) {
      db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.project_id);
    }
    return res;
  },
  getAccountsSummary() {
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(p.total_fee), 0) as total_deal_amount,
        COALESCE((SELECT SUM(amount) FROM payments), 0) as total_received
      FROM projects p
    `).get();

    const totalDeal = totals.total_deal_amount;
    const totalReceived = totals.total_received;
    const totalBalance = totalDeal - totalReceived;

    const projectAccounts = db.prepare(`
      SELECT p.id, p.name as project_name, p.location, p.status,
             c.name as client_name,
             pt.name as project_type_name, pt.badge_color,
             p.total_fee as deal_amount,
             COALESCE(SUM(pmt.amount), 0) as received_amount,
             (p.total_fee - COALESCE(SUM(pmt.amount), 0)) as balance_amount,
             MAX(pmt.payment_date) as last_payment_date
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      JOIN project_types pt ON p.project_type_id = pt.id
      LEFT JOIN payments pmt ON p.id = pmt.project_id
      GROUP BY p.id
      ORDER BY balance_amount DESC, p.name ASC
    `).all();

    return {
      total_deal: totalDeal,
      total_received: totalReceived,
      total_balance: totalBalance,
      project_accounts: projectAccounts
    };
  },

  // Drawings
  getDrawings(projectId) {
    const drawings = db.prepare(`
      SELECT d.*,
        (SELECT COUNT(*) FROM drawing_revisions WHERE drawing_id = d.id) as revision_count,
        dr.revision_code as latest_revision,
        dr.revision_date as latest_date,
        dr.revision_note as latest_note,
        dr.file_name as latest_file_name,
        dr.file_url as latest_file_url,
        dr.file_size as latest_file_size,
        dr.file_type as latest_file_type
      FROM drawings d
      LEFT JOIN (
        SELECT dr1.*
        FROM drawing_revisions dr1
        JOIN (
          SELECT drawing_id, MAX(id) as max_id
          FROM drawing_revisions
          GROUP BY drawing_id
        ) dr2 ON dr1.id = dr2.max_id
      ) dr ON d.id = dr.drawing_id
      WHERE d.project_id = ?
      ORDER BY d.updated_at DESC
    `).all(projectId);

    return drawings;
  },
  getDrawingWithRevisions(drawingId) {
    const drawing = db.prepare(`
      SELECT d.*, p.name as project_name
      FROM drawings d
      JOIN projects p ON d.project_id = p.id
      WHERE d.id = ?
    `).get(drawingId);
    if (!drawing) return null;

    drawing.revisions = db.prepare(`
      SELECT * FROM drawing_revisions
      WHERE drawing_id = ?
      ORDER BY id DESC
    `).all(drawingId);

    return drawing;
  },
  createDrawing(projectId, name, drawingNumber, category, description, uploadedBy, revisionCode = 'R00', revisionNote = 'Initial release', fileUrl = '/assets/sample-floorplan.svg', fileName = 'drawing.pdf', fileSize = 150000, fileType = 'PDF') {
    const stmt = db.prepare(`
      INSERT INTO drawings (project_id, name, drawing_number, category, description, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(projectId, name, drawingNumber || null, category, description || null, uploadedBy || 'Architect');
    const drawingId = res.lastInsertRowid;

    // Create initial revision
    const revStmt = db.prepare(`
      INSERT INTO drawing_revisions (drawing_id, revision_code, revision_note, revision_date, file_name, file_url, file_size, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    revStmt.run(
      drawingId,
      revisionCode,
      revisionNote,
      new Date().toISOString().split('T')[0],
      fileName,
      fileUrl,
      fileSize,
      fileType
    );

    db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(projectId);

    return drawingId;
  },
  addDrawingRevision(drawingId, revisionCode, revisionNote, revisionDate, fileName, fileUrl, fileSize = 0, fileType = 'PDF') {
    const revStmt = db.prepare(`
      INSERT INTO drawing_revisions (drawing_id, revision_code, revision_note, revision_date, file_name, file_url, file_size, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = revStmt.run(
      drawingId,
      revisionCode,
      revisionNote || 'Drawing revision update',
      revisionDate || new Date().toISOString().split('T')[0],
      fileName,
      fileUrl,
      fileSize,
      fileType
    );

    db.prepare('UPDATE drawings SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(drawingId);
    return res;
  },
  updateDrawing(id, name, drawingNumber, category, description) {
    return db.prepare(`
      UPDATE drawings
      SET name = ?, drawing_number = ?, category = ?, description = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, drawingNumber || null, category, description || null, id);
  },
  deleteDrawing(id) {
    return db.prepare('DELETE FROM drawings WHERE id = ?').run(id);
  },

  // Images
  getProjectImages(projectId, category = null) {
    if (category && category !== 'All') {
      return db.prepare(`
        SELECT * FROM project_images
        WHERE project_id = ? AND category = ?
        ORDER BY date DESC, id DESC
      `).all(projectId, category);
    }
    return db.prepare(`
      SELECT * FROM project_images
      WHERE project_id = ?
      ORDER BY date DESC, id DESC
    `).all(projectId);
  },
  getProjectTimeline(projectId, sort = 'ASC') {
    const order = sort.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    return db.prepare(`
      SELECT * FROM project_images
      WHERE project_id = ?
      ORDER BY date ${order}, id ${order}
    `).all(projectId);
  },
  createProjectImage(projectId, title, date, category, description, locationArea, uploadedBy, fileName, fileUrl, fileSize = 0) {
    const stmt = db.prepare(`
      INSERT INTO project_images (project_id, title, date, category, description, location_area, uploaded_by, file_name, file_url, file_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(projectId, title, date, category, description || null, locationArea || null, uploadedBy || 'Architect', fileName, fileUrl, fileSize);
    db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(projectId);
    return res;
  },
  deleteProjectImage(id) {
    return db.prepare('DELETE FROM project_images WHERE id = ?').run(id);
  },

  // Dashboard Summary
  getDashboardStats(userId = null) {
    let pUserWhere = "";
    let cUserWhere = "";
    const pParams = [];
    const cParams = [];
    if (userId !== null && userId !== undefined) {
      pUserWhere = " AND (user_id = ? OR user_id IS NULL)";
      cUserWhere = " WHERE (user_id = ? OR user_id IS NULL)";
      pParams.push(userId);
      cParams.push(userId);
    }

    const active = db.prepare(`SELECT COUNT(*) as c FROM projects WHERE status = 'Active'${pUserWhere}`).get(...pParams).c;
    const completed = db.prepare(`SELECT COUNT(*) as c FROM projects WHERE status = 'Completed'${pUserWhere}`).get(...pParams).c;
    const prePlanning = db.prepare(`SELECT COUNT(*) as c FROM projects WHERE status = 'Pre-Planning'${pUserWhere}`).get(...pParams).c;
    const totalClients = db.prepare(`SELECT COUNT(*) as c FROM clients${cUserWhere}`).get(...cParams).c;

    const totalsSql = (userId !== null && userId !== undefined)
      ? `
        SELECT
          COALESCE(SUM(p.total_fee), 0) as total_deal,
          COALESCE((SELECT SUM(amount) FROM payments WHERE project_id IN (SELECT id FROM projects WHERE user_id = ? OR user_id IS NULL)), 0) as total_received
        FROM projects p
        WHERE (p.user_id = ? OR p.user_id IS NULL)
      `
      : `
        SELECT
          COALESCE(SUM(p.total_fee), 0) as total_deal,
          COALESCE((SELECT SUM(amount) FROM payments), 0) as total_received
        FROM projects p
      `;
    const totalsParams = (userId !== null && userId !== undefined) ? [userId, userId] : [];
    const totals = db.prepare(totalsSql).get(...totalsParams);

    const totalDeal = totals ? totals.total_deal : 0;
    const totalReceived = totals ? totals.total_received : 0;
    const totalBalance = totalDeal - totalReceived;

    let recentProjectsSql = `
      SELECT p.*, c.name as client_name, pt.name as project_type_name, pt.badge_color,
             COALESCE(SUM(pmt.amount), 0) as received_amount,
             (p.total_fee - COALESCE(SUM(pmt.amount), 0)) as balance_amount
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      JOIN project_types pt ON p.project_type_id = pt.id
      LEFT JOIN payments pmt ON p.id = pmt.project_id
    `;
    const rpParams = [];
    if (userId !== null && userId !== undefined) {
      recentProjectsSql += ` WHERE (p.user_id = ? OR p.user_id IS NULL)`;
      rpParams.push(userId);
    }
    recentProjectsSql += `
      GROUP BY p.id
      ORDER BY p.updated_at DESC
      LIMIT 4
    `;
    const recentProjects = db.prepare(recentProjectsSql).all(...rpParams);

    let recentPaymentsSql = `
      SELECT pmt.*, p.name as project_name, c.name as client_name
      FROM payments pmt
      JOIN projects p ON pmt.project_id = p.id
      JOIN clients c ON pmt.client_id = c.id
    `;
    const rpayParams = [];
    if (userId !== null && userId !== undefined) {
      recentPaymentsSql += ` WHERE (p.user_id = ? OR p.user_id IS NULL)`;
      rpayParams.push(userId);
    }
    recentPaymentsSql += `
      ORDER BY pmt.payment_date DESC, pmt.id DESC
      LIMIT 4
    `;
    const recentPayments = db.prepare(recentPaymentsSql).all(...rpayParams);

    return {
      projects_counts: {
        active,
        completed,
        pre_planning: prePlanning,
        total: active + completed + prePlanning
      },
      clients_count: totalClients,
      financials: {
        total_deal: totalDeal,
        total_received: totalReceived,
        total_balance: totalBalance
      },
      recent_projects: recentProjects,
      recent_payments: recentPayments
    };
  }
};

// Initialize DB schema and seed on require
initDatabase();

module.exports = {
  db,
  hashPassword,
  queries
};
