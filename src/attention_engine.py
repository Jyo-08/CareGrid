"""
CareGrid V4.0 — Deterministic Attention Engine
Surfaces operational attention signals based strictly on actual CareGrid queue state and audit trail.

Rule:
1. Deterministic code determines whether signals are active.
2. AI DOES NOT generate or decide attention signals.
3. AI only interprets/explains active signals when requested.
"""

from typing import List, Dict, Any, Optional

class AttentionEngine:
    def __init__(self,
                 near_tie_threshold: float = 1.0,
                 major_rank_change_threshold: int = 2,
                 waiting_time_threshold: int = 120,
                 critical_load_threshold: int = 5):
        self.near_tie_threshold = near_tie_threshold
        self.major_rank_change_threshold = major_rank_change_threshold
        self.waiting_time_threshold = waiting_time_threshold
        self.critical_load_threshold = critical_load_threshold

    def evaluate_attention_signals(self, event_engine, audit_logger=None) -> List[Dict[str, Any]]:
        """
        Evaluate live CareGrid state and return prioritized deterministic attention signals.
        Signal Priority Order:
        1. MAJOR_RANK_CHANGE
        2. CRITICAL_QUEUE_LOAD
        3. WAITING_TIME_ATTENTION
        4. NEAR_TIE
        """
        signals = []

        all_patients = event_engine.get_ranked_patients() if hasattr(event_engine, "get_ranked_patients") else []
        audit_events = audit_logger.get_events(limit=30) if audit_logger else []

        # 1. MAJOR RANK CHANGE
        seen_major_pids = set()
        for evt in audit_events:
            delta = evt.get("rank_delta", 0)
            pid = evt.get("patient_id")
            if pid and abs(delta) >= self.major_rank_change_threshold and pid not in seen_major_pids:
                seen_major_pids.add(pid)
                prev_r = evt.get("previous_rank")
                new_r = evt.get("new_rank")
                signals.append({
                    "id": f"sig-major-{pid}",
                    "signal_type": "MAJOR_RANK_CHANGE",
                    "priority_order": 1,
                    "severity_class": "critical",
                    "badge_label": "MAJOR RANK CHANGE",
                    "patient_id": pid,
                    "previous_rank": prev_r,
                    "new_rank": new_r,
                    "rank_delta": delta,
                    "title": f"Major Rank Change: Patient {pid}",
                    "description": f"Patient {pid} shifted from Rank #{prev_r} → #{new_r} ({'+' if delta > 0 else ''}{delta} positions).",
                    "action_label": "VIEW AUDIT TRACE",
                    "action_type": "patient_audit",
                    "timestamp": evt.get("timestamp"),
                    "details": evt.get("reason", "")
                })

        # 2. CRITICAL QUEUE LOAD
        critical_patients = [p for p in all_patients if p.severity >= 70.0]
        if len(critical_patients) >= self.critical_load_threshold:
            signals.append({
                "id": "sig-critical-load",
                "signal_type": "CRITICAL_QUEUE_LOAD",
                "priority_order": 2,
                "severity_class": "warning",
                "badge_label": "CRITICAL QUEUE LOAD",
                "count": len(critical_patients),
                "threshold": self.critical_load_threshold,
                "title": f"High Queue Load: {len(critical_patients)} Critical Patients",
                "description": f"{len(critical_patients)} critical severity patients (SOFA severity ≥ 70.0) currently await ICU bed arbitration.",
                "action_label": "FILTER CRITICAL",
                "action_type": "filter_critical",
                "patient_ids": [p.patient_id for p in critical_patients[:5]]
            })

        # 3. WAITING-TIME ATTENTION
        for p in all_patients[:10]:
            if p.waiting_time_minutes >= self.waiting_time_threshold and p.patient_status == "Waiting":
                signals.append({
                    "id": f"sig-wait-{p.patient_id}",
                    "signal_type": "WAITING_TIME_ATTENTION",
                    "priority_order": 3,
                    "severity_class": "warning",
                    "badge_label": "WAITING-TIME ATTENTION",
                    "patient_id": p.patient_id,
                    "waiting_time_minutes": p.waiting_time_minutes,
                    "threshold": self.waiting_time_threshold,
                    "title": f"Extended Wait: Patient {p.patient_id}",
                    "description": f"Patient {p.patient_id} waiting time ({p.waiting_time_minutes} min) exceeds the configured operational attention threshold ({self.waiting_time_threshold} min).",
                    "action_label": "INSPECT PATIENT",
                    "action_type": "patient_detail"
                })

        # 4. NEAR TIE
        for i in range(len(all_patients) - 1):
            p1 = all_patients[i]
            p2 = all_patients[i + 1]
            diff = round(abs(p1.priority_score - p2.priority_score), 2)
            if diff <= self.near_tie_threshold:
                signals.append({
                    "id": f"sig-neartie-{p1.patient_id}-{p2.patient_id}",
                    "signal_type": "NEAR_TIE",
                    "priority_order": 4,
                    "severity_class": "info",
                    "badge_label": "NEAR TIE",
                    "patient_id_a": p1.patient_id,
                    "patient_id_b": p2.patient_id,
                    "score_a": round(p1.priority_score, 1),
                    "score_b": round(p2.priority_score, 1),
                    "score_diff": diff,
                    "rank_a": p1.rank,
                    "rank_b": p2.rank,
                    "title": f"Near Tie: {p1.patient_id} vs {p2.patient_id}",
                    "description": f"Patients {p1.patient_id} (Rank #{p1.rank}) and {p2.patient_id} (Rank #{p2.rank}) have closely matched priority scores (Gap: {diff} pts).",
                    "action_label": "COMPARE PAIR",
                    "action_type": "compare"
                })
                if len([s for s in signals if s["signal_type"] == "NEAR_TIE"]) >= 2:
                    break

        # Sort signals by deterministic priority order
        signals.sort(key=lambda x: (x["priority_order"], x["id"]))
        return signals
