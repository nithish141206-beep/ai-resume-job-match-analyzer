/* ==========================================================================
   AI Resume & Job Match Analyzer — application logic
   Talks to a real Flask backend at API_BASE_URL. No demo data, no fake
   timers-only processing: results are always derived from the actual
   resume and job description the user provided.
   ========================================================================== */

(() => {
  'use strict';

  /* ---------------------------------------------------------------------
     Backend configuration
  --------------------------------------------------------------------- */

  // Change this if your Flask backend runs somewhere other than localhost:5000.
  const API_BASE_URL = window.API_BASE_URL || 'http://localhost:5000';
  const ANALYZE_ENDPOINT = `${API_BASE_URL}/api/analyze`;
  const HEALTH_ENDPOINT = `${API_BASE_URL}/api/health`;

  const ACCEPTED_EXT = ['.pdf', '.doc', '.docx', '.txt'];

  /* ---------------------------------------------------------------------
     Application state
  --------------------------------------------------------------------- */

  const state = {
    resumeFile: null,   // File object selected by the user
    jobFile: null,       // Optional File object for an uploaded job description
    result: null,         // Parsed JSON response from /api/analyze
  };

  /* ---------------------------------------------------------------------
     Navigation between "pages" (single-page view swap, no reload)
  --------------------------------------------------------------------- */

  const views = document.querySelectorAll('.view');
  const navLinks = document.querySelectorAll('.nav-link');

  function goTo(viewName, { scroll = true } = {}) {
    views.forEach(v => v.classList.toggle('active', v.dataset.view === viewName));
    navLinks.forEach(l => l.classList.toggle('active', l.dataset.nav === viewName));
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
    closeMobileMenu();
  }

  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const target = el.dataset.nav;
      if ((target === 'results' || target === 'recommendations') && !state.result) {
        showToast('Run an analysis first to see results.', true);
        goTo('workspace');
        return;
      }
      goTo(target);
    });
  });

  /* Mobile menu */
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  function closeMobileMenu() {
    hamburger.classList.remove('open');
    mobileMenu.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
  }
  hamburger.addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('open');
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
  });

  /* ---------------------------------------------------------------------
     Toast helper
  --------------------------------------------------------------------- */

  let toastTimer = null;
  function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.toggle('toast-error', isError);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
  }

  /* ---------------------------------------------------------------------
     Engine status pill — pings the real backend health endpoint
  --------------------------------------------------------------------- */

  const engineStatusEl = document.getElementById('engineStatus');

  async function checkEngineStatus() {
    try {
      const res = await fetch(HEALTH_ENDPOINT, { method: 'GET' });
      if (!res.ok) throw new Error('Health check failed');
      engineStatusEl.classList.remove('offline');
      engineStatusEl.innerHTML = '<i class="pulse-dot" aria-hidden="true"></i>Engine Ready';
    } catch (err) {
      engineStatusEl.classList.add('offline');
      engineStatusEl.innerHTML = '<i class="pulse-dot" aria-hidden="true"></i>Engine Offline';
    }
  }

  /* ---------------------------------------------------------------------
     PAGE 1 — Landing actions
  --------------------------------------------------------------------- */

  document.getElementById('startAnalysisBtn').addEventListener('click', () => goTo('workspace'));

  /* ---------------------------------------------------------------------
     PAGE 2 — Workspace: resume upload
  --------------------------------------------------------------------- */

  const dropzone = document.getElementById('dropzone');
  const resumeInput = document.getElementById('resumeInput');
  const browseBtn = document.getElementById('browseBtn');
  const fileStatus = document.getElementById('fileStatus');
  const fileNameEl = document.getElementById('fileName');
  const fileDetailsEl = document.getElementById('fileDetails');
  const resumeError = document.getElementById('resumeError');

  browseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    resumeInput.click();
  });
  dropzone.addEventListener('click', (e) => {
    if (e.target === browseBtn) return;
    resumeInput.click();
  });
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resumeInput.click(); }
  });

  resumeInput.addEventListener('change', () => {
    const file = resumeInput.files[0];
    if (file) handleResumeFile(file);
  });

  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleResumeFile(file);
  });

  function extOf(filename) {
    const parts = filename.split('.');
    return parts.length > 1 ? '.' + parts.pop().toLowerCase() : '';
  }

  function handleResumeFile(file) {
    const ext = extOf(file.name);
    if (!ACCEPTED_EXT.includes(ext)) {
      showToast('Unsupported file type. Please upload PDF, DOCX or TXT.', true);
      return;
    }
    state.resumeFile = file;
    fileNameEl.textContent = file.name;
    fileDetailsEl.textContent = `${ext.replace('.', '').toUpperCase()} Document · ${formatFileSize(file.size)}`;
    fileStatus.hidden = false;
    resumeError.hidden = true;
    updateAnalyzeState();
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* ---------------------------------------------------------------------
     PAGE 2 — Workspace: job description (paste OR upload)
  --------------------------------------------------------------------- */

  const jobTextarea = document.getElementById('jobTextarea');
  const jobFileInput = document.getElementById('jobFileInput');
  const jobError = document.getElementById('jobError');
  const jobFileStatus = document.getElementById('jobFileStatus');
  const jobFileNameEl = document.getElementById('jobFileName');
  const jobFileDetailsEl = document.getElementById('jobFileDetails');
  const clearJobFileBtn = document.getElementById('clearJobFileBtn');

  jobTextarea.addEventListener('input', () => {
    jobError.hidden = true;
    updateAnalyzeState();
  });

  jobFileInput.addEventListener('change', () => {
    const file = jobFileInput.files[0];
    if (!file) return;
    const ext = extOf(file.name);
    if (!ACCEPTED_EXT.includes(ext)) {
      showToast('Unsupported file type. Please upload PDF, DOCX or TXT.', true);
      jobFileInput.value = '';
      return;
    }

    if (ext === '.txt') {
      // Plain text files can be read client-side for an immediate, editable preview.
      const reader = new FileReader();
      reader.onload = () => {
        jobTextarea.value = String(reader.result || '').slice(0, 8000);
        state.jobFile = null;
        jobFileStatus.hidden = true;
        clearJobFileBtn.hidden = true;
        jobError.hidden = true;
        updateAnalyzeState();
        showToast('Job description file loaded.');
      };
      reader.onerror = () => showToast('Could not read that file. Please try again.', true);
      reader.readAsText(file);
    } else {
      // PDF/DOCX: content is extracted server-side at analysis time.
      state.jobFile = file;
      jobFileNameEl.textContent = file.name;
      jobFileDetailsEl.textContent = `${ext.replace('.', '').toUpperCase()} Document · ${formatFileSize(file.size)}`;
      jobFileStatus.hidden = false;
      clearJobFileBtn.hidden = false;
      jobError.hidden = true;
      updateAnalyzeState();
      showToast('Job description file attached.');
    }
  });

  clearJobFileBtn.addEventListener('click', () => {
    state.jobFile = null;
    jobFileInput.value = '';
    jobFileStatus.hidden = true;
    clearJobFileBtn.hidden = true;
    updateAnalyzeState();
  });

  /* ---------------------------------------------------------------------
     PAGE 2 — Analyze button gating
  --------------------------------------------------------------------- */

  const analyzeBtn = document.getElementById('analyzeBtn');
  const analyzeStatus = document.getElementById('analyzeStatus');

  function hasResume() { return !!state.resumeFile; }
  function hasJobInput() { return !!state.jobFile || jobTextarea.value.trim().length >= 30; }

  function updateAnalyzeState() {
    const ready = hasResume() && hasJobInput();
    analyzeBtn.disabled = !ready;
    if (ready) {
      analyzeStatus.textContent = 'Ready to analyze. This sends your documents to the analysis backend.';
    } else if (!hasResume() && !hasJobInput()) {
      analyzeStatus.textContent = 'Add a resume and a job description to continue.';
    } else if (!hasResume()) {
      analyzeStatus.textContent = 'Add a resume to continue.';
    } else {
      analyzeStatus.textContent = 'Add a job description (30+ characters, or attach a file) to continue.';
    }
  }

  analyzeBtn.addEventListener('click', () => {
    if (!hasResume()) {
      resumeError.hidden = false;
      showToast('Please upload your resume first.', true);
      return;
    }
    if (!hasJobInput()) {
      jobError.hidden = false;
      showToast('Please provide a job description.', true);
      return;
    }
    runAnalysis();
  });

  /* ---------------------------------------------------------------------
     PAGE 3 — Real AI processing: staged UI driven by an actual API call
  --------------------------------------------------------------------- */

  const processingStatusEl = document.getElementById('processingStatus');
  const processingSubEl = document.getElementById('processingSub');
  const pipelineSteps = document.querySelectorAll('.pipeline-step');
  const progressFill = document.getElementById('progressFill');

  const PROCESSING_MESSAGES = [
    'Extracting resume text…',
    'Analyzing job description…',
    'Extracting skills…',
    'Generating semantic embeddings…',
    'Calculating similarity…',
    'Analyzing skill gaps…',
    'Generating recommendations…',
  ];

  async function runAnalysis() {
    goTo('processing');
    pipelineSteps.forEach(s => s.classList.remove('active', 'done'));
    progressFill.style.width = '0%';
    processingSubEl.textContent = 'Your resume and job description are being sent to the analysis backend';

    const stepCount = pipelineSteps.length;
    let i = 0;
    let requestSettled = false;

    // Advance the visual pipeline roughly in step with real work, but never
    // claim completion until the API call actually resolves — the last
    // step holds until the response arrives rather than racing ahead.
    const stepTimer = setInterval(() => {
      if (i > 0) pipelineSteps[i - 1].classList.replace('active', 'done');
      if (i >= stepCount - 1) {
        // Hold on the final step until the request finishes.
        if (!pipelineSteps[stepCount - 1].classList.contains('active')) {
          pipelineSteps[stepCount - 1].classList.add('active');
          processingStatusEl.textContent = PROCESSING_MESSAGES[stepCount - 1];
          progressFill.style.width = '92%';
        }
        if (requestSettled) clearInterval(stepTimer);
        return;
      }
      pipelineSteps[i].classList.add('active');
      processingStatusEl.textContent = PROCESSING_MESSAGES[i];
      progressFill.style.width = `${Math.round(((i + 1) / stepCount) * 90)}%`;
      i += 1;
    }, 550);

    const formData = new FormData();
    formData.append('resume', state.resumeFile);
    if (state.jobFile) {
      formData.append('job_file', state.jobFile);
    } else {
      formData.append('job_text', jobTextarea.value.trim());
    }

    try {
      const res = await fetch(ANALYZE_ENDPOINT, { method: 'POST', body: formData });
      const data = await res.json().catch(() => null);

      requestSettled = true;

      if (!res.ok) {
        clearInterval(stepTimer);
        const message = (data && data.error) ? data.error : 'Something went wrong. Please try again.';
        showToast(message, true);
        goTo('workspace');
        return;
      }

      state.result = data;

      clearInterval(stepTimer);
      pipelineSteps.forEach(s => { s.classList.remove('active'); s.classList.add('done'); });
      processingStatusEl.textContent = 'Analysis Complete';
      progressFill.style.width = '100%';

      setTimeout(() => {
        goTo('results');
        renderResults();
      }, 500);
    } catch (err) {
      requestSettled = true;
      clearInterval(stepTimer);
      showToast('Could not reach the analysis backend. Is it running?', true);
      goTo('workspace');
    }
  }

  /* ---------------------------------------------------------------------
     PAGE 4 & 5 — Results rendering (fully driven by the API response)
  --------------------------------------------------------------------- */

  function renderResults() {
    const r = state.result;
    if (!r) return;

    document.getElementById('metaCandidate').textContent = r.resume_label || 'Candidate';
    document.getElementById('metaRole').textContent = r.job_role || 'Target Role';

    // Animated score ring
    const ringFill = document.getElementById('ringFill');
    const scoreNum = document.getElementById('scoreNum');
    const scoreFit = document.getElementById('scoreFit');
    const circumference = 2 * Math.PI * 86;
    ringFill.style.strokeDasharray = `${circumference}`;
    ringFill.style.strokeDashoffset = `${circumference}`;
    ringFill.style.stroke = r.match_score >= 75 ? 'var(--green)' : r.match_score >= 50 ? 'var(--amber)' : '#ff8080';

    requestAnimationFrame(() => {
      const offset = circumference - (circumference * r.match_score) / 100;
      ringFill.style.strokeDashoffset = `${offset}`;
    });
    animateCount(scoreNum, r.match_score, 1500);
    scoreFit.textContent = r.fit_level;

    // Skill chips
    const matchingEl = document.getElementById('matchingSkills');
    matchingEl.innerHTML = r.matching_skills.length
      ? r.matching_skills.map(s => skillChip(s, 'match')).join('')
      : '<p class="card-sub">No overlapping skills detected.</p>';
    document.getElementById('matchingCount').textContent = `${r.matching_skill_count} Matching Skills`;

    const missingEl = document.getElementById('missingSkills');
    missingEl.innerHTML = r.missing_skills.length
      ? r.missing_skills.map(s => skillChip(s, 'missing')).join('')
      : '<p class="card-sub">No gaps detected for this role.</p>';
    document.getElementById('missingCount').textContent = `${r.missing_skill_count} Role Gaps`;

    // AI insight
    document.getElementById('insightText').textContent = r.insight;

    // Summary metrics
    document.getElementById('sumResumeSkills').textContent = r.resume_skill_count;
    document.getElementById('sumGaps').textContent = r.missing_skill_count;
    document.getElementById('sumScore').textContent = `${r.match_score}%`;
    document.getElementById('sumReco').textContent = `${r.semantic_similarity}%`;

    // Skill analysis bars — candidate side shows all detected resume skills;
    // job side shows each requirement with its real similarity percentage.
    const candidateBars = document.getElementById('candidateSkillBars');
    candidateBars.innerHTML = r.resume_skills.length
      ? r.resume_skills.map(s => compareRow(s, true, 100)).join('')
      : '<p class="card-sub">No recognizable skills detected on this resume.</p>';

    const jobBars = document.getElementById('jobSkillBars');
    const perSkillSim = r.per_skill_similarity || {};
    jobBars.innerHTML = r.job_skills.length
      ? r.job_skills.map(s => {
          const matched = r.matching_skills.includes(s);
          const pct = Math.round((perSkillSim[s] !== undefined ? perSkillSim[s] : (matched ? 1 : 0)) * 100);
          return compareRow(s, matched, pct);
        }).join('')
      : '<p class="card-sub">No specific requirements detected in this job description.</p>';

    // Matched / missing lists
    document.getElementById('mmMatched').innerHTML = r.matching_skills.map(s => `<li>${checkIcon()} ${escapeHtml(s)}</li>`).join('') || '<li>None</li>';
    document.getElementById('mmMissing').innerHTML = r.missing_skills.map(s => `<li>${warnIcon()} ${escapeHtml(s)}</li>`).join('') || '<li>None</li>';

    renderRecommendations(r.recommendations);
  }

  function skillChip(skill, kind) {
    const icon = kind === 'match' ? '✓' : '⚠';
    return `<span class="skill-chip ${kind}">${icon} ${escapeHtml(skill)}</span>`;
  }

  function compareRow(skill, ok, pct) {
    const clamped = Math.max(4, Math.min(100, pct));
    return `
      <div class="compare-row">
        <div class="compare-row-top">
          <span>${escapeHtml(skill)}</span>
          <span class="cr-state ${ok ? 'ok' : 'gap'}">${ok ? 'Matched' : 'Gap'}</span>
        </div>
        <div class="compare-bar-track">
          <div class="compare-bar-fill ${ok ? 'ok' : 'gap'}" style="width:${clamped}%"></div>
        </div>
      </div>`;
  }

  function checkIcon() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="color:var(--green);flex-shrink:0"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function warnIcon() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="color:var(--amber);flex-shrink:0"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  }

  function animateCount(el, target, duration) {
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = `${Math.round(eased * target)}%`;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ---------------------------------------------------------------------
     PAGE 6 — Recommendations (rendered directly from API data)
  --------------------------------------------------------------------- */

  function renderRecommendations(recommendations) {
    const grid = document.getElementById('recoGrid');
    const source = (recommendations && recommendations.length)
      ? recommendations
      : [{ title: 'No Recommendations', body: 'Run an analysis to generate personalized recommendations.', skill: 'General' }];

    grid.innerHTML = source.map((rec, idx) => `
      <div class="card glass reco-card">
        <span class="reco-index">${String(idx + 1).padStart(2, '0')}</span>
        <h3>${escapeHtml(rec.title)}</h3>
        <p>${escapeHtml(rec.body)}</p>
        <span class="reco-skill-tag">${escapeHtml(rec.skill)}</span>
      </div>
    `).join('');
  }

  /* ---------------------------------------------------------------------
     Reset
  --------------------------------------------------------------------- */

  function resetAnalysis() {
    state.resumeFile = null;
    state.jobFile = null;
    state.result = null;
    resumeInput.value = '';
    jobFileInput.value = '';
    jobTextarea.value = '';
    fileStatus.hidden = true;
    jobFileStatus.hidden = true;
    clearJobFileBtn.hidden = true;
    resumeError.hidden = true;
    jobError.hidden = true;
    updateAnalyzeState();
    goTo('workspace');
  }

  document.getElementById('resetBtn').addEventListener('click', () => {
    resetAnalysis();
    showToast('Analysis reset. Start a new comparison.');
  });
  document.getElementById('startOverBtn').addEventListener('click', () => {
    resetAnalysis();
    showToast('Analysis reset. Start a new comparison.');
  });

  /* ---------------------------------------------------------------------
     Init
  --------------------------------------------------------------------- */

  updateAnalyzeState();
  checkEngineStatus();
})();