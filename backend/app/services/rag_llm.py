# from __future__ import annotations

# import asyncio
# import logging
# import random

# import httpx

# from app.core.config import Settings

# logger=logging.getLogger(__name__)
# _semaphores: dict[tuple[int,int], asyncio.Semaphore] = {}

# def _gate(limit:int)->asyncio.Semaphore:
#     loop=asyncio.get_running_loop(); key=(id(loop),limit)
#     return _semaphores.setdefault(key, asyncio.Semaphore(limit))

# class LLMProvider:
#     async def generate(self, *, system:str, user:str, temperature:float=0.1)->str: raise NotImplementedError

# class MistralLLMProvider(LLMProvider):
#     def __init__(self, settings:Settings)->None: self.settings=settings
#     def _url(self)->str:
#         base=self.settings.mistral_base_url.rstrip("/"); return f"{base}/chat/completions" if base.endswith("/v1") else f"{base}/v1/chat/completions"
#     async def generate(self, *, system:str, user:str, temperature:float=0.1)->str:
#         if not self.settings.is_mistral_configured: raise RuntimeError("MISTRAL_API_KEY is not configured")
#         payload={"model":self.settings.rag_chat_model,"temperature":temperature,"messages":[{"role":"system","content":system},{"role":"user","content":user}]}
#         headers={"Authorization":f"Bearer {self.settings.mistral_api_key}","Content-Type":"application/json"}
#         gate=_gate(self.settings.llm_max_concurrency)
#         async with gate:
#             async with httpx.AsyncClient(timeout=self.settings.rag_chat_timeout_seconds) as client:
#                 for attempt in range(self.settings.mistral_max_retries+1):
#                     try:
#                         response=await client.post(self._url(),headers=headers,json=payload)
#                         status=response.status_code
#                         if status==429 or 500<=status<600:
#                             if attempt>=self.settings.mistral_max_retries: response.raise_for_status()
#                             retry_after=response.headers.get("Retry-After")
#                             try: wait=float(retry_after) if retry_after else self.settings.mistral_retry_base_seconds*(2**attempt)
#                             except ValueError: wait=self.settings.mistral_retry_base_seconds*(2**attempt)
#                             wait+=random.uniform(0,max(0.05,wait*.25))
#                             logger.warning("Mistral chat transient status=%s retry=%d wait=%.2fs",status,attempt+1,wait)
#                             await asyncio.sleep(wait); continue
#                         response.raise_for_status()
#                         body=response.json(); content=body.get("choices",[{}])[0].get("message",{}).get("content","")
#                         if isinstance(content,list): content="".join(part.get("text","") for part in content if isinstance(part,dict))
#                         return content or ""
#                     except (httpx.TimeoutException,httpx.NetworkError) as exc:
#                         if attempt>=self.settings.mistral_max_retries: raise RuntimeError("Mistral API request failed after bounded retries") from exc
#                         wait=self.settings.mistral_retry_base_seconds*(2**attempt)+random.uniform(0,.25)
#                         await asyncio.sleep(wait)
#         raise RuntimeError("Mistral API retry budget exhausted")

from __future__ import annotations

import asyncio
import logging
import random

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)

_semaphores: dict[tuple[int, int], asyncio.Semaphore] = {}


def _gate(limit: int) -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    key = (id(loop), limit)
    return _semaphores.setdefault(key, asyncio.Semaphore(limit))


class LLMProvider:
    async def generate(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.1,
    ) -> str:
        raise NotImplementedError


class MistralLLMProvider(LLMProvider):
    """
    Backward-compatible provider name.

    Existing RAG and Quiz services use MistralLLMProvider,
    but the actual chat request is routed through OpenRouter.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _url(self) -> str:
        base = self.settings.openrouter_base_url.rstrip("/")
        return f"{base}/chat/completions"

    async def generate(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.1,
    ) -> str:

        if not self.settings.openrouter_api_key:
            raise RuntimeError(
                "OPENROUTER_API_KEY is not configured"
            )

        payload = {
            "model": self.settings.openrouter_chat_model,
            "temperature": temperature,
            "messages": [
                {
                    "role": "system",
                    "content": system,
                },
                {
                    "role": "user",
                    "content": user,
                },
            ],
        }

        headers = {
            "Authorization": (
                f"Bearer {self.settings.openrouter_api_key}"
            ),
            "Content-Type": "application/json",
        }

        gate = _gate(self.settings.llm_max_concurrency)

        async with gate:
            async with httpx.AsyncClient(
                timeout=self.settings.rag_chat_timeout_seconds
            ) as client:

                for attempt in range(
                    self.settings.mistral_max_retries + 1
                ):
                    try:
                        response = await client.post(
                            self._url(),
                            headers=headers,
                            json=payload,
                        )

                        status = response.status_code

                        if status == 429 or 500 <= status < 600:
                            if (
                                attempt
                                >= self.settings.mistral_max_retries
                            ):
                                response.raise_for_status()

                            retry_after = response.headers.get(
                                "Retry-After"
                            )

                            try:
                                wait = (
                                    float(retry_after)
                                    if retry_after
                                    else (
                                        self.settings.mistral_retry_base_seconds
                                        * (2**attempt)
                                    )
                                )
                            except ValueError:
                                wait = (
                                    self.settings.mistral_retry_base_seconds
                                    * (2**attempt)
                                )

                            wait += random.uniform(
                                0,
                                max(0.05, wait * 0.25),
                            )

                            logger.warning(
                                "OpenRouter chat transient "
                                "status=%s retry=%d wait=%.2fs",
                                status,
                                attempt + 1,
                                wait,
                            )

                            await asyncio.sleep(wait)
                            continue

                        response.raise_for_status()

                        body = response.json()

                        content = (
                            body.get("choices", [{}])[0]
                            .get("message", {})
                            .get("content", "")
                        )

                        if isinstance(content, list):
                            content = "".join(
                                part.get("text", "")
                                for part in content
                                if isinstance(part, dict)
                            )

                        return content or ""

                    except (
                        httpx.TimeoutException,
                        httpx.NetworkError,
                    ) as exc:

                        if (
                            attempt
                            >= self.settings.mistral_max_retries
                        ):
                            raise RuntimeError(
                                "OpenRouter API request failed "
                                "after bounded retries"
                            ) from exc

                        wait = (
                            self.settings.mistral_retry_base_seconds
                            * (2**attempt)
                            + random.uniform(0, 0.25)
                        )

                        await asyncio.sleep(wait)

        raise RuntimeError(
            "OpenRouter API retry budget exhausted"
        )