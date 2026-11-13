import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import Layout from "./Layout";
import { api, getToken } from "../lib/api";
import {
  ShoppingBagIcon, WalletIcon, PackageIcon, TagsIcon,
  AlertTriangleIcon, UsersIcon, ReceiptIcon, ClockIcon,
} from "../components/Icons";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const PIE_COLORS = ["#6366f1", "#ec4899", "#eab308", "#14b8a6", "#8b5cf6", "#f59e0b", "#10b981", "#64748b"];

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [dailySales, setDailySales] = useState([]);
  const [bestSellers, setBestSellers] = useState([]);
  const [sales, setSales] = useState([]);
  const [orderSummary, setOrderSummary] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!getToken()) navigate("/");
  }, [navigate]);

  const formatCurrency = (value) => `₱${Number(value || 0).toFixed(2)}`;

  const loadDashboardData = async () => {
    setLoading(true);
    setError("");

    const [statsRes, notificationsRes, dailySalesRes, bestSellersRes, salesRes, summaryRes, recentOrdersRes] = await Promise.allSettled([
      api.get("/orders/dashboard-stats"),
      api.get("/orders/notifications"),
      (async () => {
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);
        const start = thirtyDaysAgo.toISOString().slice(0, 10);
        const end = today.toISOString().slice(0, 10);
        return api.get(`/orders/reports/pos-daily-sales?start_date=${start}&end_date=${end}`);
      })(),
      api.get("/orders/reports/best-sellers"),
      api.get("/products/sales"),
      api.get("/orders/reports/summary"),
      api.get("/orders/orders"),
    ]);

    const failed = [statsRes, notificationsRes, dailySalesRes, bestSellersRes, salesRes, summaryRes, recentOrdersRes].filter((res) => res.status === "rejected");
    if (failed.length > 0) {
      setError("Some dashboard data could not be loaded. Please refresh the page.");
    }

    if (statsRes.status === "fulfilled" && statsRes.value?.success) setStats(statsRes.value.stats);
    if (notificationsRes.status === "fulfilled" && notificationsRes.value?.success) setNotifications(notificationsRes.value.notifications || []);
    if (dailySalesRes.status === "fulfilled" && dailySalesRes.value?.success) setDailySales(dailySalesRes.value.data || []);
    if (bestSellersRes.status === "fulfilled" && bestSellersRes.value?.success) setBestSellers(bestSellersRes.value.data || []);
    if (salesRes.status === "fulfilled" && salesRes.value?.success) setSales(salesRes.value.sales || []);
    if (summaryRes.status === "fulfilled" && summaryRes.value?.success) setOrderSummary(summaryRes.value.summary);
    if (recentOrdersRes.status === "fulfilled" && recentOrdersRes.value?.success) setRecentOrders((recentOrdersRes.value.orders || []).slice(0, 5));

    setLoading(false);
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  const monthlyBuyingPatterns = useMemo(() => {
    const months = {};

    sales
      .filter((sale) => sale.product_id != null && Number(sale.product_deleted) === 0)
      .forEach((sale) => {
      const date = new Date(sale.created_at);
      if (Number.isNaN(date.getTime())) return;

      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const productName = sale.product_name || "Unknown item";
      const quantity = Number(sale.quantity) || 0;

      if (!months[monthKey]) months[monthKey] = { monthKey, items: {} };
      months[monthKey].items[productName] = (months[monthKey].items[productName] || 0) + quantity;
    });

    return Object.values(months)
      .map((month) => ({
        ...month,
        topItems: Object.entries(month.items)
          .map(([name, quantity]) => ({ name, quantity }))
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, 5),
      }))
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, [sales]);

  const formatPatternMonth = (monthKey) => {
    const [year, month] = monthKey.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  const getStatusConfig = (status) => {
    const map = {
      pending_payment: { label: "Pending Payment", color: "bg-yellow-100 text-yellow-800" },
      verified: { label: "Verified", color: "bg-blue-100 text-blue-800" },
      preparing: { label: "Preparing", color: "bg-orange-100 text-orange-800" },
      ready_for_pickup: { label: "Ready for Pickup", color: "bg-green-100 text-green-800" },
      completed: { label: "Completed", color: "bg-gray-100 text-gray-700" },
      rejected: { label: "Rejected", color: "bg-red-100 text-red-800" },
      cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-400" },
    };
    return map[status] || { label: status, color: "bg-gray-100 text-gray-600" };
  };

  return (
    <Layout title="Dashboard">

      <div className="p-6 space-y-6">
        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        {/* SUMMARY CARDS */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { label: "Total Products", value: stats?.total_products ?? "—", icon: PackageIcon, color: "text-blue-600" },
            { label: "Categories", value: stats?.total_categories ?? "—", icon: TagsIcon, color: "text-indigo-600" },
            { label: "Low Stock", value: stats?.low_stock ?? "—", icon: AlertTriangleIcon, color: "text-amber-600" },
            { label: "Pending Orders", value: stats?.pending_orders ?? "—", icon: ShoppingBagIcon, color: "text-orange-600" },
            { label: "Customers", value: stats?.total_customers ?? "—", icon: UsersIcon, color: "text-emerald-600" },
          ].map((card, i) => {
            const IconCmp = card.icon;
            return (
              <div key={i} className="bg-white p-4 rounded-2xl shadow-sm hover:shadow-md transition min-h-[120px]">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                    <IconCmp className="w-5 h-5" />
                  </div>
                </div>
                <p className={`text-2xl font-bold ${card.color}`}>{loading ? "—" : card.value}</p>
                <p className="text-sm text-gray-500 mt-1">{card.label}</p>
              </div>
            );
          })}
        </div>

        {/* ORDER SUMMARY CARDS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Online Orders", value: orderSummary?.total_orders ?? 0, color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
            { label: "Completed Orders", value: orderSummary?.completed_orders ?? 0, color: "text-green-700", bg: "bg-green-50 border-green-200" },
            { label: "Ready for Pickup", value: orderSummary?.ready_for_pickup_orders ?? 0, color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
            { label: "Online Revenue", value: formatCurrency(orderSummary?.completed_revenue ?? 0), color: "text-green-700", bg: "bg-green-50 border-green-200" },
          ].map((card, i) => (
            <div key={i} className={`p-4 rounded-2xl shadow-sm border ${card.bg}`}>
              <p className="text-sm text-gray-500">{card.label}</p>
              <p className={`text-xl font-bold mt-1 ${card.color}`}>{loading ? "—" : card.value}</p>
            </div>
          ))}
        </div>

        {/* CHARTS ROW */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* DAILY SALES CHART */}
          <div className="bg-white p-4 rounded-2xl shadow-sm">
            <h3 className="text-sm font-semibold text-gray-600 mb-3">Daily Sales (Last 30 Days)</h3>
            {dailySales.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={[...dailySales].reverse().map((d) => ({ ...d, revenue: Number(d.revenue) || 0 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(val) => `₱${Number(val).toFixed(2)}`} labelFormatter={(l) => new Date(l).toLocaleDateString()} />
                  <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-gray-400 text-sm">No sales data</div>
            )}
          </div>

          {/* BEST SELLING PRODUCTS */}
          <div className="bg-white p-4 rounded-2xl shadow-sm">
            <h3 className="text-sm font-semibold text-gray-600 mb-3">Best Selling Products</h3>
            {bestSellers.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={bestSellers.map((b) => ({ name: b.product_name, value: Number(b.total_sold) || 0 }))}
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {bestSellers.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-gray-400 text-sm">No product data</div>
            )}
          </div>
        </div>

        {/* TRENDS AND PATTERNS */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-blue-100">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Trends &amp; Patterns</h3>
            <p className="text-sm text-gray-500 mt-1">Items bought most often by month</p>
          </div>

          {monthlyBuyingPatterns.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500">
                    <th className="text-left py-3 pr-4 font-semibold">Month</th>
                    <th className="text-left py-3 px-4 font-semibold">Most bought items</th>
                    <th className="text-right py-3 pl-4 font-semibold">Total units</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyBuyingPatterns.map((month) => (
                    <tr key={month.monthKey} className="border-b border-gray-100 last:border-0">
                      <td className="py-4 pr-4 font-semibold text-gray-800 whitespace-nowrap">{formatPatternMonth(month.monthKey)}</td>
                      <td className="py-4 px-4 text-gray-600">
                        <div className="flex flex-wrap gap-2">
                          {month.topItems.map((item, index) => (
                            <span key={item.name} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${index === 0 ? "bg-blue-100 text-blue-800 font-semibold" : "bg-gray-100 text-gray-600"}`}>
                              {index + 1}. {item.name} <strong>{item.quantity}</strong>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-4 pl-4 text-right font-bold text-blue-700">{month.topItems.reduce((sum, item) => sum + item.quantity, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">No item sales available yet.</p>
          )}
        </div>

        {/* BOTTOM ROW: ALERTS + RECENT ORDERS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* NOTIFICATION ALERTS */}
          <div className="bg-white p-4 rounded-2xl shadow-sm">
            <h3 className="text-sm font-semibold text-gray-600 mb-3">Alerts</h3>
            <div className="space-y-2">
              {notifications.filter((n) => n.count > 0).length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No alerts</p>
              ) : (
                notifications.filter((n) => n.count > 0).map((n, i) => {
                  const AlertIcon =
                    n.type === "low_stock" ? AlertTriangleIcon
                    : n.type === "pending_payment" ? WalletIcon
                    : n.type === "pending_preparation" ? ReceiptIcon
                    : n.type === "ready_for_pickup" ? PackageIcon
                    : n.type === "new_orders" ? ShoppingBagIcon
                    : ClockIcon;
                  return (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                          <AlertIcon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">
                            {n.type === "low_stock" && "Low Stock Products"}
                            {n.type === "pending_payment" && "Pending Payment Verification"}
                            {n.type === "pending_preparation" && "Orders Ready to Prepare"}
                            {n.type === "new_orders" && "New Online Orders"}
                            {n.type === "ready_for_pickup" && "Ready for Pickup"}
                          </p>
                        </div>
                      </div>
                      <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{n.count}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RECENT ORDERS */}
          <div className="bg-white p-4 rounded-2xl shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-semibold text-gray-600">Recent Online Orders</h3>
              <Link to="/orders" className="text-xs text-blue-600 hover:text-blue-800 font-medium">View All →</Link>
            </div>
            {recentOrders.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No orders yet</p>
            ) : (
              <div className="space-y-2">
                {recentOrders.map((order) => {
                  const sc = getStatusConfig(order.order_status);
                  return (
                    <div key={order.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition cursor-pointer" onClick={() => navigate("/orders")}>
                      <div>
                        <p className="font-mono text-sm font-semibold text-blue-700">{order.order_number}</p>
                        <p className="text-xs text-gray-500">{order.customer_name} • {new Date(order.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-gray-800">₱{Number(order.total_amount).toFixed(2)}</p>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${sc.color}`}>
                          {sc.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* QUICK ACTIONS */}
        <div className="bg-white p-4 rounded-2xl shadow-sm">
          <h3 className="text-sm font-semibold text-gray-600 mb-3">Quick Actions</h3>
          <div className="flex flex-wrap gap-3">
            <Link to="/orders" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition">
              Manage Orders
            </Link>
            <Link to="/customers" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition">
              View Customers
            </Link>
            <Link to="/online-reports" className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition">
              Reports
            </Link>
            <Link to="/dashboard" className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 transition">
              Open POS
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}
