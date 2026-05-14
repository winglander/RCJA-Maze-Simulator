/* ============================================================
   Blockly custom blocks & JS generators for the Mighty Maisy
   rescue-maze robot API.
   ============================================================ */

// ---- Category colours (Blockly HSV hue values) ----
const HUE_MOTION   = 230;   // blue
const HUE_SENSOR   = 160;   // teal
const HUE_ACTION   = 20;    // orange-red
const HUE_TIMING   = 290;   // purple
const HUE_SETUP    = 45;    // amber

// ============================================================
// 1. BLOCK DEFINITIONS
// ============================================================

// ---- Motion blocks ----

Blockly.defineBlocksWithJsonArray([

  // --- Setup / Loop containers ---
  {
    type: 'event_setup',
    message0: 'when program starts %1 %2',
    args0: [
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'DO' }
    ],
    colour: HUE_SETUP,
    tooltip: 'Runs once when you press Run (like Arduino setup())',
    hat: 'cap'
  },
  {
    type: 'event_loop',
    message0: 'forever loop %1 %2',
    args0: [
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'DO' }
    ],
    colour: HUE_SETUP,
    tooltip: 'Runs ~50 times per second (like Arduino loop())',
    hat: 'cap'
  },

  // --- Motor blocks ---
  {
    type: 'motor_drive',
    message0: '%1 motor drive %2',
    args0: [
      { type: 'field_dropdown', name: 'SIDE', options: [['left', 'left'], ['right', 'right']] },
      { type: 'input_value', name: 'SPEED', check: 'Number' }
    ],
    previousStatement: null,
    nextStatement: null,
    colour: HUE_MOTION,
    tooltip: 'Set motor speed (-255 to 255). Positive = forward.'
  },
  {
    type: 'motor_drive_both',
    message0: 'drive both motors L %1 R %2',
    args0: [
      { type: 'input_value', name: 'LEFT', check: 'Number' },
      { type: 'input_value', name: 'RIGHT', check: 'Number' }
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE_MOTION,
    tooltip: 'Set both motors at once. Positive = forward.'
  },
  {
    type: 'motor_stop',
    message0: '%1 motor %2',
    args0: [
      { type: 'field_dropdown', name: 'SIDE', options: [['left', 'left'], ['right', 'right']] },
      { type: 'field_dropdown', name: 'ACTION', options: [['brake', 'brake'], ['standby', 'standby']] }
    ],
    previousStatement: null,
    nextStatement: null,
    colour: HUE_MOTION,
    tooltip: 'Brake or standby a motor.'
  },
  {
    type: 'motor_stop_both',
    message0: 'stop both motors',
    previousStatement: null,
    nextStatement: null,
    colour: HUE_MOTION,
    tooltip: 'Brake both motors (set speed to 0).'
  },

  // --- Sensor blocks ---
  {
    type: 'tof_read',
    message0: '%1 distance (mm)',
    args0: [
      { type: 'field_dropdown', name: 'DIR', options: [['front', 'front'], ['left', 'left'], ['right', 'right']] }
    ],
    output: 'Number',
    colour: HUE_SENSOR,
    tooltip: 'Read ToF distance sensor. Returns mm or -1 on dropout.'
  },
  {
    type: 'colour_read',
    message0: 'colour sensor %1',
    args0: [
      { type: 'field_dropdown', name: 'CHANNEL', options: [['red', 'r'], ['green', 'g'], ['blue', 'b'], ['clear', 'c']] }
    ],
    output: 'Number',
    colour: HUE_SENSOR,
    tooltip: 'Read one channel of the colour sensor (16-bit raw count).'
  },
  {
    type: 'colour_read_all',
    message0: 'colour sensor reading',
    output: null,
    colour: HUE_SENSOR,
    tooltip: 'Read all colour channels. Returns object with .r .g .b .c properties.'
  },
  {
    type: 'encoder_read',
    message0: '%1 encoder ticks',
    args0: [
      { type: 'field_dropdown', name: 'SIDE', options: [['left', 'left'], ['right', 'right']] }
    ],
    output: 'Number',
    colour: HUE_SENSOR,
    tooltip: 'Read encoder tick count (2000 ticks per revolution).'
  },
  {
    type: 'encoder_reset',
    message0: 'reset %1 encoder to %2',
    args0: [
      { type: 'field_dropdown', name: 'SIDE', options: [['left', 'left'], ['right', 'right']] },
      { type: 'input_value', name: 'VAL', check: 'Number' }
    ],
    previousStatement: null,
    nextStatement: null,
    colour: HUE_SENSOR,
    tooltip: 'Reset encoder tick count.'
  },
  {
    type: 'button_pressed',
    message0: 'button %1 pressed?',
    args0: [
      { type: 'field_dropdown', name: 'BTN', options: [['A', 'A'], ['B', 'B'], ['C', 'C']] }
    ],
    output: 'Boolean',
    colour: HUE_SENSOR,
    tooltip: 'Returns true once per press (edge-triggered).'
  },

  // --- Action blocks ---
  {
    type: 'indicate_victim',
    message0: 'indicate %1',
    args0: [
      { type: 'field_dropdown', name: 'KIND', options: [
        ['green victim (unharmed)', 'victim_unharmed'],
        ['red victim (harmed)', 'victim_harmed'],
        ['exit', 'exit']
      ]}
    ],
    previousStatement: null,
    nextStatement: null,
    colour: HUE_ACTION,
    tooltip: 'Signal a victim detection or exit to the scorer.'
  },
  {
    type: 'indicate_count',
    message0: 'report count of %1 as %2',
    args0: [
      { type: 'field_dropdown', name: 'KIND', options: [
        ['unharmed (green)', 'count_unharmed'],
        ['harmed (red)', 'count_harmed']
      ]},
      { type: 'input_value', name: 'COUNT', check: 'Number' }
    ],
    previousStatement: null,
    nextStatement: null,
    colour: HUE_ACTION,
    tooltip: 'Report victim count for bonus points. Must match valid indications.'
  },
  {
    type: 'serial_print',
    message0: 'print to serial %1 %2',
    args0: [
      { type: 'input_value', name: 'MSG' },
      { type: 'field_dropdown', name: 'NEWLINE', options: [['with newline', 'println'], ['no newline', 'print']] }
    ],
    previousStatement: null,
    nextStatement: null,
    colour: HUE_ACTION,
    tooltip: 'Print a message to the serial output console.'
  },

  // --- Timing blocks ---
  {
    type: 'delay_ms',
    message0: 'wait %1 milliseconds',
    args0: [
      { type: 'input_value', name: 'MS', check: 'Number' }
    ],
    previousStatement: null,
    nextStatement: null,
    colour: HUE_TIMING,
    tooltip: 'Pause execution for the given number of milliseconds.'
  },
  {
    type: 'millis_value',
    message0: 'time since start (ms)',
    output: 'Number',
    colour: HUE_TIMING,
    tooltip: 'Returns elapsed simulation time in milliseconds.'
  }
]);


