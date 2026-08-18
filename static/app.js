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

    const btnRunWhatif = document.getElementById("btn-run-whatif");
    if (btnRunWhatif) btnRunWhatif.addEventListener("click", runWhatIfSimulation);

    const btnResetWhatif = document.getElementById("btn-reset-whatif");
    if (btnResetWhatif) btnResetWhatif.addEventListener("click", resetWhatIfSimulation);

    const selectWhatifP = document.getElementById("whatif-patient-select");
    if (selectWhatifP) selectWhatifP.addEventListener("change", updateWhatIfLiveBaseline);

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

function formatAiAnswerHtml(text) {
    if (!text) return "";

    let safe = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    let lines = safe.split("\n");
    let html = "";
    let inList = false;

    lines.forEach(line => {
        let trimmed = line.trim();
        if (!trimmed) {
            if (inList) { html += "</ul>"; inList = false; }
            html += "<div style='height: 4px;'></div>";
            return;
        }

        if ((/^[A-Z0-9\s—–#\?\!\:\-\(\)]+$/.test(trimmed) && trimmed.length > 3 && !trimmed.startsWith("•") && !trimmed.startsWith("-")) || trimmed.endsWith(":") || trimmed.startsWith("WHY DID THIS CHANGE")) {
            if (inList) { html += "</ul>"; inList = false; }
            html += `<div style="font-size: 11px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: #0f172a; margin-top: 8px; margin-bottom: 4px; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px;">${trimmed}</div>`;
        } else if (trimmed.startsWith("•") || trimmed.startsWith("-")) {
            if (!inList) { html += "<ul style='margin: 4px 0; padding-left: 18px; line-height: 1.6;'>"; inList = true; }
            let content = trimmed.substring(1).trim();
            content = content.replace(/(Rank\s+#\d+|#\d+)/gi, '<strong style="font-family:var(--font-mono); color:var(--accent-green); background:#ecfdf5; padding:1px 5px; border-radius:4px;">$1</strong>');
            content = content.replace(/(\+\d+\.\d+\s*pts)/gi, '<span style="font-family:var(--font-mono); font-weight:700; color:#0f172a;">$1</span>');
            html += `<li style="font-size: 12px; color: #334155; margin-bottom: 3px;">${content}</li>`;
        } else {
            if (inList) { html += "</ul>"; inList = false; }
            let styled = trimmed;
            styled = styled.replace(/(Rank\s+#\d+|#\d+)/gi, '<strong style="font-family:var(--font-mono); color:var(--accent-green); background:#ecfdf5; padding:1px 5px; border-radius:4px;">$1</strong>');
            styled = styled.replace(/(\+\d+\.\d+\s*pts|\d+\.\d+\s*pts)/gi, '<span style="font-family:var(--font-mono); font-weight:700; color:#0f172a;">$1</span>');
            styled = styled.replace(/(Priority\s+Score:\s*\d+\.\d+)/gi, '<strong style="font-family:var(--font-mono); color:#0f172a;">$1</strong>');
            html += `<p style="font-size: 12.5px; color: #1e293b; line-height: 1.6; margin-bottom: 4px;">${styled}</p>`;
        }
    });

    if (inList) html += "</ul>";
    return `<div class="ai-answer-box">${html}</div>`;
}

async function askIntelligence(question) {
    const ansText = document.getElementById("intel-answer-text");
    const sourceTag = document.getElementById("intel-source-tag");
    const evidenceBox = document.getElementById("intel-evidence-box");
    const evidenceList = document.getElementById("intel-evidence-list");

    if (ansText) ansText.innerHTML = '<div style="font-size:12px; font-weight:700; color:#64748b; font-family:var(--font-mono);">ANALYZING CAREGRID STATE...</div>';

    const qLower = question.lower ? question.lower() : question.toLowerCase();

    // Check if query is a comparison question (V3.2)
    if (qLower.includes("compare") || qLower.includes("above") || qLower.includes("below") || qLower.includes("versus") || (qLower.includes("vs") && !qLower.includes("sofa"))) {
        try {
            // Find patient IDs in query or compare selected with patient below/above
            const matches = question.match(/P-?\d+/gi);
            let pidA = matches && matches[0] ? matches[0].toUpperCase().replace("P", "P-") : selectedPatientId;
            if (pidA && !pidA.startsWith("P-")) pidA = "P-" + pidA.replace("P", "");

            let pidB = matches && matches[1] ? matches[1].toUpperCase().replace("P", "P-") : null;
            if (pidB && !pidB.startsWith("P-")) pidB = "P-" + pidB.replace("P", "");

            if (!pidB && pidA) {
                const cur = currentPatients.find(p => p.patient_id === pidA);
                if (cur && cur.rank < currentPatients.length) {
                    const below = currentPatients.find(p => p.rank === cur.rank + 1);
                    if (below) pidB = below.patient_id;
                }
            }

            if (pidA && pidB) {
                const res = await fetch("/api/intelligence/compare", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ patient_id_a: pidA, patient_id_b: pidB })
                });
                const data = await res.json();
                if (data.status === "success") {
                    if (ansText) ansText.innerHTML = formatAiAnswerHtml(data.explanation);
                    if (sourceTag) sourceTag.textContent = `SOURCE: ${data.source}`;
                    if (evidenceBox) evidenceBox.style.display = "none";
                    return;
                }
            }
        } catch (err) {
            console.error("NL Comparison query error:", err);
        }
    }

    // Check if query is a what-if simulation question (V3.3)
    if (qLower.includes("what if") || qLower.includes("happens if") || qLower.includes("simulate scenario")) {
        try {
            const interpRes = await fetch("/api/intelligence/whatif", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: question, patient_id: selectedPatientId })
            });
            const interpData = await interpRes.json();

            if (interpData.status === "ready") {
                const scenario = interpData.scenario;
                const beforePatient = currentPatients.find(p => p.patient_id === (scenario.patient_id || selectedPatientId)) || currentPatients[0];
                const simRes = await fetch("/api/simulation/event", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: scenario.action, patient_id: scenario.patient_id || selectedPatientId })
                });
                const simData = await simRes.json();

                if (simData.status === "success") {
                    renderSimResults(simData);
                    await fetchOverview();
                    await fetchPatientsQueue();
                    await fetchSideAuditEvents();

                    const afterPatient = currentPatients.find(p => p.patient_id === (scenario.patient_id || selectedPatientId)) || beforePatient;
                    const expRes = await fetch("/api/intelligence/explain-simulation", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ sim_result: simData, before_patient: beforePatient, after_patient: afterPatient })
                    });
                    const expData = await expRes.json();
                    if (ansText) ansText.innerHTML = formatAiAnswerHtml(expData.answer);
                    if (sourceTag) sourceTag.textContent = `SOURCE: ${expData.source}`;
                    if (evidenceBox) evidenceBox.style.display = "none";
                    return;
                }
            } else if (interpData.status === "unsupported") {
                if (ansText) ansText.innerHTML = formatAiAnswerHtml(interpData.message);
                if (sourceTag) sourceTag.textContent = `SOURCE: ${interpData.source}`;
                if (evidenceBox) evidenceBox.style.display = "none";
                return;
            }
        } catch (err) {
            console.error("NL What-if query error:", err);
        }
    }

    try {
        const res = await fetch("/api/intelligence/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: question, patient_id: selectedPatientId })
        });
        const data = await res.json();

        if (data.status === "success") {
            if (ansText) ansText.innerHTML = formatAiAnswerHtml(data.answer);
            if (sourceTag) sourceTag.textContent = `SOURCE: ${data.source}`;

            if (data.context_summary) {
                const cs = data.context_summary;
                const iq = document.getElementById("icontext-queue");
                const ic = document.getElementById("icontext-critical");
                const it = document.getElementById("icontext-toppatient");
                const is = document.getElementById("icontext-topscore");

                const topScoreVal = (cs.top_priority_score !== undefined && cs.top_priority_score !== null) ? Number(cs.top_priority_score).toFixed(1) : "0.0";
                if (iq) iq.textContent = cs.queue_size || 0;
                if (ic) ic.textContent = cs.critical_count || 0;
                if (it) it.textContent = cs.top_patient_id || "N/A";
                if (is) is.textContent = topScoreVal;
            }

            if (data.evidence && Object.keys(data.evidence).length > 0) {
                const ev = data.evidence;
                const pScore = ev.priority_score ? Number(ev.priority_score).toFixed(1) : "0.0";
                const sevVal = ev.severity ? Number(ev.severity).toFixed(1) : "0.0";
                const sevContrib = ev.severity_contribution ? Number(ev.severity_contribution).toFixed(1) : "0.0";
                const survVal = ev.survival_likelihood ? Number(ev.survival_likelihood).toFixed(1) : "0.0";
                const survContrib = ev.survival_contribution ? Number(ev.survival_contribution).toFixed(1) : "0.0";
                const waitContrib = ev.waiting_contribution ? Number(ev.waiting_contribution).toFixed(1) : "0.0";

                evidenceList.innerHTML = `
                    <li><strong>Target Patient ID:</strong> ${ev.patient_id || "N/A"} (Rank #${ev.rank || 1})</li>
                    <li><strong>Priority Score:</strong> ${pScore} / 100.0</li>
                    <li><strong>SOFA Organ Failure Severity:</strong> ${sevVal} (SOFA raw: ${ev.sofa_score || 0}) → +${sevContrib} pts</li>
                    <li><strong>Survival Likelihood:</strong> ${survVal}% → +${survContrib} pts</li>
                    <li><strong>Waiting Duration Pending:</strong> ${ev.waiting_time_minutes || 0} minutes → +${waitContrib} pts</li>
                `;
                if (evidenceBox) evidenceBox.style.display = "block";
                if (evidenceBox) evidenceBox.style.display = "block";
            } else {
                if (evidenceBox) evidenceBox.style.display = "none";
            }
        } else {
            if (ansText) ansText.innerHTML = formatAiAnswerHtml("CAREGRID INTELLIGENCE UNAVAILABLE");
            if (sourceTag) sourceTag.textContent = "SOURCE: Unavailable";
        }
    } catch (err) {
        console.error("Intelligence query failed:", err);
        if (ansText) ansText.innerHTML = formatAiAnswerHtml("CAREGRID INTELLIGENCE UNAVAILABLE");
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

            populateWhatIfPatientSelect();
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

let activePanelWhyMode = "why_ranked";

function updatePanelBreakdown(patient) {
    const weights = { severity: 0.50, survival: 0.30, waiting: 0.20 };
    const sevContrib  = +(patient.severity * weights.severity).toFixed(1);
    const survContrib = +(patient.survival_likelihood * weights.survival).toFixed(1);
    const waitRaw     = Math.min(100.0, patient.waiting_time_minutes / 1.2);
    const waitContrib = +(waitRaw * weights.waiting).toFixed(1);

    const totalScore = patient.priority_score.toFixed(1);

    const contribMap = { "Severity": sevContrib, "Survival Likelihood": survContrib, "Waiting Duration": waitContrib };
    const dominantKey = Object.entries(contribMap).sort((a,b) => b[1]-a[1])[0][0];

    const scoreEl = document.getElementById("pbreak-total-score");
    const sRawEl  = document.getElementById("pbreak-sev-raw");
    const sCEl    = document.getElementById("pbreak-sev-contrib");
    const vRawEl  = document.getElementById("pbreak-surv-raw");
    const vCEl    = document.getElementById("pbreak-surv-contrib");
    const wRawEl  = document.getElementById("pbreak-wait-raw");
    const wCEl    = document.getElementById("pbreak-wait-contrib");
    const domEl   = document.getElementById("pbreak-dominant");

    if (scoreEl) scoreEl.textContent = `${totalScore} / 100.0`;
    if (sRawEl)  sRawEl.textContent  = `Raw: ${patient.severity} · Weight: 50%`;
    if (sCEl)    sCEl.textContent    = `+${sevContrib} pts`;
    if (vRawEl)  vRawEl.textContent  = `Raw: ${patient.survival_likelihood}% · Weight: 30%`;
    if (vCEl)    vCEl.textContent    = `+${survContrib} pts`;
    if (wRawEl)  wRawEl.textContent  = `Raw: ${patient.waiting_time_minutes} min · Weight: 20%`;
    if (wCEl)    wCEl.textContent    = `+${waitContrib} pts`;
    if (domEl)   domEl.textContent   = dominantKey;
}

async function updatePanelAIExplanation(patientId, mode = "why_ranked") {
    activePanelWhyMode = mode;
    const textEl   = document.getElementById("panel-why-ai-text");
    const sourceEl = document.getElementById("panel-why-ai-source");
    if (!patientId || !textEl) return;

    textEl.textContent = "Querying CareGrid Intelligence...";
    if (sourceEl) sourceEl.textContent = "CareGrid Priority Engine";

    try {
        const res = await fetch("/api/intelligence/ask-patient", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patient_id: patientId, mode: mode })
        });
        const data = await res.json();
        if (data.status === "success") {
            textEl.textContent = data.answer;
            if (sourceEl) sourceEl.textContent = data.source || "CareGrid Current Patient State | CareGrid Priority Engine";
        } else {
            textEl.textContent = "CAREGRID INTELLIGENCE UNAVAILABLE";
        }
    } catch (err) {
        console.error("Panel AI explanation query error:", err);
        textEl.textContent = "CAREGRID INTELLIGENCE UNAVAILABLE";
    }
}

