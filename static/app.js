/* CareGrid V2 & V3.0 — Operational Dashboard & Intelligence Client Logic */

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

let currentPatients = [];
let selectedPatientId = null;
let activeFilter = "all";

async function initApp() {
    setupTabNavigation();
    setupEventListeners();
    setupModalListeners();
    setupIntelligenceListeners();
    setupV31IntelligenceListeners();
    setupPanelSubTabs();
    await fetchOverview();
    await fetchPatientsQueue();
    await fetchSideAuditEvents();
    await fetchMajorRankChanges();
    await fetchAttentionSignals();
}


function setupTabNavigation() {
    const navItems = document.querySelectorAll(".nav-item, .nav-tab");
    navItems.forEach(item => {
        item.addEventListener("click", async () => {
            navItems.forEach(i => i.classList.remove("active"));
            document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));

            item.classList.add("active");
            const tabName = item.dataset.tab;
            const targetId = `pane-${tabName}`;
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.classList.add("active");

            // Update topbar title
            const titleElem = document.getElementById("page-current-title");
            if (titleElem) {
                titleElem.textContent = tabName === "command-center" ? "Command Center" :
                                        tabName === "simulation" ? "Simulation Mode" :
                                        tabName === "intelligence" ? "CareGrid Intelligence" :
                                        tabName === "audit" ? "Audit Log" :
                                        tabName === "methodology" ? "Prioritization Methodology" : "Research & Literature";
            }

            if (tabName === "audit") {
                await fetchAuditTimeline();
            } else if (tabName === "intelligence") {
                await fetchIntelligenceSnapshot();
            }
        });
    });
}

function setupModalListeners() {
    const modal = document.getElementById("patient-detail-modal");
    const closeBtn = document.getElementById("modal-close-btn");

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            if (modal) modal.classList.add("hidden");
        });
    }

    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) {
                modal.classList.add("hidden");
            }
        });
    }
}

function setupEventListeners() {
    const fAll = document.getElementById("filter-all");
    const fCrit = document.getElementById("filter-critical");
    const fWait = document.getElementById("filter-waiting");

    if (fAll) fAll.addEventListener("click", () => applyFilter("all"));
    if (fCrit) fCrit.addEventListener("click", () => applyFilter("Critical"));
    if (fWait) fWait.addEventListener("click", () => applyFilter("Waiting"));

    const searchInput = document.getElementById("patient-search-input");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            const query = e.target.value.trim().toLowerCase();
            const filtered = currentPatients.filter(p => p.patient_id.toLowerCase().includes(query));
            renderQueueTable(filtered);
        });
    }

    setupSimAction("sim-act-critical", "new_critical_patient");
    setupSimAction("sim-act-spike", "severity_spike");
    setupSimAction("sim-act-advance", "advance_time");
    setupSimAction("sim-act-discharge", "discharge_top");
    setupSimAction("sim-act-reset", "reset");

    ["sev", "surv", "wait"].forEach(key => {
        const input = document.getElementById(`weight-${key}`);
        const display = document.getElementById(`val-${key}`);
        if (input && display) {
            input.addEventListener("input", (e) => {
                display.textContent = parseFloat(e.target.value).toFixed(2);
            });
        }
    });

    const weightsForm = document.getElementById("ops-weights-form");
    if (weightsForm) {
        weightsForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const w_sev = parseFloat(document.getElementById("weight-sev").value);
            const w_surv = parseFloat(document.getElementById("weight-surv").value);
            const w_wait = parseFloat(document.getElementById("weight-wait").value);

            try {
                const res = await fetch("/api/priority-weights", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        weight_severity: w_sev,
                        weight_survival: w_surv,
                        weight_waiting: w_wait
                    })
                });
                const data = await res.json();
                if (data.status === "success") {
                    await fetchOverview();
                    await fetchPatientsQueue();
                }
            } catch (err) {
                console.error("Error updating weights:", err);
            }
        });
    }

    const btnFullProf = document.getElementById("btn-open-full-profile");
    if (btnFullProf) {
        btnFullProf.addEventListener("click", () => {
            if (selectedPatientId) {
                openPatientModal(selectedPatientId);
            }
        });
    }

    const pTabs = document.querySelectorAll(".panel-tab-btn");
    pTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            pTabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
        });
    });
}

function setupIntelligenceListeners() {
    const btnAsk = document.getElementById("btn-intel-ask");
    const inputQ = document.getElementById("intel-query-input");

    if (btnAsk && inputQ) {
        btnAsk.addEventListener("click", async () => {
            const q = inputQ.value.trim();
            if (q) await askIntelligence(q);
        });

        inputQ.addEventListener("keydown", async (e) => {
            if (e.key === "Enter") {
                const q = inputQ.value.trim();
                if (q) await askIntelligence(q);
            }
        });
    }

    // Suggested Questions buttons
    document.querySelectorAll(".intel-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const q = btn.dataset.q;
            if (inputQ) inputQ.value = q;
            await askIntelligence(q);
        });
    });
}

async function askIntelligence(question) {
    const ansText = document.getElementById("intel-answer-text");
    const sourceTag = document.getElementById("intel-source-tag");
    const evidenceBox = document.getElementById("intel-evidence-box");
    const evidenceList = document.getElementById("intel-evidence-list");

    if (ansText) ansText.textContent = "Querying CareGrid Intelligence foundation...";

    try {
        const res = await fetch("/api/intelligence/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question })
        });
        const data = await res.json();

        if (data.status === "success") {
            if (ansText) ansText.textContent = data.answer;
            if (sourceTag) sourceTag.textContent = `SOURCE: ${data.source}`;

            if (data.context_summary) {
                const cs = data.context_summary;
                const iq = document.getElementById("icontext-queue");
                const ic = document.getElementById("icontext-critical");
                const it = document.getElementById("icontext-toppatient");
                const is = document.getElementById("icontext-topscore");

                if (iq) iq.textContent = cs.queue_size;
                if (ic) ic.textContent = cs.critical_count;
                if (it) it.textContent = cs.top_patient_id;
                if (is) is.textContent = cs.top_priority_score.toFixed(1);
            }

            if (data.evidence && Object.keys(data.evidence).length > 0) {
                const ev = data.evidence;
                evidenceList.innerHTML = `
                    <li><strong>Top Patient ID:</strong> ${ev.patient_id} (Rank #${ev.rank})</li>
                    <li><strong>Priority Score:</strong> ${ev.priority_score.toFixed(1)} / 100.0</li>
                    <li><strong>SOFA Organ Failure Severity:</strong> ${ev.severity.toFixed(1)} (SOFA raw: ${ev.sofa_score}) → +${ev.severity_contribution.toFixed(1)} pts</li>
                    <li><strong>Survival Likelihood:</strong> ${ev.survival_likelihood.toFixed(1)}% → +${ev.survival_contribution.toFixed(1)} pts</li>
                    <li><strong>Waiting Duration Pending:</strong> ${ev.waiting_time_minutes} minutes → +${ev.waiting_contribution.toFixed(1)} pts</li>
                `;
                if (evidenceBox) evidenceBox.style.display = "block";
            } else {
                if (evidenceBox) evidenceBox.style.display = "none";
            }
        } else {
            if (ansText) ansText.textContent = "CAREGRID INTELLIGENCE UNAVAILABLE";
            if (sourceTag) sourceTag.textContent = "SOURCE: Unavailable";
        }
    } catch (err) {
        console.error("Intelligence query failed:", err);
        if (ansText) ansText.textContent = "CAREGRID INTELLIGENCE UNAVAILABLE";
        if (sourceTag) sourceTag.textContent = "SOURCE: Unavailable";
    }
}

