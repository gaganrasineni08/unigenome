import { motion } from "framer-motion";

export const VERDICTS: Record<string, { label: string; color: string; icon: string; text: string }> = {
  GENUINE: { label: "Genuine", color: "#02C39A", icon: "✓", text: "Signed by the manufacturer, registered, and its history checks out." },
  CONDITION_COMPROMISED: { label: "Condition-Compromised", color: "#E8A33D", icon: "!", text: "Genuine product, but a storage check failed or it has expired. Don't use it." },
  COUNTERFEIT: { label: "Counterfeit", color: "#D96C6C", icon: "✕", text: "This code was not issued by a registered manufacturer, or its details were changed." },
  SUSPICIOUS_CLONE: { label: "Suspicious Clone", color: "#8E7CC3", icon: "⧉", text: "The code is real, but it is turning up where the real item can't be. It may be a copy." },
  RECALLED: { label: "Recalled", color: "#D96C6C", icon: "⚠", text: "This batch has been recalled. Don't use it, and return it to the shop." },
};

export function VerdictHero({ verdict }: { verdict: string }) {
  const v = VERDICTS[verdict] ?? VERDICTS.COUNTERFEIT;
  return (
    <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 180, damping: 16 }} className="glass relative overflow-hidden rounded-3xl p-6 text-center">
      <div className="absolute inset-0 opacity-25" style={{ background: `radial-gradient(500px 220px at 50% 0%, ${v.color}, transparent)` }} />
      <motion.div initial={{ rotate: -90, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ delay: 0.15, type: "spring" }} className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full text-4xl font-bold" style={{ background: v.color + "26", color: v.color, boxShadow: `0 0 50px ${v.color}55` }}>
        {v.icon}
      </motion.div>
      <div className="relative mt-4 font-display text-3xl font-semibold" style={{ color: v.color }}>
        {v.label}
      </div>
      <p className="relative mx-auto mt-2 max-w-md text-sm text-mute">{v.text}</p>
    </motion.div>
  );
}