function setupPanelSubTabs() {
    const tabBtns = document.querySelectorAll(".panel-tabs-row .panel-tab-btn");
    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const ptab = btn.dataset.ptab || btn.id.replace("ptab-", "");
            
            const overviewPane = document.getElementById("pview-overview");
            const breakdownPane = document.getElementById("pview-breakdown");
            const explainPane = document.getElementById("pview-explanation");

            if (overviewPane) overviewPane.style.display = ptab === "overview" ? "block" : "none";
            if (breakdownPane) breakdownPane.style.display = ptab === "breakdown" ? "block" : "none";
            if (explainPane) explainPane.style.display = ptab === "explanation" ? "block" : "none";

            if (ptab === "explanation" && selectedPatientId) {
                updatePanelAIExplanation(selectedPatientId, activePanelWhyMode || "why_ranked");
            }
        });
    });

    // Quick action mode buttons in Why #Rank pane
    const modeBtns = document.querySelectorAll("#pview-explanation .v31-action-btn");
    modeBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            modeBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const mode = btn.dataset.mode || "why_ranked";
            if (selectedPatientId) {
                updatePanelAIExplanation(selectedPatientId, mode);
            }
        });
    });
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

    // Dynamic Tab Label & Explanation Header Update
    const ptabExplanation = document.getElementById("ptab-explanation");
    if (ptabExplanation) {
        ptabExplanation.textContent = `Why #${patient.rank}?`;
    }
    const panelWhyTitle = document.getElementById("panel-why-title");
    if (panelWhyTitle) {
        panelWhyTitle.textContent = `WHY IS PATIENT ${patient.patient_id} RANKED #${patient.rank}?`;
    }
    const pwhyMode1 = document.getElementById("pwhy-mode-why1");
    if (pwhyMode1) {
        pwhyMode1.textContent = patient.rank === 1 ? "WHY RANKED #1?" : "WHY NOT #1?";
    }

    // Overview Pane Update
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
            document.getElementById("panel-explain-text").innerHTML = formatExplanationHTML(exp.explanation_text);
        }
    } catch (err) {
        console.error("Explainability fetch error:", err);
    }

    // Breakdown Pane Update
    updatePanelBreakdown(patient);

    // If Why #Rank tab is active, trigger AI explanation update
    const expPane = document.getElementById("pview-explanation");
    if (expPane && expPane.style.display !== "none") {
        updatePanelAIExplanation(patient.patient_id, activePanelWhyMode || "why_ranked");
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

    const mTabWhy = document.getElementById("mtab-why");
    if (mTabWhy) {
        mTabWhy.textContent = patient.rank === 1 ? "WHY #1" : `WHY #${patient.rank}`;
    }

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
            document.getElementById("modal-explain-text").innerHTML = formatAiAnswerHtml(exp.explanation_text);
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
            if (responseText)   responseText.innerHTML   = formatAiAnswerHtml(data.answer);
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

async function renderSimResults(data) {
    const container = document.getElementById("sim-output-container");
    if (!container) return;
    const evt = data.audit_event || {};
    const movedUp = data.moved_up || [];
    const movedDown = data.moved_down || [];

    const eventTitle = (evt.event_type || 'SIMULATION').toUpperCase().replace("_", " ");
    const eventSub = evt.reason || 'Arbitration engine re-ranked candidate population.';

    let aiExplanationText = "Querying CareGrid Intelligence for simulation explanation...";

    try {
        const expRes = await fetch("/api/intelligence/explain-simulation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sim_result: data })
        });
        const expData = await expRes.json();
        if (expData.status === "success") {
            aiExplanationText = expData.answer;
        }
    } catch (err) {
        console.error("Simulation explanation fetch error:", err);
    }

    container.innerHTML = `
        <div style="margin-bottom: 12px;">
            <!-- BEFORE -> EVENT -> AFTER VISUAL FLOW -->
            <div style="display: grid; grid-template-columns: 1fr auto 1.2fr auto 1fr; gap: 8px; align-items: center; text-align: center; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px; margin-bottom: 12px;">
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px;">
                    <span style="font-size: 8.5px; font-weight: 800; color: #64748b; text-transform: uppercase;">BEFORE</span>
                    <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-top: 2px;">QUEUE SNAPSHOT</div>
                </div>
                <div style="font-size: 14px; font-weight: 800; color: #64748b;">➔</div>
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 8px;">
                    <span style="font-size: 8.5px; font-weight: 800; color: #059669; text-transform: uppercase;">EVENT</span>
                    <div style="font-size: 11px; font-weight: 800; color: #0f172a; margin-top: 2px;">${eventTitle}</div>
                    <div style="font-size: 9.5px; color: #475569;">${evt.patient_id ? `Patient ${evt.patient_id}` : 'Queue Arbitration'}</div>
                </div>
                <div style="font-size: 14px; font-weight: 800; color: #64748b;">➔</div>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px;">
                    <span style="font-size: 8.5px; font-weight: 800; color: #64748b; text-transform: uppercase;">AFTER</span>
                    <div style="font-size: 11px; font-weight: 700; color: var(--status-success);">RE-RANKED QUEUE</div>
                </div>
            </div>

            <!-- RANK CHANGES SUMMARY -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px;">
                    <span style="font-size: 10px; font-weight: 700; color: var(--status-success); text-transform: uppercase;">PROMOTED IN RANK (${movedUp.length})</span>
                    ${movedUp.length === 0 ? '<p style="font-size:11px; color:var(--text-muted); margin-top:4px;">None</p>' : movedUp.slice(0, 4).map(m => `
                        <div style="font-family: var(--font-mono); font-size: 11px; padding: 3px 0; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between;">
                            <span style="color: #0f172a; font-weight:600;">${m.patient_id}</span>
                            <span>#${m.previous_rank} → <span style="color: var(--status-success); font-weight:700;">#${m.new_rank}</span> (+${m.rank_delta})</span>
                        </div>
                    `).join('')}
                </div>
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px;">
                    <span style="font-size: 10px; font-weight: 700; color: var(--status-warning); text-transform: uppercase;">DEMOTED IN RANK (${movedDown.length})</span>
                    ${movedDown.length === 0 ? '<p style="font-size:11px; color:var(--text-muted); margin-top:4px;">None</p>' : movedDown.slice(0, 4).map(m => `
                        <div style="font-family: var(--font-mono); font-size: 11px; padding: 3px 0; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between;">
                            <span style="color: #0f172a; font-weight:600;">${m.patient_id}</span>
                            <span>#${m.previous_rank} → <span style="color: var(--status-warning); font-weight:700;">#${m.new_rank}</span> (${m.rank_delta})</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- CAREGRID INTELLIGENCE EXPLANATION -->
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">CAREGRID INTELLIGENCE — V3.4</span>
                    <span style="font-size: 9px; font-family: var(--font-mono); color: var(--accent-green); font-weight: 700;">GROUNDED EXPLANATION</span>
                </div>
                <div style="font-size: 11px; line-height: 1.6; color: #1e293b; white-space: pre-wrap; font-family: var(--font-mono); background: #f8fafc; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0;">${aiExplanationText}</div>
                <div style="margin-top: 6px; font-size: 9px; color: #64748b; text-transform: uppercase; font-family: var(--font-mono);">
                    SOURCE: CareGrid Simulation Engine | CareGrid Arbitration Engine | CareGrid Current State
                </div>
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
// PATIENT DETAIL TAB NAVIGATION — OVERVIEW / BREAKDOWN / WHY #RANK
// ══════════════════════════════════════════════════════════════════════════════

function setupPanelSubTabs() {
    const tabBtns = document.querySelectorAll(".panel-tabs-row .panel-tab-btn");
    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const ptab = btn.dataset.ptab || btn.id.replace("ptab-", "");
            
            const overviewPane = document.getElementById("pview-overview");
            const breakdownPane = document.getElementById("pview-breakdown");
            const explainPane = document.getElementById("pview-explanation");

            if (overviewPane) overviewPane.style.display = (ptab === "overview") ? "block" : "none";
            if (breakdownPane) breakdownPane.style.display = (ptab === "breakdown") ? "block" : "none";
            if (explainPane) explainPane.style.display = (ptab === "explanation" || ptab === "why") ? "block" : "none";

            if (selectedPatientId) {
                let patient = currentPatients.find(p => p.patient_id === selectedPatientId || p.record_id === selectedPatientId);
                if (patient) {
                    if (ptab === "breakdown") {
                        updatePanelBreakdown(patient);
                    } else if (ptab === "explanation" || ptab === "why") {
                        updatePanelAIExplanation(selectedPatientId, activePanelWhyMode || "why_ranked");
                    }
                }
            }
        });
    });

    // Quick action mode buttons in Why #Rank pane
    const modeBtns = document.querySelectorAll("#pview-explanation .v31-action-btn");
    modeBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            modeBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const mode = btn.dataset.mode || "why_ranked";
            if (selectedPatientId) {
                updatePanelAIExplanation(selectedPatientId, mode);
            }
        });
    });
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

