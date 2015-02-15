"use strict";

var bitmv = require('bitmv');
var bv_or_assign = bitmv.bv_or_assign;
var bv_bit_set = bitmv.bv_bit_set;
var bv_bit_test = bitmv.bv_bit_test;

function Grammar(rules) {
  rules.push(Rule('_start', [Ref('start')]));

  rules.symbols = censusSymbols();
  rules.sympred = generateSymbolMatrix();

  function censusSymbols() {
    var out = [];
    rules.forEach(function(r) {
      if (!~out.indexOf(r.name)) {
        out.push(r.name);
      }
      r.symbols.forEach(function(s, i) {
        var symNo = out.indexOf(s.name);
        if (!~out.indexOf(s.name)) {
          symNo = out.length;
          out.push(s.name);
        }

        r.symbols[i] = symNo;
      });

      r.sym = out.indexOf(r.name);
    });

    return out;
  }

  function generateSymbolMatrix() {
    var predictable = bitmv.matrix(rules.symbols.length, rules.symbols.length);

    // Build a matrix of what symbols predict what other symbols, so we can just jump straight to the
    // answer rather than having to do these loops at each pass. Bitsets are fun.
    rules.symbols.forEach(function(name, sym) {
      rules.forEach(function(r, j) {
        if (r.symbols[0] != null && r.symbols[0] == sym) {
          bv_bit_set(predictable[sym], r.sym);
        }
      });
      bv_bit_set(predictable[sym], sym);
    });
    bitmv.transitiveClosure(predictable);

    console.log('symbols');
    console.log(bitmv.dump(predictable));
    console.log(rules.symbols);

    return predictable;
  }

  function generatePredictionMatrix() {
    var predictable = bitmv.matrix(rules.symbols.length, rules.length);
    rules.forEach(function(r, j) {
      rules.forEach(function(s, k) {
        if (r.symbols[0] != null && r.symbols[0] == s.sym) {
          bv_bit_set(predictable[r.sym], k);
        }
      });

      bv_bit_set(predictable[r.sym], j);
    });

    bitmv.transitiveClosure(predictable);

    return predictable;
  }

  rules.predictions_for_symbols = generatePredictionMatrix();

  console.log('predictions_for_symbols');
  console.log(bitmv.dump(rules.predictions_for_symbols));

  return rules;
}

function Rule(name, syms) {
  return {
    name: name,
    symbols: syms
  };
}

function Ref(name) {
  return {
    name: name
  };
}

function Terminal(symbol) {
  return {
    name: symbol,
    terminal: symbol
  };
}

