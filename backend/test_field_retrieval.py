import asyncio

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.services.rag_retrieval import HybridRetriever


async def main():
    settings = get_settings()

    async with get_session_factory()() as session:
        retriever = HybridRetriever(session, settings)

        results = await retriever.search(
            "field officer forest operations",
            {
                "domain": "FIELD",
            },
        )

        print(f"\nRESULT COUNT: {len(results)}")

        for item in results:
            print(
                f"chunk={item.chunk_id} | "
                f"book={item.book_title} | "
                f"document={item.filename} | "
                f"score={item.relevance_score:.4f}"
            )


if __name__ == "__main__":
    asyncio.run(main())