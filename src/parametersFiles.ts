// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All rights reserved.
// ----------------------------------------------------------------------------

import * as assert from 'assert';
import * as fse from 'fs-extra';
import * as path from 'path';
import { commands, MessageItem, TextDocument, Uri, window, workspace } from 'vscode';
import { callWithTelemetryAndErrorHandling, IActionContext, IAzureQuickPickItem } from 'vscode-azureextensionui';
import { configKeys, configPrefix, globalStateKeys, isWin32 } from './constants';
import { DeploymentTemplate } from './DeploymentTemplate';
import { ext } from './extensionVariables';
import { containsParamsSchema } from './schemas';

const readAtMostBytesToFindParamsSchema = 50 * 1024;

const _filesCheckedThisSession: Set<string> = new Set<string>();

interface IPossibleParamsFile {
  path: string;
  isCloseNameMatch: boolean;
}

function hasSupportedParamsFileExtension(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.json' || extension === '.jsonc';
}

export async function selectParametersFile(actionContext: IActionContext, sourceUri?: Uri): Promise<void> {
  const templateUri = window.activeTextEditor?.document.uri;
  if (templateUri && templateUri.fsPath) {
    const currentParamsFileNormalized = normalizePath(findMappedParamsFileForTemplate(templateUri)?.fsPath);

    const possibilities: IPossibleParamsFile[] = await findAvailableParametersFiles(templateUri);
    const current = possibilities.find(pf => normalizePath(pf.path) === currentParamsFileNormalized);
    const none: IAzureQuickPickItem<IPossibleParamsFile | undefined> = {
      label: "$(circle-slash) None",  //asdf $(remove)?
      data: undefined
    };
    // asdf browse  $(search)
    // asdf new?
    // find most likely matches
    let items: IAzureQuickPickItem<IPossibleParamsFile>[] = possibilities.map(paramFile => <IAzureQuickPickItem<IPossibleParamsFile>>{
      label: `${paramFile === current ? "$(check)" : "$(json)"} ${path.basename(paramFile.path)}`,  // asdf $(star-full)?
      data: paramFile,
      description: paramFile === current ? "(Current)" :
        paramFile.isCloseNameMatch ? "(Similar filename)" : undefined
    });

    let allItems = [none].concat(items);

    allItems.sort((a, b) => {
      const aData = a?.data;
      const bData = a?.data;

      // The current selected params file goes first
      if (aData === current) {
        return -1;
      } else if (bData === current) {
        return 1;
      }

      // "(None)" goes second
      if (a === none) {
        return -1;
      } else if (b === none) {
        return 1;
      }

      // Close name matches go next
      if (a?.data?.isCloseNameMatch !== b?.data?.isCloseNameMatch) {
        return a?.data?.isCloseNameMatch ? -1 : 1;
      }

      // tslint:disable-next-line: strict-boolean-expressions
      return (aData?.path || "").localeCompare(bData?.path || "");
    });

    const result: IAzureQuickPickItem<IPossibleParamsFile | undefined> = await ext.ui.showQuickPick(
      allItems,
      {
        canPickMany: false,
        placeHolder: `Select a parameters file to enable fuller validation against template file ${templateUri.fsPath}`,
        suppressPersistence: true
      });

    // tslint:disable-next-line: no-non-null-assertion
    await ext.ui.showWarningMessage(String(result.data));
  }
}

/**
 * Given a template file URI, find the parameters file, if any, that the user currently has mapped to it
 */
export function findMappedParamsFileForTemplate(templateFileUri: Uri): Uri | undefined {
  const paramsFiles: { [key: string]: string } | undefined = workspace.getConfiguration(configPrefix, templateFileUri)
    .get<{ [key: string]: string }>(configKeys.parametersFiles);
  if (typeof paramsFiles === "object") {
    const normalizedTemplatePath = normalizePath(templateFileUri.fsPath);
    for (let fileNameKey of Object.getOwnPropertyNames(paramsFiles)) {
      const normalizedFileName: string | undefined = normalizePath(fileNameKey);
      if (normalizedFileName === normalizedTemplatePath) {
        let paramsFile = paramsFiles[fileNameKey];
        if (typeof paramsFile === 'string') {
          // Resolve relative to template file's folder
          let resolvedPath = path.resolve(path.dirname(templateFileUri.fsPath), paramsFile);
          let normalizedPath = normalizePath(resolvedPath);
          return !!normalizedPath ? Uri.file(normalizedPath) : undefined; // asdf what if invalid uri?
        }
      }
    }

    // asdf urls?
  }

  return undefined;
}

function normalizePath(fsPath: string | undefined): string | undefined {
  if (typeof fsPath === 'string') {
    fsPath = path.normalize(fsPath);
    if (isWin32) {
      fsPath = fsPath.toLowerCase();
    }

    return fsPath;
  }

  return undefined;
}

export async function findAvailableParametersFiles(templateUri: Uri): Promise<IPossibleParamsFile[]> {
  let paths: IPossibleParamsFile[] = [];

  try {
    const folder = path.dirname(templateUri.fsPath);
    const fileNames: string[] = await fse.readdir(folder);
    for (let paramsFileName of fileNames) {
      const fullPath = path.join(folder, paramsFileName);
      if (await isParametersFile(fullPath)) {
        paths.push({
          path: fullPath,
          isCloseNameMatch: isLikelyMatchingParamsFileBasedOnName(templateUri.fsPath, fullPath)
        });
      }
    }
  } catch (error) {
    // Ignore
  }

  return paths;
}

