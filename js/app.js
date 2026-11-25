import { firebaseConfig } from './config.js';
import { createStore } from './store.js';

/* ============ Utilidades ============ */
const COLS = ['productos', 'clientes', 'ventas', 'abonos', 'entradas', 'pagos', 'gastos', 'regalos', 'lista', 'ajustes'];
const S = Object.fromEntries(COLS.map(c => [c, []]));
let C = {}, store = null, user = null;
const editing = {}, q = {}, charts = {};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,\s]/g, '')); return isFinite(n) ? n : 0; };
const r2 = n => Math.round(num(n) * 100) / 100;
const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => { const v = num(n); return MXN.format(Math.abs(v) < 0.005 ? 0 : v); };
const moneyShort = n => { const v = num(n); return Math.abs(v) >= 1000 ? '$' + (v / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 }) + ' mil' : '$' + v.toLocaleString('es-MX', { maximumFractionDigits: 0 }); };
const int = n => Math.round(num(n)).toLocaleString('es-MX');
const pct = (n, d = 0) => (n == null || !isFinite(n)) ? '—' : (n * 100).toLocaleString('es-MX', { maximumFractionDigits: d }) + '%';
const iso = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const today = () => iso(new Date());
const pd = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
const fdate = s => s ? String(s).split('-').reverse().join('/') : '';
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const byId = (c, id) => S[c].find(x => x.id === id);
const pName = id => byId('productos', id)?.nombre || '(producto borrado)';
const cName = id => byId('clientes', id)?.nombre || '(cliente borrado)';
const sum = (arr, f) => arr.reduce((s, x) => s + num(f(x)), 0);
const ord = asc => (a, b) => { const r = String(a.fecha || '').localeCompare(String(b.fecha || '')) || (num(a.creado) - num(b.creado)); return asc ? r : -r; };
const byName = (a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');

let toastT;
function toast(msg, kind) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (kind ? ' ' + kind : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, kind === 'warn' ? 6000 : 2800);
}
const fail = err => { console.error(err); toast(err?.code === 'permission-denied' ? 'No tienes permiso para guardar. Cierra sesión y vuelve a entrar.' : 'No se pudo guardar en la nube. Revisa tu internet e intenta de nuevo.', 'warn'); };
// Guarda sin esperar a la nube: el cambio se ve al instante y se sube cuando haya señal.
const commit = ops => { store.commit(ops).catch(fail); };

const ESTADOS = ['Por pedir a Terramar', 'Pedido a Terramar', 'Llegó', 'Pendiente por entregar', 'Entregado'];
// Siguiente paso en Pedidos: lo que ya llegó o ya tienes en stock se marca directo como entregado.
const nextEst = s => s === 'Llegó' || s === 'Pendiente por entregar' ? 'Entregado' : ESTADOS[ESTADOS.indexOf(s) + 1];
const ORIGENES = ['Meta Ads', 'Recomendación', 'Clienta frecuente', 'Otro'];
const METODOS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Otro'];
const CATS = ['Meta Ads', 'Envíos', 'Empaque', 'Otros'];
// Cuenta abierta: dinero que la clienta te deja guardado para después.
// "Guardar" = te dio dinero que no se usa para pagar nada todavía. "Usar" = paga una venta con ese dinero (no es dinero nuevo).
const USO = 'De su cuenta abierta', DEP = 'Guardar en su cuenta abierta', PAGAR = 'Pagar lo que debe';
const METCL = [...METODOS, USO];
const esDep = a => a.destino === DEP, esUso = a => a.metodo === USO;
const cash = a => !esUso(a); // dinero que de verdad recibiste
const est = v => ESTADOS.includes(v?.entrega) ? v.entrega : 'Entregado';
const estPill = s => s === 'Entregado' ? 'p-ok' : s === 'Llegó' || s === 'Pendiente por entregar' ? 'p-info' : s === 'Pedido a Terramar' ? 'p-warn' : 'p-acc';
const payPill = e => e === 'Pagada' ? 'p-ok' : e === 'Parcial' ? 'p-warn' : 'p-acc';

/* ============ Ventas: cálculos ============ */
const items = v => Array.isArray(v?.items) ? v.items : [];
const vTotal = v => sum(items(v), i => num(i.cantidad) * num(i.precio));
const vCosto = v => sum(items(v), i => num(i.cantidad) * num(i.costo ?? byId('productos', i.productoId)?.costo));
const vUnits = v => sum(items(v), i => i.cantidad);
const vDesc = v => items(v).map(i => `${pName(i.productoId)} ×${num(i.cantidad)}`).join(', ');
const payState = v => { const t = vTotal(v), p = C.vp?.[v.id] ?? t; return p <= 0.005 ? 'Pagada' : p < t - 0.005 ? 'Parcial' : 'Pendiente'; };
const eCosto = e => num(e.costo) * num(e.cantidad);
const rName = r => r.productoId ? pName(r.productoId) : (r.descripcion || 'Regalo');

function compute() {
  const stock = {}, cl = {}, vp = {};
  for (const p of S.productos) stock[p.id] = 0;
  for (const e of S.entradas) stock[e.productoId] = (stock[e.productoId] || 0) + num(e.cantidad);
  for (const r of S.regalos) if (r.productoId) stock[r.productoId] = (stock[r.productoId] || 0) + num(r.cantidad);
  for (const v of S.ventas) for (const i of items(v)) stock[i.productoId] = (stock[i.productoId] || 0) - num(i.cantidad);
  const g = id => cl[id] || (cl[id] = { vendido: 0, abonado: 0, n: 0, ultima: '', cuenta: 0 });
  for (const c of S.clientes) g(c.id);
  const porCli = {};
  for (const v of S.ventas) { const k = g(v.clienteId); k.vendido += vTotal(v); k.n++; if (String(v.fecha) > k.ultima) k.ultima = v.fecha; (porCli[v.clienteId] = porCli[v.clienteId] || []).push(v); }
  const abCli = {};
  for (const a of S.abonos) {
    const k = g(a.clienteId);
    if (esDep(a)) { k.cuenta += num(a.monto); continue; } // guardado: no paga ventas
    if (esUso(a)) k.cuenta -= num(a.monto);
    k.abonado += num(a.monto); (abCli[a.clienteId] = abCli[a.clienteId] || []).push(a);
  }
  // Abonos: el abono inicial se aplica a su venta; el resto, de la venta más antigua a la más nueva.
  for (const id in cl) {
    const k = cl[id]; k.saldo = k.vendido - k.abonado;
    const vs = (porCli[id] || []).sort(ord(1)); const paid = {}; let pool = 0;
    for (const a of abCli[id] || []) {
      const v = a.ventaId && vs.find(x => x.id === a.ventaId);
      if (v) { const room = vTotal(v) - (paid[v.id] || 0), u = Math.min(room, num(a.monto)); paid[v.id] = (paid[v.id] || 0) + u; pool += num(a.monto) - u; }
      else pool += num(a.monto);
    }
    for (const v of vs) { const room = vTotal(v) - (paid[v.id] || 0), u = Math.min(pool, Math.max(0, room)); pool -= u; vp[v.id] = r2(room - u); }
  }
  const compras = sum(S.entradas, eCosto), pagadoT = sum(S.entradas, e => e.pagado) + sum(S.pagos, p => p.monto);
  C = { stock, cl, vp, compras, pagadoT, deudaT: Math.max(0, compras - pagadoT) };
}
// Aviso de stock bajo: siempre cuando queda 1 pieza o menos (o el número que tenga guardado un producto viejo).
const isLow = p => (C.stock[p.id] || 0) <= (num(p.minimo) > 0 ? num(p.minimo) : 1);

/* ============ Formularios ============ */
const fecha = { k: 'fecha', l: 'Fecha', t: 'date', req: 1 }, nota = { k: 'nota', l: 'Nota (opcional)', t: 'text' };
const F = {
  ventas: { title: 'Registrar venta', one: 'venta', many: 'ventas', f: [
    fecha,
    { k: 'clienteId', l: 'Cliente', t: 'sel', src: 'clientes', req: 1, quick: 1 },
    { k: 'items', l: 'Productos', t: 'items' },
    { k: 'origen', l: '¿De dónde vino la venta?', t: 'opt', opts: ORIGENES },
    { k: 'campana', l: 'Campaña de Meta Ads', t: 'list', list: 'campanas', show: o => o.origen === 'Meta Ads', ph: 'Ej. Navidad' },
    { k: 'entrega', l: 'Estado del pedido', t: 'opt', opts: ESTADOS },
    { k: 'inicial', l: 'Abono inicial (opcional)', t: 'money', onlyNew: 1 },
    { k: 'metodoIni', l: 'Método del abono inicial', t: 'opt', opts: METCL, onlyNew: 1, show: o => num(o.inicial) > 0, help: 'Si te da más de lo que cuesta, lo que sobra se guarda en su cuenta abierta.' },
    nota] },
  abonos: { title: 'Registrar abono', one: 'abono', many: 'abonos', f: [
    fecha, { k: 'clienteId', l: 'Cliente', t: 'sel', src: 'clientes', req: 1 },
    { k: 'destino', l: '¿Para qué es este dinero?', t: 'opt', opts: [PAGAR, DEP] },
    { k: 'monto', l: 'Monto', t: 'money', req: 1 },
    { k: 'metodo', l: 'Método de pago', t: 'opt', opts: METCL, help: 'Elige “De su cuenta abierta” para pagar con el dinero que te dejó guardado.' }, nota] },
  clientes: { title: 'Agregar cliente', one: 'cliente', many: 'clientes', f: [
    { k: 'nombre', l: 'Nombre', t: 'text', req: 1 },
    { k: 'genero', l: 'Es…', t: 'opt', opts: ['Mujer', 'Hombre'] },
    { k: 'telefono', l: 'WhatsApp', t: 'tel', ph: '55 1234 5678', help: '10 dígitos. Si es de otro país, ponle la lada al inicio.' },
    { k: 'nota', l: 'Dirección o notas', t: 'text' }] },
  productos: { title: 'Agregar producto', one: 'producto', many: 'productos', f: [
    { k: 'foto', l: 'Foto del producto', t: 'photo', help: 'Opcional. Puedes tomarla con la cámara o elegirla de tu galería.' },
    { k: 'codigo', l: 'Código', t: 'text' },
    { k: 'nombre', l: 'Nombre del producto', t: 'text', req: 1 },
    { k: 'catalogo', l: 'Catálogo o campaña', t: 'list', list: 'catalogos', ph: 'Ej. Catálogo Noviembre' },
    { k: 'precio', l: 'Precio de catálogo (precio de venta)', t: 'money', req: 1 },
    { k: 'costo', l: 'Costo (lo que te cobra Terramar)', t: 'money', help: 'Se calcula solo: la mitad del precio de catálogo + 16%. Puedes cambiarlo si es otro.' }] },
  entradas: { title: 'Registrar pedido que llegó', one: 'compra', many: 'compras', saveLbl: 'Guardar pedido', f: [
    fecha,
    { k: 'nota', l: 'Nombre del pedido', t: 'text', ph: 'Ej. Primer pedido', help: 'Se pone en todos los productos de este pedido para que sepas que van juntos.' },
    { k: 'items', l: 'Productos que te llegaron', t: 'items', kind: 'compra', onlyNew: 1 },
    { k: 'productoId', l: 'Producto', t: 'sel', src: 'productos', req: 1, quick: 1, onlyEdit: 1 },
    { k: 'cantidad', l: 'Piezas que llegaron', t: 'int', req: 1, onlyEdit: 1 },
    { k: 'costo', l: 'Costo por pieza', t: 'money', onlyEdit: 1 },
    { k: 'pagado', l: 'Ya le pagué a Terramar por esto', t: 'money', onlyEdit: 1, help: 'Si pagas el pedido completo aparte, usa “Pago a Terramar”.' },
    { k: 'pagoPedido', l: '¿Cuánto ya pagaste de este pedido?', t: 'money', onlyNew: 1, help: 'Déjalo vacío si todavía no lo pagas. Si pones algo, se registra como un pago a Terramar.' }] },
  pagos: { title: 'Pago a Terramar', one: 'pago', many: 'pagos', f: [
    fecha, { k: 'monto', l: 'Monto pagado', t: 'money', req: 1 },
    { k: 'metodo', l: 'Método', t: 'opt', opts: METODOS }, nota] },
  regalos: { title: 'Registrar regalo de Terramar', one: 'regalo', many: 'regalos', f: [
    fecha, { k: 'productoId', l: 'Producto (si está en tu lista)', t: 'sel', src: 'productos', quick: 1, none: 'No está en mi lista' },
    { k: 'descripcion', l: '¿Qué te regalaron?', t: 'text', show: o => !o.productoId, ph: 'Ej. Bolsa de regalo, muestra de crema' },
    { k: 'cantidad', l: 'Piezas', t: 'int', req: 1 },
    { k: 'valor', l: 'Precio de venta por pieza', t: 'money', help: 'Si es de tu lista, se llena solo. Sirve para saber cuánto vale lo que te regalaron.' },
    { k: 'nota', l: 'Nota (por qué pedido te llegó…)', t: 'text' }] },
  gastos: { title: 'Registrar gasto', one: 'gasto', many: 'gastos', f: [
    fecha, { k: 'categoria', l: 'Categoría', t: 'opt', opts: CATS },
    { k: 'campana', l: 'Campaña', t: 'list', list: 'campanas', ph: 'Ej. Navidad', help: 'Usa el mismo nombre que en tus ventas para medir resultados.' },
    { k: 'monto', l: 'Monto', t: 'money', req: 1 },
    { k: 'mensajes', l: 'Mensajes recibidos (opcional)', t: 'int', show: o => o.categoria === 'Meta Ads' },
    { k: 'resultados', l: 'Resultados de la campaña (opcional)', t: 'int', show: o => o.categoria === 'Meta Ads', help: 'Lo que Meta Ads reporte como “Resultados”.' },
    nota] },
};

function fieldHTML(p, f) {
  const id = `${p}-${f.k}`; let h;
  if (f.t === 'sel') h = `<div class="selrow"><select id="${id}" name="${f.k}"></select>${f.quick ? `<button class="btn sm" type="button" data-quick="${f.src}" data-target="${id}">+ Nuevo</button>` : ''}</div>`;
  else if (f.t === 'photo') h = `<div class="fotobox"><img class="fprev" alt="" hidden><span class="fnone">Sin foto</span><input type="hidden" id="${id}" name="${f.k}">
    <label class="btn sm">Elegir foto<input type="file" accept="image/*" data-foto hidden></label><button class="btn sm" type="button" data-fotox hidden>Quitar foto</button></div>`;
  else if (f.t === 'opt') h =`<select id="${id}" name="${f.k}">${f.opts.map(o => `<option>${o}</option>`).join('')}</select>`;
  else if (f.t === 'items') {
    // Lista compacta arriba y un solo recuadro para elegir producto abajo (ventas y pedidos a Terramar).
    const compra = f.kind === 'compra';
    return `<div class="fld" data-k="items"><span class="lbl">${f.l}</span>
    <ul class="list plist" id="${id}-list"></ul>
    <div class="it ad${compra ? '' : ' ad2'}" id="${id}" data-kind="${compra ? 'compra' : 'venta'}">
      <div class="selrow it-p"><select class="ad-p" id="${id}-p" aria-label="Producto">${prodOptions()}</select><button class="btn sm" type="button" data-quick="productos" data-target="${id}-p">+ Nuevo</button></div>
      <label>${compra ? 'Piezas' : 'Cantidad'}<input class="ad-q" type="number" min="1" step="1" inputmode="numeric" value="1"></label>
      ${compra ? '<label>Catálogo<input class="ad-pc" type="number" min="0" step="0.01" inputmode="decimal" placeholder="$0.00"></label>' : ''}
      <label>${compra ? 'Costo c/u' : 'Precio c/u'}<input class="ad-r" type="number" min="0" step="0.01" inputmode="decimal" placeholder="$0.00"></label>
      <div class="it-sub ad-sub"></div>
      <button class="btn sm pri ad-btn" type="button" data-addline>+ Agregar ${compra ? 'al pedido' : 'a la venta'}</button>
    </div></div>`;
  }
  else {
    const type = f.t === 'date' ? 'date' : f.t === 'tel' ? 'tel' : (f.t === 'money' || f.t === 'int') ? 'number' : 'text';
    const extra = f.t === 'money' ? ' min="0" step="0.01" inputmode="decimal" placeholder="$0.00"' : f.t === 'int' ? ' min="0" step="1" inputmode="numeric"' : f.t === 'list' ? ` list="dl-${f.list}" autocomplete="off"` : '';
    h = `<input id="${id}" name="${f.k}" type="${type}"${extra}${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}>`;
  }
  return `<div class="fld" data-k="${f.k}"><label for="${id}">${f.l}</label>${h}${f.help ? `<small class="help">${f.help}</small>` : ''}</div>`;
}
const formVals = fm => Object.fromEntries([...fm.elements].filter(e => e.name).map(e => [e.name, e.value]));
function applyShow(c, fm) {
  const o = formVals(fm);
  for (const f of F[c].f) {
    const box = fm.querySelector(`[data-k="${f.k}"]`); if (!box) continue;
    let vis = f.show ? f.show(o) : true;
    if (f.onlyNew && editing[c] && fm.id === 'f-' + c) vis = false;
    if (f.onlyEdit && !(editing[c] && fm.id === 'f-' + c)) vis = false;
    box.hidden = !vis;
  }
  fotoSync(fm);
}
// Foto: se achica en el teléfono (máx. 480 px) y se guarda junto con el producto.
function fotoSync(fm) {
  for (const b of fm.querySelectorAll('.fotobox')) {
    const v = $('input[type=hidden]', b).value, img = $('.fprev', b);
    img.hidden = !v; if (v) img.src = v; else img.removeAttribute('src');
    $('.fnone', b).hidden = !!v; $('[data-fotox]', b).hidden = !v;
    $('label', b).firstChild.textContent = v ? 'Cambiar foto' : 'Elegir foto';
  }
}
function fotoLoad(file) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const s = Math.min(1, 480 / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement('canvas');
      cv.width = Math.round(im.naturalWidth * s); cv.height = Math.round(im.naturalHeight * s);
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url); ok(cv.toDataURL('image/jpeg', 0.72));
    };
    im.onerror = () => { URL.revokeObjectURL(url); ko(new Error('img')); };
    im.src = url;
  });
}

