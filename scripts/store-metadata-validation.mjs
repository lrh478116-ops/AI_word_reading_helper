export function validateMetadata(data) {
  const errors = [];
  for (const locale of ['zh-CN', 'en']) {
    const item = data?.locales?.[locale];
    if (!item) { errors.push(`Missing locale: ${locale}`); continue; }
    for (const [field, limit] of Object.entries({ name: 30, subtitle: 30, description: 4000, promotionalText: 170 })) {
      if (typeof item[field] !== 'string' || !item[field].trim() || [...item[field]].length > limit) errors.push(`${locale}.${field}: limit ${limit}`);
    }
    if (typeof item.keywords !== 'string' || !item.keywords.trim() || Buffer.byteLength(item.keywords, 'utf8') > 100) errors.push(`${locale}.keywords: 100 UTF-8 bytes`);
    if (/<\/?[a-z][^>]*>|```|\[[^\]]+\]\(/i.test(item.description || '')) errors.push(`${locale}.description must be plain text`);
  }
  if (!data?.privacyPolicyURL?.startsWith('https://')) errors.push('Missing privacy URL');
  return errors;
}

export function validateCapture(manifest, submission = false) {
  const errors = [];
  if (!manifest?.sourceCommit || !manifest?.capturedAt || !manifest?.sourceHashes || !manifest?.artifacts?.length) errors.push('Missing capture provenance');
  if (submission && (manifest.platform !== 'darwin' || manifest.submissionReady !== true || manifest.demonstrationResponses === true || !manifest.signedBuildHash || !manifest.reviewedBy)) errors.push('Mac signed candidate capture and review required; draft or demonstration is not submission evidence');
  return errors;
}
