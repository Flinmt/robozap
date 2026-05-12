const crypto = require('crypto');

const SESSION_COOKIE = 'robozap_admin';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

function getAdminCredentials() {
    return {
        user: process.env.ADMIN_USER || 'admin',
        password: process.env.ADMIN_PASSWORD || ''
    };
}

function getSessionSecret() {
    return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'robozap-admin';
}

function parseCookies(req) {
    const header = req.headers.cookie || '';
    return header.split(';').reduce((cookies, part) => {
        const index = part.indexOf('=');
        if (index === -1) return cookies;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        cookies[key] = decodeURIComponent(value);
        return cookies;
    }, {});
}

function sign(value) {
    return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('hex');
}

function createSessionValue(user) {
    const payload = JSON.stringify({
        user,
        expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
    });
    const encoded = Buffer.from(payload).toString('base64url');
    return `${encoded}.${sign(encoded)}`;
}

function readSession(req) {
    const value = parseCookies(req)[SESSION_COOKIE];
    if (!value) return null;

    const [encoded, signature] = value.split('.');
    if (!encoded || !signature || sign(encoded) !== signature) return null;

    try {
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (!payload.expiresAt || payload.expiresAt < Date.now()) return null;
        return payload;
    } catch (_) {
        return null;
    }
}

function setSessionCookie(res, user) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(createSessionValue(user))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function requireAdmin(req, res, next) {
    const { password } = getAdminCredentials();

    if (!password) {
        return res.status(503).send('ADMIN_PASSWORD nao configurado.');
    }

    if (readSession(req)) {
        return next();
    }

    if (req.path && req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Sessao expirada. Faca login novamente.' });
    }

    return res.redirect('/admin/login');
}

function handleLogin(req, res) {
    const { user, password } = getAdminCredentials();

    if (!password) {
        return res.status(503).send('ADMIN_PASSWORD nao configurado.');
    }

    const receivedUser = String(req.body?.user || '');
    const receivedPassword = String(req.body?.password || '');

    if (receivedUser !== user || receivedPassword !== password) {
        return res.status(401).type('html').send(renderLoginPage('Usuario ou senha invalidos.'));
    }

    setSessionCookie(res, user);
    return res.redirect('/admin');
}

function handleLogout(req, res) {
    clearSessionCookie(res);
    return res.redirect('/admin/login');
}

