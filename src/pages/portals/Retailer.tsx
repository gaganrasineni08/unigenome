import { Route, Routes } from "react-router-dom";
import { AlertsPanel } from "../../components/Alerts";
import { Gate, SignOutButton } from "../../components/Gate";
import { Inventory, Shipments } from "../../components/Inventory";
import { ScanAct } from "../../components/ScanAct";
import { H1, Page, TopBar } from "../../components/ui";

const COLOR = "#E8A33D";

export default function RetailerPortal() {
  return (
    <Gate portal="retailer" roles={["retailer"]} color={COLOR}>
      <TopBar
        title="Retailer"
        color={COLOR}
        right={<SignOutButton />}
        tabs={[
          { to: "/retailer", label: "Scan", end: true },
          { to: "/retailer/shelf", label: "Shelf" },
          { to: "/retailer/shipments", label: "Deliveries" },
          { to: "/retailer/alerts", label: "Alerts" },
        ]}
      />
      <Page>
        <Routes>
          <Route index element={<><H1 sub="Receive a carton, open it and spot-check the items the server picks, then scan each item when you sell it. A sale scan tells buyers' phones where the item should be.">Scan</H1><ScanAct allowed={["RECEIVED", "UNPACKED", "STORED", "CONDITION", "SOLD", "DISPATCHED"]} /></>} />
          <Route path="shelf" element={<><H1>Shelf</H1><Inventory title="On your shelf" /></>} />
          <Route path="shipments" element={<Shipments />} />
          <Route path="alerts" element={<AlertsPanel />} />
        </Routes>
      </Page>
    </Gate>
  );
}
