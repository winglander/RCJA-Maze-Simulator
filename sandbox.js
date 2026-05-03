/* ============================================================
   Mighty Maisy Sandbox — continuous-mm rescue maze simulator
   ------------------------------------------------------------
   Architecture (top to bottom):
     1. CONSTANTS         - physical dimensions, sensor specs
     2. WORLD             - tile grid + wall segments + victims
     3. RENDERER          - SVG drawing of maze + robot + sensors
     4. PHYSICS           - differential drive integration + collision
     5. SENSORS           - ToF ray-cast, colour-sensor footprint, encoders
     6. ROBOT API         - TB6612 / VL53L1X / TCS34725 / Encoder mirrors
     7. SCORING           - Mighty Maisy A6 rubric
     8. RUNTIME           - sim tick loop, code execution sandbox
     9. UI                - palette, editor, controls, sensor panel
   ============================================================ */


/* =============================================================
   1. CONSTANTS
   ============================================================= */

const TILE_MM = 290;          // Mighty Maisy tile size (rule A2.1.3)
const WALL_THICK_MM = 10;     // A4 ream on its side
const VICTIM_MM = 50;         // 50mm × 50mm coloured square (A3.1.1)
const ROBOT_RADIUS_MM = 75;   // 150mm diameter robot
const GRID_W = 6;             // 6×6 = 1740mm × 1740mm field
const GRID_H = 6;
const FIELD_W_MM = GRID_W * TILE_MM;
const FIELD_H_MM = GRID_H * TILE_MM;

const SIM_HZ = 50;            // physics tick rate
const SIM_DT = 1 / SIM_HZ;

// Robot drive characteristics (matches Pololu 100:1 20D @ 7.4V)
const WHEEL_RADIUS_MM = 30;       // 60mm wheels
const WHEEL_BASE_MM = 110;        // distance between wheel contact points
const ENCODER_CPR = 2000;         // 20 CPR × 100:1 gearing at output shaft
const MAX_RPM = 80;               // de-rated (per hardware list)
const MAX_RAD_PER_SEC = MAX_RPM * 2 * Math.PI / 60;
const MAX_PWM = 255;

// Sensor mounting positions on the robot (in robot-local frame, mm)
//   x = forward-positive (in front of robot)
//   y = right-positive  (on the robot's right side)
//   heading 0 = robot facing +x in world coords
// Note: the colour sensor is mounted 60mm forward of the robot's geometric
// centre — this mirrors how teams typically build their robot (sensor on a
// forward bracket so colour is detected before the wheels reach it). The
// forward offset has two pedagogical consequences:
//   1. On Lack-of-Progress teleport to a victim tile (robot centre at tile
//      centre), the sensor sits 60mm forward — outside the 25mm victim half-
//      width — so it reads floor, not victim. No self-recount.
//   2. Approaching a victim, the sensor sees red/green BEFORE the robot is
//      centred. Students learn to drive a known distance after detection
//      (encoder-based dead-reckoning) — the same skill they'll use on real
//      hardware. The scorer compensates by accepting indications when either
//      the robot's centre OR the colour sensor is on the victim tile.
const SENSOR_MOUNTS = {
  tofFront: { x: 60, y: 0,    angle: 0 },                  // pointing forward
  tofLeft:  { x: 30, y: -50,  angle: -Math.PI / 2 },       // mounted left, beam points left
  tofRight: { x: 30, y: 50,   angle: Math.PI / 2 },        // mounted right, beam points right
  colour:   { x: 60, y: 0 }                                // 60mm forward of centre
};

// Sensor noise parameters
const TOF_SIGMA_MM = 8;
const TOF_PCT_NOISE = 0.01;
const TOF_DROPOUT_PROB = 0.005;
const TOF_MAX_RANGE_MM = 1200;
const TOF_DROPOUT_VALUE = -1;

const COLOUR_FOOTPRINT_MM = 20;   // 20mm radius averaging disc
const COLOUR_NOISE_PCT = 0.03;

const ENCODER_SLIP_PCT = 0.01;    // ±1% slip per tick

// Global noise toggle. When false, sensors return idealised values
// (no Gaussian noise on ToF, no dropouts, no colour noise, no encoder
// slip). Useful for algorithm debugging and lesson demonstrations
// where you want students to see the controller's logic without
// having to reason about sensor noise simultaneously.
let NOISE_ENABLED = true;
function setNoiseEnabled(v) { NOISE_ENABLED = !!v; }
function isNoiseEnabled() { return NOISE_ENABLED; }


/* =============================================================
   2. WORLD
   -------------------------------------------------------------
   A tile-based grid is used for AUTHORING and SCORING. The
   robot's physics + sensors operate in continuous mm space
   against a list of wall LINE SEGMENTS derived from the grid.
   ============================================================= */

const TILE_TYPES = { EMPTY: 0, START: 1, BLACK: 2, RED: 3, GREEN: 4 };

// Built-in test maze (loaded by the "Test maze" button). Same JSON format
// as exported/imported maze files. 4 victims (3 green + 1 red) reachable
// by right-hand wall following with a 90° black-retreat behaviour.
const TEST_MAZE_DATA = {"version":1,"gridW":6,"gridH":6,"startX":0,"startY":5,"tiles":[[0,0,0,4,0,0],[0,3,4,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,4,0,0,0,0],[1,0,0,0,0,0]],"wallsH":[[true,true,true,true,true,true],[false,false,false,false,false,true],[false,true,true,false,true,false],[false,false,false,true,false,true],[false,false,false,true,true,false],[true,false,false,true,false,false],[true,true,true,true,true,true]],"wallsV":[[true,false,false,false,true,false,true],[true,false,false,true,true,false,true],[true,false,true,false,true,false,true],[true,true,true,true,false,false,true],[true,true,true,false,false,true,true],[true,false,true,true,false,true,true]]};

class World {
  constructor() {
    this.grid = [];
    for (let y = 0; y < GRID_H; y++) {
      const row = [];
      for (let x = 0; x < GRID_W; x++) row.push(TILE_TYPES.EMPTY);
      this.grid.push(row);
    }
    // Walls between cells. wallsH[y][x] = wall on TOP edge of cell (x, y).
    // wallsV[y][x] = wall on LEFT edge of cell (x, y).
    this.wallsH = [];
    this.wallsV = [];
    for (let y = 0; y <= GRID_H; y++) {
      const r = []; for (let x = 0; x < GRID_W; x++) r.push(false);
      this.wallsH.push(r);
    }
    for (let y = 0; y < GRID_H; y++) {
      const r = []; for (let x = 0; x <= GRID_W; x++) r.push(false);
      this.wallsV.push(r);
    }
    // Outer perimeter walls
    for (let x = 0; x < GRID_W; x++) {
      this.wallsH[0][x] = true;
      this.wallsH[GRID_H][x] = true;
    }
    for (let y = 0; y < GRID_H; y++) {
      this.wallsV[y][0] = true;
      this.wallsV[y][GRID_W] = true;
    }
    // Default start tile at bottom-left, walls on other three sides
    this.grid[GRID_H - 1][0] = TILE_TYPES.START;
    this.startX = 0;
    this.startY = GRID_H - 1;
  }

  setTile(x, y, type) {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
    // Only one start tile allowed; if setting a new one, clear old
    if (type === TILE_TYPES.START) {
      for (let yy = 0; yy < GRID_H; yy++) {
        for (let xx = 0; xx < GRID_W; xx++) {
          if (this.grid[yy][xx] === TILE_TYPES.START) this.grid[yy][xx] = TILE_TYPES.EMPTY;
        }
      }
      this.startX = x;
      this.startY = y;
    }
    this.grid[y][x] = type;
  }

  toggleWall(orientation, x, y) {
    if (orientation === 'h') {
      if (y < 0 || y > GRID_H || x < 0 || x >= GRID_W) return;
      this.wallsH[y][x] = !this.wallsH[y][x];
    } else {
      if (y < 0 || y >= GRID_H || x < 0 || x > GRID_W) return;
      this.wallsV[y][x] = !this.wallsV[y][x];
    }
  }

  // Returns all walls as line segments {x1,y1,x2,y2} in mm.
  getWallSegments() {
    const segs = [];
    for (let y = 0; y <= GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (this.wallsH[y][x]) {
          segs.push({
            x1: x * TILE_MM, y1: y * TILE_MM,
            x2: (x + 1) * TILE_MM, y2: y * TILE_MM
          });
        }
      }
    }
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x <= GRID_W; x++) {
        if (this.wallsV[y][x]) {
          segs.push({
            x1: x * TILE_MM, y1: y * TILE_MM,
            x2: x * TILE_MM, y2: (y + 1) * TILE_MM
          });
        }
      }
    }
    return segs;
  }

  // What tile type is at world coord (x, y)?
  tileAt(xMM, yMM) {
    const tx = Math.floor(xMM / TILE_MM);
    const ty = Math.floor(yMM / TILE_MM);
    if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) return TILE_TYPES.EMPTY;
    return this.grid[ty][tx];
  }

  // What's the floor colour at this point in mm?
  // Returns a colour object {r, g, b} in 0..1 (idealised, no noise).
  floorColourAt(xMM, yMM) {
    const tx = Math.floor(xMM / TILE_MM);
    const ty = Math.floor(yMM / TILE_MM);
    if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) {
      return { r: 0.96, g: 0.95, b: 0.92 }; // outside = off-white paper
    }
    const tile = this.grid[ty][tx];

    // Black & silver fill the entire tile
    if (tile === TILE_TYPES.BLACK)  return { r: 0.05, g: 0.05, b: 0.05 };
    if (tile === TILE_TYPES.START)  return { r: 0.78, g: 0.78, b: 0.82 }; // silver

    // Red/green victims are 50mm centred on tile
    if (tile === TILE_TYPES.RED || tile === TILE_TYPES.GREEN) {
      const cx = tx * TILE_MM + TILE_MM / 2;
      const cy = ty * TILE_MM + TILE_MM / 2;
      const dx = Math.abs(xMM - cx);
      const dy = Math.abs(yMM - cy);
      if (dx <= VICTIM_MM / 2 && dy <= VICTIM_MM / 2) {
        if (tile === TILE_TYPES.RED)   return { r: 0.78, g: 0.10, b: 0.08 };
        if (tile === TILE_TYPES.GREEN) return { r: 0.10, g: 0.55, b: 0.15 };
      }
    }
    return { r: 0.96, g: 0.95, b: 0.92 }; // default off-white floor (high clear, neutral RGB)
  }

  countVictims() {
    let red = 0, green = 0;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (this.grid[y][x] === TILE_TYPES.RED) red++;
        if (this.grid[y][x] === TILE_TYPES.GREEN) green++;
      }
    }
    return { red, green };
  }
}


/* =============================================================
   3. RENDERER
   ============================================================= */

