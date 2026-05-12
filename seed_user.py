import asyncio
from backend.database import engine
from backend.models import User
from backend.core.security import get_password_hash
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker

async def seed():
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        # Check if user exists
        hashed_pw = get_password_hash("password123")
        user = User(
            email="admin@genealogiq.ai",
            username="admin",
            hashed_password=hashed_pw,
            is_active=True
        )
        session.add(user)
        await session.commit()
        print("✅ User created: admin / password123")

if __name__ == "__main__":
    asyncio.run(seed())
