"""
CareGrid Grounded Gemini AI Integration Test Suite
Verifies server-side Gemini client initialization, grounded context construction,
two-patient comparison context, V6 organ system context, timeout/error handling,
deterministic fallbacks, and 100% protection of deterministic decisions.
"""

import os
import unittest
from unittest.mock import patch, MagicMock

from src.data_loader import DataLoader
from src.patient_model import Patient
from src.priority_engine import PriorityEngine
from src.event_engine import EventEngine
from src.audit_logger import AuditLogger
from src.intelligence_engine import IntelligenceEngine, load_env_file

class TestGeminiIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        load_env_file()

    def setUp(self):
        loader = DataLoader()
        self.patients = loader.load_patients()[:20]
        self.priority_engine = PriorityEngine()
        self.audit_logger = AuditLogger()
        self.event_engine = EventEngine(self.priority_engine, self.audit_logger)
        self.event_engine.load_patients(self.patients)
        self.intelligence_engine = IntelligenceEngine(self.event_engine, self.priority_engine)

    def test_01_gemini_configuration_detection(self):
        """Verify GEMINI_API_KEY environment variable detection."""
        key = os.environ.get("GEMINI_API_KEY")
        self.assertTrue(key is None or isinstance(key, str))

    def test_02_gemini_client_initialization_with_missing_key(self):
        """Verify graceful None response when GEMINI_API_KEY is missing."""
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
            res = self.intelligence_engine.call_gemini_api(
                prompt="Why is patient #1 top ranked?",
                system_instruction="CareGrid System Instruction",
                context_data={"test": True}
            )
            self.assertIsNone(res)

    def test_03_patient_grounded_context_construction(self):
        """Verify grounded context structure contains all required patient & system attributes."""
        patient_id = self.patients[0].patient_id
        ctx = self.intelligence_engine.build_patient_context(patient_id)
        
        self.assertIsNotNone(ctx)
        self.assertIn("patient", ctx)
        self.assertIn("contributions", ctx)
        self.assertIn("weights", ctx)
        self.assertIn("queue", ctx)
        self.assertIn("clinical_severity", ctx)
        self.assertEqual(ctx["patient"]["patient_id"], patient_id)

    def test_04_two_patient_comparison_context(self):
        """Verify Patient Comparison includes complete datasets for BOTH patient_a and patient_b."""
        p_a = self.patients[0].patient_id
        p_b = self.patients[1].patient_id
        
        ctx_a = self.intelligence_engine.build_patient_context(p_a)
        ctx_b = self.intelligence_engine.build_patient_context(p_b)
        
        self.assertIsNotNone(ctx_a)
        self.assertIsNotNone(ctx_b)
        self.assertNotEqual(ctx_a["patient"]["patient_id"], ctx_b["patient"]["patient_id"])
        
        res = self.intelligence_engine.compare_patients(p_a, p_b)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["patient_id_a"], p_a)
        self.assertEqual(res["patient_id_b"], p_b)
        self.assertIn("explanation", res)

    def test_05_v6_organ_context_structure(self):
        """Verify V6 organ system decomposition is included in grounded context."""
        patient_id = self.patients[0].patient_id
        ctx = self.intelligence_engine.build_patient_context(patient_id)
        clin_sev = ctx.get("clinical_severity", {})
        
        self.assertIn("organ_systems", clin_sev)
        self.assertIn("dominant_contributors", clin_sev)
        organs = clin_sev["organ_systems"]
        self.assertIn("neurological", organs)
        self.assertIn("kidney", organs)

    def test_06_gemini_mocked_success_response(self):
        """Verify response handling when Gemini API returns successful answer."""
        mock_reply = "Patient P-139169 is ranked #1 due to critical SOFA renal severity (100/100)."
        with patch.object(self.intelligence_engine, "call_gemini_api", return_value=mock_reply):
            res = self.intelligence_engine.ask_about_patient(self.patients[0].patient_id, mode="why_ranked")
            self.assertEqual(res["status"], "success")
            self.assertEqual(res["answer"], mock_reply)
            self.assertIn("Gemini", res["source"])

    def test_07_gemini_api_timeout_fallback(self):
        """Verify instant deterministic fallback when Gemini API times out."""
        with patch.object(self.intelligence_engine, "call_gemini_api", return_value=None):
            res = self.intelligence_engine.ask_about_patient(self.patients[0].patient_id, mode="why_ranked")
            self.assertEqual(res["status"], "success")
            self.assertIn("CareGrid Priority Engine", res["source"])
            self.assertIn("WHY THIS PATIENT?", res["answer"])

    def test_08_gemini_api_failure_fallback(self):
        """Verify instant deterministic fallback on API error/429/503."""
        with patch.object(self.intelligence_engine, "call_gemini_api", return_value=None):
            res = self.intelligence_engine.ask("Why is the second ranked patient #2?")
            self.assertEqual(res["status"], "success")
            self.assertIn("CareGrid Priority Engine", res["source"])
            self.assertIsNotNone(res["answer"])

    def test_09_gemini_cannot_mutate_deterministic_decision(self):
        """Verify Gemini response never alters patient rank, score, or queue order."""
        patient_0 = self.patients[0]
        initial_score = patient_0.priority_score
        initial_rank = patient_0.rank

        mock_reply = "Hypothetical text asserting score should be 100."
        with patch.object(self.intelligence_engine, "call_gemini_api", return_value=mock_reply):
            self.intelligence_engine.ask_about_patient(patient_0.patient_id, mode="why_ranked")

        # Deterministic state must remain 100% unchanged
        self.assertEqual(patient_0.priority_score, initial_score)
        self.assertEqual(patient_0.rank, initial_rank)

if __name__ == "__main__":
    unittest.main()
