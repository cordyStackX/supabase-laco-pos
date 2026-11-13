import React from "react";
import { Link, useLocation } from "react-router-dom";
import LccbLogo from "../assets/LCCB-Logo.jpeg";

const NAV_SECTIONS = [
  {
    label: null,
    items: [
      { to: "/admin-dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4", label: "Dashboard", adminOnly: true },
    ],
  },
  {
    label: "Online Store",
    items: [
      { to: "/orders", icon: "M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z", label: "Orders", adminOnly: true },
      { to: "/customers", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z", label: "Customers", adminOnly: true },
      { to: "/online-reports", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z", label: "Online Reports", adminOnly: true },
    ],
  },
  {
    label: "Point of Sale",
    items: [
      { to: "/dashboard", icon: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z", label: "POS", adminOnly: false },
      { to: "/sales", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01", label: "Sales", adminOnly: true },
      { to: "/sales-report", icon: "M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z", label: "Sales Report", adminOnly: true },
    ],
  },
  {
    label: "Inventory",
    items: [
      { to: "/stock", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4", label: "Inventory", adminOnly: false, staffAllowed: true },
      { to: "/restock", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15", label: "Restock", adminOnly: true },
      { to: "/inventory-log", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2", label: "Inventory Log", adminOnly: false, inventoryLog: true },
    ],
  },
  {
    label: "Management",
    items: [
      { to: "/manage-staff", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z", label: "Manage Staff", adminOnly: true },
    ],
  },
];

function NavIcon({ d, className = "" }) {
  return (
    <svg className={`w-5 h-5 shrink-0 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export default function Sidebar({ sidebarOpen, setSidebarOpen }) {
  const location = useLocation();

  const user = (() => {
    try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; }
  })();

  const isAdmin = user?.role === "admin";
  const canViewInventoryLogs = isAdmin || user?.canViewInventoryLogs;

  const isItemVisible = (item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.inventoryLog && !canViewInventoryLogs) return false;
    if (item.staffAllowed && !isAdmin && user?.role !== "sub") return false;
    return true;
  };

  const isActive = (path) => location.pathname === path;

  const linkClass = (path) =>
    `group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive(path)
        ? "bg-blue-50 text-blue-700 border-l-[3px] border-blue-600 ml-0 pl-[9px]"
        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 border-l-[3px] border-transparent ml-0 pl-[9px]"
    }`;

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed top-0 left-0 h-full w-64 bg-white border-r border-gray-200 flex-col z-40">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-100">
          <img src={LccbLogo} className="h-9 w-9 rounded-lg object-cover" alt="Logo" />
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-tight">LCCB Bookstore</h1>
            <p className="text-[11px] text-gray-400 font-medium">Admin Panel</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter(isItemVisible);
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.label || "root"}>
                {section.label && (
                  <p className="px-3 mb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    {section.label}
                  </p>
                )}
                <div className="space-y-1">
                  {visibleItems.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={linkClass(item.to)}
                    >
                      <NavIcon d={item.icon} className={isActive(item.to) ? "text-blue-600" : "text-gray-400 group-hover:text-gray-600"} />
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100">
          <p className="text-[11px] text-gray-400 text-center">v1.0 &middot; LCCB Bookstore</p>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed top-0 left-0 h-full w-72 bg-white shadow-2xl flex flex-col animate-slideIn">
            {/* Logo */}
            <div className="flex items-center justify-between px-5 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <img src={LccbLogo} className="h-9 w-9 rounded-lg object-cover" alt="Logo" />
                <div>
                  <h1 className="text-sm font-bold text-gray-900 leading-tight">LCCB Bookstore</h1>
                  <p className="text-[11px] text-gray-400 font-medium">Admin Panel</p>
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
              {NAV_SECTIONS.map((section) => {
                const visibleItems = section.items.filter(isItemVisible);
                if (visibleItems.length === 0) return null;
                return (
                  <div key={section.label || "root"}>
                    {section.label && (
                      <p className="px-3 mb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                        {section.label}
                      </p>
                    )}
                    <div className="space-y-1">
                      {visibleItems.map((item) => (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={() => setSidebarOpen(false)}
                          className={linkClass(item.to)}
                        >
                          <NavIcon d={item.icon} className={isActive(item.to) ? "text-blue-600" : "text-gray-400 group-hover:text-gray-600"} />
                          <span>{item.label}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
