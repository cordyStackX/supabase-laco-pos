import React, { useCallback, useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "./Layout";
import { getDepartmentInfo } from "../utils/departmentUtils";
import { api, assetUrl, getToken } from "../lib/api";

export default function Dashboard() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [checkoutItems, setCheckoutItems] = useState({});
  const [total, setTotal] = useState(0);
  const [cash, setCash] = useState("");
  const [change, setChange] = useState(0);
  const [receiptId, setReceiptId] = useState(null);
  const [receiptItems, setReceiptItems] = useState([]);
  const [receiptTotal, setReceiptTotal] = useState(0);
  const [receiptCash, setReceiptCash] = useState("");
  const [receiptChange, setReceiptChange] = useState(0);
  const [receiptCustomerName, setReceiptCustomerName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [showReceipt, setShowReceipt] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [checkoutDepartment, setCheckoutDepartment] = useState("Students");
  const [notifications, setNotifications] = useState([]);
  const barcodeRef = useRef("");
  const scanLock = useRef(false);
  const lowStockAlertedRef = useRef(new Set());

  /* AUTH */
  useEffect(() => {
    if (!getToken()) navigate("/");
  }, [navigate]);

  useEffect(() => {
  const cashNum = Number(cash);

  if (!cash || isNaN(cashNum)) {
    setChange(0);
    return;
  }

  setChange(cashNum - total);
}, [cash, total]);

  useEffect(() => {
    const newTotal = Object.values(checkoutItems).reduce(
      (sum, item) => sum + item.price * item.qty,
      0
    );
    setTotal(newTotal);
  }, [checkoutItems]);

  /* LOAD DATA */
  const loadProducts = useCallback(async () => {
    const data = await api.get("/products");
    if (data.success) setProducts(data.products);
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const data = await api.get("/categories");

      if (data.success && Array.isArray(data.categories)) {
        const cats = Array.from(
          new Set(
            data.categories
              .map((c) =>
                typeof c === "string"
                  ? c.trim()
                  : c?.name?.toString().trim()
              )
              .filter(Boolean)
          )
        );

        if (cats.length > 0) {
          setCategories(cats);
          return;
        }
      }
    } catch (err) {
      console.error("Failed to load categories", err);
    }

    // Fallback: derive categories from loaded products if API returns none
    const derived = Array.from(
      new Set(
        products
          .map((p) => p.category?.toString().trim())
          .filter(Boolean)
      )
    );
    setCategories(derived);
  }, [products]);

  useEffect(() => {
    loadProducts();
    loadCategories();
  }, [loadProducts, loadCategories]);

  /* NOTIFICATIONS */
  // Declared before the low-stock effect below, whose dependency array reads it
  // during render.
  const addNotification = useCallback((message) => {
    const id = crypto.randomUUID();

    setNotifications((prev) => [...prev, { id, message }]);

    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 5000);
  }, []);

  useEffect(() => {
    if (!products.length) return;

    const lowStockItems = products.filter((product) => Number(product.stock || 0) <= 30 && Number(product.stock || 0) > 0);

    lowStockItems.forEach((product) => {
      const key = `${product.id}-${product.stock}`;
      if (lowStockAlertedRef.current.has(key)) return;

      lowStockAlertedRef.current.add(key);
      addNotification(`${product.name} is low stock (${product.stock} left)`);
    });
  }, [products, addNotification]);

  useEffect(() => {
    if (categories.length === 0 && products.length > 0) {
      const derived = Array.from(
        new Set(
          products
            .map((p) => p.category?.toString().trim())
            .filter(Boolean)
        )
      );
      setCategories(derived);
    }
  }, [categories.length, products]);

  /* The barcode listener and the auto-print effect are registered at the end of
     the component, after handleBarcodeScan and handlePrintReceipt are declared.
     Their dependency arrays are evaluated during render, so referencing them
     from here would throw "Cannot access ... before initialization". */

  /*barcode scan*/
