import React, { useEffect, useState } from "react";
import Layout from "./Layout";
import { api } from "../lib/api";
import {
  SearchIcon,
  CalendarIcon,
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  AlertTriangleIcon,
} from "../components/Icons";

export default function InventoryLog() {

  const [logs, setLogs] = useState([]);
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [typeFilter, setTypeFilter] = useState("all"); // all | IN | OUT
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    loadLogs();
  }, []);

  useEffect(() => {
    if (!user?.name) {
      const stored = JSON.parse(localStorage.getItem("user") || "{}");
      setUser(stored);
    }
  }, [user?.name]);

  useEffect(() => {
    setCurrentPage(1);
  }, [typeFilter, search, dateFilter]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      // Access is decided server-side from the bearer token; the previous
      // x-user-role / x-user-can-view-inventory-logs headers were client-asserted.
      const data = await api.get("/inventory-logs");

      if (!data.success)
        throw new Error("Failed to load logs");

      const allLogs = data.logs.map(log => ({
        id: `${log.type === 'IN' ? 'in' : 'out'}-${log.id}`,
        productName: log.product_name,
        type: log.type,
        quantity: log.quantity,
        staff: log.staff,
        timestamp: log.created_at,
        reason: log.reason,
      }));

      setLogs(allLogs);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter((log) => {
    const matchType =
      typeFilter === "all" ? true : log.type === typeFilter;

    const matchSearch =
      log.productName?.toLowerCase().includes(search.toLowerCase()) ||
      log.staff?.toLowerCase().includes(search.toLowerCase());

    const matchDate = dateFilter
      ? new Date(log.timestamp).toISOString().slice(0, 10) === dateFilter
      : true;

    return matchType && matchSearch && matchDate;
  });

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const getPaginationButtons = () => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages = [];

    if (currentPage <= 3) {
      pages.push(1, 2, 3, 4, 'ellipsis', totalPages);
    } else if (currentPage >= totalPages - 2) {
      pages.push(1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', totalPages);
    }

    return pages;
  };

  if (loading)
    return (
      <div className="h-screen w-screen bg-gray-50 flex justify-center items-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
          <p className="text-sm font-medium text-gray-500">Loading inventory logs...</p>
        </div>
      </div>
    );

  if (error)
    return (
      <div className="h-screen w-screen bg-gray-50 flex justify-center items-center">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <AlertTriangleIcon className="w-10 h-10 text-red-500" />
          </div>
          <p className="text-lg font-semibold text-red-600">{error}</p>
        </div>
      </div>
    );

  return (
    <Layout title="Inventory Log">
      <div className="p-4 md:p-6 space-y-4">
        {/* TOOLBAR */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5 pl-3 pr-2 h-11 flex-1 min-w-[220px] rounded-xl border border-gray-300 bg-gray-50 text-sm focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-500 transition">
            <SearchIcon className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              placeholder="Search product or staff..."
              className="flex-1 h-full bg-transparent border-none outline-none text-gray-700 placeholder:text-gray-400"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="h-11 px-4 rounded-xl border border-gray-300 bg-white text-gray-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200 cursor-pointer text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">All Types</option>
            <option value="IN">Stock IN</option>
            <option value="OUT">Stock OUT</option>
          </select>

          <div className="flex items-center gap-2.5 pl-3 pr-2 h-11 rounded-xl border border-gray-300 bg-gray-50 text-sm focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-500 transition">
            <CalendarIcon className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-gray-700 text-sm"
            />
          </div>
        </div>

        {/* TABLE */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">No.</th>
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Product</th>
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Quantity</th>
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Reason</th>
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Staff</th>
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
              </tr>
            </thead>

            <tbody>
              {paginatedLogs.map((log, index) => (
                <tr key={log.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="p-3 text-sm text-gray-500 whitespace-nowrap">
                    {(currentPage - 1) * itemsPerPage + index + 1}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {log.type === "IN" ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">
                        <ArrowDownToLineIcon className="w-3.5 h-3.5" />
                        IN
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-600 border border-rose-100">
                        <ArrowUpFromLineIcon className="w-3.5 h-3.5" />
                        OUT
                      </span>
                    )}
                  </td>

                  <td className="p-3 font-medium text-gray-900 whitespace-nowrap">
                    {log.productName}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <span className={`text-sm font-semibold ${log.type === "IN" ? "text-emerald-600" : "text-rose-600"}`}>
                      {log.type === "IN" ? "+" : "−"}{log.quantity}
                    </span>
                  </td>
                  <td className="p-3 text-sm text-gray-500 whitespace-nowrap">
                    {log.reason || "-"}
                  </td>
                  <td className="p-3 text-sm text-gray-500 whitespace-nowrap">
                    {log.staff}
                  </td>
                  <td className="p-3 text-sm text-gray-500 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {paginatedLogs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <ArrowDownToLineIcon className="w-10 h-10 text-gray-300" />
              <p className="text-sm text-gray-500">No logs found.</p>
            </div>
          )}

          {/* PAGINATION */}
          {totalPages > 1 && (
            <div className="p-4 bg-gray-50 border-t border-gray-200 flex flex-wrap justify-center items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 transition"
              >
                Previous
              </button>

              {getPaginationButtons().map((page, index) =>
                page === 'ellipsis' ? (
                  <span key={`ellipsis-${index}`} className="px-3 py-2 text-sm text-gray-500">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`min-w-[38px] px-4 py-2 rounded-lg border text-sm transition ${
                      currentPage === page
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    {page}
                  </button>
                )
              )}

              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 transition"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
