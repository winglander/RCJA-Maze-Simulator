const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE ERR:', err.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERR:', m.text()); });

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('file://' + path.resolve('./sandbox.html'), { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 400));

  let pass = 0, fail = 0;
  const ok = (label, cond, detail) => {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else { console.log(`  ✗ ${label}${detail ? '  → ' + detail : ''}`); fail++; }
  };

  console.log('\n[A] Initial button states (idle)');
  {
    const states = await page.evaluate(() => ({
      run: document.getElementById('btnRun').disabled,
      stop: document.getElementById('btnStop').disabled,
      lop: document.getElementById('btnLoP').disabled,
      resetRun: document.getElementById('btnResetRun').disabled,
    }));
    ok('Run enabled', states.run === false);
    ok('Stop disabled', states.stop === true);
    ok('LoP disabled (no active run)', states.lop === true);
    ok('Reset run enabled', states.resetRun === false);
  }

  console.log('\n[B] During run, button states flip');
  {
    await page.click('#btnRun');
    await new Promise(r => setTimeout(r, 300));
    const states = await page.evaluate(() => ({
      run: document.getElementById('btnRun').disabled,
      stop: document.getElementById('btnStop').disabled,
      lop: document.getElementById('btnLoP').disabled,
      resetRun: document.getElementById('btnResetRun').disabled,
    }));
    ok('Run disabled during run', states.run === true);
    ok('Stop enabled during run', states.stop === false);
    ok('LoP enabled during run', states.lop === false);
    ok('Reset run disabled during run', states.resetRun === true);
  }

  console.log('\n[C] Open LoP picker — should pause and show Start checkpoint');
  {
    await page.click('#btnLoP');
    await new Promise(r => setTimeout(r, 200));
    const visible = await page.evaluate(() =>
      !document.getElementById('lopPicker').hidden);
    ok('LoP picker visible', visible);
    const cps = await page.evaluate(() =>
      Array.from(document.getElementById('lopCheckpoints').querySelectorAll('.lop-cp-btn'))
        .map(b => b.textContent.trim()));
    ok('Start checkpoint listed', cps.length >= 1 && cps[0].includes('Start'),
       `cps=${JSON.stringify(cps)}`);
    const status = await page.$eval('#statusStrip', el => el.textContent.replace(/\s+/g, ' ').trim());
    ok('Status shows PAUSED', status.includes('PAUSED') || status.includes('Lack of progress'),
       `status="${status}"`);
    const confirmDisabled = await page.$eval('#lopConfirm', el => el.disabled);
    ok('Confirm disabled until choices made', confirmDisabled === true);
  }

  console.log('\n[D] Pick Start + N, confirm — robot teleports');
  {
    // Click first checkpoint (Start)
    await page.click('.lop-cp-btn');
    await page.click('.lop-dir-btn[data-dir="N"]');
    const confirmDisabled = await page.$eval('#lopConfirm', el => el.disabled);
    ok('Confirm enabled after picking', confirmDisabled === false);

    // Robot must currently be near Start anyway since the run hasn't moved much
    const before = await page.evaluate(() => ({
      x: document.getElementById('poseX').textContent,
      y: document.getElementById('poseY').textContent,
      t: document.getElementById('poseT').textContent,
    }));

    await page.click('#lopConfirm');
    // After confirm, the run resumes and the starter code drives forward. To get
    // a stable pose reading representing the teleport target, immediately stop.
    await page.click('#btnStop');
    await new Promise(r => setTimeout(r, 100));

    const after = await page.evaluate(() => ({
      x: document.getElementById('poseX').textContent,
      y: document.getElementById('poseY').textContent,
      t: document.getElementById('poseT').textContent,
      hidden: document.getElementById('lopPicker').hidden,
    }));
    ok('Picker hidden after confirm', after.hidden === true);
    // After teleport to Start (0, 5) facing N: x=145, y=1595, θ=270.
    // Allow tiny tolerance in case 1-2 sim ticks ran before stop took effect.
    ok('Robot at Start tile (x≈145)', after.x === '145');
    ok('Robot at Start tile (y≈1595, ±20mm)',
       Math.abs(parseInt(after.y) - 1595) < 20, `y=${after.y}`);
    ok('Robot facing N (θ=270°)', after.t === '270');
  }

  console.log('\n[E] Reset run from finished state clears scores + clock');
  {
    // Already stopped from previous block
    const beforeReset = await page.$eval('#timer', el => el.textContent);
    ok('Timer is mid-run before reset (not T-180.0s)', beforeReset !== 'T-180.0s',
       `timer="${beforeReset}"`);

    await page.click('#btnResetRun');
    await new Promise(r => setTimeout(r, 100));
    const afterReset = await page.evaluate(() => ({
      timer: document.getElementById('timer').textContent,
      total: document.getElementById('scoreTotal').textContent,
      poseX: document.getElementById('poseX').textContent,
      poseY: document.getElementById('poseY').textContent,
      runState: document.getElementById('statusStrip').textContent,
    }));
    ok('Timer reset to T-180.0s', afterReset.timer === 'T-180.0s');
    ok('Total score back to 0', afterReset.total === '0');
    ok('Robot back at start (x=145)', afterReset.poseX === '145');
    ok('Robot back at start (y=1595)', afterReset.poseY === '1595');
    ok('State back to IDLE', afterReset.runState.includes('IDLE'));
  }

  console.log('\n[F] Reset run while running is rejected gracefully');
  {
    await page.click('#btnRun');
    await new Promise(r => setTimeout(r, 200));
    // Reset run button should be disabled, but if someone bypasses via JS, the
    // method itself should refuse.
    const refused = await page.evaluate(() => {
      // We can't easily access the App instance, so just trust the disabled state.
      return document.getElementById('btnResetRun').disabled === true;
    });
    ok('Reset run disabled during run (cannot be clicked)', refused);
    await page.click('#btnStop');
  }

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