const handleBarcodeScan = useCallback((code) => {
  if (scanLock.current) return;
  scanLock.current = true;

  setTimeout(() => {
    scanLock.current = false;
  }, 300);

  const product = products.find(
    (p) => String(p.barcode) === String(code)
  );

  if (!product) return addNotification("Product not found");

  if (!product.stock || product.stock <= 0) {
    return addNotification("Invalid stocks");
  }

  setCheckoutItems((prev) => {
    const existing = prev[product.id];
    const currentQty = existing ? existing.qty : 0;

    if (currentQty >= product.stock) {
      addNotification("Out of stock");
      return prev;
    }

    return {
      ...prev,
      [product.id]: existing
        ? { ...existing, qty: existing.qty + 1 }
        : {
            id: product.id,
            name: product.name,
            price: Number(product.price),
            size: product.size || null,
            department: product.department || "",
            barcode: product.barcode,
            qty: 1,
          },
    };
  });
}, [products, addNotification]);

  /* REMOVE ITEM */
const removeFromCheckout = (id) => {
  setCheckoutItems((prev) => {
    const item = prev[id];
    if (!item) return prev;

    const newState = { ...prev };
    delete newState[id];
    return newState;
  });
};

const decreaseQuantity = (id) => {
  setCheckoutItems((prev) => {
    const item = prev[id];
    if (!item) return prev;

    // if qty is 1 → remove item completely
    if (item.qty <= 1) {
      const newState = { ...prev };
      delete newState[id];
      return newState;
    }

    // otherwise decrease qty
    return {
      ...prev,
      [id]: {
        ...item,
        qty: item.qty - 1,
      },
    };
  });
};

const increaseQuantity = (id) => {
  setCheckoutItems((prev) => {
    const item = prev[id];
    if (!item) return prev;

    const product = products.find((p) => String(p.id) === String(id));
    const max = product ? Number(product.stock || 0) : Infinity;

    if (item.qty >= max) {
      addNotification("Out of stock");
      return prev;
    }

    return {
      ...prev,
      [id]: {
        ...item,
        qty: item.qty + 1,
      },
    };
  });
};

const setQuantity = (id, value) => {
  setCheckoutItems((prev) => {
    const item = prev[id];
    if (!item) return prev;

    let qty = Number(value) || 0;
    if (qty < 1) qty = 1;

    const product = products.find((p) => String(p.id) === String(id));
    const max = product ? Number(product.stock || 0) : Infinity;
    if (qty > max) {
      addNotification(`Only ${max} available`);
      qty = max;
    }

    return {
      ...prev,
      [id]: {
        ...item,
        qty,
      },
    };
  });
};

const handlePay = async () => {
  if (!Object.keys(checkoutItems).length)
    return addNotification("Checkout empty");

  const cashNum = Number(cash);
  if (cashNum < total)
    return addNotification("Insufficient cash");

  try {
    const items = Object.values(checkoutItems).map((item) => ({
      barcode: item.barcode,
      quantity: item.qty,
    }));

    const data = await api.post("/products/checkout", {
      items,
      customerName: customerName.trim() || null,
      checkoutDepartment,
    });

    if (!data.success)
      return addNotification(data.message || "Payment failed");

    const id = data.receiptId;
    const snapshotItems = Object.values(checkoutItems);
    const snapshotTotal = total;
    const snapshotCash = cashNum;
    const snapshotChange = cashNum - total;
    const snapshotCustomerName = customerName.trim();

    setReceiptId(id);
    setReceiptItems(snapshotItems);
    setReceiptTotal(snapshotTotal);
    setReceiptCash(snapshotCash);
    setReceiptChange(snapshotChange);
    setReceiptCustomerName(snapshotCustomerName);

    setShowReceipt(true);

    setCheckoutItems({});
    setTotal(0);
    setCash("");
    setChange(0);
    setCustomerName("");

    loadProducts();
    addNotification("Successfully purchased ✔");
  } catch (err) {
    console.error(err);
    addNotification(err?.message || "Error processing payment");
  }
};

