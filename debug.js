var chalk = require('chalk');
var bitmv = require('bitmv');
var parse = require('./').parse;

function dump_rule(rule) {
  return chalk.white('{') + chalk.yellow(rule.name) + chalk.white(' → ') + chalk.cyan(rule.symbols.map(display).join(' ')) + chalk.white('}');

  function display(e) {
    return e.name;
  }
}

function dump_dotted_rule(grammar, ent) {
  var rule = grammar[ent.ruleNo];
  return ent.kind + ' ' + chalk.grey('@') + ' ' + chalk.yellow(ent.origin) + chalk.white(' {') + chalk.yellow(rule.name) + chalk.white(' → ') + chalk.cyan(rule.symbols.slice(0, ent.pos).map(display).join(' ')) + chalk.red('•') + chalk.cyan(rule.symbols.slice(ent.pos).map(display).join(' ')) + chalk.white('}');

  function display(e) {
    return grammar.symbols[e];
  }
}

function dump_table(grammar, table) {
  return '  predict ' + JSON.stringify(bitmv.dumpvn(table.predictions)) + "\n" + table.completions.map(function(e) {
      return '  ' + e.ruleNo + ': ' + dump_dotted_rule(grammar, e);
    }).join('\n');
}

function dump_grammar(grammar) {
  var out = '';
  log('rules');
  grammar.forEach(function(e, i) {
    log(i + ' ' + dump_rule(e));
  });

  log('symbols');
  log(bitmv.dump(grammar.sympred));

  log('predictions_for_symbols');
  log(grammar.predictions_for_symbols.map(bitmv.dumpv).map(function(e, i) {
    return e + ' ' + grammar.symbols[i];
  }).join('\n'));

  return out;
  function log(ln) {
    out += ln + "\n";
  }
}

function debug_parse(grammar, input) {
  console.log(dump_grammar(grammar));

  return parse(grammar, input, function(table, i) {
    if (typeof table == 'string') {
      console.log.apply(console, arguments);
    } else {
      console.log(dump_table(grammar, table[i]));
    }
  });
}

module.exports = {
  dump_rule: dump_rule,
  dump_dotted_rule: dump_dotted_rule,
  dump_table: dump_table,
  dump_grammar: dump_grammar,
  parse: debug_parse
};
