"use strict";

var bitmv = require('bitmv');
var bv_or_assign = bitmv.bv_or_assign;
var bv_bit_set = bitmv.bv_bit_set;
var bv_bit_test = bitmv.bv_bit_test;

function Grammar(rules) {
    rules.push(Rule('_start', [ Ref('start') ]));

    rules.symbols = censusSymbols();
    rules.predictable = generatePredictionMatrix();
    rules.sympred = generateSymbolMatrix();

    function censusSymbols() {
        var out = [];
        rules.forEach(function (r) {
            if (!~out.indexOf(r.name)) out.push(r.name);
            r.symbols.forEach(function (s, i) {
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

    function generatePredictionMatrix() {
        var predictable = bitmv.matrix(rules.length, rules.length);

        // Build a matrix of what rules predict what other rules, so we can just jump straight to the
        // answer rather than having to do these loops at each pass. Bitsets are fun.
        rules.forEach(function (r, i) {
            rules.forEach(function (s, j) {
                if (r.symbols[0] != null && r.symbols[0] == s.sym) bv_bit_set(predictable[i], j);
            });
        });
        bitmv.transitiveClosure(predictable);

        console.log('predictions');
        console.log(bitmv.dump(predictable));

        return predictable;
    }

    function generateSymbolMatrix() {
        var predictable = bitmv.matrix(rules.symbols.length, rules.symbols.length);

        // Build a matrix of what rules predict what other rules, so we can just jump straight to the
        // answer rather than having to do these loops at each pass. Bitsets are fun.
        rules.symbols.forEach(function (sym, i) {
            rules.forEach(function (r, j) {
                if (r.symbols[0] != null && r.symbols[0] == i) bv_bit_set(predictable[j], r.sym);
            });
        });
        bitmv.transitiveClosure(predictable);

        console.log('symbols');
        console.log(bitmv.dump(predictable));
        console.log(rules.symbols);

        return predictable;
    }

    rules.predictions_for_symbols = {};

    rules.forEach(function (r, ruleNo) {
        console.log('rule', ruleNo, 'symbols', r.symbols, r.name);

        if (!rules.predictions_for_symbols[r.name]) {
            rules.predictions_for_symbols[r.name] = bitmv.vector(rules.length);
            bv_bit_set(rules.predictions_for_symbols[r.name], ruleNo);
        }
        bv_or_assign(rules.predictions_for_symbols[r.name], rules.predictable[ruleNo]);
    });

    for (var r in rules.predictions_for_symbols) {
        console.log(r, bitmv.dumpv(rules.predictions_for_symbols[r]));
    }


    return rules;
}

function Rule(name, syms) {
    return {name: name, symbols: syms};
}

function Ref(name) {
    return {name: name};
}

function Terminal(symbol) {
    return {name: symbol, terminal: symbol};
}

function parse(grammar, toParse) {
    var table = new Array(toParse.length + 1);

    for (var i = 0; i < toParse.length; i++) {
        console.log('set', i);
        table[i] = {
            predictions: predict(i),
            completions: []
        };

        complete(i);

        console.log(dump_table(grammar, table[i]));
    }

    function justcompletions(e) { return e.completions; }

    function predict(i) {
        var predictions = bitmv.vector(grammar.length);
        var prev = table[i - 1];
        if (!prev) {
            console.log('predicting start rule');
            bv_or_assign(predictions, grammar.predictions_for_symbols._start);
        } else {
            for (var j = 0; j < prev.completions.length; j++) {
                var ruleNo = prev.completions[j].ruleNo;
                var pos = prev.completions[j].pos;
                console.log('predicting', ruleNo, 'at pos', pos, grammar[ruleNo]);
                if (grammar[ruleNo].symbols.length > pos) {
                    bv_or_assign(predictions, grammar.sympred[grammar[ruleNo].symbols[pos]] || []);
                }
            }
        }

        console.log('predicted', bitmv.dumpv(predictions));
        return predictions;
    }

    function complete(i) {
        bv_scan(table[i].predictions, function (ruleNo) {
            console.log('completing', ruleNo, 'at pos 0 with symbol', grammar[ruleNo].symbols[0]);
            if (bv_bit_test(grammar.sympred[symbolOf(toParse[i])], grammar[ruleNo].symbols[0])) {
                table[i].completions.push({ruleNo: ruleNo, pos: 0});
                console.log('completed ', ruleNo, 'at pos 0 with symbols', grammar[ruleNo].symbols[0]);
            }
        });

        var prev = table[i - 1];
        console.log('completing prior additions');
        complete_table(prev);
    }

    function complete_table(ent) {
        if (ent) for (var j = 0; j < ent.completions.length; j++) {
            var ruleNo = ent.completions[j].ruleNo;
            var pos = ent.completions[j].pos + 1;
            console.log('trying completion', j, 'at', pos, grammar[ruleNo].symbols, 'against', symbolOf(toParse[i]));
            if (~grammar.sympred[grammar.symbols.indexOf(toParse[i])].indexOf(grammar[ruleNo].symbols[pos])) {
                table[i].completions.push({ruleNo: ruleNo, pos: pos});
            }
        }
    }

    function symbolOf(token) {
        return grammar.symbols.indexOf(toParse[i]);
    }
}

function bv_scan(vec, iter) {
    for (var i = 0; i < vec.bits; i++) {
        if (bitmv.bv_bit_test(vec, i)) {
            iter(i);
        }
    }
}

function dump_table(grammar, table) {
    return '  predict ' + JSON.stringify(bitmv.dumpv(table.predictions)) + "\n" + table.completions.map(function (e) {
        return '  ' + e.ruleNo + ': ' + dump_dotted_rule(grammar, e);
    }).join('\n');
}

function dump_dotted_rule(grammar, ent) {
    var rule = grammar[ent.ruleNo];
    return '{' + rule.name + '→' + rule.symbols.slice(0, ent.pos).map(display).join(' ') + '·' + rule.symbols.slice(ent.pos).map(display).join(' ') + '}';

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
