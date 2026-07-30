/*---------------------------------------------------------------------------------------------
 *  Copyright (c) IBM Corp. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { extensions, workspace } from 'vscode';
import type { ConfigurationRequest } from 'vscode-languageclient';

interface AutoDisableSchemaDetectionEntry {
  extensionId: string;
  configurationKey?: string;
  fileMatches: string[];
}

const autoDisableSchemaDetectionEntries: AutoDisableSchemaDetectionEntry[] = [
  {
    extensionId: 'dbtlabsinc.dbt',
    fileMatches: ['**/dbt_project.yml', '**/dbt_project.yaml'],
  },
  {
    extensionId: 'docker.docker',
    configurationKey: 'docker.extension.enableComposeLanguageServer',
    fileMatches: [
      '**/docker-compose.yml',
      '**/docker-compose.yaml',
      '**/docker-compose.*.yml',
      '**/docker-compose.*.yaml',
      '**/compose.yml',
      '**/compose.yaml',
      '**/compose.*.yml',
      '**/compose.*.yaml',
    ],
  },
  {
    extensionId: 'github.vscode-github-actions',
    fileMatches: [
      '**/.github/workflows/*.yml',
      '**/.github/workflows/*.yaml',
      '**/.gitea/workflows/*.yml',
      '**/.gitea/workflows/*.yaml',
      '**/.forgejo/workflows/*.yml',
      '**/.forgejo/workflows/*.yaml',
    ],
  },
  {
    extensionId: 'ms-azure-devops.azure-pipelines',
    fileMatches: ['azure-pipelines.yml', 'azure-pipelines.yaml'],
  },
];

export const applyAutoDisableSchemaDetection: ConfigurationRequest.MiddlewareSignature = async (params, token, configuration) => {
  const configurations = await configuration(params, token);
  if (!Array.isArray(configurations)) {
    return configurations;
  }
  return configurations.map((configuration, index) => {
    if (
      params.items[index]?.section !== 'yaml' ||
      configuration === null ||
      typeof configuration !== 'object' ||
      Array.isArray(configuration)
    ) {
      return configuration;
    }

    return {
      ...configuration,
      disableSchemaDetection: computeAutoDisableSchemaDetectionUpdate(
        configuration.disableSchemaDetection,
        getAutoDisabledSchemaDetectionExtensions()
      ),
    };
  });
};

export function getAutoDisabledSchemaDetectionExtensions(): string[] {
  const configuration = workspace.getConfiguration();
  const enabledExtensions: string[] = [];
  for (const entry of autoDisableSchemaDetectionEntries) {
    if (
      !extensions.getExtension(entry.extensionId) ||
      (entry.configurationKey && configuration.get<boolean>(entry.configurationKey, true) === false)
    ) {
      continue;
    }
    enabledExtensions.push(entry.extensionId);
  }
  return enabledExtensions;
}

export function computeAutoDisableSchemaDetectionUpdate(
  currentDisableSchemaDetection: string | string[],
  enabledExtensions: string[]
): string[] {
  const configuredFileMatches = toStringArray(currentDisableSchemaDetection);
  const desiredFileMatches = getFileMatchesForExtensions(enabledExtensions);
  const additions = desiredFileMatches.filter((fileMatch) => !configuredFileMatches.includes(fileMatch));
  return configuredFileMatches.concat(additions);
}

function getFileMatchesForExtensions(extensionIds: string[]): string[] {
  const fileMatches: string[] = [];
  for (const entry of autoDisableSchemaDetectionEntries) {
    if (extensionIds.includes(entry.extensionId)) {
      fileMatches.push(...entry.fileMatches);
    }
  }
  return fileMatches;
}

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}
