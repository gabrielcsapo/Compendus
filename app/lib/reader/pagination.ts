import type {
  ViewportConfig,
  NormalizedContent,
  TextContent,
  PdfContent,
  ComicContent,
  AudioContent,
  PageContent,
  TocEntry,
} from "./types";

// Average character width as fraction of font size (empirical value for mixed content)
const AVG_CHAR_WIDTH_RATIO = 0.55;

// Default line height multiplier
const DEFAULT_LINE_HEIGHT = 1.6;

// Default font size in pixels
const DEFAULT_FONT_SIZE = 16;

class PaginationEngine {
  /**
   * Calculate how many "pages" of content exist for given viewport
   */
  calculateTotalPages(content: NormalizedContent, viewport: ViewportConfig): number {
    switch (content.type) {
      case "pdf":
        return content.pageCount;
      case "comic":
        return content.pageCount;
      case "audio":
        // One "page" per chapter for audio
        return content.chapters.length || 1;
      case "text":
        return this.calculateTextPages(content, viewport);
      default:
        return 1;
    }
  }

  /**
   * Calculate text pages based on estimated characters per page
   * For image-based content (0 characters), use one page per chapter
   */
  private calculateTextPages(content: TextContent, viewport: ViewportConfig): number {
    // For image-based content with no text, use one page per chapter
    if (content.totalCharacters === 0 && content.chapters.length > 0) {
      return content.chapters.length;
    }

    const charsPerPage = this.estimateCharsPerPage(viewport);
    if (charsPerPage <= 0) return 1;
    return Math.max(1, Math.ceil(content.totalCharacters / charsPerPage));
  }

  /**
   * Estimate how many characters fit on a page for given viewport
   */
  private estimateCharsPerPage(viewport: ViewportConfig): number {
    const fontSize = viewport.fontSize || DEFAULT_FONT_SIZE;
    const lineHeight = viewport.lineHeight || DEFAULT_LINE_HEIGHT;

    // Account for margins (assume 10% on each side by default)
    const effectiveWidth = viewport.width * 0.8;
    const effectiveHeight = viewport.height * 0.9;

    // Calculate characters per line
    const charWidth = fontSize * AVG_CHAR_WIDTH_RATIO;
    const charsPerLine = Math.floor(effectiveWidth / charWidth);

    // Calculate lines per page
    const lineHeightPx = fontSize * lineHeight;
    const linesPerPage = Math.floor(effectiveHeight / lineHeightPx);

    return charsPerLine * linesPerPage;
  }

  /**
   * Get content for specific page number
   */
  getPage(
    content: NormalizedContent,
    pageNum: number,
    viewport: ViewportConfig,
    bookId: string,
  ): PageContent {
    const totalPages = this.calculateTotalPages(content, viewport);
    const clampedPage = Math.max(1, Math.min(pageNum, totalPages));

    switch (content.type) {
      case "pdf":
        return this.getPdfPage(content, clampedPage, totalPages, bookId);
      case "comic":
        return this.getComicPage(content, clampedPage, totalPages, bookId);
      case "audio":
        return this.getAudioPage(content, clampedPage, totalPages, bookId);
      case "text":
        return this.getTextPage(content, clampedPage, totalPages, viewport);
      default:
        throw new Error(`Unknown content type`);
    }
  }

  /**
   * Get PDF page content - rendered as image on server
   */
  private getPdfPage(
    content: PdfContent,
    pageNum: number,
    totalPages: number,
    bookId: string,
  ): PageContent {
    const position = (pageNum - 1) / Math.max(1, totalPages - 1);
    const endPosition = pageNum / totalPages;

    return {
      type: "image",
      imageUrl: `/api/reader/${bookId}/pdf-page/${pageNum}`,
      position,
      endPosition,
      chapterTitle: this.findChapterTitle(content.toc, position),
    };
  }

