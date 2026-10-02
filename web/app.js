const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const inr = n => '₹' + Number(n).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const isIn = t => ['DEPOSIT', 'TRANSFER IN', 'FD CLOSED', 'LOAN CREDIT'].includes(t);
let token = sessionStorage.getItem('tok'), role = sessionStorage.getItem('role'), H = [], ACC = [];

function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(toast.h); toast.h = setTimeout(() => t.className = '', 3200); }
async function api(path, data) {
  const opt = {headers: {'X-Token': token || ''}};
  if (data) { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opt.body = new URLSearchParams(data); }
  const r = await fetch('/api/' + path, opt), j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j;
}
// ---------- page router ----------
const LOAD = {};
function go(p) {
  const el = $('#pg-' + p); if (!el) return;
  [...el.parentElement.children].filter(c => c.classList.contains('pg')).forEach(c => c.hidden = c !== el);
  const hl = p === 'ahist' ? 'accs' : p; $$('.side button').forEach(b => b.classList.toggle('on', b.dataset.go === hl));
  window.scrollTo({top: 0, behavior: 'smooth'}); if (LOAD[p]) Promise.resolve(LOAD[p]()).catch(e => toast(e.message, true));
}
document.addEventListener('click', e => { if (e.target.closest('[data-out]')) { logout(); return; } const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
function view(v) { ['authView', 'userView', 'adminView'].forEach(x => $('#' + x).hidden = x !== v); }
function nav(t) { $('#navRight').innerHTML = t ? `<span class="pill">${t}</span><button class="out" id="lo">Logout</button>` : ''; if (t) $('#lo').onclick = logout; }
function setSession(t, r) { token = t; role = r; sessionStorage.setItem('tok', t); sessionStorage.setItem('role', r); }
function logout() { if (token) api('logout', {}).catch(() => {}); token = role = null; sessionStorage.clear(); nav(''); view('authView'); go('home'); }
function bind(id, fn) { $('#' + id).addEventListener('submit', async e => { e.preventDefault(); try { await fn(Object.fromEntries(new FormData(e.target)), e.target); } catch (err) { toast(err.message, true); } }); }
function count(el, to) { const t0 = performance.now(); (function f(t) { const p = Math.min((t - t0) / 900, 1); el.textContent = inr(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); })(t0); }
function txRows(list, bal) {
  if (!list.length) return '<tr><td colspan="6" style="text-align:center;color:#999">No transactions found</td></tr>';
  return list.map(t => `<tr><td>${esc(t.time)}</td><td>${esc(bal ? t.id : t.acc)}</td><td>${esc(t.type)}</td><td>${esc(t.desc)}</td>
    <td class="r ${isIn(t.type) ? 'in' : 'outc'}">${isIn(t.type) ? '+' : '-'}${inr(t.amount)}</td>${bal ? `<td class="r">${inr(t.balance)}</td>` : ''}</tr>`).join('');
}
// ---------- charts (pure SVG) ----------
function lineChart(vals) {
  if (vals.length < 2) return '<p class="mut">Make a few transactions to see your balance trend.</p>';
  const W = 700, Hh = 220, p = 30, mx = Math.max(...vals) * 1.1, mn = Math.min(...vals) * 0.9;
  const X = i => p + i * (W - 2 * p) / (vals.length - 1), Y = v => Hh - p - (v - mn) / ((mx - mn) || 1) * (Hh - 2 * p);
  const pts = vals.map((v, i) => X(i) + ',' + Y(v)).join(' ');
  return `<svg viewBox="0 0 ${W} ${Hh}" width="100%"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b82f6" stop-opacity=".45"/><stop offset="1" stop-color="#3b82f6" stop-opacity="0"/></linearGradient></defs>
  <polygon points="${X(0)},${Hh - p} ${pts} ${X(vals.length - 1)},${Hh - p}" fill="url(#g)"/><polyline points="${pts}" fill="none" stroke="#3b82f6" stroke-width="3" stroke-linejoin="round" class="draw"/>
  ${vals.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="4.5" fill="#e0b341"><title>${inr(v)}</title></circle>`).join('')}<text x="${p}" y="14">High ${inr(Math.max(...vals))}</text></svg>`;
}
function barChart(items) {
  if (!items.length) return '<p class="mut">No accounts yet.</p>';
  const mx = Math.max(...items.map(i => +i.balance)) || 1;
  return items.map((a, i) => `<div style="display:flex;align-items:center;gap:12px;margin:9px 0"><span style="width:130px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</span>
  <div style="flex:1;background:var(--line);border-radius:9px;overflow:hidden"><div style="width:${Math.max(3, a.balance / mx * 100)}%;height:20px;border-radius:9px;background:linear-gradient(90deg,#3b82f6,${i ? '#6d3fc0' : '#e0b341'})"></div></div><b style="font-size:13px;width:110px;text-align:right">${inr(a.balance)}</b></div>`).join('');
}
// ---------- Customer ----------
function renderHist() {
  const q = $('#q').value.toLowerCase(), f = $('#flt').value;
  $('#uHist').innerHTML = txRows(H.filter(t => (!f || (f === 'in') === isIn(t.type)) && (t.desc + t.type + t.id + t.time).toLowerCase().includes(q)), true);
}
async function loadUser(first) {
  try {
    const [me, h] = await Promise.all([api('me'), api('history')]); H = h;
    view('userView'); nav('👤 ' + esc(me.name.split(' ')[0])); if (first) go('dash');
    const hr = new Date().getHours();
    $('#uHello').textContent = (hr < 12 ? 'Good morning, ' : hr < 17 ? 'Good afternoon, ' : 'Good evening, ') + me.name.split(' ')[0] + ' 👋';
    count($('#uBal'), +me.balance); $$('.bn').forEach(x => x.textContent = inr(me.balance)); $('#uName').textContent = me.name.toUpperCase(); $('#uType').textContent = (me.type || 'Savings').toUpperCase() + ' ACCOUNT'; $('#minTxt').textContent = me.type === 'Current' ? '₹1,000' : '₹500';
    $('#uNum').textContent = me.number.replace(/(\d{4})(?=\d)/g, '$1 '); $('#uSince').textContent = me.created.split(',')[0];
    const tin = h.filter(t => isIn(t.type)).reduce((s, t) => s + +t.amount, 0), tout = h.filter(t => !isIn(t.type)).reduce((s, t) => s + +t.amount, 0);
    $('#tIn').textContent = inr(tin); $('#tOut').textContent = inr(tout); $('#tCnt').textContent = h.length;
    $('#donut').innerHTML = donut(tin, tout); $('#chart').innerHTML = lineChart([...h].reverse().slice(-14).map(t => +t.balance)); $('#uRecent').innerHTML = txRows(h.slice(0, 5), true); renderHist();
  } catch (e) { logout(); toast(e.message, true); }
}
// ---------- Admin ----------
function renderAcc() {
  const q = $('#aq').value.toLowerCase(), L = ACC.filter(x => (x.name + x.number + x.phone).toLowerCase().includes(q));
  $('#aAcc').innerHTML = L.length ? L.map(x => `<tr><td>${x.number}</td><td><span class="tag ${x.type === 'Current' ? 'f2' : 'a'}">${esc(x.type || 'Savings')}</span></td><td>${esc(x.name)}</td><td>${esc(x.phone)}</td><td>${esc(x.email)}</td><td class="r">${inr(x.balance)}</td>
    <td><span class="tag ${x.frozen ? 'f' : 'a'}">${x.frozen ? 'Frozen' : 'Active'}</span></td>
    <td><button class="sm" data-v="${x.number}">History</button><button class="sm ${x.frozen ? '' : 'red'}" data-f="${x.number}">${x.frozen ? 'Unfreeze' : 'Freeze'}</button></td></tr>`).join('')
    : '<tr><td colspan="8" style="text-align:center;color:#999">No accounts found</td></tr>';
  $$('[data-v]').forEach(b => b.onclick = async () => { try { const h = await api('admin/history?account=' + b.dataset.v);
    $('#histTitle').textContent = 'History of account ' + b.dataset.v; $('#aHist').innerHTML = txRows(h, true); go('ahist'); } catch (e) { toast(e.message, true); } });
  $$('[data-f]').forEach(b => b.onclick = async () => { try { await api('admin/toggle', {account: b.dataset.f}); toast('Account status updated'); loadAdmin(); } catch (e) { toast(e.message, true); } });
}
async function loadAdmin(first) {
  try {
    const [a, t] = await Promise.all([api('admin/accounts'), api('admin/transactions')]); ACC = a.accounts;
    view('adminView'); nav('🛡️ Admin'); if (first) go('ovr');
    const tot = ACC.reduce((s, x) => s + +x.balance, 0);
    $('#sCus').textContent = ACC.length; count($('#sDep'), tot); $('#sFz').textContent = ACC.filter(x => x.frozen).length; $('#sAvg').textContent = inr(ACC.length ? tot / ACC.length : 0);
    $('#bars').innerHTML = barChart([...ACC].sort((x, y) => y.balance - x.balance).slice(0, 6));
    $('#aTx').innerHTML = txRows(t, false).replace('colspan="6"', 'colspan="5"'); renderAcc();
  } catch (e) { logout(); toast(e.message, true); }
}
// ---------- Wiring ----------
$('#q').oninput = $('#flt').onchange = renderHist; $('#aq').oninput = renderAcc; $('#prt').onclick = () => window.print();
$('#csv').onclick = () => {
  const rows = [['Date', 'ID', 'Type', 'Details', 'Amount', 'Balance'], ...H.map(t => [t.time, t.id, t.type, t.desc, t.amount, t.balance])];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')], {type: 'text/csv'}));
  a.download = 'ThakurBank_Statement.csv'; a.click(); toast('Statement downloaded');
};
const th = $('#theme'); th.onclick = () => { const d = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = d; th.textContent = d === 'dark' ? '☀️' : '🌙'; };
document.addEventListener('mousemove', e => {   // 3D tilt
  const t = e.target.closest('.tilt'); $$('.tilt').forEach(x => { if (x !== t) x.style.transform = ''; }); if (!t) return;
  const r = t.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  t.style.transform = `perspective(800px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) scale(1.03)`;
});
bind('login', async d => { const j = await api('login', d); setSession(j.token, 'user'); await loadUser(true); });
bind('adminF', async d => { const j = await api('admin/login', d); setSession(j.token, 'admin'); await loadAdmin(true); });
bind('open', async (d, f) => { const j = await api('register', d); f.reset(); const n = $('#newAcc'); n.hidden = false;
  n.textContent = '🎉 ' + d.type + ' account created! Your account number is ' + j.account + '. Use it to log in.'; $('#login [name=account]').value = j.account; toast('Welcome to Thakur Bank!'); confetti(); });
for (const [id, msg] of [['dep', 'Money deposited successfully 💰'], ['wd', 'Withdrawal successful'], ['tr', 'Transfer successful ✅']])
  bind(id, async (d, f) => { await api({dep: 'deposit', wd: 'withdraw', tr: 'transfer'}[id], d); f.reset(); toast(msg); if (id !== 'wd') confetti(); await loadUser(); go('dash'); });
if (token) role === 'admin' ? loadAdmin(true) : loadUser(true); else view('authView');

// ===== v4: cinematic effects =====
addEventListener('load', () => setTimeout(() => $('#splash').classList.add('off'), 1500));
(() => { // particle network
  const c = $('#fx'), x = c.getContext('2d'); let w, h, P = [];
  const rs = () => { w = c.width = innerWidth; h = c.height = innerHeight; P = Array.from({length: Math.min(70, w / 18 | 0)}, () => ({x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .5, vy: (Math.random() - .5) * .5})); };
  rs(); addEventListener('resize', rs);
  (function f() {
    x.clearRect(0, 0, w, h); const col = document.documentElement.dataset.theme === 'dark' ? '150,180,255' : '31,79,148';
    P.forEach((p, i) => {
      p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1;
      x.fillStyle = `rgba(${col},.6)`; x.beginPath(); x.arc(p.x, p.y, 2, 0, 7); x.fill();
      for (let j = i + 1; j < P.length; j++) { const q = P[j], d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 130) { x.strokeStyle = `rgba(${col},${.2 * (1 - d / 130)})`; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke(); } }
    }); requestAnimationFrame(f);
  })();
})();
(() => { // typewriter
  const W = ['instant transfers', 'zero hidden fees', '24/7 digital banking', 'bank-grade security'], el = $('#tw'); let i = 0, j = 0, del = false;
  (function t() { const w = W[i]; el.textContent = w.slice(0, j);
    if (!del && j === w.length) { del = true; return setTimeout(t, 1400); }
    if (del && j === 0) { del = false; i = (i + 1) % W.length; } j += del ? -1 : 1; setTimeout(t, del ? 35 : 75); })();
})();
function confetti() {
  const c = document.createElement('canvas'); c.className = 'cf'; c.width = innerWidth; c.height = innerHeight; document.body.append(c);
  const x = c.getContext('2d'), cols = ['#e0b341', '#3b82f6', '#12a150', '#a855f7', '#e5484d'];
  const P = Array.from({length: 150}, () => ({x: innerWidth / 2, y: innerHeight * .6, vx: (Math.random() - .5) * 18, vy: -Math.random() * 17 - 4, s: Math.random() * 8 + 4, c: cols[Math.random() * 5 | 0], r: Math.random() * 6}));
  let n = 0; (function f() { x.clearRect(0, 0, c.width, c.height);
    P.forEach(p => { p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += .2; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(0, 0, p.s, p.s * .6); x.restore(); });
    if (++n < 120) requestAnimationFrame(f); else c.remove(); })();
}
function donut(i, o) {
  const t = i + o || 1, R = 60, C = 2 * Math.PI * R, a = C * i / t;
  return `<svg viewBox="0 0 200 160" width="100%" height="190"><g transform="translate(100 80) rotate(-90)"><circle r="${R}" fill="none" stroke="${i + o ? '#e5484d' : '#8884'}" stroke-width="22"/>
  <circle r="${R}" fill="none" stroke="#12a150" stroke-width="22" stroke-dasharray="${a} ${C}" style="--c:${C};animation:dn 1.4s ease-out both"/></g>
  <text x="100" y="82" text-anchor="middle" style="font-size:24px;font-weight:800;fill:var(--ink)">${Math.round(i / t * 100)}%</text><text x="100" y="100" text-anchor="middle">money in</text></svg>
  <div class="leg"><span><i style="background:#12a150"></i>In ${inr(i)}</span><span><i style="background:#e5484d"></i>Out ${inr(o)}</span></div>`;
}
document.addEventListener('mousemove', e => { const t = e.target.closest('.tilt'); if (!t) return; const r = t.getBoundingClientRect();
  t.style.setProperty('--mx', (e.clientX - r.left) / r.width * 100 + '%'); t.style.setProperty('--my', (e.clientY - r.top) / r.height * 100 + '%'); });
document.addEventListener('click', e => { const b = e.target.closest('.btn,.sm,.out'); if (!b) return; const r = b.getBoundingClientRect(), s = document.createElement('span');
  s.className = 'rip'; s.style.left = e.clientX - r.left + 'px'; s.style.top = e.clientY - r.top + 'px'; b.append(s); setTimeout(() => s.remove(), 600); });

$('#atype').onchange = e => { const c = e.target.value === 'Current'; $('#depTxt').textContent = 'Opening Deposit (min ₹' + (c ? '1,000' : '500') + ')'; $('#open [name=deposit]').min = c ? 1000 : 500; };

// ===== v5: card, FD, loans, calculator, settings =====
const emi = (P, rate, n) => { const r = rate / 1200, p = Math.pow(1 + r, n); return P * r * p / (p - 1); };
const badge = s => `<span class="tag ${s === 'APPROVED' ? 'a' : s === 'PENDING' ? 'f2' : 'f'}">${s}</span>`;
LOAD.card = async () => { const c = await api('card'); $('#cNum').textContent = c.number.replace(/(\d{4})(?=\d)/g, '$1 '); $('#cName').textContent = c.name; $('#cExp').textContent = c.expiry; $('#cCvv').textContent = c.cvv;
  $('#flip').classList.toggle('frz', c.frozen); $('#cSt').textContent = c.frozen ? '❄️ Frozen' : '✅ Active'; $('#cTog').textContent = c.frozen ? '🔥 Unfreeze Card' : '❄️ Freeze Card'; };
$('#flip').onclick = e => e.currentTarget.classList.toggle('on');
$('#cTog').onclick = async () => { try { await api('card/toggle', {}); LOAD.card(); toast('Card status updated'); } catch (e) { toast(e.message, true); } };
const fdPrev = () => { const a = +$('#fdAmt').value, m = +$('#fdMon').value, r = {6: 6.5, 12: 7, 24: 7.25, 36: 7.5}[m];
  $('#fdPrev').textContent = a >= 1000 ? `Maturity value: ${inr(a * (1 + r / 100 * m / 12))} (interest ${inr(a * r / 100 * m / 12)})` : 'Enter an amount (min ₹1,000) to see your maturity value'; };
$('#fdAmt').oninput = $('#fdMon').onchange = fdPrev;
LOAD.fd = async () => { const l = await api('fd');
  $('#fdList').innerHTML = l.length ? [...l].reverse().map(d => `<div class="item"><div><b>${d.id}</b> · ${inr(d.amount)}<br><small class="mut">${d.months} months @ ${d.rate}% · ${esc(d.start)}</small><br><small>Maturity: <b>${inr(d.maturity)}</b></small></div>${d.open ? `<button class="sm red" data-fc="${d.id}">${d.ready ? 'Claim' : 'Close early'}</button>` : '<span class="tag a">Closed</span>'}</div>`).join('') : '<p class="mut">No fixed deposits yet.</p>';
  $$('[data-fc]').forEach(b => b.onclick = async () => { try { const r = await api('fd/close', {id: b.dataset.fc});
    toast(r.matured ? 'FD matured! ' + inr(r.credited) + ' credited 🎉' : 'Closed early. Principal ' + inr(r.credited) + ' returned'); if (r.matured) confetti(); await loadUser(); LOAD.fd(); } catch (e) { toast(e.message, true); } }); };
bind('fd', async (d, f) => { await api('fd/open', d); f.reset(); fdPrev(); toast('Fixed deposit created 🔒'); confetti(); await loadUser(); LOAD.fd(); });
const LR = {Personal: 11, Home: 8.5, Car: 9.5, Education: 9};
const lnPrev = () => { const a = +$('#lnAmt').value, y = +$('#lnYrs').value, k = $('#lnKind').value;
  $('#lnPrev').textContent = a >= 10000 && y >= 1 ? `Rate ${LR[k]}% · EMI ${inr(emi(a, LR[k], y * 12))}/month · Interest ${inr(emi(a, LR[k], y * 12) * y * 12 - a)}` : 'Enter amount (min ₹10,000) and years to preview your EMI'; };
$('#lnAmt').oninput = $('#lnYrs').oninput = $('#lnKind').onchange = lnPrev;
LOAD.loan = async () => { const l = await api('loans');
  $('#lnList').innerHTML = l.length ? [...l].reverse().map(x => `<div class="item"><div><b>${x.kind} Loan</b> · ${inr(x.amount)} ${badge(x.status)}<br><small class="mut">${x.id} · ${x.rate}% · ${x.months / 12} yrs · EMI ${inr(x.emi)}</small>${x.status === 'APPROVED' || x.status === 'CLOSED' ? `<div class="prog"><i style="width:${x.paid / x.months * 100}%"></i></div><small>${x.paid}/${x.months} EMIs paid</small>` : ''}</div>${x.status === 'APPROVED' ? `<button class="sm" data-lp="${x.id}">Pay EMI</button>` : ''}</div>`).join('') : '<p class="mut">No loans yet.</p>';
  $$('[data-lp]').forEach(b => b.onclick = async () => { try { await api('loan/pay', {id: b.dataset.lp}); toast('EMI paid ✅'); await loadUser(); LOAD.loan(); } catch (e) { toast(e.message, true); } }); };
bind('ln', async (d, f) => { await api('loan/apply', d); f.reset(); lnPrev(); toast('Loan application sent to admin 📨'); LOAD.loan(); });
const calc = () => { const P = +$('#cA').value, R = +$('#cR').value, Y = +$('#cY').value, e = emi(P, R, Y * 12), tot = e * Y * 12;
  $('#cAv').textContent = inr(P); $('#cRv').textContent = R + '%'; $('#cYv').textContent = Y + ' yrs'; $('#cE').textContent = inr(e); $('#cI').textContent = inr(tot - P); $('#cT').textContent = inr(tot); $('#cPb').style.width = P / tot * 100 + '%'; };
['cA', 'cR', 'cY'].forEach(i => $('#' + i).oninput = calc); calc();
bind('pw', async (d, f) => { await api('password', d); f.reset(); toast('Password changed 🔐'); });
LOAD.aloan = async () => { const l = await api('admin/loans');
  $('#aLoan').innerHTML = l.length ? [...l].reverse().map(x => `<tr><td>${x.id}</td><td>${esc(x.name)}<br><small class="mut">${x.acc}</small></td><td>${x.kind}</td><td class="r">${inr(x.amount)}</td><td>${x.rate}%</td><td>${x.months / 12}y</td><td class="r">${inr(x.emi)}</td><td>${badge(x.status)}</td>
    <td>${x.status === 'PENDING' ? `<button class="sm" data-d="approve|${x.acc}|${x.id}">Approve</button><button class="sm red" data-d="reject|${x.acc}|${x.id}">Reject</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="9" style="text-align:center;color:#999">No loan applications</td></tr>';
  $$('[data-d]').forEach(b => b.onclick = async () => { const [action, account, id] = b.dataset.d.split('|');
    try { await api('admin/loan/decide', {action, account, id}); toast(action === 'approve' ? 'Loan approved ✅' : 'Loan rejected'); LOAD.aloan(); } catch (e) { toast(e.message, true); } }); };
let idle; const rst = () => { clearTimeout(idle); if (token) idle = setTimeout(() => { logout(); toast('Logged out due to inactivity', true); }, 300000); };
['click', 'keydown', 'mousemove'].forEach(e => addEventListener(e, rst));
