type Explanation = [title: string, reason: string, action: string];
const messages: Record<string, [Explanation, Explanation]> = {
  CLOUD_TRANSPORT_UNAVAILABLE: [
    ['应用暂时无法连接云端', '应用的网络组件尚未准备好，或安装文件版本不一致。', '完全退出并重新打开应用；仍然失败时安装最新版。'],
    ['The app cannot connect to the cloud yet', 'Its network component is not ready, or installed files have mismatched versions.', 'Quit and reopen the app. If it still fails, install the latest version.']],
  LOCAL_SERVICE_UNAVAILABLE: [
    ['应用内部服务没有响应', '负责处理操作的本机服务可能已停止，当前尚未确认云端是否正常。', '退出并重新打开应用；仍然失败时请联系开发者。'],
    ['The app’s local service is not responding', 'The service running on this device may have stopped. Cloud availability has not been determined.', 'Quit and reopen the app. If it still fails, contact support.']],
  CLOUD_DNS_FAILED: [
    ['找不到云服务器地址', '网络未能把服务器名称转换成可连接的地址，可能是网络地址查询异常或服务器暂时离线。', '确认其他网站能打开，再换一个网络重试；也可以选择“仅本地使用”。'],
    ['The cloud server address could not be found', 'The network could not resolve the server name. Address lookup may be failing, or the service may be offline.', 'Check that other websites open, then try another network. Local mode is also available.']],
  CLOUD_TLS_FAILED: [
    ['无法建立安全的云连接', '服务器的安全证书未通过验证，可能与设备时间、网络拦截或服务器证书有关。', '检查电脑日期和时间；尝试其他网络。仍失败时联系开发者，不要关闭证书验证。'],
    ['A secure cloud connection could not be established', 'The server certificate could not be verified. The device clock, network interception or server certificate may be responsible.', 'Check your device’s date and time, then try another network. Contact support if it persists; do not disable certificate checks.']],
  CLOUD_TIMEOUT: [
    ['等待云服务器响应超时', '服务器未在规定时间内响应，可能是网络较慢或服务器繁忙。', '稍后重试；若持续超时，尝试其他网络。可以先选择“仅本地使用”。'],
    ['The cloud server took too long to respond', 'The connection may be slow, or the server may be busy.', 'Retry later. If timeouts continue, try another network. You can use local mode meanwhile.']],
  CLOUD_NETWORK_FAILED: [
    ['无法连接云服务器', '连接未能完成，目前无法确定是设备网络还是服务器的问题。', '检查其他网站能否打开，稍后或换一个网络重试；持续失败时联系开发者。'],
    ['Unable to connect to the cloud server', 'The connection failed. It is not yet clear whether the device network or server is responsible.', 'Check whether other websites open, then retry later or on another network. Contact support if it persists.']],
  CLOUD_CONNECTION_CLOSED: [
    ['与云服务器的连接中断了', '还没有收到完整响应，连接就被关闭；可能与网络软件、网络线路或服务器有关。', '尝试其他网络；如使用代理软件，请检查它是否仍在接管网络。仍失败时联系开发者。'],
    ['The connection to the cloud server was interrupted', 'The connection closed before a complete response arrived. Network software, the connection or the server may be responsible.', 'Try another network. If you use proxy software, check whether it is still routing traffic. Contact support if it persists.']],
  CLOUD_SERVICE_UNAVAILABLE: [
    ['云端服务暂时不可用', '服务器可能正在维护、恢复启动或暂时停止服务，当前无法完成这次操作。', '稍后重试；持续失败时联系开发者检查服务器。你也可以先选择“仅本地使用”。'],
    ['The cloud service is temporarily unavailable', 'The server may be under maintenance, restarting or temporarily stopped, so this operation could not finish.', 'Retry later. If it persists, contact support to check the server. Local mode is also available.']],
  CLOUD_RATE_LIMITED: [
    ['操作过于频繁，请稍等', '服务器暂时限制了请求数量；连续点击重试可能延长等待。', '稍等一会再试，不要连续点击。若长时间未恢复，请联系开发者。'],
    ['Too many requests; please wait', 'The server is temporarily limiting requests. Repeated retries may extend the wait.', 'Wait before trying again and avoid repeated clicks. Contact support if the restriction persists.']],
  CLOUD_REDIRECT_BLOCKED: [
    ['账户信息发送已停止', '服务器要求跳转到非预期地址，应用为保护账户信息没有继续。', '请更新应用或联系开发者检查服务地址；不要在陌生页面输入密码。'],
    ['Sending account details was stopped', 'The server requested an unexpected redirect. The app stopped to protect your account details.', 'Update the app or contact support to check the service address. Do not enter your password on an unfamiliar page.']],
  CLOUD_RESPONSE_INVALID: [
    ['无法读取云服务器的回复', '服务器返回的内容不是应用所需的格式，可能是临时故障或版本不兼容。', '稍后重试并确认应用为最新版；持续失败时联系开发者。'],
    ['The cloud server’s reply could not be read', 'The reply had an unexpected format, possibly due to a temporary fault or incompatible version.', 'Retry later and check that the app is up to date. Contact support if it persists.']],
  email_not_confirmed: [
    ['邮箱尚未完成验证', '服务器要求先确认邮箱归属，才能登录。', '检查收件箱和垃圾邮件，按注册邮件完成验证后再登录。'],
    ['Your email has not been verified', 'The server requires email verification before you can sign in.', 'Check your inbox and spam folder. Complete the registration email’s verification, then sign in again.']],
  email_address_not_authorized: [
    ['暂时无法向这个邮箱发送邮件', '应用的发信服务尚未开放给这个邮箱，这是服务端配置限制。', '请联系开发者配置发信服务；更换密码或连续重试无法解决。可以先仅本地使用。'],
    ['Email cannot be sent to this address yet', 'The app’s email service is not enabled for this address. This is a server configuration restriction.', 'Contact support to configure the email service. Changing your password or repeatedly retrying will not resolve this. Local mode is available.']],
  otp_expired: [
    ['验证码无效或已过期', '服务器没有接受这个验证码，它可能已过期、已使用或输入有误。', '检查邮箱和验证码是否对应；必要时重新获取验证码，并使用最新收到的一条。'],
    ['The verification code is invalid or expired', 'The server did not accept the code. It may have expired, been used or been entered incorrectly.', 'Check the email address and code. Request a new code if needed and use the most recent one.']],
  invalid_credentials: [
    ['邮箱或密码不正确', '服务器没有接受这组登录信息。', '检查邮箱、密码和大小写；忘记密码时使用“忘记密码”找回。'],
    ['The email or password is incorrect', 'The server did not accept these sign-in details.', 'Check your email address, password and letter case. Use “Forgot password” if needed.']],
  over_email_send_rate_limit: [
    ['邮件发送次数暂时达到上限', '发信服务限制了当前时段的邮件数量，新的邮件暂时无法发送。', '等待额度恢复后重试，勿连续点击发送；长期无法发送时联系开发者。'],
    ['The email sending limit has been reached', 'The email service limits how many messages can be sent in a period. Another email cannot be sent yet.', 'Wait for the limit to reset before retrying. Avoid repeated clicks and contact support if it persists.']],
  email_address_invalid: [
    ['这个邮箱地址无法使用', '服务器没有接受此邮箱地址，可能是格式或邮箱域名不受支持。', '检查是否输入完整、有效的邮箱地址，然后重试。'],
    ['This email address cannot be used', 'The server rejected the address. Its format or domain may not be supported.', 'Check that you entered a complete, valid email address, then retry.']],
  weak_password: [
    ['密码不符合安全要求', '服务器认为新密码过于简单或未满足密码规则。', '请设置更长且不常见的密码，并避免使用姓名、邮箱或连续数字。'],
    ['The password does not meet security requirements', 'The server considers the new password too weak or outside its password rules.', 'Choose a longer, less common password and avoid names, email addresses or consecutive digits.']],
  same_password: [
    ['新密码不能与原密码相同', '服务器要求本次重置使用一个不同的密码。', '输入一个新的密码后再次提交。'],
    ['The new password must differ from the old one', 'The server requires a different password for this reset.', 'Enter a new password and submit again.']],
  AUTH_REQUEST_FAILED: [
    ['账户操作未能完成', '服务器拒绝了本次请求，但应用尚不能确定具体原因。', '检查填写内容并更新应用；仍失败时联系开发者，并说明你正在注册、登录还是找回密码。'],
    ['The account operation could not be completed', 'The server rejected this request, but the app cannot determine the exact reason yet.', 'Check your entries and update the app. If it persists, contact support and describe whether you were registering, signing in or resetting a password.']],
  CLOUD_QUOTA_EXCEEDED: [
    ['云端空间不足', '每个账户最多使用 5 MB 云空间，本次上传将超过剩余额度。', '先移除不需要的云端文件再上传；本地文档仍可继续使用。'],
    ['There is not enough cloud storage', 'Each account has 5 MB of cloud storage, and this upload exceeds the remaining quota.', 'Remove cloud files you no longer need, then upload again. Local documents remain available.']],
};

export function cloudErrorMessage(code: string, language: string = 'zh-CN') {
  const value = messages[code]?.[language === 'en' ? 1 : 0];
  if (!value) return undefined;
  const action = value[2].replace(/联系开发者|contact support/gi, label => language === 'en'
    ? `${label} (2280810215@qq.com)`
    : `${label}（2280810215@qq.com）`);
  return language === 'en'
    ? `${value[0]}\nReason: ${value[1]}\nWhat to do: ${action}`
    : `${value[0]}\n原因说明：${value[1]}\n处理方法：${action}`;
}
