// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All rights reserved.
// ----------------------------------------------------------------------------

import { CancellationToken, CodeLens, CodeLensProvider, Position, Range, TextDocument, Uri, workspace } from 'vscode';
import { IActionContext } from 'vscode-azureextensionui';
import { configKeys, configPrefix, languageId } from './constants';
import { ext } from './extensionVariables';

const emptyRange = new Range(new Position(0, 0), new Position(0, 0));

export class ParamsFilesCodeLensProvider implements CodeLensProvider {
  /**
   * An optional event to signal that the code lenses from this provider have changed.
   */
  //asdf onDidChangeCodeLenses: Event<void> ;

  /**
   * Compute a list of [lenses](#CodeLens). This call should return as fast as possible and if
   * computing the commands is expensive implementors should only return code lens objects with the
   * range set and implement [resolve](#CodeLensProvider.resolveCodeLens).
   *
   * @param document The document in which the command was invoked.
   * @param token A cancellation token.
   * @return An array of code lenses or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined`, `null`, or an empty array.
   */
  public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | undefined {
    if (document.languageId !== languageId) {
      return undefined;
    }

    const paramsFile = findMatchingParamsFile(document.uri);

    return [
      !!paramsFile ?
        new CodeLens(
          emptyRange,
          {
            title: `Validating against parameters file ${paramsFile.fsPath}`,
            //tooltip: 'tooltip' //asdf
            command: "azurerm-vscode-tools.selectParametersFile",
            arguments: [
              document
            ]
          }
        )
        : new CodeLens(
          emptyRange,
          {
            title: "Select a parameters file to enable full validation",
            //tooltip: 'tooltip' //asdf
            command: "azurerm-vscode-tools.selectParametersFile",
            arguments: [
              document
            ]
          }
        )
    ];
  }

  // /**
  //  * This function will be called for each visible code lens, usually when scrolling and after
  //  * calls to [compute](#CodeLensProvider.provideCodeLenses)-lenses.
  //  *
  //  * @param codeLens code lens that must be resolved.
  //  * @param token A cancellation token.
  //  * @return The given, resolved code lens or thenable that resolves to such.
  //  */
  // public async resolveCodeLens?(codeLens: CodeLens, token: CancellationToken): Promise<CodeLens> {
  //     codeLens.command = ;
  // }
}

export async function selectParametersFile(actionContext: IActionContext, sourceUri: Uri): Promise<void> {
  await ext.ui.showWarningMessage("hi");
}

export function findMatchingParamsFile(uri: Uri): Uri | undefined {
  const paramsFiles: { [key: string]: string } | undefined = workspace
    .getConfiguration(configPrefix)
    .get<{ [key: string]: string }>(configKeys.parametersFiles);
  if (paramsFiles instanceof Object) {
    // asdf normalize, case insensitivity
    // asdf relative paths
    // asdf urls?
    const paramsFile = paramsFiles[uri.fsPath];
    if (typeof paramsFile === 'string') {
      return Uri.file(paramsFile);
    }
  }

  return undefined;
}
