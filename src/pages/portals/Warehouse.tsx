import { useEffect, useMemo, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { randomBytes, toHex } from "../../../shared/bytes";
import { signUnit, encodePayload, type ContainerFields } from "../../../shared/identity";
import { signEvent, type EventBody } from "../../../shared/events";
import { merkleRoot } from "../../../shared/dsa/merkle";
import { AlertsPanel } from "../../components/Alerts";
import { Gate, SignOutButton } from "../../components/Gate";
import { Inventory, Shipments } from "../../components/Inventory";
import { ScanAct } from "../../components/ScanAct";
import { H1, Page, Spinner, TopBar, useAsync } from "../../components/ui";
import { api } from "../../lib/api";
import { locate } from "../../lib/record";
import { useSession } from "../../lib/session";
import { PackView } from "./Manufacturer";

const COLOR = "#00A896";

export default function WarehousePortal() {
  return (
    <Gate portal="warehouse" roles={["warehouse"]} color={COLOR}>
      <TopBar
        title="Warehouse"
        color={COLOR}
        right={<SignOutButton />}
        tabs={[
          { to: "/warehouse", label: "Scan", end: true },
          { to: "/warehouse/stock", label: "Stock" },
          { to: "/warehouse/repack", label: "Repack" },
          { to: "/warehouse/shipments", label: "Shipments" },
          { to: "/warehouse/alerts", label: "Alerts" },
        ]}
      />
      <Page>
        <Routes>
          <Route index element={<><H1 sub="Scan the one QR on a pallet or carton. Receiving, storing, checking or dispatching it updates every item inside, with your location and time signed in.">Scan</H1><ScanAct allowed={["RECEIVED", "DISPATCHED", "STORED", "CONDITION", "UNPACKED"]} /></>} />
          <Route path="stock" element={<><H1>Stock</H1><Inventory /></>} />
          <Route path="repack" element={<Repack />} />
          <Route path="shipments" element={<Shipments />} />
          <Route path="alerts" element={<AlertsPanel />} />
        </Routes>
      </Page>
    </Gate>
  );
}

/** Splitting a shipment: open a carton, then pack some of its items into a new carton signed by this warehouse. */
export function Repack() {
  const { me, secretKey } = useSession();
  const [inv, setInv] = useState<any[] | null>(null);
  const [kind, setKind] = useState<"carton" | "pallet">("carton");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [made, setMade] = useState<any>(null);
  const { busy, error, run } = useAsync();
  const load = () => api<any[]>("/inventory").then((r) => setInv(r.filter((x) => !x.in_transit_to && !x.sold_ts)));
  useEffect(() => {
    load();
  }, []);
  const choices = useMemo(() => (inv ?? []).filter((u) => u.kind === (kind === "carton" ? "item" : "carton")), [inv, kind]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pack = () =>
    run(async () => {
      const children = [...sel].sort();
      if (!children.length) throw new Error("Select what goes inside");
      const f: ContainerFields = { kind, id: (kind === "carton" ? "C-" : "P-") + toHex(randomBytes(3)).toUpperCase(), by: me!.id, count: children.length, root: merkleRoot(children), packed: new Date().toISOString() };
      const where = await locate(me!);
      const body: EventBody = { unit: f.id, type: "PACKED", actor: me!.id, ts: Date.now(), lat: where.fix.lat, lng: where.fix.lng, acc: where.fix.acc, site: where.site?.id ?? null, prev: "0", data: { count: children.length } };
      const unit = signUnit(f, secretKey!);
      await api("/containers", { body: { unit, children, event: { body, sig: signEvent(body, secretKey!) } } });
      setMade({ id: f.id, payload: encodePayload(unit), count: children.length });
      setSel(new Set());
      await load();
    });
  if (!inv) return <Spinner />;
  return <PackView {...{ kind, setKind, choices, sel, setSel, toggle, pack, busy, error, made }} />;
}
