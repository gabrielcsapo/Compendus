"use client";

import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";

interface EditorPaneProps {
  content: string;
  filePath: string;
  isDark: boolean;
  onChange: (newContent: string) => void;
}

function getLanguageExtension(path: string) {
  if (path.endsWith(".xhtml") || path.endsWith(".html") || path.endsWith(".htm")) {
    return html();
  }
  if (path.endsWith(".css")) {
    return css();
  }
  if (path.endsWith(".opf") || path.endsWith(".ncx") || path.endsWith(".xml")) {
    return xml();
  }
  // Default to XML for unknown types in an EPUB context
  return xml();
}

function EditorPane({ content, filePath, isDark, onChange }: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  // Keep callback ref current without recreating the editor
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Destroy previous editor
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const extensions = [
      basicSetup,
      getLanguageExtension(filePath),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px" },
        ".cm-scroller": { fontFamily: "'JetBrains Mono', monospace", overflow: "auto" },
        ".cm-content": { padding: "8px 0" },
      }),
      EditorView.lineWrapping,
    ];

    if (isDark) {
      extensions.push(oneDark);
    }

    const startState = EditorState.create({
      doc: content,
      extensions,
    });

    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [filePath, isDark]); // Recreate when file or theme changes

  // Update content when it changes externally (e.g., switching files)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: content },
      });
    }
  }, [content]);

  return (
    <div ref={containerRef} className="flex-1 min-w-0 overflow-hidden [&_.cm-editor]:h-full" />
  );
}

export default EditorPane;
