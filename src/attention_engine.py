"""
CareGrid V5.0 — Configurable Deterministic Attention Engine
Surfaces operational attention signals based strictly on actual CareGrid queue state, audit trail,
and a centralized configurable operational policy threshold model.

Rules:
1. Centralized AttentionConfig manages configurable threshold policies.
2. Deterministic evaluation code determines whether signals are active using current config.
3. AI DOES NOT generate or decide attention signals.
4. AI only interprets/explains active signals when requested.
"""

from typing import List, Dict, Any, Optional

DEFAULT_ATTENTION_CONFIG = {
    "near_tie_threshold": 1.0,
    "critical_severity_threshold": 70.0,
    "critical_queue_load_threshold": 5,
    "waiting_time_threshold": 120,
    "major_rank_change_threshold": 2
}


class AttentionConfig:
    """Centralized configurable operational policy thresholds for Attention Engine."""
    def __init__(
        self,
        near_tie_threshold: float = 1.0,
        critical_severity_threshold: float = 70.0,
        critical_queue_load_threshold: int = 5,
        waiting_time_threshold: int = 120,
        major_rank_change_threshold: int = 2
    ):
        self.near_tie_threshold = float(near_tie_threshold)
        self.critical_severity_threshold = float(critical_severity_threshold)
        self.critical_queue_load_threshold = int(critical_queue_load_threshold)
        self.waiting_time_threshold = int(waiting_time_threshold)
        self.major_rank_change_threshold = int(major_rank_change_threshold)

    def update(self, **kwargs) -> Dict[str, Any]:
        """Validates and updates configuration thresholds."""
        if "near_tie_threshold" in kwargs and kwargs["near_tie_threshold"] is not None:
            val = float(kwargs["near_tie_threshold"])
            if val < 0:
                raise ValueError("Near-tie threshold cannot be negative")
            self.near_tie_threshold = val

        if "critical_severity_threshold" in kwargs and kwargs["critical_severity_threshold"] is not None:
            val = float(kwargs["critical_severity_threshold"])
            if val < 0.0 or val > 100.0:
                raise ValueError("Critical severity threshold must be between 0.0 and 100.0")
            self.critical_severity_threshold = val

        if "critical_queue_load_threshold" in kwargs and kwargs["critical_queue_load_threshold"] is not None:
            val = int(kwargs["critical_queue_load_threshold"])
            if val < 1:
                raise ValueError("Critical queue load threshold must be at least 1")
            self.critical_queue_load_threshold = val

        if "waiting_time_threshold" in kwargs and kwargs["waiting_time_threshold"] is not None:
            val = int(kwargs["waiting_time_threshold"])
            if val < 0:
                raise ValueError("Waiting time threshold cannot be negative")
            self.waiting_time_threshold = val

        if "major_rank_change_threshold" in kwargs and kwargs["major_rank_change_threshold"] is not None:
            val = int(kwargs["major_rank_change_threshold"])
            if val < 1:
                raise ValueError("Major rank change threshold must be at least 1")
            self.major_rank_change_threshold = val

        return self.to_dict()

    def reset_to_defaults(self) -> Dict[str, Any]:
        """Resets configuration thresholds back to V5 default baseline."""
        self.near_tie_threshold = 1.0
        self.critical_severity_threshold = 70.0
        self.critical_queue_load_threshold = 5
        self.waiting_time_threshold = 120
        self.major_rank_change_threshold = 2
        return self.to_dict()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "near_tie_threshold": self.near_tie_threshold,
            "critical_severity_threshold": self.critical_severity_threshold,
            "critical_queue_load_threshold": self.critical_queue_load_threshold,
            "waiting_time_threshold": self.waiting_time_threshold,
            "major_rank_change_threshold": self.major_rank_change_threshold
        }


