// Fixture: the #1487 rule MUST fire on every line below.
// Each line is a canonical dynamic-code-evaluation call site with a
// non-literal argument (identifier, member access, concat expression, or
// interpolated template), or the Function constructor, or a vm primitive.
/* eslint-disable @typescript-eslint/no-unused-vars */

// @ts-nocheck — fixture file, not expected to type-check cleanly

declare const userInput: string;
declare const req: { body: { code: string }; params: { script: string } };
declare const vm: {
  runInNewContext: (...a: unknown[]) => unknown;
  runInThisContext: (...a: unknown[]) => unknown;
};

// eval() with non-literal arg: identifier, member access, interpolated template.
eval(userInput);
eval(req.body.code);
eval(`${userInput}`);

// eval() with a binary-expression arg containing a string literal anywhere.
// CR-3 regression guard: the filter must NOT exempt mixed expressions just
// because a string node lives somewhere in the argument subtree.
eval('prefix-' + userInput);
eval(userInput + ' trailer');

// Function constructor with any arg count (all arg shapes fire).
new Function(userInput);
new Function('x', 'y', 'return x + y');

// Function() without `new` — spec-equivalent to the constructor form,
// catches the GCA #1487 coverage gap.
Function(userInput);
Function('x', 'y', 'return x + y');

// vm.runInNewContext / vm.runInThisContext always fire (attack-primitive).
vm.runInNewContext(userInput);
vm.runInThisContext(userInput);
