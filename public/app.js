// public/app.js
(() => {

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const API = {
    async get(url)  { const r = await fetch(`/api.php${url}`); if(!r.ok) throw new Error(await r.text()); return r.json(); },
    async post(url, body) { const r = await fetch(`/api.php${url}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{}) }); if(!r.ok) throw new Error(await r.text()); return r.json(); },
    async del(url)  { const r = await fetch(`/api.php${url}`, { method:'DELETE' }); if(!r.ok) throw new Error(await r.text()); return r.json(); },
    async patch(url, body) { const r = await fetch(`/api.php${url}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{}) }); if(!r.ok) throw new Error(await r.text()); return r.json(); },
  };

  const roundToMinute = (sec) => Math.round(Math.max(0, Number(sec) || 0) / 60) * 60;
  const fmtHMClock = (sec) => {
    const s = roundToMinute(sec);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    return `${h}:${m}`;
  };

  const api = {
    db: {
      clients:  { all: () => API.get('/clients'), create: (c) => API.post('/clients', c) },
      projects: { all: () => API.get('/projects'), create: (p) => API.post('/projects', p) },
      todos:    { all: () => API.get('/todos'), create: (t) => API.post('/todos', t) },
      time:     {
        recent: (n) => API.get(`/time/recent?limit=${encodeURIComponent(n||200)}`),
        add: (e) => API.post('/time/add', e),
        markInvoiced: (ids) => API.post('/time/markInvoiced', { ids })
      },
      invoices: {
        list: () => API.get('/invoices'),
        create: (p) => API.post('/invoices', p),
        nextNumber: () => API.get('/counters/nextInvoice'),
        preview: (p) => API.post('/invoices/preview', p),
        delete: (id) => API.del(`/invoices/${id}`),
        updateStatus: ({id,status}) => API.patch('/invoices/status', { id, status }),
      },
      metrics: {
        summaryRange: (p) => API.post('/metrics/summaryRange', p),
        uninvoicedAmount: () => API.get('/metrics/uninvoicedAmount'),
      }
    },
    ready: (cb) => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', cb) : cb(),
  };


  const state = {
    clients: [], projects: [], todos: [], recent: [],
    clientsById: {}, projectsById: {}, todosById: {},
    timer: { running: false, startAt: null, tickId: null },
  };

  async function load() {
    const [c, p, t, r] = await Promise.all([
      api.db.clients.all().catch(() => []),
      api.db.projects.all().catch(() => []),
      api.db.todos.all().catch(() => []),
      api.db.time.recent(200).catch(() => []),
    ]);
    state.clients  = c; state.projects = p; state.todos = t; state.recent = r;
    state.clientsById  = Object.fromEntries(state.clients.map(c1 => [c1.id, c1]));
    state.projectsById = Object.fromEntries(state.projects.map(p1 => [p1.id, p1]));
    state.todosById    = Object.fromEntries(state.todos.map(t1 => [t1.id, t1]));
  }

  function table(el, cols, rows) {
    el.innerHTML = `<div class="table"><table>
      <thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }
  const val = (root, sel) => root.querySelector(sel)?.value?.trim() || '';

  function rateFor(project, client) {
    if (project && project.rateOverride != null) return Number(project.rateOverride);
    return Number(client?.defaultRate || 0);
  }
  function fmtMoney(x, currency) {
    return `${currency || 'USD'} ${Number(x || 0).toFixed(2)}`;
  }

  function openModal(title, bodyHTML, onSubmit) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">${bodyHTML}</div>
        <div class="modal-footer">
          <button class="btn" data-role="cancel">Cancel</button>
          <button class="btn primary" data-role="ok">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.modal-close') || e.target.matches('[data-role="cancel"]')) close();
    });
    overlay.querySelector('[data-role="ok"]').addEventListener('click', async () => {
      try { await onSubmit(overlay); close(); } catch (err) { console.error(err); alert('Save failed'); }
    });
    return overlay;
  }

  function mount(page) {
    const host = $('main#page');
    host.innerHTML = '';
    host.appendChild(document.querySelector(`#tpl-${page}`).content.cloneNode(true));
    if (page === 'dashboard') renderDashboard();
    if (page === 'tracker')   renderTracker();
    if (page === 'clients')   renderClients();
    if (page === 'projects')  renderProjects();
    if (page === 'todos')     renderTodos();
    if (page === 'invoices')  renderInvoices();
    if (page === 'reports')   renderReports();
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  }

  function renderDashboard() {
    const startOfToday = () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); };
    const endOfToday   = () => { const d = new Date(); d.setHours(23,59,59,999); return d.toISOString().slice(0,10); };
    const startOfWeek  = () => { const d = new Date(); const diff=(d.getDay()+6)%7; d.setDate(d.getDate()-diff); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); };
    const endOfWeek    = () => new Date().toISOString().slice(0,10);
    const fmtHMwords   = (sec) => { const s=roundToMinute(sec); const h=Math.floor(s/3600); const m=Math.floor((s%3600)/60); return `${h}h ${m}m`; };

    async function loadMetrics() {
      const today = await api.db.metrics.summaryRange({ startIso: startOfToday(), endIso: endOfToday() }).catch(()=>({ totals:{ totalSeconds:0 }, byClient:[] }));
      const week  = await api.db.metrics.summaryRange({ startIso: startOfWeek(),  endIso: endOfWeek() }).catch(()=>({ totals:{ totalSeconds:0, billableSeconds:0 }, byClient:[] }));
      const uninv = await api.db.metrics.uninvoicedAmount().catch(()=>0);

      $('#dashToday').textContent = fmtHMwords(today.totals.totalSeconds || 0);
      $('#dashWeek').textContent  = fmtHMwords(week.totals.totalSeconds || 0);
      $('#dashBillableWeek').textContent = fmtHMwords(week.totals.billableSeconds || 0);
      $('#dashUninv').textContent = (state.clients[0]?.currency || 'USD') + ' ' + Number(uninv).toFixed(2);

      const rows = (week.byClient || []).filter(r => r.totalSeconds > 0).map(r => [ r.clientName, fmtHMwords(r.totalSeconds), fmtHMwords(r.billableSeconds) ]);
      table($('#dashClientTable'), ['Client','Hours (total)','Hours (billable)'], rows.length ? rows : [['—','—','—']]);
    }
    loadMetrics();
  }

  function renderTracker() {
    const disp = $('#trkDisplay');
    const sBtn = $('#trkStart');
    const xBtn = $('#trkStop');
    const note = $('#trkNote');
    const cSel = $('#trkClient');
    const pSel = $('#trkProject');
    const tSel = $('#trkTodo');
    if (!disp || !sBtn || !xBtn || !cSel || !pSel || !tSel) return;

    function fillClients() {
      cSel.innerHTML = `<option value="">Select client...</option>` + state.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }
    function fillProjects(clientId) {
      const list = state.projects.filter(p => !clientId || p.clientId === clientId);
      pSel.innerHTML = `<option value="">${clientId ? 'Select project...' : 'First select a client'}</option>` + list.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }
    function fillTodos(projectId) {
      const list = state.todos.filter(t => !projectId || t.projectId === projectId);
      tSel.innerHTML = `<option value="">${projectId ? 'Select to-do...' : 'First select a project'}</option>` + list.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
    }
    fillClients(); fillProjects(); fillTodos();
    cSel.onchange = () => { fillProjects(cSel.value); tSel.innerHTML = `<option value="">First select a project</option>`; };
    pSel.onchange = () => { fillTodos(pSel.value); };

    const tick = () => {
      if (!state.timer.running || !state.timer.startAt) { disp.textContent = '00:00'; return; }
      const sec = Math.floor((Date.now() - state.timer.startAt) / 1000);
      disp.textContent = fmtHMClock(sec);
    };
    clearInterval(state.timer.tickId);
    state.timer.tickId = setInterval(tick, 500);
    tick();

    sBtn.onclick = () => {
      if (state.timer.running) return;
      if (!cSel.value || !pSel.value) { alert('Please select Client and Project.'); return; }
      state.timer.running = true;
      state.timer.startAt = Date.now();
      tick();
    };

    xBtn.onclick = async () => {
      if (!state.timer.running) return;
      if (!cSel.value || !pSel.value) { alert('Please select Client and Project.'); return; }
      state.timer.running = false;

      const endAt = new Date();
      const startAt = new Date(state.timer.startAt);
      const seconds = Math.max(1, Math.floor((endAt - startAt) / 1000));

      try {
        await api.db.time.add({
          clientId: String(cSel.value),
          projectId: String(pSel.value),
          todoId: tSel.value ? String(tSel.value) : null,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          durationSeconds: seconds,
          note: (note?.value || '').trim(),
          billable: true,
        });
      } catch (e) { console.error(e); alert('Failed to save time entry.'); }

      try { state.recent = await api.db.time.recent(200); } catch { state.recent = []; }
      drawRecent();
      state.timer.startAt = null;
      tick();
    };

    const host = $('#entriesTable');
    drawRecent();

    $('#exportCsv')?.addEventListener('click', () => {
      const header = ['Date','Client','Project>To-do','Begin','End','Duration','Hourly rate','Logged amount'];
      const rows = state.recent.map(e => {
        const client  = state.clientsById[e.clientId];
        const project = state.projectsById[e.projectId];
        const todo    = state.todosById[e.todoId];
        const rate    = rateFor(project, client);
        const secR    = roundToMinute(e.durationSeconds);
        const hours   = secR / 3600;
        const amount  = Number((hours * rate).toFixed(2));
        const currency= client?.currency || 'USD';
        return [
          e.startAt?.slice(0,10) || '',
          client?.name || '',
          `${project?.name || ''}${todo?.title ? (' > ' + todo.title) : ''}`,
          e.startAt?.slice(11,19) || '',
          e.endAt?.slice(11,19) || '',
          fmtHMClock(e.durationSeconds),
          fmtMoney(rate, currency),
          fmtMoney(amount, currency)
        ];
      });
      const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'time_entries.csv'; a.click(); URL.revokeObjectURL(a.href);
    });

    function drawRecent() {
      const rows = state.recent.map(e => {
        const client  = state.clientsById[e.clientId];
        const project = state.projectsById[e.projectId];
        const todo    = state.todosById[e.todoId];

        const rate    = rateFor(project, client);
        const secR    = roundToMinute(e.durationSeconds);
        const hours   = secR / 3600;
        const amount  = Number((hours * rate).toFixed(2));
        const cur     = client?.currency || 'USD';

        return [
          e.startAt?.slice(0,10) || '',
          client?.name || '',
          `${project?.name || ''}${todo?.title ? (' > ' + todo.title) : ''}`,
          e.startAt?.slice(11,19) || '',
          e.endAt?.slice(11,19) || '',
          fmtHMClock(e.durationSeconds),
          fmtMoney(rate, cur),
          fmtMoney(amount, cur)
        ];
      });
      table(host, ['Date','Client','Project > To-do','Begin','End','Duration','Hourly rate','Logged amount'], rows);
    }
  }

  function renderClients() {
    drawClients();
    $('#addClient')?.addEventListener('click', () => {
      openModal('Add Client', `
        <div class="form-grid">
          <label>Name<input id="fName" autofocus/></label>
          <label>Email<input id="fEmail" type="email"/></label>
          <label>Address<textarea id="fAddress" rows="2"></textarea></label>
          <div class="grid-2">
            <label>Currency
              <select id="fCurrency"><option>USD</option><option>EUR</option><option>GBP</option></select>
            </label>
            <label>Default Rate (per hour)
              <input id="fRate" type="number" min="0" step="0.01" value="0"/>
            </label>
          </div>
        </div>`,
      async (ov) => {
        const name = ov.querySelector('#fName').value.trim(); if (!name) { alert('Name required'); return; }
        await api.db.clients.create({
          name,
          email: ov.querySelector('#fEmail').value.trim(),
          address: ov.querySelector('#fAddress').value.trim(),
          currency: ov.querySelector('#fCurrency').value || 'USD',
          defaultRate: Number(ov.querySelector('#fRate').value) || 0,
        });
        await load(); drawClients();
      });
    });
  }
  function drawClients() {
    const host = $('#clientsTable'); if (!host) return;
    const rows = state.clients.map(c => [c.name, c.email || '', String(c.defaultRate ?? 0), c.currency || '']);
    table(host, ['Name', 'Email', 'Rate', 'Currency'], rows);
  }

  function renderProjects() {
    drawProjects();
    $('#addProject')?.addEventListener('click', () => {
      if (!state.clients.length) { alert('Create a client first.'); return; }
      const clientOptions = state.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      openModal('Add Project', `
        <div class="form-grid">
          <label>Name<input id="pName" autofocus/></label>
          <div class="grid-2">
            <label>Client<select id="pClient">${clientOptions}</select></label>
            <label>Rate Override (optional)<input id="pRate" type="number" min="0" step="0.01" placeholder="leave blank"/></label>
          </div>
          <label>Status
            <select id="pStatus"><option value="active">active</option><option value="archived">archived</option></select>
          </label>
        </div>`,
      async (ov) => {
        const name = ov.querySelector('#pName').value.trim(); if (!name) { alert('Project name required'); return; }
        const rateStr = ov.querySelector('#pRate').value.trim();
        await api.db.projects.create({
          name,
          clientId: ov.querySelector('#pClient').value,
          rateOverride: rateStr === '' ? null : Number(rateStr),
          status: ov.querySelector('#pStatus').value || 'active',
        });
        await load(); drawProjects();
      });
    });
  }
  function drawProjects() {
    const host = $('#projectsTable'); if (!host) return;
    const rows = state.projects.map(p => [
      p.name,
      (state.clientsById[p.clientId]?.name) || p.clientId || '',
      p.status || 'active',
      (p.rateOverride ?? '') === '' ? '' : String(p.rateOverride),
    ]);
    table(host, ['Name', 'Client', 'Status', 'Rate Override'], rows);
  }

  function renderTodos() {
    drawTodos();
    $('#addTodo')?.addEventListener('click', () => {
      if (!state.projects.length) { alert('Create a project first.'); return; }
      const opts = state.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      openModal('Add To-do', `
        <div class="form-grid">
          <label>Title<input id="tTitle" autofocus/></label>
          <div class="grid-2">
            <label>Project<select id="tProject">${opts}</select></label>
            <label>Estimate (minutes)<input id="tEst" type="number" min="0" step="1" value="60"/></label>
          </div>
          <label>Status
            <select id="tStatus"><option value="open">open</option><option value="done">done</option></select>
          </label>
        </div>`,
      async (ov) => {
        const title = ov.querySelector('#tTitle').value.trim(); if (!title) { alert('Title required'); return; }
        await api.db.todos.create({
          title,
          projectId: ov.querySelector('#tProject').value,
          estimateMinutes: Number(ov.querySelector('#tEst').value) || 0,
          status: ov.querySelector('#tStatus').value || 'open',
        });
        await load(); drawTodos();
      });
    });
  }
  function drawTodos() {
    const host = $('#todosTable'); if (!host) return;
    const rows = state.todos.map(t => [
      t.title,
      (state.projectsById[t.projectId]?.name) || t.projectId || '',
      t.status || 'open',
    ]);
    table(host, ['Title', 'Project', 'Status'], rows);
  }

  function renderInvoices() {
    const tableHost = $('#invoicesTable');

    async function refreshList() {
      const rows = await api.db.invoices.list().catch(()=>[]);
      const display = rows.map(r => [
        r.number, r.issueDate, r.dueDate, r.status, `${r.currency || 'USD'} ${Number(r.grandTotal).toFixed(2)}`
      ]);
      table(tableHost, ['Number','Issue Date','Due Date','Status','Amount'], display);
    }
    refreshList();

    const newBtn = $('#btnNewInvoice');
    if (!newBtn) return;

    newBtn.onclick = async () => {
      const clientOptions = state.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      const modal = openModal('Create Invoice', `
        <div class="form-grid">
          <label>Client <select id="invClient">${clientOptions}</select></label>
          <label>Period
            <select id="invPeriod">
              <option value="week">This week</option>
              <option value="lastweek">Last week</option>
              <option value="month">This month</option>
              <option value="lastmonth">Last month</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <div class="grid-2">
            <label>Start <input id="invStart" type="date"/></label>
            <label>End   <input id="invEnd" type="date"/></label>
          </div>
          <label>Project (optional) <select id="invProject"><option value="">All projects</option></select></label>
          <div class="hr"></div>
          <div id="previewBox" style="max-height:270px; overflow:auto; border:1px solid var(--border); border-radius:10px; padding:8px; background:#fafafa">
            <em>Choose options then click “Preview”.</em>
          </div>
          <div style="display:flex; gap:8px; margin-top:8px">
            <button id="btnPreview" class="btn">Preview</button>
            <button id="btnAddManual" class="btn">Add Manual Line</button>
          </div>
        </div>
      `, async () => {
        if (!currentPreview || !currentPreview.lines.length) { alert('No lines to invoice.'); return; }
        const number = await api.db.invoices.nextNumber();
        const today  = new Date().toISOString().slice(0,10);
        const due    = new Date(Date.now()+14*86400000).toISOString().slice(0,10);

        const payload = {
          clientId: selClient.value,
          number,
          issueDate: today,
          dueDate: due,
          currency: currentPreview.currency,
          status: 'draft',
          totals: currentPreview.totals,
          lines: currentPreview.lines
        };
        await api.db.invoices.create(payload);
        const ids = currentPreview.lines.map(l=>l.entryId).filter(Boolean);
        if (ids.length) await api.db.time.markInvoiced(ids);
        await load(); await refreshList();
      });

      const selClient   = modal.querySelector('#invClient');
      const selPeriod   = modal.querySelector('#invPeriod');
      const inputStart  = modal.querySelector('#invStart');
      const inputEnd    = modal.querySelector('#invEnd');
      const selProject  = modal.querySelector('#invProject');
      const previewBox  = modal.querySelector('#previewBox');
      const btnPreview  = modal.querySelector('#btnPreview');
      const btnManual   = modal.querySelector('#btnAddManual');

      function refreshProjectOptions() {
        const cid = selClient.value;
        const opts = state.projects.filter(p => p.clientId === cid).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        selProject.innerHTML = `<option value="">All projects</option>` + opts;
      }
      function setDatesFromPeriod() {
        const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
        const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay()+6)%7)); monday.setHours(0,0,0,0);
        const lastMon = new Date(monday); lastMon.setDate(monday.getDate()-7);
        const lastSun = new Date(monday); lastSun.setDate(monday.getDate()-1);
        const firstOfMonth = new Date(y, m, 1);
        const firstOfLast  = new Date(y, m-1, 1);
        const endOfLast    = new Date(y, m, 0);
        const set = (a,b)=>{ inputStart.value = a.toISOString().slice(0,10); inputEnd.value = b.toISOString().slice(0,10); };
        const v = selPeriod.value;
        if (v==='week') set(monday, now);
        else if (v==='lastweek') set(lastMon, lastSun);
        else if (v==='month') set(firstOfMonth, now);
        else if (v==='lastmonth') set(firstOfLast, endOfLast);
      }

      let currentPreview = null;

      function renderPreview(p) {
        if (!p || !p.lines) { previewBox.innerHTML = '<em>Choose options then click “Preview”.</em>'; return; }
        const rows = p.lines.map((l, idx) => `
          <tr>
            <td>${l.date||''}</td>
            <td>${l.start||''}</td>
            <td>${l.end||''}</td>
            <td>${l.project||''}</td>
            <td>${fmtHMClock(l.displaySeconds)}</td>
            <td><input data-i="${idx}" data-k="description" value="${(l.description||'').replace(/"/g,'&quot;')}" /></td>
            <td><input data-i="${idx}" data-k="rate" type="number" step="0.01" value="${l.rate}"/></td>
            <td>${p.currency} ${l.amount.toFixed(2)}</td>
          </tr>`).join('');

        const totalRounded = roundToMinute(p.totals.hoursSeconds || 0);
        previewBox.innerHTML = `
          <table class="wfull">
            <thead><tr>
              <th>Date</th><th>Start</th><th>End</th><th>Project</th><th>Duration</th>
              <th>Description</th><th>Rate</th><th>Amount</th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="8"><em>No unbilled entries in this range.</em></td></tr>'}</tbody>
          </table>
          <div style="margin-top:8px; display:flex; gap:12px; justify-content:flex-end">
            <div>Total hours: ${fmtHMClock(totalRounded)}</div>
            <div>Subtotal: ${p.currency} ${p.totals.subtotal.toFixed(2)}</div>
            <div><strong>Grand Total: ${p.currency} ${p.totals.grandTotal.toFixed(2)}</strong></div>
          </div>`;
        previewBox.querySelectorAll('input[data-i]').forEach(inp=>{
          inp.addEventListener('input', ()=>{
            const i = Number(inp.dataset.i), k = inp.dataset.k;
            const line = p.lines[i];
            if (k==='description') line.description = inp.value;
            if (k==='rate') {
              const r = Number(inp.value) || 0;
              line.rate = r;
              const rs = roundToMinute(line.displaySeconds);
              const hours = rs / 3600;
              line.amount = Number((hours * r).toFixed(2));
              p.totals.subtotal = Number(p.lines.reduce((sum, li)=> sum + li.amount, 0).toFixed(2));
              p.totals.grandTotal = p.totals.subtotal;
              renderPreview(p);
            }
          });
        });
      }

      let tId = null;
      const debouncedPreview = () => {
        clearTimeout(tId);
        tId = setTimeout(async () => {
          const payload = {
            clientId: selClient.value,
            projectId: selProject.value || null,
            startIso:  inputStart.value,
            endIso:    inputEnd.value
          };
          if (!payload.clientId || !payload.startIso || !payload.endIso) {
            previewBox.innerHTML = '<em>Choose options then click “Preview”.</em>'; return;
          }
          try { currentPreview = await api.db.invoices.preview(payload); renderPreview(currentPreview); }
          catch (e) { console.error(e); previewBox.innerHTML = `<em style="color:#c00">Preview failed</em>`; }
        }, 250);
      };

      btnPreview.onclick = debouncedPreview;
      selClient.onchange  = () => { refreshProjectOptions(); debouncedPreview(); };
      selProject.onchange = debouncedPreview;
      inputStart.oninput  = debouncedPreview;
      inputEnd.oninput    = debouncedPreview;
      selPeriod.onchange  = () => { setDatesFromPeriod(); debouncedPreview(); };
      refreshProjectOptions();
      setDatesFromPeriod();
      debouncedPreview();

      btnManual.onclick = () => {
        if (!currentPreview) {
          currentPreview = { lines: [], totals: { hoursSeconds: 0, subtotal: 0, tax:0, discount:0, grandTotal:0 }, currency: 'USD' };
        }
        openModal('Add Manual Line', `
          <div class="form-grid">
            <div class="grid-2">
              <label>Date <input id="mlDate" type="date"/></label>
              <label>Project <input id="mlProject" placeholder="e.g., General"/></label>
            </div>
            <label>Description <input id="mlDesc"/></label>
            <div class="grid-2">
              <label>Hours (decimal) <input id="mlHours" type="number" min="0" step="0.01" value="1"/></label>
              <label>Rate <input id="mlRate" type="number" min="0" step="0.01" value="0"/></label>
            </div>
          </div>`,
        async (ov) => {
          const hours = Number(ov.querySelector('#mlHours').value) || 0;
          const rate  = Number(ov.querySelector('#mlRate').value)  || 0;
          const sec   = roundToMinute(Math.round(hours * 3600));
          const amt   = Number(((sec/3600) * rate).toFixed(2));
          currentPreview.lines.push({
            entryId: null,
            date: ov.querySelector('#mlDate').value || new Date().toISOString().slice(0,10),
            start: '', end: '',
            project: ov.querySelector('#mlProject').value || '',
            description: ov.querySelector('#mlDesc').value || 'Manual',
            _seconds: sec,
            displaySeconds: sec,
            rate, amount: amt
          });
          currentPreview.totals.hoursSeconds += sec;
          currentPreview.totals.subtotal = Number((currentPreview.totals.subtotal + amt).toFixed(2));
          currentPreview.totals.grandTotal = currentPreview.totals.subtotal;
          renderPreview(currentPreview);
        });
      };
    };
  }

  function renderReports() {
    $('#reportContent').textContent = 'Reports coming soon';
  }

  async function boot() {
    await load();
    $$('.nav-item').forEach(b => b.onclick = () => mount(b.dataset.page));
    mount('tracker');
  }
  api.ready(boot);
})();