// ============================================================
// 2. CODE GENERATORS
// ============================================================

const MaisyGenerator = new Blockly.Generator('MaisyJS');

// Inherit operator precedence from JavaScript generator
MaisyGenerator.ORDER_ATOMIC = 0;
MaisyGenerator.ORDER_MEMBER = 2;
MaisyGenerator.ORDER_FUNCTION_CALL = 2;
MaisyGenerator.ORDER_UNARY_NEGATION = 5;
MaisyGenerator.ORDER_MULTIPLICATION = 6;
MaisyGenerator.ORDER_ADDITION = 7;
MaisyGenerator.ORDER_RELATIONAL = 9;
MaisyGenerator.ORDER_EQUALITY = 10;
MaisyGenerator.ORDER_LOGICAL_NOT = 11;
MaisyGenerator.ORDER_LOGICAL_AND = 12;
MaisyGenerator.ORDER_LOGICAL_OR = 13;
MaisyGenerator.ORDER_CONDITIONAL = 14;
MaisyGenerator.ORDER_ASSIGNMENT = 15;
MaisyGenerator.ORDER_NONE = 99;

MaisyGenerator.INDENT = '  ';

MaisyGenerator.init = function(workspace) {
  const reserved = 'break,case,catch,continue,debugger,default,delete,do,else,finally,for,function,if,in,instanceof,new,return,switch,this,throw,try,typeof,var,void,while,with,class,const,enum,export,extends,import,super,implements,interface,let,package,private,protected,public,static,yield,setup,loop,leftMotor,rightMotor,frontToF,leftToF,rightToF,colourSensor,leftEncoder,rightEncoder,buttonA,buttonB,buttonC,indicate,Serial,millis,delay';
  if (!this.nameDB_) {
    this.nameDB_ = new Blockly.Names(reserved);
  } else {
    this.nameDB_.reset();
  }
  if (!this.variableDB_) {
    this.variableDB_ = new Blockly.Names(reserved);
  } else {
    this.variableDB_.reset();
  }
  this.variableDB_.setVariableMap(workspace.getVariableMap());
  this.definitions_ = Object.create(null);
  this.functionNames_ = Object.create(null);
  this._declaredVars = new Set();
};

MaisyGenerator.finish = function(code) {
  const defs = Object.values(this.definitions_).join('\n\n');
  // Hoist all variable declarations to the top level so they are shared
  // between setup() and loop(). Without this, `var x = ...` inside setup()
  // is function-scoped and invisible to loop() — a common student surprise.
  let varDecls = '';
  if (this._declaredVars && this._declaredVars.size > 0) {
    varDecls = 'var ' + [...this._declaredVars].join(', ') + ';\n\n';
  }
  this.nameDB_ = null;
  const allDefs = [varDecls, defs].filter(Boolean).join('\n');
  return allDefs ? allDefs + '\n' + code : code;
};

