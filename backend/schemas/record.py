from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any


class FamilyMember(BaseModel):
    name: str
    relation: str


class Person(BaseModel):
    name: str
    gender: Optional[str] = Field(None, description="M | F | U")
    role: Optional[str] = Field(None, description="subject | father | mother | spouse | child | witness | godparent | other")
    age: Optional[str] = None
    date_of_birth: Optional[str] = None
    date_of_death: Optional[str] = None
    occupation: Optional[str] = None
    place: Optional[str] = None
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0, description="Model self-rated confidence (0-1)")


class Relation(BaseModel):
    person_a: str = Field(..., description="Name of the first person")
    person_b: str = Field(..., description="Name of the second person")
    type: str = Field(..., description="parent_of | child_of | spouse_of | sibling_of | godparent_of | witness_of | other")
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0)


class MetadataField(BaseModel):
    """Open-ended metadata field — anything the model finds in the document
    that doesn't fit the standard schema slots."""
    label: str = Field(..., description="Human-readable label, e.g. 'Place of baptism'")
    value: str
    category: Optional[str] = Field(
        None,
        description="date | place | name | occupation | age | civil_status | religious | event | identifier | language | other",
    )
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    notes: Optional[str] = None


class RecordExtraction(BaseModel):
    record_number: Optional[str] = None
    event_type: Optional[str] = Field(None, description="birth | death | marriage | baptism | burial | other")
    given_name: Optional[str] = None
    surname: Optional[str] = None
    date_of_birth: Optional[str] = None
    date_of_death: Optional[str] = None
    date_of_event: Optional[str] = None
    place_of_event: Optional[str] = None
    father_name: Optional[str] = None
    mother_name: Optional[str] = None
    family_members: List[FamilyMember] = []
    persons: List[Person] = []
    relations: List[Relation] = []
    metadata: List[MetadataField] = []
    field_confidences: Dict[str, float] = Field(
        default_factory=dict,
        description="Per-field self-rated confidence (0-1), keys like given_name, father_name, …",
    )
    additional_info: dict = {}
