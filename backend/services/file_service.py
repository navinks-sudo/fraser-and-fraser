from pathlib import Path
import shutil, uuid
from backend.config import settings

class FileService:
    BASE = Path(settings.storage_base)
    
    def user_path(self, user_id: int) -> Path:
        return self.BASE / "users" / str(user_id)
    
    def batch_path(self, user_id: int, project_id: int, batch_id: int) -> Path:
        return self.user_path(user_id) / "projects" / str(project_id) / "batches" / str(batch_id)
    
    def save_original(self, user_id: int, project_id: int, batch_id: int, file_bytes: bytes, filename: str) -> str:
        path = self.batch_path(user_id, project_id, batch_id) / "images" / "original"
        path.mkdir(parents=True, exist_ok=True)
        safe_name = f"{uuid.uuid4().hex}_{filename}"
        full_path = path / safe_name
        full_path.write_bytes(file_bytes)
        return str(full_path)
    
    def backup_enhanced(self, enhanced_path: str) -> str:
        # Assuming path format from instructions
        backup_path = enhanced_path.replace("/enhanced/", "/enhanced_backup/")
        Path(backup_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(enhanced_path, backup_path)
        return backup_path
    
    def delete_batch_files(self, user_id: int, project_id: int, batch_id: int):
        shutil.rmtree(self.batch_path(user_id, project_id, batch_id), ignore_errors=True)
