var Grammar = require('./').Grammar;
var Rule = require('./').Rule;
var Ref = require('./').Ref;
var parse = require('./').parse;
var Terminal = require('./').Terminal;

var grammar = Grammar([
    Rule('start', [ Ref('value') ]),
    Rule('value', [ Ref('object') ]),
    Rule('value', [ Ref('array') ]),
    Rule('value', [ Ref('string') ]),
    Rule('value', [ Ref('number') ]),
    Rule('value', [ Ref('boolean') ]),
    Rule('object', [ Terminal('{'), Ref('pairs'), Terminal('}') ]),
    Rule('pairs', [ Ref('string'), Terminal(':'), Ref('value') ]),
    Rule('string', [ Terminal('"'), Terminal('a'), Terminal('"') ])
]);

parse(grammar, '{"a":"a"}');