function parse(grammar, toParse) {
  var table = new Array(toParse.length);

  for (var i = 0; i < toParse.length; i++) {
    console.log('set', i, toParse[i], 'sym', symbolOf(toParse[i]));
    table[i] = {
      predictions: predict(i),
      completions: []
    };

    scan(i);

    advance(i);

    complete(i);

    console.log(dump_table(grammar, table[i]));

  }

  return success(table[table.length -1]);

  function success(table) {
      var matches = 0;
    for (var i = 0; i < table.completions.length; i++) {
        var dr = table.completions[i];
        if (dr.origin === 0 && dr.ruleNo == grammar.length - 1 && dr.pos == grammar[grammar.length - 1].symbols.length) matches++;
    }

    if (matches === 0) {
        console.log('parse failed');
    } else if (matches == 1) {
        console.log('parse succeeded');
        return true;
    } else {
        console.log('parse was ambiguous');
    }
    return false;
  }

  function justcompletions(e) {
    return e.completions;
  }

  function predict(i) {
    var predictions = bitmv.vector(grammar.length);
    var prev = table[i - 1];
    if (!prev) {
      //console.log('predicting start rule', grammar.symbols.indexOf('_start'), bitmv.dumpv(grammar.predictions_for_symbols[grammar.symbols.indexOf('_start')]));
      bv_or_assign(predictions, grammar.predictions_for_symbols[grammar.symbols.indexOf('_start')]);
    //console.log(bitmv.dumpv(predictions));
    } else {
      for (var j = 0; j < prev.completions.length; j++) {
        var drule = prev.completions[j];
        var pos = drule.pos;
        var rule = grammar[drule.ruleNo];
        var sym = rule.symbols[pos];
        if (rule.symbols.length > pos) {
          //console.log('predicting', drule.ruleNo, 'at pos', pos, rule, sym);
          bv_or_assign(predictions, grammar.predictions_for_symbols[rule.symbols[pos - 1]]);
        }
      }
    }

    return predictions;
  }

  function scan(i) {
    var sym = symbolOf(toParse[i]);
    if (!~sym) return;
    bv_scan(table[i].predictions, function(ruleNo) {
      if (bv_bit_test(grammar.sympred[sym], grammar[ruleNo].symbols[0])) {
        table[i].completions.push({
          ruleNo: ruleNo,
          pos: 1,
          origin: i,
          kind: 'S'
        });
      }
    });
  }

  function advance(i) {
    var sym = symbolOf(toParse[i]);
    if (!~sym) return;

    var prev = table[i - 1];
    var cur = table[i];

    if (!prev) return;
    for (var j = 0; j < prev.completions.length; j++) {
      if (bv_bit_test(grammar.sympred[sym], grammar[prev.completions[j].ruleNo].symbols[prev.completions[j].pos])) {
        var candidate = prev.completions[j];
        add(cur.completions, {
          ruleNo: candidate.ruleNo,
          pos: candidate.pos + 1,
          origin: candidate.origin,
          kind: 'A'
        });
      }
    }
  }

  function complete(i) {
    var cur = table[i];
    for (var j = 0; j < cur.completions.length; j++) {
      /*jshint loopfunc:true*/
      var ruleNo = cur.completions[j].ruleNo;
      var pos = cur.completions[j].pos;
      var origin = cur.completions[j].origin;
      var sym = grammar[ruleNo].sym;
      if (!~origin) continue;
      if (pos < grammar[ruleNo].symbols.length) continue;
      // console.log('completing from', dump_dotted_rule(grammar, cur.completions[j]), 'from set', origin, 'with sym', sym);

      bv_scan(table[origin].predictions, function(predictedRuleNo) {
        //console.log('try', predictedRuleNo, grammar[predictedRuleNo]);
        if (grammar[predictedRuleNo].symbols[0] == sym) {
          add(cur.completions, {
            ruleNo: predictedRuleNo,
            pos: 1,
            origin: origin,
            kind: 'C'
          });
        }
      });

      for (var k = 0; k < table[origin].completions.length; k++) {
        var candidate = table[origin].completions[k];
        if (bv_bit_test(grammar.sympred[sym], grammar[candidate.ruleNo].symbols[candidate.pos])) {
          // console.log('completing with', dump_dotted_rule(grammar, candidate));
          add(cur.completions, {
            ruleNo: candidate.ruleNo,
            pos: candidate.pos,
            origin: candidate.origin,
            kind: 'P'
          });
        }
      }
    }
  }

  function symbolOf(token) {
    return grammar.symbols.indexOf(token);
  }
}

function add(table, rule) {
  for (var l = 0; l < table.length; l++) {
    if (ruleEqual(table[l], rule)) return;
  }

  table.push(rule);
  //console.log('added', dump_dotted_rule(grammar, table[table.length - 1]));
}

function ruleEqual(a, b) {
  return a.ruleNo == b.ruleNo && a.pos == b.pos && a.origin == b.origin;
}

function bv_scan(vec, iter) {
  for (var i = 0; i < vec.bits; i++) {
    if (bitmv.bv_bit_test(vec, i)) {
      iter(i);
    }
  }
}

function dump_table(grammar, table) {
  return '  predict ' + JSON.stringify(bitmv.dumpvn(table.predictions)) + "\n" + table.completions.map(function(e) {
      return '  ' + e.ruleNo + ': ' + dump_dotted_rule(grammar, e);
    }).join('\n');
}

var chalk = require('chalk');

function dump_dotted_rule(grammar, ent) {
  var rule = grammar[ent.ruleNo];
  return ent.kind + ' ' + chalk.grey('@') + ' ' + chalk.yellow(ent.origin) + chalk.white(' {') + chalk.yellow(rule.name) + chalk.white(' → ') + chalk.cyan(rule.symbols.slice(0, ent.pos).map(display).join(' ')) + chalk.red('•') + chalk.cyan(rule.symbols.slice(ent.pos).map(display).join(' ')) + chalk.white('}');

  function display(e) {
    return grammar.symbols[e];
  }
}

module.exports = {
  Grammar: Grammar,
  Rule: Rule,
  Ref: Ref,
  Terminal: Terminal,
  parse: parse
};
