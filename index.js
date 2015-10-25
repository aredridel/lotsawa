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

  function collectRulesBySymbol() {
    var out = [];
    rules.forEach(function(r, ruleNo) {
      if (!out[r.sym]) {
        out[r.sym] = [];
      }
      out[r.sym].push(ruleNo);

    });
    return out;
  }

  rules.by_symbol = collectRulesBySymbol();

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

  // Build a matrix of what rules get predicted with other rules
  // -----------------------------------------------------------
  //
  // This is so the Earley prediction step is just a matter of building a set
  // with a couple successive bitwise or operations.
  function generatePredictionMatrix() {
    var predictable = bitmv.matrix(rules.length, rules.length);
    rules.forEach(function(r, j) {
      rules.forEach(function(s, k) {
        if (r.symbols[0] != null && r.symbols[0] == s.sym) {
          bv_bit_set(predictable[j], k);
        }
      });

      bv_bit_set(predictable[j], j);
    });

    bitmv.transitiveClosure(predictable);

    return predictable;
  }

  rules.predictions_for_rules = generatePredictionMatrix();

  rules.predictions_for_symbols = rules.symbols.map(function(symName, sym) {
    var out = [];
    (rules.by_symbol[sym] || []).forEach(function(rule) {
      bv_scan(rules.predictions_for_rules[rule], function(ruleNo) {
        if (!~out.indexOf(ruleNo)) {
          out.push(ruleNo);
        }
      });
    });
    return out;
  });


  // Identify what symbols lead to right recursion
  // ---------------------------------------------
  //
  // The identified rules can use Joop Leo's logic to memoize that right
  // recursion, so there is not O(n^2) entries (a linear summary of the
  // factoring of the tree in each Earley set in which it appears, so O(n) for
  // each Earley set, which is also O(n) and so right recursion without Leo
  // optimization is O(n^2))
  function identifyRightRecursion() {
    var predictable = bitmv.matrix(rules.symbols.length, rules.symbols.length);

    // First we build a matrix of what rules directly refer to what other
    // rules by their rightmost symbol
    rules.symbols.forEach(function(name, sym) {
      rules.forEach(function(r) {
        if (last(r.symbols) === sym) {
          bv_bit_set(predictable[sym], r.sym);
        }
      });
    });

    // Then we compute the transitive closure of that matrix, essentially
    // following each recursion fully and annotating it.
    bitmv.transitiveClosure(predictable);

    return predictable;
  }

  rules.right_recursion = identifyRightRecursion();

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

  return p.success() && p;
}

