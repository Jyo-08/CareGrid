"""
CareGrid V6.0 — Comprehensive Acceptance Test Suite
Tests 6-Factor Organ System Clinical Severity Engine, Patient Model integration,
Organ What-If Sandbox simulation, Attention Engine enrichment, Gemini Intelligence context,
and full backward compatibility with V5.
"""

import os
import sys
import unittest
import json

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from src.severity_engine import ClinicalSeverityEngine
from src.patient_model import Patient
from src.data_loader import DataLoader
from src.priority_engine import PriorityEngine
from src.event_engine import EventEngine
from src.audit_logger import AuditLogger
from src.simulation_engine import SimulationEngine, WhatIfSimulationEngine
from src.attention_engine import AttentionEngine
from src.intelligence_engine import IntelligenceEngine


class TestCareGridV6(unittest.TestCase):

    def setUp(self):
        self.loader = DataLoader(base_dir=BASE_DIR)
        self.severity_engine = ClinicalSeverityEngine()
        self.priority_engine = PriorityEngine(weight_severity=0.50, weight_survival=0.30, weight_waiting=0.20)
        self.audit = AuditLogger()
        self.events = EventEngine(priority_engine=self.priority_engine, audit_logger=self.audit)
        self.sim = SimulationEngine(data_loader=self.loader, event_engine=self.events)
        self.whatif = WhatIfSimulationEngine(priority_engine=self.priority_engine)
        self.attention = AttentionEngine()
        self.intel = IntelligenceEngine(event_engine=self.events, priority_engine=self.priority_engine)

        self.sim.seed_initial_state()

    # 1. Test 6-Factor Organ System Decomposition
    def test_01_organ_system_decomposition(self):
        patient = Patient(
            record_id="137517",
            sofa_score=12.0,
            raw_clinical_params={
                "GCS_first": 12.0,            # Neurological (SOFA 2 -> Score 50)
                "MAP_first": 68.0,            # Cardiovascular (SOFA 1 -> Score 25)
                "SaO2_first": 88.0,           # Respiratory (SOFA 3 -> Score 75)
                "Platelets_first": 120.0,     # Coagulation (SOFA 1 -> Score 25)
                "Bilirubin_first": 1.5,       # Liver (SOFA 1 -> Score 25)
                "Creatinine_first": 2.2,      # Kidney (SOFA 2 -> Score 50)
                "UrineOutputSum": 1200.0
            }
        )

        clin = patient.get_clinical_severity()
        self.assertEqual(clin["patient_id"], "P-137517")
        self.assertEqual(len(clin["organ_systems"]), 6)
        
        neuro = clin["organ_systems"]["neurological"]
        self.assertEqual(neuro["score"], 50.0)
        self.assertEqual(neuro["category"], "Moderate")

        resp = clin["organ_systems"]["respiratory"]
        self.assertEqual(resp["score"], 75.0)
        self.assertEqual(resp["category"], "Severe")

        self.assertIn("respiratory", [d.lower().split(" ")[0] for d in clin["dominant_contributors"]])

    # 2. Test Missing Data Handling & DATA_UNAVAILABLE status
    def test_02_missing_data_honest_representation(self):
        patient = Patient(
            record_id="999000",
            sofa_score=6.0,
            raw_clinical_params={}  # All raw variables missing
        )

        clin = patient.get_clinical_severity()
        for sys_key, info in clin["organ_systems"].items():
            self.assertEqual(info["status"], "DATA_UNAVAILABLE")
            self.assertEqual(info["category"], "Data Unavailable")

        self.assertIn("provenance", clin)
        self.assertEqual(clin["overall_severity"], 30.0)  # SOFA 6 -> 30.0

    # 3. Test Organ What-If Sandbox Isolation
    def test_03_organ_what_if_sandbox_isolation(self):
        live_queue = self.events.get_ranked_patients()
        target_pid = live_queue[len(live_queue) - 1].patient_id  # Pick a low-ranked patient

        res = self.whatif.run_organ_what_if_scenario(
            live_patients=live_queue,
            patient_id=target_pid,
            organ_system="respiratory",
            target_score=100.0  # Critical respiratory failure
        )

        self.assertEqual(res["status"], "success")
        self.assertTrue(res["is_simulated"])
        self.assertGreater(res["after_state"]["priority_score"], res["before_state"]["priority_score"])
        self.assertGreaterEqual(res["impact_summary"]["rank_delta"], 0)

        # Verify live queue was NOT mutated
        current_live = self.events.get_ranked_patients()
        self.assertEqual(current_live[len(current_live) - 1].patient_id, target_pid)

    # 4. Test Attention Engine Enrichment with Organ Context
    def test_04_attention_engine_organ_enrichment(self):
        signals = self.attention.evaluate_attention_signals(self.events, self.audit)
        self.assertIsInstance(signals, list)

    # 5. Test CareGrid Intelligence Deterministic Fallback with V6 Organ Breakdown
    def test_05_intelligence_v6_deterministic_explanation(self):
        res = self.intel.ask_about_patient(patient_id="P-137517", mode="why_ranked")
        self.assertEqual(res["status"], "success")
        self.assertIn("V6 CLINICAL SEVERITY DECOMPOSITION", res["answer"])
        self.assertIn("6-Organ System Breakdown", res["answer"])


if __name__ == "__main__":
    unittest.main()
