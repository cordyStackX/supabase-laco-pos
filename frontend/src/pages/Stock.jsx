import React, { useEffect, useMemo, useState, useRef } from "react";
import Layout from "./Layout";
import { api, assetUrl } from "../lib/api";
import {
  SearchIcon,
  ChevronDownIcon,
  PlusIcon,
  DotsVerticalIcon,
  ImageIcon,
  TrashIcon,
  BoxIcon,
  PackageIcon,
  FolderIcon,
  AlertTriangleIcon,
  XIcon,
  PencilIcon,
} from "../components/Icons";

const LOW_STOCK_THRESHOLD = 30;

export default function Stock() {
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [categories, setCategories] = useState([]);

  const [showAddModal, setShowAddModal] = useState(false);

  // ✅ NEW
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategory, setNewCategory] = useState("");

  // EDIT / VIEW MODAL
  const [editModal, setEditModal] = useState(null); // product being edited
  const [editForm, setEditForm] = useState({
    name: "",
    category: "",
    price: "",
    barcode: "",
    stock: "",
    size: "",
    department: "",
    imageFile: null,
    imagePreview: "",
  });

  const [newProduct, setNewProduct] = useState({
    name: "",
    category: "",
    price: "",
    barcode: "",
    stock: 1,
    size: "",
    department: "",
    imageFile: null,
    imagePreview: "",
  });

  const [openActionMenuId, setOpenActionMenuId] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [notification, setNotification] = useState(null);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const categoryDropdownRef = useRef(null);

  useEffect(() => {
    loadStock();
    loadCategories();
  }, []);

  useEffect(() => {
    if (!openActionMenuId) return;
    const handler = (e) => {
      if (!e.target.closest(".action-menu")) setOpenActionMenuId(null);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openActionMenuId]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        categoryDropdownRef.current &&
        !categoryDropdownRef.current.contains(event.target)
      ) {
        setCategoryDropdownOpen(false);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadStock = async () => {
    setLoading(true);
    try {
      const data = await api.get("/products");
      if (!data.success) throw new Error("Failed to load stock");
      setStock(data.products || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const data = await api.get("/categories");
      if (data.success) setCategories(data.categories || []);
    } catch (err) {
      console.error(err);
    }
  };

  const addProduct = async () => {
    let { name, category, price, barcode } = newProduct;

    if (!name || !category || !price || !barcode)
      return alert("Fill all fields");

    const formData = new FormData();

    formData.append("name", name);
    formData.append("category", category);
    formData.append("price", price);
    formData.append("barcode", barcode);
    formData.append("stock", newProduct.stock);

    // append image if provided
    if (newProduct.imageFile) {
      formData.append("image", newProduct.imageFile);
    }

    if (newProduct.size && newProduct.size.trim() !== "") {
      formData.append("size", newProduct.size);
    }

    formData.append("department", newProduct.department || "");

    try {
      const data = await api.post("/products", formData);

      if (data.success) {
        setNotification({ type: "success", message: "Product added successfully!" });
        setTimeout(() => setNotification(null), 3000);
        setShowAddModal(false);
        setNewProduct({
          name: "",
          category: "",
          price: "",
          barcode: "",
          stock: 1,
          size: "",
          department: "",
          imageFile: null,
          imagePreview: "",
        });
        await loadStock();
        await loadCategories();
      } else {
        alert("Error: " + (data.message || "Failed to add product"));
      }
    } catch (err) {
      alert("Server error: " + err.message);
      console.error("Product add error:", err);
    }
  };

  // ✅ NEW CATEGORY HANDLER
  const addCategory = async () => {
    if (!newCategory.trim()) return alert("Enter category name");

    try {
      const data = await api.post("/categories", { name: newCategory });

      if (!data.success) {
        return alert(data.message || "Failed to add category");
      }

      setNewCategory("");
      setShowCategoryModal(false);
      loadCategories();

      // auto select new category
      setNewProduct((prev) => ({
        ...prev,
        category: data.category.name,
      }));
      if (editModal) {
        setEditForm((prev) => ({
          ...prev,
          category: data.category.name,
        }));
      }
    } catch (err) {
      console.error(err);
      alert("Failed to add category. Please try again.");
    }
  };

  const deleteProduct = async (id) => {
    if (!window.confirm("Delete this product?")) return;

    try {
      await api.del(`/products/${id}`);
    } catch (err) {
      alert(err.message || "Could not delete this product");
      return;
    }

    setOpenActionMenuId(null);
    loadStock();
  };

  const openEdit = (product) => {
    setEditModal(product);
    setEditForm({
      name: product.name || "",
      category: product.category || "",
      price: product.price ?? "",
      barcode: product.barcode ?? "",
      stock: product.stock ?? "",
      size: product.size || "",
      department: product.department || "",
      imageFile: null,
      imagePreview: "",
    });
    setOpenActionMenuId(null);
  };

  const closeEdit = () => {
    setEditModal(null);
    setEditForm({
      name: "",
      category: "",
      price: "",
      barcode: "",
      stock: "",
      size: "",
      department: "",
      imageFile: null,
      imagePreview: "",
    });
  };

  const saveProduct = async () => {
    const { name, category, price, barcode } = editForm;
    if (!name || !category || !price || !barcode)
      return alert("Fill all fields");

    const formData = new FormData();
    formData.append("name", name);
    formData.append("category", category);
    formData.append("price", price);
    formData.append("barcode", barcode);
    formData.append("stock", editForm.stock);
    formData.append("size", editForm.size || "");
    formData.append("department", editForm.department || "");

    if (editForm.imageFile) {
      formData.append("image", editForm.imageFile);
    }

    try {
      const data = await api.put(`/products/${editModal.id}`, formData);

      if (data.success) {
        setNotification({ type: "success", message: "Product updated successfully!" });
        setTimeout(() => setNotification(null), 3000);
        closeEdit();
        await loadStock();
      } else {
        alert("Error: " + (data.message || "Failed to update product"));
      }
    } catch (err) {
      alert("Server error: " + err.message);
      console.error("Product update error:", err);
    }
  };

  const removeEditImage = async () => {
    if (!window.confirm("Remove image for this product?")) return;

    await api.put(`/products/${editModal.id}/remove-image`);

    setEditModal((prev) => ({ ...prev, image: "" }));
    setEditForm((prev) => ({ ...prev, imageFile: null, imagePreview: "" }));
  };

  const departmentOptions = useMemo(
    () => Array.from(new Set(stock.map((item) => item.department).filter(Boolean))).sort(),
    [stock]
  );

  const normalizeSizeValue = (value) => String(value ?? "").trim();

  const sizeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          stock
            .map((item) => normalizeSizeValue(item.size))
            .filter((size) => {
              const normalized = size.toLowerCase();
              return size && !["n/a", "na", "none", "null", "undefined", "-"].includes(normalized);
            })
        )
      ).sort(),
    [stock]
  );

  const filteredStock = stock.filter((item) => {
    const query = search.toLowerCase();
    const itemSize = normalizeSizeValue(item.size);

    if (departmentFilter !== "all" && item.department !== departmentFilter) return false;
    if (sizeFilter !== "all" && itemSize.toLowerCase() !== String(sizeFilter).toLowerCase()) return false;
    if (categoryFilter && item.category !== categoryFilter) {
      return false;
    }

    return item.name?.toLowerCase().includes(query);
  });

  const stats = useMemo(() => {
    const total = stock.length;
    const stockQty = (item) => Number(item.stock) || 0;
    const lowStock = stock.filter((item) => {
      const q = stockQty(item);
      return q > 0 && q <= LOW_STOCK_THRESHOLD;
    }).length;
    const outOfStock = stock.filter((item) => stockQty(item) <= 0).length;
    return { total, lowStock, outOfStock, categories: categories.length };
  }, [stock, categories]);

  const resetForm = () => {
    setNewProduct({
      name: "",
      category: "",
      price: "",
      barcode: "",
      stock: 1,
      size: "",
      department: "",
      imageFile: null,
      imagePreview: "",
    });
  };

  const stockBadge = (value) => {
    const q = Number(value) || 0;
    if (q <= 0) {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-100">
          Out of Stock
        </span>
      );
    }
    if (q <= LOW_STOCK_THRESHOLD) {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-100">
          Low · {q}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">
        {q} in stock
      </span>
    );
  };

  if (loading)
    return (
      <div className="h-screen w-screen bg-gray-50 flex justify-center items-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
          <p className="text-sm font-medium text-gray-500">Loading inventory...</p>
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
    <Layout title="Inventory Management">
      {/* Notification toast */}
      {notification && (
        <div className="fixed top-4 right-4 z-50">
          <div className="px-4 py-3 rounded-lg shadow-md bg-white text-gray-800 border-l-4 border-emerald-500 max-w-sm flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {notification.message}
          </div>
        </div>
      )}

      <div className="p-4 md:p-6 space-y-4">
        {/* STATS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4">
            <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <BoxIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Products</p>
              <p className="text-xl font-bold text-gray-900">{stats.total}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4">
            <div className="h-11 w-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <AlertTriangleIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Low Stock</p>
              <p className="text-xl font-bold text-gray-900">{stats.lowStock}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4">
            <div className="h-11 w-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
              <PackageIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Out of Stock</p>
              <p className="text-xl font-bold text-gray-900">{stats.outOfStock}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4">
            <div className="h-11 w-11 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
              <FolderIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Categories</p>
              <p className="text-xl font-bold text-gray-900">{stats.categories}</p>
            </div>
          </div>
        </div>

        {/* TOOLBAR */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5 pl-3 pr-2 h-11 flex-1 min-w-[220px] rounded-xl border border-gray-300 bg-gray-50 text-sm focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-500 transition">
            <SearchIcon className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              placeholder="Search product..."
              className="flex-1 h-full bg-transparent border-none outline-none text-gray-700 placeholder:text-gray-400"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div ref={categoryDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setCategoryDropdownOpen((prev) => !prev)}
                className="h-11 px-4 rounded-xl border border-gray-300 bg-white text-gray-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200 cursor-pointer flex items-center gap-2 min-w-[160px] whitespace-nowrap text-sm"
              >
                <span className="truncate">{categoryFilter || "All Categories"}</span>
                <ChevronDownIcon className="w-4 h-4 text-gray-500 shrink-0" />
              </button>

              {categoryDropdownOpen && (
                <div className="absolute left-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryFilter("");
                      setCategoryDropdownOpen(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-600 hover:text-white transition"
                  >
                    All Categories
                  </button>
                  {categories.map((cat, idx) => {
                    const label = typeof cat === "string" ? cat : cat?.name || "";
                    return (
                      <button
                        key={`${label}-${idx}`}
                        type="button"
                        onClick={() => {
                          setCategoryFilter(label);
                          setCategoryDropdownOpen(false);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-600 hover:text-white transition"
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="h-11 px-4 rounded-xl border border-gray-300 bg-white text-gray-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200 text-sm cursor-pointer"
            >
              <option value="all">All Departments</option>
              {departmentOptions.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>

            <select
              value={sizeFilter}
              onChange={(e) => setSizeFilter(e.target.value)}
              className="h-11 px-4 rounded-xl border border-gray-300 bg-white text-gray-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200 text-sm cursor-pointer"
            >
              <option value="all">All Sizes</option>
              {sizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="h-11 px-5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition flex items-center justify-center gap-2 whitespace-nowrap shadow-sm text-sm font-medium"
          >
            <PlusIcon className="w-4 h-4" />
            Add Product
          </button>
        </div>

        {/* TABLE */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Image</th>
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Product</th>
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Department</th>
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Barcode</th>
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Price</th>
                <th className="p-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Stock</th>
                <th className="p-3"></th>
              </tr>
            </thead>

            <tbody>
              {filteredStock.map((item) => (
                <tr key={item.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="p-3">
                    {item.image ? (
                      <img
                        src={assetUrl(item.image)}
                        alt={item.name}
                        className="h-11 w-11 rounded-xl object-cover border border-gray-100"
                      />
                    ) : (
                      <div className="h-11 w-11 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 border border-gray-100">
                        <BoxIcon className="w-5 h-5" />
                      </div>
                    )}
                  </td>

                  <td className="p-3">
                    <div className="font-medium text-gray-900">{item.name}</div>
                    {item.size ? (
                      <div className="text-xs text-gray-500 mt-0.5">Size: {item.size}</div>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      {item.category || "-"}
                    </span>
                  </td>
                  <td className="p-3 text-sm text-gray-500">{item.department || "-"}</td>
                  <td className="p-3 text-sm font-mono text-gray-500">{item.barcode}</td>
                  <td className="p-3 font-semibold text-blue-600">₱{item.price}</td>
                  <td className="p-3">{stockBadge(item.stock)}</td>

                  <td className="p-3 relative">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(item)}
                        title="View / Edit product"
                        className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition"
                      >
                        <PencilIcon className="w-3.5 h-3.5" />
                        Edit
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenActionMenuId(
                            openActionMenuId === item.id ? null : item.id
                          );
                        }}
                        title="More actions"
                        className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
                      >
                        <DotsVerticalIcon className="w-4 h-4" />
                      </button>
                    </div>

                    {openActionMenuId === item.id && (
                      <div className="action-menu absolute right-0 mt-1 bg-white shadow-xl rounded-xl overflow-hidden w-52 border border-gray-100 z-50 py-1">
                        <div
                          onClick={() => openEdit(item)}
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                        >
                          <PencilIcon className="w-4 h-4 text-gray-400" />
                          View / Edit
                        </div>

                        <label className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                          <ImageIcon className="w-4 h-4 text-gray-400" />
                          Upload Image
                          <input
                            type="file"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files[0];
                              if (!file) return;

                              const fd = new FormData();
                              fd.append("image", file);

                              await api.put(`/products/${item.id}/update-image`, fd);

                              setOpenActionMenuId(null);
                              loadStock();
                            }}
                          />
                        </label>

                        {item.image && (
                          <div
                            onClick={async () => {
                              if (!window.confirm("Remove image for this product?")) return;

                              await api.put(`/products/${item.id}/remove-image`);

                              setOpenActionMenuId(null);
                              loadStock();
                            }}
                            className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                          >
                            <TrashIcon className="w-4 h-4 text-gray-400" />
                            Remove Image
                          </div>
                        )}

                        <div
                          onClick={() => deleteProduct(item.id)}
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 cursor-pointer border-t border-gray-100 mt-1"
                        >
                          <TrashIcon className="w-4 h-4" />
                          Delete Product
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredStock.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <BoxIcon className="w-10 h-10 text-gray-300" />
              <p className="text-sm text-gray-500">No products match your filters.</p>
            </div>
          )}
        </div>
      </div>

      {/* ADD PRODUCT MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex justify-center items-start sm:items-center z-50 px-4 py-8 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[calc(100vh-4rem)] overflow-y-auto">
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <PlusIcon className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Add Product</h2>
                  <p className="text-sm text-gray-500">
                    Add a new inventory item with category, pricing, and stock details.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                }}
                className="h-9 w-9 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="grid gap-4">
              <div className="space-y-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Product Name</span>
                  <input
                    value={newProduct.name}
                    placeholder="Enter product name"
                    className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition"
                    onChange={(e) =>
                      setNewProduct({ ...newProduct, name: e.target.value })
                    }
                  />
                </label>
              </div>

              <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                <label className="space-y-2 md:col-span-1">
                  <span className="text-sm font-medium text-gray-700">Category</span>
                  <select
                    className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition"
                    value={newProduct.category}
                    onChange={(e) =>
                      setNewProduct({ ...newProduct, category: e.target.value })
                    }
                  >
                    <option value="">Select Category</option>
                    {categories.map((cat, idx) => {
                      const label = typeof cat === "string" ? cat : cat?.name || "";
                      return (
                        <option key={`${label}-${idx}`} value={label}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => setShowCategoryModal(true)}
                  className="h-11 w-full md:w-auto px-5 bg-gray-100 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-200 transition text-sm font-medium flex items-center justify-center gap-2"
                >
                  <PlusIcon className="w-4 h-4" />
                  Category
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newProduct.price}
                    placeholder="0.00"
                    className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition"
                    onChange={(e) =>
                      setNewProduct({ ...newProduct, price: e.target.value })
                    }
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Barcode</span>
                  <input
                    value={newProduct.barcode}
                    placeholder="Enter barcode"
                    className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition"
                    onChange={(e) =>
                      setNewProduct({ ...newProduct, barcode: e.target.value })
                    }
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-end">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Stock</span>
                  <input
                    type="number"
                    min="0"
                    value={newProduct.stock}
                    placeholder="Quantity"
                    className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition appearance-none"
                    onChange={(e) =>
                      setNewProduct({ ...newProduct, stock: e.target.value })
                    }
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Size</span>
                  <select
                    className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition appearance-none"
                    value={newProduct.size}
                    onChange={(e) =>
                      setNewProduct({ ...newProduct, size: e.target.value })
                    }
                  >
                    <option value="">Select Size (Optional)</option>
                    <option value="XS">XS</option>
                    <option value="#20">#20</option>
                    <option value="Small">Small</option>
                    <option value="Medium">Medium</option>
                    <option value="Large">Large</option>
                    <option value="XL">XL</option>
                    <option value="2XL">2XL</option>
                    <option value="3XL">3XL</option>
                    <option value="4XL">4XL</option>
                  </select>
                </label>

                <div className="grid grid-cols-1 gap-4">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-gray-700">Department</span>
                    <select
                      className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition appearance-none"
                      value={newProduct.department}
                      onChange={(e) =>
                        setNewProduct({ ...newProduct, department: e.target.value })
                      }
                    >
                      <option value="">Select Department</option>
                      <option value="BSIT">BSIT</option>
                      <option value="SHTM">SHTM</option>
                      <option value="ARFIEN">ARFIEN</option>
                      <option value="SSLATE">SSLATE</option>
                    </select>
                  </label>
                </div>
              </div>

              <label className="space-y-2 mt-2">
                <span className="text-sm font-medium text-gray-700">Image (optional)</span>
                <div className="flex items-center gap-3">
                  {newProduct.imagePreview ? (
                    <img
                      src={newProduct.imagePreview}
                      alt="preview"
                      className="h-20 w-20 rounded-xl object-cover border border-gray-200"
                    />
                  ) : (
                    <div className="h-20 w-20 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 border border-dashed border-gray-300">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                  )}

                  <div className="flex flex-col ml-2 gap-2">
                    <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer transition w-max">
                      <ImageIcon className="w-4 h-4 text-gray-400" />
                      Choose image
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const url = URL.createObjectURL(file);
                          setNewProduct((prev) => ({
                            ...prev,
                            imageFile: file,
                            imagePreview: url,
                          }));
                        }}
                      />
                    </label>

                    {newProduct.imagePreview && (
                      <button
                        type="button"
                        onClick={() => {
                          URL.revokeObjectURL(newProduct.imagePreview);
                          setNewProduct((prev) => ({
                            ...prev,
                            imageFile: null,
                            imagePreview: "",
                          }));
                        }}
                        className="text-sm text-red-600 hover:underline w-max"
                      >
                        Remove image
                      </button>
                    )}
                  </div>
                </div>
              </label>

              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    resetForm();
                  }}
                  className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition text-sm font-medium"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={addProduct}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-sm text-sm font-medium"
                >
                  Add Product
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW / EDIT PRODUCT MODAL */}
      {editModal && (
        <div className="fixed inset-0 bg-black/40 flex justify-center items-start sm:items-center z-50 px-4 py-8 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[calc(100vh-4rem)] overflow-y-auto">
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
                  <PencilIcon className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Edit Product</h2>
                  <p className="text-sm text-gray-500">
                    View and update product details.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="h-9 w-9 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="grid gap-4">
              <div className="space-y-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Product Name</span>
                  <input
                    value={editForm.name}
                    placeholder="Enter product name"
                    className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition"
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                  />
                </label>
              </div>

              <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                <label className="space-y-2 md:col-span-1">
                  <span className="text-sm font-medium text-gray-700">Category</span>
                  <select
                    className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition"
                    value={editForm.category}
                    onChange={(e) =>
                      setEditForm({ ...editForm, category: e.target.value })
                    }
                  >
                    <option value="">Select Category</option>
                    {categories.map((cat, idx) => {
                      const label = typeof cat === "string" ? cat : cat?.name || "";
                      return (
                        <option key={`${label}-${idx}`} value={label}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => setShowCategoryModal(true)}
                  className="h-11 w-full md:w-auto px-5 bg-gray-100 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-200 transition text-sm font-medium flex items-center justify-center gap-2"
                >
                  <PlusIcon className="w-4 h-4" />
                  Category
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.price}
                    placeholder="0.00"
                    className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition"
                    onChange={(e) =>
                      setEditForm({ ...editForm, price: e.target.value })
                    }
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Barcode</span>
                  <input
                    value={editForm.barcode}
                    placeholder="Enter barcode"
                    className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition"
                    onChange={(e) =>
                      setEditForm({ ...editForm, barcode: e.target.value })
                    }
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-end">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Stock</span>
                  <input
                    type="number"
                    min="0"
                    value={editForm.stock}
                    placeholder="Quantity"
                    className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition appearance-none"
                    onChange={(e) =>
                      setEditForm({ ...editForm, stock: e.target.value })
                    }
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Size</span>
                  <select
                    className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition appearance-none"
                    value={editForm.size}
                    onChange={(e) =>
                      setEditForm({ ...editForm, size: e.target.value })
                    }
                  >
                    <option value="">No Size</option>
                    <option value="XS">XS</option>
                    <option value="#20">#20</option>
                    <option value="Small">Small</option>
                    <option value="Medium">Medium</option>
                    <option value="Large">Large</option>
                    <option value="XL">XL</option>
                    <option value="2XL">2XL</option>
                    <option value="3XL">3XL</option>
                    <option value="4XL">4XL</option>
                  </select>
                </label>

                <div className="grid grid-cols-1 gap-4">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-gray-700">Department</span>
                    <select
                      className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition appearance-none"
                      value={editForm.department}
                      onChange={(e) =>
                        setEditForm({ ...editForm, department: e.target.value })
                      }
                    >
                      <option value="">Select Department</option>
                      <option value="BSIT">BSIT</option>
                      <option value="SHTM">SHTM</option>
                      <option value="ARFIEN">ARFIEN</option>
                      <option value="SSLATE">SSLATE</option>
                    </select>
                  </label>
                </div>
              </div>

              <label className="space-y-2 mt-2">
                <span className="text-sm font-medium text-gray-700">Image</span>
                <div className="flex items-center gap-3">
                  {editForm.imagePreview || editModal.image ? (
                    <img
                      src={
                        editForm.imagePreview || assetUrl(editModal.image)
                      }
                      alt="product"
                      className="h-20 w-20 rounded-xl object-cover border border-gray-200"
                    />
                  ) : (
                    <div className="h-20 w-20 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 border border-dashed border-gray-300">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                  )}

                  <div className="flex flex-col ml-2 gap-2">
                    <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer transition w-max">
                      <ImageIcon className="w-4 h-4 text-gray-400" />
                      Replace image
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const url = URL.createObjectURL(file);
                          setEditForm((prev) => ({
                            ...prev,
                            imageFile: file,
                            imagePreview: url,
                          }));
                        }}
                      />
                    </label>

                    {editModal.image && (
                      <button
                        type="button"
                        onClick={removeEditImage}
                        className="inline-flex items-center gap-2 text-sm text-red-600 hover:underline w-max"
                      >
                        <TrashIcon className="w-4 h-4" />
                        Remove image
                      </button>
                    )}
                  </div>
                </div>
              </label>

              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition text-sm font-medium"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={saveProduct}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-sm text-sm font-medium"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ✅ CATEGORY MODAL OVERLAY */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/40 flex justify-center items-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-10 w-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
                <FolderIcon className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Add Category</h2>
            </div>

            <input
              placeholder="Category name"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addCategory();
              }}
              className="w-full border border-gray-300 px-4 py-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none transition"
            />

            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setShowCategoryModal(false)}
                className="px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition text-sm font-medium"
              >
                Cancel
              </button>

              <button
                onClick={addCategory}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-xl hover:bg-blue-700 transition shadow-sm text-sm font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
