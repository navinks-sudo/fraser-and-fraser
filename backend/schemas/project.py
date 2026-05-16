from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime


class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None
    # 'mixed' (default) = batch may contain certificates from many families;
    # auto-detection groups them after Process all.
    # 'single_family' = every uploaded certificate belongs to ONE family;
    # auto-assigned to a project-wide family group on upload.
    research_mode: str = "mixed"
    family_label: Optional[str] = None  # required if research_mode == 'single_family'

    @field_validator("research_mode")
    @classmethod
    def validate_mode(cls, v):
        v = (v or "mixed").strip().lower()
        if v not in {"mixed", "single_family"}:
            raise ValueError("research_mode must be 'mixed' or 'single_family'")
        return v


class ProjectCreate(ProjectBase):
    @field_validator("family_label")
    @classmethod
    def require_label_when_single(cls, v, info):
        mode = (info.data.get("research_mode") or "mixed").strip().lower()
        if mode == "single_family" and not (v and v.strip()):
            raise ValueError("family_label is required when research_mode is 'single_family'")
        return v


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    research_mode: Optional[str] = None
    family_label: Optional[str] = None


class ProjectResponse(ProjectBase):
    id: int
    user_id: int
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
