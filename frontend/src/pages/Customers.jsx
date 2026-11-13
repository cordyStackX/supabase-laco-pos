import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "./Layout";
import { api } from "../lib/api";

const STATUS_CONFIG = {
  pending_payment: { label: "Pending Payment", color: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  verified: { label: "Payment Verified", color: "bg-blue-100 text-blue-800 border-blue-300" },
  preparing: { label: "Preparing", color: "bg-orange-100 text-orange-800 border-orange-300" },
  ready_for_pickup: { label: "Ready for Pickup", color: "bg-green-100 text-green-800 border-green-300" },
  completed: { label: "Completed", color: "bg-gray-100 text-gray-700 border-gray-300" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800 border-red-300" },
};

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerOrders, setCustomerOrders] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const navigate = useNavigate();

  useEffect(() => {
    if (!localStorage.getItem("user")) navigate("/");
  }, [navigate]);

  const loadCustomers = async () => {
    try {
      const data = await api.get("/orders/customers");
      if (data.success) setCustomers(data.customers);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { loadCustomers(); }, []);

  const filtered = useMemo(() => {
    if (!search) return customers;
    const s = search.toLowerCase();
    return customers.filter(
      (c) => c.name?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s) || c.contact?.includes(s)
    );
  }, [customers, search]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filtered.slice(start, start + itemsPerPage);
  }, [filtered, currentPage]);

  const formatDate = (d) => new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" });

  const displayName = (c) => {
    const raw = (c.name || c.full_name || "").trim();
    if (raw) return raw;
    const local = (c.email || "").split("@")[0] || "";
    return local
      ? local.replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
      : "—";
  };

  const initial = (c) => displayName(c).charAt(0).toUpperCase();

  const viewCustomerProfile = async (customerId) => {
    try {
      const [profileData, ordersData] = await Promise.all([
        api.get(`/orders/customers/${customerId}`),
        api.get(`/orders/customers/${customerId}/orders`),
      ]);
      if (profileData.success) setSelectedCustomer(profileData.customer);
      if (ordersData.success) setCustomerOrders(ordersData.orders);
      setShowProfile(true);
    } catch (err) { console.error(err); }
  };

  return (
    <Layout title="Customers">

      <div className="flex-1 p-6 overflow-y-auto space-y-4">
        {/* SEARCH */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search by name, email, or contact..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
          />
        </div>

        {/* SUMMARY CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm">
            <p className="text-sm text-gray-500">Total Customers</p>
            <p className="text-2xl font-bold text-gray-800">{customers.length}</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm">
            <p className="text-sm text-gray-500">Total Orders</p>
            <p className="text-2xl font-bold text-blue-600">{customers.reduce((sum, c) => sum + (c.total_orders || 0), 0)}</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm">
            <p className="text-sm text-gray-500">Total Revenue</p>
            <p className="text-2xl font-bold text-green-600">₱{customers.reduce((sum, c) => sum + Number(c.total_purchases || 0), 0).toFixed(2)}</p>
          </div>
        </div>

        {/* CUSTOMERS TABLE */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Contact</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Orders</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Purchases</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Registered</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-4xl">👤</span>
                        <p className="text-lg font-medium">No customers found</p>
                        <p className="text-sm">Registered customers will appear here</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginated.map((customer) => (
                    <tr key={customer.id} className="border-b border-gray-100 hover:bg-gray-50 transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
                            {initial(customer)}
                          </div>
                          <span className="font-medium text-gray-800">{displayName(customer)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{customer.email || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{customer.contact || "—"}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center justify-center min-w-[24px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
                          {customer.total_orders || 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-green-600">₱{Number(customer.total_purchases || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(customer.created_at)}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => viewCustomerProfile(customer.id)} className="px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition">
                          View Profile
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 py-3 border-t border-gray-100">
              <button onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))} disabled={currentPage === 1} className="px-3 py-1 text-sm border rounded disabled:opacity-50 hover:bg-gray-50">Prev</button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let page;
                if (totalPages <= 7) page = i + 1;
                else if (currentPage <= 4) page = i + 1;
                else if (currentPage >= totalPages - 3) page = totalPages - 6 + i;
                else page = currentPage - 3 + i;
                if (page < 1 || page > totalPages) return null;
                return (
                  <button key={page} onClick={() => setCurrentPage(page)} className={`min-w-[32px] px-3 py-1 text-sm border rounded transition ${currentPage === page ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"}`}>
                    {page}
                  </button>
                );
              })}
              <button onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} className="px-3 py-1 text-sm border rounded disabled:opacity-50 hover:bg-gray-50">Next</button>
            </div>
          )}
        </div>
      </div>

      {/* CUSTOMER PROFILE MODAL */}
      {showProfile && selectedCustomer && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4" onClick={() => setShowProfile(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xl">
                    {initial(selectedCustomer)}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{displayName(selectedCustomer)}</h2>
                    <p className="text-sm text-gray-500">{selectedCustomer.email || "No email"}</p>
                  </div>
                </div>
                <button onClick={() => setShowProfile(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-500">Contact</p>
                  <p className="font-semibold text-gray-800">{selectedCustomer.contact || "—"}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-500">Total Orders</p>
                  <p className="font-semibold text-blue-600">{selectedCustomer.total_orders || 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-500">Total Spent</p>
                  <p className="font-semibold text-green-600">₱{Number(selectedCustomer.total_purchases || 0).toFixed(2)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-500">Member Since</p>
                  <p className="font-semibold text-gray-800">{formatDate(selectedCustomer.created_at)}</p>
                </div>
              </div>

              {/* Order History */}
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Order History</h3>
              {customerOrders.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 text-center">No orders yet</p>
              ) : (
                <div className="space-y-3">
                  {customerOrders.map((order) => (
                    <div key={order.id} className="border border-gray-200 rounded-xl p-4 hover:shadow-sm transition">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-mono font-semibold text-blue-700">{order.order_number}</p>
                          <p className="text-xs text-gray-500 mt-1">{new Date(order.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-gray-800">₱{Number(order.total_amount).toFixed(2)}</p>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border mt-1 ${STATUS_CONFIG[order.order_status]?.color}`}>
                            {STATUS_CONFIG[order.order_status]?.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
