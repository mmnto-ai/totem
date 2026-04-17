// Fixture: the #1487 rule MUST NOT fire on any line below.
// Literal-string evaluation is allowed by the ticket; non-evaluation call
// sites (JSON.parse, Math.eval-lookalikes, etc.) are silent.
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable prefer-const */

// @ts-nocheck — fixture file, not expected to type-check cleanly

// Literal-string eval is permitted: the rule filters out plain string args
// and template strings without interpolation.
const literalResult = eval('2 + 2');
const templateNoInterp = eval(`2 + 2`);

// JSON.parse is not an eval primitive.
const parsed = JSON.parse('{"a":1}');

// Method named `eval` on an unrelated object: member-expression callee,
// not the bare identifier the rule targets.
class MathParser {
  eval(expr: string): number {
    return Number(expr);
  }
}
const mp = new MathParser();
const n = mp.eval('42');

// A variable named `Function` used as a value, not constructed.
const FnCtor = Function;
const typeOfFn = typeof FnCtor;

export { literalResult, n, parsed, templateNoInterp, typeOfFn };
