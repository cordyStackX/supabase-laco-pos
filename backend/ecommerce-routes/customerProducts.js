const { Router } = require('express');
const { promisePool } = require('../db');

const router = Router();

function formatVariant(row) {
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    description: row.description || '',
    price: parseFloat(row.price),
    category: row.category,
    department: row.department || null,
    image: row.image,
    stock: row.stock,
    barcode: row.barcode || null,
    size: row.size || null,
    selectedSize: row.size || null,
    createdAt: row.created_at || row.id,
    updatedAt: row.updated_at || row.id,
  };
}

router.get('/', async (req, res) => {
  try {
    const { search, category, size, sort, limit = 50, page = 1 } = req.query;

    let query = 'SELECT * FROM products WHERE stock > 0 AND deleted = 0';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR barcode LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    const [columnRows] = await promisePool.query("SHOW COLUMNS FROM products LIKE 'created_at'");
    const hasCreatedAt = columnRows.length > 0;

    const sortMap = {
      newest: hasCreatedAt ? 'created_at DESC' : 'id DESC',
      'price-low': 'price ASC',
      'price-high': 'price DESC',
      name: 'name ASC',
      '-createdAt': hasCreatedAt ? 'created_at DESC' : 'id DESC',
      '-price': 'price DESC',
      price: 'price ASC',
    };

    query += ` ORDER BY ${sortMap[sort] || (hasCreatedAt ? 'created_at DESC' : 'id DESC')}`;

    const [rows] = await promisePool.query(query, params);

    const nameGroups = {};
    for (const row of rows) {
      if (!nameGroups[row.name]) nameGroups[row.name] = [];
      nameGroups[row.name].push(row);
    }

    const products = [];
    for (const row of rows) {
      const siblings = nameGroups[row.name] || [];
      const hasVariants = siblings.length > 1;
      products.push({
        _id: row.id,
        id: row.id,
        name: row.name,
        description: row.description || '',
        price: parseFloat(row.price),
        category: row.category,
        department: row.department || null,
        image: row.image,
        stock: row.stock,
        barcode: row.barcode || null,
        size: row.size || null,
        selectedSize: row.size || null,
        variants: hasVariants ? siblings.map(formatVariant) : [],
        hasVariants,
        createdAt: row.created_at || row.id,
        updatedAt: row.updated_at || row.id,
      });
    }

    let filtered = products;
    if (size) {
      filtered = products.filter((p) => p.size === size);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paginated = filtered.slice(offset, offset + parseInt(limit));

    res.json({
      products: paginated,
      total: filtered.length,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
});

router.get('/categories/list', async (req, res) => {
  try {
    const [tables] = await promisePool.query("SHOW TABLES LIKE 'categories'");
    let categories = [];

    if (tables.length > 0) {
      const [cols] = await promisePool.query('SHOW COLUMNS FROM categories');
      const colNames = cols.map((c) => c.Field);
      const nameCol = colNames.includes('name')
        ? 'name'
        : colNames.includes('category_name')
          ? 'category_name'
          : colNames[1] || 'id';

      const [rows] = await promisePool.query(`SELECT * FROM categories ORDER BY ${nameCol} ASC`);
      categories = rows.map((r) => ({
        id: r.id || r[cols[0].Field],
        name: r[nameCol],
      }));
    } else {
      const [rows] = await promisePool.query(
        "SELECT DISTINCT category FROM products WHERE deleted = 0 AND category IS NOT NULL AND category != '' ORDER BY category ASC"
      );
      categories = rows.map((r, i) => ({ id: i + 1, name: r.category }));
    }

    res.json({ categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ message: 'Failed to fetch categories' });
  }
});

router.get('/sizes/list', async (req, res) => {
  try {
    const [rows] = await promisePool.query('SELECT size, sizes FROM products WHERE deleted = 0');
    const set = new Set();
    rows.forEach((r) => {
      if (r.size) {
        r.size.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
          if (s.toLowerCase() !== 'n/a') set.add(s);
        });
      }
      if (r.sizes) {
        try {
          const arr = typeof r.sizes === 'string' ? JSON.parse(r.sizes) : r.sizes;
          arr.forEach((s) => {
            if (s && s.trim().toLowerCase() !== 'n/a') set.add(s.trim());
          });
        } catch {}
      }
    });
    res.json({ sizes: [...set].sort() });
  } catch (error) {
    console.error('Get sizes error:', error);
    res.status(500).json({ message: 'Failed to fetch sizes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await promisePool.query('SELECT * FROM products WHERE id = ? AND deleted = 0', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const product = rows[0];
    const [variantRows] = await promisePool.query(
      'SELECT * FROM products WHERE name = ? AND deleted = 0',
      [product.name]
    );

    const hasVariants = variantRows.length > 1;
    const variants = variantRows.map(formatVariant);

    res.json({
      product: {
        _id: product.id,
        id: product.id,
        name: product.name,
        description: product.description || '',
        price: parseFloat(product.price),
        category: product.category,
        department: product.department || null,
        image: product.image,
        stock: product.stock,
        barcode: product.barcode || null,
        size: product.size || null,
        selectedSize: product.size || null,
        variants,
        hasVariants,
        createdAt: product.created_at || product.id,
        updatedAt: product.updated_at || product.id,
      },
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ message: 'Failed to fetch product' });
  }
});

module.exports = router;
