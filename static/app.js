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
    setupAttentionConfigListeners();
    await fetchOverview();
    await fetchPatientsQueue();
    await fetchSideAuditEvents();
    await fetchMajorRankChanges();
    await fetchAttentionConfig();
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

    const btnOpenWhatIf = document.getElementById("btn-open-whatif");
    if (btnOpenWhatIf) {
        btnOpenWhatIf.addEventListener("click", () => openWhatIfModal());
    }

    const mRunWhatIf = document.getElementById("mwhatif-btn-run");
    if (mRunWhatIf) {
        mRunWhatIf.addEventListener("click", runModalWhatIfSimulation);
    }

    const mResetWhatIf = document.getElementById("mwhatif-btn-reset");
    if (mResetWhatIf) {
        mResetWhatIf.addEventListener("click", resetModalWhatIfReport);
    }

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
            const targetId = selectedPatientId || (currentPatients && currentPatients.length > 0 ? currentPatients[0].patient_id : null);
            if (targetId) {
                openPatientModal(targetId);
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
                <td><button class="btn-ops" onclick="event.stopPropagation(); selectPatientRow('${p.patient_id}', true);">VIEW</button></td>
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
    
    const panelStatusBadge = document.getElementById("panel-status-badge");
    if (panelStatusBadge) {
        panelStatusBadge.textContent = `● ${patient.patient_status.toUpperCase()}`;
        panelStatusBadge.className = patient.patient_status === "Critical" ? "status-badge critical" :
                                      patient.patient_status === "Admitted" ? "status-badge admitted" :
                                      patient.patient_status === "Discharged" ? "status-badge warning" : "status-badge waiting";
    }

    const ptabWhy = document.getElementById("ptab-explanation");
    if (ptabWhy) ptabWhy.textContent = patient.patient_status === "Discharged" ? "WHY DISCHARGED" : (patient.rank ? `WHY #${patient.rank}` : "WHY EXPLANATION");

    renderRightPanelTabContent(currentPanelSubTab);

    if (openModal) {
        openPatientModal(patientId);
    }
};

window.openPatientModal = async function(patientId) {
    const targetId = patientId || selectedPatientId || (currentPatients && currentPatients.length > 0 ? currentPatients[0].patient_id : null);
    if (!targetId) return;
    selectedPatientId = targetId;

    const modal = document.getElementById("patient-detail-modal");
    if (!modal) return;

    let patient = currentPatients ? currentPatients.find(p => p.patient_id === targetId || p.record_id === targetId) : null;
    if (!patient) {
        try {
            const res = await fetch(`/api/patients/${targetId}`);
            const data = await res.json();
            if (data.status === "success") patient = data.patient;
        } catch (err) {
            console.error("Fetch patient modal details failed:", err);
        }
    }

    if (!patient) return;

    const modalTitle = document.getElementById("modal-patient-id");
    if (modalTitle) modalTitle.textContent = `PATIENT ${patient.patient_id}`;

    const mtabWhy = document.getElementById("mtab-why");
    if (mtabWhy) mtabWhy.textContent = `WHY #${patient.rank}`;

    const btnWhyRanked = document.getElementById("v31-btn-why-ranked");
    if (btnWhyRanked) btnWhyRanked.textContent = `WHY IS THIS PATIENT RANKED #${patient.rank}?`;

    const btnWhyNot1 = document.getElementById("v31-btn-why-not-1");
    if (btnWhyNot1) {
        btnWhyNot1.textContent = patient.rank === 1 ? `WHY IS THIS PATIENT RANKED #1?` : `WHY IS THIS PATIENT NOT #1?`;
    }

    const statusBadge = document.getElementById("modal-status-badge");
    if (statusBadge) {
        statusBadge.textContent = `● ${patient.patient_status.toUpperCase()}`;
        statusBadge.className = patient.patient_status === "Critical" ? "status-badge critical" :
                               patient.patient_status === "Admitted" ? "status-badge admitted" : "status-badge waiting";
    }

    renderModalSubTabContent(currentModalSubTab);
    loadPatientIntelligence(patient.patient_id);
    populateV31Breakdown(patient);
    fetchPatientAuditHistory(patient.patient_id);

    const respPanel = document.getElementById("v31-response-panel");
    const errPanel  = document.getElementById("v31-error-panel");
    if (respPanel) respPanel.style.display = "none";
    if (errPanel)  errPanel.style.display  = "none";

    modal.classList.remove("hidden");
};

window.inspectPatient = function(patientId) {
    openPatientModal(patientId);
};

window.openPatientProfile = function(patientId) {
    openPatientModal(patientId);
};

function loadPatientIntelligence(patientId) {
    const respPanel = document.getElementById("v31-response-panel");
    const errPanel  = document.getElementById("v31-error-panel");
    if (respPanel) respPanel.style.display = "none";
    if (errPanel)  errPanel.style.display  = "none";
}

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

function showAttentionConfigMsg(msg, isError = false) {
    const el = document.getElementById("attention-config-msg");
    if (!el) return;
    el.style.display = "block";
    if (isError) {
        el.style.background = "#fef2f2";
        el.style.color = "#dc2626";
        el.style.border = "1px solid #fecaca";
    } else {
        el.style.background = "#f0fdf4";
        el.style.color = "#166534";
        el.style.border = "1px solid #bbf7d0";
    }
    el.textContent = msg;
}

