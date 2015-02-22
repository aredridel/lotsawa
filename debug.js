var chalk = require('chalk');
var bitmv = require('bitmv');

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

module.exports = {
    dump_rule: dump_rule,
    dump_dotted_rule: dump_dotted_rule,
    dump_table: dump_table
};