async function isParametersFile(filePath: string): Promise<boolean> {
  try {
    if (!hasSupportedParamsFileExtension(filePath)) {
      return false;
    }

    if (await doesFileContainString(filePath, containsParamsSchema, readAtMostBytesToFindParamsSchema)) {
      return true;
    }
  } catch (error) {
    // Ignore
  }

  return false;
}

async function doesFileContainString(filePath: string, matches: (fileSubcontents: string) => boolean, maxBytesToRead: number): Promise<boolean> {
  // tslint:disable-next-line: typedef
  return new Promise<boolean>((resolve, reject) => {
    const stream = fse.createReadStream(filePath, { encoding: 'utf8' });

    let content: string = '';
    stream.on('data', (chunk: string) => {
      content += chunk;
      if (containsParamsSchema(content)) {
        stream.close();
        resolve(true);
      }
    });
    stream.on('end', () => {
      resolve(false);
    });
    stream.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Determines if a file is likely a parameters file for the given template file, based on name.
 * Common patterns are:
 *   template.json, template.params.json
 *   template.json, template.parameters.json
 */
export function isLikelyMatchingParamsFileBasedOnName(templateFileName: string, paramsFileName: string): boolean {
  if (!hasSupportedParamsFileExtension(paramsFileName)) {
    return false;
  }

  const baseTemplateName = removeAllExtensions(path.basename(templateFileName)).toLowerCase();
  const baseParamsName = removeAllExtensions(path.basename(paramsFileName)).toLowerCase();

  return baseParamsName.startsWith(baseTemplateName);
}

function removeAllExtensions(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export function queryAddParametersFile(document: TextDocument, deploymentTemplate: DeploymentTemplate): void {
  // Only deal with saved files, because we don't have an accurate
  //   URI that we can track for unsaved files, and it's a better user experience.
  if (document.uri.scheme !== 'file') {
    return;
  }

  // Already checked for this scenario?
  const templatPath = document.uri.fsPath;
  let queriedToAddParamsFile = _filesCheckedThisSession.has(templatPath);
  if (queriedToAddParamsFile) {
    return;
  }
  _filesCheckedThisSession.add(templatPath.toLowerCase());

  const alreadyHasParamsFile: boolean = !!findMappedParamsFileForTemplate(document.uri);
  const checkForMatchingParamsFileSetting: boolean = !!workspace.getConfiguration(configPrefix).get<boolean>(configKeys.checkForMatchingParamsFiles);

  // tslint:disable-next-line: no-floating-promises Don't wait
  callWithTelemetryAndErrorHandling('queryAddParametersFile', async (actionContext: IActionContext): Promise<void> => {
    actionContext.telemetry.properties.checkForMatchingParamsFile = String(checkForMatchingParamsFileSetting);
    actionContext.telemetry.properties.alreadyHasParamsFile = String(alreadyHasParamsFile);

    if (!checkForMatchingParamsFileSetting || alreadyHasParamsFile) {
      return;
    }

    // tslint:disable-next-line: strict-boolean-expressions
    const dontAskFiles = ext.context.globalState.get<string[]>(globalStateKeys.dontAskAboutParamsFiles) || []; //asdf?
    if (dontAskFiles.includes(templatPath)) {
      actionContext.telemetry.properties.isInDontAskList = 'true';
      return;
    }

    const possibleParamsFiles = await findAvailableParametersFiles(document.uri);
    const closeMatches = possibleParamsFiles.filter(pf => pf.isCloseNameMatch);
    actionContext.telemetry.measurements.closeMatches = closeMatches.length;
    // Take the shortest as the most likely best match
    const closestMatch = closeMatches.length > 0 ? closeMatches.sort(pf => -pf.path.length)[0].path : undefined;
    if (!closestMatch) {
      // asdf
      return;
    }

    const yes: MessageItem = { title: "Yes" };
    const no: MessageItem = { title: "No" }; // asdf blacklist?
    const another: MessageItem = { title: "Choose another" };
    //asdfconst neverForThisFile: vscode.MessageItem = { title: "Never for this template" };

    const response = await ext.ui.showWarningMessage(
      `Is "${path.basename(closestMatch)}" the correct parameters file to use for "${path.basename(templatPath)}"?`,
      {
        learnMoreLink: "https://aka.ms/vscode-azurearmtools-updateschema"
      },
      yes,
      no,
      another
    );
    actionContext.telemetry.properties.response = response.title;

    switch (response.title) {
      case yes.title:
        await ext.ui.showWarningMessage("yes asdf");
        break;
      case no.title:
        // We won't ask again. Let them know how to do it manually
        // Don't wait for theanswer
        window.showInformationMessage(
          `blah blah here's how to do it asdf`
          // {
          //     //learnMoreLink: "asdf"
          // }
        );
        break;
      case another.title:
        await commands.executeCommand("azurerm-vscode-tools.selectParametersFile"); //asdf
        // asdf what if they cancel?  Do we tell them how?  ask again?
        break;
      default:
        assert("queryAddParametersFile: Unexpected response");
        break;
    }
  });
}