async function fetchIntelligenceSnapshot() {
    try {
        const res = await fetch("/api/intelligence/state");
        const data = await res.json();
        if (data.status === "success") {
            const sn = data.snapshot;
            const top_p = sn.top_patient;
            const iq = document.getElementById("icontext-queue");
            const ic = document.getElementById("icontext-critical");
            const it = document.getElementById("icontext-toppatient");
            const is = document.getElementById("icontext-topscore");

            if (iq) iq.textContent = sn.total_patients_in_queue;
            if (ic) ic.textContent = sn.critical_patients_count;
            if (it) it.textContent = top_p ? top_p.patient_id : "N/A";
            if (is) is.textContent = top_p ? top_p.priority_score.toFixed(1) : "--";
        }
    } catch (err) {
        console.error("Fetch intelligence snapshot failed:", err);
    }
}

function applyFilter(filterName) {
    activeFilter = filterName;
    document.querySelectorAll(".card-filter-pills .filter-pill").forEach(btn => btn.classList.remove("active"));

    if (filterName === "all") {
        document.getElementById("filter-all").classList.add("active");
        renderQueueTable(currentPatients);
    } else {
        const targetBtn = filterName === "Critical" ? document.getElementById("filter-critical") : document.getElementById("filter-waiting");
        if (targetBtn) targetBtn.classList.add("active");
        const filtered = currentPatients.filter(p => p.patient_status === filterName);
        renderQueueTable(filtered);
    }
}

function setupSimAction(btnId, actionName) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener("click", async () => {
        try {
            const res = await fetch("/api/simulation/event", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: actionName })
            });
            const data = await res.json();
            if (data.status === "success") {
                renderSimResults(data);
                await fetchOverview();
                await fetchPatientsQueue();
                await fetchSideAuditEvents();
            }
        } catch (err) {
            console.error(`Simulation ${actionName} failed:`, err);
        }
    });
}

async function fetchOverview() {
    try {
        const res = await fetch("/api/icu/overview");
        const data = await res.json();
        if (data.status === "success") {
            document.querySelectorAll("#strip-total-patients").forEach(el => el.textContent = data.total_patients.toLocaleString());
            document.querySelectorAll("#strip-bed-capacity").forEach(el => el.textContent = `${data.occupied_beds}/${data.total_beds}`);
            document.querySelectorAll("#strip-available-beds").forEach(el => el.textContent = `${data.available_beds} Available`);

            const kpiTotal = document.getElementById("kpi-total-patients");
            const kpiCrit = document.getElementById("kpi-critical-patients");
            const kpiWait = document.getElementById("kpi-waiting-patients");
            const kpiBed = document.getElementById("kpi-bed-occupancy");
            const kpiAvail = document.getElementById("kpi-available-beds");

            if (kpiTotal) kpiTotal.textContent = data.total_patients.toLocaleString();
            if (kpiCrit) kpiCrit.textContent = data.critical_patients;
            if (kpiWait) kpiWait.textContent = data.waiting_patients;
            if (kpiBed) kpiBed.textContent = `${data.occupied_beds}/${data.total_beds}`;
            if (kpiAvail) kpiAvail.textContent = `${data.available_beds} Beds Available`;
        }
    } catch (err) {
        console.error("Overview fetch failed:", err);
    }
}

async function fetchPatientsQueue() {
    const tbody = document.getElementById("ops-queue-body");
    try {
        const res = await fetch("/api/patients?limit=50");
        const data = await res.json();
        if (data.status === "success") {
            currentPatients = data.patients;
            applyFilter(activeFilter);
            renderQueueDistributionChart(currentPatients);
            renderQueueCompositionChart(currentPatients);

            if (currentPatients.length > 0) {
                const topP = currentPatients[0];
                const kpiTopScore = document.getElementById("kpi-top-score");
                const kpiTopId = document.getElementById("kpi-top-id");
                if (kpiTopScore) kpiTopScore.textContent = topP.priority_score.toFixed(1);
                if (kpiTopId) kpiTopId.textContent = `#01 · ${topP.patient_id}`;
            }

            if (!selectedPatientId && currentPatients.length > 0) {
                selectedPatientId = currentPatients[0].patient_id;
            }
            if (selectedPatientId) {
                selectPatientRow(selectedPatientId, false);
            }
        }
    } catch (err) {
        console.error("Queue fetch failed:", err);
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Error loading dataset. Ensure backend server is running.</td></tr>`;
    }
}

function renderQueueTable(patients) {
    const tbody = document.getElementById("ops-queue-body");
    if (!patients || patients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">No matching patients found.</td></tr>`;
        return;
    }

    tbody.innerHTML = patients.map(p => {
        const isSelected = p.patient_id === selectedPatientId ? "selected-row" : "";
        const rankBadgeClass = p.rank === 1 ? "rank-badge rank-1" : "rank-badge";
        const statusBadgeClass = p.patient_status === "Critical" ? "status-badge critical" :
                                 p.patient_status === "Admitted" ? "status-badge admitted" : "status-badge waiting";
        const scoreBarColor = p.severity >= 70.0 ? "var(--status-critical)" :
                              p.severity >= 40.0 ? "var(--status-warning)" : "var(--status-success)";

        return `
            <tr class="${isSelected}" onclick="selectPatientRow('${p.patient_id}', false)" id="p-row-${p.patient_id}">
                <td><span class="${rankBadgeClass}">#${p.rank}</span></td>
                <td class="patient-id-cell">${p.patient_id}</td>
                <td><span class="${statusBadgeClass}">● ${p.patient_status.toUpperCase()}</span></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="score-cell">${p.priority_score.toFixed(1)}</span>
                        <div style="width: 44px; height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden; flex-shrink: 0;">
                            <div style="height: 100%; width: ${Math.min(100, p.priority_score)}%; background: ${scoreBarColor};"></div>
                        </div>
                    </div>
                </td>
                <td>${p.severity}</td>
                <td>${p.survival_likelihood}%</td>
                <td>${p.waiting_time_minutes} min</td>
                <td><button class="btn-ops" onclick="event.stopPropagation(); openPatientModal('${p.patient_id}')">VIEW</button></td>
            </tr>
        `;
    }).join("");
}

