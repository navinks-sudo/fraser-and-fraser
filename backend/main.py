from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from backend.config import settings
from backend.routers import auth, projects, batches, images, visionmax, textiq, indexgenius, gedcomx, treeviewer, pipeline, family_groups
from backend.database import engine, Base
import logging

# Ensure models are imported for Base.metadata.create_all
from backend.models import all_models 

app = FastAPI(title="GenealogIQ API")
print(f"CORS Allowed Origins: {settings.allowed_origins}")

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        # Create tables if they don't exist
        await conn.run_sync(Base.metadata.create_all)
        # Inline schema migrations for SQLite — create_all doesn't ALTER.
        # Idempotent: checks PRAGMA table_info before each ADD COLUMN.
        await conn.run_sync(_run_inline_migrations)


def _run_inline_migrations(sync_conn):
    """Add columns that were introduced after the original schema. SQLite
    lacks ADD COLUMN IF NOT EXISTS, so we inspect PRAGMA table_info first."""
    from sqlalchemy import text as sql_text

    # Each migration is (table, column, ddl-fragment)
    migrations = [
        ("images", "rotation",             "INTEGER DEFAULT 0"),
        ("images", "family_group_id",      "VARCHAR"),
        ("images", "family_group_label",   "VARCHAR"),
        ("batches", "tree_data",                 "TEXT"),
        ("batches", "tree_persons_count",        "INTEGER DEFAULT 0"),
        ("batches", "tree_relationships_count",  "INTEGER DEFAULT 0"),
        ("batches", "tree_built_at",             "DATETIME"),
        ("projects", "research_mode",      "VARCHAR DEFAULT 'mixed'"),
        ("projects", "family_label",       "VARCHAR"),
    ]
    for table, column, ddl in migrations:
        existing = {row[1] for row in sync_conn.execute(
            sql_text(f"PRAGMA table_info({table})")
        ).fetchall()}
        if column not in existing:
            sync_conn.execute(sql_text(
                f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"
            ))

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for image serving
app.mount("/storage", StaticFiles(directory="storage"), name="storage")

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(batches.router)
app.include_router(images.router)
app.include_router(visionmax.router)
app.include_router(textiq.router)
app.include_router(indexgenius.router)
app.include_router(gedcomx.router)
app.include_router(treeviewer.router)
app.include_router(pipeline.router)
app.include_router(family_groups.router)

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/")
async def root():
    return {"message": "Welcome to GenealogIQ API"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
