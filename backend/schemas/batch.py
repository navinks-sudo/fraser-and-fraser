from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class BatchBase(BaseModel):
    name: str
    description: Optional[str] = None

class BatchCreate(BatchBase):
    pass

class BatchUpdate(BatchBase):
    name: Optional[str] = None
    status: Optional[str] = None

class BatchResponse(BatchBase):
    id: int
    project_id: int
    status: str
    image_count: int
    tree_built_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