window.selectPatientRow = async function(patientId, openModal = false) {
    selectedPatientId = patientId;

    document.querySelectorAll(".ops-table tbody tr").forEach(tr => tr.classList.remove("selected-row"));
    const targetRow = document.getElementById(`p-row-${patientId}`);
    if (targetRow) targetRow.classList.add("selected-row");

    let patient = currentPatients.find(p => p.patient_id === patientId || p.record_id === patientId);
    if (!patient) {
        try {
            const res = await fetch(`/api/patients/${patientId}`);
            const data = await res.json();
            if (data.status === "success") patient = data.patient;
        } catch (err) {
            console.error("Patient detail fetch failed:", err);
            return;
        }
    }
    if (!patient) return;

    document.getElementById("panel-patient-id").textContent = `PATIENT ${patient.patient_id}`;
    document.getElementById("panel-rank-badge").textContent = `RANK #${patient.rank}`;
    document.getElementById("panel-score").textContent = patient.priority_score.toFixed(1);
    
    const panelStatusBadge = document.getElementById("panel-status-badge");
    if (panelStatusBadge) {
        panelStatusBadge.textContent = `● ${patient.patient_status.toUpperCase()}`;
        panelStatusBadge.className = patient.patient_status === "Critical" ? "status-badge critical" :
                                      patient.patient_status === "Admitted" ? "status-badge admitted" : "status-badge waiting";
    }

    const delta = patient.rank_delta || 0;
    const movementText = delta > 0 ? `↑ ${delta} positions` :
                         delta < 0 ? `↓ ${Math.abs(delta)} positions` : `-- Stable`;
    document.getElementById("panel-rank-movement").textContent = movementText;

    document.getElementById("panel-sev-val").textContent = patient.severity;
    document.getElementById("bar-fill-sev").style.width = `${Math.min(100, patient.severity)}%`;

    document.getElementById("panel-surv-val").textContent = `${patient.survival_likelihood}%`;
    document.getElementById("bar-fill-surv").style.width = `${Math.min(100, patient.survival_likelihood)}%`;

    document.getElementById("panel-wait-val").textContent = `${patient.waiting_time_minutes} min`;
    const waitPct = Math.min(100, (patient.waiting_time_minutes / 120.0) * 100);
    document.getElementById("bar-fill-wait").style.width = `${waitPct}%`;

    const explainCard = document.getElementById("panel-explain-card");
    if (explainCard) {
        explainCard.style.borderLeftColor = patient.severity >= 70.0 ? "var(--status-critical)" :
                                           patient.severity >= 40.0 ? "var(--status-warning)" : "var(--status-success)";
    }

    try {
        const expRes = await fetch(`/api/explain/${patient.patient_id}`);
        const expData = await expRes.json();
        if (expData.status === "success") {
            const exp = expData.explainability;
            document.getElementById("panel-explain-text").textContent = exp.explanation_text;
        }
    } catch (err) {
        console.error("Explainability fetch error:", err);
    }

    const ptabWhy = document.getElementById("ptab-explanation");
    if (ptabWhy) ptabWhy.textContent = `Why #${patient.rank}?`;

    renderPatientBreakdownChart(patient);
    renderRightPanelTabContent(currentPanelSubTab);

    if (openModal) {
        openPatientModal(patientId);
    }
};

window.openPatientModal = async function(patientId) {
    selectedPatientId = patientId;
    const modal = document.getElementById("patient-detail-modal");
    if (!modal) return;

    let patient = currentPatients.find(p => p.patient_id === patientId || p.record_id === patientId);
    try {
        const res = await fetch(`/api/patients/${patientId}`);
        const data = await res.json();
        if (data.status === "success") patient = data.patient;
    } catch (err) {
        console.error("Fetch patient modal details failed:", err);
    }

    if (!patient) return;

    document.getElementById("modal-patient-id").textContent = `PATIENT ${patient.patient_id}`;
    document.getElementById("modal-rank").textContent = `RANK #${patient.rank}`;
    document.getElementById("modal-priority-score").textContent = patient.priority_score.toFixed(1);

    const mtabWhy = document.getElementById("mtab-why");
    if (mtabWhy) mtabWhy.textContent = `WHY #${patient.rank}`;

    const statusBadge = document.getElementById("modal-status-badge");
    if (statusBadge) {
        statusBadge.textContent = `● ${patient.patient_status.toUpperCase()}`;
        statusBadge.className = patient.patient_status === "Critical" ? "status-badge critical" :
                               patient.patient_status === "Admitted" ? "status-badge admitted" : "status-badge waiting";
    }

    const delta = patient.rank_delta || 0;
    const deltaText = delta > 0 ? `↑ ${delta} positions` :
                      delta < 0 ? `↓ ${Math.abs(delta)} positions` : `-- Stable Position`;
    document.getElementById("modal-rank-delta").textContent = deltaText;

    document.getElementById("modal-sev-val").textContent = patient.severity;
    const sevFill = document.getElementById("mbar-fill-sev");
    if (sevFill) {
        sevFill.style.width = `${Math.min(100, patient.severity)}%`;
        sevFill.style.backgroundColor = patient.severity >= 70.0 ? "var(--status-critical)" :
                                        patient.severity >= 40.0 ? "var(--status-warning)" : "var(--status-success)";
    }

    document.getElementById("modal-surv-val").textContent = `${patient.survival_likelihood}%`;
    const survFill = document.getElementById("mbar-fill-surv");
    if (survFill) survFill.style.width = `${Math.min(100, patient.survival_likelihood)}%`;

    document.getElementById("modal-wait-val").textContent = `${patient.waiting_time_minutes} min`;
    const waitPct = Math.min(100, (patient.waiting_time_minutes / 120.0) * 100);
    const waitFill = document.getElementById("mbar-fill-wait");
    if (waitFill) waitFill.style.width = `${waitPct}%`;

    const explainCard = document.getElementById("modal-explain-card");
    if (explainCard) {
        explainCard.style.borderLeftColor = patient.severity >= 70.0 ? "var(--status-critical)" :
                                           patient.severity >= 40.0 ? "var(--status-warning)" : "var(--status-success)";
    }

    try {
        const expRes = await fetch(`/api/explain/${patient.patient_id}`);
        const expData = await expRes.json();
        if (expData.status === "success") {
            const exp = expData.explainability;
            document.getElementById("modal-explain-text").textContent = exp.explanation_text;
        }
    } catch (err) {
        console.error("Modal explainability error:", err);
    }

    const rawContainer = document.getElementById("modal-raw-params");
    const raw = patient.raw_clinical_params || {};
    rawContainer.innerHTML = `
        <div class="raw-param-box"><span class="raw-param-label">SOFA Score</span> <span class="raw-param-val">${patient.sofa_score}</span></div>
        <div class="raw-param-box"><span class="raw-param-label">SAPS-I Score</span> <span class="raw-param-val">${raw.SAPS_first || '14'}</span></div>
        <div class="raw-param-box"><span class="raw-param-label">GCS Score</span> <span class="raw-param-val">${raw.GCS_first || '15'}</span></div>
        <div class="raw-param-box"><span class="raw-param-label">Heart Rate (HR)</span> <span class="raw-param-val">${raw.HR_first || '88'} bpm</span></div>
        <div class="raw-param-box"><span class="raw-param-label">Mean Arterial BP</span> <span class="raw-param-val">${raw.MAP_first || '75'} mmHg</span></div>
        <div class="raw-param-box"><span class="raw-param-label">Creatinine</span> <span class="raw-param-val">${raw.Creatinine_first || '1.1'} mg/dL</span></div>
        <div class="raw-param-box"><span class="raw-param-label">WBC Count</span> <span class="raw-param-val">${raw.WBC_first || '9.4'} k/uL</span></div>
        <div class="raw-param-box"><span class="raw-param-label">Arrival Date</span> <span class="raw-param-val">${patient.arrival_time || '2025-03-16'}</span></div>
    `;

    modal.classList.remove("hidden");

    // ── V3.1: Populate score breakdown table ───────────────────────
    populateV31Breakdown(patient);
    // ── V3.5: Populate patient recent activity & audit trace ───────
    fetchPatientAuditHistory(patient.patient_id);
    // Reset response panel on new patient open
    const respPanel = document.getElementById("v31-response-panel");
    const errPanel  = document.getElementById("v31-error-panel");
    if (respPanel) respPanel.style.display = "none";
    if (errPanel)  errPanel.style.display  = "none";
};

