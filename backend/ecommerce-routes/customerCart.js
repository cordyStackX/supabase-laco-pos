const { Router } = require('express');
const { promisePool } = require('../db');
const { authenticateToken, requireCustomer } = require('../ecommerce-middleware/auth');

const router = Router();

router.use(authenticateToken, requireCustomer);

async function getOrCreateCart(customerId) {
  const [existing] = await promisePool.query('SELECT id FROM ecom_carts WHERE customer_id = ?', [customerId]);
  if (existing.length > 0) return existing[0].id;

  const [result] = await promisePool.query('INSERT INTO ecom_carts (customer_id) VALUES (?)', [customerId]);
  return result.insertId;
}

router.get('/', async (req, res) => {
  try {
    const cartId = await getOrCreateCart(req.user.id);
    const [items] = await promisePool.query(
      `SELECT ci.id, ci.product_id, ci.quantity, ci.selected_size,
              p.name, p.price, p.image, p.category, p.stock, p.sizes
       FROM ecom_cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = ?`,
      [cartId]
    );

    const cart = items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      name: item.name,
      price: parseFloat(item.price),
      image: item.image,
      category: item.category,
      stock: item.stock,
      selectedSize: item.selected_size,
      quantity: item.quantity,
      sizes: item.sizes ? (typeof item.sizes === 'string' ? JSON.parse(item.sizes) : item.sizes) : [],
    }));

    res.json({ cart, total: cart.reduce((sum, item) => sum + item.price * item.quantity, 0) });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ message: 'Failed to fetch cart' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { productId, quantity = 1, selectedSize = null } = req.body;

    if (!productId) {
      return res.status(400).json({ message: 'Product ID is required' });
    }

    const [product] = await promisePool.query('SELECT id, stock FROM products WHERE id = ?', [productId]);
    if (product.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    if (product[0].stock < quantity) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }

    const cartId = await getOrCreateCart(req.user.id);

    const [existingItem] = await promisePool.query(
      'SELECT id, quantity FROM ecom_cart_items WHERE cart_id = ? AND product_id = ? AND selected_size <=> ?',
      [cartId, productId, selectedSize]
    );

    if (existingItem.length > 0) {
      const newQty = existingItem[0].quantity + quantity;
      if (newQty > product[0].stock) {
        return res.status(400).json({ message: 'Insufficient stock' });
      }
      await promisePool.query('UPDATE ecom_cart_items SET quantity = ? WHERE id = ?', [newQty, existingItem[0].id]);
    } else {
      await promisePool.query(
        'INSERT INTO ecom_cart_items (cart_id, product_id, quantity, selected_size) VALUES (?, ?, ?, ?)',
        [cartId, productId, quantity, selectedSize]
      );
    }

    res.json({ message: 'Item added to cart' });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ message: 'Failed to add item to cart' });
  }
});

router.put('/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
      await promisePool.query('DELETE FROM ecom_cart_items WHERE id = ?', [itemId]);
      return res.json({ message: 'Item removed from cart' });
    }

    const [item] = await promisePool.query(
      `SELECT ci.id, p.stock FROM ecom_cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.id = ? AND ci.cart_id = (SELECT id FROM ecom_carts WHERE customer_id = ?)`,
      [itemId, req.user.id]
    );

    if (item.length === 0) {
      return res.status(404).json({ message: 'Cart item not found' });
    }
    if (quantity > item[0].stock) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }

    await promisePool.query('UPDATE ecom_cart_items SET quantity = ? WHERE id = ?', [quantity, itemId]);
    res.json({ message: 'Cart updated' });
  } catch (error) {
    console.error('Update cart error:', error);
    res.status(500).json({ message: 'Failed to update cart' });
  }
});

router.delete('/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    await promisePool.query(
      "DELETE FROM ecom_cart_items WHERE id = ? AND cart_id = (SELECT id FROM ecom_carts WHERE customer_id = ?)",
      [itemId, req.user.id]
    );
    res.json({ message: 'Item removed from cart' });
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({ message: 'Failed to remove item' });
  }
});

router.delete('/', async (req, res) => {
  try {
    const [cart] = await promisePool.query('SELECT id FROM ecom_carts WHERE customer_id = ?', [req.user.id]);
    if (cart.length > 0) {
      await promisePool.query('DELETE FROM ecom_cart_items WHERE cart_id = ?', [cart[0].id]);
    }
    res.json({ message: 'Cart cleared' });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({ message: 'Failed to clear cart' });
  }
});

module.exports = router;
