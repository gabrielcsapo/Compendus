"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface ReadAloudBarProps {
  htmlContent: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onPageComplete: () => void;
  isActive: boolean;
  onClose: () => void;
  theme: {
    background: string;
    foreground: string;
    muted: string;
    accent: string;
  };
}

export function ReadAloudBar({
  htmlContent,
  contentRef,
  onPageComplete,
  isActive,
  onClose,
  theme,
}: ReadAloudBarProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(() => {
    if (typeof window === "undefined") return 1;
    const stored = localStorage.getItem("tts-speed");
    return stored ? parseFloat(stored) : 1;
  });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("tts-voice") || "";
  });
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const sentencesRef = useRef<string[]>([]);
  const isSpeakingRef = useRef(false);

  // Load available voices
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      setVoices(available);
      if (!selectedVoiceURI && available.length > 0) {
        const english = available.find((v) => v.lang.startsWith("en"));
        setSelectedVoiceURI(english?.voiceURI || available[0].voiceURI);
      }
    };

    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  // Extract sentences from HTML content
  useEffect(() => {
    const div = document.createElement("div");
    div.innerHTML = htmlContent;
    const text = div.textContent || "";
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    sentencesRef.current = sentences.map((s) => s.trim()).filter(Boolean);
    setCurrentSentenceIndex(0);
  }, [htmlContent]);

  // Persist preferences
  useEffect(() => {
    localStorage.setItem("tts-speed", speed.toString());
  }, [speed]);

  useEffect(() => {
    if (selectedVoiceURI) {
      localStorage.setItem("tts-voice", selectedVoiceURI);
    }
  }, [selectedVoiceURI]);

  // Highlight current sentence in DOM
  useEffect(() => {
    if (!contentRef.current) return;

    // Remove previous TTS highlights
    removeTTSHighlights(contentRef.current);

    if (isPlaying && currentSentenceIndex < sentencesRef.current.length) {
      const sentence = sentencesRef.current[currentSentenceIndex];
      highlightSentenceInDOM(contentRef.current, sentence, theme.accent);
    }
  }, [currentSentenceIndex, isPlaying, theme.accent]);

  // Cleanup on unmount or close
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      if (contentRef.current) {
        removeTTSHighlights(contentRef.current);
      }
    };
  }, []);

  const speakSentence = useCallback(
    (index: number) => {
      if (!window.speechSynthesis) return;

      if (index >= sentencesRef.current.length) {
        setIsPlaying(false);
        isSpeakingRef.current = false;
        setCurrentSentenceIndex(0);
        if (contentRef.current) removeTTSHighlights(contentRef.current);
        onPageComplete();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(sentencesRef.current[index]);
      utterance.rate = speed;

      const voice = voices.find((v) => v.voiceURI === selectedVoiceURI);
      if (voice) utterance.voice = voice;

      utterance.onend = () => {
        if (!isSpeakingRef.current) return;
        const next = index + 1;
        setCurrentSentenceIndex(next);
        speakSentence(next);
      };

      utterance.onerror = (e) => {
        if (e.error !== "canceled") {
          console.error("TTS error:", e);
          setIsPlaying(false);
          isSpeakingRef.current = false;
        }
      };

      window.speechSynthesis.speak(utterance);
    },
    [speed, selectedVoiceURI, voices, onPageComplete],
  );

  const play = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsPlaying(true);
    isSpeakingRef.current = true;
    speakSentence(currentSentenceIndex);
  }, [currentSentenceIndex, speakSentence]);

  const pause = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsPlaying(false);
    isSpeakingRef.current = false;
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsPlaying(false);
    isSpeakingRef.current = false;
    setCurrentSentenceIndex(0);
    if (contentRef.current) removeTTSHighlights(contentRef.current);
  }, []);

  const handleClose = useCallback(() => {
    stop();
    onClose();
  }, [stop, onClose]);

  if (!isActive) return null;

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 rounded-full shadow-lg border"
      style={{
        backgroundColor: theme.background,
        borderColor: `${theme.foreground}20`,
      }}
    >
      {/* Play/Pause */}
      <button
        onClick={isPlaying ? pause : play}
        className="p-1.5 rounded-full hover:bg-black/10 transition-colors"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Stop */}
      <button
        onClick={stop}
        className="p-1.5 rounded-full hover:bg-black/10 transition-colors"
        aria-label="Stop"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 6h12v12H6z" />
        </svg>
      </button>

      {/* Speed */}
      <select
        value={speed}
        onChange={(e) => setSpeed(parseFloat(e.target.value))}
        className="text-xs bg-transparent border rounded px-1.5 py-1 appearance-none cursor-pointer"
        style={{ borderColor: `${theme.foreground}20`, color: theme.foreground }}
      >
        {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>

      {/* Voice selector */}
      {voices.length > 0 && (
        <select
          value={selectedVoiceURI}
          onChange={(e) => setSelectedVoiceURI(e.target.value)}
          className="text-xs bg-transparent border rounded px-1.5 py-1 max-w-28 truncate appearance-none cursor-pointer"
          style={{ borderColor: `${theme.foreground}20`, color: theme.foreground }}
        >
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name}
            </option>
          ))}
        </select>
      )}

      {/* Close */}
      <button
        onClick={handleClose}
        className="p-1.5 rounded-full hover:bg-black/10 transition-colors"
        aria-label="Close read aloud"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

