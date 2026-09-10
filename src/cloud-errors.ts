const messages: Record<string, [string, string]> = {
  CLOUD_TRANSPORT_UNAVAILABLE: ['桌面云连接未初始化，请重启或更新应用。', 'The desktop cloud connection is not initialized. Restart or update the app.'],
  CLOUD_DNS_FAILED: ['无法解析云服务地址，服务可能暂时离线或 DNS 不可用。请稍后重试；你仍可仅本地使用。', 'The cloud address could not be resolved. The service may be offline or DNS unavailable. Retry later; local mode is still available.'],
  CLOUD_TLS_FAILED: ['无法与云服务建立安全连接。请检查系统时间与网络证书，或稍后重试。', 'A secure connection to the cloud could not be established. Check the system clock and network certificates, or retry later.'],
  CLOUD_TIMEOUT: ['连接云服务超时，请稍后重试。你仍可仅本地使用。', 'The cloud connection timed out. Retry later; local mode is still available.'],
  CLOUD_NETWORK_FAILED: ['无法连接云服务。请检查网络或稍后重试；你仍可仅本地使用。', 'Unable to connect to the cloud. Check your connection or retry later; local mode is still available.'],
  CLOUD_CONNECTION_CLOSED: ['云连接在收到响应前被中断。请检查网络、代理或 TUN 设置，或稍后重试；你仍可仅本地使用。', 'The cloud connection closed before a response was received. Check your network, proxy or TUN settings, or retry later; local mode is still available.'],
  CLOUD_SERVICE_UNAVAILABLE: ['云服务暂时不可用，可能正在维护或恢复。请稍后重试；你仍可仅本地使用。', 'The cloud service is temporarily unavailable and may be under maintenance or restarting. Retry later; local mode is still available.'],
  CLOUD_RATE_LIMITED: ['请求过于频繁或邮件额度已达上限，请稍后重试。', 'Too many requests or the email limit has been reached. Please retry later.'],
  CLOUD_REDIRECT_BLOCKED: ['云服务返回了非预期的地址跳转，已停止发送账户信息。请联系开发者。', 'The cloud service returned an unexpected redirect. Sending account details was stopped. Contact support.'],
  CLOUD_RESPONSE_INVALID: ['云服务返回了无法识别的响应，请稍后重试。', 'The cloud service returned an invalid response. Please retry later.'],
};

export function cloudErrorMessage(code: string, language: string = 'zh-CN') {
  return messages[code]?.[language === 'en' ? 1 : 0];
}
