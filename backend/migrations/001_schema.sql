-- 001: base schema
-- Every statement is IF NOT EXISTS so this can run against both a fresh
-- database and the existing installation without data loss.

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  UNIQUE KEY unique_category_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  category VARCHAR(255),
  barcode VARCHAR(100),
  stock INT NOT NULL DEFAULT 0,
  image VARCHAR(500),
  size VARCHAR(50),
  sizes JSON,
  department VARCHAR(100) DEFAULT '',
  cost_price DECIMAL(10,2) DEFAULT 0,
  product_group_id INT NULL,
  variant_size VARCHAR(50),
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_barcode (barcode),
  KEY idx_products_deleted (deleted),
  KEY idx_products_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'sub',
  can_view_inventory_logs TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_admin_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_id INT NULL,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  adminId INT NULL,
  customer_name VARCHAR(255) NULL,
  customer_type VARCHAR(100) DEFAULT '',
  checkout_department VARCHAR(100) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sales_receipt (receipt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_id INT NULL,
  product_id INT NULL,
  product_name VARCHAR(255) NOT NULL,
  barcode VARCHAR(100),
  quantity INT NOT NULL DEFAULT 1,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sales_items_receipt (receipt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS restocks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  quantity_added INT NOT NULL,
  previous_stock INT DEFAULT 0,
  new_stock INT DEFAULT 0,
  reason VARCHAR(255) DEFAULT '',
  supplier VARCHAR(255),
  cost_price DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_restocks_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_id INT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  type ENUM('IN','OUT') NOT NULL,
  quantity INT NOT NULL,
  reason VARCHAR(255) DEFAULT '',
  staff VARCHAR(100) DEFAULT 'System',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_inventory_logs_product (product_id),
  KEY idx_inventory_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  contact VARCHAR(50),
  contact_number VARCHAR(20),
  password VARCHAR(255),
  role VARCHAR(20) NOT NULL DEFAULT 'customer',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS online_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(50) NOT NULL,
  customer_id INT NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_method ENUM('gcash','rcbc') DEFAULT 'gcash',
  payment_status ENUM('pending','verified','rejected') DEFAULT 'pending',
  order_status ENUM('pending_payment','verified','preparing','ready_for_pickup','completed','rejected') DEFAULT 'pending_payment',
  reference_number VARCHAR(100),
  receipt_image VARCHAR(500),
  verified_by INT NULL,
  verified_at DATETIME NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_order_number (order_number),
  KEY idx_online_orders_customer (customer_id),
  CONSTRAINT fk_online_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  barcode VARCHAR(100),
  quantity INT NOT NULL DEFAULT 1,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_order_items_order (order_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES online_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(50),
  reference_number VARCHAR(100),
  receipt_image VARCHAR(500),
  status ENUM('pending','verified','rejected') DEFAULT 'pending',
  verified_by INT NULL,
  verified_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_order_payments_order (order_id),
  CONSTRAINT fk_order_payments_order FOREIGN KEY (order_id) REFERENCES online_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ecom_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'Pending Payment Verification',
  customer_full_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_contact VARCHAR(20),
  reference_number VARCHAR(255),
  payment_method VARCHAR(50),
  receipt_image VARCHAR(500),
  payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  pickup_code VARCHAR(10),
  verified_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_ecom_pickup_code (pickup_code),
  KEY idx_ecom_orders_customer (customer_id),
  KEY idx_ecom_orders_status (status),
  CONSTRAINT fk_ecom_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ecom_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  selected_size VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ecom_order_items_order (order_id),
  CONSTRAINT fk_ecom_order_items_order FOREIGN KEY (order_id) REFERENCES ecom_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_ecom_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ecom_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  customer_id INT NOT NULL,
  receipt_image VARCHAR(500),
  reference_number VARCHAR(255),
  payment_method VARCHAR(50),
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  verified_by INT NULL,
  verified_at DATETIME NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ecom_payments_order (order_id),
  KEY idx_ecom_payments_customer (customer_id),
  CONSTRAINT fk_ecom_payments_order FOREIGN KEY (order_id) REFERENCES ecom_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_ecom_payments_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ecom_carts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_customer_cart (customer_id),
  CONSTRAINT fk_ecom_carts_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ecom_cart_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cart_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  selected_size VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ecom_cart_items_cart (cart_id),
  CONSTRAINT fk_ecom_cart_items_cart FOREIGN KEY (cart_id) REFERENCES ecom_carts(id) ON DELETE CASCADE,
  CONSTRAINT fk_ecom_cart_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS otp_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  purpose ENUM('login','register') NOT NULL,
  expires_at DATETIME NOT NULL,
  used TINYINT(1) NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_otp_email_purpose (email, purpose)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Atomic receipt counter. Allocating a receipt number is a single UPDATE, so
-- two cashiers checking out at the same moment can never be handed the same
-- number (which the previous MAX(receipt_id)+1 lookup could do).
CREATE TABLE IF NOT EXISTS receipt_counters (
  name VARCHAR(32) NOT NULL PRIMARY KEY,
  value BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO receipt_counters (name, value) VALUES ('pos', 1000);