function buildForms() {
  for (const c in F) {
    const slot = $(`[data-form="${c}"]`); if (!slot) continue;
    slot.innerHTML = `<div class="card"><h2 id="h-${c}">${F[c].title}</h2><form id="f-${c}" novalidate>${F[c].f.map(f => fieldHTML(c, f)).join('')}
      <div class="hint" id="hint-${c}"></div>
      <div class="btns"><button class="btn pri" type="submit" id="b-${c}">Guardar</button><button class="btn" type="button" data-cancel="${c}" hidden>Cancelar</button></div></form></div>`;
    const t = $(`[data-table="${c}"]`);
    if (t) t.innerHTML = `<div class="card">${c === 'pagos' ? '<h3>Pagos a Terramar</h3>' : c === 'entradas' ? '<h3>Pedidos recibidos</h3>' : ''}<div class="tools"><input type="search" placeholder="Buscar…" data-q="${c}" aria-label="Buscar ${F[c].many}"><button class="btn" type="button" data-csv="${c}">Descargar CSV</button></div><div id="t-${c}" class="scroll"></div></div>`;
  }
}

function prodOptions(sel) {
  const list = [...S.productos].sort(byName);
  return `<option value="">${list.length ? 'Elegir producto…' : 'Primero agrega productos'}</option>` +
    list.map(p => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.nombre)}${p.codigo ? ' · ' + esc(p.codigo) : ''}</option>`).join('');
}
// Lista compacta de productos (venta o pedido). Cada línea guarda producto, cantidad y precio;
// en ventas también el costo de ese momento (data-co), para que la ganancia no cambie si luego cambia el costo.
const readLines = fm => $$('.plist li[data-pid]', fm).map(li => ({ productoId: li.dataset.pid, cantidad: num(li.dataset.q), precio: r2(li.dataset.c), costo: li.dataset.co !== undefined && li.dataset.co !== '' ? r2(li.dataset.co) : r2(li.dataset.c), catalogo: r2(li.dataset.pc) }));
const readItems = readLines;
// ¿El precio de catálogo de esta línea es distinto al guardado en Productos? (entonces se actualizará al guardar)
const precioNuevo = l => l.catalogo > 0 && l.catalogo !== r2(byId('productos', l.productoId)?.precio);
// Piezas disponibles para vender (si estás editando una venta, cuentan las que ya tenía).
const stockVenta = pid => (C.stock?.[pid] || 0) + (editing.ventas ? sum(items(byId('ventas', editing.ventas)).filter(i => i.productoId === pid), i => i.cantidad) : 0);
function renderLines(box, lines) {
  const ul = $('#' + box.id + '-list'), venta = box.dataset.kind === 'venta', need = {};
  ul.innerHTML = lines.length ? lines.map(l => {
    need[l.productoId] = (need[l.productoId] || 0) + l.cantidad;
    const tag = venta ? (need[l.productoId] > stockVenta(l.productoId) ? ' <span class="pill p-acc" title="No tienes suficientes piezas: hay que pedirlo a Terramar">Hay que pedirlo</span>' : '')
      : precioNuevo(l) ? ` <span class="pill p-info" title="Al guardar, este será su nuevo precio de catálogo">nuevo ${money(l.catalogo)}</span>` : '';
    return `<li data-pid="${esc(l.productoId)}" data-q="${l.cantidad}" data-c="${l.precio}" data-pc="${l.catalogo || ''}"${venta ? ` data-co="${l.costo ?? ''}"` : ''}><span class="grow pl-n">${esc(pName(l.productoId))}${tag}</span><span class="n pl-q">${int(l.cantidad)} × ${money(l.precio)}</span><button class="btn sm del pl-x" type="button" data-rmline aria-label="Quitar ${esc(pName(l.productoId))}">✕</button></li>`;
  }).join('') : `<li class="empty pl-empty">Todavía no agregas productos a ${venta ? 'esta venta' : 'este pedido'}.</li>`;
}
function addLine(box) {
  const fm = box.closest('form'), venta = box.dataset.kind === 'venta', pid = $('.ad-p', box).value, q = Math.round(num($('.ad-q', box).value)), c = r2($('.ad-r', box).value), pc = venta ? 0 : r2($('.ad-pc', box).value);
  if (!pid) { toast('Elige un producto.', 'warn'); $('.ad-p', box).focus(); return false; }
  if (q <= 0) { toast(`${venta ? 'La cantidad debe' : 'Las piezas deben'} ser 1 o más.`, 'warn'); return false; }
  const co = venta ? r2(byId('productos', pid)?.costo) : c;
  const lines = readLines(fm), same = lines.find(l => l.productoId === pid && l.precio === c && l.catalogo === pc && l.costo === co);
  if (same) same.cantidad += q; else lines.push({ productoId: pid, cantidad: q, precio: c, catalogo: pc, costo: co });
  renderLines(box, lines);
  $('.ad-p', box).value = ''; $('.ad-q', box).value = 1; $('.ad-r', box).value = ''; if ($('.ad-pc', box)) $('.ad-pc', box).value = '';
  if (venta) autoEntrega();
  return true;
}

function resetForm(c) {
  const fm = $('#f-' + c); if (!fm) return;
  fm.reset(); editing[c] = null; fm.dataset.touched = '';
  for (const f of F[c].f) if (f.t === 'date') fm.elements[f.k].value = today(); else if (f.t === 'photo') fm.elements[f.k].value = '';
  const fi = F[c].f.find(f => f.t === 'items');
  if (fi) renderLines($(`#${c}-items`), []);
  $('#h-' + c).textContent = F[c].title; $('#b-' + c).textContent = F[c].saveLbl || 'Guardar';
  fm.querySelector('[data-cancel]').hidden = true;
  applyShow(c, fm); hints();
}
function startEdit(c, id) {
  const x = byId(c, id); if (!x) return;
  const tab = c === 'pagos' || c === 'regalos' ? 'entradas' : c;
  go(tab); if (tab === 'entradas') sub(c === 'regalos' ? 'regalos' : 'compras');
  const fm = $('#f-' + c); editing[c] = id;
  for (const f of F[c].f) {
    if (f.onlyNew) continue;
    if (f.t === 'items') { const box = $(`#${c}-items`); $$('input', box).forEach(i => i.value = i.classList.contains('ad-q') ? 1 : ''); $('.ad-p', box).value = ''; renderLines(box, items(x).map(i => ({ ...i, cantidad: num(i.cantidad), precio: r2(i.precio), costo: i.costo ?? r2(byId('productos', i.productoId)?.costo) }))); continue; }
    const el = fm.elements[f.k]; el.value = x[f.k] ?? (f.t === 'opt' ? f.opts[0] : '');
    if ((f.t === 'money' || f.t === 'int') && !num(x[f.k]) && !f.req) el.value = '';
  }
  fm.dataset.touched = '1';
  $('#h-' + c).textContent = 'Editar ' + F[c].one; $('#b-' + c).textContent = 'Guardar cambios';
  fm.querySelector('[data-cancel]').hidden = false;
  applyShow(c, fm); hints();
  fm.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function readForm(c, fm) {
  const o = {}, vals = formVals(fm);
  for (const f of F[c].f) {
    if (f.t === 'items') { o.items = readLines(fm).map(({ productoId, cantidad, precio, costo, catalogo }) => f.kind === 'compra' ? { productoId, cantidad, precio, costo, catalogo } : { productoId, cantidad, precio, costo }); continue; }
    let v = (fm.elements[f.k]?.value || '').trim();
    if (f.show && !f.show(vals)) v = '';
    if (f.t === 'money') v = r2(v); else if (f.t === 'int') v = Math.round(num(v));
    o[f.k] = v;
  }
  return o;
}

function save(c, fm, { quick = false } = {}) {
  // Si dejaste un producto elegido sin tocar "Agregar al pedido", se agrega solo antes de guardar.
  if ((c === 'entradas' && !editing[c]) || (c === 'ventas' && !quick)) { const ad = $(`#${c}-items`); if ($('.ad-p', ad).value && !addLine(ad)) return null; }
  const o = readForm(c, fm);
  const isEdit = !quick && !!editing[c];
  const bad = F[c].f.find(f => f.req && !(f.onlyEdit && !isEdit) && !(f.onlyNew && isEdit) && (f.t === 'money' || f.t === 'int' ? o[f.k] <= 0 : !o[f.k]));
  if (bad) { toast(`Falta: ${bad.l}.`, 'warn'); fm.elements[bad.k]?.focus(); return null; }
  if (c === 'entradas' && !isEdit) {
    // Un pedido con varios productos: se guarda una compra por producto, todas con la misma fecha y nombre de pedido.
    const its = o.items;
    if (!its.length) { toast('Agrega al menos un producto al pedido.', 'warn'); return null; }
    if (its.some(i => i.cantidad <= 0)) { toast('Revisa las piezas: deben ser 1 o más.', 'warn'); return null; }
    const now = Date.now(), ops = its.map((i, k) => ({ t: 'set', c: 'entradas', id: store.newId('entradas'), data: { fecha: o.fecha, productoId: i.productoId, cantidad: i.cantidad, costo: i.precio, precioCat: i.catalogo || r2(byId('productos', i.productoId)?.precio), pagado: 0, nota: o.nota, creado: now + k } }));
    // Precios nuevos del catálogo: se actualiza el producto (precio y costo) para las siguientes ventas y pedidos.
    // Lo ya registrado no cambia porque cada compra y cada venta guarda su propio precio.
    const upd = {};
    for (const i of its) if (precioNuevo(i)) upd[i.productoId] = { precio: i.catalogo, costo: i.precio };
    for (const [pid, d] of Object.entries(upd)) ops.push({ t: 'update', c: 'productos', id: pid, data: d });
    if (o.pagoPedido > 0) ops.push({ t: 'set', c: 'pagos', id: store.newId('pagos'), data: { fecha: o.fecha, monto: o.pagoPedido, metodo: 'Transferencia', nota: 'Pago de ' + (o.nota || 'pedido del ' + fdate(o.fecha)), creado: now + its.length } });
    commit(ops);
    const pz = sum(its, i => i.cantidad);
    const nu = Object.keys(upd).length;
    toast(`Pedido guardado: ${its.length} producto${its.length === 1 ? '' : 's'}, ${int(pz)} pieza${pz === 1 ? '' : 's'}.${nu ? ` Se actualizó el precio de ${nu} producto${nu === 1 ? '' : 's'}.` : ''}`);
    resetForm(c); return ops[0].id;
  }
  if (c === 'entradas') { delete o.items; delete o.pagoPedido; }
  if (c === 'ventas') {
    if (!o.items.length) { toast('Agrega al menos un producto a la venta.', 'warn'); return null; }
    if (o.items.some(i => i.cantidad <= 0)) { toast('Revisa las cantidades: deben ser 1 o más.', 'warn'); return null; }
  }
  // Cuenta abierta: no se puede usar más dinero del que la clienta tiene guardado.
  const disp = (cid, exceptId) => { const k = C.cl[cid]?.cuenta || 0, prev = exceptId && byId('abonos', exceptId); return k + (prev && esUso(prev) ? num(prev.monto) : 0) - (prev && esDep(prev) ? num(prev.monto) : 0); };
  if (c === 'abonos') {
    if (esUso(o) && esDep(o)) { toast('Para guardar dinero en su cuenta elige cómo te pagó (efectivo, transferencia…).', 'warn'); return null; }
    if (esUso(o) && o.monto > disp(o.clienteId, !quick && editing[c]) + 0.005) { toast(`Solo tiene ${money(Math.max(0, disp(o.clienteId, !quick && editing[c])))} en su cuenta abierta.`, 'warn'); return null; }
  }
  if (c === 'ventas' && !(!quick && editing[c]) && num(o.inicial) > 0 && o.metodoIni === USO && o.inicial > disp(o.clienteId) + 0.005) { toast(`Solo tiene ${money(Math.max(0, disp(o.clienteId)))} en su cuenta abierta.`, 'warn'); return null; }
  if (c === 'regalos' && !o.productoId && !o.descripcion) { toast('Elige el producto o escribe qué te regalaron.', 'warn'); return null; }
  const id = (!quick && editing[c]) || store.newId(c);
  const ini = o.inicial || 0, metIni = o.metodoIni || 'Efectivo';
  delete o.inicial; delete o.metodoIni;
  const ops = []; let extraMsg = '';
  if (!quick && editing[c]) { o.creado = byId(c, id)?.creado || Date.now(); ops.push({ t: 'set', c, id, data: o, merge: true }); }
  else {
    o.creado = Date.now(); ops.push({ t: 'set', c, id, data: o });
    if (c === 'ventas' && ini > 0) {
      // Si te dio más de lo que cuesta, lo que sobra se guarda en su cuenta abierta.
      const t = vTotal(o), pago = Math.min(ini, t), sobra = metIni === USO ? 0 : r2(ini - t);
      if (pago > 0) ops.push({ t: 'set', c: 'abonos', id: store.newId('abonos'), data: { fecha: o.fecha, clienteId: o.clienteId, monto: r2(pago), metodo: metIni, destino: PAGAR, nota: 'Abono inicial', ventaId: id, creado: Date.now() + 1 } });
      if (sobra > 0.005) { ops.push({ t: 'set', c: 'abonos', id: store.newId('abonos'), data: { fecha: o.fecha, clienteId: o.clienteId, monto: sobra, metodo: metIni, destino: DEP, nota: 'Le sobró de la venta del ' + fdate(o.fecha), creado: Date.now() + 2 } }); extraMsg = ` Se guardaron ${money(sobra)} en su cuenta abierta.`; }
    }
  }
  const wasEdit = !quick && editing[c];
  commit(ops);
  const fem = ['venta', 'compra'].includes(F[c].one);
  toast(`${cap(F[c].one)} ${wasEdit ? 'actualizad' : 'guardad'}${fem ? 'a' : 'o'}.${extraMsg}`);
  if (!quick) resetForm(c);
  return id;
}
const cap = s => s[0].toUpperCase() + s.slice(1);

function remove(c, id) {
  const ops = [{ t: 'del', c, id }];
  if (c === 'clientes' && (S.ventas.some(v => v.clienteId === id) || S.abonos.some(a => a.clienteId === id))) return toast('No se puede borrar: este cliente tiene ventas o abonos. Bórralos primero.', 'warn');
  if (c === 'productos' && (S.ventas.some(v => items(v).some(i => i.productoId === id)) || S.entradas.some(e => e.productoId === id) || S.regalos.some(r => r.productoId === id))) return toast('No se puede borrar: este producto aparece en ventas, compras o regalos.', 'warn');
  if (c === 'productos') for (const l of S.lista) if (l.productoId === id) ops.push({ t: 'del', c: 'lista', id: l.id });
  if (c === 'ventas') for (const a of S.abonos) if (a.ventaId === id) ops.push({ t: 'del', c: 'abonos', id: a.id });
  commit(ops); toast('Registro borrado.');
  if (editing[c] === id) resetForm(c);
}

/* ============ Selectores y sugerencias ============ */
function fillSelects() {
  for (const c in F) for (const f of F[c].f) if (f.t === 'sel') {
    const el = $(`#${c}-${f.k}`); if (!el) continue; const v = el.value;
    const list = [...S[f.src]].sort(byName);
    el.innerHTML = `<option value="">${f.none || (list.length ? 'Elegir…' : 'Primero agrega ' + f.src)}</option>` + list.map(x => `<option value="${esc(x.id)}">${esc(x.nombre)}${x.codigo ? ' · ' + esc(x.codigo) : ''}</option>`).join('');
    el.value = v;
  }
  for (const s of $$('select.it-p, select.ad-p')) { const v = s.value; s.innerHTML = prodOptions(v); s.value = v; }
  { const s = $('#lista-prod'), v = s.value; s.innerHTML = prodOptions(v); s.value = v; }
  const camps = new Set([...S.ventas.map(v => v.campana), ...S.gastos.map(g => g.campana)].filter(Boolean));
  $('#dl-campanas').innerHTML = [...camps].sort().map(x => `<option value="${esc(x)}">`).join('');
  const cats = new Set(S.productos.map(p => p.catalogo).filter(Boolean));
  $('#dl-catalogos').innerHTML = [...cats].sort().map(x => `<option value="${esc(x)}">`).join('');
}

function hints() {
  const fv = $('#f-ventas'); if (!fv || !C.stock) return;
  const its = readLines(fv), adv = $('#ventas-items');
  { const pid = $('.ad-p', adv).value, qn = num($('.ad-q', adv).value), pr = num($('.ad-r', adv).value), st = stockVenta(pid) - sum(its.filter(i => i.productoId === pid), i => i.cantidad);
    $('.ad-sub', adv).innerHTML = pid ? `Subtotal <b>${money(qn * pr)}</b> · En stock: <b>${Math.max(0, st)}</b>${qn > st ? ' · <span class="bad">no alcanza, hay que pedirlo</span>' : ''}` : ''; }
  const t = sum(its, i => i.cantidad * i.precio), c = fv.elements.clienteId.value, h = [];
  if (its.length) h.push(`${its.length} producto${its.length === 1 ? '' : 's'} en esta venta`);
  if (t) h.push(`Total de la venta: <b>${money(t)}</b>`);
  if (c) h.push(`Saldo actual de ${esc(cName(c))}: <b>${money(C.cl[c]?.saldo || 0)}</b>`);
  if (c && (C.cl[c]?.cuenta || 0) > 0.005) h.push(`💰 Tiene <b class="pos">${money(C.cl[c].cuenta)}</b> en su cuenta abierta. Para usarlo, pon el abono inicial y elige “${USO}”.`);
  { const ini = num(fv.elements.inicial?.value); if (t && ini > t + 0.005 && fv.elements.metodoIni?.value !== USO && !editing.ventas) h.push(`Le sobran <b class="pos">${money(ini - t)}</b>: se guardarán en su cuenta abierta.`); }
  $('#hint-ventas').innerHTML = h.join('<br>');
  const fa = $('#f-abonos'), ca = fa.elements.clienteId.value, cu = C.cl[ca]?.cuenta || 0;
  $('#hint-abonos').innerHTML = ca ? (fa.elements.destino.value === DEP ? `Este dinero se guarda en su cuenta abierta y no paga ninguna venta todavía. Ahorita tiene: <b>${money(cu)}</b>.`
    : `${esc(cName(ca))} debe: <b>${money(C.cl[ca]?.saldo || 0)}</b>. El abono se descuenta de su venta más antigua.${cu > 0.005 ? `<br>💰 Tiene <b class="pos">${money(cu)}</b> en su cuenta abierta. Para usarlo elige método “${USO}”.` : ''}`) : '';
  const fen = $('#f-entradas'), fe = fen.elements;
  if (editing.entradas) {
    const pe = fe.productoId.value, tot = num(fe.cantidad.value) * num(fe.costo.value);
    $('#hint-entradas').innerHTML = [pe ? `Stock actual: <b>${C.stock[pe] || 0}</b>` : '', tot ? `Total de esta compra: <b>${money(tot)}</b>` : ''].filter(Boolean).join('<br>');
  } else {
    const its = readLines(fen), tot = sum(its, i => i.cantidad * i.precio), ad = $('#entradas-items');
    { const pid = $('.ad-p', ad).value, qn = num($('.ad-q', ad).value), co = num($('.ad-r', ad).value), ya = sum(its.filter(i => i.productoId === pid), i => i.cantidad), st = (C.stock[pid] || 0) + ya;
      $('.ad-sub', ad).innerHTML = pid ? `Subtotal <b>${money(qn * co)}</b> · Tienes: <b>${st}</b> → quedarás con <b>${st + qn}</b>` : ''; }
    const pz = sum(its, i => i.cantidad);
    $('#hint-entradas').innerHTML = its.length ? `Total del pedido: <b>${money(tot)}</b> · ${its.length} producto${its.length === 1 ? '' : 's'}, ${int(pz)} pieza${pz === 1 ? '' : 's'}` : '';
  }
  $('#hint-pagos').innerHTML = `Le debes a Terramar: <b>${money(C.deudaT)}</b>`;
}
function autoEntrega() {
  const f = $('#f-ventas'); if (editing.ventas || f.dataset.touched) return;
  const its = readItems(f); if (!its.length) return;
  const need = {}; for (const i of its) need[i.productoId] = (need[i.productoId] || 0) + i.cantidad;
  f.elements.entrega.value = Object.entries(need).every(([p, n]) => (C.stock[p] || 0) >= n) ? 'Entregado' : 'Por pedir a Terramar';
}

/* ============ Tablas ============ */
const waNum = t => { let d = String(t || '').replace(/\D/g, ''); if (d.length === 10) d = '52' + d; else if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3); return d; };
function waLink(x, saldo, label = 'WhatsApp') {
  const t = waNum(x?.telefono); if (!t) return '';
  const nombre = String(x.nombre || '').split(' ')[0];
  const m = saldo > 0.005
    ? `Hola ${nombre} 😊, te escribo para recordarte tu saldo pendiente de Terramar: ${money(saldo)}. Cuando puedas me avisas por aquí. ¡Muchas gracias!`
    : `Hola ${nombre} 😊`;
  return `<a class="btn sm wa" target="_blank" rel="noopener" href="https://wa.me/${t}?text=${encodeURIComponent(m)}">${label}</a>`;
}
const acts = (c, id, extra = '') => `${extra}<button class="btn sm" type="button" data-ed="${c}" data-id="${esc(id)}">Editar</button> <button class="btn sm del" type="button" data-del="${c}" data-id="${esc(id)}">Borrar</button>`;