async function runModalOrganWhatIfSimulation() {
    const pidText = document.getElementById("modal-whatif-target-pid").textContent;
    const container = document.getElementById("mwhatif-output-container");
    if (!pidText || !container) return;

    const organSys = document.getElementById("mwhatif-organ-select").value;
    const scoreVal = document.getElementById("mwhatif-organ-score").value.trim();

    if (scoreVal === "") {
        container.innerHTML = `
            <div style="padding: 14px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; font-size: 12px; color: #92400e;">
                ORGAN SEVERITY VALUE REQUIRED: Please enter a target severity score (0-100) for the selected organ system.
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div style="text-align: center; padding: 25px; color: #64748b;">
            <div style="font-size: 13px; font-weight: 600;">Executing V6 Organ System What-If Simulation...</div>
        </div>
    `;

    try {
        const res = await fetch("/api/simulation/what-if-organ", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                patient_id: pidText,
                organ_system: organSys,
                target_score: parseFloat(scoreVal)
            })
        });

        const data = await res.json();
        if (data.status === "success") {
            const b = data.before_state;
            const a = data.after_state;
            const imp = data.impact_summary;

            const scoreSign = imp.score_delta >= 0 ? "+" : "";
            const rankShiftText = imp.rank_delta > 0 ? `UP ${imp.rank_delta}` : (imp.rank_delta < 0 ? `DOWN ${Math.abs(imp.rank_delta)}` : `STABLE`);
            const rankColor = imp.rank_delta > 0 ? "#059669" : (imp.rank_delta < 0 ? "#dc2626" : "#0284c7");

            container.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 14px;">
                    <!-- Hero Result Banner -->
                    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; color: #0284c7;">V6 ORGAN WHAT-IF RESULT</span>
                            <div style="font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 2px;">Patient ${data.patient_id} • ${data.organ_system} System</div>
                            <div style="font-size: 11px; color: #475569; margin-top: 2px;">${data.deterministic_explanation}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 18px; font-weight: 800; color: ${rankColor};">${imp.rank_transition}</div>
                            <div style="font-size: 10px; font-weight: 700; color: #64748b;">RANK SHIFT (${rankShiftText})</div>
                        </div>
                    </div>

                    <!-- Comparison Grid -->
                    <div style="display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 12px;">
                        <!-- BEFORE -->
                        <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px;">
                            <span style="font-size: 9.5px; font-weight: 800; color: #64748b; text-transform: uppercase; display: block; margin-bottom: 6px;">BEFORE (LIVE STATE)</span>
                            <div style="font-size: 18px; font-weight: 800; color: #0f172a;">${b.priority_score.toFixed(1)} <span style="font-size: 10px; color: #64748b;">PRIORITY</span></div>
                            <div style="font-size: 11px; font-weight: 700; color: #0284c7; margin-bottom: 6px;">Rank #${b.rank}</div>
                            <div style="font-size: 10.5px; color: #475569; font-family: var(--font-mono);">
                                <div>Organ Sev: ${b.organ_score.toFixed(0)} (${b.organ_category})</div>
                                <div>Overall Sev: ${b.overall_severity.toFixed(1)}</div>
                            </div>
                        </div>

                        <!-- EVENT -->
                        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px;">
                            <span style="font-size: 9.5px; font-weight: 800; color: #0284c7; text-transform: uppercase; display: block; margin-bottom: 6px;">HYPOTHETICAL ORGAN EVENT</span>
                            <div style="font-weight: 700; color: #0f172a; font-size: 12px; margin-bottom: 4px;">${data.organ_system} System</div>
                            <div style="font-size: 11px; color: #334155; font-family: var(--font-mono);">Tested Score: <strong>${a.organ_score.toFixed(0)}/100</strong></div>
                            <div style="font-size: 10px; color: #64748b; margin-top: 4px;">Organ Delta: ${imp.organ_delta >= 0 ? '+' : ''}${imp.organ_delta.toFixed(0)} pts</div>
                        </div>

                        <!-- AFTER -->
                        <div style="background: #ffffff; border: 2px solid ${rankColor}; border-radius: 10px; padding: 12px;">
                            <span style="font-size: 9.5px; font-weight: 800; color: ${rankColor}; text-transform: uppercase; display: block; margin-bottom: 6px;">AFTER (SIMULATED)</span>
                            <div style="font-size: 18px; font-weight: 800; color: #0f172a;">${a.priority_score.toFixed(1)} <span style="font-size: 10px; color: ${rankColor};">(${scoreSign}${imp.score_delta.toFixed(1)})</span></div>
                            <div style="font-size: 11px; font-weight: 700; color: ${rankColor}; margin-bottom: 6px;">Rank #${a.rank} (${rankShiftText})</div>
                            <div style="font-size: 10.5px; color: #475569; font-family: var(--font-mono);">
                                <div>Organ Sev: ${a.organ_score.toFixed(0)} (${a.organ_category})</div>
                                <div>Overall Sev: ${a.overall_severity.toFixed(1)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = `<div style="padding: 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 12px; color: #991b1b;">Error: ${data.message}</div>`;
        }
    } catch (err) {
        container.innerHTML = `<div style="padding: 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 12px; color: #991b1b;">Organ Simulation Error: ${err.message}</div>`;
    }
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

