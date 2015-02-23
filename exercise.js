var Grammar = require('./').Grammar;
var Rule = require('./').Rule;
var Ref = require('./').Ref;
var Terminal = require('./').Terminal;

var debug = require('./debug');

var grammar = Grammar([
  Rule('start', [ Terminal('b') ]),
  Rule('start', [ Terminal('a'), Ref('start') ])
]);

console.log(debug.dump_grammar(grammar));

debug.parse(grammar, 'aab');
