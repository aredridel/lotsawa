var Grammar = require('../').Grammar;
var Rule = require('../').Rule;
var parse = require('../').parse;
var Terminal = require('../').Terminal;
var test = require('tape');

var grammar = Grammar([
    Rule('start', [ Terminal('a') ]),
    Rule('start', [ ])
]);

test('parses', function (t) {
    t.ok(parse(grammar, 'a'));
    t.ok(parse(grammar, ''));
    t.end();
});