MaisyGenerator.scrubNakedValue = function(line) {
  return line + ';\n';
};

MaisyGenerator.scrub_ = function(block, code, thisOnly) {
  const nextBlock = block.nextConnection && block.nextConnection.targetBlock();
  if (nextBlock && !thisOnly) {
    return code + this.blockToCode(nextBlock);
  }
  return code;
};

// --- Setup / Loop ---
MaisyGenerator.forBlock = MaisyGenerator.forBlock || {};

MaisyGenerator.forBlock['event_setup'] = function(block, generator) {
  const body = generator.statementToCode(block, 'DO');
  return 'function setup() {\n' + body + '}\n';
};

MaisyGenerator.forBlock['event_loop'] = function(block, generator) {
  const body = generator.statementToCode(block, 'DO');
  return 'function loop() {\n' + body + '}\n';
};

// --- Motors ---
MaisyGenerator.forBlock['motor_drive'] = function(block, generator) {
  const side = block.getFieldValue('SIDE');
  const speed = generator.valueToCode(block, 'SPEED', generator.ORDER_NONE) || '0';
  return side + 'Motor.drive(' + speed + ');\n';
};

MaisyGenerator.forBlock['motor_drive_both'] = function(block, generator) {
  const left = generator.valueToCode(block, 'LEFT', generator.ORDER_NONE) || '0';
  const right = generator.valueToCode(block, 'RIGHT', generator.ORDER_NONE) || '0';
  return 'leftMotor.drive(' + left + ');\nrightMotor.drive(' + right + ');\n';
};

MaisyGenerator.forBlock['motor_stop'] = function(block) {
  const side = block.getFieldValue('SIDE');
  const action = block.getFieldValue('ACTION');
  return side + 'Motor.' + action + '();\n';
};

MaisyGenerator.forBlock['motor_stop_both'] = function() {
  return 'leftMotor.drive(0);\nrightMotor.drive(0);\n';
};

// --- Sensors ---
MaisyGenerator.forBlock['tof_read'] = function(block, generator) {
  const dir = block.getFieldValue('DIR');
  return [dir + 'ToF.read()', generator.ORDER_FUNCTION_CALL];
};

MaisyGenerator.forBlock['colour_read'] = function(block, generator) {
  const ch = block.getFieldValue('CHANNEL');
  return ['colourSensor.read().' + ch, generator.ORDER_MEMBER];
};

MaisyGenerator.forBlock['colour_read_all'] = function(block, generator) {
  return ['colourSensor.read()', generator.ORDER_FUNCTION_CALL];
};

MaisyGenerator.forBlock['encoder_read'] = function(block, generator) {
  const side = block.getFieldValue('SIDE');
  return [side + 'Encoder.read()', generator.ORDER_FUNCTION_CALL];
};

MaisyGenerator.forBlock['encoder_reset'] = function(block, generator) {
  const side = block.getFieldValue('SIDE');
  const val = generator.valueToCode(block, 'VAL', generator.ORDER_NONE) || '0';
  return side + 'Encoder.write(' + val + ');\n';
};

MaisyGenerator.forBlock['button_pressed'] = function(block, generator) {
  const btn = block.getFieldValue('BTN');
  return ['button' + btn + '.pressed()', generator.ORDER_FUNCTION_CALL];
};

// --- Actions ---
MaisyGenerator.forBlock['indicate_victim'] = function(block) {
  const kind = block.getFieldValue('KIND');
  return "indicate('" + kind + "');\n";
};

MaisyGenerator.forBlock['indicate_count'] = function(block, generator) {
  const kind = block.getFieldValue('KIND');
  const count = generator.valueToCode(block, 'COUNT', generator.ORDER_NONE) || '0';
  return "indicate('" + kind + "', " + count + ");\n";
};

MaisyGenerator.forBlock['serial_print'] = function(block, generator) {
  const msg = generator.valueToCode(block, 'MSG', generator.ORDER_NONE) || "''";
  const fn = block.getFieldValue('NEWLINE');
  return 'Serial.' + fn + '(' + msg + ');\n';
};

// --- Timing ---
MaisyGenerator.forBlock['delay_ms'] = function(block, generator) {
  const ms = generator.valueToCode(block, 'MS', generator.ORDER_NONE) || '0';
  return 'delay(' + ms + ');\n';
};

MaisyGenerator.forBlock['millis_value'] = function(block, generator) {
  return ['millis()', generator.ORDER_FUNCTION_CALL];
};

// ============================================================
// 3. BUILT-IN BLOCK GENERATORS (logic, loops, math, text, variables)
// ============================================================

