// Boots the real HTML in a jsdom environment, runs the JS, and verifies
// that DOM updates happen as expected for pose, sensors, and live score.

const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync('./sandbox.html', 'utf8');
const css = fs.readFileSync('./sandbox.css', 'utf8');
const js = fs.readFileSync('./sandbox.js', 'utf8');

// Strip external <link> + <script src=...> tags — we'll inline our own
const stripped = html
  .replace(/<link[^>]+href="sandbox\.css"[^>]*>/, '')
  .replace(/<script src="sandbox\.js"><\/script>/, '');

const dom = new JSDOM(stripped, {
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const { window } = dom;
const { document } = window;

// Stub fonts request and SVGSVGElement.createSVGPoint (jsdom doesn't have it)
window.SVGSVGElement.prototype.createSVGPoint = function() {
  return { x: 0, y: 0,
           matrixTransform: function(m) { return { x: this.x, y: this.y }; } };
};
window.SVGSVGElement.prototype.getScreenCTM = function() { return null; };

// Inject CSS and JS as scripts to evaluate
const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

window.eval(js);

// Manually fire DOMContentLoaded since the script registered a listener
window.dispatchEvent(new window.Event('DOMContentLoaded'));

// Now interrogate the DOM
let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✗ ${label}${detail ? '  → ' + detail : ''}`); fail++; }
}

console.log('\n[A] DOM bootstrap');
{
  ok('SVG element rendered', document.getElementById('mazeSvg') != null);
  ok('SVG has children (rendered maze)', document.getElementById('mazeSvg').children.length > 0);
  ok('code editor populated with starter', document.getElementById('codeEditor').value.includes('function setup'));
  ok('IDLE pill shown in status', document.getElementById('statusStrip').textContent.includes('IDLE'));
  ok('pose readout populated with starting position (not dashes)',
     document.getElementById('poseX').textContent === '145' &&
     document.getElementById('poseY').textContent === '1595',
     `got x=${document.getElementById('poseX').textContent}, y=${document.getElementById('poseY').textContent}`);
  ok('score green starts at 0/0', document.getElementById('scoreGreen').textContent === '0' && document.getElementById('scoreGreenTotal').textContent === '0');
  ok('total score 0 initially', document.getElementById('scoreTotal').textContent === '0');
  ok('sensor panel shows empty placeholder', document.querySelector('.sensor-empty') != null);
}

console.log('\n[B] Adding victims updates score totals');
{
  // Find the App instance — it was constructed in the bootstrap.
  // We can't access it directly, but we can simulate clicks.
  // Click the "Red victim" tool button, then click a tile.
  const redBtn = document.querySelector('[data-tool="red"]');
  redBtn.click();
  ok('red tool now active', redBtn.classList.contains('active'));

  // Simulate a click on the SVG by directly invoking the world via the click handler.
  // Easier: dispatch a synthetic click event with offsetX/Y.
  // jsdom doesn't compute SVG coordinate transforms, so we have to monkey-patch
  // the renderer's clientToWorld for this test.
  // Better: directly invoke the click handler with computed mm coords by
  // reaching through the global scope where the App instance lives.

  // Workaround: extract the App from the window. The bootstrap doesn't expose it,
  // so we can't easily. Just dispatch a click on the SVG and trust our stub
  // returns {x:0, y:0} → tile (0,0).
  const svg = document.getElementById('mazeSvg');
  // First, fix the renderer's clientToWorld via SVGSVGElement.getScreenCTM stub
  // returning a usable matrix. For test purposes, attach a getScreenCTM that
  // identifies (clientX,clientY) → (clientX,clientY) in mm.
  window.SVGSVGElement.prototype.getScreenCTM = function() {
    return { inverse: () => ({ a:1,b:0,c:0,d:1,e:0,f:0 }) };
  };
  // Override createSVGPoint so matrixTransform applies the identity
  window.SVGSVGElement.prototype.createSVGPoint = function() {
    const p = { x: 0, y: 0 };
    p.matrixTransform = function(m) { return { x: this.x + m.e, y: this.y + m.f }; };
    return p;
  };

  // Click at SVG coords corresponding to tile (2,2) centre = (725, 725) in mm
  const ev = new window.MouseEvent('click', { bubbles: true, clientX: 725, clientY: 725 });
  svg.dispatchEvent(ev);

  ok('after click, scoreRedTotal increments to 1', document.getElementById('scoreRedTotal').textContent === '1',
     `got "${document.getElementById('scoreRedTotal').textContent}"`);
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
