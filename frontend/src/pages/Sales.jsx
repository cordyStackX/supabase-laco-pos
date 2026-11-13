import React, { useCallback, useEffect, useMemo, useState } from "react";
import Layout from "./Layout";
import { getDepartmentInfo } from "../utils/departmentUtils";
import SalesKpiCard from "../components/sales/SalesKpiCard";
import SalesChart from "../components/sales/SalesChart";
import SalesToolbar from "../components/sales/SalesToolbar";
import ReceiptCard from "../components/sales/ReceiptCard";
import ReceiptDetails from "../components/sales/ReceiptDetails";
import MiniDonut from "../components/sales/MiniDonut";
import Sparkline from "../components/sales/Sparkline";
import { api } from "../lib/api";
import {
  ShoppingBagIcon,
  WalletIcon,
  TrophyIcon,
  PrinterIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ReceiptIcon,
} from "../components/Icons";

export default function SalesPage() {
  const [sales, setSales] = useState([]);
  const [filter, setFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [customDate, setCustomDate] = useState("");
  const [search, setSearch] = useState("");
  const [selectedReceiptId, setSelectedReceiptId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [printDate, setPrintDate] = useState("");
  const [printMonth, setPrintMonth] = useState("");
  const [printOpen, setPrintOpen] = useState(false);
  const itemsPerPage = 10;

  /* ================= LOAD ================= */
  const loadSales = useCallback(async () => {
    try {
      const data = await api.get("/products/sales");
      console.log("Loaded sales:", data.sales);
      if (data.success) setSales(data.sales);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  const toDateStr = (d) => d.toISOString().slice(0, 10);

  const getSaleDepartmentLabel = useCallback((row) => {
    const rawDepartment = String(row.product_department || row.department || row.category || row.product?.department || row.product?.category || row.category_name || row.product_category?.name || "").trim();
    if (!rawDepartment) return null;
    const label = getDepartmentInfo(rawDepartment).label;
    if (label === "Students" || label === "Teachers" || label === "Personnel") return null;
    return label === "General" ? null : label;
  }, []);

  const getSaleBuyerTypeLabel = useCallback((row) => {
    const rawBuyerType = String(row.customer_type || row.checkout_department || "").trim();
    if (!rawBuyerType) return null;
    const label = getDepartmentInfo(rawBuyerType).label;
    return label === "Students" || label === "Teachers" || label === "Personnel" ? label : null;
  }, []);

  const getProductDepartmentLabel = useCallback((row) => {
    const rawDepartment = String(row.product_department || row.department || row.category || row.product?.department || row.product?.category || row.category_name || row.product_category?.name || "").trim();
    if (!rawDepartment) return null;
    const label = getDepartmentInfo(rawDepartment).label;
    if (label === "Students" || label === "Teachers" || label === "Personnel") return null;
    return label === "General" ? null : label;
  }, []);

  const formatDate = (dateString) =>
    new Date(dateString).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });

  /* ================= FILTER ================= */
  const filtered = useMemo(() => {
    const now = new Date();
    const todayStr = toDateStr(now);
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    return sales.filter((s) => {
      const d = new Date(s.created_at);
      if (isNaN(d)) return false;

      if (filter === "today") return toDateStr(d) === todayStr;
      if (filter === "month")
        return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
      if (filter === "custom" && customDate)
        return toDateStr(d) === customDate;

      if (departmentFilter !== "all") {
        const deptLabel = getSaleDepartmentLabel(s);
        return deptLabel === departmentFilter;
      }

      return true;
    });
  }, [sales, filter, customDate, departmentFilter, getSaleDepartmentLabel]);

  /* ================= SEARCH ================= */
  const searchedSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filtered;

    return filtered.filter((s) => {
      const receiptId = String(s.receipt_id != null ? s.receipt_id : s.id);
      const customer = String(s.customer_name || "");
      const product = String(s.product_name || "");
      return (
        receiptId.toLowerCase().includes(q) ||
        customer.toLowerCase().includes(q) ||
        product.toLowerCase().includes(q)
      );
    });
  }, [filtered, search]);

  /* ================= SUMMARY ================= */
  const totalEarnings = useMemo(
    () => searchedSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0),
    [searchedSales]
  );

  const totalUnits = useMemo(
    () => searchedSales.reduce((sum, sale) => sum + (Number(sale.quantity) || 0), 0),
    [searchedSales]
  );

  const activeCatalogSales = useMemo(
    () => searchedSales.filter((sale) => sale.product_id != null && Number(sale.product_deleted) === 0),
    [searchedSales]
  );

  const activeProductUnits = useMemo(
    () => activeCatalogSales.reduce((sum, sale) => sum + (Number(sale.quantity) || 0), 0),
    [activeCatalogSales]
  );

  const productSummary = useMemo(() => {
    return activeCatalogSales
      .reduce((acc, sale) => {
        const name = sale.product_name;
        const qty = Number(sale.quantity) || 0;
        acc[name] = (acc[name] || 0) + qty;
        return acc;
      }, {});
  }, [activeCatalogSales]);

  const mostBoughtItems = useMemo(
    () =>
      Object.entries(productSummary)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [productSummary]
  );

  /* ================= GROUP ================= */
  const groupedByReceipt = useMemo(() => {
    return Object.values(
      searchedSales.reduce((acc, row) => {
        const key = row.receipt_id != null ? row.receipt_id : row.id;

        if (!acc[key]) {
          acc[key] = {
            receiptId: key,
            created_at: row.created_at,
            customer_name: row.customer_name?.trim() || null,
            items: {},
            total: 0,
          };
        }

        const itemKey = `${row.product_name}-${row.barcode}-${getProductDepartmentLabel(row) || ""}-${getSaleBuyerTypeLabel(row) || ""}`;
        const existingItem = acc[key].items[itemKey];
        const quantity = Number(row.quantity) || 0;
        const itemTotal = Number(row.total) || 0;

        if (existingItem) {
          existingItem.quantity += quantity;
          existingItem.total += itemTotal;
        } else {
          acc[key].items[itemKey] = {
            id: row.id || itemKey,
            product_name: row.product_name,
            quantity,
            total: itemTotal,
            department: getProductDepartmentLabel(row),
            buyerType: getSaleBuyerTypeLabel(row),
          };
        }

        acc[key].total += itemTotal;

        return acc;
      }, {})
    )
      .map((receipt) => ({
        ...receipt,
        items: Object.values(receipt.items),
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [searchedSales, getProductDepartmentLabel, getSaleBuyerTypeLabel]);

  const paginatedSales = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return groupedByReceipt.slice(start, start + itemsPerPage);
  }, [groupedByReceipt, currentPage]);

  const departmentOptions = useMemo(
    () => Array.from(new Set(sales.map((sale) => getSaleDepartmentLabel(sale)).filter(Boolean))).sort(),
    [sales, getSaleDepartmentLabel]
  );

  const totalPages = Math.ceil(groupedByReceipt.length / itemsPerPage);

  const paginationItems = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages = [];

    if (currentPage <= 4) {
      pages.push(1, 2, 3, 4, 5, "...", totalPages);
    } else if (currentPage >= totalPages - 3) {
      pages.push(1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages);
    }

    return pages;
  }, [currentPage, totalPages]);

  /* ================= CHART DATA ================= */
  const chartData = useMemo(() => {
    const map = {};
    searchedSales.forEach((s) => {
      const d = new Date(s.created_at);
      if (isNaN(d)) return;
      const key = toDateStr(d);
      if (!map[key]) {
        map[key] = {
          date: key,
          label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          revenue: 0,
          sales: 0,
        };
      }
      map[key].revenue += Number(s.total) || 0;
      map[key].sales += 1;
    });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [searchedSales]);

  /* ================= MINI CHART DATA ================= */
  const dailyReceipts = useMemo(() => chartData.map((d) => d.sales), [chartData]);
  const dailyRevenue = useMemo(() => chartData.map((d) => d.revenue), [chartData]);
  const topItemPercent = useMemo(() => {
    if (!activeProductUnits) return 0;
    return Math.round(((mostBoughtItems[0]?.[1] || 0) / activeProductUnits) * 100);
  }, [mostBoughtItems, activeProductUnits]);

  /* ================= SELECTION ================= */
  useEffect(() => {
    setSelectedReceiptId((prev) => {
      if (prev && groupedByReceipt.some((r) => r.receiptId === prev)) return prev;
      return groupedByReceipt[0]?.receiptId ?? null;
    });
  }, [groupedByReceipt]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filter, customDate, departmentFilter]);

  const selectedReceipt = useMemo(
    () => groupedByReceipt.find((r) => r.receiptId === selectedReceiptId) ?? null,
    [groupedByReceipt, selectedReceiptId]
  );

  const resetFilters = () => {
    setFilter("all");
    setCustomDate("");
    setDepartmentFilter("all");
    setSearch("");
    setCurrentPage(1);
  };

  /* ================= PRINT ================= */
  const handlePrint = () => {
    if (!printDate) return alert("Select date");

    const daily = sales.filter(
      (s) =>
        toDateStr(new Date(s.created_at)) === printDate &&
        (departmentFilter === "all" || getSaleDepartmentLabel(s) === departmentFilter)
    );

    const total = daily.reduce((sum, s) => sum + Number(s.total || 0), 0);

    const rows = daily.reduce((acc, s) => {
      const label = [getSaleBuyerTypeLabel(s), getProductDepartmentLabel(s)].filter(Boolean).join(")(");
      const labelText = label ? `(${label})` : "";
      const key = `${s.product_name}-${s.barcode}-${labelText}`;
      if (acc[key]) {
        acc[key].quantity += Number(s.quantity) || 0;
        acc[key].total += Number(s.total) || 0;
      } else {
        acc[key] = {
          product_name: s.product_name,
          quantity: Number(s.quantity) || 0,
          total: Number(s.total) || 0,
          department: labelText,
        };
      }
      return acc;
    }, {});

    const w = window.open("", "_blank");

    w.document.write(`
      <html>
        <head>
          <title>Daily Sales ${printDate}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1f2937; }
            .header { text-align: center; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 2px solid #2563eb; }
            .header h1 { font-size: 24px; color: #1e3a8a; }
            .header p { color: #6b7280; margin-top: 4px; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #2563eb; color: #fff; padding: 10px 14px; text-align: left; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; }
            td { padding: 10px 14px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
            tr:nth-child(even) td { background: #f9fafb; }
            .total-row td { font-weight: 700; font-size: 16px; border-top: 2px solid #2563eb; border-bottom: none; background: #eff6ff; }
            .text-right { text-align: right; }
            .footer { text-align: center; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
            @media print { body { padding: 20px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Daily Sales Report</h1>
            <p>${printDate}</p>
          </div>
          <table>
            <thead>
              <tr>
                  <th>Product</th>
                  <th>Department</th>
                  <th class="text-right">Qty</th>
                  <th class="text-right">Total</th>
                </tr>
            </thead>
            <tbody>
                  ${Object.values(rows)
                .map(
                  (r) =>
                    `<tr><td>${r.product_name}</td><td>${r.department || "-"}</td><td class="text-right">${r.quantity}</td><td class="text-right">₱${r.total.toFixed(2)}</td></tr>`
                )
                .join("")}
            </tbody>
            <tfoot>
              <tr class="total-row">
                <td colspan="2">Total</td>
                <td class="text-right">${daily.reduce((s, r) => s + (Number(r.quantity) || 0), 0)}</td>
                <td class="text-right">₱${total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
          <div class="footer">LCCB Bookstore &mdash; Generated ${new Date().toLocaleString()}</div>
        </body>
      </html>
    `);

    w.print();
  };

  const handleMonthlyPrint = () => {
    if (!printMonth) return alert("Select month");

    const monthly = sales.filter((s) => {
      const d = new Date(s.created_at);
      return (
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === printMonth &&
        (departmentFilter === "all" || getSaleDepartmentLabel(s) === departmentFilter)
      );
    });

    if (monthly.length === 0) return alert("No sales for this month");

    const total = monthly.reduce((sum, s) => sum + Number(s.total || 0), 0);

    const rows = monthly.reduce((acc, s) => {
      const label = [getSaleBuyerTypeLabel(s), getProductDepartmentLabel(s)].filter(Boolean).join(")(");
      const labelText = label ? `(${label})` : "";
      const key = `${s.product_name}-${s.barcode}-${labelText}`;
      if (acc[key]) {
        acc[key].quantity += Number(s.quantity) || 0;
        acc[key].total += Number(s.total) || 0;
      } else {
        acc[key] = {
          product_name: s.product_name,
          quantity: Number(s.quantity) || 0,
          total: Number(s.total) || 0,
          department: labelText,
        };
      }
      return acc;
    }, {});

    const [year, month] = printMonth.split("-");
    const monthName = new Date(year, month - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
    const daysActive = new Set(monthly.map((s) => new Date(s.created_at).toDateString())).size;

    const w = window.open("", "_blank");

    w.document.write(`
      <html>
        <head>
          <title>Monthly Sales ${printMonth}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1f2937; }
            .header { text-align: center; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 2px solid #2563eb; }
            .header h1 { font-size: 24px; color: #1e3a8a; }
            .header p { color: #6b7280; margin-top: 4px; }
            .summary { display: flex; gap: 24px; justify-content: center; margin-bottom: 24px; }
            .summary-card { text-align: center; padding: 12px 24px; background: #f9fafb; border-radius: 8px; }
            .summary-card .label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
            .summary-card .value { font-size: 20px; font-weight: 700; color: #1e3a8a; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #2563eb; color: #fff; padding: 10px 14px; text-align: left; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; }
            td { padding: 10px 14px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
            tr:nth-child(even) td { background: #f9fafb; }
            .total-row td { font-weight: 700; font-size: 16px; border-top: 2px solid #2563eb; border-bottom: none; background: #eff6ff; }
            .text-right { text-align: right; }
            .footer { text-align: center; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
            @media print { body { padding: 20px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Monthly Sales Report</h1>
            <p>${monthName}</p>
          </div>
          <div class="summary">
            <div class="summary-card">
              <div class="label">Total Revenue</div>
              <div class="value">₱${total.toFixed(2)}</div>
            </div>
            <div class="summary-card">
              <div class="label">Items Sold</div>
              <div class="value">${monthly.reduce((s, r) => s + (Number(r.quantity) || 0), 0)}</div>
            </div>
            <div class="summary-card">
              <div class="label">Days with Sales</div>
              <div class="value">${daysActive}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                  <th>Product</th>
                  <th>Department</th>
                  <th class="text-right">Qty</th>
                  <th class="text-right">Total</th>
                </tr>
            </thead>
            <tbody>
                  ${Object.values(rows)
                .map(
                  (r) =>
                    `<tr><td>${r.product_name}</td><td>${r.department || "-"}</td><td class="text-right">${r.quantity}</td><td class="text-right">₱${r.total.toFixed(2)}</td></tr>`
                )
                .join("")}
            </tbody>
            <tfoot>
              <tr class="total-row">
                <td colspan="2">Total</td>
                <td class="text-right">${monthly.reduce((s, r) => s + (Number(r.quantity) || 0), 0)}</td>
                <td class="text-right">₱${total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
          <div class="footer">LCCB Bookstore &mdash; Generated ${new Date().toLocaleString()}</div>
        </body>
      </html>
    `);

    w.print();
  };

  return (
    <Layout title="Sales">
      <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-gray-50">

        {/* ================= HEADER ================= */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sales Overview</h1>
            <p className="text-sm text-gray-500 mt-1">Track and review your bookstore transactions</p>
          </div>

          {/* PRINT */}
          <div className="relative">
            <button
              onClick={() => setPrintOpen((v) => !v)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 shadow-sm shadow-blue-600/20 transition"
            >
              <PrinterIcon className="w-4 h-4" />
              Print Report
              <ChevronDownIcon className={`w-4 h-4 transition-transform ${printOpen ? "rotate-180" : ""}`} />
            </button>

            {printOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl border border-gray-200 shadow-lg p-4 z-30 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Daily Report Date
                  </label>
                  <input
                    type="date"
                    value={printDate}
                    onChange={(e) => setPrintDate(e.target.value)}
                    className="w-full mt-1.5 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                  <button
                    onClick={() => { handlePrint(); setPrintOpen(false); }}
                    className="w-full mt-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition inline-flex items-center justify-center gap-1.5"
                  >
                    <PrinterIcon className="w-4 h-4" /> Print Daily
                  </button>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Monthly Report Month
                  </label>
                  <input
                    type="month"
                    value={printMonth}
                    onChange={(e) => setPrintMonth(e.target.value)}
                    className="w-full mt-1.5 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                  <button
                    onClick={() => { handleMonthlyPrint(); setPrintOpen(false); }}
                    className="w-full mt-2 px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-100 transition inline-flex items-center justify-center gap-1.5"
                  >
                    <PrinterIcon className="w-4 h-4" /> Print Monthly
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ================= OVERVIEW ================= */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <SalesKpiCard
            icon={<ShoppingBagIcon className="w-6 h-6" />}
            tileClass="bg-blue-50 text-blue-600"
            label="Total Sales"
            value={groupedByReceipt.length}
            sub={`${searchedSales.length} item record(s)`}
            chart={<Sparkline data={dailyReceipts} color="#2563EB" />}
          />
          <SalesKpiCard
            icon={<WalletIcon className="w-6 h-6" />}
            tileClass="bg-emerald-50 text-emerald-600"
            label="Revenue"
            value={`₱${totalEarnings.toFixed(2)}`}
            sub={`${totalUnits} item(s) sold`}
            chart={<Sparkline data={dailyRevenue} color="#16A34A" />}
          />
          <SalesKpiCard
            icon={<TrophyIcon className="w-6 h-6" />}
            tileClass="bg-amber-50 text-amber-600"
            label="Top Item"
            value={mostBoughtItems[0]?.[0] || "N/A"}
            sub={mostBoughtItems[0] ? `${mostBoughtItems[0][1]} unit(s) sold` : "No sales yet"}
            chart={<MiniDonut percent={topItemPercent} color="#F59E0B" />}
          />
        </div>

        {/* ================= CHART ================= */}
        <SalesChart data={chartData} />

        {/* ================= TRANSACTIONS ================= */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-xl font-bold text-gray-900">Transactions</h2>
            {groupedByReceipt.length > 0 && (
              <span className="text-sm text-gray-500">
                {groupedByReceipt.length} receipt(s) found
              </span>
            )}
          </div>

          <SalesToolbar
            customDate={customDate}
            onDateChange={(e) => {
              setFilter("custom");
              setCustomDate(e.target.value);
            }}
            search={search}
            onSearchChange={setSearch}
            filter={filter}
            onFilterChange={setFilter}
            departments={departmentOptions}
            departmentFilter={departmentFilter}
            onDepartmentChange={(e) => setDepartmentFilter(e.target.value)}
            onReset={resetFilters}
          />

          <div className="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
            {/* LIST */}
            <div className="xl:col-span-2 space-y-4">
              {paginatedSales.length > 0 ? (
                paginatedSales.map((sale) => (
                  <ReceiptCard
                    key={sale.receiptId}
                    sale={sale}
                    selected={sale.receiptId === selectedReceiptId}
                    onSelect={() => setSelectedReceiptId(sale.receiptId)}
                    formatDate={formatDate}
                  />
                ))
              ) : (
                <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 text-center">
                  <div className="h-14 w-14 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                    <ReceiptIcon className="w-7 h-7 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-600">No transactions found</p>
                  <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or search</p>
                </div>
              )}

              {/* PAGINATION */}
              {totalPages > 1 && (
                <div className="flex flex-wrap justify-center items-center gap-2 pt-2">
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 transition"
                  >
                    <ChevronLeftIcon className="w-4 h-4" /> Previous
                  </button>

                  {paginationItems.map((page, index) =>
                    page === "..." ? (
                      <span key={`dots-${index}`} className="px-3 py-2 text-sm text-gray-500">
                        ...
                      </span>
                    ) : (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`min-w-[38px] px-4 py-2 rounded-lg border text-sm transition ${
                          currentPage === page
                            ? "bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/30"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                        }`}
                      >
                        {page}
                      </button>
                    )
                  )}

                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages || totalPages === 0}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 transition"
                  >
                    Next <ChevronRightIcon className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* DETAILS PANEL */}
            <div className="xl:col-span-1">
              <ReceiptDetails sale={selectedReceipt} formatDate={formatDate} />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
