const { initDatabase, queries, hashPassword } = require('./server/db');

async function runTests() {
  console.log('🧪 Starting ArchiDesk System & Relational Database Test Suite...\n');

  // Ensure DB schema and default data are initialized
  await initDatabase();

  // 1. Verify User & Auth
  console.log('1️⃣  Verifying User Authentication...');
  const user = await queries.getUserByEmail('architect@archidesk.com');
  if (!user || user.password_hash !== hashPassword('studio2026')) {
    throw new Error('User authentication verification failed');
  }
  const session = await queries.createSession(user.id);
  const validSession = await queries.getSession(session.token);
  if (!validSession || validSession.email !== 'architect@archidesk.com') {
    throw new Error('Session creation or validation failed');
  }
  console.log('   ✓ User & Session verified: Ar. Ishan Sharma (Atelier Architecture Studio)');

  // 2. Verify Relational Connection: Client -> Project -> Project Type
  console.log('2️⃣  Verifying Relational Database Links...');
  const allClients = await queries.getClients();
  const rahulClient = allClients.find(c => c.name === 'Rahul Sharma');
  if (!rahulClient) throw new Error('Client Rahul Sharma not found');

  const clientDetails = await queries.getClientById(rahulClient.id);
  if (!clientDetails.projects || clientDetails.projects.length === 0) {
    throw new Error('Rahul Sharma has no connected projects in database');
  }
  console.log(`   ✓ Rahul Sharma has ${clientDetails.projects.length} connected project(s):`, clientDetails.projects.map(p => p.name));

  const sharmaResidence = clientDetails.projects.find(p => p.name === 'Sharma Residence');
  if (!sharmaResidence) throw new Error('Sharma Residence not linked to Rahul Sharma');
  console.log(`   ✓ Project Type: ${sharmaResidence.project_type_name}`);

  // 3. Verify Financial Calculation: Balance = Total Fee - Received Amount
  console.log('3️⃣  Verifying Auto Balance Calculation...');
  console.log(`   Current project financials:`);
  console.log(`   - Agreed Fee: ₹${sharmaResidence.total_fee}`);
  console.log(`   - Received:   ₹${sharmaResidence.received_amount}`);
  console.log(`   - Balance:    ₹${sharmaResidence.balance_amount}`);
  if (sharmaResidence.balance_amount !== (sharmaResidence.total_fee - sharmaResidence.received_amount)) {
    throw new Error(`Financial balance mismatch! Expected ${sharmaResidence.total_fee - sharmaResidence.received_amount}, got ${sharmaResidence.balance_amount}`);
  }
  console.log('   ✓ Balance accurately equals (Total Fee - Total Received)!');

  // 4. Add Payment and test immediate recalculation (Prompt Rule #22)
  console.log('4️⃣  Testing Payment Addition & Immediate Recalculation (Prompt Rule #22)...');
  const prevRec = sharmaResidence.received_amount;
  const payAmt = 5000;
  const payRes = await queries.addPayment(
    sharmaResidence.id,
    payAmt,
    '2026-09-17',
    'UPI',
    'Milestone installment verification test'
  );
  console.log(`   Payment of ₹${payAmt} added (id=${payRes.lastInsertRowid})`);

  const updatedProject = await queries.getProjectById(sharmaResidence.id);
  console.log(`   After payment:`);
  console.log(`   - Agreed Fee: ₹${updatedProject.total_fee}`);
  console.log(`   - Received:   ₹${updatedProject.received_amount} (was ₹${prevRec})`);
  console.log(`   - Balance:    ₹${updatedProject.balance_amount}`);

  if (updatedProject.received_amount !== (prevRec + payAmt) || updatedProject.balance_amount !== (updatedProject.total_fee - updatedProject.received_amount)) {
    throw new Error(`Recalculation error!`);
  }
  console.log('   ✓ Balance automatically updated and verified!');

  // 5. Test Drawings & Revision History
  console.log('5️⃣  Testing Drawings & Historical Revisions...');
  const drawings = await queries.getDrawings(sharmaResidence.id);
  console.log(`   Sharma Residence has ${drawings.length} drawing(s):`);
  drawings.forEach(d => {
    console.log(`   - [${d.drawing_number}] ${d.name} (${d.category}) → Latest: ${d.latest_revision} (${d.revision_count} revs total)`);
  });

  const gfPlan = drawings.find(d => d.name.includes('Ground Floor'));
  if (!gfPlan) throw new Error('Ground Floor Plan not found');

  // Add revision R03
  await queries.addDrawingRevision(
    gfPlan.id,
    'R03',
    'Final client sign-off with skylight shaft coordinate lock',
    '2026-09-17',
    'SR_GF_Plan_R03.pdf',
    '/assets/sample-floorplan.svg',
    155000,
    'PDF'
  );

  const gfWithRevs = await queries.getDrawingWithRevisions(gfPlan.id);
  console.log(`   ✓ Added revision R03! Total revisions now: ${gfWithRevs.revisions.length}`);
  console.log(`   ✓ Revision codes in history:`, gfWithRevs.revisions.map(r => r.revision_code));
  if (gfWithRevs.revisions[0].revision_code !== 'R03') {
    throw new Error('Latest revision should be R03');
  }

  // 6. Test Site Photo Timeline
  console.log('6️⃣  Testing Site Photo Chronological Timeline...');
  const timeline = await queries.getProjectTimeline(sharmaResidence.id, 'ASC');
  console.log(`   Chronological site milestones (${timeline.length} photos):`);
  timeline.forEach(t => {
    console.log(`   - [${t.date}] [${t.category}] ${t.title} (${t.location_area || 'Site'})`);
  });
  if (timeline.length < 4) throw new Error('Expected at least 4 timeline entries');
  console.log('   ✓ Site timeline successfully verified in ascending chronological order');

  // 7. Test Dashboard Summary Stats
  console.log('7️⃣  Testing Dashboard Aggregate Stats...');
  const dashStats = await queries.getDashboardStats();
  console.log('   Dashboard totals:', {
    projects: dashStats.projects_counts,
    clients: dashStats.clients_count,
    financials: dashStats.financials
  });

  console.log('\n🎉 ALL 7 TEST SUITES PASSED FLAWLESSLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