/* ============================================================
   CAREGRID V5.0 WHAT-IF SIMULATION ENGINE FRONTEND LOGIC
   ============================================================ */

function populateWhatIfPatientSelect() {
    const select = document.getElementById("whatif-patient-select");
    if (!select || !currentPatients || currentPatients.length === 0) return;

    const topList = currentPatients.slice(0, 25);
    select.innerHTML = topList.map(p => `
        <option value="${p.patient_id}">Patient ${p.patient_id} (Rank #${p.rank}) — Priority ${p.priority_score.toFixed(1)}</option>
    `).join("");

    if (selectedPatientId && topList.some(p => p.patient_id === selectedPatientId)) {
        select.value = selectedPatientId;
    }

    updateWhatIfLiveBaseline();
}

function updateWhatIfLiveBaseline() {
    const select = document.getElementById("whatif-patient-select");
    if (!select || !currentPatients) return;

    const pid = select.value;
    const p = currentPatients.find(item => item.patient_id === pid);
    if (!p) return;

    const lblWait = document.getElementById("whatif-cur-wait");
    const lblSofa = document.getElementById("whatif-cur-sofa");
    const lblSurv = document.getElementById("whatif-cur-surv");

    if (lblWait) lblWait.textContent = `Live: ${p.waiting_time_minutes}m`;
    if (lblSofa) lblSofa.textContent = `Live: SOFA ${p.sofa_score.toFixed(1)}`;
    if (lblSurv) lblSurv.textContent = `Live: ${p.survival_likelihood.toFixed(1)}%`;
}

