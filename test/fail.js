var Grammar = require('../').Grammar;
var Rule = require('../').Rule;
var Ref = require('../').Ref;
var parse = require('../').parse;
var Terminal = require('../').Terminal;
var test = require('tape');

var grammar = Grammar([
    Rule('start', [ Terminal('a') ])
]);

test('parses', function (t) {
    t.notOk(parse(grammar, 'b'));
    t.notOk(parse(grammar, 'aa'));
    t.end();
});
