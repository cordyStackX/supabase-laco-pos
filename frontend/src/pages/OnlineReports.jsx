import React, { useCallback, useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Layout from "./Layout";
import { api } from "../lib/api";

export default function OnlineReports() {
  const [activeTab, setActiveTab] = useState("overview");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [chartGrouping, setChartGrouping] = useState("daily");
  const [summary, setSummary] = useState(null);
  const [dailySales, setDailySales] = useState([]);
  const [bestSellers, setBestSellers] = useState([]);
  const [customerSummary, setCustomerSummary] = useState([]);
  const [recentCompleted, setRecentCompleted] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!localStorage.getItem("user")) navigate("/");
  }, [navigate]);

  const dateParams = useCallback(() => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    return params.toString();
  }, [startDate, endDate]);

  // Memoised so the effect below depends on a stable identity and refetches
  // exactly when the date range changes.
  const fetchData = useCallback(async () => {
    const dp = dateParams();
    try {
      const [summaryData, dailyData, bestData, customerData, ordersData] = await Promise.all([
        api.get(`/orders/reports/summary?${dp}`),
        api.get(`/orders/reports/daily-sales?${dp}`),
        api.get(`/orders/reports/best-sellers?${dp}`),
        api.get(`/orders/reports/customer-summary`),
        api.get(`/orders/orders`),
      ]);

      if (summaryData.success) setSummary(summaryData.summary);
      if (dailyData.success) setDailySales(dailyData.data || []);
      if (bestData.success) setBestSellers(bestData.data || []);
      if (customerData.success) setCustomerSummary(customerData.data || []);
      if (ordersData.success) setRecentCompleted((ordersData.orders || []).filter((o) => o.order_status === "completed").slice(0, 20));
    } catch (err) { console.error(err); }
  }, [dateParams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatDate = (d) => new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  const dailyChartData = useMemo(
    () => {
      const grouped = {};

      dailySales.forEach((row) => {
        const date = new Date(row.date);
        if (Number.isNaN(date.getTime())) return;

        let key = row.date;
        if (chartGrouping === "weekly") {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().slice(0, 10);
        }
        if (chartGrouping === "monthly") key = row.date.slice(0, 7);

        if (!grouped[key]) grouped[key] = { date: key, revenue: 0, orders: 0 };
        grouped[key].revenue += Number(row.revenue) || 0;
        grouped[key].orders += Number(row.orders) || 0;
      });

      return Object.values(grouped).sort((a, b) => new Date(a.date) - new Date(b.date));
    },
    [dailySales, chartGrouping]
  );

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "daily", label: "Daily Sales" },
    { key: "best", label: "Best Sellers" },
    { key: "customers", label: "Customer Summary" },
    { key: "completed", label: "Completed Orders" },
  ];

  return (
    <Layout title="Online Reports">
      <div className="flex-1 p-6 overflow-y-auto space-y-4">
        {/* DATE FILTER */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-600 font-medium">From:</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <label className="text-sm text-gray-600 font-medium">To:</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={() => { setStartDate(""); setEndDate(""); }} className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 rounded-lg transition">Clear</button>
        </div>

        {/* TABS */}
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${activeTab === t.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* OVERVIEW TAB */}
        {activeTab === "overview" && summary && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-blue-100">
                <p className="text-sm text-gray-500">Total Orders</p>
                <p className="text-2xl font-bold text-blue-700">{summary.total_orders}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-green-100">
                <p className="text-sm text-gray-500">Completed Orders</p>
                <p className="text-2xl font-bold text-green-700">{summary.completed_orders}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-yellow-100">
                <p className="text-sm text-gray-500">Preparing</p>
                <p className="text-2xl font-bold text-orange-600">{summary.preparing_orders}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-100">
                <p className="text-sm text-gray-500">Ready for Pickup</p>
                <p className="text-2xl font-bold text-emerald-600">{summary.ready_for_pickup_orders}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-4 rounded-2xl shadow-sm">
                <p className="text-sm text-gray-500">Total Revenue</p>
                <p className="text-2xl font-bold text-gray-800">₱{Number(summary.total_revenue).toFixed(2)}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm">
                <p className="text-sm text-gray-500">Completed Revenue</p>
                <p className="text-2xl font-bold text-green-600">₱{Number(summary.completed_revenue).toFixed(2)}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm">
                <p className="text-sm text-gray-500">Rejected Orders</p>
                <p className="text-2xl font-bold text-red-600">{summary.rejected_orders}</p>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Daily Sales</h3>
                  <p className="text-sm text-gray-500">Recent online orders and revenue</p>
                </div>
                <select value={chartGrouping} onChange={(e) => setChartGrouping(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              {dailyChartData.length === 0 ? (
                <div className="flex items-center justify-center h-[220px] text-gray-400 text-sm">No trend data available</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={dailyChartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(date) => new Date(date).toLocaleDateString("en-US", chartGrouping === "monthly" ? { month: "short", year: "numeric" } : { month: "short", day: "numeric" })}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => `₱${value}`}
                    />
                    <Tooltip
                      formatter={(value) => [`₱${Number(value).toFixed(2)}`, "Revenue"]}
                      labelFormatter={(date) => new Date(date).toLocaleDateString("en-US", { dateStyle: "medium" })}
                      contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 13 }}
                    />
                    <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3, fill: "#2563eb", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-600">
                      <th className="text-left py-2 font-semibold">Date</th>
                      <th className="text-center py-2 font-semibold">Orders</th>
                      <th className="text-right py-2 font-semibold">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailySales.length === 0 ? (
                      <tr><td colSpan={3} className="text-center py-5 text-gray-400">No data available</td></tr>
                    ) : (
                      dailySales.slice(0, 7).map((row, i) => (
                        <tr key={i} className="border-b border-gray-100 last:border-0">
                          <td className="py-2 font-medium text-gray-800">{new Date(row.date).toLocaleDateString("en-US", { dateStyle: "medium" })}</td>
                          <td className="py-2 text-center">{row.orders}</td>
                          <td className="py-2 text-right font-semibold text-green-600">₱{Number(row.revenue).toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* DAILY SALES TAB */}
        {activeTab === "daily" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Online Revenue Trend</h3>
                  <p className="text-sm text-gray-500">Revenue for the selected period</p>
                </div>
                <select value={chartGrouping} onChange={(e) => setChartGrouping(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              {dailyChartData.length === 0 ? (
                <div className="flex items-center justify-center h-[280px] text-gray-400 text-sm">No trend data available</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={dailyChartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(date) => new Date(date).toLocaleDateString("en-US", chartGrouping === "monthly" ? { month: "short", year: "numeric" } : { month: "short", day: "numeric" })}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => `₱${value}`}
                    />
                    <Tooltip
                      formatter={(value) => [`₱${Number(value).toFixed(2)}`, "Revenue"]}
                      labelFormatter={(date) => new Date(date).toLocaleDateString("en-US", { dateStyle: "medium" })}
                      contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 13 }}
                    />
                    <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3, fill: "#2563eb", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Orders</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {dailySales.length === 0 ? (
                    <tr><td colSpan={3} className="text-center py-8 text-gray-400">No data available</td></tr>
                  ) : (
                    dailySales.map((row, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-800">{new Date(row.date).toLocaleDateString("en-US", { dateStyle: "medium" })}</td>
                        <td className="px-4 py-3 text-center">{row.orders}</td>
                        <td className="px-4 py-3 text-right font-bold text-green-600">₱{Number(row.revenue).toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </div>
        )}

        {/* BEST SELLERS TAB */}
        {activeTab === "best" && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">#</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Product</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Units Sold</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {bestSellers.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8 text-gray-400">No data available</td></tr>
                  ) : (
                    bestSellers.map((row, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{row.product_name}</td>
                        <td className="px-4 py-3 text-center font-semibold">{row.total_sold}</td>
                        <td className="px-4 py-3 text-right font-bold text-green-600">₱{Number(row.total_revenue).toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CUSTOMER SUMMARY TAB */}
        {activeTab === "customers" && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Contact</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Orders</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Spent</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Last Order</th>
                  </tr>
                </thead>
                <tbody>
                  {customerSummary.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-gray-400">No data available</td></tr>
                  ) : (
                    customerSummary.map((row, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-800">{row.name}</td>
                        <td className="px-4 py-3 text-gray-500">{row.email || "—"}</td>
                        <td className="px-4 py-3 text-gray-600">{row.contact || "—"}</td>
                        <td className="px-4 py-3 text-center">{row.total_orders}</td>
                        <td className="px-4 py-3 text-right font-bold text-green-600">₱{Number(row.total_spent).toFixed(2)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{row.last_order ? formatDate(row.last_order) : "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* COMPLETED ORDERS TAB */}
        {activeTab === "completed" && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Order #</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Amount</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Payment</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCompleted.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400">No completed orders</td></tr>
                  ) : (
                    recentCompleted.map((order) => (
                      <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono font-semibold text-blue-700">{order.order_number}</td>
                        <td className="px-4 py-3">{order.customer_name}</td>
                        <td className="px-4 py-3 text-right font-bold text-green-600">₱{Number(order.total_amount).toFixed(2)}</td>
                        <td className="px-4 py-3 uppercase text-xs font-medium">{order.payment_method}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(order.updated_at || order.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
