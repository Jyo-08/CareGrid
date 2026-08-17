"""
CareGrid V3.0 — Intelligence Foundation Engine
Grounded AI interaction layer built strictly on top of the CareGrid V2 deterministic state.

Rules:
1. Deterministic CareGrid engine remains the sole source of truth.
2. AI DOES NOT make ICU allocation decisions or calculate priority scores.
3. AI ONLY interprets and explains information supplied by CareGrid context.
"""

import os
import json
from typing import Dict, Any, List

SYSTEM_PROMPT = """You are CareGrid Intelligence.
You explain the current state of the CareGrid decision-support system.
You MUST use only the structured CareGrid context provided to you.
You MUST NOT invent patient information, clinical values, scores, rankings, events or outcomes.
You MUST NOT make clinical diagnoses or treatment recommendations.
You MUST NOT decide ICU allocation.
You MUST NOT override the deterministic CareGrid engine.
If the requested information is not present in the supplied context, state that the information is unavailable.
"""

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
