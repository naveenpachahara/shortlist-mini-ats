const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = localStorage.getItem('token'), name = localStorage.getItem('name');
let stage = '', search = '', page = 1, pages = 1, registering = false, cache = [];

async function api(url, method = 'GET', body) {
  const r = await fetch('/api' + url, {
    method, body: body && JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) logout();
  if (!r.ok) throw new Error(d.error || 'Request failed.');
  return d;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }

// ---- Auth ----
function show() {
  $('#auth').hidden = !!token; $('#app').hidden = !token;
  if (token) { $('#who').textContent = name; refresh(); }
}
function logout() { token = null; localStorage.clear(); show(); }
$('#logout').onclick = logout;
$('#authSwitch').onclick = () => {
  registering = !registering;
  $('#nameRow').hidden = !registering;
  $('#authBtn').textContent = registering ? 'Create account' : 'Sign in';
  $('#authSwitch').textContent = registering ? 'I already have an account' : 'Create an account';
  $('#authLead').textContent = registering ? 'Create an account to start tracking candidates.' : 'Sign in to manage your hiring pipeline.';
};
$('#authForm').onsubmit = async e => {
  e.preventDefault(); $('#authErr').textContent = '';
  const f = Object.fromEntries(new FormData(e.target));
  try {
    const d = await api(registering ? '/auth/register' : '/auth/login', 'POST', f);
    token = d.token; name = d.name; localStorage.setItem('token', token); localStorage.setItem('name', name);
    e.target.reset(); show();
  } catch (err) { $('#authErr').textContent = err.message; }
};

// ---- Dashboard + pipeline ----
async function loadDashboard() {
  const d = await api('/dashboard');
  $('#sTotal').textContent = d.total; $('#sActive').textContent = d.active;
  $('#sWeek').textContent = d.newThisWeek; $('#sRate').textContent = d.hireRate + '%';
  $('#sRoles').innerHTML = d.topRoles.length ? d.topRoles.map(r => `${esc(r.role)} (${r.count})`).join('<br>') : '–';
  $('#pipeline').innerHTML = STAGES.map(s => `
    <button data-s="${s}" aria-pressed="${stage === s}">
      <small>${s}</small><span class="n">${d.stages[s]}</span>
      <span class="bar"><i style="width:${d.total ? d.stages[s] / d.total * 100 : 0}%;background:var(--${s})"></i></span>
    </button>`).join('');
}
$('#pipeline').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  stage = stage === b.dataset.s ? '' : b.dataset.s; page = 1; refresh();
};

// ---- Candidate list ----
async function loadList() {
  const qs = new URLSearchParams({ search, stage, page });
  const d = await api('/candidates?' + qs);
  cache = d.items; pages = d.pages; page = d.page;
  $('#rows').innerHTML = d.items.map(c => `
    <tr data-id="${c._id}">
      <td><b>${esc(c.name)}</b><small>${esc(c.email)}${c.phone ? ' · ' + esc(c.phone) : ''}</small></td>
      <td>${esc(c.role)}</td>
      <td>${c.skills.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</td>
      <td>${c.experience} yr</td>
      <td><select class="stage-sel" aria-label="Stage for ${esc(c.name)}" style="border-left-color:var(--${c.stage})">
        ${STAGES.map(s => `<option ${s === c.stage ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td class="row-actions"><button class="link edit">Edit</button><button class="link del">Delete</button></td>
    </tr>`).join('');
  const em = $('#empty'); em.hidden = d.items.length > 0;
  em.textContent = search || stage ? 'No candidates match this search. Clear the filters to see everyone.' : 'No candidates yet. Add your first one to start the pipeline.';
  $('#pageInfo').textContent = `Page ${page} of ${pages} · ${d.total} candidate${d.total === 1 ? '' : 's'}`;
  $('#prev').disabled = page <= 1; $('#next').disabled = page >= pages;
}
const refresh = () => Promise.all([loadDashboard(), loadList()]).catch(e => toast(e.message));
$('#prev').onclick = () => { page--; loadList(); };
$('#next').onclick = () => { page++; loadList(); };
let t; $('#search').oninput = e => { clearTimeout(t); t = setTimeout(() => { search = e.target.value; page = 1; loadList(); }, 250); };

$('#rows').onchange = async e => {
  if (!e.target.classList.contains('stage-sel')) return;
  const id = e.target.closest('tr').dataset.id;
  try { await api(`/candidates/${id}/stage`, 'PATCH', { stage: e.target.value }); toast('Stage updated'); refresh(); }
  catch (err) { toast(err.message); }
};
$('#rows').onclick = async e => {
  const id = e.target.closest('tr')?.dataset.id; if (!id) return;
  if (e.target.classList.contains('edit')) openForm(cache.find(c => c._id === id));
  if (e.target.classList.contains('del') && confirm('Delete this candidate? This cannot be undone.')) {
    try { await api('/candidates/' + id, 'DELETE'); toast('Candidate deleted'); refresh(); } catch (err) { toast(err.message); }
  }
};

// ---- Add / edit dialog ----
const form = $('#candForm');
form.stage.innerHTML = STAGES.map(s => `<option>${s}</option>`).join('');
function openForm(c) {
  form.reset(); $('#formErr').textContent = '';
  $('#dlgTitle').textContent = c ? 'Edit candidate' : 'Add candidate';
  form.id.value = c?._id || '';
  if (c) for (const k of ['name', 'email', 'phone', 'role', 'experience', 'notes', 'stage']) form[k].value = c[k] ?? '';
  if (c) form.skills.value = c.skills.join(', ');
  $('#dlg').showModal();
}
$('#addBtn').onclick = () => openForm();
$('#cancel').onclick = () => $('#dlg').close();
form.onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form)); const id = f.id; delete f.id;
  try {
    await api(id ? '/candidates/' + id : '/candidates', id ? 'PUT' : 'POST', f);
    $('#dlg').close(); toast(id ? 'Candidate updated' : 'Candidate added'); refresh();
  } catch (err) { $('#formErr').textContent = err.message; }
};

show();
