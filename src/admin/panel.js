const crypto = require('crypto');

const SESSION_COOKIE = 'robozap_admin';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

function normalizeBasePath(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === '/') return '';
    const withPrefix = raw.startsWith('/') ? raw : `/${raw}`;
    return withPrefix.replace(/\/+$/, '');
}

function withBasePath(basePath, path) {
    const normalizedBase = normalizeBasePath(basePath);
    if (!normalizedBase) return path;
    if (path === '/') return normalizedBase;
    return `${normalizedBase}${path}`;
}

function getSessionCookieName(basePath) {
    const normalizedBase = normalizeBasePath(basePath);
    if (!normalizedBase) return SESSION_COOKIE;
    const suffix = normalizedBase.replace(/^\//, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${SESSION_COOKIE}_${suffix}`;
}

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

function readSession(req, basePath) {
    const cookieName = getSessionCookieName(basePath);
    const value = parseCookies(req)[cookieName];
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

function setSessionCookie(res, user, basePath) {
    const cookiePath = normalizeBasePath(basePath) || '/';
    const cookieName = getSessionCookieName(basePath);
    res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(createSessionValue(user))}; HttpOnly; SameSite=Lax; Path=${cookiePath}; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
}

function clearSessionCookie(res, basePath) {
    const cookiePath = normalizeBasePath(basePath) || '/';
    const cookieName = getSessionCookieName(basePath);
    res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Lax; Path=${cookiePath}; Max-Age=0`);
}

function requireAdmin(basePath) {
    const loginUrl = withBasePath(basePath, '/admin/login');
    const apiPrefix = withBasePath(basePath, '/api/');

    return (req, res, next) => {
    const { password } = getAdminCredentials();

    if (!password) {
        return res.status(503).send('ADMIN_PASSWORD nao configurado.');
    }

    const session = readSession(req, basePath);
    if (session) {
        req.adminSession = session;
        req.adminUser = session.user;
        return next();
    }

    if (req.path && req.path.startsWith(apiPrefix)) {
        return res.status(401).json({ error: 'Sessao expirada. Faca login novamente.' });
    }

    return res.redirect(loginUrl);
    };
}

function handleLogin(basePath) {
    const adminUrl = withBasePath(basePath, '/admin');

    return (req, res) => {
    const { user, password } = getAdminCredentials();

    if (!password) {
        return res.status(503).send('ADMIN_PASSWORD nao configurado.');
    }

    const receivedUser = String(req.body?.user || '');
    const receivedPassword = String(req.body?.password || '');

    if (receivedUser !== user || receivedPassword !== password) {
        return res.status(401).type('html').send(renderLoginPage(basePath, 'Usuario ou senha invalidos.'));
    }

    setSessionCookie(res, user, basePath);
    return res.redirect(adminUrl);
    };
}

function handleLogout(basePath) {
    const loginUrl = withBasePath(basePath, '/admin/login');
    return (req, res) => {
    clearSessionCookie(res, basePath);
    return res.redirect(loginUrl);
    };
}

function renderLoginPage(basePath, errorMessage = '') {
    const loginAction = withBasePath(basePath, '/admin/login');
    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ROBOZAP Login</title>
  <style>
    :root {
      font-family: Arial, sans-serif;
      --bg: #f5f5f5;
      --panel: #ffffff;
      --text: #10227e;
      --muted: #4a5a9a;
      --line: #d7dcf1;
      --primary: #10227e;
      --accent: #ff7900;
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
      background: var(--accent);
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
    <form method="post" action="${loginAction}">
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

function renderAdminPage(basePath) {
    const logoutHref = withBasePath(basePath, '/admin/logout');
    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ROBOZAP</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Arial, sans-serif;
      --bg: #f5f5f5;
      --panel: #ffffff;
      --line: #d7dcf1;
      --text: #10227e;
      --muted: #4a5a9a;
      --primary: #10227e;
      --accent: #ff7900;
      --danger: #b42318;
      --ok: #067647;
      --warn: #b54708;
      --soft: #e8ecff;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    header { background: var(--primary); color: #fff; padding: 18px 24px; }
    header .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; max-width: 1160px; margin: 0 auto; }
    header h1 { margin: 0; font-size: 22px; }
    header a { color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.45); border-radius: 6px; padding: 8px 10px; font-size: 14px; }
    a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid rgba(255, 121, 0, .35); outline-offset: 2px; }
    main { max-width: 1160px; margin: 0 auto; padding: 24px; }
    section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; margin-bottom: 18px; }
    h2 { font-size: 20px; margin: 0 0 14px; letter-spacing: .2px; }
    h3 { font-size: 16px; margin: 0; letter-spacing: .1px; }
    .section-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
    .section-head p { color: var(--muted); margin: 4px 0 0; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .status { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
    .stat { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: #fbfcfd; box-shadow: 0 8px 18px rgba(16, 34, 126, .05); }
    .stat span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 6px; }
    .stat strong { font-size: 16px; }
    .pill { display: inline-flex; align-items: center; min-height: 26px; border-radius: 999px; padding: 4px 10px; background: var(--soft); color: var(--primary); font-size: 12px; font-weight: 700; }
    .save-pill { background: #e8ecff; color: var(--primary); }
    .save-pill.pending { background: #fff4e8; color: #9a4a00; }
    .save-pill.ok { background: #e8f7ef; color: #067647; }
    .header-actions { display: flex; align-items: center; gap: 10px; }
    .client-badge { display: inline-flex; align-items: center; gap: 8px; border: 1px solid rgba(255,255,255,.35); border-radius: 999px; padding: 6px 12px; font-size: 13px; font-weight: 600; color: #f8fafc; }
    .client-badge strong { font-size: 13px; }
    .icon-btn { min-height: 40px; border: 1px solid rgba(255,255,255,.45); border-radius: 999px; background: rgba(7, 15, 58, .34); color: #ffffff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: transform .12s ease, background .18s ease, border-color .18s ease; padding: 0 14px; font-size: 13px; font-weight: 700; letter-spacing: .15px; }
    .icon-btn:hover { background: rgba(255,255,255,.18); border-color: rgba(255,255,255,.75); }
    .icon-btn:active { transform: translateY(1px); }
    .config-section { background: transparent; border: 0; padding: 0; }
    .config-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .config-group { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; box-shadow: 0 8px 20px rgba(16, 34, 126, .05); }
    .config-group.wide { grid-column: 1 / -1; }
    .group-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .field-stack { display: grid; gap: 12px; }
    .field-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    label { display: block; color: var(--muted); font-size: 13px; margin-bottom: 6px; }
    input[type="text"], input[type="number"], input[type="date"] { width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 10px; font-size: 14px; background: #fff; color: var(--text); transition: border-color .18s ease, box-shadow .18s ease; }
    input:focus { outline: 0; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(16, 34, 126, .15); }
    .helper { display: block; color: var(--muted); font-size: 12px; margin-top: 5px; line-height: 1.35; }
    .switch-list { display: grid; gap: 10px; }
    .toggle { display: grid; grid-template-columns: 42px 1fr; align-items: center; gap: 10px; min-height: 48px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; color: var(--text); background: #fbfcfd; margin: 0; }
    .toggle input { appearance: none; width: 38px; height: 22px; border-radius: 999px; background: #cbd5e1; position: relative; cursor: pointer; transition: .18s ease; }
    .toggle input::after { content: ""; position: absolute; width: 18px; height: 18px; top: 2px; left: 2px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(16, 24, 40, .25); transition: .18s ease; }
    .toggle input:checked { background: var(--accent); }
    .toggle input:checked::after { transform: translateX(16px); }
    .toggle span { font-size: 14px; font-weight: 700; }
    .toggle small { display: block; color: var(--muted); font-size: 12px; font-weight: 400; margin-top: 3px; line-height: 1.35; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    button { border: 0; border-radius: 8px; padding: 10px 14px; font-size: 14px; cursor: pointer; background: var(--accent); color: #fff; transition: transform .12s ease, filter .18s ease; }
    button:hover { filter: brightness(0.97); }
    button:active { transform: translateY(1px); }
    button:disabled { cursor: not-allowed; opacity: .55; }
    button.secondary { background: #243d9a; }
    button.danger { background: var(--danger); }
    .form-footer { position: sticky; bottom: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; padding: 12px 0 0; background: linear-gradient(180deg, rgba(244,246,248,0), var(--bg) 38%); }
    .message { color: var(--muted); min-height: 20px; font-size: 14px; font-weight: 600; }
    .message.pending { color: var(--warn); }
    .ok { color: var(--ok); }
    .bad { color: var(--danger); }
    .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid var(--line); padding: 9px 8px; text-align: left; white-space: nowrap; }
    th { color: var(--muted); font-weight: 700; background: #fbfcfd; }
    td.name { white-space: normal; min-width: 220px; }
    .modal-backdrop { position: fixed; inset: 0; background: rgba(16, 24, 40, .45); display: grid; place-items: center; padding: 16px; }
    .modal-backdrop.hidden { display: none; }
    .modal { width: min(520px, 100%); background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 16px; box-shadow: 0 25px 50px rgba(16, 24, 40, .28); }
    .modal h3 { font-size: 18px; margin: 0 0 6px; }
    .modal p { margin: 0 0 14px; color: var(--muted); font-size: 13px; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
    @media (max-width: 760px) {
      main { padding: 14px; }
      .grid, .status, .config-grid, .field-row { grid-template-columns: 1fr; }
      header .topbar { align-items: flex-start; flex-direction: column; }
      .header-actions { width: 100%; justify-content: space-between; }
      .client-badge { width: 100%; justify-content: center; }
      .section-head { align-items: flex-start; flex-direction: column; }
      .section-head .header-actions { width: 100%; }
      .form-footer { align-items: stretch; flex-direction: column; }
      .form-footer button { width: 100%; }
      .modal-actions { flex-direction: column; }
      .modal-actions button { width: 100%; }
      .stat strong { font-size: 15px; }
      th, td { font-size: 12px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <h1>ROBOZAP</h1>
      <div class="header-actions">
        <div class="client-badge">Cliente: <strong id="headerClientName">Nao definido</strong></div>
        <button id="openClientConfigBtn" class="icon-btn" type="button" aria-label="Configurar cliente" title="Configurar cliente" aria-haspopup="dialog" aria-controls="clientModal">Configurar cliente</button>
        <a href="${logoutHref}">Sair</a>
      </div>
    </div>
  </header>
  <main>
    <section>
      <div class="section-head">
        <div>
          <h2>Status operacional</h2>
          <p>Visao rapida da operacao atual deste cliente.</p>
        </div>
      </div>
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

    <section class="config-section">
      <div class="section-head">
        <div>
          <h2>Configuracao operacional</h2>
          <p>Ajustes salvos no runtime do worker.</p>
        </div>
        <div class="header-actions">
          <span id="saveStatePill" class="pill save-pill">Sem alteracoes</span>
          <span class="pill">Sem segredos</span>
        </div>
      </div>
      <form id="configForm">
        <div class="config-grid">
          <div class="config-group">
            <div class="group-title">
              <h3>Templates</h3>
              <span class="pill">PartnerBot</span>
            </div>
            <div class="field-stack">
              <div>
                <label for="templateNewSchedule">Agendamento realizado</label>
                <input id="templateNewSchedule" name="templateNewSchedule" type="text">
              </div>
              <div>
                <label for="templateReminder">Confirmacao de presenca</label>
                <input id="templateReminder" name="templateReminder" type="text">
              </div>
              <div>
                <label for="partnerbotAuthToken">Token PartnerBot (opcional)</label>
                <input id="partnerbotAuthToken" name="partnerbotAuthToken" type="text" autocomplete="off" placeholder="Bearer ...">
                <small class="helper">Se preenchido, sobrescreve o token do .env para esta instancia.</small>
              </div>
            </div>
          </div>

          <div class="config-group">
            <div class="group-title">
              <h3>Janela de envio</h3>
              <span class="pill">Brasil</span>
            </div>
            <div class="field-stack">
              <div class="field-row">
                <div>
                  <label for="businessHoursStart">Inicio</label>
                  <input id="businessHoursStart" name="businessHoursStart" type="number" min="0" max="23">
                </div>
                <div>
                  <label for="businessHoursEnd">Fim</label>
                  <input id="businessHoursEnd" name="businessHoursEnd" type="number" min="0" max="23">
                </div>
              </div>
              <div class="field-row">
                <div>
                  <label for="messagingStartDate">Consultas a partir de</label>
                  <input id="messagingStartDate" name="messagingStartDate" type="date">
                </div>
                <div>
                  <label for="outboundSendStartDate">Disparos a partir de</label>
                  <input id="outboundSendStartDate" name="outboundSendStartDate" type="date">
                </div>
              </div>
            </div>
          </div>

          <div class="config-group">
            <div class="group-title">
              <h3>Produtor de fila</h3>
              <span class="pill">Agenda</span>
            </div>
            <div class="field-stack">
              <label class="toggle">
                <input id="queueProducerEnabled" name="queueProducerEnabled" type="checkbox">
                <span>Criar fila automaticamente<small>Busca agendamentos elegiveis na vwAgenda.</small></span>
              </label>
              <div class="field-row">
                <div>
                  <label for="queueProducerLookaheadDays">Janela da fila em dias</label>
                  <input id="queueProducerLookaheadDays" name="queueProducerLookaheadDays" type="number" min="0" max="365">
                </div>
                <div>
                  <label for="queueProducerLimit">Limite por ciclo</label>
                  <input id="queueProducerLimit" name="queueProducerLimit" type="number" min="1" max="500">
                </div>
              </div>
              <div>
                <label for="sendIntervalSeconds">Cadencia entre envios (segundos)</label>
                <input id="sendIntervalSeconds" name="sendIntervalSeconds" type="number" min="0" max="300">
                <small class="helper">Tempo de espera entre uma mensagem e outra. Ex.: 10 ou 15 segundos.</small>
              </div>
            </div>
          </div>

          <div class="config-group">
            <div class="group-title">
              <h3>Modo seguro</h3>
              <span class="pill">Operacao</span>
            </div>
            <div class="field-stack">
              <label class="toggle">
                <input id="testModeEnabled" name="testModeEnabled" type="checkbox">
                <span>Modo teste<small>Restringe fila e envio pelo nome do paciente.</small></span>
              </label>
              <div>
                <label for="testPatientNameFilter">Texto do filtro</label>
                <input id="testPatientNameFilter" name="testPatientNameFilter" type="text">
              </div>
              <label class="toggle">
                <input id="skipPastAppointmentTime" name="skipPastAppointmentTime" type="checkbox">
                <span>Ignorar horarios passados<small>Bloqueia lembretes de consultas que ja passaram.</small></span>
              </label>
            </div>
          </div>

          <div class="config-group wide">
            <div class="group-title">
              <h3>Formato do payload</h3>
              <span class="pill">WhatsApp</span>
            </div>
            <div class="switch-list">
              <label class="toggle">
                <input id="partnerbotIsClosed" name="partnerbotIsClosed" type="checkbox">
                <span>Enviar com isClosed=true<small>Controla o estado da conversa na PartnerBot.</small></span>
              </label>
              <label class="toggle">
                <input id="includeCompany" name="includeCompany" type="checkbox">
                <span>Incluir empresa no corpo<small>Adiciona empresa como parametro do template.</small></span>
              </label>
              <label class="toggle">
                <input id="includeUnit" name="includeUnit" type="checkbox">
                <span>Incluir unidade/endereco<small>Adiciona unidade como parametro do template.</small></span>
              </label>
              <label class="toggle">
                <input id="includeConfirmationButton" name="includeConfirmationButton" type="checkbox">
                <span>Incluir botao de confirmacao<small>Envia o token dinamico para a URL do template.</small></span>
              </label>
              <label class="toggle">
                <input id="syncAgendaWhatsappStatus" name="syncAgendaWhatsappStatus" type="checkbox">
                <span>Sincronizar status na agenda<small>Marca WhatsApp enviado apos sucesso.</small></span>
              </label>
            </div>
          </div>
        </div>
        <div class="form-footer">
          <div id="message" class="message"></div>
          <button id="saveConfigBtn" type="submit" disabled>Salvar configuracao</button>
        </div>
      </form>
    </section>

    <section>
      <div class="section-head">
        <div>
          <h2>Fila pendente</h2>
          <p>Mensagens aguardando processamento e envio.</p>
        </div>
      </div>
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

  <div id="clientModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="clientModalTitle" aria-hidden="true">
    <div class="modal">
      <h3 id="clientModalTitle">Configurar cliente</h3>
      <p>Defina o cliente para facilitar a identificacao deste painel.</p>
      <div class="field-stack">
        <div>
          <label for="clientName">Nome do cliente</label>
          <input id="clientName" name="clientName" type="text" placeholder="Ex.: Clinica Exemplo">
        </div>
        <div>
          <label for="clientCode">Codigo interno</label>
          <input id="clientCode" name="clientCode" type="text" placeholder="Ex.: CLINICA-01">
        </div>
      </div>
      <div class="modal-actions">
        <button id="closeClientModalBtn" type="button" class="secondary">Cancelar</button>
        <button id="saveClientConfigBtn" type="button">Salvar cliente</button>
      </div>
    </div>
  </div>

  <script>
    const basePath = ${JSON.stringify(normalizeBasePath(basePath))};
    const withBasePath = (path) => {
      if (!basePath) return path;
      if (path === '/') return basePath;
      return basePath + path;
    };
    const fields = [
      'clientName',
      'clientCode',
      'templateNewSchedule',
      'templateReminder',
      'partnerbotAuthToken',
      'partnerbotIsClosed',
      'includeCompany',
      'includeUnit',
      'includeConfirmationButton',
      'businessHoursStart',
      'businessHoursEnd',
      'queueProducerEnabled',
      'queueProducerLookaheadDays',
      'queueProducerLimit',
      'sendIntervalSeconds',
      'testModeEnabled',
      'testPatientNameFilter',
      'syncAgendaWhatsappStatus',
      'messagingStartDate',
      'skipPastAppointmentTime',
      'outboundSendStartDate'
    ];
    const initialConfig = {};

    async function api(path, options) {
      const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      if (response.status === 401) {
        window.location.href = withBasePath('/admin/login');
        return {};
      }
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }

    function setMessage(text, ok) {
      const el = document.getElementById('message');
      el.textContent = text;
      el.className = ok ? 'message ok' : 'message bad';
      if (ok) {
        const pill = document.getElementById('saveStatePill');
        pill.textContent = 'Salvo';
        pill.className = 'pill save-pill ok';
      }
    }

    function setPendingMessage() {
      const el = document.getElementById('message');
      el.textContent = 'Alteracoes pendentes. Salve para aplicar.';
      el.className = 'message pending';
      const pill = document.getElementById('saveStatePill');
      pill.textContent = 'Nao salvo';
      pill.className = 'pill save-pill pending';
    }

    function normalizeFieldValue(field, value) {
      if (['businessHoursStart', 'businessHoursEnd', 'queueProducerLookaheadDays', 'queueProducerLimit', 'sendIntervalSeconds'].includes(field)) {
        return Number(value);
      }
      return value;
    }

    function snapshotCurrentForm() {
      const snapshot = {};
      fields.forEach((field) => {
        const input = document.getElementById(field);
        const raw = input.type === 'checkbox' ? input.checked : input.value;
        snapshot[field] = normalizeFieldValue(field, raw);
      });
      return snapshot;
    }

    function isDirty() {
      const current = snapshotCurrentForm();
      return fields.some((field) => current[field] !== initialConfig[field]);
    }

    function updateSaveState() {
      const dirty = isDirty();
      document.getElementById('saveConfigBtn').disabled = !dirty;
      if (dirty) {
        setPendingMessage();
      } else {
        const pill = document.getElementById('saveStatePill');
        pill.textContent = 'Sem alteracoes';
        pill.className = 'pill save-pill';
      }
    }

    function fillConfig(config) {
      fields.forEach((field) => {
        const input = document.getElementById(field);
        if (!input) return;
        if (input.type === 'checkbox') input.checked = Boolean(config[field]);
        else input.value = config[field] ?? '';
        initialConfig[field] = normalizeFieldValue(field, input.type === 'checkbox' ? input.checked : input.value);
      });
      document.getElementById('saveConfigBtn').disabled = true;
      const pill = document.getElementById('saveStatePill');
      pill.textContent = 'Sem alteracoes';
      pill.className = 'pill save-pill';
    }

    function renderStatus(data) {
      const paused = data.config.paused;
      const lastResult = data.lastCycleResult || '-';
      const clientName = String(data.config.clientName || '').trim() || 'Nao definido';
      const clientCode = String(data.config.clientCode || '').trim();
      let workerLabel = paused ? 'Pausado' : 'Ativo';
      if (!paused && lastResult.includes('Fora do horario')) workerLabel = 'Ativo (fora do horario)';
      if (!paused && lastResult.includes('bloqueados ate')) workerLabel = 'Ativo (envio agendado)';

      document.getElementById('workerStatus').textContent = workerLabel;
      document.getElementById('processingStatus').textContent = data.isProcessing ? 'Sim' : 'Nao';
      document.getElementById('lastCycle').textContent = data.lastCycleAt ? new Date(data.lastCycleAt).toLocaleString() : '-';
      document.getElementById('lastResult').textContent = lastResult;
      document.getElementById('queueProduced').textContent = data.lastQueueProducedCount ?? 0;
      document.getElementById('headerClientName').textContent = clientCode ? (clientName + ' (' + clientCode + ')') : clientName;
      document.getElementById('resumeBtn').disabled = !paused;
      document.getElementById('pauseBtn').disabled = paused;
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
      const data = await api(withBasePath('/api/admin/status'));
      if (!data.config) return;
      renderStatus(data);
      const queueData = await api(withBasePath('/api/admin/queue'));
      renderQueue(queueData.queue || []);
    }

    document.getElementById('refreshBtn').addEventListener('click', () => refresh().catch((err) => setMessage(err.message, false)));
    document.getElementById('pauseBtn').addEventListener('click', async () => {
      await api(withBasePath('/api/admin/pause'), { method: 'POST' });
      await refresh();
      setMessage('Worker pausado.', true);
    });
    document.getElementById('resumeBtn').addEventListener('click', async () => {
      await api(withBasePath('/api/admin/resume'), { method: 'POST' });
      await refresh();
      setMessage('Worker retomado.', true);
    });
    document.getElementById('openClientConfigBtn').addEventListener('click', () => {
      const modal = document.getElementById('clientModal');
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      document.getElementById('clientName').focus();
    });
    document.getElementById('closeClientModalBtn').addEventListener('click', () => {
      const modal = document.getElementById('clientModal');
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    });
    document.getElementById('clientModal').addEventListener('click', (event) => {
      if (event.target.id === 'clientModal') {
        const modal = document.getElementById('clientModal');
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const modal = document.getElementById('clientModal');
      if (modal.classList.contains('hidden')) return;
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    });
    document.getElementById('saveClientConfigBtn').addEventListener('click', async () => {
      try {
        const payload = {
          clientName: document.getElementById('clientName').value,
          clientCode: document.getElementById('clientCode').value
        };
        await api(withBasePath('/api/admin/config'), { method: 'PUT', body: JSON.stringify(payload) });
        const modal = document.getElementById('clientModal');
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        await refresh();
        setMessage('Cliente atualizado.', true);
      } catch (err) {
        setMessage(err.message, false);
      }
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
        payload.sendIntervalSeconds = Number(payload.sendIntervalSeconds);
        await api(withBasePath('/api/admin/config'), { method: 'PUT', body: JSON.stringify(payload) });
        await refresh();
        setMessage('Configuracao salva.', true);
      } catch (err) {
        setMessage(err.message, false);
      }
    });

    refresh().catch((err) => setMessage(err.message, false));

    fields.forEach((field) => {
      const input = document.getElementById(field);
      input.addEventListener('input', updateSaveState);
      input.addEventListener('change', updateSaveState);
    });
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
