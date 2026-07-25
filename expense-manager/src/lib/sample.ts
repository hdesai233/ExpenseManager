import type { Account, AppData, ImportBatch } from '../types';
import { addMonths, currentYM, daysInMonth, todayISO, uid } from './format';
import { ingestRows, type IngestRow } from './ingest';
import { seedCategories, seedRules } from './seed';

// ---- Deterministic sample dataset: ~6 months across 4 accounts ----

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSampleData(): AppData {
  const rnd = mulberry32(20260719);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const jitter = (base: number, pct: number) => Math.round(base * (1 + (rnd() * 2 - 1) * pct) * 100) / 100;

  const accounts: Account[] = [
    { id: 'chase', name: 'Chase Sapphire', issuingBank: 'Chase', accountType: 'credit_card', lastFour: '4021', color: '#1f6f5c' },
    { id: 'amex', name: 'Amex Everyday', issuingBank: 'American Express', accountType: 'credit_card', lastFour: '3007', color: '#4a9d86' },
    { id: 'bofa', name: 'BofA Checking', issuingBank: 'Bank of America', accountType: 'checking', lastFour: '8842', color: '#5a7f9c' },
    { id: 'ally', name: 'Ally Savings', issuingBank: 'Ally', accountType: 'savings', lastFour: '1190', color: '#c8892b' },
  ];

  const today = todayISO();
  const thisYM = currentYM();
  const rows: IngestRow[] = [];
  const add = (date: string, merchantRaw: string, amount: number, accountId: string) => {
    if (date <= today) rows.push({ date, merchantRaw, amount, accountId });
  };
  const day = (ym: string, d: number) => `${ym}-${String(Math.min(d, daysInMonth(ym))).padStart(2, '0')}`;

  for (let mi = 5; mi >= 0; mi--) {
    const ym = addMonths(thisYM, -mi);

    // --- housing ---
    add(day(ym, 1), 'VENICE PROPERTY MGMT RENT', -1450, 'bofa');
    add(day(ym, 6), 'PGANDE WEB ONLINE CA', -jitter(190, 0.35), 'bofa');
    add(day(ym, 11), 'COMCAST XFINITY INTERNET', -89.99, 'bofa');
    add(day(ym, 19), 'T-MOBILE PCS SVC', -95.0, 'bofa');

    // --- subscriptions ---
    add(day(ym, 15), 'NETFLIX.COM NETFLIX.COM CA', -22.99, 'chase');
    add(day(ym, 3), 'SPOTIFY USA', -16.99, 'chase');
    add(day(ym, 9), 'ADOBE CREATIVE CLOUD', -59.99, 'chase');
    add(day(ym, 12), 'PELOTON INTERACTIVE', -44.0, 'amex');
    add(day(ym, 1), 'APPLE.COM/BILL ICLOUD', -9.99, 'chase');
    add(day(ym, 21), 'NYTIMES DIGITAL SUBSCRIPTION', -17.0, 'chase');

    // --- groceries ---
    for (const d of [4, 11, 18, 25]) add(day(ym, d), `WHOLEFDS MKT #10231 OAKLAND CA`, -jitter(120, 0.35), 'bofa');
    add(day(ym, 12), 'COSTCO WHSE #0455 RICHMOND CA', -jitter(210, 0.25), 'amex');
    add(day(ym, 20), "TRADER JOE'S #204 BERKELEY CA", -jitter(62, 0.3), 'amex');

    // --- gas / transport ---
    for (const d of [5, 16, 26]) add(day(ym, d), 'SHELL OIL 57444 BERKELEY CA', -jitter(56, 0.25), 'amex');
    for (let i = 0; i < 4; i++) add(day(ym, 3 + Math.floor(rnd() * 24)), 'UBER *TRIP HELP.UBER.C', -jitter(19, 0.5), 'chase');
    add(day(ym, 14), 'DOWNTOWN CENTER GARAGE PARKING', -jitter(14, 0.4), 'chase');

    // --- coffee ---
    for (let i = 0; i < 6; i++) add(day(ym, 2 + Math.floor(rnd() * 25)), 'SQ *BLUE BOTTLE COFFE OAKLAND', -jitter(8.25, 0.3), 'chase');
    for (let i = 0; i < 3; i++) add(day(ym, 2 + Math.floor(rnd() * 25)), 'STARBUCKS STORE 05972', -jitter(7.1, 0.3), 'amex');

    // --- restaurants / delivery ---
    const spots = ['TST* THE MIDNIGHT DIN', 'SQ *COMAL RESTAURANT BERKELEY', 'CHIPOTLE 2214 EMERYVILLE CA', 'TST* GREAT CHINA', 'SQ *TACOS EL GORDO'];
    for (let i = 0; i < 5; i++) add(day(ym, 2 + Math.floor(rnd() * 26)), pick(spots), -jitter(48, 0.6), 'chase');
    add(day(ym, 8), 'DD DOORDASH THAIHOUSE', -jitter(42, 0.4), 'chase');

    // --- shopping ---
    add(day(ym, 9), 'TARGET T-2841 EMERYVILLE CA', -jitter(85, 0.5), 'amex');
    for (let i = 0; i < 3; i++) add(day(ym, 2 + Math.floor(rnd() * 26)), 'AMZN MKTP US*2H4LK90 AMZN.COM/BILL', -jitter(38, 0.8), 'chase');
    if (mi % 2 === 0) add(day(ym, 22), 'UNIQLO USA SAN FRANCISCO CA', -jitter(74, 0.4), 'amex');

    // --- health ---
    add(day(ym, 17), 'CVS/PHARMACY #09611', -jitter(28, 0.5), 'amex');
    if (mi % 3 === 1) add(day(ym, 23), 'BAY AREA MEDICAL GROUP', -jitter(45, 0.3), 'bofa');

    // --- entertainment / misc ---
    if (mi % 2 === 1) add(day(ym, 20), 'FANDANGO MOVIE TICKETS', -jitter(32, 0.3), 'chase');
    if (mi === 2) add(day(ym, 13), 'SOUTHWES 5262104733901 FLIGHT', -310, 'chase');
    if (mi === 2) add(day(ym, 28), 'AIRBNB * HM8Q2ZW9XK', -jitter(240, 0.1), 'chase');

    // --- a return / merchant credit ---
    if (mi % 2 === 0) add(day(ym, 16), 'TARGET REFUND T-2841', jitter(34, 0.3), 'amex');

    // --- credit card payments: debit on checking + credit on each card (paired legs) ---
    const chasePay = 1200 + Math.round(rnd() * 400);
    const amexPay = 600 + Math.round(rnd() * 200);
    add(day(ym, 18), 'CHASE CREDIT CRD AUTOPAY', -chasePay, 'bofa');
    add(day(ym, 18), 'PAYMENT THANK YOU-WEB', chasePay, 'chase');
    add(day(ym, 24), 'AMERICAN EXPRESS ACH PMT', -amexPay, 'bofa');
    add(day(ym, 24), 'ONLINE PAYMENT - THANK YOU', amexPay, 'amex');

    // --- transfer to savings (both legs) ---
    add(day(ym, 14), 'ONLINE TRANSFER TO SAV ...1190', -1000, 'bofa');
    add(day(ym, 14), 'ONLINE TRANSFER FROM CHK ...8842', 1000, 'ally');
  }

  // a couple of fresh unrecognized merchants near today → live review queue
  add(today, 'PADDLE.NET* SUBLIMETEXT', -99.0, 'chase');

  const categories = seedCategories();
  const rules = seedRules();

  const batch: ImportBatch = {
    id: uid(),
    accountId: 'bofa',
    sourceFilename: 'sample-data.generated',
    importedAt: new Date().toISOString(),
    rowCount: rows.length,
    profileId: null,
  };

  rows.sort((a, b) => a.date.localeCompare(b.date));
  const transactions = ingestRows(rows, accounts, rules, [], batch.id);

  // Simulate history: anything before this month was already reviewed/confirmed
  // by the user, so the live review queue only holds recent items.
  const monthStart = `${thisYM}-01`;
  for (const t of transactions) {
    if (t.date < monthStart && (t.confidence < 0.7 || !t.categoryId) && t.flowType !== 'transfer') {
      if (t.categoryId) {
        t.reviewed = true;
      } else {
        t.categoryId = 'food';
        t.subcategoryId = 'restaurants';
        t.confidence = 1;
        t.categorizationSource = 'manual';
        t.reviewed = true;
      }
    }
  }

  return {
    schemaVersion: 1,
    accounts,
    transactions,
    categories,
    rules,
    batches: [batch],
    profiles: [],
    settings: {
      apiFallbackEnabled: false, aiProvider: 'anthropic', aiModels: {}, householdName: 'Rivera Household',
      autoReportEnabled: false, autoReportFolder: '', autoReportLastYM: '', dismissedSubscriptions: [],
    },
  };
}
