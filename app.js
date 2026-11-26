(() => {
  'use strict';

  const STORAGE_PREFIX = 'qt_entry_';
  const PREFS_KEY = 'qt_user_prefs_v2';
  const NOTIFY_KEY = 'qt_notify_prefs_v1';
  const ANON_ID_KEY = 'qt_anon_id_v1';
  const FONT_STEPS = ['sm', 'md', 'lg'];
  const FONT_LABELS = { sm: '가-', md: '가', lg: '가+' };
  const LANG_MODES = ['ko', 'fbv', 'en', 'both'];
  const EN_VERSIONS = ['fbv', 'bsb'];
  const LEVELS = ['easy', 'medium', 'advanced'];
  const AUDIO_VOICES = ['male', 'female'];
  const AUDIO_SPEEDS = [1, 1.5, 2, 2.5, 3];
  const LEVEL_INFO = {
    easy: { label: '쉬운', desc: '처음 믿는 분을 위한 질문 · 본문에서 바로 찾을 수 있어요' },
    medium: { label: '중간', desc: '성도·집사님을 위한 질문 · 관찰과 해석을 균형 있게' },
    advanced: { label: '고급', desc: '깊이 묵상하는 분을 위한 질문 · 구조, 맥락, 그리스도와의 연결까지' }
  };

  const state = {
    schedule: null,
    day: null,
    entry: null,
    prefs: {
      theme: 'light',
      font: 'md',
      lang: 'ko',
      enVer: 'fbv',
      level: 'medium',
      voice: 'male',
      speed: 1
    },
    deferredInstallPrompt: null,
    saveTimer: null,
    toastTimer: null,
    breathTimer: null,
    calendarMonth: '',
    selectedCalendarDate: '',
    memoryDismissed: false,
    manualExpanded: new Set(),
    speaking: false,
    speakingNum: null,
    audioEl: null,
    usingSpeechFallback: false,
    feedbackCategory: 'suggestion',
    notifyPreviewKind: 'morning',
    notify: {
      enabled: false,
      morningEnabled: true,
      morningTime: '07:00',
      eveningEnabled: true,
      eveningTime: '20:00',
      subId: ''
    }
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

  // 한국시간 기준 현재 시각 (분 단위)과 날짜
  function getKstNowParts() {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return {
      date: kst.toISOString().slice(0, 10),
      minutes: kst.getUTCHours() * 60 + kst.getUTCMinutes()
    };
  }

  function getReleaseMinutes() {
    const raw = (state.schedule && state.schedule.releaseTime) || '05:30';
    const [hh, mm] = String(raw).split(':').map(Number);
    return (Number.isFinite(hh) ? hh : 5) * 60 + (Number.isFinite(mm) ? mm : 30);
  }

  // 새벽 공개 시각(기본 05:30 KST)이 지나면 오늘, 그 전이면 어제 본문이 '현재 본문'
  function getReleaseDate() {
    const now = getKstNowParts();
    return now.minutes >= getReleaseMinutes() ? now.date : shiftDate(now.date, -1);
  }

  function getVisibleDates() {
    const all = (state.schedule && state.schedule.availableDates) || [];
    const releaseDate = getReleaseDate();
    return all.filter((d) => d <= releaseDate).sort().reverse();
  }

  function getLatestVisibleDate() {
    const visible = getVisibleDates();
    if (visible.length > 0) return visible[0];
    const all = ((state.schedule && state.schedule.availableDates) || []).slice().sort();
    return all[0] || (state.schedule && state.schedule.latestDate);
  }

  // 페이지를 열어둔 채 05:30이 지나면 새 본문으로 자연스럽게 전환
  function startReleaseWatcher() {
    let lastLatest = getLatestVisibleDate();
    const check = async () => {
      const latest = getLatestVisibleDate();
      if (latest === lastLatest) return;
      const wasOnLatest = state.day && state.day.date === lastLatest;
      lastLatest = latest;
      if (wasOnLatest) {
        await loadDay(latest);
        showToast('새벽 05:30, 오늘의 말씀이 열렸습니다.');
      } else {
        renderDateSelector();
      }
    };
    setInterval(check, 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
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
        if (EN_VERSIONS.includes(parsed.enVer)) {
          state.prefs.enVer = parsed.enVer;
        }
        if (LEVELS.includes(parsed.level)) {
          state.prefs.level = parsed.level;
        }
        if (AUDIO_VOICES.includes(parsed.voice)) {
          state.prefs.voice = parsed.voice;
        }
        if (AUDIO_SPEEDS.includes(Number(parsed.speed))) {
          state.prefs.speed = Number(parsed.speed);
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
    updateLevelButtons();
    updateAudioControlsUi();
  }

  function updateLevelButtons() {
    const map = {
      easy: $('levelEasyBtn'),
      medium: $('levelMediumBtn'),
      advanced: $('levelAdvancedBtn')
    };
    Object.entries(map).forEach(([level, btn]) => {
      if (!btn) return;
      const active = state.prefs.level === level;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  // 날짜 파일의 questionSets(easy/medium/advanced)에서 현재 수준의 질문을 고름
  // (예전 형식인 questions 배열만 있으면 '중간'으로 간주)
  function getQuestionSet() {
    if (!state.day) return [];
    const sets = state.day.questionSets;
    if (sets && typeof sets === 'object') {
      return sets[state.prefs.level] || sets.medium || [];
    }
    return state.day.questions || [];
  }

  function setLevel(level) {
    if (!LEVELS.includes(level)) return;
    state.prefs.level = level;
    updateLevelButtons();
    savePrefs();
    renderQuestions();
    autoResizeAllTextareas();
    updateStepProgress();
  }

  function isEnglishOnlyMode(mode = state.prefs.lang) {
    return mode === 'en' || mode === 'fbv';
  }

  function getActiveEnVersion(mode = state.prefs.lang) {
    if (mode === 'fbv') return 'fbv';
    if (mode === 'en') return 'bsb';
    return state.prefs.enVer === 'bsb' ? 'bsb' : 'fbv';
  }

  function getVerseEnText(v, mode = state.prefs.lang) {
    if (!v) return '';
    if (getActiveEnVersion(mode) === 'fbv') {
      return v.fbv || v.en || '';
    }
    return v.en || '';
  }

  function getActiveEnShortLabel(mode = state.prefs.lang) {
    return getActiveEnVersion(mode) === 'fbv' ? '쉬운 영어 · FBV' : 'BSB';
  }

  function updateLangButtons() {
    const map = {
      ko: $('langKoBtn'),
      fbv: $('langEasyEnBtn'),
      en: $('langEnBtn'),
      both: $('langBothBtn')
    };
    Object.entries(map).forEach(([mode, btn]) => {
      if (!btn) return;
      const active = state.prefs.lang === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    const bothBar = $('bothEnBar');
    if (bothBar) {
      bothBar.hidden = state.prefs.lang !== 'both';
    }
    const easySubBtn = $('bothEasyEnBtn');
    const bsbSubBtn = $('bothBsbBtn');
    const isFbvInBoth = state.prefs.enVer !== 'bsb';
    if (easySubBtn) {
      easySubBtn.classList.toggle('is-active', isFbvInBoth);
      easySubBtn.setAttribute('aria-pressed', String(isFbvInBoth));
    }
    if (bsbSubBtn) {
      bsbSubBtn.classList.toggle('is-active', !isFbvInBoth);
      bsbSubBtn.setAttribute('aria-pressed', String(!isFbvInBoth));
    }
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
      completedAt: '',
      savedSummary: null,
      updatedAt: ''
    };
  }

  function hasMeaningfulMemo(item) {
    if (!item || typeof item !== 'object') return false;
    if (Array.isArray(item.highlightedVerses) && item.highlightedVerses.length > 0) return true;
    if ((item.icebreaker || '').trim()) return true;
    if ((item.grace || '').trim()) return true;
    if ((item.applyWhen || '').trim()) return true;
    if ((item.applyAction || '').trim()) return true;
    if ((item.obstacle || '').trim()) return true;
    if (item.prayBackCustomized && (item.prayBack || '').trim()) return true;
    if (item.answers && typeof item.answers === 'object') {
      if (Object.values(item.answers).some((v) => String(v || '').trim().length > 0)) {
        return true;
      }
    }
    return false;
  }

  function isActiveEntry(item) {
    return Boolean(item && (item.completedAt || hasMeaningfulMemo(item)));
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
    const picked = getSelectedVerseSummary();
    state.entry.savedSummary = {
      reference: state.day.reference,
      shortLabel: state.day.shortLabel,
      title: state.day.title,
      pickedRef: picked.ref,
      pickedVerse: picked.text
    };
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
    updateMonthlyHeaderBadge();
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

    stopListening();
    resetStepFolding();
    renderDateSelector();
    renderYesterdayReview();
    renderDayContent();
  }

  function renderDateSelector() {
    const select = $('dateSelect');
    if (!select || !state.schedule) return;
    select.innerHTML = '';

    const dates = getVisibleDates();
    if (state.day && !dates.includes(state.day.date)) dates.unshift(state.day.date);

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
    const chosen = state.day.verses.filter((v) => state.entry.highlightedVerses.includes(v.num));
    if (chosen.length === 0) {
      const app = state.day.application || {};
      const useFbv = getActiveEnVersion() === 'fbv';
      let defaultEnRef = state.day.englishReference || '';
      const defSuffix = String(app.defaultVerseRef || '').match(/(\d+:\d+.*)$/);
      const enBookMatch = String(state.day.englishReference || '').match(/^(.+?)\s+\d/);
      if (defSuffix && enBookMatch) {
        defaultEnRef = `${enBookMatch[1].trim()} ${defSuffix[1]}`;
      }
      return {
        ref: app.defaultVerseRef,
        enRef: defaultEnRef,
        text: app.defaultVerseText,
        enText: useFbv
          ? app.defaultVerseTextFbv || app.defaultVerseTextEn || ''
          : app.defaultVerseTextEn || ''
      };
    }

    const pickedNums = chosen.map((v) => v.num);
    const isMultiChap = pickedNums.some((n) => String(n).includes(':'));

    const koBookMatch = state.day.reference.match(/^(.+?)\s+\d/);
    const bookName = koBookMatch ? koBookMatch[1].trim() : state.day.reference;
    const chapterMatch = state.day.reference.match(/(\d+):/);
    const chapter = !isMultiChap && chapterMatch ? `${chapterMatch[1]}:` : '';
    const ref = `${bookName} ${chapter}${pickedNums.join(', ')}`;

    let enRef = '';
    if (state.day.englishReference) {
      const enBookMatch = state.day.englishReference.match(/^(.+?)\s+\d/);
      const enBook = enBookMatch ? enBookMatch[1].trim() : state.day.englishReference;
      const enChapMatch = state.day.englishReference.match(/(\d+):/);
      const enChap = !isMultiChap && enChapMatch ? `${enChapMatch[1]}:` : '';
      enRef = `${enBook} ${enChap}${pickedNums.join(', ')}`;
    }

    const text = chosen.map((v) => v.text).join(' ');
    const enText = chosen.map((v) => getVerseEnText(v)).filter(Boolean).join(' ');

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

    if (mode === 'fbv') {
      refEl.textContent = state.day.englishReference || state.day.reference;
      badge.textContent = '쉬운 영어 · Free Bible Version (FBV)';
      if (noteEl) {
        noteEl.textContent =
          '본문 출처: 쉬운 영어 Free Bible Version (FBV · © Dr. Jonathan Gallagher, CC BY-SA 4.0)';
      }
    } else if (mode === 'en') {
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
      if (getActiveEnVersion('both') === 'fbv') {
        badge.textContent = '개역한글판 (1961) · 쉬운 영어 (FBV)';
        if (noteEl) {
          noteEl.textContent =
            '본문 출처: 한글 개역한글판 (1961 · 저작권 만료) / 쉬운 영어 Free Bible Version (FBV · © Dr. Jonathan Gallagher, CC BY-SA 4.0)';
        }
      } else {
        badge.textContent = '개역한글판 (1961) · BSB (Public Domain)';
        if (noteEl) {
          noteEl.textContent =
            '본문 출처: 한글 개역한글판 (1961 · 저작권 만료) / 영어 Berean Standard Bible (BSB · CC0)';
        }
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
      container.appendChild(buildVerseRow(v, mode));
    });
  }

  function buildVerseRow(v, mode, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = extraClass ? `verse-item ${extraClass}` : 'verse-item';
    btn.setAttribute('role', 'listitem');
    btn.dataset.num = String(v.num);
    const isHighlighted = state.entry.highlightedVerses.includes(v.num);
    if (isHighlighted) btn.classList.add('is-highlighted');
    if (state.speaking && state.speakingNum === v.num) btn.classList.add('is-speaking');
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

    const enTxt = getVerseEnText(v, mode);
    if ((isEnglishOnlyMode(mode) || mode === 'both') && enTxt) {
      const enSpan = document.createElement('span');
      enSpan.className = isEnglishOnlyMode(mode) ? 'verse-en is-primary' : 'verse-en';
      enSpan.textContent = enTxt;
      bodyDiv.appendChild(enSpan);
    }

    btn.append(numSpan, bodyDiv);
    btn.addEventListener('click', () => toggleHighlight(v.num));
    return btn;
  }

  function toggleHighlight(num) {
    const idx = state.entry.highlightedVerses.indexOf(num);
    if (idx >= 0) {
      state.entry.highlightedVerses.splice(idx, 1);
    } else {
      state.entry.highlightedVerses.push(num);
    }
    renderVerses();
    renderPickedVerse();
    syncPrayBackIfAuto();
    scheduleSave();
    if (isSheetOpen()) renderScriptureSheet([], false);
  }

  // ② 질문의 verseHint("22–26절", "26, 28–29절", "1:23–2:3절 · 히 2:12")를 오늘 본문 구절로 변환
  function parseHintVerses(hint) {
    if (!hint || !state.day || !Array.isArray(state.day.verses)) return [];
    const nums = state.day.verses.map((v) => v.num);
    const multi = nums.some((n) => String(n).includes(':'));
    const main = String(hint).split('·')[0].replace(/절/g, '').replace(/[–—~]/g, '-');
    const picked = new Set();

    main.split(/[,，]/).forEach((part) => {
      const t = part.trim();
      if (!t || /[가-힣A-Za-z]/.test(t)) return;
      if (!multi) {
        const m = t.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!m) return;
        const a = Number(m[1]);
        const b = m[2] ? Number(m[2]) : a;
        for (let i = a; i <= b; i++) picked.add(i);
      } else {
        const m = t.match(/^(\d+):(\d+)(?:\s*-\s*(?:(\d+):)?(\d+))?$/);
        if (!m) return;
        const startKey = `${m[1]}:${m[2]}`;
        const endKey = m[4] ? `${m[3] || m[1]}:${m[4]}` : startKey;
        const si = nums.indexOf(startKey);
        if (si < 0) return;
        const eiRaw = nums.indexOf(endKey);
        const ei = eiRaw < 0 ? si : eiRaw;
        for (let i = si; i <= ei; i++) picked.add(nums[i]);
      }
    });

    return state.day.verses.filter((v) => picked.has(v.num));
  }

  function buildVersePeek(verses) {
    const mode = state.prefs.lang;
    const enOnly = isEnglishOnlyMode(mode);
    const box = document.createElement('div');
    box.className = 'verse-peek';
    verses.forEach((v) => {
      const p = document.createElement('p');
      p.className = 'peek-line';
      const sup = document.createElement('sup');
      sup.textContent = String(v.num);
      p.appendChild(sup);
      if (!enOnly) p.appendChild(document.createTextNode(v.text));
      const enTxt = getVerseEnText(v, mode);
      if ((enOnly || mode === 'both') && enTxt) {
        if (enOnly) {
          p.appendChild(document.createTextNode(enTxt));
        } else {
          const en = document.createElement('span');
          en.className = 'peek-en';
          en.textContent = enTxt;
          p.appendChild(en);
        }
      }
      box.appendChild(p);
    });
    const foot = document.createElement('div');
    foot.className = 'peek-foot';
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn-text-sage';
    more.textContent = '앞뒤 문맥까지 함께 보기 ↓';
    more.addEventListener('click', () => openScriptureSheet(verses.map((v) => v.num)));
    foot.appendChild(more);
    box.appendChild(foot);
    return box;
  }

  function isSheetOpen() {
    const sheet = $('scriptureSheet');
    return Boolean(sheet && !sheet.hidden);
  }

  function renderScriptureSheet(focusNums, scrollToFocus) {
    const list = $('sheetVerses');
    if (!list || !state.day) return;
    const keepScroll = list.scrollTop;
    const mode = state.prefs.lang;
    $('sheetRef').textContent =
      isEnglishOnlyMode(mode) && state.day.englishReference
        ? state.day.englishReference
        : state.day.reference;
    list.innerHTML = '';
    let firstFocusEl = null;
    state.day.verses.forEach((v) => {
      const isFocus = (focusNums || []).includes(v.num);
      const row = buildVerseRow(v, mode, isFocus ? 'is-focus' : '');
      if (isFocus && !firstFocusEl) firstFocusEl = row;
      list.appendChild(row);
    });
    if (scrollToFocus && firstFocusEl) {
      list.scrollTop = Math.max(0, firstFocusEl.offsetTop - list.offsetTop - 8);
    } else {
      list.scrollTop = keepScroll;
    }
  }

  function openScriptureSheet(focusNums) {
    const sheet = $('scriptureSheet');
    if (!sheet || !state.day) return;
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    renderScriptureSheet(focusNums || [], true);
    updateFabVisibility();
  }

  function closeScriptureSheet() {
    const sheet = $('scriptureSheet');
    if (!sheet) return;
    sheet.hidden = true;
    sheet.classList.remove('is-compact');
    document.body.classList.remove('sheet-open');
    updateFabVisibility();
  }

  // 질문(3단계)·적용(4단계)을 보고 있고, 2단계 본문이 화면 밖일 때만 '본문 함께 보기' 버튼 노출
  function updateFabVisibility() {
    const fab = $('scriptureFab');
    if (!fab) return;
    if (isSheetOpen()) {
      fab.hidden = true;
      return;
    }
    const s2 = $('versesContainer');
    const s3 = $('step-3');
    const s5 = $('step-5');
    if (!s2 || !s3 || !s5) return;
    const vh = window.innerHeight;
    const passageGone = s2.getBoundingClientRect().bottom < 120;
    const inQuestions = s3.getBoundingClientRect().top < vh * 0.7;
    const beforeShare = s5.getBoundingClientRect().top > vh * 0.45;
    fab.hidden = !(passageGone && inQuestions && beforeShare);
  }

  function formatPickedRefLabel(picked, mode) {
    const enLabel = getActiveEnShortLabel(mode);
    if (isEnglishOnlyMode(mode) && picked.enRef) {
      return `${picked.enRef} (${enLabel})`;
    }
    if (mode === 'both' && picked.enRef) {
      return `${picked.ref} (개역한글) · ${picked.enRef} (${enLabel})`;
    }
    return `${picked.ref} (개역한글)`;
  }

  function renderPickedVerse() {
    const picked = getSelectedVerseSummary();
    const mode = state.prefs.lang;

    $('pickedVerseRef').textContent = formatPickedRefLabel(picked, mode);

    const koEl = $('pickedVerseText');
    const enEl = $('pickedVerseEnText');

    if (isEnglishOnlyMode(mode) && picked.enText) {
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

  function buildQuestionCrossRef(q) {
    const mode = state.prefs.lang;
    const enOnly = isEnglishOnlyMode(mode);
    const useFbv = getActiveEnVersion(mode) === 'fbv';
    const enText = useFbv
      ? q.crossRefTextFbv || q.crossRefTextEn || ''
      : q.crossRefTextEn || '';
    const refLabel =
      enOnly && q.crossRefEn
        ? `${q.crossRefEn} (${getActiveEnShortLabel(mode)})`
        : mode === 'both' && q.crossRefEn
          ? `${q.crossRef} · ${q.crossRefEn}`
          : q.crossRef;

    const box = document.createElement('div');
    box.className = 'q-crossref';

    const head = document.createElement('div');
    head.className = 'q-crossref-head';
    const tag = document.createElement('span');
    tag.className = 'q-crossref-tag';
    tag.textContent = '함께 읽는 연결 말씀';
    const chip = document.createElement('span');
    chip.className = 'meta-chip';
    chip.textContent = refLabel;
    head.append(tag, chip);
    box.appendChild(head);

    if (!enOnly && q.crossRefText) {
      const koP = document.createElement('p');
      koP.className = 'q-crossref-ko';
      koP.textContent = `"${q.crossRefText}"`;
      box.appendChild(koP);
    }
    if ((enOnly || mode === 'both') && enText) {
      const enP = document.createElement('p');
      enP.className = enOnly ? 'q-crossref-en is-primary' : 'q-crossref-en';
      enP.textContent = `"${enText}"`;
      box.appendChild(enP);
    }
    return box;
  }

  function renderQuestions() {
    const stack = $('questionsContainer');
    if (!stack || !state.day) return;
    stack.innerHTML = '';

    const questions = getQuestionSet();
    const descEl = $('levelDesc');
    if (descEl) {
      const info = LEVEL_INFO[state.prefs.level] || LEVEL_INFO.medium;
      descEl.textContent = `${info.desc} · ${questions.length}문항`;
    }

    questions.forEach((q, idx) => {
      const isChrist = q.type === 'christ';
      const isDeep = ['interpretation', 'christ', 'reflection'].includes(q.type);
      const card = document.createElement('article');
      card.className = isChrist
        ? 'question-card is-interpret is-christ'
        : isDeep
          ? 'question-card is-interpret'
          : 'question-card';

      const meta = document.createElement('div');
      meta.className = 'q-meta';

      const left = document.createElement('div');
      left.className = 'q-meta-left';

      const num = document.createElement('span');
      num.className = 'q-index';
      num.textContent = String(idx + 1).padStart(2, '0');

      const badge = document.createElement('span');
      badge.className = isDeep ? 'q-badge q-badge-interpret' : 'q-badge';
      badge.textContent = q.badge;

      left.append(num, badge);

      const prompt = document.createElement('p');
      prompt.className = 'question-text';
      prompt.textContent = q.prompt;

      const hintVerses = parseHintVerses(q.verseHint);
      let peekBox = null;
      let ref;
      if (hintVerses.length > 0) {
        ref = document.createElement('button');
        ref.type = 'button';
        ref.className = 'q-hint-ref is-peekable';
        ref.textContent = `${q.verseHint} ▾`;
        ref.setAttribute('aria-expanded', 'false');
        ref.setAttribute('aria-label', `${q.verseHint} 말씀 바로 펼쳐 보기`);
        ref.addEventListener('click', () => {
          if (peekBox) {
            peekBox.remove();
            peekBox = null;
            card._refreshPeek = null;
            ref.setAttribute('aria-expanded', 'false');
            ref.textContent = `${q.verseHint} ▾`;
          } else {
            peekBox = buildVersePeek(hintVerses);
            prompt.after(peekBox);
            card._refreshPeek = () => {
              if (!peekBox) return;
              const updated = buildVersePeek(hintVerses);
              peekBox.replaceWith(updated);
              peekBox = updated;
            };
            ref.setAttribute('aria-expanded', 'true');
            ref.textContent = `${q.verseHint} ▴`;
          }
        });
      } else {
        ref = document.createElement('span');
        ref.className = 'q-hint-ref';
        ref.textContent = q.verseHint || '';
      }

      meta.append(left, ref);

      card.append(meta);

      if (q.crossRef && (q.crossRefText || q.crossRefTextEn || q.crossRefTextFbv)) {
        let crossRefBox = buildQuestionCrossRef(q);
        card.appendChild(crossRefBox);
        card._refreshCrossRef = () => {
          const updated = buildQuestionCrossRef(q);
          crossRefBox.replaceWith(updated);
          crossRefBox = updated;
        };
      }

      card.append(prompt);

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
    if (isEnglishOnlyMode(mode) && picked.enText) {
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
    updateStepProgress();
  }

  // ───── ③-1 단계별 진행 ✓ 표시 · ③-2 끝낸 단계 자동 접기 ─────
  const FOLDABLE_STEPS = ['step-1', 'step-2', 'step-3', 'step-4'];

  function getStepStatus() {
    const e = state.entry;
    if (!e || !state.day) return { answered: 0, total: 0 };
    const qs = getQuestionSet();
    const answered = qs.filter((q) => String(e.answers[q.id] || '').trim()).length;
    return {
      'step-1': Boolean((e.icebreaker || '').trim()),
      'step-2': e.highlightedVerses.length > 0,
      'step-3': qs.length > 0 && answered === qs.length,
      'step-4': Boolean((e.applyAction || '').trim()),
      'step-5': Boolean(e.completedAt),
      answered,
      total: qs.length
    };
  }

  function clip(text, n) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  }

  function stepSummaryText(id, st) {
    const e = state.entry;
    if (!e) return '';
    if (id === 'step-1') return `마음 열기 · ${clip(e.icebreaker, 34)}`;
    if (id === 'step-2') {
      const picked = getSelectedVerseSummary();
      return `붙잡은 말씀 · ${picked.ref || state.day.reference}`;
    }
    if (id === 'step-3') return `${st.total}개 질문에 모두 답했어요`;
    if (id === 'step-4') return `오늘의 한 걸음 · ${clip(e.applyAction, 30)}`;
    return '';
  }

  function updateStepProgress() {
    if (!state.entry || !state.day) return;
    const st = getStepStatus();
    document.querySelectorAll('.step-pill').forEach((pill) => {
      const id = (pill.getAttribute('href') || '').slice(1);
      pill.classList.toggle('is-done', Boolean(st[id]));
    });
    FOLDABLE_STEPS.forEach((id) => {
      const sec = $(id);
      if (!sec) return;
      const line = sec.querySelector('.step-summary-line');
      if (line) line.textContent = stepSummaryText(id, st);
      const btn = sec.querySelector('.step-fold-btn');
      if (!st[id] && sec.classList.contains('is-collapsed')) setStepCollapsed(sec, false, false);
      if (btn) btn.hidden = !st[id];
    });
  }

  function setStepCollapsed(sec, collapse, keepViewportStill) {
    if (!sec || sec.classList.contains('is-collapsed') === collapse) return;
    // 접히는 카드 바로 다음 요소를 기준점으로 삼아, 접힌 뒤에도 같은 자리에 머물게 보정
    const anchor = keepViewportStill ? sec.nextElementSibling : null;
    const anchorTopBefore = anchor ? anchor.getBoundingClientRect().top : 0;
    sec.classList.toggle('is-collapsed', collapse);
    const btn = sec.querySelector('.step-fold-btn');
    if (btn) {
      btn.textContent = collapse ? '펼치기' : '접기';
      btn.setAttribute('aria-expanded', String(!collapse));
    }
    if (anchor) {
      const shift = anchor.getBoundingClientRect().top - anchorTopBefore;
      if (Math.abs(shift) > 1) {
        window.scrollTo({ top: window.scrollY + shift, behavior: 'instant' });
      }
    }
  }

  function expandStep(id) {
    const sec = $(id);
    if (!sec) return;
    state.manualExpanded.add(id);
    setStepCollapsed(sec, false, false);
  }

  function autoCollapsePassedSteps() {
    if (!state.entry || !state.day) return;
    if (state.navLockUntil && Date.now() < state.navLockUntil) return;
    const st = getStepStatus();
    const topbar = document.querySelector('.topbar');
    const limit = topbar ? topbar.getBoundingClientRect().bottom : 0;
    FOLDABLE_STEPS.forEach((id) => {
      const sec = $(id);
      if (!sec || !st[id] || state.manualExpanded.has(id) || sec.classList.contains('is-collapsed')) return;
      if (sec.contains(document.activeElement)) return;
      if (sec.getBoundingClientRect().bottom < limit + 6) setStepCollapsed(sec, true, true);
    });
  }

  function resetStepFolding() {
    state.manualExpanded = new Set();
    FOLDABLE_STEPS.forEach((id) => {
      const sec = $(id);
      if (sec) setStepCollapsed(sec, false, false);
    });
  }

  function setupStepFolding() {
    FOLDABLE_STEPS.forEach((id) => {
      const sec = $(id);
      if (!sec) return;
      const head = sec.querySelector('.step-head');
      const headText = sec.querySelector('.step-head-text');
      if (!head || !headText) return;

      const line = document.createElement('p');
      line.className = 'step-summary-line';
      headText.appendChild(line);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'step-fold-btn';
      btn.textContent = '접기';
      btn.hidden = true;
      btn.setAttribute('aria-expanded', 'true');
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (sec.classList.contains('is-collapsed')) {
          expandStep(id);
        } else {
          state.manualExpanded.delete(id);
          setStepCollapsed(sec, true, false);
        }
      });
      head.appendChild(btn);

      head.addEventListener('click', (ev) => {
        if (!sec.classList.contains('is-collapsed')) return;
        if (ev.target.closest('button') && ev.target !== btn) return;
        expandStep(id);
      });
    });

    // 단계 바: 앞의 끝낸 단계를 먼저 접고 → 목표 단계를 펼친 뒤 → 한 번에 부드럽게 이동
    document.querySelectorAll('.step-pill').forEach((pill) => {
      pill.addEventListener('click', (ev) => {
        const id = (pill.getAttribute('href') || '').slice(1);
        const target = $(id);
        if (!target) return;
        ev.preventDefault();
        const st = getStepStatus();
        const targetIdx = FOLDABLE_STEPS.indexOf(id);
        FOLDABLE_STEPS.forEach((sid, i) => {
          const isBefore = targetIdx === -1 || i < targetIdx;
          if (isBefore && st[sid] && !state.manualExpanded.has(sid)) {
            setStepCollapsed($(sid), true, false);
          }
        });
        if (target.classList.contains('is-collapsed')) expandStep(id);
        if (id === 'step-5') {
          const shBtn = $('shareToggleBtn');
          const shDrawer = $('shareDrawer');
          if (shBtn && shDrawer && shDrawer.hidden) {
            shDrawer.hidden = false;
            shBtn.setAttribute('aria-expanded', 'true');
          }
        }
        state.navLockUntil = Date.now() + 1200;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ───── ③-3 말씀 듣기 (AI 고품질 남·여 성우 오디오 + 1x~3x 배속 + 내장 음성 폴백) ─────
  function pickVoice(prefix) {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    return voices.find((v) => (v.lang || '').toLowerCase().startsWith(prefix)) || null;
  }

  function updateAudioControlsUi() {
    const maleBtn = $('voiceMaleBtn');
    const femaleBtn = $('voiceFemaleBtn');
    const voiceGroup = $('voiceSelectGroup');
    const speedBtn = $('audioSpeedBtn');

    if (maleBtn && femaleBtn) {
      const isMale = state.prefs.voice !== 'female';
      maleBtn.classList.toggle('is-active', isMale);
      maleBtn.setAttribute('aria-pressed', String(isMale));
      femaleBtn.classList.toggle('is-active', !isMale);
      femaleBtn.setAttribute('aria-pressed', String(!isMale));
    }
    if (voiceGroup) {
      voiceGroup.hidden = isEnglishOnlyMode();
    }
    if (speedBtn) {
      speedBtn.textContent = `${state.prefs.speed}×`;
    }
  }

  function applyPlaybackRate(audio) {
    if (!audio) return;
    audio.preservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.webkitPreservesPitch = true;
    audio.playbackRate = state.prefs.speed || 1;
  }

  function markSpeaking(num) {
    if (state.speakingNum === num) return;
    state.speakingNum = num;
    document.querySelectorAll('.verse-item.is-speaking').forEach((el) => el.classList.remove('is-speaking'));
    if (num === null || num === undefined) return;
    const key = String(num);
    document.querySelectorAll('.verse-item').forEach((el) => {
      if (el.dataset.num === key) el.classList.add('is-speaking');
    });
    const s2 = $('step-2');
    const mainEl = document.querySelector(`#versesContainer .verse-item[data-num="${key}"]`);
    if (s2 && mainEl && !s2.classList.contains('is-collapsed')) {
      const r2 = s2.getBoundingClientRect();
      const inView = r2.top < window.innerHeight && r2.bottom > 120;
      const r = mainEl.getBoundingClientRect();
      if (inView && (r.top < 120 || r.bottom > window.innerHeight - 30)) {
        mainEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }

  function updateListenButton() {
    const btn = $('listenBtn');
    if (!btn) return;
    btn.classList.toggle('is-playing', state.speaking);
    btn.setAttribute('aria-pressed', String(state.speaking));
    $('listenIcon').textContent = state.speaking ? '■' : '▶';
    $('listenLabel').textContent = state.speaking ? '멈추기' : '말씀 듣기';
  }

  function stopListening() {
    if (state.audioEl) {
      state.audioEl.onended = null;
      state.audioEl.onerror = null;
      state.audioEl.ontimeupdate = null;
      state.audioEl.pause();
      state.audioEl.removeAttribute('src');
      state.audioEl = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    state.speaking = false;
    state.usingSpeechFallback = false;
    markSpeaking(null);
    updateListenButton();
  }

  function buildAudioVerseTimeline() {
    if (!state.day || !Array.isArray(state.day.verses)) return { total: 1, segments: [] };
    const introWeight = String(state.day.reference || '').length + 22;
    let cursor = introWeight;
    const segments = [];
    state.day.verses.forEach((v) => {
      const txt = String(v.text || '').replace(/\(셀라\)/g, '').trim();
      if (!txt || txt === '(없음)') return;
      const w = txt.length + 9;
      segments.push({ num: v.num, start: cursor, end: cursor + w });
      cursor += w;
    });
    return { total: Math.max(cursor, 1), segments };
  }

  function startSpeechSynthesisFallback() {
    if (!state.day || !('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') {
      stopListening();
      showToast('이 기기에서는 음성 낭독을 지원하지 않습니다.');
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const mode = state.prefs.lang;
    const enOnly = isEnglishOnlyMode(mode);
    const items = [];
    state.day.verses.forEach((v) => {
      if (!enOnly && v.text && v.text !== '(없음)') {
        items.push({ num: v.num, text: v.text.replace(/\(셀라\)/g, ''), lang: 'ko-KR' });
      }
      if (enOnly) {
        const enTxt = getVerseEnText(v, mode);
        if (enTxt && !enTxt.startsWith('(')) {
          items.push({ num: v.num, text: enTxt, lang: 'en-US' });
        }
      }
    });
    if (items.length === 0) {
      stopListening();
      return;
    }

    const koVoice = pickVoice('ko');
    const enVoice = pickVoice('en');
    state.speaking = true;
    state.usingSpeechFallback = true;
    updateListenButton();

    items.forEach((it, i) => {
      const u = new SpeechSynthesisUtterance(it.text);
      u.lang = it.lang;
      const voice = it.lang === 'ko-KR' ? koVoice : enVoice;
      if (voice) u.voice = voice;
      u.rate = Math.min(Math.max(state.prefs.speed || 1, 0.8), 3);
      u.onstart = () => {
        if (state.speaking) markSpeaking(it.num);
      };
      if (i === items.length - 1) {
        u.onend = () => {
          if (state.speaking) {
            state.speaking = false;
            state.usingSpeechFallback = false;
            markSpeaking(null);
            updateListenButton();
            showToast('오늘 본문 듣기를 마쳤습니다.');
          }
        };
      }
      synth.speak(u);
    });
  }

  function playStudioAudio(resumeRatio = 0) {
    if (!state.day) return;
    if (isEnglishOnlyMode()) {
      startSpeechSynthesisFallback();
      return;
    }

    const voice = state.prefs.voice === 'female' ? 'female' : 'male';
    const src = `./data/audio/${state.day.date}-${voice}.m4a`;
    const timeline = buildAudioVerseTimeline();

    if (state.audioEl) {
      state.audioEl.onended = null;
      state.audioEl.onerror = null;
      state.audioEl.ontimeupdate = null;
      state.audioEl.pause();
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    const audio = new Audio(src);
    audio.preload = 'auto';
    applyPlaybackRate(audio);
    state.audioEl = audio;
    state.speaking = true;
    state.usingSpeechFallback = false;
    updateListenButton();

    audio.addEventListener('loadedmetadata', () => {
      applyPlaybackRate(audio);
      if (resumeRatio > 0 && resumeRatio < 0.98 && Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = resumeRatio * audio.duration;
      }
    });

    audio.ontimeupdate = () => {
      if (!state.speaking || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const pos = (audio.currentTime / audio.duration) * timeline.total;
      const hit = timeline.segments.find((s) => pos >= s.start && pos < s.end);
      markSpeaking(hit ? hit.num : null);
    };

    audio.onended = () => {
      state.speaking = false;
      state.audioEl = null;
      markSpeaking(null);
      updateListenButton();
      showToast('오늘 본문 듣기를 마쳤습니다.');
    };

    audio.onerror = () => {
      if (state.audioEl !== audio) return;
      state.audioEl = null;
      startSpeechSynthesisFallback();
    };

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        if (state.audioEl !== audio) return;
        state.audioEl = null;
        startSpeechSynthesisFallback();
      });
    }
  }

  function startListening() {
    playStudioAudio(0);
  }

  function setAudioVoice(voice) {
    if (!AUDIO_VOICES.includes(voice) || state.prefs.voice === voice) return;
    let ratio = 0;
    const wasPlayingAudio = Boolean(
      state.speaking && state.audioEl && Number.isFinite(state.audioEl.duration) && state.audioEl.duration > 0
    );
    if (wasPlayingAudio) {
      ratio = state.audioEl.currentTime / state.audioEl.duration;
    }
    state.prefs.voice = voice;
    updateAudioControlsUi();
    savePrefs();
    if (wasPlayingAudio) {
      playStudioAudio(ratio);
    }
  }

  function cycleAudioSpeed() {
    const idx = AUDIO_SPEEDS.indexOf(state.prefs.speed);
    const nextSpeed = AUDIO_SPEEDS[(idx + 1) % AUDIO_SPEEDS.length];
    state.prefs.speed = nextSpeed;
    updateAudioControlsUi();
    savePrefs();

    if (state.speaking && state.audioEl) {
      applyPlaybackRate(state.audioEl);
    } else if (state.speaking && state.usingSpeechFallback) {
      startSpeechSynthesisFallback();
    }
    showToast(`낭독 속도: ${nextSpeed}배속`);
  }

  function setupListening() {
    const btn = $('listenBtn');
    if (!btn) return;
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
    updateAudioControlsUi();
    btn.addEventListener('click', () => (state.speaking ? stopListening() : startListening()));
    $('voiceMaleBtn').addEventListener('click', () => setAudioVoice('male'));
    $('voiceFemaleBtn').addEventListener('click', () => setAudioVoice('female'));
    $('audioSpeedBtn').addEventListener('click', cycleAudioSpeed);
  }

  const BSKOREA_BOOK_CODES = {
    Genesis: 'gen', Exodus: 'exo', Leviticus: 'lev', Numbers: 'num', Deuteronomy: 'deu',
    Joshua: 'jos', Judges: 'jdg', Ruth: 'rut', '1 Samuel': '1sa', '2 Samuel': '2sa',
    '1 Kings': '1ki', '2 Kings': '2ki', '1 Chronicles': '1ch', '2 Chronicles': '2ch',
    Ezra: 'ezr', Nehemiah: 'neh', Esther: 'est', Job: 'job', Psalm: 'psa', Proverbs: 'pro',
    Ecclesiastes: 'ecc', 'Song of Solomon': 'sng', Isaiah: 'isa', Jeremiah: 'jer',
    Lamentations: 'lam', Ezekiel: 'ezk', Daniel: 'dan', Hosea: 'hos', Joel: 'jol',
    Amos: 'amo', Obadiah: 'oba', Jonah: 'jon', Micah: 'mic', Nahum: 'nam', Habakkuk: 'hab',
    Zephaniah: 'zep', Haggai: 'hag', Zechariah: 'zec', Malachi: 'mal', Matthew: 'mat',
    Mark: 'mrk', Luke: 'luk', John: 'jhn', Acts: 'act', Romans: 'rom',
    '1 Corinthians': '1co', '2 Corinthians': '2co', Galatians: 'gal', Ephesians: 'eph',
    Philippians: 'php', Colossians: 'col', '1 Thessalonians': '1th', '2 Thessalonians': '2th',
    '1 Timothy': '1ti', '2 Timothy': '2ti', Titus: 'tit', Philemon: 'phm', Hebrews: 'heb',
    James: 'jas', '1 Peter': '1pe', '2 Peter': '2pe', '1 John': '1jn', '2 John': '2jn',
    '3 John': '3jn', Jude: 'jud', Revelation: 'rev'
  };

  function resolveBookAndChap(englishRef) {
    const m = String(englishRef || '').match(/^(.+?)\s+(\d+)/);
    if (!m) return null;
    const book = m[1].trim();
    const chap = m[2];
    const code = BSKOREA_BOOK_CODES[book] || BSKOREA_BOOK_CODES[book.replace(/s$/, '')];
    return code ? { code, chap } : null;
  }

  function buildBskoreaUrl(englishRef, version = 'NKRV') {
    const hit = resolveBookAndChap(englishRef);
    if (!hit) return `https://bible.bskorea.or.kr/bible/${version}/GEN.1`;
    return `https://bible.bskorea.or.kr/bible/${version}/${hit.code.toUpperCase()}.${hit.chap}`;
  }

  function renderExternalLinks() {
    if (!state.day) return;
    const dailyBibleEl = $('dailyBibleLink');
    if (dailyBibleEl) {
      dailyBibleEl.href = 'https://sum.su.or.kr:8888/bible/today';
    }
    const officialEl = $('officialLink');
    if (officialEl) {
      officialEl.href = buildBskoreaUrl(state.day.englishReference, 'NKRV');
    }
    const rnksvEl = $('rnksvLink');
    if (rnksvEl) {
      rnksvEl.href = buildBskoreaUrl(state.day.englishReference, 'RNKSV');
    }
    const kntEl = $('kntLink');
    if (kntEl) {
      kntEl.href = buildBskoreaUrl(state.day.englishReference, 'KNT');
    }

    const searchRef = (state.day.englishReference || state.day.reference).replace(/(\d)[ab]\b/gi, '$1');
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

    const stageRow = $('contextStageRow');
    const stageVal = (d.context && d.context.redemptiveStage) || '';
    if (stageRow) {
      if (stageVal) {
        $('contextRedemptiveStage').textContent = stageVal;
        stageRow.hidden = false;
      } else {
        stageRow.hidden = true;
      }
    }

    const genreRow = $('contextGenreRow');
    const genreVal = (d.context && d.context.genreTip) || '';
    if (genreRow) {
      if (genreVal) {
        $('contextGenreTip').textContent = genreVal;
        genreRow.hidden = false;
      } else {
        genreRow.hidden = true;
      }
    }

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

    // Step 4 보조 서랍 & Step 5 나누기 서랍은 기본 접힘 상태로 초기화
    const amBtn = $('applyMoreToggleBtn');
    const amDrawer = $('applyMoreDrawer');
    if (amBtn && amDrawer) {
      amBtn.setAttribute('aria-expanded', 'false');
      amDrawer.hidden = true;
    }
    const shBtn = $('shareToggleBtn');
    const shDrawer = $('shareDrawer');
    if (shBtn && shDrawer) {
      shBtn.setAttribute('aria-expanded', 'false');
      shDrawer.hidden = true;
    }

    renderHeaderTranslationMeta();
    renderExternalLinks();
    renderVerses();
    renderQuestions();
    renderPickedVerse();
    renderApplicationControls();
    renderSummaryCard();
    renderCompletionControls();
    updateMonthlyHeaderBadge();
    renderPastMemoryCard();
    reportUsagePing();
    if (isSheetOpen()) renderScriptureSheet([], false);
    autoResizeAllTextareas();
    if (isActiveEntry(state.entry)) {
      persistEntry();
    }
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
      `📖 붙잡은 말씀 (${pickedRefLabel})`
    ];

    if (isEnglishOnlyMode(mode) && picked.enText) {
      lines.push(`"${picked.enText}"`);
    } else {
      lines.push(`"${picked.text}"`);
      if (mode === 'both' && picked.enText) {
        lines.push(`"${picked.enText}"`);
      }
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

    lines.push('', `🔗 함께 묵상하기: ${getShareUrl(state.day.date)}`);

    return lines.join('\n');
  }

  function getShareUrl(dateStr) {
    const loc = window.location;
    let base;
    if (loc.protocol === 'https:') {
      base = `${loc.origin}${loc.pathname.replace(/index\.html$/, '')}`;
    } else {
      base =
        (state.schedule && state.schedule.siteUrl) ||
        `https://${(state.schedule && state.schedule.qtDomain) || 'qt.new-song.org'}/`;
    }
    if (!base.endsWith('/')) base += '/';
    return `${base}?d=${dateStr}`;
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
            const parsed = JSON.parse(raw);
            if (parsed && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') && isActiveEntry(parsed)) {
              items.push(parsed);
            }
          }
        }
      }
    } catch (_err) {
      // ignore
    }
    return items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  function resolveEntryMeta(item) {
    const fallbackDays = window.QT_FALLBACK_DATA ? window.QT_FALLBACK_DATA.days : {};
    const dayMeta = fallbackDays[item.date] || (state.day && state.day.date === item.date ? state.day : null);
    const snap = item.savedSummary || {};
    return {
      reference: snap.reference || (dayMeta && dayMeta.reference) || '저장된 말씀',
      shortLabel: snap.shortLabel || (dayMeta && dayMeta.shortLabel) || item.date.slice(5).replace('-', '/'),
      title: snap.title || (dayMeta && dayMeta.title) || '나의 말씀 묵상',
      pickedRef: snap.pickedRef || (dayMeta && dayMeta.application && dayMeta.application.defaultVerseRef) || '',
      pickedVerse: snap.pickedVerse || (dayMeta && dayMeta.application && dayMeta.application.defaultVerseText) || ''
    };
  }

  function getMonthCompletedCount(ym, entries) {
    const list = entries || collectAllSavedEntries();
    return list.filter((x) => (x.date || '').startsWith(ym) && Boolean(x.completedAt)).length;
  }

  function updateMonthlyHeaderBadge() {
    const badge = $('monthlyCountBadge');
    const btn = $('historyOpenBtn');
    if (!badge || !btn) return;
    const baseYm = ((state.day && state.day.date) || getKstTodayDate()).slice(0, 7);
    const entries = collectAllSavedEntries();
    const count = getMonthCompletedCount(baseYm, entries);
    if (count > 0) {
      badge.textContent = String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
    const doneToday = Boolean(state.entry && state.entry.completedAt);
    btn.classList.toggle('is-done-today', doneToday);
  }

  function renderCompletionControls() {
    const btn = $('completeQtBtn');
    const label = $('completeQtLabel');
    const sub = $('completeQtSub');
    const actionsRow = $('completedActionsRow');
    if (!btn || !label || !sub || !state.day || !state.entry) return;

    const ym = state.day.date.slice(0, 7);
    const monthNum = Number(ym.split('-')[1]);
    const count = getMonthCompletedCount(ym);
    const isDone = Boolean(state.entry.completedAt);

    btn.classList.toggle('is-completed', isDone);
    btn.setAttribute('aria-pressed', String(isDone));

    if (isDone) {
      label.textContent = '오늘의 묵상 완료됨';
      sub.textContent = `${monthNum}월 ${Math.max(1, count)}번째 말씀과 만났어요 · 눌러서 발견 달력 보기`;
      if (actionsRow) actionsRow.hidden = false;
    } else {
      label.textContent = '오늘의 묵상 완료하기';
      sub.textContent =
        count > 0
          ? `완료 도장을 찍으면 ${monthNum}월 ${count + 1}번째 발견이 기록됩니다`
          : '완료 도장을 찍고 이번 달 나의 발견 달력을 확인해 보세요';
      if (actionsRow) actionsRow.hidden = true;
    }
    updateStepProgress();
  }

  function handleCompleteQtClick() {
    if (!state.day || !state.entry) return;
    if (!state.entry.completedAt) {
      state.entry.completedAt = new Date().toISOString();
      persistEntry();
      renderCompletionControls();
      syncCompletionToPushServer(state.day.date, true);
      reportUsagePing(true);
      openHistoryModal({ celebrate: true, focusDate: state.day.date });
    } else {
      openHistoryModal({ celebrate: false, focusDate: state.day.date });
    }
  }

  function undoCompleteQt() {
    if (!state.day || !state.entry || !state.entry.completedAt) return;
    state.entry.completedAt = '';
    persistEntry();
    renderCompletionControls();
    syncCompletionToPushServer(state.day.date, false);
    reportUsagePing(false);
    showToast('오늘의 완료 표시를 해제했습니다.');
  }

  function renderPastMemoryCard() {
    const card = $('pastMemoryCard');
    if (!card || !state.day || state.memoryDismissed) {
      if (card) card.hidden = true;
      return;
    }

    const prevDate = shiftDate(state.day.date, -1);
    const yesterdayShown = !$('yesterdayReviewCard').hidden;
    const pastItems = collectAllSavedEntries().filter((item) => {
      if (!item.date || item.date >= state.day.date) return false;
      if (yesterdayShown && item.date === prevDate) return false;
      return true;
    });

    if (pastItems.length === 0) {
      card.hidden = true;
      return;
    }

    const weekAgo = shiftDate(state.day.date, -7);
    const monthAgo = shiftDate(state.day.date, -30);
    let pickedItem = pastItems.find((x) => x.date === weekAgo);
    let badgeText = '일주일 전 오늘의 발견';

    if (!pickedItem) {
      pickedItem = pastItems.find((x) => x.date === monthAgo);
      badgeText = '한 달 전 오늘의 발견';
    }
    if (!pickedItem) {
      const completedPool = pastItems.filter((x) => Boolean(x.completedAt));
      const pool = completedPool.length > 0 ? completedPool : pastItems;
      const seed = state.day.date.split('-').reduce((acc, n) => acc + Number(n), 0);
      pickedItem = pool[seed % pool.length];
      badgeText = '지난 발견 리마인드';
    }

    const meta = resolveEntryMeta(pickedItem);
    $('pastMemoryBadge').textContent = badgeText;
    $('pastMemoryRef').textContent = `${meta.shortLabel} · ${meta.reference}`;
    $('pastMemoryVerse').textContent = meta.pickedVerse
      ? `"${meta.pickedVerse}"`
      : meta.title;

    const myNote =
      (pickedItem.applyAction || '').trim()
        ? `나의 한 걸음: ${(pickedItem.applyAction || '').trim()}`
        : (pickedItem.grace || '').trim()
          ? `만난 주님: ${(pickedItem.grace || '').trim()}`
          : '';
    const noteEl = $('pastMemoryNote');
    if (myNote) {
      noteEl.textContent = myNote;
      noteEl.hidden = false;
    } else {
      noteEl.hidden = true;
    }

    $('pastMemoryOpenBtn').onclick = () => {
      openHistoryModal({ celebrate: false, focusDate: pickedItem.date });
    };

    card.hidden = false;
  }

  function shiftYearMonth(ym, deltaMonths) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
  }

  function renderSelectedCalendarCard(dateStr, entryMap) {
    const box = $('selectedDayCard');
    if (!box) return;
    const item = dateStr ? entryMap.get(dateStr) : null;
    if (!item) {
      box.hidden = true;
      return;
    }

    const meta = resolveEntryMeta(item);
    const isDone = Boolean(item.completedAt);
    const visibleDates = getVisibleDates();
    const canNavigate = visibleDates.includes(item.date);

    box.innerHTML = '';

    const top = document.createElement('div');
    top.className = 'selected-day-top';
    const dateSpan = document.createElement('span');
    dateSpan.className = 'selected-day-date';
    dateSpan.textContent = `${item.date} · ${meta.reference}`;
    const statusSpan = document.createElement('span');
    statusSpan.className = isDone ? 'selected-day-status' : 'selected-day-status is-memo';
    statusSpan.textContent = isDone ? '✓ 묵상 완료' : '작성 메모';
    top.append(dateSpan, statusSpan);

    const titleEl = document.createElement('h4');
    titleEl.className = 'selected-day-title';
    titleEl.textContent = meta.title;

    box.append(top, titleEl);

    if (meta.pickedVerse) {
      const verseP = document.createElement('p');
      verseP.className = 'selected-day-verse';
      verseP.textContent = meta.pickedVerse;
      box.appendChild(verseP);
    }

    const notesWrap = document.createElement('div');
    notesWrap.className = 'selected-day-notes';
    const addNoteRow = (labelTxt, valTxt) => {
      const clean = (valTxt || '').trim();
      if (!clean) return;
      const row = document.createElement('div');
      row.className = 'selected-note-row';
      const st = document.createElement('strong');
      st.textContent = labelTxt;
      row.append(st, document.createTextNode(clean));
      notesWrap.appendChild(row);
    };
    addNoteRow('만난 주님', item.grace);
    const actionCombined = [
      item.area ? `[${item.area}]` : '',
      item.applyWhen ? `(${item.applyWhen})` : '',
      (item.applyAction || '').trim()
    ]
      .filter(Boolean)
      .join(' ');
    if ((item.applyAction || '').trim()) {
      addNoteRow('한 걸음', actionCombined);
    }
    if (item.prayBackCustomized || isDone) {
      addNoteRow('한 줄 기도', item.prayBack);
    }
    if (notesWrap.childElementCount > 0) {
      box.appendChild(notesWrap);
    }

    const actions = document.createElement('div');
    actions.className = 'selected-day-actions';

    if (!isDone) {
      const stampBtn = document.createElement('button');
      stampBtn.type = 'button';
      stampBtn.className = 'btn-soft-primary';
      stampBtn.textContent = '✓ 이 날도 완료 도장 찍기';
      stampBtn.addEventListener('click', () => {
        item.completedAt = new Date().toISOString();
        try {
          localStorage.setItem(STORAGE_PREFIX + item.date, JSON.stringify(item));
        } catch (_err) {}
        if (state.day && state.day.date === item.date) {
          state.entry = loadEntry(item.date);
          renderCompletionControls();
        }
        updateMonthlyHeaderBadge();
        renderCalendarModal();
        showToast(`${meta.shortLabel} 묵상 완료 도장을 찍었습니다.`);
      });
      actions.appendChild(stampBtn);
    } else {
      const spacer = document.createElement('span');
      actions.appendChild(spacer);
    }

    if (canNavigate) {
      const goBtn = document.createElement('button');
      goBtn.type = 'button';
      goBtn.className = 'btn-text-sage';
      goBtn.textContent = '이 날짜 본문 전체 보기 →';
      goBtn.addEventListener('click', async () => {
        $('historyModal').hidden = true;
        try {
          await loadDay(item.date);
        } catch (_err) {
          showToast('해당 날짜의 본문 파일을 찾을 수 없습니다.');
        }
      });
      actions.appendChild(goBtn);
    }

    box.appendChild(actions);
    box.hidden = false;
  }

  function renderCalendarModal() {
    const items = collectAllSavedEntries();
    const entryMap = new Map(items.map((x) => [x.date, x]));
    const ym = state.calendarMonth || ((state.day && state.day.date) || getKstTodayDate()).slice(0, 7);
    state.calendarMonth = ym;

    const [year, month] = ym.split('-').map(Number);
    $('calendarMonthLabel').textContent = `${year}년 ${month}월`;

    const monthCompleted = items.filter((x) => x.date.startsWith(ym) && Boolean(x.completedAt)).length;
    const totalCompleted = items.filter((x) => Boolean(x.completedAt)).length;
    $('monthCompletedStat').textContent = `이번 달 ${monthCompleted}일 완료`;
    $('totalSavedStat').textContent = `누적 ${Math.max(totalCompleted, items.length)}일`;
    $('monthlyFeedTitle').textContent = `${month}월에 남긴 묵상 모아보기`;

    const celebBanner = $('calendarCelebrationBanner');
    if (celebBanner && !celebBanner.hidden) {
      $('celebrationTitle').textContent = `${month}월 ${Math.max(1, monthCompleted)}번째 말씀과 깊이 만났어요!`;
    }

    const grid = $('calendarGrid');
    grid.innerHTML = '';

    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const releaseDate = getReleaseDate();
    const todayStr = (state.day && state.day.date) || releaseDate;

    for (let i = 0; i < firstWeekday; i++) {
      const empty = document.createElement('span');
      empty.className = 'cal-cell-empty';
      grid.appendChild(empty);
    }

    const monthItems = items.filter((x) => x.date.startsWith(ym));
    if (!state.selectedCalendarDate || !state.selectedCalendarDate.startsWith(ym)) {
      state.selectedCalendarDate = monthItems[0] ? monthItems[0].date : '';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${ym}-${pad2(d)}`;
      const item = entryMap.get(dateStr);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';
      btn.textContent = String(d);

      if (dateStr === todayStr) btn.classList.add('is-today');
      if (item && item.completedAt) {
        btn.classList.add('is-completed');
      } else if (item) {
        btn.classList.add('has-memo');
      }
      if (state.selectedCalendarDate === dateStr && item) {
        btn.classList.add('is-selected');
      }

      if (dateStr > releaseDate && !item) {
        btn.disabled = true;
      } else {
        btn.addEventListener('click', async () => {
          if (item) {
            state.selectedCalendarDate = dateStr;
            renderCalendarModal();
          } else if (getVisibleDates().includes(dateStr)) {
            $('historyModal').hidden = true;
            await loadDay(dateStr);
          } else {
            showToast(`${month}월 ${d}일에는 저장된 묵상 기록이 없습니다.`);
          }
        });
      }

      grid.appendChild(btn);
    }

    renderSelectedCalendarCard(state.selectedCalendarDate, entryMap);

    const listEl = $('historyList');
    listEl.innerHTML = '';

    if (monthItems.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'modal-desc';
      empty.textContent = `${month}월에는 아직 남긴 묵상 기록이 없습니다. 오늘 말씀을 읽고 완료 도장을 찍어 보세요.`;
      listEl.appendChild(empty);
    } else {
      monthItems.forEach((item) => {
        const meta = resolveEntryMeta(item);
        const isDone = Boolean(item.completedAt);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = isDone ? 'history-item is-completed-item' : 'history-item';

        const top = document.createElement('div');
        top.className = 'history-item-top';
        const dSpan = document.createElement('span');
        dSpan.textContent = `${meta.shortLabel} · ${meta.reference}`;
        const tagSpan = document.createElement('span');
        tagSpan.className = 'history-stamp-tag';
        tagSpan.textContent = isDone ? '✓ 완료' : '메모';
        top.append(dSpan, tagSpan);

        const title = document.createElement('div');
        title.className = 'history-item-title';
        title.textContent = meta.title;

        const action = document.createElement('div');
        action.className = 'history-item-action';
        action.textContent =
          (item.applyAction || '').trim() ||
          (item.grace || '').trim() ||
          meta.pickedVerse ||
          '본문 하이라이트/메모 저장됨';

        btn.append(top, title, action);
        btn.addEventListener('click', () => {
          state.selectedCalendarDate = item.date;
          renderCalendarModal();
          const cardEl = $('selectedDayCard');
          if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        listEl.appendChild(btn);
      });
    }
  }

  function openHistoryModal(opts = {}) {
    const celebrate = Boolean(opts && opts.celebrate);
    const focusDate = (opts && typeof opts.focusDate === 'string' && opts.focusDate) || (state.day && state.day.date) || getKstTodayDate();
    state.calendarMonth = focusDate.slice(0, 7);
    state.selectedCalendarDate = focusDate;

    const celebBanner = $('calendarCelebrationBanner');
    if (celebBanner) {
      celebBanner.hidden = !celebrate;
    }

    renderCalendarModal();
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
    showToast('전체 묵상 기록 백업 파일을 저장했습니다.');
  }

  function importAllHistoryJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '[]'));
        if (!Array.isArray(parsed)) throw new Error('올바른 백업 파일 형식이 아닙니다.');
        let restored = 0;
        parsed.forEach((item) => {
          if (item && /^\d{4}-\d{2}-\d{2}$/.test(item.date || '')) {
            localStorage.setItem(STORAGE_PREFIX + item.date, JSON.stringify(item));
            restored += 1;
          }
        });
        if (state.day) {
          state.entry = loadEntry(state.day.date);
          renderDayContent();
          renderYesterdayReview();
        }
        renderCalendarModal();
        showToast(`${restored}일 치 묵상 기록을 복원했습니다.`);
      } catch (_err) {
        showToast('백업 파일을 읽을 수 없습니다. JSON 파일을 확인해 주세요.');
      }
    };
    reader.readAsText(file, 'utf-8');
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
    const heroNav = document.querySelector('.hero-card .step-nav');
    const stickyNav = $('stickyStepNav');
    const topbarInner = document.querySelector('.topbar-inner');

    const onScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / docHeight) * 100)) : 0;
      if (bar) bar.style.width = `${pct.toFixed(1)}%`;

      // ① 큰 히어로 단계 바가 상단 바 뒤로 사라지면 미니 단계 바를 고정 노출
      if (heroNav && stickyNav && topbarInner) {
        const showMini = heroNav.getBoundingClientRect().bottom < topbarInner.getBoundingClientRect().bottom;
        if (showMini !== stickyNav.classList.contains('is-visible')) {
          stickyNav.classList.toggle('is-visible', showMini);
          if (showMini) stickyNav.removeAttribute('inert');
          else stickyNav.setAttribute('inert', '');
        }
      }

      let currentId = sections[0] ? sections[0].id : '';
      sections.forEach((sec) => {
        const rect = sec.getBoundingClientRect();
        if (rect.top <= 150) currentId = sec.id;
      });
      pills.forEach((pill) => {
        pill.classList.toggle(
          'is-current',
          pill.getAttribute('href') === `#${currentId}`
        );
      });

      updateFabVisibility();
      if (!state.collapseQueued) {
        state.collapseQueued = true;
        window.requestAnimationFrame(() => {
          state.collapseQueued = false;
          autoCollapsePassedSteps();
        });
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
  }

  function isStandaloneMode() {
    return Boolean(
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone
    );
  }

  function isIosDevice() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isIosSafariBrowser() {
    if (!isIosDevice()) return false;
    const ua = (navigator.userAgent || '').toLowerCase();
    const isOther =
      ua.includes('crios') ||
      ua.includes('fxios') ||
      ua.includes('kakaotalk') ||
      ua.includes('naver') ||
      ua.includes('line/') ||
      ua.includes('instagram') ||
      ua.includes('fban') ||
      ua.includes('fbav');
    return ua.includes('safari') && !isOther;
  }

  function openInstallGuideModal() {
    const modal = $('installGuideModal');
    if (!modal) return;
    const iosSafari = $('installIosSafariSteps');
    const iosInApp = $('installIosInAppSteps');
    const androidEl = $('installAndroidSteps');

    iosSafari.hidden = true;
    iosInApp.hidden = true;
    androidEl.hidden = true;

    if (isIosDevice()) {
      if (isIosSafariBrowser()) {
        iosSafari.hidden = false;
      } else {
        iosInApp.hidden = false;
      }
    } else {
      androidEl.hidden = false;
    }
    modal.hidden = false;
  }

  async function triggerInstallExperience() {
    if (isStandaloneMode()) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (state.deferredInstallPrompt) {
      state.deferredInstallPrompt.prompt();
      const choice = await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      if (choice && choice.outcome === 'accepted') {
        $('pwaInstallBanner').hidden = true;
      }
      return;
    }
    openInstallGuideModal();
  }

  function setupKakaoAndPwaBanners() {
    const ua = navigator.userAgent.toLowerCase();
    const isKakao = ua.includes('kakaotalk');
    const standalone = isStandaloneMode();
    const dismissKey = 'qt_install_banner_dismissed_v1';
    let dismissedRecently = false;
    try {
      const ts = Number(localStorage.getItem(dismissKey) || 0);
      dismissedRecently = ts > 0 && Date.now() - ts < 7 * 24 * 60 * 60 * 1000;
    } catch (_err) {}

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

    // 미설치 모바일 브라우저(아이폰 Safari 포함)에서 1줄 설치 안내 배너 표시
    const isMobileLike = isIosDevice() || /android|mobile/i.test(ua);
    if (!standalone && !isKakao && isMobileLike && !dismissedRecently) {
      const cta = $('pwaInstallCta');
      if (cta && isIosDevice()) cta.textContent = '10초 설치 방법 →';
      $('pwaInstallBanner').hidden = false;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      if (!standalone && !isKakao && !dismissedRecently) {
        const cta = $('pwaInstallCta');
        if (cta) cta.textContent = '홈에 추가';
        $('pwaInstallBanner').hidden = false;
      }
    });

    window.addEventListener('appinstalled', () => {
      state.deferredInstallPrompt = null;
      $('pwaInstallBanner').hidden = true;
      $('installGuideModal').hidden = true;
      showToast('홈 화면에 New Song QT가 추가되었습니다!');
    });

    $('pwaInstallBtn').addEventListener('click', triggerInstallExperience);

    $('pwaInstallCloseBtn').addEventListener('click', () => {
      $('pwaInstallBanner').hidden = true;
      try {
        localStorage.setItem(dismissKey, String(Date.now()));
      } catch (_err) {}
    });

    // 상단 왼쪽 '오늘의 발견' 로고 클릭 시: 미설치면 설치 안내, 설치 상태면 맨 위로 이동
    const brandBtn = $('topbarBrandBtn');
    if (brandBtn) {
      brandBtn.addEventListener('click', triggerInstallExperience);
      brandBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerInstallExperience();
        }
      });
    }

    $('installGuideCloseBtn').addEventListener('click', () => {
      $('installGuideModal').hidden = true;
    });
    $('installGuideModal').addEventListener('click', (e) => {
      if (e.target === $('installGuideModal')) $('installGuideModal').hidden = true;
    });
  }

  // ───── 매일 말씀 알림 (Web Push) ─────
  function loadNotifyPrefs() {
    try {
      const raw = localStorage.getItem(NOTIFY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.notify = {
          enabled: Boolean(parsed.enabled),
          morningEnabled: parsed.morningEnabled !== false,
          morningTime: /^\d{2}:00$/.test(parsed.morningTime || '') ? parsed.morningTime : '07:00',
          eveningEnabled: parsed.eveningEnabled !== false,
          eveningTime: /^\d{2}:00$/.test(parsed.eveningTime || '') ? parsed.eveningTime : '20:00',
          subId: String(parsed.subId || '')
        };
      }
    } catch (_err) {
      // ignore
    }
    updateNotifyHeaderIndicator();
  }

  function saveNotifyPrefs() {
    try {
      localStorage.setItem(NOTIFY_KEY, JSON.stringify(state.notify));
    } catch (_err) {
      // ignore
    }
    updateNotifyHeaderIndicator();
  }

  function getPushConfig() {
    const api = String((state.schedule && state.schedule.pushApiUrl) || '').replace(/\/+$/, '');
    const key = String((state.schedule && state.schedule.vapidPublicKey) || '').trim();
    return { api, key, ready: Boolean(api && key) };
  }

  function isIosNonStandalone() {
    const ua = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone =
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      Boolean(window.navigator.standalone);
    return isIos && !isStandalone;
  }

  function urlBase64ToUint8Array(base64String) {
    const pad = '='.repeat((4 - (base64String.length % 4)) % 4);
    const b64 = (base64String + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function formatKoreanHour(hhmm) {
    const h = Number(String(hhmm || '07:00').split(':')[0]);
    if (h < 12) return `오전 ${h}:00`;
    if (h === 12) return '낮 12:00';
    return `오후 ${h - 12}:00`;
  }

  function getTodayReminderCopy(kind) {
    const d = state.day || {};
    const rem = d.reminders || {};
    const ref = d.reference || '오늘의 말씀';
    const titleText = d.title || '오늘의 발견';
    if (kind === 'evening') {
      return {
        title: rem.eveningTitle || `하루를 마치기 전 · ${ref}`,
        body: rem.eveningBody || `잠시 숨을 고르고, 오늘 ${ref} 말씀 안에서 주님의 음성을 들어볼까요?`
      };
    }
    return {
      title: rem.morningTitle || `${ref} · ${titleText}`,
      body: rem.morningBody || `오늘 ${ref} 말씀 안에서 주님의 음성을 들으며 하루를 열어볼까요?`
    };
  }

  function updateNotifyHeaderIndicator() {
    const btn = $('notifyOpenBtn');
    const dot = $('notifyActiveDot');
    if (btn) btn.classList.toggle('is-enabled', Boolean(state.notify.enabled));
    if (dot) dot.hidden = !state.notify.enabled;
  }

  function renderNotifyPreview(kind) {
    state.notifyPreviewKind = kind === 'evening' ? 'evening' : 'morning';
    const isMorning = state.notifyPreviewKind === 'morning';
    const mBtn = $('previewMorningBtn');
    const eBtn = $('previewEveningBtn');
    if (mBtn) mBtn.classList.toggle('is-active', isMorning);
    if (eBtn) eBtn.classList.toggle('is-active', !isMorning);

    const copy = getTodayReminderCopy(state.notifyPreviewKind);
    const timeVal = isMorning
      ? ($('notifyMorningTime') && $('notifyMorningTime').value) || state.notify.morningTime
      : ($('notifyEveningTime') && $('notifyEveningTime').value) || state.notify.eveningTime;
    $('notifyPreviewTime').textContent = formatKoreanHour(timeVal);
    $('notifyPreviewTitle').textContent = copy.title;
    $('notifyPreviewText').textContent = copy.body;
  }

  function renderNotifyModal() {
    const cfg = getPushConfig();
    $('notifyMorningToggle').checked = state.notify.morningEnabled;
    $('notifyMorningTime').value = state.notify.morningTime;
    $('notifyEveningToggle').checked = state.notify.eveningEnabled;
    $('notifyEveningTime').value = state.notify.eveningTime;

    $('notifyIosGuide').hidden = !isIosNonStandalone();
    $('notifySaveBtn').textContent = state.notify.enabled ? '알림 설정 저장' : '매일 말씀 알림 켜기';
    $('notifyDisableBtn').hidden = !state.notify.enabled;

    const noteEl = $('notifyStatusNote');
    if (state.notify.enabled) {
      const parts = [];
      if (state.notify.morningEnabled) parts.push(`아침 ${formatKoreanHour(state.notify.morningTime)}`);
      if (state.notify.eveningEnabled) parts.push(`저녁 ${formatKoreanHour(state.notify.eveningTime)} (미완료 시)`);
      noteEl.textContent = cfg.ready
        ? `알림이 켜져 있습니다 · ${parts.join(' / ')}`
        : `설정이 저장되었습니다 (${parts.join(' / ')}). 서버 연결 후 자동 발송이 시작됩니다.`;
      noteEl.hidden = false;
    } else if (!cfg.ready) {
      noteEl.textContent = '알림 서버 연결 준비 중입니다. 먼저 아래 [미리 받아보기]로 오늘 알림 화면을 체험해 보실 수 있어요.';
      noteEl.hidden = false;
    } else {
      noteEl.hidden = true;
    }

    renderNotifyPreview(state.notifyPreviewKind);
  }

  function openNotifyModal() {
    renderNotifyModal();
    $('notifyModal').hidden = false;
  }

  async function ensurePushSubscription(vapidPublicKey) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('이 브라우저에서는 푸시 알림을 지원하지 않습니다.');
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });
    }
    return sub;
  }

  async function saveNotificationSettings() {
    const morningEnabled = $('notifyMorningToggle').checked;
    const morningTime = $('notifyMorningTime').value;
    const eveningEnabled = $('notifyEveningToggle').checked;
    const eveningTime = $('notifyEveningTime').value;

    if (!morningEnabled && !eveningEnabled) {
      showToast('아침 초대 또는 저녁 리마인드 중 하나 이상을 선택해 주세요.');
      return;
    }

    if (isIosNonStandalone()) {
      showToast('아이폰에서는 먼저 "홈 화면에 추가" 후 아이콘으로 열어 알림을 켜 주세요.');
      return;
    }

    if (!('Notification' in window)) {
      showToast('이 기기에서는 브라우저 알림을 지원하지 않습니다.');
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      showToast('알림 권한이 허용되지 않았습니다. 브라우저 설정에서 알림을 허용해 주세요.');
      return;
    }

    const cfg = getPushConfig();
    state.notify.morningEnabled = morningEnabled;
    state.notify.morningTime = morningTime;
    state.notify.eveningEnabled = eveningEnabled;
    state.notify.eveningTime = eveningTime;

    if (cfg.ready) {
      try {
        const sub = await ensurePushSubscription(cfg.key);
        const completedDate =
          state.entry && state.entry.completedAt && state.day ? state.day.date : '';
        const res = await fetch(`${cfg.api}/api/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: sub.toJSON(),
            morningEnabled,
            morningTime,
            eveningEnabled,
            eveningTime,
            completedDate
          })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || '알림 등록에 실패했습니다.');
        state.notify.subId = data.id || '';
        state.notify.enabled = true;
        saveNotifyPrefs();
        renderNotifyModal();
        showToast('매일 말씀 알림이 켜졌습니다. 완료한 날엔 저녁 알림이 울리지 않아요.');
      } catch (err) {
        showToast(err.message || '알림 서버 연결 중 문제가 발생했습니다.');
      }
      return;
    }

    state.notify.enabled = true;
    saveNotifyPrefs();
    renderNotifyModal();
    showToast('알림 시간 설정을 저장했습니다.');
  }

  async function disableNotifications() {
    const cfg = getPushConfig();
    try {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          if (cfg.ready) {
            await fetch(`${cfg.api}/api/unsubscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: state.notify.subId, endpoint: sub.endpoint })
            }).catch(() => {});
          }
          await sub.unsubscribe().catch(() => {});
        }
      }
    } catch (_err) {
      // ignore
    }
    state.notify.enabled = false;
    state.notify.subId = '';
    saveNotifyPrefs();
    renderNotifyModal();
    showToast('매일 말씀 알림을 껐습니다.');
  }

  async function sendTestNotification() {
    if (isIosNonStandalone()) {
      showToast('아이폰에서는 "홈 화면에 추가" 후 아이콘으로 열면 알림을 받아보실 수 있어요.');
      return;
    }
    if (!('Notification' in window)) {
      showToast('이 기기에서는 브라우저 알림을 지원하지 않습니다.');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      showToast('알림 권한을 허용해 주시면 미리 받아보실 수 있어요.');
      return;
    }

    const kind = state.notifyPreviewKind;
    const cfg = getPushConfig();
    if (cfg.ready && 'serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const sub = await ensurePushSubscription(cfg.key);
        const res = await fetch(`${cfg.api}/api/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub.toJSON(), kind })
        });
        if (res.ok) {
          showToast('오늘의 말씀 초대 알림을 보냈습니다.');
          return;
        }
      } catch (_err) {
        // 아래 로컬 미리보기 폴백
      }
    }

    const copy = getTodayReminderCopy(kind);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(copy.title, {
          body: copy.body,
          icon: './icons/icon-192.png',
          badge: './icons/badge-96.png',
          tag: 'qt-preview-test'
        });
        showToast('오늘의 말씀 초대 알림을 미리 띄워드렸습니다.');
        return;
      }
    } catch (_err) {
      // fallback to Notification constructor
    }
    new Notification(copy.title, { body: copy.body, icon: './icons/icon-192.png' });
    showToast('오늘의 말씀 초대 알림을 미리 띄워드렸습니다.');
  }

  async function syncCompletionToPushServer(dateStr, completed) {
    const cfg = getPushConfig();
    if (!cfg.ready || !state.notify.enabled || !state.notify.subId) return;
    try {
      await fetch(`${cfg.api}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: state.notify.subId,
          date: dateStr,
          completed: Boolean(completed)
        })
      });
    } catch (_err) {
      // 오프라인 등은 무시
    }
  }

  // ───── 익명 사용 집계 & 함께 묵상 카운터 (개인정보 수집 없음) ─────
  function getOrCreateAnonId() {
    try {
      let id = localStorage.getItem(ANON_ID_KEY);
      if (id && id.length >= 8) return id;
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        id = window.crypto.randomUUID();
      } else {
        id = `qt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      }
      localStorage.setItem(ANON_ID_KEY, id);
      return id;
    } catch (_err) {
      return '';
    }
  }

  function renderCommunityCount(users, completed) {
    const el = $('communityCountBanner');
    if (!el) return;
    const u = Number(users || 0);
    const c = Number(completed || 0);
    if (c >= 1 && u > c) {
      el.textContent = `🌱 오늘 ${u}명이 말씀을 열고, ${c}명이 함께 묵상을 마쳤어요`;
      el.hidden = false;
    } else if (c >= 1) {
      el.textContent = `🌱 오늘 ${c}명이 함께 말씀 앞에 머물렀어요`;
      el.hidden = false;
    } else if (u >= 1) {
      el.textContent = `🌱 오늘 ${u}명이 함께 오늘 말씀을 열었어요`;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  async function reportUsagePing(completedOverride) {
    const cfg = getPushConfig();
    if (!cfg.api || !state.day || window.location.protocol === 'file:') return;

    const releaseDate = getReleaseDate();
    const targetDate = state.day.date;

    // 지난 날짜를 볼 때는 오늘 집계에 섞지 않고 해당 날짜 통계만 조회
    if (targetDate !== releaseDate && typeof completedOverride !== 'boolean') {
      try {
        const res = await fetch(`${cfg.api}/api/today-count?date=${encodeURIComponent(targetDate)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.ok) renderCommunityCount(data.users, data.completed);
        }
      } catch (_err) {}
      return;
    }

    const anonId = getOrCreateAnonId();
    if (!anonId) return;

    const payload = {
      anonId,
      date: targetDate,
      lang: state.prefs.lang,
      level: state.prefs.level
    };
    if (typeof completedOverride === 'boolean') {
      payload.completed = completedOverride;
    } else if (state.entry && state.entry.completedAt) {
      payload.completed = true;
    }

    try {
      const res = await fetch(`${cfg.api}/api/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok) renderCommunityCount(data.users, data.completed);
      }
    } catch (_err) {
      // 오프라인 등은 조용히 무시
    }
  }

  // ───── 익명 피드백 보내기 ─────
  function setFeedbackCategory(cat) {
    state.feedbackCategory = cat;
    const map = {
      suggestion: $('fbCatSuggestion'),
      issue: $('fbCatIssue'),
      thanks: $('fbCatThanks')
    };
    Object.entries(map).forEach(([k, btn]) => {
      if (!btn) return;
      const active = k === cat;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function openFeedbackModal() {
    setFeedbackCategory(state.feedbackCategory || 'suggestion');
    $('feedbackModal').hidden = false;
    const ta = $('feedbackMessage');
    if (ta) setTimeout(() => ta.focus(), 80);
  }

  async function submitFeedback() {
    const ta = $('feedbackMessage');
    const btn = $('feedbackSubmitBtn');
    const msg = String((ta && ta.value) || '').trim();
    if (!msg) {
      showToast('전달하실 내용을 한 줄 이상 적어 주세요.');
      if (ta) ta.focus();
      return;
    }

    const cfg = getPushConfig();
    if (!cfg.api) {
      showToast('피드백 서버가 아직 연결되지 않았습니다.');
      return;
    }

    btn.disabled = true;
    btn.textContent = '보내는 중...';
    try {
      const res = await fetch(`${cfg.api}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: state.feedbackCategory || 'suggestion',
          message: msg,
          date: (state.day && state.day.date) || '',
          lang: state.prefs.lang,
          level: state.prefs.level
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error((data && data.error) || '전송에 실패했습니다.');
      ta.value = '';
      $('feedbackModal').hidden = true;
      showToast('소중한 피드백이 익명으로 전달되었습니다. 감사합니다!');
    } catch (err) {
      showToast(err.message || '잠시 후 다시 시도해 주세요.');
    } finally {
      btn.disabled = false;
      btn.textContent = '익명으로 보내기';
    }
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

  function refreshOpenVersePeeks() {
    document.querySelectorAll('.question-card').forEach((card) => {
      if (typeof card._refreshPeek === 'function') card._refreshPeek();
      if (typeof card._refreshCrossRef === 'function') card._refreshCrossRef();
    });
  }

  function setLanguageMode(lang) {
    if (!LANG_MODES.includes(lang)) return;
    const prevEnOnly = isEnglishOnlyMode(state.prefs.lang);
    const nextEnOnly = isEnglishOnlyMode(lang);
    if (state.speaking && (prevEnOnly || nextEnOnly)) {
      stopListening();
    }
    state.prefs.lang = lang;
    if (lang === 'fbv') state.prefs.enVer = 'fbv';
    if (lang === 'en') state.prefs.enVer = 'bsb';
    updateLangButtons();
    updateAudioControlsUi();
    savePrefs();
    renderHeaderTranslationMeta();
    renderVerses();
    refreshOpenVersePeeks();
    renderPickedVerse();
    renderSummaryCard();
    if (isSheetOpen()) renderScriptureSheet([], false);
  }

  function setBothEnVersion(ver) {
    if (!EN_VERSIONS.includes(ver)) return;
    state.prefs.enVer = ver;
    updateLangButtons();
    savePrefs();
    renderHeaderTranslationMeta();
    renderVerses();
    refreshOpenVersePeeks();
    renderPickedVerse();
    renderSummaryCard();
    if (isSheetOpen()) renderScriptureSheet([], false);
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
    $('langEasyEnBtn').addEventListener('click', () => setLanguageMode('fbv'));
    $('langEnBtn').addEventListener('click', () => setLanguageMode('en'));
    $('langBothBtn').addEventListener('click', () => setLanguageMode('both'));
    $('bothEasyEnBtn').addEventListener('click', () => setBothEnVersion('fbv'));
    $('bothBsbBtn').addEventListener('click', () => setBothEnVersion('bsb'));
    $('levelEasyBtn').addEventListener('click', () => setLevel('easy'));
    $('levelMediumBtn').addEventListener('click', () => setLevel('medium'));
    $('levelAdvancedBtn').addEventListener('click', () => setLevel('advanced'));

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

    $('applyMoreToggleBtn').addEventListener('click', () => {
      const drawer = $('applyMoreDrawer');
      const btn = $('applyMoreToggleBtn');
      const open = drawer.hidden;
      drawer.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) autoResizeAllTextareas();
    });

    $('shareToggleBtn').addEventListener('click', () => {
      const drawer = $('shareDrawer');
      const btn = $('shareToggleBtn');
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

    $('completeQtBtn').addEventListener('click', handleCompleteQtClick);

    $('scriptureFab').addEventListener('click', () => openScriptureSheet([]));
    $('sheetCloseBtn').addEventListener('click', closeScriptureSheet);
    // 휴대폰 키보드가 올라오면 본문 창을 낮춰 입력 칸이 가려지지 않게
    document.addEventListener('focusin', (e) => {
      if (!isSheetOpen()) return;
      const isField = e.target && e.target.matches && e.target.matches('textarea, input[type="text"]');
      $('scriptureSheet').classList.toggle('is-compact', Boolean(isField));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isSheetOpen()) closeScriptureSheet();
    });
    $('openCalendarFromStepBtn').addEventListener('click', () =>
      openHistoryModal({ celebrate: false, focusDate: state.day && state.day.date })
    );
    $('undoCompleteQtBtn').addEventListener('click', undoCompleteQt);

    $('pastMemoryDismissBtn').addEventListener('click', () => {
      state.memoryDismissed = true;
      $('pastMemoryCard').hidden = true;
    });

    $('prevMonthBtn').addEventListener('click', () => {
      $('calendarCelebrationBanner').hidden = true;
      state.calendarMonth = shiftYearMonth(state.calendarMonth || getKstTodayDate().slice(0, 7), -1);
      state.selectedCalendarDate = '';
      renderCalendarModal();
    });
    $('nextMonthBtn').addEventListener('click', () => {
      $('calendarCelebrationBanner').hidden = true;
      state.calendarMonth = shiftYearMonth(state.calendarMonth || getKstTodayDate().slice(0, 7), 1);
      state.selectedCalendarDate = '';
      renderCalendarModal();
    });

    $('feedbackOpenBtn').addEventListener('click', openFeedbackModal);
    $('feedbackCloseBtn').addEventListener('click', () => {
      $('feedbackModal').hidden = true;
    });
    $('feedbackModal').addEventListener('click', (e) => {
      if (e.target === $('feedbackModal')) $('feedbackModal').hidden = true;
    });
    $('fbCatSuggestion').addEventListener('click', () => setFeedbackCategory('suggestion'));
    $('fbCatIssue').addEventListener('click', () => setFeedbackCategory('issue'));
    $('fbCatThanks').addEventListener('click', () => setFeedbackCategory('thanks'));
    $('feedbackSubmitBtn').addEventListener('click', submitFeedback);

    $('notifyOpenBtn').addEventListener('click', openNotifyModal);
    $('notifyCloseBtn').addEventListener('click', () => {
      $('notifyModal').hidden = true;
    });
    $('notifyModal').addEventListener('click', (e) => {
      if (e.target === $('notifyModal')) $('notifyModal').hidden = true;
    });
    $('previewMorningBtn').addEventListener('click', () => renderNotifyPreview('morning'));
    $('previewEveningBtn').addEventListener('click', () => renderNotifyPreview('evening'));
    $('notifyMorningTime').addEventListener('change', () => {
      if (state.notifyPreviewKind === 'morning') renderNotifyPreview('morning');
    });
    $('notifyEveningTime').addEventListener('change', () => {
      if (state.notifyPreviewKind === 'evening') renderNotifyPreview('evening');
    });
    $('notifySaveBtn').addEventListener('click', saveNotificationSettings);
    $('notifyTestBtn').addEventListener('click', sendTestNotification);
    $('notifyDisableBtn').addEventListener('click', disableNotifications);

    $('historyOpenBtn').addEventListener('click', () => openHistoryModal({ celebrate: false }));
    $('historyCloseBtn').addEventListener('click', () => {
      $('historyModal').hidden = true;
    });
    $('historyModal').addEventListener('click', (e) => {
      if (e.target === $('historyModal')) $('historyModal').hidden = true;
    });
    $('exportAllBtn').addEventListener('click', exportAllHistoryJson);
    $('importAllBtn').addEventListener('click', () => {
      const inp = $('importFileInput');
      inp.value = '';
      inp.click();
    });
    $('importFileInput').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importAllHistoryJson(file);
    });
  }

  async function init() {
    loadPrefs();
    loadNotifyPrefs();
    bindEvents();
    setupStepFolding();
    setupListening();
    setupScrollProgress();
    setupKakaoAndPwaBanners();
    registerServiceWorker();

    try {
      await loadSchedule();
      const params = new URLSearchParams(window.location.search);
      const requested = params.get('d');
      const visible = getVisibleDates();
      const releaseDate = getLatestVisibleDate();

      let targetDate = releaseDate;
      if (requested && visible.includes(requested)) {
        targetDate = requested;
      }

      await loadDay(targetDate);
      startReleaseWatcher();
    } catch (err) {
      showToast(err.message || '말씀 데이터를 불러오는 중 문제가 발생했습니다.');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
