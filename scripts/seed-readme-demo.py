"""为 README 实机截图准备独立的 SQLite 演示库，不访问用户业务数据。"""

import argparse
import sqlite3
from pathlib import Path


# 创建带关联关系的演示表，并写入可重复使用的客户、商品和订单数据。
def seed_database(destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(destination) as database:
        database.execute("PRAGMA foreign_keys = ON")
        database.executescript("""
            -- 演示客户；主键唯一标识客户，邮箱唯一约束避免重复注册。
            CREATE TABLE IF NOT EXISTS mh_customers (
                id INTEGER PRIMARY KEY, -- 客户编号。
                name TEXT NOT NULL, -- 客户名称，全部为虚构演示姓名。
                email TEXT NOT NULL UNIQUE, -- 演示邮箱，使用保留的 example.com 域名。
                city TEXT NOT NULL, -- 客户所在城市。
                created_at TEXT NOT NULL -- 注册时间，北京时间。
            );
            -- 演示商品目录；主键唯一标识商品，金额和库存检查约束禁止负数。
            CREATE TABLE IF NOT EXISTS mh_products (
                id INTEGER PRIMARY KEY, -- 商品编号。
                name TEXT NOT NULL, -- 商品展示名称。
                category TEXT NOT NULL, -- 商品所属类别。
                price NUMERIC NOT NULL CHECK (price >= 0), -- 商品单价，人民币元。
                stock INTEGER NOT NULL CHECK (stock >= 0) -- 可售库存，单位为件。
            );
            -- 演示订单；客户外键阻止删除仍有订单的客户，更新客户编号时级联。
            CREATE TABLE IF NOT EXISTS mh_orders (
                id INTEGER PRIMARY KEY, -- 订单编号。
                customer_id INTEGER NOT NULL, -- 关联 mh_customers.id 的客户编号。
                status TEXT NOT NULL CHECK (status IN ('completed', 'paid', 'processing')),
                -- 订单状态：completed 已完成、paid 已付款、processing 处理中。
                total NUMERIC NOT NULL CHECK (total >= 0), -- 订单总额，人民币元。
                created_at TEXT NOT NULL, -- 下单时间，北京时间。
                FOREIGN KEY (customer_id) REFERENCES mh_customers(id)
                    ON UPDATE CASCADE ON DELETE RESTRICT
            );
            -- 演示订单明细；订单删除时级联删除明细，商品被引用时禁止删除。
            CREATE TABLE IF NOT EXISTS mh_order_items (
                id INTEGER PRIMARY KEY, -- 订单明细编号。
                order_id INTEGER NOT NULL, -- 关联 mh_orders.id 的订单编号。
                product_id INTEGER NOT NULL, -- 关联 mh_products.id 的商品编号。
                quantity INTEGER NOT NULL CHECK (quantity > 0), -- 购买数量，单位为件。
                unit_price NUMERIC NOT NULL CHECK (unit_price >= 0), -- 成交单价，人民币元。
                FOREIGN KEY (order_id) REFERENCES mh_orders(id)
                    ON UPDATE CASCADE ON DELETE CASCADE,
                FOREIGN KEY (product_id) REFERENCES mh_products(id)
                    ON UPDATE CASCADE ON DELETE RESTRICT
            );
            -- 支持按客户查询订单、按订单查明细及反查商品销售记录。
            CREATE INDEX IF NOT EXISTS idx_mh_orders_customer ON mh_orders(customer_id);
            CREATE INDEX IF NOT EXISTS idx_mh_order_items_order ON mh_order_items(order_id);
            CREATE INDEX IF NOT EXISTS idx_mh_order_items_product ON mh_order_items(product_id);
        """)
        names = ['林晨', '苏夏', '江舟', '沈星', '周宁', '叶青', '许知远', '陈一', '陆遥', '顾言', '唐溪', '温予']
        cities = ['杭州', '上海', '深圳', '北京', '成都', '南京']
        database.executemany(
            "INSERT OR IGNORE INTO mh_customers VALUES (?, ?, ?, ?, ?)",
            [(i + 1, name, f'customer{i + 1:02}@example.com', cities[i % 6],
              f'2026-10-{i + 1:02} 09:30:00') for i, name in enumerate(names)],
        )
        products = [
            (1, '机械键盘 K87', '桌面外设', 329, 128),
            (2, '无线鼠标 M2', '桌面外设', 199, 256),
            (3, 'USB-C 扩展坞', '数码配件', 269, 86),
            (4, '27 英寸显示器', '桌面外设', 1299, 42),
            (5, '桌面支架 Pro', '办公配件', 159, 175),
            (6, '降噪耳机 Air', '音频设备', 580, 64),
        ]
        database.executemany("INSERT OR IGNORE INTO mh_products VALUES (?, ?, ?, ?, ?)", products)
        orders, items = [], []
        for index in range(24):
            product = products[index % len(products)]
            quantity = index % 3 + 1
            order_id = 1024 + index
            orders.append((order_id, index % 12 + 1,
                           ['completed', 'paid', 'processing'][index % 3],
                           product[3] * quantity, f'2026-11-{index % 9 + 1:02} 14:{index * 2:02}:00'))
            items.append((index + 1, order_id, product[0], quantity, product[3]))
        database.executemany("INSERT OR IGNORE INTO mh_orders VALUES (?, ?, ?, ?, ?)", orders)
        database.executemany("INSERT OR IGNORE INTO mh_order_items VALUES (?, ?, ?, ?, ?)", items)
        assert database.execute("PRAGMA foreign_key_check").fetchall() == []
        counts = {name: database.execute(f'SELECT COUNT(*) FROM {name}').fetchone()[0]
                  for name in ['mh_customers', 'mh_products', 'mh_orders', 'mh_order_items']}
        mysql_schema = Path(__file__).with_name('readme-demo-mysql.sql').read_text(encoding='utf-8')
        inserts = []
        for table in counts:
            rows = database.execute(f'SELECT * FROM {table} ORDER BY id').fetchall()
            values = []
            for row in rows:
                values.append('(' + ', '.join(
                    "'" + value.replace("'", "''") + "'" if isinstance(value, str) else str(value)
                    for value in row
                ) + ')')
            inserts.append(f'INSERT IGNORE INTO {table} VALUES\n' + ',\n'.join(values) + ';')
        destination.with_suffix('.mysql.sql').write_text(
            mysql_schema + '\n\n' + '\n\n'.join(inserts) + '\n', encoding='utf-8'
        )
    print(destination.resolve())
    print(counts)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('output/readme-demo/miraihub-demo.sqlite'))
    seed_database(parser.parse_args().output)
