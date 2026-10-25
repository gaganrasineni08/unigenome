// The staff scan screen: scan a QR, see what it is and who holds it, then record what you did with it.
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { verifyProof } from "../../shared/dsa/merkle";
import { api } from "../lib/api";
import { EVENT_LABEL, fmtDateTime, fmtHours } from "../lib/format";
import { locate, record, unitIdFromScan, type Located } from "../lib/record";
import { useSession } from "../lib/session";
import { Timeline } from "./Journey";
import { Scanner } from "./Scanner";
import { Alert, Badge, Button, Card, Field, Input, Select, Spinner, useAsync } from "./ui";

type Action = "RECEIVED" | "DISPATCHED" | "STORED" | "CONDITION" | "UNPACKED" | "SOLD";

export function ScanAct({ allowed }: { allowed: Action[] }) {
  const { me, secretKey } = useSession();
  const [unit, setUnit] = useState<any>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [result, setResult] = useState<any>(null);
  const [where, setWhere] = useState<Located | null>(null);
  const [parties, setParties] = useState<any[]>([]);
  const [form, setForm] = useState<any>({});
  const [eta, setEta] = useState<any>(null);
  const [spot, setSpot] = useState<Record<string, "ok" | "bad" | "pending">>({});
  const load = useAsync();
  const act = useAsync();

  useEffect(() => {
    api<any[]>("/parties", { auth: false }).then(setParties);
    if (me) locate(me).then(setWhere);
  }, [me]);

  const open = (text: string, preset?: Action | null) =>
    load.run(async () => {
      setResult(null);
      setAction(null);
      setForm({});
      setUnit(await api("/units/" + encodeURIComponent(unitIdFromScan(text))));
      if (preset && allowed.includes(preset)) setAction(preset);
    });

  // Opened from the stock or shelf list: ?unit=B-1024-007&do=SOLD
  const [params] = useSearchParams();
  useEffect(() => {
    const u = params.get("unit");
    if (u && me) open(u, params.get("do") as Action | null);
  }, [me, params.get("unit")]);

  const reload = async () => setUnit(await api("/units/" + unit.id));

  useEffect(() => {
    if (action === "DISPATCHED" && form.to) api("/eta?to=" + form.to).then(setEta).catch(() => setEta(null));
    else setEta(null);
  }, [action, form.to]);

  if (!me || !secretKey) return null;
  const mine = unit && unit.custodian === me.id && unit.top === unit.id;
  const incoming = unit && unit.inTransitTo && unit.top === unit.id;
  const options: Array<{ a: Action; label: string; show: boolean }> = unit
    ? ([
        { a: "RECEIVED", label: "Receive", show: !!incoming },
        { a: "DISPATCHED", label: "Dispatch", show: !!mine },
        { a: "STORED", label: "Store", show: !!mine },
        { a: "CONDITION", label: "Condition check", show: !!mine },
        { a: "UNPACKED", label: unit.kind === "pallet" ? "Unpack pallet" : "Open carton", show: !!mine && unit.kind !== "item" },
        { a: "SOLD", label: "Mark sold", show: !!mine && unit.kind === "item" && !unit.sold },
      ] as Array<{ a: Action; label: string; show: boolean }>).filter((o) => o.show && allowed.includes(o.a))
    : [];

  const submit = () =>
    act.run(async () => {
      const w = await locate(me);
      setWhere(w);
      const data: any = {};
      if (action === "DISPATCHED") {
        if (!form.to) throw new Error("Choose where it's going");
        data.to = form.to;
        if (form.ref) data.ref = form.ref;
      }
      if (action === "STORED" && form.zone) data.zone = form.zone;
      if (action === "CONDITION") {
        data.ok = form.ok !== "no";
        data.reading = form.reading || (data.ok ? "within range" : "out of range");
        if (form.note) data.note = form.note;
      }
      const r = await record(me, secretKey, unit.id, unit.head, action!, data, w);
      setResult({ ...r, action, released: action === "UNPACKED" ? unit.contents?.count : undefined });
      if (r.spotCheck) setSpot(Object.fromEntries(r.spotCheck.map((s: any) => [s.id, "pending"])));
      setAction(null);
      await reload();
    });

  const spotScan = (text: string) =>
    act.run(async () => {
      const id = unitIdFromScan(text);
      const entry = result.spotCheck.find((s: any) => s.id === id);
      const okLocally = !!entry && verifyProof(id, entry.proof, result.root);
      const u = await api<any>("/units/" + id);
      const w = await locate(me);
      const r = await record(me, secretKey, id, u.head, "SPOT_CHECK" as any, { carton: unit.id }, w);
      setSpot((s) => ({ ...s, [id]: okLocally && r.belongs ? "ok" : "bad" }));
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-4">
        <Card>
          <Scanner onResult={open} label="Scan an item, carton or pallet" />
          {where && (
            <div className="mt-3 flex items-center gap-2 text-xs text-mute">
              <span className={`h-2 w-2 rounded-full ${where.fix.source === "gps" ? "bg-mint" : "bg-amber"}`} />
              {where.fix.source === "gps" ? `GPS ±${where.fix.acc} m` : "GPS off: using your registered site"}
              {where.site ? ` · at ${where.site.name}` : where.fix.source === "gps" ? " · not at a registered site" : ""}
            </div>
          )}
        </Card>
        {load.busy && <Spinner />}
        {load.error && <Alert>{load.error}</Alert>}
      </div>

      <div className="space-y-4">
        <AnimatePresence mode="wait">
          {result && (
            <motion.div key="res" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="border-mint/40">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-mint/20 text-2xl text-mint">✓</div>
                  <div>
                    <div className="font-display text-xl font-semibold">{EVENT_LABEL[result.action]} · signed and saved</div>
                    {result.action === "UNPACKED" ? <div className="text-mint">{result.released} items taken out; each one now has its own record</div> : result.kind !== "item" && <div className="text-mint">{result.itemsInside} items updated by this one scan</div>}
                  </div>
                </div>
                {result.eta && (
                  <p className="mt-3 text-sm">
                    Expected arrival <b>{fmtDateTime(result.eta.expected)}</b> ({fmtHours(result.eta.hours)},{" "}
                    {result.eta.method === "dijkstra" ? `fastest known route: ${result.eta.path.map((p: string) => parties.find((x) => x.id === p)?.name ?? p).join(" → ")}` : "estimated from distance, no delivery history yet"}).
                  </p>
                )}
                {result.transitHours != null && <p className="mt-3 text-sm">Transit time: <b>{fmtHours(result.transitHours)}</b></p>}
                {result.diverted && <Alert tone="amber">This shipment was addressed to someone else. An alert was raised.</Alert>}
                {result.flags?.length > 0 && <div className="mt-2"><Alert tone="amber">⚑ {result.flags.join("; ")}</Alert></div>}
                {result.spotCheck && (
                  <div className="mt-4">
                    <div className="font-semibold">Random spot check: scan these {result.spotCheck.length} items</div>
                    <p className="text-xs text-mute">The server picked them at random. Each one is checked against the carton's signed Merkle root.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {result.spotCheck.map((s: any) => (
                        <Badge key={s.id} tone={spot[s.id] === "ok" ? "mint" : spot[s.id] === "bad" ? "coral" : "mute"}>
                          {s.id} {spot[s.id] === "ok" ? "✓" : spot[s.id] === "bad" ? "✕" : ""}
                        </Badge>
                      ))}
                    </div>
                    {Object.values(spot).some((v) => v === "pending") && (
                      <div className="mt-3">
                        <Scanner onResult={spotScan} label="Scan a spot-check item" />
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {unit && (
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-mute">{unit.kind}</div>
                <div className="mono text-xl font-medium text-ink">{unit.id}</div>
                {unit.batch && <div className="text-sm text-mute">{unit.batch.productName} · batch {unit.batch.id}</div>}
              </div>
              <div className="flex flex-col items-end gap-1">
                {unit.kind !== "item" && <Badge tone="teal">{unit.contents.count} items inside</Badge>}
                {unit.custodian && <Badge tone="mint">Held by {unit.custodianName}</Badge>}
                {unit.inTransitTo && <Badge tone="amber">In transit to {unit.inTransitToName}</Badge>}
                {unit.sold && <Badge tone="violet">Sold</Badge>}
                {unit.conditionBad && <Badge tone="coral">Condition failed</Badge>}
                <Badge tone={unit.chainCheck.ok ? "mint" : "coral"}>{unit.chainCheck.ok ? "Hash chain intact" : "Chain broken"}</Badge>
              </div>
            </div>
            {unit.top !== unit.id && <div className="mt-3"><Alert tone="amber">Packed inside {unit.top}. Scan {unit.top} to move it; this item gets that record automatically.</Alert></div>}

            {options.length > 0 && !action && (
              <div className="mt-4 flex flex-wrap gap-2">
                {options.map((o) => (
                  <Button key={o.a} variant={o.a === "RECEIVED" || o.a === "DISPATCHED" ? "primary" : "soft"} onClick={() => setAction(o.a)}>
                    {o.label}
                  </Button>
                ))}
              </div>
            )}
            {!options.length && unit.kind !== "item" && unit.contents?.count === 0 && <p className="mt-4 text-sm text-mute">This box has been opened and is empty.</p>}
            {!options.length && !unit.inTransitTo && unit.top === unit.id && unit.custodian !== me.id && !(unit.kind !== "item" && unit.contents?.count === 0) && (
              <p className="mt-4 text-sm text-mute">You don't hold this unit, so there's nothing to record.</p>
            )}

            {action && (
              <div className="mt-4 space-y-3 rounded-xl border border-line bg-abyss/50 p-4">
                <div className="font-semibold">{options.find((o) => o.a === action)?.label ?? EVENT_LABEL[action]}</div>
                {action === "DISPATCHED" && (
                  <>
                    <Field label="Destination">
                      <Select value={form.to ?? ""} onChange={(e) => setForm({ ...form, to: e.target.value })}>
                        <option value="">Choose…</option>
                        {parties.filter((p) => p.status === "approved" && p.id !== me.id && ["warehouse", "retailer"].includes(p.role)).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Vehicle or reference (optional)"><Input value={form.ref ?? ""} onChange={(e) => setForm({ ...form, ref: e.target.value })} placeholder="TS09 AB 1234" /></Field>
                    {eta && <p className="text-sm text-mute">Dispatch date: now. Expected arrival {fmtDateTime(eta.expected)} ({fmtHours(eta.hours)}{eta.method === "dijkstra" ? ", from past deliveries" : ", from distance"}).</p>}
                  </>
                )}
                {action === "STORED" && <Field label="Shelf or zone"><Input value={form.zone ?? ""} onChange={(e) => setForm({ ...form, zone: e.target.value })} placeholder="Rack B-4" /></Field>}
                {action === "CONDITION" && (
                  <>
                    <Field label="Result">
                      <Select value={form.ok ?? "yes"} onChange={(e) => setForm({ ...form, ok: e.target.value })}>
                        <option value="yes">Passed</option>
                        <option value="no">Failed (temperature, damage, seal…)</option>
                      </Select>
                    </Field>
                    <Field label="Reading"><Input value={form.reading ?? ""} onChange={(e) => setForm({ ...form, reading: e.target.value })} placeholder="e.g. 6 °C" /></Field>
                    <Field label="Note"><Input value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
                  </>
                )}
                {action === "UNPACKED" && <p className="text-sm text-mute">The {unit.contents.direct} units inside become separate. The server will pick some at random for you to spot-check.</p>}
                {action === "RECEIVED" && unit.inTransitTo !== me.id && <Alert tone="amber">This was sent to {unit.inTransitToName}, not you. Receiving it raises a diversion alert.</Alert>}
                {act.error && <Alert>{act.error}</Alert>}
                <div className="flex gap-2">
                  <Button busy={act.busy} onClick={submit}>Sign and record</Button>
                  <Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
                </div>
              </div>
            )}

            <div className="mt-6">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-mute">History</div>
              <Timeline history={unit.history} />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
