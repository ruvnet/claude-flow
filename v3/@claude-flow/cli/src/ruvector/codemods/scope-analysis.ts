/**
 * Scope-aware reassignment analysis for the `var-to-const` codemod (ADR-143).
 *
 * The naive version marks a `var` as reassigned if its name is assigned to
 * *anywhere* in the file. That is correct but over-conservative: a `var x` in
 * one function is forced to `let` just because an unrelated function also has
 * an `x = …`. This module resolves each assignment to the binding it actually
 * mutates (function-scope hoisting semantics), so a `var` becomes `const`
 * unless *its own* binding is reassigned.
 *
 * Soundness: resolution only ever attributes a reassignment to a scope that
 * actually hoists the name (i.e. genuinely declares that binding). It therefore
 * never marks a truly-reassigned binding as un-reassigned — so a `var` is only
 * promoted to `const` when it is provably never reassigned. Block-scoped
 * shadowing (let/const) is ignored for resolution, which can only make us *more*
 * conservative (fall back to `let`), never wrong.
 *
 * @module ruvector/codemods/scope-analysis
 */

import ts from 'typescript';

/** A scope is a function-like node or the SourceFile (the var-hoist boundaries). */
function isScopeNode(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function enclosingScope(node: ts.Node): ts.Node {
  let cur: ts.Node | undefined = node.parent;
  while (cur && !isScopeNode(cur)) cur = cur.parent;
  return cur ?? node.getSourceFile();
}

function parentScope(scope: ts.Node): ts.Node | undefined {
  if (ts.isSourceFile(scope)) return undefined;
  return enclosingScope(scope);
}

function collectIdentifierNames(target: ts.Node, out: (name: string) => void): void {
  if (ts.isIdentifier(target)) {
    out(target.text);
    return;
  }
  // Destructuring assignment target (object/array literal on the LHS of `=`).
  ts.forEachChild(target, (child) => collectIdentifierNames(child, out));
}

const ASSIGNMENT_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

export interface ReassignmentResolver {
  /** True if the `var` binding declared by `declarationList` (for `name`) is reassigned within its scope. */
  isReassigned(name: string, declarationList: ts.VariableDeclarationList): boolean;
}

/**
 * Build a scope-aware resolver: which `var` bindings are actually reassigned.
 */
export function buildReassignmentResolver(sf: ts.SourceFile): ReassignmentResolver {
  // Names hoisted into each scope: var-declared names, function declarations,
  // and parameters. (Collected per scope, not crossing nested function scopes.)
  const hoisted = new Map<ts.Node, Set<string>>();
  const ensure = (scope: ts.Node): Set<string> => {
    let s = hoisted.get(scope);
    if (!s) { s = new Set(); hoisted.set(scope, s); }
    return s;
  };
  ensure(sf);

  const addBinding = (name: ts.BindingName, scope: ts.Node): void => {
    if (ts.isIdentifier(name)) {
      ensure(scope).add(name.text);
    } else {
      for (const el of name.elements) {
        if (ts.isBindingElement(el)) addBinding(el.name, scope);
      }
    }
  };

  // Pass 1 — record hoisted names per scope.
  const collectHoisted = (node: ts.Node): void => {
    if (isScopeNode(node) && !ts.isSourceFile(node)) {
      ensure(node);
      // Parameters belong to the function's own scope.
      const params = (node as ts.FunctionLikeDeclarationBase).parameters;
      if (params) for (const p of params) addBinding(p.name, node);
    }
    if (ts.isVariableDeclarationList(node) && !(node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
      const scope = enclosingScope(node); // var hoists to the nearest function/source scope
      for (const decl of node.declarations) addBinding(decl.name, scope);
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      ensure(enclosingScope(node)).add(node.name.text);
    }
    ts.forEachChild(node, collectHoisted);
  };
  collectHoisted(sf);

  const resolveScope = (name: string, from: ts.Node): ts.Node | undefined => {
    let scope: ts.Node | undefined = from;
    while (scope) {
      if (hoisted.get(scope)?.has(name)) return scope;
      scope = parentScope(scope);
    }
    return undefined;
  };

  // Pass 2 — attribute each reassignment to the binding (scope) it mutates.
  const reassigned = new Set<string>(); // key: `${scopeId}::${name}`
  const scopeIds = new Map<ts.Node, number>();
  let nextId = 0;
  const scopeId = (scope: ts.Node): number => {
    let id = scopeIds.get(scope);
    if (id === undefined) { id = nextId++; scopeIds.set(scope, id); }
    return id;
  };

  const markReassigned = (name: string, at: ts.Node): void => {
    const declScope = resolveScope(name, enclosingScope(at));
    if (declScope) reassigned.add(`${scopeId(declScope)}::${name}`);
  };

  const collectReassignments = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)) {
      collectIdentifierNames(node.left, (n) => markReassigned(n, node));
    } else if (
      (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
      ts.isIdentifier(node.operand)
    ) {
      markReassigned(node.operand.text, node);
    }
    ts.forEachChild(node, collectReassignments);
  };
  collectReassignments(sf);

  return {
    isReassigned(name: string, declarationList: ts.VariableDeclarationList): boolean {
      const declScope = enclosingScope(declarationList);
      return reassigned.has(`${scopeId(declScope)}::${name}`);
    },
  };
}
