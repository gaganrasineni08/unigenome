import { motion } from "framer-motion";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Link, NavLink } from "react-router-dom";

export function Button({ variant = "primary", busy, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "soft"; busy?: boolean }) {
  const styles = {
    primary: "bg-mint text-abyss hover:bg-[#19d6ab] shadow-[0_8px_24px_-8px_rgba(2,195,154,0.7)]",
    soft: "bg-white/8 text-ink hover:bg-white/14 border border-white/10",
    ghost: "text-mute hover:text-ink hover:bg-white/6",
    danger: "bg-coral/90 text-white hover:bg-coral",
  }[variant];
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className={`glass rounded-2xl p-5 ${className}`}>
    {children}
  </motion.div>
);

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-mute">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-mute/80">{hint}</span>}
  </label>
);

const inputCls = "w-full rounded-xl border border-line bg-abyss/70 px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-mute/50 focus:border-mint focus:ring-2 focus:ring-mint/20";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputCls} ${p.className ?? ""}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${inputCls} ${p.className ?? ""}`} />;
export const TextArea = (p: any) => <textarea {...p} className={`${inputCls} min-h-24 ${p.className ?? ""}`} />;

export const Spinner = ({ small }: { small?: boolean }) => (
  <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${small ? "h-3.5 w-3.5" : "h-6 w-6"}`} />
);

export const Badge = ({ tone = "mute", children }: { tone?: "mint" | "amber" | "coral" | "violet" | "mute" | "teal"; children: ReactNode }) => {
  const t = {
    mint: "bg-mint/15 text-mint border-mint/30",
    amber: "bg-amber/15 text-amber border-amber/30",
    coral: "bg-coral/15 text-coral border-coral/30",
    violet: "bg-violet/15 text-violet border-violet/30",
    teal: "bg-teal/20 text-sea border-sea/30",
    mute: "bg-white/5 text-mute border-white/10",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
};

export const Mono = ({ children, className = "" }: { children: ReactNode; className?: string }) => <span className={`mono break-all text-[12px] text-sea ${className}`}>{children}</span>;

export const Alert = ({ tone = "coral", children }: { tone?: "coral" | "amber" | "mint"; children: ReactNode }) => (
  <div className={`rounded-xl border px-4 py-3 text-sm ${tone === "coral" ? "border-coral/40 bg-coral/10 text-[#f3b0b0]" : tone === "amber" ? "border-amber/40 bg-amber/10 text-[#f5d29a]" : "border-mint/40 bg-mint/10 text-[#9ff0d6]"}`}>
    {children}
  </div>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-mute">{children}</div>;

export const H1 = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) => (
  <div className="mb-6">
    <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">{children}</h1>
    {sub && <p className="mt-1.5 max-w-2xl text-mute">{sub}</p>}
  </div>
);

export const H2 = ({ children, right }: { children: ReactNode; right?: ReactNode }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <h2 className="font-display text-xl font-semibold">{children}</h2>
    {right}
  </div>
);

export function useAsync<T>() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export const PORTALS = {
  manufacturer: { label: "Manufacturer", color: "#02C39A", icon: "🏭" },
  warehouse: { label: "Warehouse", color: "#00A896", icon: "🏬" },
  retailer: { label: "Retailer", color: "#E8A33D", icon: "🛒" },
  buyer: { label: "Buyer", color: "#8E7CC3", icon: "📱" },
  regulator: { label: "Regulator", color: "#D96C6C", icon: "🛡️" },
} as const;

export function TopBar({ title, color, tabs, right }: { title: string; color: string; tabs?: Array<{ to: string; label: string; end?: boolean }>; right?: ReactNode }) {
  return (
    <header className="lg-bar no-print sticky top-0 z-30">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <img src="/icon.svg" className="h-8 w-8" alt="" />
          <span className="font-display text-lg font-semibold">UniGenome</span>
        </Link>
        <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: color + "22", color }}>
          {title}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/" className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-mute transition hover:bg-white/10 hover:text-ink" title="Back to the home page">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>
            <span className="hidden sm:inline">Home</span>
          </Link>
          {right}
        </div>
      </div>
      {tabs && (
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${isActive ? "bg-white/10 text-ink" : "text-mute hover:text-ink"}`}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}

export const Page = ({ children }: { children: ReactNode }) => <main className="mx-auto max-w-6xl px-4 py-6 md:py-10">{children}</main>;

export const Stat = ({ label, value, tone = "#02C39A" }: { label: string; value: ReactNode; tone?: string }) => (
  <div className="glass rounded-2xl p-4">
    <div className="text-xs font-semibold uppercase tracking-wider text-mute">{label}</div>
    <div className="mt-1 font-display text-3xl font-semibold" style={{ color: tone }}>
      {value}
    </div>
  </div>
);