// --- Logic ---
MaisyGenerator.forBlock['logic_boolean'] = function(block, generator) {
  return [block.getFieldValue('BOOL') === 'TRUE' ? 'true' : 'false', generator.ORDER_ATOMIC];
};

MaisyGenerator.forBlock['logic_negate'] = function(block, generator) {
  const arg = generator.valueToCode(block, 'BOOL', generator.ORDER_LOGICAL_NOT) || 'true';
  return ['!' + arg, generator.ORDER_LOGICAL_NOT];
};

MaisyGenerator.forBlock['logic_compare'] = function(block, generator) {
  const ops = { EQ: '===', NEQ: '!==', LT: '<', LTE: '<=', GT: '>', GTE: '>=' };
  const op = ops[block.getFieldValue('OP')];
  const order = (op === '===' || op === '!==') ? generator.ORDER_EQUALITY : generator.ORDER_RELATIONAL;
  const a = generator.valueToCode(block, 'A', order) || '0';
  const b = generator.valueToCode(block, 'B', order) || '0';
  return [a + ' ' + op + ' ' + b, order];
};

MaisyGenerator.forBlock['logic_operation'] = function(block, generator) {
  const op = block.getFieldValue('OP') === 'AND' ? '&&' : '||';
  const order = op === '&&' ? generator.ORDER_LOGICAL_AND : generator.ORDER_LOGICAL_OR;
  const a = generator.valueToCode(block, 'A', order) || 'false';
  const b = generator.valueToCode(block, 'B', order) || 'false';
  return [a + ' ' + op + ' ' + b, order];
};

MaisyGenerator.forBlock['logic_ternary'] = function(block, generator) {
  const cond = generator.valueToCode(block, 'IF', generator.ORDER_CONDITIONAL) || 'false';
  const then = generator.valueToCode(block, 'THEN', generator.ORDER_CONDITIONAL) || 'null';
  const els = generator.valueToCode(block, 'ELSE', generator.ORDER_CONDITIONAL) || 'null';
  return [cond + ' ? ' + then + ' : ' + els, generator.ORDER_CONDITIONAL];
};

MaisyGenerator.forBlock['logic_null'] = function(block, generator) {
  return ['null', generator.ORDER_ATOMIC];
};

// --- Controls / Loops ---
MaisyGenerator.forBlock['controls_if'] = function(block, generator) {
  let code = '';
  let n = 0;
  while (block.getInput('IF' + n)) {
    const cond = generator.valueToCode(block, 'IF' + n, generator.ORDER_NONE) || 'false';
    const branch = generator.statementToCode(block, 'DO' + n);
    code += (n === 0 ? 'if (' : ' else if (') + cond + ') {\n' + branch + '}';
    n++;
  }
  if (block.getInput('ELSE')) {
    const elseBranch = generator.statementToCode(block, 'ELSE');
    code += ' else {\n' + elseBranch + '}';
  }
  return code + '\n';
};

MaisyGenerator.forBlock['controls_repeat_ext'] = function(block, generator) {
  const times = generator.valueToCode(block, 'TIMES', generator.ORDER_NONE) || '0';
  const branch = generator.statementToCode(block, 'DO');
  const loopVar = generator.nameDB_ ?
    generator.nameDB_.getDistinctName('count', Blockly.Names.NameType.VARIABLE) : 'count';
  return 'for (var ' + loopVar + ' = 0; ' + loopVar + ' < ' + times + '; ' + loopVar + '++) {\n' + branch + '}\n';
};

MaisyGenerator.forBlock['controls_whileUntil'] = function(block, generator) {
  const until = block.getFieldValue('MODE') === 'UNTIL';
  let cond = generator.valueToCode(block, 'BOOL', generator.ORDER_NONE) || 'false';
  if (until) cond = '!' + cond;
  const branch = generator.statementToCode(block, 'DO');
  return 'while (' + cond + ') {\n' + branch + '}\n';
};

MaisyGenerator.forBlock['controls_for'] = function(block, generator) {
  const varName = generator.getVariableName ?
    generator.getVariableName(block.getFieldValue('VAR')) :
    (generator.variableDB_ ? generator.variableDB_.getName(block.getFieldValue('VAR'), Blockly.Names.NameType.VARIABLE) : 'i');
  const from = generator.valueToCode(block, 'FROM', generator.ORDER_NONE) || '0';
  const to = generator.valueToCode(block, 'TO', generator.ORDER_NONE) || '0';
  const by = generator.valueToCode(block, 'BY', generator.ORDER_NONE) || '1';
  return 'for (var ' + varName + ' = ' + from + '; ' + varName + ' <= ' + to + '; ' + varName + ' += ' + by + ') {\n' +
    generator.statementToCode(block, 'DO') + '}\n';
};

