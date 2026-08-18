"""
CareGrid V6 — Clinical Factors Engine
Implements 6-organ clinical decomposition (Neurological, Cardiovascular, Respiratory, Coagulation, Liver, Kidney),
missing data handling, overall severity aggregation, long-term prognosis integration, and organ factor evidence calculation.
"""

from typing import Dict, Any, List, Optional, Tuple


def categorize_severity(score: float, available: bool = True) -> str:
    if not available:
        return "DATA UNAVAILABLE"
    if score >= 80.0:
        return "CRITICAL"
    elif score >= 60.0:
        return "SEVERE"
    elif score >= 35.0:
        return "MODERATE"
    elif score >= 15.0:
        return "MILD"
    else:
        return "NORMAL"


class ClinicalEngine:
    """
    Decomposes immediate clinical severity into 6 organ systems:
    1. Neurological
    2. Cardiovascular
    3. Respiratory
    4. Coagulation
    5. Liver
    6. Kidney
    """

    def evaluate_patient_clinical_factors(self, patient: Any, organ_overrides: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        """
        Evaluates organ system severities for a patient, allowing optional What-If organ overrides.
        """
        params = getattr(patient, "raw_clinical_params", {}) or {}
        overrides = organ_overrides or {}

        # ----------------------------------------------------------------------
        # 1. NEUROLOGICAL (GCS_first)
        # ----------------------------------------------------------------------
        gcs_val = params.get("GCS_first")
        if "neurological" in overrides:
            neuro_sev = max(0.0, min(100.0, float(overrides["neurological"])))
            neuro_avail = True
            neuro_evidence = f"Simulated Override: {neuro_sev:.1f}/100"
        elif gcs_val is not None and gcs_val > 0:
            neuro_avail = True
            if gcs_val >= 15:
                neuro_sev = 0.0
            elif gcs_val >= 13:
                neuro_sev = 25.0
            elif gcs_val >= 10:
                neuro_sev = 50.0
            elif gcs_val >= 6:
                neuro_sev = 75.0
            else:
                neuro_sev = 100.0
            neuro_evidence = f"GCS = {gcs_val:.0f} (range 3-15)"
        else:
            neuro_avail = False
            neuro_sev = 0.0
            neuro_evidence = "DATA UNAVAILABLE"

        neuro_cat = categorize_severity(neuro_sev, neuro_avail)

        # ----------------------------------------------------------------------
        # 2. CARDIOVASCULAR (MAP_first, HR_first, SysABP_first)
        # ----------------------------------------------------------------------
        map_val = params.get("MAP_first")
        hr_val = params.get("HR_first")
        sysabp_val = params.get("SysABP_first")

        if "cardiovascular" in overrides:
            cardio_sev = max(0.0, min(100.0, float(overrides["cardiovascular"])))
            cardio_avail = True
            cardio_evidence = f"Simulated Override: {cardio_sev:.1f}/100"
        elif map_val is not None or hr_val is not None or sysabp_val is not None:
            cardio_avail = True
            m_v = map_val if map_val is not None else 85.0
            h_v = hr_val if hr_val is not None else 80.0
            s_v = sysabp_val if sysabp_val is not None else 120.0

            if m_v < 60.0 or s_v < 90.0:
                cardio_sev = 90.0
            elif m_v < 70.0 or h_v > 130.0 or h_v < 40.0:
                cardio_sev = 70.0
            elif m_v < 80.0 or h_v > 110.0:
                cardio_sev = 40.0
            else:
                cardio_sev = 10.0
            
            cardio_evidence = f"MAP = {m_v:.1f} mmHg, HR = {h_v:.0f} bpm, SysABP = {s_v:.0f} mmHg"
        else:
            cardio_avail = False
            cardio_sev = 0.0
            cardio_evidence = "DATA UNAVAILABLE"

        cardio_cat = categorize_severity(cardio_sev, cardio_avail)

        # ----------------------------------------------------------------------
        # 3. RESPIRATORY (SaO2_first, PaO2/FiO2 estimation)
        # ----------------------------------------------------------------------
        sao2_val = params.get("SaO2_first")
        if "respiratory" in overrides:
            resp_sev = max(0.0, min(100.0, float(overrides["respiratory"])))
            resp_avail = True
            resp_evidence = f"Simulated Override: {resp_sev:.1f}/100"
        elif sao2_val is not None and sao2_val > 0:
            resp_avail = True
            if sao2_val < 85.0:
                resp_sev = 100.0
            elif sao2_val < 90.0:
                resp_sev = 75.0
            elif sao2_val < 94.0:
                resp_sev = 50.0
            elif sao2_val < 96.0:
                resp_sev = 25.0
            else:
                resp_sev = 0.0
            resp_evidence = f"SaO2 = {sao2_val:.1f}%"
        else:
            resp_avail = False
            resp_sev = 0.0
            resp_evidence = "DATA UNAVAILABLE"

        resp_cat = categorize_severity(resp_sev, resp_avail)

        # ----------------------------------------------------------------------
        # 4. COAGULATION (WBC_first proxy / Platelets)
        # ----------------------------------------------------------------------
        wbc_val = params.get("WBC_first")
        if "coagulation" in overrides:
            coag_sev = max(0.0, min(100.0, float(overrides["coagulation"])))
            coag_avail = True
            coag_evidence = f"Simulated Override: {coag_sev:.1f}/100"
        elif wbc_val is not None and wbc_val > 0:
            coag_avail = True
            if wbc_val > 25.0 or wbc_val < 2.0:
                coag_sev = 80.0
            elif wbc_val > 15.0 or wbc_val < 4.0:
                coag_sev = 50.0
            elif wbc_val > 12.0:
                coag_sev = 25.0
            else:
                coag_sev = 0.0
            coag_evidence = f"WBC = {wbc_val:.1f} k/µL"
        else:
            coag_avail = False
            coag_sev = 0.0
            coag_evidence = "DATA UNAVAILABLE"

        coag_cat = categorize_severity(coag_sev, coag_avail)

        # ----------------------------------------------------------------------
        # 5. LIVER (Lactate_first proxy / Bilirubin)
        # ----------------------------------------------------------------------
        lac_val = params.get("Lactate_first")
        if "liver" in overrides:
            liver_sev = max(0.0, min(100.0, float(overrides["liver"])))
            liver_avail = True
            liver_evidence = f"Simulated Override: {liver_sev:.1f}/100"
        elif lac_val is not None and lac_val > 0:
            liver_avail = True
            if lac_val >= 4.0:
                liver_sev = 90.0
            elif lac_val >= 2.5:
                liver_sev = 65.0
            elif lac_val >= 1.5:
                liver_sev = 35.0
            else:
                liver_sev = 0.0
            liver_evidence = f"Lactate = {lac_val:.1f} mmol/L"
        else:
            liver_avail = False
            liver_sev = 0.0
            liver_evidence = "DATA UNAVAILABLE"

        liver_cat = categorize_severity(liver_sev, liver_avail)

        # ----------------------------------------------------------------------
        # 6. KIDNEY (Creatinine_first, UrineOutputSum)
        # ----------------------------------------------------------------------
        creat_val = params.get("Creatinine_first")
        urine_val = params.get("UrineOutputSum")

        if "kidney" in overrides:
            kidney_sev = max(0.0, min(100.0, float(overrides["kidney"])))
            kidney_avail = True
            kidney_evidence = f"Simulated Override: {kidney_sev:.1f}/100"
        elif creat_val is not None or urine_val is not None:
            kidney_avail = True
            c_v = creat_val if creat_val is not None else 1.0
            u_v = urine_val if urine_val is not None else 1500.0

            if c_v >= 4.0 or (u_v > 0 and u_v < 300.0):
                kidney_sev = 90.0
            elif c_v >= 2.5 or (u_v > 0 and u_v < 600.0):
                kidney_sev = 70.0
            elif c_v >= 1.5 or (u_v > 0 and u_v < 1000.0):
                kidney_sev = 45.0
            elif c_v >= 1.2:
                kidney_sev = 20.0
            else:
                kidney_sev = 0.0
            kidney_evidence = f"Creatinine = {c_v:.1f} mg/dL, UrineOutput = {u_v:.0f} mL/day"
        else:
            kidney_avail = False
            kidney_sev = 0.0
            kidney_evidence = "DATA UNAVAILABLE"

        kidney_cat = categorize_severity(kidney_sev, kidney_avail)

        # ----------------------------------------------------------------------
        # OVERALL SEVERITY CALCULATION
        # ----------------------------------------------------------------------
        organ_list = [
            ("Neurological", neuro_sev, neuro_avail),
            ("Cardiovascular", cardio_sev, cardio_avail),
            ("Respiratory", resp_sev, resp_avail),
            ("Coagulation", coag_sev, coag_avail),
            ("Liver", liver_sev, liver_avail),
            ("Kidney", kidney_sev, kidney_avail)
        ]

        valid_organs = [item for item in organ_list if item[2]]
        
        # If overrides are present, calculate dynamic overall severity
        if overrides and valid_organs:
            valid_scores = [item[1] for item in valid_organs]
            calculated_overall = round(max(valid_scores) * 0.50 + (sum(valid_scores) / len(valid_scores)) * 0.50, 1)
        else:
            # Preserve baseline SOFA derived severity (patient.severity) while backing it with clinical organ factors
            base_sev = getattr(patient, "severity", 0.0)
            if valid_organs:
                valid_scores = [item[1] for item in valid_organs]
                max_organ = max(valid_scores)
                calculated_overall = max(base_sev, round(max_organ * 0.60 + base_sev * 0.40, 1))
            else:
                calculated_overall = base_sev

        # Identify dominant organ contributors
        sorted_valid = sorted([item for item in valid_organs if item[1] > 0], key=lambda x: x[1], reverse=True)
        dominant_contributors = [item[0] for item in sorted_valid[:3]] if sorted_valid else ["SOFA Global Failure"]

        clinical_factors = {
            "neurological": {
                "name": "Neurological",
                "severity": round(neuro_sev, 1),
                "category": neuro_cat,
                "evidence": neuro_evidence,
                "available": neuro_avail
            },
            "cardiovascular": {
                "name": "Cardiovascular",
                "severity": round(cardio_sev, 1),
                "category": cardio_cat,
                "evidence": cardio_evidence,
                "available": cardio_avail
            },
            "respiratory": {
                "name": "Respiratory",
                "severity": round(resp_sev, 1),
                "category": resp_cat,
                "evidence": resp_evidence,
                "available": resp_avail
            },
            "coagulation": {
                "name": "Coagulation",
                "severity": round(coag_sev, 1),
                "category": coag_cat,
                "evidence": coag_evidence,
                "available": coag_avail
            },
            "liver": {
                "name": "Liver",
                "severity": round(liver_sev, 1),
                "category": liver_cat,
                "evidence": liver_evidence,
                "available": liver_avail
            },
            "kidney": {
                "name": "Kidney",
                "severity": round(kidney_sev, 1),
                "category": kidney_cat,
                "evidence": kidney_evidence,
                "available": kidney_avail
            }
        }

        prognosis_score = getattr(patient, "survival_likelihood", 75.0)
        waiting_mins = getattr(patient, "waiting_time_minutes", 30)

        return {
            "patient_id": getattr(patient, "patient_id", "N/A"),
            "clinical_factors": clinical_factors,
            "overall_severity": {
                "score": round(calculated_overall, 1),
                "category": categorize_severity(calculated_overall, True),
                "dominant_contributors": dominant_contributors,
                "sofa_score": getattr(patient, "sofa_score", 0.0)
            },
            "prognosis": {
                "score": prognosis_score,
                "label": "Long-Term Prognostic Survival Likelihood",
                "source": "Baseline Clinical Survival Model (V5 Baseline)"
            },
            "operational_waiting": {
                "waiting_time_minutes": waiting_mins,
                "label": "Operational Waiting Duration Equity"
            }
        }
