// Draws the supply-chain graph in BFS levels and replays the real queue, step by step.
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Button } from "./ui";

const ROLE_COLOR: Record<string, string> = { manufacturer: "#02C39A", warehouse: "#00A896", retailer: "#E8A33D" };

export function BfsGraph({ graph, bfs }: { graph: { nodes: any[]; edges: any[] }; bfs: { order: string[]; dist: Record<string, number>; steps: Array<{ visit: string; queue: string[] }> } }) {
  const [step, setStep] = useState(bfs.steps.length);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (step >= bfs.steps.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 700);
    return () => clearTimeout(t);
  }, [playing, step, bfs.steps.length]);

  const levels: string[][] = [];
  for (const id of bfs.order) (levels[bfs.dist[id]] ??= []).push(id);
  const W = 760;
  const colW = W / Math.max(1, levels.length);
  const rowH = 74;
  const H = Math.max(...levels.map((l) => l.length), 1) * rowH + 30;
  const pos: Record<string, { x: number; y: number }> = {};
  levels.forEach((ids, li) => ids.forEach((id, i) => (pos[id] = { x: colW * li + colW / 2, y: (H - ids.length * rowH) / 2 + i * rowH + rowH / 2 })));
  const visited = new Set(bfs.steps.slice(0, step).map((s) => s.visit));
  const current = step > 0 ? bfs.steps[step - 1] : null;
  const name = (id: string) => graph.nodes.find((n) => n.id === id);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="soft" onClick={() => { setStep(0); setPlaying(true); }}>▶ Replay BFS</Button>
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))}>◀ Step</Button>
        <Button variant="ghost" onClick={() => setStep((s) => Math.min(bfs.steps.length, s + 1))}>Step ▶</Button>
        <span className="text-sm text-mute">Step {step} of {bfs.steps.length}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-abyss/60">
        <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[640px]">
          <defs>
            <marker id="bfs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#3b6b6f" /></marker>
          </defs>
          {graph.edges.map((e, i) => pos[e.from] && pos[e.to] && (
            <line key={i} x1={pos[e.from].x + 60} y1={pos[e.from].y} x2={pos[e.to].x - 62} y2={pos[e.to].y} stroke={visited.has(e.to) ? "#02C39A" : "#2a5357"} strokeWidth={visited.has(e.to) ? 2 : 1.2} markerEnd="url(#bfs-arrow)" />
          ))}
          {Object.entries(pos).map(([id, p]) => {
            const n = name(id);
            const on = visited.has(id);
            const c = ROLE_COLOR[n?.role] ?? "#8fb3ae";
            return (
              <g key={id}>
                <motion.rect animate={{ opacity: on ? 1 : 0.45, scale: current?.visit === id ? 1.06 : 1 }} x={p.x - 60} y={p.y - 22} width={120} height={44} rx={10} fill={on ? c + "33" : "#062c30"} stroke={on ? c : "#2a5357"} strokeWidth={current?.visit === id ? 2.5 : 1.2} style={{ transformOrigin: `${p.x}px ${p.y}px` }} />
                <text x={p.x} y={p.y - 3} textAnchor="middle" fontSize="11" fontWeight="600" fill="#e7f4f2">{(n?.name ?? id).slice(0, 20)}</text>
                <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize="10" fill="#8fb3ae">{n?.role} · d={bfs.dist[id]}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-mute">Queue:</span>
        {current ? (
          current.queue.length ? current.queue.map((q) => <span key={q} className="rounded-md border border-line px-2 py-0.5 mono text-xs">{name(q)?.name?.split(",")[0] ?? q}</span>) : <span className="text-mute">empty, done</span>
        ) : (
          <span className="mono text-xs">[{name(bfs.order[0])?.name}]</span>
        )}
        {current && <span className="ml-2 text-mute">just visited <b className="text-ink">{name(current.visit)?.name}</b></span>}
      </div>
    </div>
  );
}
