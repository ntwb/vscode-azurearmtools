/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { commands } from 'vscode';
import { callWithTelemetryAndErrorHandling, IActionContext } from 'vscode-azureextensionui';
import { wrapError } from '../util/wrapError';

interface IDotnetAcquireResult {
    dotnetPath: string;
}

export async function acquireSharedDotnetInstallation(version: string): Promise<string> {
    // asdf how correlate error telemetry?
    return <string>await callWithTelemetryAndErrorHandling('acquiredSharedDotnet', async (actionContext: IActionContext) => {
        actionContext.errorHandling.rethrow = true;

        try {
            await commands.executeCommand('dotnet.showAcquisitionLog');
            const commandRes: IDotnetAcquireResult | undefined = await commands.executeCommand<IDotnetAcquireResult>('dotnet.acquire', { version });
            const dotnetPath: string | undefined = commandRes && commandRes.dotnetPath;
            if (!dotnetPath) {
                throw new Error('Couldn\'t resolve the dotnet path!');
            }
            return dotnetPath;

            // asdf
            //             const sampleExtension = vscode.extensions.getExtension('ms-azuretools.sample-extension');
            //             if (!sampleExtension) {
            //                 throw new Error('Could not find sample extension.');
            //             }
            //             const helloWorldLocation = path.join(sampleExtension.extensionPath, 'HelloWorldConsoleApp', 'HelloWorldConsoleApp.dll');
            //             const helloWorldArgs = [helloWorldLocation];
            //             // This will install any missing Linux dependencies.
            //             await vscode.commands.executeCommand('dotnet.ensureDotnetDependencies', { command: dotnetPath, arguments: helloWorldArgs });
            //             const result = cp.spawnSync(dotnetPath, helloWorldArgs);
            //             const stderr = result.stderr.toString();
            //             if (result.stderr.toString().length > 0) {
            //                 vscode.window.showErrorMessage(`Failed to run Hello World:
            // ${stderr}`);
            //                 return;
            //             }
            //             const appOutput = result.stdout.toString();
            //             vscode.window.showInformationMessage(`.NET Core Output: ${appOutput}`);
            //         } catch (error) {
            //             vscode.window.showErrorMessage(error.toString());
            //         }
        } catch (err) {
            const linkMessage = `>>>> This extension requires .NET Core for full functionality, but we were unable to download and install a local copy for the extension. If this error persists, please see https://aka.ms/vscode-armtools-dotnet for troubleshooting tips.`;
            err = wrapError(linkMessage, err);
            throw err;
        }
    });
}
