from openai import AsyncOpenAI
from langchain_openai import ChatOpenAI
from backend.config import settings

def get_openai_client() -> AsyncOpenAI:
    """
    Returns an AsyncOpenAI client configured with the custom base URL and API key.
    """
    return AsyncOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url
    )

def get_langchain_model() -> ChatOpenAI:
    """
    Returns a ChatOpenAI instance for LangChain, configured with the custom base URL.
    """
    return ChatOpenAI(
        openai_api_key=settings.openai_api_key,
        openai_api_base=settings.openai_base_url,
        model_name=settings.openai_model,
        streaming=False
    )

async def test_connection():
    """
    Simple test to verify connection to the vLLM endpoint.
    """
    client = get_openai_client()
    try:
        # We can't really list models if it's a fixed endpoint sometimes, 
        # but we can try a simple completion.
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[{"role": "user", "content": "Ping"}],
            max_tokens=5
        )
        return True, response.choices[0].message.content
    except Exception as e:
        return False, str(e)
