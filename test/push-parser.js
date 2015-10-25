var Grammar = require('../').Grammar;
var Rule = require('../').Rule;
var Ref = require('../').Ref;
var Parser = require('../').Parser;
var Terminal = require('../').Terminal;
var test = require('tap').test;

var grammar = Grammar([
  Rule('start', [Ref('A')]),
  Rule('A', [Ref('A'), Terminal('a')]),
  Rule('A', [Terminal('a')])
]);

test('parses using externally driven parser', function(t) {
  var p = Parser(grammar);
  var str = 'aaaaaaaaaaa';
  for (var i = 0; i < str.length; i++) {
    p.push(str[i]);
  }
  t.ok(p.success());
  t.end();
});
