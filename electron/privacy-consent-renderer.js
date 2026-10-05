const strings = {
  'zh-CN': { title: '使用前，请阅读隐私政策', intro: '同意后才能进入登录或仅本地使用。拒绝将退出应用。', agreement: '我已阅读并同意 AI Tip 隐私政策', 'local-note': '同意记录仅保存在本机；同意不会开启云端上传或联网搜索。', reject: '不同意并退出', accept: '同意并继续', saving: '正在保存…', loadError: '无法读取安装包内的隐私政策，不能继续使用。请重新安装，或联系开发者：2280810215@qq.com。', saveError: '无法保存同意记录，尚未进入应用。请检查磁盘空间和应用数据目录的写入权限后重试；需要帮助请联系：2280810215@qq.com。', linkError: '无法打开链接，请联系：2280810215@qq.com。' },
  en: { title: 'Before you start, read our privacy policy', intro: 'Consent is required for both sign-in and local-only use. Declining closes the app.', agreement: 'I have read and agree to the AI Tip Privacy Policy', 'local-note': 'Your consent is saved only on this device. It does not enable cloud upload or web search.', reject: 'Disagree and exit', accept: 'Agree and continue', saving: 'Saving…', loadError: 'The bundled privacy policy could not be loaded. The app cannot continue. Reinstall or contact 2280810215@qq.com.', saveError: 'Your consent could not be saved. The app has not started. Check free disk space and app-data write permissions, then retry. Contact: 2280810215@qq.com.', linkError: 'Could not open this link. Contact: 2280810215@qq.com.' },
};
const byId = id => document.getElementById(id);
let language = 'zh-CN';
let policyHash = '';
let busy = false;
let errorKey = '';
function render() {
  document.documentElement.lang = language;
  for (const id of ['title', 'intro', 'agreement', 'local-note', 'reject', 'accept']) byId(id).textContent = strings[language][id];
  if (busy) byId('accept').textContent = strings[language].saving;
  byId('error').textContent = errorKey ? strings[language][errorKey] : '';
  byId('accept').disabled = !policyHash || !byId('consent-checkbox').checked || busy;
  byId('reject').disabled = busy;
  byId('consent-checkbox').disabled = !policyHash || busy;
}
byId('language').addEventListener('change', event => { language = event.target.value; render(); });
byId('consent-checkbox').addEventListener('change', render);
byId('reject').addEventListener('click', () => window.privacyConsent.reject().catch(() => { errorKey = 'saveError'; render(); }));
byId('accept').addEventListener('click', async () => {
  if (busy || !policyHash || !byId('consent-checkbox').checked) return;
  busy = true; errorKey = ''; render();
  try {
    const result = await window.privacyConsent.accept({ checked: true, hash: policyHash, language });
    if (!result.ok) { busy = false; errorKey = 'saveError'; render(); }
  } catch { busy = false; errorKey = 'saveError'; render(); }
});
byId('policy').addEventListener('click', event => {
  const anchor = event.target.closest('a');
  if (!anchor) return;
  event.preventDefault();
  window.privacyConsent.openLink(anchor.getAttribute('href')).catch(() => { errorKey = 'linkError'; render(); });
});
window.privacyConsent.read().then(policy => {
  byId('policy').innerHTML = policy.html; // Only the trusted, bundled policy is supplied by the main process.
  policyHash = policy.hash;
  language = policy.language === 'en' ? 'en' : 'zh-CN';
  byId('language').value = language;
  byId('policy').setAttribute('aria-busy', 'false');
  render();
}).catch(() => { errorKey = 'loadError'; render(); });
