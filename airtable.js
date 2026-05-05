/* ═══════════════════════════════════════════
   App Emprendedor — Módulo Airtable
   Base ID pre-configurada: appnenFMauShRa5hl
   ═══════════════════════════════════════════ */

const DB = (() => {
  const cfg = () => window.AppConfig || {};

  const headers = () => ({
    'Authorization': `Bearer ${cfg().AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json'
  });

  const baseUrl = () => `https://api.airtable.com/v0/${cfg().BASE_ID}`;

  // ── Error handling ──
  async function handleResponse(res) {
    if (res.ok) return res.json();
    let msg;
    switch (res.status) {
      case 401: msg = 'Token inválido. Revisa AIRTABLE_TOKEN'; break;
      case 403: msg = 'Sin permisos. Verifica que el token tenga acceso a esta base'; break;
      case 404: msg = 'Registro no encontrado'; break;
      case 422: msg = 'Error en los datos enviados a Airtable'; break;
      case 429: msg = 'Límite de requests alcanzado. Espera un momento'; break;
      default:  msg = `Error ${res.status} de Airtable`;
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || msg);
  }

  // ── Fetch all pages ──
  async function fetchAll(table, params = '') {
    const records = [];
    let offset = '';
    do {
      const sep = params ? '&' : '?';
      const url = `${baseUrl()}/${encodeURIComponent(table)}${params}${offset ? sep + 'offset=' + offset : ''}`;
      const data = await fetch(url, { headers: headers() }).then(handleResponse);
      records.push(...(data.records || []));
      offset = data.offset || '';
    } while (offset);
    return records;
  }

  // ── Utilities ──
  function parsearItems(jsonString) {
    if (!jsonString) return [];
    try { return JSON.parse(jsonString); }
    catch { return []; }
  }

  function calcularTotales(items, descuentoPct = 0, tieneIVA = true) {
    const subtotal = items.reduce((s, i) => s + (parseFloat(i.cantidad) || 0) * (parseFloat(i.precioUnitario) || 0), 0);
    const descuentoMonto = subtotal * (parseFloat(descuentoPct) || 0) / 100;
    const base = subtotal - descuentoMonto;
    const iva = tieneIVA ? base * 0.16 : 0;
    const total = base + iva;
    return { subtotal, descuentoMonto, iva, total };
  }

  function formatearMoneda(n) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n || 0);
  }

  function formatearFecha(iso) {
    if (!iso) return '—';
    return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function hoy() { return new Date().toISOString().split('T')[0]; }

  // ── CLIENTES ──
  async function getClientes(filtroEstado = null) {
    let params = '?sort[0][field]=Nombre&sort[0][direction]=asc';
    if (filtroEstado) params += `&filterByFormula={Estado}="${filtroEstado}"`;
    const records = await fetchAll('Clientes', params);
    return records.map(r => ({ id: r.id, ...r.fields }));
  }

  async function getClienteById(id) {
    const res = await fetch(`${baseUrl()}/Clientes/${id}`, { headers: headers() }).then(handleResponse);
    return { id: res.id, ...res.fields };
  }

  async function crearCliente(data) {
    const res = await fetch(`${baseUrl()}/Clientes`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ fields: { ...data, FechaCreacion: hoy(), UltimaActividad: hoy() } })
    }).then(handleResponse);
    await registrarLog({ tipo: 'cliente_creado', descripcion: `Cliente creado: ${data.Nombre}`, clienteEmail: data.Email, entidadId: res.id, estado: 'enviado' });
    return { id: res.id, ...res.fields };
  }

  async function actualizarCliente(id, data) {
    const res = await fetch(`${baseUrl()}/Clientes/${id}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ fields: { ...data, UltimaActividad: hoy() } })
    }).then(handleResponse);
    return { id: res.id, ...res.fields };
  }

  async function eliminarCliente(id) {
    await fetch(`${baseUrl()}/Clientes/${id}`, { method: 'DELETE', headers: headers() }).then(handleResponse);
  }

  // ── COTIZACIONES ──
  async function _nextNumeroCot() {
    const all = await fetchAll('Cotizaciones', '?fields[]=NumeroCot&sort[0][field]=NumeroCot&sort[0][direction]=desc');
    const year = new Date().getFullYear();
    let max = 0;
    all.forEach(r => {
      const m = (r.fields.NumeroCot || '').match(/COT-\d{4}-(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1]));
    });
    return `COT-${year}-${String(max + 1).padStart(3, '0')}`;
  }

  async function getCotizaciones(filtros = {}) {
    const clauses = [];
    if (filtros.estado) clauses.push(`{Estado}="${filtros.estado}"`);
    if (filtros.clienteId) clauses.push(`FIND("${filtros.clienteId}", ARRAYJOIN({ClienteID}))`);
    const filter = clauses.length ? `filterByFormula=AND(${clauses.join(',')})&` : '';
    const records = await fetchAll('Cotizaciones', `?${filter}sort[0][field]=FechaCreacion&sort[0][direction]=desc`);
    return records.map(r => ({ id: r.id, ...r.fields }));
  }

  async function getCotizacionById(id) {
    const res = await fetch(`${baseUrl()}/Cotizaciones/${id}`, { headers: headers() }).then(handleResponse);
    return { id: res.id, ...res.fields };
  }

  async function crearCotizacion(data) {
    const numero = await _nextNumeroCot();
    const res = await fetch(`${baseUrl()}/Cotizaciones`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ fields: { ...data, NumeroCot: numero, FechaCreacion: hoy(), Estado: data.Estado || 'Borrador' } })
    }).then(handleResponse);
    return { id: res.id, ...res.fields };
  }

  async function actualizarCotizacion(id, data) {
    const res = await fetch(`${baseUrl()}/Cotizaciones/${id}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ fields: data })
    }).then(handleResponse);
    return { id: res.id, ...res.fields };
  }

  // ── INVOICES ──
  async function _nextNumeroInv() {
    const all = await fetchAll('Invoices', '?fields[]=NumeroInv&sort[0][field]=NumeroInv&sort[0][direction]=desc');
    const year = new Date().getFullYear();
    let max = 0;
    all.forEach(r => {
      const m = (r.fields.NumeroInv || '').match(/INV-\d{4}-(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1]));
    });
    return `INV-${year}-${String(max + 1).padStart(3, '0')}`;
  }

  async function getInvoices(filtros = {}) {
    const clauses = [];
    if (filtros.estado) clauses.push(`{Estado}="${filtros.estado}"`);
    if (filtros.clienteId) clauses.push(`FIND("${filtros.clienteId}", ARRAYJOIN({ClienteID}))`);
    const filter = clauses.length ? `filterByFormula=AND(${clauses.join(',')})&` : '';
    const records = await fetchAll('Invoices', `?${filter}sort[0][field]=FechaCreacion&sort[0][direction]=desc`);
    return records.map(r => ({ id: r.id, ...r.fields }));
  }

  async function getInvoiceById(id) {
    const res = await fetch(`${baseUrl()}/Invoices/${id}`, { headers: headers() }).then(handleResponse);
    return { id: res.id, ...res.fields };
  }

  async function crearInvoice(data) {
    const numero = await _nextNumeroInv();
    const res = await fetch(`${baseUrl()}/Invoices`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ fields: { ...data, NumeroInv: numero, FechaCreacion: hoy(), Estado: 'Pendiente', TotalPagado: 0, PagosRecibidos: '[]' } })
    }).then(handleResponse);
    return { id: res.id, ...res.fields };
  }

  async function registrarPago(invoiceId, { monto, fecha, nota }) {
    const inv = await getInvoiceById(invoiceId);
    const pagos = parsearItems(inv.PagosRecibidos || '[]');
    pagos.push({ fecha: fecha || hoy(), monto: parseFloat(monto), nota: nota || '' });
    const totalPagado = pagos.reduce((s, p) => s + p.monto, 0);
    const saldo = (inv.Total || 0) - totalPagado;
    const estado = saldo <= 0 ? 'Pagada' : totalPagado > 0 ? 'Pago parcial' : 'Pendiente';
    const res = await fetch(`${baseUrl()}/Invoices/${invoiceId}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ fields: { PagosRecibidos: JSON.stringify(pagos), TotalPagado: totalPagado, Estado: estado } })
    }).then(handleResponse);
    await registrarLog({ tipo: 'pago_registrado', descripcion: `Pago $${monto} en ${inv.NumeroInv}`, entidadId: invoiceId, estado: 'enviado' });
    return { id: res.id, ...res.fields };
  }

  async function actualizarEstadoInvoice(id, estado) {
    const res = await fetch(`${baseUrl()}/Invoices/${id}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ fields: { Estado: estado } })
    }).then(handleResponse);
    return { id: res.id, ...res.fields };
  }

  // ── LOGS ──
  async function getLogs(limite = 20) {
    const records = await fetchAll('Logs', `?sort[0][field]=Fecha&sort[0][direction]=desc&maxRecords=${limite}`);
    return records.map(r => ({ id: r.id, ...r.fields }));
  }

  async function registrarLog({ tipo, descripcion, clienteEmail = '', entidadId = '', estado = 'enviado', detalle = '' }) {
    try {
      await fetch(`${baseUrl()}/Logs`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ fields: {
          Descripcion: descripcion, Fecha: new Date().toISOString(),
          Tipo: tipo, ClienteEmail: clienteEmail, EntidadID: entidadId,
          Estado: estado, DetalleError: detalle
        }})
      });
    } catch { /* logs no críticos */ }
  }

  return {
    getClientes, getClienteById, crearCliente, actualizarCliente, eliminarCliente,
    getCotizaciones, getCotizacionById, crearCotizacion, actualizarCotizacion,
    getInvoices, getInvoiceById, crearInvoice, registrarPago, actualizarEstadoInvoice,
    getLogs, registrarLog,
    parsearItems, calcularTotales, formatearMoneda, formatearFecha, hoy
  };
})();