  /**
   * Get comic page content
   */
  private getComicPage(
    content: ComicContent,
    pageNum: number,
    totalPages: number,
    bookId: string,
  ): PageContent {
    const position = (pageNum - 1) / Math.max(1, totalPages - 1);
    const endPosition = pageNum / totalPages;
    const format = content.format; // cbr or cbz

    return {
      type: "image",
      imageUrl: `/comic/${bookId}/${format}/page/${pageNum}`,
      position,
      endPosition,
    };
  }

  /**
   * Get audio page content (one page per chapter)
   */
  private getAudioPage(
    content: AudioContent,
    pageNum: number,
    _totalPages: number,
    bookId: string,
  ): PageContent {
    const chapterIndex = pageNum - 1;
    const chapter = content.chapters[chapterIndex] || content.chapters[0];

    const position = chapter ? chapter.startTime / content.duration : 0;
    const endPosition = chapter ? chapter.endTime / content.duration : 1;

    return {
      type: "audio",
      audioUrl: `/books/${bookId}.${content.format}`,
      startTime: chapter?.startTime || 0,
      endTime: chapter?.endTime || content.duration,
      chapter,
      position,
      endPosition,
      chapterTitle: chapter?.title,
    };
  }

  /**
   * Get text page content (EPUB, MOBI)
   */
  private getTextPage(
    content: TextContent,
    pageNum: number,
    _totalPages: number,
    viewport: ViewportConfig,
  ): PageContent {
    // For image-based content (0 characters), each page is one chapter
    if (content.totalCharacters === 0 && content.chapters.length > 0) {
      const chapterIndex = Math.min(pageNum - 1, content.chapters.length - 1);
      const chapter = content.chapters[chapterIndex];
      const position = chapterIndex / Math.max(1, content.chapters.length);
      const endPosition = (chapterIndex + 1) / Math.max(1, content.chapters.length);

      return {
        type: "text",
        html: chapter?.html || "",
        position,
        endPosition,
        chapterTitle: chapter?.title,
      };
    }

    const charsPerPage = this.estimateCharsPerPage(viewport);
    const startChar = (pageNum - 1) * charsPerPage;
    const endChar = startChar + charsPerPage;

    // Find which chapters this page spans
    const { html, chapterTitle } = this.extractTextRange(content, startChar, endChar);

    const position = startChar / content.totalCharacters;
    const endPosition = Math.min(1, endChar / content.totalCharacters);

    return {
      type: "text",
      html,
      position,
      endPosition,
      chapterTitle,
    };
  }

  /**
   * Extract HTML for a character range from chapters
   */
  private extractTextRange(
    content: TextContent,
    startChar: number,
    endChar: number,
  ): { html: string; chapterTitle?: string } {
    const htmlParts: string[] = [];
    let chapterTitle: string | undefined;

    for (const chapter of content.chapters) {
      // Check if this chapter overlaps with our range
      if (chapter.characterEnd < startChar) continue;
      if (chapter.characterStart > endChar) break;

      // Set chapter title from first overlapping chapter
      if (!chapterTitle) {
        chapterTitle = chapter.title;
      }

      // Calculate the portion of this chapter we need
      const chapterStartOffset = Math.max(0, startChar - chapter.characterStart);
      const chapterEndOffset = Math.min(chapter.text.length, endChar - chapter.characterStart);

      // If we need the whole chapter, use the HTML directly
      if (chapterStartOffset === 0 && chapterEndOffset >= chapter.text.length) {
        htmlParts.push(chapter.html);
      } else {
        // For partial chapters, we need to extract a text subset
        // This is a simplified approach - a more sophisticated one would
        // parse the HTML and extract the relevant DOM nodes
        const textSubset = chapter.text.slice(chapterStartOffset, chapterEndOffset);
        htmlParts.push(`<p>${this.escapeHtml(textSubset)}</p>`);
      }
    }

    return {
      html: htmlParts.join("\n"),
      chapterTitle,
    };
  }