async function fetchAttentionConfig() {
    try {
        const res = await fetch("/api/attention/config");
        const data = await res.json();
        if (data.status === "success" && data.config) {
            const cfg = data.config;
            if (document.getElementById("cfg-near-tie")) document.getElementById("cfg-near-tie").value = cfg.near_tie_threshold;
            if (document.getElementById("cfg-crit-sev")) document.getElementById("cfg-crit-sev").value = cfg.critical_severity_threshold;
            if (document.getElementById("cfg-crit-load")) document.getElementById("cfg-crit-load").value = cfg.critical_queue_load_threshold;
            if (document.getElementById("cfg-wait-time")) document.getElementById("cfg-wait-time").value = cfg.waiting_time_threshold;
            if (document.getElementById("cfg-rank-change")) document.getElementById("cfg-rank-change").value = cfg.major_rank_change_threshold;
        }
    } catch (err) {
        console.error("Fetch attention config failed:", err);
    }
}

async function applyAttentionConfig() {
    const nearTieEl = document.getElementById("cfg-near-tie");
    const critSevEl = document.getElementById("cfg-crit-sev");
    const critLoadEl = document.getElementById("cfg-crit-load");
    const waitTimeEl = document.getElementById("cfg-wait-time");
    const rankChangeEl = document.getElementById("cfg-rank-change");

    const nearTie = parseFloat(nearTieEl ? nearTieEl.value : "1.0");
    const critSev = parseFloat(critSevEl ? critSevEl.value : "70.0");
    const critLoad = parseInt(critLoadEl ? critLoadEl.value : "5", 10);
    const waitTime = parseInt(waitTimeEl ? waitTimeEl.value : "120", 10);
    const rankChange = parseInt(rankChangeEl ? rankChangeEl.value : "2", 10);

    // Validation
    if (isNaN(nearTie) || nearTie < 0) {
        showAttentionConfigMsg("Validation Error: Near-tie gap threshold cannot be negative.", true);
        return;
    }
    if (isNaN(critSev) || critSev < 0 || critSev > 100) {
        showAttentionConfigMsg("Validation Error: Critical severity threshold must be between 0.0 and 100.0.", true);
        return;
    }
    if (isNaN(critLoad) || critLoad < 1) {
        showAttentionConfigMsg("Validation Error: Critical queue load threshold must be at least 1.", true);
        return;
    }
    if (isNaN(waitTime) || waitTime < 0) {
        showAttentionConfigMsg("Validation Error: Waiting time threshold cannot be negative.", true);
        return;
    }
    if (isNaN(rankChange) || rankChange < 1) {
        showAttentionConfigMsg("Validation Error: Major rank change threshold must be at least 1 position.", true);
        return;
    }

    try {
        const res = await fetch("/api/attention/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                near_tie_threshold: nearTie,
                critical_severity_threshold: critSev,
                critical_queue_load_threshold: critLoad,
                waiting_time_threshold: waitTime,
                major_rank_change_threshold: rankChange
            })
        });
        const data = await res.json();
        if (data.status === "success") {
            showAttentionConfigMsg("Attention Configuration operational policy applied successfully.", false);
            await fetchAttentionSignals();
            if (typeof fetchSideAuditEvents === "function") fetchSideAuditEvents();
        } else {
            showAttentionConfigMsg(`Configuration Error: ${data.message || "Failed to update thresholds"}`, true);
        }
    } catch (err) {
        showAttentionConfigMsg(`Network Error: ${err.message}`, true);
    }
}

async function resetAttentionConfig() {
    try {
        const res = await fetch("/api/attention/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reset: true })
        });
        const data = await res.json();
        if (data.status === "success" && data.config) {
            const cfg = data.config;
            if (document.getElementById("cfg-near-tie")) document.getElementById("cfg-near-tie").value = cfg.near_tie_threshold;
            if (document.getElementById("cfg-crit-sev")) document.getElementById("cfg-crit-sev").value = cfg.critical_severity_threshold;
            if (document.getElementById("cfg-crit-load")) document.getElementById("cfg-crit-load").value = cfg.critical_queue_load_threshold;
            if (document.getElementById("cfg-wait-time")) document.getElementById("cfg-wait-time").value = cfg.waiting_time_threshold;
            if (document.getElementById("cfg-rank-change")) document.getElementById("cfg-rank-change").value = cfg.major_rank_change_threshold;
            showAttentionConfigMsg("Attention Configuration operational policy reset to default baseline.", false);
            await fetchAttentionSignals();
            if (typeof fetchSideAuditEvents === "function") fetchSideAuditEvents();
        } else {
            showAttentionConfigMsg("Failed to reset configuration to defaults", true);
        }
    } catch (err) {
        showAttentionConfigMsg(`Network Error: ${err.message}`, true);
    }
}

