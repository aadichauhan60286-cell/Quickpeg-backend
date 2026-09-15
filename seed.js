// QuickPeg backend -- main server
// This is the single server that all three apps (customer, retailer, rider) talk to.
// It stores real data in quickpeg.db and pushes live updates over WebSockets so that
// e.g. a new order appears on the retailer's screen instantly, without refreshing.

const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { nanoid } = require('nanoid');
const db = require('./db');
require('./seed'); // safe to run every startup -- it skips itself if data already exists

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ---------- Live update broadcasting ----------
const clients = new Set();

wss.on('connection', (ws) => {
  ws.channels = new Set();
  clients.add(ws);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if(msg.type === 'subscribe'){
        ws.channels.add(msg.channel);
      }
      if(msg.type === 'unsubscribe'){
        ws.channels.delete(msg.channel);
      }
    } catch(e){ /* ignore malformed messages */ }
  });

  ws.on('close', () => clients.delete(ws));
});

function broadcast(channel, payload){
  const data = JSON.stringify({ channel, ...payload });
  clients.forEach(ws => {
    if(ws.channels.has(channel) && ws.readyState === WebSocket.OPEN){
      ws.send(data);
    }
  });
}

// Notify every online rider that a new job is available (broadcast, not targeted)
function broadcastNewJob(order){
  broadcast('jobs:available', { type: 'new_job', order });
}

// ================= VALIDATION HELPERS =================

function calcAge(dob){
  const birth = new Date(dob);
  if(isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if(monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

const ORDER_FLOW = ['placed', 'accepted', 'preparing', 'ready', 'picked_up', 'delivered'];

// ================= OTP (stub -- no real SMS gateway wired up yet) =================
// This simulates the real flow so the front-end can be built against it now.
// Swap this out later for MSG91 / Gupshup once DLT registration is done.

app.post('/api/otp/send', (req, res) => {
  const { phone } = req.body;
  if(!phone || phone.length < 10) return res.status(400).json({ error: 'Valid phone number required' });

  const code = '1234'; // fixed demo code -- replace with random + real SMS send later
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO otps (phone, code, expires_at) VALUES (?, ?, ?) ON CONFLICT(phone) DO UPDATE SET code=?, expires_at=?')
    .run(phone, code, expires, code, expires);

  console.log(`[OTP STUB] Would SMS code ${code} to ${phone}`);
  res.json({ ok: true, message: 'OTP sent', demo_hint: 'Use 1234 in this demo' });
});

app.post('/api/otp/verify', (req, res) => {
  const { phone, code } = req.body;
  const record = db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);

  if(!record) return res.status(400).json({ error: 'No OTP requested for this number' });
  if(new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'OTP expired, request a new one' });
  if(record.code !== code) return res.status(400).json({ error: 'Incorrect code' });

  db.prepare('DELETE FROM otps WHERE phone = ?').run(phone);
  res.json({ ok: true, verified: true });
});

// ================= RETAILERS =================

app.post('/api/retailer/login', (req, res) => {
  const { phone, password } = req.body;
  const retailer = db.prepare('SELECT * FROM retailers WHERE phone = ?').get(phone);
  const found = retailer || db.prepare('SELECT * FROM retailers LIMIT 1').get();
  if(!found) return res.status(404).json({ error: 'No retailer found' });
  res.json({ retailer: found });
});

app.get('/api/retailers', (req, res) => {
  const retailers = db.prepare('SELECT * FROM retailers WHERE is_open = 1').all();
  res.json({ retailers });
});

app.get('/api/retailers/:id', (req, res) => {
  const retailer = db.prepare('SELECT * FROM retailers WHERE id = ?').get(req.params.id);
  if(!retailer) return res.status(404).json({ error: 'not found' });
  res.json({ retailer });
});

app.get('/api/retailers/:id/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE retailer_id = ?').all(req.params.id);
  res.json({ products });
});