// Parsing
// =======
function Parser(grammar, debug) {
  var sets = [];

  var currentSet = 1;

  function handleToken(tok) {

    if (debug) {
      debug('set', currentSet, tok, 'sym', symbolOf(tok));
    }

    sets[currentSet] = sets[currentSet] || {
      items: []
    };

    // Advance rules already started, seeking completion
    advance(currentSet, tok);

    // Then find completed rules and carry their derivations forward,
    // potentially advancing their causes.
    complete(currentSet);

    if (debug) {
      debug(sets, currentSet);
    }

    currentSet += 1;
  }

  initialize();
  complete(0);

  if (debug) {
    debug('set', 0);
    debug(sets, 0);
  }

  return {
    push: handleToken,
    success: function() {
      // The parse succeeds if the accept rule is present in the final Earley set.
      return success(last(sets));
    },
    tree: function () {
      return tree(0, currentSet - 1);
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
      if (debug) {
        debug('null parse counts as success');
      }
      return true;
    }
    tab.items.forEach(function(dr) {
      if (dr.origin === 0 &&
        dr.ruleNo == grammar.acceptRule &&
        dr.pos == grammar[grammar.acceptRule].symbols.length) {
        matches++;
      }
    });

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

  function tree(n, m) {
      var tab = sets[m];
      console.warn(arguments, sets);
    var matches = 0;
    if (currentSet == 0 && !tab) {
      if (debug) {
        debug('null parse counts as success');
      }
      return {};
    }
    tab.items.forEach(function(dr) {
      if (dr.origin === n &&
        dr.ruleNo == grammar.acceptRule &&
        dr.pos == grammar[grammar.acceptRule].symbols.length) {
        matches++;
      }
    });

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

  function predictCandidate(candidate, which) {
    var cur = sets[which];
    if (candidate.pos == 0) return;
    var rule = grammar[candidate.ruleNo];
    if (rule.symbols.length > candidate.pos) {
      grammar.predictions_for_symbols[rule.symbols[candidate.pos]].forEach(expandRule);
    }
    function expandRule(ruleNo) {
      add(cur, {
        ruleNo: ruleNo,
        pos: 0,
        leo: leo(rule, candidate.leo == null ? candidate.origin : candidate.leo),
        origin: which,
        kind: 'P'
      });
      // FIXME: should be leo more times than it is, but not always.
    }

  }

  function initialize() {
    var cur = sets[0] = {
      items: []
    };
    grammar.predictions_for_symbols[grammar.symbols.length - 1].forEach(expandRule);
    function expandRule(ruleNo) {
      add(cur, {
        ruleNo: ruleNo,
        pos: 0,
        leo: null,
        origin: 0,
        kind: 'I'
      });
    }
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
    prev.items.forEach(function(candidate) {
      var rule = grammar[candidate.ruleNo];

      if (rule.symbols[candidate.pos] == sym) {
        var pos = candidate.pos + 1;

        var newItem = {
          ruleNo: candidate.ruleNo,
          prev: candidate,
          pos: pos,
          origin: candidate.origin,
          leo: candidate.leo != null ? candidate.leo : leo(rule, candidate.origin),
          kind: 'A'
        };
        add(cur, newItem);
        predictCandidate(newItem, which, candidate);
      }
    });
  }

  // Complete rules
  // --------------
  //
  // When a rule has been completed, its causing rules may also be advanced or
  // completed. We process those here.
  function complete(which) {
    var cur = sets[which];

    forEachCanExpand(cur.items, function(drule) {
      var ruleNo = drule.ruleNo;
      var pos = drule.pos;
      var origin = drule.origin;
      var sym = grammar[ruleNo].sym;
      if (pos < grammar[ruleNo].symbols.length) return;

      if (drule.leo != null) {
        sets[drule.leo].items.forEach(function(item) {

          // Non-leo items will be handled below.
          if (sym == nextSymbol(item)) {
            add(cur, {
              ruleNo: item.ruleNo,
              prev: candidate,
              pos: item.pos + 1,
              origin: item.leo != null ? item.leo : item.origin,
              kind: 'L'
            });
          }
        });
      } else {

        // Rules already confirmed and realized in prior Earley sets get advanced
        sets[origin].items.forEach(function(candidate) {

          if (sym == nextSymbol(candidate)) {
            var newRule = {
              ruleNo: candidate.ruleNo,
              pos: candidate.pos + 1,
              origin: candidate.origin,
              kind: 'C'
            };
            add(cur, newRule);
            predictCandidate(newRule, which);
          }
        });
      }

    });


  }

  function nextSymbol(prior) {
    return grammar[prior.ruleNo].symbols[prior.pos];
  }

  function symbolOf(token) {
    return grammar.symbols.indexOf(token);
  }

  // Determine leo recursion eligibility for rule and position within it
  function leo(rule, which) {
      var lastSym = rule.symbols[rule.symbols.length - 1];
    if (lastSym == rule.sym || bv_bit_test(grammar.right_recursion[rule.sym], lastSym)) {
      return which;
    } else {
      return null;
    }
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

function forEachCanExpand(it, cb) {
  for (var i = 0; i < it.length; i++) {
    cb(it[i], i);
  }
}
