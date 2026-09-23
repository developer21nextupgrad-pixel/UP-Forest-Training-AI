"""Environment-driven settings (PRD §91) — no hardcoded configuration.

Every deployer-tunable value lives here, sourced from environment variables
via ``pydantic-settings``. Nothing in ``services/`` or ``api/`` should read
``os.environ`` directly — they take a ``Settings`` instance instead.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from fastapi import Depends
from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    environment: Literal["local", "staging", "production"] = Field(
        default="local", validation_alias=AliasChoices("ENVIRONMENT", "APP_ENV")
    )
    # Application persistence
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/up_forest"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    password_reset_expire_minutes: int = 60
    frontend_base_url: str = "http://localhost:3000"

    # Optional SMTP delivery for password-reset emails. Local development can
    # use the debug reset URL returned by the reset-request endpoint.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_use_tls: bool = True

    host: str = "0.0.0.0"
    port: int = 8000

    # Progress intelligence / mastery
    mastery_quiz_weight: float = 0.50
    quiz_latest_weight: float = 0.50
    quiz_average_weight: float = 0.30
    quiz_best_weight: float = 0.20
    mastery_completion_weight: float = 0.25
    mastery_recency_weight: float = 0.15
    mastery_activity_weight: float = 0.10
    mastery_weak_threshold: float = 40.0
    mastery_review_threshold: float = 60.0
    mastery_mastered_threshold: float = 80.0
    min_evidence_for_mastered: int = 2
    recency_decay_days: float = 30.0

    review_interval_very_weak_days: int = 1
    review_interval_weak_days: int = 3
    review_interval_developing_days: int = 7
    review_interval_good_days: int = 14
    review_interval_mastered_days: int = 30

    review_priority_weakness_weight: float = 0.40
    review_priority_recency_weight: float = 0.25
    review_priority_decline_weight: float = 0.20
    review_priority_coverage_weight: float = 0.15
    progress_cache_ttl_seconds: int = 300
    activity_points_per_event: float = 10.0
    activity_signal_cap: float = 50.0
    decline_points_multiplier: float = 2.0

    # Instructor/Admin intelligence
    learning_risk_mastery_weight: float = 0.30
    learning_risk_coverage_weight: float = 0.20
    learning_risk_decline_weight: float = 0.20
    learning_risk_inactivity_weight: float = 0.15
    learning_risk_overdue_weight: float = 0.15
    learning_risk_high_threshold: float = 60.0
    learning_risk_medium_threshold: float = 35.0
    risk_inactivity_warning_days: int = 7
    risk_inactivity_high_days: int = 30
    risk_overdue_saturation_count: int = 5
    analytics_cache_ttl_seconds: int = 300
    quiz_question_min_evidence: int = 3

    # Mistral
    mistral_api_key: str = Field(default="")
    mistral_base_url: str = "https://api.mistral.ai"
    ocr_model: str = "mistral-ocr-latest"
    stt_model: str = "voxtral-mini-latest"
    stt_realtime_model: str = "voxtral-mini-transcribe-realtime-2602"
    # OpenRouter - RAG/LLM testing
    openrouter_api_key: str = Field(default="")
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_chat_model: str = "mistralai/mistral-small-3.2-24b-instruct"
    # Lower = words appear sooner but with a bit less context to correct
    # itself; Mistral supports down to ~200ms. 250ms favors a "quick" feel
    # (PRD's core philosophy — never feel frozen) without being twitchy.
    stt_streaming_delay_ms: int = 250
    # After Stop, re-transcribe the full recording with the batch model
    # (better full-context accuracy than the latency-optimized realtime
    # model) and replace the live transcript with the refined one.
    stt_refine_after_stop: bool = True

    # CORS — comma-separated origins, e.g. "http://localhost:3000,https://app.example.com"
    cors_origins: str = "http://localhost:3000"

    # Upload / processing limits (PRD §78/§87)
    max_upload_size_mb: int = 100  # scanned books run tens-to-hundreds of MB
    ocr_timeout_seconds: int = 30  # single-shot path only (POST /ocr, images)
    speech_timeout_seconds: int = 60
    # Pages per Mistral OCR call when batching a multi-page PDF — small
    # enough that progress updates feel responsive, large enough to not
    # drown in per-call overhead for a few-hundred-page book.
    ocr_batch_pages: int = 20
    # Hard cap so a malicious/huge upload can't tie up the server
    # indefinitely — 1500 pages covers essentially any real book.
    ocr_max_pages: int = 1500
    # Per-batch timeout scales with batch size instead of reusing the
    # single-shot timeout — a batch of 20 image-heavy scanned pages
    # legitimately needs minutes, not the 30s a single quick image gets.
    # Tune this once real per-page timing data exists for your documents.
    ocr_seconds_per_page: float = 15.0
    ocr_batch_timeout_floor_seconds: int = 60
    # Batches run concurrently (bounded by this) rather than one-at-a-time —
    # each Mistral OCR call is I/O-bound, so a few hundred pages finishes in
    # roughly 1/N the time instead of a strictly serial queue. Kept modest
    # by default so a single document doesn't itself look like a burst of
    # abuse against Mistral's own per-key rate limits.

    # RAG
    rag_embedding_model: str = "mistral-embed"
    rag_chat_model: str = "mistral-small-latest"
    rag_chunk_size: int = 1200
    rag_chunk_overlap: int = 200
    rag_embedding_batch_size: int = 32
    rag_top_k: int = 5
    rag_dense_top_k: int = 10
    rag_bm25_top_k: int = 10
    rag_fused_top_k: int = 8
    rag_context_top_k: int = 5
    rag_similarity_threshold: float = 0.35
    rag_min_confidence: float = 0.45
    rag_max_citations: int = 5
    rag_dense_weight: float = 0.60
    rag_bm25_weight: float = 0.30
    rag_metadata_weight: float = 0.10
    rag_bm25_k1: float = 1.5
    rag_bm25_b: float = 0.75
    rag_reranker_enabled: bool = False
    rag_max_context_chars: int = 20000
    tutor_max_history_messages: int = 10
    rag_embedding_timeout_seconds: float = 120.0
    rag_chat_timeout_seconds: float = 90.0
    rag_index_dir: str = "data/rag"
    mistral_max_retries: int = 3
    llm_max_concurrency: int = 4
    embedding_max_concurrency: int = 2
    ocr_max_concurrency: int = 4
    mistral_retry_base_seconds: float = 1.0
    embedding_provider: str = "mistral"
    content_cache_ttl_seconds: int = 300


    # Document ingestion / storage
    storage_backend: Literal["local"] = "local"
    storage_root: str = "data/documents"
    ingestion_max_concurrency: int = 1
    ingestion_job_timeout_seconds: int = 7200
    vector_store: Literal["pgvector", "faiss"] = "pgvector"

    # Every OCR/Speech call proxies to a paid Mistral API call — this caps
    # abuse (or a retry-looping bug) per client IP, per endpoint family.
    rate_limit_requests_per_minute: int = 10

    @model_validator(mode="after")
    def validate_progress_weights(self):
        weights = (
            self.mastery_quiz_weight,
            self.mastery_completion_weight,
            self.mastery_recency_weight,
            self.mastery_activity_weight,
        )
        if any(w <= 0 or w > 1 for w in weights) or abs(sum(weights) - 1.0) > 1e-9:
            raise ValueError("Mastery weights must be > 0, <= 1, and sum exactly to 1.0")
        quiz_weights = (self.quiz_latest_weight, self.quiz_average_weight, self.quiz_best_weight)
        if any(w <= 0 or w > 1 for w in quiz_weights) or abs(sum(quiz_weights) - 1.0) > 1e-9:
            raise ValueError("Quiz signal weights must be > 0, <= 1, and sum exactly to 1.0")
        priority_weights = (
            self.review_priority_weakness_weight,
            self.review_priority_recency_weight,
            self.review_priority_decline_weight,
            self.review_priority_coverage_weight,
        )
        if any(w <= 0 or w > 1 for w in priority_weights) or abs(sum(priority_weights) - 1.0) > 1e-9:
            raise ValueError("Review priority weights must be > 0, <= 1, and sum exactly to 1.0")
        if not (0 <= self.mastery_weak_threshold < self.mastery_review_threshold < self.mastery_mastered_threshold <= 100):
            raise ValueError("Mastery thresholds must satisfy 0 <= weak < review < mastered <= 100")
        risk_weights = (
            self.learning_risk_mastery_weight,
            self.learning_risk_coverage_weight,
            self.learning_risk_decline_weight,
            self.learning_risk_inactivity_weight,
            self.learning_risk_overdue_weight,
        )
        if any(w <= 0 or w > 1 for w in risk_weights) or abs(sum(risk_weights) - 1.0) > 1e-9:
            raise ValueError("Learning risk weights must be > 0, <= 1, and sum exactly to 1.0")
        if not (0 <= self.learning_risk_medium_threshold < self.learning_risk_high_threshold <= 100):
            raise ValueError("Learning risk thresholds must satisfy 0 <= medium < high <= 100")
        if self.risk_inactivity_warning_days < 1 or self.risk_inactivity_high_days <= self.risk_inactivity_warning_days:
            raise ValueError("Inactivity thresholds must be positive and ordered")
        if self.risk_overdue_saturation_count < 1 or self.analytics_cache_ttl_seconds < 1 or self.quiz_question_min_evidence < 1:
            raise ValueError("Risk/cache configuration must be positive")
        if not (0.0 <= self.rag_min_confidence <= 1.0):
            raise ValueError("RAG minimum confidence must be between 0 and 1")
        if self.rag_max_citations < 1 or self.content_cache_ttl_seconds < 1:

            raise ValueError("RAG citation and content cache settings must be positive")
        retrieval_weights = (self.rag_dense_weight, self.rag_bm25_weight, self.rag_metadata_weight)
        if any(w < 0 for w in retrieval_weights) or abs(sum(retrieval_weights) - 1.0) > 1e-9:
            raise ValueError("RAG retrieval weights must be non-negative and sum exactly to 1.0")
        if (
            self.min_evidence_for_mastered < 1
            or self.recency_decay_days <= 0
            or self.activity_points_per_event <= 0
            or self.activity_signal_cap <= 0
            or self.decline_points_multiplier <= 0
        ):
            raise ValueError("Evidence, recency, activity and decline configuration must be positive")
        if self.mistral_max_retries < 0 or self.llm_max_concurrency < 1 or self.embedding_max_concurrency < 1 or self.ocr_max_concurrency < 1:
            raise ValueError("Mistral concurrency/retry settings must be non-negative and positive where applicable")
        if self.mistral_retry_base_seconds <= 0:
            raise ValueError("MISTRAL retry base must be positive")
        if self.environment == "production" and self.vector_store != "pgvector":
            raise ValueError("Production environments must use pgvector")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    def ocr_batch_timeout_seconds(self, page_count: int) -> float:
        return max(
            self.ocr_batch_timeout_floor_seconds, self.ocr_seconds_per_page * page_count
        )

    @property
    def is_mistral_configured(self) -> bool:
        return bool(self.mistral_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


SettingsDep = Annotated[Settings, Depends(get_settings)]
