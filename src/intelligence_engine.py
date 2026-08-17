"""
CareGrid V3.0 / V3.1 — Intelligence Foundation Engine
Grounded AI interaction layer built strictly on top of the CareGrid V2 deterministic state.

Rules:
1. Deterministic CareGrid engine remains the sole source of truth.
2. AI DOES NOT make ICU allocation decisions or calculate priority scores.
3. AI ONLY interprets and explains information supplied by CareGrid context.
"""

import os
import json
from typing import Dict, Any, List, Optional

SYSTEM_PROMPT = """You are CareGrid Intelligence.
You explain the current state of the CareGrid decision-support system.
You MUST use only the structured CareGrid context provided to you.
You MUST NOT invent patient information, clinical values, scores, rankings, events or outcomes.
You MUST NOT make clinical diagnoses or treatment recommendations.
You MUST NOT decide ICU allocation.
You MUST NOT override the deterministic CareGrid engine.
If the requested information is not present in the supplied context, state that the information is unavailable.
"""

PATIENT_SYSTEM_PROMPT = """You are CareGrid Intelligence operating on a selected CareGrid patient.
Use ONLY the structured patient and system context supplied by CareGrid.
Never invent patient information, scores, rankings, clinical values, events or outcomes.
Never modify CareGrid state.
Never calculate or override the official CareGrid priority.
Never provide diagnosis or treatment recommendations.
Explain the deterministic result produced by CareGrid.
If information is unavailable, clearly state that it is unavailable."""