function renderLoginPage(errorMessage = '') {
    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ROBOZAP Login</title>
  <style>
    :root {
      font-family: Arial, sans-serif;
      --bg: #eef2f6;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #667085;
      --line: #d8dde5;
      --primary: #1769aa;
      --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--text);
    }
    main {
      width: min(420px, calc(100vw - 32px));
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 28px;
      box-shadow: 0 18px 50px rgba(23, 32, 42, 0.10);
    }
    h1 { margin: 0 0 6px; font-size: 24px; }
    p { margin: 0 0 22px; color: var(--muted); line-height: 1.4; }
    label { display: block; color: var(--muted); font-size: 13px; margin: 14px 0 6px; }
    input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 11px;
      font-size: 15px;
    }
    button {
      width: 100%;
      margin-top: 18px;
      border: 0;
      border-radius: 6px;
      padding: 12px 14px;
      font-size: 15px;
      cursor: pointer;
      background: var(--primary);
      color: #fff;
    }
    .error {
      margin-top: 14px;
      color: var(--danger);
      min-height: 20px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <main>
    <h1>ROBOZAP Admin</h1>
    <p>Acesse o painel operacional do worker.</p>
    <form method="post" action="/admin/login">
      <label for="user">Usuario</label>
      <input id="user" name="user" type="text" autocomplete="username" autofocus>
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" autocomplete="current-password">
      <button type="submit">Entrar</button>
    </form>
    <div class="error">${escapeHtml(errorMessage)}</div>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function renderAdminPage() {
    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ROBOZAP Admin</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Arial, sans-serif;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --line: #d8dde5;
      --text: #17202a;
      --muted: #667085;
      --primary: #1769aa;
      --danger: #b42318;
      --ok: #067647;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    header { background: #202938; color: #fff; padding: 18px 24px; }
    header .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; max-width: 980px; margin: 0 auto; }
    header h1 { margin: 0; font-size: 22px; }
    header a { color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.45); border-radius: 6px; padding: 8px 10px; font-size: 14px; }
    main { max-width: 980px; margin: 0 auto; padding: 24px; }
    section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; margin-bottom: 18px; }
    h2 { font-size: 18px; margin: 0 0 14px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .status { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
    .stat { border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: #fbfcfd; }
    .stat span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 6px; }
    .stat strong { font-size: 16px; }
    label { display: block; color: var(--muted); font-size: 13px; margin-bottom: 6px; }
    input[type="text"], input[type="number"] { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 10px; font-size: 14px; }
    .toggle { display: flex; align-items: center; gap: 10px; padding: 10px 0; color: var(--text); }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    button { border: 0; border-radius: 6px; padding: 10px 14px; font-size: 14px; cursor: pointer; background: var(--primary); color: #fff; }
    button.secondary { background: #475467; }
    button.danger { background: var(--danger); }
    .message { color: var(--muted); margin-top: 12px; min-height: 20px; }
    .ok { color: var(--ok); }
    .bad { color: var(--danger); }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid var(--line); padding: 9px 8px; text-align: left; white-space: nowrap; }
    th { color: var(--muted); font-weight: 700; background: #fbfcfd; }
    td.name { white-space: normal; min-width: 220px; }
    @media (max-width: 760px) {
      main { padding: 14px; }
      .grid, .status { grid-template-columns: 1fr; }
      header .topbar { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <h1>ROBOZAP Admin</h1>
      <a href="/admin/logout">Sair</a>
    </div>
  </header>
  <main>
    <section>
      <h2>Status</h2>
      <div class="status">
        <div class="stat"><span>Worker</span><strong id="workerStatus">-</strong></div>
        <div class="stat"><span>Processando</span><strong id="processingStatus">-</strong></div>
        <div class="stat"><span>Ultimo ciclo</span><strong id="lastCycle">-</strong></div>
        <div class="stat"><span>Resultado</span><strong id="lastResult">-</strong></div>
        <div class="stat"><span>Fila criada</span><strong id="queueProduced">-</strong></div>
      </div>
      <div class="actions">
        <button id="resumeBtn">Retomar</button>
        <button id="pauseBtn" class="danger">Pausar</button>
        <button id="refreshBtn" class="secondary">Atualizar</button>
      </div>
    </section>

    <section>
      <h2>Configuracao operacional</h2>
      <form id="configForm">
        <div class="grid">
          <div>
            <label for="templateNewSchedule">Template novo agendamento</label>
            <input id="templateNewSchedule" name="templateNewSchedule" type="text">
          </div>
          <div>
            <label for="templateReminder">Template confirmacao/lembrete</label>
            <input id="templateReminder" name="templateReminder" type="text">
          </div>
          <div>
            <label for="businessHoursStart">Inicio do envio</label>
            <input id="businessHoursStart" name="businessHoursStart" type="number" min="0" max="23">
          </div>
          <div>
            <label for="businessHoursEnd">Fim do envio</label>
            <input id="businessHoursEnd" name="businessHoursEnd" type="number" min="0" max="23">
          </div>
          <div>
            <label for="queueProducerLookaheadDays">Janela da fila (dias)</label>
            <input id="queueProducerLookaheadDays" name="queueProducerLookaheadDays" type="number" min="0" max="365">
          </div>
          <div>
            <label for="queueProducerLimit">Limite de criacao por ciclo</label>
            <input id="queueProducerLimit" name="queueProducerLimit" type="number" min="1" max="500">
          </div>
          <div>
            <label for="testPatientNameFilter">Filtro do modo teste</label>
            <input id="testPatientNameFilter" name="testPatientNameFilter" type="text">
          </div>
          <div>
            <label for="messagingStartDate">Enviar apenas agendamentos a partir de</label>
            <input id="messagingStartDate" name="messagingStartDate" type="date">
          </div>
          <div>
            <label for="outboundSendStartDate">Comecar a enviar mensagens em</label>
            <input id="outboundSendStartDate" name="outboundSendStartDate" type="date">
          </div>
        </div>
        <label class="toggle"><input id="partnerbotIsClosed" name="partnerbotIsClosed" type="checkbox"> Enviar com isClosed=true</label>
        <label class="toggle"><input id="includeCompany" name="includeCompany" type="checkbox"> Incluir empresa no corpo</label>
        <label class="toggle"><input id="includeUnit" name="includeUnit" type="checkbox"> Incluir unidade/endereco no corpo</label>
        <label class="toggle"><input id="includeConfirmationButton" name="includeConfirmationButton" type="checkbox"> Incluir botao de confirmacao</label>
        <label class="toggle"><input id="queueProducerEnabled" name="queueProducerEnabled" type="checkbox"> Criar fila automaticamente a partir da agenda</label>
        <label class="toggle"><input id="testModeEnabled" name="testModeEnabled" type="checkbox"> Modo teste: usar somente pacientes filtrados</label>
        <label class="toggle"><input id="syncAgendaWhatsappStatus" name="syncAgendaWhatsappStatus" type="checkbox"> Sincronizar status de WhatsApp enviado na agenda</label>
        <label class="toggle"><input id="skipPastAppointmentTime" name="skipPastAppointmentTime" type="checkbox"> Ignorar consultas com horario ja passado</label>
        <div class="actions">
          <button type="submit">Salvar configuracao</button>
        </div>
      </form>
      <div id="message" class="message"></div>
    </section>

    <section>
      <h2>Fila pendente</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Tipo</th>
              <th>Paciente</th>
              <th>Data</th>
              <th>Hora</th>
              <th>Telefone</th>
              <th>Profissional</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="queueRows">
            <tr><td colspan="8">Carregando...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <script>
    const fields = [
      'templateNewSchedule',
      'templateReminder',
      'partnerbotIsClosed',
      'includeCompany',
      'includeUnit',
      'includeConfirmationButton',
      'businessHoursStart',
      'businessHoursEnd',
      'queueProducerEnabled',
      'queueProducerLookaheadDays',
      'queueProducerLimit',
      'testModeEnabled',
      'testPatientNameFilter',
      'syncAgendaWhatsappStatus',
      'messagingStartDate',
      'skipPastAppointmentTime',
      'outboundSendStartDate'
    ];

    async function api(path, options) {
      const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      if (response.status === 401) {
        window.location.href = '/admin/login';
        return {};
      }
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }

    function setMessage(text, ok) {
      const el = document.getElementById('message');
      el.textContent = text;
      el.className = ok ? 'message ok' : 'message bad';
    }

    function fillConfig(config) {
      fields.forEach((field) => {
        const input = document.getElementById(field);
        if (!input) return;
        if (input.type === 'checkbox') input.checked = Boolean(config[field]);
        else input.value = config[field] ?? '';
      });
    }

    function renderStatus(data) {
      const paused = data.config.paused;
      document.getElementById('workerStatus').textContent = paused ? 'Pausado' : 'Ativo';
      document.getElementById('processingStatus').textContent = data.isProcessing ? 'Sim' : 'Nao';
      document.getElementById('lastCycle').textContent = data.lastCycleAt ? new Date(data.lastCycleAt).toLocaleString() : '-';
      document.getElementById('lastResult').textContent = data.lastCycleResult || '-';
      document.getElementById('queueProduced').textContent = data.lastQueueProducedCount ?? 0;
      fillConfig(data.config);
    }

    function clientEscapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[char]));
    }

    function renderQueue(rows) {
      const tbody = document.getElementById('queueRows');
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8">Nenhuma mensagem pendente.</td></tr>';
        return;
      }

      tbody.innerHTML = rows.map((row) => (
        '<tr>' +
          '<td>' + clientEscapeHtml(row.intWhatsAppEnvioId) + '</td>' +
          '<td>' + clientEscapeHtml(row.tipoFila) + '</td>' +
          '<td class="name">' + clientEscapeHtml(row.strAgenda) + '</td>' +
          '<td>' + clientEscapeHtml(row.datagenda) + '</td>' +
          '<td>' + clientEscapeHtml(row.strHora) + '</td>' +
          '<td>' + clientEscapeHtml(row.strTelefone) + '</td>' +
          '<td>' + clientEscapeHtml(row.strProfissional) + '</td>' +
          '<td>' + clientEscapeHtml(row.bolEnviado) + '/' + clientEscapeHtml(row.bolConfirma) + '</td>' +
        '</tr>'
      )).join('');
    }

    async function refresh() {
      const data = await api('/api/admin/status');
      if (!data.config) return;
      renderStatus(data);
      const queueData = await api('/api/admin/queue');
      renderQueue(queueData.queue || []);
    }

    document.getElementById('refreshBtn').addEventListener('click', () => refresh().catch((err) => setMessage(err.message, false)));
    document.getElementById('pauseBtn').addEventListener('click', async () => {
      await api('/api/admin/pause', { method: 'POST' });
      await refresh();
      setMessage('Worker pausado.', true);
    });
    document.getElementById('resumeBtn').addEventListener('click', async () => {
      await api('/api/admin/resume', { method: 'POST' });
      await refresh();
      setMessage('Worker retomado.', true);
    });
    document.getElementById('configForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const payload = {};
        fields.forEach((field) => {
          const input = document.getElementById(field);
          payload[field] = input.type === 'checkbox' ? input.checked : input.value;
        });
        payload.businessHoursStart = Number(payload.businessHoursStart);
        payload.businessHoursEnd = Number(payload.businessHoursEnd);
        payload.queueProducerLookaheadDays = Number(payload.queueProducerLookaheadDays);
        payload.queueProducerLimit = Number(payload.queueProducerLimit);
        await api('/api/admin/config', { method: 'PUT', body: JSON.stringify(payload) });
        await refresh();
        setMessage('Configuracao salva.', true);
      } catch (err) {
        setMessage(err.message, false);
      }
    });

    refresh().catch((err) => setMessage(err.message, false));
  </script>
</body>
</html>`;
}

module.exports = {
    requireAdmin,
    handleLogin,
    handleLogout,
    renderLoginPage,
    renderAdminPage
};
