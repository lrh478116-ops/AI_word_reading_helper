const root = document.documentElement;
const languageButton = document.querySelector("[data-language-toggle]");
const remembered = localStorage.getItem("ai-tip-site-language");
if (remembered === "en") root.dataset.siteLanguage = "en";

languageButton?.addEventListener("click", () => {
  const next = root.dataset.siteLanguage === "en" ? "zh" : "en";
  root.dataset.siteLanguage = next;
  root.lang = next === "en" ? "en" : "zh-CN";
  localStorage.setItem("ai-tip-site-language", next);
});

for (const element of document.querySelectorAll("[data-copy-email]")) {
  element.addEventListener("click", async (event) => {
    event.preventDefault();
    const email = "2280810215@qq.com";
    const status = document.querySelector("[data-copy-status]");
    try {
      await navigator.clipboard.writeText(email);
      if (status) status.textContent = root.dataset.siteLanguage === "en" ? "Email copied." : "邮箱已复制。";
    } catch {
      location.href = `mailto:${email}`;
    }
  });
}
