-- README 截图专用数据库；只新增演示资源，不使用任何业务库。
CREATE DATABASE IF NOT EXISTS miraihub_readme_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE miraihub_readme_demo;

CREATE TABLE IF NOT EXISTS mh_customers (
    id BIGINT NOT NULL COMMENT '客户编号',
    name VARCHAR(80) NOT NULL COMMENT '虚构的演示客户名称',
    email VARCHAR(160) NOT NULL COMMENT '演示邮箱，使用 example.com 保留域名',
    city VARCHAR(40) NOT NULL COMMENT '客户所在城市',
    created_at DATETIME NOT NULL COMMENT '注册时间，北京时间',
    PRIMARY KEY (id) COMMENT '唯一标识演示客户',
    UNIQUE KEY uk_mh_customers_email (email) COMMENT '保证演示邮箱唯一'
) COMMENT='README 演示客户';

CREATE TABLE IF NOT EXISTS mh_products (
    id BIGINT NOT NULL COMMENT '商品编号',
    name VARCHAR(120) NOT NULL COMMENT '商品展示名称',
    category VARCHAR(60) NOT NULL COMMENT '商品所属类别',
    price DECIMAL(10,2) NOT NULL COMMENT '商品单价，人民币元',
    stock INT NOT NULL COMMENT '可售库存，单位为件',
    PRIMARY KEY (id) COMMENT '唯一标识演示商品'
) COMMENT='README 演示商品目录';

CREATE TABLE IF NOT EXISTS mh_orders (
    id BIGINT NOT NULL COMMENT '订单编号',
    customer_id BIGINT NOT NULL COMMENT '关联 mh_customers.id 的客户编号',
    status VARCHAR(24) NOT NULL COMMENT '状态：completed 已完成、paid 已付款、processing 处理中',
    total DECIMAL(10,2) NOT NULL COMMENT '订单总额，人民币元',
    created_at DATETIME NOT NULL COMMENT '下单时间，北京时间',
    PRIMARY KEY (id) COMMENT '唯一标识演示订单',
    KEY idx_mh_orders_customer (customer_id) COMMENT '支持按客户查询订单',
    -- 有订单时禁止删除客户；客户编号变化时级联更新。
    CONSTRAINT fk_mh_orders_customer FOREIGN KEY (customer_id)
        REFERENCES mh_customers(id) ON UPDATE CASCADE ON DELETE RESTRICT
) COMMENT='README 演示订单';

CREATE TABLE IF NOT EXISTS mh_order_items (
    id BIGINT NOT NULL COMMENT '订单明细编号',
    order_id BIGINT NOT NULL COMMENT '关联 mh_orders.id 的订单编号',
    product_id BIGINT NOT NULL COMMENT '关联 mh_products.id 的商品编号',
    quantity INT NOT NULL COMMENT '购买数量，单位为件',
    unit_price DECIMAL(10,2) NOT NULL COMMENT '成交单价，人民币元',
    PRIMARY KEY (id) COMMENT '唯一标识订单明细',
    KEY idx_mh_order_items_order (order_id) COMMENT '支持按订单查询明细',
    KEY idx_mh_order_items_product (product_id) COMMENT '支持反查商品销售记录',
    -- 删除订单时级联删除明细；订单编号变化时级联更新。
    CONSTRAINT fk_mh_order_items_order FOREIGN KEY (order_id)
        REFERENCES mh_orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- 商品仍被明细引用时禁止删除；商品编号变化时级联更新。
    CONSTRAINT fk_mh_order_items_product FOREIGN KEY (product_id)
        REFERENCES mh_products(id) ON UPDATE CASCADE ON DELETE RESTRICT
) COMMENT='README 演示订单明细';
