"""
CareGrid V5.0 - What-If Simulation Engine Module
Provides state-isolated hypothetical scenario simulation for CareGrid V5.0.
Reuses the exact existing CareGrid PriorityEngine and ranking logic on deep-cloned sandbox state.
ABSOLUTE RULE: Live patient data, live scores, and production database/audit log are NEVER modified.
"""

import copy
from typing import Dict, Any, List, Optional
from src.data_loader import DataLoader
from src.patient_model import Patient
from src.event_engine import EventEngine
from src.priority_engine import PriorityEngine


class SimulationEngine:
    def __init__(self, data_loader: DataLoader, event_engine: EventEngine):
        self.data_loader = data_loader
        self.event_engine = event_engine
        self._counter = 100

    def seed_initial_state(self):
        """Loads dataset and seeds initial patient population."""
        patients = self.data_loader.load_patients()
        self.event_engine.load_patients(patients)

    def reset_simulation(self) -> Dict[str, Any]:
        """Resets simulation state back to original raw dataset state."""
        self.event_engine.audit_logger.clear()
        self.event_engine.total_beds = 50
        self.event_engine.occupied_beds = 42
        self.seed_initial_state()
        return {
            "status": "success",
            "message": "Simulation state reset to original dataset baseline",
            "total_patients": len(self.event_engine.patients_map)
        }

    def simulate_new_critical_patient(self) -> Dict[str, Any]:
        """Simulates arrival of a new high-severity emergency patient (SOFA 18)."""
        self._counter += 1
        rec_id = f"99{self._counter}"
        patient = Patient(
            record_id=rec_id,
            sofa_score=18.0,            # Severity = 90.0
            survival_likelihood=92.0,   # High survival potential
            waiting_time_minutes=5,
            arrival_time="2025-08-17",
            patient_status="Waiting",
            name=f"EMERGENCY ARRIVAL P-{rec_id}"
        )
        result = self.event_engine.process_event(
            event_type="NEW_PATIENT",
            new_value=patient,
            reason="EMERGENCY STAT: Incoming polytrauma patient requiring immediate ICU bed arbitration"
        )
        return result

    def simulate_patient_severity_spike(self, patient_id: str = "P-137517") -> Dict[str, Any]:
        """Simulates sudden clinical deterioration (SOFA score spike to 19)."""
        result = self.event_engine.process_event(
            event_type="SEVERITY_UPDATED",
            patient_id=patient_id,
            new_value=19.0,
            reason=f"CRITICAL ALERT: Rapid septic deterioration in patient {patient_id} (SOFA spiked to 19)"
        )
        return result

    def simulate_advance_time(self, minutes: int = 30) -> Dict[str, Any]:
        """Advances waiting duration across all pending patients."""
        result = self.event_engine.process_event(
            event_type="WAITING_TIME_ADVANCED",
            new_value=minutes,
            reason=f"SIMULATION: Advanced waiting queue clock by +{minutes} minutes"
        )
        return result

    def simulate_discharge_top_patient(self) -> Dict[str, Any]:
        ranked = self.event_engine.get_ranked_patients()
        if not ranked:
            return {"status": "error", "message": "Queue is empty"}
        top_patient = ranked[0]
        result = self.event_engine.process_event(
            event_type="PATIENT_DISCHARGED",
            patient_id=top_patient.patient_id,
            reason=f"ICU Allocation/Discharge completed for top patient {top_patient.patient_id}"
        )
        return result


import copy

