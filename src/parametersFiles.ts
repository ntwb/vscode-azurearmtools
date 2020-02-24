// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All rights reserved.
// ----------------------------------------------------------------------------

import * as assert from 'assert';
import * as fse from 'fs-extra';
import * as path from 'path';
import { commands, ConfigurationTarget, MessageItem, TextDocument, Uri, window, workspace } from 'vscode';
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
  if (!templateUri) {
    await ext.ui.showWarningMessage(`No template file is selected.`);
    return;
  }

  const currentParamsFileNormalized: string | undefined = normalizePath(findMappedParamsFileForTemplate(templateUri));

  const possibilities: IPossibleParamsFile[] = await findAvailableParametersFiles(templateUri);
  const current = possibilities.find(pf => normalizePath(pf.path) === currentParamsFileNormalized);
  const none: IAzureQuickPickItem<IPossibleParamsFile | undefined> = {
    label: "$(circle-slash) None",
    data: undefined
  };
  // asdf browse  $(search)
  // asdf new?
  // find most likely matches
  let items: IAzureQuickPickItem<IPossibleParamsFile>[] = possibilities.map(paramFile => <IAzureQuickPickItem<IPossibleParamsFile>>{
    label: `$(json) ${path.basename(paramFile.path)}`,
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

  const paramsFilePath: string | undefined = result.data?.path;
  if (paramsFilePath) {
    await setMappedParamsFileForTemplate(templateUri, paramsFilePath);
  }
}

function normalizePath(filePath: Uri | string | undefined): string | undefined {
  const fsPath: string | undefined = typeof filePath === 'string' ? filePath :
    filePath ? filePath.fsPath : undefined;
  if (fsPath) {
    let normalizedPath = path.normalize(fsPath);
    if (isWin32) {
      normalizedPath = normalizedPath.toLowerCase();
    }

    return normalizedPath;
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
  const templatUri = document.uri;
  const templatPath = templatUri.fsPath;
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
        await setMappedParamsFileForTemplate(templatUri, closestMatch);
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

/**
 * Given a template file URI, find the parameters file, if any, that the user currently has mapped to it
 */
export function findMappedParamsFileForTemplate(templateFileUri: Uri): Uri | undefined {
  const paramsFiles: { [key: string]: string } | undefined =
    workspace.getConfiguration(configPrefix, templateFileUri).get<{ [key: string]: string }>(configKeys.parametersFiles);
  if (typeof paramsFiles === "object") {
    const normalizedTemplatePath = normalizePath(templateFileUri.fsPath);
    let paramsFile: Uri | undefined;
    for (let fileNameKey of Object.getOwnPropertyNames(paramsFiles)) {
      const normalizedFileName: string | undefined = normalizePath(fileNameKey);
      if (normalizedFileName === normalizedTemplatePath) {
        if (typeof paramsFiles[fileNameKey] === 'string') {
          // Resolve relative to template file's folder
          let resolvedPath = path.resolve(path.dirname(templateFileUri.fsPath), paramsFiles[fileNameKey]);
          let normalizedPath = normalizePath(resolvedPath);

          // If the user has an entry in both workspace and user settings, vscode combines the two objects,
          //   with workspace settings overriding the user settings.
          // If there are two entries differing only by case, allow the last one to win, because it will be
          //   the workspace setting value
          paramsFile = !!normalizedPath ? Uri.file(normalizedPath) : undefined; // asdf what if invalid uri?
        }
      }
    }

    return paramsFile;

    // asdf urls?
  }

  return undefined;
}

async function setMappedParamsFileForTemplate(templateUri: Uri, paramsFilePath: string): Promise<void> {
  // tslint:disable-next-line: no-non-null-assertion
  // let paramsFilesSetting = workspace.getConfiguration(configPrefix, templateUri).inspect(configKeys.parametersFiles);
  // assert(paramsFilesSetting, `Configuration ${configKeys.parametersFiles} not found`);
  // // tslint:disable-next-line: no-non-null-assertion
  // paramsFilesSetting = paramsFilesSetting!;

  // tslint:disable-next-line: no-non-null-assertion
  const normalizedTemplatePath: string = normalizePath(templateUri)!;

  const relativeParamsFilePath = path.relative(normalizedTemplatePath, paramsFilePath);
  let map = workspace.getConfiguration(configPrefix, templateUri).get<{ [key: string]: string }>(configKeys.parametersFiles, {});
  if (typeof map === 'object') { //asdf
    //asdf remove previous entries that differ only by case
    map[normalizedTemplatePath] = relativeParamsFilePath;
  }
  /* asdf
  		 * Will throw error when
		 * - Writing a configuration which is not registered.
		 * - Writing a configuration to workspace or folder target when no workspace is opened
		 * - Writing a configuration to folder target when there is no folder settings
		 * - Writing to folder target without passing a resource when getting the configuration (`workspace.getConfiguration(section, resource)`)
		 * - Writing a window configuration to folder target
*/
  await workspace.getConfiguration(configPrefix, templateUri).update(configKeys.parametersFiles, map, ConfigurationTarget.Workspace); //asdf

  // //asdf
  // let workspaceFolderValue = typeof paramsFilesSetting.workspaceFolderValue === 'object' ? <{ [key: string]: unknown }>paramsFilesSetting.workspaceFolderValue : undefined;
  // let workspaceValue = typeof paramsFilesSetting.workspaceValue === 'object' ? <{ [key: string]: unknown }>paramsFilesSetting.workspaceValue : undefined;
  // let globalValue = typeof paramsFilesSetting.globalValue === 'object' ? <{ [key: string]: unknown }>paramsFilesSetting.globalValue : undefined;

  // // tslint:disable-next-line: strict-boolean-expressions
  // if (workspaceFolderValue && !!workspaceFolderValue[key]) {
  //   workspaceFolderValue[key] = paramsFilePath;
  //   await workspace.getConfiguration(configPrefix, templateUri).update(configKeys.parametersFiles, workspaceFolderValue, ConfigurationTarget.WorkspaceFolder);
  // } else if (workspaceValue && !!workspaceFolderValue[key]) {
  //   workspaceFolderValue[key] = paramsFilePath;
  //   await workspace.getConfiguration(configPrefix, templateUri).update(configKeys.parametersFiles, workspaceFolderValue);
  // }

  // async function updateSetting(target: ConfigurationTarget): Promise<boolean> {
  //   // tslint:disable-next-line: strict-boolean-expressions
  //   if (workspaceFolderValue && workspaceFolderValue[key]) {
  //     // Found a current value in this configuration,
  //     workspaceFolderValue[key] = paramsFilePath;
  //     await workspace.getConfiguration(configPrefix, templateUri).update(configKeys.parametersFiles, workspaceFolderValue, ConfigurationTarget.WorkspaceFolder);
  //   } else if (workspaceValue && !!workspaceFolderValue[key]) {

  //   }
  // }
}
