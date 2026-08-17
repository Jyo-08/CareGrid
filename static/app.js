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

        return `
            <tr class="${isSelected}" onclick="selectPatientRow('${p.patient_id}', true)" id="p-row-${p.patient_id}">
                <td><span class="${rankBadgeClass}">#${p.rank}</span></td>
                <td class="patient-id-cell">${p.patient_id}</td>
                <td class="score-cell">${p.priority_score.toFixed(1)}</td>
                <td>${p.severity}</td>
                <td>${p.survival_likelihood}%</td>
                <td>${p.waiting_time_minutes} min</td>
                <td><span class="${statusBadgeClass}">● ${p.patient_status.toUpperCase()}</span></td>
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
};

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
