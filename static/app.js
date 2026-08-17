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
    setupModalIntelTabs();
    setupV32Listeners();
    setupV33Listeners();
    setupV35Listeners();
    setupV36AttentionPanel();
    setupIntelligenceTabRouting();
    await fetchOverview();
    await fetchPatientsQueue();
    await fetchSideAuditEvents();
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

    if (openModal) {
        openPatientModal(patientId);
    }
};

window.openPatientModal = async function(patientId) {
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
// MODAL INTELLIGENCE TABS — switch between EXPLAIN / COMPARE / WHAT-IF / AUDIT
// ══════════════════════════════════════════════════════════════════════════════
function setupModalIntelTabs() {
    document.querySelectorAll(".intel-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            // Deactivate all
            document.querySelectorAll(".intel-tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".intel-modal-pane").forEach(p => p.classList.remove("active"));
            // Activate selected
            btn.classList.add("active");
            const pane = document.getElementById(`impane-${btn.dataset.imtab}`);
            if (pane) pane.classList.add("active");
            // Reset shared response panel on tab switch
            const resp = document.getElementById("v31-response-panel");
            const err  = document.getElementById("v31-error-panel");
            if (resp) resp.style.display = "none";
            if (err)  err.style.display  = "none";
        });
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// V3.2 — PATIENT COMPARISON
// ══════════════════════════════════════════════════════════════════════════════

// Current ranked queue cache for comparison
let cachedRankedQueue = [];

async function runComparison(pidA, pidB) {
    if (!pidA || !pidB) {
        showModalIntelResponse("INSUFFICIENT DATA FOR COMPARISON\n\nBoth patients must be present in the current queue.", "CareGrid Priority Engine");
        return;
    }
    showModalIntelResponse("Comparing patients…", "—");

    try {
        const res = await fetch("/api/intelligence/compare", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({patient_id_a: pidA, patient_id_b: pidB})
        });
        const data = await res.json();

        if (data.status === "success") {
            // Populate side-by-side display
            populateCompareDisplay(data);
            showModalIntelResponse(data.explanation, data.source);
        } else {
            showModalIntelError();
        }
    } catch (err) {
        console.error("V3.2 compare error:", err);
        showModalIntelError();
    }
}

function populateCompareDisplay(data) {
    const display = document.getElementById("v32-compare-display");
    const colA    = document.getElementById("v32-col-a");
    const colB    = document.getElementById("v32-col-b");
    const diffEl  = document.getElementById("v32-biggest-diff");
    if (!display || !colA || !colB) return;

    const renderCol = (p) => `
        <div class="v32-row"><span class="v32-row-label">Patient ID</span><span class="v32-row-val">${p.patient_id}</span></div>
        <div class="v32-row"><span class="v32-row-label">Rank</span><span class="v32-row-val">#${p.rank}</span></div>
        <div class="v32-row"><span class="v32-row-label">Priority Score</span><span class="v32-row-val">${p.priority_score}</span></div>
        <div class="v32-row"><span class="v32-row-label">Severity</span><span class="v32-row-val">${p.severity}</span></div>
        <div class="v32-row"><span class="v32-row-label">Survival</span><span class="v32-row-val">${p.survival_likelihood}%</span></div>
        <div class="v32-row"><span class="v32-row-label">Waiting</span><span class="v32-row-val">${p.waiting_time_minutes} min</span></div>
        <div class="v32-row"><span class="v32-row-label">Sev. Contribution</span><span class="v32-row-val">+${p.contributions.severity_contribution}</span></div>
        <div class="v32-row"><span class="v32-row-label">Surv. Contribution</span><span class="v32-row-val">+${p.contributions.survival_contribution}</span></div>
        <div class="v32-row"><span class="v32-row-label">Wait Contribution</span><span class="v32-row-val">+${p.contributions.waiting_contribution}</span></div>
    `;

    colA.innerHTML = renderCol(data.patient_a);
    colB.innerHTML = renderCol(data.patient_b);
    if (diffEl) {
        diffEl.innerHTML = `<strong>Largest Difference:</strong> ${data.biggest_diff_factor} &nbsp;|&nbsp; Score Gap: <strong>${data.score_difference} pts</strong>`;
    }
    display.style.display = "block";
}

function setupV32Listeners() {
    const btnAbove = document.getElementById("v32-btn-above");
    const btnBelow = document.getElementById("v32-btn-below");
    const btnAsk   = document.getElementById("v32-btn-ask");
    const freeIn   = document.getElementById("v32-free-input");

    if (btnAbove) {
        btnAbove.addEventListener("click", async () => {
            if (!selectedPatientId) return;
            // Find patient above in cached queue
            const idx = cachedRankedQueue.findIndex(p => p.patient_id === selectedPatientId);
            if (idx > 0) {
                await runComparison(selectedPatientId, cachedRankedQueue[idx - 1].patient_id);
            } else {
                showModalIntelResponse("This patient is already ranked #1 — no patient above.", "CareGrid Priority Engine");
            }
        });
    }

    if (btnBelow) {
        btnBelow.addEventListener("click", async () => {
            if (!selectedPatientId) return;
            const idx = cachedRankedQueue.findIndex(p => p.patient_id === selectedPatientId);
            if (idx >= 0 && idx < cachedRankedQueue.length - 1) {
                await runComparison(selectedPatientId, cachedRankedQueue[idx + 1].patient_id);
            } else {
                showModalIntelResponse("No patient below this rank in the current queue.", "CareGrid Priority Engine");
            }
        });
    }

    if (btnAsk && freeIn) {
        const doAsk = async () => {
            const q = freeIn.value.trim();
            if (!q || !selectedPatientId) return;
            // Extract any second patient ID from question
            const m = q.match(/P-?\d+/gi);
            const pidB = m ? m.find(id => id.toUpperCase() !== selectedPatientId.toUpperCase()) : null;
            const idx  = cachedRankedQueue.findIndex(p => p.patient_id === selectedPatientId);
            const compareTo = pidB || (idx > 0 ? cachedRankedQueue[idx - 1].patient_id : null)
                                   || (idx < cachedRankedQueue.length - 1 ? cachedRankedQueue[idx + 1].patient_id : null);
            if (compareTo) await runComparison(selectedPatientId, compareTo);
            else showModalIntelResponse("Could not identify a second patient to compare. Try 'Compare with patient above' or 'Compare with patient below'.", "CareGrid Intelligence");
        };
        btnAsk.addEventListener("click", doAsk);
        freeIn.addEventListener("keydown", e => { if (e.key === "Enter") doAsk(); });
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// V3.3 / V3.4 — WHAT-IF SIMULATION + BEFORE/AFTER
// ══════════════════════════════════════════════════════════════════════════════

async function runWhatIfScenario(action, patientId = null) {
    // Capture BEFORE state
    const beforeQueueRes = await fetch("/api/patients?limit=10");
    const beforeData     = await beforeQueueRes.json();
    const beforeQueue    = (beforeData.patients || []).slice(0, 5).map(p => ({
        patient_id: p.patient_id, rank: p.rank, priority_score: p.priority_score
    }));

    // Render BEFORE list immediately
    const beforeAfterEl = document.getElementById("v34-before-after");
    const beforeList    = document.getElementById("v34-before-list");
    if (beforeList) {
        beforeList.innerHTML = beforeQueue.map(p =>
            `<div>#${p.rank} &nbsp;${p.patient_id} &nbsp;<span style="color:#64748b;">${p.priority_score}</span></div>`
        ).join("");
    }

    showModalIntelResponse("Running simulation…", "—");

    try {
        // Run the simulation via existing engine
        const payload = {event_type: action};
        if (action === "advance_time") payload.minutes = 30;
        if (action === "severity_spike" && patientId) payload.patient_id = patientId;

        const simRes  = await fetch("/api/simulation/event", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload)
        });
        const simData = await simRes.json();

        if (!simData || simData.status === "error") {
            showModalIntelError();
            return;
        }

        // Capture AFTER state
        const afterQueueRes = await fetch("/api/patients?limit=10");
        const afterData     = await afterQueueRes.json();
        const afterQueue    = (afterData.patients || []).slice(0, 5).map(p => ({
            patient_id: p.patient_id, rank: p.rank, priority_score: p.priority_score
        }));

        // Render AFTER list
        const afterList = document.getElementById("v34-after-list");
        if (afterList) {
            afterList.innerHTML = afterQueue.map(p => {
                const was = beforeQueue.find(b => b.patient_id === p.patient_id);
                const arrow = !was ? '<span class="v34-new"> NEW</span>'
                            : p.rank < was.rank ? '<span class="v34-up"> ↑</span>'
                            : p.rank > was.rank ? '<span class="v34-down"> ↓</span>' : '';
                return `<div>#${p.rank} &nbsp;${p.patient_id} &nbsp;<span style="color:#64748b;">${p.priority_score}</span>${arrow}</div>`;
            }).join("");
        }

        // Change table
        renderChangeTable(beforeQueue, afterQueue, simData);

        if (beforeAfterEl) beforeAfterEl.style.display = "block";

        // Update "Last Simulation" badge in Intel tab
        const badge = document.getElementById("intel-last-sim-badge");
        if (badge) badge.textContent = action.replace(/_/g, " ").toUpperCase();

        // Get AI explanation via /api/intelligence/explain-simulation
        const explainRes = await fetch("/api/intelligence/explain-simulation", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({sim_result: simData, before_queue: beforeQueue})
        });
        const explainData = await explainRes.json();
        showModalIntelResponse(
            explainData.answer || "Simulation completed.",
            explainData.source || "CareGrid Simulation Engine"
        );

        // Refresh main queue display
        await fetchPatientsQueue();
        await fetchSideAuditEvents();

    } catch (err) {
        console.error("V3.3 what-if error:", err);
        showModalIntelError();
    }
}

