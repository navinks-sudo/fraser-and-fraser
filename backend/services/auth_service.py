from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from backend.models.all_models import User
from backend.core.security import get_password_hash, verify_password, create_access_token
from backend.schemas.auth import UserCreate, Token
from fastapi import HTTPException, status

class AuthService:
    async def register_user(self, db: AsyncSession, user_data: UserCreate):
        # Check if user already exists
        result = await db.execute(select(User).where((User.email == user_data.email) | (User.username == user_data.username)))
        if result.scalars().first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username or email already registered"
            )
        
        hashed_pw = get_password_hash(user_data.password)
        new_user = User(
            email=user_data.email,
            username=user_data.username,
            hashed_password=hashed_pw
        )
        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)
        return new_user

    async def authenticate_user(self, db: AsyncSession, username: str, password: str):
        result = await db.execute(select(User).where(User.username == username))
        user = result.scalars().first()
        if not user or not verify_password(password, user.hashed_password):
            return False
        return user
