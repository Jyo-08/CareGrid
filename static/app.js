/* CareGrid V2 Dashboard Client Logic */

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

let currentPatients = [];

async function initApp() {
    setupEventListeners();
    await fetchOverview();
    await fetchPatientsQueue();
}

function setupEventListeners() {
    const btnRefresh = document.getElementById("btn-refresh");
    if (btnRefresh) {
        btnRefresh.addEventListener("click", async () => {
            await fetchOverview();
            await fetchPatientsQueue();
        });
    }

    const btnCloseModal = document.getElementById("btn-close-modal");
    const modalOverlay = document.getElementById("patient-modal");
    if (btnCloseModal && modalOverlay) {
        btnCloseModal.addEventListener("click", () => modalOverlay.classList.add("hidden"));
        modalOverlay.addEventListener("click", (e) => {
            if (e.target === modalOverlay) modalOverlay.classList.add("hidden");
        });
    }

    // Audit Log Modal
    const btnAudit = document.getElementById("btn-view-audit");
    const auditModal = document.getElementById("audit-modal");
    const btnCloseAudit = document.getElementById("btn-close-audit");
    if (btnAudit && auditModal && btnCloseAudit) {
        btnAudit.addEventListener("click", async () => {
            await fetchAuditLogs();
            auditModal.classList.remove("hidden");
        });
        btnCloseAudit.addEventListener("click", () => auditModal.classList.add("hidden"));
        auditModal.addEventListener("click", (e) => {
            if (e.target === auditModal) auditModal.classList.add("hidden");
        });
    }

    // Simulation Scenario Buttons
    setupSimButton("sim-btn-critical", "new_critical_patient");
    setupSimButton("sim-btn-spike", "severity_spike");
    setupSimButton("sim-btn-advance", "advance_time");
    setupSimButton("sim-btn-discharge", "discharge_top");
    setupSimButton("sim-btn-reset", "reset");

    // Weight sliders input sync
    const sliders = ["sev", "surv", "wait"];
    sliders.forEach(key => {
        const input = document.getElementById(`weight-${key}`);
        const display = document.getElementById(`val-${key}`);
        if (input && display) {
            input.addEventListener("input", (e) => {
                display.textContent = parseFloat(e.target.value).toFixed(2);
            });
        }
    });

    const weightsForm = document.getElementById("weights-form");
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

function setupSimButton(buttonId, actionName) {
    const btn = document.getElementById(buttonId);
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
                await fetchOverview();
                await fetchPatientsQueue();
            }
        } catch (err) {
            console.error(`Simulation action ${actionName} failed:`, err);
        }
    });
}

async function fetchOverview() {
    try {
        const res = await fetch("/api/icu/overview");
        const data = await res.json();
        if (data.status === "success") {
            document.getElementById("metric-total-patients").textContent = data.total_patients;
            document.getElementById("metric-waiting-patients").textContent = data.waiting_patients;
            document.getElementById("metric-bed-capacity").textContent = `${data.occupied_beds} / ${data.total_beds}`;
            document.getElementById("metric-available-beds").textContent = `${data.available_beds} Beds Available`;
            document.getElementById("metric-critical-count").textContent = data.critical_patients;
        }
    } catch (err) {
        console.error("Failed to load overview:", err);
    }
}

async function fetchPatientsQueue() {
    const tbody = document.getElementById("queue-table-body");
    try {
        const res = await fetch("/api/patients?limit=50");
        const data = await res.json();
        if (data.status === "success") {
            currentPatients = data.patients;
            renderQueueTable(currentPatients);
        }
    } catch (err) {
        console.error("Failed to load patient queue:", err);
        tbody.innerHTML = `<tr><td colspan="8" class="loading-cell">Error loading data. Make sure server is running.</td></tr>`;
    }
}

