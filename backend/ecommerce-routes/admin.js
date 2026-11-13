const { Router } = require('express');
const { promisePool } = require('../db');
const { authenticateEcomAdmin } = require('../ecommerce-middleware/auth');

const router = Router();

router.use(authenticateEcomAdmin);

function generatePickupCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

router.get('/payments', async (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT p.*, o.customer_full_name, o.customer_email, o.customer_contact, o.total_amount
      FROM ecom_payments p
      JOIN ecom_orders o ON p.order_id = o.id
    `;
    const params = [];

    if (status) {
      query += ' WHERE p.status = ?';
      params.push(status);
    }

    query += ' ORDER BY p.created_at DESC';

    const [payments] = await promisePool.query(query, params);
    res.json({ payments });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ message: 'Failed to fetch payments' });
  }
});

router.post('/payments/:paymentId/verify', async (req, res) => {
  const connection = await promisePool.getConnection();
  try {
    await connection.beginTransaction();
    const { paymentId } = req.params;

    const [payments] = await connection.query('SELECT * FROM ecom_payments WHERE id = ?', [paymentId]);
    if (payments.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Payment not found' });
    }

    const payment = payments[0];

    let pickupCode;
    let isUnique = false;
    while (!isUnique) {
      pickupCode = generatePickupCode();
      const [existing] = await connection.query('SELECT id FROM ecom_orders WHERE pickup_code = ?', [pickupCode]);
      if (existing.length === 0) isUnique = true;
    }

    await connection.query(
      "UPDATE ecom_payments SET status = 'verified', verified_by = ?, verified_at = NOW() WHERE id = ?",
      [req.user.id, paymentId]
    );

    await connection.query(
      "UPDATE ecom_orders SET payment_status = 'verified', status = 'Payment Verified', pickup_code = ? WHERE id = ?",
      [pickupCode, payment.order_id]
    );

    const [orderItems] = await connection.query(
      'SELECT product_id, quantity FROM ecom_order_items WHERE order_id = ?',
      [payment.order_id]
    );

    for (const item of orderItems) {
      await connection.query(
        'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
        [item.quantity, item.product_id, item.quantity]
      );
      await connection.query(
        `INSERT INTO inventory_logs (product_id, product_name, type, quantity, reason, staff)
         SELECT ?, product_name, 'OUT', ?, 'Ecommerce Order (Receipt Verified)', 'System'
         FROM ecom_order_items WHERE product_id = ? AND order_id = ? LIMIT 1`,
        [item.product_id, item.quantity, item.product_id, payment.order_id]
      );
    }

    await connection.commit();
    res.json({ message: 'Payment verified successfully', pickupCode });
  } catch (error) {
    await connection.rollback();
    console.error('Verify payment error:', error);
    res.status(500).json({ message: 'Failed to verify payment' });
  } finally {
    connection.release();
  }
});

router.post('/payments/:paymentId/reject', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { notes } = req.body;

    const [payments] = await promisePool.query('SELECT * FROM ecom_payments WHERE id = ?', [paymentId]);
    if (payments.length === 0) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    await promisePool.query(
      "UPDATE ecom_payments SET status = 'rejected', notes = ? WHERE id = ?",
      [notes || null, paymentId]
    );

    await promisePool.query(
      "UPDATE ecom_orders SET payment_status = 'rejected', status = 'Rejected' WHERE id = ?",
      [payments[0].order_id]
    );

    res.json({ message: 'Payment rejected' });
  } catch (error) {
    console.error('Reject payment error:', error);
    res.status(500).json({ message: 'Failed to reject payment' });
  }
});

router.put('/orders/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const validStatuses = [
      'Pending Payment Verification',
      'Payment Verified',
      'Preparing',
      'Ready for Pickup',
      'Completed',
      'Rejected',
      'Cancelled',
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const [orders] = await promisePool.query('SELECT * FROM ecom_orders WHERE id = ?', [orderId]);
    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    await promisePool.query('UPDATE ecom_orders SET status = ? WHERE id = ?', [status, orderId]);
    res.json({ message: 'Order status updated' });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ message: 'Failed to update order status' });
  }
});

router.post('/orders/verify-pickup', async (req, res) => {
  try {
    const { pickupCode } = req.body;

    if (!pickupCode) {
      return res.status(400).json({ message: 'Pickup code is required' });
    }

    const [orders] = await promisePool.query(
      'SELECT id, customer_full_name, customer_contact, total_amount, status, pickup_code FROM ecom_orders WHERE pickup_code = ?',
      [pickupCode.trim().toUpperCase()]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Invalid pickup code' });
    }

    const order = orders[0];

    if (order.status === 'Completed') {
      return res.status(400).json({ message: 'This order has already been picked up', order });
    }

    if (order.status !== 'Ready for Pickup') {
      return res.status(400).json({ message: `Order is not ready for pickup. Current status: ${order.status}`, order });
    }

    res.json({
      message: 'Customer verified',
      order: {
        id: order.id,
        customerName: order.customer_full_name,
        contact: order.customer_contact,
        totalAmount: parseFloat(order.total_amount),
        status: order.status,
      },
    });
  } catch (error) {
    console.error('Verify pickup error:', error);
    res.status(500).json({ message: 'Failed to verify pickup code' });
  }
});

router.post('/orders/complete-pickup', async (req, res) => {
  try {
    const { pickupCode } = req.body;

    if (!pickupCode) {
      return res.status(400).json({ message: 'Pickup code is required' });
    }

    const [orders] = await promisePool.query(
      'SELECT id, status FROM ecom_orders WHERE pickup_code = ?',
      [pickupCode.trim().toUpperCase()]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Invalid pickup code' });
    }

    const order = orders[0];

    if (order.status === 'Completed') {
      return res.status(400).json({ message: 'This order has already been picked up' });
    }

    if (order.status !== 'Ready for Pickup') {
      return res.status(400).json({ message: `Order is not ready for pickup. Current status: ${order.status}` });
    }

    await promisePool.query("UPDATE ecom_orders SET status = 'Completed' WHERE id = ?", [order.id]);
    res.json({ message: 'Order marked as completed' });
  } catch (error) {
    console.error('Complete pickup error:', error);
    res.status(500).json({ message: 'Failed to complete pickup' });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM ecom_orders';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const [orders] = await promisePool.query(query, params);

    const formattedOrders = await Promise.all(
      orders.map(async (order) => {
        const [items] = await promisePool.query(
          'SELECT * FROM ecom_order_items WHERE order_id = ?',
          [order.id]
        );
        return {
          _id: order.id,
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
          items: items.map((i) => ({
            name: i.product_name,
            quantity: i.quantity,
            price: parseFloat(i.price),
          })),
          createdAt: order.created_at,
        };
      })
    );

    res.json({ orders: formattedOrders });
  } catch (error) {
    console.error('Get admin orders error:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

module.exports = router;
