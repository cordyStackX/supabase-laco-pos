import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import SignIn from "./pages/SignIn";
import LogIn from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AdminDashboard from "./pages/AdminDashboard";
import StartPage from "./pages/Start";
import StockManager from "./pages/Stock";
import SalesPage from "./pages/Sales";
import Restock from "./pages/Restock";
import Log from "./pages/InventoryLog";
import MonthlySalesReport from "./pages/MonthlySalesReport";
import ManageStaff from "./pages/ManageStaff";
import Orders from "./pages/Orders";
import Customers from "./pages/Customers";
import OnlineReports from "./pages/OnlineReports";
import ErrorBoundary from "./components/ErrorBoundary";
import { getToken, setUnauthorizedHandler } from "./lib/api";
import "./index.css";

// The guards below only decide what to render. Every page's data comes from
// endpoints that re-check the bearer token server-side, so these checks are a
// UX convenience and not the security boundary.
setUnauthorizedHandler(() => {
  if (!window.location.pathname.endsWith("/login")) {
    window.location.replace("/login");
  }
});

function ProtectedRoute({ children }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  if (!user?.role) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

function InventoryRoute({ children }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  if (!user?.role) return <Navigate to="/login" replace />;
  if (user.role === "admin" || user.canViewInventoryLogs) return children;
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <Router>
      <div style={{ width: "100%" }}>

        {/* Main routing */}
        <Routes>
          {/* Public */}
          <Route path="/" element={<StartPage />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/login" element={<LogIn />} />

          {/* Protected */}
          <Route
            path="/admin-dashboard"
            element={
              <ProtectedRoute>
                <AdminRoute><ErrorBoundary><AdminDashboard /></ErrorBoundary></AdminRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <ErrorBoundary><Dashboard /></ErrorBoundary>
              </ProtectedRoute>
            }
          />

          <Route
            path="/stock"
            element={
              <ProtectedRoute>
                <ErrorBoundary><StockManager /></ErrorBoundary>
              </ProtectedRoute>
            }
          />

          <Route path="/sales" element={<ProtectedRoute><ErrorBoundary><SalesPage /></ErrorBoundary></ProtectedRoute>} />
          <Route
            path="/restock"
            element={
              <ProtectedRoute>
                <ErrorBoundary><Restock /></ErrorBoundary>
              </ProtectedRoute>
            }
          />

          <Route path="/inventory-log" element={<ProtectedRoute><InventoryRoute><ErrorBoundary><Log /></ErrorBoundary></InventoryRoute></ProtectedRoute>} />
          <Route path="/sales-report" element={<ProtectedRoute><AdminRoute><ErrorBoundary><MonthlySalesReport /></ErrorBoundary></AdminRoute></ProtectedRoute>} />
          <Route path="/manage-staff" element={<ProtectedRoute><AdminRoute><ErrorBoundary><ManageStaff /></ErrorBoundary></AdminRoute></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute><AdminRoute><ErrorBoundary><Orders /></ErrorBoundary></AdminRoute></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute><AdminRoute><ErrorBoundary><Customers /></ErrorBoundary></AdminRoute></ProtectedRoute>} />
          <Route path="/online-reports" element={<ProtectedRoute><AdminRoute><ErrorBoundary><OnlineReports /></ErrorBoundary></AdminRoute></ProtectedRoute>} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </Router>
  );
}