async function runWhatIfSimulation() {
    const select = document.getElementById("whatif-patient-select");
    const container = document.getElementById("sim-output-container");
    if (!select || !container) return;

    const pid = select.value;
    const waitVal = document.getElementById("whatif-input-wait").value.trim();
    const sofaVal = document.getElementById("whatif-input-sofa").value.trim();
    const survVal = document.getElementById("whatif-input-surv").value.trim();

    const scenario_changes = {};
    if (waitVal !== "") scenario_changes.waiting_time_minutes = parseInt(waitVal);
    if (sofaVal !== "") scenario_changes.sofa_score = parseFloat(sofaVal);
    if (survVal !== "") scenario_changes.survival_likelihood = parseFloat(survVal);

    if (Object.keys(scenario_changes).length === 0) {
        container.innerHTML = `
            <div style="padding: 16px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; font-size: 12px; color: #92400e;">
                ⚠️ <strong>SCENARIO REQUIRED:</strong> Please enter at least one hypothetical value (Waiting Time, SOFA Score, or Survival Likelihood) to run a simulation.
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div style="text-align: center; padding: 30px; color: #64748b;">
            <p style="font-size: 13px; font-weight: 600;">Executing Isolated What-If Priority Engine Sandbox Simulation...</p>
        </div>
    `;

    try {
        const res = await fetch("/api/simulation/what-if", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                patient_id: pid,
                scenario_changes: scenario_changes
            })
        });

        const data = await res.json();
        if (data.status === "success") {
            renderWhatIfReport(data);
        } else {
            container.innerHTML = `<div style="padding: 16px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 12px; color: #991b1b;">Error: ${data.message}</div>`;
        }
    } catch (err) {
        container.innerHTML = `<div style="padding: 16px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 12px; color: #991b1b;">Simulation Request Failed: ${err.message}</div>`;
    }
}