function rows(c) {
  const s = C.stock, cl = C.cl;
  if (c === 'productos') return { h: ['#', 'Código', 'Producto', 'Catálogo', 'Costo', 'Precio', 'Ganancia', 'Stock'], n: [4, 5, 6, 7], r: [...S.productos].sort(byName).map((p, i) => {
    const st = s[p.id] || 0, gan = num(p.precio) - num(p.costo);
    const stH = isLow(p) ? `<span class="pill ${st <= 0 ? 'p-acc' : 'p-warn'}">${st}</span>` : st < 0 ? `<span class="pill p-acc" title="Vendido sin stock: falta que llegue">${st}</span>` : st;
    return { id: p.id, v: [i + 1, p.codigo, p.nombre, p.catalogo, r2(p.costo), r2(p.precio), r2(gan), st], h: [`<span class="muted">${i + 1}</span>`, esc(p.codigo), `<b>${esc(p.nombre)}</b>`, esc(p.catalogo), money(p.costo), money(p.precio), money(gan), stH] };
  }) };
  if (c === 'clientes') return { h: ['Cliente', 'WhatsApp', 'Compras', 'Comprado', 'Abonado', 'Saldo', 'Cuenta abierta'], n: [2, 3, 4, 5, 6], r: [...S.clientes].sort(byName).map(x => {
    const k = cl[x.id] || { vendido: 0, abonado: 0, saldo: 0, n: 0 };
    return { id: x.id, click: 1, extra: waLink(x, k.saldo) + ` <button class="btn sm" type="button" data-ver="${esc(x.id)}">Ver</button> `, v: [x.nombre, x.telefono, k.n, r2(k.vendido), r2(k.abonado), r2(k.saldo), r2(k.cuenta || 0)],
      h: [`<b>${esc(x.nombre)}</b>${x.nota ? `<br><span class="small muted">${esc(x.nota)}</span>` : ''}`, esc(x.telefono), k.n, money(k.vendido), money(k.abonado), k.saldo > 0.005 ? `<span class="neg">${money(k.saldo)}</span>` : k.saldo < -0.005 ? `<span class="pill p-ok">A favor ${money(-k.saldo)}</span>` : money(0), money(k.cuenta || 0)] };
  }) };
  if (c === 'ventas') return { h: ['Fecha', 'Cliente', 'Productos', 'Total', 'Le falta', 'Pago', 'Entrega', 'Origen'], n: [3, 4], r: [...S.ventas].sort(ord(0)).map(v => {
    const t = vTotal(v), p = C.vp[v.id] ?? t, e = payState(v), o = v.origen ? v.origen + (v.campana ? ' · ' + v.campana : '') : '';
    return { id: v.id, v: [fdate(v.fecha), cName(v.clienteId), vDesc(v), r2(t), r2(p), e, est(v), o], h: [fdate(v.fecha), esc(cName(v.clienteId)), esc(vDesc(v)), `<b>${money(t)}</b>`, p > 0.005 ? `<span class="neg">${money(p)}</span>` : money(0), `<span class="pill ${payPill(e)}">${e}</span>`, `<span class="pill ${estPill(est(v))}">${est(v)}</span>`, `<span class="small">${esc(o)}</span>`] };
  }) };
  if (c === 'abonos') return { h: ['Fecha', 'Cliente', 'Monto', 'Método', 'Para qué', 'Nota'], n: [2], r: [...S.abonos].sort(ord(0)).map(a => { const d = esDep(a) ? 'Guardado en su cuenta abierta' : esUso(a) ? 'Pagó con su cuenta abierta' : 'Pagar lo que debe'; return { id: a.id, v: [fdate(a.fecha), cName(a.clienteId), r2(a.monto), a.metodo, d, a.nota], h: [fdate(a.fecha), esc(cName(a.clienteId)), `<b>${money(a.monto)}</b>`, esc(a.metodo), d, esc(a.nota)] }; }) };
  if (c === 'entradas') return { h: ['Fecha', 'Producto', 'Piezas', 'Costo c/u', 'Total', 'Pagado', 'Nota'], n: [2, 3, 4, 5], r: [...S.entradas].sort(ord(0)).map(e => ({ id: e.id, v: [fdate(e.fecha), pName(e.productoId), num(e.cantidad), r2(e.costo), r2(eCosto(e)), r2(e.pagado), e.nota], h: [fdate(e.fecha), esc(pName(e.productoId)), num(e.cantidad), money(e.costo), `<b>${money(eCosto(e))}</b>`, money(e.pagado), esc(e.nota)] })) };
  if (c === 'pagos') return { h: ['Fecha', 'Monto', 'Método', 'Nota'], n: [1], r: [...S.pagos].sort(ord(0)).map(p => ({ id: p.id, v: [fdate(p.fecha), r2(p.monto), p.metodo, p.nota], h: [fdate(p.fecha), `<b>${money(p.monto)}</b>`, esc(p.metodo), esc(p.nota)] })) };
  if (c === 'regalos') return { h: ['Fecha', 'Regalo', 'Piezas', 'Valor c/u', 'Valor total', 'Nota'], n: [2, 3, 4], r: [...S.regalos].sort(ord(0)).map(r => ({ id: r.id, v: [fdate(r.fecha), rName(r), num(r.cantidad), r2(r.valor), r2(num(r.valor) * num(r.cantidad)), r.nota], h: [fdate(r.fecha), `<b>${esc(rName(r))}</b>${r.productoId ? '' : ' <span class="pill p-mute">Fuera de tu lista</span>'}`, num(r.cantidad), money(r.valor), `<b>${money(num(r.valor) * num(r.cantidad))}</b>`, esc(r.nota)] })) };
  if (c === 'gastos') return { h: ['Fecha', 'Categoría', 'Campaña', 'Monto', 'Mensajes', 'Resultados', 'Nota'], n: [3, 4, 5], r: [...S.gastos].sort(ord(0)).map(g => ({ id: g.id, v: [fdate(g.fecha), g.categoria, g.campana, r2(g.monto), num(g.mensajes) || '', num(g.resultados) || '', g.nota], h: [fdate(g.fecha), `<span class="pill ${g.categoria === 'Meta Ads' ? 'p-info' : 'p-mute'}">${esc(g.categoria)}</span>`, esc(g.campana), `<b>${money(g.monto)}</b>`, num(g.mensajes) || '', num(g.resultados) || '', esc(g.nota)] })) };
}
function tableHTML(R, list, act) {
  return `<table class="stack"><thead><tr>${R.h.map((h, i) => `<th class="${R.n.includes(i) ? 'n' : ''}">${h}</th>`).join('')}${act ? '<th></th>' : ''}</tr></thead><tbody>${list.map(r => `<tr>${r.h.map((h, i) => `<td class="${R.n.includes(i) ? 'n' : ''}" data-l="${esc(R.h[i])}">${h ?? ''}</td>`).join('')}${act ? `<td class="a">${act(r)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}
// Mercancía recibida agrupada por pedido (mismo "Nombre del pedido"; si no tiene, por fecha). Se abre para ver los productos.
const openG = new Set();
const eCat = e => num(e.cantidad) * num(e.precioCat ?? byId('productos', e.productoId)?.precio);
function entradasTable() {
  const el = $('#t-entradas'); if (!el) return;
  const R = rows('entradas'), t = (q.entradas || '').toLowerCase().trim();
  if (!R.r.length) { el.innerHTML = '<p class="empty">Todavía no hay compras. Usa el formulario para registrar tu primer pedido.</p>'; return; }
  const E = Object.fromEntries(S.entradas.map(e => [e.id, e])), G = new Map();
  for (const r of R.r) {
    const e = E[r.id], nm = String(e.nota || '').trim(), k = nm ? 'n:' + nm.toLowerCase() : 'f:' + e.fecha;
    if (!G.has(k)) G.set(k, { k, name: nm || 'Compra del ' + fdate(e.fecha), rows: [], E: [] });
    G.get(k).rows.push(r); G.get(k).E.push(e);
  }
  const R2 = { h: R.h.slice(0, 6), n: R.n };
  const html = [...G.values()].map(g => {
    const match = !t || g.name.toLowerCase().includes(t), list = match ? g.rows : g.rows.filter(r => r.v.join(' ').toLowerCase().includes(t));
    if (!list.length) return '';
    const fs = [...new Set(g.E.map(e => e.fecha))].sort(), fe = fs.length > 1 ? `${fdate(fs[0])} – ${fdate(fs[fs.length - 1])}` : fdate(fs[0]);
    const np = new Set(g.E.map(e => e.productoId)).size, pz = sum(g.E, e => e.cantidad), co = sum(g.E, eCosto), ca = sum(g.E, eCat);
    return `<details class="ped" data-g="${esc(g.k)}"${t || openG.has(g.k) ? ' open' : ''}><summary>
      <span class="ped-h"><b>${esc(g.name)}</b><small class="muted">${fe} · ${np} producto${np === 1 ? '' : 's'} · ${int(pz)} pieza${pz === 1 ? '' : 's'}</small></span>
      <span class="ped-n"><span><small>Te costó</small><b>${money(co)}</b></span><span><small>A precio de catálogo</small><b>${money(ca)}</b></span><span><small>Ganarías</small><b class="pos">${money(ca - co)}</b></span></span>
      <span class="ped-v" aria-hidden="true">Ver productos</span></summary>
      <div class="ped-t"><div class="tiles">${list.map(r => { const e = E[r.id]; return tile({ attr: `data-entrada="${esc(e.id)}"`, cls: 'tl-v', ico: fotoHTML(byId('productos', e.productoId) || { nombre: pName(e.productoId) }, ''), t: esc(pName(e.productoId)), big: money(eCosto(e)), s: `${num(e.cantidad)} pza${num(e.cantidad) === 1 ? '' : 's'} × ${money(e.costo)}` }); }).join('')}</div></div></details>`;
  }).join('');
  el.innerHTML = html || `<p class="empty">Nada coincide con “${esc(q.entradas)}”.</p>`;
}
// Productos en mosaico: foto, nombre y existencias. Al tocarlo se abre con todos sus datos.
const stockTxt = st => st < 0 ? `Faltan ${-st}` : st <= 0 ? 'Agotado' : `${st} pza${st === 1 ? '' : 's'}`;
const stockCls = p => { const st = C.stock[p.id] || 0; return st <= 0 ? 'p-acc' : isLow(p) ? 'p-warn' : 'p-ok'; };
const fotoHTML = (p, cls) => p.foto ? `<img class="${cls}" src="${esc(p.foto)}" alt="" loading="lazy">` : `<span class="${cls} sinfoto" aria-hidden="true">${esc((String(p.nombre || '?').trim()[0] || '?').toUpperCase())}</span>`;
// Piezas vendidas de cada producto (sumando todas las ventas).
const vendidas = () => { const m = {}; for (const v of S.ventas) for (const i of items(v)) m[i.productoId] = (m[i.productoId] || 0) + num(i.cantidad); return m; };
function productosGrid() {
  const el = $('#t-productos'); if (!el) return;
  const R = rows('productos'), t = (q.productos || '').toLowerCase().trim(), list = R.r.filter(r => !t || r.v.join(' ').toLowerCase().includes(t));
  if (!R.r.length) { el.innerHTML = '<p class="empty">Todavía no hay productos. Usa el formulario para agregar el primero.</p>'; return; }
  if (!list.length) { el.innerHTML = `<p class="empty">Nada coincide con “${esc(q.productos)}”.</p>`; return; }
  const vend = vendidas();
  const card = r => { const p = byId('productos', r.id), st = C.stock[p.id] || 0, nv = vend[p.id] || 0;
    return `<button class="mos" type="button" data-prod="${esc(p.id)}">${fotoHTML(p, 'mos-f')}
      <span class="mos-b"><span class="mos-n">${esc(p.nombre)}</span><span class="pill ${stockCls(p)}">${stockTxt(st)}</span></span>
      <span class="mos-p">${money(p.precio)}${p.codigo ? ` · <span class="muted">${esc(p.codigo)}</span>` : ''}</span>
      <span class="mos-v">${nv ? `Vendido <b>${int(nv)}</b> ${nv === 1 ? 'vez' : 'veces'}` : 'Sin ventas todavía'}</span></button>`; };
  const hay = r => (C.stock[r.id] || 0) > 0;
  el.innerHTML = splitHTML(list.filter(hay).map(card), list.filter(r => !hay(r)).map(card), { l: '✅ En stock', r: '⛔ Agotados', lc: 'ok', rc: 'bad', grid: 'mosaico', le: 'Nada en stock.', re: 'Nada agotado.' });
}
// Dos lados: a la izquierda lo verde (o lo pendiente, según la pestaña) y a la derecha lo otro. En el celular quedan uno arriba del otro.
function splitHTML(L, R, o) {
  const side = (arr, lbl, cls, emp) => `<div class="sp-c"><h4 class="sp-h ${cls}">${lbl} <span>${arr.length}</span></h4>${arr.length ? `<div class="${o.grid || 'tiles'}">${arr.join('')}</div>` : `<p class="empty small">${emp}</p>`}</div>`;
  return `<div class="split">${side(L, o.l, o.lc, o.le)}${side(R, o.r, o.rc, o.re)}</div>`;
}
function verProducto(id) {
  const p = byId('productos', id); if (!p) return;
  const st = C.stock[id] || 0, gan = num(p.precio) - num(p.costo);
  const vend = vendidas()[id] || 0;
  const comp = sum(S.entradas.filter(e => e.productoId === id), e => e.cantidad);
  const row = (l, v) => `<li><span class="muted">${l}</span><span class="n">${v}</span></li>`;
  openDlg(p.nombre, `<div class="pv">${fotoHTML(p, 'pv-f')}<div class="pv-s"><span class="pill ${stockCls(p)}">${st < 0 ? stockTxt(st) : st <= 0 ? 'Agotado' : `Tienes ${st} pieza${st === 1 ? '' : 's'}`}</span>${st < 0 ? '<small class="muted">Vendiste más de lo que tienes: falta que llegue.</small>' : ''}</div></div>
    <ul class="list">${row('Código', esc(p.codigo || '—'))}${row('Catálogo', esc(p.catalogo || '—'))}${row('Precio de venta', `<b>${money(p.precio)}</b>`)}${row('Costo', money(p.costo))}${row('Ganas por pieza', `<b class="pos">${money(gan)}</b>`)}${row('Piezas que te han llegado', int(comp))}${row('Piezas vendidas', int(vend))}</ul>
    <div class="btns">${acts('productos', id)}</div>`);
}
// Fotos de los productos de una venta (máximo 3, encimadas) y foto chica junto a un nombre.
const fotosDe = pids => { const u = [...new Set(pids)], P = u.slice(0, 3).map(id => fotoHTML(byId('productos', id) || { nombre: '?' }, '')); if (u.length > 3) P.push(`<span class="mas">+${u.length - 3}</span>`); return `<span class="fotos" aria-hidden="true">${P.join('')}</span>`; };
const conFoto = (pid, html) => `<span class="th-w">${fotoHTML(byId('productos', pid) || { nombre: '?' }, 'th')}<span>${html}</span></span>`;
const vResumen = v => { const its = items(v), n = sum(its, i => i.cantidad); return its.length ? `${esc(pName(its[0].productoId))}${its.length > 1 ? ` y ${its.length - 1} más` : ''} · ${int(n)} pza${n === 1 ? '' : 's'}` : 'Sin productos'; };
function ventaCard(v, { pago = true } = {}) {
  // Mosaico de la venta: foto del producto (y "+N" si lleva más), clienta en grande, total y estado.
  const e = payState(v), s = est(v), falta = C.vp[v.id] ?? vTotal(v), ps = [...new Set(items(v).map(i => i.productoId))];
  const ico = fotoHTML(byId('productos', ps[0]) || { nombre: '?' }, '') + (ps.length > 1 ? `<span class="tl-n">+${ps.length - 1}</span>` : '');
  return tile({ attr: `data-venta="${esc(v.id)}"`, cls: 'tl-v', ico, t: esc(cName(v.clienteId)), big: `${money(vTotal(v))}${falta > 0.005 ? `<small class="tl-f">Falta ${money(falta)}</small>` : ''}`, s: `${fdate(v.fecha)} · ${vResumen(v)}`,
    pills: `<span class="pill ${estPill(s)}">${s}</span>${pago ? `<span class="pill ${payPill(e)}">${e}</span>` : ''}` });
}
function ventasCards() {
  const el = $('#t-ventas'); if (!el) return;
  const R = rows('ventas'), t = (q.ventas || '').toLowerCase().trim(), list = R.r.filter(r => !t || r.v.join(' ').toLowerCase().includes(t));
  el.innerHTML = !R.r.length ? '<p class="empty">Todavía no hay ventas. Usa el formulario para agregar la primera.</p>'
    : !list.length ? `<p class="empty">Nada coincide con “${esc(q.ventas)}”.</p>`
    : (() => { const V = list.map(r => byId('ventas', r.id)), lista = v => payState(v) === 'Pagada' && est(v) === 'Entregado';
      return splitHTML(V.filter(v => !lista(v)).map(v => ventaCard(v)), V.filter(lista).map(v => ventaCard(v)), { l: '⏳ Les falta algo', r: '✅ Pagadas y entregadas', lc: 'bad', rc: 'ok', le: 'Ninguna pendiente. ¡Todo al día!', re: 'Todavía ninguna completa.' }); })();
}
function verVenta(id) {
  const v = byId('ventas', id); if (!v) return;
  const e = payState(v), s = est(v), t = vTotal(v), falta = C.vp[id] ?? t, nx = nextEst(s), cl = byId('clientes', v.clienteId);
  const row = (l, x) => `<li><span class="muted">${l}</span><span class="n">${x}</span></li>`;
  openDlg(cName(v.clienteId), `<div class="vc-p" style="margin-bottom:8px"><span class="pill ${estPill(s)}">${s}</span><span class="pill ${payPill(e)}">${e}</span></div>
    <ul class="list pv-items">${items(v).map(i => { const p = byId('productos', i.productoId) || { nombre: pName(i.productoId) }; return `<li>${fotoHTML(p, 'th lg')}<span class="grow"><b>${esc(pName(i.productoId))}</b><br><span class="small muted">${num(i.cantidad)} × ${money(i.precio)}</span></span><span class="n"><b>${money(num(i.cantidad) * num(i.precio))}</b></span></li>`; }).join('')}</ul>
    <ul class="list" style="margin-top:8px">${row('Fecha', fdate(v.fecha))}${row('Total', `<b>${money(t)}</b>`)}${row('Ya pagó', money(t - Math.max(0, falta)))}${row('Le falta', falta > 0.005 ? `<span class="neg">${money(falta)}</span>` : money(0))}${row('Ganancia', `<b class="pos">${money(t - vCosto(v))}</b>`)}${v.origen ? row('Origen', esc(v.origen)) : ''}${v.campana ? row('Campaña', esc(v.campana)) : ''}${v.nota ? row('Nota', esc(v.nota)) : ''}</ul>
    <div class="btns">${nx ? `<button class="btn sm pri" type="button" data-adv="${esc(id)}" data-to="${nx}">Marcar: ${nx}</button>` : ''}${falta > 0.005 ? `<button class="btn sm" type="button" data-newab="${esc(v.clienteId)}">Registrar abono</button>` : ''}${cl ? waLink(cl, C.cl[cl.id]?.saldo || 0) : ''}${acts('ventas', id)}</div>`);
}
function verEntrada(id) {
  const e = byId('entradas', id); if (!e) return;
  const p = byId('productos', e.productoId) || { nombre: pName(e.productoId) };
  const row = (l, x) => `<li><span class="muted">${l}</span><span class="n">${x}</span></li>`;
  openDlg(pName(e.productoId), `<div class="pv">${fotoHTML(p, 'pv-f')}<div class="pv-s"><span class="pill p-info">${num(e.cantidad)} pieza${num(e.cantidad) === 1 ? '' : 's'}</span>${e.nota ? `<small class="muted">${esc(e.nota)}</small>` : ''}</div></div>
    <ul class="list">${row('Fecha', fdate(e.fecha))}${row('Costo por pieza', money(e.costo))}${row('Total', `<b>${money(eCosto(e))}</b>`)}${row('Precio de catálogo', money(e.precioCat ?? p.precio))}${row('Ganarías', `<b class="pos">${money(eCat(e) - eCosto(e))}</b>`)}${num(e.pagado) ? row('Ya pagado', money(e.pagado)) : ''}</ul>
    <div class="btns">${acts('entradas', id)}</div>`);
}
/* ============ Mosaicos para todas las listas ============ */
// Cada registro es un cuadrito con icono, lo importante en grande, y al tocarlo se abre todo su detalle.
const gIco = x => x?.genero === 'Hombre' ? '👨' : x?.genero === 'Mujer' ? '👩' : '👤';
const catIco = c => ({ 'Meta Ads': '📣', 'Envíos': '🚚', 'Empaque': '🎁' }[c] || '🧾');
const abIco = a => esDep(a) ? '💰' : esUso(a) ? '🔁' : '💵';
const abTag = a => esDep(a) ? '<span class="pill p-info">Guardado en su cuenta</span>' : esUso(a) ? '<span class="pill p-mute">Pagado con su cuenta</span>' : '';
const tile = ({ attr, ico, t, big, bigCls = '', s = '', pills = '', cls = '' }) => `<button class="tl ${cls}" type="button" ${attr}><span class="tl-i" aria-hidden="true">${ico}</span><span class="tl-t">${t}</span>${big != null ? `<span class="tl-m ${bigCls}">${big}</span>` : ''}${s ? `<span class="tl-s">${s}</span>` : ''}${pills ? `<span class="tl-p">${pills}</span>` : ''}</button>`;
function clienteTile(x) {
  const k = C.cl[x.id] || { saldo: 0, n: 0, cuenta: 0 };
  const big = k.saldo > 0.005 ? `Debe ${money(k.saldo)}` : k.saldo < -0.005 ? `A favor ${money(-k.saldo)}` : 'Al corriente';
  return tile({ attr: `data-ver="${esc(x.id)}"`, cls: 'tl-cli', ico: gIco(x), t: esc(x.nombre), big, bigCls: k.saldo > 0.005 ? 'neg' : 'pos', s: `${k.n} compra${k.n === 1 ? '' : 's'}${x.telefono ? ' · ' + esc(x.telefono) : ''}`, pills: k.cuenta > 0.005 ? `<span class="pill p-info">💰 Cuenta abierta ${money(k.cuenta)}</span>` : '' });
}
const TILE = {
  clientes: x => clienteTile(x),
  abonos: a => tile({ attr: `data-fila="abonos" data-id="${esc(a.id)}"`, ico: abIco(a), t: esc(cName(a.clienteId)), big: money(a.monto), bigCls: esDep(a) ? '' : 'pos', s: `${fdate(a.fecha)}${a.metodo && !esUso(a) ? ' · ' + esc(a.metodo) : ''}`, pills: abTag(a) }),
  pagos: p => tile({ attr: `data-fila="pagos" data-id="${esc(p.id)}"`, ico: '🏦', t: money(p.monto), s: `${fdate(p.fecha)}${p.metodo ? ' · ' + esc(p.metodo) : ''}${p.nota ? '<br>' + esc(p.nota) : ''}` }),
  regalos: r => tile({ attr: `data-fila="regalos" data-id="${esc(r.id)}"`, ico: r.productoId ? fotoHTML(byId('productos', r.productoId) || { nombre: rName(r) }, '') : '🎀', t: esc(rName(r)), big: money(num(r.valor) * num(r.cantidad)), bigCls: 'pos', s: `${num(r.cantidad)} pza${num(r.cantidad) === 1 ? '' : 's'} · ${fdate(r.fecha)}`, pills: r.productoId ? '' : '<span class="pill p-mute">Fuera de tu lista</span>' }),
  gastos: g => tile({ attr: `data-fila="gastos" data-id="${esc(g.id)}"`, ico: catIco(g.categoria), t: esc(g.categoria || 'Gasto'), big: money(g.monto), bigCls: 'neg', s: `${fdate(g.fecha)}${g.campana ? ' · ' + esc(g.campana) : ''}` }),
};
function tilesTable(c) {
  const el = $('#t-' + c); if (!el) return;
  const R = rows(c), t = (q[c] || '').toLowerCase().trim(), list = R.r.filter(r => !t || r.v.join(' ').toLowerCase().includes(t));
  el.innerHTML = !R.r.length ? `<p class="empty">Todavía no hay ${F[c].many}. Usa el formulario para agregar el primero.</p>`
    : !list.length ? `<p class="empty">Nada coincide con “${esc(q[c])}”.</p>`
    : c === 'clientes' ? (() => { const X = list.map(r => byId(c, r.id)), debe = x => (C.cl[x.id]?.saldo || 0) > 0.005;
      return splitHTML(X.filter(debe).map(TILE[c]), X.filter(x => !debe(x)).map(TILE[c]), { l: '🔴 Te deben', r: '✅ Al corriente', lc: 'bad', rc: 'ok', le: 'Nadie te debe. ¡Todo cobrado!', re: 'Nadie está al corriente todavía.' }); })()
    : `<div class="tiles">${list.map(r => TILE[c](byId(c, r.id))).join('')}</div>`;
}
// Detalle de cualquier registro: todos sus datos y los botones Editar / Borrar.
function verFila(c, id) {
  if (c === 'ventas') return verVenta(id);
  if (c === 'entradas') return verEntrada(id);
  if (c === 'clientes') return verCliente(id);
  const R = rows(c), r = R.r.find(x => x.id === id); if (!r) return;
  const x = byId(c, id), ico = c === 'abonos' ? abIco(x) : c === 'gastos' ? catIco(x.categoria) : c === 'pagos' ? '🏦' : '🎀';
  const title = c === 'abonos' ? 'Abono de ' + cName(x.clienteId) : c === 'pagos' ? 'Pago a Terramar' : c === 'gastos' ? 'Gasto: ' + (x.categoria || '') : rName(x);
  const head = c === 'regalos' && x.productoId ? `<div class="pv">${fotoHTML(byId('productos', x.productoId) || { nombre: rName(x) }, 'pv-f')}</div>` : `<div class="dl-ico" aria-hidden="true">${ico}</div>`;
  openDlg(title, `${head}${c === 'abonos' ? `<p>${abTag(x)}</p>` : ''}<ul class="list">${R.h.map((h, i) => r.h[i] !== '' && r.h[i] != null ? `<li><span class="muted">${h}</span><span class="n" style="white-space:normal;text-align:end">${r.h[i]}</span></li>` : '').join('')}</ul>
    <div class="btns">${c === 'abonos' ? `<button class="btn sm" type="button" data-ver="${esc(x.clienteId)}">Ver cliente</button>` : ''}${acts(c, id)}</div>`);
}

/* ============ Cuentas abiertas ============ */
function cuentaMovs(id) { return S.abonos.filter(a => a.clienteId === id && (esDep(a) || esUso(a))).sort(ord(0)); }
function cuentas() {
  const el = $('#t-cuentas'); if (!el) return;
  const L = S.clientes.filter(x => (C.cl[x.id]?.cuenta || 0) > 0.005 || cuentaMovs(x.id).length).sort((a, b) => (C.cl[b.id]?.cuenta || 0) - (C.cl[a.id]?.cuenta || 0) || byName(a, b));
  const tot = sum(S.clientes, x => Math.max(0, C.cl[x.id]?.cuenta || 0)), con = S.clientes.filter(x => (C.cl[x.id]?.cuenta || 0) > 0.005).length;
  $('#k-cuentas').innerHTML = [kpi('Dinero guardado de tus clientes', money(tot), { cls: tot > 0.005 ? 'good' : '', d: 'Es de ellos: se descuenta cuando te pidan algo' }), kpi('Clientes con cuenta abierta', int(con))].join('');
  el.innerHTML = L.length ? `<div class="tiles">${L.map(x => { const cu = C.cl[x.id]?.cuenta || 0; return tile({ attr: `data-cuenta="${esc(x.id)}"`, cls: 'tl-cli', ico: gIco(x), t: esc(x.nombre), big: money(cu), bigCls: cu > 0.005 ? 'pos' : 'muted', s: cu > 0.005 ? 'Tiene guardado' : 'Ya lo usó todo' }); }).join('')}</div>`
    : '<p class="empty">Nadie tiene cuenta abierta todavía. Cuando una clienta te deje dinero guardado, regístralo en <b>Abonos</b> eligiendo “Guardar en su cuenta abierta”, o pon en la venta un abono mayor al total.</p>';
}
function verCuenta(id) {
  const x = byId('clientes', id); if (!x) return;
  const k = C.cl[id] || { cuenta: 0, saldo: 0 }, M = cuentaMovs(id);
  openDlg('Cuenta abierta de ' + x.nombre, `<div class="kpis">${kpi('Tiene guardado', money(k.cuenta), { cls: k.cuenta > 0.005 ? 'good' : '' })}${kpi('Te debe', money(Math.max(0, k.saldo)), { cls: k.saldo > 0.005 ? 'hot' : '' })}</div>
    <div class="btns"><button class="btn sm pri" type="button" data-dep="${esc(id)}">💰 Guardar dinero</button>${k.cuenta > 0.005 ? `<button class="btn sm" type="button" data-uso="${esc(id)}">🔁 Usar para pagar</button>` : ''}<button class="btn sm" type="button" data-newsale="${esc(id)}">Nueva venta</button></div>
    <h3 style="margin-top:18px">Movimientos de su cuenta</h3>${M.length ? `<ul class="list">${M.map(a => `<li><span class="grow">${abIco(a)} ${fdate(a.fecha)} · ${esDep(a) ? 'Guardó' : 'Usó para pagar'}${a.nota ? '<br><span class="small muted">' + esc(a.nota) + '</span>' : ''}</span><span class="n ${esDep(a) ? 'pos' : 'neg'}">${esDep(a) ? '+' : '−'}${money(a.monto)}</span></li>`).join('')}</ul>` : '<p class="empty">Sin movimientos.</p>'}`);
}

function table(c) {
  if (c === 'entradas') return entradasTable();
  if (c === 'productos') return productosGrid();
  if (c === 'ventas') return ventasCards();
  if (TILE[c]) return tilesTable(c);
  const el = $('#t-' + c); if (!el) return;
  const R = rows(c), t = (q[c] || '').toLowerCase().trim(), list = R.r.filter(r => !t || r.v.join(' ').toLowerCase().includes(t));
  el.innerHTML = !R.r.length ? `<p class="empty">Todavía no hay ${F[c].many}. Usa el formulario para agregar el primero.</p>`
    : !list.length ? `<p class="empty">Nada coincide con “${esc(q[c])}”.</p>`
    : tableHTML(R, list, r => acts(c, r.id, r.extra || ''));
}

/* ============ Resumen ============ */
function kpi(label, value, { cls = '', d = '' } = {}) { return `<div class="kpi ${cls}"><small>${label}</small><strong>${value}</strong>${d ? `<span class="d">${d}</span>` : ''}</div>`; }
function resumen() {
  const ym = today().slice(0, 7);
  const vm = S.ventas.filter(v => String(v.fecha).startsWith(ym));
  const vend = sum(vm, vTotal), cob = sum(S.abonos.filter(a => cash(a) && String(a.fecha).startsWith(ym)), a => a.monto);
  const gm = S.gastos.filter(g => String(g.fecha).startsWith(ym));
  const meta = sum(gm.filter(g => g.categoria === 'Meta Ads'), g => g.monto), otros = sum(gm.filter(g => g.categoria !== 'Meta Ads'), g => g.monto);
  const neta = vend - sum(vm, vCosto) - meta - otros;
  const deuda = sum(Object.values(C.cl), k => Math.max(0, k.saldo));
  const pend = S.ventas.filter(v => est(v) !== 'Entregado').length;
  const low = S.productos.filter(isLow);
  const vTot = sum(S.ventas, vTotal), abTot = sum(S.abonos.filter(cash), a => a.monto);
  const metaTot = sum(S.gastos.filter(g => g.categoria === 'Meta Ads'), g => g.monto);
  const netaTot = vTot - sum(S.ventas, vCosto) - sum(S.gastos, g => g.monto);
  $('#k-mes').innerHTML = [
    kpi('Vendido', money(vend), { d: `${vm.length} venta${vm.length === 1 ? '' : 's'}` }),
    kpi('Te abonaron', money(cob)),
    kpi('Gasto en Meta Ads', money(meta)),
    kpi('Ganancia neta', money(neta), { cls: neta < 0 ? 'hot' : 'good', d: 'Ventas − costo − gastos' }),
  ].join('');
  $('#k-total').innerHTML = [
    kpi('Te falta cobrar', money(deuda), { cls: deuda > 0.005 ? 'hot' : '' }),
    kpi('Le debes a Terramar', money(C.deudaT), { cls: C.deudaT > 0.005 ? 'hot' : '' }),
    kpi('Pedidos sin entregar', int(pend)),
    kpi('Productos con stock bajo', int(low.length), { cls: low.length ? 'hot' : '' }),
    kpi('Vendido en total', money(vTot)),
    kpi('Abonado en total', money(abTot)),
    kpi('Gasto total en Meta Ads', money(metaTot)),
    kpi('Ganancia neta total', money(netaTot), { cls: netaTot < 0 ? 'hot' : '' }),
  ].join('');
  $('#start').innerHTML = S.productos.length && S.clientes.length ? '' : `<div class="card" style="margin-top:18px"><h3>Para empezar</h3><ol class="steps">
    <li>Agrega tus productos en <b>Productos</b> con su costo y precio.</li><li>Agrega tus clientes en <b>Clientes</b>.</li>
    <li>Cuando te llegue mercancía, regístrala en <b>Compras a Terramar</b>.</li><li>Anota cada venta en <b>Ventas</b> y cada pago en <b>Abonos</b>. Lo demás se calcula solo.</li></ol></div>`;
  const deb = Object.entries(C.cl).filter(([, k]) => k.saldo > 0.005).sort((a, b) => b[1].saldo - a[1].saldo);
  $('#deben').innerHTML = deb.length ? deb.slice(0, 8).map(([id, k]) => `<li><span class="grow">${esc(cName(id))}</span>${waLink(byId('clientes', id), k.saldo, 'Recordar')}<span class="n neg">${money(k.saldo)}</span></li>`).join('') : '<li class="empty" style="display:block">Nadie te debe. ¡Todo cobrado!</li>';
  const ms = []; const d = new Date(); d.setDate(1);
  for (let i = 5; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); ms.push([`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`, MES[x.getMonth()]]); }
  const data = ms.map(([k, l]) => ({ l, v: sum(S.ventas.filter(v => String(v.fecha).startsWith(k)), vTotal), c: sum(S.abonos.filter(a => cash(a) && String(a.fecha).startsWith(k)), a => a.monto) }));
  const mx = Math.max(1, ...data.map(x => Math.max(x.v, x.c)));
  $('#bars').innerHTML = data.map(x => `<div class="r"><span>${x.l}</span><div><div class="bar" style="width:${x.v / mx * 100}%"></div><div class="bar-l">Vendido ${money(x.v)}</div><div class="bar c" style="width:${x.c / mx * 100}%"></div><div class="bar-l">Cobrado ${money(x.c)}</div></div></div>`).join('');
  $('#bajo').innerHTML = low.length ? low.sort((a, b) => (C.stock[a.id] || 0) - (C.stock[b.id] || 0)).slice(0, 10).map(p => { const st = C.stock[p.id] || 0; return `<li><span>${esc(p.nombre)}</span><span class="pill ${st <= 0 ? 'p-acc' : 'p-warn'}">${st <= 0 ? 'Agotado' : st + ' quedan'}</span></li>`; }).join('') : `<li class="empty" style="display:block">${S.productos.length ? 'Todo el inventario está en orden.' : 'Sin productos todavía.'}</li>`;
  const pl = S.ventas.filter(v => est(v) !== 'Entregado').sort(ord(1));
  $('#r-ped').innerHTML = pl.length ? pl.slice(0, 8).map(v => `<li><span class="grow">${esc(cName(v.clienteId))}<br><span class="small muted">${esc(vDesc(v))}</span></span><span class="pill ${estPill(est(v))}">${est(v)}</span></li>`).join('') + (pl.length > 8 ? `<li><a href="#pedidos" class="small">Ver los ${pl.length} pedidos</a></li>` : '') : '<li class="empty" style="display:block">Todo entregado.</li>';
}

/* ============ Pedidos ============ */
function pedidos() {
  const pp = {};
  for (const v of S.ventas) if (est(v) === 'Por pedir a Terramar') for (const i of items(v)) pp[i.productoId] = (pp[i.productoId] || 0) + num(i.cantidad);
  const e = Object.entries(pp).sort((a, b) => pName(a[0]).localeCompare(pName(b[0]), 'es'));
  const costo = sum(e, ([id, n]) => n * num(byId('productos', id)?.costo));
  $('#porpedir').innerHTML = e.length ? e.map(([id, n]) => { const p = byId('productos', id); return `<li>${conFoto(id, `${esc(pName(id))}${p?.codigo ? ` <span class="small muted">${esc(p.codigo)}</span>` : ''}`)}<span class="n"><b>${n}</b> pza${n === 1 ? '' : 's'}</span></li>`; }).join('') + `<li><span class="muted">Costo aproximado</span><span class="n"><b>${money(costo)}</b></span></li>` : '<li class="empty" style="display:block">No hay nada pendiente por pedir.</li>';
  $('#porpedir-b').innerHTML = e.length ? '<button class="btn pri" type="button" data-addporpedir>Pasar a mi próximo pedido</button> <button class="btn" type="button" id="ya-pedi">Ya hice el pedido a Terramar</button> <button class="btn" type="button" id="copy-ped">Copiar lista</button>' : '';
  const t = ($('#q-ped').value || '').toLowerCase(), fs = $('#f-ped').value;
  const L = S.ventas.filter(v => est(v) !== 'Entregado' && (!fs || est(v) === fs)).sort(ord(1)).filter(v => !t || `${cName(v.clienteId)} ${vDesc(v)} ${est(v)}`.toLowerCase().includes(t));
  $('#t-pedidos').innerHTML = L.length ? `<div class="tiles">${L.map(v => { const nx = nextEst(est(v)); return `<div class="tl-w">${ventaCard(v, { pago: false })}${nx ? `<button class="btn sm pri" type="button" data-adv="${esc(v.id)}" data-to="${nx}">Marcar: ${nx}</button>` : ''}</div>`; }).join('')}</div>`
    : `<p class="empty">${S.ventas.length ? 'No hay pedidos pendientes aquí.' : 'Aún no hay pedidos. Registra una venta para empezar.'}</p>`;
}

/* ============ Compras a Terramar ============ */
function terramar() {
  const inv = sum(S.productos, p => Math.max(0, C.stock[p.id] || 0) * num(p.costo));
  $('#k-terramar').innerHTML = [
    kpi('Le debes a Terramar', money(C.deudaT), { cls: C.deudaT > 0.005 ? 'hot' : 'good' }),
    kpi('Total comprado', money(C.compras)), kpi('Total pagado', money(C.pagadoT)), kpi('Inventario a costo', money(inv)),
  ].join('');
}

/* ============ Próximo pedido y regalos ============ */
let SUB = 'lista';
function sub(v) {
  SUB = v;
  for (const b of $$('#sub-ent button')) b.setAttribute('aria-selected', b.dataset.sub === v);
  for (const d of $$('[data-subv]')) d.hidden = d.dataset.subv !== v;
}
const ajustes = () => ({ minimo: 2000, base: 'costo', ...(S.ajustes.find(a => a.id === 'general') || {}) });
function porPedirMap() {
  const pp = {};
  for (const v of S.ventas) if (est(v) === 'Por pedir a Terramar') for (const i of items(v)) pp[i.productoId] = (pp[i.productoId] || 0) + num(i.cantidad);
  return pp;
}
function addToLista(pid, n) {
  const ex = S.lista.find(l => l.productoId === pid);
  if (ex) commit([{ t: 'update', c: 'lista', id: ex.id, data: { cantidad: num(ex.cantidad) + n } }]);
  else commit([{ t: 'set', c: 'lista', id: store.newId('lista'), data: { productoId: pid, cantidad: n, creado: Date.now() } }]);
}
function lista() {
  const aj = ajustes(), min = num(aj.minimo), porPrecio = aj.base === 'precio';
  if (document.activeElement?.id !== 'aj-min') $('#aj-min').value = min || '';
  $('#aj-base').value = porPrecio ? 'precio' : 'costo';
  const L = [...S.lista].sort((a, b) => num(a.creado) - num(b.creado));
  const val = l => { const p = byId('productos', l.productoId); return num(porPrecio ? p?.precio : p?.costo); };
  const total = sum(L, l => num(l.cantidad) * val(l));
  const costo = sum(L, l => num(l.cantidad) * num(byId('productos', l.productoId)?.costo));
  const piezas = sum(L, l => l.cantidad), falta = Math.max(0, min - total), listo = min > 0 && total >= min;
  const w = min > 0 ? Math.min(100, total / min * 100) : 100;
  $('#lista-meta').innerHTML = `<div class="goal"><h2>Próximo pedido a Terramar</h2>
    <div class="big">${money(total)}</div>
    <div class="muted small">${int(piezas)} pieza${piezas === 1 ? '' : 's'}${min > 0 ? ` · Mínimo ${money(min)}` : ''}${porPrecio ? ` · A precio de catálogo` : ''}</div>
    ${min > 0 ? `<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="${min}" aria-valuenow="${r2(total)}"><i class="${listo ? 'ok' : ''}" style="width:${w}%"></i></div>
    ${listo ? `<p class="ok-msg">✓ Ya alcanzaste el pedido mínimo${total - min > 0.005 ? `. Llevas ${money(total - min)} de más` : ''}. Puedes seguir agregando.</p>` : `<p>Te faltan <b class="neg">${money(falta)}</b> para llegar al pedido mínimo.</p>`}` : ''}
    ${porPrecio && L.length ? `<p class="small muted" style="margin-top:4px">Lo que le pagarías a Terramar (a costo): <b>${money(costo)}</b></p>` : ''}</div>`;
  // Cada producto de la lista es un cuadrito con su foto, las piezas (− / +) y el subtotal.
  $('#t-lista').innerHTML = L.length ? `<div class="tiles">${L.map(l => { const p = byId('productos', l.productoId) || { nombre: pName(l.productoId) };
    return `<div class="tl tl-l"><span class="tl-i" aria-hidden="true">${fotoHTML(p, '')}</span><span class="tl-t">${esc(pName(l.productoId))}</span>
      <span class="tl-s">${p.codigo ? esc(p.codigo) + ' · ' : ''}Costo ${money(p.costo)} · Precio ${money(p.precio)}</span>
      <span class="stepper"><button class="btn sm" type="button" data-lq="${esc(l.id)}" data-d="-1" aria-label="Una pieza menos">−</button><b>${num(l.cantidad)}</b><button class="btn sm" type="button" data-lq="${esc(l.id)}" data-d="1" aria-label="Una pieza más">+</button></span>
      <span class="tl-m">${money(num(l.cantidad) * val(l))}</span>
      <button class="btn sm del" type="button" data-lrm="${esc(l.id)}">Quitar</button></div>`; }).join('')}</div>`
    : '<p class="empty">Tu lista está vacía. Agrega productos con el formulario o toca “Agregar lo que tengo por pedir”.</p>';
  const nPed = S.ventas.filter(v => est(v) === 'Pedido a Terramar').length;
  $('#lista-llego').innerHTML = L.length ? `<div style="border-top:1px solid var(--line);margin-top:14px;padding-top:6px">
    <h3 style="margin-top:10px">¿Ya te llegó este pedido?</h3>
    <div class="fld"><label for="ll-pag">¿Cuánto le pagaste a Terramar por este pedido? (opcional)</label><input id="ll-pag" type="number" min="0" step="0.01" inputmode="decimal" placeholder="$0.00"></div>
    ${nPed ? `<label class="chk" for="ll-ventas"><input type="checkbox" id="ll-ventas" checked> Marcar como “Llegó” ${nPed === 1 ? 'la venta que está' : `las ${nPed} ventas que están`} en “Pedido a Terramar”</label>` : ''}
    <div class="btns"><button class="btn pri" type="button" id="ll-ok">Ya me llegó: pasar a Compras</button><button class="btn" type="button" id="ll-copy">Copiar lista</button><button class="btn del" type="button" id="ll-clear">Vaciar lista</button></div>
    <p class="hint">Al tocar “Ya me llegó”, cada producto se registra en <b>Compras y pagos</b> con su costo y se suma a tu inventario.</p></div>` : '';
  const pp = porPedirMap(), faltan = Object.entries(pp).filter(([id, n]) => n - num(S.lista.find(l => l.productoId === id)?.cantidad) > 0).length;
  $('#lista-pp-h').innerHTML = Object.keys(pp).length ? (faltan ? `Tienes <b>${faltan}</b> producto${faltan === 1 ? '' : 's'} vendido${faltan === 1 ? '' : 's'} sin stock que aún no están en la lista.` : 'Todo lo que tienes “por pedir” ya está en la lista.') : '';
}
function llego() {
  const L = [...S.lista].sort((a, b) => num(a.creado) - num(b.creado)); if (!L.length) return;
  const f = today(), nota = 'Pedido de mi lista ' + fdate(f), ops = []; let k = 0;
  for (const l of L) {
    const p = byId('productos', l.productoId); if (!p) continue;
    ops.push({ t: 'set', c: 'entradas', id: store.newId('entradas'), data: { fecha: f, productoId: l.productoId, cantidad: num(l.cantidad), costo: r2(p.costo), precioCat: r2(p.precio), pagado: 0, nota, creado: Date.now() + k++ } });
  }
  const pag = r2($('#ll-pag')?.value);
  if (pag > 0) ops.push({ t: 'set', c: 'pagos', id: store.newId('pagos'), data: { fecha: f, monto: pag, metodo: '', nota, creado: Date.now() + k++ } });
  if ($('#ll-ventas')?.checked) for (const v of S.ventas) if (est(v) === 'Pedido a Terramar') ops.push({ t: 'update', c: 'ventas', id: v.id, data: { entrega: 'Llegó' } });
  for (const l of L) ops.push({ t: 'del', c: 'lista', id: l.id });
  commit(ops); toast(`Listo: ${L.length} producto${L.length === 1 ? '' : 's'} pasaron a Compras y a tu inventario.`); sub('compras');
}
function regalosView() {
  const R = S.regalos, piezas = sum(R, r => r.cantidad), valor = sum(R, r => num(r.valor) * num(r.cantidad));
  const ym = today().slice(0, 7), mes = sum(R.filter(r => String(r.fecha).startsWith(ym)), r => num(r.valor) * num(r.cantidad));
  const enStock = sum(R.filter(r => r.productoId), r => num(r.cantidad));
  $('#k-regalos').innerHTML = [kpi('Piezas regaladas', int(piezas)), kpi('Valor de tus regalos', money(valor), { cls: valor > 0 ? 'good' : '', d: 'A precio de venta' }), kpi('Regalos este mes', money(mes))].join('');
  $('#regalos-msg').innerHTML = R.length ? `<h3>¿Puedo hacer rebajas?</h3><p class="sub">Estos productos <b>no te costaron</b>. Si los vendes, aunque sea con rebaja, todo lo que cobres es ganancia. Por ejemplo, si los vendes a mitad de precio, ganarías <b>${money(valor / 2)}</b>.</p>${enStock ? `<p class="hint">Los ${int(enStock)} que son de tu lista de productos ya se sumaron a tu inventario.</p>` : ''}`
    : '<h3>Tus regalos de Terramar</h3><p class="sub">Cuando Terramar te mande regalos con un pedido, regístralos aquí. Así sabes cuánto valen y cuánto puedes rebajar sin perder dinero.</p>';
}

/* ============ Movimientos ============ */
function movs() {
  return [
    ...S.ventas.map(v => ({ ...v, _t: 'Venta', _d: `${cName(v.clienteId)} · ${vDesc(v)}`, _m: vTotal(v), _c: 'ventas' })),
    ...S.abonos.map(a => ({ ...a, _t: 'Abono', _d: `${cName(a.clienteId)}${a.metodo ? ' · ' + a.metodo : ''}${esDep(a) ? ' · guardado en su cuenta abierta' : ''}`, _m: num(a.monto), _c: 'abonos' })),
    ...S.entradas.map(e => ({ ...e, _t: 'Compra a Terramar', _d: `${pName(e.productoId)} · ${num(e.cantidad)} pzas`, _m: eCosto(e), _c: 'entradas' })),
    ...S.pagos.map(p => ({ ...p, _t: 'Pago a Terramar', _d: p.metodo || '', _m: num(p.monto), _c: 'pagos' })),
    ...S.gastos.map(g => ({ ...g, _t: 'Gasto', _d: `${g.categoria}${g.campana ? ' · ' + g.campana : ''}`, _m: num(g.monto), _c: 'gastos' })),
    ...S.regalos.map(r => ({ ...r, _t: 'Regalo', _d: `${rName(r)} · ${num(r.cantidad)} pzas (valor)`, _m: num(r.valor) * num(r.cantidad), _c: 'regalos' })),
  ].sort(ord(0));
}
const movPill = t => ({ Venta: 'p-warn', Abono: 'p-ok', 'Compra a Terramar': 'p-mute', 'Pago a Terramar': 'p-info', Gasto: 'p-acc', Regalo: 'p-ok' }[t]);
function movList() {
  const t = ($('#q-mov').value || '').toLowerCase().trim(), ft = $('#f-mov').value;
  return movs().filter(m => (!ft || m._t === ft) && (!t || `${m._t} ${m._d} ${m.nota || ''} ${fdate(m.fecha)}`.toLowerCase().includes(t)));
}
const movIco = m => m._c === 'abonos' ? abIco(m) : ({ Venta: '🛍️', 'Compra a Terramar': '📦', 'Pago a Terramar': '🏦', Gasto: catIco(m.categoria), Regalo: '🎀' }[m._t] || '•');
function movTable() {
  const L = movList();
  $('#t-movimientos').innerHTML = L.length ? `<div class="tiles">${L.slice(0, 500).map(m => tile({ attr: `data-fila="${m._c}" data-id="${esc(m.id)}"`, ico: movIco(m), t: `<span class="pill ${movPill(m._t)}">${m._t}</span>`, big: money(m._m), s: `${fdate(m.fecha)} · ${esc(m._d)}` })).join('')}</div>` + (L.length > 500 ? `<p class="empty">Se muestran los 500 más recientes de ${L.length}. Usa el buscador para encontrar otros.</p>` : '') : '<p class="empty">No hay movimientos que coincidan.</p>';
}

/* ============ Detalle de cliente ============ */
function openDlg(title, html) { $('#dlg-t').textContent = title; $('#dlg-b').innerHTML = html; const d = $('#dlg'); if (!d.open) d.showModal(); }
function verCliente(id) {
  const x = byId('clientes', id); if (!x) return;
  const k = C.cl[id] || { vendido: 0, abonado: 0, saldo: 0, n: 0 };
  const vs = S.ventas.filter(v => v.clienteId === id).sort(ord(0)), as = S.abonos.filter(a => a.clienteId === id).sort(ord(0));
  const cu = k.cuenta || 0;
  openDlg(x.nombre, `<div class="dl-ico" aria-hidden="true">${gIco(x)}</div><div class="kpis">${kpi('Comprado', money(k.vendido))}${kpi('Abonado', money(k.abonado))}${kpi('Saldo', money(k.saldo), { cls: k.saldo > 0.005 ? 'hot' : 'good' })}${kpi('💰 Cuenta abierta', money(cu), { cls: cu > 0.005 ? 'good' : '' })}</div>
    <p class="sub" style="margin-top:12px">${x.telefono ? 'WhatsApp: ' + esc(x.telefono) : 'Sin WhatsApp registrado'}${x.nota ? ' · ' + esc(x.nota) : ''}</p>
    <div class="btns">${waLink(x, k.saldo, k.saldo > 0.005 ? 'Enviar recordatorio por WhatsApp' : 'Abrir WhatsApp')}<button class="btn sm" type="button" data-newsale="${esc(id)}">Nueva venta</button><button class="btn sm" type="button" data-newab="${esc(id)}">Registrar abono</button><button class="btn sm" type="button" data-cuenta="${esc(id)}">💰 Cuenta abierta</button>${acts('clientes', id)}</div>
    <h3 style="margin-top:18px">Compras</h3>${vs.length ? `<ul class="list">${vs.map(v => `<li><span class="grow">${fdate(v.fecha)} · ${esc(vDesc(v))}<br><span class="pill ${payPill(payState(v))}">${payState(v)}</span> <span class="pill ${estPill(est(v))}">${est(v)}</span></span><span class="n"><b>${money(vTotal(v))}</b>${C.vp[v.id] > 0.005 ? `<br><span class="small neg">falta ${money(C.vp[v.id])}</span>` : ''}</span></li>`).join('')}</ul>` : '<p class="empty">Sin compras.</p>'}
    <h3 style="margin-top:18px">Abonos</h3>${as.length ? `<ul class="list">${as.map(a => `<li><span>${abIco(a)} ${fdate(a.fecha)} · ${esc(a.metodo || '')}${a.nota ? ' · ' + esc(a.nota) : ''}${abTag(a) ? '<br>' + abTag(a) : ''}</span><span class="n">${money(a.monto)}</span></li>`).join('')}</ul>` : '<p class="empty">Sin abonos.</p>'}`);
}
function quickAdd(c, targetId) {
  const fl = F[c].f;
  openDlg(c === 'clientes' ? 'Nuevo cliente' : 'Nuevo producto', `<form id="f-quick" data-c="${c}" data-target="${targetId}" novalidate>${fl.map(f => fieldHTML('qk', f)).join('')}<div class="btns"><button class="btn pri" type="submit">Guardar</button></div></form>`);
  setTimeout(() => $('#f-quick input[name="nombre"]')?.focus(), 50);
}

/* ============ Métricas ============ */
const M = { pre: 'mes', a: '', b: '', camp: '__all', grp: 'auto' };
function shiftMonths(s, n) { const d = pd(s), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return iso(d); }
function presetRange(p) {
  const t = today(), y = t.slice(0, 4), first = t.slice(0, 8) + '01';
  if (p === 'mes') return [first, t];
  if (p === 'mesp') { const a = shiftMonths(first, -1); return [a, addDays(first, -1)]; }
  if (p === 'd7') return [addDays(t, -6), t];
  if (p === 'd30') return [addDays(t, -29), t];
  if (p === 'd90') return [addDays(t, -89), t];
  if (p === 'anio') return [y + '-01-01', t];
  if (p === 'todo') { const all = [...S.ventas, ...S.gastos, ...S.abonos].map(x => x.fecha).filter(Boolean).sort(); return [all[0] || t, t]; }
  return [M.a || first, M.b || t];
}
function prevRange(p, a, b) {
  if (p === 'todo') return null;
  if (p === 'mes' || p === 'mesp') { const pa = shiftMonths(a, -1); return [pa, p === 'mesp' ? addDays(a, -1) : shiftMonths(b, -1)]; }
  if (p === 'anio') return [String(+a.slice(0, 4) - 1) + a.slice(4), String(+b.slice(0, 4) - 1) + b.slice(4)];
  const L = daysBetween(a, b) + 1; return [addDays(a, -L), addDays(a, -1)];
}
const campOf = x => x.campana || '';
function inCamp(x) {
  if (M.camp === '__all') return true;
  if (M.camp === '__none') return !campOf(x);
  return campOf(x) === M.camp;
}
function metrics(a, b) {
  const V = S.ventas.filter(v => v.fecha >= a && v.fecha <= b && inCamp(v));
  const G = S.gastos.filter(g => g.fecha >= a && g.fecha <= b && inCamp(g, 1));
  const ventas = sum(V, vTotal), costo = sum(V, vCosto), n = V.length, bruta = ventas - costo;
  const GM = G.filter(g => g.categoria === 'Meta Ads');
  const meta = sum(GM, g => g.monto), otros = sum(G.filter(g => g.categoria !== 'Meta Ads'), g => g.monto);
  const VM = V.filter(v => v.origen === 'Meta Ads'), ventasMeta = sum(VM, vTotal), nMeta = VM.length;
  const mensajes = sum(GM, g => g.mensajes), resultados = sum(GM, g => g.resultados);
  const pendiente = sum(V, v => Math.max(0, C.vp[v.id] ?? vTotal(v))), cobrado = ventas - pendiente;
  return { V, G, ventas, costo, n, bruta, margen: ventas ? bruta / ventas : null, ticket: n ? ventas / n : null, unidades: sum(V, vUnits),
    meta, otros, neta: bruta - meta - otros, ventasMeta, nMeta, mensajes, resultados,
    roas: meta ? ventasMeta / meta : null, cpv: nMeta ? meta / nMeta : null, cpm: mensajes ? meta / mensajes : null, conv: mensajes ? nMeta / mensajes : null,
    cobrado, pendiente, pCobrado: ventas ? cobrado / ventas : null, gananciaAds: (sum(VM, vTotal) - sum(VM, vCosto)) - meta };
}
function delta(cur, prev, { fmt = money, inverse = false } = {}) {
  if (prev == null || cur == null) return '';
  const diff = cur - prev;
  const ch = prev ? diff / Math.abs(prev) : null;
  if (Math.abs(diff) < 0.005) return 'Igual que el periodo anterior';
  const good = inverse ? diff < 0 : diff > 0;
  return `<span class="${good ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${ch == null ? '' : pct(Math.abs(ch)) + ' · '}</span>antes ${fmt(prev)}`;
}
const roasF = v => v == null ? '—' : v.toLocaleString('es-MX', { maximumFractionDigits: 2 }) + 'x';
const orDash = (v, f) => v == null ? '—' : f(v);

function buckets(a, b, grp) {
  const out = [];
  if (grp === 'dia') for (let d = a; d <= b; d = addDays(d, 1)) out.push({ k: d, a: d, b: d, l: `${+d.slice(8)} ${MES[+d.slice(5, 7) - 1]}` });
  else if (grp === 'semana') {
    let d = pd(a); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); let s = iso(d);
    for (; s <= b; s = addDays(s, 7)) { const e = addDays(s, 6); out.push({ k: s, a: s < a ? a : s, b: e > b ? b : e, l: `Sem. ${+s.slice(8)} ${MES[+s.slice(5, 7) - 1]}` }); }
  } else {
    let s = a.slice(0, 8) + '01';
    for (; s <= b; s = shiftMonths(s, 1)) { const e = addDays(shiftMonths(s, 1), -1); out.push({ k: s, a: s < a ? a : s, b: e > b ? b : e, l: `${MES[+s.slice(5, 7) - 1]} ${s.slice(2, 4)}` }); }
  }
  return out;
}
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function mkChart(id, cfg) {
  charts[id]?.destroy();
  if (!window.Chart) { $('#' + id).replaceWith(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'No se pudo cargar la gráfica. Revisa tu internet.' })); return; }
  Chart.defaults.font.family = 'Geist, system-ui, sans-serif'; Chart.defaults.color = cssv('--mute');
  charts[id] = new Chart($('#' + id), cfg);
}
function hbars(rows, fmt = money) {
  if (!rows.length) return '<p class="empty">Sin datos en este periodo.</p>';
  const mx = Math.max(1e-9, ...rows.map(r => Math.abs(r.v)));
  return rows.map(r => `<div class="hb"><div class="hb-top"><span>${esc(r.l)}</span><b>${fmt(r.v)}</b></div><div class="hb-track"><div class="hb-bar" style="width:${Math.abs(r.v) / mx * 100}%;${r.c ? 'background:' + r.c : ''}"></div></div>${r.s ? `<small>${r.s}</small>` : ''}</div>`).join('');
}

