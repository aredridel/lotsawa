"use strict";

// The Public API
// ==============
module.exports = {

  // `Grammar` returns a processed, precomputed grammar given an array of
  // rules. `(Rule[]) → Grammar`
  Grammar: Grammar,

  // `Rule` defines a rule in the proper format `(name, Symbol[]) → Rule`
  Rule: Rule,

  // `Ref` represents a reference to a rule `(name) → Ref`
  Ref: Ref,

  // `Terminal` represents a terminal symbol `(name) → Terminal`
  Terminal: Terminal,

  // Both `Ref` and `Terminal` are `Symbol`s.

  // `parse' accepts input and performs the parse. `(Grammar, string) → Boolean`
  parse: parse
};

// Some definitions
// ================
//
// The whole library uses a lot of set operations, represented by vectors,
// and some precomputation of what items refer to other items, calculated
// via transitive closures over bit matrices.
var bitmv = require('bitmv');

// let `bv_or_assign` be the operation of replacing the first argument with
// the union of the sets
var bv_or_assign = bitmv.bv_or_assign;

// let `bv_bit_set` be the operation of setting a particular bit in a set.
var bv_bit_set = bitmv.bv_bit_set;

// let `bv_bit_test` be the operation of determining whether a particular bit
// is in the set.
var bv_bit_test = bitmv.bv_bit_test;

function Grammar(rules) {
  // Processing The Grammar
  // ======================
  //
  // Here we begin defining a grammar given the raw rules, terminal
  // symbols, and symbolic references to rules
  //
  // The input is a list of rules.
  //
  // Add the accept rule
  // -------------------
  //
  // The input grammar is amended with a final rule, the 'accept' rule,
  // which if it spans the parse chart, means the entire grammar was
  // accepted. This is needed in the case of a nulling start symbol.
  rules.push(Rule('_accept', [Ref('start')]));
  rules.acceptRule = rules.length - 1;

  // Build a list of all the symbols used in the grammar
  // ---------------------------------------------------
  //
  // so they can be numbered instead of referred to by name, and therefore
  // their presence can be represented by a single bit in a set.
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

  rules.symbols = censusSymbols();

  // Build a matrix of what symbols predict what other symbols
  // ---------------------------------------------------------
  //
  // so we can know what completions we're looking for given a symbol, and
  // manipulate that with the and and or of bit sets.
  function generateSymbolMatrix() {
    var predictable = bitmv.matrix(rules.symbols.length, rules.symbols.length);

    rules.symbols.forEach(function(name, sym) {
      rules.forEach(function(r) {
        if (r.symbols[0] != null && r.symbols[0] == sym) {
          bv_bit_set(predictable[sym], r.sym);
        }
      });
      bv_bit_set(predictable[sym], sym);
    });
    bitmv.transitiveClosure(predictable);

    return predictable;
  }

  rules.sympred = generateSymbolMatrix();

  // Build a matrix of what symbols predict what rules
  // -------------------------------------------------
  //
  // This is so the Earley prediction step is just a matter of building a set
  // with a couple successive bitwise or operations.
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

  // Identify what rules are right-recursive
  // --------------------------------------
  //
  // The identified rules can use Joop Leo's logic to memoize that right
  // recursion, so there is not O(n^2) entries (a linear summary of the
  // factoring of the tree in each Earley set in which it appears, so O(n) for
  // each Earley set, which is also O(n) and so right recursion without Leo
  // optimization is O(n^2))
  function identifyRightRecursion() {
    var predictable = bitmv.matrix(rules.length, rules.length);

    // First we build a matrix of what rules directly refer to what other
    // rules by their rightmost symbol
    rules.forEach(function(r, j) {
      rules.forEach(function(s, k) {
        if (last(r.symbols) === s.sym) {
          bv_bit_set(predictable[j], k);
        }
      });

    });

    // Then we compute the transitive closure of that matrix, essentially
    // following each recursion fully and annotating it.
    bitmv.transitiveClosure(predictable);

    // Then we check for which rules have their own bit set -- the diagonal
    // of the matrix. Mark any such rules found.
    rules.forEach(function(r, j) {
      if (bv_bit_test(predictable[j], j)) {
        r.right_recursive = true;
      }
    });
  }

  identifyRightRecursion();

  return rules;
}

// Defining a grammar
// ==================
//
// Define a rule
// -------------
//
// Rules are in the form
//
// _{ Name → symbol symbol symbol }_
function Rule(name, syms) {
  return {
    name: name,
    symbols: syms
  };
}

// Refer to another rule by its name
// ---------------------------------
//
// This symbol in the rule is a reference to another rule
function Ref(name) {
  return {
    name: name
  };
}

// Define a terminal symbol
// ------------------------
//
// This symbol refers to nothing else and is used literally.
function Terminal(symbol) {
  return {
    name: symbol,
    terminal: symbol
  };
}

