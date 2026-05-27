import asyncio

from sqlalchemy import select

from src.db.engine import get_db_session
from src.db.models import User


async def main():
    async for db in get_db_session():
        user_id = "00000000-0000-0000-0000-000000000000"
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            new_user = User(id=user_id, email="default@example.com")
            db.add(new_user)
            await db.commit()
            print("Inserted default user.")
        else:
            print("Default user already exists.")


if __name__ == "__main__":
    asyncio.run(main())
