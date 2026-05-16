from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    projects = relationship("Project", back_populates="user", cascade="all, delete-orphan")

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text)
    status = Column(String, default="active")
    # 'single_family' = every uploaded cert auto-joins one named family group.
    # 'mixed'         = standard flow, run auto-detection after Process all.
    research_mode = Column(String, default="mixed")
    # Used as the family-group label when research_mode == 'single_family'
    family_label = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user = relationship("User", back_populates="projects")
    batches = relationship("Batch", back_populates="project", cascade="all, delete-orphan")

class Batch(Base):
    __tablename__ = "batches"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text)
    status = Column(String, default="pending")
    image_count = Column(Integer, default=0)
    tree_data = Column(Text, nullable=True)              # Gemini-built GedcomX (JSON)
    tree_persons_count = Column(Integer, default=0)
    tree_relationships_count = Column(Integer, default=0)
    tree_built_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("Project", back_populates="batches")
    images = relationship("Image", back_populates="batch", cascade="all, delete-orphan")

class Image(Base):
    __tablename__ = "images"
    
    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("batches.id", ondelete="CASCADE"), nullable=False)
    original_filename = Column(String, nullable=False)
    original_path = Column(String, nullable=False)
    enhanced_path = Column(String)
    enhanced_backup_path = Column(String)
    has_enhancement = Column(Boolean, default=False)
    visionmax_status = Column(String, default="pending")
    textiq_status = Column(String, default="pending")
    indexgenius_status = Column(String, default="pending")
    gedcomx_status = Column(String, default="pending")
    segment_status = Column(String, default="pending")
    region_data = Column(Text, nullable=True)
    file_type = Column(String, default="image")  # "image" | "spreadsheet"
    spreadsheet_data = Column(Text, nullable=True)  # JSON of {sheets: [{name, columns, rows}]}
    rotation = Column(Integer, default=0)           # 0/90/180/270 degrees CW
    sort_order = Column(Integer, default=0)
    # Family-group membership: null = standalone; same string = same family.
    # Populated by the auto-detection / user-confirm flow.
    family_group_id = Column(String, nullable=True, index=True)
    family_group_label = Column(String, nullable=True)  # human-friendly e.g. "Clifford family"
    created_at = Column(DateTime, default=datetime.utcnow)
    
    batch = relationship("Batch", back_populates="images")
    ocr_text = relationship("OCRText", back_populates="image", uselist=False, cascade="all, delete-orphan")
    records = relationship("Record", back_populates="image", cascade="all, delete-orphan")

class OCRText(Base):
    __tablename__ = "ocr_texts"

    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id", ondelete="CASCADE"), unique=True, nullable=False)
    current_text = Column(Text)
    original_text = Column(Text)
    regions = Column(Text, nullable=True)            # JSON: per-region text, language, word/char confidence
    language_detected = Column(String, nullable=True)
    translation_en = Column(Text, nullable=True)
    has_edits = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    image = relationship("Image", back_populates="ocr_text")

class Record(Base):
    __tablename__ = "records"
    
    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id", ondelete="CASCADE"), nullable=False)
    record_number = Column(String)
    event_type = Column(String)
    given_name = Column(String)
    surname = Column(String)
    date_of_birth = Column(String)
    date_of_death = Column(String)
    date_of_event = Column(String)
    father_name = Column(String)
    mother_name = Column(String)
    family_members = Column(Text)  # JSON string
    persons_extracted = Column(Text)    # JSON list of Person dicts
    relations_extracted = Column(Text)  # JSON list of Relation dicts
    metadata_extracted = Column(Text)   # JSON list of MetadataField dicts (open-ended fields)
    field_confidences = Column(Text)    # JSON dict {field_name: confidence_0_1}
    place_of_event = Column(String, nullable=True)
    additional_info = Column(Text) # JSON string
    raw_extracted = Column(Text)   # JSON string
    has_edits = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    image = relationship("Image", back_populates="records")
    gedcomx = relationship("GedcomXRecord", back_populates="record", uselist=False, cascade="all, delete-orphan")

class GedcomXRecord(Base):
    __tablename__ = "gedcomx_records"
    
    id = Column(Integer, primary_key=True, index=True)
    record_id = Column(Integer, ForeignKey("records.id", ondelete="CASCADE"), unique=True, nullable=False)
    gedcomx_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    record = relationship("Record", back_populates="gedcomx")