class WhatIfSimulationEngine:
    """
    CareGrid V5.0 State-Isolated What-If Engine.
    Executes hypothetical multi-factor scenario testing on deep-cloned sandbox copies.
    REUSES existing PriorityEngine & rankingComparator logic without mutating live state.
    """
    def __init__(self, priority_engine: PriorityEngine):
        self.priority_engine = priority_engine

    def run_what_if_scenario(
        self,
        live_patients: List[Patient],
        patient_id: str,
        scenario_changes: Dict[str, Any],
        capacity_change: Optional[int] = 0
    ) -> Dict[str, Any]:
        """
        Runs a hypothetical What-If scenario on a deep copy of live patient data.
        NEVER modifies live_patients or live application state.
        Reuses the exact existing CareGrid PriorityEngine.
        """
        if not live_patients:
            return {"status": "error", "message": "Live patient queue is empty"}

        # 1. Rank live queue to establish BEFORE baseline
        live_queue = self.priority_engine.rank_patients([copy.deepcopy(p) for p in live_patients])
        before_ranks = {p.patient_id: p.rank for p in live_queue}
        before_scores = {p.patient_id: p.priority_score for p in live_queue}

        target_live = next((p for p in live_queue if p.patient_id == patient_id), None)
        if not target_live:
            return {"status": "error", "message": f"Patient {patient_id} not found in live queue"}

        # Capture BEFORE state snapshot
        before_snapshot = {
            "patient_id": target_live.patient_id,
            "rank": target_live.rank,
            "priority_score": target_live.priority_score,
            "sofa_score": target_live.sofa_score,
            "severity": target_live.severity,
            "survival_likelihood": target_live.survival_likelihood,
            "waiting_time_minutes": target_live.waiting_time_minutes,
            "severity_contribution": target_live.severity_contribution,
            "survival_contribution": target_live.survival_contribution,
            "waiting_contribution": target_live.waiting_contribution
        }

        # 2. Deep clone live queue to construct SIMULATION STATE
        sim_queue = [copy.deepcopy(p) for p in live_patients]
        target_sim = next((p for p in sim_queue if p.patient_id == patient_id), None)

        event_details = []

        # Apply scenario factor changes safely
        if "waiting_time_minutes" in scenario_changes and scenario_changes["waiting_time_minutes"] is not None:
            old_wait = target_sim.waiting_time_minutes
            new_wait = max(0, int(scenario_changes["waiting_time_minutes"]))
            target_sim.waiting_time_minutes = new_wait
            diff = new_wait - old_wait
            event_details.append({
                "factor": "Waiting Time",
                "before": f"{old_wait} min",
                "after": f"{new_wait} min",
                "change": f"{'+' if diff >= 0 else ''}{diff} min"
            })

        if "sofa_score" in scenario_changes and scenario_changes["sofa_score"] is not None:
            old_sofa = target_sim.sofa_score
            new_sofa = float(scenario_changes["sofa_score"])
            target_sim.update_severity(new_sofa, event_trigger="SIMULATED_SOFA_UPDATE")
            diff = round(new_sofa - old_sofa, 1)
            event_details.append({
                "factor": "SOFA Severity",
                "before": f"SOFA {old_sofa:.1f} (Sev {before_snapshot['severity']})",
                "after": f"SOFA {new_sofa:.1f} (Sev {target_sim.severity})",
                "change": f"{'+' if diff >= 0 else ''}{diff} SOFA pts"
            })

        if "survival_likelihood" in scenario_changes and scenario_changes["survival_likelihood"] is not None:
            old_surv = target_sim.survival_likelihood
            new_surv = max(0.0, min(100.0, float(scenario_changes["survival_likelihood"])))
            target_sim.survival_likelihood = round(new_surv, 2)
            diff = round(new_surv - old_surv, 1)
            event_details.append({
                "factor": "Survival Likelihood",
                "before": f"{old_surv:.1f}%",
                "after": f"{new_surv:.1f}%",
                "change": f"{'+' if diff >= 0 else ''}{diff}%"
            })

        # 3. Recalculate priority scores & re-rank using EXISTING PriorityEngine
        sim_ranked = self.priority_engine.rank_patients(sim_queue)
        after_ranks = {p.patient_id: p.rank for p in sim_ranked}
        after_scores = {p.patient_id: p.priority_score for p in sim_ranked}

        target_after = next((p for p in sim_ranked if p.patient_id == patient_id), None)

        # Capture AFTER state snapshot
        after_snapshot = {
            "patient_id": target_after.patient_id,
            "rank": target_after.rank,
            "priority_score": target_after.priority_score,
            "sofa_score": target_after.sofa_score,
            "severity": target_after.severity,
            "survival_likelihood": target_after.survival_likelihood,
            "waiting_time_minutes": target_after.waiting_time_minutes,
            "severity_contribution": target_after.severity_contribution,
            "survival_contribution": target_after.survival_contribution,
            "waiting_contribution": target_after.waiting_contribution
        }

        # 4. Compute deltas & rank shifts
        score_delta = round(after_snapshot['priority_score'] - before_snapshot['priority_score'], 2)
        rank_delta = before_snapshot['rank'] - after_snapshot['rank']  # Positive means moved UP in rank (#3 -> #1 = +2)

        factor_deltas = {
            "severity_contribution": round(after_snapshot["severity_contribution"] - before_snapshot["severity_contribution"], 2),
            "survival_contribution": round(after_snapshot["survival_contribution"] - before_snapshot["survival_contribution"], 2),
            "waiting_contribution": round(after_snapshot["waiting_contribution"] - before_snapshot["waiting_contribution"], 2)
        }

        # Determine dominant contribution driver
        dominant_factor = max(factor_deltas.items(), key=lambda x: abs(x[1]))
        driver_name = {
            "severity_contribution": "Severity (SOFA) contribution",
            "survival_contribution": "Survival potential contribution",
            "waiting_contribution": "Waiting duration equity contribution"
        }[dominant_factor[0]]

        # Affected patient rank shifts across full queue
        affected_patients = []
        for p_id, b_r in before_ranks.items():
            a_r = after_ranks.get(p_id)
            if a_r and b_r != a_r:
                r_diff = b_r - a_r
                affected_patients.append({
                    "patient_id": p_id,
                    "before_rank": b_r,
                    "after_rank": a_r,
                    "rank_shift": f"#{b_r} -> #{a_r} ({'UP ' + str(r_diff) if r_diff > 0 else 'DOWN ' + str(abs(r_diff))})",
                    "priority_score": after_scores.get(p_id)
                })

        affected_patients.sort(key=lambda x: x["after_rank"])

        # Grounded deterministic explanation (Strictly NO emojis)
        if rank_delta > 0:
            rank_text = f"moved UP by {rank_delta} position(s) from Rank #{before_snapshot['rank']} to Rank #{after_snapshot['rank']}"
        elif rank_delta < 0:
            rank_text = f"moved DOWN by {abs(rank_delta)} position(s) from Rank #{before_snapshot['rank']} to Rank #{after_snapshot['rank']}"
        else:
            rank_text = f"remained unchanged at Rank #{before_snapshot['rank']}"

        explanation_text = (
            f"WHAT-IF SIMULATION SUMMARY: Under the tested scenario, Patient {patient_id}'s priority score changed "
            f"from {before_snapshot['priority_score']:.1f} to {after_snapshot['priority_score']:.1f} ({'+' if score_delta >= 0 else ''}{score_delta:.1f} pts). "
            f"Consequently, Patient {patient_id} {rank_text}. The primary driver of this shift was the {driver_name} "
            f"({'+' if dominant_factor[1] >= 0 else ''}{dominant_factor[1]:.1f} pts contribution delta). "
            f"Live CareGrid state and production queue remain 100% unchanged."
        )

        return {
            "status": "success",
            "is_simulated": True,
            "patient_id": patient_id,
            "before_state": before_snapshot,
            "event_details": event_details,
            "after_state": after_snapshot,
            "impact_summary": {
                "score_delta": score_delta,
                "rank_delta": rank_delta,
                "factor_deltas": factor_deltas,
                "primary_driver": driver_name,
                "dominant_delta": dominant_factor[1]
            },
            "affected_rank_shifts": affected_patients[:10],
            "deterministic_explanation": explanation_text,
            "source": "CareGrid Priority Engine (Isolated Simulation Copy)"
        }

    def run_organ_what_if_scenario(
        self,
        live_patients: List[Patient],
        patient_id: str,
        organ_system: str,
        target_score: float
    ) -> Dict[str, Any]:
        """
        CareGrid V6 Organ-System What-If Simulation.
        Tests hypothetical organ deterioration or improvement (e.g. Respiratory severity 80.0)
        on a deep-cloned sandbox copy of live queue state.
        Calculates BEFORE, SCENARIO, AFTER, and DELTA metrics without mutating live queue.
        """
        if not live_patients:
            return {"status": "error", "message": "Live patient queue is empty"}

        # 1. Baseline ranking
        live_queue = self.priority_engine.rank_patients([copy.deepcopy(p) for p in live_patients])
        before_ranks = {p.patient_id: p.rank for p in live_queue}
        target_live = next((p for p in live_queue if p.patient_id == patient_id), None)
        if not target_live:
            return {"status": "error", "message": f"Patient {patient_id} not found in live queue"}

        before_clin_sev = target_live.get_clinical_severity()
        before_organ_info = before_clin_sev["organ_systems"].get(organ_system.lower(), {})
        before_organ_score = before_organ_info.get("score", 0.0)

        before_snapshot = {
            "patient_id": target_live.patient_id,
            "rank": target_live.rank,
            "priority_score": target_live.priority_score,
            "sofa_score": target_live.sofa_score,
            "overall_severity": target_live.severity,
            "organ_system": organ_system.capitalize(),
            "organ_score": before_organ_score,
            "organ_category": before_organ_info.get("category", "N/A"),
            "severity_contribution": target_live.severity_contribution,
            "survival_contribution": target_live.survival_contribution,
            "waiting_contribution": target_live.waiting_contribution
        }

        # 2. Deep clone for simulation
        sim_queue = [copy.deepcopy(p) for p in live_patients]
        target_sim = next((p for p in sim_queue if p.patient_id == patient_id), None)

        # Map target organ score (0-100) to subscore (0-4) and adjust SOFA
        new_organ_score = max(0.0, min(100.0, float(target_score)))
        new_subscore = int(round(new_organ_score / 25.0))
        old_subscore = before_organ_info.get("sofa_subscore", 0)

        sub_diff = new_subscore - old_subscore
        new_total_sofa = max(0.0, min(24.0, target_sim.sofa_score + sub_diff))
        target_sim.update_severity(new_total_sofa, event_trigger="ORGAN_WHAT_IF_SIMULATION")

        # 3. Recalculate Priority and Rerank
        sim_ranked = self.priority_engine.rank_patients(sim_queue)
        after_ranks = {p.patient_id: p.rank for p in sim_ranked}
        target_after = next((p for p in sim_ranked if p.patient_id == patient_id), None)
        after_clin_sev = target_after.get_clinical_severity()
        after_organ_info = after_clin_sev["organ_systems"].get(organ_system.lower(), {})

        after_snapshot = {
            "patient_id": target_after.patient_id,
            "rank": target_after.rank,
            "priority_score": target_after.priority_score,
            "sofa_score": target_after.sofa_score,
            "overall_severity": target_after.severity,
            "organ_system": organ_system.capitalize(),
            "organ_score": new_organ_score,
            "organ_category": after_organ_info.get("category", "Simulated"),
            "severity_contribution": target_after.severity_contribution,
            "survival_contribution": target_after.survival_contribution,
            "waiting_contribution": target_after.waiting_contribution
        }

        score_delta = round(after_snapshot['priority_score'] - before_snapshot['priority_score'], 2)
        rank_delta = before_snapshot['rank'] - after_snapshot['rank']  # Positive = moved UP (#8 -> #4 = +4)
        organ_delta = round(new_organ_score - before_organ_score, 1)
        severity_delta = round(after_snapshot['overall_severity'] - before_snapshot['overall_severity'], 1)

        # Affected patient rank shifts
        affected_patients = []
        for p_id, b_r in before_ranks.items():
            a_r = after_ranks.get(p_id)
            if a_r and b_r != a_r:
                r_diff = b_r - a_r
                affected_patients.append({
                    "patient_id": p_id,
                    "before_rank": b_r,
                    "after_rank": a_r,
                    "rank_shift": f"#{b_r} -> #{a_r} ({'UP ' + str(r_diff) if r_diff > 0 else 'DOWN ' + str(abs(r_diff))})"
                })

        explanation_text = (
            f"V6 ORGAN WHAT-IF SUMMARY: Adjusting {organ_system.capitalize()} severity for Patient {patient_id} "
            f"from {before_organ_score:.0f} to {new_organ_score:.0f} ({'+' if organ_delta >= 0 else ''}{organ_delta:.0f} pts) "
            f"changed Overall Severity from {before_snapshot['overall_severity']:.1f} to {after_snapshot['overall_severity']:.1f} "
            f"and Priority Score from {before_snapshot['priority_score']:.1f} to {after_snapshot['priority_score']:.1f}. "
            f"Rank Shift: #{before_snapshot['rank']} -> #{after_snapshot['rank']} ({'+' if rank_delta >= 0 else ''}{rank_delta}). "
            f"Live CareGrid state remains 100% untouched."
        )

        return {
            "status": "success",
            "is_simulated": True,
            "patient_id": patient_id,
            "organ_system": organ_system.capitalize(),
            "before_state": before_snapshot,
            "after_state": after_snapshot,
            "impact_summary": {
                "organ_delta": organ_delta,
                "severity_delta": severity_delta,
                "score_delta": score_delta,
                "rank_delta": rank_delta,
                "rank_transition": f"#{before_snapshot['rank']} -> #{after_snapshot['rank']}"
            },
            "affected_rank_shifts": affected_patients[:10],
            "deterministic_explanation": explanation_text,
            "source": "CareGrid V6 Organ Severity Engine (Sandbox Copy)"
        }


