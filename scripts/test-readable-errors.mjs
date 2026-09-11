import { strict as assert } from 'node:assert';
import { cloudErrorMessage } from '../src/cloud-errors.ts';
const codes = ['CLOUD_DNS_FAILED', 'CLOUD_TLS_FAILED', 'CLOUD_TIMEOUT', 'CLOUD_CONNECTION_CLOSED', 'CLOUD_SERVICE_UNAVAILABLE', 'CLOUD_RATE_LIMITED', 'email_not_confirmed', 'email_address_not_authorized', 'otp_expired', 'invalid_credentials', 'CLOUD_QUOTA_EXCEEDED'];
for (const code of codes) {
  const zh = cloudErrorMessage(code, 'zh-CN');
  const en = cloudErrorMessage(code, 'en');
  assert.ok(zh?.includes('\n原因说明：') && zh?.includes('\n处理方法：'), `Missing understandable cause/action: ${code}`);
  assert.ok(en?.includes('\nReason:') && en?.includes('\nWhat to do:'), `Missing English cause/action: ${code}`);
  assert.doesNotMatch(en, /[\u4e00-\u9fff]/);
}
assert.match(cloudErrorMessage('CLOUD_SERVICE_UNAVAILABLE'), /可能/);
assert.doesNotMatch(cloudErrorMessage('CLOUD_SERVICE_UNAVAILABLE'), /服务器已经暂停|服务器已暂停/);
assert.match(cloudErrorMessage('email_address_not_authorized'), /开发者/);
assert.equal(cloudErrorMessage('unrecognized-code'), undefined);
console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', causeAndAction: true, bilingual: true, noInventedDiagnosis: true }));
