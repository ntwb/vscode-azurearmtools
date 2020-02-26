/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, window } from "vscode";
import { DialogResponses, IActionContext } from "vscode-azureextensionui";
import { extensionName, globalStateKeys } from "./constants";
import { ext } from "./extensionVariables";

export async function resetGlobalState(actionContext: IActionContext): Promise<void> {
    if (DialogResponses.yes === await ext.ui.showWarningMessage(`Reset all global state for the ${extensionName} extension (VS Code settings will not be changed)?`, DialogResponses.yes, DialogResponses.cancel)) {
        ext.context.globalState.update(globalStateKeys.dontAskAboutSchemaFiles, undefined);
        ext.context.globalState.update(globalStateKeys.dontAskAboutParamFiles, undefined);
        ext.context.globalState.update(globalStateKeys.survey.neverShowSurvey, undefined);
        ext.context.globalState.update(globalStateKeys.survey.surveyPostponedUntilTime, undefined);

        const reload = "Reload";
        if (reload === await window.showInformationMessage(`Global state for ${extensionName} has been reset.`, reload)) {
            // Don't wait
            commands.executeCommand("workbench.action.reloadWindow");
        }
    }
}