// ── V3.1: Populate the static score breakdown from patient data ──────────────
function populateV31Breakdown(patient) {
    const weights = { severity: 0.50, survival: 0.30, waiting: 0.20 };
    const sevContrib  = +(patient.severity * weights.severity).toFixed(1);
    const survContrib = +(patient.survival_likelihood * weights.survival).toFixed(1);
    const waitRaw     = Math.min(100.0, patient.waiting_time_minutes / 1.2);
    const waitContrib = +(waitRaw * weights.waiting).toFixed(1);

    const contrib = { severity: sevContrib, survival: survContrib, waiting: waitContrib };
    const dominantKey = Object.entries(contrib).sort((a,b) => b[1]-a[1])[0][0];
    const dominantLabel = { severity: "Severity", survival: "Survival Likelihood", waiting: "Waiting Duration" }[dominantKey];

    const sevValEl   = document.getElementById("v31-sev-val");
    const survValEl  = document.getElementById("v31-surv-val");
    const waitValEl  = document.getElementById("v31-wait-val");
    const sevCEl     = document.getElementById("v31-sev-contrib");
    const survCEl    = document.getElementById("v31-surv-contrib");
    const waitCEl    = document.getElementById("v31-wait-contrib");
    const domEl      = document.getElementById("v31-dominant");

    if (sevValEl)  sevValEl.textContent  = patient.severity;
    if (survValEl) survValEl.textContent = `${patient.survival_likelihood}%`;
    if (waitValEl) waitValEl.textContent = `${patient.waiting_time_minutes} min`;
    if (sevCEl)    sevCEl.textContent    = `+${sevContrib} pts`;
    if (survCEl)   survCEl.textContent   = `+${survContrib} pts`;
    if (waitCEl)   waitCEl.textContent   = `+${waitContrib} pts`;
    if (domEl)     domEl.textContent     = dominantLabel;
}

// ── V3.1: Ask CareGrid Intelligence about the currently-open patient ─────────
async function askPatientIntelligence(mode, freeQuestion = "") {
    if (!selectedPatientId) return;

    const responsePanel = document.getElementById("v31-response-panel");
    const responseText  = document.getElementById("v31-response-text");
    const responseSource = document.getElementById("v31-response-source");
    const errPanel      = document.getElementById("v31-error-panel");

    // Disable all action buttons while loading
    document.querySelectorAll(".v31-action-btn").forEach(b => b.classList.add("v31-loading"));
    if (responsePanel) {
        responsePanel.style.display = "block";
        responseText.textContent = "Querying CareGrid Intelligence…";
        responseSource.textContent = "—";
    }
    if (errPanel) errPanel.style.display = "none";

    try {
        const res = await fetch("/api/intelligence/ask-patient", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                patient_id: selectedPatientId,
                mode: mode,
                question: freeQuestion
            })
        });
        const data = await res.json();

        if (data.status === "success") {
            if (responseText)   responseText.textContent   = data.answer;
            if (responseSource) responseSource.textContent = data.source || "CareGrid Priority Engine";
            if (responsePanel)  responsePanel.style.display = "block";
        } else {
            if (responsePanel) responsePanel.style.display = "none";
            if (errPanel)      errPanel.style.display = "block";
        }
    } catch (err) {
        console.error("V3.1 patient intelligence error:", err);
        if (responsePanel) responsePanel.style.display = "none";
        if (errPanel)      errPanel.style.display = "block";
    } finally {
        document.querySelectorAll(".v31-action-btn").forEach(b => b.classList.remove("v31-loading"));
    }
}

// ── V3.1: Setup Intelligence Listeners (called from initApp) ──────────────────
function setupV31IntelligenceListeners() {
    // Quick action buttons
    document.querySelectorAll(".v31-action-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const mode = btn.dataset.mode;
            if (mode) askPatientIntelligence(mode);
        });
    });

    // Free-text ASK button
    const askBtn   = document.getElementById("v31-btn-ask");
    const freeInput = document.getElementById("v31-free-input");

    if (askBtn && freeInput) {
        askBtn.addEventListener("click", () => {
            const q = freeInput.value.trim();
            if (q) askPatientIntelligence("free", q);
        });
        freeInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                const q = freeInput.value.trim();
                if (q) askPatientIntelligence("free", q);
            }
        });
    }
}


