import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Layout from "./Layout";
import { api, assetUrl } from "../lib/api";

// Matches the low-stock threshold used elsewhere in the app (orderRoutes and
// the dashboard both treat <= 30 as low).
const LOW_STOCK_THRESHOLD = 30;

const peso = (value) =>
  `₱${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const stockTone = (stock) => {
  if (!stock || stock <= 0) {
    return { label: "Out of stock", classes: "bg-rose-50 text-rose-700 ring-rose-600/20" };
  }
  if (stock <= LOW_STOCK_THRESHOLD) {
    return { label: "Low stock", classes: "bg-amber-50 text-amber-800 ring-amber-600/20" };
  }
  return { label: "In stock", classes: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" };
};

const formatWhen = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** Card shell with a consistent heading, so every section lines up. */
function SectionCard({ title, subtitle, action, children, className = "" }) {
  return (
    <section
      className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Labelled form control with inline validation messaging. */
function Field({ label, htmlFor, required, error, hint, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm font-medium text-gray-700"
      >
        {label}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-rose-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}

const controlClass =
  "w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50 disabled:text-gray-500";

export default function Restock() {
  const barcodeRef = useRef(null);
  const quantityRef = useRef(null);

  const [barcode, setBarcode] = useState("");
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [product, setProduct] = useState(null);
  const [lookupError, setLookupError] = useState("");

  const [quantity, setQuantity] = useState("1");
  const [supplier, setSupplier] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState(null);

  const [restocks, setRestocks] = useState([]);
  const [loadingRestocks, setLoadingRestocks] = useState(true);
  const [restocksError, setRestocksError] = useState("");

  // Real history from the database. The previous implementation kept a
  // hand-rolled list in localStorage that always attributed every entry to a
  // hardcoded "Admin", so it showed stale, fabricated data on any other device.
  const loadRestocks = useCallback(async () => {
    try {
      const data = await api.get("/products/restocks");
      setRestocks(Array.isArray(data.restocks) ? data.restocks : []);
      setRestocksError("");
    } catch (error) {
      setRestocksError(error.message || "Could not load restock history");
    } finally {
      setLoadingRestocks(false);
    }
  }, []);

  useEffect(() => {
    barcodeRef.current?.focus();
    loadRestocks();
  }, [loadRestocks]);

  // Distinct suppliers already used, so the field can suggest them instead of
  // relying on memory. Supplier lives as free text on each restock, so this list
  // is what keeps "Paper" and "Paper Company" from splitting into two vendors.
  const [suppliers, setSuppliers] = useState([]);

  const loadSuppliers = useCallback(async () => {
    try {
      const data = await api.get("/products/suppliers");
      setSuppliers(Array.isArray(data.suppliers) ? data.suppliers : []);
    } catch {
      // Purely an assist: free text still works, so a failure here must stay
      // silent rather than block the form.
      setSuppliers([]);
    }
  }, []);

  useEffect(() => {
    barcodeRef.current?.focus();
    loadRestocks();
    loadSuppliers();
  }, [loadRestocks, loadSuppliers]);

  const parsedQuantity = Number(quantity);
  const quantityValid = Number.isInteger(parsedQuantity) && parsedQuantity > 0;
  const supplierValid = supplier.trim().length > 0;
  const projectedStock = product ? Number(product.stock || 0) + (quantityValid ? parsedQuantity : 0) : 0;

  const handleBarcodeSearch = useCallback(async () => {
    const code = barcode.trim();
    if (!code) return;

    setLoadingProduct(true);
    setLookupError("");
    setProduct(null);
    setSuccess(null);
    setFormError("");

    try {
      const data = await api.get(`/products/barcode/${encodeURIComponent(code)}`);
      if (!data.success) {
        setLookupError(data.message || "Product not found");
        return;
      }
      setProduct(data.product);
    } catch (error) {
      setLookupError(error.message || "Failed to load product");
    } finally {
      setLoadingProduct(false);
    }
  }, [barcode]);

  const adjustQuantity = (delta) => {
    setQuantity((prev) => {
      const next = (Number(prev) || 0) + delta;
      return String(Math.max(1, next));
    });
  };

  const resetForm = () => {
    setBarcode("");
    setQuantity("1");
    setSupplier("");
    setCostPrice("");
    setNotes("");
    setProduct(null);
  };

  const printReceipt = (receiptData, receiptWindow) => {
    if (!receiptWindow) return false;

    const { product, quantity, supplier, costPrice, notes } = receiptData;

    const today = new Date().toLocaleString();
    const escapeHtml = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const content = `
      <html>
        <head>
          <title>Restock Receipt</title>
          <style>
            body {
              font-family: "Segoe UI", Arial, sans-serif;
              margin: 0;
              padding: 24px 20px;
              color: #111827;
              background: #fff;
            }
            .receipt {
              width: 100%;
              max-width: 360px;
              margin: 0 auto;
              border: 1px solid #d1d5db;
              border-radius: 10px;
              padding: 18px 16px;
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
            }
            .title {
              text-align: center;
              font-size: 20px;
              font-weight: 700;
              margin: 0 0 6px;
              letter-spacing: 0.03em;
            }
            .subtitle {
              text-align: center;
              font-size: 12px;
              color: #6b7280;
              margin-bottom: 12px;
            }
            .divider {
              border-top: 1px dashed #9ca3af;
              margin: 10px 0;
            }
            .row {
              display: flex;
              justify-content: space-between;
              gap: 12px;
              margin: 6px 0;
              font-size: 13px;
            }
            .label { color: #4b5563; }
            .value { font-weight: 600; text-align: right; }
            .notes {
              margin-top: 8px;
              padding: 8px;
              background: #f9fafb;
              border-radius: 6px;
              font-size: 12px;
              color: #374151;
              white-space: pre-wrap;
            }
            .footer {
              margin-top: 12px;
              text-align: center;
              font-size: 11px;
              color: #6b7280;
            }
            @media print {
              body { padding: 0; }
              .receipt { border: none; box-shadow: none; padding: 0; }
            }
          </style>
        </head>
        <body>
          <div class="receipt">
            <h2 class="title">Restock Receipt</h2>
            <p class="subtitle">Stock update record</p>
            <div class="row"><span class="label">Product</span><span class="value">${escapeHtml(product.name)}</span></div>
            <div class="row"><span class="label">Barcode</span><span class="value">${escapeHtml(product.barcode)}</span></div>
            <div class="row"><span class="label">Qty Added</span><span class="value">${escapeHtml(quantity)}</span></div>
            <div class="row"><span class="label">Supplier</span><span class="value">${escapeHtml(supplier || "N/A")}</span></div>
            <div class="row"><span class="label">Cost Price</span><span class="value">${costPrice ? peso(costPrice) : "N/A"}</span></div>
            <div class="row"><span class="label">Stock After</span><span class="value">${escapeHtml(Number(product.stock || 0) + Number(quantity))}</span></div>
            <div class="divider"></div>
            ${notes ? `<div class="notes">${escapeHtml(notes)}</div>` : ""}
            <div class="footer">${escapeHtml(today)}</div>
          </div>
        </body>
      </html>
    `;

    receiptWindow.document.write(content);
    receiptWindow.document.close();
    receiptWindow.focus();
    receiptWindow.print();
    return true;
  };

  const handleRestock = async () => {
    if (submitting) return;
    if (!product) {
      setFormError("Scan a product before confirming a restock.");
      barcodeRef.current?.focus();
      return;
    }
    if (!quantityValid) {
      setFormError("Enter a whole number greater than zero for the quantity.");
      quantityRef.current?.focus();
      return;
    }
    // The backend rejects an empty supplier, so the form must require it too
    // rather than sending a request that is guaranteed to fail.
    if (!supplierValid) {
      setFormError("Supplier is required.");
      return;
    }

    setSubmitting(true);
    setFormError("");
    setSuccess(null);

    const receiptData = {
      product,
      quantity: parsedQuantity,
      supplier: supplier.trim(),
      costPrice,
      notes,
    };

    // Opened up-front so the browser does not block it as a popup.
    const receiptWindow = window.open("", "_blank");
    if (receiptWindow) {
      receiptWindow.document.write("<title>Preparing restock receipt...</title>");
      receiptWindow.document.close();
    }

    try {
      const data = await api.post("/products/restock", {
        productId: product.id,
        amount: parsedQuantity,
        supplier: supplier.trim(),
        costPrice,
        notes,
      });

      if (!data.success) {
        throw new Error(data.message || "Failed to update stock");
      }

      const printed = printReceipt(receiptData, receiptWindow);
      resetForm();
      setSuccess({
        productName: receiptData.product.name,
        added: parsedQuantity,
        previousStock: Number(data.previousStock ?? receiptData.product.stock ?? 0),
        newStock: Number(data.newStock ?? 0),
        printed,
      });

      await loadRestocks();
      // A brand-new supplier should be offered next time without a refresh.
      await loadSuppliers();
      barcodeRef.current?.focus();
    } catch (error) {
      receiptWindow?.close();
      setFormError(error.message || "Failed to restock");
    } finally {
      setSubmitting(false);
    }
  };

  const stats = useMemo(() => {
    const units = restocks.reduce((sum, row) => sum + Number(row.quantity_added || 0), 0);
    const supplierNames = new Set(
      restocks.map((row) => String(row.supplier || "").trim()).filter(Boolean)
    );
    return { units, suppliers: supplierNames.size, count: restocks.length };
  }, [restocks]);

  const tone = product ? stockTone(Number(product.stock || 0)) : null;

  return (
    <Layout title="Restock">
      <div className="flex-1 overflow-y-auto bg-gray-50/60">
        <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6">
          {/* Page header */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Restock</h1>
              <p className="mt-1 text-sm text-gray-600">
                Scan a barcode, record the delivery, and update stock levels.
              </p>
            </div>
            {stats.count > 0 && (
              <div className="flex gap-2">
                <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-center shadow-sm">
                  <p className="text-lg font-bold leading-none text-gray-900">{stats.units}</p>
                  <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    Units logged
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-center shadow-sm">
                  <p className="text-lg font-bold leading-none text-gray-900">{stats.suppliers}</p>
                  <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    Suppliers
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Feedback banners */}
          {formError && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
            >
              <span className="mt-0.5 font-bold">!</span>
              <p className="font-medium">{formError}</p>
            </div>
          )}
          {success && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
            >
              <p className="font-medium">
                Restocked <span className="font-semibold">{success.productName}</span> by{" "}
                <span className="font-semibold">+{success.added}</span> units
                <span className="text-emerald-700">
                  {" "}
                  &middot; stock {success.previousStock} &rarr; {success.newStock}
                </span>
              </p>
              {!success.printed && (
                <p className="text-xs font-medium text-amber-700">
                  Allow pop-ups for this site to print receipts automatically.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Main column */}
            <div className="space-y-5 lg:col-span-2">
              <SectionCard
                title="Scan barcode"
                subtitle="Use a scanner or type the code, then press Enter"
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <input
                      ref={barcodeRef}
                      id="restock-barcode"
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleBarcodeSearch();
                        }
                      }}
                      placeholder="Scan or enter barcode"
                      aria-label="Barcode"
                      autoComplete="off"
                      className={`${controlClass} pl-10 font-mono tracking-wide`}
                    />
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path
                          fillRule="evenodd"
                          d="M3 4a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm3 0v2H4V4h2zm9 0a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1h-2a1 1 0 01-1-1V4zm3 0v2h-2V4h2zM3 10a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zm3 0v6H4v-6h2zm9-1a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1V9zm3 0v6h-2V9h2zM9 4a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleBarcodeSearch}
                    disabled={loadingProduct || !barcode.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    {loadingProduct ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                          <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                        Searching
                      </>
                    ) : (
                      "Look up"
                    )}
                  </button>
                </div>

                {lookupError && (
                  <p className="mt-3 text-sm font-medium text-rose-600" role="alert">
                    {lookupError}
                  </p>
                )}
              </SectionCard>

              <SectionCard title="Product" subtitle="Confirm you picked the right item">
                {loadingProduct ? (
                  <div className="flex items-center justify-center gap-3 py-10 text-sm text-gray-500">
                    <svg className="h-5 w-5 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                      <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Loading product
                  </div>
                ) : !product ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50/70 px-6 py-12 text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-400 ring-1 ring-gray-200">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6">
                        <path d="M3 4a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm3 0v2H4V4h2zm9 0a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1h-2a1 1 0 01-1-1V4zm3 0v2h-2V4h2zM3 10a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zm3 0v6H4v-6h2zm9-1a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1V9zm3 0v6h-2V9h2zM9 4a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V4z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-gray-700">No product selected</p>
                    <p className="mt-1 text-sm text-gray-500">Scan a barcode to load product details.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5 sm:flex-row">
                    {product.image ? (
                      <img
                        src={assetUrl(product.image)}
                        alt={product.name}
                        className="h-32 w-32 shrink-0 rounded-xl object-cover ring-1 ring-gray-200"
                      />
                    ) : (
                      <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-xs font-medium text-gray-400 ring-1 ring-gray-200">
                        No image
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="truncate text-lg font-semibold text-gray-900">{product.name}</h3>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tone.classes}`}
                        >
                          {tone.label}
                        </span>
                      </div>

                      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Category
                          </dt>
                          <dd className="mt-0.5 font-medium text-gray-800">
                            {product.category || "-"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Size
                          </dt>
                          <dd className="mt-0.5 font-medium text-gray-800">{product.size || "-"}</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Barcode
                          </dt>
                          <dd className="mt-0.5 font-mono text-sm text-gray-800">{product.barcode}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Current stock
                          </dt>
                          <dd className="mt-0.5 text-lg font-bold leading-none text-gray-900">
                            {product.stock}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Selling price
                          </dt>
                          <dd className="mt-0.5 text-lg font-bold leading-none text-gray-900">
                            {peso(product.price)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title="Delivery details"
                subtitle="Supplier is required so stock can be traced back to a source"
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field
                    label="Quantity to add"
                    htmlFor="restock-quantity"
                    required
                    error={
                      quantity !== "" && !quantityValid
                        ? "Enter a whole number of at least 1."
                        : ""
                    }
                  >
                    <div className="flex items-stretch gap-2">
                      <button
                        type="button"
                        onClick={() => adjustQuantity(-1)}
                        disabled={!product || submitting}
                        aria-label="Decrease quantity"
                        className="flex w-11 shrink-0 items-center justify-center rounded-xl border border-gray-300 bg-white text-lg font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        &minus;
                      </button>
                      <input
                        ref={quantityRef}
                        id="restock-quantity"
                        type="number"
                        min="1"
                        step="1"
                        disabled={!product}
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        className={`${controlClass} text-center text-base font-semibold`}
                      />
                      <button
                        type="button"
                        onClick={() => adjustQuantity(1)}
                        disabled={!product || submitting}
                        aria-label="Increase quantity"
                        className="flex w-11 shrink-0 items-center justify-center rounded-xl border border-gray-300 bg-white text-lg font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </Field>

                  <Field
                    label="Supplier"
                    htmlFor="restock-supplier"
                    required
                    hint="Used on the printed receipt and in the audit trail"
                  >
                    <input
                      id="restock-supplier"
                      type="text"
                      list="restock-supplier-options"
                      value={supplier}
                      onChange={(e) => setSupplier(e.target.value)}
                      placeholder="e.g. National Book Store"
                      autoComplete="off"
                      className={controlClass}
                    />
                    <datalist id="restock-supplier-options">
                      {suppliers.map((entry) => (
                        <option key={entry.supplier} value={entry.supplier} />
                      ))}
                    </datalist>

                    {suppliers.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-gray-500">Recent:</span>
                        {suppliers.slice(0, 6).map((entry) => {
                          const name = String(entry.supplier || "").trim();
                          if (!name) return null;
                          const active = supplier.trim().toLowerCase() === name.toLowerCase();

                          return (
                            <button
                              key={name}
                              type="button"
                              onClick={() => setSupplier(name)}
                              title={
                                entry.times_used > 1
                                  ? `${name} - used ${entry.times_used} times`
                                  : name
                              }
                              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                                active
                                  ? "bg-blue-600 text-white"
                                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                              }`}
                            >
                              {name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </Field>

                  <Field
                    label="Cost price"
                    htmlFor="restock-cost"
                    hint="Optional. Used for margin reporting."
                  >
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500">
                        &#8369;
                      </span>
                      <input
                        id="restock-cost"
                        type="number"
                        min="0"
                        step="0.01"
                        value={costPrice}
                        onChange={(e) => setCostPrice(e.target.value)}
                        placeholder="0.00"
                        className={`${controlClass} pl-8`}
                      />
                    </div>
                  </Field>

                  <Field label="Notes" htmlFor="restock-notes" hint="Optional">
                    <textarea
                      id="restock-notes"
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Invoice number, condition, or anything worth remembering"
                      className={`${controlClass} resize-y`}
                    />
                  </Field>
                </div>

                {product && (
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3 ring-1 ring-inset ring-gray-200">
                    <p className="text-sm text-gray-600">
                      Stock after restock
                    </p>
                    <p className="text-sm font-semibold text-gray-900">
                      {product.stock}
                      <span className="px-1.5 text-gray-400">&rarr;</span>
                      <span className="text-blue-700">{projectedStock}</span>
                    </p>
                  </div>
                )}

                <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
                  <button
                    type="button"
                    onClick={handleRestock}
                    disabled={submitting || !product}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300 sm:w-auto sm:min-w-48"
                  >
                    {submitting ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                          <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                        Saving
                      </>
                    ) : (
                      "Confirm restock"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setFormError("");
                      setSuccess(null);
                      setLookupError("");
                      barcodeRef.current?.focus();
                    }}
                    disabled={submitting}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    Clear
                  </button>
                </div>
              </SectionCard>
            </div>

            {/* History column */}
            <SectionCard
              title="Recent restocks"
              subtitle={restocks.length > 0 ? `${restocks.length} most recent` : undefined}
              className="h-fit lg:sticky lg:top-6"
            >
              {loadingRestocks ? (
                <div className="flex items-center justify-center gap-3 py-8 text-sm text-gray-500">
                  <svg className="h-4 w-4 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                    <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Loading history
                </div>
              ) : restocksError ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {restocksError}
                </div>
              ) : restocks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/70 px-4 py-10 text-center">
                  <p className="text-sm font-medium text-gray-700">No restocks yet</p>
                  <p className="mt-1 text-sm text-gray-500">Completed deliveries will appear here.</p>
                </div>
              ) : (
                <div
                  tabIndex={0}
                  role="group"
                  aria-label="Restock history, scrollable"
                  className="max-h-[24rem] space-y-2.5 overflow-y-auto overscroll-contain rounded-xl pr-1 lg:max-h-[calc(100vh-19rem)] [scrollbar-width:thin] [scrollbar-color:rgb(203_213_225)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 hover:[&::-webkit-scrollbar-thumb]:bg-gray-400"
                >
                  <ol className="space-y-2.5">
                    {restocks.map((row) => (
                      <li
                        key={row.id}
                        className="rounded-xl border border-gray-200 bg-white p-3.5 transition hover:border-gray-300 hover:shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-semibold leading-snug text-gray-900">
                            {row.product_name || `Product #${row.product_id}`}
                          </p>
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                            +{row.quantity_added}
                          </span>
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                          {row.supplier && (
                            <span className="font-medium text-gray-700">{row.supplier}</span>
                          )}
                          {Number(row.cost_price) > 0 && (
                            <>
                              <span aria-hidden="true">&middot;</span>
                              <span>{peso(row.cost_price)}</span>
                            </>
                          )}
                          {formatWhen(row.created_at) && (
                            <>
                              <span aria-hidden="true">&middot;</span>
                              <span>{formatWhen(row.created_at)}</span>
                            </>
                          )}
                        </div>

                        {row.previous_stock != null && row.new_stock != null && (
                          <p className="mt-2 text-xs font-medium text-gray-600">
                            {row.previous_stock} &rarr;{" "}
                            <span className="font-semibold text-gray-900">{row.new_stock}</span> units
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </div>
    </Layout>
  );
}