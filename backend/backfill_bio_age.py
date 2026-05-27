import asyncio
from datetime import date as date_type
from sqlalchemy import select
from src.db.engine import async_session_factory
from src.db.models import FitnessEstimate, User
from src.metrics.derived import compute_biological_age

async def backfill():
    async with async_session_factory() as db:
        users = await db.execute(select(User))
        for user in users.scalars().all():
            if not user.birthdate: continue
            age = (date_type.today() - user.birthdate).days // 365
            
            estimates = await db.execute(select(FitnessEstimate).where(FitnessEstimate.user_id == user.id))
            for est in estimates.scalars().all():
                if est.vo2max_vendor:
                    est.biological_age_app = compute_biological_age(est.vo2max_vendor, age)
        
        await db.commit()
        print("Backfill complete")

if __name__ == "__main__":
    asyncio.run(backfill())