class AttentionEngine:
    def __init__(
        self,
        config: Optional[AttentionConfig] = None,
        near_tie_threshold: float = 1.0,
        major_rank_change_threshold: int = 2,
        waiting_time_threshold: int = 120,
        critical_load_threshold: int = 5,
        critical_severity_threshold: float = 70.0
    ):
        if config:
            self.config = config
        else:
            self.config = AttentionConfig(
                near_tie_threshold=near_tie_threshold,
                critical_severity_threshold=critical_severity_threshold,
                critical_queue_load_threshold=critical_load_threshold,
                waiting_time_threshold=waiting_time_threshold,
                major_rank_change_threshold=major_rank_change_threshold
            )

    @property
    def near_tie_threshold(self) -> float:
        return self.config.near_tie_threshold

    @property
    def major_rank_change_threshold(self) -> int:
        return self.config.major_rank_change_threshold

    @property
    def waiting_time_threshold(self) -> int:
        return self.config.waiting_time_threshold

    @property
    def critical_load_threshold(self) -> int:
        return self.config.critical_queue_load_threshold

    @property
    def critical_severity_threshold(self) -> float:
        return self.config.critical_severity_threshold

    def evaluate_attention_signals(self, event_engine, audit_logger=None) -> List[Dict[str, Any]]:
        """
        Evaluate live CareGrid state against current configurable attention thresholds.
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
            if pid and abs(delta) >= self.config.major_rank_change_threshold and pid not in seen_major_pids:
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
                    "threshold": self.config.major_rank_change_threshold,
                    "title": f"Major Rank Change: Patient {pid}",
                    "description": f"Patient {pid} shifted from Rank #{prev_r} → #{new_r} ({'+' if delta > 0 else ''}{delta} positions, threshold ≥ {self.config.major_rank_change_threshold}).",
                    "action_label": "VIEW AUDIT TRACE",
                    "action_type": "patient_audit",
                    "timestamp": evt.get("timestamp"),
                    "details": evt.get("reason", "")
                })

        # 2. CRITICAL QUEUE LOAD
        critical_patients = [p for p in all_patients if p.severity >= self.config.critical_severity_threshold]
        if len(critical_patients) >= self.config.critical_queue_load_threshold:
            signals.append({
                "id": "sig-critical-load",
                "signal_type": "CRITICAL_QUEUE_LOAD",
                "priority_order": 2,
                "severity_class": "warning",
                "badge_label": "CRITICAL QUEUE LOAD",
                "count": len(critical_patients),
                "severity_threshold": self.config.critical_severity_threshold,
                "threshold": self.config.critical_queue_load_threshold,
                "title": f"High Queue Load: {len(critical_patients)} Critical Patients",
                "description": f"{len(critical_patients)} critical severity patients (severity ≥ {self.config.critical_severity_threshold:.1f}) currently await ICU bed arbitration (load threshold ≥ {self.config.critical_queue_load_threshold}).",
                "action_label": "FILTER CRITICAL",
                "action_type": "filter_critical",
                "patient_ids": [p.patient_id for p in critical_patients[:5]]
            })

        # 3. WAITING-TIME ATTENTION
        for p in all_patients[:10]:
            if p.waiting_time_minutes >= self.config.waiting_time_threshold and p.patient_status == "Waiting":
                signals.append({
                    "id": f"sig-wait-{p.patient_id}",
                    "signal_type": "WAITING_TIME_ATTENTION",
                    "priority_order": 3,
                    "severity_class": "warning",
                    "badge_label": "WAITING-TIME ATTENTION",
                    "patient_id": p.patient_id,
                    "waiting_time_minutes": p.waiting_time_minutes,
                    "threshold": self.config.waiting_time_threshold,
                    "title": f"Extended Wait: Patient {p.patient_id}",
                    "description": f"Patient {p.patient_id} waiting time ({p.waiting_time_minutes} min) exceeds configured operational attention threshold (≥ {self.config.waiting_time_threshold} min).",
                    "action_label": "INSPECT PATIENT",
                    "action_type": "patient_detail"
                })

        # 4. NEAR TIE
        for i in range(len(all_patients) - 1):
            p1 = all_patients[i]
            p2 = all_patients[i + 1]
            diff = round(abs(p1.priority_score - p2.priority_score), 2)
            if diff <= self.config.near_tie_threshold:
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
                    "threshold": self.config.near_tie_threshold,
                    "rank_a": p1.rank,
                    "rank_b": p2.rank,
                    "title": f"Near Tie: {p1.patient_id} vs {p2.patient_id}",
                    "description": f"Patients {p1.patient_id} (Rank #{p1.rank}) and {p2.patient_id} (Rank #{p2.rank}) have closely matched priority scores (Gap: {diff} pts ≤ {self.config.near_tie_threshold} pts).",
                    "action_label": "COMPARE PAIR",
                    "action_type": "compare"
                })
                if len([s for s in signals if s["signal_type"] == "NEAR_TIE"]) >= 2:
                    break

        # 5. V6 MULTI-ORGAN CRITICAL SIGNAL
        for p in all_patients[:10]:
            decomp = getattr(p, "get_clinical_decomposition", None)
            if callable(decomp):
                c_data = decomp()
                c_factors = c_data.get("clinical_factors", {})
                crit_organs = [k for k, v in c_factors.items() if v.get("category") == "CRITICAL"]
                if len(crit_organs) >= 2:
                    signals.append({
                        "id": f"sig-multiorgan-{p.patient_id}",
                        "signal_type": "MULTI_ORGAN_CRITICAL",
                        "priority_order": 1,
                        "severity_class": "critical",
                        "badge_label": "MULTI-ORGAN CRITICAL",
                        "patient_id": p.patient_id,
                        "critical_organs": crit_organs,
                        "title": f"Multi-Organ Failure Risk: Patient {p.patient_id}",
                        "description": f"Patient {p.patient_id} has {len(crit_organs)} critical organ system failures ({', '.join([o.capitalize() for o in crit_organs])}).",
                        "action_label": "INSPECT PATIENT",
                        "action_type": "patient_detail"
                    })

        # Sort signals by deterministic priority order
        signals.sort(key=lambda x: (x["priority_order"], x["id"]))
        return signals

