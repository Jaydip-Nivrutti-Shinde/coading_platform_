export function apiErrorMessage(error, fallback = 'Request failed') {
  const data = error?.response?.data;
  if (typeof data === 'string' && data.trim() && !data.startsWith('<')) return data;
  return data?.message || data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || fallback;
}
