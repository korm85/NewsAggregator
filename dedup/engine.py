import re
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import config
from dedup import storage


def _normalize(text: str) -> str:
    """Lowercase, strip URLs and punctuation for cleaner comparison."""
    text = text.lower()
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_duplicate(text: str) -> bool:
    """
    Returns True if `text` is a duplicate of something seen recently.
    Checks exact hash first (fast), then TF-IDF cosine similarity (semantic).
    """
    if len(text.strip()) < config.MIN_TEXT_LENGTH:
        return False

    if storage.is_exact_duplicate(text):
        return True

    recent = storage.get_recent_texts()
    if not recent:
        return False

    norm_new = _normalize(text)
    norm_recent = [_normalize(t) for t in recent]

    try:
        vectorizer = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
        corpus = norm_recent + [norm_new]
        tfidf = vectorizer.fit_transform(corpus)
        # Compare the new text (last row) against all previous texts
        similarities = cosine_similarity(tfidf[-1], tfidf[:-1]).flatten()
        return float(similarities.max()) >= config.SIMILARITY_THRESHOLD
    except ValueError:
        # Vectorizer can fail on very short / empty texts after normalization
        return False
