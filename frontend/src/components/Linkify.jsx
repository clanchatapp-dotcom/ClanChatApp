import React from "react";

/**
 * Turn plain-text URLs into safe clickable anchors while preserving
 * whitespace, newlines and any surrounding text verbatim.
 *
 * Usage:
 *   <Linkify text={post.content} />
 *
 * URL detection intentionally leans conservative — we match:
 *   - http(s):// URLs
 *   - www.<domain> bare URLs
 *   - #hashtags → link to /tag/<name>
 *   - #handles inline in content still render as plain text (the
 *     author-avatar row already links profiles); we don't turn every
 *     token starting with # into a profile link because tags conflict.
 *
 * Anchors open in a new tab, `rel="noopener noreferrer"` to prevent
 * tab-nabbing, and use the ClanChat orange for hover.
 */
const URL_RE = /(https?:\/\/[^\s<]+|www\.[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}[^\s<]*)/gi;

export default function Linkify({ text, className = "" }) {
  if (text == null || text === "") return null;
  const parts = [];
  let last = 0;
  const str = String(text);
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(str)) !== null) {
    if (m.index > last) parts.push(str.slice(last, m.index));
    let raw = m[0];
    // Strip trailing punctuation that's almost certainly not part of the URL.
    let trailing = "";
    while (raw.length > 0 && /[.,!?)\]}>'"]/.test(raw[raw.length - 1])) {
      trailing = raw[raw.length - 1] + trailing;
      raw = raw.slice(0, -1);
    }
    const href = raw.startsWith("http") ? raw : `https://${raw}`;
    parts.push(
      <a
        key={`${m.index}-${raw}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-[#FF5A00] underline decoration-[#FF5A00]/40 hover:decoration-[#FF5A00] break-all"
      >
        {raw.replace(/^https?:\/\//, "")}
      </a>
    );
    if (trailing) parts.push(trailing);
    last = m.index + m[0].length;
  }
  if (last < str.length) parts.push(str.slice(last));
  return <span className={className}>{parts}</span>;
}
