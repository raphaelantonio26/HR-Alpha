import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Inbox,
  Lock,
  Minus,
  RefreshCw,
  ShieldOff,
  type LucideIcon,
} from "lucide-react";

/**
 * A container card. Static by default (containers should not move under the
 * cursor); pass `interactive` to opt into the hover-lift for clickable cards.
 * `icon` renders a small brand glyph beside the title.
 */
export function Card({
  title,
  action,
  icon: Icon,
  interactive = false,
  children,
}: {
  title?: string;
  action?: ReactNode;
  icon?: LucideIcon;
  interactive?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-card border border-line bg-surface shadow-card ${interactive ? "u-lift cursor-pointer" : ""}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-tightish text-ink">
            {Icon && <Icon className="text-brand-navy" size={15} strokeWidth={2.25} aria-hidden />}
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A KPI tile. Optional directional trend (navy/green/red) + delta label. */
export function Stat({
  label,
  value,
  hint,
  trend,
  delta,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: "up" | "down" | "flat";
  delta?: string;
}) {
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  const trendTone = trend === "up" ? "text-good" : trend === "down" ? "text-bad" : "text-muted";
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="text-2xs font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-bold tracking-tightish text-ink">{value}</div>
        {trend && delta && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${trendTone}`}>
            <TrendIcon size={13} strokeWidth={2.5} aria-hidden />
            {delta}
          </span>
        )}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Pill({ tone = "muted", children }: { tone?: "good" | "warn" | "bad" | "muted" | "brand"; children: ReactNode }) {
  const map: Record<string, string> = {
    good: "bg-good/10 text-good",
    warn: "bg-warn/10 text-warn",
    bad: "bg-bad/10 text-bad",
    brand: "bg-brand-navy/10 text-brand-navy",
    muted: "bg-ink/5 text-muted",
  };
  return <span className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-semibold ${map[tone]}`}>{children}</span>;
}

/** Button primitive — one source of truth for the three button intents. */
export function Button({
  children,
  onClick,
  variant = "secondary",
  type = "button",
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-50";
  const map: Record<string, string> = {
    primary: "bg-brand-navy text-white hover:bg-brand-navy/90",
    secondary: "border border-line text-brand-navy hover:bg-ink/5",
    ghost: "text-ink hover:bg-ink/5",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${map[variant]} ${className}`}>
      {children}
    </button>
  );
}

/** Single shimmer block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`u-skeleton ${className}`} aria-hidden />;
}

/** Table-shaped loading placeholder used while a data surface fetches. */
export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card" role="status" aria-live="polite">
      <span className="sr-only">Loading data</span>
      <div className="mb-3 flex gap-3" aria-hidden>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="space-y-2.5" aria-hidden>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-3">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className={`h-4 flex-1 ${c === 0 ? "max-w-[28%]" : ""}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A glyph in a soft, tinted disc — the shared visual for empty/error states. */
function StateIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: "brand" | "warn" | "bad" }) {
  const map = { brand: "bg-brand-navy/10 text-brand-navy", warn: "bg-warn/10 text-warn", bad: "bg-bad/10 text-bad" };
  return (
    <div className={`mb-3 grid h-12 w-12 place-items-center rounded-full ${map[tone]}`} aria-hidden>
      <Icon size={22} strokeWidth={2} aria-hidden />
    </div>
  );
}

export function EmptyState({ title, body, next, icon }: { title: string; body: string; next?: string; icon?: LucideIcon }) {
  return (
    <div className="u-enter flex min-h-[40vh] flex-col items-center justify-center rounded-card border border-dashed border-line bg-surface/60 p-10 text-center">
      <StateIcon icon={icon ?? Inbox} tone="brand" />
      <h3 className="text-base font-bold text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{body}</p>
      {next && <p className="mt-3 text-2xs font-semibold uppercase tracking-wider text-brand-navy">Next: {next}</p>}
    </div>
  );
}

/** Tiny dependency-free sparkline (kept bespoke; reads cleaner than a chart lib here). */
export function Sparkline({ values, width = 120, height = 32 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / span) * height}`)
    .join(" ");
  return (
    <svg width={width} height={height} role="img" aria-label="trend">
      <polyline points={pts} fill="none" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Accessible busy indicator (respects prefers-reduced-motion via CSS). */
export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-live="polite">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand-navy motion-reduce:animate-none" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Error state with a retry affordance. Forbidden (403) gets a calmer message. */
export function ErrorState({ error, onRetry }: { error: Error & { status?: number }; onRetry?: () => void }) {
  const forbidden = error.status === 403;
  const unauthorized = error.status === 401;
  const title = forbidden ? "Not available for your role" : unauthorized ? "Sign-in required" : "Could not load this view";
  const body = forbidden
    ? "Your role does not have access to this data. Access is enforced at the data layer, not just here."
    : `${error.message}. The server may be unreachable — confirm it is running (see RUN.md).`;
  const icon = forbidden ? ShieldOff : unauthorized ? Lock : AlertTriangle;
  return (
    <div role="alert" className="u-enter flex min-h-[30vh] flex-col items-center justify-center rounded-card border border-dashed border-line bg-surface/60 p-10 text-center">
      <StateIcon icon={icon} tone={forbidden ? "warn" : "bad"} />
      <h3 className="text-base font-bold text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{body}</p>
      {onRetry && !forbidden && !unauthorized && (
        <Button variant="secondary" onClick={onRetry} className="mt-3">
          <RefreshCw size={14} strokeWidth={2.25} aria-hidden />
          Retry
        </Button>
      )}
    </div>
  );
}

/**
 * Render-helper that turns an AsyncState into the right surface: loading skeleton,
 * error+retry, empty-state, or the loaded children. Keeps every module's
 * loading/empty/error handling consistent (Toyota baseline).
 */
export function Async<T>({
  state,
  isEmpty,
  empty,
  loadingFallback,
  children,
}: {
  state: { data: T | null; loading: boolean; error: (Error & { status?: number }) | null; reload: () => void };
  isEmpty?: (d: T) => boolean;
  empty?: ReactNode;
  loadingFallback?: ReactNode;
  children: (d: T) => ReactNode;
}) {
  if (state.loading && state.data == null) return <>{loadingFallback ?? <Spinner />}</>;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.data == null) return <>{loadingFallback ?? <Spinner />}</>;
  if (isEmpty && isEmpty(state.data) && empty) return <>{empty}</>;
  return <>{children(state.data)}</>;
}