MaisyGenerator.forBlock['controls_flow_statements'] = function(block, generator) {
  const flow = block.getFieldValue('FLOW');
  return flow === 'BREAK' ? 'break;\n' : 'continue;\n';
};

// --- Math ---
MaisyGenerator.forBlock['math_number'] = function(block, generator) {
  const n = Number(block.getFieldValue('NUM'));
  const order = n < 0 ? generator.ORDER_UNARY_NEGATION : generator.ORDER_ATOMIC;
  return [String(n), order];
};

MaisyGenerator.forBlock['math_arithmetic'] = function(block, generator) {
  const ops = { ADD: [' + ', generator.ORDER_ADDITION], MINUS: [' - ', generator.ORDER_ADDITION],
                MULTIPLY: [' * ', generator.ORDER_MULTIPLICATION], DIVIDE: [' / ', generator.ORDER_MULTIPLICATION],
                POWER: [null, generator.ORDER_NONE] };
  const tuple = ops[block.getFieldValue('OP')];
  const a = generator.valueToCode(block, 'A', tuple[1]) || '0';
  const b = generator.valueToCode(block, 'B', tuple[1]) || '0';
  if (block.getFieldValue('OP') === 'POWER') {
    return ['Math.pow(' + a + ', ' + b + ')', generator.ORDER_FUNCTION_CALL];
  }
  return [a + tuple[0] + b, tuple[1]];
};

MaisyGenerator.forBlock['math_single'] = function(block, generator) {
  const op = block.getFieldValue('OP');
  const arg = generator.valueToCode(block, 'NUM', generator.ORDER_NONE) || '0';
  const map = { ROOT: 'Math.sqrt', ABS: 'Math.abs', NEG: '-', LN: 'Math.log', LOG10: 'Math.log10',
                EXP: 'Math.exp', POW10: 'Math.pow(10, ' };
  if (op === 'NEG') return ['-' + arg, generator.ORDER_UNARY_NEGATION];
  if (op === 'POW10') return ['Math.pow(10, ' + arg + ')', generator.ORDER_FUNCTION_CALL];
  return [map[op] + '(' + arg + ')', generator.ORDER_FUNCTION_CALL];
};

MaisyGenerator.forBlock['math_trig'] = function(block, generator) {
  const op = block.getFieldValue('OP');
  const arg = generator.valueToCode(block, 'NUM', generator.ORDER_NONE) || '0';
  const fns = { SIN: 'Math.sin', COS: 'Math.cos', TAN: 'Math.tan',
                ASIN: 'Math.asin', ACOS: 'Math.acos', ATAN: 'Math.atan' };
  return [fns[op] + '(' + arg + ' / 180 * Math.PI)', generator.ORDER_FUNCTION_CALL];
};

MaisyGenerator.forBlock['math_constant'] = function(block, generator) {
  const map = { PI: 'Math.PI', E: 'Math.E', GOLDEN_RATIO: '(1 + Math.sqrt(5)) / 2',
                SQRT2: 'Math.SQRT2', SQRT1_2: 'Math.SQRT1_2', INFINITY: 'Infinity' };
  return [map[block.getFieldValue('CONSTANT')] || '0', generator.ORDER_ATOMIC];
};

MaisyGenerator.forBlock['math_number_property'] = function(block, generator) {
  const prop = block.getFieldValue('PROPERTY');
  const num = generator.valueToCode(block, 'NUMBER_TO_CHECK', generator.ORDER_NONE) || '0';
  const map = { EVEN: num + ' % 2 === 0', ODD: num + ' % 2 === 1',
                PRIME: 'false', WHOLE: num + ' % 1 === 0',
                POSITIVE: num + ' > 0', NEGATIVE: num + ' < 0',
                DIVISIBLE_BY: num + ' % ' + (generator.valueToCode(block, 'DIVISOR', generator.ORDER_NONE) || '1') + ' === 0' };
  return [map[prop] || 'false', generator.ORDER_EQUALITY];
};

MaisyGenerator.forBlock['math_round'] = function(block, generator) {
  const op = block.getFieldValue('OP');
  const arg = generator.valueToCode(block, 'NUM', generator.ORDER_NONE) || '0';
  const fn = { ROUND: 'Math.round', ROUNDUP: 'Math.ceil', ROUNDDOWN: 'Math.floor' }[op];
  return [fn + '(' + arg + ')', generator.ORDER_FUNCTION_CALL];
};

MaisyGenerator.forBlock['math_modulo'] = function(block, generator) {
  const a = generator.valueToCode(block, 'DIVIDEND', generator.ORDER_MULTIPLICATION) || '0';
  const b = generator.valueToCode(block, 'DIVISOR', generator.ORDER_MULTIPLICATION) || '1';
  return [a + ' % ' + b, generator.ORDER_MULTIPLICATION];
};

