var Grammar = require('./').Grammar;
var Rule = require('./').Rule;
var Ref = require('./').Ref;
var parse = require('./').parse;
var Terminal = require('./').Terminal;
var bitmv = require('bitmv');

var debug = require('./debug');

var grammar = Grammar([
  Rule('start', []),
  Rule('start', [Terminal('a'), Ref('start')])
]);

console.log('rules');
grammar.forEach(function(e, i) {
  console.log(i + ' ' + debug.dump_rule(e));
});

console.log('symbols');
console.log(bitmv.dump(grammar.sympred));

console.log('predictions_for_symbols');
console.log(grammar.predictions_for_symbols.map(bitmv.dumpv).map(function(e, i) {
  return e + ' ' + grammar.symbols[i];
}).join('\n'));

var success = parse(grammar, 'aa', function(table, i) {
  if (typeof table == 'string') {
    console.log(table);
  } else {
    console.log(debug.dump_table(grammar, table[i]));
  }
});

console.log('parse', success ? 'succeeded' : 'failed');
