import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPrivacyPolicy, createPrivacyConsentStore } from '../electron/privacy-consent-store.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'ai-tip-privacy-store-'));
try {
  const policy = loadPrivacyPolicy(new URL('../website/privacy/index.html', import.meta.url));
  assert.match(policy.html, /data-lang="zh"/);
  assert.match(policy.html, /data-lang="en"/);
  assert.match(policy.hash, /^[a-f0-9]{64}$/);
  assert.throws(() => loadPrivacyPolicy(path.join(root, 'missing.html')));
  const file = path.join(root, 'privacy-consent.json');
  const store = createPrivacyConsentStore(file, policy);
  assert.equal(store.hasConsent(), false);
  writeFileSync(path.join(root, 'remembered-login.json'), '{"token":"old-login"}');
  assert.equal(store.hasConsent(), false, 'Existing credentials are not privacy consent');
  for (const invalid of [null, {}, { checked: false, hash: policy.hash }, { checked: true, hash: 'old-policy' }]) {
    assert.throws(() => store.accept(invalid));
    assert.equal(existsSync(file), false);
  }
  store.accept({ checked: true, hash: policy.hash, language: 'en' });
  assert.equal(createPrivacyConsentStore(file, policy).hasConsent(), true);
  const receipt = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(receipt.policyHash, policy.hash);
  assert.equal(receipt.language, 'en');
  assert.ok(Number.isFinite(Date.parse(receipt.acceptedAt)));
  assert.equal(createPrivacyConsentStore(file, { ...policy, hash: 'changed-policy' }).hasConsent(), false);
  for (const invalid of ['broken json', 'null', '{}', JSON.stringify({ ...receipt, accepted: false }), JSON.stringify({ ...receipt, acceptedAt: 'bad-date' })]) {
    writeFileSync(file, invalid);
    assert.equal(store.hasConsent(), false);
  }
  const blocked = path.join(root, 'not-a-directory');
  writeFileSync(blocked, 'file');
  assert.throws(() => createPrivacyConsentStore(path.join(blocked, 'consent.json'), policy).accept({ checked: true, hash: policy.hash }));
  const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const startup = main.slice(main.indexOf('app.whenReady().then(async () =>'));
  assert.ok(startup.indexOf('await ensurePrivacyConsent(') < startup.indexOf('await bootServer()'), 'Diagnostics must not bypass consent');
  assert.match(main, /if \(!privacyAccepted\) throw new Error/, 'Business startup must enforce authorization itself');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.build.files.includes('website/privacy/index.html'), 'Offline policy must ship');
  console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', consentStore: true, staleConsentBlocked: true, writeFailureBlocked: true, startupSourceGuard: true }));
} finally { rmSync(root, { recursive: true, force: true }); }
