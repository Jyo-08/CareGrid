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