MaisyGenerator.forBlock['math_constrain'] = function(block, generator) {
  const val = generator.valueToCode(block, 'VALUE', generator.ORDER_NONE) || '0';
  const low = generator.valueToCode(block, 'LOW', generator.ORDER_NONE) || '0';
  const high = generator.valueToCode(block, 'HIGH', generator.ORDER_NONE) || '255';
  return ['Math.min(Math.max(' + val + ', ' + low + '), ' + high + ')', generator.ORDER_FUNCTION_CALL];
};

MaisyGenerator.forBlock['math_random_int'] = function(block, generator) {
  const a = generator.valueToCode(block, 'FROM', generator.ORDER_NONE) || '0';
  const b = generator.valueToCode(block, 'TO', generator.ORDER_NONE) || '100';
  return ['Math.floor(Math.random() * (' + b + ' - ' + a + ' + 1) + ' + a + ')', generator.ORDER_FUNCTION_CALL];
};

MaisyGenerator.forBlock['math_random_float'] = function(block, generator) {
  return ['Math.random()', generator.ORDER_FUNCTION_CALL];
};

MaisyGenerator.forBlock['math_atan2'] = function(block, generator) {
  const x = generator.valueToCode(block, 'X', generator.ORDER_NONE) || '0';
  const y = generator.valueToCode(block, 'Y', generator.ORDER_NONE) || '0';
  return ['Math.atan2(' + y + ', ' + x + ') / Math.PI * 180', generator.ORDER_MULTIPLICATION];
};

// --- Text ---
MaisyGenerator.forBlock['text'] = function(block, generator) {
  const text = block.getFieldValue('TEXT').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  return ["'" + text + "'", generator.ORDER_ATOMIC];
};

MaisyGenerator.forBlock['text_join'] = function(block, generator) {
  if (block.itemCount_ === 0) return ["''", generator.ORDER_ATOMIC];
  if (block.itemCount_ === 1) {
    const val = generator.valueToCode(block, 'ADD0', generator.ORDER_NONE) || "''";
    return ['String(' + val + ')', generator.ORDER_FUNCTION_CALL];
  }
  const parts = [];
  for (let i = 0; i < block.itemCount_; i++) {
    parts.push(generator.valueToCode(block, 'ADD' + i, generator.ORDER_NONE) || "''");
  }
  return [parts.join(" + ' ' + "), generator.ORDER_ADDITION];
};

MaisyGenerator.forBlock['text_length'] = function(block, generator) {
  const val = generator.valueToCode(block, 'VALUE', generator.ORDER_MEMBER) || "''";
  return [val + '.length', generator.ORDER_MEMBER];
};

MaisyGenerator.forBlock['text_isEmpty'] = function(block, generator) {
  const val = generator.valueToCode(block, 'VALUE', generator.ORDER_MEMBER) || "''";
  return ['!' + val + '.length', generator.ORDER_LOGICAL_NOT];
};

// --- Variables ---
MaisyGenerator.forBlock['variables_get'] = function(block, generator) {
  const varName = generator.variableDB_ ?
    generator.variableDB_.getName(block.getFieldValue('VAR'), Blockly.Names.NameType.VARIABLE) :
    block.getFieldValue('VAR');
  return [varName, generator.ORDER_ATOMIC];
};

MaisyGenerator.forBlock['variables_set'] = function(block, generator) {
  const varName = generator.variableDB_ ?
    generator.variableDB_.getName(block.getFieldValue('VAR'), Blockly.Names.NameType.VARIABLE) :
    block.getFieldValue('VAR');
  const val = generator.valueToCode(block, 'VALUE', generator.ORDER_NONE) || '0';
  if (!generator._declaredVars) generator._declaredVars = new Set();
  generator._declaredVars.add(varName);
  // No 'var' keyword here — declarations are hoisted to top level by finish()
  return varName + ' = ' + val + ';\n';
};

MaisyGenerator.forBlock['math_change'] = function(block, generator) {
  const varName = generator.variableDB_ ?
    generator.variableDB_.getName(block.getFieldValue('VAR'), Blockly.Names.NameType.VARIABLE) :
    block.getFieldValue('VAR');
  const delta = generator.valueToCode(block, 'DELTA', generator.ORDER_NONE) || '0';
  if (!generator._declaredVars) generator._declaredVars = new Set();
  generator._declaredVars.add(varName);
  // No inline 'var' — declarations are hoisted to top level by finish()
  return varName + ' += ' + delta + ';\n';
};

// --- Lists (basic) ---
MaisyGenerator.forBlock['lists_create_with'] = function(block, generator) {
  const items = [];
  for (let i = 0; i < block.itemCount_; i++) {
    items.push(generator.valueToCode(block, 'ADD' + i, generator.ORDER_NONE) || 'null');
  }
  return ['[' + items.join(', ') + ']', generator.ORDER_ATOMIC];
};

