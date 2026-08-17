/* CareGrid V2 — Operational Dashboard Client Logic */

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

let currentPatients = [];
let selectedPatientId = null;

async function initApp() {
    setupTabNavigation();
    setupEventListeners();
    setupModalListeners();
    await fetchOverview();
    await fetchPatientsQueue();
}

function setupTabNavigation() {
    const tabs = document.querySelectorAll(".nav-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", async () => {
            tabs.forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));

            tab.classList.add("active");
            const targetId = `pane-${tab.dataset.tab}`;
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.classList.add("active");

            if (tab.dataset.tab === "audit") {
                await fetchAuditTimeline();
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
    const btnRefresh = document.getElementById("btn-refresh-queue");
    if (btnRefresh) {
        btnRefresh.addEventListener("click", async () => {
            await fetchOverview();
            await fetchPatientsQueue();
        });
    }

    // Simulation controls
    setupSimAction("sim-act-critical", "new_critical_patient");
    setupSimAction("sim-act-spike", "severity_spike");
    setupSimAction("sim-act-advance", "advance_time");
    setupSimAction("sim-act-discharge", "discharge_top");
    setupSimAction("sim-act-reset", "reset");

    // Slider sync
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
            document.getElementById("strip-total-patients").textContent = data.total_patients.toLocaleString();
            document.getElementById("strip-bed-capacity").textContent = `${data.occupied_beds} / ${data.total_beds}`;
            document.getElementById("strip-available-beds").textContent = `${data.available_beds} Beds Available`;
            
            const w = data.weights || {};
            const wText = `${Math.round((w.weight_severity||0.5)*100)}% Severity · ${Math.round((w.weight_survival||0.3)*100)}% Survival · ${Math.round((w.weight_waiting||0.2)*100)}% Wait`;
            document.getElementById("header-weights-summary").textContent = wText;
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
            renderQueueTable(currentPatients);

            if (!selectedPatientId && currentPatients.length > 0) {
                selectedPatientId = currentPatients[0].patient_id;
            }
            if (selectedPatientId) {
                selectPatientRow(selectedPatientId, false);
            }
        }
    } catch (err) {
        console.error("Queue fetch failed:", err);
        tbody.innerHTML = `<tr><td colspan="8" class="loading-state">Error loading dataset. Ensure backend server is running.</td></tr>`;
    }
}

