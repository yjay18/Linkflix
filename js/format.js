/* ================= Date / meta formatting ================= */

export function formatDate(date) {
  const s = String(date || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

export function formatShowDates(item) {
  if (item?.dates) return item.dates;
  const start = item?.premiered || '';
  const end = item?.ended || '';
  if (start && end) return `${formatDate(start)} - ${formatDate(end)}`;
  if (start && item?.status && !/ended/i.test(item.status))
    return `${formatDate(start)} - ${item.status}`;
  return start ? formatDate(start) : '';
}

export function episodeMeta(ep) {
  return [ep.airdate && formatDate(ep.airdate), ep.subtitle].filter(Boolean).join(' · ');
}
