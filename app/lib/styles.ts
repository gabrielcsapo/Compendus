/**
 * Shared Tailwind class compositions for common UI patterns.
 * Replaces the @utility blocks previously in paper.css.
 * Design tokens (colors, shadows, etc.) remain in styles.css via @theme.
 */

// ── Buttons ──────────────────────────────────────────────────────

export const buttonStyles = {
  base: [
    "inline-flex items-center justify-center gap-2 cursor-pointer",
    "bg-surface border border-btn-border rounded-lg",
    "px-4 py-2.5 text-sm font-medium",
    "shadow-btn",
    "transition-all duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]",
    "hover:shadow-btn-hover hover:-translate-y-px hover:border-border-hover",
    "active:translate-y-0 active:shadow-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none",
  ].join(" "),

  primary:
    "!bg-primary !text-white !border-primary hover:!bg-primary-hover hover:!border-primary-hover",

  secondary:
    "!border-secondary !text-secondary hover:!bg-secondary hover:!text-white",

  ghost:
    "!bg-transparent !border-transparent !shadow-none hover:!bg-surface-elevated hover:!shadow-none hover:!translate-y-0",

  danger: "!border-danger !text-white !bg-danger hover:!bg-danger/90",
} as const;

// ── Badges ───────────────────────────────────────────────────────

export const badgeStyles = {
  base: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",

  primary: "bg-primary-light text-primary border border-primary/20",
  success: "bg-success-light text-success border border-success/20",
  warning: "bg-warning-light text-warning border border-warning/20",
  danger: "bg-danger-light text-danger border border-danger/20",
  neutral: "bg-surface-elevated text-foreground-muted border border-border",
  secondary: "bg-secondary-light text-secondary border border-secondary/20",
} as const;

// ── Form Elements ────────────────────────────────────────────────

export const inputStyles = [
  "w-full px-4 py-2.5 rounded-lg",
  "bg-surface border border-border",
  "text-foreground placeholder:text-foreground-muted",
  "transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]",
  "focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary-light",
  "disabled:bg-surface-elevated disabled:opacity-60 disabled:cursor-not-allowed",
].join(" ");

// ── Paper / Card ─────────────────────────────────────────────────

export const paperStyles = [
  "bg-paper-background border border-paper-border rounded-xl p-6",
  "shadow-paper",
  "transition-[box-shadow,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
].join(" ");

// ── Code Block ───────────────────────────────────────────────────

export const codeBlockStyles =
  "bg-surface-elevated text-foreground p-4 rounded-lg overflow-x-auto text-sm font-mono border border-border";