function renderWhatIfReport(data) {
    const container = document.getElementById("sim-output-container");
    if (!container || !data) return;

    const b = data.before_state;
    const a = data.after_state;
    const imp = data.impact_summary;

    const scoreSign = imp.score_delta >= 0 ? "+" : "";
    const rankBadgeColor = imp.rank_delta > 0 ? "#059669" : (imp.rank_delta < 0 ? "#d97706" : "#64748b");
    const rankShiftText = imp.rank_delta > 0 ? `↑ ${imp.rank_delta} POSITIONS` : (imp.rank_delta < 0 ? `↓ ${Math.abs(imp.rank_delta)} POSITIONS` : `UNCHANGED`);

    let eventsHtml = data.event_details.map(ev => `
        <div style="font-size: 11px; margin-bottom: 4px;">
            <strong style="color: #334155;">${ev.factor}:</strong> ${ev.before} → <span style="color: #0284c7; font-weight: 700;">${ev.after}</span> (${ev.change})
        </div>
    `).join("");

    let affectedHtml = "";
    if (data.affected_rank_shifts && data.affected_rank_shifts.length > 0) {
        affectedHtml = `
            <div style="margin-top: 14px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #475569; display: block; margin-bottom: 8px;">FULL QUEUE AFFECTED PATIENT RANK MOVEMENTS</span>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px;">
                    ${data.affected_rank_shifts.map(p => `
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 10px; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-weight: 700; color: #0f172a;">${p.patient_id}</span>
                            <span style="font-family: var(--font-mono); font-weight: 700; color: ${p.before_rank > p.after_rank ? '#059669' : '#d97706'};">${p.rank_shift}</span>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
    }

    const html = `
        <div style="display: flex; flex-direction: column; gap: 14px;">
            <!-- Sandbox Header Badge -->
            <div style="display: flex; justify-content: space-between; align-items: center; background: #334155; color: #ffffff; padding: 8px 14px; border-radius: 8px; font-size: 11px; font-weight: 700;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="width: 8px; height: 8px; background: #38bdf8; border-radius: 50%;"></span>
                    <span>HYPOTHETICAL SIMULATION ACTIVE — Sandbox Isolated</span>
                </div>
                <span style="font-family: var(--font-mono); color: #cbd5e1; font-weight: 400; font-size: 10px;">LIVE STATE UNCHANGED</span>
            </div>

            <!-- BEFORE -> EVENT -> AFTER Grid -->
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
                <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 12px;">
                    <span style="font-size: 9.5px; font-weight: 800; letter-spacing: 0.6px; color: #1e40af; text-transform: uppercase; display: block; margin-bottom: 6px;">TESTED EVENT</span>
                    <div style="font-weight: 700; color: #1e3a8a; font-size: 13px; margin-bottom: 6px;">Patient ${data.patient_id} Scenario</div>
                    ${eventsHtml}
                </div>

                <!-- AFTER -->
                <div style="background: #ffffff; border: 2px solid ${rankBadgeColor}; border-radius: 10px; padding: 12px;">
                    <span style="font-size: 9.5px; font-weight: 800; letter-spacing: 0.6px; color: ${rankBadgeColor}; text-transform: uppercase; display: block; margin-bottom: 6px;">AFTER (SIMULATED)</span>
                    <div style="font-size: 20px; font-weight: 800; color: #0f172a;">${a.priority_score.toFixed(1)} <span style="font-size: 11px; font-weight: 700; color: ${rankBadgeColor};">(${scoreSign}${imp.score_delta.toFixed(1)})</span></div>
                    <div style="font-size: 12px; font-weight: 700; color: ${rankBadgeColor}; margin-bottom: 6px;">Rank #${a.rank} (${rankShiftText})</div>
                    <div style="font-size: 11px; color: #475569; font-family: var(--font-mono);">
                        <div>SOFA: ${a.sofa_score.toFixed(1)} (Sev ${a.severity.toFixed(0)})</div>
                        <div>Survival: ${a.survival_likelihood.toFixed(0)}%</div>
                        <div>Wait: ${a.waiting_time_minutes}m</div>
                    </div>
                </div>
            </div>

            <!-- Priority Comparison Bars -->
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px;">
                <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #475569; display: block; margin-bottom: 8px;">PRIORITY SCORE SHIFT COMPARISON</span>
                <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="width: 80px; font-weight: 700; color: #64748b;">LIVE STATE</span>
                        <span style="width: 45px; font-family: var(--font-mono); font-weight: 700; color: #0f172a;">${b.priority_score.toFixed(1)}</span>
                        <div style="flex: 1; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                            <div style="height: 100%; width: ${b.priority_score}%; background: #64748b; border-radius: 4px;"></div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="width: 80px; font-weight: 700; color: #0284c7;">SIMULATED</span>
                        <span style="width: 45px; font-family: var(--font-mono); font-weight: 700; color: #0284c7;">${a.priority_score.toFixed(1)}</span>
                        <div style="flex: 1; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                            <div style="height: 100%; width: ${a.priority_score}%; background: #0284c7; border-radius: 4px;"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Factor Contribution Shift Breakdown -->
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px;">
                <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #475569; display: block; margin-bottom: 8px;">FACTOR CONTRIBUTION DELTAS</span>
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
                    <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 8px;">
                        <div style="color: #1e40af; font-size: 10px; font-weight: 700;">WAIT EQUITY (20%)</div>
                        <div style="font-weight: 700; color: #1e3a8a; margin-top: 2px;">${b.waiting_contribution.toFixed(1)} → ${a.waiting_contribution.toFixed(1)} pts</div>
                        <div style="font-size: 10px; font-family: var(--font-mono); color: #1d4ed8; font-weight: 700;">Delta: ${(imp.factor_deltas.waiting_contribution >= 0 ? '+' : '') + imp.factor_deltas.waiting_contribution.toFixed(1)} pts ★</div>
                    </div>
                </div>
            </div>

            ${affectedHtml}

            <!-- Grounded Deterministic Explanation -->
            <div class="explain-card" style="margin-top: 0; background: #ffffff;">
                <span class="explain-eyebrow">DETERMINISTIC SIMULATION ANALYSIS</span>
                <p class="explain-text" style="color: #1e293b; font-size: 12px; line-height: 1.6;">${data.deterministic_explanation}</p>
            </div>

            <!-- Action Toolbar -->
            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px;">
                <button onclick="askCareGridAIAboutSimulation('${data.patient_id}')" class="btn-ops" style="background: #0f172a; padding: 8px 14px; font-size: 11px;">💬 Ask CareGrid AI About Simulation</button>
                <button onclick="resetWhatIfSimulation()" class="btn-ops" style="background: #dc2626; padding: 8px 14px; font-size: 11px;">🔄 Reset Simulation Sandbox</button>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

function resetWhatIfSimulation() {
    const inputWait = document.getElementById("whatif-input-wait");
    const inputSofa = document.getElementById("whatif-input-sofa");
    const inputSurv = document.getElementById("whatif-input-surv");
    const container = document.getElementById("sim-output-container");

    if (inputWait) inputWait.value = "";
    if (inputSofa) inputSofa.value = "";
    if (inputSurv) inputSurv.value = "";

    if (container) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #64748b;">
                <span style="font-size: 28px; display: block; margin-bottom: 8px;">⚡</span>
                <h3 style="font-size: 15px; font-weight: 700; color: #334155; margin-bottom: 4px;">What-If Scenario Sandbox Reset</h3>
                <p style="font-size: 12px; max-width: 420px; margin: 0 auto;">Live CareGrid state baseline restored. Select a patient and enter hypothetical parameters on the left to evaluate scenario impacts.</p>
            </div>
        `;
    }
}