  /**
   * Get page number for a given position (0-1)
   */
  getPageForPosition(
    content: NormalizedContent,
    position: number,
    viewport: ViewportConfig,
  ): number {
    const totalPages = this.calculateTotalPages(content, viewport);
    const clampedPosition = Math.max(0, Math.min(1, position));

    switch (content.type) {
      case "pdf":
      case "comic":
        // Direct mapping for page-based formats
        return Math.max(1, Math.ceil(clampedPosition * totalPages));

      case "audio": {
        // Find chapter by time position
        const time = clampedPosition * content.duration;
        const chapterIndex = content.chapters.findIndex(
          (ch) => time >= ch.startTime && time < ch.endTime,
        );
        return chapterIndex >= 0 ? chapterIndex + 1 : 1;
      }

      case "text": {
        // For image-based content (0 characters), map position to chapter
        if (content.totalCharacters === 0 && content.chapters.length > 0) {
          return Math.max(1, Math.ceil(clampedPosition * content.chapters.length));
        }

        // Map position to character, then to page
        const charPosition = Math.floor(clampedPosition * content.totalCharacters);
        const charsPerPage = this.estimateCharsPerPage(viewport);
        return Math.max(1, Math.ceil(charPosition / charsPerPage));
      }

      default:
        return 1;
    }
  }

  /**
   * Convert TOC entries to have page numbers for current viewport
   */
  calculateTocPageNumbers(
    content: NormalizedContent,
    toc: TocEntry[],
    viewport: ViewportConfig,
  ): TocEntry[] {
    return toc.map((entry) => ({
      ...entry,
      pageNum: this.getPageForPosition(content, entry.position, viewport),
      children: entry.children
        ? this.calculateTocPageNumbers(content, entry.children, viewport)
        : undefined,
    }));
  }

  /**
   * Search content and return results with page numbers
   */
  searchContent(
    content: NormalizedContent,
    query: string,
    viewport: ViewportConfig,
    maxResults = 50,
  ): Array<{
    text: string;
    context: string;
    position: number;
    pageNum: number;
    chapterTitle?: string;
  }> {
    if (content.type !== "text") {
      // Only text content is searchable
      return [];
    }

    const results: Array<{
      text: string;
      context: string;
      position: number;
      pageNum: number;
      chapterTitle?: string;
    }> = [];

    const lowerQuery = query.toLowerCase();
    const contextChars = 50;

    for (const chapter of content.chapters) {
      const lowerText = chapter.text.toLowerCase();
      let searchIndex = 0;

      while (results.length < maxResults) {
        const foundIndex = lowerText.indexOf(lowerQuery, searchIndex);
        if (foundIndex === -1) break;

        const absolutePosition = chapter.characterStart + foundIndex;
        const position = absolutePosition / content.totalCharacters;

        // Extract context around the match
        const contextStart = Math.max(0, foundIndex - contextChars);
        const contextEnd = Math.min(chapter.text.length, foundIndex + query.length + contextChars);
        const context = chapter.text.slice(contextStart, contextEnd);

        results.push({
          text: chapter.text.slice(foundIndex, foundIndex + query.length),
          context:
            (contextStart > 0 ? "..." : "") +
            context +
            (contextEnd < chapter.text.length ? "..." : ""),
          position,
          pageNum: this.getPageForPosition(content, position, viewport),
          chapterTitle: chapter.title,
        });

        searchIndex = foundIndex + 1;
      }

      if (results.length >= maxResults) break;
    }

    return results;
  }

  /**
   * Find chapter title for a given position
   */
  private findChapterTitle(toc: TocEntry[], position: number): string | undefined {
    let lastTitle: string | undefined;

    for (const entry of toc) {
      if (entry.position <= position) {
        lastTitle = entry.title;
      } else {
        break;
      }

      if (entry.children) {
        const childTitle = this.findChapterTitle(entry.children, position);
        if (childTitle) lastTitle = childTitle;
      }
    }

    return lastTitle;
  }

  /**
   * Escape HTML entities
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

// Singleton instance
export const paginationEngine = new PaginationEngine();