function removeTTSHighlights(container: HTMLElement) {
  container.querySelectorAll(".tts-highlight").forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent || ""), el);
      parent.normalize();
    }
  });
}

function highlightSentenceInDOM(
  container: HTMLElement,
  sentence: string,
  accentColor: string,
) {
  const trimmed = sentence.trim();
  if (!trimmed) return;

  // Use a prefix of the sentence for matching (handles minor whitespace differences)
  const searchPrefix = trimmed.substring(0, Math.min(30, trimmed.length));

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; startInNode: number; endInNode: number }[] = [];
  let searchStarted = false;
  let remaining = trimmed;

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const nodeText = node.textContent || "";

    if (!searchStarted) {
      const idx = nodeText.indexOf(searchPrefix.substring(0, Math.min(20, searchPrefix.length)));
      if (idx !== -1) {
        searchStarted = true;
        const endInNode = Math.min(nodeText.length, idx + remaining.length);
        nodes.push({ node, startInNode: idx, endInNode });
        remaining = remaining.substring(endInNode - idx);
        if (remaining.length === 0) break;
      }
    } else {
      const endInNode = Math.min(nodeText.length, remaining.length);
      nodes.push({ node, startInNode: 0, endInNode });
      remaining = remaining.substring(endInNode);
      if (remaining.length === 0) break;
    }
  }

  // Wrap found ranges (iterate in reverse to preserve node positions)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const { node: textNode, startInNode, endInNode } = nodes[i];
    const text = textNode.textContent || "";
    const parent = textNode.parentNode;
    if (!parent) continue;

    const span = document.createElement("span");
    span.className = "tts-highlight";
    span.style.backgroundColor = `${accentColor}25`;
    span.style.borderRadius = "2px";
    span.style.transition = "background-color 0.2s ease";

    if (startInNode === 0 && endInNode === text.length) {
      parent.replaceChild(span, textNode);
      span.appendChild(textNode);
    } else {
      const frag = document.createDocumentFragment();
      if (startInNode > 0) {
        frag.appendChild(document.createTextNode(text.substring(0, startInNode)));
      }
      span.textContent = text.substring(startInNode, endInNode);
      frag.appendChild(span);
      if (endInNode < text.length) {
        frag.appendChild(document.createTextNode(text.substring(endInNode)));
      }
      parent.replaceChild(frag, textNode);
    }
  }
}
