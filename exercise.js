var Grammar = require('./').Grammar;
var Rule = require('./').Rule;
var Ref = require('./').Ref;
var Terminal = require('./').Terminal;

var debug = require('./debug');

var grammar = Grammar([
  Rule('start', [Terminal('a')]),
  Rule('start', [Terminal('a'), Terminal('a'), Ref('next')]),
  Rule('next', [Terminal('a'), Terminal('a'), Ref('start')])
]);

debug.parse(grammar, 'aaaaaaaaa');