function renderQueueTable(patients) {
    const tbody = document.getElementById("queue-table-body");
    if (!patients || patients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="loading-cell">No patients found.</td></tr>`;
        return;
    }

    tbody.innerHTML = patients.map(patient => {
        const rankClass = patient.rank <= 3 ? "rank-cell top-rank" : "rank-cell";
        const statusClass = patient.patient_status === "Critical" ? "status-critical" :
                            patient.patient_status === "Admitted" ? "status-admitted" : "status-waiting";

        return `
            <tr onclick="openPatientModal('${patient.patient_id}')">
                <td class="${rankClass}">#${patient.rank}</td>
                <td class="patient-id-cell">${patient.patient_id}</td>
                <td>${patient.severity}</td>
                <td>${patient.survival_likelihood}%</td>
                <td>${patient.waiting_time_minutes} min</td>
                <td class="score-cell">${patient.priority_score.toFixed(1)}</td>
                <td><span class="status-tag ${statusClass}">${patient.patient_status}</span></td>
                <td><button class="btn-secondary" onclick="event.stopPropagation(); openPatientModal('${patient.patient_id}')">View</button></td>
            </tr>
        `;
    }).join("");
}

async function fetchAuditLogs() {
    const tbody = document.getElementById("audit-table-body");
    try {
        const res = await fetch("/api/audit?limit=30");
        const data = await res.json();
        if (data.status === "success") {
            const events = data.audit_trail || [];
            if (events.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="loading-cell">No audit events recorded yet.</td></tr>`;
                return;
            }
            tbody.innerHTML = events.map(evt => `
                <tr>
                    <td style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-blue);">${evt.event_id}</td>
                    <td style="font-size: 11px; color: var(--text-muted);">${evt.timestamp.split('T')[1].split('.')[0]}</td>
                    <td><span class="badge source">${evt.event_type}</span></td>
                    <td style="font-family: var(--font-mono);">${evt.patient_id || "--"}</td>
                    <td style="font-family: var(--font-mono); color: var(--accent-amber);">${evt.previous_rank ? `#${evt.previous_rank} → #${evt.new_rank}` : "--"}</td>
                    <td style="font-size: 12px;">${evt.reason}</td>
                </tr>
            `).join("");
        }
    } catch (err) {
        console.error("Failed to load audit logs:", err);
    }
}

window.openPatientModal = async function(patientId) {
    let patient = currentPatients.find(p => p.patient_id === patientId || p.record_id === patientId);
    if (!patient) {
        try {
            const res = await fetch(`/api/patients/${patientId}`);
            const data = await res.json();
            if (data.status === "success") patient = data.patient;
        } catch (err) {
            console.error("Failed to fetch detail:", err);
            return;
        }
    }

    if (!patient) return;

    // Fetch explainability text
    try {
        const expRes = await fetch(`/api/explain/${patient.patient_id}`);
        const expData = await expRes.json();
        if (expData.status === "success") {
            const exp = expData.explainability;
            document.getElementById("modal-explanation-text").textContent = exp.explanation_text;
            document.getElementById("modal-tiebreak-info").textContent = exp.tie_broken ?
                `Tie-break Applied: ${exp.tie_break_rule}` : "Standard Score Ranking";
        }
    } catch (err) {
        console.error("Explainability fetch failed:", err);
    }

    document.getElementById("modal-patient-id").textContent = `Patient ${patient.patient_id}`;
    document.getElementById("modal-patient-rank").textContent = `Rank #${patient.rank}`;
    document.getElementById("modal-name").textContent = patient.name;
    document.getElementById("modal-status").textContent = patient.patient_status;
    document.getElementById("modal-arrival").textContent = patient.arrival_time;
    document.getElementById("modal-score").textContent = patient.priority_score;

    document.getElementById("modal-severity").textContent = patient.severity;
    document.getElementById("modal-sofa-raw").textContent = `SOFA Raw Score: ${patient.sofa_score}`;
    document.getElementById("modal-contrib-sev").textContent = `+${patient.severity_contribution || (patient.severity * 0.5).toFixed(1)}`;

    document.getElementById("modal-survival").textContent = `${patient.survival_likelihood}%`;
    document.getElementById("modal-contrib-surv").textContent = `+${patient.survival_contribution || (patient.survival_likelihood * 0.3).toFixed(1)}`;

    document.getElementById("modal-wait").textContent = `${patient.waiting_time_minutes} min`;
    document.getElementById("modal-contrib-wait").textContent = `+${patient.waiting_contribution || 0.0}`;

    // Populate physiological params grid
    const paramsGrid = document.getElementById("modal-params-grid");
    const params = patient.raw_clinical_params || {};
    paramsGrid.innerHTML = Object.entries(params).map(([key, val]) => `
        <div class="param-box">
            <div class="param-name">${key}</div>
            <div class="param-val">${val !== null && val !== undefined ? val : "N/A"}</div>
        </div>
    `).join("");

    document.getElementById("patient-modal").classList.remove("hidden");
};
