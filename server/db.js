require('dotenv').config();
const { createClient } = require('@libsql/client');
const crypto = require('crypto');

// Initialize libSQL connection using Turso cloud credentials
// Fallback to :memory: if TURSO_DATABASE_URL is not provided (e.g. offline testing), avoiding local disk persistence
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || ':memory:',
  authToken: process.env.TURSO_AUTH_TOKEN
});

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + '_archisalt_2026').digest('hex');
}

let initPromise = null;

async function initDatabase() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Enable foreign keys
    await db.execute('PRAGMA foreign_keys = ON;');

    // Create tables
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        studio_name TEXT DEFAULT 'SHASWAT DESIGNS',
        role TEXT DEFAULT 'Principal Architect',
        google_id TEXT,
        avatar_url TEXT,
        auth_provider TEXT DEFAULT 'local',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS project_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        is_default INTEGER DEFAULT 0,
        badge_color TEXT DEFAULT '#2563eb',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        company_name TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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
    `);

    await db.execute(`
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
    `);

    await db.execute(`
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
    `);

    await db.execute(`
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
    `);

    await db.execute(`
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
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.execute(`CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(project_type_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_payments_project ON payments(project_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_drawings_project ON drawings(project_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_revisions_drawing ON drawing_revisions(drawing_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_images_project ON project_images(project_id);`);
    await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);`);

    // Schema upgrades if existing remote database was created previously
    try { await db.execute("ALTER TABLE users ADD COLUMN google_id TEXT;"); } catch (e) {}
    try { await db.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT;"); } catch (e) {}
    try { await db.execute("ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'local';"); } catch (e) {}
    try { await db.execute("ALTER TABLE clients ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;"); } catch (e) {}
    try { await db.execute("ALTER TABLE projects ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;"); } catch (e) {}

    // Backfill demo data
    try {
      await db.execute("UPDATE clients SET user_id = 1 WHERE user_id IS NULL;");
      await db.execute("UPDATE projects SET user_id = 1 WHERE user_id IS NULL;");
    } catch (e) {}

    await seedDefaultData();
  })();

  return initPromise;
}

async function seedDefaultData() {
  // Check if default user exists
  const existingUserRes = await db.execute('SELECT id FROM users LIMIT 1');
  if (existingUserRes.rows.length === 0) {
    await db.execute({
      sql: `
        INSERT INTO users (email, password_hash, name, studio_name, role)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [
        'architect@archidesk.com',
        hashPassword('studio2026'),
        'Er. Shivansh',
        'SHASWAT DESIGNS',
        'Principal Architect'
      ]
    });
  } else {
    await db.execute("UPDATE users SET studio_name = 'SHASWAT DESIGNS' WHERE studio_name = 'Atelier Architecture Studio' OR studio_name IS NULL;");
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

  for (const t of defaultTypes) {
    const checkRes = await db.execute({ sql: 'SELECT id FROM project_types WHERE name = ?', args: [t.name] });
    if (checkRes.rows.length === 0) {
      await db.execute({
        sql: 'INSERT INTO project_types (name, is_default, badge_color) VALUES (?, 1, ?)',
        args: [t.name, t.color]
      });
    }
  }

  // Check if any client exists; if not, seed realistic sample data
  const existingClientRes = await db.execute('SELECT id FROM clients LIMIT 1');
  if (existingClientRes.rows.length === 0) {
    // 1. Clients
    const rahulRes = await db.execute({
      sql: `
        INSERT INTO clients (name, phone, email, address, company_name, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `,
      args: [
        'Rahul Sharma',
        '+91 98765 43210',
        'rahul.sharma@example.com',
        'Sector 4, Gomti Nagar, Lucknow, UP',
        'Sharma & Sons Enterprises',
        'Prefers bioclimatic design, natural sandstone facade, and minimal open spaces.'
      ]
    });
    const rahulId = Number(rahulRes.lastInsertRowid);

    const priyaRes = await db.execute({
      sql: `
        INSERT INTO clients (name, phone, email, address, company_name, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `,
      args: [
        'Priya Verma',
        '+91 98111 22334',
        'priya.verma@vermaestates.in',
        '14 Park Road, Hazratganj, Lucknow, UP',
        'Verma Estates & Living',
        'Luxury penthouse renovation with Italian marble and smart home integration.'
      ]
    });
    const priyaId = Number(priyaRes.lastInsertRowid);

    const arindamRes = await db.execute({
      sql: `
        INSERT INTO clients (name, phone, email, address, company_name, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `,
      args: [
        'Arindam Sen',
        '+91 97222 33445',
        'sen@zenithtech.in',
        'Tower B, Cyber City, Gurgaon, HR',
        'Zenith Tech Labs',
        'Corporate open workspace with biophilic acoustics.'
      ]
    });
    const arindamId = Number(arindamRes.lastInsertRowid);

    // Get type IDs
    const resTypeId = (await db.execute({ sql: 'SELECT id FROM project_types WHERE name = ?', args: ['Residential'] })).rows[0].id;
    const intTypeId = (await db.execute({ sql: 'SELECT id FROM project_types WHERE name = ?', args: ['Interior'] })).rows[0].id;
    const renTypeId = (await db.execute({ sql: 'SELECT id FROM project_types WHERE name = ?', args: ['Renovation'] })).rows[0].id;
    const offTypeId = (await db.execute({ sql: 'SELECT id FROM project_types WHERE name = ?', args: ['Office'] })).rows[0].id;

    // 2. Projects
    const sharmaRes = await db.execute({
      sql: `
        INSERT INTO projects (client_id, project_type_id, name, location, status, start_date, expected_completion_date, total_fee, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      args: [
        rahulId,
        resTypeId,
        'Sharma Residence',
        'Lucknow',
        'Active',
        '2026-08-01',
        '2027-04-30',
        50000,
        'G+2 contemporary sustainable villa with double-height central atrium, courtyard cooling, and rooftop solar terrace.'
      ]
    });
    const sharmaProjId = Number(sharmaRes.lastInsertRowid);

    await db.execute({
      sql: `
        INSERT INTO projects (client_id, project_type_id, name, location, status, start_date, expected_completion_date, total_fee, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      args: [
        rahulId,
        intTypeId,
        'Sharma Office Interior',
        'Vibhuti Khand, Lucknow',
        'Pre-Planning',
        '2026-10-15',
        '2027-01-20',
        35000,
        'Executive cabin redesign with acoustic timber battens and concealed warm lighting.'
      ]
    });

    const vermaRes = await db.execute({
      sql: `
        INSERT INTO projects (client_id, project_type_id, name, location, status, start_date, expected_completion_date, total_fee, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      args: [
        priyaId,
        renTypeId,
        'Verma Penthouse',
        'Hazratganj, Lucknow',
        'Completed',
        '2026-01-10',
        '2026-07-28',
        85000,
        'Full interior transformation including bespoke kitchen, terrace deck garden, and walk-in wardrobe.'
      ]
    });
    const vermaProjId = Number(vermaRes.lastInsertRowid);

    const zenithRes = await db.execute({
      sql: `
        INSERT INTO projects (client_id, project_type_id, name, location, status, start_date, expected_completion_date, total_fee, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      args: [
        arindamId,
        offTypeId,
        'Zenith Innovation Hub',
        'Cyber City, Gurgaon',
        'Active',
        '2026-06-15',
        '2026-12-31',
        120000,
        'Modular 120-seat tech studio with collaboration pods and exposed architectural ceiling.'
      ]
    });
    const zenithProjId = Number(zenithRes.lastInsertRowid);

    // 3. Payments
    await db.execute({
      sql: `INSERT INTO payments (project_id, client_id, amount, payment_date, payment_method, reference_note) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [sharmaProjId, rahulId, 10000, '2026-08-15', 'UPI', 'Advance token on approval of concept drawings (UPI Ref: UPI-8492048)']
    });

    await db.execute({
      sql: `INSERT INTO payments (project_id, client_id, amount, payment_date, payment_method, reference_note) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [vermaProjId, priyaId, 30000, '2026-01-15', 'Bank Transfer', 'Initial Mobilization Deposit']
    });
    await db.execute({
      sql: `INSERT INTO payments (project_id, client_id, amount, payment_date, payment_method, reference_note) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [vermaProjId, priyaId, 35000, '2026-04-10', 'Cheque', 'Mid-way Milestone Payment (Chq #440912)']
    });
    await db.execute({
      sql: `INSERT INTO payments (project_id, client_id, amount, payment_date, payment_method, reference_note) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [vermaProjId, priyaId, 20000, '2026-07-30', 'Bank Transfer', 'Final Handover Settlement']
    });

    await db.execute({
      sql: `INSERT INTO payments (project_id, client_id, amount, payment_date, payment_method, reference_note) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [zenithProjId, arindamId, 50000, '2026-06-20', 'Bank Transfer', 'Phase 1 Structural Design Signoff']
    });

    // 4. Drawings for Sharma Residence
    const d1Res = await db.execute({
      sql: `INSERT INTO drawings (project_id, name, drawing_number, category, description, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        sharmaProjId,
        'Ground Floor Layout Plan',
        'ARC-SR-101',
        'Floor plans',
        'Detailed architectural space planning showing master bedroom, foyer, double-height living, and open kitchen.',
        'Ar. Ishan Sharma'
      ]
    });
    const d1 = Number(d1Res.lastInsertRowid);

    await db.execute({
      sql: `INSERT INTO drawing_revisions (drawing_id, revision_code, revision_note, revision_date, file_name, file_url, file_size, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [d1, 'R00', 'Initial architectural schematic concept layout', '2026-08-05', 'SR_GF_Plan_R00.pdf', '/assets/sample-floorplan.svg', 142000, 'PDF']
    });
    await db.execute({
      sql: `INSERT INTO drawing_revisions (drawing_id, revision_code, revision_note, revision_date, file_name, file_url, file_size, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [d1, 'R01', 'Kitchen pantry extended & utility corridor modified', '2026-08-14', 'SR_GF_Plan_R01.pdf', '/assets/sample-floorplan.svg', 148500, 'PDF']
    });
    await db.execute({
      sql: `INSERT INTO drawing_revisions (drawing_id, revision_code, revision_note, revision_date, file_name, file_url, file_size, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [d1, 'R02', 'Final approved layout with staircase structural column alignment', '2026-08-28', 'SR_GF_Plan_R02.pdf', '/assets/sample-floorplan.svg', 152000, 'PDF']
    });

    const d2Res = await db.execute({
      sql: `INSERT INTO drawings (project_id, name, drawing_number, category, description, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        sharmaProjId,
        'North Front Elevation',
        'ARC-SR-201',
        'Elevations',
        'Exterior facade detailing terracotta vertical louvers, exposed concrete finish, and cantilever balcony.',
        'Ar. Ishan Sharma'
      ]
    });
    const d2 = Number(d2Res.lastInsertRowid);

    await db.execute({
      sql: `INSERT INTO drawing_revisions (drawing_id, revision_code, revision_note, revision_date, file_name, file_url, file_size, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [d2, 'R00', 'Initial facade massing & window proportion study', '2026-08-10', 'SR_Elevation_R00.dwg', '/assets/sample-elevation.svg', 210000, 'DWG']
    });
    await db.execute({
      sql: `INSERT INTO drawing_revisions (drawing_id, revision_code, revision_note, revision_date, file_name, file_url, file_size, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [d2, 'R01', 'Balcony louvers orientation and cantilever beam depth adjusted', '2026-08-22', 'SR_Elevation_R01.dwg', '/assets/sample-elevation.svg', 218000, 'DWG']
    });

    const d3Res = await db.execute({
      sql: `INSERT INTO drawings (project_id, name, drawing_number, category, description, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        sharmaProjId,
        'Cross Section A-A & Slab Heights',
        'ARC-SR-301',
        'Sections',
        'Full transverse section cutting through central courtyard and double-height skylight zone.',
        'Er. K. Mehta (Structural)'
      ]
    });
    const d3 = Number(d3Res.lastInsertRowid);

    await db.execute({
      sql: `INSERT INTO drawing_revisions (drawing_id, revision_code, revision_note, revision_date, file_name, file_url, file_size, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [d3, 'R00', 'Issued for structural tender and footing coordinates', '2026-08-18', 'SR_Section_AA_R00.pdf', '/assets/sample-section.svg', 189000, 'PDF']
    });

    // 5. Site Photo Timeline for Sharma Residence
    await db.execute({
      sql: `
        INSERT INTO project_images (project_id, title, date, category, description, location_area, uploaded_by, file_name, file_url, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
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
      ]
    });

    await db.execute({
      sql: `
        INSERT INTO project_images (project_id, title, date, category, description, location_area, uploaded_by, file_name, file_url, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
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
      ]
    });

    await db.execute({
      sql: `
        INSERT INTO project_images (project_id, title, date, category, description, location_area, uploaded_by, file_name, file_url, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
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
      ]
    });

    await db.execute({
      sql: `
        INSERT INTO project_images (project_id, title, date, category, description, location_area, uploaded_by, file_name, file_url, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
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
      ]
    });

    await db.execute({
      sql: `
        INSERT INTO project_images (project_id, title, date, category, description, location_area, uploaded_by, file_name, file_url, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
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
      ]
    });
  }
}

// Helper query functions refactored for asynchronous libSQL queries
const queries = {
  // Auth
  async getUserByEmail(email) {
    const res = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
    return res.rows[0] || null;
  },

  async getUserById(id) {
    const res = await db.execute({
      sql: 'SELECT id, email, name, studio_name, role, google_id, avatar_url, auth_provider, created_at FROM users WHERE id = ?',
      args: [id]
    });
    return res.rows[0] || null;
  },

  async getUserByGoogleId(googleId) {
    const res = await db.execute({
      sql: 'SELECT id, email, name, studio_name, role, google_id, avatar_url, auth_provider, created_at FROM users WHERE google_id = ?',
      args: [googleId]
    });
    return res.rows[0] || null;
  },

  async createOrUpdateGoogleUser({ googleId, email, name, avatarUrl, studioName, role }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    
    // 1. Check by google_id
    const userByGId = await db.execute({ sql: 'SELECT * FROM users WHERE google_id = ?', args: [googleId] });
    let user = userByGId.rows[0];
    if (user) {
      await db.execute({
        sql: `
          UPDATE users
          SET name = COALESCE(?, name),
              avatar_url = COALESCE(?, avatar_url),
              auth_provider = 'google'
          WHERE id = ?
        `,
        args: [name ? name.trim() : user.name, avatarUrl || user.avatar_url, user.id]
      });
      const updated = await db.execute({
        sql: 'SELECT id, email, name, studio_name, role, google_id, avatar_url, auth_provider, created_at FROM users WHERE id = ?',
        args: [user.id]
      });
      return updated.rows[0];
    }

    // 2. Check by email
    const userByEmail = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [cleanEmail] });
    user = userByEmail.rows[0];
    if (user) {
      await db.execute({
        sql: `
          UPDATE users
          SET google_id = ?,
              name = COALESCE(?, name),
              avatar_url = COALESCE(?, avatar_url),
              auth_provider = 'google'
          WHERE id = ?
        `,
        args: [googleId, name ? name.trim() : user.name, avatarUrl || user.avatar_url, user.id]
      });
      const updated = await db.execute({
        sql: 'SELECT id, email, name, studio_name, role, google_id, avatar_url, auth_provider, created_at FROM users WHERE id = ?',
        args: [user.id]
      });
      return updated.rows[0];
    }

    // 3. Insert new Google user
    const dummyHash = hashPassword(crypto.randomBytes(24).toString('hex'));
    const finalName = name ? name.trim() : 'Architect';
    const finalStudio = studioName ? studioName.trim() : `${finalName}'s Studio`;
    const finalRole = role ? role.trim() : 'Principal Architect';

    const insertRes = await db.execute({
      sql: `
        INSERT INTO users (email, password_hash, name, studio_name, role, google_id, avatar_url, auth_provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'google')
      `,
      args: [cleanEmail, dummyHash, finalName, finalStudio, finalRole, googleId, avatarUrl || null]
    });

    const newId = Number(insertRes.lastInsertRowid);
    const created = await db.execute({
      sql: 'SELECT id, email, name, studio_name, role, google_id, avatar_url, auth_provider, created_at FROM users WHERE id = ?',
      args: [newId]
    });
    return created.rows[0];
  },

  async createUser(email, password, name = 'Er. Shivansh', studioName = 'SHASWAT DESIGNS', role = 'Principal Architect') {
    const hash = hashPassword(password);
    const res = await db.execute({
      sql: `
        INSERT INTO users (email, password_hash, name, studio_name, role, auth_provider)
        VALUES (?, ?, ?, ?, ?, 'local')
      `,
      args: [email.trim().toLowerCase(), hash, name.trim(), studioName.trim(), role.trim()]
    });
    return Number(res.lastInsertRowid);
  },

  async updateUserProfile(userId, name, studioName, email, role) {
    return await db.execute({
      sql: `
        UPDATE users
        SET name = ?, studio_name = ?, email = ?, role = ?
        WHERE id = ?
      `,
      args: [name.trim(), studioName.trim(), email.trim().toLowerCase(), role.trim(), userId]
    });
  },

  async createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    await db.execute({
      sql: 'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
      args: [token, userId, expiresAt]
    });
    return { token, expiresAt };
  },

  async getSession(token) {
    const res = await db.execute({
      sql: `
        SELECT s.*, u.id as user_id, u.email, u.name, u.studio_name, u.role, u.google_id, u.avatar_url, u.auth_provider
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
      `,
      args: [token]
    });
    return res.rows[0] || null;
  },

  async deleteSession(token) {
    return await db.execute({
      sql: 'DELETE FROM sessions WHERE token = ?',
      args: [token]
    });
  },

  // Project Types
  async getProjectTypes() {
    const res = await db.execute(`
      SELECT pt.*, COUNT(p.id) as project_count
      FROM project_types pt
      LEFT JOIN projects p ON pt.id = p.project_type_id
      GROUP BY pt.id
      ORDER BY pt.is_default DESC, pt.name ASC
    `);
    return res.rows;
  },

  async getProjectTypeById(id) {
    const res = await db.execute({
      sql: 'SELECT * FROM project_types WHERE id = ?',
      args: [id]
    });
    return res.rows[0] || null;
  },

  async createProjectType(name, badgeColor = '#2563eb') {
    const res = await db.execute({
      sql: 'INSERT INTO project_types (name, is_default, badge_color) VALUES (?, 0, ?)',
      args: [name, badgeColor]
    });
    return { lastInsertRowid: Number(res.lastInsertRowid) };
  },

  async updateProjectType(id, name, badgeColor) {
    return await db.execute({
      sql: 'UPDATE project_types SET name = ?, badge_color = ? WHERE id = ?',
      args: [name, badgeColor, id]
    });
  },

  async deleteProjectType(id) {
    const countRes = await db.execute({
      sql: 'SELECT COUNT(*) as c FROM projects WHERE project_type_id = ?',
      args: [id]
    });
    const count = countRes.rows[0] ? countRes.rows[0].c : 0;
    if (count > 0) {
      throw new Error(`Cannot delete: this project type is assigned to ${count} active project(s).`);
    }
    return await db.execute({
      sql: 'DELETE FROM project_types WHERE id = ? AND is_default = 0',
      args: [id]
    });
  },

  // Clients
  async getClients(userId = null) {
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
    const res = await db.execute({ sql, args: params });
    return res.rows;
  },

  async getClientById(id) {
    const clientRes = await db.execute({
      sql: 'SELECT * FROM clients WHERE id = ?',
      args: [id]
    });
    const client = clientRes.rows[0];
    if (!client) return null;

    const projectsRes = await db.execute({
      sql: `
        SELECT p.*, pt.name as project_type_name, pt.badge_color,
          COALESCE(SUM(pmt.amount), 0) as received_amount,
          MAX(0, (p.total_fee - COALESCE(SUM(pmt.amount), 0))) as balance_amount
        FROM projects p
        JOIN project_types pt ON p.project_type_id = pt.id
        LEFT JOIN payments pmt ON p.id = pmt.project_id
        WHERE p.client_id = ?
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `,
      args: [id]
    });

    return { ...client, projects: projectsRes.rows };
  },

  async createClient(name, phone, email, address, company_name, notes, userId = null) {
    const res = await db.execute({
      sql: `
        INSERT INTO clients (name, phone, email, address, company_name, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [name, phone || null, email || null, address || null, company_name || null, notes || null, userId || 1]
    });
    return { lastInsertRowid: Number(res.lastInsertRowid) };
  },

  async updateClient(id, name, phone, email, address, company_name, notes) {
    return await db.execute({
      sql: `
        UPDATE clients
        SET name = ?, phone = ?, email = ?, address = ?, company_name = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [name, phone || null, email || null, address || null, company_name || null, notes || null, id]
    });
  },

  async deleteClient(id) {
    const countRes = await db.execute({
      sql: 'SELECT COUNT(*) as c FROM projects WHERE client_id = ?',
      args: [id]
    });
    const count = countRes.rows[0] ? countRes.rows[0].c : 0;
    if (count > 0) {
      throw new Error(`Cannot delete client: has ${count} associated project(s).`);
    }
    return await db.execute({
      sql: 'DELETE FROM clients WHERE id = ?',
      args: [id]
    });
  },

  // Projects
  async getProjects(filters = {}) {
    let sql = `
      SELECT p.*,
        c.name as client_name, c.phone as client_phone, c.email as client_email,
        pt.name as project_type_name, pt.badge_color,
        COALESCE(SUM(pmt.amount), 0) as received_amount,
        MAX(0, (p.total_fee - COALESCE(SUM(pmt.amount), 0))) as balance_amount,
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
    const res = await db.execute({ sql, args: params });
    return res.rows;
  },

  async getProjectById(id) {
    const projRes = await db.execute({
      sql: `
        SELECT p.*,
          c.name as client_name, c.phone as client_phone, c.email as client_email, c.address as client_address, c.company_name as client_company,
          pt.name as project_type_name, pt.badge_color,
          COALESCE(SUM(pmt.amount), 0) as received_amount,
          MAX(0, (p.total_fee - COALESCE(SUM(pmt.amount), 0))) as balance_amount
        FROM projects p
        JOIN clients c ON p.client_id = c.id
        JOIN project_types pt ON p.project_type_id = pt.id
        LEFT JOIN payments pmt ON p.id = pmt.project_id
        WHERE p.id = ?
        GROUP BY p.id
      `,
      args: [id]
    });

    const project = projRes.rows[0];
    if (!project) return null;

    // Attach payments
    const paymentsRes = await db.execute({
      sql: 'SELECT * FROM payments WHERE project_id = ? ORDER BY payment_date DESC, id DESC',
      args: [id]
    });
    project.payments = paymentsRes.rows;

    // Attach drawings count and images count
    const dCount = await db.execute({ sql: 'SELECT COUNT(*) as c FROM drawings WHERE project_id = ?', args: [id] });
    project.drawings_count = dCount.rows[0] ? dCount.rows[0].c : 0;

    const iCount = await db.execute({ sql: 'SELECT COUNT(*) as c FROM project_images WHERE project_id = ?', args: [id] });
    project.images_count = iCount.rows[0] ? iCount.rows[0].c : 0;

    return project;
  },

  async createProject(clientId, projectTypeId, name, location, status, startDate, completionDate, totalFee, notes, userId = null) {
    const res = await db.execute({
      sql: `
        INSERT INTO projects (client_id, project_type_id, name, location, status, start_date, expected_completion_date, total_fee, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [clientId, projectTypeId, name, location, status || 'Active', startDate || null, completionDate || null, totalFee || 0, notes || null, userId || 1]
    });
    return { lastInsertRowid: Number(res.lastInsertRowid) };
  },

  async updateProject(id, clientId, projectTypeId, name, location, status, startDate, completionDate, totalFee, notes) {
    return await db.execute({
      sql: `
        UPDATE projects
        SET client_id = ?, project_type_id = ?, name = ?, location = ?, status = ?,
            start_date = ?, expected_completion_date = ?, total_fee = ?, notes = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [clientId, projectTypeId, name, location, status, startDate || null, completionDate || null, totalFee || 0, notes || null, id]
    });
  },

  async updateProjectStatus(id, status) {
    return await db.execute({
      sql: 'UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [status, id]
    });
  },

  async deleteProject(id) {
    return await db.execute({
      sql: 'DELETE FROM projects WHERE id = ?',
      args: [id]
    });
  },

  // Payments / Accounts
  async getPayments(projectId = null) {
    if (projectId) {
      const res = await db.execute({
        sql: `
          SELECT pmt.*, p.name as project_name, c.name as client_name
          FROM payments pmt
          JOIN projects p ON pmt.project_id = p.id
          JOIN clients c ON pmt.client_id = c.id
          WHERE pmt.project_id = ?
          ORDER BY pmt.payment_date DESC, pmt.id DESC
        `,
        args: [projectId]
      });
      return res.rows;
    }
    const res = await db.execute(`
      SELECT pmt.*, p.name as project_name, c.name as client_name, pt.name as project_type_name
      FROM payments pmt
      JOIN projects p ON pmt.project_id = p.id
      JOIN clients c ON pmt.client_id = c.id
      JOIN project_types pt ON p.project_type_id = pt.id
      ORDER BY pmt.payment_date DESC, pmt.id DESC
    `);
    return res.rows;
  },

  async addPayment(projectId, amount, paymentDate, paymentMethod, referenceNote) {
    const projRes = await db.execute({
      sql: `
        SELECT p.*,
          COALESCE(SUM(pmt.amount), 0) as received_amount,
          MAX(0, (p.total_fee - COALESCE(SUM(pmt.amount), 0))) as balance_amount
        FROM projects p
        LEFT JOIN payments pmt ON p.id = pmt.project_id
        WHERE p.id = ?
        GROUP BY p.id
      `,
      args: [projectId]
    });
    const proj = projRes.rows[0];
    if (!proj) throw new Error('Project not found');

    const remainingBalance = Math.max(0, proj.total_fee - proj.received_amount);
    if (remainingBalance <= 0) {
      throw new Error(`Project "${proj.name}" is already fully settled (₹0 balance). Cannot receive additional payments.`);
    }
    if (amount > remainingBalance) {
      throw new Error(`Payment amount (₹${amount.toLocaleString('en-IN')}) exceeds the remaining project balance of ₹${remainingBalance.toLocaleString('en-IN')}`);
    }

    const res = await db.execute({
      sql: `
        INSERT INTO payments (project_id, client_id, amount, payment_date, payment_method, reference_note)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [projectId, proj.client_id, amount, paymentDate, paymentMethod, referenceNote || null]
    });

    await db.execute({
      sql: 'UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [projectId]
    });

    return { lastInsertRowid: Number(res.lastInsertRowid) };
  },

  async deletePayment(id) {
    const paymentRes = await db.execute({
      sql: 'SELECT project_id FROM payments WHERE id = ?',
      args: [id]
    });
    const payment = paymentRes.rows[0];

    const res = await db.execute({
      sql: 'DELETE FROM payments WHERE id = ?',
      args: [id]
    });

    if (payment) {
      await db.execute({
        sql: 'UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        args: [payment.project_id]
      });
    }
    return res;
  },

  async getAccountsSummary() {
    const totalsRes = await db.execute(`
      SELECT
        COALESCE(SUM(p.total_fee), 0) as total_deal_amount,
        COALESCE((SELECT SUM(amount) FROM payments), 0) as total_received
      FROM projects p
    `);
    const totals = totalsRes.rows[0];
    const totalDeal = totals ? totals.total_deal_amount : 0;
    const totalReceived = totals ? totals.total_received : 0;
    const totalBalance = Math.max(0, totalDeal - totalReceived);

    const projectAccountsRes = await db.execute(`
      SELECT p.id, p.name as project_name, p.location, p.status,
             c.name as client_name,
             pt.name as project_type_name, pt.badge_color,
             p.total_fee as deal_amount,
             COALESCE(SUM(pmt.amount), 0) as received_amount,
             MAX(0, (p.total_fee - COALESCE(SUM(pmt.amount), 0))) as balance_amount,
             MAX(pmt.payment_date) as last_payment_date
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      JOIN project_types pt ON p.project_type_id = pt.id
      LEFT JOIN payments pmt ON p.id = pmt.project_id
      GROUP BY p.id
      ORDER BY balance_amount DESC, p.name ASC
    `);

    return {
      total_deal: totalDeal,
      total_received: totalReceived,
      total_balance: totalBalance,
      project_accounts: projectAccountsRes.rows
    };
  },

  // Drawings
  async getDrawings(projectId) {
    const res = await db.execute({
      sql: `
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
      `,
      args: [projectId]
    });
    return res.rows;
  },

  async getDrawingWithRevisions(drawingId) {
    const drawingRes = await db.execute({
      sql: `
        SELECT d.*, p.name as project_name
        FROM drawings d
        JOIN projects p ON d.project_id = p.id
        WHERE d.id = ?
      `,
      args: [drawingId]
    });
    const drawing = drawingRes.rows[0];
    if (!drawing) return null;

    const revsRes = await db.execute({
      sql: `
        SELECT * FROM drawing_revisions
        WHERE drawing_id = ?
        ORDER BY id DESC
      `,
      args: [drawingId]
    });
    drawing.revisions = revsRes.rows;

    return drawing;
  },

  async createDrawing(projectId, name, drawingNumber, category, description, uploadedBy, revisionCode = 'R00', revisionNote = 'Initial release', fileUrl = '/assets/sample-floorplan.svg', fileName = 'drawing.pdf', fileSize = 150000, fileType = 'PDF') {
    const res = await db.execute({
      sql: `
        INSERT INTO drawings (project_id, name, drawing_number, category, description, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [projectId, name, drawingNumber || null, category, description || null, uploadedBy || 'Architect']
    });
    const drawingId = Number(res.lastInsertRowid);

    // Create initial revision
    await db.execute({
      sql: `
        INSERT INTO drawing_revisions (drawing_id, revision_code, revision_note, revision_date, file_name, file_url, file_size, file_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        drawingId,
        revisionCode,
        revisionNote,
        new Date().toISOString().split('T')[0],
        fileName,
        fileUrl,
        fileSize,
        fileType
      ]
    });

    await db.execute({
      sql: 'UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [projectId]
    });

    return drawingId;
  },

  async addDrawingRevision(drawingId, revisionCode, revisionNote, revisionDate, fileName, fileUrl, fileSize = 0, fileType = 'PDF') {
    const res = await db.execute({
      sql: `
        INSERT INTO drawing_revisions (drawing_id, revision_code, revision_note, revision_date, file_name, file_url, file_size, file_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        drawingId,
        revisionCode,
        revisionNote || 'Drawing revision update',
        revisionDate || new Date().toISOString().split('T')[0],
        fileName,
        fileUrl,
        fileSize,
        fileType
      ]
    });

    await db.execute({
      sql: 'UPDATE drawings SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [drawingId]
    });

    return { lastInsertRowid: Number(res.lastInsertRowid) };
  },

  async updateDrawing(id, name, drawingNumber, category, description) {
    return await db.execute({
      sql: `
        UPDATE drawings
        SET name = ?, drawing_number = ?, category = ?, description = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [name, drawingNumber || null, category, description || null, id]
    });
  },

  async deleteDrawing(id) {
    return await db.execute({
      sql: 'DELETE FROM drawings WHERE id = ?',
      args: [id]
    });
  },

  // Images
  async getProjectImages(projectId, category = null) {
    if (category && category !== 'All') {
      const res = await db.execute({
        sql: `
          SELECT * FROM project_images
          WHERE project_id = ? AND category = ?
          ORDER BY date DESC, id DESC
        `,
        args: [projectId, category]
      });
      return res.rows;
    }
    const res = await db.execute({
      sql: `
        SELECT * FROM project_images
        WHERE project_id = ?
        ORDER BY date DESC, id DESC
      `,
      args: [projectId]
    });
    return res.rows;
  },

  async getProjectTimeline(projectId, sort = 'ASC') {
    const order = sort.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const res = await db.execute({
      sql: `
        SELECT * FROM project_images
        WHERE project_id = ?
        ORDER BY date ${order}, id ${order}
      `,
      args: [projectId]
    });
    return res.rows;
  },

  async createProjectImage(projectId, title, date, category, description, locationArea, uploadedBy, fileName, fileUrl, fileSize = 0) {
    const res = await db.execute({
      sql: `
        INSERT INTO project_images (project_id, title, date, category, description, location_area, uploaded_by, file_name, file_url, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [projectId, title, date, category, description || null, locationArea || null, uploadedBy || 'Architect', fileName, fileUrl, fileSize]
    });

    await db.execute({
      sql: 'UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [projectId]
    });

    return { lastInsertRowid: Number(res.lastInsertRowid) };
  },

  async deleteProjectImage(id) {
    return await db.execute({
      sql: 'DELETE FROM project_images WHERE id = ?',
      args: [id]
    });
  },

  // Dashboard Summary
  async getDashboardStats(userId = null) {
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

    const activeRes = await db.execute({ sql: `SELECT COUNT(*) as c FROM projects WHERE status = 'Active'${pUserWhere}`, args: pParams });
    const active = activeRes.rows[0] ? activeRes.rows[0].c : 0;

    const compRes = await db.execute({ sql: `SELECT COUNT(*) as c FROM projects WHERE status = 'Completed'${pUserWhere}`, args: pParams });
    const completed = compRes.rows[0] ? compRes.rows[0].c : 0;

    const prepRes = await db.execute({ sql: `SELECT COUNT(*) as c FROM projects WHERE status = 'Pre-Planning'${pUserWhere}`, args: pParams });
    const prePlanning = prepRes.rows[0] ? prepRes.rows[0].c : 0;

    const clRes = await db.execute({ sql: `SELECT COUNT(*) as c FROM clients${cUserWhere}`, args: cParams });
    const totalClients = clRes.rows[0] ? clRes.rows[0].c : 0;

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
    const totalsRes = await db.execute({ sql: totalsSql, args: totalsParams });
    const totals = totalsRes.rows[0];

    const totalDeal = totals ? totals.total_deal : 0;
    const totalReceived = totals ? totals.total_received : 0;
    const totalBalance = Math.max(0, totalDeal - totalReceived);

    let recentProjectsSql = `
      SELECT p.*, c.name as client_name, pt.name as project_type_name, pt.badge_color,
             COALESCE(SUM(pmt.amount), 0) as received_amount,
             MAX(0, (p.total_fee - COALESCE(SUM(pmt.amount), 0))) as balance_amount
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
    const recentProjectsRes = await db.execute({ sql: recentProjectsSql, args: rpParams });
    const recentProjects = recentProjectsRes.rows;

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
    const recentPaymentsRes = await db.execute({ sql: recentPaymentsSql, args: rpayParams });
    const recentPayments = recentPaymentsRes.rows;

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

module.exports = {
  db,
  hashPassword,
  initDatabase,
  queries
};
