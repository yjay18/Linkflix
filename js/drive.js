/* ================= Google Drive helpers ================= */

export function driveFileId(link) {
  const m = String(link || '').match(/\/file\/d\/([\w-]{10,})/) ||
            String(link || '').match(/[?&]id=([\w-]{10,})/);
  return m ? m[1] : null;
}

export function embedUrl(link) {
  const id = driveFileId(link);
  return id ? `https://drive.google.com/file/d/${id}/preview` : link;
}
