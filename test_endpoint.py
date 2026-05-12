import asyncio
import sys
import os

# Add the project root to sys.path to allow imports
sys.path.append(os.getcwd())

from backend.services.openai_service import test_connection

async def main():
    print("Testing connection to vLLM endpoint...")
    success, result = await test_connection()
    if success:
        print(f"✅ Success! Response: {result}")
    else:
        print(f"❌ Failed! Error: {result}")

if __name__ == "__main__":
    asyncio.run(main())
