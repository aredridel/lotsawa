var Grammar = require('../').Grammar;
var Rule = require('../').Rule;
var Ref = require('../').Ref;
var parse = require('../').parse;
var Terminal = require('../').Terminal;
var test = require('tap').test;

var grammar = Grammar([
    Rule('start', [ Ref('A') ]),
    Rule('A', [ Terminal('a'), Ref('B') ]),
    Rule('A', [ Terminal('a') ]),
    Rule('B', [ Terminal('a'), Ref('A') ]),
    Rule('B', [ Terminal('a') ])
]);

test('parses', function (t) {
    t.ok(parse(grammar, 'aaaaaaaaaaaaaaaaa'));
    t.end();
});
