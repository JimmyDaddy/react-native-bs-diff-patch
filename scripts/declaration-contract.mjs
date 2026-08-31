import assert from 'node:assert/strict';

import ts from 'typescript';

function isExported(statement) {
  return statement.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
  );
}

function addBindingNames(bindingName, names) {
  if (ts.isIdentifier(bindingName)) {
    names.add(bindingName.text);
    return;
  }
  for (const element of bindingName.elements) {
    if (ts.isBindingElement(element)) addBindingNames(element.name, names);
  }
}

/**
 * Return value-level exports from a declaration module. Type-only exports are
 * intentionally excluded: this contract compares the JavaScript namespace to
 * values that TypeScript consumers can import at runtime.
 */
export function declarationValueExports(source, filename) {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );
  const names = new Set();

  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || !statement.exportClause) continue;
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (!element.isTypeOnly) names.add(element.name.text);
        }
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        names.add(statement.exportClause.name.text);
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      names.add('default');
      continue;
    }
    if (!isExported(statement)) continue;

    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addBindingNames(declaration.name, names);
      }
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      names.add(statement.name.text);
    }
  }
  return [...names].sort();
}

/** Return every public declaration name, including type-only exports. */
export function declarationExports(source, filename) {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );
  const names = new Set();

  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) continue;
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text);
        }
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        names.add(statement.exportClause.name.text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      names.add('default');
      continue;
    }
    if (!isExported(statement)) continue;

    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isImportEqualsDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addBindingNames(declaration.name, names);
      }
    }
  }
  return [...names].sort();
}

export function assertDeclarationValueExportsMatchRuntime(
  runtimeApi,
  declarationSource,
  declarationPath
) {
  assert.deepEqual(
    declarationValueExports(declarationSource, declarationPath),
    Object.keys(runtimeApi).sort(),
    `${declarationPath} value exports must exactly match its runtime module`
  );
}
