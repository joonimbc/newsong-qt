(() => {
  'use strict';

  const STORAGE_PREFIX = 'qt_entry_';
  const PREFS_KEY = 'qt_user_prefs_v2';
  const FONT_STEPS = ['sm', 'md', 'lg'];
  const FONT_LABELS = { sm: '가-', md: '가', lg: '가+' };
  const LANG_MODES = ['ko', 'en', 'both'];

  const state = {
    schedule: null,
    day: null,
    entry: null,
    prefs: {
      theme: 'light',
      font: 'md',
      lang: 'ko'
    },
    deferredInstallPrompt: null,
    saveTimer: null,
    toastTimer: null,
    breathTimer: null
  };

  const $ = (id) => document.getElementById(id);

  function getKstTodayDate() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (_err) {
      const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
      return now.toISOString().slice(0, 10);
    }
  }

  function shiftDate(dateStr, deltaDays) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
    return utc.toISOString().slice(0, 10);
  }

  function showToast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2600);
  }

  function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 64)}px`;
  }

  function autoResizeAllTextareas() {
    document.querySelectorAll('.qt-textarea').forEach(autoResizeTextarea);
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.theme === 'dark' || parsed.theme === 'light') {
          state.prefs.theme = parsed.theme;
        }
        if (FONT_STEPS.includes(parsed.font)) {
          state.prefs.font = parsed.font;
        }
        if (LANG_MODES.includes(parsed.lang)) {
          state.prefs.lang = parsed.lang;
        }
      }
    } catch (_err) {
      // ignore storage errors
    }
    applyPrefs();
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
    } catch (_err) {
      // ignore storage errors
    }
  }

  function applyPrefs() {
    document.documentElement.setAttribute('data-theme', state.prefs.theme);
    document.documentElement.setAttribute('data-font', state.prefs.font);

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute(
        'content',
        state.prefs.theme === 'dark' ? '#171512' : '#F8F5EE'
      );
    }

    const fontBtn = $('fontSizeBtn');
    if (fontBtn) fontBtn.textContent = FONT_LABELS[state.prefs.font] || '가';

    const themeBtn = $('themeToggleBtn');
    if (themeBtn) {
      themeBtn.setAttribute(
        'aria-label',
        state.prefs.theme === 'dark' ? '아침 모드로 전환' : '새벽 모드로 전환'
      );
    }

    updateLangButtons();
  }

  function updateLangButtons() {
    const map = {
      ko: $('langKoBtn'),
      en: $('langEnBtn'),
      both: $('langBothBtn')
    };
    Object.entries(map).forEach(([mode, btn]) => {
      if (!btn) return;
      const active = state.prefs.lang === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function createEmptyEntry(dateStr) {
    return {
      date: dateStr,
      icebreaker: '',
      highlightedVerses: [],
      answers: {},
      grace: '',
      area: '',
      applyWhen: '',
      applyAction: '',
      obstacle: '',
      prayBack: '',
      prayBackCustomized: false,
      reviewStatus: '',
      updatedAt: ''
    };
  }

  function loadEntry(dateStr) {
    const base = createEmptyEntry(dateStr);
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + dateStr);
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      return {
        ...base,
        ...parsed,
        highlightedVerses: Array.isArray(parsed.highlightedVerses)
          ? parsed.highlightedVerses
          : [],
        answers:
          parsed.answers && typeof parsed.answers === 'object'
            ? parsed.answers
            : {}
      };
    } catch (_err) {
      return base;
    }
  }

  function persistEntry() {
    if (!state.entry || !state.day) return;
    state.entry.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(
        STORAGE_PREFIX + state.day.date,
        JSON.stringify(state.entry)
      );
      const status = $('saveStatus');
      if (status) status.textContent = '이 기기에 저장됨';
    } catch (_err) {
      const status = $('saveStatus');
      if (status) status.textContent = '저장 제한됨';
    }
  }

  function scheduleSave() {
    const status = $('saveStatus');
    if (status) status.textContent = '저장 중...';
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      persistEntry();
    }, 260);
    renderSummaryCard();
  }

  async function fetchJsonWithFallback(path, fallbackValue) {
    if (window.location.protocol !== 'file:') {
      try {
        const res = await fetch(path, { cache: 'no-store' });
        if (res.ok) return await res.json();
      } catch (_err) {
        // fallback below
      }
    }
    if (fallbackValue) return fallbackValue;
    throw new Error(`데이터를 불러올 수 없습니다: ${path}`);
  }

  async function loadSchedule() {
    const fallback = window.QT_FALLBACK_DATA ? window.QT_FALLBACK_DATA.schedule : null;
    const data = await fetchJsonWithFallback('./data/schedule.json', fallback);
    state.schedule = data;

    const churchEl = $('churchName');
    if (churchEl && data.churchName) {
      churchEl.textContent = data.churchName;
    }

    const footerLink = $('footerChurchLink');
    if (footerLink && data.churchUrl) {
      footerLink.href = data.churchUrl;
      if (data.churchName) footerLink.textContent = data.churchName;
    }
  }

  async function loadDay(dateStr) {
    const fallbackDays = window.QT_FALLBACK_DATA ? window.QT_FALLBACK_DATA.days : {};
    const dayData = await fetchJsonWithFallback(
      `./data/days/${dateStr}.json`,
      fallbackDays[dateStr] || null
    );
    state.day = dayData;
    state.entry = loadEntry(dayData.date);

    renderDateSelector();
    renderYesterdayReview();
    renderDayContent();
  }

  function renderDateSelector() {
    const select = $('dateSelect');
    if (!select || !state.schedule) return;
    select.innerHTML = '';

    const dates = Array.isArray(state.schedule.availableDates)
      ? state.schedule.availableDates
      : [state.day.date];

    dates.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d;
      const parts = d.split('-');
      const short = parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : d;
      opt.textContent = short;
      if (state.day && d === state.day.date) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function renderYesterdayReview() {
    const card = $('yesterdayReviewCard');
    if (!card || !state.day) return;

    const prevDate = shiftDate(state.day.date, -1);
    const prevEntry = loadEntry(prevDate);
    const hasAction = Boolean(prevEntry.applyAction && prevEntry.applyAction.trim());

    if (!hasAction) {
      card.hidden = true;
      return;
    }

    const fallbackDays = window.QT_FALLBACK_DATA ? window.QT_FALLBACK_DATA.days : {};
    const prevDayMeta = fallbackDays[prevDate];
    $('yesterdayReviewRef').textContent = prevDayMeta
      ? `${prevDayMeta.shortLabel} · ${prevDayMeta.reference}`
      : prevDate;

    const whenPrefix = prevEntry.applyWhen ? `[${prevEntry.applyWhen}] ` : '';
    $('yesterdayReviewText').textContent = `${whenPrefix}${prevEntry.applyAction}`;

    const doneBtn = $('yesterdayDoneBtn');
    const retryBtn = $('yesterdayRetryBtn');
    const msgEl = $('yesterdayStatusMsg');

    const updateStatusUi = (status) => {
      doneBtn.classList.toggle('is-active', status === 'done');
      retryBtn.classList.toggle('is-active', status === 'retry');
      if (status === 'done') {
        msgEl.textContent = '주님과 동행한 작은 한 걸음을 기뻐합니다. 오늘도 은혜로 시작해 보세요.';
        msgEl.hidden = false;
      } else if (status === 'retry') {
        msgEl.textContent = '괜찮아요. 성화는 우리의 완벽함이 아니라 은혜로 자라가는 여정입니다.';
        msgEl.hidden = false;
      } else {
        msgEl.hidden = true;
      }
    };

    updateStatusUi(prevEntry.reviewStatus);

    doneBtn.onclick = () => {
      prevEntry.reviewStatus = 'done';
      try {
        localStorage.setItem(STORAGE_PREFIX + prevDate, JSON.stringify(prevEntry));
      } catch (_err) {}
      updateStatusUi('done');
    };

    retryBtn.onclick = () => {
      prevEntry.reviewStatus = 'retry';
      try {
        localStorage.setItem(STORAGE_PREFIX + prevDate, JSON.stringify(prevEntry));
      } catch (_err) {}
      updateStatusUi('retry');
    };

    card.hidden = false;
  }

  function getSelectedVerseSummary() {
    if (!state.day || !state.entry) return { ref: '', enRef: '', text: '', enText: '' };
    const pickedNums = [...state.entry.highlightedVerses].sort((a, b) => a - b);
    if (pickedNums.length === 0) {
      return {
        ref: state.day.application.defaultVerseRef,
        enRef: state.day.englishReference || '',
        text: state.day.application.defaultVerseText,
        enText: state.day.application.defaultVerseTextEn || ''
      };
    }

    const bookName = state.day.reference.split(':')[0].replace(/\s*\d+$/, '');
    const chapterMatch = state.day.reference.match(/(\d+):/);
    const chapter = chapterMatch ? `${chapterMatch[1]}:` : '';
    const ref = `${bookName} ${chapter}${pickedNums.join(', ')}`;

    let enRef = '';
    if (state.day.englishReference) {
      const enBook = state.day.englishReference.split(':')[0].replace(/\s*\d+$/, '');
      const enChapMatch = state.day.englishReference.match(/(\d+):/);
      const enChap = enChapMatch ? `${enChapMatch[1]}:` : '';
      enRef = `${enBook} ${enChap}${pickedNums.join(', ')}`;
    }

    const chosen = state.day.verses.filter((v) => pickedNums.includes(v.num));
    const text = chosen.map((v) => v.text).join(' ');
    const enText = chosen.map((v) => v.en || '').filter(Boolean).join(' ');

    return { ref, enRef, text, enText };
  }

  function buildPrayBackDraft() {
    if (!state.day) return '';
    const picked = getSelectedVerseSummary();
    const actionText =
      (state.entry.applyAction || '').trim() || '오늘 주신 마음대로 작게 순종';
    const template =
      state.day.application.prayBackTemplate ||
      '주님, "{verse}" 말씀대로 {action} 할 수 있도록 은혜를 주세요. 아멘.';
    return template
      .replace('{verse}', picked.text)
      .replace('{action}', actionText);
  }

  function syncPrayBackIfAuto() {
    if (!state.entry || state.entry.prayBackCustomized) return;
    const draft = buildPrayBackDraft();
    state.entry.prayBack = draft;
    const el = $('prayBackInput');
    if (el) {
      el.value = draft;
      autoResizeTextarea(el);
    }
  }

  function renderHeaderTranslationMeta() {
    if (!state.day) return;
    const mode = state.prefs.lang;
    const badge = $('translationBadge');
    const refEl = $('passageReference');
    const noteEl = $('scriptureSourceNote');

    if (mode === 'en') {
      refEl.textContent = state.day.englishReference || state.day.reference;
      badge.textContent = 'Berean Standard Bible (BSB · Public Domain)';
      if (noteEl) {
        noteEl.textContent =
          'Scripture Source: Berean Standard Bible (BSB · Public Domain CC0 1.0)';
      }
    } else if (mode === 'both') {
      refEl.textContent = state.day.englishReference
        ? `${state.day.reference} · ${state.day.englishReference}`
        : state.day.reference;
      badge.textContent = '개역한글판 (1961) · BSB (Public Domain)';
      if (noteEl) {
        noteEl.textContent =
          '본문 출처: 한글 개역한글판 (1961 · 저작권 만료) / 영어 Berean Standard Bible (BSB · CC0)';
      }
    } else {
      refEl.textContent = state.day.reference;
      badge.textContent = '개역한글판 (1961 · 저작권 만료)';
      if (noteEl) {
        noteEl.textContent =
          '본문 출처: 성경전서 개역한글판 (1961년 초판 · 저작재산권 만료 공개본)';
      }
    }
  }

  function renderVerses() {
    const container = $('versesContainer');
    if (!container || !state.day) return;
    container.innerHTML = '';

    const mode = state.prefs.lang;
    const count = state.entry.highlightedVerses.length;
    const countChip = $('pickedCountChip');
    const clearBtn = $('clearHighlightBtn');

    if (count > 0) {
      countChip.textContent = `${count}절 붙잡음`;
      countChip.hidden = false;
      clearBtn.hidden = false;
    } else {
      countChip.hidden = true;
      clearBtn.hidden = true;
    }

    state.day.verses.forEach((v) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'verse-item';
      btn.setAttribute('role', 'listitem');
      const isHighlighted = state.entry.highlightedVerses.includes(v.num);
      if (isHighlighted) btn.classList.add('is-highlighted');
      btn.setAttribute('aria-pressed', String(isHighlighted));

      const numSpan = document.createElement('span');
      numSpan.className = 'verse-num';
      numSpan.textContent = String(v.num);

      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'verse-body';

      if (mode === 'ko' || mode === 'both') {
        const koSpan = document.createElement('span');
        koSpan.className = 'verse-ko';
        koSpan.textContent = v.text;
        bodyDiv.appendChild(koSpan);
      }

      if ((mode === 'en' || mode === 'both') && v.en) {
        const enSpan = document.createElement('span');
        enSpan.className = mode === 'en' ? 'verse-en is-primary' : 'verse-en';
        enSpan.textContent = v.en;
        bodyDiv.appendChild(enSpan);
      }

      btn.append(numSpan, bodyDiv);
      btn.addEventListener('click', () => {
        const idx = state.entry.highlightedVerses.indexOf(v.num);
        if (idx >= 0) {
          state.entry.highlightedVerses.splice(idx, 1);
        } else {
          state.entry.highlightedVerses.push(v.num);
        }
        renderVerses();
        renderPickedVerse();
        syncPrayBackIfAuto();
        scheduleSave();
      });

      container.appendChild(btn);
    });
  }

  function formatPickedRefLabel(picked, mode) {
    if (mode === 'en' && picked.enRef) {
      return `${picked.enRef} (BSB)`;
    }
    if (mode === 'both' && picked.enRef) {
      return `${picked.ref} (개역한글) · ${picked.enRef} (BSB)`;
    }
    return `${picked.ref} (개역한글)`;
  }

  function renderPickedVerse() {
    const picked = getSelectedVerseSummary();
    const mode = state.prefs.lang;

    $('pickedVerseRef').textContent = formatPickedRefLabel(picked, mode);

    const koEl = $('pickedVerseText');
    const enEl = $('pickedVerseEnText');

    if (mode === 'en' && picked.enText) {
      koEl.hidden = true;
      enEl.textContent = `"${picked.enText}"`;
      enEl.hidden = false;
    } else if (mode === 'both' && picked.enText) {
      koEl.hidden = false;
      koEl.textContent = `"${picked.text}"`;
      enEl.textContent = `"${picked.enText}"`;
      enEl.hidden = false;
    } else {
      koEl.hidden = false;
      koEl.textContent = `"${picked.text}"`;
      enEl.hidden = true;
    }
  }

  function renderQuestions() {
    const stack = $('questionsContainer');
    if (!stack || !state.day) return;
    stack.innerHTML = '';

    state.day.questions.forEach((q, idx) => {
      const card = document.createElement('article');
      card.className =
        q.type === 'interpretation' ? 'question-card is-interpret' : 'question-card';

      const meta = document.createElement('div');
      meta.className = 'q-meta';

      const left = document.createElement('div');
      left.className = 'q-meta-left';

      const num = document.createElement('span');
      num.className = 'q-index';
      num.textContent = String(idx + 1).padStart(2, '0');

      const badge = document.createElement('span');
      badge.className =
        q.type === 'interpretation' ? 'q-badge q-badge-interpret' : 'q-badge';
      badge.textContent = q.badge;

      left.append(num, badge);

      const ref = document.createElement('span');
      ref.className = 'q-hint-ref';
      ref.textContent = q.verseHint || '';

      meta.append(left, ref);

      const prompt = document.createElement('p');
      prompt.className = 'question-text';
      prompt.textContent = q.prompt;

      card.append(meta, prompt);

      if (q.leaderNudge) {
        const nudgeBtn = document.createElement('button');
        nudgeBtn.type = 'button';
        nudgeBtn.className = 'nudge-toggle';
        nudgeBtn.textContent = '조금 더 생각해보기';
        nudgeBtn.setAttribute('aria-expanded', 'false');

        const nudgeBox = document.createElement('div');
        nudgeBox.className = 'nudge-box';
        nudgeBox.hidden = true;
        nudgeBox.textContent = q.leaderNudge;

        nudgeBtn.addEventListener('click', () => {
          const open = nudgeBox.hidden;
          nudgeBox.hidden = !open;
          nudgeBtn.setAttribute('aria-expanded', String(open));
          nudgeBtn.textContent = open ? '힌트 접기' : '조금 더 생각해보기';
        });

        card.append(nudgeBtn, nudgeBox);
      }

      const textarea = document.createElement('textarea');
      textarea.className = 'qt-textarea qt-textarea-lined';
      textarea.rows = 2;
      textarea.placeholder = q.placeholder || '본문에서 발견한 내용을 편하게 적어 보세요.';
      textarea.value = state.entry.answers[q.id] || '';
      textarea.addEventListener('input', (e) => {
        state.entry.answers[q.id] = e.target.value;
        autoResizeTextarea(e.target);
        scheduleSave();
      });

      card.appendChild(textarea);
      stack.appendChild(card);
    });
  }

  function renderApplicationControls() {
    const app = state.day.application;
    $('gracePromptLabel').textContent = app.gracePrompt;
    $('obstaclePromptLabel').textContent = app.obstaclePrompt;

    $('graceInput').value = state.entry.grace || '';
    $('applyWhenInput').value = state.entry.applyWhen || '';
    $('applyActionInput').value = state.entry.applyAction || '';
    $('obstacleInput').value = state.entry.obstacle || '';

    if (!state.entry.prayBack && !state.entry.prayBackCustomized) {
      state.entry.prayBack = buildPrayBackDraft();
    }
    $('prayBackInput').value = state.entry.prayBack || '';

    const areaWrap = $('areaChips');
    areaWrap.innerHTML = '';
    app.areas.forEach((area) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-btn';
      if (state.entry.area === area) btn.classList.add('is-active');
      btn.textContent = area;
      btn.addEventListener('click', () => {
        state.entry.area = state.entry.area === area ? '' : area;
        renderApplicationControls();
        scheduleSave();
      });
      areaWrap.appendChild(btn);
    });

    const sugWrap = $('suggestionChips');
    sugWrap.innerHTML = '';
    const sorted = [...app.suggestions].sort((a, b) => {
      const aMatch = state.entry.area && a.area === state.entry.area ? -1 : 0;
      const bMatch = state.entry.area && b.area === state.entry.area ? -1 : 0;
      return aMatch - bMatch;
    });

    sorted.forEach((sug) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'suggestion-chip';
      if (state.entry.area && sug.area === state.entry.area) {
        btn.classList.add('is-matched');
      }

      const strong = document.createElement('strong');
      strong.textContent = `[${sug.area}]`;
      const span = document.createElement('span');
      span.textContent = `${sug.when} · ${sug.action}`;

      btn.append(strong, span);
      btn.addEventListener('click', () => {
        state.entry.area = sug.area;
        state.entry.applyWhen = sug.when;
        state.entry.applyAction = sug.action;
        renderApplicationControls();
        syncPrayBackIfAuto();
        autoResizeAllTextareas();
        scheduleSave();
        showToast('적용 예시를 채웠습니다. 내 상황에 맞게 다듬어 보세요.');
      });
      sugWrap.appendChild(btn);
    });
  }

  function renderSummaryCard() {
    if (!state.day || !state.entry) return;
    const picked = getSelectedVerseSummary();
    const mode = state.prefs.lang;

    const refLabel = formatPickedRefLabel(picked, mode);
    $('cardDateRef').textContent = `${state.day.shortLabel} · ${refLabel}`;

    const koCardEl = $('cardVerseText');
    const enCardEl = $('cardVerseEnText');
    if (mode === 'en' && picked.enText) {
      koCardEl.hidden = true;
      enCardEl.textContent = picked.enText;
      enCardEl.hidden = false;
    } else if (mode === 'both' && picked.enText) {
      koCardEl.hidden = false;
      koCardEl.textContent = picked.text;
      enCardEl.textContent = picked.enText;
      enCardEl.hidden = false;
    } else {
      koCardEl.hidden = false;
      koCardEl.textContent = picked.text;
      enCardEl.hidden = true;
    }

    $('cardGraceText').textContent =
      (state.entry.grace || '').trim() || '묵상한 은혜를 위 칸에 적어 보세요.';

    const areaTag = state.entry.area ? `[${state.entry.area}] ` : '';
    const whenTag = state.entry.applyWhen ? `(${state.entry.applyWhen}) ` : '';
    const actionBody = (state.entry.applyAction || '').trim();
    $('cardActionText').textContent = actionBody
      ? `${areaTag}${whenTag}${actionBody}`
      : '오늘 살아볼 작은 한 걸음을 적어 보세요.';

    $('cardPrayerText').textContent =
      (state.entry.prayBack || '').trim() || buildPrayBackDraft();
  }

  function renderExternalLinks() {
    if (!state.day) return;
    const officialEl = $('officialLink');
    if (officialEl && state.day.officialDailyBibleUrl) {
      officialEl.href = state.day.officialDailyBibleUrl;
    }

    const searchRef = state.day.englishReference || state.day.reference;
    const encoded = encodeURIComponent(searchRef);
    const nivEl = $('nivLink');
    const nltEl = $('nltLink');
    if (nivEl) nivEl.href = `https://www.biblegateway.com/passage/?search=${encoded}&version=NIV`;
    if (nltEl) nltEl.href = `https://www.biblegateway.com/passage/?search=${encoded}&version=NLT`;
  }

  function renderDayContent() {
    const d = state.day;
    $('dayLabel').textContent = d.dayLabel;
    $('passageTitle').textContent = d.title;
    $('passageEnglishTitle').textContent = d.englishTitle || '';

    $('openingPrayerText').textContent = d.openingPrayer;
    $('icebreakerPrompt').textContent = d.icebreaker;
    $('icebreakerInput').value = state.entry.icebreaker || '';

    // Context collapsed by default on day switch
    const ctxBtn = $('contextToggleBtn');
    const ctxDrawer = $('contextDrawer');
    ctxBtn.setAttribute('aria-expanded', 'false');
    ctxDrawer.hidden = true;
    $('contextAuthor').textContent = d.context.author;
    $('contextSummary').textContent = d.context.summary;

    const glossaryEl = $('contextGlossary');
    glossaryEl.innerHTML = '';
    (d.context.glossary || []).forEach((g) => {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = `${g.term}: `;
      li.append(strong, document.createTextNode(g.meaning));
      glossaryEl.appendChild(li);
    });

    renderHeaderTranslationMeta();
    renderExternalLinks();
    renderVerses();
    renderQuestions();
    renderPickedVerse();
    renderApplicationControls();
    renderSummaryCard();
    autoResizeAllTextareas();
    persistEntry();
  }

  function buildShareText() {
    const picked = getSelectedVerseSummary();
    const mode = state.prefs.lang;
    const grace = (state.entry.grace || '').trim();
    const areaTag = state.entry.area ? `[${state.entry.area}] ` : '';
    const whenTag = state.entry.applyWhen ? `${state.entry.applyWhen} — ` : '';
    const action = (state.entry.applyAction || '').trim();
    const prayer = (state.entry.prayBack || '').trim();

    const pickedRefLabel = formatPickedRefLabel(picked, mode);
    const lines = [
      `[New Song 오늘의 발견 · ${state.day.shortLabel}]`,
      `${state.day.title} (${state.day.reference})`,
      '',
      `📖 붙잡은 말씀 (${pickedRefLabel})`,
      `"${picked.text}"`
    ];

    if ((mode === 'en' || mode === 'both') && picked.enText) {
      lines.push(`"${picked.enText}"`);
    }
    if (grace) {
      lines.push('', `✨ 오늘 만난 주님`, grace);
    }
    if (action) {
      lines.push('', `👣 오늘의 한 걸음`, `${areaTag}${whenTag}${action}`);
    }
    if (prayer) {
      lines.push('', `🙏 한 줄 기도`, prayer);
    }

    return lines.join('\n');
  }

  async function copyShareText() {
    const text = buildShareText();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast('소그룹·카톡 나눔 문구가 복사되었습니다.');
        return;
      }
    } catch (_err) {
      // fallback below
    }
    const tmp = document.createElement('textarea');
    tmp.value = text;
    tmp.style.position = 'fixed';
    tmp.style.opacity = '0';
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
    showToast('소그룹·카톡 나눔 문구가 복사되었습니다.');
  }

  async function shareNative() {
    const text = buildShareText();
    if (navigator.share) {
      try {
        await navigator.share({
          title: `New Song 오늘의 발견 — ${state.day.reference}`,
          text
        });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    await copyShareText();
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function escapeIcsText(str) {
    return String(str || '')
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  function downloadReminderIcs(hour) {
    if (!state.day || !state.entry) return;
    const dateCompact = state.day.date.replace(/-/g, '');
    const start = `${dateCompact}T${pad2(hour)}0000`;
    const end = `${dateCompact}T${pad2(hour)}1500`;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

    const picked = getSelectedVerseSummary();
    const actionText =
      (state.entry.applyAction || '').trim() || '오늘 붙잡은 말씀을 잠깐 떠올리며 기도하기';
    const desc = [
      `말씀: ${picked.ref} - "${picked.text}"`,
      `적용: ${actionText}`,
      state.entry.prayBack ? `기도: ${state.entry.prayBack}` : ''
    ]
      .filter(Boolean)
      .join('\n');

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//NewSong//DailyDiscoveryQT//KO',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:qt-${state.day.date}-${hour}@new-song.org`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeIcsText(`[큐티 적용] ${state.day.reference}`)}`,
      `DESCRIPTION:${escapeIcsText(desc)}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT5M',
      'ACTION:DISPLAY',
      'DESCRIPTION:오늘의 큐티 한 걸음을 기억해 보세요.',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qt-reminder-${state.day.date}-${hour}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`${hour === 13 ? '오후 1시' : '저녁 8시'} 캘린더 알림 파일을 저장했습니다.`);
  }

  function collectAllSavedEntries() {
    const items = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX)) {
          const raw = localStorage.getItem(k);
          if (raw) {
            items.push(JSON.parse(raw));
          }
        }
      }
    } catch (_err) {
      // ignore
    }
    return items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  function openHistoryModal() {
    const listEl = $('historyList');
    const items = collectAllSavedEntries();
    const fallbackDays = window.QT_FALLBACK_DATA ? window.QT_FALLBACK_DATA.days : {};
    listEl.innerHTML = '';

    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'modal-desc';
      empty.textContent = '아직 저장된 묵상 기록이 없습니다. 오늘 질문이나 적용을 적어 보세요.';
      listEl.appendChild(empty);
    } else {
      items.forEach((item) => {
        const meta = fallbackDays[item.date];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'history-item';

        const top = document.createElement('div');
        top.className = 'history-item-top';
        const dSpan = document.createElement('span');
        dSpan.textContent = item.date;
        const rSpan = document.createElement('span');
        rSpan.textContent = meta ? meta.reference : '저장된 기록';
        top.append(dSpan, rSpan);

        const title = document.createElement('div');
        title.className = 'history-item-title';
        title.textContent = meta ? meta.title : '나의 묵상';

        const action = document.createElement('div');
        action.className = 'history-item-action';
        action.textContent =
          (item.applyAction || '').trim() ||
          (item.grace || '').trim() ||
          (item.icebreaker || '').trim() ||
          '본문 하이라이트/메모 저장됨';

        btn.append(top, title, action);
        btn.addEventListener('click', async () => {
          $('historyModal').hidden = true;
          try {
            await loadDay(item.date);
          } catch (_err) {
            showToast('해당 날짜의 본문 파일을 찾을 수 없습니다.');
          }
        });
        listEl.appendChild(btn);
      });
    }

    $('historyModal').hidden = false;
  }

  function exportAllHistoryJson() {
    const items = collectAllSavedEntries();
    const blob = new Blob([JSON.stringify(items, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `newsong-qt-backup-${getKstTodayDate()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('전체 묵상 기록 JSON 파일을 저장했습니다.');
  }

  function stopBreathPause() {
    clearInterval(state.breathTimer);
    state.breathTimer = null;
    const guide = $('breathGuide');
    const btn = $('breathToggleBtn');
    if (guide) guide.hidden = true;
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = '잠시 숨 고르기';
    }
  }

  function toggleBreathPause() {
    const guide = $('breathGuide');
    const btn = $('breathToggleBtn');
    const prompt = $('breathPrompt');
    if (!guide || !btn || !prompt) return;

    if (!guide.hidden) {
      stopBreathPause();
      return;
    }

    guide.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = '멈추기';

    const phases = [
      '4초간 천천히 들이쉬며, 주님이 여기에 계심을 기억합니다',
      '4초간 고요히 내쉬며, 마음의 분주함을 내려놓습니다',
      '한 번 더 깊이 들이쉬며, 말씀 들을 마음을 엽니다',
      '평안히 내쉬며, 오늘 주시는 음성을 기다립니다'
    ];
    let step = 0;
    prompt.textContent = phases[0];

    clearInterval(state.breathTimer);
    state.breathTimer = setInterval(() => {
      step += 1;
      if (step >= phases.length) {
        stopBreathPause();
        return;
      }
      prompt.textContent = phases[step];
    }, 4000);
  }

  function setupScrollProgress() {
    const bar = $('readingProgressBar');
    const pills = Array.from(document.querySelectorAll('.step-pill'));
    const sections = ['step-1', 'step-2', 'step-3', 'step-4', 'step-5']
      .map((id) => $(id))
      .filter(Boolean);

    const onScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / docHeight) * 100)) : 0;
      if (bar) bar.style.width = `${pct.toFixed(1)}%`;

      let currentId = sections[0] ? sections[0].id : '';
      sections.forEach((sec) => {
        const rect = sec.getBoundingClientRect();
        if (rect.top <= 140) currentId = sec.id;
      });
      pills.forEach((pill) => {
        pill.classList.toggle(
          'is-current',
          pill.getAttribute('href') === `#${currentId}`
        );
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function setupKakaoAndPwaBanners() {
    const ua = navigator.userAgent.toLowerCase();
    const isKakao = ua.includes('kakaotalk');
    if (isKakao) {
      $('kakaoBanner').hidden = false;
      $('kakaoOpenExternalBtn').addEventListener('click', () => {
        const target = window.location.href;
        window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(target)}`;
      });
      $('kakaoBannerCloseBtn').addEventListener('click', () => {
        $('kakaoBanner').hidden = true;
      });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      if (!isKakao) {
        $('pwaInstallBanner').hidden = false;
      }
    });

    $('pwaInstallBtn').addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      $('pwaInstallBanner').hidden = true;
    });

    $('pwaInstallCloseBtn').addEventListener('click', () => {
      $('pwaInstallBanner').hidden = true;
    });
  }

  function registerServiceWorker() {
    const host = window.location.hostname;
    const isSecure =
      window.location.protocol === 'https:' ||
      host === 'localhost' ||
      host === '127.0.0.1';
    if ('serviceWorker' in navigator && isSecure) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
  }

  function setLanguageMode(lang) {
    if (!LANG_MODES.includes(lang)) return;
    state.prefs.lang = lang;
    updateLangButtons();
    savePrefs();
    renderHeaderTranslationMeta();
    renderVerses();
    renderPickedVerse();
    renderSummaryCard();
  }

  function bindEvents() {
    $('fontSizeBtn').addEventListener('click', () => {
      const idx = FONT_STEPS.indexOf(state.prefs.font);
      state.prefs.font = FONT_STEPS[(idx + 1) % FONT_STEPS.length];
      applyPrefs();
      savePrefs();
      autoResizeAllTextareas();
    });

    $('themeToggleBtn').addEventListener('click', () => {
      state.prefs.theme = state.prefs.theme === 'dark' ? 'light' : 'dark';
      applyPrefs();
      savePrefs();
    });

    $('dateSelect').addEventListener('change', async (e) => {
      await loadDay(e.target.value);
    });

    $('breathToggleBtn').addEventListener('click', toggleBreathPause);

    $('langKoBtn').addEventListener('click', () => setLanguageMode('ko'));
    $('langEnBtn').addEventListener('click', () => setLanguageMode('en'));
    $('langBothBtn').addEventListener('click', () => setLanguageMode('both'));

    $('clearHighlightBtn').addEventListener('click', () => {
      state.entry.highlightedVerses = [];
      renderVerses();
      renderPickedVerse();
      syncPrayBackIfAuto();
      scheduleSave();
    });

    $('contextToggleBtn').addEventListener('click', () => {
      const drawer = $('contextDrawer');
      const btn = $('contextToggleBtn');
      const open = drawer.hidden;
      drawer.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });

    $('icebreakerInput').addEventListener('input', (e) => {
      state.entry.icebreaker = e.target.value;
      autoResizeTextarea(e.target);
      scheduleSave();
    });

    $('graceInput').addEventListener('input', (e) => {
      state.entry.grace = e.target.value;
      autoResizeTextarea(e.target);
      scheduleSave();
    });

    $('applyWhenInput').addEventListener('input', (e) => {
      state.entry.applyWhen = e.target.value;
      scheduleSave();
    });

    $('applyActionInput').addEventListener('input', (e) => {
      state.entry.applyAction = e.target.value;
      autoResizeTextarea(e.target);
      syncPrayBackIfAuto();
      scheduleSave();
    });

    $('obstacleInput').addEventListener('input', (e) => {
      state.entry.obstacle = e.target.value;
      autoResizeTextarea(e.target);
      scheduleSave();
    });

    $('prayBackInput').addEventListener('input', (e) => {
      state.entry.prayBack = e.target.value;
      state.entry.prayBackCustomized = true;
      autoResizeTextarea(e.target);
      scheduleSave();
    });

    $('prayBackResetBtn').addEventListener('click', () => {
      state.entry.prayBackCustomized = false;
      const draft = buildPrayBackDraft();
      state.entry.prayBack = draft;
      const el = $('prayBackInput');
      el.value = draft;
      autoResizeTextarea(el);
      scheduleSave();
      showToast('붙잡은 말씀으로 기도문 초안을 채웠습니다.');
    });

    $('copyShareBtn').addEventListener('click', copyShareText);
    $('webShareBtn').addEventListener('click', shareNative);
    $('icsAfternoonBtn').addEventListener('click', () => downloadReminderIcs(13));
    $('icsEveningBtn').addEventListener('click', () => downloadReminderIcs(20));

    $('historyOpenBtn').addEventListener('click', openHistoryModal);
    $('historyCloseBtn').addEventListener('click', () => {
      $('historyModal').hidden = true;
    });
    $('historyModal').addEventListener('click', (e) => {
      if (e.target === $('historyModal')) $('historyModal').hidden = true;
    });
    $('exportAllBtn').addEventListener('click', exportAllHistoryJson);
  }

  async function init() {
    loadPrefs();
    bindEvents();
    setupScrollProgress();
    setupKakaoAndPwaBanners();
    registerServiceWorker();

    try {
      await loadSchedule();
      const params = new URLSearchParams(window.location.search);
      const requested = params.get('d');
      const kstToday = getKstTodayDate();
      const avail = state.schedule.availableDates || [];

      let targetDate = state.schedule.latestDate;
      if (requested && avail.includes(requested)) {
        targetDate = requested;
      } else if (avail.includes(kstToday)) {
        targetDate = kstToday;
      }

      await loadDay(targetDate);
    } catch (err) {
      showToast(err.message || '말씀 데이터를 불러오는 중 문제가 발생했습니다.');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