app.patch('/api/retailers/:id', (req, res) => {
  const { is_open, name, address, excise_license } = req.body;
  const fields = [];
  const vals = [];
  if(is_open !== undefined){ fields.push('is_open = ?'); vals.push(is_open ? 1 : 0); }
  if(name){ fields.push('name = ?'); vals.push(name); }
  if(address){ fields.push('address = ?'); vals.push(address); }
  if(excise_license){ fields.push('excise_license = ?'); vals.push(excise_license); }
  if(fields.length === 0) return res.json({ ok: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE retailers SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  const retailer = db.prepare('SELECT * FROM retailers WHERE id = ?').get(req.params.id);
  res.json({ ok: true, retailer });
});

app.patch('/api/products/:id', (req, res) => {
  const { price, in_stock, name, description, category } = req.body;
  const fields = [];
  const vals = [];
  if(price !== undefined){ fields.push('price = ?'); vals.push(price); }
  if(in_stock !== undefined){ fields.push('in_stock = ?'); vals.push(in_stock ? 1 : 0); }
  if(name){ fields.push('name = ?'); vals.push(name); }
  if(description !== undefined){ fields.push('description = ?'); vals.push(description); }
  if(category){ fields.push('category = ?'); vals.push(category); }
  if(fields.length === 0) return res.json({ ok: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

app.post('/api/retailers/:id/products', (req, res) => {
  const { name, category, price, kind, tone, cap, description } = req.body;
  if(!name || !price) return res.status(400).json({ error: 'name and price required' });
  const id = nanoid(10);
  db.prepare(`INSERT INTO products (id, retailer_id, name, category, price, kind, tone, cap, description, in_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
    id, req.params.id, name, category || 'Beer', price, kind || 'bottle', tone || '#8A7B4F', cap || '#C77D34', description || ''
  );
  res.json({ ok: true, id });
});

app.delete('/api/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Retailer earnings summary -- computed live from real order data
app.get('/api/retailers/:id/earnings', (req, res) => {
  const retailerId = req.params.id;
  const retailer = db.prepare('SELECT * FROM retailers WHERE id = ?').get(retailerId);
  if(!retailer) return res.status(404).json({ error: 'not found' });

  const todayRow = db.prepare(`
    SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
    FROM orders WHERE retailer_id = ? AND status = 'delivered' AND date(created_at) = date('now')
  `).get(retailerId);

  const weekRow = db.prepare(`
    SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
    FROM orders WHERE retailer_id = ? AND status = 'delivered' AND created_at >= datetime('now', '-7 days')
  `).get(retailerId);

  const commissionPct = retailer.commission_pct || 12;
  const commission = Math.round(weekRow.revenue * commissionPct / 100);
  const netPayout = weekRow.revenue - commission;
  const avgOrder = weekRow.orders > 0 ? Math.round(weekRow.revenue / weekRow.orders) : 0;

  res.json({
    today: { orders: todayRow.orders, revenue: todayRow.revenue },
    week: { orders: weekRow.orders, revenue: weekRow.revenue, avgOrderValue: avgOrder },
    payout: { commissionPct, commission, netPayout }
  });
});

// ================= CUSTOMERS =================

app.post('/api/customer/login', (req, res) => {
  const { phone } = req.body;
  let customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  if(!customer){
    const id = nanoid(10);
    db.prepare('INSERT INTO customers (id, phone) VALUES (?, ?)').run(id, phone);
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  }
  res.json({ customer });
});

// Age verification -- checks DOB gives 25+ (Uttarakhand's minimum legal purchase age)
app.post('/api/customers/:id/verify-age', (req, res) => {
  const { dob } = req.body;
  const age = calcAge(dob);
  if(age === null) return res.status(400).json({ error: 'Invalid date of birth' });

  const verified = age >= 25;
  db.prepare('UPDATE customers SET dob = ?, age_verified = ? WHERE id = ?').run(dob, verified ? 1 : 0, req.params.id);

  if(!verified) return res.status(403).json({ error: 'Must be 25 or older to order alcohol in Uttarakhand', age_verified: false });
  res.json({ ok: true, age_verified: true, age });
});

app.patch('/api/customers/:id', (req, res) => {
  const { name } = req.body;
  if(!name) return res.json({ ok: true });
  db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json({ ok: true });
});

app.get('/api/customers/:id/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ orders });
});

// ================= ORDERS (the core live-flow piece) =================

app.post('/api/orders', (req, res) => {
  const { customer_id, retailer_id, items, total, payment_method, delivery_address } = req.body;

  if(!retailer_id || !items || !items.length || !total){
    return res.status(400).json({ error: 'retailer_id, items, and total are required' });
  }

  // Guard: don't allow ordering from a closed retailer
  const retailer = db.prepare('SELECT * FROM retailers WHERE id = ?').get(retailer_id);
  if(!retailer) return res.status(404).json({ error: 'Retailer not found' });
  if(!retailer.is_open) return res.status(409).json({ error: 'This store is currently closed' });

  // Guard: require age verification on file for this customer
  if(customer_id){
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
    if(customer && !customer.age_verified){
      return res.status(403).json({ error: 'Age verification required before ordering' });
    }
  }

  const id = nanoid(12);
  const orderNumber = 'QP-' + Math.floor(1000 + Math.random() * 9000);

  db.prepare(`INSERT INTO orders (id, order_number, customer_id, retailer_id, status, items_json, total, payment_method, delivery_address)
    VALUES (?, ?, ?, ?, 'placed', ?, ?, ?, ?)`).run(
    id, orderNumber, customer_id, retailer_id, JSON.stringify(items), total, payment_method, delivery_address
  );
  db.prepare('INSERT INTO order_events (order_id, status) VALUES (?, ?)').run(id, 'placed');

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  broadcast('retailer:' + retailer_id, { type: 'new_order', order });

  res.json({ order });
});

app.get('/api/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if(!order) return res.status(404).json({ error: 'not found' });
  const events = db.prepare('SELECT status, created_at FROM order_events WHERE order_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json({ order, events });
});

app.get('/api/retailers/:id/orders', (req, res) => {
  const status = req.query.status;
  let orders;
  if(status){
    orders = db.prepare('SELECT * FROM orders WHERE retailer_id = ? AND status = ? ORDER BY created_at DESC').all(req.params.id, status);
  } else {
    orders = db.prepare('SELECT * FROM orders WHERE retailer_id = ? ORDER BY created_at DESC').all(req.params.id);
  }
  res.json({ orders });
});

app.get('/api/riders/:id/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE rider_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ orders });
});

// Moving an order through its lifecycle: placed -> accepted -> preparing -> ready -> picked_up -> delivered
app.patch('/api/orders/:id/status', (req, res) => {
  const { status, rider_id, cancel_reason } = req.body;
  const orderId = req.params.id;

  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if(!existing) return res.status(404).json({ error: 'not found' });

  const validStatuses = [...ORDER_FLOW, 'rejected', 'cancelled'];
  if(!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status: ' + status });

  const fields = ['status = ?', "updated_at = datetime('now')"];
  const vals = [status];
  if(rider_id){ fields.push('rider_id = ?'); vals.push(rider_id); }
  if(cancel_reason){ fields.push('cancel_reason = ?'); vals.push(cancel_reason); }
  vals.push(orderId);

  db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  db.prepare('INSERT INTO order_events (order_id, status) VALUES (?, ?)').run(orderId, status);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

  broadcast('order:' + orderId, { type: 'status_update', order });
  broadcast('retailer:' + order.retailer_id, { type: 'order_update', order });
  if(order.rider_id) broadcast('rider:' + order.rider_id, { type: 'order_update', order });

  // The moment an order becomes ready, tell all online riders a job is available
  if(status === 'ready' && !order.rider_id) broadcastNewJob(order);

  res.json({ order });
});

// Riders see all unclaimed ready orders
app.get('/api/jobs/available', (req, res) => {
  const orders = db.prepare(`SELECT * FROM orders WHERE status = 'ready' AND rider_id IS NULL ORDER BY created_at ASC`).all();
  res.json({ orders });
});

// A rider claims a ready order
app.post('/api/orders/:id/claim', (req, res) => {
  const { rider_id } = req.body;
  const orderId = req.params.id;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

  if(!order) return res.status(404).json({ error: 'not found' });
  if(order.rider_id) return res.status(409).json({ error: 'Already claimed by another rider' });
  if(order.status !== 'ready') return res.status(409).json({ error: 'Order is not ready for pickup yet' });

  db.prepare(`UPDATE orders SET rider_id = ?, updated_at = datetime('now') WHERE id = ?`).run(rider_id, orderId);
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

  broadcast('order:' + orderId, { type: 'status_update', order: updated });
  broadcast('retailer:' + order.retailer_id, { type: 'order_update', order: updated });

  res.json({ order: updated });
});

// ================= RIDERS =================

app.post('/api/rider/login', (req, res) => {
  const { phone, password } = req.body;
  const rider = db.prepare('SELECT * FROM riders WHERE phone = ?').get(phone);
  const found = rider || db.prepare('SELECT * FROM riders LIMIT 1').get();
  if(!found) return res.status(404).json({ error: 'No rider found' });
  res.json({ rider: found });
});

app.patch('/api/riders/:id/status', (req, res) => {
  const { is_online } = req.body;
  db.prepare('UPDATE riders SET is_online = ? WHERE id = ?').run(is_online ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// Rider earnings summary -- computed live from real delivered orders
app.get('/api/riders/:id/earnings', (req, res) => {
  const riderId = req.params.id;

  const todayRow = db.prepare(`
    SELECT COUNT(*) as trips, COALESCE(SUM(rider_fare),0) as earnings
    FROM orders WHERE rider_id = ? AND status = 'delivered' AND date(created_at) = date('now')
  `).get(riderId);

  const weekRow = db.prepare(`
    SELECT COUNT(*) as trips, COALESCE(SUM(rider_fare),0) as earnings
    FROM orders WHERE rider_id = ? AND status = 'delivered' AND created_at >= datetime('now', '-7 days')
  `).get(riderId);

  const avgFare = weekRow.trips > 0 ? Math.round(weekRow.earnings / weekRow.trips) : 0;

  res.json({
    today: { trips: todayRow.trips, earnings: todayRow.earnings },
    week: { trips: weekRow.trips, earnings: weekRow.earnings, avgFare }
  });
});

// ================= ADMIN (owner control panel) =================
// Unlike the retailer/rider demo logins, this one actually checks the password --
// it can see and edit every shop, so it's worth locking down properly later
// (this is still a plain-text password check, fine for now, not for real launch).

app.post('/api/admin/login', (req, res) => {
  const { phone, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE phone = ? AND password = ?').get(phone, password);
  if(!admin) return res.status(401).json({ error: 'Incorrect phone number or password' });
  res.json({ admin: { id: admin.id, name: admin.name, phone: admin.phone } });
});

// Business-wide snapshot: shops, orders, revenue
app.get('/api/admin/overview', (req, res) => {
  const retailerCount = db.prepare('SELECT COUNT(*) as c FROM retailers').get().c;
  const openCount = db.prepare('SELECT COUNT(*) as c FROM retailers WHERE is_open = 1').get().c;
  const productCount = db.prepare('SELECT COUNT(*) as c FROM products').get().c;

  const todayRow = db.prepare(`
    SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
    FROM orders WHERE status = 'delivered' AND date(created_at) = date('now')
  `).get();
  const weekRow = db.prepare(`
    SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
    FROM orders WHERE status = 'delivered' AND created_at >= datetime('now', '-7 days')
  `).get();
  const activeOrders = db.prepare(`
    SELECT COUNT(*) as c FROM orders WHERE status NOT IN ('delivered','rejected','cancelled')
  `).get().c;

  res.json({
    retailers: { total: retailerCount, open: openCount },
    products: { total: productCount },
    today: todayRow,
    week: weekRow,
    activeOrders
  });
});

// All retailers, with a live product/order count for each
app.get('/api/admin/retailers', (req, res) => {
  const retailers = db.prepare('SELECT * FROM retailers').all();
  const withCounts = retailers.map(r => {
    const productCount = db.prepare('SELECT COUNT(*) as c FROM products WHERE retailer_id = ?').get(r.id).c;
    const orderCount = db.prepare('SELECT COUNT(*) as c FROM orders WHERE retailer_id = ?').get(r.id).c;
    return { ...r, productCount, orderCount };
  });
  res.json({ retailers: withCounts });
});

// Owner onboards a brand-new retailer partner
app.post('/api/admin/retailers', (req, res) => {
  const { name, address, phone, password, excise_license } = req.body;
  if(!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  const id = 'ret_' + nanoid(10);
  db.prepare(`INSERT INTO retailers (id, name, address, phone, password, excise_license, is_open)
    VALUES (?, ?, ?, ?, ?, ?, 1)`).run(
    id, name, address || '', phone, password || 'demo123', excise_license || ''
  );
  res.json({ ok: true, id });
});

// All orders across every shop, most recent first
app.get('/api/admin/orders', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const orders = db.prepare(`
    SELECT orders.*, retailers.name as retailer_name
    FROM orders JOIN retailers ON retailers.id = orders.retailer_id
    ORDER BY orders.created_at DESC LIMIT ?
  `).all(limit);
  res.json({ orders });
});

// ---------- Health check ----------
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`QuickPeg backend running on port ${PORT}`);
});