MaisyGenerator.forBlock['lists_length'] = function(block, generator) {
  const list = generator.valueToCode(block, 'VALUE', generator.ORDER_MEMBER) || '[]';
  return [list + '.length', generator.ORDER_MEMBER];
};

MaisyGenerator.forBlock['lists_indexOf'] = function(block, generator) {
  const list = generator.valueToCode(block, 'VALUE', generator.ORDER_MEMBER) || '[]';
  const item = generator.valueToCode(block, 'FIND', generator.ORDER_NONE) || "''";
  const end = block.getFieldValue('END') === 'FIRST' ? 'indexOf' : 'lastIndexOf';
  return [list + '.' + end + '(' + item + ')', generator.ORDER_FUNCTION_CALL];
};

// --- Procedures (functions) ---
MaisyGenerator.forBlock['procedures_defnoreturn'] = function(block, generator) {
  const name = generator.variableDB_ ?
    generator.variableDB_.getName(block.getFieldValue('NAME'), Blockly.Names.NameType.PROCEDURE) :
    block.getFieldValue('NAME');
  const body = generator.statementToCode(block, 'STACK');
  const args = [];
  const variables = block.getVars ? block.getVars() : [];
  for (const v of variables) {
    args.push(generator.variableDB_ ?
      generator.variableDB_.getName(v, Blockly.Names.NameType.VARIABLE) : v);
  }
  return 'function ' + name + '(' + args.join(', ') + ') {\n' + body + '}\n\n';
};

MaisyGenerator.forBlock['procedures_defreturn'] = function(block, generator) {
  const name = generator.variableDB_ ?
    generator.variableDB_.getName(block.getFieldValue('NAME'), Blockly.Names.NameType.PROCEDURE) :
    block.getFieldValue('NAME');
  const body = generator.statementToCode(block, 'STACK');
  const ret = generator.valueToCode(block, 'RETURN', generator.ORDER_NONE) || 'null';
  const args = [];
  const variables = block.getVars ? block.getVars() : [];
  for (const v of variables) {
    args.push(generator.variableDB_ ?
      generator.variableDB_.getName(v, Blockly.Names.NameType.VARIABLE) : v);
  }
  return 'function ' + name + '(' + args.join(', ') + ') {\n' + body + '  return ' + ret + ';\n}\n\n';
};

MaisyGenerator.forBlock['procedures_callnoreturn'] = function(block, generator) {
  const name = generator.variableDB_ ?
    generator.variableDB_.getName(block.getFieldValue('NAME'), Blockly.Names.NameType.PROCEDURE) :
    block.getFieldValue('NAME');
  const args = [];
  const variables = block.getVars ? block.getVars() : [];
  for (const v of variables) {
    args.push(generator.valueToCode(block, 'ARG' + variables.indexOf(v), generator.ORDER_NONE) || 'null');
  }
  return name + '(' + args.join(', ') + ');\n';
};

MaisyGenerator.forBlock['procedures_callreturn'] = function(block, generator) {
  const name = generator.variableDB_ ?
    generator.variableDB_.getName(block.getFieldValue('NAME'), Blockly.Names.NameType.PROCEDURE) :
    block.getFieldValue('NAME');
  const args = [];
  const variables = block.getVars ? block.getVars() : [];
  for (const v of variables) {
    args.push(generator.valueToCode(block, 'ARG' + variables.indexOf(v), generator.ORDER_NONE) || 'null');
  }
  return [name + '(' + args.join(', ') + ')', generator.ORDER_FUNCTION_CALL];
};

MaisyGenerator.forBlock['procedures_ifreturn'] = function(block, generator) {
  const cond = generator.valueToCode(block, 'CONDITION', generator.ORDER_NONE) || 'false';
  let code = 'if (' + cond + ') {\n';
  if (block.hasReturnValue_) {
    const val = generator.valueToCode(block, 'VALUE', generator.ORDER_NONE) || 'null';
    code += generator.INDENT + 'return ' + val + ';\n';
  } else {
    code += generator.INDENT + 'return;\n';
  }
  return code + '}\n';
};


// ============================================================
// 4. TOOLBOX DEFINITION
// ============================================================

