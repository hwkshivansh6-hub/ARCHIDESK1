# 📐 SHASWAT DESIGNS — ARCHIDESK Studio

A simple, clean, and professional **Architect & Engineering Management Mobile Web App** designed as a digital assistant for architects, civil/structural engineers, and architecture practices. 

It manages **Projects, Clients, Accounts, Drawings (with full revision history), and Site Photographs (with a chronological timeline)** connected through a real relational SQLite database.

---

## ✨ Features Overview

### 1. 📊 Main Dashboard
- **Connected Pillars**:
  - **A. Projects**: Quick status breakdown (*Active*, *Pre-Planning*, *Completed*).
  - **B. Clients**: Client directory and project density count.
  - **C. Accounts**: Real-time financial metrics:
    $$\text{Balance} = \text{Total Agreed Fee} - \text{Total Payments Received}$$
- **Personalized Engineer Greeting**: Dynamically adapts greeting (*Good morning / afternoon / evening, Er. [Name] 👋*).
- **Quick Action Bar**: Shortcuts for creating projects, clients, recording payments, and configuring project types.
- **Recent Activity Ledger**: Live stream of latest payments and drawing updates.

### 2. 📁 Projects Workspace (Digital Project Folders)
- **Status Categorization**: Move projects between **Active**, **Pre-Planning**, and **Completed**.
- **Multi-Filter & Search**: Instant filter by *Status*, *Project Type*, *Client*, and *Location*, plus full-text search.
- **Dedicated Tabs**:
  - **Overview**: Site location, start & completion dates, scope notes, client contact card, and live financial summary.
  - **Accounts**: Agreed deal fee, total received, remaining balance, and full receipt ledger with payment methods (*UPI, Bank Transfer, Cash, Cheque, Other*).
  - **Drawings**: Categorized architectural drawings (*Floor plans, Elevations, Sections, Structural, Electrical, etc.*) with support for PDF, CAD DWG/DXF, and images.
  - **Drawing Revisions**: Preserves previous versions (`R00` → `R01` → `R02` → `R03`) with revision notes, dates, and preview.
  - **Site Images & Timeline**: Visual chronological milestones (*Excavation* → *Foundation* → *Columns* → *Brickwork*) with dates, areas, descriptions, and high-res lightbox viewer.

### 3. 👥 Clients Directory
- Full client contact profiles (phone, email, company, billing address, notes).
- Lists all connected projects under each client (e.g. *Rahul Sharma → Sharma Residence, Sharma Office Interior*) with direct click-through.

### 4. 💰 Accounts Hub
- Studio-wide portfolio metrics (Total Agreed Value, Total Collected, Outstanding Balances).
- Project-wise breakdown table with one-click payment entry.
- Full studio transaction history.

### 5. ⚙️ Studio Customization & Settings
- **Project Types Manager**: Defaults (*Residential, Commercial, Interior, Renovation, Office, Retail, Hospitality, Institutional, Landscape, Other*) + Custom types with color tags.
- **Principal Profile Editor**: Change Principal Architect / Engineer Name, Studio Name (*SHASWAT DESIGNS*), and professional role at any time.
- **Architectural Tools**:
  - **📐 Grid Mode**: Toggle technical architectural drafting grid background.
  - **📱 Mobile Frame Switcher**: Switch between an iPhone/Android mobile device simulator and full desktop studio layout.

---

## 🛠️ Technology Stack

- **Backend**: Node.js v24 with native `node:sqlite` (SQLite v3.53.3 built-in)
  - Zero external native build tool dependencies
  - ACID-compliant relational tables with foreign keys and cascade rules
- **Server**: Express.js, CORS, Multer (file uploads)
- **Frontend**: Semantic HTML5, Vanilla CSS3 (Architectural design tokens & micro-animations), Modern Vanilla ES JavaScript
- **Storage**: Persistent SQLite file (`archimanager.db`) and static uploaded files (`uploads/`)

---

## 🗄️ Relational Database Schema

```
clients
  ├── projects
  │     ├── project_types
  │     ├── payments (auto-recalculating balance)
  │     ├── drawings
  │     │     └── drawing_revisions (R00, R01, R02...)
  │     └── project_images (site milestone timeline)
  └── sessions (persistent 365-day login)
```

---

## 🚀 Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/hwkshivansh6-hub/ARCHIDESK.git
cd ARCHIDESK
npm install
```

### 2. Start Application
```bash
npm start
```

### 3. Open Browser
Navigate to **`http://localhost:3001`**.

#### Default Login Credentials:
- **Email**: `architect@archidesk.com`
- **Password**: `studio2026`
- *(Or register your own real account using the "Register New Account" tab on the login page)*

---

## 🧪 Running System Tests

```bash
node test_system.js
```
Runs end-to-end verification of user auth, relational database links, automatic balance calculations, drawing revision tracking, site milestone timelines, and portfolio aggregates.

---

## 📄 License
MIT © SHASWAT DESIGNS
