//! The named rewrite ruleset (DESIGN.md § Method 2).
//!
//! DESIGN names the ruleset exactly: "union assoc/comm/idempotence, concat
//! assoc + ε-identity, `∅` annihilator/identity laws, `(a*)* → a*`,
//! `a?·a* → a*`, `a·a* ↔ a+`, char-class union merging, single-char class ↔
//! literal. NO rule that is not locally provable".
//!
//! Nothing beyond that list is implemented. Where DESIGN writes `↔` the rule is
//! shipped as a named pair. Each rule below carries its one-line local proof;
//! the same proofs are emitted verbatim into `artifacts/ruleset.json`.

use egg::{rewrite as rw, Applier, EGraph, Id, Pattern, PatternAst, Rewrite, Subst, Symbol, Var};

use crate::charset::{ClassSet, LitChar};
use crate::ir::ReLang;

pub type Rw = Rewrite<ReLang, ()>;

/// A rule as it appears in `ruleset.json`.
pub struct RuleDoc {
    pub name: &'static str,
    pub design_clause: &'static str,
    pub statement: &'static str,
    pub local_proof: &'static str,
}

pub fn ruleset() -> (Vec<Rw>, Vec<RuleDoc>) {
    let mut rules: Vec<Rw> = vec![
        rw!("union-assoc-right"; "(alt (alt ?a ?b) ?c)" => "(alt ?a (alt ?b ?c))"),
        rw!("union-assoc-left";  "(alt ?a (alt ?b ?c))" => "(alt (alt ?a ?b) ?c)"),
        rw!("union-comm";        "(alt ?a ?b)"          => "(alt ?b ?a)"),
        rw!("union-idempotent";  "(alt ?a ?a)"          => "?a"),
        rw!("concat-assoc-right"; "(cat (cat ?a ?b) ?c)" => "(cat ?a (cat ?b ?c))"),
        rw!("concat-assoc-left";  "(cat ?a (cat ?b ?c))" => "(cat (cat ?a ?b) ?c)"),
        rw!("concat-eps-left";   "(cat eps ?a)"   => "?a"),
        rw!("concat-eps-right";  "(cat ?a eps)"   => "?a"),
        rw!("concat-empty-left";  "(cat empty ?a)" => "empty"),
        rw!("concat-empty-right"; "(cat ?a empty)" => "empty"),
        rw!("union-empty-left";   "(alt empty ?a)" => "?a"),
        rw!("union-empty-right";  "(alt ?a empty)" => "?a"),
        rw!("star-star";         "(star (star ?a))"      => "(star ?a)"),
        rw!("opt-then-star";     "(cat (opt ?a) (star ?a))" => "(star ?a)"),
        rw!("cat-star-to-plus";  "(cat ?a (star ?a))"    => "(plus ?a)"),
        rw!("plus-to-cat-star";  "(plus ?a)"             => "(cat ?a (star ?a))"),
    ];

    // Char-class union merging and the single-char class ↔ literal pair need to
    // read leaf DATA, which an egg `Pattern` cannot bind — so they are dynamic
    // appliers over a searcher that enumerates candidate e-classes.
    let any: Pattern<ReLang> = "?x".parse().unwrap();
    rules.push(Rewrite::new(
        "class-union-merge",
        "(alt ?a ?b)".parse::<Pattern<ReLang>>().unwrap(),
        ClassUnionMerge {
            a: "?a".parse().unwrap(),
            b: "?b".parse().unwrap(),
        },
    )
    .expect("class-union-merge"));
    rules.push(
        Rewrite::new("class-single-to-literal", any.clone(), ClassSingleToLiteral)
            .expect("class-single-to-literal"),
    );
    rules.push(
        Rewrite::new("literal-to-class-single", any, LiteralToClassSingle)
            .expect("literal-to-class-single"),
    );

    let docs = vec![
        RuleDoc {
            name: "union-assoc-right",
            design_clause: "union assoc",
            statement: "(A ∪ B) ∪ C  →  A ∪ (B ∪ C)",
            local_proof: "set union is associative",
        },
        RuleDoc {
            name: "union-assoc-left",
            design_clause: "union assoc",
            statement: "A ∪ (B ∪ C)  →  (A ∪ B) ∪ C",
            local_proof: "set union is associative",
        },
        RuleDoc {
            name: "union-comm",
            design_clause: "union comm",
            statement: "A ∪ B  →  B ∪ A",
            local_proof: "set union is commutative",
        },
        RuleDoc {
            name: "union-idempotent",
            design_clause: "union idempotence",
            statement: "A ∪ A  →  A",
            local_proof: "set union is idempotent",
        },
        RuleDoc {
            name: "concat-assoc-right",
            design_clause: "concat assoc",
            statement: "(A·B)·C  →  A·(B·C)",
            local_proof: "language concatenation is associative (string concatenation is)",
        },
        RuleDoc {
            name: "concat-assoc-left",
            design_clause: "concat assoc",
            statement: "A·(B·C)  →  (A·B)·C",
            local_proof: "language concatenation is associative",
        },
        RuleDoc {
            name: "concat-eps-left",
            design_clause: "concat ε-identity",
            statement: "ε·A  →  A",
            local_proof: "{\"\"}·A = A: prepending the empty word changes no string",
        },
        RuleDoc {
            name: "concat-eps-right",
            design_clause: "concat ε-identity",
            statement: "A·ε  →  A",
            local_proof: "A·{\"\"} = A",
        },
        RuleDoc {
            name: "concat-empty-left",
            design_clause: "∅ annihilator",
            statement: "∅·A  →  ∅",
            local_proof: "no w splits as x·y with x ∈ ∅, so the concatenation is empty",
        },
        RuleDoc {
            name: "concat-empty-right",
            design_clause: "∅ annihilator",
            statement: "A·∅  →  ∅",
            local_proof: "mirror of concat-empty-left",
        },
        RuleDoc {
            name: "union-empty-left",
            design_clause: "∅ identity",
            statement: "∅ ∪ A  →  A",
            local_proof: "∅ is the identity of set union",
        },
        RuleDoc {
            name: "union-empty-right",
            design_clause: "∅ identity",
            statement: "A ∪ ∅  →  A",
            local_proof: "∅ is the identity of set union",
        },
        RuleDoc {
            name: "star-star",
            design_clause: "(a*)* → a*",
            statement: "(A*)*  →  A*",
            local_proof: "A* is closed under concatenation and contains ε, so (A*)* = A*",
        },
        RuleDoc {
            name: "opt-then-star",
            design_clause: "a?·a* → a*",
            statement: "A?·A*  →  A*",
            local_proof: "(ε ∪ A)·A* = A* ∪ A·A* = A*",
        },
        RuleDoc {
            name: "cat-star-to-plus",
            design_clause: "a·a* ↔ a+ (forward)",
            statement: "A·A*  →  A+",
            local_proof: "A+ is by definition A·A*",
        },
        RuleDoc {
            name: "plus-to-cat-star",
            design_clause: "a·a* ↔ a+ (reverse)",
            statement: "A+  →  A·A*",
            local_proof: "A+ is by definition A·A*",
        },
        RuleDoc {
            name: "class-union-merge",
            design_clause: "char-class union merging",
            statement: "[S] ∪ [T]  →  [S ∪ T]",
            local_proof:
                "a one-character language denoting the set S unions elementwise: L([S]) ∪ L([T]) \
                 = S ∪ T = L([S ∪ T]); the sets are Σ-subsets so the union stays in Σ",
        },
        RuleDoc {
            name: "class-single-to-literal",
            design_clause: "single-char class ↔ literal (forward)",
            statement: "[c]  →  'c'",
            local_proof: "a singleton class denotes {c}, the same language as the literal c",
        },
        RuleDoc {
            name: "literal-to-class-single",
            design_clause: "single-char class ↔ literal (reverse)",
            statement: "'c'  →  [c]",
            local_proof: "the literal c denotes {c}, the same language as the singleton class",
        },
    ];

    assert_eq!(
        rules.len(),
        docs.len(),
        "every rewrite must carry a documented local proof"
    );
    (rules, docs)
}