const MAISY_TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Setup',
      colour: HUE_SETUP,
      contents: [
        { kind: 'block', type: 'event_setup' },
        { kind: 'block', type: 'event_loop' }
      ]
    },
    {
      kind: 'category',
      name: 'Motion',
      colour: HUE_MOTION,
      contents: [
        { kind: 'block', type: 'motor_drive', inputs: { SPEED: { shadow: { type: 'math_number', fields: { NUM: 150 } } } } },
        { kind: 'block', type: 'motor_drive_both',
          inputs: {
            LEFT: { shadow: { type: 'math_number', fields: { NUM: 150 } } },
            RIGHT: { shadow: { type: 'math_number', fields: { NUM: 150 } } }
          }
        },
        { kind: 'block', type: 'motor_stop' },
        { kind: 'block', type: 'motor_stop_both' }
      ]
    },
    {
      kind: 'category',
      name: 'Sensors',
      colour: HUE_SENSOR,
      contents: [
        { kind: 'block', type: 'tof_read' },
        { kind: 'block', type: 'colour_read' },
        { kind: 'block', type: 'colour_read_all' },
        { kind: 'block', type: 'encoder_read' },
        { kind: 'block', type: 'encoder_reset', inputs: { VAL: { shadow: { type: 'math_number', fields: { NUM: 0 } } } } },
        { kind: 'block', type: 'button_pressed' }
      ]
    },
    {
      kind: 'category',
      name: 'Actions',
      colour: HUE_ACTION,
      contents: [
        { kind: 'block', type: 'indicate_victim' },
        { kind: 'block', type: 'indicate_count', inputs: { COUNT: { shadow: { type: 'math_number', fields: { NUM: 0 } } } } },
        { kind: 'block', type: 'serial_print', inputs: { MSG: { shadow: { type: 'text', fields: { TEXT: 'hello' } } } } }
      ]
    },
    {
      kind: 'category',
      name: 'Timing',
      colour: HUE_TIMING,
      contents: [
        { kind: 'block', type: 'delay_ms', inputs: { MS: { shadow: { type: 'math_number', fields: { NUM: 1000 } } } } },
        { kind: 'block', type: 'millis_value' }
      ]
    },
    { kind: 'sep' },
    {
      kind: 'category',
      name: 'Logic',
      colour: '%{BKY_LOGIC_HUE}',
      contents: [
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'controls_if', extraState: { hasElse: true } },
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
        { kind: 'block', type: 'logic_ternary' }
      ]
    },
    {
      kind: 'category',
      name: 'Loops',
      colour: '%{BKY_LOOPS_HUE}',
      contents: [
        { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } },
        { kind: 'block', type: 'controls_whileUntil' },
        { kind: 'block', type: 'controls_for' },
        { kind: 'block', type: 'controls_flow_statements' }
      ]
    },
    {
      kind: 'category',
      name: 'Math',
      colour: '%{BKY_MATH_HUE}',
      contents: [
        { kind: 'block', type: 'math_number', fields: { NUM: 0 } },
        { kind: 'block', type: 'math_arithmetic' },
        { kind: 'block', type: 'math_single' },
        { kind: 'block', type: 'math_trig' },
        { kind: 'block', type: 'math_constant' },
        { kind: 'block', type: 'math_round' },
        { kind: 'block', type: 'math_modulo' },
        { kind: 'block', type: 'math_constrain', inputs: {
          LOW: { shadow: { type: 'math_number', fields: { NUM: -255 } } },
          HIGH: { shadow: { type: 'math_number', fields: { NUM: 255 } } }
        }},
        { kind: 'block', type: 'math_random_int' },
        { kind: 'block', type: 'math_random_float' }
      ]
    },
    {
      kind: 'category',
      name: 'Text',
      colour: '%{BKY_TEXTS_HUE}',
      contents: [
        { kind: 'block', type: 'text' },
        { kind: 'block', type: 'text_join' },
        { kind: 'block', type: 'text_length' },
        { kind: 'block', type: 'text_isEmpty' }
      ]
    },
    {
      kind: 'category',
      name: 'Variables',
      colour: '%{BKY_VARIABLES_HUE}',
      custom: 'VARIABLE'
    },
    {
      kind: 'category',
      name: 'Functions',
      colour: '%{BKY_PROCEDURES_HUE}',
      custom: 'PROCEDURE'
    }
  ]
};


// ============================================================
// 5. STARTER BLOCKS (default workspace for new users)
// ============================================================

const STARTER_BLOCKS_XML = `
<xml xmlns="https://developers.google.com/blockly/xml">
  <block type="event_setup" x="20" y="20">
    <statement name="DO">
      <block type="serial_print">
        <value name="MSG">
          <shadow type="text"><field name="TEXT">Robot starting</field></shadow>
        </value>
        <next>
          <block type="encoder_reset">
            <value name="VAL"><shadow type="math_number"><field name="NUM">0</field></shadow></value>
            <next>
              <block type="encoder_reset">
                <field name="SIDE">right</field>
                <value name="VAL"><shadow type="math_number"><field name="NUM">0</field></shadow></value>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
  </block>
  <block type="event_loop" x="20" y="240">
    <statement name="DO">
      <block type="motor_drive_both">
        <value name="LEFT"><shadow type="math_number"><field name="NUM">150</field></shadow></value>
        <value name="RIGHT"><shadow type="math_number"><field name="NUM">150</field></shadow></value>
      </block>
    </statement>
  </block>
</xml>
`;