/* PRINT RECEIPT */
const formatReceiptItemLabel = (item) => {
  const department = item.department ? getDepartmentInfo(item.department).label : null;
  const sizeLabel = item.size ? ` (${item.size})` : "";
  return `${item.name}${sizeLabel}${department && department !== "General" ? ` (${department})` : ""}`;
};

const handlePrintReceipt = useCallback(() => {
  const date = new Date().toLocaleString();
  
  const itemsHtml = receiptItems
    .map(
      (item) => {
        return `<p>${formatReceiptItemLabel(item)} x${item.qty} - ₱${(item.price * item.qty).toFixed(2)}</p>`;
      }
    )
    .join("");

  const w = window.open("", "_blank");
  
  if (!w) {
    return addNotification("Failed to open print window. Check pop-up blocker settings.");
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Receipt #${receiptId}</title>
      <style>
        body {
          font-family: 'Courier New', Courier, monospace;
          padding: 20px;
          max-width: 400px;
          margin: 0 auto;
          color: #000;
        }
        h2 {
          text-align: center;
          margin-bottom: 10px;
        }
        .center { text-align: center; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        h3 { margin: 10px 0 5px 0; }
        p { margin: 3px 0; }
        .total { font-weight: bold; font-size: 16px; margin-top: 10px; }
        .thank-you { text-align: center; margin-top: 20px; font-size: 12px; }
      </style>
    </head>
    <body>
      <h2>LCCB Bookstore</h2>
      <p class="center">La Consolacion College Bacolod</p>
      <div class="divider"></div>
      <p class="center"><strong>Receipt #${receiptId}</strong></p>
      <p class="center">${date}</p>
      ${receiptCustomerName ? `<p class="center">Customer: <strong>${receiptCustomerName}</strong></p>` : ""}
      <div class="divider"></div>
      
      <h3>Items:</h3>
      ${itemsHtml}
      
      <div class="divider"></div>
      <div class="total">
        Total: ₱${receiptTotal.toFixed(2)}<br>
        Paid: ₱${receiptCash.toFixed(2)}<br>
        Change: ₱${receiptChange.toFixed(2)}
      </div>
      
      <div class="thank-you">
        <p>Thank you for your purchase!</p>
        <p>Please come again</p>
      </div>
    </body>
    </html>
  `;

  w.document.write(html);
  w.document.close();

  setTimeout(() => {
    w.focus();
    w.print();
    setTimeout(() => {
      setShowReceipt(false);
    }, 100);
  }, 250);
}, [receiptItems, receiptTotal, receiptCustomerName, receiptCash, receiptChange, receiptId, addNotification]);

  /* BARCODE */
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT") return;

      if (e.key === "Enter") {
        const code = barcodeRef.current.trim();
        if (code) handleBarcodeScan(code);
        barcodeRef.current = "";
      } else if (/\d/.test(e.key)) {
        barcodeRef.current += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleBarcodeScan]);

  /* AUTO-PRINT RECEIPT */
  useEffect(() => {
    if (showReceipt) {
      const timer = setTimeout(() => {
        handlePrintReceipt();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [showReceipt, handlePrintReceipt]);

const filtered = products.filter((p) => {
    const matchSearch = p.name
      .toLowerCase()
      .includes(search.toLowerCase());

    const matchCategory = categoryFilter
      ? String(p.category).trim() === String(categoryFilter).trim()
      : true;

    return matchSearch && matchCategory;
  });

  return (
    <Layout title="LCCB Bookstore">

<div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3">
  {notifications.map((n) => (
    <div
      key={n.id}
      className="w-80 bg-white border border-gray-200 shadow-lg rounded-xl px-4 py-3 flex items-start justify-between animate-fadeIn"
    >
      <div className="flex gap-3">
        <div className="w-2 h-2 mt-2 rounded-full bg-blue-500" />
        <div>
          <p className="text-sm font-semibold text-gray-800">
            Notification
          </p>
          <p className="text-sm text-gray-600">{n.message}</p>
        </div>
      </div>

      <button
        onClick={() =>
          setNotifications((prev) =>
            prev.filter((item) => item.id !== n.id)
          )
        }
        className="text-gray-400 hover:text-red-500 text-lg font-bold"
      >
        ×
      </button>
    </div>
  ))}
</div>

      {/* MAIN */}
      <div className="flex flex-1 h-full min-h-0 p-4 gap-4 overflow-hidden">

          {/* PRODUCTS */}
          <div className="flex-1 min-h-0 bg-white shadow-sm border border-gray-100 p-4 overflow-auto rounded-2xl">

            {/* SEARCH & FILTER */}
            <div className="flex items-center gap-3 mb-5">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  placeholder="Search products..."
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white transition-all"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white transition-all cursor-pointer"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* PRODUCT GRID */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {filtered.map((p) => (
                <div
                  key={p.id}
                  className="group relative bg-white border border-blue-100 rounded-xl overflow-hidden hover:shadow-lg hover:shadow-blue-100 hover:border-blue-200 transition-all duration-200 flex flex-col"
                >
                  {/* Image */}
                  <div className="relative bg-gradient-to-b from-blue-50 to-white flex h-28 items-center justify-center overflow-hidden">
                    <img
                      src={assetUrl(p.image)}
                      alt={p.name}
                      className="max-h-20 max-w-[75%] object-contain group-hover:scale-105 transition-transform duration-300 ease-out"
                    />
                    {p.stock <= 0 ? (
                      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold uppercase">Sold Out</span>
                    ) : p.stock <= 30 ? (
                      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-bold uppercase">Low</span>
                    ) : null}
                  </div>

                  {/* Content */}
                  <div className="flex flex-col flex-1 p-2.5 gap-1">
                    <h3 className="text-[12px] font-semibold text-blue-950 leading-tight line-clamp-1">{p.name}</h3>

                    <div className="flex items-center gap-1">
                      {p.size && <span className="text-[10px] text-blue-400">{p.size}</span>}
                      {p.size && p.department && p.department !== "General" && <span className="text-[10px] text-blue-200">·</span>}
                      {p.department && p.department !== "General" && <span className="text-[10px] text-blue-500">{p.department}</span>}
                    </div>

                    {/* Price + Button */}
                    <div className="flex items-center justify-between pt-1.5 mt-auto border-t border-blue-50">
                      <p className="text-[13px] font-bold text-blue-700 leading-none">₱{p.price}</p>
                      <button
                        onClick={() => handleBarcodeScan(p.barcode)}
                        disabled={p.stock <= 0}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold leading-none transition-all duration-200 ${
                          p.stock <= 0
                            ? "bg-blue-50 text-blue-300 cursor-not-allowed"
                            : "bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
                        }`}
                      >
                        {p.stock <= 0 ? "N/A" : "Add"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CHECKOUT */}
          <div className="w-96 min-h-0 bg-white shadow-sm border border-gray-100 p-5 flex flex-col rounded-2xl h-full overflow-y-auto">

            <h2 className="font-bold text-lg mb-4 text-gray-900">Checkout</h2>

            <div className="flex-1 min-h-[180px] max-h-[32vh] overflow-auto rounded-xl bg-gray-50 border border-gray-100 p-3 mb-4">
{Object.values(checkoutItems).map((item) => (
  <div
    key={item.id}
    className="border-b border-gray-200 py-3 flex flex-col gap-2 overflow-hidden min-w-0 last:border-b-0"
  >
    {/* Product Info */}
    <div className="min-w-0 overflow-hidden">
      <p className="font-medium text-sm leading-tight break-words line-clamp-2 text-gray-800">
        {item.name}
      </p>

      <p className="text-xs text-gray-500 truncate mt-1">
        Size: {item.size || "N/A"}{item.department ? ` | Dept: ${item.department}` : ""}
      </p>
    </div>

    {/* Bottom Row */}
    <div className="flex items-center justify-between gap-2 min-w-0 mt-2">

      {/* Quantity Controls */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => decreaseQuantity(item.id)}
          className="w-5 h-5 flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300 text-blue-600 text-xs font-bold transition"
          title="Decrease"
          type="button"
        >
          −
        </button>

<input
  type="number"
  min={1}
  value={item.qty}
  onChange={(e) => setQuantity(item.id, e.target.value)}
  onKeyDown={(e) => e.stopPropagation()}
  style={{ width: "40px" }}
  className="h-5 appearance-none text-center rounded bg-gray-200 text-[10px] font-bold"
/>
        <button
          onClick={() => increaseQuantity(item.id)}
          className="w-5 h-5 flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300 text-blue-600 text-xs font-bold transition"
          title="Increase"
          type="button"
        >
          +
        </button>
      </div>

      {/* Price + Remove */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right font-bold text-sm text-green-600 whitespace-nowrap">
          ₱{(item.price * item.qty).toFixed(2)}
        </div>

        <button
          onClick={() => removeFromCheckout(item.id)}
          className="text-red-500 font-bold text-lg hover:text-red-700 hover:bg-red-50 px-1.5 py-0.5 rounded transition"
          title="Remove item"
          type="button"
        >
          ×
        </button>
      </div>
    </div>
  </div>
))}
            </div>

            <div className="mt-auto space-y-3">
              {/* Subtotal */}
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500 font-medium">Subtotal</span>
                  <span className="text-xl font-bold text-gray-900">₱{total.toFixed(2)}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Department</label>
                <select
                  value={checkoutDepartment}
                  onChange={(e) => setCheckoutDepartment(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 p-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                >
                  <option value="Students">Students</option>
                  <option value="Teachers">Teachers</option>
                  <option value="Personnel">Personnel</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Customer Name</label>
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  placeholder="Optional"
                  className="w-full bg-gray-50 border border-gray-200 p-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Cash Amount</label>
                <input
                  type="number"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0.00"
                  className="w-full bg-gray-50 border border-gray-200 p-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>

              {/* Change Display */}
              <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                <p className="text-xs text-green-600 font-semibold uppercase tracking-wider">Change</p>
                <p className="text-2xl font-bold text-green-700">
                  ₱{change.toFixed(2)}
                </p>
              </div>

              {/* Pay Button */}
              <button
                onClick={handlePay}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all duration-200 active:scale-[0.98] shadow-sm hover:shadow-md"
              >
                Pay
              </button>

            {/* Receipt */}
            {showReceipt && (
              <div className="border-t-2 border-gray-200 pt-3 bg-gradient-to-b from-gray-50 to-white p-3 rounded-lg shadow-md">
                <p className="font-bold text-lg text-gray-900 mb-2">Receipt #{receiptId}</p>

                {receiptCustomerName && (
                  <p className="text-sm text-gray-700 mb-2 font-semibold">Customer: {receiptCustomerName}</p>
                )}

                <div className="space-y-1 mb-2 pb-2 border-b border-gray-300">
                  {receiptItems.map((item, i) => {
                    const department = item.department ? getDepartmentInfo(item.department).label : null;
                    return (
                      <p key={i} className="text-xs text-gray-700">
                        {item.name}
                        {item.size ? ` (${item.size})` : ""}
                        {department && department !== "General" ? ` (${department})` : ""} × {item.qty}
                        <span className="float-right font-semibold">₱{(item.price * item.qty).toFixed(2)}</span>
                      </p>
                    );
                  })}
                </div>

                <div className="space-y-1 text-sm font-medium text-gray-800">
                  <div className="flex justify-between">
                    <span>Total:</span>
                    <span>₱{receiptTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Paid:</span>
                    <span>₱{receiptCash.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-green-600 font-bold text-base pt-1 border-t border-gray-300">
                    <span>Change:</span>
                    <span>₱{receiptChange.toFixed(2)}</span>
                  </div>
                </div>

                <div className="mt-4 flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={handlePrintReceipt}
                    className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-900 transition"
                  >
                    Print Receipt
                  </button>
                </div>
              </div>
            )}
            </div>

          </div>
        </div>
    </Layout>
  );
}