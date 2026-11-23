/**
 * Render one line of chat text (user input or AI output) as safe HTML.
 * Everything is HTML-escaped first, so text like <img src=x onerror=...>
 * coming from a user, an uploaded file or the LLM can no longer run script.
 * Then a small subset of markdown is applied: **bold**, `code`, # headings, bullets.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderLine(line: string): string {
  let html = escapeHtml(line);
  html = html.replace(/^#{1,6}\s+(.*)$/, "<strong>$1</strong>");
  html = html.replace(/^\s*[-*]\s+/, "• ");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /`([^`]+?)`/g,
    "<code style='background:#EEF0F5;padding:1px 4px;border-radius:3px;font-size:0.85em'>$1</code>"
  );
  return html;
}