function askCareGridAIAboutSimulation(patientId) {
    const tabBtnIntel = document.getElementById("tab-btn-intel");
    if (tabBtnIntel) tabBtnIntel.click();

    const freeInput = document.getElementById("v31-free-question-input");
    if (freeInput) {
        freeInput.value = `Why did patient ${patientId}'s rank and priority score change under the recent What-If simulation scenario?`;
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
// V3.2 — PATIENT COMPARISON INTELLIGENCE & MODAL LOGIC
// ══════════════════════════════════════════════════════════════════════════════

function setupV32ComparisonListeners() {
    const btnAbove = document.getElementById("btn-compare-above");
    const btnBelow = document.getElementById("btn-compare-below");
    const closeBtn = document.getElementById("compare-modal-close-btn");
    const modal    = document.getElementById("patient-comparison-modal");

    if (closeBtn && modal) {
        closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
        modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
    }

    if (btnAbove) {
        btnAbove.addEventListener("click", () => {
            if (!selectedPatientId) return;
            const currentPatient = currentPatients.find(p => p.patient_id === selectedPatientId);
            if (!currentPatient) return;

            if (currentPatient.rank <= 1) {
                alert("This patient is currently ranked #1. There is no patient above to compare.");
                return;
            }

            const patientAbove = currentPatients.find(p => p.rank === currentPatient.rank - 1);
            if (patientAbove) {
                openCompareModal(selectedPatientId, patientAbove.patient_id);
            } else {
                alert("Patient above is not available in the current queue snapshot.");
            }
        });
    }

    if (btnBelow) {
        btnBelow.addEventListener("click", () => {
            if (!selectedPatientId) return;
            const currentPatient = currentPatients.find(p => p.patient_id === selectedPatientId);
            if (!currentPatient) return;

            if (currentPatient.rank >= currentPatients.length) {
                alert("This patient is at the end of the queue. There is no patient below to compare.");
                return;
            }

            const patientBelow = currentPatients.find(p => p.rank === currentPatient.rank + 1);
            if (patientBelow) {
                openCompareModal(selectedPatientId, patientBelow.patient_id);
            } else {
                alert("Patient below is not available in the current queue snapshot.");
            }
        });
    }
}

async function openCompareModal(patientIdA, patientIdB) {
    const modal = document.getElementById("patient-comparison-modal");
    const aiText = document.getElementById("compare-ai-text");
    const aiSource = document.getElementById("compare-ai-source");
    if (!modal) return;

    if (aiText) aiText.textContent = "Querying CareGrid Intelligence for grounded comparison...";
    modal.classList.remove("hidden");

    try {
        const res = await fetch("/api/intelligence/compare", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patient_id_a: patientIdA, patient_id_b: patientIdB })
        });
        const data = await res.json();

        if (data.status === "success") {
            const pa = data.patient_a;
            const pb = data.patient_b;
            const ca = pa.contributions;
            const cb = pb.contributions;

            document.getElementById("compa-id").textContent = pa.patient_id;
            document.getElementById("compa-rank").textContent = `Rank #${pa.rank}`;
            document.getElementById("compa-score").textContent = pa.priority_score.toFixed(1);
            document.getElementById("compa-sev").textContent = pa.severity;
            document.getElementById("compa-surv").textContent = `${pa.survival_likelihood}%`;
            document.getElementById("compa-wait").textContent = `${pa.waiting_time_minutes} min`;

            document.getElementById("compb-id").textContent = pb.patient_id;
            document.getElementById("compb-rank").textContent = `Rank #${pb.rank}`;
            document.getElementById("compb-score").textContent = pb.priority_score.toFixed(1);
            document.getElementById("compb-sev").textContent = pb.severity;
            document.getElementById("compb-surv").textContent = `${pb.survival_likelihood}%`;
            document.getElementById("compb-wait").textContent = `${pb.waiting_time_minutes} min`;

            document.getElementById("comp-sev-a").textContent = `+${ca.severity_contribution.toFixed(1)} pts`;
            document.getElementById("comp-sev-b").textContent = `+${cb.severity_contribution.toFixed(1)} pts`;

            document.getElementById("comp-surv-a").textContent = `+${ca.survival_contribution.toFixed(1)} pts`;
            document.getElementById("comp-surv-b").textContent = `+${cb.survival_contribution.toFixed(1)} pts`;

            document.getElementById("comp-wait-a").textContent = `+${ca.waiting_contribution.toFixed(1)} pts`;
            document.getElementById("comp-wait-b").textContent = `+${cb.waiting_contribution.toFixed(1)} pts`;

            if (aiText) aiText.innerHTML = formatAiAnswerHtml(data.explanation);
            if (aiSource) aiSource.textContent = data.source || "CareGrid Priority Engine | CareGrid Current Patient State";
        } else {
            if (aiText) aiText.innerHTML = formatAiAnswerHtml(data.message || "INSUFFICIENT DATA FOR COMPARISON");
        }
    } catch (err) {
        console.error("Comparison fetch failed:", err);
        if (aiText) aiText.innerHTML = formatAiAnswerHtml("CAREGRID INTELLIGENCE TEMPORARILY UNAVAILABLE");
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// V3.3 — WHAT-IF SCENARIO INTELLIGENCE & MODAL LOGIC
// ══════════════════════════════════════════════════════════════════════════════

function setupV33WhatIfListeners() {
    const btnWhatIf = document.getElementById("btn-run-whatif");
    const closeBtn  = document.getElementById("whatif-modal-close-btn");
    const modal     = document.getElementById("whatif-scenario-modal");

    if (closeBtn && modal) {
        closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
        modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
    }

    if (btnWhatIf) {
        btnWhatIf.addEventListener("click", () => {
            if (selectedPatientId) {
                openWhatIfModal(selectedPatientId);
            }
        });
    }

    // Action buttons inside What-If modal
    const scenarioBtns = document.querySelectorAll("#whatif-scenario-modal .v31-action-btn");
    scenarioBtns.forEach(btn => {
        btn.addEventListener("click", async () => {
            const actionName = btn.dataset.action;
            if (actionName && selectedPatientId) {
                await runWhatIfScenarioAction(selectedPatientId, actionName);
            }
        });
    });
}

function openWhatIfModal(patientId) {
    const modal = document.getElementById("whatif-scenario-modal");
    if (!modal) return;

    const patient = currentPatients.find(p => p.patient_id === patientId || p.record_id === patientId);
    if (patient) {
        document.getElementById("wbefore-id").textContent = patient.patient_id;
        document.getElementById("wbefore-rank").textContent = `Rank #${patient.rank}`;
        document.getElementById("wbefore-score").textContent = patient.priority_score.toFixed(1);

        document.getElementById("wafter-id").textContent = patient.patient_id;
        document.getElementById("wafter-rank").textContent = `Rank #${patient.rank}`;
        document.getElementById("wafter-score").textContent = patient.priority_score.toFixed(1);
    }

    const aiText = document.getElementById("whatif-ai-text");
    if (aiText) aiText.textContent = "Select a scenario action button above to run a deterministic simulation.";

    modal.classList.remove("hidden");
}

async function runWhatIfScenarioAction(patientId, actionName) {
    const aiText = document.getElementById("whatif-ai-text");
    const aiSource = document.getElementById("whatif-ai-source");
    if (aiText) aiText.textContent = "Executing deterministic simulation engine scenario...";

    const beforePatient = currentPatients.find(p => p.patient_id === patientId || p.record_id === patientId);
    const beforeSnap = beforePatient ? { ...beforePatient } : null;

    try {
        // Run deterministic simulation engine calculation
        const simPayload = { action: actionName };
        if (actionName === "severity_spike" && patientId) {
            simPayload.patient_id = patientId;
        }

        const simRes = await fetch("/api/simulation/event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(simPayload)
        });
        const simData = await simRes.json();

        if (simData.status === "success") {
            renderSimResults(simData);
            await fetchOverview();
            await fetchPatientsQueue();
            await fetchSideAuditEvents();

            const afterPatient = currentPatients.find(p => p.patient_id === patientId || p.record_id === patientId) || beforeSnap;

            const evt = simData.audit_event || {};
            const weventTitle = document.getElementById("wevent-title");
            const weventSub   = document.getElementById("wevent-sub");
            if (weventTitle) weventTitle.textContent = (evt.event_type || actionName).toUpperCase().replace("_", " ");
            if (weventSub)   weventSub.textContent   = evt.patient_id ? `Patient ${evt.patient_id}` : "Queue Arbitration";

            if (beforeSnap && afterPatient) {
                document.getElementById("wbefore-id").textContent = beforeSnap.patient_id;
                document.getElementById("wbefore-rank").textContent = `Rank #${beforeSnap.rank}`;
                document.getElementById("wbefore-score").textContent = `${beforeSnap.priority_score.toFixed(1)} pts`;

                document.getElementById("wafter-id").textContent = afterPatient.patient_id;
                document.getElementById("wafter-rank").textContent = `Rank #${afterPatient.rank}`;
                document.getElementById("wafter-score").textContent = `${afterPatient.priority_score.toFixed(1)} pts`;
            }

            // Populate Rank Changes Table
            const wtableBody = document.getElementById("wtable-body");
            if (wtableBody) {
                const movedUp = simData.moved_up || [];
                const movedDown = simData.moved_down || [];
                const allChanges = [
                    ...movedUp.map(m => ({ ...m, type: "PROMOTED" })),
                    ...movedDown.map(m => ({ ...m, type: "DEMOTED" }))
                ];

                if (allChanges.length === 0) {
                    wtableBody.innerHTML = `<tr><td colspan="4" style="padding: 6px; color: var(--text-muted); text-align: center;">Queue ranking remained stable after scenario evaluation.</td></tr>`;
                } else {
                    wtableBody.innerHTML = allChanges.slice(0, 6).map(m => {
                        const isUp = m.type === "PROMOTED";
                        const moveText = isUp ? `<span style="color: var(--status-success); font-weight:700;">↑${m.rank_delta}</span>` :
                                                `<span style="color: var(--status-warning); font-weight:700;">${m.rank_delta}</span>`;
                        return `
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 6px; font-weight: 700; color: #0f172a;">${m.patient_id}</td>
                                <td style="padding: 6px; color: #64748b;">#${m.previous_rank}</td>
                                <td style="padding: 6px; font-weight: 700; color: #0f172a;">#${m.new_rank}</td>
                                <td style="padding: 6px;">${moveText}</td>
                            </tr>
                        `;
                    }).join('');
                }
            }

            // Get V3.4 AI explanation of simulation result
            const expRes = await fetch("/api/intelligence/explain-simulation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sim_result: simData,
                    before_patient: beforeSnap,
                    after_patient: afterPatient
                })
            });
            const expData = await expRes.json();

            if (aiText) aiText.innerHTML = formatAiAnswerHtml(expData.answer || "Simulation executed.");
            if (aiSource) aiSource.textContent = expData.source || "CareGrid Simulation Engine | CareGrid Arbitration Engine | CareGrid Current State";

            await fetchAttentionSignals();
        } else {
            if (aiText) aiText.innerHTML = formatAiAnswerHtml("SIMULATION COULD NOT BE COMPLETED");
        }
    } catch (err) {
        console.error("What-if simulation action failed:", err);
        if (aiText) aiText.innerHTML = formatAiAnswerHtml("SIMULATION COULD NOT BE COMPLETED");
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// V3.6 — ATTENTION INTELLIGENCE CLIENT LOGIC
// ══════════════════════════════════════════════════════════════════════════════

async function fetchAttentionSignals() {
    const container = document.getElementById("attention-cards-container");
    const badge = document.getElementById("attention-signals-count-badge");
    if (!container) return;

    try {
        const res = await fetch("/api/attention/signals");
        const data = await res.json();
        if (data.status === "success") {
            const signals = data.signals || [];
            if (badge) {
                badge.textContent = `${signals.length} ACTIVE SIGNAL${signals.length === 1 ? '' : 'S'}`;
                badge.className = signals.length > 0 ? "status-badge warning" : "status-badge admitted";
            }

            if (signals.length === 0) {
                container.innerHTML = `
                    <div style="grid-column: 1 / -1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 12px; font-weight: 600; color: #64748b;">NO SIGNIFICANT ATTENTION SIGNALS ACTIVE</span>
                        <span style="font-size: 11px; font-weight: 700; color: var(--accent-green); background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 20px; padding: 2px 10px;">OPERATIONAL STABLE</span>
                    </div>
                `;
                return;
            }

            container.innerHTML = signals.map(s => {
                const isCritical = s.severity_class === "critical";
                const isWarning = s.severity_class === "warning";
                const borderCol = isCritical ? "var(--status-critical)" : isWarning ? "#f59e0b" : "#3b82f6";
                const bgCol = isCritical ? "#fff5f5" : isWarning ? "#fffbeb" : "#eff6ff";

                let actionData = "";
                if (s.signal_type === "NEAR_TIE") {
                    actionData = `onclick="openCompareModal('${s.patient_id_a}', '${s.patient_id_b}')"`;
                } else if (s.signal_type === "MAJOR_RANK_CHANGE" || s.signal_type === "WAITING_TIME_ATTENTION") {
                    actionData = `onclick="openPatientDetailModal('${s.patient_id}')"`;
                } else {
                    actionData = `onclick="applyFilter('Critical')"`;
                }

                return `
                    <div style="background: ${bgCol}; border-left: 4px solid ${borderCol}; border-top: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <span style="font-size: 10px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: ${borderCol};">${s.badge_label}</span>
                                ${s.timestamp ? `<span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${s.timestamp.substring(11, 19)}</span>` : ''}
                            </div>
                            <h4 style="font-size: 13px; font-weight: 700; color: #0f172a; margin: 0 0 6px 0;">${s.title}</h4>
                            <p style="font-size: 12px; color: #334155; line-height: 1.45; margin: 0 0 10px 0;">${s.description}</p>
                        </div>
                        <div style="display: flex; gap: 8px; margin-top: 8px;">
                            <button class="btn-ops" ${actionData} style="padding: 5px 12px; font-size: 10.5px; background: #0f172a;">${s.action_label}</button>
                            <button class="btn-ops" onclick="explainAttentionSignal('${s.id}')" style="padding: 5px 12px; font-size: 10.5px; background: #ffffff; color: #0f172a; border: 1px solid #cbd5e1;">WHY IS THIS FLAGGED?</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (err) {
        console.error("Fetch attention signals failed:", err);
    }
}

async function explainAttentionSignal(signalId) {
    try {
        const res = await fetch("/api/attention/signals");
        const data = await res.json();
        const signal = (data.signals || []).find(s => s.id === signalId) || (data.signals || [])[0];
        if (!signal) return;

        const expRes = await fetch("/api/intelligence/explain-attention", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signal })
        });
        const expData = await expRes.json();

        // Switch to CareGrid Intelligence tab
        const navIntel = document.querySelector('[data-tab="intelligence"]');
        if (navIntel) navIntel.click();

        const ansText = document.getElementById("intel-answer-text");
        const sourceTag = document.getElementById("intel-source-tag");
        if (ansText) ansText.innerHTML = formatAiAnswerHtml(expData.answer);
        if (sourceTag) sourceTag.textContent = `SOURCE: ${expData.source}`;
    } catch (err) {
        console.error("Explain attention signal failed:", err);
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