// Parsing
// =======
function parse(grammar, toParse, debug) {
  var table = [];

  // For each input symbol, generate an Earley set
  for (var i = 0; i < toParse.length; i++) {
    if (debug) {
      debug('set', i, toParse[i], 'sym', symbolOf(toParse[i]));
    }

    // First predictions: what rules are possible at this point in the parse
    table[i] = {
      predictions: predict(i),
      completions: []
    };

    // Then scan: what rules match at this point in the parse
    scan(i);

    // Then advance rules already started, seeking completion
    advance(i);

    // Then find completed rules and carry their derivations forward,
    // potentially advancing their causes.
    complete(i);

    if (debug) {
      debug(table, i);
    }
  }

  // The parse succeeds if the accept rule is present in the final Earley set.
  return success(last(table));

  // Test for success
  // ----------------
  //
  // Success is when the accept rule is present in the last Earley set and has
  // origin 0. If there are multiple factorings of the output, there will be an
  // entry for each: the parse is ambiguous.
  //
  // At the moment, an ambiguous parse is considered unsuccessful, but this is
  // an avenue for refinement.
  function success(tab) {
    var matches = 0;
    if (toParse.length == 0 && !tab) {
      return true;
    }
    for (var j = 0; j < tab.completions.length; j++) {
      var dr = tab.completions[j];
      if (dr.origin === 0 &&
        dr.ruleNo == grammar.acceptRule &&
        dr.pos == grammar[grammar.acceptRule].symbols.length) {
        matches++;
      }
    }

    if (matches === 0) {
      if (debug) {
        debug('parse failed');
      }
    } else if (matches == 1) {
      if (debug) {
        debug('parse succeeded');
      }
      return true;
    } else {
      if (debug) {
        debug('parse was ambiguous');
      }
    }
    return false;
  }

  // Predict which rules are applicable given current input
  // ------------------------------------------------------
  //
  // There is a special case for the first set, since there is no prior input,
  // just the expectation that we'll parse this grammar.
  function predict(which) {
    var predictions = bitmv.vector(grammar.length);
    var prev = table[which - 1];
    if (!prev) {
      bv_or_assign(predictions, grammar.predictions_for_symbols[grammar.symbols.indexOf('_accept')]);
    } else {
      for (var j = 0; j < prev.completions.length; j++) {
        var drule = prev.completions[j];
        var pos = drule.pos;
        var rule = grammar[drule.ruleNo];
        if (rule.symbols.length > pos) {
          bv_or_assign(predictions, grammar.predictions_for_symbols[rule.symbols[pos]]);
        }
      }
    }

    return predictions;
  }


  // Scan a token
  // ------------
  //
  // Given the predictions, see which ones' first symbols match input.
  function scan(which) {
    var sym = symbolOf(toParse[which]);
    if (!~sym) return;

    bv_scan(table[which].predictions, function(ruleNo) {
      if (grammar[ruleNo].symbols[0] == sym) {
        table[which].completions.push({
          ruleNo: ruleNo,
          pos: 1,
          origin: which,
          kind: 'S'
        });
      }
    });
  }

  // Advance prior rules in progress
  // -------------------------------
  //
  // Since there are uncompleted rules in progress during most steps, this will
  // match those to input and step them along, recording the progress.
  function advance(which) {
    var sym = symbolOf(toParse[which]);
    if (!~sym) return;

    var prev = table[which - 1];
    var cur = table[which];

    if (!prev) return;
    for (var j = 0; j < prev.completions.length; j++) {
      var drule = prev.completions[j];
      var rule = grammar[drule.ruleNo];
      if (rule.symbols[drule.pos] == sym) {
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

  // Complete rules
  // --------------
  //
  // When a rule has been completed, its causing rules may also be advanced or
  // completed. We process those here.
  function complete(which) {
    var cur = table[which];
    for (var j = 0; j < cur.completions.length; j++) {
      var ruleNo = cur.completions[j].ruleNo;
      var pos = cur.completions[j].pos;
      var origin = cur.completions[j].origin;
      var sym = grammar[ruleNo].sym;
      if (!~origin) continue;
      if (pos < grammar[ruleNo].symbols.length) continue;

      bv_scan(table[origin].predictions, predictForRuleNo);

      if (!table[origin - 1]) return;
      for (var k = 0; k < table[origin - 1].completions.length; k++) {
        var candidate = table[origin - 1].completions[k];
        if (bv_bit_test(grammar.sympred[sym], grammar[candidate.ruleNo].symbols[candidate.pos])) {
          add(cur.completions, {
            ruleNo: candidate.ruleNo,
            pos: candidate.pos + 1,
            origin: candidate.origin,
            kind: 'P'
          });
        }
      }
    }

    function predictForRuleNo(predictedRuleNo) {
      if (bv_bit_test(grammar.sympred[sym], grammar[predictedRuleNo].symbols[0])) {
        add(cur.completions, {
          ruleNo: predictedRuleNo,
          pos: 1,
          origin: origin,
          kind: 'C'
        });
      }
    }
  }

  function symbolOf(token) {
    return grammar.symbols.indexOf(token);
  }
}

// Unimportant bits
// ================

// Get the last entry in an array
function last(arr) {
  return arr[arr.length - 1];
}

// Scan a bit set and call the iterator function for each item in the set
function bv_scan(vec, iter) {
  for (var i = 0; i < vec.bits; i++) {
    if (bitmv.bv_bit_test(vec, i)) {
      iter(i);
    }
  }
}

// Add a rule to a table, detecting duplicates
function add(table, rule) {
  for (var l = 0; l < table.length; l++) {
    if (ruleEqual(table[l], rule)) return;
  }

  table.push(rule);
}

// determine whether two rules are equal
function ruleEqual(a, b) {
  return a.ruleNo == b.ruleNo && a.pos == b.pos && a.origin == b.origin;
}
