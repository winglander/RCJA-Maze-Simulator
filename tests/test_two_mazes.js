// Test the exemplar against both preset mazes via the new buttons
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const exemplarSrc = fs.readFileSync('./exemplar.js', 'utf8');

async function runOnce(mazeButton, label) {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('file://' + path.resolve('./sandbox.html'), { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  await page.click(mazeButton);
  await new Promise(r => setTimeout(r, 300));

  await page.evaluate((src) => {
    document.getElementById('codeEditor').value = src;
  }, exemplarSrc);
  await page.select('#speedSelect', '20');
  await page.click('#btnRun');

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    const status = await page.$eval('#statusStrip', el => el.textContent);
    if (status.includes('FINISHED')) break;
  }

  const final = await page.evaluate(() => ({
    total:  document.getElementById('scoreTotal').textContent,
    green:  document.getElementById('scoreGreen').textContent,
    red:    document.getElementById('scoreRed').textContent,
  }));
  console.log(`  [${label}] score=${final.total}  green=${final.green}  red=${final.red}`);
  await browser.close();
  return final;
}

(async () => {
  console.log('Test maze:');
  for (let i = 0; i < 3; i++) await runOnce('#btnTestMaze', `test_run${i+1}`);
})();