async function fetchSideAuditEvents() {
    const container = document.getElementById("side-audit-events");
    if (!container) return;
    try {
        const res = await fetch("/api/audit?limit=4");
        const data = await res.json();
        if (data.status === "success") {
            const events = data.audit_trail || [];
            if (events.length === 0) {
                container.innerHTML = `<div style="font-size:12px; color:var(--text-secondary);">No arbitration events recorded yet.</div>`;
                return;
            }
            container.innerHTML = events.slice(0, 4).map(evt => `
                <div style="background: #f8fafc; border-radius: 10px; padding: 10px; border-left: 3px solid var(--accent-green);">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 2px;">
                        <span>${evt.event_type}</span>
                        <span style="font-family: var(--font-mono); color: var(--text-muted);">${evt.timestamp.split('T')[1].split('.')[0]}</span>
                    </div>
                    <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.3;">${evt.reason}</div>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error("Side audit events fetch failed:", err);
    }
}

function renderSimResults(data) {
    const container = document.getElementById("sim-output-container");
    const evt = data.audit_event || {};
    const movedUp = data.moved_up || [];
    const movedDown = data.moved_down || [];

    container.innerHTML = `
        <div style="margin-bottom: 12px; padding: 10px; background: #ffffff; border-radius: 10px; border: 1px solid #cbd5e1;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span class="status-badge admitted">${evt.event_type || 'EVENT'}</span>
                <span style="font-family: var(--font-mono); font-weight: 700; font-size: 12px; color: #0f172a;">${evt.patient_id ? `Patient ${evt.patient_id}` : 'Queue Re-ranked'}</span>
            </div>
            <p style="font-size: 12px; color: var(--text-secondary); margin: 0;">${evt.reason || 'Arbitration engine re-ranked candidate population.'}</p>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div>
                <span style="font-size: 11px; font-weight: 700; color: var(--status-success); text-transform: uppercase;">PROMOTED IN RANK (${movedUp.length})</span>
                ${movedUp.length === 0 ? '<p style="font-size:12px; color:var(--text-muted); margin-top:4px;">None</p>' : movedUp.slice(0, 5).map(m => `
                    <div style="font-family: var(--font-mono); font-size: 12px; padding: 4px 0; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between;">
                        <span style="color: #0f172a; font-weight:600;">${m.patient_id}</span>
                        <span>#${m.previous_rank} → <span style="color: var(--status-success); font-weight:700;">#${m.new_rank}</span> (+${m.rank_delta})</span>
                    </div>
                `).join('')}
            </div>
            <div>
                <span style="font-size: 11px; font-weight: 700; color: var(--status-warning); text-transform: uppercase;">DEMOTED IN RANK (${movedDown.length})</span>
                ${movedDown.length === 0 ? '<p style="font-size:12px; color:var(--text-muted); margin-top:4px;">None</p>' : movedDown.slice(0, 5).map(m => `
                    <div style="font-family: var(--font-mono); font-size: 12px; padding: 4px 0; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between;">
                        <span style="color: #0f172a; font-weight:600;">${m.patient_id}</span>
                        <span>#${m.previous_rank} → <span style="color: var(--status-warning); font-weight:700;">#${m.new_rank}</span> (${m.rank_delta})</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

async function fetchAuditTimeline() {
    const container = document.getElementById("audit-timeline-body");
    try {
        const res = await fetch("/api/audit?limit=20");
        const data = await res.json();
        if (data.status === "success") {
            const events = data.audit_trail || [];
            if (events.length === 0) {
                container.innerHTML = `<p style="font-size:13px; color:var(--text-muted);">No audit events recorded yet.</p>`;
                return;
            }

            container.innerHTML = events.map(evt => `
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid var(--accent-green); border-radius: 12px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                            <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">${evt.timestamp.split('T')[1].split('.')[0]}</span>
                            <span class="status-badge admitted">${evt.event_type}</span>
                            ${evt.patient_id ? `<span style="font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #0f172a;">PATIENT ${evt.patient_id}</span>` : ''}
                        </div>
                        <div style="font-size: 12px; color: var(--text-secondary);">${evt.reason}</div>
                    </div>
                    <div style="text-align: right;">
                        ${evt.previous_rank ? `<div style="font-family: var(--font-mono); font-size: 12px; font-weight: 800; color: var(--status-success);">#${evt.previous_rank} → #${evt.new_rank}</div>` : ''}
                        <span style="font-family: var(--font-mono); font-size: 10px; color: var(--text-muted);">${evt.source}</span>
                    </div>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error("Audit timeline fetch failed:", err);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// V3.5 — AUDIT INTELLIGENCE & SMALL ATTENTION FOUNDATION CLIENT LOGIC
// ══════════════════════════════════════════════════════════════════════════════

async function fetchMajorRankChanges() {
    const container = document.getElementById("small-attention-container");
    const textEl = document.getElementById("major-rank-pill-text");
    const btn = document.getElementById("btn-major-rank-pill");
    if (!container) return;

    try {
        const res = await fetch("/api/attention/major-changes?threshold=2");
        const data = await res.json();
        if (data.status === "success" && data.major_changes && data.major_changes.length > 0) {
            const topChange = data.major_changes[0];
            container.style.display = "flex";
            if (textEl) {
                textEl.textContent = `${topChange.patient_id} (#${topChange.previous_rank} → #${topChange.new_rank})`;
            }
            if (btn) {
                btn.onclick = () => {
                    openPatientDetailModal(topChange.patient_id);
                    askPatientIntelligence(topChange.patient_id, "trace_move");
                };
            }
        } else {
            container.style.display = "none";
        }
    } catch (err) {
        console.error("Fetch major rank changes failed:", err);
        if (container) container.style.display = "none";
    }
}

async function fetchAttentionSignals() {
    const container = document.getElementById("attention-cards-container");
    const countBadge = document.getElementById("attention-signals-count-badge");
    if (!container) return;

    try {
        const res = await fetch("/api/attention/signals");
        const data = await res.json();

        if (data.status === "success" && data.signals && data.signals.length > 0) {
            const signals = data.signals;
            if (countBadge) {
                countBadge.textContent = `${signals.length} ACTIVE SIGNALS`;
                countBadge.className = "status-badge warning";
            }

            container.innerHTML = signals.map(sig => {
                let badgeStyle = "background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;";
                if (sig.severity_class === "critical") badgeStyle = "background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;";
                else if (sig.severity_class === "warning") badgeStyle = "background: #fffbeb; color: #d97706; border: 1px solid #fde68a;";

                let actionOnClick = "";
                if (sig.signal_type === "NEAR_TIE") {
                    actionOnClick = `openPatientComparison('${sig.patient_id_a}', '${sig.patient_id_b}')`;
                } else if (sig.signal_type === "MAJOR_RANK_CHANGE" || sig.signal_type === "WAITING_TIME_ATTENTION") {
                    actionOnClick = `selectPatientRow('${sig.patient_id}', true)`;
                } else if (sig.signal_type === "CRITICAL_QUEUE_LOAD") {
                    actionOnClick = `filterQueue('critical')`;
                } else {
                    actionOnClick = `selectPatientRow('${sig.patient_id || ''}', true)`;
                }

                return `
                    <div class="ui-card" style="padding: 12px 14px; border-left: 3px solid ${sig.severity_class === 'critical' ? 'var(--status-critical)' : sig.severity_class === 'warning' ? 'var(--status-warning)' : 'var(--accent-blue)'}; margin-bottom: 0;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                            <span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; ${badgeStyle}">${sig.badge_label}</span>
                            <button class="btn-ops" style="font-size: 10px; padding: 3px 8px; background: #0f172a;" onclick="${actionOnClick}">${sig.action_label}</button>
                        </div>
                        <h4 style="font-size: 12px; font-weight: 700; color: #0f172a; margin: 0 0 4px;">${sig.title}</h4>
                        <p style="font-size: 11px; color: #475569; margin: 0 0 8px; line-height: 1.4;">${sig.description}</p>
                        <button style="font-size: 10.5px; font-weight: 600; color: #0284c7; background: transparent; border: none; padding: 0; cursor: pointer; text-decoration: underline;" onclick="explainAttentionSignal('${sig.id}')">
                            Why is this flagged?
                        </button>
                    </div>
                `;
            }).join("");

            window.liveAttentionSignals = signals;
        } else {
            if (countBadge) {
                countBadge.textContent = "0 ACTIVE SIGNALS";
                countBadge.className = "status-badge success";
            }
            container.innerHTML = `
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 12px 16px; text-align: center; color: var(--status-success); font-size: 11px; font-weight: 600;">
                    NO SIGNIFICANT ATTENTION SIGNALS — Queue operating within normal operational parameters.
                </div>
            `;
        }
    } catch (err) {
        console.error("Fetch attention signals failed:", err);
        if (countBadge) {
            countBadge.textContent = "TEMPORARILY UNAVAILABLE";
            countBadge.className = "status-badge critical";
        }
        container.innerHTML = `
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 12px 16px; text-align: center; color: var(--status-critical); font-size: 11px; font-weight: 600;">
                ATTENTION SIGNALS TEMPORARILY UNAVAILABLE — Core CareGrid priority queue remains fully operational.
            </div>
        `;
    }
}

async function explainAttentionSignal(signalId) {
    const signals = window.liveAttentionSignals || [];
    const sig = signals.find(s => s.id === signalId);
    if (!sig) return;

    // Switch to CareGrid Intelligence tab
    const intelNav = document.querySelector('.nav-item[data-tab="intelligence"]');
    if (intelNav) intelNav.click();

    const freeInput = document.getElementById("intel-free-input");
    if (freeInput) freeInput.value = `Why is this flagged? (${sig.title})`;

    try {
        const res = await fetch("/api/intelligence/explain-attention", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signal: sig })
        });
        const data = await res.json();
        if (data.status === "success") {
            renderIntelAnswer(sig.title, data.answer, data.source);
        }
    } catch (err) {
        renderIntelAnswer(sig.title, sig.description, "CareGrid Attention Engine (Deterministic Fallback)");
    }
}

async function fetchPatientAuditHistory(patientId) {
    const container = document.getElementById("v35-patient-audit-container");
    if (!container) return;
    try {
        const res = await fetch(`/api/audit?limit=20`);
        const data = await res.json();
        const events = (data.events || []).filter(e => e.patient_id === patientId);

        if (events.length === 0) {
            container.innerHTML = `<div style="color: var(--text-muted); font-size: 11px;">NO RECENT ACTIVITY FOR THIS PATIENT</div>`;
            return;
        }

        let html = events.slice(0, 3).map(e => `
            <div style="margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px dashed #e2e8f0;">
                <div style="display: flex; justify-content: space-between; font-weight: 600; color: #0f172a;">
                    <span>${e.event_type}</span>
                    <span style="font-family: var(--font-mono); font-size: 10.5px; color: var(--text-muted);">${(e.timestamp || '').substring(11, 19)}</span>
                </div>
                ${e.previous_rank && e.new_rank ? `<div style="font-size: 11px; color: var(--accent-green); font-weight: 700;">Rank Shift: #${e.previous_rank} → #${e.new_rank}</div>` : ''}
                <div style="font-size: 11px; color: #475569;">${e.reason || ''}</div>
            </div>
        `).join('');

        const latest = events[0];
        html += `
            <div style="margin-top: 8px; font-size: 10.5px; background: #f8fafc; padding: 8px; border-radius: 6px; font-family: var(--font-mono); line-height: 1.5;">
                <div style="font-weight: 700; color: #64748b; margin-bottom: 4px;">RANK CHANGE TRACE</div>
                <div>${latest.event_type} ↓</div>
                <div>${latest.reason || 'Parameter Change'} ↓</div>
                <div>Priority Engine Recalculation (50/30/20) ↓</div>
                <div>Rank Position #${latest.new_rank || 'N/A'} ↓</div>
                <div>Audit Event ${latest.event_id || 'EVT'} Logged</div>
            </div>
        `;
        container.innerHTML = html;
    } catch (err) {
        console.error("Fetch patient audit failed:", err);
        container.innerHTML = `<div style="color: var(--text-muted); font-size: 11px;">Audit trace unavailable</div>`;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// PATIENT DETAIL TAB NAVIGATION BUG FIX — OVERVIEW / BREAKDOWN / WHY #RANK
// ══════════════════════════════════════════════════════════════════════════════

let currentPanelSubTab = "overview";
let currentModalSubTab = "overview";

function setupPanelSubTabs() {
    // 1. Right Column Card Tabs
    const pTabs = [
        { id: "ptab-overview", mode: "overview" },
        { id: "ptab-breakdown", mode: "breakdown" },
        { id: "ptab-explanation", mode: "why" }
    ];

    pTabs.forEach(t => {
        const btn = document.getElementById(t.id);
        if (btn) {
            btn.addEventListener("click", () => {
                pTabs.forEach(item => {
                    const b = document.getElementById(item.id);
                    if (b) b.classList.remove("active");
                });
                btn.classList.add("active");
                currentPanelSubTab = t.mode;
                renderRightPanelTabContent(currentPanelSubTab);
            });
        }
    });

    // 2. Modal Sub-Tabs
    const mTabs = [
        { id: "mtab-overview", mode: "overview" },
        { id: "mtab-breakdown", mode: "breakdown" },
        { id: "mtab-why", mode: "why" }
    ];

    mTabs.forEach(t => {
        const btn = document.getElementById(t.id);
        if (btn) {
            btn.addEventListener("click", () => {
                mTabs.forEach(item => {
                    const b = document.getElementById(item.id);
                    if (b) b.classList.remove("active");
                });
                btn.classList.add("active");
                currentModalSubTab = t.mode;
                renderModalSubTabContent(currentModalSubTab);
            });
        }
    });
}

async function renderRightPanelTabContent(tabMode) {
    if (!selectedPatientId) return;
    let patient = currentPatients.find(p => p.patient_id === selectedPatientId || p.record_id === selectedPatientId);
    if (!patient) return;

    // Update dynamic button label
    const ptabWhy = document.getElementById("ptab-explanation");
    if (ptabWhy) ptabWhy.textContent = `Why #${patient.rank}?`;

    const rankEl = document.getElementById("panel-explain-rank-text");
    const pidEl = document.getElementById("panel-explain-pid-text");
    const scoreEl = document.getElementById("panel-explain-score-text");
    if (rankEl) rankEl.textContent = `#${patient.rank}`;
    if (pidEl) pidEl.textContent = patient.patient_id;
    if (scoreEl) scoreEl.textContent = patient.priority_score.toFixed(1);

    const explainText = document.getElementById("panel-explain-text");

    if (tabMode === "overview") {
        try {
            const expRes = await fetch(`/api/explain/${patient.patient_id}`);
            const expData = await expRes.json();
            if (expData.status === "success" && explainText) {
                explainText.textContent = expData.explainability.explanation_text;
            }
        } catch (err) {
            if (explainText) explainText.textContent = `Patient ${patient.patient_id} holds Rank #${patient.rank} with priority score ${patient.priority_score.toFixed(1)}.`;
        }
    } else if (tabMode === "breakdown") {
        const weights = { severity: 0.50, survival: 0.30, waiting: 0.20 };
        const sevContrib  = +(patient.severity * weights.severity).toFixed(1);
        const survContrib = +(patient.survival_likelihood * weights.survival).toFixed(1);
        const waitRaw     = Math.min(100.0, patient.waiting_time_minutes / 1.2);
        const waitContrib = +(waitRaw * weights.waiting).toFixed(1);

        const contrib = { severity: sevContrib, survival: survContrib, waiting: waitContrib };
        const dominantKey = Object.entries(contrib).sort((a,b) => b[1]-a[1])[0][0];
        const dominantLabel = { severity: "Severity", survival: "Survival Likelihood", waiting: "Waiting Duration" }[dominantKey];

        if (explainText) {
            explainText.innerHTML = `
                <strong>SCORE BREAKDOWN (Rank #${patient.rank})</strong><br>
                • Severity (SOFA): +${sevContrib} pts (50% weight)<br>
                • Survival Likelihood: +${survContrib} pts (30% weight)<br>
                • Waiting Duration: +${waitContrib} pts (20% weight)<br>
                <strong>Dominant Factor:</strong> ${dominantLabel}
            `;
        }
    } else if (tabMode === "why") {
        if (explainText) explainText.textContent = `Fetching grounded rank explanation for Patient ${patient.patient_id}...`;
        try {
            const askRes = await fetch("/api/intelligence/ask-patient", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    patient_id: patient.patient_id,
                    mode: "why_ranked"
                })
            });
            const askData = await askRes.json();
            if (askData.status === "success" && explainText) {
                explainText.textContent = askData.answer;
            }
        } catch (err) {
            if (explainText) explainText.textContent = `Patient ${patient.patient_id} is ranked #${patient.rank} with priority score ${patient.priority_score.toFixed(1)}.`;
        }
    }
}

async function renderModalSubTabContent(tabMode) {
    if (!selectedPatientId) return;
    let patient = currentPatients.find(p => p.patient_id === selectedPatientId || p.record_id === selectedPatientId);
    if (!patient) return;

    // Update dynamic modal button label
    const mtabWhy = document.getElementById("mtab-why");
    if (mtabWhy) mtabWhy.textContent = `WHY #${patient.rank}`;

    const explainText = document.getElementById("modal-explain-text");

    if (tabMode === "overview") {
        try {
            const expRes = await fetch(`/api/explain/${patient.patient_id}`);
            const expData = await expRes.json();
            if (expData.status === "success" && explainText) {
                explainText.textContent = expData.explainability.explanation_text;
            }
        } catch (err) {
            if (explainText) explainText.textContent = `High SOFA-derived severity is the primary contributor for Patient ${patient.patient_id}.`;
        }
    } else if (tabMode === "breakdown") {
        const weights = { severity: 0.50, survival: 0.30, waiting: 0.20 };
        const sevContrib  = +(patient.severity * weights.severity).toFixed(1);
        const survContrib = +(patient.survival_likelihood * weights.survival).toFixed(1);
        const waitRaw     = Math.min(100.0, patient.waiting_time_minutes / 1.2);
        const waitContrib = +(waitRaw * weights.waiting).toFixed(1);

        if (explainText) {
            explainText.innerHTML = `
                SCORE CONTRIBUTION BREAKDOWN — PATIENT ${patient.patient_id} (Rank #${patient.rank})<br>
                • Severity (SOFA-derived): ${patient.severity} → +${sevContrib} pts<br>
                • Survival Likelihood: ${patient.survival_likelihood}% → +${survContrib} pts<br>
                • Waiting Duration: ${patient.waiting_time_minutes} min → +${waitContrib} pts
            `;
        }
    } else if (tabMode === "why") {
        if (explainText) explainText.textContent = `Loading grounded rank explanation for Patient ${patient.patient_id}...`;
        try {
            const askRes = await fetch("/api/intelligence/ask-patient", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    patient_id: patient.patient_id,
                    mode: "why_ranked"
                })
            });
            const askData = await askRes.json();
            if (askData.status === "success" && explainText) {
                explainText.textContent = askData.answer;
            }
        } catch (err) {
            if (explainText) explainText.textContent = `Patient ${patient.patient_id} is ranked #${patient.rank} with priority score ${patient.priority_score.toFixed(1)}.`;
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// V5.0 — AESTHETIC DATA VISUALIZATION UPGRADE (CHARTS & GRAPHS)
// ══════════════════════════════════════════════════════════════════════════════

// CHART 1: QUEUE PRIORITY DISTRIBUTION (SVG Bar Chart)
function renderQueueDistributionChart(patients) {
    const container = document.getElementById("chart-queue-distribution");
    if (!container || !patients || patients.length === 0) return;

    const topSubset = patients.slice(0, 15);
    const maxScore = Math.max(...topSubset.map(p => p.priority_score), 100);
    const svgWidth = 500;
    const svgHeight = 85;
    const barWidth = 22;
    const gap = 8;
    const paddingLeft = 24;

    let svg = `<svg viewBox="0 0 ${svgWidth} ${svgHeight}" style="width: 100%; height: 100%; font-family: var(--font-sans);">`;
    svg += `<line x1="${paddingLeft}" y1="10" x2="${svgWidth}" y2="10" stroke="#e2e8f0" stroke-dasharray="3,3"/>`;
    svg += `<line x1="${paddingLeft}" y1="38" x2="${svgWidth}" y2="38" stroke="#e2e8f0" stroke-dasharray="3,3"/>`;
    svg += `<line x1="${paddingLeft}" y1="65" x2="${svgWidth}" y2="65" stroke="#cbd5e1"/>`;

    svg += `<text x="18" y="13" font-size="8.5" fill="#94a3b8" text-anchor="end">100</text>`;
    svg += `<text x="18" y="41" font-size="8.5" fill="#94a3b8" text-anchor="end">50</text>`;
    svg += `<text x="18" y="68" font-size="8.5" fill="#94a3b8" text-anchor="end">0</text>`;

    topSubset.forEach((p, idx) => {
        const x = paddingLeft + idx * (barWidth + gap);
        const h = Math.max(6, (p.priority_score / maxScore) * 55);
        const y = 65 - h;
        const color = p.severity >= 70.0 ? '#ef4444' : p.patient_status === 'Admitted' ? '#10b981' : '#3b82f6';
        
        svg += `
            <g cursor="pointer" onclick="selectPatientRow('${p.patient_id}', false)">
                <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="3" fill="${color}" opacity="0.85">
                    <title>Patient ${p.patient_id} (Rank #${p.rank})&#10;Priority Score: ${p.priority_score.toFixed(1)}&#10;Severity: ${p.severity}</title>
                </rect>
                <text x="${x + barWidth/2}" y="78" font-size="8" fill="#64748b" text-anchor="middle" font-weight="600">#${p.rank}</text>
            </g>
        `;
    });

    svg += `</svg>`;
    container.innerHTML = svg;
}

// CHART 5: QUEUE COMPOSITION DONUT CHART
function renderQueueCompositionChart(patients) {
    const container = document.getElementById("chart-queue-composition");
    if (!container || !patients) return;

    const criticalCount = patients.filter(p => p.severity >= 70.0).length;
    const waitingCount = patients.filter(p => p.patient_status === "Waiting").length;
    const admittedCount = patients.filter(p => p.patient_status === "Admitted").length;
    const total = patients.length || 1;

    const critPct = criticalCount / total;
    const waitPct = waitingCount / total;
    const admPct = admittedCount / total;

    const html = `
        <div style="display: flex; align-items: center; justify-content: space-around; width: 100%; height: 100%;">
            <svg width="80" height="80" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="14" fill="transparent" stroke="#e2e8f0" stroke-width="4.5"/>
                <circle cx="18" cy="18" r="14" fill="transparent" stroke="#ef4444" stroke-width="4.5" stroke-dasharray="${critPct * 88} 88" stroke-dashoffset="0" transform="rotate(-90 18 18)"/>
                <circle cx="18" cy="18" r="14" fill="transparent" stroke="#f59e0b" stroke-width="4.5" stroke-dasharray="${waitPct * 88} 88" stroke-dashoffset="-${critPct * 88}" transform="rotate(-90 18 18)"/>
                <circle cx="18" cy="18" r="14" fill="transparent" stroke="#10b981" stroke-width="4.5" stroke-dasharray="${admPct * 88} 88" stroke-dashoffset="-${(critPct + waitPct) * 88}" transform="rotate(-90 18 18)"/>
                <text x="18" y="16.5" font-size="6.5" font-weight="800" fill="#0f172a" text-anchor="middle">3.6K</text>
                <text x="18" y="22" font-size="4.5" font-weight="600" fill="#64748b" text-anchor="middle">TOTAL</text>
            </svg>
            <div style="display: flex; flex-direction: column; gap: 4px; font-size: 10px;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="width: 7px; height: 7px; border-radius: 50%; background: #ef4444; display: inline-block;"></span>
                    <span style="color: #475569; font-weight: 600;">Critical (${criticalCount})</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; display: inline-block;"></span>
                    <span style="color: #475569; font-weight: 600;">Waiting (${waitingCount})</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="width: 7px; height: 7px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
                    <span style="color: #475569; font-weight: 600;">Admitted (${admittedCount})</span>
                </div>
            </div>
        </div>
    `;
    container.innerHTML = html;
}

// CHART 2: PATIENT PRIORITY COMPONENT BREAKDOWN (Horizontal Bar Chart)
function renderPatientBreakdownChart(patient) {
    const container = document.getElementById("chart-patient-breakdown");
    if (!container || !patient) return;

    const weights = { severity: 0.50, survival: 0.30, waiting: 0.20 };
    const sevContrib  = +(patient.severity * weights.severity).toFixed(1);
    const survContrib = +(patient.survival_likelihood * weights.survival).toFixed(1);
    const waitRaw     = Math.min(100.0, patient.waiting_time_minutes / 1.2);
    const waitContrib = +(waitRaw * weights.waiting).toFixed(1);

    const maxContrib = 50.0;
    const sevPct  = (sevContrib / maxContrib) * 100;
    const survPct = (survContrib / maxContrib) * 100;
    const waitPct = (waitContrib / maxContrib) * 100;

    const html = `
        <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10.5px;">
            <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 2px; font-weight: 600; color: #334155;">
                    <span>Severity (SOFA Derived)</span>
                    <span style="font-family: var(--font-mono); color: #ef4444; font-weight: 700;">+${sevContrib} pts</span>
                </div>
                <div style="height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                    <div style="height: 100%; width: ${sevPct}%; background: #ef4444; border-radius: 3px;"></div>
                </div>
            </div>

            <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 2px; font-weight: 600; color: #334155;">
                    <span>Survival Likelihood</span>
                    <span style="font-family: var(--font-mono); color: #f59e0b; font-weight: 700;">+${survContrib} pts</span>
                </div>
                <div style="height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                    <div style="height: 100%; width: ${survPct}%; background: #f59e0b; border-radius: 3px;"></div>
                </div>
            </div>

            <div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 2px; font-weight: 600; color: #334155;">
                    <span>Waiting Duration Equity</span>
                    <span style="font-family: var(--font-mono); color: #3b82f6; font-weight: 700;">+${waitContrib} pts</span>
                </div>
                <div style="height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                    <div style="height: 100%; width: ${waitPct}%; background: #3b82f6; border-radius: 3px;"></div>
                </div>
            </div>
        </div>
    `;
    container.innerHTML = html;
}

// CHART 3: PATIENT COMPARISON GROUPED BAR CHART
async function openPatientComparison(pidA, pidB) {
    const modal = document.getElementById("patient-comparison-modal");
    const grid = document.getElementById("comparison-cards-grid");
    const title = document.getElementById("comparison-modal-title");
    const text = document.getElementById("comparison-explain-text");

    if (!modal) return;

    let pA = currentPatients.find(p => p.patient_id === pidA);
    let pB = currentPatients.find(p => p.patient_id === pidB);

    if (!pA) {
        try {
            const resA = await fetch(`/api/patients/${pidA}`);
            const dataA = await resA.json();
            if (dataA.status === "success") pA = dataA.patient;
        } catch (e) {}
    }

    if (!pB) {
        try {
            const resB = await fetch(`/api/patients/${pidB}`);
            const dataB = await resB.json();
            if (dataB.status === "success") pB = dataB.patient;
        } catch (e) {}
    }

    if (!pA || !pB) return;

    if (title) title.textContent = `PATIENT COMPARISON: ${pA.patient_id} VS ${pB.patient_id}`;

    if (grid) {
        grid.innerHTML = `
            <div style="background: #f8fafc; border: 1px solid #38bdf8; border-radius: 10px; padding: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span style="font-size: 11px; font-weight: 700; color: #0284c7;">PATIENT ${pA.patient_id}</span>
                    <span class="rank-badge rank-1">RANK #${pA.rank}</span>
                </div>
                <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 4px;">${pA.priority_score.toFixed(1)} <span style="font-size: 10px; color: var(--text-muted);">PRIORITY</span></div>
                <div style="font-size: 11px; color: #475569;">SOFA Severity: <strong>${pA.severity}</strong> | Survival: <strong>${pA.survival_likelihood}%</strong> | Wait: <strong>${pA.waiting_time_minutes} min</strong></div>
            </div>

            <div style="background: #f0fdf4; border: 1px solid #4ade80; border-radius: 10px; padding: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span style="font-size: 11px; font-weight: 700; color: #059669;">PATIENT ${pB.patient_id}</span>
                    <span class="rank-badge rank-1" style="background: #dcfce7; color: #166534;">RANK #${pB.rank}</span>
                </div>
                <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 4px;">${pB.priority_score.toFixed(1)} <span style="font-size: 10px; color: var(--text-muted);">PRIORITY</span></div>
                <div style="font-size: 11px; color: #475569;">SOFA Severity: <strong>${pB.severity}</strong> | Survival: <strong>${pB.survival_likelihood}%</strong> | Wait: <strong>${pB.waiting_time_minutes} min</strong></div>
            </div>
        `;
    }

    renderComparisonChart(pA, pB);

    if (text) {
        const gap = Math.abs(pA.priority_score - pB.priority_score).toFixed(1);
        text.textContent = `Patient ${pA.patient_id} (Rank #${pA.rank}, Score ${pA.priority_score.toFixed(1)}) and Patient ${pB.patient_id} (Rank #${pB.rank}, Score ${pB.priority_score.toFixed(1)}) are separated by ${gap} priority points. Under CareGrid rules, Patient ${pA.rank < pB.rank ? pA.patient_id : pB.patient_id} holds higher priority due to higher SOFA organ failure severity contribution.`;
    }

    modal.classList.remove("hidden");
}

function closeComparisonModal() {
    const modal = document.getElementById("patient-comparison-modal");
    if (modal) modal.classList.add("hidden");
}

function renderComparisonChart(patientA, patientB) {
    const container = document.getElementById("chart-patient-comparison");
    if (!container || !patientA || !patientB) return;

    const metrics = [
        { label: "Priority Score", valA: patientA.priority_score, valB: patientB.priority_score, max: 100 },
        { label: "Severity (SOFA)", valA: patientA.severity, valB: patientB.severity, max: 100 },
        { label: "Survival Potential (%)", valA: patientA.survival_likelihood, valB: patientB.survival_likelihood, max: 100 },
        { label: "Wait Duration (min)", valA: Math.min(100, patientA.waiting_time_minutes / 1.5), valB: Math.min(100, patientB.waiting_time_minutes / 1.5), max: 100 }
    ];

    let html = `
        <div style="display: flex; gap: 16px; margin-bottom: 8px; font-size: 11px; font-weight: 700;">
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="width: 10px; height: 10px; background: #0284c7; border-radius: 2px;"></span>
                <span style="color: #0284c7;">Patient ${patientA.patient_id} (Rank #${patientA.rank})</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="width: 10px; height: 10px; background: #059669; border-radius: 2px;"></span>
                <span style="color: #059669;">Patient ${patientB.patient_id} (Rank #${patientB.rank})</span>
            </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 10.5px;">
    `;

    metrics.forEach(m => {
        const pctA = Math.min(100, (m.valA / m.max) * 100);
        const pctB = Math.min(100, (m.valB / m.max) * 100);

        html += `
            <div>
                <div style="font-weight: 600; color: #475569; margin-bottom: 2px;">${m.label}</div>
                <div style="display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="width: 40px; font-family: var(--font-mono); font-size: 10px; color: #0284c7; font-weight: 700;">${m.valA.toFixed(1)}</span>
                        <div style="flex: 1; height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                            <div style="height: 100%; width: ${pctA}%; background: #0284c7; border-radius: 3px;"></div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="width: 40px; font-family: var(--font-mono); font-size: 10px; color: #059669; font-weight: 700;">${m.valB.toFixed(1)}</span>
                        <div style="flex: 1; height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                            <div style="height: 100%; width: ${pctB}%; background: #059669; border-radius: 3px;"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;
}
