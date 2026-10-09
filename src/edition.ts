export type AppEdition = 'local' | 'api';
export type Distribution = 'direct' | 'mas';
export interface BuildPolicy {
  edition: AppEdition;
  distribution: Distribution;
  cloudModels: boolean;
  tavily: boolean;
  apiDownloadURL: string;
  showApiDownload: boolean;
}
declare const __AI_TIP_BUILD_POLICY__: BuildPolicy;

export function createBuildPolicy(edition: string, distribution: string, downloadURL = ''): BuildPolicy {
  if (edition !== 'local' && edition !== 'api') throw new Error('Unknown app edition');
  if (distribution !== 'direct' && distribution !== 'mas') throw new Error('Unknown distribution');
  if (edition === 'api' && distribution === 'mas') throw new Error('API edition cannot be built for MAS');
  if (downloadURL) {
    const url = new URL(downloadURL);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Download URL must use HTTPS without credentials');
  }
  const apiDownloadURL = edition === 'local' && distribution === 'direct' ? downloadURL : '';
  return { edition, distribution, cloudModels: edition === 'api', tavily: edition === 'api', apiDownloadURL, showApiDownload: Boolean(apiDownloadURL) };
}

// Replaced by Vite and esbuild. A process environment variable cannot unlock a compiled local build.
export const BUILD_POLICY: Readonly<BuildPolicy> = Object.freeze(typeof __AI_TIP_BUILD_POLICY__ === 'undefined'
  ? createBuildPolicy('api', 'direct')
  : createBuildPolicy(__AI_TIP_BUILD_POLICY__.edition, __AI_TIP_BUILD_POLICY__.distribution, __AI_TIP_BUILD_POLICY__.apiDownloadURL));
export const LOCAL_EDITION = BUILD_POLICY.edition === 'local';

export function localModelBaseURL(value: unknown): string {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.search || url.hash || url.pathname !== '/v1') throw new Error('not loopback');
    return `${url.origin}/v1`;
  } catch { throw new Error('LOCAL_EDITION: model address must be a credential-free HTTP loopback /v1 endpoint'); }
}

export function validateEditionSettings(policy: Readonly<BuildPolicy>, input: { provider?: unknown; baseURL?: unknown; apiKey?: unknown; searchApiKey?: unknown }) {
  if (policy.cloudModels) return;
  if (input.provider !== undefined && !['local', 'ollama'].includes(String(input.provider))) throw new Error('LOCAL_EDITION: cloud model providers are not supported');
  if (String(input.apiKey || '').trim() || String(input.searchApiKey || '').trim()) throw new Error('LOCAL_EDITION: API keys are not supported');
  if (input.baseURL !== undefined) localModelBaseURL(input.baseURL);
}

export function restrictStoredSettings<T extends { provider?: unknown; baseURL?: unknown; apiKey?: unknown; searchApiKey?: unknown }>(policy: Readonly<BuildPolicy>, settings: T, defaults: Partial<T>): T {
  if (policy.cloudModels) return settings;
  let usable = ['local', 'ollama'].includes(String(settings.provider));
  try { localModelBaseURL(settings.baseURL); } catch { usable = false; }
  const editionRestricted = !usable || ('editionRestricted' in settings && settings.editionRestricted === true);
  return { ...settings, ...(!usable ? defaults : {}), apiKey: '', searchApiKey: '', searchBudgetMode: 'free', editionRestricted };
}
