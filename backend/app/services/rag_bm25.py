from __future__ import annotations
import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable

_TOKEN_RE = re.compile(r"[A-Za-z0-9\u0900-\u097F]+", re.UNICODE)

def tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text or "")]

@dataclass(slots=True)
class BM25Document:
    chunk_id: str
    tokens: list[str]
    metadata: dict

class BM25Index:
    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1, self.b = k1, b
        self.documents: list[BM25Document] = []
        self.doc_freq: Counter[str] = Counter()
        self.avgdl = 0.0

    def build(self, records: Iterable[dict]) -> None:
        self.documents = []
        self.doc_freq = Counter()
        for record in records:
            tokens = tokenize(record.get("text", ""))
            if not tokens:
                continue
            self.documents.append(BM25Document(record["chunk_id"], tokens, record))
            for term in set(tokens):
                self.doc_freq[term] += 1
        self.avgdl = (
            sum(len(d.tokens) for d in self.documents) / len(self.documents)
            if self.documents else 0.0
        )

    def search(self, query: str, top_k: int = 10, allowed_ids: set[str] | None = None) -> list[tuple[dict, float]]:
        qterms = tokenize(query)
        if not qterms or not self.documents:
            return []
        n = len(self.documents)
        scored: list[tuple[float, BM25Document]] = []
        for doc in self.documents:
            if allowed_ids is not None and doc.chunk_id not in allowed_ids:
                continue
            tf = Counter(doc.tokens)
            dl = len(doc.tokens)
            score = 0.0
            for term in qterms:
                f = tf.get(term, 0)
                if not f:
                    continue
                df = self.doc_freq.get(term, 0)
                idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
                denom = f + self.k1 * (1 - self.b + self.b * dl / max(self.avgdl, 1.0))
                score += idf * (f * (self.k1 + 1)) / denom
            if score > 0:
                scored.append((score, doc))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [(d.metadata, s) for s, d in scored[:top_k]]
