"""
CareGrid V1 - Data Provenance Tracking
Explicitly marks data origin to maintain clinical transparency.
"""

class ProvenanceType:
    SOURCE_VALUE = "SOURCE_VALUE"       # Direct value from verified raw CSV datasets
    DERIVED_VALUE = "DERIVED_VALUE"     # Mathematically transformed/calculated from raw dataset values
    SIMULATED_VALUE = "SIMULATED_VALUE" # Synthetically generated or mock value (not clinical ground truth)


class FieldProvenance:
    def __init__(self, value, provenance_type: str, source_field: str = None, calculation: str = None):
        self.value = value
        self.provenance_type = provenance_type
        self.source_field = source_field
        self.calculation = calculation

    def to_dict(self):
        return {
            "value": self.value,
            "provenance": self.provenance_type,
            "source_field": self.source_field,
            "calculation": self.calculation
        }
