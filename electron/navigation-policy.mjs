function parsedUrl(value) {
  try { return new URL(String(value)); }
  catch { return null; }
}

export function isAllowedAppNavigation(url, allowedOrigin) {
  const candidate = parsedUrl(url);
  const allowed = parsedUrl(allowedOrigin);
  if (!candidate || !allowed) return false;
  if (!/^https?:$/.test(candidate.protocol) || !/^https?:$/.test(allowed.protocol)) return false;
  if (candidate.username || candidate.password || allowed.username || allowed.password) return false;
  return candidate.origin === allowed.origin;
}

export function isAllowedExternalUrl(url) {
  const candidate = parsedUrl(url);
  if (!candidate || candidate.username || candidate.password) return false;
  return candidate.protocol === "https:" || candidate.protocol === "http:" || candidate.protocol === "mailto:";
}