/// `[S] ∪ [T] → [S ∪ T]` — reads the two class leaves out of the matched
/// e-classes. Returns nothing when either side is not a class.
struct ClassUnionMerge {
    a: Var,
    b: Var,
}

fn class_of(egraph: &EGraph<ReLang, ()>, id: Id) -> Option<ClassSet> {
    egraph[id].nodes.iter().find_map(|n| match n {
        ReLang::Cls(s) => Some(*s),
        _ => None,
    })
}

impl Applier<ReLang, ()> for ClassUnionMerge {
    fn apply_one(
        &self,
        egraph: &mut EGraph<ReLang, ()>,
        eclass: Id,
        subst: &Subst,
        _searcher_ast: Option<&PatternAst<ReLang>>,
        _rule_name: Symbol,
    ) -> Vec<Id> {
        let (Some(sa), Some(sb)) = (
            class_of(egraph, subst[self.a]),
            class_of(egraph, subst[self.b]),
        ) else {
            return vec![];
        };
        let merged = egraph.add(ReLang::Cls(sa.union(sb)));
        if egraph.union(eclass, merged) {
            vec![merged]
        } else {
            vec![]
        }
    }
}

/// `[c] → 'c'` for a singleton class.
struct ClassSingleToLiteral;

impl Applier<ReLang, ()> for ClassSingleToLiteral {
    fn apply_one(
        &self,
        egraph: &mut EGraph<ReLang, ()>,
        eclass: Id,
        _subst: &Subst,
        _searcher_ast: Option<&PatternAst<ReLang>>,
        _rule_name: Symbol,
    ) -> Vec<Id> {
        let single = egraph[eclass].nodes.iter().find_map(|n| match n {
            ReLang::Cls(s) => s.as_single(),
            _ => None,
        });
        let Some(c) = single else { return vec![] };
        let lit = egraph.add(ReLang::Lit(LitChar(c)));
        if egraph.union(eclass, lit) {
            vec![lit]
        } else {
            vec![]
        }
    }
}

/// `'c' → [c]`.
struct LiteralToClassSingle;

impl Applier<ReLang, ()> for LiteralToClassSingle {
    fn apply_one(
        &self,
        egraph: &mut EGraph<ReLang, ()>,
        eclass: Id,
        _subst: &Subst,
        _searcher_ast: Option<&PatternAst<ReLang>>,
        _rule_name: Symbol,
    ) -> Vec<Id> {
        let lit = egraph[eclass].nodes.iter().find_map(|n| match n {
            ReLang::Lit(LitChar(c)) => Some(*c),
            _ => None,
        });
        let Some(c) = lit else { return vec![] };
        let cls = egraph.add(ReLang::Cls(ClassSet::single(c as u32)));
        if egraph.union(eclass, cls) {
            vec![cls]
        } else {
            vec![]
        }
    }
}
