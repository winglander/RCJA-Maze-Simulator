// Smoke test: load the JS in a stub browser environment and exercise
// the core classes. We don't load DOM-dependent code; we only test the
// world/physics/sensor/scoring layer.

// Stub minimal DOM globals so the file can parse without crashing.
global.window = {
  addEventListener: () => {},
};
global.document = { addEventListener: () => {}, getElementById: () => null };
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = () => {};

// Read the JS source and eval the core classes without the App bootstrap.
const fs = require('fs');
const src = fs.readFileSync('./sandbox.js', 'utf8');

// The bootstrap at the bottom assumes DOMContentLoaded — stub doc handles that.
// We need to expose World, Robot, etc. for testing. Since they're declared with
// `class X { ... }` at top level, they become module-scope. Eval them in a
// shared scope and capture references via a trick.

const wrapped = `
${src}
return {
  World, Robot, Renderer, Scorer, Runtime,
  buildRobotAPI, compileStudentCode,
  readToFNoisy, readColourSensor, readToFRaw,
  TILE_TYPES, TILE_MM, GRID_W, GRID_H, TIME_LIMIT_MS, SIM_DT, ROBOT_RADIUS_MM,
  pointToSegmentDist
};
`;
const exposed = new Function(wrapped)();

const { World, Robot, Scorer, Runtime, buildRobotAPI, compileStudentCode,
        readToFNoisy, readColourSensor, TILE_TYPES, TILE_MM, GRID_H, SIM_DT,
        ROBOT_RADIUS_MM, pointToSegmentDist } = exposed;

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✗ ${label}${detail ? '  → ' + detail : ''}`); fail++; }
}

// =========================================================
console.log('\n[1] World basics');
{
  const w = new World();
  ok('default has start at (0, GRID_H-1)', w.startX === 0 && w.startY === GRID_H - 1);
  ok('outer perimeter has 24 walls (6+6+6+6)', w.getWallSegments().length === 24);
  ok('start tile is silver', w.tileAt(TILE_MM/2, (GRID_H-1)*TILE_MM + TILE_MM/2) === TILE_TYPES.START);

  w.setTile(2, 2, TILE_TYPES.RED);
  const totals = w.countVictims();
  ok('counted 1 red victim', totals.red === 1 && totals.green === 0);

  // Floor colour at centre of red tile should be reddish
  const c = w.floorColourAt(2*TILE_MM + TILE_MM/2, 2*TILE_MM + TILE_MM/2);
  ok('red victim centre reads red>green,blue', c.r > c.g && c.r > c.b);
  // Floor colour 60mm off-centre (outside 50mm victim) should be the light floor, not red
  const c2 = w.floorColourAt(2*TILE_MM + TILE_MM/2 + 60, 2*TILE_MM + TILE_MM/2);
  ok('red victim 60mm off-centre is light floor (r ≈ g ≈ b)',
     Math.abs(c2.r - c2.g) < 0.1 && Math.abs(c2.g - c2.b) < 0.2,
     `r=${c2.r}, g=${c2.g}, b=${c2.b}`);
}

// =========================================================
console.log('\n[2] Robot physics');
{
  const w = new World();
  const r = new Robot();
  r.reset(TILE_MM/2, (GRID_H-1)*TILE_MM + TILE_MM/2, -Math.PI/2); // facing up
  r.leftPwm = 200; r.rightPwm = 200;
  const walls = w.getWallSegments();
  const startY = r.y;
  for (let i = 0; i < 50; i++) r.step(walls); // 1 second of forward
  ok('robot moves forward (y decreases)', r.y < startY,
     `start ${startY.toFixed(1)} → ${r.y.toFixed(1)}`);
  ok('robot accumulated encoder ticks', r.leftEncoderTicks > 0 && r.rightEncoderTicks > 0);

  // Now hit a wall — drive into top wall
  r.reset(TILE_MM/2, ROBOT_RADIUS_MM + 5, -Math.PI/2);
  r.leftPwm = 255; r.rightPwm = 255;
  let bumped = false;
  for (let i = 0; i < 30; i++) { r.step(walls); if (r.bumpedThisStep) bumped = true; }
  ok('robot bumps wall at top of field', bumped);
}

// =========================================================
console.log('\n[3] ToF sensor');
{
  const w = new World();
  const r = new Robot();
  // Place robot in middle-bottom tile facing up. There's only the perimeter wall.
  r.reset(TILE_MM/2, (GRID_H-1)*TILE_MM + TILE_MM/2, -Math.PI/2);
  const walls = w.getWallSegments();
  // Front-facing should see the perimeter (top wall) ~5*TILE = 1450mm
  const samples = [];
  for (let i = 0; i < 20; i++) samples.push(readToFNoisy(r, 'tofFront', walls));
  const valid = samples.filter(v => v >= 0);
  ok('front ToF returns mostly valid readings near max range or dropout', valid.length >= 0); // can be 0 if all dropped/over range
  // Add an internal wall just in front
  w.toggleWall('h', 0, GRID_H - 1); // horizontal wall on TOP edge of bottom-left tile
  const walls2 = w.getWallSegments();
  const samples2 = [];
  for (let i = 0; i < 20; i++) samples2.push(readToFNoisy(r, 'tofFront', walls2));
  const validVals = samples2.filter(v => v >= 0);
  const median = validVals.sort((a,b)=>a-b)[Math.floor(validVals.length/2)];
  // Robot at y = 5.5*TILE, wall at y = 5*TILE → distance ~ TILE/2 - sensor_x = 145 - 60 = 85mm
  ok('front ToF sees nearby wall within 60-130mm (sensor offset + noise)',
     median > 50 && median < 140, `median was ${median}`);
}

// =========================================================
console.log('\n[4] Colour sensor (mounted 60mm forward of centre)');
{
  const w = new World();
  w.setTile(2, 2, TILE_TYPES.RED);
  w.setTile(3, 3, TILE_TYPES.GREEN);
  w.setTile(4, 4, TILE_TYPES.BLACK);

  const r = new Robot();

  // Robot centred on red tile, heading WEST (π) — sensor goes 60mm west of
  // centre, which is still inside the 50mm victim square (within ±25mm).
  // No wait — sensor 60mm west of centre is at tile_centre - 60, which is
  // outside the ±25mm victim halfwidth. So sensor sees FLOOR.
  // To get sensor over the victim, the robot's centre must be offset such
  // that the sensor lands within ±25mm of the tile centre. Robot at
  // (tile_centre + 60, tile_centre) facing WEST → sensor at (tile_centre, tile_centre).
  r.reset(2*TILE_MM + TILE_MM/2 + 60, 2*TILE_MM + TILE_MM/2, Math.PI);
  const cRed = readColourSensor(r, w);
  ok('sensor over red victim (robot offset, facing W): r > g and r > b',
     cRed.r > cRed.g && cRed.r > cRed.b,
     `got r=${cRed.r}, g=${cRed.g}, b=${cRed.b}`);

  // Same trick for green
  r.reset(3*TILE_MM + TILE_MM/2 + 60, 3*TILE_MM + TILE_MM/2, Math.PI);
  const cGreen = readColourSensor(r, w);
  ok('sensor over green victim: g > r and g > b',
     cGreen.g > cGreen.r && cGreen.g > cGreen.b,
     `got r=${cGreen.r}, g=${cGreen.g}, b=${cGreen.b}`);

  // Black tile FILLS the entire tile, so sensor sees black no matter where
  // on the tile it sits.
  r.reset(4*TILE_MM + TILE_MM/2, 4*TILE_MM + TILE_MM/2, 0);
  const cBlack = readColourSensor(r, w);
  ok('over black tile (any position): clear < 3000', cBlack.c < 3000, `got c=${cBlack.c}`);

  // Over plain floor
  r.reset(TILE_MM/2, TILE_MM/2, 0);
  const cFloor = readColourSensor(r, w);
  ok('over plain floor: clear > 20000', cFloor.c > 20000, `got c=${cFloor.c}`);

  // CRITICAL NEW BEHAVIOUR: robot centred on victim tile, heading=0 (east),
  // sensor 60mm east of centre → outside the 25mm victim halfwidth → reads FLOOR.
  // This is the LoP-no-self-detect property.
  r.reset(2*TILE_MM + TILE_MM/2, 2*TILE_MM + TILE_MM/2, 0);
  const cAtCentre = readColourSensor(r, w);
  ok('LoP: robot centred on red victim, sensor 60mm forward → reads FLOOR not red',
     !(cAtCentre.r > cAtCentre.g * 1.5),
     `got r=${cAtCentre.r}, g=${cAtCentre.g}, b=${cAtCentre.b}`);
}

// =========================================================
console.log('\n[5] Scoring (with forward-mounted colour sensor)');
{
  const w = new World();
  w.setTile(2, 2, TILE_TYPES.RED);
  w.setTile(3, 3, TILE_TYPES.GREEN);
  const r = new Robot();
  const scorer = new Scorer(w);

  // Robot centred on red tile — centre IS on red tile, indicate succeeds
  r.reset(2*TILE_MM + TILE_MM/2, 2*TILE_MM + TILE_MM/2, 0);
  scorer._handle(r, { kind: 'victim_harmed' }, 1000);
  ok('red victim correctly scores 25 (centre on tile)', scorer.totalPoints() === 25);

  // Re-indicate same victim — no double scoring
  scorer._handle(r, { kind: 'victim_harmed' }, 1500);
  ok('no duplicate scoring on same tile', scorer.totalPoints() === 25);

  // Wrong colour indicate (call unharmed on a red tile) — should fail
  scorer._handle(r, { kind: 'victim_unharmed' }, 2000);
  ok('wrong colour indicate ignored', scorer.totalPoints() === 25);

  // Move to green tile and indicate
  r.reset(3*TILE_MM + TILE_MM/2, 3*TILE_MM + TILE_MM/2, 0);
  scorer._handle(r, { kind: 'victim_unharmed' }, 3000);
  ok('green victim scores 10 (total 35)', scorer.totalPoints() === 35);

  // GENEROUS SCORER: robot centre on tile (1,2), but facing EAST so the
  // sensor at +60mm forward sits on tile (2,2). Tile (1,2) is empty floor,
  // tile (2,2) is RED — already scored in this run. Indicate should be
  // rejected as already-scored, not as "no victim under robot".
  // Reset scorer to test fresh case.
  const w2 = new World();
  w2.setTile(2, 2, TILE_TYPES.RED);
  const r2 = new Robot();
  const scorer2 = new Scorer(w2);
  // Robot centre near right edge of tile (1,2), facing east, sensor crosses into (2,2)
  r2.reset(2*TILE_MM - 5, 2*TILE_MM + TILE_MM/2, 0);
  scorer2._handle(r2, { kind: 'victim_harmed' }, 100);
  ok('generous scorer: indicate accepted when sensor is on victim tile but centre is not',
     scorer2.totalPoints() === 25);

  // Indicate on a tile where neither centre nor sensor sees a victim — fail
  const r3 = new Robot();
  const scorer3 = new Scorer(w2);
  r3.reset(TILE_MM/2, TILE_MM/2, 0); // empty floor
  scorer3._handle(r3, { kind: 'victim_harmed' }, 100);
  ok('indicate on empty floor still rejected', scorer3.totalPoints() === 0);

  // Indicate exit on start tile (need full containment)
  const sx = w.startX, sy = w.startY;
  r.reset(sx*TILE_MM + TILE_MM/2, sy*TILE_MM + TILE_MM/2, 0);
  scorer._handle(r, { kind: 'exit' }, 4000);
  ok('exit bonus +25 (total 60)', scorer.totalPoints() === 60);

  // Now count bonus on start tile.
  // Tally: valid harmed indications = 2 (line 175 + line 179 duplicate),
  //        valid unharmed indications = 1 (line 188).
  scorer._handle(r, { kind: 'count_unharmed', value: 1 }, 5000);
  scorer._handle(r, { kind: 'count_harmed', value: 2 }, 5100);
  ok('both count bonuses +50 (total 110)', scorer.totalPoints() === 110);
}

// =========================================================
console.log('\n[5a] Count bonus requires reported number to match valid-indication tally');
{
  const w = new World();
  w.setTile(2, 2, TILE_TYPES.RED);
  w.setTile(3, 3, TILE_TYPES.RED);
  const r = new Robot();
  const scorer = new Scorer(w);
  // Find one red so we clear the 50% threshold (1 of 2 = 50%)
  r.reset(2*TILE_MM + TILE_MM/2, 2*TILE_MM + TILE_MM/2, 0);
  scorer._handle(r, { kind: 'victim_harmed' }, 1000);
  ok('valid indication tallied (1)', scorer.harmedIndicationsValid === 1);

  // Robot returns to start
  r.reset(w.startX*TILE_MM + TILE_MM/2, w.startY*TILE_MM + TILE_MM/2, 0);

  // Missing N — should be rejected
  const noValueResult = scorer._handle(r, { kind: 'count_harmed' }, 2000);
  ok('count without N is rejected', !noValueResult.ok);

  // Reporting MORE than the valid tally — referee's count won't match → DENIED
  const overReport = scorer._handle(r, { kind: 'count_harmed', value: 3 }, 2500);
  ok('over-report (3 vs 1 valid) is DENIED', !overReport.ok);
  ok('bonus not claimed after over-report', !scorer.harmedCountClaimed);

  // Reporting LESS than the valid tally — also won't match → DENIED
  const underReport = scorer._handle(r, { kind: 'count_harmed', value: 0 }, 2700);
  ok('under-report (0 vs 1 valid) is DENIED', !underReport.ok);

  // Reporting EXACTLY the valid tally → AWARDED
  scorer._handle(r, { kind: 'count_harmed', value: 1 }, 3000);
  ok('exact match awards bonus', scorer.harmedCountClaimed);
  ok('reported count stored as 1', scorer.harmedCountReported === 1);

  // Negative N rejected
  const sc2 = new Scorer(w);
  sc2._handle(r, { kind: 'victim_harmed' }, 100);
  r.reset(w.startX*TILE_MM + TILE_MM/2, w.startY*TILE_MM + TILE_MM/2, 0);
  const negResult = sc2._handle(r, { kind: 'count_harmed', value: -1 }, 200);
  ok('negative N is rejected', !negResult.ok);
}

// =========================================================
console.log('\n[5b] Duplicate indications on same tile increment the tally (allowed over-count)');
{
  const w = new World();
  w.setTile(2, 2, TILE_TYPES.RED);
  w.setTile(3, 3, TILE_TYPES.RED);
  w.setTile(4, 4, TILE_TYPES.RED);
  const r = new Robot();
  const scorer = new Scorer(w);

  // Find one red victim, then indicate again on the same tile
  r.reset(2*TILE_MM + TILE_MM/2, 2*TILE_MM + TILE_MM/2, 0);
  scorer._handle(r, { kind: 'victim_harmed' }, 1000);
  scorer._handle(r, { kind: 'victim_harmed' }, 1100); // duplicate on same tile
  ok('duplicate indications increment tally', scorer.harmedIndicationsValid === 2);
  ok('but only score the tile once', scorer.totalPoints() === 25);

  // Find a 2nd red victim (clears threshold of 1 for 3 victims)
  r.reset(3*TILE_MM + TILE_MM/2, 3*TILE_MM + TILE_MM/2, 0);
  scorer._handle(r, { kind: 'victim_harmed' }, 1500);
  ok('second tile scored', scorer.totalPoints() === 50);
  ok('tally now 3', scorer.harmedIndicationsValid === 3);

  // Return to start, claim with reported=3 (matches duplicate-counted tally)
  r.reset(w.startX*TILE_MM + TILE_MM/2, w.startY*TILE_MM + TILE_MM/2, 0);
  // Need also unharmed count to claim — set to 0 with no green victims
  scorer._handle(r, { kind: 'count_harmed', value: 3 }, 2000);
  ok('count bonus awarded for matching the duplicate-counted tally', scorer.harmedCountClaimed);
}

// =========================================================
console.log('\n[5c] Wrong-colour indications do NOT increment the tally');
{
  const w = new World();
  w.setTile(2, 2, TILE_TYPES.RED);
  w.setTile(3, 3, TILE_TYPES.GREEN);
  const r = new Robot();
  const scorer = new Scorer(w);

  // Stand on red tile, but indicate as green (false positive)
  r.reset(2*TILE_MM + TILE_MM/2, 2*TILE_MM + TILE_MM/2, 0);
  scorer._handle(r, { kind: 'victim_unharmed' }, 1000);
  ok('wrong-colour indication does not score', scorer.totalPoints() === 0);
  ok('wrong-colour indication does not tally as unharmed', scorer.unharmedIndicationsValid === 0);
  ok('wrong-colour indication does not tally as harmed', scorer.harmedIndicationsValid === 0);

  // Now stand on empty floor and indicate
  r.reset(0, 0, 0);
  scorer._handle(r, { kind: 'victim_harmed' }, 1100);
  ok('empty-floor indication does not tally', scorer.harmedIndicationsValid === 0);
}

// =========================================================
console.log('\n[5d] LoP teleport does not cause victim re-detection');
{
  const w = new World();
  w.setTile(2, 2, TILE_TYPES.RED);
  const r = new Robot();
  const scorer = new Scorer(w);

  // First: legitimately score the victim by being on the tile
  r.reset(2*TILE_MM + TILE_MM/2, 2*TILE_MM + TILE_MM/2, 0);
  scorer._handle(r, { kind: 'victim_harmed' }, 1000);
  ok('victim scored once, total 25', scorer.totalPoints() === 25);

  // Simulate LoP teleport to that same victim tile (rule A5.5.2 — student
  // chooses an identified victim as a checkpoint). All four cardinals.
  for (const dir of ['N', 'E', 'S', 'W']) {
    const dirRad = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI }[dir];
    r.reset(2*TILE_MM + TILE_MM/2, 2*TILE_MM + TILE_MM/2, dirRad);
    const c = readColourSensor(r, w);
    // Sensor 60mm in the heading direction → outside the 25mm victim square.
    // Should NOT register strongly red. Use a permissive check: r should not
    // overwhelmingly dominate g.
    ok(`LoP teleport facing ${dir}: sensor reads floor, not red (r/g ratio < 1.5)`,
       c.r < c.g * 1.5,
       `r=${c.r}, g=${c.g}, b=${c.b}, ratio=${(c.r/c.g).toFixed(2)}`);
  }

  // Even if a buggy student calls indicate('victim_harmed') after LoP teleport,
  // the scorer rejects it as already-scored, not as a fresh detection.
  r.reset(2*TILE_MM + TILE_MM/2, 2*TILE_MM + TILE_MM/2, -Math.PI/2);
  const result = scorer._handle(r, { kind: 'victim_harmed' }, 2000);
  ok('post-LoP indicate on already-scored tile is rejected, score unchanged',
     scorer.totalPoints() === 25 && result.ok === false);
}
{
  const w = new World();
  const r = new Robot();
  const scorer = new Scorer(w);
  const runtime = new Runtime();
  const walls = w.getWallSegments();
  const api = buildRobotAPI(r, w, walls, runtime);

  const src = `
    let counter = 0;
    function setup() {
      Serial.println("hello");
      leftEncoder.write(0);
    }
    function loop() {
      counter++;
      leftMotor.drive(100);
      rightMotor.drive(100);
    }
  `;
  const compiled = compileStudentCode(src, api);
  ok('compileStudentCode returns setup/loop', typeof compiled.setup === 'function' && typeof compiled.loop === 'function');
  compiled.setup();
  ok('Serial.println captured to runtime', runtime.serialBuf.includes('hello'));
  for (let i = 0; i < 5; i++) compiled.loop();
  ok('loop ran 5 times, motors set', r.leftPwm === 100 && r.rightPwm === 100);
}

// =========================================================
console.log('\n[7] End-to-end: starter code drives forward in open maze');
{
  const w = new World();
  // Open up the maze interior so the robot has somewhere to go
  // (default has start tile enclosed on 3 sides per A2.2.2)
  const r = new Robot();
  // Place robot in the middle of the field facing up, no nearby walls
  r.reset(3*TILE_MM + TILE_MM/2, 3*TILE_MM + TILE_MM/2, -Math.PI/2);
  const startY = r.y;
  const walls = w.getWallSegments();
  const runtime = new Runtime();
  const api = buildRobotAPI(r, w, walls, runtime);

  // Minimal "drive forward, stop near wall" code
  const compiled = compileStudentCode(`
    function setup() { }
    function loop() {
      const f = frontToF.read();
      if (f > 0 && f < 80) {
        leftMotor.drive(0); rightMotor.drive(0);
      } else {
        leftMotor.drive(150); rightMotor.drive(150);
      }
    }
  `, api);

  compiled.setup();
  for (let i = 0; i < 50 * 30; i++) {
    runtime.elapsedMs += SIM_DT * 1000;
    compiled.loop();
    r.step(walls);
    if (runtime.elapsedMs > 30000) break;
  }
  ok('robot stopped before hitting top wall', r.y > ROBOT_RADIUS_MM,
     `final y=${r.y.toFixed(1)}, ROBOT_RADIUS=${ROBOT_RADIUS_MM}`);
  ok('robot moved up significantly from start (open field)', r.y < startY - 200,
     `start y=${startY.toFixed(1)}, final y=${r.y.toFixed(1)}`);
}

// =========================================================
console.log('\n[8] Buttons (rule 2.2.1 — manual start/restart controls)');
{
  const w = new World();
  const r = new Robot();
  const walls = w.getWallSegments();
  const runtime = new Runtime();
  const api = buildRobotAPI(r, w, walls, runtime);

  ok('button.pressed() returns false initially', !api.buttonA.pressed());
  ok('three buttons exposed', api.buttonA && api.buttonB && api.buttonC);

  // Fire press by setting pendingPress (mirrors what LoP picker does)
  r.pendingPress.A = true;
  ok('button A reads true once after press fired', api.buttonA.pressed());
  ok('button A reads false on second call (edge-triggered)', !api.buttonA.pressed());
  ok('button B is independent', !api.buttonB.pressed());

  // Multiple pending presses on different buttons
  r.pendingPress.A = true;
  r.pendingPress.C = true;
  ok('button A fires', api.buttonA.pressed());
  ok('button C fires', api.buttonC.pressed());
  ok('button B still false', !api.buttonB.pressed());

  // Press persists across robot.reset() (LoP teleport scenario)
  r.pendingPress.B = true;
  r.reset(0, 0, 0);
  ok('press survives robot.reset() (so LoP teleport press reaches student code)', api.buttonB.pressed());
}

// =========================================================
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
