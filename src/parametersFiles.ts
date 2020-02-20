// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All rights reserved.
// ----------------------------------------------------------------------------

import * as fse from 'fs-extra';
import * as path from 'path';
import { Uri, window, workspace } from 'vscode';
import { IActionContext, IAzureQuickPickItem } from 'vscode-azureextensionui';
import { configKeys, configPrefix } from './constants';
import { ext } from './extensionVariables';
import { containsParamsSchema, isParamsSchema } from './schemas';

const readAtMostBytesToFindParamsSchema = 50 * 1024;

export async function selectParametersFile(actionContext: IActionContext, sourceUri?: Uri): Promise<void> {
  const templatePath = window.activeTextEditor?.document.uri;
  if (templatePath && templatePath.fsPath) {
    const currentParamsFile = normalizePath(findMappedParamsFileForTemplate(templatePath)?.fsPath);

    const possibilities: string[] = await findAvailableParametersFiles(templatePath.fsPath);
    const none: IAzureQuickPickItem<string> = {
      label: "None",
      data: ""
    };
    // asdf browse
    // find most likely matches
    const items: IAzureQuickPickItem<string>[] = possibilities.map(p => <IAzureQuickPickItem<string>>{
      label: path.basename(p),
      data: p,
      description: normalizePath(p) === currentParamsFile ? "(Current)" : undefined
    });

    items.sort((a, b) => {
      if (a === none) {
        return -1;
      } else if (b === none) {
        return 1;
      }

      if (normalizePath(a.data) === currentParamsFile) {
        return -1;
      } else if (normalizePath(b.data) === currentParamsFile) {
        return 1;
      }

      return a.data.localeCompare(b.data);
    });

    const result: IAzureQuickPickItem<string> = await ext.ui.showQuickPick(
      [none].concat(items),
      {
        canPickMany: false,
        placeHolder: "Select an Azure deployment parameters file to validate against"
      });

    // tslint:disable-next-line: no-non-null-assertion
    await ext.ui.showWarningMessage(result.data);
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
        return typeof paramsFile === 'string' ? Uri.file(paramsFiles[fileNameKey]) : undefined; // asdf what if invalid uri?
      }
    }
    // asdf normalize
    // asdf relative paths
    // asdf urls?
  }

  return undefined;
}

function normalizePath(fsPath: string | undefined): string | undefined {
  if (typeof fsPath === 'string') {
    return path.normalize(fsPath).toLowerCase();
  }

  return undefined;
}

export async function findAvailableParametersFiles(templatePath: string): Promise<string[]> {
  let paths: string[] = [];

  try {
    const folder = path.dirname(templatePath);
    const fileNames: string[] = await fse.readdir(folder);
    for (let paramsFileName of fileNames) {
      const fullPath = path.join(folder, paramsFileName);
      if (await isParametersFile(fullPath)) {
        paths.push(fullPath);
      }
    }
  } catch (error) {
    console.log(error);
  }

  return paths;
}

async function isParametersFile(filePath: string): Promise<boolean> {
  try {
    if (path.extname(filePath).toLowerCase() !== '.json') {
      return false;
    }

    if (await doesFileContainString(filePath, containsParamsSchema, readAtMostBytesToFindParamsSchema)) {
      // It contains the correct schema string, but could be in a comment etc. Now do more accurate check
      let contents: unknown = await fse.readJson(filePath, { encoding: 'utf8' });
      if (contents instanceof Object) {
        let schema = (<{ $schema?: string }>contents).$schema;
        if (isParamsSchema(schema)) {
          return true;
        }
      }
    }
  } catch (error) {
    console.log(error); //asdf
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