function metricas() {
  if (M.pre !== 'custom') { const [a, b] = presetRange(M.pre); M.a = a; M.b = b; }
  if (M.a > M.b) [M.a, M.b] = [M.b, M.a];
  $('#m-a').value = M.a; $('#m-b').value = M.b;
  const camps = [...new Set([...S.ventas.map(campOf), ...S.gastos.map(campOf)].filter(Boolean))].sort();
  $('#m-camp').innerHTML = `<option value="__all">Todas</option><option value="__none">Sin campaña</option>` + camps.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('#m-camp').value = camps.includes(M.camp) || M.camp.startsWith('__') ? M.camp : (M.camp = '__all');
  const a = M.a, b = M.b, pr = prevRange(M.pre, a, b);
  const m = metrics(a, b), p = pr ? metrics(pr[0], pr[1]) : null;
  $('#m-cmp').textContent = `Del ${fdate(a)} al ${fdate(b)}` + (pr ? ` · Comparado con: ${fdate(pr[0])} al ${fdate(pr[1])}` : '');
  const D = (k, o) => p ? delta(m[k], p[k], o) : '';
  $('#m-k1').innerHTML = [
    kpi('Ventas', money(m.ventas), { d: D('ventas') }),
    kpi('Número de ventas', int(m.n), { d: D('n', { fmt: int }) }),
    kpi('Ticket promedio', orDash(m.ticket, money), { d: D('ticket') }),
    kpi('Piezas vendidas', int(m.unidades), { d: D('unidades', { fmt: int }) }),
    kpi('Ganancia bruta', money(m.bruta), { d: m.margen == null ? 'Ventas − costo del producto' : `Margen ${pct(m.margen)} · ` + (D('bruta') || '') }),
    kpi('Otros gastos', money(m.otros), { d: D('otros', { inverse: true }) }),
    kpi('Ganancia neta', money(m.neta), { cls: m.neta < 0 ? 'hot' : 'good', d: D('neta') || 'Bruta − Meta Ads − otros gastos' }),
    kpi('Cobrado de estas ventas', orDash(m.pCobrado, v => pct(v)), { d: `${money(m.cobrado)} de ${money(m.ventas)}` }),
  ].join('');
  $('#m-k2').innerHTML = [
    kpi('Gasto en Meta Ads', money(m.meta), { d: D('meta', { inverse: true }) }),
    kpi('Ventas que vinieron de Meta Ads', money(m.ventasMeta), { d: `${int(m.nMeta)} venta${m.nMeta === 1 ? '' : 's'}` }),
    kpi('ROAS', roasF(m.roas), { cls: m.roas != null && m.roas < 1 ? 'hot' : '', d: m.roas == null ? 'Ventas de Meta ÷ gasto' : `Por cada $1 de anuncios vendiste ${money(m.roas)}` }),
    kpi('Costo por venta', orDash(m.cpv, money), { d: p && m.cpv != null ? delta(m.cpv, p.cpv, { inverse: true }) : 'Gasto ÷ ventas de Meta' }),
    kpi('Mensajes recibidos', int(m.mensajes), { d: D('mensajes', { fmt: int }) }),
    kpi('Costo por mensaje', orDash(m.cpm, money), { d: p && m.cpm != null ? delta(m.cpm, p.cpm, { inverse: true }) : 'Gasto ÷ mensajes' }),
    kpi('Mensajes que se volvieron venta', orDash(m.conv, v => pct(v, 1)), { d: m.mensajes ? `${int(m.nMeta)} de ${int(m.mensajes)} mensajes` : 'Anota los mensajes en Gastos' }),
    kpi('Ganancia después de anuncios', money(m.gananciaAds), { cls: m.gananciaAds < 0 ? 'hot' : 'good', d: 'Ganancia bruta de Meta − gasto' }),
  ].join('');

  // Ventas por periodo vs. periodo anterior
  const days = daysBetween(a, b) + 1, grp = M.grp === 'auto' ? (days <= 31 ? 'dia' : days <= 120 ? 'semana' : 'mes') : M.grp;
  $('#m-grp-l').textContent = { dia: 'día', semana: 'semana', mes: 'mes' }[grp];
  const B = buckets(a, b, grp), PB = pr ? buckets(pr[0], pr[1], grp) : [];
  const tot = (bk, V) => sum(V.filter(v => v.fecha >= bk.a && v.fecha <= bk.b), vTotal);
  const cur = B.map(bk => tot(bk, m.V)), prev = B.map((_, i) => PB[i] ? tot(PB[i], p.V) : null);
  mkChart('ch-ventas', { type: 'bar', data: { labels: B.map(x => x.l), datasets: [
    { type: 'bar', label: 'Este periodo', data: cur, backgroundColor: cssv('--brand'), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 34, order: 2 },
    ...(pr ? [{ type: 'line', label: 'Periodo anterior', data: prev, borderColor: cssv('--mute'), borderDash: [5, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: cssv('--mute'), tension: .25, spanGaps: true, order: 1 }] : []),
  ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.datasetIndex === 0 ? `Este periodo: ${money(c.parsed.y)}` : `Antes (${PB[c.dataIndex]?.l || ''}): ${money(c.parsed.y)}` } } },
    scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 12 } }, y: { beginAtZero: true, grid: { color: cssv('--grid') }, border: { display: false }, ticks: { callback: v => moneyShort(v), maxTicksLimit: 6 } } } } });

  // Cascada de ganancia
  const neg = cssv('--acc'), okc = cssv('--ok');
  $('#m-cascada').innerHTML = hbars([
    { l: 'Ventas', v: m.ventas }, { l: '− Costo del producto', v: -m.costo, c: cssv('--bar2') },
    { l: '= Ganancia bruta', v: m.bruta, c: okc, s: m.margen == null ? '' : `Margen ${pct(m.margen)}` },
    { l: '− Meta Ads', v: -m.meta, c: cssv('--brand') }, { l: '− Otros gastos', v: -m.otros, c: cssv('--bar2') },
    { l: '= Ganancia neta', v: m.neta, c: m.neta < 0 ? neg : okc, s: m.ventas ? `Te quedas con ${pct(m.neta / m.ventas)} de lo que vendes` : '' },
  ], v => v < 0 ? '−' + money(-v) : money(v));

  // Cobrado vs pendiente
  $('#m-cobro').innerHTML = m.ventas ? `<div class="stackbar" role="img" aria-label="Cobrado ${pct(m.pCobrado)}"><div style="flex:${m.cobrado};background:var(--ok)"></div><div style="flex:${m.pendiente};background:var(--brand)"></div></div>
    <div class="legend"><span><i style="background:var(--ok)"></i>Cobrado ${money(m.cobrado)} (${pct(m.pCobrado)})</span><span><i style="background:var(--brand)"></i>Pendiente ${money(m.pendiente)} (${pct(1 - m.pCobrado)})</span></div>` : '<p class="empty">Sin ventas en este periodo.</p>';

  // Por campaña
  const cm = {};
  const gc = k => cm[k] || (cm[k] = { gasto: 0, mensajes: 0, resultados: 0, n: 0, ventas: 0, costo: 0 });
  for (const g of m.G) if (g.categoria === 'Meta Ads') { const k = gc(campOf(g) || '(sin campaña)'); k.gasto += num(g.monto); k.mensajes += num(g.mensajes); k.resultados += num(g.resultados); }
  for (const v of m.V) if (v.origen === 'Meta Ads') { const k = gc(campOf(v) || '(sin campaña)'); k.n++; k.ventas += vTotal(v); k.costo += vCosto(v); }
  const CR = Object.entries(cm).sort((x, y) => y[1].ventas - x[1].ventas || y[1].gasto - x[1].gasto);
  const w = $('#ch-camp-w');
  if (CR.length) {
    w.hidden = false; w.style.height = Math.max(140, CR.length * 62 + 40) + 'px';
    mkChart('ch-camp', { type: 'bar', data: { labels: CR.map(x => x[0]), datasets: [
      { label: 'Ventas', data: CR.map(x => r2(x[1].ventas)), backgroundColor: cssv('--ink'), borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: 'left', maxBarThickness: 18 },
      { label: 'Gasto en anuncios', data: CR.map(x => r2(x[1].gasto)), backgroundColor: cssv('--brand'), borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: 'left', maxBarThickness: 18 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', axis: 'y', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.parsed.x)}`, afterBody: it => { const k = CR[it[0].dataIndex][1]; return k.gasto ? `ROAS: ${roasF(k.ventas / k.gasto)}` : ''; } } } },
        scales: { x: { beginAtZero: true, grid: { color: cssv('--grid') }, border: { display: false }, ticks: { callback: v => moneyShort(v), maxTicksLimit: 5 } }, y: { grid: { display: false } } } } });
  } else w.hidden = true;
  const RC = { h: ['Campaña', 'Gasto', 'Mensajes', 'Ventas', 'Vendido', 'ROAS', 'Costo por venta', 'Costo por mensaje', 'Mensajes → venta', 'Ganancia − anuncios'], n: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
  $('#m-camp-t').innerHTML = CR.length ? tableHTML(RC, CR.map(([name, k]) => { const g = k.ventas - k.costo - k.gasto; return { h: [`<b>${esc(name)}</b>`, money(k.gasto), int(k.mensajes), int(k.n), money(k.ventas), k.gasto ? `<span class="${k.ventas / k.gasto < 1 ? 'neg' : ''}">${roasF(k.ventas / k.gasto)}</span>` : '—', k.n && k.gasto ? money(k.gasto / k.n) : '—', k.mensajes ? money(k.gasto / k.mensajes) : '—', k.mensajes ? pct(k.n / k.mensajes, 1) : '—', `<span class="${g < 0 ? 'neg' : ''}">${money(g)}</span>`] }; }), null)
    + '<p class="small muted" style="margin-top:8px">ROAS = lo vendido ÷ lo gastado en anuncios. Arriba de 1x recuperas lo invertido en anuncios; para ganar, también debe cubrir el costo del producto (mira “Ganancia − anuncios”).</p>'
    : '<p class="empty">No hay gastos ni ventas de Meta Ads en este periodo. Registra tus gastos de anuncios en <b>Gastos</b> y elige “Meta Ads” como origen en tus ventas.</p>';

  // Productos, clientes, origen, gastos
  const pm = {}; for (const v of m.V) for (const i of items(v)) { const k = pm[i.productoId] || (pm[i.productoId] = { u: 0, t: 0, g: 0 }); k.u += num(i.cantidad); k.t += num(i.cantidad) * num(i.precio); k.g += num(i.cantidad) * (num(i.precio) - num(i.costo ?? byId('productos', i.productoId)?.costo)); }
  $('#m-prod').innerHTML = hbars(Object.entries(pm).sort((x, y) => y[1].u - x[1].u || y[1].t - x[1].t).slice(0, 8).map(([id, k]) => ({ l: pName(id), v: k.u, s: `Vendido ${money(k.t)} · Ganancia ${money(k.g)}` })), v => int(v) + ' pzas');
  const cmx = {}; for (const v of m.V) { const k = cmx[v.clienteId] || (cmx[v.clienteId] = { t: 0, n: 0 }); k.t += vTotal(v); k.n++; }
  $('#m-cli').innerHTML = hbars(Object.entries(cmx).sort((x, y) => y[1].t - x[1].t).slice(0, 8).map(([id, k]) => ({ l: cName(id), v: k.t, s: `${k.n} compra${k.n === 1 ? '' : 's'} · Saldo actual ${money(C.cl[id]?.saldo || 0)}` })));
  const om = {}; for (const v of m.V) { const o = v.origen || 'Sin indicar', k = om[o] || (om[o] = { t: 0, n: 0 }); k.t += vTotal(v); k.n++; }
  $('#m-origen').innerHTML = hbars(Object.entries(om).sort((x, y) => y[1].t - x[1].t).map(([o, k]) => ({ l: o, v: k.t, s: `${k.n} venta${k.n === 1 ? '' : 's'} · ${pct(m.ventas ? k.t / m.ventas : 0)} del total` })));
  const gm = {}; for (const g of m.G) { const k = gm[g.categoria || 'Otros'] || (gm[g.categoria || 'Otros'] = 0); gm[g.categoria || 'Otros'] = k + num(g.monto); }
  const gt = sum(Object.values(gm), x => x);
  $('#m-gastos').innerHTML = hbars(Object.entries(gm).sort((x, y) => y[1] - x[1]).map(([c, v]) => ({ l: c, v, c: c === 'Meta Ads' ? cssv('--brand') : '', s: `${pct(gt ? v / gt : 0)} de tus gastos` })));
}

/* ============ Respaldo (Excel) ============ */
const SHEETS = [
  ['Productos', 'productos', ['id', 'codigo', 'nombre', 'catalogo', 'costo', 'precio', 'minimo', 'creado']],
  ['Clientes', 'clientes', ['id', 'nombre', 'genero', 'telefono', 'nota', 'creado']],
  ['Ventas', 'ventas', ['id', 'fecha', 'clienteId', '_cliente', 'origen', 'campana', 'entrega', 'nota', '_total', 'items_json', 'creado']],
  ['Abonos', 'abonos', ['id', 'fecha', 'clienteId', '_cliente', 'monto', 'metodo', 'destino', 'nota', 'ventaId', 'creado']],
  ['Compras Terramar', 'entradas', ['id', 'fecha', 'productoId', '_producto', 'cantidad', 'costo', 'precioCat', 'pagado', 'nota', 'creado']],
  ['Pagos Terramar', 'pagos', ['id', 'fecha', 'monto', 'metodo', 'nota', 'creado']],
  ['Gastos', 'gastos', ['id', 'fecha', 'categoria', 'campana', 'monto', 'mensajes', 'resultados', 'nota', 'creado']],
  ['Regalos', 'regalos', ['id', 'fecha', 'productoId', '_producto', 'descripcion', 'cantidad', 'valor', 'nota', 'creado']],
  ['Próximo pedido', 'lista', ['id', 'productoId', '_producto', 'cantidad', 'creado']],
];
const NUMK = new Set(['costo', 'precio', 'precioCat','minimo', 'monto', 'cantidad', 'pagado', 'mensajes', 'resultados', 'valor', 'creado']);
let xlsxP;
function loadXLSX() {
  return xlsxP || (xlsxP = new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = () => ok(window.XLSX); s.onerror = () => { xlsxP = null; ko(new Error('xlsx')); }; document.head.appendChild(s); }));
}
async function exportXLSX() {
  let X; try { X = await loadXLSX(); } catch { return toast('No se pudo preparar el archivo. Revisa tu internet.', 'warn'); }
  const wb = X.utils.book_new();
  for (const [name, c, keys] of SHEETS) {
    const data = S[c].map(x => Object.fromEntries(keys.map(k => [k,
      k === '_cliente' ? cName(x.clienteId) : k === '_producto' ? pName(x.productoId) : k === '_total' ? r2(vTotal(x)) : k === 'items_json' ? JSON.stringify(items(x)) : (x[k] ?? '')])));
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(data, { header: keys }), name);
  }
  const det = [...S.ventas].sort(ord(1)).flatMap(v => items(v).map(i => ({ Fecha: fdate(v.fecha), Cliente: cName(v.clienteId), Producto: pName(i.productoId), Cantidad: num(i.cantidad), 'Precio c/u': num(i.precio), Subtotal: r2(num(i.cantidad) * num(i.precio)), 'Costo c/u': num(i.costo), Origen: v.origen || '', Campaña: v.campana || '', Pago: payState(v), Entrega: est(v) })));
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(det), 'Detalle ventas (solo lectura)');
  X.writeFile(wb, `respaldo-ventas-${today()}.xlsx`);
  try { localStorage.setItem('lastBackup', new Date().toISOString()); } catch {}
  backupInfo(); toast('Respaldo descargado.');
}
function backupInfo() {
  let l = null; try { l = localStorage.getItem('lastBackup'); } catch {}
  $('#exp-last').innerHTML = l ? `Último respaldo desde este dispositivo: <b>${new Date(l).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</b>` : 'Aún no has descargado un respaldo desde este dispositivo.';
}
let pendingImport = null;
async function importXLSX(file) {
  const msg = $('#imp-msg'); msg.textContent = 'Leyendo archivo…';
  let X; try { X = await loadXLSX(); } catch { msg.textContent = ''; return toast('No se pudo leer el archivo. Revisa tu internet.', 'warn'); }
  try {
    const wb = X.read(await file.arrayBuffer(), { type: 'array' });
    const ops = [], counts = [];
    for (const [name, c, keys] of SHEETS) {
      const ws = wb.Sheets[name]; if (!ws) continue;
      const rowsIn = X.utils.sheet_to_json(ws, { defval: '' }); let n = 0;
      for (const r of rowsIn) {
        const o = {};
        for (const k of keys) {
          if (k === 'id' || k.startsWith('_')) continue;
          if (k === 'items_json') { try { o.items = JSON.parse(r.items_json || '[]'); } catch { o.items = []; } continue; }
          if (!(k in r)) continue;
          let v = r[k]; if (NUMK.has(k)) v = num(v); else if (k === 'fecha' && typeof v === 'number') v = iso(new Date(Math.round((v - 25569) * 864e5) + new Date().getTimezoneOffset() * 6e4)); else v = String(v).trim();
          o[k] = v;
        }
        if (c === 'productos' && !o.nombre) continue; if (c === 'clientes' && !o.nombre) continue;
        if (!o.creado) o.creado = Date.now() + n;
        ops.push({ t: 'set', c, id: String(r.id || '').trim() || store.newId(c), data: o, merge: true }); n++;
      }
      if (n) counts.push(`${n} ${F[c]?.many || 'en ' + name}`);
    }
    if (!ops.length) { msg.textContent = 'El archivo no tiene hojas que yo reconozca. Usa un respaldo descargado de esta página.'; return; }
    pendingImport = ops;
    msg.innerHTML = `Encontré: <b>${counts.join(', ')}</b>. <button class="btn sm pri" type="button" id="imp-ok">Importar</button> <button class="btn sm" type="button" id="imp-no">Cancelar</button>`;
  } catch (e) { console.error(e); msg.textContent = 'No pude leer ese archivo. ¿Es un Excel (.xlsx)?'; }
}
function csvDownload(name, header, data) {
  const csv = '﻿' + [header, ...data].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `${name}-${today()}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ============ Navegación y eventos ============ */
const TABS = ['resumen', 'ventas', 'abonos', 'pedidos', 'clientes', 'cuentas', 'productos', 'entradas', 'gastos', 'metricas', 'movimientos', 'respaldo'];
let cur = 'resumen';
function go(t) { if (location.hash !== '#' + t) location.hash = t; else show(); }
function show() {
  const t = (location.hash || '').slice(1); cur = TABS.includes(t) ? t : 'resumen';
  for (const b of $$('#tabs button')) { const on = b.dataset.t === cur; b.setAttribute('aria-selected', on); if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  for (const s of $$('main section')) s.hidden = s.id !== 'v-' + cur;
  if (cur === 'metricas') metricas();
  window.scrollTo({ top: 0 });
}
let raf = 0;
function render() {
  clearTimeout(raf);
  raf = setTimeout(() => {
    compute(); fillSelects();
    for (const c in F) table(c);
    resumen(); pedidos(); terramar(); lista(); regalosView(); movTable(); cuentas(); hints(); backupInfo();
    if (cur === 'metricas') metricas();
  });
}

function wire() {
  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t) return go(b.dataset.t);
    if (b.dataset.sub) return sub(b.dataset.sub);
    if (b.dataset.lq) { const l = byId('lista', b.dataset.lq); if (!l) return; const n = num(l.cantidad) + num(b.dataset.d); commit([n > 0 ? { t: 'update', c: 'lista', id: l.id, data: { cantidad: n } } : { t: 'del', c: 'lista', id: l.id }]); return; }
    if (b.dataset.lrm) { commit([{ t: 'del', c: 'lista', id: b.dataset.lrm }]); toast('Producto quitado de la lista.'); return; }
    if ('addporpedir' in b.dataset) {
      const pp = porPedirMap(); let n = 0;
      for (const [id, q] of Object.entries(pp)) { const ya = num(S.lista.find(l => l.productoId === id)?.cantidad), d = q - ya; if (d > 0) { addToLista(id, d); n++; } }
      if (b.closest('#v-pedidos')) { go('entradas'); sub('lista'); }
      toast(n ? `Agregué ${n} producto${n === 1 ? '' : 's'} a tu próximo pedido.` : Object.keys(pp).length ? 'Todo lo que tienes por pedir ya está en tu lista.' : 'No tienes ventas “Por pedir a Terramar”.'); return;
    }
    if (b.id === 'll-ok') { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = '¿Seguro? Toca otra vez'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Ya me llegó: pasar a Compras'; } }, 4000); return; } return llego(); }
    if (b.id === 'll-clear') { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = '¿Vaciar? Toca otra vez'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Vaciar lista'; } }, 4000); return; } commit(S.lista.map(l => ({ t: 'del', c: 'lista', id: l.id }))); toast('Lista vaciada.'); return; }
    if (b.id === 'll-copy') {
      const aj = ajustes(), L = [...S.lista].sort((a, c) => num(a.creado) - num(c.creado));
      const tot = sum(L, l => num(l.cantidad) * num(aj.base === 'precio' ? byId('productos', l.productoId)?.precio : byId('productos', l.productoId)?.costo));
      const txt = 'Pedido Terramar ' + fdate(today()) + '\n' + L.map(l => { const p = byId('productos', l.productoId); return `${p?.codigo ? p.codigo + ' ' : ''}${pName(l.productoId)}: ${num(l.cantidad)}`; }).join('\n') + `\nTotal: ${money(tot)}`;
      navigator.clipboard?.writeText(txt).then(() => toast('Lista copiada. Pégala en WhatsApp o donde hagas tu pedido.'), () => toast('No se pudo copiar.', 'warn')); return;
    }
    if (b.id === 'dlg-x') return $('#dlg').close();
    if ('fotox' in b.dataset) { const box = b.closest('.fotobox'); $('input[type=hidden]', box).value = ''; fotoSync(box.closest('form')); return; }
    if (b.dataset.prod) return verProducto(b.dataset.prod);
    if (b.dataset.venta) return verVenta(b.dataset.venta);
    if (b.dataset.fila) return verFila(b.dataset.fila, b.dataset.id);
    if (b.dataset.cuenta) return verCuenta(b.dataset.cuenta);
    if (b.dataset.dep || b.dataset.uso) {
      // Ir a Abonos con todo listo: guardar dinero, o usar lo guardado para pagar lo que debe.
      const id = b.dataset.dep || b.dataset.uso, fa = $('#f-abonos'), k = C.cl[id] || {};
      $('#dlg').close(); go('abonos'); resetForm('abonos'); fa.elements.clienteId.value = id;
      if (b.dataset.dep) { fa.elements.destino.value = DEP; fa.elements.metodo.value = 'Efectivo'; }
      else { fa.elements.destino.value = PAGAR; fa.elements.metodo.value = USO; const m = Math.min(k.cuenta || 0, Math.max(0, k.saldo || 0)) || (k.cuenta || 0); fa.elements.monto.value = m > 0 ? r2(m).toFixed(2) : ''; }
      applyShow('abonos', fa); hints(); setTimeout(() => fa.elements.monto.focus(), 100); return;
    }
    if (b.dataset.entrada) return verEntrada(b.dataset.entrada);
    if ('addline' in b.dataset) { const box = b.closest('.ad'); if (addLine(box)) $('.ad-p', box).focus(); hints(); return; }
    if ('rmline' in b.dataset) { const li = b.closest('li'), ul = li.parentElement, box = $('#' + ul.id.replace(/-list$/, '')); li.remove(); renderLines(box, readLines(box.closest('form'))); if (box.dataset.kind === 'venta') autoEntrega(); hints(); return; }
    if (b.dataset.quick) return quickAdd(b.dataset.quick, b.dataset.target);
    if (b.dataset.cancel) return resetForm(b.dataset.cancel);
    if (b.dataset.ed) { if (b.closest('#dlg')) $('#dlg').close(); return startEdit(b.dataset.ed, b.dataset.id); }
    if (b.dataset.ver) return verCliente(b.dataset.ver);
    if (b.dataset.newsale) { $('#dlg').close(); go('ventas'); resetForm('ventas'); $('#ventas-clienteId').value = b.dataset.newsale; hints(); return; }
    if (b.dataset.newab) { $('#dlg').close(); go('abonos'); resetForm('abonos'); $('#abonos-clienteId').value = b.dataset.newab; hints(); setTimeout(() => $('#abonos-monto').focus(), 100); return; }
    if (b.dataset.del) {
      if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = '¿Seguro? Toca otra vez'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Borrar'; } }, 4000); return; }
      if (b.closest('#dlg')) $('#dlg').close();
      return remove(b.dataset.del, b.dataset.id);
    }
    if (b.dataset.adv) { if (b.closest('#dlg')) $('#dlg').close(); commit([{ t: 'update', c: 'ventas', id: b.dataset.adv, data: { entrega: b.dataset.to } }]); toast('Pedido: ' + b.dataset.to + '.'); return; }
    if (b.id === 'ya-pedi') { const ops = S.ventas.filter(v => est(v) === 'Por pedir a Terramar').map(v => ({ t: 'update', c: 'ventas', id: v.id, data: { entrega: 'Pedido a Terramar' } })); commit(ops); toast(`${ops.length} venta${ops.length === 1 ? '' : 's'} marcada${ops.length === 1 ? '' : 's'} como “Pedido a Terramar”.`); return; }
    if (b.id === 'copy-ped') {
      const pp = {}; for (const v of S.ventas) if (est(v) === 'Por pedir a Terramar') for (const i of items(v)) pp[i.productoId] = (pp[i.productoId] || 0) + num(i.cantidad);
      const txt = 'Pedido Terramar ' + fdate(today()) + '\n' + Object.entries(pp).map(([id, n]) => `${byId('productos', id)?.codigo ? byId('productos', id).codigo + ' ' : ''}${pName(id)}: ${n}`).join('\n');
      navigator.clipboard?.writeText(txt).then(() => toast('Lista copiada. Pégala en WhatsApp o donde hagas tu pedido.'), () => toast('No se pudo copiar.', 'warn')); return;
    }
    if (b.dataset.csv) { const c = b.dataset.csv, R = rows(c); return csvDownload(F[c].many, R.h, R.r.map(r => r.v)); }
    if (b.id === 'csv-mov') return csvDownload('movimientos', ['Fecha', 'Tipo', 'Detalle', 'Monto', 'Nota'], movList().map(m => [fdate(m.fecha), m._t, m._d, r2(m._m), m.nota || '']));
    if (b.id === 'exp-xlsx') return exportXLSX();
    if (b.id === 'imp-ok') { const ops = pendingImport; pendingImport = null; if (ops) { commit(ops); $('#imp-msg').textContent = `Listo: se importaron ${ops.length} registros.`; } return; }
    if (b.id === 'imp-no') { pendingImport = null; $('#imp-msg').textContent = ''; return; }
    if (b.id === 'logout') { store.logout(); return; }
    if (b.id === 'pw-reset') { store.reset(user.email).then(() => { $('#pw-msg').textContent = `Te envié un correo a ${user.email} con un enlace para cambiar tu contraseña. Revisa también “Spam”.`; }, () => { $('#pw-msg').textContent = 'No se pudo enviar el correo. Intenta más tarde.'; }); return; }
    if (b.id === 'install' && deferredInstall) { deferredInstall.prompt(); deferredInstall = null; b.hidden = true; return; }
  });
  document.addEventListener('submit', e => {
    e.preventDefault(); const fm = e.target;
    if (fm.id === 'f-login') return doLogin();
    if (fm.id === 'f-lista') {
      const pid = fm.elements.productoId.value, n = Math.round(num(fm.elements.cantidad.value));
      if (!pid) { toast('Elige un producto.', 'warn'); return; }
      if (n <= 0) { toast('Las piezas deben ser 1 o más.', 'warn'); return; }
      addToLista(pid, n); toast(`${pName(pid)} agregado a la lista.`); fm.elements.cantidad.value = 1; fm.elements.productoId.value = ''; return;
    }
    if (fm.id === 'f-quick') { const c = fm.dataset.c, id = save(c, fm, { quick: true }); if (id) { $('#dlg').close(); setTimeout(() => { fillSelects(); const t = $('#' + fm.dataset.target); if (t) { t.value = id; t.dispatchEvent(new Event('change', { bubbles: true })); } }, 60); } return; }
    const c = fm.id.slice(2); if (F[c]) save(c, fm);
  });
  document.addEventListener('change', e => {
    const el = e.target, fm = el.form;
    if ('foto' in el.dataset) {
      const f = el.files[0], box = el.closest('.fotobox'); el.value = ''; if (!f) return;
      fotoLoad(f).then(d => { $('input[type=hidden]', box).value = d; fotoSync(box.closest('form')); }, () => toast('No pude abrir esa foto. Prueba con otra.', 'warn'));
      return;
    }
    if (el.id === 'imp-file') { if (el.files[0]) importXLSX(el.files[0]); el.value = ''; return; }
    if (el.id === 'm-pre') { M.pre = el.value; return metricas(); }
    if (el.id === 'm-a' || el.id === 'm-b') { M.pre = 'custom'; $('#m-pre').value = 'custom'; M[el.id.slice(2)] = el.value; return metricas(); }
    if (el.id === 'm-camp') { M.camp = el.value; return metricas(); }
    if (el.id === 'm-grp') { M.grp = el.value; return metricas(); }
    if (el.id === 'aj-min' || el.id === 'aj-base') { commit([{ t: 'set', c: 'ajustes', id: 'general', data: { minimo: r2($('#aj-min').value), base: $('#aj-base').value }, merge: true }]); toast('Pedido mínimo guardado.'); return; }
    if (el.id === 'f-ped') return pedidos();
    if (el.id === 'f-mov') return movTable();
    if (!fm) return;
    if (el.classList.contains('ad-p')) {
      const p = byId('productos', el.value), box = el.closest('.ad');
      if (box.dataset.kind === 'venta') $('.ad-r', box).value = p ? (num(p.precio) || '') : '';
      else { $('.ad-r', box).value = p ? (num(p.costo) || '') : ''; $('.ad-pc', box).value = p ? (num(p.precio) || '') : ''; }
    }
    if (fm.id === 'f-entradas' && el.name === 'productoId' && !editing.entradas) { const p = byId('productos', el.value); if (p) fm.elements.costo.value = num(p.costo) || ''; }
    if (fm.id === 'f-regalos' && el.name === 'productoId') { const p = byId('productos', el.value); if (p) fm.elements.valor.value = num(p.precio) || ''; }
    if (fm.id === 'f-ventas' && el.name === 'entrega') fm.dataset.touched = '1';
    const c = fm.id.slice(2); if (F[c]) applyShow(c, fm);
    hints();
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.q) { q[el.dataset.q] = el.value; return table(el.dataset.q); }
    if (el.id === 'q-ped') return pedidos();
    if (el.id === 'q-mov') return movTable();
    // Costo automático: mitad del precio de catálogo + 16%. Solo se reemplaza si el costo está vacío o lo puso la página.
    if (el.classList.contains('ad-pc')) { const co = $('.ad-r', el.closest('.ad')); co.value = num(el.value) > 0 ? r2(num(el.value) / 2 * 1.16).toFixed(2) : ''; }
    if (el.form && el.name === 'precio' && el.form.elements.costo && (el.form.id === 'f-productos' || el.form.dataset.c === 'productos')) {
      const fm = el.form, co = fm.elements.costo, auto = fm.dataset.autoCosto;
      if (!co.value || co.value === auto) { const v = num(el.value) > 0 ? r2(num(el.value) / 2 * 1.16).toFixed(2) : ''; co.value = v; fm.dataset.autoCosto = v; }
    }
    if (el.form) { const c = el.form.id.slice(2); if (F[c]) applyShow(c, el.form); hints(); }
  });
  // Recordar qué pedidos dejaste abiertos (para que no se cierren al guardar algo).
  document.addEventListener('toggle', e => { const d = e.target; if (d.classList?.contains('ped') && !q.entradas) d.open ? openG.add(d.dataset.g) : openG.delete(d.dataset.g); }, true);
  // En el recuadro del pedido, "Enter" agrega el producto a la lista en vez de guardar todo el pedido.
  document.addEventListener('keydown', e => {
    const box = e.target.closest?.('.ad');
    if (box && e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); if (addLine(box)) $('.ad-p', box).focus(); hints(); }
  });
  $('#dlg').addEventListener('click', e => { if (e.target === $('#dlg')) $('#dlg').close(); });
  $('#l-reset').addEventListener('click', () => {
    const em = $('#l-email').value.trim(), m = $('#l-msg');
    if (!em) { m.className = 'msg warn'; m.textContent = 'Escribe tu correo arriba y vuelve a tocar “Olvidé mi contraseña”.'; return; }
    store.reset(em).then(() => { m.className = 'msg ok'; m.textContent = 'Si ese correo está registrado, te llegará un enlace para crear una contraseña nueva. Revisa también “Spam”.'; }, () => { m.className = 'msg warn'; m.textContent = 'No se pudo enviar el correo. Revisa que esté bien escrito.'; });
  });
  addEventListener('hashchange', show);
  const net = () => { $('#offline').hidden = navigator.onLine; };
  addEventListener('online', net); addEventListener('offline', net); net();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (cur === 'metricas') metricas(); });
}

/* ============ Sesión ============ */
async function doLogin() {
  const em = $('#l-email').value.trim(), pw = $('#l-pass').value, m = $('#l-msg'), b = $('#l-btn');
  if (!em || !pw) { m.className = 'msg warn'; m.textContent = 'Escribe tu correo y tu contraseña.'; return; }
  b.disabled = true; m.className = 'msg'; m.textContent = 'Entrando…';
  try { await store.login(em, pw); m.textContent = ''; }
  catch (err) {
    const c = err?.code || '';
    m.className = 'msg warn';
    m.textContent = c.includes('too-many') ? 'Demasiados intentos. Espera unos minutos y vuelve a intentar.'
      : c.includes('network') ? 'No hay conexión a internet.'
      : c.includes('invalid-email') ? 'El correo no está bien escrito.'
      : 'Correo o contraseña incorrectos.';
  }
  b.disabled = false;
}
function onUser(u) {
  user = u; $('#boot').hidden = true;
  if (!u) { $('#app').hidden = true; $('#login').hidden = false; for (const c of COLS) S[c] = []; return; }
  $('#login').hidden = true; $('#app').hidden = false; $('#l-pass').value = '';
  $('#who').textContent = u.email; $('#who2').textContent = u.email;
  for (const c in F) resetForm(c);
  sub(SUB); show();
  for (const c of COLS) store.listen(c, (docs) => { S[c] = docs; render(); }, err => { console.error(err); toast('No se pudieron leer tus datos. Cierra sesión y vuelve a entrar.', 'warn'); });
}

let deferredInstall = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; const b = $('#install'); if (b) b.hidden = false; });

(async function main() {
  buildForms(); wire();
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const demo = local && new URLSearchParams(location.search).has('demo');
  try { store = await createStore(firebaseConfig, { demo }); }
  catch (e) { console.error(e); $('#boot').textContent = 'No se pudo conectar. Revisa tu internet y recarga la página.'; return; }
  if (demo) { $('#demo').hidden = false; }
  store.onAuth(onUser);
  if (demo) setTimeout(() => store.login('demo@ejemplo.com', 'x'), 80);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
