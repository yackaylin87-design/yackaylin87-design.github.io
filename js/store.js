// Capa de datos. Todo se guarda en Firestore bajo users/{uid}/{colección}/{id}.
// En modo demostración (solo en la computadora de pruebas) usa datos de ejemplo en memoria.
const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';

export async function createStore(config, { demo = false } = {}) {
  return demo ? demoStore() : firebaseStore(config);
}

async function firebaseStore(cfg) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-firestore.js'),
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  auth.languageCode = 'es';
  let db;
  try {
    db = F.initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
    });
  } catch (e) {
    db = F.initializeFirestore(app, { ignoreUndefinedProperties: true });
  }
  let uid = null;
  const unsubs = [];
  const col = c => F.collection(db, 'users', uid, c);
  return {
    mode: 'firebase',
    onAuth(cb) {
      A.onAuthStateChanged(auth, u => { uid = u ? u.uid : null; cb(u ? { email: u.email, uid: u.uid } : null); });
    },
    login: (email, pass) => A.signInWithEmailAndPassword(auth, email, pass),
    reset: email => A.sendPasswordResetEmail(auth, email),
    logout() { unsubs.splice(0).forEach(f => f()); return A.signOut(auth); },
    newId: c => F.doc(col(c)).id,
    listen(c, cb, onErr) {
      unsubs.push(F.onSnapshot(col(c), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })), s.metadata.fromCache), onErr));
    },
    async commit(ops) {
      for (let i = 0; i < ops.length; i += 400) {
        const b = F.writeBatch(db);
        for (const o of ops.slice(i, i + 400)) {
          const r = F.doc(db, 'users', uid, o.c, o.id);
          if (o.t === 'del') b.delete(r);
          else if (o.t === 'update') b.update(r, o.data);
          else b.set(r, o.data, { merge: !!o.merge });
        }
        await b.commit();
      }
    },
  };
}

function demoStore() {
  const data = seed();
  const subs = {};
  let n = 0;
  const emit = c => (subs[c] || []).forEach(cb => cb(Object.entries(data[c] || {}).map(([id, d]) => ({ id, ...d })), false));
  return {
    mode: 'demo',
    onAuth(cb) { this._cb = cb; setTimeout(() => cb(null), 50); },
    async login(email) { this._cb({ email: email || 'demo@ejemplo.com', uid: 'demo' }); },
    async reset() {},
    async logout() { this._cb(null); },
    newId: () => 'd' + Date.now().toString(36) + (n++),
    listen(c, cb) { (subs[c] = subs[c] || []).push(cb); setTimeout(() => emit(c), 30); },
    async commit(ops) {
      const touched = new Set();
      for (const o of ops) {
        data[o.c] = data[o.c] || {};
        if (o.t === 'del') delete data[o.c][o.id];
        else if (o.t === 'update' || o.merge) data[o.c][o.id] = { ...(data[o.c][o.id] || {}), ...o.data };
        else data[o.c][o.id] = { ...o.data };
        touched.add(o.c);
      }
      touched.forEach(emit);
    },
  };
}

