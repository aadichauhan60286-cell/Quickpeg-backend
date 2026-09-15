// QuickPeg backend -- seed demo data
// Run this once to populate the database with the demo retailer, products, and rider
// so the three apps have something real to talk to.

const db = require('./db');
const { nanoid } = require('nanoid');

function ensureAdmin(){
  const existingAdmin = db.prepare('SELECT COUNT(*) as c FROM admins').get();
  if(existingAdmin.c > 0) return;
  db.prepare(`INSERT INTO admins (id, name, phone, password)
    VALUES (?, ?, ?, ?)`).run(
    'admin_owner', 'Aaditya Chauhan', '9999999999', 'quickpegowner1'
  );
  console.log('Seeded owner admin login.');
}

function seed(){
  const existing = db.prepare('SELECT COUNT(*) as c FROM retailers').get();
  if(existing.c > 0){
    console.log('Database already has data -- skipping seed. Delete quickpeg.db to reseed.');
    ensureAdmin();
    return;
  }

  const retailerId = 'ret_vintage_cellar';
  db.prepare(`INSERT INTO retailers (id, name, address, phone, password, excise_license, is_open)
    VALUES (?, ?, ?, ?, ?, ?, 1)`).run(
    retailerId, 'The Vintage Cellar', 'Civil Lines, Rudrapur, Udham Singh Nagar', '9876543210', 'demo123', 'UK-EXC-2026-00142'
  );

  const products = [
    ['Kingfisher Premium', 'Beer', 180, 'can', '#C77D34', '#C77D34'],
    ['Bira 91 White', 'Beer', 210, 'can', '#8A7B4F', '#E0A868'],
    ['Budweiser', 'Beer', 195, 'can', '#A8462F', '#E0A868'],
    ['Corona Extra', 'Beer', 220, 'bottle', '#E0A868', '#F2EEE6'],
    ['Blenders Pride', 'Spirits', 950, 'spirit', '#2B3A2E', '#C77D34'],
    ['Old Monk Rum', 'Spirits', 620, 'spirit', '#1A1815', '#8A7B4F'],
    ['Sula Rasa Shiraz', 'Wine', 780, 'wine', '#4C2F3A', '#2B3A2E'],
    ['Coca-Cola 750ml', 'Mixers', 60, 'can', '#A8462F', '#F2EEE6'],
    ['Soda Water', 'Mixers', 40, 'can', '#8A7B4F', '#F2EEE6']
  ];
  const insertProduct = db.prepare(`INSERT INTO products (id, retailer_id, name, category, price, kind, tone, cap, in_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  products.forEach(p => {
    insertProduct.run(nanoid(10), retailerId, p[0], p[1], p[2], p[3], p[4], p[5]);
  });

  db.prepare(`INSERT INTO riders (id, name, phone, password, vehicle, is_online)
    VALUES (?, ?, ?, ?, ?, 0)`).run(
    'rider_rajesh', 'Rajesh Kumar', '9812345678', 'demo123', 'Motorcycle - DL 4S AB 1234'
  );

  ensureAdmin();

  console.log('Seed complete: 1 retailer, ' + products.length + ' products, 1 rider, 1 admin owner login.');
}

seed();