class IntelligenceEngine:
    def __init__(self, event_engine, priority_engine):
        self.event_engine = event_engine
        self.priority_engine = priority_engine

    def build_current_context(self) -> Dict[str, Any]:
        """Extract a structured snapshot of the current CareGrid state."""
        return self.get_current_snapshot()

    def get_current_snapshot(self) -> Dict[str, Any]:
        all_patients = self.event_engine.get_ranked_patients()
        top_patient = all_patients[0] if all_patients else None
        waiting_count = len([p for p in all_patients if p.patient_status == "Waiting"])
        critical_count = len([p for p in all_patients if p.severity >= 70.0])
        weights = self.priority_engine.get_weights()

        snapshot = {
            "total_patients_in_queue": len(all_patients),
            "waiting_patients_count": waiting_count,
            "critical_patients_count": critical_count,
            "occupied_beds": self.event_engine.occupied_beds,
            "total_beds": self.event_engine.total_beds,
            "available_beds": self.event_engine.total_beds - self.event_engine.occupied_beds,
            "weights": weights,
            "top_patient": top_patient.to_dict() if top_patient else None
        }
        return snapshot

    def ask(self, question: str) -> Dict[str, Any]:
        """Process a V3.0 user question grounded strictly in CareGrid state."""
        q_norm = question.strip().lower()
        snapshot = self.get_current_snapshot()
        top_p = snapshot["top_patient"]

        # Default Evidence structure
        evidence = {}
        if top_p:
            evidence = {
                "patient_id": top_p["patient_id"],
                "rank": top_p["rank"],
                "priority_score": top_p["priority_score"],
                "severity": top_p["severity"],
                "sofa_score": top_p["sofa_score"],
                "survival_likelihood": top_p["survival_likelihood"],
                "waiting_time_minutes": top_p["waiting_time_minutes"],
                "severity_contribution": top_p.get("severity_contribution", round(top_p["severity"] * snapshot["weights"]["weight_severity"], 1)),
                "survival_contribution": top_p.get("survival_contribution", round(top_p["survival_likelihood"] * snapshot["weights"]["weight_survival"], 1)),
                "waiting_contribution": top_p.get("waiting_contribution", round(min(100, top_p["waiting_time_minutes"] / 1.2) * snapshot["weights"]["weight_waiting"], 1))
            }

        context_summary = {
            "queue_size": snapshot["total_patients_in_queue"],
            "critical_count": snapshot["critical_patients_count"],
            "top_patient_id": top_p["patient_id"] if top_p else "N/A",
            "top_priority_score": top_p["priority_score"] if top_p else 0.0,
            "available_beds": snapshot["available_beds"]
        }

        # 1. QUESTION: Why is the top-ranked patient #1?
        if "why" in q_norm or "#1" in q_norm or "top" in q_norm:
            if not top_p:
                answer = "No patients are currently in the CareGrid queue."
            else:
                answer = (
                    f"Patient {top_p['patient_id']} is ranked #1 with an official priority score of "
                    f"{top_p['priority_score']:.1f}/100. The primary score drive is a SOFA organ failure severity of "
                    f"{top_p['severity']:.1f} (SOFA raw score: {top_p['sofa_score']}), contributing {evidence['severity_contribution']:.1f} points. "
                    f"Survival likelihood of {top_p['survival_likelihood']:.1f}% adds {evidence['survival_contribution']:.1f} points, "
                    f"and waiting duration equity ({top_p['waiting_time_minutes']} min pending) adds {evidence['waiting_contribution']:.1f} points."
                )

            return {
                "status": "success",
                "question": question,
                "answer": answer,
                "evidence": evidence,
                "source": "CareGrid Current Priority State",
                "context_summary": context_summary
            }

        # 2. QUESTION: Summarize the current queue.
        elif "summarize" in q_norm or "summary" in q_norm or "queue" in q_norm:
            answer = (
                f"CareGrid is currently tracking {snapshot['total_patients_in_queue']} patients. "
                f"There are {snapshot['critical_patients_count']} critical severity patients (severity ≥ 70.0) awaiting bed arbitration. "
                f"Top-ranked patient is {top_p['patient_id']} with priority score {top_p['priority_score']:.1f}/100. "
                f"ICU capacity status: {snapshot['occupied_beds']}/{snapshot['total_beds']} beds occupied ({snapshot['available_beds']} beds available)."
            )

            return {
                "status": "success",
                "question": question,
                "answer": answer,
                "evidence": evidence,
                "source": "CareGrid Current Priority State",
                "context_summary": context_summary
            }

        # 3. QUESTION: What is the current priority state?
        elif "state" in q_norm or "priority" in q_norm or "status" in q_norm or "current" in q_norm:
            answer = (
                f"CareGrid Priority Engine is ONLINE running deterministic scoring weights "
                f"({int(snapshot['weights']['weight_severity']*100)}% Severity, {int(snapshot['weights']['weight_survival']*100)}% Survival, {int(snapshot['weights']['weight_waiting']*100)}% Wait). "
                f"Highest priority candidate: Patient {top_p['patient_id']} (Priority Score: {top_p['priority_score']:.1f}). "
                f"Queue population: {snapshot['total_patients_in_queue']} total patients ({snapshot['critical_patients_count']} critical)."
            )

            return {
                "status": "success",
                "question": question,
                "answer": answer,
                "evidence": evidence,
                "source": "CareGrid Current Priority State",
                "context_summary": context_summary
            }

        # Fallback for generic/unrecognized query:
        else:
            answer = (
                f"CareGrid Intelligence is grounded strictly in current engine state. "
                f"Current top candidate is Patient {top_p['patient_id']} (Priority Score: {top_p['priority_score']:.1f}) out of {snapshot['total_patients_in_queue']} total records. "
                f"Please select one of the suggested questions or ask about queue summary, priority state, or rank #1 explanation."
            )

            return {
                "status": "success",
                "question": question,
                "answer": answer,
                "evidence": evidence,
                "source": "CareGrid Current Priority State",
                "context_summary": context_summary
            }

    def build_patient_context(self, patient_id: str) -> Optional[Dict[str, Any]]:
        """Build structured context for a specific patient from live CareGrid state."""
        all_patients = self.event_engine.get_ranked_patients()
        target_idx = next((i for i, p in enumerate(all_patients) if p.patient_id == patient_id or p.record_id == patient_id), None)
        if target_idx is None:
            return None

        target = all_patients[target_idx]
        weights = self.priority_engine.get_weights()

        # Deterministic contribution calculation (mirrors priority_engine logic)
        sev_contrib = round(target.severity * weights["weight_severity"], 1)
        surv_contrib = round(target.survival_likelihood * weights["weight_survival"], 1)
        wait_raw = min(100.0, target.waiting_time_minutes / 1.2)
        wait_contrib = round(wait_raw * weights["weight_waiting"], 1)

        # Identify neighboring queue positions
        patient_above = all_patients[target_idx - 1] if target_idx > 0 else None
        patient_below = all_patients[target_idx + 1] if target_idx < len(all_patients) - 1 else None

        context = {
            "patient": {
                "patient_id": target.patient_id,
                "rank": target.rank,
                "priority_score": round(target.priority_score, 1),
                "severity": round(target.severity, 1),
                "survival_likelihood": round(target.survival_likelihood, 1),
                "waiting_time_minutes": target.waiting_time_minutes,
                "patient_status": target.patient_status,
                "sofa_score": target.sofa_score,
            },
            "contributions": {
                "severity_contribution": sev_contrib,
                "survival_contribution": surv_contrib,
                "waiting_contribution": wait_contrib,
            },
            "weights": {
                "weight_severity_pct": int(weights["weight_severity"] * 100),
                "weight_survival_pct": int(weights["weight_survival"] * 100),
                "weight_waiting_pct": int(weights["weight_waiting"] * 100),
            },
            "queue": {
                "total_patients": len(all_patients),
                "patient_above": {
                    "patient_id": patient_above.patient_id,
                    "rank": patient_above.rank,
                    "priority_score": round(patient_above.priority_score, 1),
                } if patient_above else None,
                "patient_below": {
                    "patient_id": patient_below.patient_id,
                    "rank": patient_below.rank,
                    "priority_score": round(patient_below.priority_score, 1),
                } if patient_below else None,
            }
        }
        return context

    def _dominant_contributor(self, contributions: Dict[str, float]) -> str:
        labels = {
            "severity_contribution": "Severity",
            "survival_contribution": "Survival Likelihood",
            "waiting_contribution": "Waiting Duration"
        }
        top_key = max(contributions, key=contributions.get)
        return labels.get(top_key, top_key)

    def ask_about_patient(self, patient_id: str, mode: str, free_question: str = "") -> Dict[str, Any]:
        """
        V3.1 — Patient-specific grounded explanation.
        mode: 'why_ranked' | 'drivers' | 'simple' | 'why_not_1' | 'free'
        """
        ctx = self.build_patient_context(patient_id)
        if not ctx:
            return {
                "status": "error",
                "message": f"Patient {patient_id} not found in the current CareGrid queue.",
                "source": "CareGrid Priority Engine"
            }

        p = ctx["patient"]
        c = ctx["contributions"]
        w = ctx["weights"]
        q = ctx["queue"]
        dominant = self._dominant_contributor(c)

        # Sort contributions for structured display
        contribs_sorted = sorted([
            ("Severity", c["severity_contribution"]),
            ("Survival Likelihood", c["survival_contribution"]),
            ("Waiting Duration", c["waiting_contribution"]),
        ], key=lambda x: x[1], reverse=True)

        if mode == "why_ranked" or (mode == "free" and ("why" in free_question.lower() or "rank" in free_question.lower())):
            answer = (
                f"WHY THIS PATIENT?\n\n"
                f"Patient {p['patient_id']} is currently ranked #{p['rank']} with a CareGrid priority score of {p['priority_score']}.\n\n"
                f"SCORE EVIDENCE\n\n"
                f"Severity (SOFA-derived)\n"
                f"  Value: {p['severity']}\n"
                f"  Contribution: +{c['severity_contribution']} pts ({w['weight_severity_pct']}% weight)\n\n"
                f"Survival Likelihood\n"
                f"  Value: {p['survival_likelihood']}%\n"
                f"  Contribution: +{c['survival_contribution']} pts ({w['weight_survival_pct']}% weight)\n\n"
                f"Waiting Duration Equity\n"
                f"  Value: {p['waiting_time_minutes']} min\n"
                f"  Contribution: +{c['waiting_contribution']} pts ({w['weight_waiting_pct']}% weight)\n\n"
                f"INTERPRETATION\n\n"
                f"{dominant} is currently the largest contributor to Patient {p['patient_id']}'s calculated priority under the configured CareGrid weighting. "
                f"CareGrid currently classifies this patient as {p['patient_status']}.\n\n"
                f"SOURCE\n"
                f"CareGrid Current Patient State | CareGrid Priority Engine"
            )
            source = "CareGrid Current Patient State | CareGrid Priority Engine"

        elif mode == "drivers":
            answer = (
                f"WHAT DRIVES THIS PRIORITY?\n\n"
                f"Patient {p['patient_id']} — Priority Score: {p['priority_score']} — Rank #{p['rank']}\n\n"
            )
            labels = ["PRIMARY CONTRIBUTOR", "SECONDARY CONTRIBUTOR", "LOWER CONTRIBUTOR"]
            for i, (name, val) in enumerate(contribs_sorted):
                lbl = labels[i] if i < len(labels) else "CONTRIBUTOR"
                answer += f"{lbl}\n  {name}\n  +{val} points\n\n"
            answer += (
                f"Under the current CareGrid weighting ({w['weight_severity_pct']}% Severity / "
                f"{w['weight_survival_pct']}% Survival / {w['weight_waiting_pct']}% Waiting Duration), "
                f"{dominant} is the dominant contributor to this patient's priority score.\n\n"
                f"SOURCE\n"
                f"CareGrid Priority Engine"
            )
            source = "CareGrid Priority Engine"

        elif mode == "simple":
            second_name = contribs_sorted[1][0] if len(contribs_sorted) > 1 else ""
            answer = (
                f"Patient {p['patient_id']} is currently ranked #{p['rank']} in the CareGrid queue.\n\n"
                f"Their priority score of {p['priority_score']} is primarily driven by their {dominant.lower()} contribution ({contribs_sorted[0][1]} pts)"
                + (f", with {second_name.lower()} also contributing meaningfully ({contribs_sorted[1][1]} pts)." if second_name else ".") +
                f"\n\nCareGrid classifies this patient as {p['patient_status']}. "
                f"The score was calculated deterministically by the CareGrid Priority Engine — no clinical judgment is implied.\n\n"
                f"SOURCE\n"
                f"CareGrid Current Patient State"
            )
            source = "CareGrid Current Patient State"

        elif mode == "why_not_1":
            if p["rank"] == 1:
                answer = (
                    f"Patient {p['patient_id']} IS currently ranked #1 in the CareGrid queue with a priority score of {p['priority_score']}. "
                    f"No patient currently has a higher calculated priority score under the active CareGrid weighting.\n\n"
                    f"SOURCE\n"
                    f"CareGrid Priority Engine"
                )
            else:
                above = q.get("patient_above")
                score_gap = round(above["priority_score"] - p["priority_score"], 1) if above else "N/A"
                answer = (
                    f"WHY IS THIS PATIENT NOT RANKED #1?\n\n"
                    f"Under the current CareGrid scoring and ranking rules, Patient {p['patient_id']} is ranked #{p['rank']} "
                    f"with a calculated priority score of {p['priority_score']}.\n\n"
                )
                if above:
                    answer += (
                        f"The patient immediately above in the queue is {above['patient_id']} (Rank #{above['rank']}), "
                        f"who holds a higher calculated priority score of {above['priority_score']} — a difference of +{score_gap} points.\n\n"
                    )
                answer += (
                    f"The patients ranked above hold higher computed priority scores under the active weighting configuration "
                    f"({w['weight_severity_pct']}% Severity / {w['weight_survival_pct']}% Survival / {w['weight_waiting_pct']}% Waiting Duration). "
                    f"CareGrid has not made a clinical judgment; it has applied deterministic scoring consistently across all patients.\n\n"
                    f"SOURCE\n"
                    f"CareGrid Priority Engine | CareGrid Current Patient State"
                )
            source = "CareGrid Priority Engine | CareGrid Current Patient State"

        else:
            # Free-text fallback: return why_ranked as default
            answer = (
                f"Patient {p['patient_id']} is currently ranked #{p['rank']} with a priority score of {p['priority_score']}. "
                f"The score is composed of: Severity +{c['severity_contribution']} pts, Survival Likelihood +{c['survival_contribution']} pts, "
                f"Waiting Duration +{c['waiting_contribution']} pts. "
                f"The dominant contributor under the current CareGrid weighting is {dominant}. "
                f"Patient status: {p['patient_status']}.\n\n"
                f"SOURCE: CareGrid Current Patient State | CareGrid Priority Engine"
            )
            source = "CareGrid Current Patient State | CareGrid Priority Engine"

        return {
            "status": "success",
            "patient_id": patient_id,
            "mode": mode,
            "answer": answer,
            "contributions": c,
            "patient_snapshot": p,
            "dominant_contributor": dominant,
            "source": source,
        }

    # ──────────────────────────────────────────────────────────────────────
    # V3.2 — PATIENT COMPARISON INTELLIGENCE
    # ──────────────────────────────────────────────────────────────────────

    def compare_patients(self, pid_a: str, pid_b: str) -> Dict[str, Any]:
        """Compare two actual CareGrid patients by rank, score, and contributions."""
        ctx_a = self.build_patient_context(pid_a)
        ctx_b = self.build_patient_context(pid_b)

        if not ctx_a:
            return {"status": "error", "message": f"Patient {pid_a} not found in queue.", "source": "CareGrid Priority Engine"}
        if not ctx_b:
            return {"status": "error", "message": f"Patient {pid_b} not found in queue.", "source": "CareGrid Priority Engine"}

        pa, pb = ctx_a["patient"], ctx_b["patient"]
        ca, cb = ctx_a["contributions"], ctx_b["contributions"]
        wa = ctx_a["weights"]

        score_diff = round(abs(pa["priority_score"] - pb["priority_score"]), 2)
        higher = pa if pa["rank"] < pb["rank"] else pb
        lower  = pb if pa["rank"] < pb["rank"] else pa
        c_hi   = ca if pa["rank"] < pb["rank"] else cb
        c_lo   = cb if pa["rank"] < pb["rank"] else ca

        diffs = {
            "severity_contribution":  abs(ca["severity_contribution"]  - cb["severity_contribution"]),
            "survival_contribution":  abs(ca["survival_contribution"]  - cb["survival_contribution"]),
            "waiting_contribution":   abs(ca["waiting_contribution"]   - cb["waiting_contribution"]),
        }
        factor_labels = {
            "severity_contribution":  "Severity",
            "survival_contribution":  "Survival Likelihood",
            "waiting_contribution":   "Waiting Duration",
        }
        biggest_diff_key   = max(diffs, key=diffs.get)
        biggest_diff_label = factor_labels[biggest_diff_key]

        explanation = (
            f"WHY PATIENT {higher['patient_id']} IS CURRENTLY ABOVE {lower['patient_id']}\n\n"
            f"Under the current CareGrid scoring and ranking rules:\n"
            f"  {higher['patient_id']}: Rank #{higher['rank']} — Priority Score {higher['priority_score']}\n"
            f"  {lower['patient_id']}:  Rank #{lower['rank']} — Priority Score {lower['priority_score']}\n\n"
            f"PRIORITY DIFFERENCE: {score_diff} points\n\n"
            f"LARGEST CONTRIBUTING DIFFERENCE: {biggest_diff_label}\n"
            f"  {higher['patient_id']}: +{c_hi[biggest_diff_key]} pts\n"
            f"  {lower['patient_id']}:  +{c_lo[biggest_diff_key]} pts\n"
            f"  Gap: {diffs[biggest_diff_key]:.1f} pts\n\n"
            f"SCORE CONTRIBUTION COMPARISON\n"
            f"  {'Factor':<25} {higher['patient_id']:<14} {lower['patient_id']}\n"
            f"  {'Severity':<25} +{c_hi['severity_contribution']:<14} +{c_lo['severity_contribution']}\n"
            f"  {'Survival Likelihood':<25} +{c_hi['survival_contribution']:<14} +{c_lo['survival_contribution']}\n"
            f"  {'Waiting Duration':<25} +{c_hi['waiting_contribution']:<14} +{c_lo['waiting_contribution']}\n\n"
            f"Weighting active: {wa['weight_severity_pct']}% Severity / {wa['weight_survival_pct']}% Survival / {wa['weight_waiting_pct']}% Waiting\n\n"
            f"SOURCE\nCareGrid Priority Engine"
        )

        return {
            "status": "success",
            "patient_a": {**pa, "contributions": ca},
            "patient_b": {**pb, "contributions": cb},
            "higher_ranked": higher["patient_id"],
            "lower_ranked":  lower["patient_id"],
            "score_difference": score_diff,
            "biggest_diff_factor": biggest_diff_label,
            "factor_diffs": {factor_labels[k]: round(v, 2) for k, v in diffs.items()},
            "explanation": explanation,
            "source": "CareGrid Priority Engine",
        }

    # ──────────────────────────────────────────────────────────────────────
    # V3.3 / V3.4 — WHAT-IF INTELLIGENCE & BEFORE/AFTER EXPLANATION
    # ──────────────────────────────────────────────────────────────────────

    def interpret_whatif(self, question: str, patient_id: str = None) -> Dict[str, Any]:
        """Parse a natural-language what-if question and return a structured scenario descriptor."""
        import re
        q = question.lower()

        if "new critical" in q or "new patient" in q or "enters" in q or "arriving" in q:
            return {
                "status": "ready",
                "scenario": {"action": "new_critical_patient", "patient_id": None,
                             "description": "Simulate a new critical patient entering the CareGrid queue"},
                "source": "CareGrid Intelligence",
            }

        if "discharge" in q or "leave" in q or "remov" in q or "exit" in q:
            return {
                "status": "ready",
                "scenario": {"action": "discharge_top", "patient_id": None,
                             "description": "Simulate the top-ranked patient being discharged from the queue"},
                "source": "CareGrid Intelligence",
            }

        if "time" in q or "wait" in q or "advance" in q or "clock" in q or "delay" in q:
            match = re.search(r'(\d+)\s*min', q)
            minutes = int(match.group(1)) if match else 30
            return {
                "status": "ready",
                "scenario": {"action": "advance_time", "minutes": minutes, "patient_id": None,
                             "description": f"Advance the CareGrid waiting-time clock by {minutes} minutes"},
                "source": "CareGrid Intelligence",
            }

        if any(w in q for w in ["severity", "spike", "worsen", "deterior", "critical", "sofa"]):
            target = patient_id
            if not target:
                m = re.search(r'p-?\d+', question, re.IGNORECASE)
                if m:
                    target = m.group(0).upper().replace("P", "P-") if not m.group(0).startswith("P-") else m.group(0).upper()
            return {
                "status": "ready",
                "scenario": {"action": "severity_spike",
                             "patient_id": target,
                             "description": f"Simulate a severity spike for patient {target or '(selected patient)'}"},
                "source": "CareGrid Intelligence",
            }

        return {
            "status": "unsupported",
            "message": (
                "CareGrid cannot simulate that scenario with the currently available simulation engine.\n"
                "Supported scenarios: new critical patient | discharge top patient | advance wait clock | severity spike"
            ),
            "source": "CareGrid Intelligence",
        }

    def explain_simulation_result(self, sim_result: Dict[str, Any], before_queue: list) -> Dict[str, Any]:
        """Build a grounded before/after explanation from an actual simulation result."""
        evt       = sim_result.get("audit_event", {})
        moved_up  = sim_result.get("moved_up", [])
        moved_down = sim_result.get("moved_down", [])
        event_type = evt.get("event_type", "SIMULATION EVENT")
        patient_id = evt.get("patient_id", "")
        reason     = evt.get("reason", "")

        lines = ["WHAT CHANGED?\n"]
        if patient_id:
            lines.append(f"Event: {event_type} — Patient {patient_id}")
        else:
            lines.append(f"Event: {event_type}")
        if reason:
            lines.append(f"Reason: {reason}")
        lines.append("")

        if moved_up:
            lines.append(f"PROMOTED IN QUEUE ({len(moved_up)}):")
            for m in moved_up[:5]:
                lines.append(f"  {m['patient_id']}: #{m['previous_rank']} → #{m['new_rank']} (↑{m['rank_delta']})")
        if moved_down:
            lines.append(f"\nDEMOTED IN QUEUE ({len(moved_down)}):")
            for m in moved_down[:5]:
                lines.append(f"  {m['patient_id']}: #{m['previous_rank']} → #{m['new_rank']} ({m['rank_delta']})")

        lines.append("\nINTERPRETATION")
        if moved_up or moved_down:
            lines.append(
                f"The CareGrid deterministic priority engine recalculated rankings for all "
                f"affected patients. {len(moved_up)} patient(s) moved up; {len(moved_down)} moved down. "
                f"All changes are based on the updated priority scores computed by the CareGrid engine."
            )
        else:
            lines.append("No rank changes resulted from this simulation event. The queue order is unchanged.")

        lines.append("\nSOURCE\nCareGrid Simulation Engine | CareGrid Arbitration Engine")

        return {
            "status": "success",
            "answer": "\n".join(lines),
            "event_type": event_type,
            "moved_up": moved_up,
            "moved_down": moved_down,
            "before_queue_top5": before_queue[:5] if before_queue else [],
            "source": "CareGrid Simulation Engine | CareGrid Arbitration Engine",
        }

    # ──────────────────────────────────────────────────────────────────────
    # V3.5 — AUDIT INTELLIGENCE
    # ──────────────────────────────────────────────────────────────────────

    def summarize_audit(self, patient_id: str = None, limit: int = 10) -> Dict[str, Any]:
        """Read and summarize actual audit events. AI cannot modify audit records."""
        events = self.event_engine.audit_logger.get_events(limit=limit)
        if patient_id:
            events = [e for e in events if e.get("patient_id") == patient_id]

        if not events:
            msg = f"No audit events found{' for patient ' + patient_id if patient_id else ' in the recent log'}."
            return {"status": "success", "answer": msg, "events": [], "source": "CareGrid Audit Log"}

        lines = [f"RECENT AUDIT EVENTS — {len(events)} record(s)\n"]
        for evt in events[:8]:
            ts    = evt.get("timestamp", "")[:19] if evt.get("timestamp") else "—"
            pid   = evt.get("patient_id", "—")
            etype = evt.get("event_type", "UNKNOWN")
            reason= evt.get("reason", "")
            prev  = evt.get("previous_rank")
            new   = evt.get("new_rank")

            entry = f"{ts}\n  {etype}"
            if pid != "—": entry += f" — Patient {pid}"
            if prev and new: entry += f"\n  Rank: #{prev} → #{new}"
            if reason: entry += f"\n  {reason}"
            lines.append(entry)

        # Most significant rank change
        ranked = [e for e in events if e.get("previous_rank") and e.get("new_rank")]
        if ranked:
            big = max(ranked, key=lambda e: abs(e["previous_rank"] - e["new_rank"]))
            change = abs(big["previous_rank"] - big["new_rank"])
            lines.append(
                f"\nMOST SIGNIFICANT RECENT CHANGE\n"
                f"Patient {big.get('patient_id','—')}: #{big['previous_rank']} → #{big['new_rank']} ({change} positions)\n"
                f"Event: {big.get('event_type','UNKNOWN')}\n"
                f"Reason: {big.get('reason','—')}"
            )

        lines.append("\nSOURCE\nCareGrid Audit Log")
        return {
            "status": "success",
            "answer": "\n\n".join(lines),
            "events": events,
            "source": "CareGrid Audit Log",
        }

    # ──────────────────────────────────────────────────────────────────────
    # V3.6 — ATTENTION INTELLIGENCE (all deterministic — no AI for detection)
    # ──────────────────────────────────────────────────────────────────────

    def get_attention_signals(self, near_tie_threshold: float = None,
                               major_rank_change_threshold: int = 3,
                               waiting_time_multiplier: float = 1.5,
                               critical_load_threshold: int = 5) -> Dict[str, Any]:
        """Detect operational attention signals from live CareGrid state. Pure deterministic logic."""
        all_patients = self.event_engine.get_ranked_patients()
        threshold    = near_tie_threshold if near_tie_threshold is not None else self.priority_engine.near_tie_threshold
        signals      = []

        # 1 — NEAR-TIE DETECTION
        for i in range(len(all_patients) - 1):
            a, b = all_patients[i], all_patients[i + 1]
            diff = round(abs(a.priority_score - b.priority_score), 2)
            if diff <= threshold:
                signals.append({
                    "type": "near_tie",
                    "severity": "warning",
                    "patients": [a.patient_id, b.patient_id],
                    "ranks": [a.rank, b.rank],
                    "scores": [round(a.priority_score, 1), round(b.priority_score, 1)],
                    "difference": diff,
                    "threshold": threshold,
                    "message": f"Patients {a.patient_id} (#{a.rank}) and {b.patient_id} (#{b.rank}) have a priority score difference of {diff} (threshold: {threshold})",
                })

        # 2 — MAJOR RANK CHANGE (from audit)
        recent_events = self.event_engine.audit_logger.get_events(limit=20)
        seen_pids = set()
        for evt in recent_events:
            pid = evt.get("patient_id")
            if pid and pid not in seen_pids and evt.get("previous_rank") and evt.get("new_rank"):
                change = abs(evt["previous_rank"] - evt["new_rank"])
                if change >= major_rank_change_threshold:
                    seen_pids.add(pid)
                    signals.append({
                        "type": "major_rank_change",
                        "severity": "info",
                        "patient_id": pid,
                        "previous_rank": evt["previous_rank"],
                        "new_rank": evt["new_rank"],
                        "rank_change": change,
                        "event_type": evt.get("event_type", "UNKNOWN"),
                        "message": f"Patient {pid} moved {change} positions (#{evt['previous_rank']} → #{evt['new_rank']})",
                    })

        # 3 — WAITING-TIME ATTENTION
        wait_times = [p.waiting_time_minutes for p in all_patients]
        if wait_times:
            avg_wait = sum(wait_times) / len(wait_times)
            wait_threshold = max(120, avg_wait * waiting_time_multiplier)
            for p in all_patients:
                if p.waiting_time_minutes >= wait_threshold:
                    signals.append({
                        "type": "waiting_time_attention",
                        "severity": "warning",
                        "patient_id": p.patient_id,
                        "rank": p.rank,
                        "waiting_time_minutes": p.waiting_time_minutes,
                        "queue_average_minutes": round(avg_wait, 1),
                        "threshold_minutes": round(wait_threshold, 1),
                        "message": f"Patient {p.patient_id} waiting {p.waiting_time_minutes} min (queue avg: {avg_wait:.0f} min)",
                    })

        # 4 — CRITICAL QUEUE LOAD
        critical_count = len([p for p in all_patients if p.severity >= 70.0])
        if critical_count >= critical_load_threshold:
            signals.append({
                "type": "critical_queue_load",
                "severity": "critical",
                "critical_count": critical_count,
                "total_patients": len(all_patients),
                "threshold": critical_load_threshold,
                "message": f"{critical_count} critical patients (severity ≥ 70.0) currently in the active queue",
            })

        # Sort & cap: near-tie → top-5 by smallest gap; waiting → top-3 by longest wait
        near_ties = sorted([s for s in signals if s["type"] == "near_tie"],
                           key=lambda s: s["difference"])[:5]
        waiting   = sorted([s for s in signals if s["type"] == "waiting_time_attention"],
                           key=lambda s: -s["waiting_time_minutes"])[:3]
        others    = [s for s in signals if s["type"] not in ("near_tie", "waiting_time_attention")]
        capped_signals = near_ties + others + waiting
        total_near_ties = len([s for s in signals if s["type"] == "near_tie"])

        return {
            "status": "success",
            "signals": capped_signals,
            "signal_count": len(capped_signals),
            "total_near_ties_found": total_near_ties,
            "near_tie_threshold": threshold,
            "source": "CareGrid Current State",
        }



    def explain_attention_signal(self, signal: Dict[str, Any]) -> Dict[str, Any]:
        """Return a grounded AI explanation for a specific attention signal."""
        stype = signal.get("type", "")

        if stype == "near_tie":
            patients = signal.get("patients", [])
            scores   = signal.get("scores", [])
            diff     = signal.get("difference", 0)
            threshold= signal.get("threshold", self.priority_engine.near_tie_threshold)
            answer = (
                f"NEAR-TIE SIGNAL EXPLANATION\n\n"
                f"Patients {patients[0] if len(patients)>0 else '—'} and {patients[1] if len(patients)>1 else '—'} "
                f"have priority scores separated by only {diff} points under the current CareGrid weighting.\n\n"
                f"  {patients[0] if len(patients)>0 else '—'}: {scores[0] if len(scores)>0 else '—'}\n"
                f"  {patients[1] if len(patients)>1 else '—'}: {scores[1] if len(scores)>1 else '—'}\n"
                f"  Difference: {diff}\n\n"
                f"The configured near-tie threshold is {threshold}. Any priority difference at or below this "
                f"threshold is flagged as a near-tie signal. This is a data-driven operational signal — "
                f"CareGrid makes no clinical judgment about these patients.\n\n"
                f"SOURCE\nCareGrid Current State | CareGrid Priority Engine"
            )

        elif stype == "major_rank_change":
            pid  = signal.get("patient_id", "Unknown")
            prev = signal.get("previous_rank")
            new  = signal.get("new_rank")
            chg  = signal.get("rank_change", 0)
            etype= signal.get("event_type", "UNKNOWN")
            answer = (
                f"MAJOR RANK CHANGE SIGNAL EXPLANATION\n\n"
                f"Patient {pid} moved {chg} position(s) in the CareGrid priority queue "
                f"(#{prev} → #{new}).\n\n"
                f"Triggering event: {etype}\n\n"
                f"This movement reflects a significant recalculation by the CareGrid deterministic priority engine, "
                f"caused by a data event that substantially altered one or more priority score contributions.\n\n"
                f"SOURCE\nCareGrid Audit Log | CareGrid Priority Engine"
            )

        elif stype == "waiting_time_attention":
            pid  = signal.get("patient_id", "Unknown")
            wt   = signal.get("waiting_time_minutes", 0)
            avg  = signal.get("queue_average_minutes", 0)
            thr  = signal.get("threshold_minutes", 0)
            answer = (
                f"WAITING-TIME ATTENTION SIGNAL EXPLANATION\n\n"
                f"Patient {pid} has a recorded waiting duration of {wt} minutes. "
                f"The current queue average is {avg:.0f} minutes; the attention threshold is {thr:.0f} minutes.\n\n"
                f"This is an operational attention signal generated from the CareGrid waiting-time equity component. "
                f"It does not represent a medical emergency determination.\n\n"
                f"SOURCE\nCareGrid Current State"
            )

        elif stype == "critical_queue_load":
            count = signal.get("critical_count", 0)
            total = signal.get("total_patients", 0)
            threshold = signal.get("threshold", 5)
            answer = (
                f"CRITICAL QUEUE LOAD SIGNAL EXPLANATION\n\n"
                f"{count} out of {total} patients currently in the CareGrid queue have a severity score ≥ 70.0 "
                f"(SOFA-derived). The signal threshold is {threshold} critical patients.\n\n"
                f"This indicates elevated operational load on the CareGrid priority queue. "
                f"It does not represent a clinical decision or medical recommendation.\n\n"
                f"SOURCE\nCareGrid Current State"
            )

        else:
            answer = f"CareGrid flagged this signal based on current queue state data.\n\nSOURCE\nCareGrid Current State"

        return {
            "status": "success",
            "signal_type": stype,
            "answer": answer,
            "source": "CareGrid Current State | CareGrid Priority Engine",
        }


