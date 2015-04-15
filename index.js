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
  parse: parse,

  // `Parser` gives a parser that can be driven for arbitrary input.
  //
  // It has a `push` method that accepts a token of input, and a `success`
  // method to see if the parse is successful given the current input.
  Parser: Parser

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
        if (!~symNo) {
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
  // so we can know what items we're looking for given a symbol, and
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
  rules.predictions_expanded_for_symbols = rules.predictions_for_symbols.map(function(v) {
    var out = [];
    bv_scan(v, function(n) {
      out.push(n);
    });
    return out;
  });

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

// A convenience parse function
function parse(grammar, toParse, debug) {
  var p = Parser(grammar, debug);
  // For each input symbol, generate an Earley set
  for (var i = 0; i < toParse.length; i++) {
    p.push(toParse[i]);
  }

  return p.success();
}

// Parsing
// =======
function Parser(grammar, debug) {
  var sets = [];

  var currentSet = 0;

  function handleToken(tok) {

    if (debug) {
      debug('set', currentSet, tok, 'sym', symbolOf(tok));
    }

    // First predictions: what rules are possible at this point in the parse
    sets[currentSet] = {
      predictions: null,
      items: []
    };

    sets[currentSet].predictions = predict(currentSet);

    // Then scan: what rules match at this point in the parse
    scan(currentSet, tok);

    // Then advance rules already started, seeking completion
    advance(currentSet, tok);

    // Then find completed rules and carry their derivations forward,
    // potentially advancing their causes.
    complete(currentSet);

    if (debug) {
      debug(sets, currentSet);
    }

    currentSet += 1;
  }

  return {
    push: handleToken,
    success: function() {
      // The parse succeeds if the accept rule is present in the final Earley set.
      return success(last(sets));
    }
  };


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
    if (currentSet == 0 && !tab) {
      return true;
    }
    for (var j = 0; j < tab.items.length; j++) {
      var dr = tab.items[j];
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
    var prev = sets[which - 1];
    var cur = sets[which];
    if (!prev) {
      bv_or_assign(predictions, grammar.predictions_for_symbols[grammar.symbols.indexOf('_accept')]);
    } else {
      for (var j = 0; j < prev.items.length; j++) {
        var drule = prev.items[j];
        var pos = drule.pos;
        var rule = grammar[drule.ruleNo];
        if (rule.symbols.length > pos) {
          grammar.predictions_expanded_for_symbols[rule.symbols[pos]].forEach(expandRule);
        }
      }
    }

    function expandRule(ruleNo) {
      if ('leo' in drule) {
        add(cur, {
          ruleNo: ruleNo,
          pos: 1,
          leo: drule.leo,
          origin: which,
          kind: 'Q'
        });
      } else {
        add(cur, {
          ruleNo: ruleNo,
          pos: 1,
          origin: which,
          kind: 'P'
        });
      }
    }

    return predictions;
  }


  // Scan a token
  // ------------
  //
  // Given the predictions, see which ones' first symbols match input.
  function scan(which, tok) {
    var sym = symbolOf(tok);
    if (!~sym) return;

    bv_scan(sets[which].predictions, function(ruleNo) {
      var rule = grammar[ruleNo];
      var pos = 1;

      if (grammar[ruleNo].symbols[0] == sym) {
        sets[which].items.push({
          ruleNo: ruleNo,
          pos: pos,
          origin: which,
          leo: leo(rule, pos, which),
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
  function advance(which, tok) {
    var sym = symbolOf(tok);
    if (!~sym) return;

    var prev = sets[which - 1];
    var cur = sets[which];

    if (!prev) return;
    for (var j = 0; j < prev.items.length; j++) {
      var drule = prev.items[j];
      var rule = grammar[drule.ruleNo];

      if (rule.symbols[drule.pos] == sym) {
        var candidate = prev.items[j];
        var pos = candidate.pos + 1;

        console.log(candidate);
        add(cur, {
          ruleNo: candidate.ruleNo,
          pos: pos,
          origin: candidate.origin,
          leo: leo(rule, pos, candidate.leo != null ? candidate.leo : candidate.origin),
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
    var cur = sets[which];

    // I really dislike how I've done alreadyLeo -- not really connected enough
    // to why what's going on is going on, but it's what I've got for now.
    var alreadyLeo = false;

    for (var j = 0; j < cur.items.length; j++) {
      var ruleNo = cur.items[j].ruleNo;
      var pos = cur.items[j].pos;
      var origin = cur.items[j].origin;
      var sym = grammar[ruleNo].sym;
      if (!~origin) continue;
      if (pos < grammar[ruleNo].symbols.length) continue;

      // Since predictions are stored in compact form, completing them
      // requires realizing them as they are completed.
      bv_scan(sets[origin].predictions, realizeCompletablePrediction);

      // If this is the first Earley set being completed, then there are no
      // prior rules already confirmed to advance.
      if (!sets[origin - 1]) return;

      // Leo items from prior Earley sets get advanced
      if (!alreadyLeo)
        for (var l = 0; l < sets[origin - 1].items.length; l++) {
          var item = sets[origin - 1].items[l];

          // Non-leo items will be handled below.
          if (bv_bit_test(prediction(sym), nextSymbol(item))) {
            add(cur, {
              ruleNo: item.ruleNo,
              pos: item.pos + 1,
              origin: item.origin,
              leo: item.leo || item.origin,
              kind: 'L'
            });

            // We assume that the first Leo item we create is _the_ Leo item,
            // which _should_ be true in most (all?) cases. This needs validation
            // and refinement. A Leo item must be unique for a given origin set.
            alreadyLeo = true;
            break;
          }
      }

      // Rules already confirmed and realized in prior Earley sets get advanced
      for (var k = 0; k < sets[origin - 1].items.length; k++) {
        var candidate = sets[origin - 1].items[k];

        // Leo items were handled above.
        if (candidate.leo) continue;
        if (bv_bit_test(prediction(sym), nextSymbol(candidate))) {
          add(cur, {
            ruleNo: candidate.ruleNo,
            pos: candidate.pos + 1,
            origin: candidate.origin,
            kind: 'C'
          });
        }
      }
    }

    function realizeCompletablePrediction(predictedRuleNo) {
      // Because predicted items are virtual -- just an entry in a bit set --
      // until realized, operations that scan the details will miss them. We
      // do this now to save the cost of doing this for predictions that went
      // nowhere.
      if (bv_bit_test(prediction(sym), grammar[predictedRuleNo].symbols[0])) {
        add(cur, {
          ruleNo: predictedRuleNo,
          pos: 1,
          origin: origin,
          kind: 'P'
        });
      }
    }

  }

  function nextSymbol(prior) {
    return grammar[prior.ruleNo].symbols[prior.pos];
  }

  function prediction(s) {
    return grammar.sympred[s];
  }

  function symbolOf(token) {
    return grammar.symbols.indexOf(token);
  }

  // Determine leo recursion eligibility for rule and position within it
  function leo(rule, pos, which) {
    return (rule.right_recursive && rule.symbols.length == pos + 1 && rule.symbols[pos] == rule.sym) ? which : null;
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

// Add a rule to an Earley set, detecting duplicates
function add(set, rule) {
  for (var l = 0; l < set.items.length; l++) {
    if (ruleEqual(set.items[l], rule)) return;
  }

  set.items.push(rule);
}

// determine whether two rules are equal
function ruleEqual(a, b) {
  return a.ruleNo == b.ruleNo && a.pos == b.pos && a.origin == b.origin;
}
