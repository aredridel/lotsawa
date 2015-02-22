var Grammar = require('../').Grammar;
var Rule = require('../').Rule;
var Ref = require('../').Ref;
var parse = require('../').parse;
var Terminal = require('../').Terminal;
var test = require('tape');

var grammar = Grammar([
    Rule('start', [ Ref('A') ]),
    Rule('A', [ Ref('A'), Terminal('a') ]),
    Rule('A', [ Terminal('a') ])
]);

test('parses', function (t) {
    t.ok(parse(grammar, 'aaaaaaaaaaa'));
    t.end();
});
