"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface YAMLEditorProps {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly className?: string;
  readonly readOnly?: boolean;
}

// CodeMirror 6 is loaded dynamically to avoid SSR issues with its DOM dependencies
async function createEditorView(
  container: HTMLElement,
  initialValue: string,
  onChange: (v: string) => void,
  readOnly: boolean
) {
  try {
    const [
      { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine },
      { EditorState },
      { defaultKeymap, indentWithTab, history, historyKeymap },
      { yaml: langYaml },
      { syntaxHighlighting, defaultHighlightStyle },
      { closeBrackets, closeBracketsKeymap },
      { autocompletion, completionKeymap },
      { lintKeymap },
    ] = await Promise.all([
      import("@codemirror/view"),
      import("@codemirror/state"),
      import("@codemirror/commands"),
      import("@codemirror/lang-yaml"),
      import("@codemirror/language"),
      import("@codemirror/autocomplete"),
      import("@codemirror/autocomplete"),
      import("@codemirror/lint"),
    ]);

    // Resolve design tokens at editor-init time to keep theme in sync with CSS vars
    const css = getComputedStyle(document.documentElement);
    const tok = (v: string) => css.getPropertyValue(v).trim();

    const swarmxTheme = EditorView.theme(
      {
        "&": {
          background: tok("--color-bg-surface"),
          color: tok("--color-text-primary"),
          fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
          fontSize: "12px",
          height: "100%",
        },
        ".cm-content": { caretColor: tok("--color-accent"), padding: "8px 0" },
        ".cm-cursor": { borderLeftColor: tok("--color-accent") },
        ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
        ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.03)" },
        ".cm-gutters": { background: tok("--color-bg-elevated"), borderRight: `1px solid ${tok("--color-border")}`, color: "#4a4a6a" },
        ".cm-lineNumbers .cm-gutterElement": { paddingLeft: "8px", paddingRight: "12px" },
        ".cm-selectionBackground": { backgroundColor: tok("--color-selection-bg") },
        "&.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(0,255,136,0.22)" },
        ".cm-matchingBracket": { outline: `1px solid ${tok("--color-accent")}`, background: "transparent" },
        ".cm-tooltip": { background: tok("--color-bg-elevated"), border: `1px solid ${tok("--color-border")}` },
        ".cm-completionLabel": { fontFamily: "inherit" },
      },
      { dark: true }
    );

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        closeBrackets(),
        autocompletion(),
        langYaml(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        swarmxTheme,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
        ...(readOnly ? [EditorState.readOnly.of(true)] : []),
      ],
    });

    return new EditorView({ state, parent: container });
  } catch {
    // CodeMirror not installed — fallback textarea
    return null;
  }
}

export function YAMLEditor({ value, onChange, className, readOnly = false }: YAMLEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<{ destroy: () => void; dispatch: (tr: unknown) => void; state: { doc: { toString: () => string } } } | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Mount CodeMirror
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let view: Awaited<ReturnType<typeof createEditorView>> = null;

    createEditorView(
      containerRef.current,
      value,
      (v) => onChangeRef.current(v),
      readOnly
    ).then((v) => {
      if (cancelled) { v?.destroy(); return; }
      view = v;
      viewRef.current = v as typeof viewRef.current;
    });

    return () => {
      cancelled = true;
      view?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "overflow-auto bg-bg-surface rounded",
        "[&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto",
        className
      )}
    />
  );
}