function renderChangeTable(before, after, simData) {
    const el = document.getElementById("v34-change-table");
    if (!el) return;

    // Combine all patient IDs seen in before or after
    const allIds = [...new Set([...before.map(p => p.patient_id), ...after.map(p => p.patient_id)])];
    const rows = allIds.slice(0, 8).map(pid => {
        const b = before.find(p => p.patient_id === pid);
        const a = after.find(p => p.patient_id === pid);
        if (!b) return `<tr><td>${pid}</td><td>—</td><td>#${a.rank}</td><td class="v34-new">NEW</td></tr>`;
        if (!a) return `<tr><td>${pid}</td><td>#${b.rank}</td><td>—</td><td class="v34-down">REMOVED</td></tr>`;
        const change = b.rank - a.rank;
        const cls    = change > 0 ? "v34-up" : change < 0 ? "v34-down" : "";
        const label  = change > 0 ? `↑${change}` : change < 0 ? `↓${Math.abs(change)}` : "—";
        return `<tr><td>${pid}</td><td>#${b.rank} / ${b.priority_score}</td><td>#${a.rank} / ${a.priority_score}</td><td class="${cls}">${label}</td></tr>`;
    }).join("");

    el.innerHTML = `
        <table class="v34-change-table">
            <thead><tr><th>PATIENT</th><th>BEFORE</th><th>AFTER</th><th>CHANGE</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function setupV33Listeners() {
    const actions = {
        "v33-btn-new-critical": "new_critical_patient",
        "v33-btn-discharge":    "discharge_top",
        "v33-btn-advance":      "advance_time",
        "v33-btn-severity":     "severity_spike"
    };

    Object.entries(actions).forEach(([id, action]) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener("click", () => {
                const patientId = action === "severity_spike" ? selectedPatientId : null;
                runWhatIfScenario(action, patientId);
            });
        }
    });

    const freeIn = document.getElementById("v33-free-input");
    const runBtn = document.getElementById("v33-btn-ask");
    if (freeIn && runBtn) {
        const doRun = async () => {
            const q = freeIn.value.trim();
            if (!q) return;
            // Interpret via backend
            const res = await fetch("/api/intelligence/whatif", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({question: q, patient_id: selectedPatientId})
            });
            const data = await res.json();
            if (data.status === "ready") {
                const s = data.scenario;
                await runWhatIfScenario(s.action, s.patient_id || selectedPatientId);
            } else {
                showModalIntelResponse(data.message || "SIMULATION COULD NOT BE COMPLETED", "CareGrid Intelligence");
            }
        };
        runBtn.addEventListener("click", doRun);
        freeIn.addEventListener("keydown", e => { if (e.key === "Enter") doRun(); });
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// V3.5 — AUDIT INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function setupV35Listeners() {
    const btnRecent  = document.getElementById("v35-btn-recent");
    const btnPatient = document.getElementById("v35-btn-patient");

    if (btnRecent) {
        btnRecent.addEventListener("click", async () => {
            showModalIntelResponse("Loading audit summary…", "—");
            try {
                const res  = await fetch("/api/intelligence/audit-summary", {
                    method: "POST", headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({limit: 10})
                });
                const data = await res.json();
                showModalIntelResponse(data.answer || "AUDIT INFORMATION UNAVAILABLE", data.source || "CareGrid Audit Log");
            } catch (e) { showModalIntelError(); }
        });
    }

    if (btnPatient) {
        btnPatient.addEventListener("click", async () => {
            if (!selectedPatientId) {
                showModalIntelResponse("No patient selected.", "CareGrid Audit Log");
                return;
            }
            showModalIntelResponse(`Loading audit events for ${selectedPatientId}…`, "—");
            try {
                const res  = await fetch("/api/intelligence/audit-summary", {
                    method: "POST", headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({patient_id: selectedPatientId, limit: 10})
                });
                const data = await res.json();
                showModalIntelResponse(data.answer || "AUDIT INFORMATION UNAVAILABLE", data.source || "CareGrid Audit Log");
            } catch (e) { showModalIntelError(); }
        });
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// V3.6 — ATTENTION REQUIRED PANEL
// ══════════════════════════════════════════════════════════════════════════════

function setupV36AttentionPanel() {
    const refreshBtn = document.getElementById("btn-refresh-attention");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", loadAttentionSignals);
    }
    // Load when Intelligence tab is opened
    document.querySelectorAll(".nav-item").forEach(item => {
        if (item.dataset.tab === "intelligence") {
            item.addEventListener("click", loadAttentionSignals);
        }
    });
}

async function loadAttentionSignals() {
    const container = document.getElementById("attention-signals-container");
    if (!container) return;
    container.innerHTML = `<p style="font-size: 12px; color: var(--text-secondary);">Scanning CareGrid state for attention signals...</p>`;
    try {
        const res  = await fetch("/api/intelligence/attention");
        const data = await res.json();

        if (data.status !== "success") {
            container.innerHTML = `<p style="font-size:12px; color:var(--text-muted);">ATTENTION SIGNALS UNAVAILABLE</p>`;
            return;
        }

        if (!data.signals || data.signals.length === 0) {
            container.innerHTML = `<div class="attention-no-signals">NO SIGNIFICANT ATTENTION SIGNALS — Queue operating within normal parameters</div>`;
            return;
        }

        const typeLabels = {
            near_tie:              "NEAR TIE",
            major_rank_change:     "MAJOR RANK CHANGE",
            waiting_time_attention:"WAITING-TIME ATTENTION",
            critical_queue_load:   "CRITICAL QUEUE LOAD"
        };

        container.innerHTML = data.signals.map((sig, idx) => `
            <div class="attention-signal-card severity-${sig.severity}" id="attention-sig-${idx}">
                <div class="attention-signal-type">${typeLabels[sig.type] || sig.type}</div>
                <div class="attention-signal-msg">${sig.message}</div>
                <div class="attention-signal-footer">
                    <span style="font-size:10px; color:var(--text-muted);">SOURCE: CareGrid Current State</span>
                    <button class="v31-action-btn" style="padding:4px 10px; font-size:9px;"
                        onclick="explainSignal(${idx})">WHY IS THIS FLAGGED?</button>
                </div>
                <div class="attention-explain-response" id="attention-explain-${idx}" style="display:none; margin-top:8px; font-size:11px; font-family:var(--font-mono); color:#1e293b; white-space:pre-wrap; background:#fff; padding:8px; border-radius:6px; border:1px solid #e2e8f0;"></div>
            </div>
        `).join("");

        // Store signals for explain
        window._attentionSignals = data.signals;

    } catch (err) {
        console.error("Attention signals error:", err);
        container.innerHTML = `<p style="font-size:12px; color:var(--text-muted);">ATTENTION SIGNALS UNAVAILABLE</p>`;
    }
}

async function explainSignal(idx) {
    if (!window._attentionSignals || !window._attentionSignals[idx]) return;
    const signal     = window._attentionSignals[idx];
    const responseEl = document.getElementById(`attention-explain-${idx}`);
    if (!responseEl) return;

    responseEl.style.display = "block";
    responseEl.textContent = "Querying CareGrid Intelligence…";

    try {
        const res  = await fetch("/api/intelligence/explain-signal", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({signal})
        });
        const data = await res.json();
        responseEl.textContent = data.answer || "INTELLIGENCE UNAVAILABLE";
    } catch (err) {
        responseEl.textContent = "CAREGRID INTELLIGENCE TEMPORARILY UNAVAILABLE";
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// INTELLIGENCE TAB — Route suggested questions 4-6 through V3.3/V3.5
// ══════════════════════════════════════════════════════════════════════════════

function setupIntelligenceTabRouting() {
    // btn-q4: What changed recently? → V3.5 audit summary
    const q4 = document.getElementById("btn-q4");
    if (q4) {
        q4.addEventListener("click", async () => {
            document.getElementById("intel-answer-text").textContent = "Loading audit summary…";
            try {
                const res  = await fetch("/api/intelligence/audit-summary", {
                    method: "POST", headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({limit: 10})
                });
                const data = await res.json();
                document.getElementById("intel-answer-text").textContent = data.answer || "AUDIT INFORMATION UNAVAILABLE";
                document.getElementById("intel-source-tag").textContent = `SOURCE: ${data.source || "CareGrid Audit Log"}`;
                document.getElementById("intel-evidence-box").style.display = "none";
            } catch (e) {
                document.getElementById("intel-answer-text").textContent = "AUDIT INFORMATION UNAVAILABLE";
            }
        });
    }

    // btn-q5: New critical patient → V3.3 whatif
    const q5 = document.getElementById("btn-q5");
    if (q5) {
        q5.addEventListener("click", async () => {
            const ansEl = document.getElementById("intel-answer-text");
            ansEl.textContent = "Interpreting scenario…";
            const res  = await fetch("/api/intelligence/whatif", {
                method: "POST", headers: {"Content-Type": "application/json"},
                body: JSON.stringify({question: "What happens if a new critical patient enters?"})
            });
            const data = await res.json();
            if (data.status === "ready") {
                ansEl.textContent = `Scenario: ${data.scenario.description}\n\nUse the patient detail WHAT-IF tab to run this simulation against the live CareGrid engine.`;
            } else {
                ansEl.textContent = data.message || "Scenario not supported.";
            }
            document.getElementById("intel-source-tag").textContent = "SOURCE: CareGrid Intelligence";
        });
    }

    // btn-q6: Discharge top patient → V3.3 whatif
    const q6 = document.getElementById("btn-q6");
    if (q6) {
        q6.addEventListener("click", async () => {
            const ansEl = document.getElementById("intel-answer-text");
            ansEl.textContent = "Interpreting scenario…";
            const res  = await fetch("/api/intelligence/whatif", {
                method: "POST", headers: {"Content-Type": "application/json"},
                body: JSON.stringify({question: "What happens if the top patient is discharged?"})
            });
            const data = await res.json();
            if (data.status === "ready") {
                ansEl.textContent = `Scenario: ${data.scenario.description}\n\nUse the patient detail WHAT-IF tab to run this simulation.`;
            } else {
                ansEl.textContent = data.message || "Scenario not supported.";
            }
            document.getElementById("intel-source-tag").textContent = "SOURCE: CareGrid Intelligence";
        });
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED MODAL RESPONSE HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function showModalIntelResponse(text, source) {
    const panel = document.getElementById("v31-response-panel");
    const textEl  = document.getElementById("v31-response-text");
    const sourceEl = document.getElementById("v31-response-source");
    const errEl  = document.getElementById("v31-error-panel");
    if (panel)  { panel.style.display = "block"; }
    if (textEl)   textEl.textContent   = text;
    if (sourceEl) sourceEl.textContent = source || "—";
    if (errEl)  errEl.style.display = "none";
}

function showModalIntelError() {
    const panel = document.getElementById("v31-response-panel");
    const errEl = document.getElementById("v31-error-panel");
    if (panel)  panel.style.display = "none";
    if (errEl)  errEl.style.display = "block";
}


