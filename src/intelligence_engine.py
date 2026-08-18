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
import re
from typing import Dict, Any, List, Optional

def load_env_file(base_dir: Optional[str] = None):
    """Loads key-value pairs from .env file into os.environ if present."""
    if base_dir is None:
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    env_path = os.path.join(base_dir, ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k and k not in os.environ:
                            os.environ[k] = v
        except Exception:
            pass

load_env_file()

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

    def call_gemini_api(self, prompt: str, system_instruction: str, context_data: Dict[str, Any]) -> Optional[str]:
        """
        Executes grounded Gemini API generation using GEMINI_API_KEY from environment.
        Returns generated answer string if successful, or None if key is missing/call fails.
        """
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return None

        primary_model = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
        models = [primary_model, "gemini-3.6-flash", "gemini-2.5-flash", "gemini-flash-latest", "gemini-3.5-flash", "gemini-1.5-flash"]
        seen = set()
        model_list = [m for m in models if not (m in seen or seen.add(m))]

        formatted_payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": (
                                f"{system_instruction}\n\n"
                                f"GROUNDED CAREGRID SYSTEM & PATIENT CONTEXT:\n"
                                f"```json\n{json.dumps(context_data, indent=2, default=str)}\n```\n\n"
                                f"USER QUESTION:\n{prompt}"
                            )
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 1024
            }
        }

        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": api_key
        }

        import requests
        for model_name in model_list:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
            try:
                resp = requests.post(url, json=formatted_payload, headers=headers, timeout=5)
                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts:
                            text = parts[0].get("text", "").strip()
                            if text:
                                return text
                elif resp.status_code in (404, 400):
                    continue
                else:
                    print(f"[CareGrid Gemini API] Returned HTTP {resp.status_code}: {resp.text[:200]}")
                    return None
            except Exception as exc:
                print(f"[CareGrid Gemini API] Exception: {str(exc)}")
                return None

        return None

    def resolve_target_patient_from_query(self, question: str, patient_id: Optional[str] = None):
        """
        Dynamically resolves (target_patient, resolved_rank, comparison_patient) from user question.
        Identifies Patient IDs (e.g. P-152433), ordinals (second, third, etc.), or rank numbers (#2, rank 2).
        Never defaults to rank #1 unless rank #1 is explicitly requested or no specific patient/rank is identified.
        """
        all_patients = self.event_engine.get_ranked_patients()
        if not all_patients:
            return None, None, None

        q_norm = question.strip().lower()

        # 1. Direct Patient ID match (e.g. P-152433)
        match_pid = re.search(r'P-?\d{4,}', question, re.IGNORECASE)
        if match_pid:
            raw_m = match_pid.group(0).upper()
            pid = raw_m if raw_m.startswith("P-") else f"P-{raw_m[1:]}"
            target = next((p for p in all_patients if p.patient_id == pid or p.record_id == pid), None)
            if not target:
                target = self.event_engine.patients_map.get(pid)
            if target:
                comp = all_patients[0] if (target.rank and target.rank > 1 and all_patients) else None
                return target, target.rank, comp

        if patient_id:
            target = next((p for p in all_patients if p.patient_id == patient_id or p.record_id == patient_id), None)
            if not target:
                target = self.event_engine.patients_map.get(patient_id)
            if target:
                comp = all_patients[0] if (target.rank and target.rank > 1 and all_patients) else None
                return target, target.rank, comp

        # 2. Ordinal words mapping
        ordinals = {
            "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
            "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10
        }

        target_rank = None
        for word, r in ordinals.items():
            if word in q_norm:
                target_rank = r
                break

        if target_rank is None:
            m_rank = re.search(r'(?:#|rank\s*#?|ranked\s*#?|position\s*#?|patient\s*#?)\s*(\d+)', q_norm)
            if m_rank:
                try:
                    val = int(m_rank.group(1))
                    if 1 <= val <= len(all_patients):
                        target_rank = val
                except ValueError:
                    pass

        if target_rank is not None:
            idx = target_rank - 1
            if 0 <= idx < len(all_patients):
                target_p = all_patients[idx]
                comp_p = all_patients[0] if (target_rank > 1) else (all_patients[1] if len(all_patients) > 1 else None)
                return target_p, target_rank, comp_p

        return None, None, None

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

    def ask(self, question: str, patient_id: Optional[str] = None) -> Dict[str, Any]:
        """Process a user question grounded strictly in current CareGrid state with distinct intent routing."""
        q_norm = question.strip().lower()
        snapshot = self.get_current_snapshot()
        top_p = snapshot["top_patient"]
        all_patients = self.event_engine.get_ranked_patients()

        # Check if a specific patient ID was mentioned in question text (e.g. P-134104 or P134104)
        mentioned_pid = None
        match = re.search(r'P-?\d+', question, re.IGNORECASE)
        if match:
            raw_m = match.group(0).upper()
            mentioned_pid = raw_m if raw_m.startswith("P-") else f"P-{raw_m[1:]}"

        target_pid = mentioned_pid or patient_id
        target_p, target_rank, comp_p = self.resolve_target_patient_from_query(question, patient_id)

        context_summary = {
            "queue_size": snapshot["total_patients_in_queue"],
            "critical_count": snapshot["critical_patients_count"],
            "top_patient_id": top_p["patient_id"] if top_p else "N/A",
            "top_priority_score": top_p["priority_score"] if top_p else 0.0,
            "available_beds": snapshot["available_beds"]
        }

        evidence = {}
        if top_p:
            weights = snapshot["weights"]
            evidence = {
                "patient_id": top_p["patient_id"],
                "rank": top_p["rank"],
                "priority_score": top_p["priority_score"],
                "severity": top_p["severity"],
                "sofa_score": top_p["sofa_score"],
                "survival_likelihood": top_p["survival_likelihood"],
                "waiting_time_minutes": top_p["waiting_time_minutes"],
                "severity_contribution": round(top_p["severity"] * weights["weight_severity"], 1),
                "survival_contribution": round(top_p["survival_likelihood"] * snapshot["weights"]["weight_survival"], 1),
                "waiting_contribution": round(min(100.0, top_p["waiting_time_minutes"] / 1.2) * snapshot["weights"]["weight_waiting"], 1)
            }

        # ----------------------------------------------------------------------
        # CATEGORY 0A: V3.5 AUDIT INTELLIGENCE QUESTIONS
        # ----------------------------------------------------------------------
        if any(w in q_norm for w in ["what changed", "recent changes", "audit", "history", "moved", "re-ranking", "trace"]):
            return self.ask_audit(question, patient_id=patient_id)

        # ----------------------------------------------------------------------
        # CATEGORY 0B: V3.6 ATTENTION INTELLIGENCE QUESTIONS
        # ----------------------------------------------------------------------
        if any(w in q_norm for w in ["flagged", "attention", "concern", "near tie", "critical load"]):
            if hasattr(self.event_engine, "attention_engine"):
                signals = self.event_engine.attention_engine.evaluate_attention_signals(self.event_engine, self.event_engine.audit_logger)
                if signals:
                    res = self.explain_attention_signal(signals[0])
                    return {
                        "status": "success",
                        "question": question,
                        "answer": res.get("answer", ""),
                        "evidence": evidence,
                        "source": res.get("source", "CareGrid Attention Engine"),
                        "context_summary": context_summary
                    }
            answer = (
                f"CAREGRID ATTENTION SUMMARY\n\n"
                f"• Active Critical Patients: {snapshot['critical_patients_count']}\n"
                f"• ICU Capacity: {snapshot['occupied_beds']}/{snapshot['total_beds']} occupied ({snapshot['available_beds']} beds available)\n"
                f"• Top Candidate: Patient {top_p['patient_id']} (Priority Score: {top_p['priority_score']:.1f})\n\n"
                f"No immediate high-severity attention flags are active."
            )
            return {
                "status": "success",
                "question": question,
                "answer": answer,
                "evidence": evidence,
                "source": "CareGrid Current State | CareGrid Attention Engine",
                "context_summary": context_summary
            }

        # ----------------------------------------------------------------------
        # CATEGORY 1: TOP PATIENT EXPLANATION (#1)
        # ----------------------------------------------------------------------
        if ("#1" in q_norm or "top" in q_norm or "highest" in q_norm or "first" in q_norm) and ("why" in q_norm or "explain" in q_norm or "reason" in q_norm or "ranked" in q_norm or "get" in q_norm or "one" in q_norm):
            if not top_p:
                answer = "No patients are currently in the CareGrid queue."
            else:
                answer = (
                    f"EXPLANATION FOR TOP-RANKED PATIENT #{top_p['rank']} ({top_p['patient_id']})\n\n"
                    f"Patient {top_p['patient_id']} holds Rank #1 with an official CareGrid priority score of {top_p['priority_score']:.1f} / 100.0.\n\n"
                    f"KEY CONTRIBUTING FACTORS:\n"
                    f"• Severity (SOFA-derived score {top_p['severity']:.1f}): +{evidence['severity_contribution']:.1f} pts (50% weight)\n"
                    f"• Survival Likelihood ({top_p['survival_likelihood']:.1f}%): +{evidence['survival_contribution']:.1f} pts (30% weight)\n"
                    f"• Waiting Duration Equity ({top_p['waiting_time_minutes']} min): +{evidence['waiting_contribution']:.1f} pts (20% weight)\n\n"
                    f"SOFA organ failure severity is currently the primary driver securing position #1 for Patient {top_p['patient_id']}."
                )

            return {
                "status": "success",
                "question": question,
                "answer": answer,
                "evidence": evidence,
                "source": "CareGrid Priority Engine | CareGrid Current State",
                "context_summary": context_summary
            }

        # ----------------------------------------------------------------------
        # CATEGORY 2: QUEUE SUMMARY
        # ----------------------------------------------------------------------
        elif "summarize" in q_norm or "summary" in q_norm or "everyone" in q_norm or "happening" in q_norm or ("queue" in q_norm and not "this" in q_norm):
            answer = (
                f"CAREGRID ICU QUEUE SUMMARY\n\n"
                f"• Active Candidate Population: {snapshot['total_patients_in_queue']} total patients currently under arbitration.\n"
                f"• Critical Severity Cohort: {snapshot['critical_patients_count']} patients with SOFA-derived severity ≥ 70.0.\n"
                f"• Top Priority Candidate: Patient {top_p['patient_id']} (Rank #1, Priority Score: {top_p['priority_score']:.1f}).\n"
                f"• ICU Capacity State: {snapshot['occupied_beds']} of {snapshot['total_beds']} beds occupied ({snapshot['available_beds']} beds available for allocation).\n"
                f"• Engine Configuration: 50% Severity / 30% Survival Likelihood / 20% Waiting Equity."
            )

            return {
                "status": "success",
                "question": question,
                "answer": answer,
                "evidence": evidence,
                "source": "CareGrid Current Priority State",
                "context_summary": context_summary
            }

        # ----------------------------------------------------------------------
        # CATEGORY 3: PRIORITY STATE & WEIGHTS
        # ----------------------------------------------------------------------
        elif "priority state" in q_norm or "weights" in q_norm or "scoring formula" in q_norm or ("state" in q_norm and not "patient" in q_norm):
            answer = (
                f"CAREGRID PRIORITY ENGINE STATE\n\n"
                f"• Status: ONLINE & DETERMINISTICALLY ACTIVE\n"
                f"• Scoring Formula: Score = (Severity × 0.50) + (Survival × 0.30) + (Wait × 0.20)\n"
                f"• Top Candidate Score: {top_p['priority_score']:.1f} (Patient {top_p['patient_id']})\n"
                f"• Evaluated Population: {snapshot['total_patients_in_queue']} active records ({snapshot['critical_patients_count']} critical)\n"
                f"• Provenance: All priority scores and rank positions are generated deterministically by CareGrid Priority Engine."
            )

            return {
                "status": "success",
                "question": question,
                "answer": answer,
                "evidence": evidence,
                "source": "CareGrid Priority Engine",
                "context_summary": context_summary
            }

        # ----------------------------------------------------------------------
        # CATEGORY 4: PATIENT COMPARISON / DIFFERENCE BETWEEN TOP TWO
        # ----------------------------------------------------------------------
        elif "difference" in q_norm or "compare" in q_norm or "top two" in q_norm or "versus" in q_norm or "vs" in q_norm:
            if len(all_patients) >= 2:
                res = self.compare_patients(all_patients[0].patient_id, all_patients[1].patient_id)
                return {
                    "status": "success",
                    "question": question,
                    "answer": res.get("explanation", ""),
                    "evidence": evidence,
                    "source": "CareGrid Priority Engine | CareGrid Current State",
                    "context_summary": context_summary
                }

        # ----------------------------------------------------------------------
        # CATEGORY 5: PATIENT-SPECIFIC QUERY / "THIS PATIENT" / "CONTRIBUTES MOST"
        # ----------------------------------------------------------------------
        resolved_pid = None
        if target_p:
            resolved_pid = target_p.patient_id if hasattr(target_p, "patient_id") else (target_p.get("patient_id") if isinstance(target_p, dict) else None)

        if resolved_pid or target_pid or "this patient" in q_norm or "patient" in q_norm or "contribute" in q_norm or "driver" in q_norm or "why" in q_norm:
            pid = resolved_pid or target_pid or (top_p["patient_id"] if top_p else None)
            if pid:
                mode = "drivers" if ("contribute" in q_norm or "driver" in q_norm or "most" in q_norm) else "why_ranked"
                res = self.ask_about_patient(patient_id=pid, mode=mode, free_question=question)
                return {
                    "status": "success",
                    "question": question,
                    "answer": res.get("answer", ""),
                    "evidence": evidence,
                    "source": res.get("source", "CareGrid Current Patient State"),
                    "context_summary": context_summary
                }
            else:
                answer = "Please select a patient row from the queue table or specify a Patient ID (e.g. P-139169) to view patient-specific priority drivers."
                return {
                    "status": "success",
                    "question": question,
                    "answer": answer,
                    "evidence": evidence,
                    "source": "CareGrid Intelligence",
                    "context_summary": context_summary
                }

        # ----------------------------------------------------------------------
        # FALLBACK FOR UNRECOGNIZED QUESTIONS
        # ----------------------------------------------------------------------
        answer = (
            f"CareGrid Intelligence Context for query '{question}':\n\n"
            f"• Current Queue Population: {snapshot['total_patients_in_queue']} records under active arbitration.\n"
            f"• Highest Priority Candidate: Patient {top_p['patient_id']} (Rank #1, Priority Score: {top_p['priority_score']:.1f}).\n"
            f"• Configured Weights: 50% Severity / 30% Survival Likelihood / 20% Waiting Equity.\n"
            f"• Available Beds: {snapshot['available_beds']} beds.\n\n"
            f"You can ask about queue summary, priority state, top patient explanation, or select a patient row to inspect specific drivers."
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
            },
            "clinical_severity": target.get_clinical_severity()
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

    def compare_patients(self, patient_id_a: str, patient_id_b: str) -> Dict[str, Any]:
        """
        Grounded Patient Comparison Intelligence (Step 7).
        Builds structured context containing BOTH patient_a and patient_b datasets.
        Passes both contexts to Gemini API so Gemini compares evidence directly.
        If Gemini unavailable/fails, generates deterministic comparison fallback.
        """
        ctx_a = self.build_patient_context(patient_id_a)
        ctx_b = self.build_patient_context(patient_id_b)

        if not ctx_a or not ctx_b:
            return {
                "status": "error",
                "message": f"One or both patients ({patient_id_a}, {patient_id_b}) not found in active CareGrid queue.",
                "source": "CareGrid Priority Engine"
            }

        comparison_context = {
            "comparison_mode": "PATIENT_PAIR_COMPARISON",
            "patient_a": ctx_a,
            "patient_b": ctx_b,
            "system_weights": self.priority_engine.get_weights()
        }

        prompt = f"Compare Patient {patient_id_a} (Rank #{ctx_a['patient']['rank']}) vs Patient {patient_id_b} (Rank #{ctx_b['patient']['rank']}) using the supplied evidence."
        
        gemini_reply = self.call_gemini_api(prompt, SYSTEM_PROMPT, comparison_context)
        if gemini_reply:
            return {
                "status": "success",
                "patient_id_a": patient_id_a,
                "patient_id_b": patient_id_b,
                "explanation": gemini_reply,
                "source": "Gemini API | CareGrid Patient Comparison Intelligence",
                "patient_a_snapshot": ctx_a["patient"],
                "patient_b_snapshot": ctx_b["patient"]
            }

        # Deterministic Fallback Comparison
        p_a, p_b = ctx_a["patient"], ctx_b["patient"]
        c_a, c_b = ctx_a["contributions"], ctx_b["contributions"]
        gap = round(p_a["priority_score"] - p_b["priority_score"], 1)

        lines = [
            f"PATIENT COMPARISON SUMMARY: {p_a['patient_id']} (Rank #{p_a['rank']}) vs {p_b['patient_id']} (Rank #{p_b['rank']})\n",
            f"• Priority Score Gap: Patient {p_a['patient_id']} leads by +{gap} points ({p_a['priority_score']:.1f} vs {p_b['priority_score']:.1f}).",
            f"• Severity Factor (SOFA): Patient {p_a['patient_id']} {p_a['severity']:.1f} (+{c_a['severity_contribution']:.1f} pts) vs Patient {p_b['patient_id']} {p_b['severity']:.1f} (+{c_b['severity_contribution']:.1f} pts).",
            f"• Prognostic Survival: Patient {p_a['patient_id']} {p_a['survival_likelihood']:.1f}% (+{c_a['survival_contribution']:.1f} pts) vs Patient {p_b['patient_id']} {p_b['survival_likelihood']:.1f}% (+{c_b['survival_contribution']:.1f} pts).",
            f"• Waiting Equity: Patient {p_a['patient_id']} {p_a['waiting_time_minutes']} min (+{c_a['waiting_contribution']:.1f} pts) vs Patient {p_b['patient_id']} {p_b['waiting_time_minutes']} min (+{c_b['waiting_contribution']:.1f} pts).",
            f"\nReason for Rank Shift: Deterministic priority score hierarchy applied consistently across all patients."
        ]

        return {
            "status": "success",
            "patient_id_a": patient_id_a,
            "patient_id_b": patient_id_b,
            "explanation": "\n".join(lines),
            "source": "CareGrid Priority Engine (Deterministic Fallback)",
            "patient_a_snapshot": p_a,
            "patient_b_snapshot": p_b
        }

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

        # Attempt Gemini API Generation
        gemini_prompt = free_question if free_question else f"Explain why patient {patient_id} is ranked #{p.get('rank')} under mode '{mode}'."
        gemini_reply = self.call_gemini_api(gemini_prompt, PATIENT_SYSTEM_PROMPT, ctx)
        if gemini_reply:
            return {
                "status": "success",
                "patient_id": patient_id,
                "mode": mode,
                "answer": gemini_reply,
                "contributions": c,
                "patient_snapshot": p,
                "dominant_contributor": dominant,
                "source": "Gemini API | CareGrid Intelligence",
            }

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

        # Attach V6 Clinical Severity Breakdown if patient object available
        try:
            patient_obj = self.event_engine.patients_map.get(patient_id)
            if patient_obj:
                clin_sev = patient_obj.get_clinical_severity()
                doms = clin_sev.get("dominant_contributors", [])
                answer += f"\n\nV6 CLINICAL SEVERITY DECOMPOSITION:\n"
                answer += f"• Overall Severity: {patient_obj.severity:.1f} / 100.0\n"
                if doms:
                    answer += f"• Dominant Organ Drivers: {', '.join(doms)}\n"
                answer += "• 6-Organ System Breakdown:\n"
                for s_key, s_info in clin_sev.get("organ_systems", {}).items():
                    answer += f"  - {s_info['system_name']}: {s_info['score']:.0f}/100 ({s_info['category']}) [{s_info['evidence']}]\n"
        except Exception:
            pass

        return {
            "status": "success",
            "patient_id": patient_id,
            "mode": mode,
            "answer": answer,
            "contributions": c,
            "patient_snapshot": p,
            "dominant_contributor": dominant,
            "source": f"{source} (Deterministic Fallback)",
        }

    # ──────────────────────────────────────────────────────────────────────
    # V3.5 — AUDIT INTELLIGENCE & SMALL ATTENTION FOUNDATION
    # ──────────────────────────────────────────────────────────────────────

    def ask_audit(self, question: str, patient_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Process V3.5 Audit Intelligence query grounded strictly in live Audit Log events.
        """
        q_norm = question.strip().lower()
        audit_events = self.event_engine.audit_logger.get_events(limit=20) if hasattr(self.event_engine, "audit_logger") else []

        match = re.search(r'P-?\d+', question, re.IGNORECASE)
        mentioned_pid = match.group(0).upper() if match else None
        if mentioned_pid and not mentioned_pid.startswith("P-"):
            mentioned_pid = f"P-{mentioned_pid[1:]}"
        target_pid = mentioned_pid or patient_id

        # 1. PATIENT-SPECIFIC AUDIT / WHY DID PATIENT MOVE
        if target_pid or "this patient" in q_norm or "moved" in q_norm:
            pid = target_pid or (audit_events[0]["patient_id"] if audit_events and audit_events[0].get("patient_id") else None)
            patient_evts = [e for e in audit_events if e.get("patient_id") == pid] if pid else []

            # Attempt Gemini API Generation
            audit_ctx = {
                "target_patient_id": pid,
                "patient_audit_events": patient_evts[:10],
                "all_recent_audit_events": audit_events[:10]
            }
            gemini_reply = self.call_gemini_api(question, SYSTEM_PROMPT, audit_ctx)
            if gemini_reply:
                return {
                    "status": "success",
                    "question": question,
                    "answer": gemini_reply,
                    "source": "Gemini API | CareGrid Audit Intelligence"
                }

            lines = [f"PATIENT AUDIT TRACE — PATIENT {pid or 'N/A'}\n"]
            lines.append("RECENT ACTIVITY")

            if not patient_evts:
                lines.append("  No recent activity recorded for this patient in the active audit log.")
                lines.append("\nRANK CHANGE TRACE")
                lines.append("  Trigger information is unavailable in the current audit data.")
            else:
                for e in patient_evts[:5]:
                    lines.append(f"  • [{e.get('timestamp', 'N/A')[:19]}] {e.get('event_type', 'EVENT')}")
                    if e.get("previous_rank") and e.get("new_rank"):
                        lines.append(f"    Rank Shift: #{e['previous_rank']} → #{e['new_rank']} ({'+' if e.get('rank_delta',0)>0 else ''}{e.get('rank_delta',0)} positions)")
                    if e.get("reason"):
                        lines.append(f"    Reason: {e['reason']}")

                latest = patient_evts[0]
                lines.append("\nRANK CHANGE TRACE")
                lines.append("  TRIGGER")
                lines.append(f"  ↓ {latest.get('event_type', 'System Action')}")
                lines.append("  INPUT CHANGE")
                lines.append(f"  ↓ {latest.get('reason', 'Parameter / Queue update')}")
                lines.append("  PRIORITY RECALCULATION")
                lines.append("  ↓ CareGrid Priority Engine executed 50/30/20 deterministic scoring")
                lines.append("  RANK CHANGE")
                if latest.get("previous_rank") and latest.get("new_rank"):
                    lines.append(f"  ↓ #{latest['previous_rank']} → #{latest['new_rank']}")
                else:
                    lines.append("  ↓ Evaluated position updated")
                lines.append("  ARBITRATION")
                lines.append("  ↓ ICU Bed Arbitration Engine confirmed position")
                lines.append("  AUDIT RECORD")
                lines.append(f"  ↓ Event {latest.get('event_id', 'EVT')} logged to audit trail")

            lines.append("\nSOURCE\nCareGrid Audit Log | CareGrid Priority Engine")
            return {
                "status": "success",
                "question": question,
                "answer": "\n".join(lines),
                "source": "CareGrid Audit Log | CareGrid Priority Engine"
            }

        # 2. GENERAL RECENT AUDIT SUMMARY ("What changed recently?")
        lines = ["RECENT CAREGRID AUDIT CHANGES\n"]
        if not audit_events:
            lines.append("NO RECENT AUDIT EVENTS RECORDED IN THE SYSTEM.")
        else:
            for e in audit_events[:8]:
                ts = e.get("timestamp", "")[:19].replace("T", " ")
                pid_str = f"P-{e['patient_id']}" if e.get("patient_id") and not str(e.get("patient_id")).startswith("P-") else (e.get("patient_id") or "QUEUE")
                lines.append(f"• {ts} | {pid_str}")
                lines.append(f"  Event: {e.get('event_type', 'State Change')}")
                if e.get("previous_rank") and e.get("new_rank"):
                    lines.append(f"  Rank: #{e['previous_rank']} → #{e['new_rank']}")
                if e.get("reason"):
                    lines.append(f"  Details: {e['reason']}")
                lines.append("")

        lines.append("SOURCE\nCareGrid Audit Log")
        return {
            "status": "success",
            "question": question,
            "answer": "\n".join(lines),
            "source": "CareGrid Audit Log"
        }

    def detect_major_rank_changes(self, threshold: int = 2) -> List[Dict[str, Any]]:
        """
        V3.5 Small Attention Foundation: Deterministic Major Rank Change detection.
        Scans recent audit history for rank position shifts >= threshold.
        """
        audit_events = self.event_engine.audit_logger.get_events(limit=30) if hasattr(self.event_engine, "audit_logger") else []
        major_changes = []
        seen_pids = set()

        for evt in audit_events:
            delta = evt.get("rank_delta", 0)
            pid = evt.get("patient_id")
            if pid and abs(delta) >= threshold and pid not in seen_pids:
                seen_pids.add(pid)
                major_changes.append({
                    "patient_id": pid,
                    "previous_rank": evt.get("previous_rank"),
                    "new_rank": evt.get("new_rank"),
                    "rank_delta": delta,
                    "timestamp": evt.get("timestamp"),
                    "event_type": evt.get("event_type"),
                    "reason": evt.get("reason"),
                    "threshold": threshold
                })
        return major_changes

    def explain_major_rank_change(self, patient_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Grounded AI explanation of why a Major Rank Change attention indicator was surfaced.
        """
        changes = self.detect_major_rank_changes()
        target = next((c for c in changes if c["patient_id"] == patient_id), None) if patient_id else (changes[0] if changes else None)

        lines = ["ATTENTION EXPLANATION: MAJOR RANK CHANGE\n"]
        lines.append("WHY IS THIS FLAGGED?")

        if not target:
            lines.append("NO MAJOR RANK CHANGES")
            lines.append("No major rank changes (≥ 2 rank position shifts) are currently recorded in the active audit history.")
        else:
            pid = target["patient_id"]
            prev_r = target["previous_rank"]
            new_r = target["new_rank"]
            delta = target["rank_delta"]
            lines.append(
                f"This is flagged as a Major Rank Change because Patient {pid} shifted from Rank #{prev_r} → #{new_r} "
                f"({'+' if delta > 0 else ''}{delta} positions), meeting the configured operational threshold of ≥ {target['threshold']} position shifts.\n\n"
                f"TRIGGER DETAILS\n"
                f"• Event: {target['event_type']}\n"
                f"• Details: {target['reason']}\n"
                f"• Timestamp: {target['timestamp'][:19]}\n\n"
                f"CareGrid surfaced this indicator deterministically from the Audit Log. No clinical judgment or prediction is implied."
            )

        lines.append("\nSOURCE\nCareGrid Audit Log | CareGrid Priority Engine")
        return {
            "status": "success",
            "answer": "\n".join(lines),
            "source": "CareGrid Audit Log | CareGrid Priority Engine"
        }

    def explain_attention_signal(self, signal: Dict[str, Any]) -> Dict[str, Any]:
        """
        Grounded AI explanation of any V4.0 deterministic Attention Signal.
        """
        sig_type = signal.get("signal_type", "ATTENTION_SIGNAL")
        prompt = f"Explain why operational attention signal '{sig_type}' was surfaced."
        gemini_reply = self.call_gemini_api(prompt, SYSTEM_PROMPT, signal)
        if gemini_reply:
            return {
                "status": "success",
                "answer": gemini_reply,
                "source": "Gemini API | CareGrid Attention Intelligence"
            }

        lines = [f"ATTENTION SIGNAL EXPLANATION: {sig_type.replace('_', ' ')}\n"]
        lines.append("WHY IS THIS FLAGGED?")

        if sig_type == "NEAR_TIE":
            pid_a = signal.get("patient_id_a", "N/A")
            pid_b = signal.get("patient_id_b", "N/A")
            diff = signal.get("score_diff", 0.0)
            lines.append(
                f"These patients have closely matched priority scores (Gap: {diff} pts) under the current CareGrid configuration.\n\n"
                f"• Patient {pid_a}: Rank #{signal.get('rank_a')}, Priority Score {signal.get('score_a')}\n"
                f"• Patient {pid_b}: Rank #{signal.get('rank_b')}, Priority Score {signal.get('score_b')}\n\n"
                f"OPERATIONAL RULE\n"
                f"Score separation is within the configured near-tie threshold of ≤ 1.0 points. "
                f"CareGrid highlights closely matched candidates so clinicians can review physiological score breakdown side-by-side."
            )
        elif sig_type == "MAJOR_RANK_CHANGE":
            pid = signal.get("patient_id", "N/A")
            prev_r = signal.get("previous_rank", "?")
            new_r = signal.get("new_rank", "?")
            delta = signal.get("rank_delta", 0)
            lines.append(
                f"Patient {pid} experienced a major rank position shift from Rank #{prev_r} → #{new_r} ({'+' if delta > 0 else ''}{delta} positions).\n\n"
                f"OPERATIONAL RULE\n"
                f"Rank position delta meets or exceeds the operational attention threshold of ≥ 2 position shifts."
            )
        elif sig_type == "WAITING_TIME_ATTENTION":
            pid = signal.get("patient_id", "N/A")
            wait_m = signal.get("waiting_time_minutes", 0)
            thresh = signal.get("threshold", 120)
            lines.append(
                f"Patient {pid} waiting duration ({wait_m} min) exceeds the configured operational attention threshold of ≥ {thresh} minutes.\n\n"
                f"OPERATIONAL RULE\n"
                f"Extended wait time is surfaced deterministically to ensure queue equity and prevent prolonged pending status."
            )
        elif sig_type == "CRITICAL_QUEUE_LOAD":
            cnt = signal.get("count", 0)
            thresh = signal.get("threshold", 5)
            lines.append(
                f"This is flagged as Critical Queue Load because {cnt} critical severity patients (SOFA severity ≥ 70.0) are currently present out of 3600 total records, meeting the operational threshold of ≥ {thresh} critical candidates.\n\n"
                f"OPERATIONAL RULE\n"
                f"High critical load requires ICU capacity review to manage impending bed allocation demand."
            )
        else:
            lines.append(signal.get("description", "Deterministic operational signal surfaced by CareGrid Attention Engine."))

        lines.append("\nSOURCE\nCareGrid Current State | CareGrid Attention Engine")
        return {
            "status": "success",
            "answer": "\n".join(lines),
            "source": "CareGrid Current State | CareGrid Attention Engine"
        }

    # ──────────────────────────────────────────────────────────────────────
    # V3.2 — PATIENT COMPARISON INTELLIGENCE
    # ──────────────────────────────────────────────────────────────────────

    def interpret_whatif(self, question: str, patient_id: str = None) -> Dict[str, Any]:
        """Parse a natural-language what-if question into a structured scenario descriptor."""
        import re
        q = question.lower()

        if "new critical" in q or "new patient" in q or "enters" in q or "arriving" in q:
            return {
                "status": "ready",
                "scenario": {
                    "action": "new_critical_patient",
                    "patient_id": None,
                    "description": "Simulate a new critical patient entering the CareGrid queue"
                },
                "source": "CareGrid Intelligence"
            }

        if "discharge" in q or "leave" in q or "remov" in q or "exit" in q or "bed available" in q or "bed" in q:
            return {
                "status": "ready",
                "scenario": {
                    "action": "discharge_top",
                    "patient_id": None,
                    "description": "Simulate the top-ranked patient being discharged from the queue (freeing a bed)"
                },
                "source": "CareGrid Intelligence"
            }

        if "time" in q or "wait" in q or "advance" in q or "clock" in q or "delay" in q:
            match = re.search(r'(\d+)\s*min', q)
            minutes = int(match.group(1)) if match else 30
            return {
                "status": "ready",
                "scenario": {
                    "action": "advance_time",
                    "minutes": minutes,
                    "patient_id": None,
                    "description": f"Advance the CareGrid waiting-time clock by {minutes} minutes"
                },
                "source": "CareGrid Intelligence"
            }

        if any(w in q for w in ["severity", "spike", "worsen", "deterior", "sofa"]):
            target = patient_id
            if not target:
                m = re.search(r'p-?\d+', question, re.IGNORECASE)
                if m:
                    target = m.group(0).upper().replace("P", "P-") if not m.group(0).startswith("P-") else m.group(0).upper()
            return {
                "status": "ready",
                "scenario": {
                    "action": "severity_spike",
                    "patient_id": target,
                    "description": f"Simulate a severity spike for patient {target or '(selected patient)'}"
                },
                "source": "CareGrid Intelligence"
            }

        return {
            "status": "unsupported",
            "message": (
                "CareGrid cannot simulate that scenario with the currently available data.\n"
                "Supported scenarios: severity change | waiting-time change | new critical patient | bed availability (top patient discharge)."
            ),
            "source": "CareGrid Intelligence"
        }

    def explain_simulation_result(self, sim_result: Dict[str, Any], before_patient: Dict[str, Any] = None, after_patient: Dict[str, Any] = None) -> Dict[str, Any]:
        """V3.4 — Build a grounded BEFORE → EVENT → AFTER AI explanation from deterministic simulation results."""
        evt = sim_result.get("audit_event", {})
        moved_up = sim_result.get("moved_up", [])
        moved_down = sim_result.get("moved_down", [])
        event_type = evt.get("event_type", "SIMULATION EVENT")
        pid = evt.get("patient_id") or (before_patient.get("patient_id") if before_patient else "")
        reason = evt.get("reason", "")

        lines = ["BEFORE → EVENT → AFTER SIMULATION EXPLANATION\n"]
        
        # WHAT CHANGED?
        lines.append("WHAT CHANGED?")
        if pid:
            lines.append(f"  Event: {event_type} — Patient {pid}")
        else:
            lines.append(f"  Event: {event_type}")

        if reason:
            lines.append(f"  Reason: {reason}")

        if before_patient and after_patient:
            b_rank = before_patient.get("rank", "N/A")
            a_rank = after_patient.get("rank", "N/A")
            b_score = before_patient.get("priority_score", 0.0)
            a_score = after_patient.get("priority_score", 0.0)
            target_pid = after_patient.get("patient_id", pid)

            score_diff = round(a_score - b_score, 1)
            lines.append(f"  Target Patient {target_pid}: #{b_rank} ({b_score}) → #{a_rank} ({a_score}) [{'+' if score_diff >= 0 else ''}{score_diff} pts]")

        if moved_up:
            lines.append(f"  Promoted ({len(moved_up)}): " + ", ".join([f"{m['patient_id']} (#{m['previous_rank']} → #{m['new_rank']})" for m in moved_up[:4]]))
        if moved_down:
            lines.append(f"  Demoted ({len(moved_down)}): " + ", ".join([f"{m['patient_id']} (#{m['previous_rank']} → #{m['new_rank']})" for m in moved_down[:4]]))

        lines.append("\nWHY DID THIS CHANGE?")
        lines.append(
            f"  Computation Chain: {event_type} ➔ Parameter Input Change ➔ Priority Score Recalculation ➔ Rank Re-Arbitration.\n"
            f"  The CareGrid Priority Engine updated the active candidate queue without modifying production state. "
            f"  Patients with higher computed priority scores were placed ahead in line according to the active 50% Severity / 30% Survival / 20% Waiting weighting."
        )

        lines.append("\nSOURCE\nCareGrid Simulation Engine | CareGrid Arbitration Engine | CareGrid Current State")

        return {
            "status": "success",
            "answer": "\n".join(lines),
            "source": "CareGrid Simulation Engine | CareGrid Arbitration Engine | CareGrid Current State"
        }

    # ──────────────────────────────────────────────────────────────────────
    # V3.5 — AUDIT INTELLIGENCE
    # ──────────────────────────────────────────────────────────────────────

    def ask_audit(self, question: str, patient_id: Optional[str] = None, audit_events: List[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Process V3.5 Audit Intelligence query grounded strictly in live Audit Log events.
        """
        q_norm = question.strip().lower()
        if audit_events is None:
            audit_events = self.event_engine.audit_logger.get_events(limit=20) if hasattr(self.event_engine, "audit_logger") else []

        # Find target patient ID if mentioned
        match = re.search(r'P-?\d+', question, re.IGNORECASE)
        mentioned_pid = match.group(0).upper() if match else None
        if mentioned_pid and not mentioned_pid.startswith("P-"):
            mentioned_pid = f"P-{mentioned_pid[1:]}"
        target_pid = mentioned_pid or patient_id

        # 1. PATIENT-SPECIFIC AUDIT / WHY DID PATIENT MOVE
        if target_pid or "this patient" in q_norm or "moved" in q_norm:
            pid = target_pid or (audit_events[0]["patient_id"] if audit_events and audit_events[0].get("patient_id") else None)
            patient_evts = [e for e in audit_events if e.get("patient_id") == pid] if pid else []

            lines = [f"PATIENT AUDIT TRACE — PATIENT {pid or 'N/A'}\n"]
            lines.append("RECENT EVENTS")

            if not patient_evts:
                lines.append("  No specific audit events recorded for this patient in the recent audit window.")
                lines.append("\nRANK CHANGE TRACE")
                lines.append("  Trigger information is unavailable in the current audit data.")
            else:
                for e in patient_evts[:5]:
                    lines.append(f"  • [{e.get('timestamp', 'N/A')[:19]}] {e.get('event_type', 'EVENT')}")
                    if e.get("previous_rank") and e.get("new_rank"):
                        lines.append(f"    Rank Shift: #{e['previous_rank']} → #{e['new_rank']} ({'+' if e.get('rank_delta',0)>0 else ''}{e.get('rank_delta',0)} positions)")
                    if e.get("reason"):
                        lines.append(f"    Reason: {e['reason']}")

                latest = patient_evts[0]
                lines.append("\nRANK CHANGE TRACE")
                lines.append("  TRIGGER")
                lines.append(f"  ↓ {latest.get('event_type', 'System Action')}")
                lines.append("  INPUT CHANGE")
                lines.append(f"  ↓ {latest.get('reason', 'Parameter / Queue update')}")
                lines.append("  PRIORITY RECALCULATION")
                lines.append("  ↓ CareGrid Priority Engine executed 50/30/20 deterministic scoring")
                lines.append("  RANK CHANGE")
                if latest.get("previous_rank") and latest.get("new_rank"):
                    lines.append(f"  ↓ #{latest['previous_rank']} → #{latest['new_rank']}")
                else:
                    lines.append("  ↓ Evaluated position updated")
                lines.append("  ARBITRATION")
                lines.append("  ↓ ICU Bed Arbitration Engine confirmed position")
                lines.append("  AUDIT RECORD")
                lines.append(f"  ↓ Event {latest.get('event_id', 'EVT')} logged to audit trail")

            lines.append("\nSOURCE\nCareGrid Audit Log | CareGrid Priority Engine")
            return {
                "status": "success",
                "question": question,
                "answer": "\n".join(lines),
                "source": "CareGrid Audit Log | CareGrid Priority Engine"
            }

        # 2. GENERAL RECENT AUDIT SUMMARY ("What changed recently?")
        lines = ["RECENT CAREGRID AUDIT CHANGES\n"]
        if not audit_events:
            lines.append("NO RECENT AUDIT EVENTS RECORDED IN THE SYSTEM.")
        else:
            for e in audit_events[:8]:
                ts = e.get("timestamp", "")[:19].replace("T", " ")
                pid_str = f"P-{e['patient_id']}" if e.get("patient_id") and not str(e.get("patient_id")).startswith("P-") else (e.get("patient_id") or "QUEUE")
                lines.append(f"• {ts} | {pid_str}")
                lines.append(f"  Event: {e.get('event_type', 'State Change')}")
                if e.get("previous_rank") and e.get("new_rank"):
                    lines.append(f"  Rank: #{e['previous_rank']} → #{e['new_rank']}")
                if e.get("reason"):
                    lines.append(f"  Details: {e['reason']}")
                lines.append("")

        lines.append("SOURCE\nCareGrid Audit Log")
        return {
            "status": "success",
            "question": question,
            "answer": "\n".join(lines),
            "source": "CareGrid Audit Log"
        }

    # ──────────────────────────────────────────────────────────────────────
    # V3.6 — ATTENTION INTELLIGENCE EXPLANATION
    # ──────────────────────────────────────────────────────────────────────

    def explain_attention_signal(self, signal: Dict[str, Any]) -> Dict[str, Any]:
        """
        Grounded AI explanation of why a deterministic Attention Signal was surfaced.
        """
        stype = signal.get("signal_type", "")
        lines = [f"ATTENTION SIGNAL EXPLANATION: {signal.get('badge_label', stype)}\n"]
        lines.append("WHY IS THIS FLAGGED?")

        if stype == "NEAR_TIE":
            pid_a = signal.get("patient_id_a", "P-A")
            pid_b = signal.get("patient_id_b", "P-B")
            score_a = signal.get("score_a", 0.0)
            score_b = signal.get("score_b", 0.0)
            gap = signal.get("score_delta", 0.0)
            thresh = signal.get("threshold", 1.0)
            lines.append(
                f"This is flagged as a Near Tie because Patient {pid_a} (Rank #{signal.get('rank_a')}, Score {score_a:.1f}) "
                f"and Patient {pid_b} (Rank #{signal.get('rank_b')}, Score {score_b:.1f}) have priority scores separated "
                f"by only {gap:.1f} points under the current CareGrid configuration.\n\n"
                f"OPERATIONAL RULE\n"
                f"CareGrid flags any adjacent queue pair with a score difference ≤ {thresh:.1f} points so clinical teams can inspect score composition."
            )

        elif stype == "MAJOR_RANK_CHANGE":
            pid = signal.get("patient_id", "P-X")
            prev_r = signal.get("previous_rank", "N/A")
            new_r = signal.get("new_rank", "N/A")
            delta = signal.get("rank_delta", 0)
            lines.append(
                f"This is flagged as a Major Rank Change because Patient {pid} moved from Rank #{prev_r} → #{new_r} "
                f"({'+' if delta > 0 else ''}{delta} positions), meeting the configured operational threshold of ≥ 2 position shifts.\n\n"
                f"OPERATIONAL RULE\n"
                f"Significant rank displacement indicates recent severity changes or time-elapsed priority recalculation."
            )

        elif stype == "WAITING-TIME ATTENTION":
            pid = signal.get("patient_id", "P-X")
            wait_m = signal.get("waiting_time_minutes", 0)
            thresh = signal.get("threshold", 120)
            lines.append(
                f"This is flagged as Waiting-Time Attention because Patient {pid} waiting time ({wait_m} minutes) "
                f"exceeds the configured operational attention threshold of {thresh} minutes.\n\n"
                f"OPERATIONAL RULE\n"
                f"Prolonged queue retention triggers an equity review signal to ensure long-waiting patients receive timely arbitration."
            )

        elif stype == "CRITICAL_QUEUE_LOAD":
            crit_count = signal.get("critical_count", 0)
            total_q = signal.get("total_queue", 0)
            thresh = signal.get("threshold", 5)
            lines.append(
                f"This is flagged as Critical Queue Load because {crit_count} critical severity patients (SOFA severity ≥ 70.0) "
                f"are currently present out of {total_q} total records, meeting the operational threshold of ≥ {thresh} critical candidates.\n\n"
                f"OPERATIONAL RULE\n"
                f"High critical load requires ICU capacity review to manage impending bed allocation demand."
            )

        else:
            lines.append(signal.get("description", "Condition met under active CareGrid configuration rules."))

        lines.append("\nSOURCE\nCareGrid Current State | CareGrid Attention Engine")
        return {
            "status": "success",
            "answer": "\n".join(lines),
            "source": "CareGrid Current State | CareGrid Attention Engine"
        }



    # ──────────────────────────────────────────────────────────────────────
    # V3.2 — PATIENT COMPARISON INTELLIGENCE
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


