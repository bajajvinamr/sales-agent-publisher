import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function seed() {
  console.log('Seeding database...')

  // ── Settings ──────────────────────────────────────────────
  await prisma.settings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      dailyTargetVisits: 8,
      alertEmailTo: 'manager@publisher.com',
      managerEmail: 'nishkarsh@publisher.com',
      whatsappGroupName: 'Friends Sales Team',
    },
  })

  // ── Executives ────────────────────────────────────────────
  const execs = [
    { name: 'Fp Tomar', displayName: 'Tomar', phone: '9876543210', email: 'tomar@publisher.com' },
    { name: 'Meenakshi Sales', displayName: 'Meenakshi', phone: '9876543211', email: 'meenakshi@publisher.com' },
    { name: 'S Abdul Rehman Fp', displayName: 'Abdul Rehman', phone: '9876543212', email: 'abdulrehman@publisher.com' },
    { name: 'Akash Kanpur', displayName: 'Akash', phone: '9876543213', email: 'akash@publisher.com' },
    { name: 'Pankaj Joshi', displayName: 'Pankaj', phone: '9876543214', email: 'pankaj@publisher.com' },
    { name: 'Meena Sales', displayName: 'Meena', phone: '9876543215', email: 'meena@publisher.com' },
    { name: 'Sunil (Sales)', displayName: 'Sunil', phone: '9876543216', email: 'sunil@publisher.com' },
    { name: 'Surinder Punjab', displayName: 'Surinder', phone: '9876543217', email: 'surinder@publisher.com' },
    { name: 'Siddhi Sales - Faridabad', displayName: 'Siddhi', phone: '9876543218', email: 'siddhi@publisher.com' },
  ]

  const execRecords: Record<string, string> = {}
  for (const exec of execs) {
    const record = await prisma.executive.upsert({
      where: { id: exec.name.replace(/\s/g, '-').toLowerCase() },
      update: {},
      create: {
        id: exec.name.replace(/\s/g, '-').toLowerCase(),
        ...exec,
        dailyTarget: 8,
        active: true,
      },
    })
    execRecords[exec.displayName] = record.id
  }

  // ── Schools ───────────────────────────────────────────────
  const schools = [
    { canonicalName: 'Silver Shine School', board: 'CBSE', lastKnownStrength: 900, address: 'Ghaziabad', principalName: 'Mrs Bhardwaj', principalMobile: '9718366890' },
    { canonicalName: 'Silver Line Prestige School', board: 'CBSE', lastKnownStrength: 3000, address: 'Ghaziabad', principalName: 'Mrs Gupta' },
    { canonicalName: 'Modern Indian School', board: 'ICSE', lastKnownStrength: 500, principalName: 'Mrs Preeti Sharma', principalMobile: '8859040880' },
    { canonicalName: 'Raj Kumar Academy', board: 'ICSE', lastKnownStrength: 1400, principalName: 'Mr Sunil Kumar', bookSeller: 'Sample received' },
    { canonicalName: 'Noble Public School', board: 'CBSE', lastKnownStrength: 600, address: 'Phulpur', principalName: 'Mr. Awadhesh', principalMobile: '9918076076' },
    { canonicalName: 'Dr. Virendra Swaroop Education Centre', board: 'CBSE', lastKnownStrength: 900, address: 'Cantt, Kanpur', principalName: 'Mr Rai' },
    { canonicalName: 'Alpine International School', board: 'CBSE', lastKnownStrength: 400, address: 'Thanabhawan', principalName: 'Mrs Priti' },
    { canonicalName: 'Umanath Singh Sen Sec School', board: 'CBSE', lastKnownStrength: 800, address: 'Jaffarabad', principalName: 'S.P. Singh' },
    { canonicalName: 'St. Xavier Sr. Sec. School', board: 'CBSE', lastKnownStrength: 1200, address: 'Berkheda, Bhopal', principalName: 'Father Thomas', principalMobile: '9827164835' },
    { canonicalName: 'Holy Family Convent School', board: 'CBSE', lastKnownStrength: 1500, address: 'Sri Hargobindpur, Punjab', principalName: 'Sr. Mary' },
    { canonicalName: 'Arpan Public School', board: 'CBSE', lastKnownStrength: 350, address: 'Thanabhawan', principalName: 'Mr Verma' },
    { canonicalName: 'Ingram CBSE School', board: 'CBSE', lastKnownStrength: 1100, address: 'Ghaziabad', principalName: 'Mrs Singh' },
    { canonicalName: 'Sanskar Public School', board: 'CBSE', lastKnownStrength: 500, address: 'Phulpur', principalName: 'Mr Pandey' },
    { canonicalName: 'Sidheshwar Sr Sec School', board: 'CBSE', lastKnownStrength: 2000, address: 'Sec 9A, Gurgaon', principalName: 'Mr Sharma' },
    { canonicalName: 'Sidheshwar Sr Sec School (Primary Wing)', board: 'CBSE', lastKnownStrength: 800, address: 'Sec 9A, Gurgaon' },
    // Extra schools for demo volume
    { canonicalName: 'Delhi Public School', board: 'CBSE', lastKnownStrength: 2500, address: 'Sector 12, Bhopal', principalName: 'Dr. Verma', principalMobile: '9425111222' },
    { canonicalName: 'Kendriya Vidyalaya', board: 'CBSE', lastKnownStrength: 1800, address: 'Kolar Road, Bhopal', principalName: 'Mrs Saxena' },
    { canonicalName: 'Carmel Convent School', board: 'CBSE', lastKnownStrength: 1600, address: 'Kolar Road, Bhopal', principalName: 'Sr. Mary Thomas', principalMobile: '9425333444', bookSeller: 'Gupta Book Store' },
  ]

  const schoolRecords: Record<string, string> = {}
  for (const school of schools) {
    const record = await prisma.school.create({
      data: {
        ...school,
        aliases: '[]',
      },
    })
    schoolRecords[school.canonicalName] = record.id
  }

  // ── Visits — today's data (for dashboard) ─────────────────
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const twoDaysAgo = new Date(today)
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

  const todayVisits = [
    // Tomar — 6 visits (under target)
    { exec: 'Tomar', school: 'Silver Shine School', board: 'CBSE', strength: 900, principal: 'Mrs Bhardwaj', mobile: '9718366890', remark: 'Sampling', remarkDetail: 'Samples delivered, follow up next week', complete: true },
    { exec: 'Tomar', school: 'Silver Line Prestige School', board: 'CBSE', strength: 3000, principal: 'Mrs Gupta', remark: 'Meeting with Principal', remarkDetail: 'Very positive meeting, interested in maths books', complete: true },
    { exec: 'Tomar', school: 'Ingram CBSE School', board: 'CBSE', strength: 1100, principal: 'Mrs Singh', remark: 'New Visit', complete: true },
    { exec: 'Tomar', school: 'Delhi Public School', board: 'CBSE', strength: 2500, principal: 'Dr. Verma', mobile: '9425111222', remark: 'Follow up Visit', remarkDetail: 'Order discussion pending', complete: true },
    { exec: 'Tomar', school: 'Kendriya Vidyalaya', board: 'CBSE', strength: 1800, principal: 'Mrs Saxena', remark: 'New Visit', complete: false, missing: ['principalMobile'] },
    { exec: 'Tomar', school: 'Carmel Convent School', board: 'CBSE', strength: 1600, principal: 'Sr. Mary Thomas', mobile: '9425333444', remark: 'Sampling', complete: true },
    // Meenakshi — 9 visits (above target)
    { exec: 'Meenakshi', school: 'Modern Indian School', board: 'ICSE', strength: 500, principal: 'Mrs Preeti Sharma', mobile: '8859040880', remark: 'Meeting with Principal', complete: true },
    { exec: 'Meenakshi', school: 'Raj Kumar Academy', board: 'ICSE', strength: 1400, principal: 'Mr Sunil Kumar', remark: 'Sampling', remarkDetail: 'Sample received', complete: true },
    { exec: 'Meenakshi', school: 'Noble Public School', board: 'CBSE', strength: 600, principal: 'Mr. Awadhesh', mobile: '9918076076', remark: 'Follow up Visit', complete: true },
    { exec: 'Meenakshi', school: 'Alpine International School', board: 'CBSE', strength: 400, principal: 'Mrs Priti', remark: 'New Visit', complete: true },
    { exec: 'Meenakshi', school: 'Arpan Public School', board: 'CBSE', strength: 350, principal: 'Mr Verma', remark: 'New Visit', complete: true },
    { exec: 'Meenakshi', school: 'Delhi Public School', board: 'CBSE', strength: 2500, principal: 'Dr. Verma', remark: 'Sampling', complete: true },
    { exec: 'Meenakshi', school: 'Kendriya Vidyalaya', board: 'CBSE', strength: 1800, principal: 'Mrs Saxena', remark: 'Meeting with Principal', complete: false, missing: ['principalMobile', 'bookSeller'] },
    { exec: 'Meenakshi', school: 'Carmel Convent School', board: 'CBSE', strength: 1600, principal: 'Sr. Mary Thomas', remark: 'Follow up Visit', complete: true },
    { exec: 'Meenakshi', school: 'St. Xavier Sr. Sec. School', board: 'CBSE', strength: 1200, principal: 'Father Thomas', remark: 'New Visit', complete: true },
    // Abdul Rehman — 8 visits (exactly on target)
    { exec: 'Abdul Rehman', school: 'Noble Public School', board: 'CBSE', strength: 600, principal: 'Mr. Awadhesh', mobile: '9918076076', remark: 'Sampling', complete: true },
    { exec: 'Abdul Rehman', school: 'Sanskar Public School', board: 'CBSE', strength: 500, principal: 'Mr Pandey', remark: 'New Visit', complete: true },
    { exec: 'Abdul Rehman', school: 'Umanath Singh Sen Sec School', board: 'CBSE', strength: 800, principal: 'S.P. Singh', remark: 'Follow up Visit', complete: true },
    { exec: 'Abdul Rehman', school: 'Modern Indian School', board: 'ICSE', strength: 500, principal: 'Mrs Preeti Sharma', remark: 'Meeting with Principal', complete: true },
    { exec: 'Abdul Rehman', school: 'Silver Shine School', board: 'CBSE', strength: 900, principal: 'Mrs Bhardwaj', remark: 'New Visit', complete: true },
    { exec: 'Abdul Rehman', school: 'Alpine International School', board: 'CBSE', strength: 400, principal: 'Mrs Priti', remark: 'Sampling', complete: true },
    { exec: 'Abdul Rehman', school: 'Raj Kumar Academy', board: 'ICSE', strength: 1400, principal: 'Mr Sunil Kumar', remark: 'Follow up Visit', complete: true },
    { exec: 'Abdul Rehman', school: 'Ingram CBSE School', board: 'CBSE', strength: 1100, principal: 'Mrs Singh', remark: 'New Visit', complete: false, missing: ['principalMobile'] },
    // Akash — 4 visits (under target)
    { exec: 'Akash', school: 'Dr. Virendra Swaroop Education Centre', board: 'CBSE', strength: 900, principal: 'Mr Rai', remark: 'Meeting with Principal', remarkDetail: 'Principal interested, asked for Hindi book samples', complete: true },
    { exec: 'Akash', school: 'Delhi Public School', board: 'CBSE', strength: 2500, principal: 'Dr. Verma', remark: 'New Visit', complete: true },
    { exec: 'Akash', school: 'Carmel Convent School', board: 'CBSE', strength: 1600, principal: 'Sr. Mary Thomas', remark: 'Sampling', complete: true },
    { exec: 'Akash', school: 'Kendriya Vidyalaya', board: 'CBSE', strength: 1800, principal: 'Mrs Saxena', remark: 'Follow up Visit', complete: false, missing: ['principalMobile', 'bookSeller'] },
    // Pankaj — 7 visits
    { exec: 'Pankaj', school: 'Alpine International School', board: 'CBSE', strength: 400, principal: 'Mrs Priti', remark: 'Meeting with Principal', complete: true },
    { exec: 'Pankaj', school: 'Arpan Public School', board: 'CBSE', strength: 350, principal: 'Mr Verma', remark: 'New Visit', complete: true },
    { exec: 'Pankaj', school: 'Silver Shine School', board: 'CBSE', strength: 900, principal: 'Mrs Bhardwaj', remark: 'Follow up Visit', complete: true },
    { exec: 'Pankaj', school: 'Raj Kumar Academy', board: 'ICSE', strength: 1400, principal: 'Mr Sunil Kumar', remark: 'Sampling', complete: true },
    { exec: 'Pankaj', school: 'Modern Indian School', board: 'ICSE', strength: 500, principal: 'Mrs Preeti Sharma', remark: 'New Visit', complete: true },
    { exec: 'Pankaj', school: 'Holy Family Convent School', board: 'CBSE', strength: 1500, principal: 'Sr. Mary', remark: 'New Visit', complete: true },
    { exec: 'Pankaj', school: 'St. Xavier Sr. Sec. School', board: 'CBSE', strength: 1200, principal: 'Father Thomas', remark: 'Follow up Visit', complete: true },
    // Sunil — 3 visits (very under target)
    { exec: 'Sunil', school: 'St. Xavier Sr. Sec. School', board: 'CBSE', strength: 1200, principal: 'Father Thomas', mobile: '9827164835', remark: 'Sampling', remarkDetail: 'English samples delivered', complete: true },
    { exec: 'Sunil', school: 'Delhi Public School', board: 'CBSE', strength: 2500, principal: 'Dr. Verma', remark: 'New Visit', complete: true },
    { exec: 'Sunil', school: 'Carmel Convent School', board: 'CBSE', strength: 1600, principal: 'Sr. Mary Thomas', remark: 'Meeting with Principal', complete: true },
    // Surinder — 5 visits
    { exec: 'Surinder', school: 'Holy Family Convent School', board: 'CBSE', strength: 1500, principal: 'Sr. Mary', remark: 'Meeting with Principal', remarkDetail: 'Good meeting, order likely', complete: true },
    { exec: 'Surinder', school: 'Silver Line Prestige School', board: 'CBSE', strength: 3000, principal: 'Mrs Gupta', remark: 'Follow up Visit', complete: true },
    { exec: 'Surinder', school: 'Sanskar Public School', board: 'CBSE', strength: 500, principal: 'Mr Pandey', remark: 'Sampling', complete: true },
    { exec: 'Surinder', school: 'Noble Public School', board: 'CBSE', strength: 600, principal: 'Mr. Awadhesh', remark: 'New Visit', complete: true },
    { exec: 'Surinder', school: 'Ingram CBSE School', board: 'CBSE', strength: 1100, principal: 'Mrs Singh', remark: 'New Visit', complete: false, missing: ['principalMobile'] },
    // Siddhi — 10 visits (star performer)
    { exec: 'Siddhi', school: 'Sidheshwar Sr Sec School', board: 'CBSE', strength: 2000, principal: 'Mr Sharma', remark: 'Order Received', remarkDetail: 'Order confirmed for 500 books', complete: true },
    { exec: 'Siddhi', school: 'Sidheshwar Sr Sec School (Primary Wing)', board: 'CBSE', strength: 800, remark: 'Sampling', complete: true },
    { exec: 'Siddhi', school: 'Delhi Public School', board: 'CBSE', strength: 2500, principal: 'Dr. Verma', remark: 'Meeting with Principal', complete: true },
    { exec: 'Siddhi', school: 'Carmel Convent School', board: 'CBSE', strength: 1600, principal: 'Sr. Mary Thomas', remark: 'Sampling', complete: true },
    { exec: 'Siddhi', school: 'Kendriya Vidyalaya', board: 'CBSE', strength: 1800, principal: 'Mrs Saxena', remark: 'Follow up Visit', complete: true },
    { exec: 'Siddhi', school: 'Modern Indian School', board: 'ICSE', strength: 500, principal: 'Mrs Preeti Sharma', remark: 'New Visit', complete: true },
    { exec: 'Siddhi', school: 'Raj Kumar Academy', board: 'ICSE', strength: 1400, principal: 'Mr Sunil Kumar', remark: 'Sampling', complete: true },
    { exec: 'Siddhi', school: 'St. Xavier Sr. Sec. School', board: 'CBSE', strength: 1200, principal: 'Father Thomas', remark: 'Meeting with Principal', complete: true },
    { exec: 'Siddhi', school: 'Noble Public School', board: 'CBSE', strength: 600, principal: 'Mr. Awadhesh', remark: 'Follow up Visit', complete: true },
    { exec: 'Siddhi', school: 'Alpine International School', board: 'CBSE', strength: 400, principal: 'Mrs Priti', remark: 'New Visit', complete: true },
  ]

  // No report from Meena today — will trigger NO_REPORT alert

  for (const v of todayVisits) {
    await prisma.visit.create({
      data: {
        executiveId: execRecords[v.exec],
        schoolId: schoolRecords[v.school] || null,
        visitDate: today,
        schoolNameRaw: v.school,
        board: v.board,
        strength: v.strength,
        principalName: v.principal,
        principalMobile: v.mobile || null,
        remark: v.remark,
        remarkDetail: v.remarkDetail || null,
        dataComplete: v.complete ?? true,
        missingFields: JSON.stringify(v.missing || []),
        extractionModel: 'haiku',
        isRepeatVisit: false,
        visitNumberInSession: 1,
        changesFromLast: '[]',
      },
    })
  }

  // ── Alerts ────────────────────────────────────────────────
  const alerts = [
    { exec: 'Sunil', type: 'TARGET_NOT_MET', message: 'Only 3/8 visits today. Gap: 5 visits.', severity: 'high' },
    { exec: 'Akash', type: 'TARGET_NOT_MET', message: 'Only 4/8 visits today. Gap: 4 visits.', severity: 'high' },
    { exec: 'Meena', type: 'NO_REPORT', message: 'No visit reports received today.', severity: 'high' },
    { exec: 'Tomar', type: 'MISSING_DATA', message: 'Missing principal mobile for Kendriya Vidyalaya', severity: 'medium' },
    { exec: 'Meenakshi', type: 'MISSING_DATA', message: 'Missing principal mobile and book seller for Kendriya Vidyalaya', severity: 'medium' },
    { exec: 'Abdul Rehman', type: 'MISSING_DATA', message: 'Missing principal mobile for Ingram CBSE School', severity: 'medium' },
    { exec: 'Surinder', type: 'TARGET_NOT_MET', message: 'Only 5/8 visits today. Gap: 3 visits.', severity: 'medium' },
    { exec: 'Siddhi', type: 'STATUS_CHANGED', message: 'Sidheshwar Sr Sec School: status changed to Order Received', severity: 'low' },
  ]

  for (const a of alerts) {
    await prisma.alert.create({
      data: {
        executiveId: execRecords[a.exec],
        alertType: a.type,
        message: a.message,
        severity: a.severity,
        resolved: false,
      },
    })
  }

  // ── Daily Summary ─────────────────────────────────────────
  await prisma.dailySummary.create({
    data: {
      summaryDate: today,
      totalExecutivesReporting: 8,
      totalVisits: todayVisits.length,
      avgVisitsPerExec: Math.round((todayVisits.length / 8) * 10) / 10,
      targetsMetCount: 3, // Meenakshi (9), Abdul Rehman (8), Siddhi (10)
      targetsMissedCount: 5,
      newSchoolsCount: 14,
      repeatVisitsCount: todayVisits.length - 14,
      dataCompletenessPct: Math.round((todayVisits.filter(v => v.complete !== false).length / todayVisits.length) * 100),
      summaryText: `Today: 8 of 9 executives reported. ${todayVisits.length} total visits (avg ${(todayVisits.length / 8).toFixed(1)}/exec). Meenakshi (9) and Siddhi (10) exceeded target. Sunil significantly under at 3/8. Meena did not report — needs follow-up. 4 records have missing data fields. Siddhi closed an order at Sidheshwar Sr Sec School — 500 books confirmed.`,
    },
  })

  // ── Ingestion Run ─────────────────────────────────────────
  await prisma.ingestionRun.create({
    data: {
      runDate: today,
      messagesScraped: 213,
      messagesAfterFilter: 187,
      chunksCreated: 52,
      visitsExtracted: todayVisits.length,
      alertsGenerated: alerts.length,
      haikuTokensUsed: 25996,
      sonnetTokensUsed: 1200,
      status: 'success',
    },
  })

  console.log(`Seeded: ${execs.length} executives, ${schools.length} schools, ${todayVisits.length} visits, ${alerts.length} alerts`)
  console.log('Done!')
}

seed()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
