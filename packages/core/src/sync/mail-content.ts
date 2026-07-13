import sanitizeHtml from "sanitize-html";

/**
 * Serverseitige Bereinigung von HTML-Mails. Skripte/Event-Handler werden
 * entfernt; das Rendering passiert zusätzlich in einem sandboxed iframe,
 * das Remote-Inhalte erst nach Klick lädt.
 */
export function sanitizeMailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img",
      "h1",
      "h2",
      "center",
      "font",
      "u",
      "style",
    ],
    allowedAttributes: {
      "*": ["style", "align", "valign", "width", "height", "bgcolor", "color", "border", "cellpadding", "cellspacing"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "border"],
      font: ["face", "size", "color"],
    },
    allowedSchemes: ["http", "https", "mailto", "cid", "data"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
      }),
    },
  });
}

export function buildSnippet(text: string | null, maxLen = 200): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().slice(0, maxLen);
}
