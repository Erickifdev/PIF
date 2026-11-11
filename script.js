(() => {
  const STORAGE_KEY = 'estudai.v1';
  const icons = ['📚', '🧪', '📐', '🌿', '🌎', '✍️', '🎹', '💻', '⭐'];
  const colors = [
    { bg: '#351b24', fg: '#e28ba0' }, { bg: '#382027', fg: '#e1a0a8' },
    { bg: '#2d1b26', fg: '#ca8bad' }, { bg: '#251d23', fg: '#ce91a2' },
    { bg: '#3a211c', fg: '#e39b76' }, { bg: '#321a20', fg: '#df858c' }
  ];

  const emptyData = () => ({ subjects: [], practicedSessions: 0 });
  let data = loadData();
  const supabaseClient = window.supabase?.createClient && window.ESTUDAI_SUPABASE?.url && window.ESTUDAI_SUPABASE?.publishableKey
    ? window.supabase.createClient(window.ESTUDAI_SUPABASE.url, window.ESTUDAI_SUPABASE.publishableKey)
    : null;
  let currentUser = null;
  let cloudReady = false;
  let loadingUserId = null;
  let cloudSaveTimer = null;
  let authBusy = false;
  let currentSubjectId = null;
  let selectedIcon = icons[0];
  let session = null;
  let toastTimer;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const byId = id => document.getElementById(id);
  const uid = () => (window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const getSubject = id => data.subjects.find(subject => subject.id === id);
  const getTopic = (subject, id) => subject?.topics.find(topic => topic.id === id);
  const allQuestions = () => data.subjects.flatMap(subject => subject.topics.flatMap(topic => topic.questions.map(question => ({ ...question, subjectId: subject.id, subjectName: subject.name, subjectIcon: subject.icon, topicId: topic.id, topicName: topic.name }))));

  function loadData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.subjects)) {
        saved.subjects = saved.subjects.map(subject => ({
          id: subject.id || uid(), name: String(subject.name || 'Matéria'), description: String(subject.description || ''), icon: subject.icon || icons[0],
          topics: Array.isArray(subject.topics) ? subject.topics.map(topic => ({
            id: topic.id || uid(), name: String(topic.name || 'Assunto'), description: String(topic.description || ''),
            questions: Array.isArray(topic.questions) ? topic.questions.map(question => ({ id: question.id || uid(), prompt: String(question.prompt || ''), answer: String(question.answer || ''), type: question.type === 'closed' ? 'closed' : 'open', options: Array.isArray(question.options) ? question.options.map(String) : [] })) : []
          })) : []
        }));
        saved.practicedSessions = Number(saved.practicedSessions) || 0;
        return saved;
      }
    } catch (error) {
      console.warn('Não foi possível ler os dados salvos do PIF.', error);
    }
    return emptyData();
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      scheduleCloudSave();
      return true;
    } catch (error) {
      showToast('Não consegui salvar. Verifique o espaço disponível no navegador.');
      return false;
    }
  }

  function scheduleCloudSave() {
    if (!currentUser || !cloudReady || !supabaseClient) return;
    const userId = currentUser.id;
    const snapshot = JSON.parse(JSON.stringify(data));
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(async () => {
      if (!currentUser || currentUser.id !== userId || !cloudReady) return;
      const { error } = await supabaseClient.from('pif_data').upsert({
        user_id: userId,
        data: snapshot,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      if (error) {
        console.error('Falha ao sincronizar dados do PIF:', error);
        showToast('Não consegui sincronizar agora. Confira sua conexão.');
        updateStorageStatus('Falha na sincronização');
      } else updateStorageStatus('Salvo na nuvem');
    }, 350);
  }

  function updateStorageStatus(message) {
    const status = byId('storageStatus');
    if (status) status.textContent = message;
  }

  function updateAuthView() {
    const button = byId('authButton');
    const avatar = byId('userAvatar');
    if (!button || !avatar) return;
    if (currentUser) {
      button.textContent = 'Sair';
      avatar.textContent = (currentUser.email || 'E').slice(0, 1).toUpperCase();
      avatar.title = currentUser.email || 'Conta conectada';
      updateStorageStatus(cloudReady ? 'Sincronizado na nuvem' : 'Conectando à nuvem…');
    } else {
      button.textContent = 'Entrar';
      avatar.textContent = 'E';
      avatar.title = 'Seu perfil';
      updateStorageStatus('Salvo neste navegador');
    }
  }

  async function handleSignedInUser(user) {
    if (!user || !supabaseClient) {
      currentUser = null;
      cloudReady = false;
      updateAuthView();
      return;
    }
    if (loadingUserId === user.id || (currentUser?.id === user.id && cloudReady)) return;
    loadingUserId = user.id;
    currentUser = user;
    cloudReady = false;
    updateAuthView();

    const markerKey = 'estudai.lastUserId';
    const previousUserId = localStorage.getItem(markerKey);
    if (previousUserId && previousUserId !== user.id) {
      data = emptyData();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    const { data: row, error } = await supabaseClient.from('pif_data').select('data').eq('user_id', user.id).maybeSingle();
    if (error) {
      console.error('Falha ao carregar dados do PIF:', error);
      updateStorageStatus('Verifique a tabela e as regras do banco');
      showToast('A conta entrou, mas não consegui abrir o banco. Confira a configuração no Supabase.');
      loadingUserId = null;
      return;
    }

    const localHasData = data.subjects.length > 0 || data.practicedSessions > 0;
    if (row?.data) {
      if (localHasData && !previousUserId) {
        const useLocal = window.confirm('Há matérias neste navegador e dados na sua conta. OK envia as matérias deste navegador para a nuvem; Cancelar carrega o que já está na nuvem.');
        if (useLocal) {
          const { error: saveError } = await supabaseClient.from('pif_data').upsert({ user_id: user.id, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
          if (saveError) { showToast('Não consegui enviar as matérias para a nuvem.'); loadingUserId = null; return; }
        } else data = row.data;
      } else data = row.data;
    } else {
      const { error: saveError } = await supabaseClient.from('pif_data').upsert({ user_id: user.id, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (saveError) { showToast('Não consegui criar seu espaço no banco. Confira as regras da tabela.'); loadingUserId = null; return; }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(markerKey, user.id);
    cloudReady = true;
    loadingUserId = null;
    render();
    updateAuthView();
    showToast('Sua conta está conectada e as matérias foram sincronizadas.');
  }

  function openAuthModal() {
    if (!supabaseClient) { showToast('A conexão com o Supabase ainda não está configurada.'); return; }
    authBusy = false;
    byId('authForm').reset();
    byId('authTitle').innerHTML = 'Entre na sua conta<span class="title-dot">.</span>';
    byId('authDescription').textContent = 'Entre ou crie uma conta para salvar suas matérias na nuvem.';
    byId('signInButton').innerHTML = 'Entrar <span>→</span>';
    byId('createAccount').hidden = false;
    openModal(byId('authModal'));
  }

  async function createAccount() {
    if (authBusy) return;
    const email = byId('authEmail').value.trim();
    const password = byId('authPassword').value;
    if (!byId('authEmail').reportValidity() || !password || password.length < 6) {
      if (password.length < 6) { byId('authPassword').setCustomValidity('Use pelo menos 6 caracteres.'); byId('authPassword').reportValidity(); byId('authPassword').setCustomValidity(''); }
      return;
    }
    authBusy = true;
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { data: result, error } = await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
    authBusy = false;
    if (error) { showToast(error.message); return; }
    if (result.session) closeModals();
    else {
      byId('authDescription').textContent = 'Conta criada! Confira seu e-mail para confirmar o cadastro e depois entre.';
      byId('createAccount').hidden = true;
      showToast('Confira seu e-mail para confirmar a conta.');
    }
  }

  async function signIn() {
    if (authBusy) return;
    const email = byId('authEmail').value.trim();
    const password = byId('authPassword').value;
    if (!byId('authEmail').reportValidity() || !password) return;
    authBusy = true;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    authBusy = false;
    if (error) { showToast('Não consegui entrar. Confira o e-mail e a senha.'); return; }
    closeModals();
  }

  async function signOut() {
    if (!supabaseClient || !currentUser) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) { showToast('Não consegui sair da conta. Tente novamente.'); return; }
    currentUser = null; cloudReady = false; session = null; data = emptyData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    currentSubjectId = null; render(); navigate('home'); updateAuthView();
    showToast('Você saiu da conta. Seus dados continuam na nuvem.');
  }

  function initializeCloudAuth() {
    if (!supabaseClient) { updateAuthView(); return; }
    supabaseClient.auth.onAuthStateChange((_event, authSession) => {
      if (authSession?.user) setTimeout(() => handleSignedInUser(authSession.user), 0);
    });
    supabaseClient.auth.getSession().then(({ data: result }) => {
      if (result.session?.user) handleSignedInUser(result.session.user);
      else updateAuthView();
    }).catch(error => {
      console.error('Falha ao verificar dados do PIF:', error);
      updateAuthView();
    });
  }

  function exportBackup() {
    const backup = { format: 'pif-backup', version: 1, exportedAt: new Date().toISOString(), data };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pif-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    showToast('Cópia das suas matérias baixada.');
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const importedData = ['pif-backup', 'estudai-backup'].includes(backup?.format) ? backup.data : backup;
      if (!importedData || !Array.isArray(importedData.subjects)) throw new Error('invalid backup');
      if (data.subjects.length && !window.confirm('Importar essa cópia vai substituir as matérias que estão neste navegador. Quer continuar?')) return;
      const previousData = data;
      data = {
        subjects: importedData.subjects.map(subject => ({
          id: String(subject.id || uid()), name: String(subject.name || 'Matéria'), description: String(subject.description || ''), icon: String(subject.icon || icons[0]),
          topics: Array.isArray(subject.topics) ? subject.topics.map(topic => ({
            id: String(topic.id || uid()), name: String(topic.name || 'Assunto'), description: String(topic.description || ''),
            questions: Array.isArray(topic.questions) ? topic.questions.map(question => ({ id: String(question.id || uid()), prompt: String(question.prompt || ''), answer: String(question.answer || ''), type: question.type === 'closed' ? 'closed' : 'open', options: Array.isArray(question.options) ? question.options.map(String) : [] })) : []
          })) : []
        })),
        practicedSessions: Number(importedData.practicedSessions) || 0
      };
      if (!persist()) { data = previousData; return; }
      currentSubjectId = null; session = null; render(); navigate('home');
      showToast('Cópia importada. Suas matérias já estão aqui!');
    } catch (error) {
      showToast('Não consegui ler esse arquivo. Escolha uma cópia do PIF.');
    } finally {
      byId('backupFile').value = '';
    }
  }

  function showToast(message) {
    const toast = byId('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
  }

  function questionCount(subject) {
    return subject.topics.reduce((total, topic) => total + topic.questions.length, 0);
  }

  function cardMarkup(subject, index) {
    const palette = colors[index % colors.length];
    const count = questionCount(subject);
    const topicCount = subject.topics.length;
    return `<article class="subject-card" role="button" tabindex="0" data-open-subject="${escapeHTML(subject.id)}" aria-label="Abrir matéria ${escapeHTML(subject.name)}">
      <div class="subject-card-top"><span class="subject-card-icon" style="background:${palette.bg};color:${palette.fg}">${escapeHTML(subject.icon)}</span><div class="subject-card-tools"><button class="delete-subject-button" data-delete-subject="${escapeHTML(subject.id)}" aria-label="Apagar matéria ${escapeHTML(subject.name)}" title="Apagar matéria">×</button><span class="subject-card-arrow">↗</span></div></div>
      <h3>${escapeHTML(subject.name)}</h3><p>${escapeHTML(subject.description || 'Seu espaço para aprender')}</p>
      <div class="subject-card-foot"><span>${topicCount} ${topicCount === 1 ? 'assunto' : 'assuntos'}</span><span class="card-question-count"><span>✳</span>${count} ${count === 1 ? 'pergunta' : 'perguntas'}</span></div>
    </article>`;
  }

  function render() {
    renderSubjects();
    renderSidebar();
    renderStats();
    renderPracticeFilters();
    if (currentSubjectId && getSubject(currentSubjectId)) renderDetail();
    else if (byId('detailView').classList.contains('active-page')) navigate('subjects');
    if (session && !byId('practiceView').classList.contains('active-page')) session = null;
    if (session) renderSession();
  }

  function renderSubjects() {
    const empty = `<div class="empty-subjects"><div><strong>Seu espaço começa do seu jeito.</strong><p>Crie a primeira matéria e organize nela tudo o que quiser estudar.</p></div><span class="empty-subjects-icon">✳</span></div>`;
    const cards = data.subjects.map(cardMarkup).join('');
    byId('homeSubjectGrid').innerHTML = cards || empty;
    byId('allSubjectGrid').innerHTML = cards || empty;
    const total = data.subjects.length;
    byId('subjectCountLabel').textContent = `${total} ${total === 1 ? 'matéria' : 'matérias'}`;
    bindSubjectCards();
  }

  function bindSubjectCards() {
    $$('[data-open-subject]').forEach(card => {
      const open = () => openSubject(card.dataset.openSubject);
      card.addEventListener('click', open);
      card.addEventListener('keydown', event => { if (event.target === card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); } });
      const deleteButton = $('[data-delete-subject]', card);
      if (deleteButton) deleteButton.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        deleteSubject(deleteButton.dataset.deleteSubject);
      });
    });
  }

  function renderSidebar() {
    byId('subjectNav').innerHTML = data.subjects.length
      ? data.subjects.slice(0, 7).map(subject => `<button class="subject-nav-item" data-open-subject="${escapeHTML(subject.id)}"><span class="subject-nav-icon">${escapeHTML(subject.icon)}</span><span>${escapeHTML(subject.name)}</span></button>`).join('')
      : '<div class="nav-empty">Suas matérias aparecem aqui.</div>';
    $$('.subject-nav-item').forEach(button => button.addEventListener('click', () => openSubject(button.dataset.openSubject)));
  }

  function renderStats() {
    byId('statSubjects').textContent = data.subjects.length;
    byId('statQuestions').textContent = allQuestions().length;
    byId('statPracticed').textContent = data.practicedSessions;
    byId('practiceProgress').style.width = `${data.practicedSessions ? 100 : 0}%`;
  }

  function openSubject(id) {
    const subject = getSubject(id);
    if (!subject) return;
    currentSubjectId = id;
    renderDetail();
    navigate('detail');
    closeSidebar();
  }

  function renderDetail() {
    const subject = getSubject(currentSubjectId);
    if (!subject) return;
    const index = data.subjects.indexOf(subject);
    const palette = colors[index % colors.length];
    byId('detailIcon').textContent = subject.icon;
    byId('detailIcon').style.background = palette.bg;
    byId('detailIcon').style.color = palette.fg;
    byId('detailTitle').textContent = subject.name;
    byId('detailDescription').textContent = subject.description || `${subject.topics.length} ${subject.topics.length === 1 ? 'assunto' : 'assuntos'} · ${questionCount(subject)} perguntas`;
    const topics = byId('topicList');
    if (!subject.topics.length) {
      topics.innerHTML = `<div class="empty-detail"><div>✧</div><h3>Comece por um assunto.</h3><p>Separe essa matéria em partes menores para estudar melhor.</p><button class="secondary-button" data-create-topic>＋ Criar primeiro assunto</button></div>`;
      $('[data-create-topic]', topics).addEventListener('click', () => openTopicModal());
      return;
    }
    topics.innerHTML = subject.topics.map(topic => `<article class="topic-card" data-topic-card="${escapeHTML(topic.id)}">
      <div class="topic-head"><button class="topic-toggle" data-toggle-topic="${escapeHTML(topic.id)}" aria-label="Expandir assunto">›</button><div class="topic-heading-text"><h3>${escapeHTML(topic.name)}</h3><p>${escapeHTML(topic.description || 'Adicione perguntas para praticar')}</p></div><span class="topic-count">${topic.questions.length} ${topic.questions.length === 1 ? 'pergunta' : 'perguntas'}</span><div class="topic-actions"><button class="subtle-button" data-bulk-import="${escapeHTML(topic.id)}">Colar bloco</button><button class="subtle-button" data-add-question="${escapeHTML(topic.id)}">＋ Pergunta</button><button class="delete-topic-button" data-delete-topic="${escapeHTML(topic.id)}" aria-label="Apagar assunto ${escapeHTML(topic.name)}" title="Apagar assunto">×</button></div></div>
      <div class="topic-questions">${topic.questions.length ? topic.questions.map(question => `<div class="question-row" data-question-row="${escapeHTML(question.id)}"><span class="question-row-mark">?</span><div class="question-row-content"><strong>${escapeHTML(question.prompt)}</strong><button data-reveal-answer="${escapeHTML(question.id)}">Ver resposta</button><span>${escapeHTML(question.answer)}</span></div><button class="delete-question" data-delete-question="${escapeHTML(question.id)}" aria-label="Apagar pergunta">×</button></div>`).join('') : '<div class="empty-topic">Ainda sem perguntas. Adicione a primeira para começar seu treino.</div>'}</div>
    </article>`).join('');
    $$('[data-toggle-topic]', topics).forEach(button => button.addEventListener('click', () => button.closest('.topic-card').classList.toggle('expanded')));
    $$('[data-add-question]', topics).forEach(button => button.addEventListener('click', () => openQuestionModal(button.dataset.addQuestion)));
    $$('[data-bulk-import]', topics).forEach(button => button.addEventListener('click', () => openBulkModal(button.dataset.bulkImport)));
    $$('[data-reveal-answer]', topics).forEach(button => button.addEventListener('click', () => {
      const row = button.closest('.question-row');
      row.classList.toggle('show-answer');
      button.textContent = row.classList.contains('show-answer') ? 'Esconder resposta' : 'Ver resposta';
    }));
    $$('[data-delete-question]', topics).forEach(button => button.addEventListener('click', () => deleteQuestion(button.dataset.deleteQuestion)));
    $$('[data-delete-topic]', topics).forEach(button => button.addEventListener('click', () => deleteTopic(button.dataset.deleteTopic)));
  }

  function openModal(dialog) { if (!dialog.open) dialog.showModal(); }
  function closeModals() { $$('dialog[open]').forEach(dialog => dialog.close()); }
  function openSubjectModal() {
    selectedIcon = icons[0];
    byId('subjectForm').reset();
    renderIconChoices();
    openModal(byId('subjectModal'));
    setTimeout(() => byId('subjectName').focus(), 50);
  }
  function renderIconChoices() {
    byId('iconChoices').innerHTML = icons.map((icon, index) => `<button type="button" class="icon-choice ${index === 0 ? 'selected' : ''}" data-icon-choice="${escapeHTML(icon)}" aria-label="Ícone ${escapeHTML(icon)}">${escapeHTML(icon)}</button>`).join('');
    $$('[data-icon-choice]').forEach(button => button.addEventListener('click', () => {
      selectedIcon = button.dataset.iconChoice;
      $$('[data-icon-choice]').forEach(option => option.classList.toggle('selected', option === button));
    }));
  }
  function openTopicModal() {
    byId('topicForm').reset();
    openModal(byId('topicModal'));
    setTimeout(() => byId('topicName').focus(), 50);
  }
  function openQuestionModal(topicId = '') {
    const subject = getSubject(currentSubjectId);
    if (!subject) { showToast('Abra uma matéria antes de adicionar perguntas.'); return; }
    if (!subject.topics.length) { showToast('Crie um assunto primeiro para organizar a pergunta.'); openTopicModal(); return; }
    byId('questionForm').reset();
    byId('questionTopic').innerHTML = subject.topics.map(topic => `<option value="${escapeHTML(topic.id)}" ${topic.id === topicId ? 'selected' : ''}>${escapeHTML(topic.name)}</option>`).join('');
    byId('questionModalKicker').textContent = subject.name.toUpperCase();
    byId('questionModalSub').textContent = 'Escreva uma pergunta e a resposta para praticar depois.';
    openModal(byId('questionModal'));
    setTimeout(() => byId('questionText').focus(), 50);
  }

  let bulkTopicId = null;
  let parsedBulk = [];
  function openBulkModal(topicId) {
    const subject = getSubject(currentSubjectId);
    if (!subject || !getTopic(subject, topicId)) return;
    bulkTopicId = topicId;
    parsedBulk = [];
    byId('bulkForm').reset();
    byId('bulkPreview').innerHTML = '';
    byId('bulkActions').hidden = true;
    byId('bulkModalKicker').textContent = `${subject.name} · ${getTopic(subject, topicId).name}`.toUpperCase();
    openModal(byId('bulkModal'));
    setTimeout(() => byId('bulkText').focus(), 50);
  }

  function classifyQuestion(prompt, answer, options) {
    const q = prompt.toLocaleLowerCase('pt-BR').trim();
    const a = answer.toLocaleLowerCase('pt-BR').trim().replace(/[.!?]+$/, '');
    if (options.length || /^(sim|não|nao|verdadeiro|falso|certo|errado|yes|no)$/.test(a)) return 'closed';
    if (/^(é|foi|são|sao|tem|têm|existe|existem|pode|podem|deve|devem|quem|qual|quais|quando|onde|quantos?|quantas?)\b/.test(q)) return 'closed';
    return 'open';
  }

  function parseBulkText(text) {
    const records = [];
    let current = null;
    const flush = () => {
      if (current?.prompt?.trim() && current?.answer?.trim()) {
        current.prompt = current.prompt.trim().replace(/^[-•\d.)\s]+/, '');
        current.answer = current.answer.trim();
        current.options = [...new Set(current.options.map(option => option.trim()).filter(Boolean))];
        current.type = classifyQuestion(current.prompt, current.answer, current.options);
        records.push(current);
      }
      current = null;
    };
    for (const rawLine of text.replace(/\r/g, '').split('\n')) {
      const line = rawLine.trim();
      if (!line) { if (current?.prompt && current?.answer) flush(); continue; }
      const q = line.match(/^(?:pergunta|quest[aã]o|question|q)\s*(?:\d+)?\s*[:.)-]\s*(.*)$/i);
      const a = line.match(/^(?:resposta|answer|resp|r|a)\s*(?:\d+)?\s*[:.)-]\s*(.*)$/i);
      const option = line.match(/^(?:\(?[a-h]\)?[.)]|[-•])\s+(.+)$/i);
      if (q) { flush(); current = { prompt: q[1], answer: '', options: [] }; continue; }
      if (a && current) { current.answer = a[1]; continue; }
      if (option && current && !current.answer) { current.options.push(line); continue; }
      if (current?.answer && /\?\s*$/.test(line)) { flush(); current = { prompt: line, answer: '', options: [] }; continue; }
      if (!current) current = { prompt: line, answer: '', options: [] };
      else if (!current.answer && !current.prompt.includes('?')) current.prompt += ` ${line}`;
      else if (!current.answer) current.answer = line;
      else current.answer += ` ${line}`;
    }
    flush();
    return records;
  }

  function renderBulkPreview() {
    const preview = byId('bulkPreview');
    if (!parsedBulk.length) {
      preview.innerHTML = '<div class="bulk-no-results">Não encontrei pares completos. Tente marcar cada bloco com “Pergunta:” e “Resposta:”.</div>';
      byId('bulkActions').hidden = true;
      return;
    }
    preview.innerHTML = `<div class="bulk-preview-head"><strong>${parsedBulk.length} ${parsedBulk.length === 1 ? 'pergunta encontrada' : 'perguntas encontradas'}</strong><span>Confira o texto e o tipo antes de salvar</span></div>` + parsedBulk.map((item, index) => `<article class="bulk-preview-card"><div class="bulk-preview-meta"><span>PERGUNTA ${index + 1}</span><select data-bulk-type="${index}" aria-label="Tipo da pergunta"><option value="open" ${item.type === 'open' ? 'selected' : ''}>Aberta</option><option value="closed" ${item.type === 'closed' ? 'selected' : ''}>Fechada</option></select></div><textarea data-bulk-prompt="${index}" rows="2" aria-label="Pergunta">${escapeHTML(item.prompt)}</textarea>${item.options.length ? `<div class="bulk-options-label">Alternativas detectadas (uma por linha)</div><textarea data-bulk-options="${index}" rows="3" aria-label="Alternativas">${escapeHTML(item.options.join('\n'))}</textarea>` : ''}<textarea data-bulk-answer="${index}" rows="2" aria-label="Resposta">${escapeHTML(item.answer)}</textarea></article>`).join('');
    byId('bulkActions').hidden = false;
  }

  function saveBulkQuestions() {
    const subject = getSubject(currentSubjectId);
    const topic = getTopic(subject, bulkTopicId);
    if (!topic) return;
    const imported = [];
    parsedBulk.forEach((item, index) => {
      const prompt = $(`[data-bulk-prompt="${index}"]`)?.value.trim();
      const answer = $(`[data-bulk-answer="${index}"]`)?.value.trim();
      const type = $(`[data-bulk-type="${index}"]`)?.value || item.type;
      const options = ($(`[data-bulk-options="${index}"]`)?.value || '').split('\n').map(line => line.trim()).filter(Boolean);
      if (prompt && answer) imported.push({ id: uid(), prompt, answer, type, options });
    });
    if (!imported.length) { showToast('Revise a prévia: preciso de pergunta e resposta em cada item.'); return; }
    topic.questions.push(...imported);
    persist(); closeModals(); render();
    const card = $(`[data-topic-card="${CSS.escape(topic.id)}"]`);
    if (card) card.classList.add('expanded');
    showToast(`${imported.length} ${imported.length === 1 ? 'pergunta salva' : 'perguntas salvas'} no assunto!`);
  }

  function deleteQuestion(id) {
    const subject = getSubject(currentSubjectId);
    if (!subject) return;
    for (const topic of subject.topics) {
      const index = topic.questions.findIndex(question => question.id === id);
      if (index >= 0) {
        if (!window.confirm('Apagar esta pergunta?')) return;
        topic.questions.splice(index, 1);
        persist(); render(); showToast('Pergunta removida.'); return;
      }
    }
  }

  function deleteTopic(id) {
    const subject = getSubject(currentSubjectId);
    const topic = getTopic(subject, id);
    if (!subject || !topic) return;
    const count = topic.questions.length;
    const detail = count ? ` Ela também apagará ${count} ${count === 1 ? 'pergunta deste assunto' : 'perguntas deste assunto'}.` : '';
    if (!window.confirm(`Apagar o assunto “${topic.name}”?${detail}`)) return;
    subject.topics = subject.topics.filter(item => item.id !== id);
    persist(); render(); showToast('Assunto removido.');
  }

  function deleteSubject(id) {
    const subject = getSubject(id);
    if (!subject) return;
    const count = questionCount(subject);
    const detail = count ? ` Isso também apagará os ${count} ${count === 1 ? 'cartão de pergunta' : 'cartões de pergunta'} dessa matéria.` : '';
    if (!window.confirm(`Apagar a matéria “${subject.name}” e todos os seus assuntos?${detail}`)) return;
    data.subjects = data.subjects.filter(item => item.id !== id);
    if (currentSubjectId === id) currentSubjectId = null;
    persist(); render();
    if (!getSubject(currentSubjectId) && byId('detailView').classList.contains('active-page')) navigate('subjects');
    showToast('Matéria removida.');
  }

  function renderPracticeFilters() {
    const subjectSelect = byId('practiceSubject');
    const topicSelect = byId('practiceTopic');
    const priorSubject = subjectSelect.value;
    const priorTopic = topicSelect.value;
    subjectSelect.innerHTML = '<option value="">Todas as matérias</option>' + data.subjects.map(subject => `<option value="${escapeHTML(subject.id)}">${escapeHTML(subject.name)}</option>`).join('');
    if (data.subjects.some(subject => subject.id === priorSubject)) subjectSelect.value = priorSubject;
    updatePracticeTopics(priorTopic);
  }

  function updatePracticeTopics(preferred = '') {
    const subjectId = byId('practiceSubject').value;
    const topics = subjectId ? (getSubject(subjectId)?.topics || []) : data.subjects.flatMap(subject => subject.topics.map(topic => ({ ...topic, subjectId: subject.id })));
    const topicSelect = byId('practiceTopic');
    topicSelect.innerHTML = '<option value="">Todos os assuntos</option>' + topics.map(topic => `<option value="${escapeHTML(topic.id)}">${escapeHTML(topic.name)}</option>`).join('');
    if (topics.some(topic => topic.id === preferred)) topicSelect.value = preferred;
    const available = filteredQuestions().length;
    byId('practiceAvailable').textContent = available;
    byId('startPractice').disabled = available === 0;
    byId('startPractice').style.opacity = available === 0 ? '.55' : '1';
  }

  function filteredQuestions() {
    const subjectId = byId('practiceSubject').value;
    const topicId = byId('practiceTopic').value;
    return allQuestions().filter(question => (!subjectId || question.subjectId === subjectId) && (!topicId || question.topicId === topicId));
  }

  function startPractice() {
    const questions = filteredQuestions();
    if (!questions.length) { showToast('Adicione algumas perguntas para começar a praticar.'); return; }
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
    session = { questions, index: 0, revealed: false, knew: 0 };
    renderSession();
  }

  function renderSession() {
    const stage = byId('practiceStage');
    if (!session) return;
    if (session.index >= session.questions.length) {
      data.practicedSessions += 1;
      persist();
      renderStats();
      stage.innerHTML = `<div class="complete-state"><div class="complete-icon">✦</div><h2>Sessão concluída!</h2><p>Você praticou <strong>${session.questions.length} ${session.questions.length === 1 ? 'pergunta' : 'perguntas'}</strong>${session.questions.length ? ` e lembrou de <strong>${session.knew}</strong>` : ''}. Cada revisão ajuda o conhecimento a ficar.</p><button class="primary-button" id="againPractice">Praticar mais <span>→</span></button></div>`;
      byId('againPractice').addEventListener('click', startPractice);
      session = null;
      return;
    }
    const question = session.questions[session.index];
    const progress = Math.round((session.index / session.questions.length) * 100);
    const closed = question.type === 'closed';
    let answerArea;
    if (closed && session.closedResult) {
      const result = session.closedResult;
      answerArea = `<div class="revealed-answer ${result.correct ? 'answer-correct' : 'answer-incorrect'}"><strong>${result.correct ? 'Isso! Resposta certa.' : 'Quase! Vamos guardar a resposta certa:'}</strong><br>${escapeHTML(question.answer)}</div><div class="session-actions"><span></span><div class="answer-actions"><button class="knew-it" id="nextQuestion">Continuar →</button></div></div>`;
    } else if (closed && question.options?.length) {
      answerArea = `<div class="choice-list">${question.options.map((option, index) => `<button class="choice-button" data-choice="${index}">${escapeHTML(option)}</button>`).join('')}</div>`;
    } else if (closed) {
      answerArea = `<div class="closed-answer-entry"><input id="closedAnswerInput" placeholder="Digite sua resposta..." aria-label="Sua resposta"><button class="reveal-button" id="checkClosedAnswer">Conferir</button></div>`;
    } else if (session.revealed) {
      answerArea = `${session.userAnswer ? `<div class="user-answer-note"><span>SUA RESPOSTA</span><p>${escapeHTML(session.userAnswer)}</p></div>` : ''}<div class="revealed-answer">${escapeHTML(question.answer)}</div><div class="session-actions"><span>Como foi dessa vez?</span><div class="answer-actions"><button class="didnt-know" id="didntKnow">Vou revisar</button><button class="knew-it" id="knewIt">Eu sabia ✓</button></div></div>`;
    } else answerArea = `<textarea class="open-answer-input" id="openAnswerInput" rows="3" placeholder="Escreva sua resposta com suas palavras..."></textarea><button class="reveal-button" id="revealAnswer">Ver resposta e comparar&nbsp; ↓</button>`;
    stage.innerHTML = `<div class="question-session"><div class="session-top"><span>PERGUNTA ${session.index + 1} DE ${session.questions.length}</span><span>${progress}%</span></div><div class="session-progress"><span style="width:${progress}%"></span></div><div class="session-tags"><span class="session-tag">${escapeHTML(question.subjectName)}</span><span class="session-tag">${escapeHTML(question.topicName)}</span><span class="session-tag">${closed ? 'Fechada' : 'Aberta'}</span></div><h2 class="session-question">${escapeHTML(question.prompt)}</h2>${answerArea}</div>`;
    const reveal = byId('revealAnswer');
    if (reveal) reveal.addEventListener('click', () => { session.userAnswer = byId('openAnswerInput')?.value.trim() || ''; session.revealed = true; renderSession(); });
    const advance = knew => {
      if (knew) session.knew += 1;
      session.index += 1;
      session.revealed = false;
      session.userAnswer = '';
      session.closedResult = null;
      renderSession();
    };
    if (byId('didntKnow')) byId('didntKnow').addEventListener('click', () => advance(false));
    if (byId('knewIt')) byId('knewIt').addEventListener('click', () => advance(true));
    if (byId('nextQuestion')) byId('nextQuestion').addEventListener('click', () => { session.index++; session.revealed = false; session.closedResult = null; renderSession(); });
    const checkAnswer = (chosen, choiceIndex = null) => {
      const normalize = value => value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^[a-h][.)]\s*/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const answerLetter = question.answer.match(/^\s*([a-h])(?:[.)\s:]|$)/i)?.[1]?.toUpperCase();
      const chosenLetter = choiceIndex === null ? null : question.options[choiceIndex]?.match(/^\s*\(?([a-h])\)?[.)]/i)?.[1]?.toUpperCase();
      const correct = normalize(chosen) === normalize(question.answer) || Boolean(answerLetter && chosenLetter && answerLetter === chosenLetter);
      if (correct) session.knew++;
      session.closedResult = { correct };
      renderSession();
    };
    $$('[data-choice]', stage).forEach(button => button.addEventListener('click', () => checkAnswer(button.textContent, Number(button.dataset.choice))));
    if (byId('checkClosedAnswer')) byId('checkClosedAnswer').addEventListener('click', () => checkAnswer(byId('closedAnswerInput').value));
  }

  function navigate(view) {
    const pageIds = { home: 'homeView', subjects: 'subjectsView', detail: 'detailView', practice: 'practiceView' };
    const labels = { home: 'Visão geral', subjects: 'Minhas matérias', detail: getSubject(currentSubjectId)?.name || 'Matéria', practice: 'Praticar' };
    Object.entries(pageIds).forEach(([key, id]) => byId(id).classList.toggle('active-page', key === view));
    $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === (view === 'detail' ? 'subjects' : view)));
    byId('currentCrumb').textContent = labels[view] || labels.home;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeSidebar();
  }

  function closeSidebar() { byId('sidebar').classList.remove('open'); }

  byId('subjectForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = byId('subjectName').value.trim();
    if (!name) return;
    const subject = { id: uid(), name, description: byId('subjectDescription').value.trim(), icon: selectedIcon, topics: [] };
    data.subjects.push(subject);
    persist(); closeModals(); render(); openSubject(subject.id); showToast('Matéria criada. Agora escolha um assunto!');
  });

  byId('topicForm').addEventListener('submit', event => {
    event.preventDefault();
    const subject = getSubject(currentSubjectId);
    const name = byId('topicName').value.trim();
    if (!subject || !name) return;
    const topic = { id: uid(), name, description: byId('topicDescription').value.trim(), questions: [] };
    subject.topics.push(topic);
    persist(); closeModals(); render();
    const card = $(`[data-topic-card="${CSS.escape(topic.id)}"]`);
    if (card) card.classList.add('expanded');
    showToast('Assunto criado. Você já pode adicionar uma pergunta.');
  });

  byId('questionForm').addEventListener('submit', event => {
    event.preventDefault();
    const subject = getSubject(currentSubjectId);
    const topic = getTopic(subject, byId('questionTopic').value);
    const prompt = byId('questionText').value.trim();
    const answer = byId('answerText').value.trim();
    if (!topic || !prompt || !answer) return;
    topic.questions.push({ id: uid(), prompt, answer, type: classifyQuestion(prompt, answer, []), options: [] });
    persist(); closeModals(); render();
    const card = $(`[data-topic-card="${CSS.escape(topic.id)}"]`);
    if (card) card.classList.add('expanded');
    showToast('Pergunta salva. Ela já está pronta para praticar!');
  });

  byId('parseBulk').addEventListener('click', () => {
    parsedBulk = parseBulkText(byId('bulkText').value);
    renderBulkPreview();
  });
  byId('bulkForm').addEventListener('submit', event => { event.preventDefault(); saveBulkQuestions(); });

  byId('addSubjectSide').addEventListener('click', openSubjectModal);
  byId('exportData').addEventListener('click', exportBackup);
  byId('importData').addEventListener('click', () => byId('backupFile').click());
  byId('backupFile').addEventListener('change', event => importBackup(event.target.files?.[0]));
  byId('authButton').addEventListener('click', () => currentUser ? signOut() : openAuthModal());
  byId('authForm').addEventListener('submit', event => { event.preventDefault(); signIn(); });
  byId('createAccount').addEventListener('click', createAccount);
  byId('addSubjectMain').addEventListener('click', openSubjectModal);
  byId('addTopicButton').addEventListener('click', openTopicModal);
  byId('backToSubjects').addEventListener('click', () => navigate('subjects'));
  byId('practiceSubject').addEventListener('change', () => updatePracticeTopics());
  byId('practiceTopic').addEventListener('change', () => { byId('practiceAvailable').textContent = filteredQuestions().length; });
  byId('startPractice').addEventListener('click', startPractice);
  byId('menuToggle').addEventListener('click', () => byId('sidebar').classList.toggle('open'));
  $$('.nav-link').forEach(link => link.addEventListener('click', () => navigate(link.dataset.view)));
  $$('[data-go]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.go)));
  $$('[data-close-modal]').forEach(button => button.addEventListener('click', closeModals));
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-delete-subject]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    deleteSubject(button.dataset.deleteSubject);
  });
  $$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSidebar(); });

  const now = new Date();
  byId('todayLabel').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).format(now).replace('.', '');
  render();
  initializeCloudAuth();
})();