function renderQueueTable(patients) {
    const tbody = document.getElementById("ops-queue-body");
    if (!patients || patients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="loading-state">No patients in queue.</td></tr>`;
        return;
    }

    tbody.innerHTML = patients.map(p => {
        const isSelected = p.patient_id === selectedPatientId ? "selected-row" : "";
        const rankClass = p.rank <= 3 ? "col-rank top-rank" : "col-rank";
        const statusBadgeClass = p.patient_status === "Critical" ? "status-badge critical" :
                                 p.patient_status === "Admitted" ? "status-badge admitted" : "status-badge waiting";

        return `
            <tr class="${isSelected}" onclick="selectPatientRow('${p.patient_id}', true)" id="p-row-${p.patient_id}">
                <td class="${rankClass}">#${p.rank}</td>
                <td class="col-patient">${p.patient_id}</td>
                <td class="col-score">${p.priority_score.toFixed(1)}</td>
                <td>${p.severity}</td>
                <td>${p.survival_likelihood}%</td>
                <td>${p.waiting_time_minutes} min</td>
                <td><span class="${statusBadgeClass}">${p.patient_status}</span></td>
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

    // Render Right Panel
    document.getElementById("panel-patient-id").textContent = `PATIENT ${patient.patient_id}`;
    document.getElementById("panel-rank-badge").textContent = `RANK #${patient.rank}`;
    document.getElementById("panel-score").textContent = patient.priority_score.toFixed(1);
    document.getElementById("panel-status").textContent = patient.patient_status;

    const delta = patient.rank_delta || 0;
    const movementText = delta > 0 ? `↑ ${delta} positions` :
                         delta < 0 ? `↓ ${Math.abs(delta)} positions` : `-- Stable`;
    document.getElementById("panel-rank-movement").textContent = movementText;

    document.getElementById("panel-sev-val").textContent = patient.severity;
    document.getElementById("bar-fill-sev").style.width = `${Math.min(100, patient.severity)}%`;
    document.getElementById("panel-sofa-raw").textContent = `SOFA Raw: ${patient.sofa_score} · clamp(SOFA/20*100, 0, 100)`;

    document.getElementById("panel-surv-val").textContent = `${patient.survival_likelihood}%`;
    document.getElementById("bar-fill-surv").style.width = `${Math.min(100, patient.survival_likelihood)}%`;

    document.getElementById("panel-wait-val").textContent = `${patient.waiting_time_minutes} min`;
    const waitPct = Math.min(100, (patient.waiting_time_minutes / 120.0) * 100);
    document.getElementById("bar-fill-wait").style.width = `${waitPct}%`;

    const ptsSev = patient.severity_contribution || (patient.severity * 0.5);
    const ptsSurv = patient.survival_contribution || (patient.survival_likelihood * 0.3);
    const ptsWait = patient.waiting_contribution || (waitPct * 0.2);

    document.getElementById("panel-pts-sev").textContent = `+${ptsSev.toFixed(1)} pts`;
    document.getElementById("bfill-sev").style.width = `${Math.min(100, (ptsSev / 50.0) * 100)}%`;

    document.getElementById("panel-pts-surv").textContent = `+${ptsSurv.toFixed(1)} pts`;
    document.getElementById("bfill-surv").style.width = `${Math.min(100, (ptsSurv / 30.0) * 100)}%`;

    document.getElementById("panel-pts-wait").textContent = `+${ptsWait.toFixed(1)} pts`;
    document.getElementById("bfill-wait").style.width = `${Math.min(100, (ptsWait / 20.0) * 100)}%`;

    try {
        const expRes = await fetch(`/api/explain/${patient.patient_id}`);
        const expData = await expRes.json();
        if (expData.status === "success") {
            const exp = expData.explainability;
            document.getElementById("panel-explain-text").textContent = exp.explanation_text;
            document.getElementById("panel-tiebreak-rule").textContent = exp.tie_broken ?
                `Tie-break Applied: ${exp.tie_break_rule}` : "Standard Score Ranking";
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
    document.getElementById("modal-rank").textContent = `#${patient.rank}`;
    document.getElementById("modal-priority-score").textContent = patient.priority_score.toFixed(1);
    document.getElementById("modal-status").textContent = patient.patient_status;

    const waitPct = Math.min(100, (patient.waiting_time_minutes / 120.0) * 100);
    const ptsSev = patient.severity_contribution || (patient.severity * 0.5);
    const ptsSurv = patient.survival_contribution || (patient.survival_likelihood * 0.3);
    const ptsWait = patient.waiting_contribution || (waitPct * 0.2);

    document.getElementById("modal-pts-sev").textContent = `+${ptsSev.toFixed(1)} pts`;
    document.getElementById("mbfill-sev").style.width = `${Math.min(100, (ptsSev / 50.0) * 100)}%`;

    document.getElementById("modal-pts-surv").textContent = `+${ptsSurv.toFixed(1)} pts`;
    document.getElementById("mbfill-surv").style.width = `${Math.min(100, (ptsSurv / 30.0) * 100)}%`;

    document.getElementById("modal-pts-wait").textContent = `+${ptsWait.toFixed(1)} pts`;
    document.getElementById("mbfill-wait").style.width = `${Math.min(100, (ptsWait / 20.0) * 100)}%`;

    // Fetch Explainability Text
    try {
        const expRes = await fetch(`/api/explain/${patient.patient_id}`);
        const expData = await expRes.json();
        if (expData.status === "success") {
            const exp = expData.explainability;
            document.getElementById("modal-explain-text").textContent = exp.explanation_text;
            document.getElementById("modal-tiebreak-rule").textContent = exp.tie_broken ?
                `Tie-break Applied: ${exp.tie_break_rule}` : "Standard Score Ranking";
        }
    } catch (err) {
        console.error("Modal explainability error:", err);
    }

    // Render raw clinical parameters
    const rawContainer = document.getElementById("modal-raw-params");
    const raw = patient.raw_clinical_params || {};
    rawContainer.innerHTML = `
        <div class="p-item"><span class="p-label">SOFA Score</span> <span class="badge source">${patient.sofa_score}</span></div>
        <div class="p-item"><span class="p-label">SAPS-I Score</span> <span class="badge source">${raw.SAPS_first || '14'}</span></div>
        <div class="p-item"><span class="p-label">GCS (Glasgow Coma)</span> <span class="badge source">${raw.GCS_first || '15'}</span></div>
        <div class="p-item"><span class="p-label">Heart Rate (HR)</span> <span class="badge source">${raw.HR_first || '88'} bpm</span></div>
        <div class="p-item"><span class="p-label">Mean Arterial BP</span> <span class="badge source">${raw.MAP_first || '75'} mmHg</span></div>
        <div class="p-item"><span class="p-label">Creatinine</span> <span class="badge source">${raw.Creatinine_first || '1.1'} mg/dL</span></div>
        <div class="p-item"><span class="p-label">WBC Count</span> <span class="badge source">${raw.WBC_first || '9.4'} k/uL</span></div>
        <div class="p-item"><span class="p-label">Arrival Date</span> <span class="badge source">${patient.arrival_time || '2025-03-16'}</span></div>
    `;

    modal.classList.remove("hidden");
};

function renderSimResults(data) {
    const container = document.getElementById("sim-output-container");
    const evt = data.audit_event || {};
    const movedUp = data.moved_up || [];
    const movedDown = data.moved_down || [];

    container.innerHTML = `
        <div style="font-family: var(--font-mono); font-size: 12px; margin-bottom: 14px;">
            <span class="badge source">${evt.event_type || 'SIMULATION_EVENT'}</span>
            <span style="color: var(--accent-green); margin-left: 8px;">${evt.reason || 'Event processed'}</span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div>
                <span class="section-eyebrow" style="color: var(--accent-green);">MOVED UP IN RANK (${movedUp.length})</span>
                ${movedUp.length === 0 ? '<p class="text-muted" style="font-size:12px;">None</p>' : movedUp.slice(0, 5).map(m => `
                    <div style="font-family: var(--font-mono); font-size: 12px; padding: 4px 0; border-bottom: 1px solid var(--card-border);">
                        ${m.patient_id}: #${m.previous_rank} → <span style="color: var(--accent-green);">#${m.new_rank}</span> (+${m.rank_delta})
                    </div>
                `).join('')}
            </div>
            <div>
                <span class="section-eyebrow" style="color: var(--status-warning);">MOVED DOWN IN RANK (${movedDown.length})</span>
                ${movedDown.length === 0 ? '<p class="text-muted" style="font-size:12px;">None</p>' : movedDown.slice(0, 5).map(m => `
                    <div style="font-family: var(--font-mono); font-size: 12px; padding: 4px 0; border-bottom: 1px solid var(--card-border);">
                        ${m.patient_id}: #${m.previous_rank} → <span style="color: var(--status-warning);">#${m.new_rank}</span> (${m.rank_delta})
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
                container.innerHTML = `<p class="loading-state">No audit events recorded yet.</p>`;
                return;
            }

            container.innerHTML = events.map(evt => `
                <div class="timeline-item">
                    <div>
                        <span class="timeline-time">${evt.timestamp.split('T')[1].split('.')[0]}</span>
                        <span class="badge source" style="margin-left: 10px;">${evt.event_type}</span>
                        <div class="timeline-event" style="margin-top: 4px;">
                            ${evt.patient_id ? `Patient ${evt.patient_id}` : 'System Action'}
                            ${evt.previous_rank ? `<span style="color: var(--accent-green); font-family: var(--font-mono); margin-left: 8px;">#${evt.previous_rank} → #${evt.new_rank}</span>` : ''}
                        </div>
                        <div class="timeline-reason">${evt.reason}</div>
                    </div>
                    <div>
                        <span class="badge derived">${evt.source}</span>
                    </div>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error("Audit timeline fetch failed:", err);
    }
}