class WhatIfSimulationEngine:
    """
    CareGrid V5.0 State-Isolated What-If Engine.
    Executes hypothetical multi-factor scenario testing on deep-cloned sandbox copies.
    REUSES existing PriorityEngine & rankingComparator logic without mutating live state.
    """
    def __init__(self, priority_engine: PriorityEngine):
        self.priority_engine = priority_engine

    def run_what_if_scenario(
        self,
        live_patients: List[Patient],
        patient_id: str,
        scenario_changes: Dict[str, Any],
        capacity_change: Optional[int] = 0
    ) -> Dict[str, Any]:
        """
        Runs a hypothetical What-If scenario on a deep copy of live patient data.
        NEVER modifies live_patients or live application state.
        Reuses the exact existing CareGrid PriorityEngine.
        """
        if not live_patients:
            return {"status": "error", "message": "Live patient queue is empty"}

        # 1. Rank live queue to establish BEFORE baseline
        live_queue = self.priority_engine.rank_patients([copy.deepcopy(p) for p in live_patients])
        before_ranks = {p.patient_id: p.rank for p in live_queue}
        before_scores = {p.patient_id: p.priority_score for p in live_queue}

        target_live = next((p for p in live_queue if p.patient_id == patient_id), None)
        if not target_live:
            return {"status": "error", "message": f"Patient {patient_id} not found in live queue"}

        # Capture BEFORE state snapshot
        before_snapshot = {
            "patient_id": target_live.patient_id,
            "rank": target_live.rank,
            "priority_score": target_live.priority_score,
            "sofa_score": target_live.sofa_score,
            "severity": target_live.severity,
            "survival_likelihood": target_live.survival_likelihood,
            "waiting_time_minutes": target_live.waiting_time_minutes,
            "severity_contribution": target_live.severity_contribution,
            "survival_contribution": target_live.survival_contribution,
            "waiting_contribution": target_live.waiting_contribution
        }

        # 2. Deep clone live queue to construct SIMULATION STATE
        sim_queue = [copy.deepcopy(p) for p in live_patients]
        target_sim = next((p for p in sim_queue if p.patient_id == patient_id), None)

        event_details = []

        # Apply scenario factor changes safely
        if "waiting_time_minutes" in scenario_changes and scenario_changes["waiting_time_minutes"] is not None:
            old_wait = target_sim.waiting_time_minutes
            new_wait = max(0, int(scenario_changes["waiting_time_minutes"]))
            target_sim.waiting_time_minutes = new_wait
            diff = new_wait - old_wait
            event_details.append({
                "factor": "Waiting Time",
                "before": f"{old_wait} min",
                "after": f"{new_wait} min",
                "change": f"{'+' if diff >= 0 else ''}{diff} min"
            })

        if "sofa_score" in scenario_changes and scenario_changes["sofa_score"] is not None:
            old_sofa = target_sim.sofa_score
            new_sofa = float(scenario_changes["sofa_score"])
            target_sim.update_severity(new_sofa, event_trigger="SIMULATED_SOFA_UPDATE")
            diff = round(new_sofa - old_sofa, 1)
            event_details.append({
                "factor": "SOFA Severity",
                "before": f"SOFA {old_sofa:.1f} (Sev {before_snapshot['severity']})",
                "after": f"SOFA {new_sofa:.1f} (Sev {target_sim.severity})",
                "change": f"{'+' if diff >= 0 else ''}{diff} SOFA pts"
            })

        if "survival_likelihood" in scenario_changes and scenario_changes["survival_likelihood"] is not None:
            old_surv = target_sim.survival_likelihood
            new_surv = max(0.0, min(100.0, float(scenario_changes["survival_likelihood"])))
            target_sim.survival_likelihood = round(new_surv, 2)
            diff = round(new_surv - old_surv, 1)
            event_details.append({
                "factor": "Survival Likelihood",
                "before": f"{old_surv:.1f}%",
                "after": f"{new_surv:.1f}%",
                "change": f"{'+' if diff >= 0 else ''}{diff}%"
            })

        # 3. Recalculate priority scores & re-rank using EXISTING PriorityEngine
        sim_ranked = self.priority_engine.rank_patients(sim_queue)
        after_ranks = {p.patient_id: p.rank for p in sim_ranked}
        after_scores = {p.patient_id: p.priority_score for p in sim_ranked}

        target_after = next((p for p in sim_ranked if p.patient_id == patient_id), None)

        # Capture AFTER state snapshot
        after_snapshot = {
            "patient_id": target_after.patient_id,
            "rank": target_after.rank,
            "priority_score": target_after.priority_score,
            "sofa_score": target_after.sofa_score,
            "severity": target_after.severity,
            "survival_likelihood": target_after.survival_likelihood,
            "waiting_time_minutes": target_after.waiting_time_minutes,
            "severity_contribution": target_after.severity_contribution,
            "survival_contribution": target_after.survival_contribution,
            "waiting_contribution": target_after.waiting_contribution
        }

        # 4. Compute deltas & rank shifts
        score_delta = round(after_snapshot['priority_score'] - before_snapshot['priority_score'], 2)
        rank_delta = before_snapshot['rank'] - after_snapshot['rank']  # Positive means moved UP in rank (#3 -> #1 = +2)

        factor_deltas = {
            "severity_contribution": round(after_snapshot["severity_contribution"] - before_snapshot["severity_contribution"], 2),
            "survival_contribution": round(after_snapshot["survival_contribution"] - before_snapshot["survival_contribution"], 2),
            "waiting_contribution": round(after_snapshot["waiting_contribution"] - before_snapshot["waiting_contribution"], 2)
        }

        # Determine dominant contribution driver
        dominant_factor = max(factor_deltas.items(), key=lambda x: abs(x[1]))
        driver_name = {
            "severity_contribution": "Severity (SOFA) contribution",
            "survival_contribution": "Survival potential contribution",
            "waiting_contribution": "Waiting duration equity contribution"
        }[dominant_factor[0]]

        # Affected patient rank shifts across full queue
        affected_patients = []
        for p_id, b_r in before_ranks.items():
            a_r = after_ranks.get(p_id)
            if a_r and b_r != a_r:
                r_diff = b_r - a_r
                affected_patients.append({
                    "patient_id": p_id,
                    "before_rank": b_r,
                    "after_rank": a_r,
                    "rank_shift": f"#{b_r} → #{a_r} ({'↑' if r_diff > 0 else '↓'}{abs(r_diff)})",
                    "priority_score": after_scores.get(p_id)
                })

        affected_patients.sort(key=lambda x: x["after_rank"])

        # Grounded deterministic explanation
        if rank_delta > 0:
            rank_text = f"moved UP by {rank_delta} position(s) from Rank #{before_snapshot['rank']} to Rank #{after_snapshot['rank']}"
        elif rank_delta < 0:
            rank_text = f"moved DOWN by {abs(rank_delta)} position(s) from Rank #{before_snapshot['rank']} to Rank #{after_snapshot['rank']}"
        else:
            rank_text = f"remained unchanged at Rank #{before_snapshot['rank']}"

        explanation_text = (
            f"WHAT-IF SIMULATION SUMMARY: Under the tested scenario, Patient {patient_id}'s priority score changed "
            f"from {before_snapshot['priority_score']:.1f} to {after_snapshot['priority_score']:.1f} ({'+' if score_delta >= 0 else ''}{score_delta:.1f} pts). "
            f"Consequently, Patient {patient_id} {rank_text}. The primary driver of this shift was the {driver_name} "
            f"({'+' if dominant_factor[1] >= 0 else ''}{dominant_factor[1]:.1f} pts contribution delta). "
            f"Live CareGrid state and production queue remain 100% unchanged."
        )

        return {
            "status": "success",
            "is_simulated": True,
            "patient_id": patient_id,
            "before_state": before_snapshot,
            "event_details": event_details,
            "after_state": after_snapshot,
            "impact_summary": {
                "score_delta": score_delta,
                "rank_delta": rank_delta,
                "factor_deltas": factor_deltas,
                "primary_driver": driver_name,
                "dominant_delta": dominant_factor[1]
            },
            "affected_rank_shifts": affected_patients[:10],
            "deterministic_explanation": explanation_text,
            "source": "CareGrid Priority Engine (Isolated Simulation Copy)"
        }


    def run_organ_what_if_scenario(
        self,
        live_patients: List[Patient],
        patient_id: str,
        organ_system: str,
        target_score: float
    ) -> Dict[str, Any]:
        if not live_patients:
            return {"status": "error", "message": "Live patient queue is empty"}

        live_queue = self.priority_engine.rank_patients([copy.deepcopy(p) for p in live_patients])
        before_ranks = {p.patient_id: p.rank for p in live_queue}
        target_live = next((p for p in live_queue if p.patient_id == patient_id), None)
        if not target_live:
            return {"status": "error", "message": f"Patient {patient_id} not found in live queue"}

        before_clin_sev = target_live.get_clinical_severity()
        before_organ_info = before_clin_sev["organ_systems"].get(organ_system.lower(), {})
        before_organ_score = before_organ_info.get("score", 0.0)

        before_snapshot = {
            "patient_id": target_live.patient_id,
            "rank": target_live.rank,
            "priority_score": target_live.priority_score,
            "sofa_score": target_live.sofa_score,
            "overall_severity": target_live.severity,
            "organ_system": organ_system.capitalize(),
            "organ_score": before_organ_score,
            "organ_category": before_organ_info.get("category", "N/A"),
            "severity_contribution": target_live.severity_contribution,
            "survival_contribution": target_live.survival_contribution,
            "waiting_contribution": target_live.waiting_contribution
        }

        sim_queue = [copy.deepcopy(p) for p in live_patients]
        target_sim = next((p for p in sim_queue if p.patient_id == patient_id), None)

        new_organ_score = max(0.0, min(100.0, float(target_score)))
        new_subscore = int(round(new_organ_score / 25.0))
        old_subscore = before_organ_info.get("sofa_subscore", 0)

        sub_diff = new_subscore - old_subscore
        new_total_sofa = max(0.0, min(24.0, target_sim.sofa_score + sub_diff))
        target_sim.update_severity(new_total_sofa, event_trigger="ORGAN_WHAT_IF_SIMULATION")

        sim_ranked = self.priority_engine.rank_patients(sim_queue)
        after_ranks = {p.patient_id: p.rank for p in sim_ranked}
        target_after = next((p for p in sim_ranked if p.patient_id == patient_id), None)
        after_clin_sev = target_after.get_clinical_severity()
        after_organ_info = after_clin_sev["organ_systems"].get(organ_system.lower(), {})

        after_snapshot = {
            "patient_id": target_after.patient_id,
            "rank": target_after.rank,
            "priority_score": target_after.priority_score,
            "sofa_score": target_after.sofa_score,
            "overall_severity": target_after.severity,
            "organ_system": organ_system.capitalize(),
            "organ_score": new_organ_score,
            "organ_category": after_organ_info.get("category", "Simulated"),
            "severity_contribution": target_after.severity_contribution,
            "survival_contribution": target_after.survival_contribution,
            "waiting_contribution": target_after.waiting_contribution
        }

        score_delta = round(after_snapshot['priority_score'] - before_snapshot['priority_score'], 2)
        rank_delta = before_snapshot['rank'] - after_snapshot['rank']
        organ_delta = round(new_organ_score - before_organ_score, 1)
        severity_delta = round(after_snapshot['overall_severity'] - before_snapshot['overall_severity'], 1)

        affected_patients = []
        for p_id, b_r in before_ranks.items():
            a_r = after_ranks.get(p_id)
            if a_r and b_r != a_r:
                r_diff = b_r - a_r
                shift_str = f"#{b_r} -> #{a_r} (UP {r_diff})" if r_diff > 0 else f"#{b_r} -> #{a_r} (DOWN {abs(r_diff)})"
                affected_patients.append({
                    "patient_id": p_id,
                    "before_rank": b_r,
                    "after_rank": a_r,
                    "rank_shift": shift_str
                })

        explanation_text = (
            f"V6 ORGAN WHAT-IF SUMMARY: Adjusting {organ_system.capitalize()} severity for Patient {patient_id} "
            f"from {before_organ_score:.0f} to {new_organ_score:.0f} changed Overall Severity from {before_snapshot['overall_severity']:.1f} to {after_snapshot['overall_severity']:.1f} "
            f"and Priority Score from {before_snapshot['priority_score']:.1f} to {after_snapshot['priority_score']:.1f}. "
            f"Rank Shift: #{before_snapshot['rank']} -> #{after_snapshot['rank']}. Live CareGrid state remains 100% untouched."
        )

        return {
            "status": "success",
            "is_simulated": True,
            "patient_id": patient_id,
            "organ_system": organ_system.capitalize(),
            "before_state": before_snapshot,
            "after_state": after_snapshot,
            "impact_summary": {
                "organ_delta": organ_delta,
                "severity_delta": severity_delta,
                "score_delta": score_delta,
                "rank_delta": rank_delta,
                "rank_transition": f"#{before_snapshot['rank']} -> #{after_snapshot['rank']}"
            },
            "affected_rank_shifts": affected_patients[:10],
            "deterministic_explanation": explanation_text,
            "source": "CareGrid V6 Organ Severity Engine (Sandbox Copy)"
        }
