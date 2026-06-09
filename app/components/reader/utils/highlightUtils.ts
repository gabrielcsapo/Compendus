import type { ReaderHighlight } from "@/lib/reader/types";

export interface SelectionPositions {
  startPosition: number;
  endPosition: number;
  text: string;
}

/**
 * Convert a browser text selection to normalized 0-1 positions within a page.
 * Uses TreeWalker to count character offsets within the content element.
 */
export function selectionToPositions(
  contentEl: HTMLElement,
  pagePosition: number,
  pageEndPosition: number,
): SelectionPositions | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const text = selection.toString().trim();
  if (text.length === 0) return null;

  // Verify selection is within our content
  if (!contentEl.contains(range.commonAncestorContainer)) {
    return null;
  }

  const totalChars = contentEl.textContent?.length || 0;
  if (totalChars === 0) return null;

  // Walk text nodes to find character offsets
  const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
  let charCount = 0;
  let selectionStartChar = -1;
  let selectionEndChar = -1;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const nodeLength = node.textContent?.length || 0;

    // Check if this node contains the selection start
    if (node === range.startContainer) {
      selectionStartChar = charCount + range.startOffset;
    }

    // Check if this node contains the selection end
    if (node === range.endContainer) {
      selectionEndChar = charCount + range.endOffset;
      break;
    }

    charCount += nodeLength;
  }

  if (selectionStartChar === -1 || selectionEndChar === -1) {
    return null;
  }

  // Interpolate to 0-1 positions within the page range
  const pageSpan = pageEndPosition - pagePosition;
  const startPosition = pagePosition + (selectionStartChar / totalChars) * pageSpan;
  const endPosition = pagePosition + (selectionEndChar / totalChars) * pageSpan;

  return { startPosition, endPosition, text };
}

/**
 * Apply highlight marks to the DOM for highlights that overlap the current page.
 * Wraps matching text ranges in <mark> elements with highlight styling.
 */
export function applyHighlightsToDOM(
  contentEl: HTMLElement,
  highlights: ReaderHighlight[],
  pagePosition: number,
  pageEndPosition: number,
): void {
  // First clear any existing marks
  clearHighlightMarks(contentEl);

  const totalChars = contentEl.textContent?.length || 0;
  if (totalChars === 0) return;

  const pageSpan = pageEndPosition - pagePosition;
  if (pageSpan <= 0) return;

  // Filter to highlights that overlap this page
  const overlapping = highlights.filter(
    (h) => h.startPosition < pageEndPosition && h.endPosition > pagePosition,
  );

  if (overlapping.length === 0) return;

  // Sort by start position so we process them in order
  const sorted = [...overlapping].sort((a, b) => a.startPosition - b.startPosition);

  for (const highlight of sorted) {
    // Clamp to page bounds
    const clampedStart = Math.max(highlight.startPosition, pagePosition);
    const clampedEnd = Math.min(highlight.endPosition, pageEndPosition);

    // Convert to character offsets
    const startChar = Math.floor(((clampedStart - pagePosition) / pageSpan) * totalChars);
    const endChar = Math.ceil(((clampedEnd - pagePosition) / pageSpan) * totalChars);

    if (startChar >= endChar) continue;

    wrapCharRange(contentEl, startChar, endChar, highlight.id, highlight.color);
  }
}

/**
 * Remove all highlight marks from the DOM, restoring original text nodes.
 */
function clearHighlightMarks(contentEl: HTMLElement): void {
  const marks = contentEl.querySelectorAll("[data-highlight-id]");
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (parent) {
      // Replace mark with its text content
      const textNode = document.createTextNode(mark.textContent || "");
      parent.replaceChild(textNode, mark);
      // Normalize to merge adjacent text nodes
      parent.normalize();
    }
  }
}

/**
 * Wrap a character range within a content element in <mark> elements.
 * Handles ranges that span multiple text nodes and elements.
 */
function wrapCharRange(
  contentEl: HTMLElement,
  startChar: number,
  endChar: number,
  highlightId: string,
  color: string,
): void {
  const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
  let charCount = 0;
  let node: Text | null;
  const nodesToWrap: Array<{ node: Text; start: number; end: number }> = [];

  while ((node = walker.nextNode() as Text | null)) {
    const nodeLength = node.textContent?.length || 0;
    const nodeStart = charCount;
    const nodeEnd = charCount + nodeLength;

    // Check if this text node overlaps with our target range
    if (nodeEnd > startChar && nodeStart < endChar) {
      const wrapStart = Math.max(0, startChar - nodeStart);
      const wrapEnd = Math.min(nodeLength, endChar - nodeStart);
      nodesToWrap.push({ node, start: wrapStart, end: wrapEnd });
    }

    charCount += nodeLength;
    if (charCount >= endChar) break;
  }

  // Wrap the identified ranges (process in reverse to preserve node positions)
  for (let i = nodesToWrap.length - 1; i >= 0; i--) {
    const { node: textNode, start, end } = nodesToWrap[i];
    wrapTextNode(textNode, start, end, highlightId, color);
  }
}

/**
 * Wrap a portion of a text node in a <mark> element.
 */
function wrapTextNode(
  textNode: Text,
  start: number,
  end: number,
  highlightId: string,
  color: string,
): void {
  const text = textNode.textContent || "";
  if (start >= end || start >= text.length) return;

  // Split the text node if needed
  const parent = textNode.parentNode;
  if (!parent) return;

  // Don't wrap if already inside a highlight mark
  if ((parent as HTMLElement).hasAttribute?.("data-highlight-id")) return;

  const mark = document.createElement("mark");
  mark.setAttribute("data-highlight-id", highlightId);
  mark.className = "reader-highlight";
  mark.style.backgroundColor = `${color}40`; // 25% opacity via hex alpha
  mark.style.borderRadius = "2px";

  if (start === 0 && end === text.length) {
    // Wrap the entire text node
    parent.replaceChild(mark, textNode);
    mark.appendChild(textNode);
  } else {
    // Need to split
    const before = text.substring(0, start);
    const middle = text.substring(start, end);
    const after = text.substring(end);

    const frag = document.createDocumentFragment();

    if (before) {
      frag.appendChild(document.createTextNode(before));
    }

    mark.textContent = middle;
    frag.appendChild(mark);

    if (after) {
      frag.appendChild(document.createTextNode(after));
    }

    parent.replaceChild(frag, textNode);
  }
}

/**
 * Calculate the position for the floating highlight toolbar
 * relative to the selection and container.
 */
export function calculateToolbarPosition(
  selectionRect: DOMRect,
  containerRect: DOMRect,
): { x: number; y: number; above: boolean } {
  const TOOLBAR_WIDTH = 210;
  const TOOLBAR_HEIGHT = 44;
  const GAP = 8;

  // Center horizontally on the selection
  let x = selectionRect.left + selectionRect.width / 2 - TOOLBAR_WIDTH / 2;

  // Clamp to container bounds
  x = Math.max(containerRect.left + GAP, Math.min(x, containerRect.right - TOOLBAR_WIDTH - GAP));

  // Place above selection by default
  let y = selectionRect.top - TOOLBAR_HEIGHT - GAP;
  let above = true;

  // If not enough room above, place below
  if (y < containerRect.top + GAP) {
    y = selectionRect.bottom + GAP;
    above = false;
  }

  return { x, y, above };
}
