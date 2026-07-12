/**
 * Business context: GeoAdmin information layers expose localized HTML popup
 * fragments. This module keeps their useful text, tables, links, and images
 * while removing executable markup before React renders the content.
 */

/**
 * Converts one URL from official popup markup into a safe absolute HTTP URL.
 *
 * @param value - Raw attribute value returned by GeoAdmin.
 * @returns Safe absolute URL, or `null` when the protocol is not allowed.
 */
function normalizeSafeUrl(value: string): string | null {
  if (!value.trim()) {
    return null;
  }

  try {
    const url = new URL(value, 'https://api3.geo.admin.ch/');
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Removes executable markup while retaining readable official information.
 *
 * @param html - Raw HTML returned by a GeoAdmin popup endpoint.
 * @returns Sanitized HTML suitable for a project-owned information panel.
 */
export function sanitizeGeoAdminPopupHtml(html: string): string {
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const allowedTags = new Set([
    'A',
    'B',
    'BR',
    'DIV',
    'EM',
    'H1',
    'H2',
    'H3',
    'H4',
    'I',
    'IMG',
    'LI',
    'OL',
    'P',
    'SPAN',
    'STRONG',
    'TABLE',
    'TBODY',
    'TD',
    'TH',
    'THEAD',
    'TR',
    'UL',
  ]);
  const blockedTags = new Set([
    'BUTTON',
    'EMBED',
    'FORM',
    'IFRAME',
    'INPUT',
    'OBJECT',
    'SCRIPT',
    'STYLE',
  ]);
  const allowedClasses = new Set([
    'htmlpopup-container',
    'htmlpopup-header',
    'htmlpopup-content',
    'cell-left',
  ]);

  // Process deepest nodes first so unwrapping an unknown container preserves
  // already-sanitized descendants and the official table structure.
  const elements = Array.from(documentNode.body.querySelectorAll('*')).reverse();

  for (const element of elements) {
    if (blockedTags.has(element.tagName)) {
      element.remove();
      continue;
    }

    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    const originalClassName = element.getAttribute('class') ?? '';
    const originalHref = element.getAttribute('href') ?? '';
    const originalSrc = element.getAttribute('src') ?? '';
    const originalAlt = element.getAttribute('alt') ?? '';

    for (const attribute of Array.from(element.attributes)) {
      element.removeAttribute(attribute.name);
    }

    if (originalClassName) {
      const safeClasses = originalClassName
        .split(/\s+/)
        .filter((className) => allowedClasses.has(className));

      if (safeClasses.length > 0) {
        element.setAttribute('class', safeClasses.join(' '));
      }
    }

    if (element instanceof HTMLAnchorElement) {
      const href = normalizeSafeUrl(originalHref);

      if (href) {
        element.href = href;
        element.target = '_blank';
        element.rel = 'noopener noreferrer';
      }
    }

    if (element instanceof HTMLImageElement) {
      const src = normalizeSafeUrl(originalSrc);

      if (src) {
        element.src = src;
        element.alt = originalAlt;
      } else {
        element.remove();
      }
    }
  }

  return documentNode.body.innerHTML.trim();
}
