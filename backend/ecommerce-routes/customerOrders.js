const { Router } = require('express');
const { promisePool } = require('../db');
const { authenticateToken, requireCustomer } = require('../ecommerce-middleware/auth');

const router = Router();

router.use(authenticateToken, requireCustomer);

router.post('/', async (req, res) => {
  const connection = await promisePool.getConnection();
  try {
    await connection.beginTransaction();

    const { items, totalAmount, customerInfo, paymentMethod } = req.body;
    const normalizedPaymentMethod =
      typeof paymentMethod === 'string' && paymentMethod.trim() ? paymentMethod.trim() : 'GCash';

    if (normalizedPaymentMethod.toLowerCase() !== 'gcash') {
      await connection.rollback();
      return res.status(400).json({ message: 'GCash is the only supported online payment method' });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item' });
    }

    if (!customerInfo || !customerInfo.fullName || !customerInfo.email || !customerInfo.contactNumber) {
      return res.status(400).json({ message: 'Customer information is required' });
    }

    for (const item of items) {
      const [product] = await connection.query(
        'SELECT id, stock, name FROM products WHERE id = ?',
        [item.product]
      );
      if (product.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: `Product not found: ${item.name || item.product}` });
      }
      if (product[0].stock < item.quantity) {
        await connection.rollback();
        return res.status(400).json({ message: `Insufficient stock for ${product[0].name}` });
      }
    }

    const [orderResult] = await connection.query(
      `INSERT INTO ecom_orders (customer_id, total_amount, status, customer_full_name, customer_email, customer_contact, payment_method)
       VALUES (?, ?, 'Pending Payment Verification', ?, ?, ?, ?)`,
      [req.user.id, totalAmount, customerInfo.fullName, customerInfo.email, customerInfo.contactNumber, 'GCash']
    );
    const orderId = orderResult.insertId;

    for (const item of items) {
      await connection.query(
        'INSERT INTO ecom_order_items (order_id, product_id, product_name, quantity, price, selected_size) VALUES (?, ?, ?, ?, ?, ?)',
        [orderId, item.product, item.name, item.quantity, item.price, item.selectedSize || null]
      );
    }

    await connection.commit();

    res.status(201).json({
      order: {
        _id: orderId,
        id: orderId,
        totalAmount,
        status: 'Pending Payment Verification',
        items,
        customerInfo,
        createdAt: new Date(),
      },
    });
  } catch (error) {
    await connection.rollback();
    console.error('Create order error:', error);
    res.status(500).json({ message: 'Failed to create order' });
  } finally {
    connection.release();
  }
});

router.get('/my-orders', async (req, res) => {
  try {
    const [orders] = await promisePool.query(
      'SELECT * FROM ecom_orders WHERE customer_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    const formattedOrders = await Promise.all(
      orders.map(async (order) => {
        const [items] = await promisePool.query(
          `SELECT oi.*, p.image FROM ecom_order_items oi
           LEFT JOIN products p ON oi.product_id = p.id
           WHERE oi.order_id = ?`,
          [order.id]
        );
        return formatOrder(order, items);
      })
    );

    res.json({ orders: formattedOrders });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [orders] = await promisePool.query(
      'SELECT * FROM ecom_orders WHERE id = ? AND customer_id = ?',
      [id, req.user.id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const [items] = await promisePool.query(
      `SELECT oi.*, p.image FROM ecom_order_items oi
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [id]
    );

    const [payments] = await promisePool.query(
      'SELECT * FROM ecom_payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1',
      [id]
    );

    const order = formatOrder(orders[0], items);
    if (payments.length > 0) {
      order.payment = {
        referenceNumber: payments[0].reference_number,
        paymentMethod: payments[0].payment_method,
        status: payments[0].status,
      };
    }

    res.json({ order });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ message: 'Failed to fetch order' });
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const [orders] = await promisePool.query(
      'SELECT * FROM ecom_orders WHERE id = ? AND customer_id = ?',
      [id, req.user.id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (orders[0].status !== 'Pending Payment Verification') {
      return res.status(400).json({ message: 'Only pending orders can be cancelled' });
    }

    await promisePool.query("UPDATE ecom_orders SET status = 'Cancelled' WHERE id = ?", [id]);
    res.json({ message: 'Order cancelled' });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ message: 'Failed to cancel order' });
  }
});

function formatOrder(order, items = []) {
  return {
    _id: order.id,
    id: order.id,
    totalAmount: parseFloat(order.total_amount),
    status: order.status,
    pickupCode: order.pickup_code || null,
    customerInfo: {
      fullName: order.customer_full_name,
      email: order.customer_email,
      contactNumber: order.customer_contact,
    },
    referenceNumber: order.reference_number,
    paymentMethod: order.payment_method,
    receiptImage: order.receipt_image,
    items: items.map((item) => ({
      product: { id: item.product_id, image: item.image },
      name: item.product_name,
      quantity: item.quantity,
      price: parseFloat(item.price),
      selectedSize: item.selected_size,
    })),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

module.exports = router;
