import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Spinner } from "./components/ui";
import Home from "./pages/Home";

const ManufacturerPortal = lazy(() => import("./pages/portals/Manufacturer"));
const WarehousePortal = lazy(() => import("./pages/portals/Warehouse"));
const RetailerPortal = lazy(() => import("./pages/portals/Retailer"));
const BuyerPortal = lazy(() => import("./pages/portals/Buyer"));
const VerifyPage = lazy(() => import("./pages/portals/Buyer").then((m) => ({ default: m.VerifyPage })));
const RegulatorPortal = lazy(() => import("./pages/portals/Regulator"));
const Register = lazy(() => import("./pages/Register"));

export default function App() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><Spinner /></div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/v" element={<VerifyPage />} />
        <Route path="/buyer/*" element={<BuyerPortal />} />
        <Route path="/manufacturer/*" element={<ManufacturerPortal />} />
        <Route path="/warehouse/*" element={<WarehousePortal />} />
        <Route path="/retailer/*" element={<RetailerPortal />} />
        <Route path="/regulator/*" element={<RegulatorPortal />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </Suspense>
  );
}