function setupAttentionConfigListeners() {
    const btnToggle = document.getElementById("btn-toggle-attn-config");
    const panel = document.getElementById("attention-config-panel");
    const btnApply = document.getElementById("btn-apply-attn-config");
    const btnReset = document.getElementById("btn-reset-attn-config");

    if (btnToggle && panel) {
        btnToggle.onclick = () => {
            if (panel.style.display === "none" || !panel.style.display) {
                panel.style.display = "block";
                fetchAttentionConfig();
            } else {
                panel.style.display = "none";
            }
        };
    }
    if (btnApply) btnApply.onclick = applyAttentionConfig;
    if (btnReset) btnReset.onclick = resetAttentionConfig;
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

/* ============================================================
   CAREGRID V5.0 FULL CONTENT VIEW GENERATOR (OVERVIEW / BREAKDOWN / WHY #RANK)
   ============================================================ */

function generatePatientViewHTML(patient, mode, explanationText, aiAnswerText) {
    if (!patient) return "";

    const weights = { severity: 0.50, survival: 0.30, waiting: 0.20 };
    const sevContrib  = (patient.severity_contribution !== undefined) ? patient.severity_contribution : +(patient.severity * weights.severity).toFixed(1);
    const survContrib = (patient.survival_contribution !== undefined) ? patient.survival_contribution : +(patient.survival_likelihood * weights.survival).toFixed(1);
    const waitContrib = (patient.waiting_contribution !== undefined) ? patient.waiting_contribution : +(Math.min(100.0, patient.waiting_time_minutes / 1.2) * weights.waiting).toFixed(1);

    const isDischarged = patient.patient_status === "Discharged";
    const rankClass = isDischarged ? "status-badge warning" : (patient.rank === 1 ? "rank-badge rank-1" : patient.rank <= 3 ? "rank-badge rank-2" : "rank-badge rank-normal");
    const rankBadgeText = isDischarged ? "DISCHARGED / NO ACTIVE RANK" : (!patient.rank ? "NO ACTIVE RANK" : `RANK #${patient.rank}`);
    const delta = patient.rank_delta || 0;
    const deltaText = isDischarged ? "Excluded from Active Queue" : (delta > 0 ? `↑ ${delta} positions` : delta < 0 ? `↓ ${Math.abs(delta)} positions` : `-- Stable Position`);

    if (mode === "overview") {
        let rawParamsHtml = "";
        const raw = patient.parameters || patient.raw_clinical_params || {};
        const keys = ["sofa", "saps_i", "gcs", "map", "sao2", "creatinine", "wbc", "lactate", "urine_output", "sysabp"];
        rawParamsHtml = keys.map(k => {
            const val = raw[k] || raw[k.toUpperCase()] || raw[`${k}_first`];
            if (val === undefined || val === null) return "";
            const lbl = k.toUpperCase().replace("_", " ");
            return `
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; font-size: 11px;">
                    <div style="font-size: 9.5px; font-weight: 700; color: #64748b; text-transform: uppercase;">${lbl}</div>
                    <div style="font-size: 12px; font-weight: 800; color: #0f172a; font-family: var(--font-mono); margin-top: 2px;">${val}</div>
                </div>
            `;
        }).join("");

        return `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <!-- Hero Rank & Priority -->
                <div class="selected-patient-hero">
                    <div>
                        <span class="${rankClass}">${rankBadgeText}</span>
                        <div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-top: 4px;">${deltaText}</div>
                    </div>
                    <div class="hero-score-box">
                        <div class="hero-score-val">${patient.priority_score.toFixed(1)}</div>
                        <div class="hero-score-lbl">PRIORITY SCORE</div>
                    </div>
                </div>

                <!-- Clinical Indicators Bars -->
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px;">
                    <span class="sidebar-title" style="padding-left: 0; font-size: 10px; letter-spacing: 0.8px; display: block; margin-bottom: 8px;">CLINICAL INDICATORS</span>
                    <div class="metrics-bars-group">
                        <div class="metric-bar-item">
                            <div class="bar-header">
                                <span class="bar-title">Severity (SOFA Derived)</span>
                                <span class="bar-val">${patient.severity.toFixed(1)}</span>
                            </div>
                            <div class="bar-track"><div class="bar-fill" style="width: ${Math.min(100, patient.severity)}%;"></div></div>
                        </div>
                        <div class="metric-bar-item">
                            <div class="bar-header">
                                <span class="bar-title">Survival Likelihood</span>
                                <span class="bar-val">${patient.survival_likelihood.toFixed(1)}%</span>
                            </div>
                            <div class="bar-track"><div class="bar-fill" style="width: ${Math.min(100, patient.survival_likelihood)}%;"></div></div>
                        </div>
                        <div class="metric-bar-item">
                            <div class="bar-header">
                                <span class="bar-title">Waiting Duration</span>
                                <span class="bar-val">${patient.waiting_time_minutes} min</span>
                            </div>
                            <div class="bar-track"><div class="bar-fill" style="width: ${Math.min(100, patient.waiting_time_minutes / 1.2)}%;"></div></div>
                        </div>
                    </div>
                </div>

                <!-- Demographics & Status Snapshot -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; font-size: 11px;">
                    <span class="sidebar-title" style="padding-left: 0; font-size: 10px; letter-spacing: 0.8px; display: block; margin-bottom: 8px;">PATIENT CLINICAL SNAPSHOT</span>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div><span style="color: #64748b; font-weight: 600;">Record ID:</span> <strong style="color: #0f172a;">${patient.record_id || patient.patient_id}</strong></div>
                        <div><span style="color: #64748b; font-weight: 600;">Status:</span> <strong style="color: #0284c7;">${patient.patient_status || 'Waiting'}</strong></div>
                        <div><span style="color: #64748b; font-weight: 600;">Arrival Time:</span> <strong style="color: #0f172a;">${patient.arrival_time || '2025-08-17'}</strong></div>
                        <div><span style="color: #64748b; font-weight: 600;">Service Unit:</span> <strong style="color: #0f172a;">ICU Allocation</strong></div>
                    </div>
                </div>

                ${rawParamsHtml ? `
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px;">
                    <span class="sidebar-title" style="padding-left: 0; font-size: 10px; letter-spacing: 0.8px; display: block; margin-bottom: 8px;">RAW PHYSIOLOGICAL PARAMETERS</span>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px;">
                        ${rawParamsHtml}
                    </div>
                </div>` : ''}
            </div>
        `;
    } else if (mode === "breakdown") {
        const dominant = sevContrib >= survContrib && sevContrib >= waitContrib ? "Severity (SOFA)" :
                         survContrib >= waitContrib ? "Survival Likelihood" : "Waiting Duration";

        return `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <!-- Priority Score Card -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="font-size: 10px; font-weight: 800; letter-spacing: 0.8px; color: #64748b; text-transform: uppercase;">PRIORITY SCORE BREAKDOWN</span>
                        <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 2px;">${patient.priority_score.toFixed(1)} <span style="font-size: 11px; font-weight: 600; color: #64748b;">PTS TOTAL</span></div>
                        <div style="font-size: 11px; color: #0284c7; font-weight: 700; margin-top: 2px;">Dominant Driver: ${dominant}</div>
                    </div>
                    <span class="${rankClass}">${rankBadgeText}</span>
                </div>

                <!-- 3 Factor Contributions Grid -->
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 11px;">
                    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px;">
                        <div style="font-size: 9.5px; font-weight: 700; color: #64748b;">SEVERITY (50%)</div>
                        <div style="font-size: 16px; font-weight: 800; color: #0f172a; font-family: var(--font-mono); margin-top: 2px;">+${sevContrib.toFixed(1)}</div>
                        <div style="font-size: 9.5px; color: #475569; margin-top: 2px;">SOFA ${patient.sofa_score.toFixed(1)}</div>
                    </div>
                    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px;">
                        <div style="font-size: 9.5px; font-weight: 700; color: #64748b;">SURVIVAL (30%)</div>
                        <div style="font-size: 16px; font-weight: 800; color: #0f172a; font-family: var(--font-mono); margin-top: 2px;">+${survContrib.toFixed(1)}</div>
                        <div style="font-size: 9.5px; color: #475569; margin-top: 2px;">Prog ${patient.survival_likelihood.toFixed(1)}%</div>
                    </div>
                    <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px;">
                        <div style="font-size: 9.5px; font-weight: 700; color: #0284c7;">WAITING (20%)</div>
                        <div style="font-size: 16px; font-weight: 800; color: #0f172a; font-family: var(--font-mono); margin-top: 2px;">+${waitContrib.toFixed(1)}</div>
                        <div style="font-size: 9.5px; color: #475569; margin-top: 2px;">Wait ${patient.waiting_time_minutes}m</div>
                    </div>
                </div>

                <!-- Weighting Rules Table -->
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #475569; display: block; margin-bottom: 6px;">WEIGHTING ENGINE FORMULA</span>
                    <table style="width: 100%; border-collapse: collapse; font-size: 10.5px; text-align: left;">
                        <thead>
                            <tr style="border-bottom: 1px solid #e2e8f0; color: #64748b;">
                                <th style="padding: 4px 6px;">COMPONENT</th>
                                <th style="padding: 4px 6px;">WEIGHT</th>
                                <th style="padding: 4px 6px;">RAW METRIC</th>
                                <th style="padding: 4px 6px;">CONTRIBUTION</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 5px 6px; font-weight: 700;">Severity (SOFA)</td>
                                <td style="padding: 5px 6px; font-family: var(--font-mono);">50% (0.50)</td>
                                <td style="padding: 5px 6px; font-family: var(--font-mono);">${patient.severity.toFixed(1)} / 100</td>
                                <td style="padding: 5px 6px; font-family: var(--font-mono); font-weight: 700; color: #0f172a;">+${sevContrib.toFixed(1)} pts</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 5px 6px; font-weight: 700;">Prognostic Survival</td>
                                <td style="padding: 5px 6px; font-family: var(--font-mono);">30% (0.30)</td>
                                <td style="padding: 5px 6px; font-family: var(--font-mono);">${patient.survival_likelihood.toFixed(1)}%</td>
                                <td style="padding: 5px 6px; font-family: var(--font-mono); font-weight: 700; color: #0f172a;">+${survContrib.toFixed(1)} pts</td>
                            </tr>
                            <tr>
                                <td style="padding: 5px 6px; font-weight: 700;">Waiting Equity</td>
                                <td style="padding: 5px 6px; font-family: var(--font-mono);">20% (0.20)</td>
                                <td style="padding: 5px 6px; font-family: var(--font-mono);">${patient.waiting_time_minutes} min</td>
                                <td style="padding: 5px 6px; font-family: var(--font-mono); font-weight: 700; color: #0284c7;">+${waitContrib.toFixed(1)} pts</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } else if (mode === "why") {
        const text = explanationText || (isDischarged ?
            `Patient ${patient.patient_id} has been discharged from the ICU queue and holds no active queue rank position.` :
            `Patient ${patient.patient_id} holds Rank #${patient.rank} with a priority score of ${patient.priority_score.toFixed(1)} based on organ failure severity and waiting equity.`);
        const aiText = aiAnswerText ? `<div style="margin-top: 8px; padding: 8px 10px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; font-size: 11px; color: #0369a1;"><strong>CareGrid Intelligence:</strong><br>${aiAnswerText}</div>` : '';

        // Find next adjacent patient for comparison context
        const prevPatient = (currentPatients && patient.rank) ? currentPatients.find(p => p.rank === patient.rank - 1) : null;
        const nextPatient = (currentPatients && patient.rank) ? currentPatients.find(p => p.rank === patient.rank + 1) : null;

        let contextHtml = "";
        if (isDischarged) {
            contextHtml = `
                <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px; margin-top: 8px;">
                    <span style="font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #d97706; display: block; margin-bottom: 4px;">PATIENT STATUS CONTEXT</span>
                    <div style="font-size: 11px; color: #92400e; line-height: 1.4;">
                        Patient ${patient.patient_id} was discharged from active bed arbitration. They remain in system history for clinical auditing but do not occupy active queue capacity or rank position.
                    </div>
                </div>
            `;
        } else if (prevPatient || nextPatient) {
            contextHtml = `
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-top: 8px;">
                    <span style="font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b; display: block; margin-bottom: 4px;">QUEUE NEIGHBOR COMPARISON CONTEXT</span>
                    <div style="display: flex; flex-direction: column; gap: 4px; font-size: 10.5px;">
                        ${prevPatient ? `<div><span style="color: #64748b;">Rank #${prevPatient.rank} (${prevPatient.patient_id}):</span> <strong style="color: #0f172a;">${prevPatient.priority_score.toFixed(1)} pts</strong> (${(prevPatient.priority_score - patient.priority_score).toFixed(1)} pts above)</div>` : ''}
                        <div><span style="color: #0284c7; font-weight: 700;">Rank #${patient.rank} (${patient.patient_id}):</span> <strong style="color: #0284c7;">${patient.priority_score.toFixed(1)} pts (TARGET)</strong></div>
                        ${nextPatient ? `<div><span style="color: #64748b;">Rank #${nextPatient.rank} (${nextPatient.patient_id}):</span> <strong style="color: #0f172a;">${nextPatient.priority_score.toFixed(1)} pts</strong> (${(patient.priority_score - nextPatient.priority_score).toFixed(1)} pts margin)</div>` : ''}
                    </div>
                </div>
            `;
        }

        return `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <!-- Cockpit Rank Banner -->
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <span style="font-size: 10px; font-weight: 800; letter-spacing: 0.8px; color: #64748b; text-transform: uppercase;">GROUNDED RANKING JUSTIFICATION</span>
                        <div style="display: flex; align-items: baseline; gap: 8px; margin-top: 2px;">
                            <span style="font-size: ${isDischarged ? '16px' : '24px'}; font-weight: 800; color: ${isDischarged ? '#d97706' : '#0284c7'};">${isDischarged ? 'DISCHARGED' : '#' + patient.rank}</span>
                            <span style="font-size: 15px; font-weight: 800; color: #0f172a;">PATIENT ${patient.patient_id}</span>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-size: 10px; font-weight: 800; letter-spacing: 0.8px; color: #64748b; text-transform: uppercase;">PRIORITY SCORE</span>
                        <div style="font-size: 20px; font-weight: 800; color: #0f172a; font-family: var(--font-mono); margin-top: 2px;">${patient.priority_score.toFixed(1)}</div>
                    </div>
                </div>

                <!-- Grounded Narrative Card -->
                <div class="explain-card" style="margin-top: 0; background: #ffffff; border: 1px solid #e2e8f0; padding: 12px;">
                    <span class="explain-eyebrow">DETERMINISTIC STATUS EXPLANATION — ${isDischarged ? 'DISCHARGED' : 'RANK #' + patient.rank}</span>
                    <p class="explain-text" style="color: #1e293b; font-size: 12px; line-height: 1.5; margin-top: 4px;">${text}</p>
                    ${aiText}
                </div>

                ${contextHtml}
            </div>
        `;
    }
    return "";
}

async function renderRightPanelTabContent(tabMode) {
    if (!selectedPatientId) return;
    let patient = currentPatients.find(p => p.patient_id === selectedPatientId || p.record_id === selectedPatientId);
    if (!patient) return;

    const mode = tabMode || currentPanelSubTab || "overview";
    currentPanelSubTab = mode;

    // Update dynamic button label
    const ptabWhy = document.getElementById("ptab-explanation");
    if (ptabWhy) ptabWhy.textContent = `WHY #${patient.rank}`;

    const container = document.getElementById("panel-view-container");
    if (!container) return;

    let explainText = "";
    if (mode === "why") {
        try {
            const expRes = await fetch(`/api/explain/${patient.patient_id}`);
            const expData = await expRes.json();
            if (expData.status === "success") {
                explainText = expData.explainability.explanation_text;
            }
        } catch (err) {
            explainText = `Patient ${patient.patient_id} holds Rank #${patient.rank} with priority score ${patient.priority_score.toFixed(1)}.`;
        }
    }

    container.innerHTML = generatePatientViewHTML(patient, mode, explainText, "");
}

async function renderModalSubTabContent(tabMode) {
    if (!selectedPatientId) return;
    let patient = currentPatients.find(p => p.patient_id === selectedPatientId || p.record_id === selectedPatientId);
    if (!patient) return;

    const mode = tabMode || currentModalSubTab || "overview";
    currentModalSubTab = mode;

    // Update dynamic modal button label
    const mtabWhy = document.getElementById("mtab-why");
    if (mtabWhy) mtabWhy.textContent = `WHY #${patient.rank}`;

    const container = document.getElementById("modal-view-container");
    if (!container) return;

    let explainText = "";
    if (mode === "why") {
        try {
            const expRes = await fetch(`/api/explain/${patient.patient_id}`);
            const expData = await expRes.json();
            if (expData.status === "success") {
                explainText = expData.explainability.explanation_text;
            }
        } catch (err) {
            explainText = `Patient ${patient.patient_id} holds Rank #${patient.rank} with priority score ${patient.priority_score.toFixed(1)}.`;
        }
    }

    container.innerHTML = generatePatientViewHTML(patient, mode, explainText, "");
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
        { label: "Priority Score", valA: patientA.priority_score, valB: patientB.priority_score, max: 100, unit: "" },
        { label: "Severity (SOFA)", valA: patientA.severity, valB: patientB.severity, max: 100, unit: "" },
        { label: "Survival Potential (%)", valA: patientA.survival_likelihood, valB: patientB.survival_likelihood, max: 100, unit: "%" },
        { label: "Wait Duration (min)", valA: patientA.waiting_time_minutes, valB: patientB.waiting_time_minutes, max: 180, unit: "m" }
    ];

    let html = `
        <div style="display: flex; gap: 16px; margin-bottom: 10px; font-size: 11px; font-weight: 700;">
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="width: 10px; height: 10px; background: #0284c7; border-radius: 2px;"></span>
                <span style="color: #0284c7;">Patient ${patientA.patient_id} (Rank #${patientA.rank})</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="width: 10px; height: 10px; background: #059669; border-radius: 2px;"></span>
                <span style="color: #059669;">Patient ${patientB.patient_id} (Rank #${patientB.rank})</span>
            </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px; font-size: 10.5px;">
    `;

    metrics.forEach(m => {
        const pctA = Math.min(100, (m.valA / m.max) * 100);
        const pctB = Math.min(100, (m.valB / m.max) * 100);

        html += `
            <div>
                <div style="font-weight: 600; color: #475569; margin-bottom: 3px;">${m.label}</div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="width: 45px; font-family: var(--font-mono); font-size: 10px; color: #0284c7; font-weight: 700;">${m.valA.toFixed(0)}${m.unit}</span>
                        <div style="flex: 1; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                            <div style="height: 100%; width: ${pctA}%; background: #0284c7; border-radius: 3px;"></div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="width: 45px; font-family: var(--font-mono); font-size: 10px; color: #059669; font-weight: 700;">${m.valB.toFixed(0)}${m.unit}</span>
                        <div style="flex: 1; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
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

/* ============================================================
   CAREGRID V5.0 COMMAND CENTER DEDICATED WHAT-IF WORKSPACE MODAL
   ============================================================ */

function openWhatIfModal(pid) {
    const targetId = pid || selectedPatientId;
    if (!targetId || !currentPatients) return;

    const patient = currentPatients.find(p => p.patient_id === targetId || p.record_id === targetId);
    if (!patient) return;

    const modal = document.getElementById("patient-whatif-modal");
    if (!modal) return;

    document.getElementById("modal-whatif-title").textContent = `WHAT-IF SCENARIO: PATIENT ${patient.patient_id}`;
    document.getElementById("modal-whatif-target-pid").textContent = patient.patient_id;
    document.getElementById("modal-whatif-target-info").textContent = `Live Rank #${patient.rank} | Live Priority Score ${patient.priority_score.toFixed(1)}`;

    document.getElementById("mwhatif-cur-wait").textContent = `Live: ${patient.waiting_time_minutes}m`;
    document.getElementById("mwhatif-cur-sofa").textContent = `Live: SOFA ${patient.sofa_score.toFixed(1)}`;
    document.getElementById("mwhatif-cur-surv").textContent = `Live: ${patient.survival_likelihood.toFixed(1)}%`;

    document.getElementById("mwhatif-input-wait").value = "";
    document.getElementById("mwhatif-input-sofa").value = "";
    document.getElementById("mwhatif-input-surv").value = "";

    resetModalWhatIfReport();

    modal.classList.remove("hidden");
}

function closeWhatIfModal() {
    const modal = document.getElementById("patient-whatif-modal");
    if (modal) modal.classList.add("hidden");
}

async function runModalWhatIfSimulation() {
    const pidText = document.getElementById("modal-whatif-target-pid").textContent;
    const container = document.getElementById("mwhatif-output-container");
    if (!pidText || !container) return;

    const waitVal = document.getElementById("mwhatif-input-wait").value.trim();
    const sofaVal = document.getElementById("mwhatif-input-sofa").value.trim();
    const survVal = document.getElementById("mwhatif-input-surv").value.trim();

    const scenario_changes = {};
    if (waitVal !== "") scenario_changes.waiting_time_minutes = parseInt(waitVal);
    if (sofaVal !== "") scenario_changes.sofa_score = parseFloat(sofaVal);
    if (survVal !== "") scenario_changes.survival_likelihood = parseFloat(survVal);

    if (Object.keys(scenario_changes).length === 0) {
        container.innerHTML = `
            <div style="padding: 14px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; font-size: 12px; color: #92400e;">
                SCENARIO PARAMETER REQUIRED: Please enter at least one hypothetical factor (Waiting Time, SOFA Score, or Survival Likelihood) to run simulation.
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div style="text-align: center; padding: 25px; color: #64748b;">
            <div style="font-size: 13px; font-weight: 600;">Executing Isolated Sandbox What-If Simulation...</div>
        </div>
    `;

    try {
        const res = await fetch("/api/simulation/what-if", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                patient_id: pidText,
                scenario_changes: scenario_changes
            })
        });

        const data = await res.json();
        if (data.status === "success") {
            renderModalWhatIfReport(data);
        } else {
            container.innerHTML = `<div style="padding: 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 12px; color: #991b1b;">Error: ${data.message}</div>`;
        }
    } catch (err) {
        container.innerHTML = `<div style="padding: 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 12px; color: #991b1b;">Simulation Error: ${err.message}</div>`;
    }
}

function renderModalWhatIfReport(data) {
    const container = document.getElementById("mwhatif-output-container");
    if (!container || !data) return;

    const b = data.before_state;
    const a = data.after_state;
    const imp = data.impact_summary;

    const scoreSign = imp.score_delta >= 0 ? "+" : "";
    const rankColor = imp.rank_delta > 0 ? "#059669" : (imp.rank_delta < 0 ? "#d97706" : "#64748b");
    const rankShiftText = imp.rank_delta > 0 ? `+${imp.rank_delta} positions (UP)` : (imp.rank_delta < 0 ? `-${Math.abs(imp.rank_delta)} positions (DOWN)` : `UNCHANGED`);

    let eventsHtml = data.event_details.map(ev => `
        <div style="font-size: 11px; margin-bottom: 4px; color: #1e293b;">
            <strong>${ev.factor}:</strong> ${ev.before} → <span style="color: #0284c7; font-weight: 700;">${ev.after}</span> (${ev.change})
        </div>
    `).join("");

    let affectedRows = "";
    if (data.affected_rank_shifts && data.affected_rank_shifts.length > 0) {
        affectedRows = data.affected_rank_shifts.map(p => `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 10px; font-size: 11px; display: flex; justify-content: space-between;">
                <span style="font-weight: 700; color: #0f172a;">${p.patient_id}</span>
                <span style="font-family: var(--font-mono); font-weight: 700; color: ${p.before_rank > p.after_rank ? '#059669' : '#d97706'};">${p.rank_shift}</span>
            </div>
        `).join("");
    } else {
        affectedRows = `<div style="font-size: 11px; color: #64748b;">No other patients shifted queue position.</div>`;
    }

    const html = `
        <div style="display: flex; flex-direction: column; gap: 14px;">
            <!-- Sandbox Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; background: #0f172a; color: #ffffff; padding: 8px 14px; border-radius: 8px; font-size: 11px; font-weight: 700;">
                <span>SANDBOX ISOLATED SIMULATION REPORT</span>
                <span style="font-family: var(--font-mono); color: #94a3b8; font-weight: 400; font-size: 10px;">LIVE CAREGRID STATE UNCHANGED</span>
            </div>

            <!-- BEFORE -> EVENT -> AFTER 3-Column Grid -->
            <div style="display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 12px;">
                <!-- BEFORE -->
                <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px;">
                    <span style="font-size: 9.5px; font-weight: 800; letter-spacing: 0.6px; color: #64748b; text-transform: uppercase; display: block; margin-bottom: 6px;">BEFORE (LIVE STATE)</span>
                    <div style="font-size: 20px; font-weight: 800; color: #0f172a;">${b.priority_score.toFixed(1)} <span style="font-size: 11px; font-weight: 600; color: #64748b;">PRIORITY</span></div>
                    <div style="font-size: 12px; font-weight: 700; color: #0284c7; margin-bottom: 6px;">Rank #${b.rank}</div>
                    <div style="font-size: 11px; color: #475569; font-family: var(--font-mono);">
                        <div>SOFA: ${b.sofa_score.toFixed(1)} (Sev ${b.severity.toFixed(0)})</div>
                        <div>Survival: ${b.survival_likelihood.toFixed(0)}%</div>
                        <div>Wait: ${b.waiting_time_minutes}m</div>
                    </div>
                </div>

                <!-- EVENT -->
                <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px;">
                    <span style="font-size: 9.5px; font-weight: 800; letter-spacing: 0.6px; color: #0284c7; text-transform: uppercase; display: block; margin-bottom: 6px;">TESTED EVENT</span>
                    <div style="font-weight: 700; color: #0f172a; font-size: 12px; margin-bottom: 6px;">Scenario Changes</div>
                    ${eventsHtml}
                </div>

                <!-- AFTER -->
                <div style="background: #ffffff; border: 2px solid ${rankColor}; border-radius: 10px; padding: 12px;">
                    <span style="font-size: 9.5px; font-weight: 800; letter-spacing: 0.6px; color: ${rankColor}; text-transform: uppercase; display: block; margin-bottom: 6px;">AFTER (SIMULATED)</span>
                    <div style="font-size: 20px; font-weight: 800; color: #0f172a;">${a.priority_score.toFixed(1)} <span style="font-size: 11px; font-weight: 700; color: ${rankColor};">(${scoreSign}${imp.score_delta.toFixed(1)})</span></div>
                    <div style="font-size: 12px; font-weight: 700; color: ${rankColor}; margin-bottom: 6px;">Rank #${a.rank} (${rankShiftText})</div>
                    <div style="font-size: 11px; color: #475569; font-family: var(--font-mono);">
                        <div>SOFA: ${a.sofa_score.toFixed(1)} (Sev ${a.severity.toFixed(0)})</div>
                        <div>Survival: ${a.survival_likelihood.toFixed(0)}%</div>
                        <div>Wait: ${a.waiting_time_minutes}m</div>
                    </div>
                </div>
            </div>

            <!-- Comparison Table -->
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px;">
                <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #475569; display: block; margin-bottom: 8px;">LIVE VS SIMULATED METRIC COMPARISON</span>
                <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
                    <thead>
                        <tr style="border-bottom: 1px solid #e2e8f0; color: #64748b;">
                            <th style="padding: 4px 6px;">METRIC</th>
                            <th style="padding: 4px 6px;">LIVE STATE</th>
                            <th style="padding: 4px 6px;">SIMULATED STATE</th>
                            <th style="padding: 4px 6px;">NET CHANGE</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 6px; font-weight: 700;">Priority Score</td>
                            <td style="padding: 6px; font-family: var(--font-mono);">${b.priority_score.toFixed(1)}</td>
                            <td style="padding: 6px; font-family: var(--font-mono); font-weight: 700; color: #0284c7;">${a.priority_score.toFixed(1)}</td>
                            <td style="padding: 6px; font-family: var(--font-mono); font-weight: 700;">${scoreSign}${imp.score_delta.toFixed(1)} pts</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 6px; font-weight: 700;">Queue Rank</td>
                            <td style="padding: 6px; font-family: var(--font-mono);">Rank #${b.rank}</td>
                            <td style="padding: 6px; font-family: var(--font-mono); font-weight: 700; color: ${rankColor};">Rank #${a.rank}</td>
                            <td style="padding: 6px; font-family: var(--font-mono); font-weight: 700; color: ${rankColor};">${rankShiftText}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px; font-weight: 700;">Waiting Duration</td>
                            <td style="padding: 6px; font-family: var(--font-mono);">${b.waiting_time_minutes} min</td>
                            <td style="padding: 6px; font-family: var(--font-mono); font-weight: 700;">${a.waiting_time_minutes} min</td>
                            <td style="padding: 6px; font-family: var(--font-mono); font-weight: 700;">${a.waiting_time_minutes - b.waiting_time_minutes >= 0 ? '+' : ''}${a.waiting_time_minutes - b.waiting_time_minutes} min</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Priority Contribution Shift Breakdown -->
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px;">
                <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #475569; display: block; margin-bottom: 8px;">PRIORITY CONTRIBUTION SHIFT</span>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 11px;">
                    <div style="background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 6px; padding: 8px;">
                        <div style="color: #64748b; font-size: 10px; font-weight: 700;">SEVERITY (SOFA 50%)</div>
                        <div style="font-weight: 700; color: #0f172a; margin-top: 2px;">${b.severity_contribution.toFixed(1)} → ${a.severity_contribution.toFixed(1)} pts</div>
                        <div style="font-size: 10px; font-family: var(--font-mono); color: #0284c7;">Delta: ${(imp.factor_deltas.severity_contribution >= 0 ? '+' : '') + imp.factor_deltas.severity_contribution.toFixed(1)} pts</div>
                    </div>
                    <div style="background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 6px; padding: 8px;">
                        <div style="color: #64748b; font-size: 10px; font-weight: 700;">SURVIVAL (PROG 30%)</div>
                        <div style="font-weight: 700; color: #0f172a; margin-top: 2px;">${b.survival_contribution.toFixed(1)} → ${a.survival_contribution.toFixed(1)} pts</div>
                        <div style="font-size: 10px; font-family: var(--font-mono); color: #0284c7;">Delta: ${(imp.factor_deltas.survival_contribution >= 0 ? '+' : '') + imp.factor_deltas.survival_contribution.toFixed(1)} pts</div>
                    </div>
                    <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px;">
                        <div style="color: #0284c7; font-size: 10px; font-weight: 700;">WAIT EQUITY (20%)</div>
                        <div style="font-weight: 700; color: #0f172a; margin-top: 2px;">${b.waiting_contribution.toFixed(1)} → ${a.waiting_contribution.toFixed(1)} pts</div>
                        <div style="font-size: 10px; font-family: var(--font-mono); color: #0284c7; font-weight: 700;">Delta: ${(imp.factor_deltas.waiting_contribution >= 0 ? '+' : '') + imp.factor_deltas.waiting_contribution.toFixed(1)} pts [PRIMARY]</div>
                    </div>
                </div>
            </div>

            <!-- Affected Patient Movements -->
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px;">
                <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #475569; display: block; margin-bottom: 8px;">AFFECTED QUEUE PATIENT MOVEMENTS</span>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px;">
                    ${affectedRows}
                </div>
            </div>

            <!-- Deterministic Explanation -->
            <div class="explain-card" style="margin-top: 0; background: #ffffff; border: 1px solid #e2e8f0;">
                <span class="explain-eyebrow">DETERMINISTIC SIMULATION ANALYSIS</span>
                <p class="explain-text" style="color: #1e293b; font-size: 12px; line-height: 1.6;">${data.deterministic_explanation}</p>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

function resetModalWhatIfReport() {
    const inputWait = document.getElementById("mwhatif-input-wait");
    const inputSofa = document.getElementById("mwhatif-input-sofa");
    const inputSurv = document.getElementById("mwhatif-input-surv");
    const container = document.getElementById("mwhatif-output-container");

    if (inputWait) inputWait.value = "";
    if (inputSofa) inputSofa.value = "";
    if (inputSurv) inputSurv.value = "";

    if (container) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px 20px; color: #64748b;">
                <h4 style="font-size: 14px; font-weight: 700; color: #334155; margin-bottom: 4px;">What-If Scenario Simulation Workspace Reset</h4>
                <p style="font-size: 12px; max-width: 460px; margin: 0 auto;">Live CareGrid state baseline restored. Enter hypothetical parameters above and click "RUN WHAT-IF SIMULATION".</p>
            </div>
        `;
    }
}