class Renderer {
  constructor(svg, world) {
    this.svg = svg;
    this.world = world;
    this.svgNS = 'http://www.w3.org/2000/svg';
    this.scale = 0.55; // mm → svg pixels
    svg.setAttribute('viewBox', `-20 -20 ${FIELD_W_MM + 40} ${FIELD_H_MM + 40}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }

  render(robot, sensorReadings, victimsScored) {
    const { svg, svgNS, world } = this;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // --- Floor backing
    const floor = document.createElementNS(svgNS, 'rect');
    floor.setAttribute('x', 0); floor.setAttribute('y', 0);
    floor.setAttribute('width', FIELD_W_MM); floor.setAttribute('height', FIELD_H_MM);
    floor.setAttribute('fill', '#f1eee6');
    svg.appendChild(floor);

    // --- Tile backgrounds (start, black, victims)
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const t = world.grid[y][x];
        if (t === TILE_TYPES.START) {
          const r = document.createElementNS(svgNS, 'rect');
          r.setAttribute('x', x * TILE_MM); r.setAttribute('y', y * TILE_MM);
          r.setAttribute('width', TILE_MM); r.setAttribute('height', TILE_MM);
          r.setAttribute('fill', 'url(#silverGrad)');
          r.setAttribute('stroke', '#888');
          r.setAttribute('stroke-width', 1);
          svg.appendChild(r);
        } else if (t === TILE_TYPES.BLACK) {
          const r = document.createElementNS(svgNS, 'rect');
          r.setAttribute('x', x * TILE_MM); r.setAttribute('y', y * TILE_MM);
          r.setAttribute('width', TILE_MM); r.setAttribute('height', TILE_MM);
          r.setAttribute('fill', '#14110f');
          svg.appendChild(r);
        }
      }
    }

    // --- Silver gradient defs
    const defs = document.createElementNS(svgNS, 'defs');
    defs.innerHTML = `
      <linearGradient id="silverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#dcdcdc"/>
        <stop offset="50%" stop-color="#f5f5f5"/>
        <stop offset="100%" stop-color="#b8b8b8"/>
      </linearGradient>
    `;
    svg.insertBefore(defs, svg.firstChild);

    // --- Tile grid lines (light)
    for (let i = 0; i <= GRID_W; i++) {
      const ln = document.createElementNS(svgNS, 'line');
      ln.setAttribute('x1', i * TILE_MM); ln.setAttribute('y1', 0);
      ln.setAttribute('x2', i * TILE_MM); ln.setAttribute('y2', FIELD_H_MM);
      ln.setAttribute('stroke', '#c8bfa8'); ln.setAttribute('stroke-width', 1);
      svg.appendChild(ln);
    }
    for (let i = 0; i <= GRID_H; i++) {
      const ln = document.createElementNS(svgNS, 'line');
      ln.setAttribute('x1', 0); ln.setAttribute('y1', i * TILE_MM);
      ln.setAttribute('x2', FIELD_W_MM); ln.setAttribute('y2', i * TILE_MM);
      ln.setAttribute('stroke', '#c8bfa8'); ln.setAttribute('stroke-width', 1);
      svg.appendChild(ln);
    }

    // --- Victims (50mm squares)
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const t = world.grid[y][x];
        if (t === TILE_TYPES.RED || t === TILE_TYPES.GREEN) {
          const cx = x * TILE_MM + TILE_MM / 2;
          const cy = y * TILE_MM + TILE_MM / 2;
          const r = document.createElementNS(svgNS, 'rect');
          r.setAttribute('x', cx - VICTIM_MM / 2);
          r.setAttribute('y', cy - VICTIM_MM / 2);
          r.setAttribute('width', VICTIM_MM);
          r.setAttribute('height', VICTIM_MM);
          r.setAttribute('fill', t === TILE_TYPES.RED ? '#c73e1d' : '#2d7a26');
          r.setAttribute('stroke', '#14110f');
          r.setAttribute('stroke-width', 1.5);
          svg.appendChild(r);
          // Score-marker if found
          const key = `${x},${y}`;
          if (victimsScored && victimsScored.has(key)) {
            const tick = document.createElementNS(svgNS, 'text');
            tick.setAttribute('x', cx);
            tick.setAttribute('y', cy + 8);
            tick.setAttribute('text-anchor', 'middle');
            tick.setAttribute('font-family', 'JetBrains Mono, monospace');
            tick.setAttribute('font-size', '24');
            tick.setAttribute('font-weight', '700');
            tick.setAttribute('fill', '#f5f1e8');
            tick.textContent = '✓';
            svg.appendChild(tick);
          }
        }
      }
    }

    // --- Walls
    for (const seg of world.getWallSegments()) {
      const ln = document.createElementNS(svgNS, 'line');
      ln.setAttribute('x1', seg.x1); ln.setAttribute('y1', seg.y1);
      ln.setAttribute('x2', seg.x2); ln.setAttribute('y2', seg.y2);
      ln.setAttribute('stroke', '#14110f');
      ln.setAttribute('stroke-width', WALL_THICK_MM);
      ln.setAttribute('stroke-linecap', 'square');
      svg.appendChild(ln);
    }

    // --- Robot
    if (robot) {
      // Body
      const body = document.createElementNS(svgNS, 'circle');
      body.setAttribute('cx', robot.x);
      body.setAttribute('cy', robot.y);
      body.setAttribute('r', ROBOT_RADIUS_MM);
      body.setAttribute('fill', '#1d4e89');
      body.setAttribute('stroke', '#14110f');
      body.setAttribute('stroke-width', 2);
      body.setAttribute('opacity', '0.9');
      svg.appendChild(body);

      // Colour sensor — drawn at its actual mount position. Two layers:
      //  - faint footprint ring showing the ~20mm averaging radius
      //  - solid dot at the exact sample point
      // This is also the "front of the robot" indicator since the sensor is
      // mounted forward of centre.
      const cosH = Math.cos(robot.heading), sinH = Math.sin(robot.heading);
      const cs = SENSOR_MOUNTS.colour;
      const csx = robot.x + cs.x * cosH - cs.y * sinH;
      const csy = robot.y + cs.x * sinH + cs.y * cosH;

      const footprint = document.createElementNS(svgNS, 'circle');
      footprint.setAttribute('cx', csx); footprint.setAttribute('cy', csy);
      footprint.setAttribute('r', COLOUR_FOOTPRINT_MM);
      footprint.setAttribute('fill', 'none');
      footprint.setAttribute('stroke', '#e8c4b8');
      footprint.setAttribute('stroke-width', 1);
      footprint.setAttribute('stroke-dasharray', '3,2');
      footprint.setAttribute('opacity', '0.7');
      svg.appendChild(footprint);

      const head = document.createElementNS(svgNS, 'circle');
      head.setAttribute('cx', csx); head.setAttribute('cy', csy);
      head.setAttribute('r', 6);
      head.setAttribute('fill', '#e8c4b8');
      head.setAttribute('stroke', '#14110f');
      head.setAttribute('stroke-width', 1.5);
      svg.appendChild(head);

      // ToF beams (visualised)
      if (sensorReadings) {
        const beams = ['tofFront', 'tofLeft', 'tofRight'];
        const colours = { tofFront: '#c73e1d', tofLeft: '#b8851a', tofRight: '#1d4e89' };
        for (const name of beams) {
          const reading = sensorReadings[name];
          if (reading == null || reading < 0) continue;
          const mount = SENSOR_MOUNTS[name];
          const cosH = Math.cos(robot.heading), sinH = Math.sin(robot.heading);
          const sx = robot.x + mount.x * cosH - mount.y * sinH;
          const sy = robot.y + mount.x * sinH + mount.y * cosH;
          const beamHead = robot.heading + mount.angle;
          const ex = sx + Math.cos(beamHead) * reading;
          const ey = sy + Math.sin(beamHead) * reading;
          const ln = document.createElementNS(svgNS, 'line');
          ln.setAttribute('x1', sx); ln.setAttribute('y1', sy);
          ln.setAttribute('x2', ex); ln.setAttribute('y2', ey);
          ln.setAttribute('stroke', colours[name]);
          ln.setAttribute('stroke-width', 2);
          ln.setAttribute('stroke-dasharray', '6,4');
          ln.setAttribute('opacity', '0.7');
          svg.appendChild(ln);
        }
      }
    }
  }

  // Convert SVG client coords to mm in world space, given the current viewBox
  clientToWorld(clientX, clientY) {
    const pt = this.svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return null;
    const inv = ctm.inverse();
    const w = pt.matrixTransform(inv);
    return { x: w.x, y: w.y };
  }
}


/* =============================================================
   4. PHYSICS
   ============================================================= */

class Robot {
  constructor() {
    this.x = 0; this.y = 0; this.heading = 0;
    this.leftPwm = 0; this.rightPwm = 0;
    this.leftEncoderTicks = 0; this.rightEncoderTicks = 0;
    this.bumpedThisStep = false;
    this.indications = []; // queued robot.indicate(...) calls
    // Per RCJA rule 2.2.1, the real robot must have manual start/restart
    // controls. The sim exposes three buttons (A, B, C) the student can
    // poll. Presses can only be fired by the LoP picker (on confirm) or
    // by the Start-press dropdown (when Run is clicked). Mid-run presses
    // are not allowed by the rules and are not exposed in the UI.
    this.pendingPress = { A: false, B: false, C: false };
  }

  reset(x, y, heading) {
    this.x = x; this.y = y; this.heading = heading;
    this.leftPwm = 0; this.rightPwm = 0;
    this.leftEncoderTicks = 0; this.rightEncoderTicks = 0;
    this.bumpedThisStep = false;
    this.indications = [];
    // Note: pendingPress is NOT cleared here — a press queued before
    // reset() (e.g. by the LoP picker) should still be visible to the
    // student's code after the teleport.
  }

  // Drive integration. PWM -255..255 → angular velocity per wheel.
  step(walls) {
    this.bumpedThisStep = false;

    const leftRads = clamp(this.leftPwm, -MAX_PWM, MAX_PWM) / MAX_PWM * MAX_RAD_PER_SEC;
    const rightRads = clamp(this.rightPwm, -MAX_PWM, MAX_PWM) / MAX_PWM * MAX_RAD_PER_SEC;

    const leftLin = leftRads * WHEEL_RADIUS_MM;     // mm/s
    const rightLin = rightRads * WHEEL_RADIUS_MM;
    const v = (leftLin + rightLin) / 2;
    const omega = (rightLin - leftLin) / WHEEL_BASE_MM;

    const newHeading = this.heading + omega * SIM_DT;
    const newX = this.x + v * Math.cos((this.heading + newHeading) / 2) * SIM_DT;
    const newY = this.y + v * Math.sin((this.heading + newHeading) / 2) * SIM_DT;

    // Collision: if new circle position would intersect any wall, slide/halt.
    if (this.collidesAt(newX, newY, walls)) {
      // Try rotation only (allow turning in place against a wall)
      this.heading = newHeading;
      this.bumpedThisStep = true;
    } else {
      this.x = newX;
      this.y = newY;
      this.heading = newHeading;
    }

    // Encoder integration (with optional slip)
    const leftDeltaRads = leftRads * SIM_DT;
    const rightDeltaRads = rightRads * SIM_DT;
    const leftSlip  = NOISE_ENABLED ? 1 + (Math.random() - 0.5) * 2 * ENCODER_SLIP_PCT : 1;
    const rightSlip = NOISE_ENABLED ? 1 + (Math.random() - 0.5) * 2 * ENCODER_SLIP_PCT : 1;
    this.leftEncoderTicks += (leftDeltaRads / (2 * Math.PI)) * ENCODER_CPR * leftSlip;
    this.rightEncoderTicks += (rightDeltaRads / (2 * Math.PI)) * ENCODER_CPR * rightSlip;
  }

  collidesAt(x, y, walls) {
    // Out-of-bounds counts as collision
    if (x < ROBOT_RADIUS_MM || x > FIELD_W_MM - ROBOT_RADIUS_MM) return true;
    if (y < ROBOT_RADIUS_MM || y > FIELD_H_MM - ROBOT_RADIUS_MM) return true;
    for (const w of walls) {
      if (pointToSegmentDist(x, y, w.x1, w.y1, w.x2, w.y2) < ROBOT_RADIUS_MM + WALL_THICK_MM / 2) {
        return true;
      }
    }
    return false;
  }
}

// ----- geometric helpers -----
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Ray-segment intersection. Returns t (distance along ray) or null.
function rayHitSegment(ox, oy, dx, dy, x1, y1, x2, y2) {
  const sx = x2 - x1, sy = y2 - y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((x1 - ox) * sy - (y1 - oy) * sx) / denom;
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / denom;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return null;
}


/* =============================================================
   5. SENSORS
   ============================================================= */

function readToFRaw(robot, mountName, walls) {
  const mount = SENSOR_MOUNTS[mountName];
  const cosH = Math.cos(robot.heading), sinH = Math.sin(robot.heading);
  const sx = robot.x + mount.x * cosH - mount.y * sinH;
  const sy = robot.y + mount.x * sinH + mount.y * cosH;
  const beamHead = robot.heading + mount.angle;
  const dx = Math.cos(beamHead), dy = Math.sin(beamHead);

  let nearest = TOF_MAX_RANGE_MM;
  for (const w of walls) {
    const t = rayHitSegment(sx, sy, dx, dy, w.x1, w.y1, w.x2, w.y2);
    if (t !== null && t < nearest) nearest = t;
  }
  // Account for the wall thickness — sensor sees the surface, not the mid-line
  nearest = Math.max(0, nearest - WALL_THICK_MM / 2);
  return nearest;
}

function readToFNoisy(robot, mountName, walls) {
  const raw = readToFRaw(robot, mountName, walls);
  if (!NOISE_ENABLED) {
    if (raw >= TOF_MAX_RANGE_MM) return TOF_DROPOUT_VALUE;
    return Math.round(raw);
  }
  if (Math.random() < TOF_DROPOUT_PROB) return TOF_DROPOUT_VALUE;
  if (raw >= TOF_MAX_RANGE_MM) return TOF_DROPOUT_VALUE;
  const noise = gaussian() * (TOF_SIGMA_MM + raw * TOF_PCT_NOISE);
  return Math.max(0, Math.round(raw + noise));
}

// Footprint-averaged colour. Samples N points in a disc under the sensor
// mount, returns approximate raw 16-bit r/g/b/c counts (TCS34725-style).
function readColourSensor(robot, world) {
  const mount = SENSOR_MOUNTS.colour;
  const cosH = Math.cos(robot.heading), sinH = Math.sin(robot.heading);
  const cx = robot.x + mount.x * cosH - mount.y * sinH;
  const cy = robot.y + mount.x * sinH + mount.y * cosH;

  const SAMPLES = 9;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < SAMPLES; i++) {
    // sample in concentric ring pattern within the footprint disc
    const rad = COLOUR_FOOTPRINT_MM * Math.sqrt(i / SAMPLES);
    const ang = i * 2.4; // golden-ish spacing
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    const c = world.floorColourAt(px, py);
    r += c.r; g += c.g; b += c.b;
  }
  r /= SAMPLES; g /= SAMPLES; b /= SAMPLES;

  // Apply noise + scale to 16-bit counts (TCS34725 typical full-scale ~65535)
  const SCALE = 12000;
  const noiseScale = NOISE_ENABLED ? COLOUR_NOISE_PCT : 0;
  const nr = Math.max(0, Math.round((r + gaussian() * noiseScale) * SCALE));
  const ng = Math.max(0, Math.round((g + gaussian() * noiseScale) * SCALE));
  const nb = Math.max(0, Math.round((b + gaussian() * noiseScale) * SCALE));
  const nc = nr + ng + nb;
  return { r: nr, g: ng, b: nb, c: nc };
}

// Box-Muller standard normal
function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}


/* =============================================================
   6. ROBOT API (Arduino-shaped)
   -------------------------------------------------------------
   Mirrors the libraries listed in the hardware doc:
     - Pololu VL53L1X  →  tof.read()
     - Adafruit TCS34725 → colourSensor.read()  ({r,g,b,c})
     - SparkFun TB6612 → motor.drive(-255..255)
     - Paul Stoffregen Encoder → encoder.read() / .write(0)
   Plus a Serial.println() for student debug output.
   ============================================================= */

function buildRobotAPI(robot, world, walls, runtime) {
  const tof = (mountName) => ({
    read() { return readToFNoisy(robot, mountName, walls); }
  });

  const motor = (which) => ({
    drive(speed) {
      const s = clamp(Math.round(speed), -MAX_PWM, MAX_PWM);
      if (which === 'left') robot.leftPwm = s;
      else robot.rightPwm = s;
    },
    brake() { if (which === 'left') robot.leftPwm = 0; else robot.rightPwm = 0; },
    standby() { robot.leftPwm = 0; robot.rightPwm = 0; }
  });

  const encoder = (which) => ({
    read() {
      return Math.round(which === 'left' ? robot.leftEncoderTicks : robot.rightEncoderTicks);
    },
    write(val) {
      if (which === 'left') robot.leftEncoderTicks = val;
      else robot.rightEncoderTicks = val;
    }
  });

  const button = (name) => ({
    // Edge-triggered: returns true the first time it's called after a press
    // was queued, then false until the next press. Mirrors a debounced
    // physical button helper. Presses can only be queued by the runtime
    // (via the LoP picker or Start-press dropdown) — there is no API to
    // queue a press from student code, matching rule 2.2.1 which forbids
    // touching the robot mid-run.
    pressed() {
      if (robot.pendingPress[name]) {
        robot.pendingPress[name] = false;
        return true;
      }
      return false;
    }
  });

  return {
    // Sensors
    frontToF: tof('tofFront'),
    leftToF:  tof('tofLeft'),
    rightToF: tof('tofRight'),
    colourSensor: { read: () => readColourSensor(robot, world) },
    leftEncoder: encoder('left'),
    rightEncoder: encoder('right'),

    // Buttons (rule 2.2.1 — manual start/restart controls)
    buttonA: button('A'),
    buttonB: button('B'),
    buttonC: button('C'),

    // Actuators
    leftMotor:  motor('left'),
    rightMotor: motor('right'),

    // Indicate (for scoring). Some kinds carry a value:
    //   indicate('count_unharmed', N) — N = number of unharmed victims found
    //   indicate('count_harmed', N)   — N = number of harmed victims found
    indicate(kind, value) {
      robot.indications.push({ kind, value, t: runtime.elapsedMs });
    },

    // Serial debug
    Serial: {
      print(...args) { runtime.serialOut(args.join(' '), false); },
      println(...args) { runtime.serialOut(args.join(' '), true); }
    },

    // Convenience
    millis: () => runtime.elapsedMs,
    delay: (ms) => runtime.requestDelay(ms),

    // Constants made available to student code
    MAX_PWM: MAX_PWM,
  };
}


/* =============================================================
   7. SCORING
   ============================================================= */

const TIME_LIMIT_MS = 180_000; // Mighty Maisy A5.3.3

class Scorer {
  constructor(world) {
    this.world = world;
    this.victimsScored = new Map(); // "x,y" → { kind: 'red'|'green', tile: {x,y} }
    this.exitClaimed = false;
    this.unharmedCountClaimed = false;
    this.harmedCountClaimed = false;
    // Reported counts from the robot. Per RCJA rule A6.6, the bonus is
    // awarded if the robot stops on the start tile and "clearly indicates
    // the number of [type] victims the robot has found" — the reported
    // number is what the robot's own tally says, NOT the actual count.
    // Over-counts (passing over a victim twice) are explicitly allowed.
    this.unharmedCountReported = null;
    this.harmedCountReported = null;
    // Live count of VALID victim indications. A real-life referee adjudicates
    // each indicate() call: did the robot signal while actually over a victim
    // of the matching colour? If yes, increment. If no (false positive on
    // empty floor / wrong colour), don't increment. Duplicates on the same
    // tile DO count — the rules explicitly allow over-counts via repeat
    // valid indications, see A6.6's worked example.
    this.unharmedIndicationsValid = 0;
    this.harmedIndicationsValid = 0;
    this.indicationsAtVictims = []; // log
    this.lastIndicateConsumedAt = -10000;
  }

  // Process pending indications from the robot. Called every tick.
  processIndications(robot, elapsedMs) {
    while (robot.indications.length) {
      const ind = robot.indications.shift();
      this._handle(robot, ind, elapsedMs);
    }
  }

  _handle(robot, ind, elapsedMs) {
    const tx = Math.floor(robot.x / TILE_MM);
    const ty = Math.floor(robot.y / TILE_MM);

    if (ind.kind === 'victim_unharmed' || ind.kind === 'victim_harmed') {
      // Robot must be over a victim tile of matching colour. We accept a hit
      // if EITHER the robot's centre OR the colour-sensor mount position lies
      // on a tile of the expected colour. This mirrors competition refereeing
      // (the indicator must be "over" the victim) and makes the natural code
      // pattern work — students who stop the moment the sensor sees red, with
      // the sensor 60mm forward of centre, will still get credited.
      const expected = ind.kind === 'victim_unharmed' ? TILE_TYPES.GREEN : TILE_TYPES.RED;

      // Sensor world position (uses same offset as readColourSensor)
      const cosH = Math.cos(robot.heading), sinH = Math.sin(robot.heading);
      const sMount = SENSOR_MOUNTS.colour;
      const sx = robot.x + sMount.x * cosH - sMount.y * sinH;
      const sy = robot.y + sMount.x * sinH + sMount.y * cosH;
      const stx = Math.floor(sx / TILE_MM);
      const sty = Math.floor(sy / TILE_MM);

      // Try centre tile first, then sensor tile. Prefer sensor tile if both
      // qualify (matches the typical "stop when sensor sees colour" pattern).
      let hitTx = null, hitTy = null;
      if (this.world.tileAt(sx, sy) === expected) {
        hitTx = stx; hitTy = sty;
      } else if (this.world.tileAt(robot.x, robot.y) === expected) {
        hitTx = tx; hitTy = ty;
      }

      if (hitTx !== null) {
        // Record this as a valid indication regardless of whether the tile
        // was already scored. Per rule A6.6: the count tally rewards the
        // robot's "found" signal each time it indicates over a real victim
        // — duplicates on the same tile each tick the count up.
        if (ind.kind === 'victim_unharmed') this.unharmedIndicationsValid++;
        else                                this.harmedIndicationsValid++;

        const key = `${hitTx},${hitTy}`;
        if (!this.victimsScored.has(key)) {
          this.victimsScored.set(key, {
            kind: ind.kind,
            points: ind.kind === 'victim_unharmed' ? 10 : 25,
            at: elapsedMs
          });
          return { ok: true, msg: `Victim identified (${ind.kind === 'victim_unharmed' ? 'green/unharmed' : 'red/harmed'}) at tile (${hitTx},${hitTy}). +${ind.kind === 'victim_unharmed' ? 10 : 25} pts.` };
        }
        return { ok: false, msg: `indicate('${ind.kind}') called over already-scored victim at (${hitTx},${hitTy}). Indication still counts toward count tally.` };
      }
      return { ok: false, msg: `indicate('${ind.kind}') called but no matching victim under robot (centre at tile (${tx},${ty}), sensor at tile (${stx},${sty})).` };
    }

    if (ind.kind === 'exit') {
      // Robot must be entirely on the start tile (rule A6.5)
      const startTile = this.world.tileAt(robot.x, robot.y);
      if (startTile !== TILE_TYPES.START) {
        return { ok: false, msg: `indicate('exit') called but robot is not on the Start/Exit tile.` };
      }
      // Must be ENTIRELY on the tile
      const tcx = tx * TILE_MM + TILE_MM / 2;
      const tcy = ty * TILE_MM + TILE_MM / 2;
      const dist = Math.max(Math.abs(robot.x - tcx), Math.abs(robot.y - tcy));
      if (dist + ROBOT_RADIUS_MM > TILE_MM / 2) {
        return { ok: false, msg: `indicate('exit') called but robot is not fully contained on the Start tile.` };
      }
      if (!this.exitClaimed) {
        this.exitClaimed = true;
        return { ok: true, msg: `Exit bonus +25 pts.` };
      }
      return { ok: false, msg: 'Exit already claimed.' };
    }

    if (ind.kind === 'count_unharmed' || ind.kind === 'count_harmed') {
      // Per A6.6: the robot must report the number of [type] victims
      // it has found. The reported number is required — it's the
      // whole point of this bonus. We expect ind.value to carry it.
      if (typeof ind.value !== 'number' || !Number.isFinite(ind.value) || ind.value < 0) {
        return { ok: false, msg: `indicate('${ind.kind}', N) requires a non-negative number for N. Got: ${ind.value}` };
      }
      const reportedCount = Math.floor(ind.value);
      const totals = this.world.countVictims();
      const totalVictims = totals.red + totals.green;
      const half = Math.floor(totalVictims / 2);
      const found = [...this.victimsScored.values()].length;
      if (found < half) {
        return { ok: false, msg: `Count bonus needs at least ${half} victims found (have ${found}).` };
      }
      // Must be on Start tile (per A6.6)
      const tile = this.world.tileAt(robot.x, robot.y);
      if (tile !== TILE_TYPES.START) {
        return { ok: false, msg: `Count bonus must be claimed on the Start/Exit tile.` };
      }
      // The reported number must match the runtime's valid-indication tally.
      // A real referee adjudicates each indicate() call live and only counts
      // the ones over actual victims. If the robot's tally diverges (e.g.
      // because the code called indicate() on empty floor), the referee's
      // count and the robot's count won't match → no bonus.
      const validCount = ind.kind === 'count_unharmed'
        ? this.unharmedIndicationsValid
        : this.harmedIndicationsValid;
      if (reportedCount !== validCount) {
        const label = ind.kind === 'count_unharmed' ? 'Unharmed' : 'Harmed';
        return { ok: false, msg: `${label} count bonus DENIED. Reported ${reportedCount} but referee tallied ${validCount} valid indications. False-positive indications can cause this — the robot must only indicate when actually over a victim.` };
      }
      if (ind.kind === 'count_unharmed' && !this.unharmedCountClaimed) {
        this.unharmedCountClaimed = true;
        this.unharmedCountReported = reportedCount;
        return { ok: true, msg: `Unharmed count bonus +25 pts. Reported: ${reportedCount} (valid: ${this.unharmedIndicationsValid}).` };
      }
      if (ind.kind === 'count_harmed' && !this.harmedCountClaimed) {
        this.harmedCountClaimed = true;
        this.harmedCountReported = reportedCount;
        return { ok: true, msg: `Harmed count bonus +25 pts. Reported: ${reportedCount} (valid: ${this.harmedIndicationsValid}).` };
      }
    }
    return { ok: false, msg: `Unknown indicate kind: ${ind.kind}` };
  }

  totalPoints() {
    let pts = 0;
    for (const v of this.victimsScored.values()) pts += v.points;
    if (this.exitClaimed) pts += 25;
    if (this.unharmedCountClaimed) pts += 25;
    if (this.harmedCountClaimed) pts += 25;
    return pts;
  }

  summary() {
    const found = [...this.victimsScored.values()];
    const greenFound = found.filter(v => v.kind === 'victim_unharmed').length;
    const redFound = found.filter(v => v.kind === 'victim_harmed').length;
    const totals = this.world.countVictims();
    return {
      greenFound, redFound,
      greenTotal: totals.green,
      redTotal: totals.red,
      unharmedIndications: this.unharmedIndicationsValid,
      harmedIndications:   this.harmedIndicationsValid,
      exit: this.exitClaimed,
      unharmedCount: this.unharmedCountClaimed,
      harmedCount: this.harmedCountClaimed,
      unharmedReported: this.unharmedCountReported,
      harmedReported: this.harmedCountReported,
      total: this.totalPoints()
    };
  }

  scoredTileKeys() { return new Set(this.victimsScored.keys()); }
}


/* =============================================================
   8. RUNTIME
   -------------------------------------------------------------
   Wraps student code in a setup()/loop() structure. Compiles
   their source by Function-constructing a builder that pulls
   robot API names into scope, then we call setup() once and
   loop() at sim cadence.
   ============================================================= */

class Runtime {
  constructor() {
    this.elapsedMs = 0;
    this.serialBuf = '';
    this.serialListener = null;
    this.delayUntil = 0;
  }

  reset() {
    this.elapsedMs = 0;
    this.serialBuf = '';
    this.delayUntil = 0;
  }

  serialOut(text, newline) {
    const piece = text + (newline ? '\n' : '');
    this.serialBuf += piece;
    if (this.serialListener) this.serialListener(piece);
  }

  requestDelay(ms) {
    // Cooperative delay — loop() will be skipped until elapsed catches up
    this.delayUntil = Math.max(this.delayUntil, this.elapsedMs + ms);
  }

  shouldRunLoop() { return this.elapsedMs >= this.delayUntil; }
}

// Compile student source into { setup, loop } using API exposed at function scope.
//
// Tricky bit: students write `function setup() { ... }` and `function loop() { ... }`
// as plain declarations. Function declarations are hoisted to the top of the enclosing
// function. So we cannot pre-declare `var setup = function(){}` because that initialises
// AFTER the hoisted user declaration, clobbering it. Instead, we let the user's
// declarations stand on their own and reference them at the bottom, defaulting to
// no-ops only if they're missing.
function compileStudentCode(src, api) {
  const keys = Object.keys(api);
  const wrapped = `
    "use strict";
    ${keys.map(k => `var ${k} = __api__.${k};`).join('\n')}
    ${src}
    var __setup = (typeof setup === 'function') ? setup : function(){};
    var __loop  = (typeof loop  === 'function') ? loop  : function(){};
    return { setup: __setup, loop: __loop };
  `;
  // eslint-disable-next-line no-new-func
  const fn = new Function('__api__', wrapped);
  return fn(api);
}


/* =============================================================
   9. UI / APP
   ============================================================= */

const STARTER_CODE = `// =================================================================
// Mighty Maisy starter sketch  —  Year 11 Software Engineering
// =================================================================
// Two functions are called by the simulator:
//   setup()  — runs ONCE when you press Run
//   loop()   — runs ~50× per second until time expires or you Stop
//
// Sensor & motor names mirror the real Arduino libraries:
//   frontToF.read() / leftToF.read() / rightToF.read()  → mm (or -1)
//   colourSensor.read()                                  → {r,g,b,c}
//   leftEncoder.read() / rightEncoder.read()             → ticks
//   leftMotor.drive(-255..255) / rightMotor.drive(...)   → signed PWM
//   indicate('victim_unharmed' | 'victim_harmed' | 'exit')
//   indicate('count_unharmed') / indicate('count_harmed')
//   Serial.println(...) for debug output
// =================================================================

let stopUntil = 0;          // ms — when to resume driving after a stop
let foundColours = [];      // log of victims we've indicated

function setup() {
  Serial.println("Robot starting");
  leftEncoder.write(0);
  rightEncoder.write(0);
}

function loop() {
  // ---- 1. Read sensors
  const front = frontToF.read();
  const colour = colourSensor.read();
  const floor  = classifyColour(colour);

  // ---- 2. Stop-and-indicate logic over a victim
  if (millis() < stopUntil) {
    leftMotor.drive(0);
    rightMotor.drive(0);
    return;
  }

  if (floor === 'red' && !foundColours.includes(currentTileKey())) {
    Serial.println("Red victim detected — stopping to indicate");
    leftMotor.drive(0); rightMotor.drive(0);
    indicate('victim_harmed');
    foundColours.push(currentTileKey());
    stopUntil = millis() + 1100;   // hold 1.1s (rule A6.2 needs 1s minimum)
    return;
  }
  if (floor === 'green' && !foundColours.includes(currentTileKey())) {
    Serial.println("Green victim detected — stopping to indicate");
    leftMotor.drive(0); rightMotor.drive(0);
    indicate('victim_unharmed');
    foundColours.push(currentTileKey());
    stopUntil = millis() + 1100;
    return;
  }

  // ---- 3. Avoid black tiles & front walls
  if (floor === 'black') {
    Serial.println("Black tile! Reversing.");
    leftMotor.drive(-120); rightMotor.drive(-120);
    return;
  }
  if (front > 0 && front < 80) {
    // Wall ahead — turn right
    leftMotor.drive(120); rightMotor.drive(-120);
    return;
  }

  // ---- 4. Otherwise drive forward
  leftMotor.drive(150);
  rightMotor.drive(150);
}

// -------- Helpers (improve these!) --------

// Classify the floor under the robot from raw RGB counts.
// IMPROVE THIS: tune thresholds, handle silver (start tile) and edge cases.
function classifyColour({ r, g, b, c }) {
  if (c < 1500) return 'black';                // very low light returned
  if (r > 5000 && r > g * 2 && r > b * 2) return 'red';
  if (g > 5000 && g > r * 1.4 && g > b * 1.4) return 'green';
  if (c > 22000 && Math.abs(r - g) < 1500) return 'silver';
  return 'white';
}

// Approximate which tile the robot is on right now.
// (The sim grid is 290mm; this is a rough key, not used for scoring.)
function currentTileKey() {
  // 'pose' is not directly available — but we can infer from encoders
  // for now, just return time-bucketed key so each new victim is "new"
  return Math.floor(millis() / 1500);
}
`;


class App {
  constructor() {
    this.world = new World();
    this.robot = new Robot();
    this.scorer = new Scorer(this.world);
    this.runtime = new Runtime();
    this.svg = document.getElementById('mazeSvg');
    this.renderer = new Renderer(this.svg, this.world);
    this.feedbackEl = document.getElementById('feedback');
    this.statusEl = document.getElementById('statusStrip');
    this.timerEl = document.getElementById('timer');
    this.scorePanel = document.getElementById('scorePanel');
    this.codeEditor = document.getElementById('codeEditor');
    this.sensorPanel = document.getElementById('sensorPanel');

    // Pose sidebar
    this.poseX = document.getElementById('poseX');
    this.poseY = document.getElementById('poseY');
    this.poseT = document.getElementById('poseT');
    this.poseLPwm = document.getElementById('poseLPwm');
    this.poseRPwm = document.getElementById('poseRPwm');
    this.poseBump = document.getElementById('poseBump');

    // Live score sidebar
    this.scoreGreen = document.getElementById('scoreGreen');
    this.scoreGreenTotal = document.getElementById('scoreGreenTotal');
    this.scoreGreenPts = document.getElementById('scoreGreenPts');
    this.scoreRed = document.getElementById('scoreRed');
    this.scoreRedTotal = document.getElementById('scoreRedTotal');
    this.scoreRedPts = document.getElementById('scoreRedPts');
    this.scoreIndUnharmed = document.getElementById('scoreIndUnharmed');
    this.scoreIndHarmed = document.getElementById('scoreIndHarmed');
    this.scoreExit = document.getElementById('scoreExit');
    this.scoreExitPts = document.getElementById('scoreExitPts');
    this.scoreCount = document.getElementById('scoreCount');
    this.scoreCountPts = document.getElementById('scoreCountPts');
    this.scoreCountDetail = document.getElementById('scoreCountDetail');
    this.scoreCountDetailText = document.getElementById('scoreCountDetailText');
    this.scoreTotal = document.getElementById('scoreTotal');

    // LoP picker
    this.telemetryPanels = document.getElementById('telemetryPanels');
    this.lopPicker = document.getElementById('lopPicker');
    this.lopCheckpoints = document.getElementById('lopCheckpoints');
    this.lopDirection = document.getElementById('lopDirection');
    this.lopButtonPress = document.getElementById('lopButtonPress');
    this.lopResetCode = document.getElementById('lopResetCode');
    this.lopConfirmBtn = document.getElementById('lopConfirm');
    this.lopCancelBtn = document.getElementById('lopCancel');
    this.lopState = null; // { selectedCp, selectedDir, selectedButton }

    this.btnRun = document.getElementById('btnRun');
    this.btnStop = document.getElementById('btnStop');
    this.btnResetRun = document.getElementById('btnResetRun');
    this.btnLoP = document.getElementById('btnLoP');

    this.runState = 'idle'; // idle | running | finished
    this.compiled = null;
    this.lastSensors = null;
    this.lastTickReal = 0;
    this.simSpeed = 1.0;
    this.activeTool = 'wall';
    this._prevScores = { green: 0, red: 0, exit: false, count: 0 };

    this.placeStartingPose();
    this.loadStarter();
    this.bindUI();
    this.initGettingStarted();
    this.render();
    this.updateLiveScore(); // populate totals before any run
    this.updateStatusBar(); // show IDLE state
  }

  // Show / hide the Getting Started callout above the maze.
  // Dismissed via the × button; choice persists across page loads via
  // localStorage. The callout stays visible until the user explicitly
  // dismisses it — no auto-hide on first action, since the user might
  // want to refer back to it while painting the first maze.
  initGettingStarted() {
    this.gsCallout = document.getElementById('gettingStarted');
    if (!this.gsCallout) return;
    const dismissed = (() => {
      try { return localStorage.getItem('mmm.gsDismissed') === '1'; }
      catch { return false; }
    })();
    if (dismissed) {
      this.gsCallout.classList.add('hidden');
    }
    document.getElementById('gsDismiss').addEventListener('click', () => {
      this.gsCallout.classList.add('hidden');
      try { localStorage.setItem('mmm.gsDismissed', '1'); } catch {}
    });
  }

  loadStarter() {
    this.codeEditor.value = STARTER_CODE;
  }

  placeStartingPose() {
    // Place robot at centre of start tile, heading +y (into the maze)
    const { startX, startY } = this.world;
    this.robot.reset(
      startX * TILE_MM + TILE_MM / 2,
      startY * TILE_MM + TILE_MM / 2,
      -Math.PI / 2 // facing up (-y)
    );
  }

  bindUI() {
    // ---- Toolbar buttons (paint tools)
    const toolButtons = document.querySelectorAll('[data-tool]');
    for (const btn of toolButtons) {
      btn.addEventListener('click', () => {
        this.activeTool = btn.dataset.tool;
        toolButtons.forEach(b => b.classList.toggle('active', b === btn));
        this.updateStatusBar();
      });
    }

    // ---- SVG click for paint
    this.svg.addEventListener('click', (e) => {
      if (this.runState === 'running') return;
      const w = this.renderer.clientToWorld(e.clientX, e.clientY);
      if (!w) return;
      this.handleMazeClick(w.x, w.y);
    });

    // ---- Run / stop / reset
    document.getElementById('btnRun').addEventListener('click', () => this.run());
    document.getElementById('btnStop').addEventListener('click', () => this.stop('user'));
    document.getElementById('btnResetMaze').addEventListener('click', () => this.resetMaze());
    document.getElementById('btnClearMaze').addEventListener('click', () => this.clearMaze());
    document.getElementById('btnTestMaze').addEventListener('click', () => this.loadTestMaze());
    document.getElementById('btnExportMaze').addEventListener('click', () => this.exportMazeJSON());

    // Import: clicking the visible button triggers the hidden file input.
    // When a file is chosen, hand it to importMazeJSON. We reset the
    // input value afterward so the same file can be re-imported by
    // re-selecting it (browsers suppress the change event otherwise).
    const importFileInput = document.getElementById('importMazeFile');
    document.getElementById('btnImportMaze').addEventListener('click', () => {
      importFileInput.click();
    });
    importFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.importMazeJSON(file);
      e.target.value = '';
    });

    // Noise toggle — flips the global flag and updates the button label
    const noiseBtn = document.getElementById('btnNoise');
    noiseBtn.addEventListener('click', () => {
      setNoiseEnabled(!isNoiseEnabled());
      noiseBtn.textContent = 'Noise: ' + (isNoiseEnabled() ? 'ON' : 'OFF');
      noiseBtn.classList.toggle('active', !isNoiseEnabled());
    });
    this.btnResetRun.addEventListener('click', () => this.resetRun());
    this.btnLoP.addEventListener('click', () => this.openLopPicker());

    // ---- LoP picker controls
    this.lopCancelBtn.addEventListener('click', () => this.closeLopPicker(false));
    this.lopConfirmBtn.addEventListener('click', () => this.closeLopPicker(true));
    this.lopDirection.querySelectorAll('.lop-dir-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.lopState.selectedDir = btn.dataset.dir;
        this.lopDirection.querySelectorAll('.lop-dir-btn').forEach(b =>
          b.classList.toggle('selected', b === btn));
        this._updateLopConfirmEnabled();
      });
    });
    this.lopButtonPress.querySelectorAll('.lop-btn-press-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.lopState.selectedButton = btn.dataset.btn;  // 'None' | 'A' | 'B' | 'C'
        this.lopButtonPress.querySelectorAll('.lop-btn-press-btn').forEach(b =>
          b.classList.toggle('selected', b === btn));
      });
    });

    // ---- Speed
    document.getElementById('speedSelect').addEventListener('change', (e) => {
      this.simSpeed = parseFloat(e.target.value);
    });

    // ---- Serial output listener
    this.runtime.serialListener = (text) => {
      const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      this.feedbackEl.innerHTML += safe;
      this.feedbackEl.scrollTop = this.feedbackEl.scrollHeight;
    };
  }

  handleMazeClick(xMM, yMM) {
    const tool = this.activeTool;
    if (tool === 'wall') {
      // Pick the nearest tile edge and toggle that wall
      const tx = Math.floor(xMM / TILE_MM);
      const ty = Math.floor(yMM / TILE_MM);
      const lx = xMM - tx * TILE_MM;
      const ly = yMM - ty * TILE_MM;
      // Distance to each of 4 edges
      const dTop = ly, dBot = TILE_MM - ly, dLeft = lx, dRight = TILE_MM - lx;
      const minD = Math.min(dTop, dBot, dLeft, dRight);
      if (minD === dTop)        this.world.toggleWall('h', tx, ty);
      else if (minD === dBot)   this.world.toggleWall('h', tx, ty + 1);
      else if (minD === dLeft)  this.world.toggleWall('v', tx, ty);
      else                      this.world.toggleWall('v', tx + 1, ty);
    } else {
      // tile-fill tools: empty / start / black / red / green
      const tx = Math.floor(xMM / TILE_MM);
      const ty = Math.floor(yMM / TILE_MM);
      const map = {
        empty: TILE_TYPES.EMPTY, start: TILE_TYPES.START,
        black: TILE_TYPES.BLACK, red: TILE_TYPES.RED, green: TILE_TYPES.GREEN
      };
      if (tool in map) this.world.setTile(tx, ty, map[tool]);
    }
    this.placeStartingPose(); // start tile may have moved
    this.render();
  }

  resetMaze() {
    if (this.runState === 'running') this.stop('reset');
    this.world = new World();
    this.scorer = new Scorer(this.world);
    this.renderer = new Renderer(this.svg, this.world);
    this.placeStartingPose();
    this.feedbackEl.innerHTML = '';
    this.scorePanel.classList.add('hidden');
    this.runState = 'idle';
    this._prevScores = { green: 0, red: 0, exit: false, count: 0 };
    this.lastSensors = null;
    this.render();
    this.updateStatusBar();
  }

  clearMaze() {
    if (this.runState === 'running') this.stop('reset');
    this.world = new World();
    // Strip outer perimeter except start side enclosure — keep perimeter but clear interior
    for (let y = 0; y <= GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (y > 0 && y < GRID_H) this.world.wallsH[y][x] = false;
      }
    }
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x <= GRID_W; x++) {
        if (x > 0 && x < GRID_W) this.world.wallsV[y][x] = false;
      }
    }
    // Add walls around start tile (3 sides per A2.2.2)
    const sx = this.world.startX, sy = this.world.startY;
    if (sx > 0) this.world.wallsV[sy][sx] = true;
    if (sx < GRID_W - 1) this.world.wallsV[sy][sx + 1] = true;
    if (sy > 0) this.world.wallsH[sy][sx] = true;
    if (sy < GRID_H - 1) this.world.wallsH[sy + 1][sx] = true;
    // Reopen the side facing into the maze
    if (sy === GRID_H - 1) this.world.wallsH[sy][sx] = false;
    else if (sy === 0)     this.world.wallsH[sy + 1][sx] = false;
    else if (sx === 0)     this.world.wallsV[sy][sx + 1] = false;
    else                   this.world.wallsV[sy][sx] = false;
    this.scorer = new Scorer(this.world);
    this.renderer = new Renderer(this.svg, this.world);
    this.placeStartingPose();
    this.feedbackEl.innerHTML = '';
    this.scorePanel.classList.add('hidden');
    this.runState = 'idle';
    this._prevScores = { green: 0, red: 0, exit: false, count: 0 };
    this.lastSensors = null;
    this.render();
    this.updateStatusBar();
  }

  // Simple test maze — designed so right-hand wall-following sweeps all
  // four victims along the perimeter. The shipped exemplar scores 70/70
  // Test maze. Right-hand wall-following with full bonus claim should
  // score 130/130 on this maze (3 greens + 1 red + exit + 2 counts).
  // Use it to verify your code works end-to-end.
  loadTestMaze() {
    this._applyMazeData(TEST_MAZE_DATA);
  }

  // Apply a maze JSON object to the current world. Used by both the
  // built-in test maze button and the JSON file importer — single
  // code path so they behave identically.
  _applyMazeData(data) {
    if (this.runState === 'running') this.stop('reset');
    // Fresh world; clear interior walls + tiles, then overlay from data.
    this.world = new World();
    for (let y = 1; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) this.world.wallsH[y][x] = false;
    }
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 1; x < GRID_W; x++) this.world.wallsV[y][x] = false;
    }
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) this.world.grid[y][x] = TILE_TYPES.EMPTY;
    }
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const t = data.tiles[y][x];
        if (t !== TILE_TYPES.EMPTY) this.world.setTile(x, y, t);
      }
    }
    for (let y = 0; y <= GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) this.world.wallsH[y][x] = !!data.wallsH[y][x];
    }
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x <= GRID_W; x++) this.world.wallsV[y][x] = !!data.wallsV[y][x];
    }
    this.world.startX = data.startX;
    this.world.startY = data.startY;
    this.world.grid[data.startY][data.startX] = TILE_TYPES.START;

    this.scorer = new Scorer(this.world);
    this.renderer = new Renderer(this.svg, this.world);
    this.placeStartingPose();
    this.feedbackEl.innerHTML = '';
    this.scorePanel.classList.add('hidden');
    this.runState = 'idle';
    this._prevScores = { green: 0, red: 0, exit: false, count: 0 };
    this.lastSensors = null;
    this.render();
    this.updateStatusBar();
  }

  // Serialise the current maze to a JSON file and trigger a download.
  // The file captures everything needed to reproduce the maze: tile grid,
  // wall arrays, and start position. Format is human-readable so it can
  // be edited in a text editor.
  exportMazeJSON() {
    const data = {
      version: 1,
      gridW: GRID_W,
      gridH: GRID_H,
      startX: this.world.startX,
      startY: this.world.startY,
      // Deep-copy so the JSON snapshot is decoupled from live state
      tiles: this.world.grid.map(row => row.slice()),
      wallsH: this.world.wallsH.map(row => row.slice()),
      wallsV: this.world.wallsV.map(row => row.slice())
    };
    // Custom formatter: tiles/walls each row on its own line, scalars indented.
    // Result is human-readable and editable in a text editor.
    const rowsToLines = arr => arr.map(r => '    ' + JSON.stringify(r)).join(',\n');
    const json =
      '{\n' +
      `  "version": ${data.version},\n` +
      `  "gridW": ${data.gridW},\n` +
      `  "gridH": ${data.gridH},\n` +
      `  "startX": ${data.startX},\n` +
      `  "startY": ${data.startY},\n` +
      `  "tiles": [\n${rowsToLines(data.tiles)}\n  ],\n` +
      `  "wallsH": [\n${rowsToLines(data.wallsH)}\n  ],\n` +
      `  "wallsV": [\n${rowsToLines(data.wallsV)}\n  ]\n` +
      '}\n';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maze-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.serialInfo(`Maze exported as maze-${ts}.json`);
  }

  // Load a maze from a JSON file selected by the user. Validates the
  // input shape and rejects malformed files with a clear message
  // rather than crashing.
  importMazeJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (err) {
        this.serialErr(`Could not parse JSON: ${err.message}`);
        return;
      }
      const validation = this._validateMazeJSON(data);
      if (validation !== null) {
        this.serialErr(`Invalid maze file: ${validation}`);
        return;
      }
      this._applyMazeData(data);
      this.serialInfo(`Maze imported from ${file.name}`);
    };
    reader.onerror = () => this.serialErr(`Could not read file: ${reader.error}`);
    reader.readAsText(file);
  }

  // Returns null if the parsed JSON is a valid maze, otherwise a string
  // describing the first problem found.
  _validateMazeJSON(data) {
    if (!data || typeof data !== 'object') return 'top level must be an object';
    if (data.version !== 1) return `unsupported version: ${data.version}`;
    if (data.gridW !== GRID_W) return `gridW must be ${GRID_W} (got ${data.gridW})`;
    if (data.gridH !== GRID_H) return `gridH must be ${GRID_H} (got ${data.gridH})`;
    if (!Number.isInteger(data.startX) || data.startX < 0 || data.startX >= GRID_W) {
      return `startX out of range: ${data.startX}`;
    }
    if (!Number.isInteger(data.startY) || data.startY < 0 || data.startY >= GRID_H) {
      return `startY out of range: ${data.startY}`;
    }
    if (!Array.isArray(data.tiles) || data.tiles.length !== GRID_H) {
      return `tiles must be a ${GRID_H}-row array`;
    }
    const validTypes = [
      TILE_TYPES.EMPTY, TILE_TYPES.START, TILE_TYPES.BLACK,
      TILE_TYPES.RED, TILE_TYPES.GREEN
    ];
    for (let y = 0; y < GRID_H; y++) {
      const row = data.tiles[y];
      if (!Array.isArray(row) || row.length !== GRID_W) {
        return `tiles[${y}] must be a ${GRID_W}-column array`;
      }
      for (let x = 0; x < GRID_W; x++) {
        if (!validTypes.includes(row[x])) {
          return `tiles[${y}][${x}] is not a valid tile type: ${row[x]}`;
        }
      }
    }
    if (!Array.isArray(data.wallsH) || data.wallsH.length !== GRID_H + 1) {
      return `wallsH must be a ${GRID_H + 1}-row array`;
    }
    for (let y = 0; y <= GRID_H; y++) {
      if (!Array.isArray(data.wallsH[y]) || data.wallsH[y].length !== GRID_W) {
        return `wallsH[${y}] must be a ${GRID_W}-column array`;
      }
    }
    if (!Array.isArray(data.wallsV) || data.wallsV.length !== GRID_H) {
      return `wallsV must be a ${GRID_H}-row array`;
    }
    for (let y = 0; y < GRID_H; y++) {
      if (!Array.isArray(data.wallsV[y]) || data.wallsV[y].length !== GRID_W + 1) {
        return `wallsV[${y}] must be a ${GRID_W + 1}-column array`;
      }
    }
    return null;
  }

  // Reset RUN state — clear scores, clock, robot position. Maze and code untouched.
  // Available when state is idle or finished. During running, must Stop first.
  resetRun() {
    if (this.runState === 'running') {
      this.serialInfo('Stop the run before resetting.');
      return;
    }
    this.scorer = new Scorer(this.world);
    this.runtime.reset();
    this._prevScores = { green: 0, red: 0, exit: false, count: 0 };
    this._stepBudget = 0;
    this.lastSensors = null;
    this.compiled = null;
    this.placeStartingPose();
    this.feedbackEl.innerHTML = '';
    this.scorePanel.classList.add('hidden');
    this.runState = 'idle';
    this.render();
    this.updateStatusBar();
  }

  // ---- Lack of Progress flow ----
  // Per RCJA rule A5.5.2: pause the running sim, present checkpoints (Start tile
  // + previously-identified victim tiles), let the student pick a position and
  // facing, and optionally re-run setup() (preserving everything else, including
  // accumulated score and elapsed time).
  openLopPicker() {
    if (this.runState !== 'running') {
      this.serialInfo('Lack of progress is only available during a run.');
      return;
    }
    this._lopWasRunning = true;
    this.runState = 'paused-lop';
    this.robot.leftPwm = 0; this.robot.rightPwm = 0;

    // Build checkpoint list: always Start, plus any scored victims
    const checkpoints = [
      { kind: 'start', label: 'Start tile',
        tx: this.world.startX, ty: this.world.startY }
    ];
    for (const [key, info] of this.scorer.victimsScored.entries()) {
      const [tx, ty] = key.split(',').map(Number);
      const colour = info.kind === 'victim_unharmed' ? 'green' : 'red';
      checkpoints.push({
        kind: colour, label: `${colour === 'green' ? 'Green' : 'Red'} victim at (${tx}, ${ty})`,
        tx, ty
      });
    }
    this._renderLopCheckpoints(checkpoints);
    this.lopState = { selectedCp: null, selectedDir: null, selectedButton: 'None', checkpoints };
    this._updateLopConfirmEnabled();
    this.lopResetCode.checked = false;
    // Reset direction selection
    this.lopDirection.querySelectorAll('.lop-dir-btn').forEach(b => b.classList.remove('selected'));
    // Reset button-press selection to None
    this.lopButtonPress.querySelectorAll('.lop-btn-press-btn').forEach(b =>
      b.classList.toggle('selected', b.dataset.btn === 'None'));

    // Show picker, dim panels
    this.telemetryPanels.classList.add('dimmed');
    this.lopPicker.hidden = false;
    this.updateStatusBar();
  }

  _renderLopCheckpoints(checkpoints) {
    this.lopCheckpoints.innerHTML = '';
    if (checkpoints.length === 1) {
      // Only Start available. Render it but also a hint that finding victims gives more options.
      const hint = document.createElement('div');
      hint.className = 'lop-cp-empty';
      hint.textContent = 'No identified victims yet — only Start available. Identify victims during a run to unlock checkpoints.';
      this.lopCheckpoints.appendChild(hint);
    }
    for (const cp of checkpoints) {
      const btn = document.createElement('button');
      btn.className = 'lop-cp-btn';
      btn.dataset.cpIndex = checkpoints.indexOf(cp);
      btn.innerHTML = `<span class="cp-dot ${cp.kind}"></span>${cp.label}`;
      btn.addEventListener('click', () => {
        this.lopState.selectedCp = cp;
        this.lopCheckpoints.querySelectorAll('.lop-cp-btn').forEach(b =>
          b.classList.toggle('selected', b === btn));
        this._updateLopConfirmEnabled();
      });
      this.lopCheckpoints.appendChild(btn);
    }
  }

  _updateLopConfirmEnabled() {
    const ready = this.lopState && this.lopState.selectedCp && this.lopState.selectedDir;
    this.lopConfirmBtn.disabled = !ready;
  }

  closeLopPicker(confirmed) {
    this.lopPicker.hidden = true;
    this.telemetryPanels.classList.remove('dimmed');

    if (confirmed && this.lopState) {
      const cp = this.lopState.selectedCp;
      const dir = this.lopState.selectedDir;
      // Cardinal → heading. In screen space (y down), N = -π/2, E = 0, S = π/2, W = π.
      const dirRad = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI }[dir];
      this.robot.reset(
        cp.tx * TILE_MM + TILE_MM / 2,
        cp.ty * TILE_MM + TILE_MM / 2,
        dirRad
      );
      // Score and elapsed time are preserved (not reset).
      this.serialInfo(`LoP: robot moved to ${cp.label}, facing ${dir}.`);

      // Fire button press if requested. Done BEFORE setup() re-run so
      // setup() can poll the press too. Also done AFTER robot.reset so
      // that the press signal is what the student's code sees as "the
      // operator just relocated me" — not stale from before LoP opened.
      const btn = this.lopState.selectedButton;
      if (btn && btn !== 'None') {
        this.robot.pendingPress[btn] = true;
        this.serialInfo(`LoP: button ${btn} pressed.`);
      }

      if (this.lopResetCode.checked && this.compiled) {
        try {
          this.compiled.setup();
          this.serialInfo('setup() re-run.');
        } catch (e) {
          this.serialErr(`setup() threw on LoP reset: ${e.message}`);
          this.runState = 'finished';
          this.showScorePanel('error');
          this.updateStatusBar();
          return;
        }
      }
    }

    if (this._lopWasRunning) {
      this._lopWasRunning = false;
      this.runState = 'running';
      this.lastTickReal = performance.now();
      this._stepBudget = 0; // don't accumulate dead time during the picker
      this.tick();
    }
    this.updateStatusBar();
    this.render();
  }

  run() {
    if (this.runState === 'running') return;
    this.feedbackEl.innerHTML = '';
    this.scorePanel.classList.add('hidden');
    this.placeStartingPose();
    this.scorer = new Scorer(this.world);
    this._prevScores = { green: 0, red: 0, exit: false, count: 0 };
    this._stepBudget = 0;
    this.runtime.reset();

    const walls = this.world.getWallSegments();
    const api = buildRobotAPI(this.robot, this.world, walls, this.runtime);

    try {
      this.compiled = compileStudentCode(this.codeEditor.value, api);
    } catch (e) {
      this.serialErr(`Compile error: ${e.message}`);
      return;
    }

    // Fire pre-armed start press BEFORE setup() runs, so setup() can poll it.
    // Per rule 2.2.1, the operator may press a button at start to choose a
    // strategy, calibrate, etc.
    const startPress = document.getElementById('startPressSelect').value;
    if (startPress && startPress !== 'None') {
      this.robot.pendingPress[startPress] = true;
      this.serialInfo(`Start: button ${startPress} pressed.`);
    }

    try {
      this.compiled.setup();
    } catch (e) {
      this.serialErr(`setup() threw: ${e.message}`);
      return;
    }

    this.runState = 'running';
    this.lastTickReal = performance.now();
    this.tick();
  }

  stop(reason) {
    if (this.runState !== 'running') return;
    this.runState = 'finished';
    this.robot.leftPwm = 0; this.robot.rightPwm = 0;
    this.showScorePanel(reason);
    this.updateStatusBar();
    this.render();
  }

  tick() {
    if (this.runState !== 'running') return;

    const now = performance.now();
    const realDelta = now - this.lastTickReal;
    this.lastTickReal = now;
    const simDelta = realDelta * this.simSpeed;
    // Accumulate budget across frames. With SIM_HZ=50 (20ms per tick) and
    // RAF at ~60Hz (16.67ms), a single frame's budget at simSpeed=1 is less
    // than one step. The accumulator carries the remainder forward so we
    // catch up over the next frame.
    this._stepBudget = (this._stepBudget || 0) + simDelta;

    const stepMs = SIM_DT * 1000;
    let stepsThisFrame = 0;
    const maxStepsPerFrame = 60; // cap to avoid death-spiral

    while (this._stepBudget >= stepMs && stepsThisFrame < maxStepsPerFrame) {
      this.simStep();
      this._stepBudget -= stepMs;
      stepsThisFrame++;
      if (this.runState !== 'running') break;
    }
    // If we hit the death-spiral cap, drop the rest of the budget so we don't
    // queue up infinite work next frame.
    if (stepsThisFrame >= maxStepsPerFrame) this._stepBudget = 0;

    this.render();
    this.updateStatusBar();

    if (this.runState === 'running') {
      requestAnimationFrame(() => this.tick());
    }
  }

  simStep() {
    this.runtime.elapsedMs += SIM_DT * 1000;
    if (this.runtime.elapsedMs >= TIME_LIMIT_MS) {
      this.stop('time');
      return;
    }

    // Run student loop()
    if (this.compiled && this.runtime.shouldRunLoop()) {
      try { this.compiled.loop(); }
      catch (e) {
        this.serialErr(`loop() threw: ${e.message}`);
        this.stop('error');
        return;
      }
    }

    // Physics
    const walls = this.world.getWallSegments();
    this.robot.step(walls);

    // Process indications
    while (this.robot.indications.length) {
      const ind = this.robot.indications.shift();
      const result = this.scorer._handle(this.robot, ind, this.runtime.elapsedMs);
      if (result) {
        if (result.ok) this.serialOk(`✓ ${result.msg}`);
        else this.serialInfo(`· ${result.msg}`);
      }
    }

    // Cache sensor readings for the visual panel (cheap re-read)
    this.lastSensors = {
      tofFront: readToFNoisy(this.robot, 'tofFront', walls),
      tofLeft:  readToFNoisy(this.robot, 'tofLeft', walls),
      tofRight: readToFNoisy(this.robot, 'tofRight', walls),
      colour:   readColourSensor(this.robot, this.world),
      encL: Math.round(this.robot.leftEncoderTicks),
      encR: Math.round(this.robot.rightEncoderTicks)
    };
  }

  render() {
    this.renderer.render(this.robot, this.lastSensors, this.scorer.scoredTileKeys());
    this.updateSensorPanel();
    this.updateLiveScore();
    this.updatePoseReadout();
  }

  updatePoseReadout() {
    const r = this.robot;
    const headDeg = ((r.heading * 180 / Math.PI) % 360 + 360) % 360;
    this.poseX.textContent = r.x.toFixed(0);
    this.poseY.textContent = r.y.toFixed(0);
    this.poseT.textContent = headDeg.toFixed(0);
    this.poseLPwm.textContent = r.leftPwm;
    this.poseRPwm.textContent = r.rightPwm;
    this.poseBump.classList.toggle('show', r.bumpedThisStep);
  }

  updateSensorPanel() {
    const s = this.lastSensors;
    if (!s) {
      this.sensorPanel.innerHTML = '<div class="sensor-empty">Sensor values appear when you press Run.</div>';
      return;
    }
    const pct = (v, max) => Math.min(100, Math.max(0, (v / max) * 100));
    // Display swatch should be perceptually meaningful — scale raw 16-bit
    // counts (~0-30000 typical) to 0-255 with mild gamma.
    const swR = Math.min(255, Math.round(Math.pow(s.colour.r / 30000, 0.7) * 255));
    const swG = Math.min(255, Math.round(Math.pow(s.colour.g / 30000, 0.7) * 255));
    const swB = Math.min(255, Math.round(Math.pow(s.colour.b / 30000, 0.7) * 255));

    this.sensorPanel.innerHTML = `
      <div class="sensor-section">
        <div class="sensor-section-title">ToF (mm)</div>
        <div class="sensor-row"><span class="label">Front</span>
          <div class="bar"><div class="bar-fill" style="width:${pct(s.tofFront < 0 ? 0 : s.tofFront, 1200)}%"></div></div>
          <span class="val">${s.tofFront < 0 ? '—' : s.tofFront}</span></div>
        <div class="sensor-row"><span class="label">Left</span>
          <div class="bar"><div class="bar-fill" style="width:${pct(s.tofLeft < 0 ? 0 : s.tofLeft, 1200)}%"></div></div>
          <span class="val">${s.tofLeft < 0 ? '—' : s.tofLeft}</span></div>
        <div class="sensor-row"><span class="label">Right</span>
          <div class="bar"><div class="bar-fill" style="width:${pct(s.tofRight < 0 ? 0 : s.tofRight, 1200)}%"></div></div>
          <span class="val">${s.tofRight < 0 ? '—' : s.tofRight}</span></div>
      </div>

      <div class="sensor-section">
        <div class="sensor-section-title">Colour (raw 16-bit)</div>
        <div class="sensor-row"><span class="label">R</span>
          <div class="bar"><div class="bar-fill r" style="width:${pct(s.colour.r, 30000)}%"></div></div>
          <span class="val">${s.colour.r}</span></div>
        <div class="sensor-row"><span class="label">G</span>
          <div class="bar"><div class="bar-fill g" style="width:${pct(s.colour.g, 30000)}%"></div></div>
          <span class="val">${s.colour.g}</span></div>
        <div class="sensor-row"><span class="label">B</span>
          <div class="bar"><div class="bar-fill b" style="width:${pct(s.colour.b, 30000)}%"></div></div>
          <span class="val">${s.colour.b}</span></div>
        <div class="sensor-row"><span class="label">Clear</span>
          <div class="bar"><div class="bar-fill c" style="width:${pct(s.colour.c, 60000)}%"></div></div>
          <span class="val">${s.colour.c}</span></div>
        <div class="colour-swatch" style="background: rgb(${swR}, ${swG}, ${swB})"></div>
      </div>

      <div class="sensor-section">
        <div class="sensor-section-title">Encoders (ticks)</div>
        <div class="sensor-row"><span class="label">Left</span>
          <div class="bar"><div class="bar-fill" style="width:${pct(Math.abs(s.encL) % 8000, 8000)}%"></div></div>
          <span class="val">${s.encL}</span></div>
        <div class="sensor-row"><span class="label">Right</span>
          <div class="bar"><div class="bar-fill" style="width:${pct(Math.abs(s.encR) % 8000, 8000)}%"></div></div>
          <span class="val">${s.encR}</span></div>
      </div>
    `;
  }

  updateLiveScore() {
    const sum = this.scorer.summary();
    const totals = this.world.countVictims();

    // Counts vs totals
    this.scoreGreen.textContent = sum.greenFound;
    this.scoreGreenTotal.textContent = totals.green;
    this.scoreRed.textContent = sum.redFound;
    this.scoreRedTotal.textContent = totals.red;
    this.scoreIndUnharmed.textContent = sum.unharmedIndications;
    this.scoreIndHarmed.textContent = sum.harmedIndications;

    // Points columns
    this.scoreGreenPts.textContent = sum.greenFound * 10;
    this.scoreRedPts.textContent = sum.redFound * 25;
    this.scoreExitPts.textContent = sum.exit ? 25 : 0;
    this.scoreExit.textContent = sum.exit ? '✓' : '—';
    const countPts = (sum.unharmedCount ? 25 : 0) + (sum.harmedCount ? 25 : 0);
    this.scoreCountPts.textContent = countPts;
    if (sum.unharmedCount && sum.harmedCount) this.scoreCount.textContent = '✓✓';
    else if (sum.unharmedCount || sum.harmedCount) this.scoreCount.textContent = '✓';
    else this.scoreCount.textContent = '—';

    // Show the reported vs valid counts beneath the Count bonus row when
    // either count has been claimed. With the strict-match rule, reported
    // always equals valid when the bonus is awarded — the line confirms
    // the team's count agreed with the referee's tally. "Valid" = the
    // referee's count of indications over a real victim of matching colour.
    if (sum.unharmedCount || sum.harmedCount) {
      const parts = [];
      if (sum.unharmedCount) {
        parts.push(`Unharmed: reported ${sum.unharmedReported} (valid ${sum.unharmedIndications})`);
      }
      if (sum.harmedCount) {
        parts.push(`Harmed: reported ${sum.harmedReported} (valid ${sum.harmedIndications})`);
      }
      this.scoreCountDetailText.textContent = parts.join(' · ');
      this.scoreCountDetail.hidden = false;
    } else {
      this.scoreCountDetail.hidden = true;
    }

    this.scoreTotal.textContent = sum.total;

    // Pulse animation for newly-scored rows. Row order in HTML:
    //   [0] Green, [1] Red, [2] Indications, [3] Exit, [4] Count, [5] Detail (when shown), [6] Total
    const rows = this.scoreTotal.closest('.live-score').querySelectorAll('.score-row');
    if (sum.greenFound > this._prevScores.green) this._pulseRow(rows[0]);
    if (sum.redFound > this._prevScores.red)     this._pulseRow(rows[1]);
    if (sum.exit && !this._prevScores.exit)      this._pulseRow(rows[3]);
    if (countPts > this._prevScores.count)       this._pulseRow(rows[4]);

    this._prevScores = {
      green: sum.greenFound, red: sum.redFound,
      exit: sum.exit, count: countPts
    };
  }

  _pulseRow(row) {
    if (!row) return;
    row.classList.remove('scored');
    void row.offsetWidth; // restart animation
    row.classList.add('scored');
  }

  updateStatusBar() {
    const ms = this.runtime.elapsedMs;
    const remaining = Math.max(0, TIME_LIMIT_MS - ms);
    const sec = (remaining / 1000).toFixed(1);
    this.timerEl.textContent = `T-${sec}s`;
    this.timerEl.classList.toggle('warn', remaining < 30000 && remaining >= 10000);
    this.timerEl.classList.toggle('danger', remaining < 10000);

    const stateLabel = {
      idle: 'IDLE — paint a maze, then press Run',
      running: 'RUNNING',
      'paused-lop': 'PAUSED — Lack of progress',
      finished: 'FINISHED — see debrief below'
    }[this.runState] || this.runState.toUpperCase();
    const pillClass = this.runState === 'running' ? 'success'
                    : this.runState === 'paused-lop' ? 'warn'
                    : this.runState === 'finished' ? 'info' : '';
    this.statusEl.innerHTML = `
      <span class="status-pill ${pillClass}">${stateLabel}</span>
      <span class="status-pill">Tool: ${this.activeTool}</span>
    `;

    // Button enabled states
    const isRunning = this.runState === 'running';
    const isPaused = this.runState === 'paused-lop';
    this.btnRun.disabled = isRunning || isPaused;
    this.btnStop.disabled = !isRunning;
    this.btnLoP.disabled = !isRunning;
    this.btnResetRun.disabled = isRunning || isPaused;
  }

  serialErr(msg) {
    const safe = msg.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    this.feedbackEl.innerHTML += `<span class="err">[ERR] ${safe}</span>\n`;
    this.feedbackEl.scrollTop = this.feedbackEl.scrollHeight;
  }
  serialOk(msg) {
    const safe = msg.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    this.feedbackEl.innerHTML += `<span class="ok">${safe}</span>\n`;
    this.feedbackEl.scrollTop = this.feedbackEl.scrollHeight;
  }
  serialInfo(msg) {
    const safe = msg.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    this.feedbackEl.innerHTML += `<span class="info">${safe}</span>\n`;
    this.feedbackEl.scrollTop = this.feedbackEl.scrollHeight;
  }

  showScorePanel(reason) {
    const sum = this.scorer.summary();
    const totals = this.world.countVictims();
    const reasonText = {
      time: 'Time expired',
      user: 'Stopped by user',
      reset: 'Reset',
      error: 'Stopped on error'
    }[reason] || 'Run ended';

    const debriefHTML = this._buildDebrief(reason, sum, totals);

    this.scorePanel.innerHTML = `
      <h2>Run Complete</h2>
      <div class="score-meta">${reasonText} · Time: ${(this.runtime.elapsedMs / 1000).toFixed(1)}s</div>
      <ul class="score-list">
        <li><span>Unharmed (green) victims</span><span class="pts">${sum.greenFound} × 10 = ${sum.greenFound * 10}</span></li>
        <li><span>Harmed (red) victims</span><span class="pts">${sum.redFound} × 25 = ${sum.redFound * 25}</span></li>
        <li><span>Exit bonus</span><span class="pts">${sum.exit ? 25 : 0}</span></li>
        <li><span>Unharmed count bonus</span><span class="pts">${sum.unharmedCount ? 25 : 0}</span></li>
        <li><span>Harmed count bonus</span><span class="pts">${sum.harmedCount ? 25 : 0}</span></li>
        <li class="total"><span>Total</span><span class="pts">${sum.total} pts</span></li>
      </ul>
      ${debriefHTML}
      <p style="margin-top:14px; font-size:0.92rem; color:var(--muted)">
        Maze had ${totals.green} green and ${totals.red} red victims.
      </p>
    `;
    this.scorePanel.classList.remove('hidden');
  }

  // Build a short list of diagnostic observations after a run.
  // Capped at ~3 items; ordered most-actionable-first. Skipped on 'reset'
  // (user explicitly reset, no narrative needed). Minimal on 'error'
  // (the serial output already explains).
  _buildDebrief(reason, sum, totals) {
    if (reason === 'reset') return '';
    if (reason === 'error') {
      return `<div class="debrief"><div class="debrief-title">What happened</div>
        <ul class="debrief-list"><li>Your code threw an error — check the Serial output below the editor for details.</li></ul>
      </div>`;
    }

    const items = [];
    const totalVictims = totals.green + totals.red;
    const foundVictims = sum.greenFound + sum.redFound;
    const maxPossible = totals.green * 10 + totals.red * 25 + 25 + 50; // greens + reds + exit + 2 counts

    // 1. Robot never moved (final pose still on start tile after time elapsed AND no victims found AND no indications)
    const startCx = this.world.startX * TILE_MM + TILE_MM / 2;
    const startCy = this.world.startY * TILE_MM + TILE_MM / 2;
    const distFromStart = Math.hypot(this.robot.x - startCx, this.robot.y - startCy);
    const neverMoved = this.runtime.elapsedMs > 5000 &&
                       distFromStart < TILE_MM &&
                       foundVictims === 0 &&
                       sum.unharmedIndications === 0 &&
                       sum.harmedIndications === 0;
    if (neverMoved) {
      items.push("The robot didn't leave the start tile. Check that <code>leftMotor.drive()</code> and <code>rightMotor.drive()</code> are being called with non-zero values in <code>loop()</code>.");
    }

    // 2. Time expired with no victims
    else if (reason === 'time' && foundVictims === 0 && totalVictims > 0) {
      items.push(`Time ran out without finding any of the ${totalVictims} victims. Try checking your colour-sensor logic — is <code>indicate('victim_unharmed')</code> being called when you're over a green tile?`);
    }

    // 3. Found some victims but didn't return / claim exit
    if (foundVictims > 0 && !sum.exit && reason === 'time') {
      items.push(`Found ${foundVictims} victim${foundVictims === 1 ? '' : 's'} but didn't claim the exit bonus. Did your code drive back to the silver Start tile and call <code>indicate('exit')</code> while fully contained on it?`);
    }

    // 4. Robot is on start tile but didn't claim exit (close to home but not centred)
    const onStartTile = this.world.tileAt(this.robot.x, this.robot.y) === TILE_TYPES.START;
    if (foundVictims > 0 && onStartTile && !sum.exit && items.length < 3) {
      items.push("Robot ended on the Start tile but the exit bonus wasn't claimed. Per rule A6.5, the entire robot body must be contained on the silver tile when <code>indicate('exit')</code> is called.");
    }

    // 5. Count bonus eligibility but neither claimed
    const eligibleForCount = foundVictims >= Math.floor(totalVictims / 2) && totalVictims > 0;
    if (eligibleForCount && !sum.unharmedCount && !sum.harmedCount && items.length < 3) {
      items.push(`You found ≥half the victims (eligible for count bonuses) but didn't claim either. Call <code>indicate('count_unharmed', N)</code> and <code>indicate('count_harmed', N)</code> from the Start tile, where <code>N</code> matches your robot's tally.`);
    }

    // 6. Reported counts didn't match valid tally (referee denied bonus)
    // Detected: count was eligible AND robot is on start AND but bonus not claimed.
    // We can also explicitly check via the scorer: if the robot called count_*
    // but the tally mismatched, the bonus stays false. That gets covered by #5.

    // 7. Full max score
    if (sum.total === maxPossible && maxPossible > 0) {
      items.length = 0; // wipe other notes — celebration only
      items.push("Full score! 🎉 Try painting a custom maze to push your code further, or load the JSON maze files shared by your teacher.");
    }

    // 8. Partial: half-found but not all
    else if (foundVictims > 0 && foundVictims < totalVictims && !this._anyMatch(items, ['half'])) {
      // Only if no other notes are competing
      if (items.length < 3) {
        items.push(`Found ${foundVictims} of ${totalVictims} victims. Right-hand wall-following can miss victims tucked in interior pockets — see the API guide for extension strategies (left-hand fallback, visited-tile tracking).`);
      }
    }

    if (items.length === 0) return '';

    return `<div class="debrief">
      <div class="debrief-title">What happened</div>
      <ul class="debrief-list">${items.map(s => `<li>${s}</li>`).join('')}</ul>
    </div>`;
  }

  _anyMatch(items, keywords) {
    return items.some(item => keywords.some(k => item.includes(k)));
  }
}

// ---- Bootstrap ----
window.addEventListener('DOMContentLoaded', () => { new App(); });
