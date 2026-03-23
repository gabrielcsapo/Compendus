"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const TYPE_STYLES: Record<ToastType, { bg: string; icon: string; iconClass: string }> = {
  success: {
    bg: "bg-success-light border-success/30",
    icon: "M5 13l4 4L19 7",
    iconClass: "text-success",
  },
  error: {
    bg: "bg-danger-light border-danger/30",
    icon: "M6 18L18 6M6 6l12 12",
    iconClass: "text-danger",
  },
  warning: {
    bg: "bg-warning-light border-warning/30",
    icon: "M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
    iconClass: "text-warning",
  },
  info: {
    bg: "bg-surface border-border",
    icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    iconClass: "text-primary",
  },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const styles = TYPE_STYLES[toast.type];
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm text-foreground ${styles.bg}`}
      role="alert"
    >
      <svg
        className={`w-4 h-4 mt-0.5 shrink-0 ${styles.iconClass}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={styles.icon} />
      </svg>
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 text-foreground-muted hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function GlobalToastPanel({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info", duration = 4000) => {
      const id = `toast-${++counter}`;
      setToasts((prev) => [...prev, { id, message, type }]);
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <GlobalToastPanel toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
