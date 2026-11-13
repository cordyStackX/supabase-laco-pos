const { Router } = require('express');
const { promisePool } = require('../db');
const { authenticateToken, requireCustomer } = require('../ecommerce-middleware/auth');
const upload = require('../ecommerce-middleware/upload');
const { discardTemporaryUpload, removeUpload, saveUpload } = require('../lib/objectStorage');

const router = Router();

router.use(authenticateToken, requireCustomer);

function generatePickupCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

router.post('/:id/gcash-pay', async (req, res) => {
  const connection = await promisePool.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;

    const [orders] = await connection.query(
      'SELECT * FROM ecom_orders WHERE id = ? AND customer_id = ?',
      [id, req.user.id]
    );

    if (orders.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Order not found' });
    }

    if (orders[0].status !== 'Pending Payment Verification') {
      await connection.rollback();
      return res.status(400).json({ message: 'Only pending orders can be paid online' });
    }

    let pickupCode = null;
    let isUnique = false;
    while (!isUnique) {
      pickupCode = generatePickupCode();
      const [existing] = await connection.query(
        'SELECT id FROM ecom_orders WHERE pickup_code = ?',
        [pickupCode]
      );
      if (existing.length === 0) isUnique = true;
    }

    const referenceNumber = 'GCASH-' + Date.now().toString().slice(-10);

    await connection.query(
      "UPDATE ecom_orders SET status = 'Payment Verified', payment_status = 'verified', payment_method = 'GCash', reference_number = ?, pickup_code = ?, verified_at = NOW() WHERE id = ?",
      [referenceNumber, pickupCode, id]
    );

    await connection.query(
      `INSERT INTO ecom_payments (order_id, customer_id, receipt_image, reference_number, payment_method, amount, status, verified_by, verified_at)
       VALUES (?, ?, NULL, ?, 'GCash', ?, 'verified', NULL, NOW())`,
      [id, req.user.id, referenceNumber, orders[0].total_amount]
    );

    const [items] = await connection.query(
      'SELECT product_id, quantity, product_name FROM ecom_order_items WHERE order_id = ?',
      [id]
    );

    for (const item of items) {
      await connection.query(
        'UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?',
        [item.quantity, item.product_id]
      );
      await connection.query(
        `INSERT INTO inventory_logs (product_id, product_name, type, quantity, reason, staff)
         VALUES (?, ?, 'OUT', ?, 'Ecommerce Order (GCash Online)', 'System')`,
        [item.product_id, item.product_name, item.quantity]
      );
    }

    await connection.commit();

    res.json({ success: true, message: 'Payment successful', pickupCode, referenceNumber });
  } catch (error) {
    await connection.rollback();
    console.error('GCash pay error:', error);
    res.status(500).json({ message: 'Failed to process payment' });
  } finally {
    connection.release();
  }
});

router.post('/:id/payment', upload.single('receipt'), async (req, res) => {
  try {
    const { id } = req.params;
    const { referenceNumber, paymentMethod = 'GCash' } = req.body;
    if (typeof paymentMethod !== 'string' || paymentMethod.trim().toLowerCase() !== 'gcash') {
      await discardTemporaryUpload(req.file);
      return res.status(400).json({ message: 'GCash is the only supported online payment method' });
    }

    const [orders] = await promisePool.query(
      'SELECT * FROM ecom_orders WHERE id = ? AND customer_id = ?',
      [id, req.user.id]
    );

    if (orders.length === 0) {
      await discardTemporaryUpload(req.file);
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Payment receipt image is required' });
    }

    const stored = await saveUpload(req.file, { kind: 'receipt' });
    const receiptPath = stored.relativePath;
    const connection = await promisePool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        "UPDATE ecom_orders SET reference_number = ?, receipt_image = ?, payment_method = ?, payment_status = 'pending' WHERE id = ?",
        [referenceNumber || '', receiptPath, 'GCash', id]
      );

      await connection.query(
        'INSERT INTO ecom_payments (order_id, customer_id, receipt_image, reference_number, payment_method, amount, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, req.user.id, receiptPath, referenceNumber || '', 'GCash', orders[0].total_amount, 'pending']
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      await removeUpload(receiptPath, 'receipt');
      throw error;
    } finally {
      connection.release();
    }

    res.json({ message: 'Payment submitted successfully' });
  } catch (error) {
    console.error('Upload payment error:', error);
    res.status(500).json({ message: 'Failed to upload payment' });
  }
});

module.exports = router;