// Datos de ejemplo para probar la página sin tocar tu información real.
function seed() {
  const d = (off) => { const x = new Date(); x.setDate(x.getDate() - off); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  const P = {
    p1: { codigo: 'TM-101', nombre: 'Crema facial Aloe', catalogo: 'Catálogo Noviembre', costo: 95, precio: 165, minimo: 3 },
    p2: { codigo: 'TM-205', nombre: 'Perfume Brisa 50 ml', catalogo: 'Catálogo Noviembre', costo: 210, precio: 349, minimo: 2 },
    p3: { codigo: 'TM-310', nombre: 'Shampoo Romero', catalogo: 'Catálogo Octubre', costo: 62, precio: 115, minimo: 4 },
    p4: { codigo: 'TM-412', nombre: 'Jabón artesanal Avena', catalogo: 'Catálogo Octubre', costo: 28, precio: 55, minimo: 5 },
    p5: { codigo: 'TM-520', nombre: 'Kit Navidad Glow', catalogo: 'Campaña Navidad', costo: 320, precio: 549, minimo: 0 },
  };
  const Cl = {
    c1: { nombre: 'Ana López', telefono: '55 1234 5678', nota: 'Entrega en oficina' },
    c2: { nombre: 'Rosa Martínez', telefono: '33 9876 5432', nota: '' },
    c3: { nombre: 'Lupita Hernández', telefono: '81 5555 1212', nota: 'Paga quincenal' },
    c4: { nombre: 'Carmen Ruiz', telefono: '', nota: '' },
  };
  const E = {
    e1: { fecha: d(80), productoId: 'p1', cantidad: 10, costo: 95, pagado: 950, nota: 'Pedido 1001' },
    e2: { fecha: d(80), productoId: 'p3', cantidad: 8, costo: 62, pagado: 496, nota: 'Pedido 1001' },
    e3: { fecha: d(45), productoId: 'p2', cantidad: 6, costo: 210, pagado: 600, nota: 'Pedido 1002' },
    e4: { fecha: d(45), productoId: 'p4', cantidad: 15, costo: 28, pagado: 420, nota: 'Pedido 1002' },
    e5: { fecha: d(10), productoId: 'p5', cantidad: 4, costo: 320, pagado: 0, nota: 'Pedido 1003' },
  };
  const it = (p, q) => ({ productoId: p, cantidad: q, precio: P[p].precio, costo: P[p].costo });
  const V = {
    v1: { fecha: d(75), clienteId: 'c1', items: [it('p1', 2), it('p3', 1)], origen: 'Meta Ads', campana: 'Cremas octubre', entrega: 'Entregado' },
    v2: { fecha: d(70), clienteId: 'c2', items: [it('p3', 2)], origen: 'Recomendación', campana: '', entrega: 'Entregado' },
    v3: { fecha: d(50), clienteId: 'c3', items: [it('p2', 1), it('p4', 3)], origen: 'Meta Ads', campana: 'Perfumes', entrega: 'Entregado' },
    v4: { fecha: d(40), clienteId: 'c1', items: [it('p2', 2)], origen: 'Clienta frecuente', campana: '', entrega: 'Entregado' },
    v5: { fecha: d(33), clienteId: 'c4', items: [it('p4', 4)], origen: 'Otro', campana: '', entrega: 'Entregado' },
    v6: { fecha: d(18), clienteId: 'c2', items: [it('p1', 3), it('p4', 2)], origen: 'Meta Ads', campana: 'Cremas octubre', entrega: 'Entregado' },
    v7: { fecha: d(12), clienteId: 'c3', items: [it('p5', 2)], origen: 'Meta Ads', campana: 'Navidad', entrega: 'Llegó' },
    v8: { fecha: d(6), clienteId: 'c1', items: [it('p5', 3), it('p1', 1)], origen: 'Meta Ads', campana: 'Navidad', entrega: 'Por pedir a Terramar' },
    v9: { fecha: d(3), clienteId: 'c4', items: [it('p2', 1)], origen: 'Recomendación', campana: '', entrega: 'Pedido a Terramar' },
    v10: { fecha: d(1), clienteId: 'c2', items: [it('p3', 4)], origen: 'Meta Ads', campana: 'Navidad', entrega: 'Por pedir a Terramar' },
  };
  const Ab = {
    a1: { fecha: d(75), clienteId: 'c1', monto: 445, metodo: 'Transferencia', nota: '' },
    a2: { fecha: d(68), clienteId: 'c2', monto: 230, metodo: 'Efectivo', nota: '' },
    a3: { fecha: d(48), clienteId: 'c3', monto: 300, metodo: 'Efectivo', nota: '' },
    a4: { fecha: d(30), clienteId: 'c1', monto: 400, metodo: 'Tarjeta', nota: '' },
    a5: { fecha: d(30), clienteId: 'c4', monto: 220, metodo: 'Efectivo', nota: '' },
    a6: { fecha: d(15), clienteId: 'c2', monto: 300, metodo: 'Transferencia', nota: '' },
    a7: { fecha: d(5), clienteId: 'c3', monto: 500, metodo: 'Transferencia', nota: '' },
  };
  const Pg = { g1: { fecha: d(40), monto: 500, metodo: 'Transferencia', nota: 'Abono a pedido 1002' } };
  const G = {
    x1: { fecha: d(78), categoria: 'Meta Ads', campana: 'Cremas octubre', monto: 300, mensajes: 25, resultados: 25, nota: '' },
    x2: { fecha: d(52), categoria: 'Meta Ads', campana: 'Perfumes', monto: 250, mensajes: 14, resultados: 14, nota: '' },
    x3: { fecha: d(20), categoria: 'Meta Ads', campana: 'Cremas octubre', monto: 200, mensajes: 18, resultados: 18, nota: '' },
    x4: { fecha: d(14), categoria: 'Meta Ads', campana: 'Navidad', monto: 450, mensajes: 40, resultados: 40, nota: '' },
    x5: { fecha: d(16), categoria: 'Envíos', campana: '', monto: 120, mensajes: 0, resultados: 0, nota: 'Paquetería' },
    x6: { fecha: d(9), categoria: 'Empaque', campana: '', monto: 85, mensajes: 0, resultados: 0, nota: 'Bolsas y moños' },
  };
  let k = 1;
  const stamp = o => { for (const id in o) o[id].creado = k++; return o; };
  return { productos: stamp(P), clientes: stamp(Cl), entradas: stamp(E), ventas: stamp(V), abonos: stamp(Ab), pagos: stamp(Pg), gastos: stamp(G) };
}
