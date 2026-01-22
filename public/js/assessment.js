(function(){
  const genForm = document.getElementById('genForm');
  const genBtn = document.getElementById('genBtn');
  const genStatus = document.getElementById('genStatus');
  const authWarn = document.getElementById('authWarn');

  const testWrap = document.getElementById('testWrap');
  const testMeta = document.getElementById('testMeta');
  const questionsEl = document.getElementById('questions');
  const submitBtn = document.getElementById('submitBtn');
  const submitStatus = document.getElementById('submitStatus');

  const resultWrap = document.getElementById('resultWrap');
  const scoreText = document.getElementById('scoreText');
  const breakdownEl = document.getElementById('breakdown');

  let currentAssessmentId = null;
  let currentQuestions = [];

  function normalizeQuestions(questions){
    const out = [];
    (questions||[]).forEach(q => {
      if (!q || !q.prompt) return;
      const prompt = String(q.prompt).trim();
      if (!prompt) return;
      if (q.type === 'mcq') {
        const opts = (Array.isArray(q.options)? q.options: []).map(o => String(o||'').trim()).filter(Boolean);
        if (opts.length < 2) return; // пропускаем пустые вопросы
        out.push({ id: q.id, type: 'mcq', prompt, options: opts });
      } else if (q.type === 'open') {
        out.push({ id: q.id, type: 'open', prompt });
      }
    });
    return out;
  }

  async function ensureAuth() {
    try {
      const r = await fetch('/api/user');
      const j = await r.json();
      if (!j?.authenticated) {
        authWarn.classList.remove('hidden');
        genBtn.disabled = true;
        return false;
      }
      authWarn.classList.add('hidden');
      genBtn.disabled = false;
      return true;
    } catch (_) {
      authWarn.classList.remove('hidden');
      genBtn.disabled = true;
      return false;
    }
  }

  function renderQuestions(questions){
    questionsEl.innerHTML = '';
    questions.forEach((q, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'border rounded p-3';
      const title = document.createElement('div');
      title.className = 'font-medium';
      title.textContent = `${idx+1}. ${q.prompt}`;
      wrap.appendChild(title);

      if (q.type === 'mcq' && Array.isArray(q.options)) {
        const list = document.createElement('div');
        list.className = 'mt-2 space-y-1';
        q.options.forEach((opt, i) => {
          const id = `${q.id}_${i}`;
          const label = document.createElement('label');
          label.className = 'flex items-center gap-2';
          label.innerHTML = `<input type="radio" name="${q.id}" value="${i}" id="${id}"> <span>${opt}</span>`;
          list.appendChild(label);
        });
        wrap.appendChild(list);
      } else if (q.type === 'open') {
        const ta = document.createElement('textarea');
        ta.className = 'mt-2 w-full border rounded px-3 py-2';
        ta.rows = 4;
        ta.name = q.id;
        ta.placeholder = 'Ваш ответ...';
        wrap.appendChild(ta);
      }

      questionsEl.appendChild(wrap);
    });
  }

  function collectAnswers(){
    const answers = [];
    currentQuestions.forEach(q => {
      if (q.type === 'mcq') {
        const checked = document.querySelector(`input[name="${q.id}"]:checked`);
        if (checked) answers.push({ id: q.id, answer: Number(checked.value) });
      } else if (q.type === 'open') {
        const ta = document.querySelector(`textarea[name="${q.id}"]`);
        answers.push({ id: q.id, answer: (ta?.value || '').trim() });
      }
    });
    return answers;
  }

  function renderResult(res){
    resultWrap.classList.remove('hidden');
    const pct = Math.round((res.score || 0) * 100);
    scoreText.textContent = `Итоговый результат: ${pct}%`;

    // Диаграмма качества: зелёный (полностью верно), жёлтый (частично), красный (неверно)
    const total = (res.breakdown || []).length || 1;
    const greenCount = (res.breakdown || []).filter(b => (b.type==='mcq' && (b.score||0) >= 1) || (b.type==='open' && (b.score||0) >= 0.99)).length;
    const yellowCount = (res.breakdown || []).filter(b => (b.type==='open' && (b.score||0) > 0 && (b.score||0) < 0.99)).length;
    const redCount = Math.max(0, total - greenCount - yellowCount);
    const greenPct = Math.round(greenCount*100/total);
    const yellowPct = Math.round(yellowCount*100/total);
    const redPct = 100 - greenPct - yellowPct;
    const chart = document.getElementById('qualityChart');
    const legend = document.getElementById('qualityLegend');
    if (chart) {
      chart.innerHTML = '';
      const segGreen = document.createElement('div');
      segGreen.style.width = greenPct + '%';
      segGreen.style.background = '#10b981';
      const segYellow = document.createElement('div');
      segYellow.style.width = yellowPct + '%';
      segYellow.style.background = '#f59e0b';
      const segRed = document.createElement('div');
      segRed.style.width = redPct + '%';
      segRed.style.background = '#ef4444';
      chart.appendChild(segGreen);
      chart.appendChild(segYellow);
      chart.appendChild(segRed);
    }
    if (legend) {
      legend.textContent = `Зелёный: ${greenPct}% • Жёлтый: ${yellowPct}% • Красный: ${redPct}%`;
    }

    breakdownEl.innerHTML = '';
    (res.breakdown || []).forEach(item => {
      const row = document.createElement('div');
      row.className = 'text-sm text-gray-700';
      let tag = '';
      if (item.type === 'mcq') tag = item.correct ? '✅' : '❌';
      else tag = `📝 ${Math.round((item.score||0)*100)}%`;
      row.textContent = `${tag} ${item.id}: ${item.reasoning||''}`;
      breakdownEl.appendChild(row);
    });
  }

  genForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    resultWrap.classList.add('hidden');
    submitStatus.textContent = '';

    if (!(await ensureAuth())) return;

    const profession = document.getElementById('profession').value.trim();
    const difficulty = document.getElementById('difficulty').value;
    const numQuestions = Number(document.getElementById('numQuestions').value) || 10;
    if (!profession) return;

    genBtn.disabled = true;
    genStatus.textContent = 'Генерация теста...';

    try {
      const r = await fetch('/api/assessment/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profession, difficulty, numQuestions })
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'Ошибка');

      currentAssessmentId = j.assessmentId;
      currentQuestions = normalizeQuestions(j.questions || []);
      renderQuestions(currentQuestions);
      testMeta.textContent = `${profession} • ${difficulty} • ${currentQuestions.length} вопросов`;
      testWrap.classList.remove('hidden');
      genStatus.textContent = 'Готово';
    } catch (err) {
      console.error(err);
      genStatus.textContent = `Ошибка: ${err.message || err}`;
    } finally {
      genBtn.disabled = false;
      setTimeout(() => genStatus.textContent = '', 3000);
    }
  });

  submitBtn.addEventListener('click', async () => {
    if (!currentAssessmentId) return;
    const answers = collectAnswers();
    if (!answers.length) {
      submitStatus.textContent = 'Ответы не заполнены';
      return;
    }

    submitBtn.disabled = true;
    submitStatus.textContent = 'Оценка ответов...';

    try {
      const r = await fetch('/api/assessment/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessmentId: currentAssessmentId, answers })
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'Ошибка');
      renderResult(j);
      submitStatus.textContent = 'Готово';
    } catch (err) {
      console.error(err);
      submitStatus.textContent = `Ошибка: ${err.message || err}`;
    } finally {
      submitBtn.disabled = false;
      setTimeout(() => submitStatus.textContent = '', 3000);
    }
  });

  // Initial auth check
  ensureAuth();
})();
