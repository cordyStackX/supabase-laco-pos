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
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-400 border-gray-200" },
};

const STATUS_FILTERS = [
  { key: "all", label: "All Orders" },
  { key: "pending_payment", label: "Pending Payment" },
  { key: "verified", label: "Payment Verified" },
  { key: "preparing", label: "Preparing" },
  { key: "ready_for_pickup", label: "Ready for Pickup" },
  { key: "completed", label: "Completed" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
];

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showReceipt, setShowReceipt] = useState(null);
  const [receiptImageUrl, setReceiptImageUrl] = useState(null);
  const [receiptImageLoading, setReceiptImageLoading] = useState(false);
  const [receiptImageError, setReceiptImageError] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const navigate = useNavigate();

  const user = (() => {
    try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; }
  })();

  useEffect(() => {
    if (!localStorage.getItem("user")) navigate("/");
  }, [navigate]);

  const loadOrders = async () => {
    try {
      const data = await api.get("/orders/orders");
      if (data.success) setOrders(Array.isArray(data.orders) ? data.orders : []);
      else console.error("GET /api/orders/orders failed:", data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { loadOrders(); }, []);

  useEffect(() => {
    if (!showReceipt?.receipt_image) {
      setReceiptImageUrl(null);
      setReceiptImageLoading(false);
      setReceiptImageError("");
      return;
    }

    let active = true;
    let objectUrl = null;
    const filename = showReceipt.receipt_image.split("/").pop();
    setReceiptImageUrl(null);
    setReceiptImageLoading(true);
    setReceiptImageError("");

    api.get(`/orders/receipts/${encodeURIComponent(filename)}`, { raw: true })
      .then((response) => response.blob())
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setReceiptImageUrl(objectUrl);
      })
      .catch((err) => {
        if (active) setReceiptImageError(err.message || "Unable to load payment receipt");
      })
      .finally(() => {
        if (active) setReceiptImageLoading(false);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [showReceipt]);

  const genId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  };

  const addNotification = (message, type = "info") => {
    const id = genId();
    setNotifications((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 5000);
  };

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.order_status !== statusFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return (
          o.order_number?.toLowerCase().includes(s) ||
          o.customer_name?.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [orders, search, statusFilter]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filtered.slice(start, start + itemsPerPage);
  }, [filtered, currentPage]);

  const formatDate = (d) => {
    try {
      const date = new Date(d);
      if (isNaN(date.getTime())) return "—";
      return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    } catch { return "—"; }
  };

  const showOrdersByStatus = (status) => {
    setStatusFilter(status);
    setSearch("");
    setCurrentPage(1);
    setShowDetail(false);
    setSelectedOrder(null);
  };

  const handleStatusChange = async (orderId, newStatus, source = "pos") => {
    try {
      const data = await api.put(`/orders/orders/${orderId}/status?source=${source}`, {
        status: newStatus,
      });
      if (data.success) {
        addNotification(`Order status updated to ${STATUS_CONFIG[newStatus]?.label || newStatus}`, "success");
        loadOrders();
        showOrdersByStatus(newStatus);
      } else {
        addNotification(data.message || "Failed to update status", "error");
      }
    } catch (err) {
      addNotification(err.message || "Error updating status", "error");
    }
    setConfirmAction(null);
  };

  const handleVerifyPayment = async (orderId, source = "pos") => {
    try {
      const data = await api.put(`/orders/orders/${orderId}/verify-payment?source=${source}`, {
        verified_by: user?.id || null,
      });
      if (data.success) {
        addNotification("Payment verified successfully", "success");
        loadOrders();
        showOrdersByStatus("verified");
      } else {
        addNotification(data.message || "Verification failed", "error");
      }
    } catch (err) {
      addNotification(err.message || "Error verifying payment", "error");
    }
    setConfirmAction(null);
  };

  const handleRejectPayment = async (orderId, source = "pos") => {
    try {
      const data = await api.put(`/orders/orders/${orderId}/reject-payment?source=${source}`);
      if (data.success) {
        addNotification("Payment rejected", "success");
        loadOrders();
        showOrdersByStatus("rejected");
      } else {
        addNotification(data.message || "Rejection failed", "error");
      }
    } catch (err) {
      addNotification(err.message || "Error rejecting payment", "error");
    }
    setConfirmAction(null);
  };

  const viewOrderDetail = async (order) => {
    try {
      const data = await api.get(
        `/orders/orders/${order.id}?source=${order.source || "pos"}`
      );
      if (data.success) {
        setSelectedOrder(data.order);
        setShowDetail(true);
      }
    } catch (err) { console.error(err); }
  };

  const statusCounts = useMemo(() => {
    const counts = { all: orders.length };
    orders.forEach((o) => {
      counts[o.order_status] = (counts[o.order_status] || 0) + 1;
    });
    return counts;
  }, [orders]);

  const getNextStatuses = (current) => {
    const flow = {
      pending_payment: ["verified", "rejected"],
      verified: ["preparing", "rejected"],
      preparing: ["ready_for_pickup"],
      ready_for_pickup: ["completed"],
      completed: [],
      rejected: [],
    };
    return flow[current] || [];
  };

  return (
    <Layout title="Online Orders">
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3">
        {notifications.map((n) => (
          <div key={n.id} className={`w-80 border shadow-lg rounded-xl px-4 py-3 flex items-start justify-between ${n.type === "success" ? "bg-green-50 border-green-200" : n.type === "error" ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200"}`}>
            <div className="flex gap-3">
              <div className={`w-2 h-2 mt-2 rounded-full ${n.type === "success" ? "bg-green-500" : n.type === "error" ? "bg-red-500" : "bg-blue-500"}`} />
              <div>
                <p className="text-sm font-semibold text-gray-800">{n.type === "success" ? "Success" : n.type === "error" ? "Error" : "Notification"}</p>
                <p className="text-sm text-gray-600">{n.message}</p>
              </div>
            </div>
            <button onClick={() => setNotifications((prev) => prev.filter((item) => item.id !== n.id))} className="text-gray-400 hover:text-red-500 text-lg font-bold">×</button>
          </div>
        ))}
      </div>

      <div className="flex-1 p-6 overflow-y-auto space-y-4">
        {/* STATUS FILTER TABS */}
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((sf) => (
            <button
              key={sf.key}
              onClick={() => { setStatusFilter(sf.key); setCurrentPage(1); }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${statusFilter === sf.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
            >
              {sf.label}
              <span className={`ml-1.5 text-xs ${statusFilter === sf.key ? "text-blue-200" : "text-gray-400"}`}>
                {statusCounts[sf.key] || 0}
              </span>
            </button>
          ))}
        </div>

        {/* SEARCH */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search by Order ID or Customer Name..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
          />
        </div>

        {/* ORDERS TABLE */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Order ID</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Products</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Total</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Payment</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-gray-400">
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-4xl">📦</span>
                        <p className="text-lg font-medium">No orders found</p>
                        <p className="text-sm">Orders from the e-commerce site will appear here</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginated.map((order) => (
                    <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50 transition">
                      <td className="px-4 py-3 font-mono font-semibold text-blue-700">
                        <span className="inline-flex items-center gap-1.5">
                          {order.source === "ecom" && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-purple-100 text-purple-700 border border-purple-200">
                              ECO
                            </span>
                          )}
                          {order.order_number}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-gray-800">{order.customer_name}</p>
                          <p className="text-xs text-gray-500">{order.customer_email}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(order.created_at)}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs max-w-[200px] truncate">
                        {order.product_names || "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-800">₱{Number(order.total_amount).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 uppercase">
                          {order.payment_method === "gcash" ? "💳" : "🏦"} {order.payment_method}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_CONFIG[order.order_status]?.color || "bg-gray-100 text-gray-600"}`}>
                          {STATUS_CONFIG[order.order_status]?.label || order.order_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => viewOrderDetail(order)} className="px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition">
                            View
                          </button>
                          {order.receipt_image && (
                            <button onClick={() => setShowReceipt(order)} className="px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50 rounded transition">
                              Receipt
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINATION */}
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

      {/* ORDER DETAIL MODAL */}
      {showDetail && selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4" onClick={() => setShowDetail(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Order {selectedOrder.order_number}</h2>
                  <p className="text-sm text-gray-500 mt-1">{formatDate(selectedOrder.created_at)}</p>
                </div>
                <button onClick={() => setShowDetail(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
              </div>

              {/* Customer Info */}
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <h3 className="text-sm font-semibold text-gray-500 mb-2">Customer Information</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-gray-500">Name:</span> <span className="font-medium">{selectedOrder.customer_name}</span></div>
                  <div><span className="text-gray-500">Email:</span> <span className="font-medium">{selectedOrder.customer_email}</span></div>
                  <div><span className="text-gray-500">Contact:</span> <span className="font-medium">{selectedOrder.customer_contact || "—"}</span></div>
                  <div><span className="text-gray-500">Payment:</span> <span className="font-medium uppercase">{selectedOrder.payment_method}</span></div>
                </div>
              </div>

              {/* Reference Number */}
              {selectedOrder.reference_number && (
                <div className="bg-blue-50 rounded-xl p-4 mb-4">
                  <h3 className="text-sm font-semibold text-blue-600 mb-1">Reference Number</h3>
                  <p className="text-sm font-mono text-blue-800">{selectedOrder.reference_number}</p>
                </div>
              )}

              {/* Status */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-500 mb-2">Order Status</h3>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border ${STATUS_CONFIG[selectedOrder.order_status]?.color}`}>
                  {STATUS_CONFIG[selectedOrder.order_status]?.label}
                </span>
                {selectedOrder.pickup_code && (
                  <div className="mt-3 bg-purple-50 rounded-xl p-4 border border-purple-200">
                    <p className="text-xs text-purple-700 mb-1">Pickup Code</p>
                    <p className="text-2xl font-mono font-bold tracking-[0.3em] text-purple-700">{selectedOrder.pickup_code}</p>
                    <p className="text-xs text-gray-500 mt-1">Show this to the customer when they collect their order</p>
                  </div>
                )}
                {selectedOrder.verified_at && (
                  <p className="text-xs text-gray-500 mt-1">Verified: {formatDate(selectedOrder.verified_at)}</p>
                )}
              </div>

              {/* Items */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-500 mb-2">Order Items</h3>
                <div className="border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-3 py-2 font-medium text-gray-600">Product</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600">Qty</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600">Price</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedOrder.items || []).map((item) => (
                        <tr key={item.id} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            <p className="font-medium">{item.product_name}</p>
                            {item.barcode && <p className="text-xs text-gray-500">Barcode: {item.barcode}</p>}
                          </td>
                          <td className="px-3 py-2 text-right">{item.quantity}</td>
                          <td className="px-3 py-2 text-right">₱{Number(item.price).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-medium">₱{Number(item.total).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 border-t-2 border-gray-300">
                        <td colSpan={3} className="px-3 py-2 font-bold text-right">Total:</td>
                        <td className="px-3 py-2 text-right font-bold text-blue-600">₱{Number(selectedOrder.total_amount).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Notes */}
              {selectedOrder.notes && (
                <div className="bg-yellow-50 rounded-xl p-4 mb-4">
                  <h3 className="text-sm font-semibold text-yellow-700 mb-1">Notes</h3>
                  <p className="text-sm text-yellow-800">{selectedOrder.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200">
                {selectedOrder.order_status === "pending_payment" ? (
                  <>
                    <button onClick={() => setConfirmAction({ type: "verify", orderId: selectedOrder.id, source: selectedOrder.source })} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition">
                      ✓ Verify Payment
                    </button>
                    <button onClick={() => setConfirmAction({ type: "reject", orderId: selectedOrder.id, source: selectedOrder.source })} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition">
                      ✕ Reject Payment
                    </button>
                  </>
                ) : (
                  getNextStatuses(selectedOrder.order_status)
                    .filter((s) => s !== "rejected")
                    .map((nextStatus) => (
                      <button
                        key={nextStatus}
                        onClick={() => setConfirmAction({ type: "status", orderId: selectedOrder.id, source: selectedOrder.source, status: nextStatus })}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition"
                      >
                        Mark as {STATUS_CONFIG[nextStatus]?.label}
                      </button>
                    ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RECEIPT VIEWER */}
      {showReceipt && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4" onClick={() => setShowReceipt(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Payment Receipt</h3>
              <button onClick={() => setShowReceipt(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <p className="text-sm text-gray-500 mb-3">Order: {showReceipt.order_number}</p>
            {receiptImageLoading ? (
              <p className="py-8 text-center text-sm text-gray-500">Loading receipt image...</p>
            ) : receiptImageUrl ? (
              <img
                src={receiptImageUrl}
                alt="Uploaded payment receipt"
                className="w-full rounded-lg border"
                onError={() => setReceiptImageError("The uploaded receipt image could not be displayed")}
              />
            ) : (
              <p className="py-8 text-center text-sm text-red-600">{receiptImageError || "Receipt image unavailable"}</p>
            )}
          </div>
        </div>
      )}

      {/* CONFIRMATION DIALOG */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4" onClick={() => setConfirmAction(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Confirm Action</h3>
            <p className="text-sm text-gray-600 mb-6">
              {confirmAction.type === "verify" && "Are you sure you want to verify this payment? This will mark the order as verified."}
              {confirmAction.type === "reject" && "Are you sure you want to reject this payment? This action cannot be undone."}
              {confirmAction.type === "status" && `Are you sure you want to change the status to "${STATUS_CONFIG[confirmAction.status]?.label}"?`}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmAction(null)} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmAction.type === "verify") handleVerifyPayment(confirmAction.orderId, confirmAction.source);
                  else if (confirmAction.type === "reject") handleRejectPayment(confirmAction.orderId, confirmAction.source);
                  else handleStatusChange(confirmAction.orderId, confirmAction.status, confirmAction.source);
                }}
                className={`px-4 py-2 text-sm font-semibold text-white rounded-lg transition ${confirmAction.type === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}
              >
                {confirmAction.type === "verify" ? "Verify Payment" : confirmAction.type === "reject" ? "Reject" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
