// Quotes and deposits click-through against the fake Supabase. Same setup as flow.cjs:
//   node e2e/quotes.cjs <output-dir>
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
const { createFakeSupabase } = require('./fakeSupabase.cjs');

const out = process.argv[2] || 'screenshots';
const base = process.env.BASE_URL || 'http://localhost:4173';
fs.mkdirSync(out, { recursive: true });
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plain = (t) => t.replace(/[  ]/g, ' ');

function expect(cond, msg) {
  if (!cond) throw new Error('CHECK FAILED: ' + msg);
  console.log('  ok  ' + msg);
}

let failPage = null;
(async () => {
  const fake = createFakeSupabase({ today });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.route('**/demo.supabase.co/**', async (route) => {
    const req = route.request();
    const res = fake.handle({ method: req.method(), url: req.url(), headers: req.headers(), body: req.postData(), bodyBuffer: req.postDataBuffer() });
    await route.fulfill({ status: res.status, contentType: res.contentType ?? 'application/json', body: res.body });
  });
  const page = await ctx.newPage();
  failPage = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let n = 0;
  const shot = async (name) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `${pad(++n)}-${name}.png`) });
  };
  const text = async () => plain(await page.locator('main').innerText());
  const download = async (click, name) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
    const file = path.join(out, name);
    await dl.saveAs(file);
    execSync(`pdftoppm -r 60 -png -singlefile ${file} ${file.replace(/\.pdf$/, '')}`);
    return file;
  };
  const pdfText = (file) => execSync(`pdftotext -layout ${file} -`).toString();

  console.log('Sign in');
  await page.goto(base + '/#/sign-in');
  await page.fill('#email', 'owner@example.com');
  await page.fill('#password', 'secret-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Received this month');
  await shot('home-empty');

  console.log('New quote for a new client');
  await page.click('.nav-new');
  await shot('plus-menu');
  await page.click('dialog[open] >> text=New quote');
  await page.waitForSelector('text=Choose client');
  await page.click('.action-bar >> text=Send quote');
  await page.waitForSelector('text=Choose who the quote is for');
  expect(true, 'validation asks for a client');
  await page.click('text=Choose client');
  await page.click('dialog[open] >> text=New client');
  await page.fill('#c-name', 'Mokoena Attorneys');
  await page.fill('#c-contact', 'Thabo Mokoena');
  await page.fill('#c-phone', '082 123 4567');
  await page.click('text=Save and use');
  await page.waitForSelector('.picker >> text=Mokoena Attorneys');
  await page.fill('#q-title', 'New website');
  await page.click('button:has-text("Pick")');
  await page.click('dialog[open] >> text=Website design and build');
  await page.fill('#q0-price', '8 000');
  await page.click('text=Add line');
  await page.click('.line-card >> nth=1 >> button:has-text("Pick")');
  await page.click('dialog[open] >> text=Website hosting and maintenance (monthly)');
  await page.fill('#q1-qty', '12');
  await page.fill('#q1-price', '250');
  await page.fill('#q-notes', 'Five pages, contact form and Google Business Profile. About three weeks.');
  const t = await text();
  expect(t.includes('R 11 000,00') && t.includes('R 5 500,00'), 'live total R 11 000,00 and 50% deposit R 5 500,00');
  await shot('quote-editor');
  await page.click('.action-bar >> text=Save draft');
  await page.waitForSelector('text=Draft saved.');
  await page.waitForSelector('h1 >> text=Edit BMS-Q-0001');
  expect(fake.db.quotes[0].status === 'draft' && fake.db.quotes[0].total_cents === 1100000, 'draft BMS-Q-0001 saved, total R 11 000');

  console.log('Send it');
  await page.click('.action-bar >> text=Send quote');
  await page.waitForSelector('dialog[open] >> text=Send BMS-Q-0001?');
  await shot('send-confirm');
  await page.click('dialog[open] >> button:has-text("Send quote")');
  await page.waitForSelector('text=BMS-Q-0001 is ready');
  const q = fake.db.quotes[0];
  expect(q.status === 'sent' && q.issue_date === today && !!q.customer_snapshot && !!q.seller_snapshot, 'sent: dated today, client and business details snapshotted');
  await shot('quote-sent');
  const quotePdf = await download(() => page.click('.action-bar >> text=Share'), 'BMS-Q-0001.pdf');
  const wa = await page.getAttribute('dialog[open] >> a:has-text("Open WhatsApp")', 'href');
  expect(decodeURIComponent(wa).includes('Hi Thabo, please find quote BMS-Q-0001 for R 11 000,00 attached.'), 'WhatsApp message for the quote');
  const qt = pdfText(quotePdf);
  expect(/QUOTE/.test(qt) && qt.includes('Valid until') && qt.includes('New website') && qt.includes('deposit of R 5 500,00') && !/tax invoice|\bVAT\b/i.test(qt), 'quote PDF: QUOTE, valid until, project, deposit; no VAT');
  await page.keyboard.press('Escape');

  console.log('Client accepts; invoice the deposit');
  await page.click('button:has-text("Accepted")');
  await page.waitForSelector('text=Invoice the deposit');
  expect((await text()).includes('Invoice the deposit · R 5 500,00') && (await text()).includes('Invoice the full amount · R 11 000,00'), 'offers the deposit or the full amount');
  await shot('quote-accepted');
  await page.click('text=Invoice the deposit');
  await page.waitForSelector('text=Deposit invoice for quote');
  expect((await page.inputValue('#l0-desc')) === 'Deposit (50%) for quote BMS-Q-0001: New website' && (await page.inputValue('#l0-price')) === '5500.00', 'draft deposit invoice prefilled');
  await shot('deposit-draft');
  await page.click('.action-bar >> text=Issue invoice');
  await page.click('dialog[open] >> button:has-text("Issue invoice")');
  await page.waitForSelector('h1 >> text=BMS-0001');
  expect((await text()).includes('Deposit for quote BMS-Q-0001'), 'invoice shows which quote it is for');
  const depPdf = await download(() => page.click('text=Download PDF'), 'BMS-0001.pdf');
  const dt = pdfText(depPdf);
  expect(dt.includes('Deposit invoice for quote BMS-Q-0001') && dt.includes('BMS-Q-0001') && /INVOICE/.test(dt), 'deposit invoice PDF names the quote');
  await page.click('.action-bar >> text=Record payment');
  await page.click('text=Save payment');
  await page.waitForSelector('.page-head >> text=Paid');
  await shot('deposit-paid');

  console.log('Back to the quote: invoice the balance');
  await page.click('main >> a:has-text("BMS-Q-0001")');
  await page.waitForSelector('text=Invoice the balance');
  const tq = await text();
  expect(tq.includes('Invoice the balance · R 5 500,00') && !tq.includes('Invoice the deposit'), 'only the balance is offered now');
  await shot('quote-part-invoiced');
  await page.click('text=Invoice the balance');
  await page.waitForSelector('text=Balance invoice for quote');
  await page.click('.action-bar >> text=Issue invoice');
  await page.click('dialog[open] >> button:has-text("Issue invoice")');
  await page.waitForSelector('h1 >> text=BMS-0002');
  await page.click('main >> a:has-text("BMS-Q-0001")');
  await page.waitForSelector('text=Fully invoiced.');
  expect((await text()).includes('Invoiced'), 'quote shows Invoiced');
  await shot('quote-fully-invoiced');
  const numbers = fake.db.invoices.filter((i) => i.number).map((i) => `${i.number}:${i.kind}:${i.total_cents}`).sort();
  expect(JSON.stringify(numbers) === JSON.stringify(['BMS-0001:deposit:550000', 'BMS-0002:balance:550000']), 'deposit and balance invoices, gap-free numbers, R 5 500 each');

  console.log('Revise: duplicate, send, leave waiting');
  await page.click('text=Duplicate as new draft');
  await page.waitForSelector('h1 >> text=Edit BMS-Q-0002');
  await page.fill('#q-deposit', '30');
  await page.fill('#q-title', 'New website, phase 2');
  await page.click('.action-bar >> text=Send quote');
  await page.click('dialog[open] >> button:has-text("Send quote")');
  await page.waitForSelector('text=BMS-Q-0002 is ready');
  expect(Number(fake.db.quotes[1].deposit_percent) === 30, 'deposit changed to 30% on the new quote');

  console.log('Lists');
  await page.click('.bottomnav >> text=Quotes');
  await page.waitForSelector('text=BMS-Q-0002');
  await shot('quotes-list');
  await page.getByRole('tab', { name: /^Waiting/ }).click();
  await page.waitForTimeout(300);
  const lt = await text();
  expect(lt.includes('BMS-Q-0002') && !lt.includes('BMS-Q-0001'), 'Waiting filter');
  await page.click('.bottomnav >> text=Home');
  await page.waitForSelector('text=Quotes to follow up');
  await shot('home');
  await page.goto(base + '/#/customers');
  await page.click('text=Mokoena Attorneys');
  await page.waitForSelector('h2 >> text=Quotes');
  await shot('client');
  await page.goto(base + '/#/settings');
  await page.waitForSelector('legend >> text=Quotes');
  await page.locator('legend:has-text("Quotes")').scrollIntoViewIfNeeded();
  await shot('settings-quotes');

  console.log('Desktop');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(base + `/#/quotes/${fake.db.quotes[0].id}`);
  await page.waitForSelector('text=Fully invoiced.');
  await shot('desktop-quote');
  await page.goto(base + '/#/quotes');
  await page.waitForSelector('text=BMS-Q-0002');
  await shot('desktop-quotes');

  expect(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log('E2E QUOTES PASSED');
})().catch(async (err) => {
  console.error(err.message.split('\n')[0]);
  if (failPage) await failPage.screenshot({ path: path.join(out, 'FAILURE.png') }).catch(() => {});
  process.exit(1);
});
