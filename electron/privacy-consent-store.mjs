import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export function loadPrivacyPolicy(file) {
  const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const html = source.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (!html || !html.includes('data-lang="zh"') || !html.includes('data-lang="en"')) {
    throw new Error('Bundled privacy policy is missing or incomplete');
  }
  return { hash: createHash('sha256').update(html).digest('hex'), html };
}

export function createPrivacyConsentStore(file, policy) {
  return {
    hasConsent() {
      try {
        const record = JSON.parse(readFileSync(file, 'utf8'));
        return record?.schema === 1 && record.accepted === true && record.policyHash === policy.hash
          && typeof record.acceptedAt === 'string' && Number.isFinite(Date.parse(record.acceptedAt));
      } catch { return false; } // Missing, unreadable or corrupt receipts require explicit consent again.
    },
    accept(input) {
      if (input?.checked !== true || input?.hash !== policy.hash) throw new Error('Explicit consent to the current policy is required');
      const record = { schema: 1, accepted: true, policyHash: policy.hash, acceptedAt: new Date().toISOString(), language: input.language === 'en' ? 'en' : 'zh-CN' };
      mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(record, null, 2), { mode: 0o600, flag: 'wx', flush: true });
        renameSync(temporary, file);
      } finally { try { unlinkSync(temporary); } catch (error) { if (error?.code !== 'ENOENT') throw error; } }
      return record;
    },
  };
}
